import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
let db;
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 255;

const seedFaq = [
  ["Getting started","How do I create my first invoice?","Open Invoices in Savro, create an invoice, enter the customer and item details, then save or download it."],
  ["Getting started","Where do I add my business details?","Open Settings in Savro and complete Business Profile."],
  ["Sales & inventory","How do I add an item?","Open Items and create a product or service with its name, price and any stock details."],
  ["Sales & inventory","Why is my stock showing low?","Check the current stock and low-stock threshold on the Items or Inventory page."],
  ["Reports & accounting","Where can I see profit and loss?","Open Reports or Accounting and select the period you need."],
  ["Plans & payments","How does the free trial work?","Check Plans & Billing in Savro for your current trial status and available plans."],
  ["Plans & payments","My payment succeeded but my plan did not activate. What should I do?","Do not pay again immediately. Save your payment reference and contact Savro Support."],
  ["Account & security","I forgot my password. How can I reset it?","Use Forgot Password on the Savro login page and follow the email verification steps."],
  ["Account & security","Can support ask for my password or OTP?","No. Never share passwords, OTPs, API secrets or full card details."]
];

function supportConfig() {
  const required = ['SUPPORT_DB_HOST','SUPPORT_DB_USER','SUPPORT_DB_NAME','SUPPORT_JWT_SECRET','SUPPORT_ADMIN_EMAIL','SUPPORT_ADMIN_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error('Missing Support environment settings: ' + missing.join(', '));
  if (process.env.SUPPORT_JWT_SECRET.length < 32) throw new Error('SUPPORT_JWT_SECRET must be at least 32 characters.');
  if (process.env.SUPPORT_ADMIN_PASSWORD.length < 12) throw new Error('SUPPORT_ADMIN_PASSWORD must be at least 12 characters.');
  return {
    host: process.env.SUPPORT_DB_HOST,
    port: Number(process.env.SUPPORT_DB_PORT || 3306),
    user: process.env.SUPPORT_DB_USER,
    password: process.env.SUPPORT_DB_PASSWORD,
    database: process.env.SUPPORT_DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
    ssl: process.env.SUPPORT_DB_SSL === 'true' ? {
      ca: fs.readFileSync(process.env.RENDER ? '/etc/secrets/support-ca.pem' : path.join(ROOT_DIR,'support-ca.pem'),'utf8'),
      rejectUnauthorized: true
    } : undefined
  };
}

export async function initializeSupport() {
  if (!db) db = mysql.createPool(supportConfig());
  await db.query(`CREATE TABLE IF NOT EXISTS support_admins(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120) NOT NULL,email VARCHAR(254) UNIQUE NOT NULL,password_hash VARCHAR(255) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS support_tickets(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,ticket_code VARCHAR(24) UNIQUE NOT NULL,customer_name VARCHAR(120) NOT NULL,customer_email VARCHAR(254) NOT NULL,subject VARCHAR(180) NOT NULL,category VARCHAR(80) NOT NULL DEFAULT 'General',status ENUM('open','pending','resolved') NOT NULL DEFAULT 'open',priority ENUM('normal','high') NOT NULL DEFAULT 'normal',access_hash CHAR(64) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,INDEX(status,updated_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS support_messages(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,ticket_id BIGINT UNSIGNED NOT NULL,sender_type ENUM('customer','admin') NOT NULL,sender_name VARCHAR(120) NOT NULL,body TEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX(ticket_id,id),FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS support_faq(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,category VARCHAR(80) NOT NULL,question VARCHAR(255) UNIQUE NOT NULL,answer TEXT NOT NULL,sort_order INT DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Additive tables for remembered customer sessions and email-based ticket recovery.
  // Existing ticket, message, FAQ and admin records are not modified.
  await db.query(`CREATE TABLE IF NOT EXISTS support_customer_sessions(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,email VARCHAR(254) NOT NULL,token_hash CHAR(64) NOT NULL UNIQUE,expires_at DATETIME NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,last_used_at DATETIME NULL,INDEX(email,expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS support_ticket_recovery_otps(email VARCHAR(254) PRIMARY KEY,otp_hash CHAR(64) NOT NULL,expires_at DATETIME NOT NULL,attempts INT NOT NULL DEFAULT 0,last_sent_at DATETIME NOT NULL,request_ip VARCHAR(64) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const email = process.env.SUPPORT_ADMIN_EMAIL.toLowerCase();
  const [admins] = await db.query('SELECT id FROM support_admins WHERE email=?',[email]);
  if (!admins.length) {
    await db.query('INSERT INTO support_admins(name,email,password_hash) VALUES(?,?,?)',[
      clean(process.env.SUPPORT_ADMIN_NAME || 'Savro Support Admin',120), email,
      await bcrypt.hash(process.env.SUPPORT_ADMIN_PASSWORD,12)
    ]);
  }
  const [faqCount] = await db.query('SELECT COUNT(*) AS n FROM support_faq');
  if (!Number(faqCount[0].n)) {
    for (let i=0;i<seedFaq.length;i++) {
      await db.query('INSERT IGNORE INTO support_faq(category,question,answer,sort_order) VALUES(?,?,?,?)',[...seedFaq[i],i]);
    }
  }

  const router = express.Router();
  const secret = process.env.SUPPORT_JWT_SECRET;
  const adminAuth = (req,res,next) => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
      const payload = jwt.verify(token,secret);
      if (payload.role !== 'admin') throw new Error('Invalid role');
      req.supportAdmin = payload;
      next();
    } catch { return res.status(401).json({error:'Please sign in again.'}); }
  };
  const loginAttempts = new Map();
  const recoveryRequestAttempts = new Map();
  const hashSecret = value => crypto.createHash('sha256').update(String(value)).digest('hex');
  const customerSessionAuth = async (req,res,next) => {
    const token = clean(req.headers['x-customer-session'],128);
    if (!token) return res.status(401).json({error:'Customer session required.'});
    try {
      const [rows] = await db.query('SELECT email FROM support_customer_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP() LIMIT 1',[hashSecret(token)]);
      if (!rows.length) return res.status(401).json({error:'Your saved access has expired. Please recover access by email.'});
      req.customerSession = rows[0];
      await db.query('UPDATE support_customer_sessions SET last_used_at=UTC_TIMESTAMP() WHERE token_hash=?',[hashSecret(token)]);
      next();
    } catch (error) {
      console.error('Support customer session check failed:',error.message);
      return res.status(500).json({error:'Unable to verify customer access.'});
    }
  };
  const customerAuth = async (req,res,next) => {
    const code = clean(req.params.code,24).toUpperCase();
    const token = clean(req.headers['x-ticket-access'],128);
    const sessionToken = clean(req.headers['x-customer-session'],128);
    try {
      let rows = [];
      if (token) {
        rows = (await db.query('SELECT * FROM support_tickets WHERE ticket_code=? AND access_hash=?',[code,hashSecret(token)]))[0];
      } else if (sessionToken) {
        const [sessions] = await db.query('SELECT email FROM support_customer_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP() LIMIT 1',[hashSecret(sessionToken)]);
        if (!sessions.length) return res.status(401).json({error:'Your saved access has expired. Please recover access by email.'});
        rows = (await db.query('SELECT * FROM support_tickets WHERE ticket_code=? AND customer_email=?',[code,sessions[0].email]))[0];
        await db.query('UPDATE support_customer_sessions SET last_used_at=UTC_TIMESTAMP() WHERE token_hash=?',[hashSecret(sessionToken)]);
      } else {
        return res.status(401).json({error:'Ticket access is required.'});
      }
      if (!rows.length) return res.status(404).json({error:'Ticket not found or access is incorrect.'});
      req.supportTicket = rows[0];
      next();
    } catch (error) {
      console.error('Support customer ticket authorization failed:',error.message);
      return res.status(500).json({error:'Unable to verify ticket access.'});
    }
  };
  async function sendTicketRecoveryCode(email,otp) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!key || !from) throw new Error('Support email recovery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the main Savro service.');
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        from,to:[email],subject:'Your Savro Support access code',
        text:`Your Savro Support verification code is ${otp}. It expires in 10 minutes. If you did not request this code, ignore this email. Never share this code with anyone.`,
        html:`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#172033"><div style="font-size:22px;font-weight:800;letter-spacing:4px">SAVRO</div><p style="color:#667085">CUSTOMER SUPPORT</p><h1 style="font-size:24px">Recover your support conversations</h1><p>Use this one-time code to securely access tickets associated with this email address. It expires in 10 minutes.</p><div style="font-size:32px;font-weight:800;letter-spacing:9px;padding:18px;background:#f4f5fb;border-radius:12px;text-align:center">${otp}</div><p style="color:#667085;font-size:13px">If you did not request this code, ignore this email. Never share this code with anyone.</p></div>`
      })
    });
    if (!response.ok) {
      const details = await response.text().catch(()=>'');
      console.error('Support recovery email failed:',response.status,details.slice(0,300));
      throw new Error('Could not send the recovery email. Please try again later.');
    }
  }

  router.get('/health',async(_req,res)=>{try{await db.query('SELECT 1');res.json({ok:true,service:'savro-support'})}catch{res.status(503).json({ok:false})}});
  router.get('/faq',async(_req,res)=>{try{const [items]=await db.query('SELECT id,category,question,answer FROM support_faq ORDER BY sort_order,id');res.json({items})}catch{res.status(500).json({error:'Unable to load help articles.'})}});
  router.post('/customer/recovery/request',async(req,res)=>{
    const email=clean(req.body?.email,254).toLowerCase();
    if(!validEmail(email))return res.status(400).json({error:'Enter a valid email address.'});
    const generic={message:'If support requests are associated with that email, a verification code will be sent.'};
    try{
      const ip=clean(req.ip||req.socket.remoteAddress||'unknown',64),now=Date.now();
      const ipEntry=recoveryRequestAttempts.get(ip);
      if(ipEntry&&now-ipEntry<60000)return res.json(generic);
      recoveryRequestAttempts.set(ip,now);
      const [tickets]=await db.query('SELECT id FROM support_tickets WHERE customer_email=? LIMIT 1',[email]);
      if(!tickets.length)return res.json(generic);
      const [existing]=await db.query('SELECT TIMESTAMPDIFF(SECOND,last_sent_at,UTC_TIMESTAMP()) AS seconds_since FROM support_ticket_recovery_otps WHERE email=?',[email]);
      if(existing.length&&Number(existing[0].seconds_since)<60)return res.json(generic);
      const otp=String(crypto.randomInt(100000,1000000));
      await sendTicketRecoveryCode(email,otp);
      const otpHash=hashSecret(`${email}:${otp}:${process.env.SUPPORT_JWT_SECRET}`);
      await db.query(`INSERT INTO support_ticket_recovery_otps(email,otp_hash,expires_at,attempts,last_sent_at,request_ip) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE),0,UTC_TIMESTAMP(),?) ON DUPLICATE KEY UPDATE otp_hash=VALUES(otp_hash),expires_at=VALUES(expires_at),attempts=0,last_sent_at=UTC_TIMESTAMP(),request_ip=VALUES(request_ip)`,[email,otpHash,ip]);
      return res.json(generic);
    }catch(error){console.error('Support recovery request failed:',error.message);return res.status(503).json({error:'Email recovery is temporarily unavailable. Please try again later.'});}
  });
  router.post('/customer/recovery/verify',async(req,res)=>{
    const email=clean(req.body?.email,254).toLowerCase(),otp=clean(req.body?.code,6);
    if(!validEmail(email)||!/^\d{6}$/.test(otp))return res.status(400).json({error:'Enter your email address and the six-digit code.'});
    try{
      const [rows]=await db.query('SELECT * FROM support_ticket_recovery_otps WHERE email=? LIMIT 1',[email]);
      if(!rows.length||new Date(rows[0].expires_at).getTime()<=Date.now()||Number(rows[0].attempts)>=5){return res.status(400).json({error:'The code is invalid or expired. Request a new code.'});}
      const expected=hashSecret(`${email}:${otp}:${process.env.SUPPORT_JWT_SECRET}`),actual=String(rows[0].otp_hash||'');
      const valid=actual.length===expected.length&&crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
      if(!valid){await db.query('UPDATE support_ticket_recovery_otps SET attempts=attempts+1 WHERE email=?',[email]);return res.status(400).json({error:'The code is invalid or expired. Request a new code.'});}
      const [tickets]=await db.query('SELECT ticket_code,subject,status,created_at,updated_at FROM support_tickets WHERE customer_email=? ORDER BY updated_at DESC',[email]);
      if(!tickets.length){await db.query('DELETE FROM support_ticket_recovery_otps WHERE email=?',[email]);return res.status(400).json({error:'No support requests were found for that email address.'});}
      const sessionToken=crypto.randomBytes(32).toString('hex');
      await db.query('INSERT INTO support_customer_sessions(email,token_hash,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))',[email,hashSecret(sessionToken)]);
      await db.query('DELETE FROM support_ticket_recovery_otps WHERE email=?',[email]);
      return res.json({message:'Email verified. Your support requests are ready.',customerSessionToken:sessionToken,expiresInDays:30,tickets});
    }catch(error){console.error('Support recovery verification failed:',error.message);return res.status(500).json({error:'Unable to verify the recovery code.'});}
  });
  router.get('/customer/tickets',customerSessionAuth,async(req,res)=>{
    try{const [items]=await db.query('SELECT ticket_code AS ticketCode,subject,status,category,created_at AS createdAt,updated_at AS updatedAt FROM support_tickets WHERE customer_email=? ORDER BY updated_at DESC',[req.customerSession.email]);res.json({items});}
    catch(error){console.error('Support customer ticket list failed:',error.message);res.status(500).json({error:'Unable to load your support requests.'});}
  });
  router.post('/tickets',async(req,res)=>{
    const body=req.body||{},name=clean(body.name,120),email=clean(body.email,254).toLowerCase(),subject=clean(body.subject,180),category=clean(body.category||'General',80),message=clean(body.message,5000);
    if(name.length<2||!validEmail(email)||subject.length<4||message.length<10)return res.status(400).json({error:'Enter your name, valid email, subject and a message of at least 10 characters.'});
    const code='SAV-'+crypto.randomBytes(4).toString('hex').toUpperCase(),access=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(access).digest('hex'),conn=await db.getConnection();
    try{await conn.beginTransaction();const [result]=await conn.query('INSERT INTO support_tickets(ticket_code,customer_name,customer_email,subject,category,access_hash) VALUES(?,?,?,?,?,?)',[code,name,email,subject,category,hash]);await conn.query('INSERT INTO support_messages(ticket_id,sender_type,sender_name,body) VALUES(?,?,?,?)',[result.insertId,'customer',name,message]);await conn.commit();res.status(201).json({ticketCode:code,accessToken:access,message:'Your request was received. Save your ticket code and private access token.'})}
    catch(error){await conn.rollback();console.error('Support ticket create failed:',error.message);res.status(500).json({error:'Could not create ticket.'})}finally{conn.release()}
  });
  router.get('/tickets/:code',customerAuth,async(req,res)=>{try{const [messages]=await db.query('SELECT sender_type,sender_name,body,created_at FROM support_messages WHERE ticket_id=? ORDER BY id',[req.supportTicket.id]);const t=req.supportTicket;res.json({ticket:{ticketCode:t.ticket_code,subject:t.subject,status:t.status,category:t.category,createdAt:t.created_at,updatedAt:t.updated_at},messages})}catch{res.status(500).json({error:'Unable to load ticket.'})}});
  router.post('/tickets/:code/messages',customerAuth,async(req,res)=>{const body=clean(req.body?.message,5000);if(body.length<2)return res.status(400).json({error:'Enter a message.'});if(req.supportTicket.status==='resolved')return res.status(409).json({error:'Ticket resolved. Please open a new request.'});try{await db.query('INSERT INTO support_messages(ticket_id,sender_type,sender_name,body) VALUES(?,?,?,?)',[req.supportTicket.id,'customer',req.supportTicket.customer_name,body]);await db.query("UPDATE support_tickets SET status='open' WHERE id=?",[req.supportTicket.id]);res.status(201).json({message:'Reply sent.'})}catch{res.status(500).json({error:'Unable to send reply.'})}});
  router.post('/admin/login',async(req,res)=>{
    const ip=req.ip||req.socket.remoteAddress||'unknown',now=Date.now(),entry=loginAttempts.get(ip)||{count:0,until:now+900000};
    if(now>entry.until){entry.count=0;entry.until=now+900000}
    if(entry.count>=8)return res.status(429).json({error:'Too many sign-in attempts. Please try again later.'});
    try{const [rows]=await db.query('SELECT * FROM support_admins WHERE email=?',[clean(req.body?.email,254).toLowerCase()]);if(!rows.length||!await bcrypt.compare(String(req.body?.password||''),rows[0].password_hash)){entry.count++;loginAttempts.set(ip,entry);return res.status(401).json({error:'Email or password is incorrect.'})}loginAttempts.delete(ip);const a=rows[0];res.json({token:jwt.sign({id:a.id,email:a.email,name:a.name,role:'admin'},secret,{expiresIn:'8h'}),admin:{name:a.name,email:a.email}})}catch{res.status(500).json({error:'Unable to sign in.'})}
  });
  router.get('/admin/tickets',adminAuth,async(req,res)=>{try{const status=['open','pending','resolved'].includes(req.query.status)?req.query.status:'',term=clean(req.query.q,100);let sql=`SELECT t.*,(SELECT body FROM support_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) last_message FROM support_tickets t WHERE 1=1`,params=[];if(status){sql+=' AND t.status=?';params.push(status)}if(term){sql+=' AND (t.ticket_code LIKE ? OR t.customer_name LIKE ? OR t.customer_email LIKE ? OR t.subject LIKE ?)';params.push(...Array(4).fill('%'+term+'%'))}sql+=" ORDER BY FIELD(t.status,'open','pending','resolved'),t.updated_at DESC LIMIT 200";const [items]=await db.query(sql,params);res.json({items})}catch(error){console.error('Support ticket list failed:',error.message);res.status(500).json({error:'Unable to load tickets.'})}});
  router.get('/admin/tickets/:id',adminAuth,async(req,res)=>{try{const [tickets]=await db.query('SELECT * FROM support_tickets WHERE id=?',[req.params.id]);if(!tickets.length)return res.status(404).json({error:'Ticket not found.'});const [messages]=await db.query('SELECT * FROM support_messages WHERE ticket_id=? ORDER BY id',[req.params.id]);res.json({ticket:tickets[0],messages})}catch{res.status(500).json({error:'Unable to load ticket.'})}});
  router.post('/admin/tickets/:id/messages',adminAuth,async(req,res)=>{const body=clean(req.body?.message,5000);if(body.length<2)return res.status(400).json({error:'Enter a reply.'});try{const [tickets]=await db.query('SELECT id FROM support_tickets WHERE id=?',[req.params.id]);if(!tickets.length)return res.status(404).json({error:'Ticket not found.'});await db.query('INSERT INTO support_messages(ticket_id,sender_type,sender_name,body) VALUES(?,?,?,?)',[tickets[0].id,'admin',clean(req.supportAdmin.name,120),body]);await db.query("UPDATE support_tickets SET status=IF(status='resolved','resolved','pending') WHERE id=?",[req.params.id]);res.status(201).json({message:'Reply saved. Email delivery is not configured yet.'})}catch{res.status(500).json({error:'Unable to save reply.'})}});
  router.patch('/admin/tickets/:id',adminAuth,async(req,res)=>{const status=['open','pending','resolved'].includes(req.body?.status)?req.body.status:null,priority=['normal','high'].includes(req.body?.priority)?req.body.priority:null;if(!status&&!priority)return res.status(400).json({error:'Invalid status or priority.'});try{const [rows]=await db.query('SELECT id FROM support_tickets WHERE id=?',[req.params.id]);if(!rows.length)return res.status(404).json({error:'Ticket not found.'});if(status&&priority)await db.query('UPDATE support_tickets SET status=?,priority=? WHERE id=?',[status,priority,req.params.id]);else if(status)await db.query('UPDATE support_tickets SET status=? WHERE id=?',[status,req.params.id]);else await db.query('UPDATE support_tickets SET priority=? WHERE id=?',[priority,req.params.id]);res.json({message:'Ticket updated.'})}catch{res.status(500).json({error:'Unable to update ticket.'})}});
  return router;
}
