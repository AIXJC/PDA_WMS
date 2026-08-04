import { pool } from './db.js';

(async () => {
  try {
    const [rows] = await pool.query(
      "SELECT req.RequestID, req.RequestStatusID, req.RequestTypeID, req.SourceLocationID, req.DestinationLocationID, req.LotInventoryID, src.LocationName AS SourceLocationName, dest.LocationName AS DestinationLocationName FROM INVENTORY_REQUESTS req LEFT JOIN PLANT_LOCATIONS src ON src.LocationID = req.SourceLocationID LEFT JOIN PLANT_LOCATIONS dest ON dest.LocationID = req.DestinationLocationID WHERE req.RequestStatusID = 42 ORDER BY req.RequestID DESC LIMIT 50"
    );
    console.log('ROWS', rows.length);
    for (const row of rows) console.log(JSON.stringify(row));

    const locationIds = new Set(rows.flatMap((r) => [r.SourceLocationID, r.DestinationLocationID]).filter((id) => id != null));
    if (locationIds.size > 0) {
      const placeholders = Array.from(locationIds).map(() => '?').join(', ');
      const [locs] = await pool.query(
        `SELECT LocationID, LocationName FROM PLANT_LOCATIONS WHERE LocationID IN (${placeholders}) ORDER BY LocationID`
      , Array.from(locationIds));
      console.log('LOCATIONS', locs.map((loc) => `${loc.LocationID}: ${loc.LocationName}`).join(' | '));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();