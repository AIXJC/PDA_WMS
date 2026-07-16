import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const args = process.argv.slice(2);
const userId = Number(args[0]);
const password = args[1];

if (!Number.isInteger(userId) || !password) {
  console.error('Uso: node set_user_password.js <UserID> <password>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

try {
  const [result] = await pool.query(
    'UPDATE USERS_MES SET AccessCode = ? WHERE UserID = ?',
    [hash, userId]
  );

  if (result.affectedRows === 0) {
    console.error(`No se encontró el usuario con UserID=${userId}`);
    process.exit(1);
  }

  console.log(`Contraseña actualizada para UserID=${userId}`);
  console.log(hash);
} catch (error) {
  console.error('Error al actualizar la contraseña:', error.message);
  process.exit(1);
} finally {
  await pool.end();
}
