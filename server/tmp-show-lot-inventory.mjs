import { pool } from './db.js';

async function run() {
  const [rows] = await pool.query('SELECT * FROM MES_LOT_INVENTORY LIMIT 20');
  console.log(JSON.stringify(rows.slice(0,20), null, 2));
  const [linkRows] = await pool.query(`SELECT li.LotInventoryID, li.LotID, li.PartNumber, li.LotReference, s.LotReceiveID FROM MES_LOT_INVENTORY li LEFT JOIN SHIPPING_RECEIVING_LOTS s ON s.InternalLot = li.LotReference OR s.ProviderLot = li.LotReference OR CAST(s.LotReceiveID AS CHAR) = li.LotReference LIMIT 20`);
  console.log('LINKS:', JSON.stringify(linkRows, null, 2));
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });