import { pool } from './db.js';

const [tables] = await pool.query("SHOW TABLES LIKE 'MES_LOT_LOCATION'");
console.log('tableExists', tables.length > 0);
if (tables.length > 0) {
  const [desc] = await pool.query('DESCRIBE MES_LOT_LOCATION');
  console.log(JSON.stringify(desc, null, 2));
}

await pool.end();
