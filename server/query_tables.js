import { pool } from './db.js';

async function run() {
  try {
    console.log('Querying USERS_MES columns...');
    const [colsUsers] = await pool.query("SHOW COLUMNS FROM `USERS_MES`");
    console.table(colsUsers);

    console.log('Querying sample USERS_MES rows...');
    const [users] = await pool.query('SELECT UserID, AccesCode, FName, SName, RoleID, Email FROM `USERS_MES` LIMIT 10');
    console.table(users);

    console.log('Querying USER_ROLES columns...');
    const [colsRoles] = await pool.query("SHOW COLUMNS FROM `USER_ROLES`");
    console.table(colsRoles);

    console.log('Querying sample USER_ROLES rows...');
    const [roles] = await pool.query('SELECT RoleID, RoleName FROM `USER_ROLES` LIMIT 50');
    console.table(roles);

    await pool.end();
  } catch (err) {
    console.error('Error querying tables:', err.message);
    process.exit(1);
  }
}

run();
