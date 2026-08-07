import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { pool, quoteIdentifier } from "./db.js";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as erpClient from "./erpClient.js";
import { buildInboundTransferRequestPayload } from './receiptFlow.js';
import { shouldApplyInventoryUpdate, upsertInventoryFromLot, reverseSubmittedMovement, getStorageFromLot } from './inventoryFlow.js';

dotenv.config({ path: "server/.env" });
dotenv.config();

const envPath = path.join('server', '.env');
const configPassword = process.env.CONFIG_PASSWORD || 'admin';
const app = express();
// Allow overriding the listen port via `API_PORT` for running parallel instances
const port = Number(process.env.API_PORT || process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const MAX_LIMIT = 1000;

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
  'CONFIG_PASSWORD',
  'ERP_API_TOKEN',
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
  if (req.method === 'POST' && req.path === '/requests') return next();
  // if (req.method === 'POST' && /^\/requests\/inbound\/\d+\/confirm$/.test(req.path)) return next();
  if (req.method === 'PUT' && /^\/requests\/\d+$/.test(req.path)) return next();
  if (req.method === 'POST' && /^\/requests\/\d+\/execute-transfer$/.test(req.path)) return next();
  if (req.method === 'POST' && req.path === '/erp/create-stock-entry') return next();
  if (req.method === 'PUT' && req.path === '/erp/submit-stock-entry') return next();

  // if (req.method !== "GET" && req.method !== "OPTIONS") {
  //   return res.status(405).json({
  //     message: "Backend en modo solo lectura. No se permiten escrituras en MariaDB.",
  //   });
  // }

  next();
});

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('Unhandled route error:', error && error.stack ? error.stack : error);
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

function getOffset(value, fallback = 0) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, parsed);
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

const inventoryRequestTypeCache = {
  byKey: new Map(),
  byId: new Map(),
  tableExists: false,
};

async function loadInventoryRequestTypeCache() {
  try {
    const [tables] = await pool.query("SHOW TABLES LIKE 'INVENTORY_REQUEST_TYPES'");
    if (!tables[0]) {
      inventoryRequestTypeCache.tableExists = false;
      return;
    }

    inventoryRequestTypeCache.tableExists = true;
    const [rows] = await pool.query(`
      SELECT RequestID, RequestType, RequestDescription, UseFlag
      FROM INVENTORY_REQUEST_TYPES
    `);

    for (const row of rows) {
      const id = Number(row.RequestID);
      const type = String(row.RequestType || '').trim().toLowerCase();
      const description = String(row.RequestDescription || '').trim().toLowerCase();
      if (type) inventoryRequestTypeCache.byKey.set(type, id);
      if (description) inventoryRequestTypeCache.byKey.set(description, id);
      inventoryRequestTypeCache.byId.set(id, row);
    }
  } catch (error) {
    inventoryRequestTypeCache.tableExists = false;
    console.warn('[api] No se pudo cargar INVENTORY_REQUEST_TYPES:', error.message);
  }
}

function getInventoryRequestTypeIdByKey(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!inventoryRequestTypeCache.tableExists) return null;

  const exact = inventoryRequestTypeCache.byKey.get(normalized);
  if (exact) return exact;

  for (const [key, id] of inventoryRequestTypeCache.byKey.entries()) {
    if (key.includes(normalized)) return id;
  }

  return null;
}

loadOrderStatusCache().catch((error) => console.warn('[api] Error cargando status de ordenes:', error.message));
loadReceiptDetailColumns().catch((error) => console.warn('[api] Error leyendo columnas de recibo:', error.message));
loadInventoryRequestTypeCache().catch((error) => console.warn('[api] Error cargando tipos de solicitud de inventario:', error.message));

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

function getPendingDeliveryStatusId() {
  return getOrderStatusIdByKey('Pendiente de entrega', 'ERP_PURCHASE_RECEIPT')
    ?? getOrderStatusIdByKey('pendiente de entrega', 'ERP_PURCHASE_RECEIPT')
    ?? getOrderStatusIdByKey('pendiente', 'ERP_PURCHASE_RECEIPT')
    ?? getOrderStatusIdByKey('pending', 'ERP_PURCHASE_RECEIPT')
    ?? null;
}

function hasReceiptDetailColumn(name) {
  return receiptDetailColumns.has(name);
}

async function resolveLotMeta(lotReceiveId) {
  const numericId = Number(lotReceiveId);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const [rows] = await pool.query(`
    SELECT
      lot.LotReceiveID,
      lot.PurchaseReceiptDetailID,
      lot.ProviderLot,
      lot.InternalLot,
      lot.ShortInternalLot,
      lot.SerialNumber,
      lot.Quantity,
      item.PartNumber
    FROM SHIPPING_RECEIVING_LOTS lot
    LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL detail ON detail.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
    LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
    WHERE lot.LotReceiveID = ?
    LIMIT 1
  `, [numericId]);

  return rows[0] || null;
}

async function resolveLotLocationId(lotReceiveId, lotInventoryId = null) {
  const numericLotReceiveId = Number(lotReceiveId);
  const numericLotInventoryId = Number(lotInventoryId);

  if (Number.isInteger(numericLotInventoryId) && numericLotInventoryId > 0) {
    const [rows] = await pool.query(`
      SELECT CurrentLocationID
      FROM MES_LOT_INVENTORY
      WHERE LotInventoryID = ?
      LIMIT 1
    `, [numericLotInventoryId]);

    if (rows[0]?.CurrentLocationID != null) return Number(rows[0].CurrentLocationID);
  }

  if (Number.isInteger(numericLotReceiveId) && numericLotReceiveId > 0) {
    const [rows] = await pool.query(`
      SELECT CurrentLocationID
      FROM MES_LOT_INVENTORY
      WHERE LotReceiveID = ?
      LIMIT 1
    `, [numericLotReceiveId]);

    if (rows[0]?.CurrentLocationID != null) return Number(rows[0].CurrentLocationID);
  }

  return null;
}

async function findStorageLocationForPart(partNumber) {
  const [rows] = await pool.query(`
    SELECT inv.RackLocationID
    FROM MES_INVENTORY inv
    LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
    LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
    WHERE inv.PartNumber = ?
      AND inv.Quantity > 0
      AND (
        LOWER(plant.LocationName) LIKE '%stor%'
        OR LOWER(plant.LocationName) LIKE '%almac%'
      )
    ORDER BY inv.Quantity DESC
    LIMIT 1
  `, [String(partNumber || '')]);
  return rows[0]?.RackLocationID || null;
}

async function findProductionLocation() {
  const [rows] = await pool.query(`
    SELECT LocationID FROM PLANT_LOCATIONS
    WHERE (
      LOWER(LocationName) LIKE '%produ%'
      OR LOWER(LocationName) LIKE '%production%'
      OR LOWER(LocationName) LIKE '%producción%'
    )
    LIMIT 1
  `);
  return rows[0]?.LocationID || null;
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  const rows = await query(
    "SELECT DATABASE() AS db, CURRENT_USER() AS user, VERSION() AS version"
  );

  res.json({
    ok: true,
    mode: "mixed (lectura general + escritura en endpoints específicos, ver /api/modules)",
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
    mode: "mixed (lectura general + escritura en endpoints específicos)",
    writeEndpoints: [
      "POST /api/auth/login",
      "POST/GET /api/server-config*",
      "POST /api/orders/inbound/:id/receive",
      "POST /api/orders/inbound/:id/confirm",
      "POST /api/cyclic-count",
      "POST /api/cyclic-count/:id/complete",
      "POST /api/scrap",
      "POST /api/transfers",
      "POST /api/requests",
      "PUT /api/requests/:id",
      "POST /api/requests/:id/execute-transfer",
      "POST /api/erp/create-stock-entry",
    ],
    modules: {
      dashboard: ["/api/dashboard"],
      inventory: ["/api/inventory", "/api/inventory/:partNumber"],
      scanner: ["/api/scanner/:code"],
      cyclicCount: ["/api/cyclic-count"],
      inboundOrders: ["/api/orders/inbound", "/api/orders/inbound/:id"],
      outboundOrders: ["/api/orders/outbound", "/api/orders/outbound/:id"],
      transfers: ["/api/transfers"],
      scrap: ["/api/scrap"],
      requests: ["/api/request-types", "/api/requests", "/api/requests/lots", "/api/requests/:id/execute-transfer"],
      reports: ["/api/reports/summary"],
      settings: ["/api/settings/catalogs"],
    },
  });
});

app.get("/api/dashboard", asyncRoute(async (_req, res) => {
  const [
    inventorySummary,
    criticalInventory,
    inboundRows,
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
    query(`
      SELECT
        req.RequestID,
        req.RequestStatusID,
        req.LotInventoryID,
        src.LocationName AS SourceLocationName,
        dest.LocationName AS DestinationLocationName
      FROM INVENTORY_REQUESTS req
      LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID
      LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
      WHERE req.RequestStatusID IN (40, 41)
        AND req.LotInventoryID IS NOT NULL
        AND req.LotInventoryID > 0
        AND LOWER(COALESCE(src.LocationName, '')) LIKE '%incoming%'
        AND LOWER(COALESCE(dest.LocationName, '')) LIKE '%storage%'
      ORDER BY req.SubmitDate DESC, req.RequestID DESC
    `),
  ]);

  const approvedInboundCount = Array.isArray(inboundRows)
    ? inboundRows.filter((row) => Number(row.RequestStatusID) === 41).length
    : 0;

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
    inboundReceipts: approvedInboundCount,
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

  const offset = Number(req.query.offset || 0) || 0;
  params.push(limit, offset);

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
    OFFSET ?
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

const CYCLIC_COUNT_STATUS_IDS = [46, 47, 48, 49]; // COMPLETED, IN_PROCESS, CANCELLED, REQUIRES_RECOUNT
const CYCLIC_COUNT_STORAGE_LOCATION_ID = 5; // MES_LOT_INVENTORY.CurrentLocationID required to allow a physical count

const CYCLIC_COUNT_SELECT_FIELDS = `
  cc.CycleCountID,
  cc.ERPCycleCountID,
  cc.LocationID,
  cc.StorageLocationID,
  cc.StatusID,
  cc.InventoryID,
  cc.PartNumber,
  cc.LocationCode,
  cc.SystemQuantity,
  cc.CountedQuantity,
  cc.Difference,
  cc.Result,
  cc.AdjustmentStatus,
  cc.ProgressPercent,
  cc.AttemptNo,
  cc.Comments,
  cc.CreatedDate,
  cc.UpdateDate,
  s.StatusCode,
  s.StatusDescription,
  sl.RackName,
  sl.RackColumn,
  sl.RackCell,
  pl.LocationName,
  mmi.PartName
`;

const CYCLIC_COUNT_JOINS = `
  FROM MES_CYCLE_COUNTING cc
  LEFT JOIN MES_STATUS s ON s.StatusID = cc.StatusID
  LEFT JOIN STORAGE_LOCATIONS sl ON sl.StorageID = cc.StorageLocationID
  LEFT JOIN PLANT_LOCATIONS pl ON pl.LocationID = cc.LocationID
  LEFT JOIN MES_MASTER_ITEMS mmi ON mmi.PartNumber = cc.PartNumber
`;

app.get("/api/cyclic-count", asyncRoute(async (req, res) => {
  const requestedStatus = String(req.query.status || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => CYCLIC_COUNT_STATUS_IDS.includes(value));
  const statusFilter = requestedStatus.length > 0 ? requestedStatus : CYCLIC_COUNT_STATUS_IDS;
  const placeholders = statusFilter.map(() => '?').join(', ');

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = getLimit(req.query.limit, 20);
  const offset = (page - 1) * limit;

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM MES_CYCLE_COUNTING cc WHERE cc.StatusID IN (${placeholders})`,
    statusFilter
  );
  const total = Number(countRows[0]?.total || 0);

  const rows = await query(`
    SELECT ${CYCLIC_COUNT_SELECT_FIELDS}
    ${CYCLIC_COUNT_JOINS}
    WHERE cc.StatusID IN (${placeholders})
    ORDER BY cc.UpdateDate DESC, cc.CycleCountID DESC
    LIMIT ?
    OFFSET ?
  `, [...statusFilter, limit, offset]);

  res.json({
    cycles: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}));

app.get("/api/cyclic-count/:id", asyncRoute(async (req, res) => {
  const cycleId = Number(req.params.id);
  if (!Number.isInteger(cycleId) || cycleId <= 0) {
    return res.status(400).json({ message: 'CycleCountID inválido' });
  }

  const rows = await query(`
    SELECT ${CYCLIC_COUNT_SELECT_FIELDS}
    ${CYCLIC_COUNT_JOINS}
    WHERE cc.CycleCountID = ?
    LIMIT 1
  `, [cycleId]);

  if (!rows[0]) {
    return res.status(404).json({ message: 'Conteo cíclico no encontrado' });
  }

  res.json({ cycle: rows[0] });
}));

function describeErpCountResult(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return null;
  const parts = [];
  if (payload.result) parts.push(String(payload.result));
  if (payload.difference !== undefined && payload.difference !== null) {
    parts.push(`Diferencia: ${payload.difference}`);
  }
  if (parts.length) return parts.join(' · ');
  return payload.status ? String(payload.status) : null;
}

app.post("/api/cyclic-count/:id/scan", asyncRoute(async (req, res) => {
  const cycleId = Number(req.params.id);
  const batch = String(req.body?.batch || '').trim();

  if (!Number.isInteger(cycleId) || cycleId <= 0) {
    return res.status(400).json({ message: 'CycleCountID inválido' });
  }
  if (!batch) {
    return res.status(400).json({ message: 'El código de lote escaneado es requerido' });
  }

  const [cycleRows] = await pool.query(
    'SELECT CycleCountID, ERPCycleCountID FROM MES_CYCLE_COUNTING WHERE CycleCountID = ? LIMIT 1',
    [cycleId]
  );
  const cycle = cycleRows[0];
  if (!cycle) {
    return res.status(404).json({ message: 'Conteo cíclico no encontrado' });
  }
  if (!cycle.ERPCycleCountID) {
    return res.status(409).json({ message: 'Este conteo no tiene un ID de ERP asociado (ERPCycleCountID)' });
  }

  const [lotRows] = await pool.query(
    'SELECT LotInventoryID, CurrentInternalLot, CurrentLocationID, CurrentQuantity FROM MES_LOT_INVENTORY WHERE CurrentInternalLot = ? LIMIT 1',
    [batch]
  );
  const lot = lotRows[0];
  if (!lot) {
    return res.status(404).json({ message: `Lote ${batch} no encontrado`, batch });
  }

  if (Number(lot.CurrentLocationID) !== CYCLIC_COUNT_STORAGE_LOCATION_ID) {
    return res.status(409).json({
      message: `No se puede contar el lote ${batch}: no se encuentra en la ubicación de conteo cíclico`,
      warning: true,
      batch,
    });
  }

  const countedQuantity = Number(lot.CurrentQuantity || 0);

  const erpResult = await erpClient.recordPhysicalCount({
    countId: cycle.ERPCycleCountID,
    batch,
    countedQuantity,
  });

  if (!erpResult.ok) {
    return res.status(erpResult.status && erpResult.status >= 400 ? erpResult.status : 502).json({
      message: describeErpCountResult(erpResult.message) || 'Error al registrar el conteo en el ERP',
      batch,
      countedQuantity,
    });
  }

  res.json({
    ok: true,
    batch,
    countId: cycle.ERPCycleCountID,
    countedQuantity,
    message: describeErpCountResult(erpResult.message) || 'Conteo registrado correctamente',
  });
}));

app.get("/api/storage-locations", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 1000);
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
    availableLocations,
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

  const pendingStatusIds = [getPendingDeliveryStatusId(), 8, 20].filter((value) => Number.isInteger(Number(value)) && Number(value) > 0);
  const [pendingOrderRows] = pendingStatusIds.length
    ? await pool.query(`
      SELECT
        po.PurchaseOrderID,
        po.PONumber,
        provider.ProviderName,
        po.OrderDate,
        po.CreateDate,
        po.UpdateDate,
        po.OrderStatusID,
        status.StatusDescription,
        COUNT(detail.PurchaseOrderDetailID) AS detailCount,
        COALESCE(
          (
            SELECT SUM(prd.ReceivedQty)
            FROM ERP_PURCHASE_RECEIPT_DETAIL prd
            JOIN ERP_PURCHASE_RECEIPT pr ON pr.PurchaseReceiptID = prd.PurchaseReceiptID
            WHERE pr.PurchaseOrderID = po.PurchaseOrderID
          ),
          0
        ) AS receivedQty
      FROM ERP_PURCHASE_ORDER po
      LEFT JOIN ERP_PURCHASE_ORDER_DETAIL detail ON detail.PurchaseOrderID = po.PurchaseOrderID
      LEFT JOIN PROVIDERS_MES provider ON provider.ProviderID = po.ProviderID
      LEFT JOIN MES_STATUS status ON status.StatusID = po.OrderStatusID
      WHERE po.OrderStatusID IN (${pendingStatusIds.map(() => '?').join(',')})
      GROUP BY po.PurchaseOrderID
      ORDER BY po.CreateDate DESC
      LIMIT ?
    `, [...pendingStatusIds, limit])
    : [[], []];

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
    WHERE mv.NewInternalLot = 'TRANSFER'
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
    storageQty: Number(row.acceptedQty || 0),
    quarantineQty: Number(row.rejectedQty || 0),
    receivedQty: Number(row.receivedQty || 0),
    detailCount: Number(row.detailCount || 0),
  }));

  const typedPendingOrderRows = Array.isArray(pendingOrderRows)
    ? pendingOrderRows.map((row) => ({
        id: `pending-receipt-${row.PurchaseOrderID}`,
        type: 'inbound',
        ref: row.PONumber || `PO-${row.PurchaseOrderID}`,
        provider: row.ProviderName || 'Sin proveedor',
        receiver: 'Recepción en curso',
        createdAt: row.CreateDate,
        receivedAt: row.OrderDate || row.CreateDate,
        updatedAt: row.UpdateDate,
        purchaseOrderId: row.PurchaseOrderID,
        acceptedQty: Number(row.receivedQty || 0),
        rejectedQty: 0,
        storageQty: Number(row.receivedQty || 0),
        quarantineQty: 0,
        receivedQty: Number(row.receivedQty || 0),
        detailCount: Number(row.detailCount || 0),
        statusLabel: row.StatusDescription || 'Recepción pendiente',
        description: 'Recepción pendiente o en proceso',
        isPending: true,
      }))
    : [];

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

  const history = [...typedReceiptRows, ...typedPendingOrderRows, ...typedScrapRows, ...typedTransferRows, ...typedOutboundRows]
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
  const pendingDeliveryStatusId = getPendingDeliveryStatusId();

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
    const normalizedStatus = String(status).trim().toLowerCase();
    if (normalizedStatus === 'all') {
      // Return all inbound orders regardless of status.
    } else {
      const statusId = getOrderStatusIdByKey(status, 'ERP_PURCHASE_RECEIPT');
      if (statusId !== null) {
        clauses.push('po.OrderStatusID = ?');
        params.push(statusId);
      }
    }
  } else if (pendingDeliveryStatusId !== null) {
    clauses.push('po.OrderStatusID = ?');
    params.push(pendingDeliveryStatusId);
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
      latestLot.LotReceiveID,
      latestLot.LotInventoryID,
      latestLot.CurrentLocationID,
      latestLot.ProviderLot,
      latestLot.InternalLot,
      latestLot.ShortInternalLot,
      po.CreateDate,
      po.UpdateDate
    FROM ERP_PURCHASE_ORDER po
    LEFT JOIN ERP_PURCHASE_ORDER_DETAIL detail
      ON detail.PurchaseOrderID = po.PurchaseOrderID
    LEFT JOIN PROVIDERS_MES provider
      ON provider.ProviderID = po.ProviderID
    LEFT JOIN MES_STATUS status ON status.StatusID = po.OrderStatusID
    LEFT JOIN (
      SELECT
        pr.PurchaseOrderID,
        MAX(lot.LotReceiveID) AS LotReceiveID,
        MAX(li.LotInventoryID) AS LotInventoryID,
        MAX(li.CurrentLocationID) AS CurrentLocationID,
        MAX(lot.ProviderLot) AS ProviderLot,
        MAX(lot.InternalLot) AS InternalLot,
        MAX(lot.ShortInternalLot) AS ShortInternalLot
      FROM ERP_PURCHASE_RECEIPT pr
      JOIN ERP_PURCHASE_RECEIPT_DETAIL prd ON prd.PurchaseReceiptID = pr.PurchaseReceiptID
      JOIN SHIPPING_RECEIVING_LOTS lot ON lot.PurchaseReceiptDetailID = prd.PurchaseReceiptDetailID
      LEFT JOIN MES_LOT_INVENTORY li ON li.LotReceiveID = lot.LotReceiveID
      GROUP BY pr.PurchaseOrderID
    ) latestLot ON latestLot.PurchaseOrderID = po.PurchaseOrderID
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
  const [headers, details, receipts, lots] = await Promise.all([
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
    query(`
      SELECT
        prd.PurchaseOrderDetailID,
        lot.LotReceiveID,
        lot.ProviderLot,
        lot.InternalLot,
        lot.ShortInternalLot,
        lot.SerialNumber,
        lot.Quantity AS LotQuantity,
        pr.PurchaseReceiptID,
        prd.PurchaseReceiptDetailID,
        li.LotInventoryID,
        li.CurrentLocationID
      FROM SHIPPING_RECEIVING_LOTS lot
      JOIN ERP_PURCHASE_RECEIPT_DETAIL prd ON prd.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
      JOIN ERP_PURCHASE_RECEIPT pr ON pr.PurchaseReceiptID = prd.PurchaseReceiptID
      LEFT JOIN MES_LOT_INVENTORY li ON li.LotReceiveID = lot.LotReceiveID
      WHERE pr.PurchaseOrderID = ?
      ORDER BY lot.RegDate DESC, lot.LotReceiveID DESC
    `, [id]),
  ]);

  const lotMap = new Map();
  for (const lot of lots || []) {
    const detailId = Number(lot.PurchaseOrderDetailID);
    if (!Number.isInteger(detailId)) continue;
    if (!lotMap.has(detailId)) lotMap.set(detailId, []);
    lotMap.get(detailId).push(lot);
  }

  const detailsWithLots = (details || []).map((detail) => {
    const detailId = Number(detail.PurchaseOrderDetailID);
    const lot = detailId && lotMap.has(detailId) ? (lotMap.get(detailId)[0] || null) : null;

    return {
      ...detail,
      LotReceiveID: lot?.LotReceiveID ?? null,
      ProviderLot: lot?.ProviderLot ?? null,
      InternalLot: lot?.InternalLot ?? null,
      ShortInternalLot: lot?.ShortInternalLot ?? null,
      LotSerialNumber: lot?.SerialNumber ?? null,
      LotQuantity: lot?.LotQuantity ?? null,
      PurchaseReceiptDetailID: lot?.PurchaseReceiptDetailID ?? null,
      PurchaseReceiptID: lot?.PurchaseReceiptID ?? null,
      LotInventoryID: lot?.LotInventoryID ?? null,
      CurrentLocationID: lot?.CurrentLocationID ?? null,
    };
  });

  const orderHeader = headers[0] ? { ...headers[0] } : null;
  if (orderHeader && Array.isArray(lots) && lots.length > 0) {
    const latestLot = lots[0];
    orderHeader.LotReceiveID = latestLot.LotReceiveID ?? null;
    orderHeader.LotInventoryID = latestLot.LotInventoryID ?? null;
    orderHeader.CurrentLocationID = latestLot.CurrentLocationID ?? null;
    orderHeader.ProviderLot = latestLot.ProviderLot ?? null;
    orderHeader.InternalLot = latestLot.InternalLot ?? null;
    orderHeader.ShortInternalLot = latestLot.ShortInternalLot ?? null;
  }

  res.json({
    order: orderHeader ? { ...orderHeader, StatusDescription: (await query('SELECT StatusDescription, StatusCode FROM MES_STATUS WHERE StatusID = ? LIMIT 1', [orderHeader.OrderStatusID]))[0]?.StatusDescription || orderHeader.StatusDescription } : null,
    details: detailsWithLots,
    receipts,
  });
}));

app.post("/api/orders/inbound/:id/receive", asyncRoute(async (req, res) => {
  const purchaseOrderId = Number(req.params.id);
  const { purchaseOrderDetailID, quantity, lotReceiveID, receivedBy, destination, storageId } = req.body || {};
  const detailId = Number(purchaseOrderDetailID);
  const qty = Number(quantity);
  const receivedByUserId = Number(receivedBy);
  const destinationKey = String(destination || 'almacen').trim().toLowerCase();
  const pendingDeliveryStatusId = getPendingDeliveryStatusId();

  if (!Number.isInteger(purchaseOrderId) || !Number.isInteger(detailId)) {
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
    'SELECT PurchaseOrderID, OrderStatusID FROM ERP_PURCHASE_ORDER WHERE PurchaseOrderID = ? LIMIT 1',
    [purchaseOrderId]
  );

  if (!orderRows[0]) {
    return res.status(404).json({ message: 'Orden de compra no encontrada' });
  }

  const orderStatusId = Number(orderRows[0].OrderStatusID);
  const isPendingDelivery = pendingDeliveryStatusId !== null
    ? orderStatusId === pendingDeliveryStatusId
    : true;

  if (!isPendingDelivery) {
    return res.status(400).json({ message: 'Solo se pueden recibir órdenes en estado Pendiente de entrega' });
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

  const lotMeta = await resolveLotMeta(lotReceiveID);
  const qtyFromLot = lotMeta ? Number(lotMeta.Quantity || 0) : 0;
  const effectiveQty = Number.isFinite(qty) && qty > 0 ? qty : qtyFromLot;

  if (!Number.isFinite(effectiveQty) || effectiveQty <= 0) {
    return res.status(400).json({ message: 'La cantidad a recibir debe ser mayor a cero' });
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

  if (effectiveQty > remainingQty) {
    return res.status(400).json({ message: 'La cantidad recibida supera la cantidad restante por recibir' });
  }

  const isQuarantine = ['cuarentena', 'quarantine', 'rechazado', 'rejected'].includes(destinationKey);
  const acceptQ = isQuarantine ? 'Rechazado' : 'Aceptado';
  const acceptedQty = isQuarantine ? 0 : effectiveQty;
  const rejectedQty = isQuarantine ? effectiveQty : 0;
  const receiptStatusId = pendingDeliveryStatusId ?? 20;

  const [receiptResult] = await pool.query(
    `INSERT INTO ERP_PURCHASE_RECEIPT (PurchaseOrderID, ReceiptDate, OrderStatusID, ReceivedBy, CreateDate, UpdateDate)
     VALUES (?, NOW(), ?, ?, NOW(), NOW())`,
    [purchaseOrderId, receiptStatusId, receivedByUserId]
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
    effectiveQty,
    acceptedQty,
    rejectedQty,
    new Date(),
    receivedByUserId,
    new Date(),
    lotMeta?.InternalLot || lotMeta?.ShortInternalLot || lotMeta?.ProviderLot || null,
    lotMeta?.SerialNumber || null,
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
    receivedQty: effectiveQty,
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
  const { scannedDetails, quarantineQty = 0, receivedBy, orderStatusId, destinationLocationId, sourceLocationId, requestUserId, lotReference, comments } = req.body || {};

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
    'SELECT PurchaseOrderID, OrderStatusID FROM ERP_PURCHASE_ORDER WHERE PurchaseOrderID = ? LIMIT 1',
    [purchaseOrderId]
  );

  if (!orderRows[0]) {
    return res.status(404).json({ message: 'Orden de compra no encontrada' });
  }

  const pendingDeliveryStatusId = getPendingDeliveryStatusId();
  const currentOrderStatusId = Number(orderRows[0].OrderStatusID);
  const isPendingDelivery = pendingDeliveryStatusId !== null
    ? currentOrderStatusId === pendingDeliveryStatusId
    : true;

  if (!isPendingDelivery) {
    return res.status(400).json({ message: 'Solo se pueden recibir órdenes en estado Pendiente de entrega' });
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
    `SELECT
       detail.PurchaseOrderDetailID,
       detail.PurchaseOrderID,
       detail.ItemID,
       detail.Qty,
       detail.CreateDate,
       detail.RegUserID,
       detail.UpdateDate,
       item.PartNumber
     FROM ERP_PURCHASE_ORDER_DETAIL detail
     LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
     WHERE detail.PurchaseOrderID = ? AND detail.PurchaseOrderDetailID IN (${detailIds.map(() => '?').join(',')})`,
    [purchaseOrderId, ...detailIds]
  );

  if (detailRows.length !== detailIds.length) {
    return res.status(400).json({ message: 'Algunos detalles de orden no existen o no pertenecen a la orden' });
  }

  const detailsById = new Map(detailRows.map((row) => [Number(row.PurchaseOrderDetailID), row]));
  let totalScanned = 0;
  const parsedDetails = [];
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
  for (const item of scannedDetails) {
    const detailId = Number(item.purchaseOrderDetailID);
    const detailRow = detailsById.get(detailId);

    if (!detailRow) {
      throw new Error('Detalle de orden inválido');
    }

    const lotMeta = Number.isInteger(Number(item.lotReceiveID)) && Number(item.lotReceiveID) > 0
      ? await resolveLotMeta(Number(item.lotReceiveID))
      : null;
    const fallbackQtyFromLot = lotMeta ? Number(lotMeta.Quantity || 0) : 0;
    const rawScannedQty = Number(item.scannedQty || 0);
    const scannedQty = Number.isFinite(rawScannedQty) && rawScannedQty > 0 ? rawScannedQty : fallbackQtyFromLot;
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
    parsedDetails.push({ detailRow, scannedQty, lotMeta });
  }

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
    receiptStatusId = getPendingDeliveryStatusId()
      ?? orderStatusCache.byKey.get('pending')
      ?? orderStatusCache.byKey.get('pendiente')
      ?? 20;
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

  for (const { detailRow, scannedQty, lotMeta } of parsedDetails) {
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
      lotMeta?.InternalLot || lotMeta?.ShortInternalLot || lotMeta?.ProviderLot || null,
      lotMeta?.SerialNumber || null,
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

  let transferRequest = null;
  if (destinationLocationId !== undefined && destinationLocationId !== null && destinationLocationId !== '') {
    const normalizedSourceLocationId = sourceLocationId !== undefined && sourceLocationId !== null && sourceLocationId !== ''
      ? Number(sourceLocationId)
      : null;
    const normalizedDestinationLocationId = destinationLocationId !== undefined && destinationLocationId !== null && destinationLocationId !== ''
      ? Number(destinationLocationId)
      : null;

    const transferPayload = buildInboundTransferRequestPayload({
      partNumber: detailRows[0]?.PartNumber || detailRows[0]?.ItemID || null,
      quantity: acceptedTotal > 0 ? acceptedTotal : totalScanned,
      sourceLocationId: normalizedSourceLocationId,
      destinationLocationId: normalizedDestinationLocationId,
      requestUserId: requestUserId ?? receivedByUserId,
      lotReference: lotReference ?? parsedDetails[0]?.lotMeta?.InternalLot ?? parsedDetails[0]?.lotMeta?.ShortInternalLot ?? parsedDetails[0]?.lotMeta?.ProviderLot ?? null,
      comments: comments || `Recepción confirmada para PO ${purchaseOrderId}`,
    });

    if (transferPayload.PartNumber && transferPayload.SourceLocationID && transferPayload.DestinationLocationID) {
      const [requestInsertResult] = await pool.query(`
        INSERT INTO INVENTORY_REQUESTS (
          RequestStatusID, RequestTypeID, PartNumber, Quantity,
          RegUserID, ConfirmUserID, SourceLocationID, DestinationLocationID, LotInventoryID
        ) VALUES (40, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        transferPayload.RequestTypeID,
        transferPayload.PartNumber,
        transferPayload.Quantity,
        transferPayload.RegUserID,
        transferPayload.RegUserID,
        transferPayload.SourceLocationID,
        transferPayload.DestinationLocationID,
        transferPayload.LotReceiveID || null,
      ]);

      const requestId = requestInsertResult.insertId;
      const erpResult = await erpClient.createStockEntry(requestId);
      if (!erpResult.ok) {
        await pool.query('DELETE FROM INVENTORY_REQUESTS WHERE RequestID = ?', [requestId]);
        transferRequest = { requestId: null, error: erpResult.message };
      } else {
        transferRequest = {
          requestId,
          partNumber: transferPayload.PartNumber,
          quantity: transferPayload.Quantity,
          destinationLocationId: transferPayload.DestinationLocationID,
          sourceLocationId: transferPayload.SourceLocationID,
        };
      }
    }
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
    transferRequest,
  });
}));

app.get("/api/orders/outbound", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit);
  const offset = getOffset(req.query.offset);
  const clauses = [];
  const params = [];

  if (req.query.status) {
    clauses.push("status.StatusDescription = ?");
    params.push(req.query.status);
  }

  // push limit then offset to match placeholders
  params.push(limit);
  params.push(offset);
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
    LIMIT ? OFFSET ?
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
    clauses.push("mv.NewInternalLot = ?");
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
    WHERE mv.NewInternalLot = 'TRANSFER'
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
        OriginalInternalLot,
        NewInternalLot
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

app.get("/api/scrap/requests", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 100);
  const rows = await query(`
    SELECT
      req.RequestID,
      req.RequestStatusID,
      req.RequestTypeID,
      req.PartNumber,
      item.PartName,
      req.Quantity,
      req.LotInventoryID,
      li.LotReceiveID,
      li.CurrentInternalLot,
      li.CurrentQuantity,
      li.CurrentLocationID,
      req.SourceLocationID,
      req.DestinationLocationID,
      source.LocationName AS SourceLocationName,
      dest.LocationName AS DestinationLocationName
    FROM INVENTORY_REQUESTS req
    LEFT JOIN MES_LOT_INVENTORY li ON li.LotInventoryID = req.LotInventoryID
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = req.PartNumber
    LEFT JOIN PLANT_LOCATIONS source ON source.LocationID = req.SourceLocationID
    LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
    WHERE req.RequestStatusID IN (40, 41)
      AND (
        req.RequestTypeID = 6
        OR req.RequestTypeID = 2
        OR req.RequestTypeID = 3
      )
      AND (
        LOWER(COALESCE(dest.LocationName, '')) LIKE '%quarantine%'
        OR LOWER(COALESCE(dest.LocationName, '')) LIKE '%purg%'
        OR LOWER(COALESCE(dest.LocationName, '')) LIKE '%cuarentena%'
        OR LOWER(COALESCE(dest.LocationName, '')) LIKE '%purgue%'
      )
    ORDER BY req.RequestStatusID ASC, req.RequestID DESC
    LIMIT ?
  `, [limit]);

  res.json({ count: rows.length, requests: rows });
}));

app.post('/api/scrap/requests/:requestId', asyncRoute(async (req, res) => {
  const requestId = Number(req.params.requestId);
  const { quantity, scrapType, comments, regUserId } = req.body || {};

  if (!Number.isInteger(requestId) || requestId <= 0) {
    return res.status(400).json({
      message: 'RequestID inválido.'
    });
  }

  const parsedQty = Number(quantity);

  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    return res.status(400).json({
      message: 'La cantidad debe ser mayor a cero.'
    });
  }

  const normalizedComments = comments
    ? String(comments).trim()
    : null;

  const normalizedScrapType = scrapType
    ? String(scrapType).trim()
    : null;

  const normalizedUserId = regUserId
    ? Number(regUserId)
    : null;

  if (!normalizedScrapType) {
    return res.status(400).json({
      message: 'Debe indicar un tipo de Scrap.'
    });
  }

  const connection = await pool.getConnection();

  let requestRow = null;
  let movementResult = null;
  let scrapResult = null;
  let newScrapRequestId = null;
  let availableQty = 0;

  try {
    await connection.beginTransaction();

    const [requestRows] = await connection.query(`
      SELECT
        req.RequestID,
        req.RequestTypeID,
        req.RequestStatusID,
        req.PartNumber,
        req.Quantity AS RequestQuantity,
        req.LotInventoryID,
        req.SourceLocationID,
        req.DestinationLocationID,
        li.CurrentQuantity AS LotCurrentQuantity,
        li.CurrentLocationID AS LotLocationID,
        li.CurrentInternalLot
      FROM INVENTORY_REQUESTS req
      LEFT JOIN MES_LOT_INVENTORY li
        ON li.LotInventoryID = req.LotInventoryID
      WHERE req.RequestID = ?
      LIMIT 1
    `, [requestId]);

    requestRow = requestRows[0];

    if (!requestRow) {
      await connection.rollback();

      return res.status(404).json({
        message: 'Solicitud no encontrada.'
      });
    }

    const isScrapRequest = Number(requestRow.RequestTypeID) === 6;
    const isTransferLikeRequest = [2, 3].includes(
      Number(requestRow.RequestTypeID)
    );

    if (!isScrapRequest && !isTransferLikeRequest) {
      await connection.rollback();

      return res.status(400).json({
        message: 'Sólo se pueden procesar solicitudes de Scrap o transferencias hacia cuarentena/purgue.'
      });
    }

    if (![41, 42].includes(Number(requestRow.RequestStatusID))) {
      await connection.rollback();

      return res.status(400).json({
        message: 'Sólo se pueden procesar solicitudes aprobadas o ejecutadas para Scrap.'
      });
    }

    if (!requestRow.LotInventoryID) {
      await connection.rollback();

      return res.status(400).json({
        message: 'La solicitud no tiene un lote de inventario asociado.'
      });
    }

    const [lotRows] = await connection.query(
      `
        SELECT
          LotInventoryID,
          CurrentQuantity,
          CurrentLocationID
        FROM MES_LOT_INVENTORY
        WHERE LotInventoryID = ?
        FOR UPDATE
      `,
      [requestRow.LotInventoryID]
    );

    const lotRow = lotRows[0];

    if (!lotRow) {
      await connection.rollback();

      return res.status(404).json({
        message: 'El lote de inventario asociado no fue encontrado.'
      });
    }

    const destinationLocationId =
      requestRow.DestinationLocationID != null
        ? Number(requestRow.DestinationLocationID)
        : null;

    const sourceLocationId =
      requestRow.SourceLocationID != null
        ? Number(requestRow.SourceLocationID)
        : null;

    if (
      destinationLocationId === null &&
      sourceLocationId === null
    ) {
      await connection.rollback();

      return res.status(400).json({
        message: 'La solicitud no tiene una ubicación de origen ni de destino.'
      });
    }

    if (destinationLocationId !== null) {
      if (
        lotRow.CurrentLocationID == null ||
        Number(lotRow.CurrentLocationID) !== destinationLocationId
      ) {
        await connection.rollback();

        return res.status(409).json({
          message: 'El lote debe estar en la ubicación de cuarentena/purgue indicada en la solicitud antes de procesar scrap.'
        });
      }
    } else if (sourceLocationId !== null) {
      if (
        lotRow.CurrentLocationID == null ||
        Number(lotRow.CurrentLocationID) !== sourceLocationId
      ) {
        await connection.rollback();

        return res.status(409).json({
          message: 'El lote no está en la ubicación de origen indicada en la solicitud.'
        });
      }
    }

    availableQty = Number(lotRow.CurrentQuantity || 0);

    if (availableQty <= 0) {
      await connection.rollback();

      return res.status(409).json({
        message: 'El lote no tiene cantidad disponible para scrap.'
      });
    }

    const maxQty = Math.min(
      availableQty,
      Number(requestRow.RequestQuantity || 0)
    );

    if (parsedQty > maxQty) {
      await connection.rollback();

      return res.status(400).json({
        message: `La cantidad de scrap no puede exceder ${maxQty}.`
      });
    }

    const [updateResult] = await connection.query(`
      UPDATE MES_LOT_INVENTORY
      SET CurrentQuantity = CurrentQuantity - ?
      WHERE LotInventoryID = ?
        AND CurrentQuantity >= ?
    `, [
      parsedQty,
      requestRow.LotInventoryID,
      parsedQty
    ]);

    if (updateResult.affectedRows === 0) {
      await connection.rollback();

      return res.status(409).json({
        message: 'No hay suficiente cantidad disponible en el lote para scrap.'
      });
    }

    const movementComments =
      `${normalizedScrapType}${normalizedComments ? ` | ${normalizedComments}` : ''}`;

    [movementResult] = await connection.query(`
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
        OriginalInternalLot,
        NewInternalLot
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      requestId,
      requestRow.PartNumber,
      null,
      parsedQty,
      6,
      sourceLocationId,
      destinationLocationId,
      normalizedUserId,
      normalizedUserId,
      movementComments,
      requestRow.CurrentInternalLot || null,
      'SCRAP'
    ]);

    [scrapResult] = await connection.query(`
      INSERT INTO MES_SCRAP_AND_DISCREPANCIES (
        PartNumber,
        Quantity,
        LocationID,
        RegUserID,
        Comments,
        MovementID
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      requestRow.PartNumber,
      parsedQty,
      destinationLocationId || sourceLocationId || null,
      normalizedUserId,
      movementComments,
      movementResult.insertId
    ]);

    if (!isScrapRequest) {
      const [scrapLocationRows] = await connection.query(`
        SELECT
          LocationID,
          LocationName
        FROM PLANT_LOCATIONS
        WHERE LOWER(LocationName) LIKE '%quarantine rejection%'
           OR LOWER(LocationName) LIKE '%confirmed scrap%'
      `);

      const normalizeLocation = (value) =>
        String(value || '').trim().toLowerCase();

      const scrapSourceLocationRow = scrapLocationRows.find(
        (row) =>
          normalizeLocation(row.LocationName)
            .includes('quarantine rejection')
      );

      const scrapDestinationLocationRow = scrapLocationRows.find(
        (row) =>
          normalizeLocation(row.LocationName)
            .includes('confirmed scrap')
      );

      const scrapSourceLocationId = scrapSourceLocationRow
        ? Number(scrapSourceLocationRow.LocationID)
        : 4;

      const scrapDestinationLocationId = scrapDestinationLocationRow
        ? Number(scrapDestinationLocationRow.LocationID)
        : 19;

      const [newRequestResult] = await connection.query(`
        INSERT INTO INVENTORY_REQUESTS (
          RequestStatusID,
          RequestTypeID,
          PartNumber,
          Quantity,
          RegUserID,
          ConfirmUserID,
          SourceLocationID,
          DestinationLocationID,
          LotInventoryID
        )
        VALUES (40, 6, ?, ?, ?, ?, ?, ?, ?)
      `, [
        requestRow.PartNumber,
        parsedQty,
        normalizedUserId,
        normalizedUserId,
        scrapSourceLocationId,
        scrapDestinationLocationId,
        requestRow.LotInventoryID
      ]);

      newScrapRequestId = newRequestResult.insertId
        ? Number(newRequestResult.insertId)
        : null;
    }

    await connection.query(`
      UPDATE INVENTORY_REQUESTS
      SET
        RequestStatusID = 42,
        ConfirmUserID = ?,
        SubmitDate = NOW()
      WHERE RequestID = ?
    `, [
      normalizedUserId,
      requestId
    ]);

    // Commit de todos los cambios locales ANTES de llamar al ERP: el ERP
    // escribe esta misma fila (INVENTORY_REQUESTS) con su propia conexión,
    // así que llamarlo con esta transacción todavía abierta produciría un
    // interbloqueo (su UPDATE esperando el lock que esta llamada retiene).
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  const erpSubmitResult = await erpClient.submitEntryForRequestType({
    requestId,
    requestTypeId: Number(requestRow.RequestTypeID),
    qty: parsedQty,
    batchNo: requestRow.CurrentInternalLot || undefined,
  });

  if (!erpSubmitResult.ok) {
    console.error(`[scrap] MES Web rechazó la confirmación del movimiento para requestId=${requestId}:`, erpSubmitResult);

    const compConnection = await pool.getConnection();
    let compensation = { reversed: false, reason: 'not_attempted' };
    try {
      await compConnection.beginTransaction();
      compensation = await reverseSubmittedMovement(compConnection, {
        requestId,
        requestTypeId: Number(requestRow.RequestTypeID),
        lotInventoryId: requestRow.LotInventoryID,
        sourceLocationId: requestRow.SourceLocationID ? Number(requestRow.SourceLocationID) : null,
      });
      if (compensation.reversed) {
        await compConnection.query(
          "UPDATE INVENTORY_REQUESTS SET RequestStatusID = 41, SubmitDate = NULL WHERE RequestID = ?",
          [requestId]
        );
      }
      if (newScrapRequestId) {
        await compConnection.query(
          'DELETE FROM INVENTORY_REQUESTS WHERE RequestID = ? AND RequestStatusID = 40',
          [newScrapRequestId]
        );
      }
      await compConnection.commit();
    } catch (compensationError) {
      await compConnection.rollback().catch(() => {});
      console.error(`[scrap] Falló la reversión compensatoria para requestId=${requestId}:`, compensationError);
      compensation = { reversed: false, reason: 'compensation_failed' };
    } finally {
      compConnection.release();
    }

    console.error(`[scrap] requestId=${requestId} revertido=${compensation.reversed} razon=${compensation.reason || 'n/a'}`);
    return res.status(502).json({ message: 'No se pudo completar la operación, intenta de nuevo.' });
  }

  res.status(201).json({
    ok: true,
    requestId,
    movementId: movementResult.insertId,
    scrapId: scrapResult.insertId,
    newScrapRequestId,
    deductedQty: parsedQty,
    remainingLotQuantity: availableQty - parsedQty,
    erpSubmit: erpSubmitResult.data,
  });
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
  const { partNumber, quantity, locationId, sourceLocationId, destinationLocationId, comments, regUserId, lotReceiveId, lotInventoryId } = req.body || {};

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
        OriginalInternalLot,
        NewInternalLot
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

async function getMostRecentInternalLot(partNumber) {
  if (!partNumber) return null;
  const rows = await query(`
    SELECT lot.InternalLot
    FROM SHIPPING_RECEIVING_LOTS lot
    LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL detail ON detail.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
    LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
    WHERE item.PartNumber = ? AND lot.InternalLot IS NOT NULL
    ORDER BY lot.RegDate DESC
    LIMIT 1
  `, [partNumber]);
  return rows[0]?.InternalLot || null;
}

app.get("/api/request-types", asyncRoute(async (_req, res) => {
  const rows = await query(`
    SELECT RequestID AS RequestTypeID, RequestType, RequestDescription
    FROM INVENTORY_REQUEST_TYPES
    WHERE UseFlag = 1
    ORDER BY RequestID
  `);
  res.json({ count: rows.length, requestTypes: rows });
}));

app.get("/api/requests", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 100);
  const offset = getOffset(req.query.offset, 0);
  const clauses = [];
  const params = [];

  if (req.query.status) {
    clauses.push("req.RequestStatusID = ?");
    params.push(Number(req.query.status));
  }
  if (req.query.requestTypeId) {
    clauses.push("req.RequestTypeID = ?");
    params.push(Number(req.query.requestTypeId));
  }

  params.push(limit);
  params.push(offset);
  const rows = await query(`
    SELECT
      req.RequestID,
      req.RequestStatusID,
      status.StatusCode,
      status.StatusDescription,
      req.RequestTypeID,
      type.RequestType AS RequestTypeName,
      type.RequestDescription AS RequestTypeDescription,
      req.PartNumber,
      item.PartName,
      item.UnitType,
      req.Quantity,
      req.RegDate,
      req.SubmitDate,
      req.RegUserID,
      req.ConfirmUserID,
      req.RequestName,
      req.SourceLocationID,
      req.DestinationLocationID,
      req.LotInventoryID AS LotInventoryID,
      li.LotReceiveID AS LotReceiveID
    FROM INVENTORY_REQUESTS req
    LEFT JOIN MES_STATUS status ON status.StatusID = req.RequestStatusID
    LEFT JOIN INVENTORY_REQUEST_TYPES type ON type.RequestID = req.RequestTypeID
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = req.PartNumber
    LEFT JOIN MES_LOT_INVENTORY li ON li.LotInventoryID = req.LotInventoryID
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY req.RequestID DESC
    LIMIT ? OFFSET ?
  `, params);

  res.json({ count: rows.length, requests: rows });
}));

app.get("/api/requests/inbound", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 100);
  const offset = getOffset(req.query.offset);
  const statusQuery = String(req.query.status || '').trim();
  const normalizedStatus = statusQuery.toLowerCase();
  let statusId = null;

  if (normalizedStatus) {
    if (normalizedStatus === 'pending' || normalizedStatus.includes('pend')) {
      statusId = 41;
    } else if (normalizedStatus === 'approved' || normalizedStatus.includes('approv')) {
      statusId = 42;
    } else {
      const resolved = getOrderStatusIdByKey(statusQuery, null);
      if (Number.isFinite(Number(resolved))) {
        statusId = Number(resolved);
      }
    }
  }

  const params = [];
  const clauses = [
    'req.RequestStatusID IN (41, 42)',
    'req.RequestTypeID IN (2, 12)',
    'req.LotInventoryID IS NOT NULL',
    'req.LotInventoryID > 0',
    "LOWER(COALESCE(src.LocationName, '')) LIKE '%incoming%'",
    "LOWER(COALESCE(dest.LocationName, '')) LIKE '%storage%'",
  ];

  if (Number.isFinite(Number(statusId))) {
    clauses.push('req.RequestStatusID = ?');
    params.push(statusId);
  }

  const rows = await query(`
    SELECT
      req.RequestID,
      req.RequestStatusID,
      status.StatusCode,
      status.StatusDescription,
      req.RequestTypeID,
      type.RequestType AS RequestTypeName,
      type.RequestDescription AS RequestTypeDescription,
      req.PartNumber,
      item.PartName,
      item.UnitType,
      req.Quantity,
      req.RegDate,
      req.SubmitDate,
      req.RequestName,
      req.SourceLocationID,
      req.DestinationLocationID,
      req.LotInventoryID,
      src.LocationName AS SourceLocationName,
      dest.LocationName AS DestinationLocationName,
      li.LotReceiveID AS LotReceiveIDFromInventory,
      li.CurrentLocationID
    FROM INVENTORY_REQUESTS req
    LEFT JOIN MES_STATUS status ON status.StatusID = req.RequestStatusID
    LEFT JOIN INVENTORY_REQUEST_TYPES type ON type.RequestID = req.RequestTypeID
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = req.PartNumber
    LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID
    LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
    LEFT JOIN MES_LOT_INVENTORY li ON li.LotInventoryID = req.LotInventoryID
    WHERE ${clauses.join(' AND\n      ')}
    ORDER BY req.SubmitDate DESC, req.RequestID DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const normalized = (rows || []).map((row) => ({
    RequestID: Number(row.RequestID),
    PurchaseOrderID: Number(row.RequestID),
    PONumber: String(row.RequestName || `REQ-${row.RequestID}`),
    ProviderName: row.PartName ? String(row.PartName) : 'Incoming → Storage',
    OrderDate: row.SubmitDate || row.RegDate,
    ExpectedDate: row.SubmitDate || row.RegDate,
    OrderStatusID: Number(row.RequestStatusID || 0),
    StatusCode: row.StatusCode,
    StatusDescription: row.StatusDescription || 'Aprobada',
    itemCount: 1,
    orderedQty: Number(row.Quantity || 0),
    receivedQty: 0,
    CreateDate: row.RegDate || row.SubmitDate,
    UpdateDate: row.SubmitDate || row.RegDate,
    PartNumber: row.PartNumber,
    PartName: row.PartName,
    Quantity: Number(row.Quantity || 0),
    RequestName: row.RequestName,
    SourceLocationID: row.SourceLocationID != null ? Number(row.SourceLocationID) : null,
    DestinationLocationID: row.DestinationLocationID != null ? Number(row.DestinationLocationID) : null,
    SourceLocationName: row.SourceLocationName,
    DestinationLocationName: row.DestinationLocationName,
    LotInventoryID: row.LotInventoryID != null ? Number(row.LotInventoryID) : null,
    LotReceiveID: row.LotReceiveIDFromInventory != null ? Number(row.LotReceiveIDFromInventory) : null,
    CurrentLocationID: row.CurrentLocationID != null ? Number(row.CurrentLocationID) : null,
    RequestTypeName: row.RequestTypeName,
    RequestTypeDescription: row.RequestTypeDescription,
  }));

  res.json({ count: normalized.length, orders: normalized });
}));

app.get('/api/requests/inbound/:id(\\d+)', asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) return res.status(400).json({ message: 'Identificador inválido.' });

  const rows = await query(`
    SELECT
      req.RequestID,
      req.RequestStatusID,
      status.StatusCode,
      status.StatusDescription,
      req.RequestTypeID,
      type.RequestType AS RequestTypeName,
      type.RequestDescription AS RequestTypeDescription,
      req.PartNumber,
      item.PartName,
      item.UnitType,
      req.Quantity,
      req.RegDate,
      req.SubmitDate,
      req.RequestName,
      req.SourceLocationID,
      req.DestinationLocationID,
      req.LotInventoryID,
      src.LocationName AS SourceLocationName,
      dest.LocationName AS DestinationLocationName,
      li.LotReceiveID AS LotReceiveIDFromInventory,
      li.CurrentLocationID
    FROM INVENTORY_REQUESTS req
    LEFT JOIN MES_STATUS status ON status.StatusID = req.RequestStatusID
    LEFT JOIN INVENTORY_REQUEST_TYPES type ON type.RequestID = req.RequestTypeID
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = req.PartNumber
    LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID
    LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
    LEFT JOIN MES_LOT_INVENTORY li ON li.LotInventoryID = req.LotInventoryID
    WHERE req.RequestID = ?
    LIMIT 1
  `, [requestId]);

  if (!rows[0]) return res.status(404).json({ message: 'Solicitud de entrada no encontrada.' });

  const row = rows[0];
  res.json({
    request: {
      RequestID: Number(row.RequestID),
      PurchaseOrderID: Number(row.RequestID),
      PONumber: String(row.RequestName || `REQ-${row.RequestID}`),
      ProviderName: row.PartName ? String(row.PartName) : 'Incoming → Storage',
      OrderDate: row.SubmitDate || row.RegDate,
      ExpectedDate: row.SubmitDate || row.RegDate,
      OrderStatusID: Number(row.RequestStatusID || 0),
      StatusCode: row.StatusCode,
      StatusDescription: row.StatusDescription || 'Aprobada',
      itemCount: 1,
      orderedQty: Number(row.Quantity || 0),
      receivedQty: 0,
      CreateDate: row.RegDate || row.SubmitDate,
      UpdateDate: row.SubmitDate || row.RegDate,
      PartNumber: row.PartNumber,
      PartName: row.PartName,
      Quantity: Number(row.Quantity || 0),
      RequestName: row.RequestName,
      SourceLocationID: row.SourceLocationID != null ? Number(row.SourceLocationID) : null,
      DestinationLocationID: row.DestinationLocationID != null ? Number(row.DestinationLocationID) : null,
      SourceLocationName: row.SourceLocationName,
      DestinationLocationName: row.DestinationLocationName,
      LotInventoryID: row.LotInventoryID != null ? Number(row.LotInventoryID) : null,
      LotReceiveID: row.LotReceiveIDFromInventory != null ? Number(row.LotReceiveIDFromInventory) : null,
      CurrentLocationID: row.CurrentLocationID != null ? Number(row.CurrentLocationID) : null,
      RequestTypeName: row.RequestTypeName,
      RequestTypeDescription: row.RequestTypeDescription,
    },
  });
}));

app.post('/api/requests/inbound/:id/confirm', asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  const { storageId, quantity, receivedBy, comments, lotReference, sourceLocationId, requestUserId, lotInventoryId } = req.body || {};
  if (!Number.isInteger(requestId) || requestId <= 0) return res.status(400).json({ message: 'ID de solicitud inválido.' });

  const [requestRows] = await pool.query('SELECT * FROM INVENTORY_REQUESTS WHERE RequestID = ? LIMIT 1', [requestId]);
  const requestRow = requestRows[0];
  if (!requestRow) return res.status(404).json({ message: 'Solicitud de entrada no encontrada.' });
  const statusId = Number(requestRow.RequestStatusID);
  if (statusId !== 40 && statusId !== 41) return res.status(409).json({ message: 'Solo se pueden confirmar solicitudes en estado pendiente/aprobado.' });
  if (Number(requestRow.LotInventoryID) <= 0) return res.status(400).json({ message: 'La solicitud no tiene lote válido para recibir.' });

  const parsedStorageId = Number(storageId);
  if (!Number.isInteger(parsedStorageId) || parsedStorageId <= 0) return res.status(400).json({ message: 'Debe seleccionar una ubicación de rack.' });

  const parsedSourceLocationId = sourceLocationId !== undefined && sourceLocationId !== null && sourceLocationId !== ''
    ? Number(sourceLocationId)
    : undefined;
  const parsedQty = Number(quantity);
  const effectiveQty = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : Number(requestRow.Quantity || 0);
  if (!Number.isFinite(effectiveQty) || effectiveQty <= 0) return res.status(400).json({ message: 'La cantidad debe ser mayor a cero.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [storageRows] = await connection.query('SELECT StorageID, LocationID, RackName FROM STORAGE_LOCATIONS WHERE StorageID = ? LIMIT 1', [parsedStorageId]);
    if (!storageRows[0]) {
      await connection.rollback();
      return res.status(404).json({ message: 'La ubicación de rack indicada no existe.' });
    }

    const partNumber = String(requestRow.PartNumber || '').trim();
    if (!partNumber) {
      await connection.rollback();
      return res.status(400).json({ message: 'La solicitud no tiene producto asociado.' });
    }

    const [existingInventoryRows] = await connection.query(
      'SELECT InventoryID, Quantity FROM MES_INVENTORY WHERE PartNumber = ? AND RackLocationID = ? FOR UPDATE',
      [partNumber, parsedStorageId]
    );

    if (existingInventoryRows[0]) {
      await connection.query(
        'UPDATE MES_INVENTORY SET Quantity = Quantity + ?, LastUpdate = NOW() WHERE InventoryID = ?',
        [effectiveQty, existingInventoryRows[0].InventoryID]
      );
    } else {
      await connection.query(
        'INSERT INTO MES_INVENTORY (PartNumber, RackLocationID, Quantity, LastUpdate) VALUES (?, ?, ?, NOW())',
        [partNumber, parsedStorageId, effectiveQty]
      );
    }

    if (requestRow.LotInventoryID) {
      await connection.query(
        'UPDATE MES_LOT_INVENTORY SET CurrentLocationID = ? WHERE LotInventoryID = ?',
        [storageRows[0].LocationID || null, requestRow.LotInventoryID]
      );
    }

    const transferPayload = buildInboundTransferRequestPayload({
      partNumber: String(requestRow.PartNumber || '').trim(),
      quantity: effectiveQty,
      sourceLocationId: parsedSourceLocationId,
      destinationLocationId: storageRows[0].LocationID ? Number(storageRows[0].LocationID) : parsedStorageId,
      requestUserId: requestUserId !== undefined && requestUserId !== null && requestUserId !== '' ? Number(requestUserId) : (receivedBy ? Number(receivedBy) : null),
      lotReference: lotReference !== undefined && lotReference !== null && lotReference !== '' ? String(lotReference) : undefined,
      lotInventoryId: lotInventoryId !== undefined && lotInventoryId !== null && lotInventoryId !== '' ? Number(lotInventoryId) : (requestRow.LotInventoryID ? Number(requestRow.LotInventoryID) : undefined),
      comments: comments ? String(comments) : 'Recepción confirmada desde Incoming → Storage',
    });

    let createdTransferRequestId = null;
    if (transferPayload.PartNumber && transferPayload.SourceLocationID && transferPayload.DestinationLocationID) {
      const [requestInsertResult] = await connection.query(`
        INSERT INTO INVENTORY_REQUESTS (
          RequestStatusID, RequestTypeID, PartNumber, Quantity,
          RegUserID, ConfirmUserID, SourceLocationID, DestinationLocationID, LotInventoryID, RequestName, Comments
        ) VALUES (40, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        transferPayload.RequestTypeID,
        transferPayload.PartNumber,
        transferPayload.Quantity,
        transferPayload.RegUserID,
        transferPayload.RegUserID,
        transferPayload.SourceLocationID,
        transferPayload.DestinationLocationID,
        transferPayload.LotInventoryID ?? null,
        `Inbound-${requestId}`,
        transferPayload.Comments || null,
      ]);

      createdTransferRequestId = Number(requestInsertResult.insertId || 0);

      if (createdTransferRequestId > 0) {
        try {
          const erpResult = await erpClient.createStockEntry(createdTransferRequestId);
          if (!erpResult.ok) {
            await connection.query('DELETE FROM INVENTORY_REQUESTS WHERE RequestID = ?', [createdTransferRequestId]);
            createdTransferRequestId = null;
          }
        } catch (erpError) {
          await connection.query('DELETE FROM INVENTORY_REQUESTS WHERE RequestID = ?', [createdTransferRequestId]);
          createdTransferRequestId = null;
        }
      }
    }

    await connection.query(
      'UPDATE INVENTORY_REQUESTS SET RequestStatusID = 41, ConfirmUserID = ?, SubmitDate = NOW() WHERE RequestID = ?',
      [receivedBy ? Number(receivedBy) : null, requestId]
    );

    if (shouldApplyInventoryUpdate(41, Number(requestRow.RequestTypeID), Number(requestRow.LotInventoryID))) {
      await upsertInventoryFromLot(connection, {
        requestId,
        lotInventoryId: requestRow.LotInventoryID,
        partNumber: partNumber,
        quantity: effectiveQty,
        sourceLocationId: requestRow.SourceLocationID ? Number(requestRow.SourceLocationID) : null,
        destinationLocationId: storageRows[0].LocationID ? Number(storageRows[0].LocationID) : parsedStorageId,
        userId: receivedBy ? Number(receivedBy) : null,
        comments: comments ? String(comments) : 'Recepción confirmada desde Incoming → Storage',
        requestStatusId: 41,
        requestTypeId: Number(requestRow.RequestTypeID),
      });
    }

    await connection.query(`
      INSERT INTO INVENTORY_MOVEMENTS_HISTORY (
        RequestID, PartNumber, StorageID, Quantity, MovementTypeID,
        SourceLocationID, DestinationLocationID, RegUserID, ConfirmUserID,
        Comments, OriginalInternalLot, NewInternalLot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      requestId,
      partNumber,
      parsedStorageId,
      effectiveQty,
      2,
      requestRow.SourceLocationID ? Number(requestRow.SourceLocationID) : null,
      requestRow.DestinationLocationID ? Number(requestRow.DestinationLocationID) : null,
      receivedBy ? Number(receivedBy) : null,
      receivedBy ? Number(receivedBy) : null,
      comments ? String(comments) : 'Recepción confirmada desde Incoming → Storage',
      requestRow.LotInventoryID ? String(requestRow.LotInventoryID) : null,
      requestRow.LotInventoryID ? String(requestRow.LotInventoryID) : null,
    ]);

    await connection.commit();
    res.json({
      ok: true,
      requestId,
      statusName: 'Confirmada',
      receivedQty: effectiveQty,
      storageId: parsedStorageId,
      transferRequestId: createdTransferRequestId,
      transferRequestCreated: createdTransferRequestId !== null,
    });
  } catch (error) {
    await connection.rollback();
    console.error('[api] Error confirmando solicitud de entrada:', error);
    res.status(500).json({ message: error.message || 'No fue posible confirmar la solicitud de entrada.' });
  } finally {
    connection.release();
  }
}));

app.get('/api/requests/:id(\\d+)', asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId)) return res.status(400).json({ message: 'Identificador inválido.' });

  const rows = await query(`
    SELECT
      req.RequestID,
      req.RequestStatusID,
      status.StatusCode,
      status.StatusDescription,
      req.RequestTypeID,
      type.RequestType AS RequestTypeName,
      type.RequestDescription AS RequestTypeDescription,
      req.PartNumber,
      item.PartName,
      item.UnitType,
      req.Quantity,
      req.RegDate,
      req.SubmitDate,
      req.RegUserID,
      req.ConfirmUserID,
      req.RequestName,
      req.SourceLocationID,
      req.DestinationLocationID,
      req.LotInventoryID AS LotInventoryID,
      li.LotReceiveID AS LotReceiveID
    FROM INVENTORY_REQUESTS req
    LEFT JOIN MES_STATUS status ON status.StatusID = req.RequestStatusID
    LEFT JOIN INVENTORY_REQUEST_TYPES type ON type.RequestID = req.RequestTypeID
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = req.PartNumber
    LEFT JOIN MES_LOT_INVENTORY li ON li.LotInventoryID = req.LotInventoryID
    WHERE req.RequestID = ?
    LIMIT 1
  `, [requestId]);

  if (!rows[0]) return res.status(404).json({ message: 'Solicitud no encontrada.' });
  res.json({ request: rows[0] });
}));

app.get("/api/requests/lot-inventory", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 50);
  const partNumber = getSearch(req.query.partNumber);

  const [rows] = await pool.query(`
    SELECT
      li.LotInventoryID,
      li.LotReceiveID,
      li.CurrentInternalLot,
      li.CurrentLocationID,
      li.CurrentQuantity,
      li.RegDate,
      lot.InternalLot,
      lot.ProviderLot,
      lot.ShortInternalLot,
      lot.Quantity AS ReceiveQuantity,
      detail.PurchaseReceiptDetailID,
      detail.ItemID,
      item.PartNumber,
      item.PartName,
      item.UnitType
    FROM MES_LOT_INVENTORY li
    LEFT JOIN SHIPPING_RECEIVING_LOTS lot ON lot.LotReceiveID = li.LotReceiveID
    LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL detail ON detail.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
    LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
    ${partNumber ? "WHERE item.PartNumber = ?" : ""}
    ORDER BY li.LotInventoryID DESC
    LIMIT ?
  `, partNumber ? [partNumber, limit] : [limit]);

  const normalizedRows = (rows || []).map((row) => ({
    ...row,
    LotInventoryID: row.LotInventoryID != null ? Number(row.LotInventoryID) : null,
    LotReceiveID: row.LotReceiveID != null ? Number(row.LotReceiveID) : null,
    CurrentLocationID: row.CurrentLocationID != null ? Number(row.CurrentLocationID) : null,
    CurrentQuantity: row.CurrentQuantity != null ? Number(row.CurrentQuantity) : null,
    RegDate: row.RegDate || null,
    ReceiveQuantity: row.ReceiveQuantity != null ? Number(row.ReceiveQuantity) : null,
  }));

  res.json({ count: normalizedRows.length, lotInventory: normalizedRows });
}));

app.get("/api/requests/lots", asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 50);
  const partNumber = getSearch(req.query.partNumber);
  const lotReference = getSearch(req.query.lotReference);
  const clauses = [];
  const params = [];

  if (partNumber) {
    clauses.push("item.PartNumber = ?");
    params.push(partNumber);
  }

  if (lotReference) {
    clauses.push(`(
      lot.ProviderLot = ?
      OR lot.InternalLot = ?
      OR lot.ShortInternalLot = ?
      OR CAST(lot.LotReceiveID AS CHAR) = ?
    )`);
    params.push(lotReference, lotReference, lotReference, lotReference);
  }

  params.push(limit);
  const rows = await query(`
    SELECT
      lot.LotReceiveID AS ReceiveID,
      lot.ProviderLot,
      lot.InternalLot,
      lot.ShortInternalLot,
      lot.Quantity,
      lot.RegDate,
      item.PartNumber,
      receipt.PurchaseOrderID AS PurchaseOrderID,
      po.PONumber AS PONumber,
      detail.PurchaseReceiptDetailID,
      detail.PurchaseOrderDetailID,
      detail.ItemID,
      detail.ReceivedQty,
      detail.AcceptedQty,
      detail.RejectedQty,
      li.LotInventoryID AS LotInventoryID,
      li.CurrentLocationID AS CurrentLocationID,
      li.CurrentInternalLot AS CurrentInternalLot,
      li.CurrentQuantity AS CurrentQuantity
    FROM MES_LOT_INVENTORY li
    LEFT JOIN SHIPPING_RECEIVING_LOTS lot ON lot.LotReceiveID = li.LotReceiveID
    LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL detail ON detail.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
    LEFT JOIN ERP_PURCHASE_RECEIPT receipt ON receipt.PurchaseReceiptID = detail.PurchaseReceiptID
    LEFT JOIN ERP_PURCHASE_ORDER po ON po.PurchaseOrderID = receipt.PurchaseOrderID
    LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
    WHERE li.CurrentLocationID IS NOT NULL
      AND COALESCE(li.CurrentQuantity, 0) > 0
    ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}
    ORDER BY li.LotInventoryID DESC
    LIMIT ?
  `, params);

  const normalizedRows = (rows || []).map((row) => {
    const purchaseOrderId = row.PurchaseOrderID != null ? Number(row.PurchaseOrderID) : null;
    return {
      ...row,
      PurchaseOrderID: Number.isFinite(purchaseOrderId) && purchaseOrderId > 0 ? purchaseOrderId : null,
      PONumber: row.PONumber ? String(row.PONumber) : null,
      ReceiveID: row.ReceiveID != null ? Number(row.ReceiveID) : null,
      LotInventoryID: row.LotInventoryID != null ? Number(row.LotInventoryID) : null,
      CurrentLocationID: row.CurrentLocationID != null ? Number(row.CurrentLocationID) : null,
      CurrentInternalLot: row.CurrentInternalLot ? String(row.CurrentInternalLot) : null,
      CurrentQuantity: row.CurrentQuantity != null ? Number(row.CurrentQuantity) : null,
      inStorage: row.CurrentLocationID != null,
    };
  });

  res.json({ count: normalizedRows.length, lots: normalizedRows });
}));

app.post("/api/requests", asyncRoute(async (req, res) => {
  const {
    RequestTypeID,
    PartNumber,
    Quantity,
    RegUserID,
    SourceLocationID,
    DestinationLocationID,
    LotReceiveID: incomingLotReceiveID,
    LotInventoryID,
    Comments,
  } = req.body || {};
  let LotReceiveID = incomingLotReceiveID;

  const normalizedPartNumber = String(PartNumber || '').trim();
  const parsedQty = Number(Quantity);
  const parsedTypeId = Number(RequestTypeID);
  const parsedRegUserId = RegUserID ? Number(RegUserID) : null;

  if (!normalizedPartNumber) {
    return res.status(400).json({ message: "Debe indicar un producto para la solicitud." });
  }
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    return res.status(400).json({ message: "La cantidad debe ser mayor a cero." });
  }
  if (!Number.isInteger(parsedTypeId)) {
    return res.status(400).json({ message: "Debe indicar un tipo de solicitud válido." });
  }
  if (!parsedRegUserId) {
    return res.status(400).json({ message: "No se pudo identificar al usuario que registra la solicitud." });
  }

  const [typeRows] = await pool.query(
    "SELECT RequestID FROM INVENTORY_REQUEST_TYPES WHERE RequestID = ? AND UseFlag = 1",
    [parsedTypeId]
  );
  if (!typeRows[0]) {
    return res.status(400).json({ message: "El tipo de solicitud indicado no es válido." });
  }

  const isTransfer = parsedTypeId === 2;
  let normalizedSourceLocationId = SourceLocationID ? Number(SourceLocationID) : null;
  let normalizedDestinationLocationId = DestinationLocationID ? Number(DestinationLocationID) : null;
  let resolvedLotInventoryId = null;

  const hasLotInventoryId = LotInventoryID !== undefined && LotInventoryID !== null && LotInventoryID !== '';
  const parsedLotInventoryId = hasLotInventoryId ? Number(LotInventoryID) : null;

  if (Number.isInteger(parsedLotInventoryId) && parsedLotInventoryId > 0) {
    const [lotInvRows] = await pool.query(`SELECT LotInventoryID, LotReceiveID, CurrentLocationID FROM MES_LOT_INVENTORY WHERE LotInventoryID = ? LIMIT 1`, [parsedLotInventoryId]);
    if (!lotInvRows[0]) {
      return res.status(400).json({ message: 'Lote de inventario indicado no existe.' });
    }
    resolvedLotInventoryId = parsedLotInventoryId;
    const inventoryLotReceiveId = lotInvRows[0].LotReceiveID || null;
    if (!LotReceiveID) {
      LotReceiveID = inventoryLotReceiveId;
    } else if (inventoryLotReceiveId && Number(inventoryLotReceiveId) !== Number(LotReceiveID)) {
      return res.status(400).json({ message: 'El lote de inventario indicado no coincide con el lote recibido seleccionado.' });
    }
  }

  const hasLotReceiveId = LotReceiveID !== undefined && LotReceiveID !== null && LotReceiveID !== '';

  // If a LotReceiveID was provided, validate that the lot exists and is available in Storage,
  // and if no explicit source rack was provided, choose a rack automatically.
  if (hasLotReceiveId) {
    const lotMeta = await resolveLotMeta(LotReceiveID).catch(() => null);
    if (!lotMeta) {
      return res.status(400).json({ message: 'Lote indicado no existe.' });
    }

    // If no destination specified, default to Production location
    if (!normalizedDestinationLocationId) {
      const prodLoc = await findProductionLocation().catch(() => null);
      if (prodLoc) normalizedDestinationLocationId = Number(prodLoc);
    }

    // Map LotReceiveID -> LotInventoryID (MES_LOT_INVENTORY) if available
    if (resolvedLotInventoryId === null) {
      try {
        const [lotInvRows] = await pool.query(`SELECT LotInventoryID, CurrentLocationID FROM MES_LOT_INVENTORY WHERE LotReceiveID = ? LIMIT 1`, [Number(LotReceiveID)]);
        if (lotInvRows && lotInvRows[0] && lotInvRows[0].LotInventoryID) {
          resolvedLotInventoryId = Number(lotInvRows[0].LotInventoryID);
          if (!normalizedSourceLocationId && lotInvRows[0].CurrentLocationID != null) {
            normalizedSourceLocationId = Number(lotInvRows[0].CurrentLocationID);
          }
        } else {
          // try matching by internal lot string when LotReceiveID isn't present in MES_LOT_INVENTORY
          const candidateRef = String(lotMeta.InternalLot || lotMeta.ProviderLot || '').trim();
          if (candidateRef) {
            const [byRef] = await pool.query(`SELECT LotInventoryID, CurrentLocationID FROM MES_LOT_INVENTORY WHERE CurrentInternalLot = ? LIMIT 1`, [candidateRef]);
            if (byRef && byRef[0] && byRef[0].LotInventoryID) {
              resolvedLotInventoryId = Number(byRef[0].LotInventoryID);
              if (!normalizedSourceLocationId && byRef[0].CurrentLocationID != null) {
                normalizedSourceLocationId = Number(byRef[0].CurrentLocationID);
              }
            }
          }
        }
      } catch (e) {
        // ignore mapping errors; we'll insert NULL for LotInventoryID if not resolvable
        resolvedLotInventoryId = null;
      }
    }

    // Only create a MES_LOT_INVENTORY mapping if the lot has available quantity
    const lotQty = Number(lotMeta.Quantity || 0);
    if (resolvedLotInventoryId === null) {
      if (lotQty > 0) {
        try {
            const candidateRef = String(lotMeta.InternalLot || lotMeta.ProviderLot || req.body.LotReceiveID || '').trim();
            // Use actual lot quantity when creating the inventory record
            const lotQty = Number(lotMeta.Quantity || 0);
            const currentQty = Number.isFinite(lotQty) ? lotQty.toFixed(4) : '0.0000';
            const regUser = parsedRegUserId || 1;

            // Determine a sensible CurrentLocationID: prefer provided source, else try findStorageLocationForPart -> map to PLANT LocationID
            let currentLocation = normalizedSourceLocationId || null;
            if (!currentLocation) {
              try {
                const candidateStorageId = await findStorageLocationForPart(lotMeta.PartNumber);
                if (candidateStorageId) {
                  const [storageRows] = await pool.query(`SELECT LocationID FROM STORAGE_LOCATIONS WHERE StorageID = ? LIMIT 1`, [candidateStorageId]);
                  if (storageRows[0] && storageRows[0].LocationID) currentLocation = Number(storageRows[0].LocationID);
                  else currentLocation = Number(candidateStorageId);
                }
              } catch (err) {
                currentLocation = normalizedSourceLocationId || null;
              }
            }

            const [createRes] = await pool.query(`
              INSERT INTO MES_LOT_INVENTORY (LotReceiveID, CurrentInternalLot, CurrentLocationID, CurrentQuantity, RegDate, RegUserID)
              VALUES (?, ?, ?, ?, NOW(), ?)
            `, [Number(req.body.LotReceiveID), candidateRef, currentLocation, String(currentQty), regUser]);
          if (createRes && createRes.insertId) {
            resolvedLotInventoryId = Number(createRes.insertId);
          }
        } catch (e) {
          console.error('Failed creating MES_LOT_INVENTORY for LotReceiveID', req.body.LotReceiveID, e && e.stack ? e.stack : e);
          resolvedLotInventoryId = null;
        }
      } else {
        // Lot has no available quantity — return helpful context so UI can inform user
        const [racks] = await pool.query(`
          SELECT
            inv.RackLocationID AS StorageID,
            storage.RackName,
            plant.LocationName,
            inv.Quantity
          FROM MES_INVENTORY inv
          LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
          LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
          WHERE inv.PartNumber = ? AND inv.Quantity > 0
          ORDER BY inv.Quantity DESC
          LIMIT 10
        `, [String(lotMeta.PartNumber || '')]);

        const [lotsInStorage] = await pool.query(`
          SELECT
            lot.LotReceiveID AS ReceiveID,
            lot.InternalLot,
            lot.ProviderLot,
            lot.Quantity
          FROM SHIPPING_RECEIVING_LOTS lot
          LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL detail ON detail.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
          LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
          WHERE item.PartNumber = ? AND lot.Quantity > 0
          ORDER BY lot.RegDate DESC
          LIMIT 50
        `, [String(lotMeta.PartNumber || '')]);

        return res.status(409).json({
          message: 'El lote indicado no tiene cantidad disponible en Storage.',
          selectedSourceLocationId: normalizedSourceLocationId,
          availableRacks: racks,
          lotsInStorage: lotsInStorage.map(l => ({ ReceiveID: l.ReceiveID, InternalLot: l.InternalLot, ProviderLot: l.ProviderLot, Quantity: l.Quantity })),
        });
      }
    }

    if (normalizedSourceLocationId && resolvedLotInventoryId !== null) {
      const [lotInvRows] = await pool.query(`
        SELECT CurrentLocationID, CurrentQuantity
        FROM MES_LOT_INVENTORY
        WHERE LotInventoryID = ?
        LIMIT 1
      `, [resolvedLotInventoryId]);

      const lotInvRow = lotInvRows[0];
      if (!lotInvRow || lotInvRow.CurrentLocationID == null || Number(lotInvRow.CurrentQuantity || 0) <= 0) {
        return res.status(409).json({
          message: 'El lote indicado no tiene stock en la ubicación de origen seleccionada.',
          selectedSourceLocationId: normalizedSourceLocationId,
        });
      }

      if (Number(lotInvRow.CurrentLocationID) !== normalizedSourceLocationId) {
        return res.status(409).json({
          message: 'El lote indicado no está en la ubicación de origen seleccionada.',
          selectedSourceLocationId: normalizedSourceLocationId,
          lotCurrentLocationId: Number(lotInvRow.CurrentLocationID),
        });
      }
    } else if (normalizedSourceLocationId) {
        const [invRows] = await pool.query(`
          SELECT 1
          FROM MES_INVENTORY inv
          LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
          LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
          WHERE inv.PartNumber = ? AND plant.LocationID = ?
          LIMIT 1
        `, [String(lotMeta.PartNumber || ''), normalizedSourceLocationId]);
      if (!invRows[0]) {
          // If the requested rack doesn't contain the lot, return helpful details so the UI can explain
          const [racks] = await pool.query(`
            SELECT
              inv.RackLocationID AS StorageID,
              storage.RackName,
              plant.LocationName,
              inv.Quantity
            FROM MES_INVENTORY inv
            LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
            LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
            WHERE inv.PartNumber = ? AND inv.Quantity > 0
            ORDER BY inv.Quantity DESC
            LIMIT 10
          `, [String(lotMeta.PartNumber || '')]);

          const [lotsInStorage] = await pool.query(`
            SELECT
              lot.LotReceiveID AS ReceiveID,
              lot.InternalLot,
              lot.ProviderLot
            FROM SHIPPING_RECEIVING_LOTS lot
            LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL detail ON detail.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
            LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
            WHERE item.PartNumber = ?
            ORDER BY lot.RegDate DESC
            LIMIT 50
          `, [String(lotMeta.PartNumber || '')]);

          return res.status(409).json({
            message: 'El lote indicado no tiene stock en la ubicación de origen seleccionada.',
            selectedSourceLocationId: normalizedSourceLocationId,
            availableRacks: racks,
            lotsInStorage: lotsInStorage.map(l => ({ ReceiveID: l.ReceiveID, InternalLot: l.InternalLot, ProviderLot: l.ProviderLot })),
          });
      }
    } else {
      const candidateStorageId = await findStorageLocationForPart(lotMeta.PartNumber);
      if (candidateStorageId) {
          // map StorageID -> Plant LocationID so SourceLocationID references PLANT_LOCATIONS
          const [storageRows] = await pool.query(`SELECT LocationID FROM STORAGE_LOCATIONS WHERE StorageID = ? LIMIT 1`, [candidateStorageId]);
          if (storageRows[0] && storageRows[0].LocationID) {
            normalizedSourceLocationId = Number(storageRows[0].LocationID);
          } else {
            normalizedSourceLocationId = Number(candidateStorageId);
          }
      } else {
        const [invRows] = await pool.query(`
          SELECT 1
          FROM MES_INVENTORY inv
          LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
          LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
          WHERE inv.PartNumber = ?
            AND (
              LOWER(plant.LocationName) LIKE '%stor%'
              OR LOWER(plant.LocationName) LIKE '%almac%'
            )
          LIMIT 1
        `, [String(lotMeta.PartNumber || '')]);
        if (!invRows[0]) {
          // Provide helpful context: which racks have the part and which lots exist for that part
          const [racks] = await pool.query(`
            SELECT
              inv.RackLocationID AS StorageID,
              storage.RackName,
              plant.LocationName,
              inv.Quantity
            FROM MES_INVENTORY inv
            LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
            LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
            WHERE inv.PartNumber = ? AND inv.Quantity > 0
            ORDER BY inv.Quantity DESC
            LIMIT 10
          `, [String(lotMeta.PartNumber || '')]);

          const [lotsInStorage] = await pool.query(`
            SELECT
              lot.LotReceiveID AS ReceiveID,
              lot.InternalLot,
              lot.ProviderLot
            FROM SHIPPING_RECEIVING_LOTS lot
            LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL detail ON detail.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
            LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
            WHERE item.PartNumber = ?
            ORDER BY lot.RegDate DESC
            LIMIT 50
          `, [String(lotMeta.PartNumber || '')]);

          return res.status(409).json({
            message: 'El lote indicado no tiene stock en Storage.',
            availableRacks: racks,
            lotsInStorage: lotsInStorage.map(l => ({ ReceiveID: l.ReceiveID, InternalLot: l.InternalLot, ProviderLot: l.ProviderLot })),
          });
        }
      }
    }
  }

  if (isTransfer && (!normalizedSourceLocationId || !normalizedDestinationLocationId)) {
    return res.status(400).json({ message: "Una transferencia requiere ubicación de origen y destino." });
  }

  // El ERP valida el request_id releyendo la fila desde la misma base de datos con su
  // propia conexión, así que el INSERT debe quedar comprometido (COMMIT) ANTES de
  // llamarlo — de lo contrario el ERP no puede ver una fila todavía no confirmada y
  // responde "No existe la solicitud". Por eso aquí no se usa una transacción local:
  // se inserta ya confirmado y, si el ERP rechaza, se revierte con un DELETE
  // compensatorio en vez de un ROLLBACK.
  const [insertResult] = await pool.query(`
    INSERT INTO INVENTORY_REQUESTS (
      RequestStatusID, RequestTypeID, PartNumber, Quantity,
      RegUserID, ConfirmUserID, SourceLocationID, DestinationLocationID, LotInventoryID
    ) VALUES (40, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    parsedTypeId,
    normalizedPartNumber,
    parsedQty,
    parsedRegUserId,
    parsedRegUserId,
    normalizedSourceLocationId,
    normalizedDestinationLocationId,
    resolvedLotInventoryId !== null ? resolvedLotInventoryId : null,
  ]);

  const requestId = insertResult.insertId;
  let erpResult = null;

  if (isTransfer) {
    erpResult = await erpClient.createStockEntry(requestId);
    if (!erpResult.ok) {
      await pool.query("DELETE FROM INVENTORY_REQUESTS WHERE RequestID = ?", [requestId]);
      return res.status(502).json({
        message: `La solicitud no se creó porque el MES Web la rechazó: ${erpResult.message}`,
        erp: erpResult,
      });
    }
  }

  res.status(201).json({
    ok: true,
    requestId,
    erp: erpResult
      ? { stockEntry: erpResult.data?.stock_entry, stockEntryType: erpResult.data?.stock_entry_type, message: erpResult.message }
      : null,
    message: isTransfer
      ? `Solicitud #${requestId} creada y sincronizada con el MES Web correctamente.`
      : `Solicitud #${requestId} creada correctamente.`,
  });
}));

app.put("/api/requests/:id(\\d+)", asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId)) {
    return res.status(400).json({ message: "Identificador de solicitud inválido." });
  }

  const { PartNumber, Quantity, SourceLocationID, DestinationLocationID } = req.body || {};

  const [existingRows] = await pool.query("SELECT * FROM INVENTORY_REQUESTS WHERE RequestID = ?", [requestId]);
  const existing = existingRows[0];
  if (!existing) {
    return res.status(404).json({ message: "La solicitud no existe." });
  }
  if (Number(existing.RequestStatusID) !== 40) {
    return res.status(409).json({ message: "Solo se pueden editar solicitudes en estado DRAFT (pendiente)." });
  }

  const normalizedPartNumber = PartNumber ? String(PartNumber).trim() : String(existing.PartNumber);
  const parsedQty = Quantity !== undefined && Quantity !== null && Quantity !== '' ? Number(Quantity) : Number(existing.Quantity);
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    return res.status(400).json({ message: "La cantidad debe ser mayor a cero." });
  }
  const normalizedSourceLocationId = SourceLocationID !== undefined
    ? (SourceLocationID ? Number(SourceLocationID) : null)
    : existing.SourceLocationID;
  const normalizedDestinationLocationId = DestinationLocationID !== undefined
    ? (DestinationLocationID ? Number(DestinationLocationID) : null)
    : existing.DestinationLocationID;

  const isTransfer = Number(existing.RequestTypeID) === 2;
  if (isTransfer && (!normalizedSourceLocationId || !normalizedDestinationLocationId)) {
    return res.status(400).json({ message: "Una transferencia requiere ubicación de origen y destino." });
  }

  // Mismo motivo que en la creación: el ERP relee la fila con su propia conexión para
  // sincronizar material/cantidad/ubicaciones, así que el UPDATE debe quedar
  // comprometido antes de llamarlo. Si el ERP rechaza, se revierte con un UPDATE
  // compensatorio a los valores previos en vez de un ROLLBACK transaccional.
  const [updateResult] = await pool.query(`
    UPDATE INVENTORY_REQUESTS
    SET PartNumber = ?, Quantity = ?, SourceLocationID = ?, DestinationLocationID = ?
    WHERE RequestID = ? AND RequestStatusID = 40
  `, [normalizedPartNumber, parsedQty, normalizedSourceLocationId, normalizedDestinationLocationId, requestId]);

  if (updateResult.affectedRows === 0) {
    return res.status(409).json({ message: "La solicitud ya no está en estado DRAFT; no se puede actualizar." });
  }

  let erpResult = null;
  if (isTransfer) {
    erpResult = await erpClient.updateStockEntry(requestId);
    if (!erpResult.ok) {
      await pool.query(`
        UPDATE INVENTORY_REQUESTS
        SET PartNumber = ?, Quantity = ?, SourceLocationID = ?, DestinationLocationID = ?
        WHERE RequestID = ?
      `, [existing.PartNumber, existing.Quantity, existing.SourceLocationID, existing.DestinationLocationID, requestId]);
      return res.status(502).json({
        message: `No se actualizó la solicitud porque el ERP la rechazó: ${erpResult.message}`,
        erp: erpResult,
      });
    }
  }

  res.json({
    ok: true,
    requestId,
    erp: erpResult ? { stockEntry: erpResult.data?.stock_entry, message: erpResult.message } : null,
    message: "Solicitud actualizada correctamente.",
  });
}));

const handleExecuteTransfer = asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId)) {
    return res.status(400).json({ message: "Identificador de solicitud inválido." });
  }

  const { destinationStorageId, destinationLocationId, quantity, regUserId, comments } = req.body || {};
  const parsedDestinationLocationId = destinationLocationId != null ? Number(destinationLocationId) : null;
  const parsedQty = Number(quantity);
  const parsedUserId = regUserId ? Number(regUserId) : null;

  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    return res.status(400).json({ message: "La cantidad debe ser mayor a cero." });
  }

  const [requestRows] = await pool.query("SELECT * FROM INVENTORY_REQUESTS WHERE RequestID = ?", [requestId]);
  const requestRow = requestRows[0];
  if (!requestRow) {
    return res.status(404).json({ message: "La solicitud no existe." });
  }
  if (![2, 3, 6, 12].includes(Number(requestRow.RequestTypeID))) {
    return res.status(409).json({ message: "Esta operación solo aplica a solicitudes de Transferencia, Consumo, Transferencia parcial o Scrap." });
  }
  const allowedStatuses = new Set([41, 42]);
  if (!allowedStatuses.has(Number(requestRow.RequestStatusID))) {
    return res.status(409).json({ message: "La solicitud debe estar aprobada o confirmada antes de ejecutar la transferencia." });
  }

  const effectiveDestinationLocationId = Number(requestRow.DestinationLocationID || parsedDestinationLocationId || null) || null;
  const isQuarantineDestination = effectiveDestinationLocationId != null
    ? await (async () => {
        const [locationRows] = await pool.query(
          "SELECT LocationName FROM PLANT_LOCATIONS WHERE LocationID = ? LIMIT 1",
          [effectiveDestinationLocationId]
        );
        const locationName = String(locationRows[0]?.LocationName || '').toLowerCase();
        return [
          'quarantine',
          'quarentine',
          'purg',
          'cuarentena',
          'purgue',
        ].some((token) => locationName.includes(token));
      })()
    : false;

  if (effectiveDestinationLocationId == null) {
    return res.status(400).json({ message: "Debe seleccionar una ubicación de destino válida." });
  }

  const partNumber = String(requestRow.PartNumber || '');
  const requestTypeId = Number(requestRow.RequestTypeID);
  const sourceLocationId = requestRow.SourceLocationID ? Number(requestRow.SourceLocationID) : null;

  let storage = null;
  let lotInternalLot = null;
  let movementId = null;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (!requestRow.LotInventoryID) {
      await connection.rollback();
      return res.status(400).json({ message: 'La solicitud no tiene un lote de inventario asociado.' });
    }

    const [lotRows] = await connection.query(
      'SELECT LotInventoryID, CurrentQuantity, CurrentLocationID, CurrentInternalLot FROM MES_LOT_INVENTORY WHERE LotInventoryID = ? FOR UPDATE',
      [requestRow.LotInventoryID]
    );
    const lotRow = lotRows[0];
    if (!lotRow) {
      await connection.rollback();
      return res.status(404).json({ message: 'El lote de inventario asociado no fue encontrado.' });
    }
    lotInternalLot = lotRow.CurrentInternalLot || null;

    storage = await getStorageFromLot(
      connection,
      requestId
    );

    const lotCurrentQuantity = Number(lotRow.CurrentQuantity || 0);
    if (lotCurrentQuantity <= 0) {
      await connection.rollback();
      return res.status(409).json({ message: 'El lote no tiene cantidad disponible para transferir.' });
    }

    const shouldValidateSourceLocation = !(requestTypeId === 6 && isQuarantineDestination);
    if (shouldValidateSourceLocation && sourceLocationId !== null && lotRow.CurrentLocationID != null && Number(lotRow.CurrentLocationID) !== sourceLocationId) {
      await connection.rollback();
      return res.status(409).json({ message: 'El lote no está en la ubicación de origen indicada en la solicitud.' });
    }

    let destinationLocationId = effectiveDestinationLocationId;

    if (destinationLocationId == null) {
      await connection.rollback();
      return res.status(400).json({ message: 'No se pudo determinar una ubicación de destino para la transferencia.' });
    }

    const isPartialOutbound = [3, 12].includes(requestTypeId);
    if (!isPartialOutbound) {
      await connection.query(
        'UPDATE MES_LOT_INVENTORY SET CurrentLocationID = ? WHERE LotInventoryID = ?',
        [destinationLocationId, requestRow.LotInventoryID]
      );
    }

    const normalizedComments = comments ? String(comments).trim() : null;

    // NOTA: ya NO insertamos aquí en INVENTORY_MOVEMENTS_HISTORY.
    // upsertInventoryFromLot es ahora la única fuente del registro de movimiento,
    // para evitar la doble inserción (una manual + una dentro de la función).

    await connection.query(
      'UPDATE INVENTORY_REQUESTS SET RequestStatusID = 42, ConfirmUserID = ?, SubmitDate = NOW() WHERE RequestID = ?',
      [parsedUserId || requestRow.RegUserID, requestId]
    );

    if (shouldApplyInventoryUpdate(42, requestTypeId, Number(requestRow.LotInventoryID))) {
      const upsertResult = await upsertInventoryFromLot(connection, {
        requestId,
        lotInventoryId: requestRow.LotInventoryID,
        partNumber: partNumber,
        quantity: parsedQty,
        sourceLocationId,
        destinationLocationId: destinationLocationId,
        userId: parsedUserId || requestRow.RegUserID,
        comments: normalizedComments || 'Transferencia confirmada',
        requestStatusId: 42,
        requestTypeId,
      });
      movementId = upsertResult?.movementId ?? null;
    }

    // Commit de todos los cambios locales ANTES de tocar el ERP. El ERP
    // escribe esta misma fila (INVENTORY_REQUESTS) con su propia conexión;
    // si lo llamáramos con esta transacción todavía abierta, su UPDATE
    // quedaría bloqueado esperando a que soltemos el lock que esta misma
    // llamada HTTP necesita para regresar -> interbloqueo.
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error(
      `[transfer] ERROR requestId=${requestId}:`,
      {
        message: error.message,
        code: error.code,
        sqlMessage: error.sqlMessage,
        sql: error.sql,
      }
    );
    throw error;
  } finally {
    connection.release();
  }

  /*
   * =====================================================
   * SINCRONIZACIÓN CON ERP (retiro de rack + confirmación del movimiento)
   * =====================================================
   * MES_DB ya quedó comprometido con RequestStatusID = 42. Si cualquiera
   * de las dos llamadas ERP falla, se revierte todo con una transacción
   * de compensación nueva (reverseSubmittedMovement), dejando la solicitud
   * de vuelta en 41 sin cambios parciales.
   */
  let erpWithdrawResult = null;
  let erpSubmitResult = null;

  try {
    if (storage) {
      const erpResponse = await fetch(
        process.env.ERP_WITHDRAW_MATERIAL_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `token ${process.env.ERP_API_TOKEN}`,
          },
          body: JSON.stringify({
            mes_storage_id: Number(storage.StorageID),
            item_code: String(storage.PartNumber),
            batch: String(storage.CurrentInternalLot || ''),
            quantity: parsedQty,
          }),
        }
      );

      erpWithdrawResult = await erpResponse.json();
      if (!erpResponse.ok) {
        throw Object.assign(new Error('withdraw_rejected'), { erpDetail: erpWithdrawResult });
      }
    }

    erpSubmitResult = await erpClient.submitEntryForRequestType({
      requestId,
      requestTypeId,
      qty: parsedQty,
      batchNo: lotInternalLot || undefined,
    });

    if (!erpSubmitResult.ok) {
      throw Object.assign(new Error('submit_rejected'), { erpDetail: erpSubmitResult });
    }
  } catch (erpError) {
    console.error(`[transfer] MES Web rechazó la operación para requestId=${requestId}:`, erpError.erpDetail || erpError);

    const compConnection = await pool.getConnection();
    let compensation = { reversed: false, reason: 'not_attempted' };
    try {
      await compConnection.beginTransaction();
      compensation = await reverseSubmittedMovement(compConnection, {
        requestId,
        requestTypeId,
        lotInventoryId: requestRow.LotInventoryID,
        sourceLocationId,
      });
      if (compensation.reversed) {
        await compConnection.query(
          "UPDATE INVENTORY_REQUESTS SET RequestStatusID = 41, SubmitDate = NULL WHERE RequestID = ?",
          [requestId]
        );
      }
      await compConnection.commit();
    } catch (compensationError) {
      await compConnection.rollback().catch(() => {});
      console.error(`[transfer] Falló la reversión compensatoria para requestId=${requestId}:`, compensationError);
      compensation = { reversed: false, reason: 'compensation_failed' };
    } finally {
      compConnection.release();
    }

    console.error(`[transfer] requestId=${requestId} revertido=${compensation.reversed} razon=${compensation.reason || 'n/a'}`);
    return res.status(502).json({ message: 'No se pudo completar la operación, intenta de nuevo.' });
  }

  console.log(`[transfer] requestId=${requestId} statusAfter=42`);

  res.json({
    ok: true,
    movementId,
    quantity: parsedQty,
    erpWithdraw: erpWithdrawResult,
    erpSubmit: erpSubmitResult.data,
    message: "Transferencia confirmada correctamente.",
  });
});

app.post("/api/requests/:id(\\d+)/execute-transfer", handleExecuteTransfer);

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
    const [outboundRows] = await pool.query(`
      SELECT
        ship.ShipmentID AS id,
        ship.ShipmentNumber,
        ship.CustomerID,
        ship.ShipmentDate AS createdAt,
        ship.CreatedDate,
        ship.ClosedDate,
        COALESCE(SUM(detail.ScannQty), 0) AS quantity,
        status.StatusDescription AS statusDescription
      FROM PART_SHIPPING ship
      LEFT JOIN PART_SHIPPING_DETAIL detail ON detail.ShipmentID = ship.ShipmentID
      LEFT JOIN MES_STATUS status ON status.StatusID = ship.StatusID
      GROUP BY ship.ShipmentID
      ORDER BY ship.CreatedDate DESC
      LIMIT ?
    `, [limit]);

    if (Array.isArray(outboundRows) && outboundRows.length > 0) {
      activities.push(...outboundRows.map((row) => ({
        id: `outbound-${row.id}`,
        type: 'outbound',
        ref: row.ShipmentNumber || `OUT-${row.id}`,
        provider: row.CustomerID || 'Cliente',
        receiver: 'Sin receptor',
        createdAt: row.CreatedDate || row.createdAt,
        receivedAt: row.createdAt || row.CreatedDate,
        updatedAt: row.ClosedDate || row.CreatedDate,
        description: row.statusDescription || 'Salida',
        quantity: Number(row.quantity || 0),
        timestamp: row.createdAt || row.CreatedDate || new Date().toISOString(),
      })));
    }
  } catch (err) {
    console.warn('[api] Error en órdenes de salida:', err.message);
  }

  try {
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
        source.LocationName AS SourceLocationName,
        dest.LocationName AS DestinationLocationName
      FROM INVENTORY_MOVEMENTS_HISTORY mv
      LEFT JOIN USERS_MES reg ON reg.UserID = mv.RegUserID
      LEFT JOIN PLANT_LOCATIONS source ON source.LocationID = mv.SourceLocationID
      LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = mv.DestinationLocationID
      WHERE mv.NewInternalLot = 'TRANSFER'
      ORDER BY mv.RegDate DESC
      LIMIT ?
    `, [limit]);

    if (Array.isArray(transferRows) && transferRows.length > 0) {
      activities.push(...transferRows.map((row) => ({
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
        timestamp: row.createdAt || row.updatedAt || new Date().toISOString(),
      })));
    }
  } catch (err) {
    console.warn('[api] Error en transferencias:', err.message);
  }

  try {
    const sql = `
          SELECT
            req.RequestID AS id,
            req.RequestStatusID,
            status.StatusDescription AS status,
            type.RequestType AS requestType,
            req.RequestTypeID,
            req.PartNumber,
            item.PartName,
            req.Quantity,
            req.SourceLocationID,
            req.DestinationLocationID,
            req.LotInventoryID,
            req.SubmitDate AS timestamp,
            req.SubmitDate AS createdAt,
            req.SubmitDate AS receivedAt,
            req.SubmitDate AS updatedAt,
            COALESCE(req.RequestName, 'Ajuste de inventario') AS description,
            src.LocationName AS SourceLocationName,
            dest.LocationName AS DestinationLocationName
          FROM INVENTORY_REQUESTS req
          LEFT JOIN MES_STATUS status ON status.StatusID = req.RequestStatusID
          LEFT JOIN INVENTORY_REQUEST_TYPES type ON type.RequestID = req.RequestTypeID
          LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = req.PartNumber
          LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID
          LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
          WHERE req.RequestStatusID = 41
            AND (
              type.RequestType LIKE '%ajuste%'
              OR type.RequestDescription LIKE '%ajuste%'
              OR type.RequestType LIKE '%adjustment%'
              OR type.RequestDescription LIKE '%adjustment%'
            )
          ORDER BY req.SubmitDate DESC
          LIMIT ?
        `;
    const [rows] = await pool.query(sql, [limit]);
    const adjustmentRows = rows;

    if (Array.isArray(adjustmentRows) && adjustmentRows.length > 0) {
      activities.push(...adjustmentRows.map((row) => ({
        id: `adjustment-${row.id}`,
        type: 'adjustment',
        ref: `ADJ-${row.id}`,
        provider: row.requestType || 'Ajuste',
        receiver: row.PartName || 'Ajuste de inventario',
        createdAt: row.createdAt,
        receivedAt: row.receivedAt,
        updatedAt: row.updatedAt,
        status: row.status || 'Aprobado',
        description: row.description || `Ajuste de inventario ${row.requestType}`,
        quantity: Number(row.Quantity || 0),
        locationName: [row.SourceLocationName, row.DestinationLocationName].filter(Boolean).join(' → '),
        partNumber: row.PartNumber,
      })));
    }
  } catch (err) {
    console.warn('[api] Error en ajustes:', err.message);
  }

  try {
    const [cyclicRows] = await pool.query(`
      SELECT
        cc.CycleCountID AS id,
        cc.LocationID,
        cc.StatusID,
        cc.PackCount,
        cc.InventoryID,
        sl.RackName,
        sl.RackColumn,
        sl.RackCell,
        status.StatusCode,
        status.StatusDescription AS status,
        COUNT(mi.InventoryID) AS itemCount,
        COALESCE(SUM(COALESCE(mi.Quantity, 0)), 0) AS currentQuantity,
        cc.PackCount AS packCount,
        NOW() AS createdAt
      FROM MES_CYCLE_COUNTING cc
      LEFT JOIN STORAGE_LOCATIONS sl ON sl.StorageID = cc.LocationID
      LEFT JOIN MES_STATUS status ON status.StatusID = cc.StatusID
      LEFT JOIN MES_INVENTORY mi ON mi.RackLocationID = cc.LocationID
      GROUP BY cc.CycleCountID
      ORDER BY cc.CycleCountID DESC
      LIMIT ?
    `, [limit]);

    if (Array.isArray(cyclicRows) && cyclicRows.length > 0) {
      activities.push(...cyclicRows.map((row) => ({
        id: `cyclic-${row.id}`,
        type: 'cyclic',
        ref: `${row.RackName || 'Rack'}-${row.RackColumn || 0}-${row.RackCell || 0}`,
        provider: row.status || 'Conteo cíclico',
        receiver: 'Conteo cíclico',
        createdAt: row.createdAt,
        receivedAt: row.createdAt,
        updatedAt: row.createdAt,
        description: `Conteo cíclico en ${row.RackName || 'Rack'} ${row.RackColumn || 0}-${row.RackCell || 0}`,
        quantity: Number(row.currentQuantity || 0),
        status: row.status || 'Pendiente',
        timestamp: row.createdAt || new Date().toISOString(),
      })));
    }
  } catch (err) {
    console.warn('[api] Error en conteos cíclicos:', err.message);
  }

  try {
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
        location.LocationName AS LocationName
      FROM MES_SCRAP_AND_DISCREPANCIES scrap
      LEFT JOIN USERS_MES reg ON reg.UserID = scrap.RegUserID
      LEFT JOIN PLANT_LOCATIONS location ON location.LocationID = scrap.LocationID
      ORDER BY scrap.SADID DESC
      LIMIT ?
    `, [limit]);

    if (Array.isArray(scrapRows) && scrapRows.length > 0) {
      activities.push(...scrapRows.map((row) => ({
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
        timestamp: row.createdAt || new Date().toISOString(),
      })));
    }
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

app.get('/api/notifications', asyncRoute(async (req, res) => {
  const limit = getLimit(req.query.limit, 50);

  const [receiptRows] = await pool.query(`
    SELECT
      pr.PurchaseReceiptID AS id,
      pr.PurchaseOrderID,
      po.PONumber AS poNumber,
      COALESCE(provider.ProviderName, 'Proveedor desconocido') AS providerName,
      pr.CreateDate AS timestamp,
      pr.ReceiptDate,
      pr.UpdateDate,
      COALESCE(u.FirstName, '') AS firstName,
      COALESCE(u.LastName, '') AS lastName,
      COALESCE(status.StatusDescription, status.StatusCode, 'Pendiente') AS status,
      COALESCE(SUM(prd.AcceptedQty), 0) AS acceptedQty,
      COALESCE(SUM(prd.RejectedQty), 0) AS rejectedQty,
      COUNT(prd.PurchaseReceiptDetailID) AS detailCount
    FROM ERP_PURCHASE_RECEIPT pr
    LEFT JOIN ERP_PURCHASE_ORDER po ON po.PurchaseOrderID = pr.PurchaseOrderID
    LEFT JOIN PROVIDERS_MES provider ON provider.ProviderID = po.ProviderID
    LEFT JOIN USERS_MES u ON u.UserID = pr.ReceivedBy
    LEFT JOIN MES_STATUS status ON status.StatusID = pr.OrderStatusID
    LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL prd ON prd.PurchaseReceiptID = pr.PurchaseReceiptID
    GROUP BY pr.PurchaseReceiptID
    ORDER BY pr.CreateDate DESC
    LIMIT ?
  `, [limit]);

  const [movementRows] = await pool.query(`
    SELECT
      mv.MovementID AS id,
      mv.PartNumber,
      item.PartName,
      mv.Quantity,
      mv.RegDate AS timestamp,
      mv.Comments,
      mv.NewInternalLot,
      mv.OriginalInternalLot,
      mv.MovementTypeID,
      source.LocationName AS sourceLocationName,
      dest.LocationName AS destinationLocationName
    FROM INVENTORY_MOVEMENTS_HISTORY mv
    LEFT JOIN MES_MASTER_ITEMS item ON item.PartNumber = mv.PartNumber
    LEFT JOIN PLANT_LOCATIONS source ON source.LocationID = mv.SourceLocationID
    LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = mv.DestinationLocationID
    ORDER BY mv.RegDate DESC
    LIMIT ?
  `, [limit]);

  const normalizeLocation = (value) => String(value || '').toLowerCase();
  const isIncomingLocation = (value) => normalizeLocation(value).includes('incoming');

  const notifications = [];

  notifications.push(...receiptRows.map((row) => ({
    id: `inbound-${row.id}`,
    type: 'inbound',
    title: `Entrada registrada ${row.poNumber || `REC-${row.id}`}`,
    message: `Recepción de ${row.providerName}. Aceptadas: ${row.acceptedQty}, rechazadas: ${row.rejectedQty}`,
    timestamp: row.timestamp || row.ReceiptDate || new Date(),
    status: row.status,
    reference: row.poNumber || `REC-${row.id}`,
    details: {
      provider: row.providerName,
      acceptedQty: Number(row.acceptedQty || 0),
      rejectedQty: Number(row.rejectedQty || 0),
      detailCount: Number(row.detailCount || 0),
    },
    incoming: true,
  })));

  notifications.push(...movementRows.map((row) => {
    const incoming = isIncomingLocation(row.sourceLocationName) || isIncomingLocation(row.destinationLocationName);
    const title = incoming
      ? `Movimiento incoming ${row.PartNumber}`
      : `Movimiento ${row.PartNumber}`;
    const direction = row.sourceLocationName || row.destinationLocationName
      ? `${row.sourceLocationName || 'Sin origen'} → ${row.destinationLocationName || 'Sin destino'}`
      : 'Ubicación desconocida';

    return {
      id: `movement-${row.id}`,
      type: 'movement',
      title,
      message: `${direction}. Cantidad: ${row.Quantity || 0}.${row.Comments ? ` ${row.Comments}` : ''}`,
      timestamp: row.timestamp || new Date(),
      status: row.NewInternalLot || 'MOVIMIENTO',
      reference: row.PartNumber,
      details: {
        partNumber: row.PartNumber,
        partName: row.PartName,
        quantity: Number(row.Quantity || 0),
        sourceLocation: row.sourceLocationName,
        destinationLocation: row.destinationLocationName,
      },
      incoming,
    };
  }));

  notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json({
    notifications: notifications.slice(0, limit),
    total: notifications.length,
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
      // If the error indicates a missing table, suppress the noisy warning
      const code = err && err.code ? String(err.code) : '';
      const msg = err && err.message ? String(err.message) : '';
      if (code === 'ER_NO_SUCH_TABLE' || /doesn'?t exist/i.test(msg) || /Unknown table/i.test(msg)) {
        return [];
      }
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

// ERPNext Endpoints
app.post(
  "/api/erp/create-stock-entry",
  asyncRoute(async (req, res) => {
    const requestId = Number(req.body?.request_id);
    let requestTypeId = Number(req.body?.request_type_id);

    if (!Number.isInteger(requestId)) {
      return res.status(400).json({
        message: "El identificador de la solicitud es requerido.",
      });
    }

    // El frontend no siempre manda request_type_id (p.ej. al entrar a una solicitud
    // por URL directa sin pasar por la lista que lo trae). En vez de fallar, lo
    // resolvemos desde MES_DB con el request_id, que siempre es la fuente de verdad.
    if (!Number.isInteger(requestTypeId)) {
      const [typeRows] = await pool.query("SELECT RequestTypeID FROM INVENTORY_REQUESTS WHERE RequestID = ?", [requestId]);
      if (!typeRows[0]) {
        return res.status(404).json({ message: `La solicitud #${requestId} no existe.` });
      }
      requestTypeId = Number(typeRows[0].RequestTypeID);
      console.warn(`[erp/create-stock-entry] request_type_id no vino en el body para requestId=${requestId}; se resolvió desde MES_DB como ${requestTypeId}.`);
    }

    const erpResult = await erpClient.createEntryForRequestType(requestId, requestTypeId);

    if (erpResult.ok) {
      return res.json({ ok: true, erp: erpResult.data, message: erpResult.message });
    }

    // Solo revertimos si la solicitud sigue en DRAFT (40): si ya avanzó por otro medio
    // mientras esperábamos al ERP, borrarla destruiría trabajo válido de otro usuario.
    const [deleteResult] = await pool.query(
      "DELETE FROM INVENTORY_REQUESTS WHERE RequestID = ? AND RequestStatusID = 40",
      [requestId]
    );
    const rolledBack = deleteResult.affectedRows > 0;

    console.error(`[erp/create-stock-entry] ERP rechazó requestId=${requestId}: ${erpResult.message}. rolledBack=${rolledBack}`);

    return res.status(502).json({
      message: rolledBack
        ? `El MES Web rechazó la solicitud; el registro #${requestId} en MES_DB fue eliminado.`
        : `El MES Web rechazó la solicitud y el registro #${requestId} ya no estaba en DRAFT, por lo que no se eliminó automáticamente. Requiere revisión manual.`,
      erp: erpResult,
      rolledBack,
    });
  })
);

app.put(
  "/api/erp/submit-stock-entry",
  asyncRoute(async (req, res) => {
    const requestId = Number(req.body?.request_id);
    let requestTypeId = Number(req.body?.request_type_id);
    const qty = Number(req.body?.qty);
    const batchNo = req.body?.batch_no;

    if (!Number.isInteger(requestId) || !Number.isFinite(qty) || qty <= 0 || !batchNo) {
      return res.status(400).json({
        message: "El identificador de la solicitud, la cantidad y el lote son requeridos.",
      });
    }

    if (!Number.isInteger(requestTypeId)) {
      const [typeRows] = await pool.query("SELECT RequestTypeID FROM INVENTORY_REQUESTS WHERE RequestID = ?", [requestId]);
      if (!typeRows[0]) {
        return res.status(404).json({ message: `La solicitud #${requestId} no existe.` });
      }
      requestTypeId = Number(typeRows[0].RequestTypeID);
      console.warn(`[erp/submit-stock-entry] request_type_id no vino en el body para requestId=${requestId}; se resolvió desde MES_DB como ${requestTypeId}.`);
    }

    const erpResult = await erpClient.submitEntryForRequestType({ requestId, requestTypeId, qty, batchNo });

    if (erpResult.ok) {
      return res.json({ ok: true, erp: erpResult.data, message: erpResult.message });
    }

    console.error(`[erp/submit-stock-entry] ERP rechazó requestId=${requestId}: ${erpResult.message}`);

    const connection = await pool.getConnection();
    let compensation = { reversed: false, reason: 'not_attempted' };
    try {
      await connection.beginTransaction();

      const [requestRows] = await connection.query(
        "SELECT RequestID, RequestTypeID, RequestStatusID, LotInventoryID, SourceLocationID FROM INVENTORY_REQUESTS WHERE RequestID = ? FOR UPDATE",
        [requestId]
      );
      const requestRow = requestRows[0];

      // Solo revertimos si la solicitud sigue exactamente en el estado que dejó la
      // ejecución (42): si algo más ya la movió, no adivinamos y dejamos la reversión
      // para revisión manual en vez de arriesgar corromper inventario real.
      if (requestRow && Number(requestRow.RequestStatusID) === 42) {
        compensation = await reverseSubmittedMovement(connection, {
          requestId,
          requestTypeId: requestRow.RequestTypeID,
          lotInventoryId: requestRow.LotInventoryID,
          sourceLocationId: requestRow.SourceLocationID,
        });

        if (compensation.reversed) {
          await connection.query(
            "UPDATE INVENTORY_REQUESTS SET RequestStatusID = 41, SubmitDate = NULL WHERE RequestID = ?",
            [requestId]
          );
        }
      } else {
        compensation = { reversed: false, reason: requestRow ? 'unexpected_status' : 'request_not_found' };
      }

      await connection.commit();
    } catch (compensationError) {
      await connection.rollback().catch(() => {});
      console.error(`[erp/submit-stock-entry] Falló la reversión compensatoria para requestId=${requestId}:`, compensationError);
      compensation = { reversed: false, reason: 'compensation_failed' };
    } finally {
      connection.release();
    }

    return res.status(502).json({
      message: compensation.reversed
        ? `El MES Web rechazó la confirmación; el movimiento de la solicitud #${requestId} en MES_DB fue revertido.`
        : `El MES Web rechazó la confirmación y no se pudo revertir automáticamente el movimiento de la solicitud #${requestId} (${compensation.reason}). Requiere revisión manual.`,
      erp: erpResult,
      rolledBack: compensation.reversed,
    });
  })
)

app.use((_req, res) => {
  res.status(404).json({ message: "Ruta no encontrada" });
});

app.listen(port, host, () => {
  console.log(`[api] Servidor listo en http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api`);
  console.log(`[api] Escuchando en ${host}:${port}`);
  console.log("[api] Modo mixto: GET habilitado en todo /api; escrituras solo en endpoints de la allowlist (ver GET /api/modules)");
});

