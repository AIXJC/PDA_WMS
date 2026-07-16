import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath,'utf8');
  for (const line of raw.split(/\r?\n/)){
    const t=line.trim(); if(!t||t.startsWith('#')) continue;
    const eq=t.indexOf('='); if(eq===-1) continue;
    const k=t.slice(0,eq).trim(); let v=t.slice(eq+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
    env[k]=v;
  }
}

(async()=>{
  try{
    console.log('Using', env.DB_HOST, env.DB_USER, 'PWD_LEN', String(env.DB_PASSWORD||'').length);
    const pool = mysql.createPool({host: env.DB_HOST, port: Number(env.DB_PORT||3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME});
    const [rows]=await pool.query('SELECT USER(), CURRENT_USER(), DATABASE()');
    console.log(rows);
    await pool.end();
  }catch(e){console.error('err', e.message, e.code)}
})();
