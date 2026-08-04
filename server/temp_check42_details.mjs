import { pool } from './db.js';

(async () => {
  try {
    const [rows] = await pool.query(`
      SELECT
        req.RequestID,
        req.RequestStatusID,
        req.RequestTypeID,
        type.RequestType AS RequestTypeName,
        req.SourceLocationID,
        src.LocationName AS SourceLocationName,
        req.DestinationLocationID,
        dest.LocationName AS DestinationLocationName,
        req.LotInventoryID,
        req.LotReceiveID
      FROM INVENTORY_REQUESTS req
      LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID
      LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
      LEFT JOIN INVENTORY_REQUEST_TYPES type ON type.RequestID = req.RequestTypeID
      WHERE req.RequestStatusID = 42
      ORDER BY req.RequestID DESC
      LIMIT 50
    `);
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
