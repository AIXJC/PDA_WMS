import { pool } from './server/db.js';

async function run() {
  const [receiptRows] = await pool.query(`SELECT * FROM ERP_PURCHASE_RECEIPT WHERE PurchaseReceiptID IN (2,3,4,5,6,17) LIMIT 10`);
  console.log('ERP_PURCHASE_RECEIPT rows:', JSON.stringify(receiptRows, null, 2));

  const [orderCols] = await pool.query(`SHOW COLUMNS FROM ERP_PURCHASE_ORDER`);
  console.log('ERP_PURCHASE_ORDER columns:', JSON.stringify(orderCols, null, 2));

  const [orderRows] = await pool.query(`SELECT * FROM ERP_PURCHASE_ORDER WHERE PurchaseOrderID IN (1,10,16) LIMIT 10`);
  console.log('ERP_PURCHASE_ORDER rows:', JSON.stringify(orderRows, null, 2));

  const [usersCols] = await pool.query(`SHOW COLUMNS FROM USERS_MES`);
  console.log('USERS_MES columns:', JSON.stringify(usersCols, null, 2));

  const [joinRows] = await pool.query(`
    SELECT
      pr.PurchaseReceiptID AS id,
      pr.PurchaseOrderID,
      po.PONumber AS poNumber,
      po.OrderDate AS orderDate,
      po.ExpectedDate AS expectedDate,
      po.OrderStatusID AS orderStatusId,
      CONCAT(u.FirstName, ' ', u.LastName) AS receivedBy,
      status.StatusDescription AS receiptStatusDesc,
      status.StatusCode AS receiptStatusCode
    FROM ERP_PURCHASE_RECEIPT pr
    LEFT JOIN ERP_PURCHASE_ORDER po ON po.PurchaseOrderID = pr.PurchaseOrderID
    LEFT JOIN USERS_MES u ON u.UserID = pr.ReceivedBy
    LEFT JOIN MES_STATUS status ON status.StatusID = pr.OrderStatusID
    WHERE pr.PurchaseReceiptID IN (17)
    LIMIT 10
  `);
  console.log('Join rows:', JSON.stringify(joinRows, null, 2));

  await pool.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
