import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: 'server/.env' });
 dotenv.config();

(async () => {
  try {
    const pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
      ssl: false,
    });

    const pwd = String(process.env.DB_PASSWORD || '');
    console.log('DB_HOST=', process.env.DB_HOST, 'DB_USER=', process.env.DB_USER, 'DB_NAME=', process.env.DB_NAME, 'PWD_LEN=', pwd.length);
    console.log('DB_PASSWORD hex=', Buffer.from(pwd).toString('hex'));
    const [rows] = await pool.query('SELECT USER(), CURRENT_USER(), DATABASE()');
    console.log(rows);
    await pool.end();
  } catch (err) {
    console.error('DB connect error:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
