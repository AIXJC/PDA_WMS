import { pool } from './db.js';

async function run() {
  const storageId = 129;
  const [rows] = await pool.query('SELECT StorageID, LocationID, RackName FROM STORAGE_LOCATIONS WHERE StorageID = ? LIMIT 1', [storageId]);
  console.log('STORAGE ROW:', JSON.stringify(rows[0] || null, null, 2));
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });