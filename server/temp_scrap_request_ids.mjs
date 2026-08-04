import { pool } from './db.js';

(async () => {
  try {
    console.log('--- PLANT_LOCATIONS matching scrap/quarantine ---');
    const [locations] = await pool.query(`
      SELECT LocationID, LocationName
      FROM PLANT_LOCATIONS
      WHERE LocationName LIKE '%Scrap%'
         OR LocationName LIKE '%scrap%'
         OR LocationName LIKE '%Quarantine%'
         OR LocationName LIKE '%quarantine%'
         OR LocationName LIKE '%Purg%'
         OR LocationName LIKE '%purg%'
      ORDER BY LocationID
    `);
    console.log(JSON.stringify(locations, null, 2));

    console.log('--- INVENTORY_REQUEST_TYPES ---');
    const [types] = await pool.query(`
      SELECT RequestID, RequestType, RequestDescription
      FROM INVENTORY_REQUEST_TYPES
      ORDER BY RequestID
    `);
    console.log(JSON.stringify(types, null, 2));

    console.log('--- MES_STATUS matching scrap/pending/approved/executed ---');
    const [statuses] = await pool.query(`
      SELECT StatusID, StatusCode, StatusDescription, ModuleCode
      FROM MES_STATUS
      WHERE StatusCode LIKE '%SCRAP%'
         OR StatusDescription LIKE '%scrap%'
         OR StatusDescription LIKE '%aprob%'
         OR StatusDescription LIKE '%ejecut%'
         OR StatusDescription LIKE '%pend%'
      ORDER BY StatusID
    `);
    console.log(JSON.stringify(statuses, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();