import { pool } from './db.js';

async function run() {
  const lotId = 187;
  const [[lot]] = await pool.query(
    `SELECT lot.LotReceiveID, lot.PurchaseReceiptDetailID, lot.ProviderLot, lot.InternalLot,
      lot.ShortInternalLot, lot.SerialNumber, lot.Quantity, item.PartNumber
    FROM SHIPPING_RECEIVING_LOTS lot
    LEFT JOIN ERP_PURCHASE_RECEIPT_DETAIL detail ON detail.PurchaseReceiptDetailID = lot.PurchaseReceiptDetailID
    LEFT JOIN MES_MASTER_ITEMS item ON item.ItemID = detail.ItemID
    WHERE lot.LotReceiveID = ?
    LIMIT 1`,
    [lotId]
  );
  console.log('LOT META:', JSON.stringify(lot, null, 2));

  if (!lot?.PartNumber) {
    console.log('No part number on lot meta. Inspecting direct detail row.');
    const [detailRows] = await pool.query(
      `SELECT * FROM ERP_PURCHASE_RECEIPT_DETAIL WHERE PurchaseReceiptDetailID = ? LIMIT 1`,
      [lot?.PurchaseReceiptDetailID]
    );
    console.log('DETAIL ROW:', JSON.stringify(detailRows[0] || null, null, 2));
  }

  const [invRows] = await pool.query(
    `SELECT inv.InventoryID, inv.PartNumber, inv.RackLocationID, inv.Quantity,
      storage.StorageID, plant.LocationName
    FROM MES_INVENTORY inv
    LEFT JOIN STORAGE_LOCATIONS storage ON storage.StorageID = inv.RackLocationID
    LEFT JOIN PLANT_LOCATIONS plant ON plant.LocationID = storage.LocationID
    WHERE inv.PartNumber = ? AND inv.Quantity > 0`,
    [lot?.PartNumber]
  );
  console.log('INVENTORY MATCHES:', JSON.stringify(invRows.slice(0, 20), null, 2));

  await pool.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
