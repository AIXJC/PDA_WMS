import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath, override: true });

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});

const [rows] = await conn.query(`
  SELECT
    req.RequestID,
    req.RequestStatusID,
    req.RequestTypeID,
    type.RequestType,
    type.RequestDescription,
    req.PartNumber,
    req.Quantity,
    req.LotInventoryID,
    req.SourceLocationID,
    req.DestinationLocationID,
    src.LocationName AS SourceLocationName,
    dest.LocationName AS DestinationLocationName,
    li.LotReceiveID,
    li.CurrentLocationID,
    li.CurrentInternalLot,
    li.CurrentQuantity,
    li.ProviderLot,
    li.InternalLot,
    li.ShortInternalLot,
    req.RequestName
  FROM INVENTORY_REQUESTS req
  LEFT JOIN INVENTORY_REQUEST_TYPES type ON type.RequestID = req.RequestTypeID
  LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID
  LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
  LEFT JOIN MES_LOT_INVENTORY li ON li.LotInventoryID = req.LotInventoryID
  WHERE req.RequestID = 171
  LIMIT 1
`);

console.log(JSON.stringify(rows, null, 2));
await conn.end();
