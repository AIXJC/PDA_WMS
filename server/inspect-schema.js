import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: 'server/.env' });
dotenv.config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || '',
};

const main = async () => {
  const conn = await mysql.createConnection(config);
  try {
    const [tables] = await conn.query("SHOW TABLES LIKE '%SCRAP%'");
    console.log(JSON.stringify({ tables }, null, 2));
    const [cols] = await conn.query('SHOW COLUMNS FROM MES_SCRAP_AND_DISCREPANCIES');
    console.log(JSON.stringify({ cols: cols.map((c) => c.Field) }, null, 2));
    const [moveCols] = await conn.query('SHOW COLUMNS FROM INVENTORY_MOVEMENTS_HISTORY');
    console.log(JSON.stringify({ moveCols: moveCols.map((c) => c.Field) }, null, 2));
    const [rows] = await conn.query('SELECT * FROM INVENTORY_MOVEMENTS_HISTORY ORDER BY MovementID DESC LIMIT 5');
    console.log(JSON.stringify({ rows }, null, 2));
  } finally {
    await conn.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
