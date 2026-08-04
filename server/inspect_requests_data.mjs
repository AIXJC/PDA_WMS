import { pool } from './db.js';

const run = async () => {
  try {
    const [tables] = await pool.query("SHOW TABLES LIKE 'INVENTORY_REQUESTS'");
    console.log('inventory_requests_exists', tables.length);
    const [reqTypes] = await pool.query("SHOW TABLES LIKE 'INVENTORY_REQUEST_TYPES'");
    console.log('inventory_request_types_exists', reqTypes.length);
    if (reqTypes.length) {
      const [rows] = await pool.query('SELECT RequestID, RequestType, RequestDescription, UseFlag FROM INVENTORY_REQUEST_TYPES ORDER BY RequestID LIMIT 100');
      console.log(JSON.stringify(rows, null, 2));
    }
    if (tables.length) {
      const [rows] = await pool.query("SELECT RequestID, RequestStatusID, RequestTypeID, PartNumber, Quantity, SourceLocationID, DestinationLocationID, LotInventoryID, RegDate, SubmitDate, ConfirmUserID FROM INVENTORY_REQUESTS ORDER BY RequestID DESC LIMIT 50");
      console.log(JSON.stringify(rows, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

run();
