import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { pool, quoteIdentifier } from "./db.js";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config({ path: "server/.env" });
dotenv.config();

const envPath = path.join('server', '.env');
const configPassword = process.env.CONFIG_PASSWORD || 'admin';
const app = express();
// Allow overriding the listen port via `API_PORT` for running parallel instances
const port = Number(process.env.API_PORT || process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const MAX_LIMIT = 500;

const configKeys = new Set([
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'HOST',
  'PORT',
  'API_HOST',
  'API_PORT',
  'API_BASE_URL',
  'CONFIG_PASSWORD'
]);

const parseEnvFile = () => {
  const result = {};
  if (!fs.existsSync(envPath)) return result;
  const raw = fs.readFileSync(envPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([^#][^=\s]+)\s*=\s*(.*)$/);
    if (match) {
      result[match[1].trim()] = match[2].trim();
    }
  }
  return result;
};

const writeEnvFile = (values) => {
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const lines = raw.split(/\r?\n/);
  const outputLines = lines.map((line) => {
    const match = line.match(/^\s*([^#][^=\s]+)\s*=\s*(.*)$/);
    if (!match) return line;
    const key = match[1].trim();
    if (configKeys.has(key) && Object.prototype.hasOwnProperty.call(values, key)) {
      return `${key}=${values[key]}`;
    }
    return line;
  });

  for (const key of Object.keys(values)) {
    if (configKeys.has(key) && !outputLines.some((l) => l.startsWith(`${key}=`))) {
      outputLines.push(`${key}=${values[key]}`);
    }
  }

  fs.writeFileSync(envPath, outputLines.join('\n'), 'utf8');
};

app.use(cors());
app.use(express.json());

app.use("/api", (req, res, next) => {
  // Allow auth routes to accept POST (login)
  if (req.path.startsWith('/auth')) return next();
  // Allow any request that targets the server-config endpoints (be permissive)
  if (req.path && req.path.includes('server-config')) return next();
  if (req.method === 'POST' && req.path.startsWith('/orders/inbound/')) return next();
  if (req.method === 'POST' && (req.path === '/cyclic-count' || req.path.startsWith('/cyclic-count/'))) return next();
  if (req.method === 'POST' && req.path === '/scrap') return next();
  if (req.method === 'POST' && req.path === '/transfers') return next();

  if (req.method !== "GET" && req.method !== "OPTIONS") {
    return res.status(405).json({
      message: "Backend en modo solo lectura. No se permiten escrituras en MariaDB.",
    });
  }

  next();
});

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      res.status(500).json({
        message: "Error consultando MariaDB",
        detail: error.message,
      });
    }
  };
}

function getLimit(value, fallback = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIMIT);
}

function getSearch(value) {
  return String(value || "").trim();
}

function normalizeRowNumbers(rows) {
  return rows.map((row) => {
    const normalized = { ...row };
    for (const [key, value] of Object.entries(normalized)) {
      if (typeof value === "bigint") normalized[key] = Number(value);
    }
    return normalized;
  });
}

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return normalizeRowNumbers(rows);
}

const orderStatusCache = {
  byId: new Map(),
  byKey: new Map(),
  tableExists: false,
};

async function loadOrderStatusCache() {
  try {
    const [tables] = await pool.query("SHOW TABLES LIKE 'MES_STATUS'");
    if (!tables[0]) {
      orderStatusCache.tableExists = false;
      console.warn('[api] La tabla MES_STATUS no existe en la base de datos');
      return;
    }

    orderStatusCache.tableExists = true;
    const [rows] = await pool.query(`
      SELECT StatusID, StatusCode, StatusDescription
      FROM MES_STATUS
    `);
    for (const row of rows) {
      const id = Number(row.StatusID);
      const code = String(row.StatusCode || '').trim().toLowerCase();
      const desc = String(row.StatusDescription || '').trim().toLowerCase();
      orderStatusCache.byId.set(id, row);
      if (code) orderStatusCache.byKey.set(code, id);
      if (desc) orderStatusCache.byKey.set(desc, id);
    }
  } catch (error) {
    orderStatusCache.tableExists = false;
    console.warn('[api] No se pudo cargar MES_STATUS:', error.message);
  }
}

let receiptDetailColumns = new Set();
async function loadReceiptDetailColumns() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM ERP_PURCHASE_RECEIPT_DETAIL");
    for (const col of cols) {
      receiptDetailColumns.add(String(col.Field));
    }
  } catch (error) {
    console.warn('[api] No se pudo leer metadata de ERP_PURCHASE_RECEIPT_DETAIL:', error.message);
  }
}

loadOrderStatusCache().catch((error) => console.warn('[api] Error cargando status de ordenes:', error.message));
loadReceiptDetailColumns().catch((error) => console.warn('[api] Error leyendo columnas de recibo:', error.message));

function getOrderStatusIdByKey(value, moduleCode = null) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isInteger(numeric)) return numeric;
  if (!orderStatusCache.tableExists) return null;
  const normalized = String(value).trim().toLowerCase();

  // Exact lookup by code/description
  const exact = orderStatusCache.byKey.get(normalized);
  if (exact) return exact;

  // Fallback: try contains-match (optionally filtering by ModuleCode)
  for (const [id, row] of orderStatusCache.byId.entries()) {
    if (moduleCode && String(row.ModuleCode || '').trim() !== String(moduleCode).trim()) continue;
    const code = String(row.StatusCode || '').toLowerCase();
    const desc = String(row.StatusDescription || '').toLowerCase();
    if (code.includes(normalized) || desc.includes(normalized) || desc.split(/\s+/).includes(normalized)) {
      return id;
    }
  }

  return null;
}

function getOrderStatusLabel(statusId) {
  const numericId = Number(statusId);
  if (orderStatusCache.tableExists) {
    const row = orderStatusCache.byId.get(numericId);
    if (row) return row.StatusDescription || row.StatusCode || String(statusId);
  }
  return String(statusId || '');
}

function hasReceiptDetailColumn(name) {
  return receiptDetailColumns.has(name);
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  const rows = await query(
    "SELECT DATABASE() AS db, CURRENT_USER() AS user, VERSION() AS version"
  );

  res.json({
    ok: true,
    mode: "read-only",
    database: rows[0]?.db,
    user: rows[0]?.user,
    version: rows[0]?.version,
  });
}));

app.get("/api/db/tables", asyncRoute(async (_req, res) => {
  const rows = await query("SHOW FULL TABLES");
  const tables = rows.map((row) => {
    const values = Object.values(row);
    return {
      name: values[0],
      type: values[1],
    };
  });

  res.json({ tables });
}));

app.get("/api/db/tables/:table/columns", asyncRoute(async (req, res) => {
  const table = quoteIdentifier(req.params.table);
  const columns = await query(`SHOW COLUMNS FROM ${table}`);
  res.json({ columns });
}));

app.get("/api/modules", (_req, res) => {
  res.json({
    mode: "read-only",
    modules: {
      dashboard: ["/api/dashboard"],
      inventory: ["/api/inventory", "/api/inventory/:partNumber"],
      scanner: ["/api/scanner/:code"],
      cyclicCount: ["/api/cyclic-count"],
      inboundOrders: ["/api/orders/inbound", "/api/orders/inbound/:id"],
      outboundOrders: ["/api/orders/outbound", "/api/orders/outbound/:id"],
      transfers: ["/api/transfers"],
      scrap: ["/api/scrap"],
      reports: ["/api/reports/summary"],
      settings: ["/api/settings/catalogs"],
    },
  });
});

app.get("/api/dashboard", asyncRoute(async (_req, res) => {
  const pendingDeliveryStatusId = getOrderStatusIdByKey('Pendiente de entrega', 'ERP_PURCHASE_RECEIPT')
    ?? getOrderStatusIdByKey('pendiente de entrega', 'ERP_PURCHASE_RECEIPT')
    ?? getOrderStatusIdByKey('pendiente', 'ERP_PURCHASE_RECEIPT')
    ?? getOrderStatusIdByKey('pending', 'ERP_PURCHASE_RECEIPT')
    ?? null;

  const [
    inventorySummary,
    criticalInventory,
    pendingOrdersCount,
  ] = await Promise.all([
    query(`
      SELECT
        COUNT(*) AS inventoryRows,
        COUNT(DISTINCT PartNumber) AS uniqueParts,
        COALESCE(SUM(Quantity), 0) AS totalQuantity,
        COUNT(DISTINCT RackLocationID) AS occupiedRackLocations
      FROM MES_INVENTORY
    `),
    query(`
      SELECT COUNT(*) AS criticalItems
      FROM MES_INVENTORY
      WHERE Quantity <= 0
    `),
    pendingDeliveryStatusId === null
      ? Promise.resolve([{ inboundReceipts: 0 }])
      : query(`
          SELECT COUNT(*) AS inboundReceipts
          FROM ERP_PURCHASE_ORDER
          WHERE OrderStatusID = ?
        `, [pendingDeliveryStatusId]),
  ]);

  res.json({
    inventory: {
      ...inventorySummary[0],
      criticalItems: criticalInventory[0]?.criticalItems || 0,
    },
    latestMovements: [],
    transactionsByStatus: [],
    transfersByStatus: [],
    workOrdersByStatus: [],
    shippingByStatus: [],
    receiptsByStatus: [],
    inboundReceipts: pendingOrdersCount[0]?.inboundReceipts || 0,
    scrap: { rows: 0, totalQuantity: 0 },
  });
}));

app.get("/api/inventory", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit);
  const search = getSearch(req.query.search);
  const clauses = [];
  const params = [];

  if (search) {
    clauses.push(`(
      inv.PartNumber LIKE ?
      OR item.PartName LIKE ?
      OR item.Project LIKE ?
      OR item.WorkArea LIKE ?
      OR plant.LocationName LIKE ?
      OR storage.RackName LIKE ?
    )`);
    const term = `%${search}%`;
    params.push(term, term, term, term, term, term);
  }

  if (req.query.locationId) {
    clauses.push("plant.LocationID = ?");
    params.push(req.query.locationId);
  }

  if (req.query.storageId) {
    clauses.push("storage.StorageID = ?");
    params.push(req.query.storageId);
  }

  if (req.query.workArea) {
    clauses.push("item.WorkArea = ?");
    params.push(req.query.workArea);
  }

  if (req.query.partType) {
    clauses.push("item.PartType = ?");
    params.push(req.query.partType);
  }

  params.push(limit);

  const rows = await query(`
    SELECT
      inv.InventoryID AS inventoryId,
      inv.PartNumber AS sku,
      item.PartName AS name,
      item.PartType AS partType,
      item.UnitType AS unitType,
      inv.Quantity AS stock,
      inv.LastUpdate AS lastUpdate,
      item.ItemID,
      item.Project,
      item.WorkArea,
      storage.StorageID AS storageId,
      storage.RackName AS rackName,
      storage.RackColumn AS rackColumn,
      storage.RackCell AS rackCell,
      plant.LocationID AS locationId,
      plant.LocationNumber AS locationNumber,
      plant.LocationName AS locationName,
      plant.LocationArea AS locationArea
    FROM MES_INVENTORY inv
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = inv.PartNumber
    LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
    LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY inv.LastUpdate DESC, inv.PartNumber ASC
    LIMIT ?
  `, params);

  res.json({ count: rows.length, inventory: rows });
}));

app.get("/api/products", asyncRoute(async (req, res) => {
  req.url = `/api/inventory${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
  const limit = getLimit(req.query.limit);
  const search = getSearch(req.query.search);
  const clauses = [];
  const params = [];

  if (search) {
    clauses.push("(inv.PartNumber LIKE ? OR item.PartName LIKE ? OR item.WorkArea LIKE ?)");
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  params.push(limit);
  const rows = await query(`
    SELECT
      inv.PartNumber AS sku,
      item.PartName AS name,
      item.PartType AS partType,
      item.UnitType AS unitType,
      inv.Quantity AS stock,
      plant.LocationName AS location,
      storage.RackName,
      item.WorkArea,
      item.Project
    FROM MES_INVENTORY inv
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = inv.PartNumber
    LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
    LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY inv.LastUpdate DESC
    LIMIT ?
  `, params);

  res.json({ products: rows });
}));

app.get("/api/inventory/id/:inventoryId", asyncRoute(async (req, res) => {
  const inventoryId = Number(req.params.inventoryId);
  if (!Number.isInteger(inventoryId)) {
    return res.status(400).json({ message: 'InventoryID inválido' });
  }

  const rows = await query(`
    SELECT
      inv.InventoryID AS inventoryId,
      inv.PartNumber AS sku,
      item.PartName AS name,
      inv.Quantity AS stock,
      inv.LastUpdate AS lastUpdate,
      storage.RackName AS rackName,
      storage.RackColumn AS rackColumn,
      storage.RackCell AS rackCell,
      plant.LocationName AS locationName,
      plant.LocationArea AS locationArea
    FROM MES_INVENTORY inv
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = inv.PartNumber
    LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
    LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
    WHERE inv.InventoryID = ?
    LIMIT 1
  `, [inventoryId]);

  if (!rows[0]) {
    return res.status(404).json({ message: 'Registro no encontrado' });
  }

  res.json({ inventory: rows[0] });
}));

app.get("/api/inventory/:partNumber", asyncRoute(async (req, res) => {
  const partNumber = req.params.partNumber;
  const [summary, locations] = await Promise.all([
    query(`
      SELECT
        item.ItemID,
        item.PartNumber,
        item.PartName,
        item.Project,
        item.WorkArea,
        item.UnitType,
        item.PartType,
        COALESCE(SUM(inv.Quantity), 0) AS totalStock
      FROM MES_MASTER_ITEMS item
      LEFT JOIN MES_INVENTORY inv ON inv.PartNumber = item.PartNumber
      WHERE item.PartNumber = ?
      GROUP BY item.ItemID, item.PartNumber, item.PartName, item.Project,
        item.WorkArea, item.UnitType, item.PartType
    `, [partNumber]),
    query(`
      SELECT
        inv.InventoryID,
        inv.Quantity,
        inv.LastUpdate,
        storage.StorageID,
        storage.RackName,
        storage.RackColumn,
        storage.RackCell,
        plant.LocationID,
        plant.LocationNumber,
        plant.LocationName,
        plant.LocationArea
      FROM MES_INVENTORY inv
      LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
      LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
      WHERE inv.PartNumber = ?
      ORDER BY inv.Quantity DESC
    `, [partNumber]),
  ]);

  res.json({
    item: summary[0] || null,
    locations,
    recentMovements: [],
  });
}));

app.get("/api/scanner/:code", asyncRoute(async (req, res) => {
  const code = req.params.code;
  const packs = await query(`
    SELECT
      pack.PackID,
      pack.PackBarcode,
      pack.PartNumber,
      item.PartName,
      pack.Quantity,
      pack.PackStatus,
      status.PackDescription,
      pack.LotType,
      lot.LotDescription,
      pack.LineCode,
      pack.SourceLocationID,
      plant.LocationName AS sourceLocationName,
      pack.RegDate,
      pack.RegUserID,
      pack.ConfirmUserID
    FROM MES_PACK_PART pack
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = pack.PartNumber
    LEFT JOIN MES_PACK_STATUS status ON status.PackStatus = pack.PackStatus
    LEFT JOIN MES_PACK_LOT_TYPES lot ON lot.LotType = pack.LotType
    LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = pack.SourceLocationID
    WHERE pack.PackBarcode = ? OR pack.PartNumber = ?
    ORDER BY pack.RegDate DESC
    LIMIT 25
  `, [code, code]);

  const inventory = await query(`
    SELECT
      inv.PartNumber,
      item.PartName AS PartName,
      inv.Quantity,
      item.UnitType AS UnitType,
      storage.StorageID,
      storage.RackName,
      plant.LocationID,
      plant.LocationName
    FROM MES_INVENTORY inv
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = inv.PartNumber
    LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
    LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
    WHERE inv.PartNumber = ? OR inv.PartNumber IN (
      SELECT PartNumber FROM MES_PACK_PART WHERE PackBarcode = ?
    )
    ORDER BY inv.Quantity DESC
  `, [code, code]);

  res.json({
    found: packs.length > 0 || inventory.length > 0,
    code,
    packs,
    inventory,
  });
}));

app.get("/api/cyclic-count", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 100);
  const rows = await query(`
    SELECT
      cc.CycleCountID,
      cc.LocationID,
      cc.StatusID,
      cc.PackCount,
      cc.InventoryID,
      sl.RackName,
      sl.RackColumn,
      sl.RackCell,
      s.StatusCode,
      s.StatusDescription,
      COUNT(mi.InventoryID) AS InventoryItemCount,
      COALESCE(SUM(COALESCE(mi.Quantity, 0)), 0) AS CurrentQuantity,
      MIN(mi.PartNumber) AS PartNumber,
      MIN(mmi.PartName) AS PartName,
      MIN(mmi.WorkArea) AS WorkArea
    FROM MES_CYCLE_COUNTING cc
    LEFT JOIN STORAGE_LOCATIONS sl ON sl.StorageID = cc.LocationID
    LEFT JOIN MES_STATUS s ON s.StatusID = cc.StatusID
    LEFT JOIN MES_INVENTORY mi ON mi.RackLocationID = cc.LocationID
    LEFT JOIN MES_MASTER_ITEMS mmi ON mmi.PartNumber = mi.PartNumber
    GROUP BY
      cc.CycleCountID,
      cc.LocationID,
      cc.StatusID,
      cc.PackCount,
      cc.InventoryID,
      sl.RackName,
      sl.RackColumn,
      sl.RackCell,
      s.StatusCode,
      s.StatusDescription
    ORDER BY cc.CycleCountID DESC
    LIMIT ?
  `, [limit]);

  res.json({
    count: rows.length,
    cycles: rows,
  });
}));

app.get("/api/cyclic-count/:id/items", asyncRoute(async (req, res) => {
  const cycleId = Number(req.params.id);

  const [cycleRows] = await pool.query(
    'SELECT CycleCountID, LocationID, StatusID, InventoryID FROM MES_CYCLE_COUNTING WHERE CycleCountID = ? LIMIT 1',
    [cycleId]
  );

  if (!cycleRows[0]) {
    return res.status(404).json({ message: 'Conteo cíclico no encontrado' });
  }

  const cycle = cycleRows[0];
  const [items] = await pool.query(`
    SELECT
      mi.InventoryID,
      mi.PartNumber,
      mmi.PartName,
      mmi.WorkArea,
      mmi.PartType,
      mmi.UnitType,
      mi.Quantity AS CurrentQuantity,
      sl.RackName,
      sl.RackColumn,
      sl.RackCell,
      pl.LocationName
    FROM MES_INVENTORY mi
    LEFT JOIN MES_MASTER_ITEMS mmi ON mmi.PartNumber = mi.PartNumber
    LEFT JOIN STORAGE_LOCATIONS sl ON sl.StorageID = mi.RackLocationID
    LEFT JOIN PLANT_LOCATIONS pl ON pl.LocationID = sl.LocationID
    WHERE mi.RackLocationID = ?
    ORDER BY mi.PartNumber
  `, [cycle.LocationID]);

  res.json({
    cycle: {
      CycleCountID: cycle.CycleCountID,
      LocationID: cycle.LocationID,
      StatusID: cycle.StatusID,
      InventoryID: cycle.InventoryID,
    },
    items,
  });
}));

app.post("/api/cyclic-count/:id/complete", asyncRoute(async (req, res) => {
  const cycleId = Number(req.params.id);
  const { scannedItems } = req.body || {};

  if (!Array.isArray(scannedItems)) {
    return res.status(400).json({ message: 'scannedItems debe ser un array' });
  }

  const [cycleRows] = await pool.query(
    'SELECT CycleCountID, InventoryID, StatusID FROM MES_CYCLE_COUNTING WHERE CycleCountID = ? LIMIT 1',
    [cycleId]
  );

  if (!cycleRows[0]) {
    return res.status(404).json({ message: 'Conteo cíclico no encontrado' });
  }

  const totalScanned = scannedItems.length;
  const statusCompletedId = 46;

  await pool.query(
    'UPDATE MES_CYCLE_COUNTING SET StatusID = ?, PackCount = ? WHERE CycleCountID = ?',
    [statusCompletedId, totalScanned, cycleId]
  );

  for (const item of scannedItems) {
    const inventoryId = Number(item.inventoryId);
    const countedQty = Number(item.countedQty) || 0;

    if (!Number.isNaN(inventoryId) && inventoryId > 0) {
      await pool.query(
        'UPDATE MES_INVENTORY SET Quantity = ?, LastUpdate = NOW() WHERE InventoryID = ?',
        [countedQty, inventoryId]
      );
    }
  }

  res.json({
    ok: true,
    cycleCountID: cycleId,
    itemsScanned: totalScanned,
    message: 'Conteo completado correctamente',
  });
}));

app.post("/api/cyclic-count", asyncRoute(async (req, res) => {
  const { locationId } = req.body;

  if (!locationId) {
    return res.status(400).json({ message: 'locationId es requerido' });
  }

  const locationIdNum = Number(locationId);

  const [locations] = await pool.query(
    'SELECT StorageID, RackName, RackColumn, RackCell, LocationID FROM STORAGE_LOCATIONS WHERE StorageID = ? LIMIT 1',
    [locationIdNum]
  );

  if (!locations[0]) {
    return res.status(404).json({ message: 'Ubicación no encontrada' });
  }

  const statusInProcessId = 47;
  const [inventoryRows] = await pool.query(
    'SELECT InventoryID FROM MES_INVENTORY WHERE RackLocationID = ? ORDER BY InventoryID LIMIT 1',
    [locationIdNum]
  );
  const initialInventoryId = inventoryRows[0]?.InventoryID ?? 1;

  const [packRows] = await pool.query(
    'SELECT PackID FROM MES_PACK_PART ORDER BY PackID LIMIT 1'
  );
  const packId = packRows[0]?.PackID ?? 1;

  const [result] = await pool.query(
    'INSERT INTO MES_CYCLE_COUNTING (LocationID, StatusID, PackCount, InventoryID) VALUES (?, ?, ?, ?)',
    [locationIdNum, statusInProcessId, packId, initialInventoryId]
  );

  if (!result.insertId) {
    return res.status(500).json({ message: 'Error creando ciclo de conteo' });
  }

  const cycleId = result.insertId;

  const [cycle] = await pool.query(`
    SELECT
      cc.CycleCountID,
      cc.LocationID,
      cc.StatusID,
      cc.PackCount,
      cc.InventoryID,
      sl.RackName,
      sl.RackColumn,
      sl.RackCell,
      s.StatusCode,
      s.StatusDescription,
      COUNT(mi.InventoryID) AS InventoryItemCount,
      COALESCE(SUM(COALESCE(mi.Quantity, 0)), 0) AS CurrentQuantity
    FROM MES_CYCLE_COUNTING cc
    LEFT JOIN STORAGE_LOCATIONS sl ON sl.StorageID = cc.LocationID
    LEFT JOIN MES_STATUS s ON s.StatusID = cc.StatusID
    LEFT JOIN MES_INVENTORY mi ON mi.RackLocationID = cc.LocationID
    WHERE cc.CycleCountID = ?
    GROUP BY cc.CycleCountID, cc.LocationID, cc.StatusID, cc.PackCount, cc.InventoryID, sl.RackName, sl.RackColumn, sl.RackCell, s.StatusCode, s.StatusDescription
    LIMIT 1
  `, [cycleId]);

  if (!cycle[0]) {
    return res.status(500).json({ message: 'Error recuperando ciclo creado' });
  }

  res.status(201).json({
    ok: true,
    cycle: cycle[0],
    message: 'Ciclo de conteo creado exitosamente',
  });
}));

app.get("/api/storage-locations", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 500);
  const rows = await query(`
    SELECT
      storage.StorageID,
      storage.RackName,
      storage.RackColumn,
      storage.RackCell,
      storage.LocationID,
      plant.LocationName,
      COUNT(inv.InventoryID) AS OccupiedItemCount,
      COALESCE(SUM(COALESCE(inv.Quantity, 0)), 0) AS OccupiedQuantity
    FROM STORAGE_LOCATIONS storage
    LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
    LEFT JOIN MES_INVENTORY inv ON inv.RackLocationID = storage.StorageID
    GROUP BY storage.StorageID, storage.RackName, storage.RackColumn, storage.RackCell, storage.LocationID, plant.LocationName
    ORDER BY storage.RackName, storage.RackColumn, storage.RackCell
    LIMIT ?
  `, [limit]);

  const locations = (rows || []).map((row) => ({
    StorageID: Number(row.StorageID),
    RackName: String(row.RackName || ''),
    RackColumn: Number(row.RackColumn || 0),
    RackCell: Number(row.RackCell || 0),
    LocationID: row.LocationID != null ? Number(row.LocationID) : null,
    LocationName: String(row.LocationName || ''),
    OccupiedItemCount: Number(row.OccupiedItemCount || 0),
    OccupiedQuantity: Number(row.OccupiedQuantity || 0),
    Status: Number(row.OccupiedItemCount || 0) > 0 ? 'occupied' : 'available',
  }));

  const rackNames = [...new Set(locations.map((location) => location.RackName).filter(Boolean))].sort();
  const racks = rackNames.map((rackName) => ({
    RackName: rackName,
    cells: locations
      .filter((location) => location.RackName === rackName)
      .sort((left, right) => left.RackColumn - right.RackColumn || left.RackCell - right.RackCell),
  }));

  res.json({
    count: locations.length,
    locations,
    racks,
    summary: {
      totalLocations: locations.length,
      occupiedLocations: locations.filter((location) => location.Status === 'occupied').length,
      availableLocations: locations.filter((location) => location.Status === 'available').length,
    },
  });
}));

app.get("/api/scrap/location-options", asyncRoute(async (_req, res) => {
  const [locationRows] = await pool.query(`
    SELECT
      LocationID,
      LocationName
    FROM PLANT_LOCATIONS
    WHERE LocationName IS NOT NULL
    ORDER BY LocationID
  `);

  const availableLocations = (Array.isArray(locationRows) ? locationRows : []).map((row) => ({
    LocationID: Number(row.LocationID),
    LocationName: String(row.LocationName || `Location ${row.LocationID}`),
  }));

  const normalize = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/containment/g, 'contanment')
    .replace(/purge/g, 'purgue')
    .trim();

  const resolveLocation = (preferredName) => {
    const targetName = String(preferredName || '').trim();
    const targetKey = normalize(targetName);

    const exactMatch = availableLocations.find((location) => normalize(location.LocationName) === targetKey);
    if (exactMatch) {
      return { LocationID: Number(exactMatch.LocationID), LocationName: exactMatch.LocationName };
    }

    const fuzzyMatch = availableLocations.find((location) => {
      const locationKey = normalize(location.LocationName);
      return locationKey.includes(targetKey) || targetKey.includes(locationKey);
    });

    if (fuzzyMatch) {
      return { LocationID: Number(fuzzyMatch.LocationID), LocationName: fuzzyMatch.LocationName };
    }

    return null;
  };

  const uniqueLocations = (items) => {
    const seen = new Set();
    return (items || []).filter((item) => {
      const key = `${item.LocationID}:${item.LocationName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const sourcePairs = [
    { source: 'Incoming Inspection Quality', destination: 'Quarantine Rejection' },
    { source: 'Incoming Inspection Quality', destination: 'Storage' },
    { source: 'Storage', destination: 'Purgue' },
    { source: 'Storage', destination: 'Production' },
    { source: 'Safe Launch Quality', destination: 'Quality Contanment' },
    { source: 'Safe Launch Quality', destination: 'Logistic Storage' },
    { source: 'Logistic Storage', destination: 'Logistic Contanment' },
  ];

  const resolvedSourceLocations = uniqueLocations(sourcePairs.map(({ source }) => resolveLocation(source)).filter(Boolean));
  const resolvedDestinationLocations = uniqueLocations(sourcePairs.map(({ destination }) => resolveLocation(destination)).filter(Boolean));

  const destinationOptionsBySource = sourcePairs.reduce((accumulator, { source, destination }) => {
    const resolvedSource = resolveLocation(source);
    const resolvedDestination = resolveLocation(destination);
    if (!resolvedSource || !resolvedDestination) return accumulator;
    const key = resolvedSource.LocationName;
    if (!accumulator[key]) accumulator[key] = [];
    if (!accumulator[key].some((item) => item.LocationID === resolvedDestination.LocationID)) {
      accumulator[key].push(resolvedDestination);
    }
    return accumulator;
  }, {});

  res.json({
    sourceLocations: resolvedSourceLocations,
    destinationLocations: resolvedDestinationLocations,
    destinationOptionsBySource,
  });
}));

app.get("/api/history/inbound", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 50);

  const [receiptRows] = await pool.query(`
    SELECT
      pr.PurchaseReceiptID,
      pr.PurchaseOrderID,
      po.PONumber,
      provider.ProviderName,
      pr.ReceiptDate,
      pr.CreateDate,
      pr.UpdateDate,
      pr.ReceivedBy,
      receiver.FirstName,
      receiver.LastName,
      receiver.AccessCode,
      COALESCE(SUM(prd.ReceivedQty), 0) AS receivedQty,
      COALESCE(SUM(prd.AcceptedQty), 0) AS acceptedQty,
      COALESCE(SUM(prd.RejectedQty), 0) AS rejectedQty,
      COUNT(prd.PurchaseReceiptDetailID) AS detailCount
    FROM ERP_PURCHASE_RECEIPT pr
    LEFT JOIN ERP_PURCHASE_ORDER po ON po.PurchaseOrderID = pr.PurchaseOrderID
    LEFT JOIN PROVIDERS_MES provider ON provider.ProviderID = po.ProviderID
    LEFT JOIN USERS_MES receiver ON receiver.UserID = pr.ReceivedBy
    LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL prd ON prd.PurchaseReceiptID = pr.PurchaseReceiptID
    GROUP BY pr.PurchaseReceiptID
    ORDER BY pr.CreateDate DESC
    LIMIT ?
  `, [limit]);

  const [scrapRows] = await pool.query(`
    SELECT
      scrap.SADID AS id,
      scrap.PartNumber,
      scrap.Quantity,
      scrap.LocationID,
      scrap.RegUserID,
      scrap.Comments,
      NOW() AS createdAt,
      reg.FirstName AS RegUserFirstName,
      reg.LastName AS RegUserLastName,
      reg.AccessCode AS RegUserAccessCode,
      location.LocationName AS LocationName
    FROM MES_SCRAP_AND_DISCREPANCIES scrap
    LEFT JOIN USERS_MES reg ON reg.UserID = scrap.RegUserID
    LEFT JOIN PLANT_LOCATIONS location ON location.LocationID = scrap.LocationID
    ORDER BY scrap.SADID DESC
    LIMIT ?
  `, [limit]);

  const [transferRows] = await pool.query(`
    SELECT
      mv.MovementID AS id,
      mv.PartNumber,
      mv.Quantity,
      mv.SourceLocationID,
      mv.DestinationLocationID,
      mv.RegUserID,
      mv.Comments,
      mv.RegDate AS createdAt,
      mv.ConfirmDate AS updatedAt,
      reg.FirstName AS RegUserFirstName,
      reg.LastName AS RegUserLastName,
      reg.AccessCode AS RegUserAccessCode,
      source.LocationName AS SourceLocationName,
      dest.LocationName AS DestinationLocationName
    FROM INVENTORY_MOVEMENTS_HISTORY mv
    LEFT JOIN USERS_MES reg ON reg.UserID = mv.RegUserID
    LEFT JOIN PLANT_LOCATIONS source ON source.LocationID = mv.SourceLocationID
    LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = mv.DestinationLocationID
    WHERE mv.LotSequence = 'TRANSFER'
    ORDER BY mv.RegDate DESC
    LIMIT ?
  `, [limit]);

  const [outboundRows] = await pool.query(`
    SELECT
      ship.ShipmentID AS id,
      ship.ShipmentNumber,
      ship.CustomerID,
      ship.ShipmentDate AS createdAt,
      ship.CreatedDate,
      ship.ClosedDate,
      COALESCE(SUM(detail.ScannQty), 0) AS quantity,
      status.StatusDescription
    FROM PART_SHIPPING ship
    LEFT JOIN PART_SHIPPING_DETAIL detail ON detail.ShipmentID = ship.ShipmentID
    LEFT JOIN MES_STATUS status ON status.StatusID = ship.StatusID
    GROUP BY ship.ShipmentID
    ORDER BY ship.CreatedDate DESC
    LIMIT ?
  `, [limit]);

  const typedReceiptRows = receiptRows.map((row) => ({
    id: String(row.PurchaseReceiptID),
    type: 'inbound',
    ref: row.PONumber || `REC-${row.PurchaseReceiptID}`,
    provider: row.ProviderName || 'Sin proveedor',
    receiver: row.FirstName || row.LastName
      ? `${row.FirstName || ''} ${row.LastName || ''}`.trim()
      : (row.AccessCode ? String(row.AccessCode) : 'Sin receptor'),
    createdAt: row.CreateDate,
    receivedAt: row.ReceiptDate || row.CreateDate,
    updatedAt: row.UpdateDate,
    purchaseOrderId: row.PurchaseOrderID,
    acceptedQty: Number(row.acceptedQty || 0),
    rejectedQty: Number(row.rejectedQty || 0),
    receivedQty: Number(row.receivedQty || 0),
    detailCount: Number(row.detailCount || 0),
  }));

  const typedScrapRows = Array.isArray(scrapRows)
    ? scrapRows.map((row) => ({
        id: `scrap-${row.id}`,
        type: 'scrap',
        ref: row.PartNumber || 'Merma',
        provider: 'Merma',
        receiver: row.RegUserFirstName || row.RegUserLastName
          ? `${row.RegUserFirstName || ''} ${row.RegUserLastName || ''}`.trim()
          : 'Sin usuario',
        createdAt: row.createdAt,
        receivedAt: row.createdAt,
        updatedAt: row.createdAt,
        description: row.Comments || 'Sin comentarios',
        quantity: Number(row.Quantity || 0),
        locationName: row.LocationName || 'Sin ubicación',
        partNumber: row.PartNumber,
      }))
    : [];

  const typedTransferRows = Array.isArray(transferRows)
    ? transferRows.map((row) => ({
        id: `transfer-${row.id}`,
        type: 'transfer',
        ref: row.PartNumber || 'Transferencia',
        provider: 'Transferencia',
        receiver: row.RegUserFirstName || row.RegUserLastName
          ? `${row.RegUserFirstName || ''} ${row.RegUserLastName || ''}`.trim()
          : 'Sin usuario',
        createdAt: row.createdAt,
        receivedAt: row.createdAt,
        updatedAt: row.updatedAt || row.createdAt,
        description: row.Comments || 'Sin comentarios',
        quantity: Number(row.Quantity || 0),
        locationName: [row.SourceLocationName, row.DestinationLocationName].filter(Boolean).join(' → ') || 'Sin ubicación',
        partNumber: row.PartNumber,
      }))
    : [];

  const typedOutboundRows = Array.isArray(outboundRows)
    ? outboundRows.map((row) => ({
        id: `outbound-${row.id}`,
        type: 'outbound',
        ref: row.ShipmentNumber || `OUT-${row.id}`,
        provider: row.CustomerID || 'Cliente',
        receiver: 'Sin receptor',
        createdAt: row.CreatedDate || row.createdAt,
        receivedAt: row.createdAt || row.CreatedDate,
        updatedAt: row.ClosedDate || row.CreatedDate,
        description: row.StatusDescription || 'Salida',
        quantity: Number(row.quantity || 0),
      }))
    : [];

  const history = [...typedReceiptRows, ...typedScrapRows, ...typedTransferRows, ...typedOutboundRows]
    .sort((a, b) => {
      const aTime = new Date(a.createdAt || a.receivedAt || a.updatedAt || 0).getTime();
      const bTime = new Date(b.createdAt || b.receivedAt || b.updatedAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, limit);

  res.json({ count: history.length, history });
}));

app.get("/api/orders/inbound", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit);
  const provider = getSearch(req.query.provider);
  const poNumber = getSearch(req.query.poNumber);
  const date = getSearch(req.query.date);
  const status = getSearch(req.query.status);
  const clauses = [];
  const params = [];

  if (provider) {
    clauses.push('provider.ProviderName LIKE ?');
    params.push(`%${provider}%`);
  }
  if (poNumber) {
    clauses.push('po.PONumber LIKE ?');
    params.push(`%${poNumber}%`);
  }
  if (date) {
    clauses.push('DATE(po.OrderDate) = ?');
    params.push(date);
  }
  if (status) {
    const statusId = getOrderStatusIdByKey(status, 'ERP_PURCHASE_RECEIPT');
    if (statusId !== null) {
      clauses.push('po.OrderStatusID = ?');
      params.push(statusId);
    }
  }

  params.push(limit);

  const rows = await query(`
    SELECT
      po.PurchaseOrderID,
      po.PONumber,
      po.ProviderID,
      provider.ProviderName,
      po.OrderDate,
      po.ExpectedDate,
      po.OrderStatusID,
      status.StatusCode,
      status.StatusDescription,
      COUNT(detail.PurchaseOrderDetailID) AS itemCount,
      COALESCE(SUM(detail.Qty), 0) AS orderedQty,
      (
        SELECT COALESCE(SUM(prd.ReceivedQty), 0)
        FROM ERP_PURCHASE_RECEIPT_DETAIL prd
        JOIN ERP_PURCHASE_RECEIPT pr ON pr.PurchaseReceiptID = prd.PurchaseReceiptID
        WHERE pr.PurchaseOrderID = po.PurchaseOrderID
      ) AS receivedQty,
      po.CreateDate,
      po.UpdateDate
    FROM ERP_PURCHASE_ORDER po
    LEFT JOIN ERP_PURCHASE_ORDER_DETAIL detail
      ON detail.PurchaseOrderID = po.PurchaseOrderID
    LEFT JOIN PROVIDERS_MES provider
      ON provider.ProviderID = po.ProviderID
    LEFT JOIN MES_STATUS status ON status.StatusID = po.OrderStatusID
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    GROUP BY po.PurchaseOrderID
    ORDER BY po.CreateDate DESC
    LIMIT ?
  `, params);

  // Resolve MES_STATUS descriptions for the statuses present in the result set
  const statusIds = Array.from(new Set(rows.map((r) => Number(r.OrderStatusID)).filter((v) => Number.isFinite(v))));
  let statusMap = new Map();
  if (statusIds.length) {
    const placeholders = statusIds.map(() => '?').join(',');
    const statusRows = await query(`SELECT StatusID, StatusCode, StatusDescription FROM MES_STATUS WHERE StatusID IN (${placeholders})`, statusIds);
    for (const s of statusRows) {
      statusMap.set(Number(s.StatusID), s);
    }
  }

  const formatted = rows.map((row) => ({
    ...row,
    StatusDescription: (statusMap.get(Number(row.OrderStatusID))?.StatusDescription) || (statusMap.get(Number(row.OrderStatusID))?.StatusCode) || row.StatusDescription || row.StatusCode || String(row.OrderStatusID || 'Pendiente'),
  }));

  res.json({ count: formatted.length, orders: formatted });
}));

app.get("/api/orders/inbound/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const [headers, details, receipts] = await Promise.all([
    query(`
      SELECT
        po.*,
        provider.ProviderName,
        status.StatusCode,
        status.StatusDescription
      FROM ERP_PURCHASE_ORDER po
      LEFT JOIN PROVIDERS_MES provider ON provider.ProviderID = po.ProviderID
      LEFT JOIN MES_STATUS status ON status.StatusID = po.OrderStatusID
      WHERE po.PurchaseOrderID = ?
    `, [id]),
    query(`
      SELECT
        detail.PurchaseOrderDetailID,
        detail.PurchaseOrderID,
        detail.ItemID,
        detail.Qty,
        detail.UnitPrice,
        (
          SELECT COALESCE(SUM(prd.ReceivedQty), 0)
          FROM ERP_PURCHASE_RECEIPT_DETAIL prd
          JOIN ERP_PURCHASE_RECEIPT pr ON pr.PurchaseReceiptID = prd.PurchaseReceiptID
          WHERE pr.PurchaseOrderID = ? AND prd.PurchaseOrderDetailID = detail.PurchaseOrderDetailID
        ) AS ReceivedQty,
        detail.CreateDate,
        detail.RegUserID,
        detail.UpdateDate,
        item.PartNumber,
        item.PartName,
        item.WorkArea,
        item.PartType
      FROM ERP_PURCHASE_ORDER_DETAIL detail
      LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
      WHERE detail.PurchaseOrderID = ?
      ORDER BY detail.PurchaseOrderDetailID
    `, [id, id]),
    query(`
      SELECT *
      FROM ERP_PURCHASE_RECEIPT
      WHERE PurchaseOrderID = ?
      ORDER BY CreateDate DESC
    `, [id]),
  ]);

  res.json({
    order: (headers[0] ? { ...headers[0], StatusDescription: (await query('SELECT StatusDescription, StatusCode FROM MES_STATUS WHERE StatusID = ? LIMIT 1', [headers[0].OrderStatusID]))[0]?.StatusDescription || (await query('SELECT StatusDescription, StatusCode FROM MES_STATUS WHERE StatusID = ? LIMIT 1', [headers[0].OrderStatusID]))[0]?.StatusCode || headers[0].StatusDescription } : null),
    details,
    receipts,
  });
}));

app.post("/api/orders/inbound/:id/receive", asyncRoute(async (req, res) => {
  const purchaseOrderId = Number(req.params.id);
  const { purchaseOrderDetailID, quantity, receivedBy, destination, storageId } = req.body || {};
  const detailId = Number(purchaseOrderDetailID);
  const qty = Number(quantity);
  const receivedByUserId = Number(receivedBy);
  const destinationKey = String(destination || 'almacen').trim().toLowerCase();

  if (!Number.isInteger(purchaseOrderId) || !Number.isInteger(detailId) || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ message: 'Parámetros inválidos para la recepción' });
  }

  if (!Number.isInteger(receivedByUserId) || receivedByUserId <= 0) {
    return res.status(400).json({ message: 'Usuario receptor inválido' });
  }

  const [userRows] = await pool.query(
    'SELECT UserID FROM USERS_MES WHERE UserID = ? LIMIT 1',
    [receivedByUserId]
  );

  if (!userRows[0]) {
    return res.status(400).json({ message: 'Usuario receptor no encontrado en la base de datos' });
  }

  const [orderRows] = await pool.query(
    'SELECT PurchaseOrderID FROM ERP_PURCHASE_ORDER WHERE PurchaseOrderID = ? LIMIT 1',
    [purchaseOrderId]
  );

  if (!orderRows[0]) {
    return res.status(404).json({ message: 'Orden de compra no encontrada' });
  }

  const [detailRows] = await pool.query(
    `SELECT PurchaseOrderDetailID, PurchaseOrderID, ItemID, Qty, CreateDate, RegUserID, UpdateDate
     FROM ERP_PURCHASE_ORDER_DETAIL
     WHERE PurchaseOrderDetailID = ? AND PurchaseOrderID = ? LIMIT 1`,
    [detailId, purchaseOrderId]
  );

  if (!detailRows[0]) {
    return res.status(404).json({ message: 'Línea de orden no encontrada' });
  }

  const expectedQty = Number(detailRows[0].Qty || 0);
  // compute current received quantity for this detail from receipt details
  const [curRec] = await pool.query(
    `SELECT COALESCE(SUM(prd.ReceivedQty), 0) AS receivedQty
     FROM ERP_PURCHASE_RECEIPT_DETAIL prd
     JOIN ERP_PURCHASE_RECEIPT pr ON pr.PurchaseReceiptID = prd.PurchaseReceiptID
     WHERE pr.PurchaseOrderID = ? AND prd.PurchaseOrderDetailID = ?`,
    [purchaseOrderId, detailId]
  );
  const currentReceived = Number(curRec[0]?.receivedQty || 0);
  const remainingQty = Math.max(0, expectedQty - currentReceived);

  if (qty > remainingQty) {
    return res.status(400).json({ message: 'La cantidad recibida supera la cantidad restante por recibir' });
  }

  const isQuarantine = ['cuarentena', 'quarantine', 'rechazado', 'rejected'].includes(destinationKey);
  const acceptQ = isQuarantine ? 'Rechazado' : 'Aceptado';
  const acceptedQty = isQuarantine ? 0 : qty;
  const rejectedQty = isQuarantine ? qty : 0;

  const [receiptResult] = await pool.query(
    `INSERT INTO ERP_PURCHASE_RECEIPT (PurchaseOrderID, ReceiptDate, OrderStatusID, ReceivedBy, CreateDate, UpdateDate)
     VALUES (?, NOW(), ?, ?, NOW(), NOW())`,
    [purchaseOrderId, 1, receivedByUserId]
  );

  const receiptId = receiptResult.insertId;

  const detailFields = [
    'PurchaseReceiptID',
    'PurchaseOrderDetailID',
    'ItemID',
    'ReceivedQty',
    'AcceptedQty',
    'RejectedQty',
    'CreateDate',
    'RegUserID',
    'UpdateDate',
    'RejectionReason',
    'LotNumber',
    'SerialNumber',
  ];
  const detailValues = [
    receiptId,
    detailId,
    detailRows[0].ItemID,
    qty,
    acceptedQty,
    rejectedQty,
    new Date(),
    receivedByUserId,
    new Date(),
    null,
    null,
    null,
  ];

  if (hasReceiptDetailColumn('AcceptQ')) {
    detailFields.push('AcceptQ');
    detailValues.push(acceptQ);
  }

  if (hasReceiptDetailColumn('StorageID') && Number.isInteger(Number(storageId))) {
    detailFields.push('StorageID');
    detailValues.push(Number(storageId));
  }

  const placeholders = detailFields.map(() => '?').join(', ');
  await pool.query(
    `INSERT INTO ERP_PURCHASE_RECEIPT_DETAIL (${detailFields.join(', ')}) VALUES (${placeholders})`,
    detailValues
  );

  let nextReceived = currentReceived;
  if (acceptedQty > 0) {
    nextReceived = currentReceived + acceptedQty;
    // Do not update ERP_PURCHASE_ORDER_DETAIL (no ReceivedQty column); rely on receipt details table
  }

  res.json({
    ok: true,
    receiptId,
    purchaseOrderDetailID: detailId,
    receivedQty: qty,
    acceptedQty,
    rejectedQty,
    updatedReceivedQty: nextReceived,
    expectedQty,
    remainingQty: Math.max(0, expectedQty - nextReceived),
    destination: acceptQ,
  });
}));

app.post("/api/orders/inbound/:id/confirm", asyncRoute(async (req, res) => {
  const purchaseOrderId = Number(req.params.id);
  const { scannedDetails, quarantineQty = 0, receivedBy, orderStatusId } = req.body || {};

  if (!Number.isInteger(purchaseOrderId) || purchaseOrderId <= 0) {
    return res.status(400).json({ message: 'ID de orden inválido' });
  }

  if (!Array.isArray(scannedDetails) || scannedDetails.length === 0) {
    return res.status(400).json({ message: 'No se enviaron piezas escaneadas' });
  }

  const receivedByUserId = Number(receivedBy);
  let validReceivedBy = null;

  if (Number.isInteger(receivedByUserId) && receivedByUserId > 0) {
    const [userRows] = await pool.query(
      'SELECT UserID FROM USERS_MES WHERE UserID = ? LIMIT 1',
      [receivedByUserId]
    );

    if (userRows[0]) {
      validReceivedBy = receivedByUserId;
    }
  }

  if (validReceivedBy === null) {
    validReceivedBy = 1;
  }

  const [orderRows] = await pool.query(
    'SELECT PurchaseOrderID FROM ERP_PURCHASE_ORDER WHERE PurchaseOrderID = ? LIMIT 1',
    [purchaseOrderId]
  );

  if (!orderRows[0]) {
    return res.status(404).json({ message: 'Orden de compra no encontrada' });
  }

  const detailIds = Array.from(new Set(
    scannedDetails
      .map((item) => Number(item.purchaseOrderDetailID))
      .filter((id) => Number.isInteger(id) && id > 0)
  ));

  if (detailIds.length === 0) {
    return res.status(400).json({ message: 'Detalles de orden inválidos' });
  }

  const detailRows = await query(
    `SELECT PurchaseOrderDetailID, PurchaseOrderID, ItemID, Qty, CreateDate, RegUserID, UpdateDate
     FROM ERP_PURCHASE_ORDER_DETAIL
     WHERE PurchaseOrderID = ? AND PurchaseOrderDetailID IN (${detailIds.map(() => '?').join(',')})`,
    [purchaseOrderId, ...detailIds]
  );

  if (detailRows.length !== detailIds.length) {
    return res.status(400).json({ message: 'Algunos detalles de orden no existen o no pertenecen a la orden' });
  }

  const detailsById = new Map(detailRows.map((row) => [Number(row.PurchaseOrderDetailID), row]));
  let totalScanned = 0;
  // fetch received quantities for all detailIds in one query
  const [receivedRows] = await pool.query(
    `SELECT prd.PurchaseOrderDetailID, COALESCE(SUM(prd.ReceivedQty), 0) AS receivedQty
     FROM ERP_PURCHASE_RECEIPT_DETAIL prd
     JOIN ERP_PURCHASE_RECEIPT pr ON pr.PurchaseReceiptID = prd.PurchaseReceiptID
     WHERE pr.PurchaseOrderID = ? AND prd.PurchaseOrderDetailID IN (${detailIds.map(() => '?').join(',')})
     GROUP BY prd.PurchaseOrderDetailID`,
    [purchaseOrderId, ...detailIds]
  );
  const receivedMap = new Map((receivedRows || []).map((r) => [Number(r.PurchaseOrderDetailID), Number(r.receivedQty || 0)]));
  const parsedDetails = scannedDetails.map((item) => {
    const detailId = Number(item.purchaseOrderDetailID);
    const scannedQty = Number(item.scannedQty || 0);
    const detailRow = detailsById.get(detailId);

    if (!detailRow) {
      throw new Error('Detalle de orden inválido');
    }

    const expectedQty = Number(detailRow.Qty || 0);
    const receivedQty = Number(receivedMap.get(detailId) || 0);
    const remainingQty = Math.max(0, expectedQty - receivedQty);

    if (!Number.isInteger(scannedQty) || scannedQty <= 0) {
      throw new Error('Cantidad escaneada inválida');
    }
    if (scannedQty > remainingQty) {
      throw new Error('La cantidad escaneada supera la cantidad restante por recibir');
    }

    totalScanned += scannedQty;
    return { detailRow, scannedQty };
  });

  const totalQuarantine = Number(quarantineQty || 0);
  if (!Number.isFinite(totalQuarantine) || totalQuarantine < 0 || totalQuarantine > totalScanned) {
    return res.status(400).json({ message: 'Cantidad de cuarentena inválida' });
  }

  // Determine receipt status id: prefer explicit orderStatusId from client when valid
  let receiptStatusId = null;
  const numericProvided = Number(orderStatusId);
  if (Number.isInteger(numericProvided) && numericProvided > 0) {
    // verify exists in cache when possible
    if (orderStatusCache.tableExists) {
      if (orderStatusCache.byId.has(numericProvided)) receiptStatusId = numericProvided;
    } else {
      receiptStatusId = numericProvided;
    }
  }

  if (receiptStatusId === null) {
    // fallback to default 'pendiente' id if known, else 20
    receiptStatusId = orderStatusCache.byKey.get('pending') ?? orderStatusCache.byKey.get('pendiente') ?? 20;
  }

  const [receiptResult] = await pool.query(
    `INSERT INTO ERP_PURCHASE_RECEIPT (PurchaseOrderID, ReceiptDate, OrderStatusID, ReceivedBy, CreateDate, UpdateDate)
     VALUES (?, NOW(), ?, ?, NOW(), NOW())`,
    [purchaseOrderId, receiptStatusId, receivedByUserId]
  );

  const receiptId = receiptResult.insertId;
  let remainingQuarantine = totalQuarantine;
  let acceptedTotal = 0;
  let rejectedTotal = 0;

  for (const { detailRow, scannedQty } of parsedDetails) {
    const rejectedQty = Math.min(scannedQty, remainingQuarantine);
    const acceptedQty = scannedQty - rejectedQty;
    remainingQuarantine -= rejectedQty;

    const detailFields = [
      'PurchaseReceiptID',
      'PurchaseOrderDetailID',
      'ItemID',
      'ReceivedQty',
      'AcceptedQty',
      'RejectedQty',
      'CreateDate',
      'RegUserID',
      'UpdateDate',
      'RejectionReason',
      'LotNumber',
      'SerialNumber',
    ];
    const detailValues = [
      receiptId,
      detailRow.PurchaseOrderDetailID,
      detailRow.ItemID,
      scannedQty,
      acceptedQty,
      rejectedQty,
      new Date(),
      receivedByUserId,
      new Date(),
      null,
      null,
      null,
    ];

    if (hasReceiptDetailColumn('AcceptQ')) {
      detailFields.push('AcceptQ');
      detailValues.push(acceptedQty > 0 ? 'Aceptado' : 'Rechazado');
    }

    await pool.query(
      `INSERT INTO ERP_PURCHASE_RECEIPT_DETAIL (${detailFields.join(', ')}) VALUES (${detailFields.map(() => '?').join(',')})`,
      detailValues
    );

    if (acceptedQty > 0) {
      const prevRec = Number(receivedMap.get(detailRow.PurchaseOrderDetailID) || 0);
      const nextReceived = prevRec + acceptedQty;
      receivedMap.set(detailRow.PurchaseOrderDetailID, nextReceived);
      // Do not update ERP_PURCHASE_ORDER_DETAIL (no ReceivedQty column); receipts table holds the truth
    }

    acceptedTotal += acceptedQty;
    rejectedTotal += rejectedQty;
  }

  const [totals] = await query(`
    SELECT COALESCE(SUM(Qty),0) AS orderedQty
    FROM ERP_PURCHASE_ORDER_DETAIL
    WHERE PurchaseOrderID = ?
  `, [purchaseOrderId]);
  const orderedQty = Number(totals[0]?.orderedQty || 0);
  const [recTotals] = await query(`
    SELECT COALESCE(SUM(prd.ReceivedQty),0) AS receivedQty
    FROM ERP_PURCHASE_RECEIPT_DETAIL prd
    JOIN ERP_PURCHASE_RECEIPT pr ON pr.PurchaseReceiptID = prd.PurchaseReceiptID
    WHERE pr.PurchaseOrderID = ?
  `, [purchaseOrderId]);
  const receivedQty = Number(recTotals[0]?.receivedQty || 0);
  // If client provided an orderStatusId and it's valid, use it; otherwise compute mapping
  let targetStatusId = null;
  if (Number.isInteger(Number(orderStatusId)) && Number(orderStatusId) > 0) {
    const cand = Number(orderStatusId);
    if (!orderStatusCache.tableExists || orderStatusCache.byId.has(cand)) {
      targetStatusId = cand;
    }
  }

  if (targetStatusId === null) {
    // Map to specific MES_STATUS IDs for purchase receipts: 20 = Pendiente, 8 = En Proceso, 10 = Completado
    if (receivedQty <= 0) targetStatusId = 20;
    else if (receivedQty < orderedQty) targetStatusId = 8;
    else targetStatusId = 10;

    // verify existence
    if (orderStatusCache.tableExists && !orderStatusCache.byId.has(Number(targetStatusId))) {
      const statusKey = receivedQty <= 0 ? 'pendiente' : (receivedQty < orderedQty ? 'en proceso' : 'completado');
      const fallbackId = getOrderStatusIdByKey(statusKey, 'ERP_PURCHASE_RECEIPT') ?? getOrderStatusIdByKey(statusKey.replace(/\s+/g, ''), 'ERP_PURCHASE_RECEIPT');
      if (fallbackId !== null) targetStatusId = fallbackId;
    }
  }

  if (targetStatusId !== null) {
    await pool.query(
      'UPDATE ERP_PURCHASE_ORDER SET OrderStatusID = ?, UpdateDate = NOW() WHERE PurchaseOrderID = ?',
      [targetStatusId, purchaseOrderId]
    );
  }

  res.json({
    ok: true,
    purchaseOrderId,
    statusId: targetStatusId,
    statusName: getOrderStatusLabel(targetStatusId),
    orderedQty,
    receivedQty,
    acceptedTotal,
    rejectedTotal,
  });
}));

app.get("/api/orders/outbound", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit);
  const clauses = [];
  const params = [];

  if (req.query.status) {
    clauses.push("status.StatusDescription = ?");
    params.push(req.query.status);
  }

  params.push(limit);
  const rows = await query(`
    SELECT
      ship.ShipmentID,
      ship.ShipmentNumber,
      ship.CustomerID,
      ship.StatusID,
      status.StatusCode,
      status.StatusDescription,
      ship.ShipmentDate,
      ship.RequestedShipDate,
      ship.TrackingNumber,
      COUNT(detail.ShipmentDetailID) AS itemCount,
      ship.OrderQty AS orderQty,
      COALESCE(SUM(detail.ScannQty), 0) AS shippedQty,
      ship.CreatedDate,
      ship.ClosedDate
    FROM PART_SHIPPING ship
    LEFT JOIN PART_SHIPPING_DETAIL detail ON detail.ShipmentID = ship.ShipmentID
    LEFT JOIN MES_STATUS status ON status.StatusID = ship.StatusID
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    GROUP BY ship.ShipmentID
    ORDER BY ship.CreatedDate DESC
    LIMIT ?
  `, params);

  res.json({ count: rows.length, orders: rows });
}));

app.get("/api/orders/outbound/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const [headers, details, logs] = await Promise.all([
    query(`
      SELECT ship.*, status.StatusCode, status.StatusDescription
      FROM PART_SHIPPING ship
      LEFT JOIN MES_STATUS status ON status.StatusID = ship.StatusID
      WHERE ship.ShipmentID = ?
    `, [id]),
    query(`
      SELECT
        detail.ShipmentDetailID,
        detail.ShipmentID,
        detail.ScannQty,
        detail.LocationID,
        detail.SerialNumber,
        detail.TeslaBarcodeA,
        detail.TeslaBarcodeB,
        detail.ClientLot,
        detail.InternalLot,
        detail.ShortInternalLot,
        item.PartNumber,
        item.PartName,
        item.WorkArea,
        plant.LocationName
      FROM PART_SHIPPING_DETAIL detail
      LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = ship.PartNumberID
      LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = detail.LocationID
      WHERE detail.ShipmentID = ?
      ORDER BY detail.ShipmentDetailID
    `, [id]),
    query(`
      SELECT *
      FROM SHIPPING_LOG
      WHERE OrderNumber = (
        SELECT ShipmentNumber FROM PART_SHIPPING WHERE ShipmentID = ?
      )
      ORDER BY LogDate DESC
      LIMIT 25
    `, [id]),
  ]);

  res.json({
    order: headers[0] || null,
    details,
    logs,
  });
}));

app.get("/api/transfers", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 20);
  const clauses = [];
  const params = [];

  if (req.query.status) {
    clauses.push("mv.LotSequence = ?");
    params.push(req.query.status);
  }

  params.push(limit);
  const rows = await query(`
    SELECT
      mv.MovementID AS TransferID,
      mv.RegDate AS TransferDate,
      mv.ConfirmDate AS ConfirmDate,
      mv.PartNumber,
      item.PartName,
      item.UnitType,
      item.PartType,
      mv.Quantity AS TransferQuantity,
      mv.MovementTypeID AS StatusType,
      mv.SourceLocationID,
      mv.DestinationLocationID,
      mv.RegUserID,
      start.LocationNumber AS StartingLocationNumber,
      start.LocationName AS StartingLocationName,
      dest.LocationNumber AS DestinationLocationNumber,
      dest.LocationName AS DestinationLocationName,
      mv.Comments
    FROM INVENTORY_MOVEMENTS_HISTORY mv
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = mv.PartNumber
    LEFT JOIN PLANT_LOCATIONS start ON start.LocationID = mv.SourceLocationID
    LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = mv.DestinationLocationID
    WHERE mv.LotSequence = 'TRANSFER'
    ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}
    ORDER BY mv.RegDate DESC
    LIMIT ?
  `, params);

  res.json({ count: rows.length, transfers: rows });
}));

app.post("/api/transfers", asyncRoute(async (req, res) => {
  const {
    partNumber,
    quantity,
    locationId,
    sourceLocationId,
    destinationLocationId,
    sourceStorageId,
    destinationStorageId,
    comments,
    regUserId,
  } = req.body || {};

  if (!partNumber || !String(partNumber).trim()) {
    return res.status(400).json({ message: "Debe indicar un producto para registrar la transferencia." });
  }

  const parsedQty = Number(quantity);
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    return res.status(400).json({ message: "La cantidad debe ser mayor a cero." });
  }

  const normalizedPartNumber = String(partNumber).trim();
  const normalizedLocationId = locationId ? Number(locationId) : null;
  const normalizedSourceLocationId = sourceLocationId ? Number(sourceLocationId) : null;
  const normalizedDestinationLocationId = destinationLocationId ? Number(destinationLocationId) : null;
  const normalizedUserId = regUserId ? Number(regUserId) : null;
  const normalizedComments = comments ? String(comments).trim() : null;
  const movementSourceLocationId = normalizedSourceLocationId ?? normalizedLocationId;
  const movementDestinationLocationId = normalizedDestinationLocationId ?? normalizedLocationId;
  const movementStorageId = normalizedDestinationLocationId ?? normalizedSourceLocationId ?? normalizedLocationId;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [inventoryRows] = await connection.query(`
      SELECT inv.InventoryID, inv.Quantity, storage.LocationID
      FROM MES_INVENTORY inv
      LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
      WHERE inv.PartNumber = ?
      ORDER BY
        CASE
          WHEN ? IS NULL THEN 0
          WHEN storage.LocationID = ? THEN 0
          ELSE 1
        END,
        inv.Quantity DESC,
        inv.InventoryID ASC
    `, [normalizedPartNumber, normalizedLocationId, normalizedLocationId]);

    let remainingQty = parsedQty;
    let adjustedQty = 0;

    for (const row of inventoryRows || []) {
      if (remainingQty <= 0) break;
      const availableQty = Number(row.Quantity || 0);
      if (availableQty <= 0) continue;

      const qtyToDeduct = Math.min(remainingQty, availableQty);
      const [updateResult] = await connection.query(`
        UPDATE MES_INVENTORY
        SET Quantity = Quantity - ?, LastUpdate = NOW()
        WHERE InventoryID = ? AND Quantity >= ?
      `, [qtyToDeduct, row.InventoryID, qtyToDeduct]);

      if (updateResult.affectedRows > 0) {
        remainingQty -= qtyToDeduct;
        adjustedQty += qtyToDeduct;
      }
    }

    const [movementResult] = await connection.query(`
      INSERT INTO INVENTORY_MOVEMENTS_HISTORY (
        RequestID,
        PartNumber,
        StorageID,
        Quantity,
        MovementTypeID,
        SourceLocationID,
        DestinationLocationID,
        RegUserID,
        ConfirmUserID,
        Comments,
        LotBarcode,
        LotSequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      1,
      normalizedPartNumber,
      movementStorageId,
      parsedQty,
      6,
      movementSourceLocationId,
      movementDestinationLocationId,
      normalizedUserId,
      normalizedUserId,
      normalizedComments,
      normalizedPartNumber,
      'TRANSFER'
    ]);

    const movementId = movementResult.insertId;

    const [destinationLocationRows] = await connection.query(`
      SELECT LocationName
      FROM PLANT_LOCATIONS
      WHERE LocationID = ?
    `, [movementDestinationLocationId]);

    const destinationLocationName = String(destinationLocationRows?.[0]?.LocationName || '').trim();
    const normalizedDestinationName = destinationLocationName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const isScrapDestination = [
      'discrepancy',
      'quarantine rejection',
      'purge',
      'quarantine scrap ncm',
      'quality contanment',
      'logistic containment',
      'shipping containment',
      'quarantine',
    ].some((token) => normalizedDestinationName.includes(token));

    if (isScrapDestination && movementDestinationLocationId) {
      const followUpComments = [
        'SCRAP_PENDIENTE',
        normalizedComments,
        destinationLocationName ? `Transferencia a ${destinationLocationName}` : null,
      ].filter(Boolean).join(' | ');

      await connection.query(`
        INSERT INTO MES_SCRAP_AND_DISCREPANCIES (PartNumber, Quantity, LocationID, RegUserID, Comments, MovementID)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [normalizedPartNumber, parsedQty, movementDestinationLocationId, normalizedUserId, followUpComments, movementId]);
    }

    await connection.commit();

    res.status(201).json({
      ok: true,
      transferId: movementResult.insertId,
      adjustedInventory: adjustedQty > 0,
      adjustedQty,
      remainingQty,
      message: remainingQty > 0
        ? "Transferencia registrada, pero no hubo stock suficiente para descontar por completo."
        : "Transferencia registrada correctamente y stock actualizado.",
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get("/api/scrap", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit);
  const rows = await query(`
    SELECT
      scrap.SADID AS ScrapID,
      scrap.PartNumber,
      item.PartName,
      item.WorkArea,
      item.UnitType,
      scrap.Quantity,
      scrap.LocationID,
      location.LocationName AS LocationName,
      scrap.RegUserID,
      reg.FirstName AS RegUserFirstName,
      reg.LastName AS RegUserLastName,
      scrap.Comments
    FROM MES_SCRAP_AND_DISCREPANCIES scrap
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = scrap.PartNumber
    LEFT JOIN PLANT_LOCATIONS location ON location.LocationID = scrap.LocationID
    LEFT JOIN USERS_MES reg ON reg.UserID = scrap.RegUserID
    ORDER BY scrap.SADID DESC
    LIMIT ?
  `, [limit]);

  res.json({ count: rows.length, scrap: rows });
}));

app.post("/api/scrap", asyncRoute(async (req, res) => {
  const { partNumber, quantity, locationId, sourceLocationId, destinationLocationId, comments, regUserId } = req.body || {};

  if (!partNumber || !String(partNumber).trim()) {
    return res.status(400).json({ message: "Debe indicar un producto para registrar la merma." });
  }

  const parsedQty = Number(quantity);
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    return res.status(400).json({ message: "La cantidad debe ser mayor a cero." });
  }

  const normalizedPartNumber = String(partNumber).trim();
  const normalizedLocationId = locationId ? Number(locationId) : null;
  const normalizedSourceLocationId = sourceLocationId ? Number(sourceLocationId) : null;
  const normalizedDestinationLocationId = destinationLocationId ? Number(destinationLocationId) : null;
  const normalizedUserId = regUserId ? Number(regUserId) : null;
  const normalizedComments = comments ? String(comments).trim() : null;
  const movementSourceLocationId = normalizedSourceLocationId ?? normalizedLocationId;
  const movementDestinationLocationId = normalizedDestinationLocationId ?? normalizedLocationId;
  const movementStorageId = normalizedDestinationLocationId ?? normalizedSourceLocationId ?? normalizedLocationId;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [inventoryRows] = await connection.query(`
      SELECT inv.InventoryID, inv.Quantity, storage.LocationID
      FROM MES_INVENTORY inv
      LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
      WHERE inv.PartNumber = ?
      ORDER BY
        CASE
          WHEN ? IS NULL THEN 0
          WHEN storage.LocationID = ? THEN 0
          ELSE 1
        END,
        inv.Quantity DESC,
        inv.InventoryID ASC
    `, [normalizedPartNumber, normalizedLocationId, normalizedLocationId]);

    let remainingQty = parsedQty;
    let adjustedQty = 0;

    for (const row of inventoryRows || []) {
      if (remainingQty <= 0) break;
      const availableQty = Number(row.Quantity || 0);
      if (availableQty <= 0) continue;

      const qtyToDeduct = Math.min(remainingQty, availableQty);
      const [updateResult] = await connection.query(`
        UPDATE MES_INVENTORY
        SET Quantity = Quantity - ?, LastUpdate = NOW()
        WHERE InventoryID = ? AND Quantity >= ?
      `, [qtyToDeduct, row.InventoryID, qtyToDeduct]);

      if (updateResult.affectedRows > 0) {
        remainingQty -= qtyToDeduct;
        adjustedQty += qtyToDeduct;
      }
    }

    const [movementResult] = await connection.query(`
      INSERT INTO INVENTORY_MOVEMENTS_HISTORY (
        RequestID,
        PartNumber,
        StorageID,
        Quantity,
        MovementTypeID,
        SourceLocationID,
        DestinationLocationID,
        RegUserID,
        ConfirmUserID,
        Comments,
        LotBarcode,
        LotSequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      1,
      normalizedPartNumber,
      movementStorageId,
      parsedQty,
      6,
      movementSourceLocationId,
      movementDestinationLocationId,
      normalizedUserId,
      normalizedUserId,
      normalizedComments,
      normalizedPartNumber,
      'SCRAP'
    ]);

    const movementId = movementResult.insertId;

    const [result] = await connection.query(`
      INSERT INTO MES_SCRAP_AND_DISCREPANCIES (PartNumber, Quantity, LocationID, RegUserID, Comments, MovementID)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [normalizedPartNumber, parsedQty, normalizedLocationId, normalizedUserId, normalizedComments, movementId]);

    await connection.commit();

    res.status(201).json({
      ok: true,
      scrapId: result.insertId,
      movementId,
      adjustedInventory: adjustedQty > 0,
      adjustedQty,
      remainingQty,
      message: remainingQty > 0
        ? "Merma registrada, pero no hubo stock suficiente para descontar por completo."
        : "Merma registrada correctamente y stock actualizado.",
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get("/api/reports/summary", asyncRoute(async (_req, res) => {
  const [
    inventoryByArea,
    inventoryByType,
    movementsByType,
    transactionsByType,
    scrapByPart,
    productionSummary,
  ] = await Promise.all([
    query(`
      SELECT item.WorkArea, COUNT(*) AS rows, COALESCE(SUM(inv.Quantity), 0) AS quantity
      FROM MES_INVENTORY inv
      LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = inv.PartNumber
      GROUP BY item.WorkArea
      ORDER BY quantity DESC
    `),
    query(`
      SELECT item.PartType AS PartType, COUNT(*) AS rows, COALESCE(SUM(inv.Quantity), 0) AS quantity
      FROM MES_INVENTORY inv
      LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = inv.PartNumber
      GROUP BY item.PartType
      ORDER BY quantity DESC
    `),
    query(`
      SELECT mt.MovementCode, mt.MovementDescription, COUNT(*) AS rows, COALESCE(SUM(m.Quantity), 0) AS quantity
      FROM INVENTORY_MOVEMENTS m
      LEFT JOIN INVENTORY_MOVEMENT_TYPES mt ON mt.MovementTypeID = m.MovementTypeID
      GROUP BY mt.MovementCode, mt.MovementDescription
      ORDER BY rows DESC
    `),
    query(`
      SELECT tt.TransType, tt.TransDescription, COUNT(*) AS rows, COALESCE(SUM(t.Quantity), 0) AS quantity
      FROM INVENTORY_TRANSACTIONS t
      LEFT JOIN INVENTORY_TRANSACTION_TYPES tt ON tt.TransactionTypeID = t.TransactionTypeID
      GROUP BY tt.TransType, tt.TransDescription
      ORDER BY rows DESC
    `),
    query(`
      SELECT scrap.PartNumber, item.PartName, COALESCE(SUM(scrap.Quantity), 0) AS quantity
      FROM MES_SCRAP_AND_DISCREPANCIES scrap
      LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = scrap.PartNumber
      GROUP BY scrap.PartNumber, item.PartName
      ORDER BY quantity DESC
      LIMIT 20
    `),
    query(`
      SELECT
        COUNT(*) AS logs,
        COALESCE(SUM(GoodQty), 0) AS goodQty,
        COALESCE(SUM(ScrapQty), 0) AS scrapQty
      FROM PRODUCTION_LOG
    `),
  ]);

  res.json({
    inventoryByArea,
    inventoryByType,
    movementsByType,
    transactionsByType,
    scrapByPart,
    production: productionSummary[0],
  });
}));

// DEBUG: Check inbound receipts
app.get('/api/debug/inbound-receipts', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT * FROM ERP_PURCHASE_RECEIPT LIMIT 5
  `);
  res.json({ count: rows.length, rows });
}));

// Activity History - Aggregates all movements (inbound, outbound, transfers, adjustments, cyclic counts, scrap)
app.get('/api/activity-history', asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 50);
  
  // Build aggregated activity from multiple sources
  const activities = [];

  try {
    // Inbound receipts with accepted/rejected details
    const [inboundRows] = await pool.query(`
      SELECT
        pr.PurchaseReceiptID AS id,
        'inbound' AS type,
        CONCAT('REC-', pr.PurchaseReceiptID) AS reference,
        pr.CreateDate AS timestamp,
        pr.OrderStatusID AS receiptStatusId,
        po.OrderStatusID AS orderStatusId,
        po.PONumber AS poNumber,
        po.OrderDate AS orderDate,
        po.ExpectedDate AS expectedDate,
        COALESCE(CONCAT(u.FirstName, ' ', u.LastName), 'Usuario desconocido') AS receivedBy,
        COALESCE(status.StatusDescription, status.StatusCode, 'Pendiente') AS status,
        COALESCE(SUM(COALESCE(prd.RejectedQty, 0)), 0) AS rejectedQty,
        COALESCE(SUM(COALESCE(prd.AcceptedQty, 0)), 0) AS acceptedQty,
        CASE
          WHEN COALESCE(SUM(COALESCE(prd.RejectedQty, 0)), 0) > 0
            AND COALESCE(SUM(COALESCE(prd.AcceptedQty, 0)), 0) > 0
            THEN CONCAT('Recepción parcial: ', COALESCE(SUM(COALESCE(prd.AcceptedQty, 0)), 0), ' aceptadas, ', COALESCE(SUM(COALESCE(prd.RejectedQty, 0)), 0), ' rechazadas')
          WHEN COALESCE(SUM(COALESCE(prd.RejectedQty, 0)), 0) > 0
            THEN CONCAT('Recepción rechazada: ', COALESCE(SUM(COALESCE(prd.RejectedQty, 0)), 0), ' unidades')
          ELSE 'Recepción'
        END AS description
      FROM ERP_PURCHASE_RECEIPT pr
      LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL prd ON pr.PurchaseReceiptID = prd.PurchaseReceiptID
      LEFT JOIN ERP_PURCHASE_ORDER po ON po.PurchaseOrderID = pr.PurchaseOrderID
      LEFT JOIN USERS_MES u ON u.UserID = pr.ReceivedBy
      LEFT JOIN MES_STATUS status ON status.StatusID = pr.OrderStatusID
      GROUP BY pr.PurchaseReceiptID
      ORDER BY pr.CreateDate DESC
      LIMIT 20
    `);
    activities.push(...inboundRows.map(r => ({
      id: r.id,
      type: 'inbound',
      reference: r.reference,
      timestamp: r.timestamp,
      status: r.status,
      orderStatusId: r.orderStatusId,
      receiptStatusId: r.receiptStatusId,
      poNumber: r.poNumber,
      orderDate: r.orderDate,
      expectedDate: r.expectedDate,
      receivedBy: r.receivedBy,
      description: r.description,
      rejectedQty: r.rejectedQty,
      acceptedQty: r.acceptedQty,
      icon: 'ArrowDownCircle',
      color: r.rejectedQty > 0 ? (r.acceptedQty > 0 ? 'amber' : 'rose') : 'emerald',
    })));
  } catch (err) {
    console.warn('[api] No se pudieron cargar recepciones:', err.message);
  }

  try {
    // Outbound orders (mock for now as no table exists in schema)
    const mockOutbound = [
      { id: 'OUT001', type: 'outbound', reference: 'PICK-4412', timestamp: new Date(Date.now() - 12 * 60000), status: 'inProgress', description: 'Orden de salida', icon: 'ArrowUpCircle', color: 'blue' },
    ];
    activities.push(...mockOutbound);
  } catch (err) {
    console.warn('[api] Error en órdenes de salida:', err.message);
  }

  try {
    // Transfers (mock for now)
    const mockTransfers = [
      { id: 'TRF001', type: 'transfer', reference: 'TRF-001', timestamp: new Date(Date.now() - 60 * 60000), status: 'completed', description: 'Transferencia', icon: 'MoveHorizontal', color: 'violet' },
    ];
    activities.push(...mockTransfers);
  } catch (err) {
    console.warn('[api] Error en transferencias:', err.message);
  }

  try {
    // Adjustments (mock for now)
    const mockAdjustments = [
      { id: 'ADJ001', type: 'adjustment', reference: 'ADJ-0012', timestamp: new Date(Date.now() - 45 * 60000), status: 'completed', description: 'Ajuste de inventario', icon: 'Settings2', color: 'amber' },
    ];
    activities.push(...mockAdjustments);
  } catch (err) {
    console.warn('[api] Error en ajustes:', err.message);
  }

  try {
    // Cyclic counts (mock for now)
    const mockCyclic = [
      { id: 'CC001', type: 'cyclic', reference: 'CC-2024-001', timestamp: new Date(Date.now() - 2 * 3600000), status: 'pending', description: 'Conteo cíclico', icon: 'RefreshCw', color: 'cyan' },
    ];
    activities.push(...mockCyclic);
  } catch (err) {
    console.warn('[api] Error en conteos cíclicos:', err.message);
  }

  try {
    // Scrap/Merma (mock for now)
    const mockScrap = [
      { id: 'SCR001', type: 'scrap', reference: 'SCR-001', timestamp: new Date(Date.now() - 3 * 3600000), status: 'completed', description: 'Merma', icon: 'Trash2', color: 'rose' },
    ];
    activities.push(...mockScrap);
  } catch (err) {
    console.warn('[api] Error en merma:', err.message);
  }

  // Sort by timestamp descending and limit
  activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const result = activities.slice(0, limit);

  res.json({
    activities: result,
    total: activities.length,
  });
}));

app.post('/api/server-config/auth', asyncRoute(async (req, res) => {
  const { password } = req.body || {};

  if (!password || String(password) !== configPassword) {
    return res.status(401).json({ message: 'Contraseña inválida' });
  }

  const env = parseEnvFile();
  res.json({
    dbHost: env.DB_HOST || process.env.DB_HOST || '',
    dbPort: env.DB_PORT || process.env.DB_PORT || '',
    dbUser: env.DB_USER || process.env.DB_USER || '',
    dbPassword: env.DB_PASSWORD || process.env.DB_PASSWORD || '',
    dbName: env.DB_NAME || process.env.DB_NAME || '',
    apiHost: env.HOST || process.env.HOST || '',
    apiPort: env.PORT || process.env.PORT || '',
    apiBaseUrl: env.API_BASE_URL || process.env.API_BASE_URL || '',
  });
}));

app.post('/api/server-config', asyncRoute(async (req, res) => {
  const { password, values } = req.body || {};

  if (!password || String(password) !== configPassword) {
    return res.status(401).json({ message: 'Contraseña inválida' });
  }

  if (!values || typeof values !== 'object') {
    return res.status(400).json({ message: 'Valores de configuración inválidos' });
  }

  const envValues = {};
  if (values.dbHost !== undefined) envValues.DB_HOST = String(values.dbHost || '');
  if (values.dbPort !== undefined) envValues.DB_PORT = String(values.dbPort || '');
  if (values.dbUser !== undefined) envValues.DB_USER = String(values.dbUser || '');
  if (values.dbPassword !== undefined) envValues.DB_PASSWORD = String(values.dbPassword || '');
  if (values.dbName !== undefined) envValues.DB_NAME = String(values.dbName || '');
  if (values.apiHost !== undefined) envValues.HOST = String(values.apiHost || '');
  if (values.apiPort !== undefined) envValues.PORT = String(values.apiPort || '');
  if (values.apiBaseUrl !== undefined) envValues.API_BASE_URL = String(values.apiBaseUrl || '');

  if (Object.keys(envValues).length === 0) {
    return res.status(400).json({ message: 'No hay valores para guardar' });
  }

  writeEnvFile(envValues);

  res.json({ ok: true, message: 'Configuración guardada. Reinicie el servidor para aplicar los cambios.' });
}));

app.get("/api/settings/catalogs", asyncRoute(async (_req, res) => {
  // Run catalog queries safely so missing tables won't break the whole endpoint
  async function safeQuerySql(sql) {
    try {
      return await query(sql);
    } catch (err) {
      console.warn('[api] settings catalog query failed:', err.message);
      return [];
    }
  }

  const [
    roles,
    positions,
    statuses,
    planStatuses,
    movementTypes,
    transactionTypes,
    transactionStatuses,
    measureUnits,
    itemTypes,
    packStatuses,
    lotTypes,
    plantLocations,
    storageLocations,
    productionLines,
  ] = await Promise.all([
    safeQuerySql("SELECT * FROM USER_ROLES ORDER BY RoleName"),
    safeQuerySql("SELECT * FROM USER_POSITIONS ORDER BY PositionName"),
    safeQuerySql("SELECT * FROM MES_STATUS ORDER BY ModuleCode, StatusOrder"),
    safeQuerySql("SELECT * FROM MES_PLAN_STATUS ORDER BY PlanStatusID"),
    safeQuerySql("SELECT * FROM INVENTORY_MOVEMENT_TYPES ORDER BY MovementCode"),
    safeQuerySql("SELECT * FROM INVENTORY_TRANSACTION_TYPES ORDER BY TransType"),
    safeQuerySql("SELECT * FROM INVENTORY_TRANSACTION_STATUS ORDER BY TransType"),
    safeQuerySql("SELECT * FROM MES_MEASURE_UNITS ORDER BY MeasureType"),
    safeQuerySql("SELECT * FROM MES_ITEMS_TYPES ORDER BY PartType"),
    safeQuerySql("SELECT * FROM MES_PACK_STATUS ORDER BY PackStatus"),
    safeQuerySql("SELECT * FROM MES_PACK_LOT_TYPES ORDER BY LotType"),
    safeQuerySql("SELECT * FROM PLANT_LOCATIONS ORDER BY LocationNumber"),
    safeQuerySql(`
      SELECT storage.*, plant.LocationName, plant.LocationArea
      FROM STORAGE_LOCATIONS storage
      LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
      ORDER BY plant.LocationName, storage.RackName, storage.RackColumn, storage.RackCell
    `),
    safeQuerySql("SELECT * FROM PROD_LINES_MES ORDER BY LineCode"),
  ]);

  res.json({
    roles,
    positions,
    statuses,
    orderStatuses: statuses,
    planStatuses,
    movementTypes,
    transactionTypes,
    transactionStatuses,
    measureUnits,
    itemTypes,
    packStatuses,
    lotTypes,
    plantLocations,
    storageLocations,
    productionLines,
  });
}));

// Autentificación endpoint
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Falta identifier o password' });
  }

  let rows;
  const idStr = String(identifier).trim();
  if (/^\d+$/.test(idStr)) {
    // numeric - treat as UserID
    rows = await query('SELECT UserID, FirstName, LastName, AccessCode, RoleID FROM USERS_MES WHERE UserID = ? LIMIT 1', [Number(idStr)]);
  } else {
    const search = idStr.toLowerCase();
    rows = await query(
      `SELECT UserID, FirstName, LastName, AccessCode, RoleID FROM USERS_MES
       WHERE LOWER(FirstName) = ? OR LOWER(LastName) = ? OR LOWER(CONCAT(FirstName, ' ', LastName)) = ? LIMIT 1`,
      [search, search, search]
    );
  }

  const user = rows[0];
  if (!user) return res.status(401).json({ message: 'Credenciales invalidas' });

  const dbVal = user.AccessCode;
  let ok = false;

  if (typeof dbVal === 'string' && dbVal.startsWith('$2')) {
    ok = await bcrypt.compare(String(password), dbVal);
  } else {
    ok = String(dbVal) === String(password);
  }

  if (!ok) return res.status(401).json({ message: 'Credenciales invalidas' });

  const roles = await query('SELECT RoleName FROM USER_ROLES WHERE RoleID = ? LIMIT 1', [user.RoleID]);
  const roleName = roles[0]?.RoleName || 'operator';

  const payload = {
    sub: user.UserID,
    name: `${user.FirstName} ${user.LastName}`,
    role: roleName,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '8h' });

  res.json({ id: user.UserID, name: payload.name, role: roleName, token });
}));

app.use((_req, res) => {
  res.status(404).json({ message: "Ruta no encontrada" });
});

app.listen(port, host, () => {
  console.log(`[api] Servidor listo en http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api`);
  console.log(`[api] Escuchando en ${host}:${port}`);
  console.log("[api] Modo solo lectura: GET habilitado, escrituras bloqueadas");
});

