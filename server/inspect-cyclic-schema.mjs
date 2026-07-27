import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });
const config = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const conn = await mysql.createConnection(config);
try {
  const [cycleTables] = await conn.query("SHOW TABLES LIKE '%CYCLE%'");
  console.log('CYCLE_TABLES:', JSON.stringify(cycleTables, null, 2));
  const [cycleCountTables] = await conn.query("SHOW TABLES LIKE '%CYCLE_COUNT%'");
  console.log('CYCLE_COUNT_TABLES:', JSON.stringify(cycleCountTables, null, 2));

  for (const row of cycleCountTables) {
    const table = Object.values(row)[0];
    const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
    console.log(`COLUMNS ${table}:`, JSON.stringify(cols.map(c => c.Field), null, 2));
    const [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT 5`);
    console.log(`ROWS ${table}:`, JSON.stringify(rows, null, 2));
  }

  const [colsInv] = await conn.query('SHOW COLUMNS FROM MES_CYCLE_COUNTING');
  console.log('MES_CYCLE_COUNTING cols:', JSON.stringify(colsInv.map(c => c.Field), null, 2));
  const [sample] = await conn.query('SELECT * FROM MES_CYCLE_COUNTING LIMIT 5');
  console.log('MES_CYCLE_COUNTING sample:', JSON.stringify(sample, null, 2));

  const [colsTimes] = await conn.query('SHOW COLUMNS FROM MES_CYCLE_TIMES');
  console.log('MES_CYCLE_TIMES cols:', JSON.stringify(colsTimes.map(c => c.Field), null, 2));
  const [sampleTimes] = await conn.query('SELECT * FROM MES_CYCLE_TIMES LIMIT 5');
  console.log('MES_CYCLE_TIMES sample:', JSON.stringify(sampleTimes, null, 2));

  const [colsStorage] = await conn.query('SHOW COLUMNS FROM STORAGE_LOCATIONS');
  console.log('STORAGE_LOCATIONS cols:', JSON.stringify(colsStorage.map(c => c.Field), null, 2));
  const [sampleStorage] = await conn.query('SELECT StorageID, LocationID, RackName, RackColumn, RackCell FROM STORAGE_LOCATIONS LIMIT 5');
  console.log('STORAGE_LOCATIONS sample:', JSON.stringify(sampleStorage, null, 2));

  const [createCycle] = await conn.query('SHOW CREATE TABLE MES_CYCLE_COUNTING');
  console.log('MES_CYCLE_COUNTING DDL:', JSON.stringify(createCycle, null, 2));

  const [movementHistoryTables] = await conn.query("SHOW TABLES LIKE 'INVENTORY_MOVEMENTS_HISTORY'");
  console.log('INVENTORY_MOVEMENTS_HISTORY table exists:', movementHistoryTables.length > 0);
  if (movementHistoryTables.length > 0) {
    const [movementHistoryCols] = await conn.query('SHOW COLUMNS FROM INVENTORY_MOVEMENTS_HISTORY');
    console.log('INVENTORY_MOVEMENTS_HISTORY cols:', JSON.stringify(movementHistoryCols.map(c => c.Field), null, 2));
    const [movementHistoryDDL] = await conn.query('SHOW CREATE TABLE INVENTORY_MOVEMENTS_HISTORY');
    console.log('INVENTORY_MOVEMENTS_HISTORY DDL:', JSON.stringify(movementHistoryDDL, null, 2));
  }

  const [movementTypesTables] = await conn.query("SHOW TABLES LIKE 'INVENTORY_MOVEMENT_TYPES'");
  console.log('INVENTORY_MOVEMENT_TYPES table exists:', movementTypesTables.length > 0);
  if (movementTypesTables.length > 0) {
    const [movementTypes] = await conn.query('SELECT MovementTypeID, MovementCode, MovementDescription FROM INVENTORY_MOVEMENT_TYPES ORDER BY MovementTypeID LIMIT 100');
    console.log('INVENTORY_MOVEMENT_TYPES:', JSON.stringify(movementTypes, null, 2));
  }

  const [requestTypeTables] = await conn.query("SHOW TABLES LIKE 'INVENTORY_REQUEST_TYPES'");
  console.log('INVENTORY_REQUEST_TYPES table exists:', requestTypeTables.length > 0);
  if (requestTypeTables.length > 0) {
    const [requestTypes] = await conn.query('SELECT RequestID, RequestType, RequestDescription, UseFlag FROM INVENTORY_REQUEST_TYPES ORDER BY RequestID LIMIT 200');
    console.log('INVENTORY_REQUEST_TYPES:', JSON.stringify(requestTypes, null, 2));
  }
} catch (err) {
  console.error('ERROR', err.message);
} finally {
  await conn.end();
}
