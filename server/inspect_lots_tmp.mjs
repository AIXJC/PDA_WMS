import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { pool } from './db.js';

const run = async () => {
  const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM SHIPPING_RECEIVING_LOTS');
  console.log('TOTAL', JSON.stringify(countRows));

  const [withInternal] = await pool.query('SELECT COUNT(*) AS withInternalLot FROM SHIPPING_RECEIVING_LOTS WHERE InternalLot IS NOT NULL AND TRIM(InternalLot) <> ""');
  console.log('WITH_INTERNAL', JSON.stringify(withInternal));

  const [withProvider] = await pool.query('SELECT COUNT(*) AS withProviderLot FROM SHIPPING_RECEIVING_LOTS WHERE ProviderLot IS NOT NULL AND TRIM(ProviderLot) <> ""');
  console.log('WITH_PROVIDER', JSON.stringify(withProvider));

  const [rows] = await pool.query('SELECT LotReceiveID, PurchaseReceiptDetailID, ProviderLot, InternalLot, ShortInternalLot, Quantity, RegDate FROM SHIPPING_RECEIVING_LOTS ORDER BY LotReceiveID DESC LIMIT 15');
  console.log('ROWS', JSON.stringify(rows, null, 2));
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
