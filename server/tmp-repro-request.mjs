import { pool } from './db.js';

async function run() {
  const query = `
    INSERT INTO INVENTORY_REQUESTS (
      RequestStatusID, RequestTypeID, PartNumber, Quantity,
      RegUserID, ConfirmUserID, SourceLocationID, DestinationLocationID, LotReceiveID
    ) VALUES (40, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    3,
    'BL-322',
    1,
    1,
    1,
    129,
    null,
    187,
  ];
  console.log('QUERY:', query);
  console.log('VALUES LENGTH:', values.length);
  console.log('PLACEHOLDERS:', (query.match(/\?/g) || []).length);
  try {
    const [result] = await pool.query(query, values);
    console.log('RESULT:', result);
  } catch (error) {
    console.error(error);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
