import { pool } from './db.js'; const [rows] = await pool.query('SHOW COLUMNS FROM INVENTORY_REQUESTS'); console.log(JSON.stringify(rows,null,2)); await pool.end();
