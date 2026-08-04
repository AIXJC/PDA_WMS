import { pool } from './db.js';

(async () => {
  try {
    const [cols] = await pool.query('SHOW COLUMNS FROM INVENTORY_REQUESTS');
    console.log('COLUMNS', cols.map((c) => c.Field).join(', '));
    const [rows] = await pool.query('SELECT RequestID, RequestStatusID, RequestTypeID, SourceLocationID, DestinationLocationID, LotInventoryID FROM INVENTORY_REQUESTS WHERE RequestStatusID = 42 LIMIT 20');
    console.log('ROWS', rows.length);
    for (const row of rows) {
      console.log(JSON.stringify(row));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();
