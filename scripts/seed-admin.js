import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const email=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
const password=String(process.env.ADMIN_PASSWORD||'');
if(!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Set a valid ADMIN_EMAIL in .env.');
if(password.length<12) throw new Error('Set ADMIN_PASSWORD to a strong password of at least 12 characters in .env.');

const pool = await mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: {
    rejectUnauthorized: false
  },
  connectionLimit: 2
});

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id CHAR(36) PRIMARY KEY,email VARCHAR(255) NOT NULL UNIQUE,password_hash VARCHAR(255) NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'user',profile JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
  const [rows]=await pool.query('SELECT * FROM users WHERE email=?',[email]);
  const hash=await bcrypt.hash(password,12), name=String(process.env.ADMIN_NAME||'Ledgerly Admin').trim();
  if(rows.length){const profile=typeof rows[0].profile==='string'?JSON.parse(rows[0].profile):rows[0].profile;await pool.query("UPDATE users SET password_hash=?,role='admin',profile=? WHERE id=?",[hash,JSON.stringify({...profile,name,email,businessName:profile.businessName||'Ledgerly',subscriptionStatus:'active'}),rows[0].id]);}
  else {const id=randomUUID(),profile={name,email,businessName:'Ledgerly',phone:'',subscriptionStatus:'active',subscriptionPlan:null,trialEndsAt:null};await pool.query("INSERT INTO users(id,email,password_hash,role,profile) VALUES(?,?,?,'admin',?)",[id,email,hash,JSON.stringify(profile)]);}
  console.log(`Admin account ready: ${email}. Keep the password private.`);
} finally {await pool.end();}
