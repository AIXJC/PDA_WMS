import { pool } from './db.js';

(async () => {
  try {
    const [rows] = await pool.query(`
      SELECT COUNT(*) AS count
      FROM INVENTORY_REQUESTS req
      LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID
      LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
      WHERE req.RequestStatusID IN (41, 42)
        AND req.RequestTypeID IN (2, 12)
        AND req.LotInventoryID IS NOT NULL
        AND req.LotInventoryID > 0
        AND LOWER(COALESCE(src.LocationName, '')) LIKE '%incoming%'
        AND LOWER(COALESCE(dest.LocationName, '')) LIKE '%storage%'
    `);
    console.log('COUNT', rows[0].count);

    const [rows2] = await pool.query(`
      SELECT req.RequestID, req.RequestStatusID, req.RequestTypeID, src.LocationName AS SourceLocationName, dest.LocationName AS DestinationLocationName, req.LotInventoryID
      FROM INVENTORY_REQUESTS req
      LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID
      LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID
      WHERE req.RequestStatusID IN (41, 42)
        AND req.RequestTypeID IN (2, 12)
        AND req.LotInventoryID IS NOT NULL
        AND req.LotInventoryID > 0
        AND LOWER(COALESCE(src.LocationName, '')) LIKE '%incoming%'
        AND LOWER(COALESCE(dest.LocationName, '')) LIKE '%storage%'
      ORDER BY req.RequestID DESC
      LIMIT 20
    `);
    for (const row of rows2) {
      console.log(JSON.stringify(row));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();