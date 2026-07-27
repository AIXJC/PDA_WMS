import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { pool } from './db.js';

const run = async () => {
  const [tables] = await pool.query("SHOW TABLES LIKE 'ERP_PURCHASE_%'");
  console.log('TABLES', JSON.stringify(tables, null, 2));

  const [columns] = await pool.query(
    "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('ERP_PURCHASE_RECEIPT','ERP_PURCHASE_RECEIPT_DETAIL','ERP_PURCHASE_ORDER','ERP_PURCHASE_ORDER_DETAIL','SHIPPING_RECEIVING_LOTS') ORDER BY TABLE_NAME, COLUMN_NAME"
  );
  console.log('COLUMNS', JSON.stringify(columns, null, 2));
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
