
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import Razorpay from "razorpay";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { backupDatabase } from "./scripts/backup-db.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(), PORT=process.env.PORT||3000;
// Render terminates HTTPS one hop in front of this service. Trust exactly that
// hop so req.ip cannot be bypassed by prepending a fake X-Forwarded-For value.
app.set('trust proxy',1);

// Live Help Desk events: Server-Sent Events (SSE) for instant customer/admin updates.
const helpChatStreams=new Map();
const helpStreamIdentityCounts=new Map();
function reservePublicHelpStream(identity,res,max=3){
 const key=String(identity||'unknown'),active=Number(helpStreamIdentityCounts.get(key)||0),total=[...helpStreamIdentityCounts.values()].reduce((sum,count)=>sum+Number(count||0),0);if(active>=max||total>=200)return false;
 helpStreamIdentityCounts.set(key,active+1);let released=false;const release=()=>{if(released)return;released=true;const left=Number(helpStreamIdentityCounts.get(key)||1)-1;if(left>0)helpStreamIdentityCounts.set(key,left);else helpStreamIdentityCounts.delete(key)};
 res.once('close',release);res.once('error',release);return true;
}
function addHelpChatStream(key,res){
  if(!helpChatStreams.has(key)) helpChatStreams.set(key,new Set());
  helpChatStreams.get(key).add(res);
  const cleanup=()=>{const set=helpChatStreams.get(key);if(!set)return;set.delete(res);if(!set.size)helpChatStreams.delete(key)};
  res.on('close',cleanup);
  return cleanup;
}
function publishHelpChat(threadId,payload){
  const keys=[`thread:${threadId}`,'admin:all'];
  const data=`data: ${JSON.stringify(payload)}\n\n`;
  for(const key of keys){const set=helpChatStreams.get(key);if(!set)continue;for(const res of [...set]){try{res.write(data)}catch{try{res.end()}catch{}set.delete(res)}}}
}

// Keep customer/order data independent of version folders. If an older version
// already has an Ashwini database, reuse the newest nearby database on first run.
function findExistingDb(){
 const explicit=process.env.ASHWINI_DB_PATH;
 if(explicit) return path.resolve(explicit);
 // Each extracted Ashwini version gets its own database by default.
 // This prevents localhost:3000 from silently attaching to an older Vxx
 // database in a neighbouring folder and making new orders appear to vanish.
 return process.env.DB_PATH || path.join(__dirname,"ashwini.db");
}
const dbPath=findExistingDb();
console.log(`[Ashwini DB] Using ${dbPath}`);
const db=new Database(dbPath);
db.pragma("foreign_keys=ON");
db.exec(fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8"));
const backupIntervalHours=Math.max(1,Number(process.env.BACKUP_INTERVAL_HOURS)||24);
let backupRunning=false;
async function runScheduledBackup(){
 if(backupRunning)return console.warn('[Ashwini backup] Skipped because another backup is still running');
 backupRunning=true;
 try{console.log(`[Ashwini backup] Created ${await backupDatabase()}`)}catch(error){console.error('[Ashwini backup] Failed:',error.message)}finally{backupRunning=false}
}
const backupStartTimer=setTimeout(runScheduledBackup,60*1000);
const backupIntervalTimer=setInterval(runScheduledBackup,backupIntervalHours*60*60*1000);
backupStartTimer.unref?.();
backupIntervalTimer.unref?.();
try{db.exec("ALTER TABLE products ADD COLUMN gallery TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN product_history TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN size_chart TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN care_instructions TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN badge_text TEXT DEFAULT 'Ashwini Choice'")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN offer_text TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN offer_discount REAL DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''")}catch{}
// Enforce one non-empty mobile number per account at the database boundary.
// Triggers protect upgraded databases even when historical duplicates prevent
// creation of the supporting unique index; existing rows are never auto-deleted.
try{db.exec(`
 CREATE TRIGGER IF NOT EXISTS users_unique_phone_insert
 BEFORE INSERT ON users
 WHEN trim(COALESCE(NEW.phone,''))<>''
  AND EXISTS(SELECT 1 FROM users WHERE phone=NEW.phone)
 BEGIN
  SELECT RAISE(ABORT,'Mobile number is already registered');
 END;
 CREATE TRIGGER IF NOT EXISTS users_unique_phone_update
 BEFORE UPDATE OF phone ON users
 WHEN trim(COALESCE(NEW.phone,''))<>''
  AND EXISTS(SELECT 1 FROM users WHERE phone=NEW.phone AND id<>OLD.id)
 BEGIN
  SELECT RAISE(ABORT,'Mobile number is already registered');
 END;
`)}catch(e){console.error('[Ashwini mobile uniqueness]',e.message)}
try{db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_phone ON users(phone) WHERE trim(COALESCE(phone,''))<>''")}catch{
 const duplicateGroups=Number(db.prepare("SELECT COUNT(*) n FROM (SELECT phone FROM users WHERE trim(COALESCE(phone,''))<>'' GROUP BY phone HAVING COUNT(*)>1)").get()?.n||0);
 console.warn(`[Ashwini mobile uniqueness] ${duplicateGroups} historical duplicate mobile group(s) require admin review; new duplicates are blocked.`);
}
try{db.exec("ALTER TABLE users ADD COLUMN otp_hash TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN otp_expires_at INTEGER DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN login_otp_hash TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN two_step_enabled INTEGER NOT NULL DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN two_step_channel TEXT NOT NULL DEFAULT 'AUTO'")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN login_otp_expires_at INTEGER DEFAULT 0")}catch{}
// Ensure the configured Store Admin can always sign in after Render restarts or a
// database is recreated.  The previous implementation assigned a random password
// to a newly-created admin, which made password sign-in impossible.
try{
 const bootstrapAdminEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
 const bootstrapAdminPassword=String(process.env.ADMIN_PASSWORD||'');
 if(bootstrapAdminEmail && bootstrapAdminPassword){
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(bootstrapAdminEmail))throw new Error('ADMIN_EMAIL is invalid');
  if(Array.from(bootstrapAdminPassword).length<8||Buffer.byteLength(bootstrapAdminPassword,'utf8')>72)throw new Error('ADMIN_PASSWORD must be 8 or more characters and no more than 72 UTF-8 bytes');
  const hash=bcrypt.hashSync(bootstrapAdminPassword,12);
  const existingAdmin=db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1").get(bootstrapAdminEmail);
  if(existingAdmin){
   db.prepare("UPDATE users SET password_hash=?,role='admin' WHERE id=?").run(hash,existingAdmin.id);
   db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(existingAdmin.id);
  }else{
   db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
     .run('Ashwini Store Admin',bootstrapAdminEmail,hash);
  }
 }else if(bootstrapAdminEmail){
  console.warn('[Ashwini Admin Bootstrap] ADMIN_PASSWORD must be set before the admin account can be created or recovered.');
 }
}catch(e){console.error('[Ashwini Admin Bootstrap]',e.message)}
try{db.exec("ALTER TABLE users ADD COLUMN recovery_otp_hash TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN recovery_otp_expires_at INTEGER DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN delivered_at TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN cancelled_at TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN stock_reserved_at TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN stock_released_at TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN checkout_key TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN razorpay_refund_id TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN refund_status TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN refund_amount INTEGER DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN refund_requested_at TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN dispute_id TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN dispute_status TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN dispute_reason TEXT DEFAULT ''")}catch{}
try{db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_checkout_key ON orders(user_id,checkout_key) WHERE trim(COALESCE(checkout_key,''))<>''")}catch(e){console.error('[Ashwini checkout idempotency]',e.message)}
try{db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_order_id ON orders(razorpay_order_id) WHERE trim(COALESCE(razorpay_order_id,''))<>''")}catch(e){console.error('[Razorpay order uniqueness]',e.message)}
try{db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_payment_id ON orders(razorpay_payment_id) WHERE trim(COALESCE(razorpay_payment_id,''))<>''")}catch(e){console.error('[Razorpay payment uniqueness]',e.message)}
try{db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_refund_id ON orders(razorpay_refund_id) WHERE trim(COALESCE(razorpay_refund_id,''))<>''")}catch(e){console.error('[Razorpay refund uniqueness]',e.message)}
try{db.exec("UPDATE orders SET stock_reserved_at=created_at WHERE COALESCE(stock_reserved_at,'')='' AND COALESCE(stock_released_at,'')='' ")}catch{}
try{db.exec("UPDATE orders SET delivered_at=updated_at WHERE status='DELIVERED' AND COALESCE(delivered_at,'')=''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN replacement_for_order_id INTEGER DEFAULT NULL")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN replacement_for_return_id INTEGER DEFAULT NULL")}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS product_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, user_id INTEGER, question TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS product_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), feedback TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS offers (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '', coupon_code TEXT DEFAULT '', discount_percent REAL DEFAULT 0, banner_url TEXT DEFAULT '', button_text TEXT DEFAULT 'Shop Now', button_action TEXT DEFAULT '', start_at TEXT DEFAULT '', end_at TEXT DEFAULT '', active INTEGER DEFAULT 1, show_popup INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS homepage_slides (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT DEFAULT '', offer_text TEXT DEFAULT '', image_url TEXT NOT NULL, button_text TEXT DEFAULT 'Shop Now', button_action TEXT DEFAULT '', active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec("ALTER TABLE homepage_slides ADD COLUMN offer_text TEXT DEFAULT ''")}catch{}
for(const q of ["ALTER TABLE homepage_slides ADD COLUMN title_color TEXT DEFAULT ''","ALTER TABLE homepage_slides ADD COLUMN title_size INTEGER DEFAULT 0","ALTER TABLE homepage_slides ADD COLUMN offer_color TEXT DEFAULT ''","ALTER TABLE homepage_slides ADD COLUMN offer_size INTEGER DEFAULT 0","ALTER TABLE homepage_slides ADD COLUMN button_background TEXT DEFAULT ''","ALTER TABLE homepage_slides ADD COLUMN button_color TEXT DEFAULT ''","ALTER TABLE homepage_slides ADD COLUMN button_border TEXT DEFAULT ''"]){try{db.exec(q)}catch{}}
try{db.exec(`CREATE TABLE IF NOT EXISTS site_appearance (id INTEGER PRIMARY KEY CHECK(id=1), button_bg TEXT NOT NULL DEFAULT '#CAF0F8', button_text TEXT NOT NULL DEFAULT '#03045E', button_border TEXT NOT NULL DEFAULT '#023EBA', button_font_size INTEGER NOT NULL DEFAULT 15, header_bg TEXT NOT NULL DEFAULT '#321c29', header_text TEXT NOT NULL DEFAULT '#ffffff', nav_bg TEXT NOT NULL DEFAULT '#5a2e40', nav_text TEXT NOT NULL DEFAULT '#ffffff', search_bg TEXT NOT NULL DEFAULT '#ffffff', search_button_bg TEXT NOT NULL DEFAULT '#c9a86a', search_button_text TEXT NOT NULL DEFAULT '#03045E', shop_now_bg TEXT NOT NULL DEFAULT '#CAF0F8', shop_now_text TEXT NOT NULL DEFAULT '#03045E', shop_now_border TEXT NOT NULL DEFAULT '#023EBA', shop_category_bg TEXT NOT NULL DEFAULT '#CAF0F8', shop_category_text TEXT NOT NULL DEFAULT '#03045E', shop_category_border TEXT NOT NULL DEFAULT '#023EBA', quick_filter_bg TEXT NOT NULL DEFAULT '#CAF0F8', quick_filter_text TEXT NOT NULL DEFAULT '#03045E', quick_filter_border TEXT NOT NULL DEFAULT '#023EBA', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
for(const q of ["ALTER TABLE site_appearance ADD COLUMN shop_now_bg TEXT NOT NULL DEFAULT '#CAF0F8'","ALTER TABLE site_appearance ADD COLUMN shop_now_text TEXT NOT NULL DEFAULT '#03045E'","ALTER TABLE site_appearance ADD COLUMN shop_now_border TEXT NOT NULL DEFAULT '#023EBA'","ALTER TABLE site_appearance ADD COLUMN shop_category_bg TEXT NOT NULL DEFAULT '#CAF0F8'","ALTER TABLE site_appearance ADD COLUMN shop_category_text TEXT NOT NULL DEFAULT '#03045E'","ALTER TABLE site_appearance ADD COLUMN shop_category_border TEXT NOT NULL DEFAULT '#023EBA'","ALTER TABLE site_appearance ADD COLUMN quick_filter_bg TEXT NOT NULL DEFAULT '#CAF0F8'","ALTER TABLE site_appearance ADD COLUMN quick_filter_text TEXT NOT NULL DEFAULT '#03045E'","ALTER TABLE site_appearance ADD COLUMN quick_filter_border TEXT NOT NULL DEFAULT '#023EBA'"]){try{db.exec(q)}catch{}}
try{db.exec(`CREATE TABLE IF NOT EXISTS shop_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, icon TEXT DEFAULT '👗', active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS quick_filters (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE, filter_type TEXT NOT NULL DEFAULT 'IN_STOCK', active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{const defaults=[['In stock','IN_STOCK',0],['4 Stars & above','RATING_4',1]];const add=db.prepare('INSERT INTO quick_filters(label,filter_type,active,sort_order) VALUES(?,?,1,?)');for(const [label,type,order] of defaults){if(!db.prepare('SELECT id FROM quick_filters WHERE label=?').get(label))add.run(label,type,order)}}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS product_highlights (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, value TEXT NOT NULL, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{ const defaults=[['Fabric','Premium Feel',0],['Fit','Comfort Fit',1],['Delivery','Fast Dispatch',2]]; const add=db.prepare('INSERT INTO product_highlights(label,value,active,sort_order) VALUES(?,?,?,?)'); for(const [label,value,order] of defaults){const row=db.prepare('SELECT id FROM product_highlights WHERE label=? ORDER BY id LIMIT 1').get(label); if(!row)add.run(label,value,1,order);} }catch{}
try{
 const n=db.prepare('SELECT COUNT(*) c FROM shop_categories').get().c;
 if(!n){
  const add=db.prepare('INSERT INTO shop_categories(name,icon,active,sort_order) VALUES(?,?,?,?)');
  ['Western Dress','Co-ord Set','Skirt & Top','Kurta Set','Formal Ladies & Gents Pants','Sarara','Coat Set','Lehenga','Wedding Gown','Shirts','Party Wear'].forEach((x,i)=>add.run(x,'👗',1,i));
 }
}catch{}
try{
 const n=db.prepare('SELECT COUNT(*) c FROM homepage_slides').get().c;
 if(!n){
  const add=db.prepare('INSERT INTO homepage_slides(title,image_url,button_text,button_action,active,sort_order,offer_text) VALUES(?,?,?,?,?,?,?)');
  [['Slide 1','/ad1-clean.jpg','Shop Now',"shopSlide('All')",''],['Slide 2','/ad2-clean.jpg','Shop Now',"shopSlide('Western Dress')",''],['Slide 3','/ad3-clean.jpg','Shop Now',"shopSlide('Party Wear')",''],['Slide 4','/ad4-clean.jpg','Shop Now',"shopSlide('Co-ord Set')",''],['Slide 5','/ad5-clean-no-button.jpg','Shop Now',"shopSlide('Wedding Gown')",'']].forEach((x,i)=>add.run(x[0],x[1],x[2],x[3],1,i,x[4]));
 }
}catch{}

try{db.exec(`CREATE TABLE IF NOT EXISTS offer_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, offer_id INTEGER, title TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at TEXT DEFAULT '', FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(offer_id) REFERENCES offers(id) ON DELETE SET NULL)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS returns (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, user_id INTEGER NOT NULL, reason TEXT NOT NULL, request_type TEXT NOT NULL DEFAULT 'REPLACEMENT', replacement_size TEXT DEFAULT '', replacement_color TEXT DEFAULT '', pickup_at TEXT DEFAULT '', admin_note TEXT DEFAULT '', replacement_order_id INTEGER DEFAULT NULL, status TEXT NOT NULL DEFAULT 'REQUESTED', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS return_events (id INTEGER PRIMARY KEY AUTOINCREMENT, return_id INTEGER NOT NULL, user_id INTEGER NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(return_id) REFERENCES returns(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, user_id INTEGER NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
for(const q of ["ALTER TABLE returns ADD COLUMN request_type TEXT NOT NULL DEFAULT 'REPLACEMENT'","ALTER TABLE returns ADD COLUMN replacement_size TEXT DEFAULT ''","ALTER TABLE returns ADD COLUMN replacement_color TEXT DEFAULT ''","ALTER TABLE returns ADD COLUMN pickup_at TEXT DEFAULT ''","ALTER TABLE returns ADD COLUMN admin_note TEXT DEFAULT ''","ALTER TABLE returns ADD COLUMN replacement_order_id INTEGER DEFAULT NULL"]){try{db.exec(q)}catch{}}
try{db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec("ALTER TABLE auth_sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE auth_sessions ADD COLUMN device_label TEXT NOT NULL DEFAULT 'Unknown device'")}catch{}
try{db.exec("ALTER TABLE auth_sessions ADD COLUMN absolute_expires_at INTEGER NOT NULL DEFAULT 0")}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS auth_rate_limits (key_hash TEXT PRIMARY KEY,window_start INTEGER NOT NULL,request_count INTEGER NOT NULL DEFAULT 0,last_request INTEGER NOT NULL DEFAULT 0,verify_failures INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL)`);db.prepare('DELETE FROM auth_rate_limits WHERE updated_at<?').run(Date.now()-24*60*60*1000)}catch(e){console.error('[Ashwini auth rate limits]',e.message)}
try{db.exec(`CREATE TABLE IF NOT EXISTS public_rate_limits (key_hash TEXT PRIMARY KEY,bucket TEXT NOT NULL,window_start INTEGER NOT NULL,request_count INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL)`);db.prepare('DELETE FROM public_rate_limits WHERE updated_at<?').run(Date.now()-2*24*60*60*1000)}catch(e){console.error('[Ashwini public rate limits]',e.message)}
try{db.exec(`CREATE TABLE IF NOT EXISTS profile_change_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, old_email TEXT NOT NULL, old_phone TEXT NOT NULL, new_email TEXT NOT NULL, new_phone TEXT NOT NULL, old_email_hash TEXT DEFAULT "", old_email_expires INTEGER DEFAULT 0, new_email_hash TEXT DEFAULT "", new_email_expires INTEGER DEFAULT 0, old_phone_hash TEXT DEFAULT "", old_phone_expires INTEGER DEFAULT 0, new_phone_hash TEXT DEFAULT "", new_phone_expires INTEGER DEFAULT 0, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_help_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, customer_name TEXT NOT NULL DEFAULT '', customer_email TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'NEW', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, seen_at TEXT)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS help_chat_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, guest_token TEXT NOT NULL DEFAULT '', customer_name TEXT NOT NULL DEFAULT 'Guest customer', customer_email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS help_chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, sender_role TEXT NOT NULL CHECK(sender_role IN ('CUSTOMER','ADMIN')), message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, seen_at TEXT, FOREIGN KEY(thread_id) REFERENCES help_chat_threads(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS customer_help_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, contact_method TEXT NOT NULL DEFAULT 'EMAIL', status TEXT NOT NULL DEFAULT 'NEW', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS account_deletion_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS admin_activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,admin_user_id INTEGER,admin_email TEXT NOT NULL DEFAULT '',action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL DEFAULT '',details TEXT NOT NULL DEFAULT '{}',ip_address TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(admin_user_id) REFERENCES users(id) ON DELETE SET NULL); CREATE INDEX IF NOT EXISTS idx_admin_activity_created ON admin_activity_logs(created_at DESC); CREATE INDEX IF NOT EXISTS idx_admin_activity_entity ON admin_activity_logs(entity_type,entity_id);`)}catch(e){console.error('[Admin activity log table]',e.message)}
try{db.exec(`CREATE TABLE IF NOT EXISTS store_profile (id INTEGER PRIMARY KEY CHECK(id=1), about_title TEXT NOT NULL DEFAULT 'About Ashwini Clothing', history TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', pincode TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT 'ashwiniweb88@gmail.com', phone TEXT NOT NULL DEFAULT '', logo_data TEXT NOT NULL DEFAULT '', whatsapp_enabled INTEGER NOT NULL DEFAULT 0, whatsapp_number TEXT NOT NULL DEFAULT '', whatsapp_name TEXT NOT NULL DEFAULT 'Ashwini AI Help Desk', whatsapp_message TEXT NOT NULL DEFAULT 'Hello! 👋 Need help? Chat with us on WhatsApp!', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec("ALTER TABLE store_profile ADD COLUMN logo_data TEXT NOT NULL DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE store_profile ADD COLUMN whatsapp_enabled INTEGER NOT NULL DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE store_profile ADD COLUMN whatsapp_number TEXT NOT NULL DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE store_profile ADD COLUMN whatsapp_name TEXT NOT NULL DEFAULT 'Ashwini AI Help Desk'")}catch{}
try{db.exec("ALTER TABLE store_profile ADD COLUMN whatsapp_message TEXT NOT NULL DEFAULT 'Hello! 👋 Need help? Chat with us on WhatsApp!'")}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS cod_settings (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS cod_state_settings (state TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS behavior_events (id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,user_id INTEGER,event_type TEXT NOT NULL,product_id INTEGER,context_product_id INTEGER,metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_behavior_session_time ON behavior_events(session_id,created_at); CREATE INDEX IF NOT EXISTS idx_behavior_product_type ON behavior_events(product_id,event_type);`)}catch(e){console.error('[Behavior table]',e.message)}
try{db.exec("ALTER TABLE behavior_events ADD COLUMN consent_version TEXT NOT NULL DEFAULT ''")}catch{}
const behaviorRetentionDays=Math.max(30,Math.min(365,Number(process.env.BEHAVIOR_RETENTION_DAYS)||90));
function purgeExpiredBehaviorData(){try{const result=db.prepare("DELETE FROM behavior_events WHERE created_at < datetime('now', ?)").run(`-${behaviorRetentionDays} days`);if(result.changes)console.log(`[Ashwini privacy] Deleted ${result.changes} expired behavior events`)}catch(e){console.error('[Behavior retention]',e.message)}}
purgeExpiredBehaviorData();
const behaviorRetentionTimer=setInterval(purgeExpiredBehaviorData,24*60*60*1000);behaviorRetentionTimer.unref?.();
try{db.exec(`CREATE TABLE IF NOT EXISTS razorpay_webhook_events (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,event_type TEXT NOT NULL,razorpay_order_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'RECEIVED',error TEXT NOT NULL DEFAULT '',received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,processed_at TEXT)`)}catch(e){console.error('[Razorpay webhook table]',e.message)}
try{db.exec(`CREATE TABLE IF NOT EXISTS security_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT,alert_key TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'HIGH',alert_type TEXT NOT NULL,order_id INTEGER,title TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'OPEN',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT DEFAULT '',FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL);CREATE INDEX IF NOT EXISTS idx_security_alert_status_time ON security_alerts(status,created_at);CREATE INDEX IF NOT EXISTS idx_security_alert_key_time ON security_alerts(alert_key,created_at);`)}catch(e){console.error('[Security alert table]',e.message)}
try{db.exec(`CREATE TABLE IF NOT EXISTS delivery_settings (id INTEGER PRIMARY KEY CHECK(id=1), dispatch_city TEXT NOT NULL DEFAULT 'Jandli, Ambala Cantt', dispatch_state TEXT NOT NULL DEFAULT 'Haryana', dispatch_pincode TEXT NOT NULL DEFAULT '134003', same_city_min INTEGER NOT NULL DEFAULT 1, same_city_max INTEGER NOT NULL DEFAULT 2, same_state_min INTEGER NOT NULL DEFAULT 2, same_state_max INTEGER NOT NULL DEFAULT 4, nearby_min INTEGER NOT NULL DEFAULT 3, nearby_max INTEGER NOT NULL DEFAULT 5, rest_min INTEGER NOT NULL DEFAULT 5, rest_max INTEGER NOT NULL DEFAULT 8, remote_min INTEGER NOT NULL DEFAULT 7, remote_max INTEGER NOT NULL DEFAULT 10, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS delivery_blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, block_type TEXT NOT NULL CHECK(block_type IN ('PIN','CITY','STATE')), block_value TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(block_type,block_value))`)}catch{}
try{db.prepare(`INSERT OR IGNORE INTO delivery_settings(id) VALUES(1)`).run()}catch{}
try{db.prepare("INSERT OR IGNORE INTO cod_settings(id,enabled) VALUES(1,1)").run()}catch{}
try{db.prepare("INSERT OR IGNORE INTO site_appearance(id) VALUES(1)").run()}catch{}
try{db.prepare(`INSERT OR IGNORE INTO store_profile(id,about_title,history,address,city,state,pincode,email,phone,logo_data) VALUES(1,?,?,?,?,?,?,?,?,?)`).run('About Ashwini Clothing','Welcome to Ashwini Clothing. Our story and company information can be updated by the store admin.','','','','','ashwiniweb88@gmail.com','', '')}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS product_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, user_id INTEGER, answer TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(question_id) REFERENCES product_questions(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL)`)}catch{}
db.exec(fs.readFileSync(path.join(__dirname,"seed.sql"),"utf8"));
// Keep the Ashwini product photo path correct even if an older database already exists.
db.prepare("UPDATE products SET image=? WHERE id=?").run('/new-model-dress-clean.jpg',100);
const razorpay=process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET
 ? new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;

function releaseOrderStock(orderId,nextStatus){
 return db.transaction(()=>{
  const order=db.prepare("SELECT id,payment_status,stock_released_at FROM orders WHERE id=?").get(orderId);
  if(!order||order.payment_status==='PAID'||String(order.stock_released_at||''))return false;
  const claimed=db.prepare("UPDATE orders SET stock_released_at=CURRENT_TIMESTAMP,status=COALESCE(?,status),updated_at=CURRENT_TIMESTAMP WHERE id=? AND COALESCE(stock_released_at,'')='' AND payment_status<>'PAID'").run(nextStatus||null,order.id);
  if(!claimed.changes)return false;
  const items=db.prepare("SELECT product_id,SUM(quantity) quantity FROM order_items WHERE order_id=? GROUP BY product_id").all(order.id);
  const restore=db.prepare("UPDATE products SET stock=stock+? WHERE id=?");
  for(const item of items)restore.run(Number(item.quantity||0),item.product_id);
  return true;
 })();
}
function restoreCancelledOrderStock(orderId){
 return db.transaction(()=>{
  const order=db.prepare("SELECT id,stock_released_at FROM orders WHERE id=?").get(orderId);
  if(!order||String(order.stock_released_at||''))return false;
  const claimed=db.prepare("UPDATE orders SET stock_released_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND COALESCE(stock_released_at,'')=''").run(order.id);
  if(!claimed.changes)return false;
  const items=db.prepare("SELECT product_id,SUM(quantity) quantity FROM order_items WHERE order_id=? GROUP BY product_id").all(order.id),restore=db.prepare("UPDATE products SET stock=stock+? WHERE id=?");
  for(const item of items)restore.run(Number(item.quantity||0),item.product_id);
  return true;
 })();
}
async function cancelOrderSafely(order){
 if(order.status==='CANCELLED')return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
 if(!['PAYMENT_PENDING','PAYMENT_EXPIRED','PAYMENT_FAILED','PLACED','CONFIRMED','PACKED'].includes(String(order.status)))throw Error('This order can no longer be cancelled because shipping has started');
 if(order.payment_method==='RAZORPAY'&&order.payment_status==='PAID'){
  if(!razorpay||!order.razorpay_payment_id)throw Error('Online refund is not configured for this payment. Please contact Ashwini Support.');
  const claim=db.prepare("UPDATE orders SET refund_status='PROCESSING',refund_requested_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND COALESCE(refund_status,'') IN ('','FAILED')").run(order.id);
  if(!claim.changes){const current=db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);if(['PROCESSING','PENDING','PROCESSED'].includes(String(current.refund_status)))return current;throw Error('This refund could not be started again')}
  try{
   const refund=await razorpay.payments.refund(order.razorpay_payment_id,{amount:Number(order.total)*100,notes:{ashwini_order_id:String(order.id),reason:'Customer order cancellation'}});
   const refundStatus=String(refund.status||'PENDING').toUpperCase(),paymentStatus=refundStatus==='PROCESSED'?'REFUNDED':'REFUND_PENDING';
   db.prepare("UPDATE orders SET status='CANCELLED',payment_status=?,razorpay_refund_id=?,refund_status=?,refund_amount=?,cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(paymentStatus,String(refund.id||''),refundStatus,Math.round(Number(refund.amount||Number(order.total)*100)/100),order.id);
   restoreCancelledOrderStock(order.id);
  }catch(error){db.prepare("UPDATE orders SET refund_status='FAILED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);throw Error(`Refund could not be initiated: ${error?.error?.description||error.message||'Razorpay error'}`)}
 }else{
  db.prepare("UPDATE orders SET status='CANCELLED',payment_status=CASE WHEN payment_status='PAID' THEN payment_status ELSE 'CANCELLED' END,cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
  restoreCancelledOrderStock(order.id);
 }
 return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
}
function reserveReleasedOrderStock(orderId){
 return db.transaction(()=>{
  const order=db.prepare("SELECT id,stock_released_at FROM orders WHERE id=?").get(orderId);
  if(!order)return false;
  if(!String(order.stock_released_at||''))return true;
  const items=db.prepare("SELECT product_id,SUM(quantity) quantity FROM order_items WHERE order_id=? GROUP BY product_id").all(order.id);
  for(const item of items){const product=db.prepare("SELECT stock FROM products WHERE id=?").get(item.product_id);if(!product||Number(product.stock)<Number(item.quantity))return false}
  const deduct=db.prepare("UPDATE products SET stock=stock-? WHERE id=? AND stock>=?");
  for(const item of items){const qty=Number(item.quantity);if(!deduct.run(qty,item.product_id,qty).changes)throw Error('Stock changed while restoring payment reservation')}
  db.prepare("UPDATE orders SET stock_released_at='',stock_reserved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
  return true;
 })();
}
function releaseExpiredPaymentStock(){
 const rows=db.prepare("SELECT id FROM orders WHERE payment_method='RAZORPAY' AND payment_status='PENDING' AND status='PAYMENT_PENDING' AND COALESCE(stock_released_at,'')='' AND datetime(created_at)<=datetime('now','-30 minutes')").all();
 for(const row of rows)if(releaseOrderStock(row.id,'PAYMENT_EXPIRED'))console.info(`[Ashwini stock] Released expired payment reservation for Order #${row.id}`);
}
try{releaseExpiredPaymentStock()}catch(e){console.error('[Ashwini stock expiry]',e.message)}
const stockExpiryTimer=setInterval(()=>{try{releaseExpiredPaymentStock()}catch(e){console.error('[Ashwini stock expiry]',e.message)}},5*60*1000);
stockExpiryTimer.unref?.();

function createSecurityAlert({key,type,title,orderId=null,severity='HIGH',details={}}){
 try{
  const alertKey=String(key||type||'SERVER_ERROR').slice(0,180),safeDetails=JSON.stringify(details,(k,v)=>/secret|token|signature|password/i.test(k)?'[REDACTED]':v).slice(0,4000);
  const duplicate=db.prepare("SELECT id FROM security_alerts WHERE alert_key=? AND status='OPEN' AND created_at>=datetime('now','-15 minutes') ORDER BY id DESC LIMIT 1").get(alertKey);
  if(duplicate)return duplicate.id;
  const result=db.prepare('INSERT INTO security_alerts(alert_key,severity,alert_type,order_id,title,details) VALUES(?,?,?,?,?,?)').run(alertKey,String(severity).slice(0,20),String(type||'SERVER_ERROR').slice(0,80),Number(orderId)||null,String(title||'Ashwini security alert').slice(0,240),safeDetails);
  const id=Number(result.lastInsertRowid),orderText=orderId?`\nOrder: #${orderId}`:'';
  Promise.resolve(sendEmail(adminEmail(),`[${severity}] Ashwini Alert #${id}: ${title}`,`A security/operations alert needs review.${orderText}\nType: ${type}\nDetails: ${safeDetails}\n\nOpen Admin > Security Alerts.`)).catch(error=>console.error('[Security alert email]',error.message));
  return id;
 }catch(error){console.error('[Security alert]',error.message);return null}
}

// Razorpay must be verified against the untouched request bytes. Keep this
// route before express.json(), otherwise signature validation is unreliable.
app.post('/api/webhooks/razorpay',express.raw({type:'application/json',limit:'1mb'}),(req,res)=>{
 const secret=String(process.env.RAZORPAY_WEBHOOK_SECRET||''),signature=String(req.headers['x-razorpay-signature']||''),raw=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||'');
 if(!secret)return res.status(503).json({error:'Razorpay webhook is not configured'});
 const expected=crypto.createHmac('sha256',secret).update(raw).digest('hex');
 const valid=/^[a-f0-9]{64}$/i.test(signature)&&crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex'));
 if(!valid)return res.status(401).json({error:'Invalid webhook signature'});
 let event;
 try{event=JSON.parse(raw.toString('utf8'))}catch{return res.status(400).json({error:'Invalid webhook payload'})}
 const eventId=String(req.headers['x-razorpay-event-id']||event.id||crypto.createHash('sha256').update(raw).digest('hex')).slice(0,160);
 const eventType=String(event.event||'unknown').slice(0,80);
 const payment=event.payload?.payment?.entity||null,orderEntity=event.payload?.order?.entity||null,refund=event.payload?.refund?.entity||null,dispute=event.payload?.dispute?.entity||null;
 const razorpayOrderId=String(payment?.order_id||orderEntity?.id||'');
 const inserted=db.prepare('INSERT OR IGNORE INTO razorpay_webhook_events(event_id,event_type,razorpay_order_id) VALUES(?,?,?)').run(eventId,eventType,razorpayOrderId);
 if(!inserted.changes){
  const previous=db.prepare('SELECT status FROM razorpay_webhook_events WHERE event_id=?').get(eventId);
  if(previous?.status!=='ERROR')return res.json({ok:true,duplicate:true});
  const retry=db.prepare("UPDATE razorpay_webhook_events SET status='RECEIVED',error='',processed_at=NULL WHERE event_id=? AND status='ERROR'").run(eventId);
  if(!retry.changes)return res.json({ok:true,duplicate:true});
 }
 try{
  const finish=(status,error='')=>db.prepare('UPDATE razorpay_webhook_events SET status=?,error=?,processed_at=CURRENT_TIMESTAMP WHERE event_id=?').run(status,String(error).slice(0,500),eventId);
  const paymentEvents=['payment.captured','order.paid','payment.failed'],refundEvents=['refund.created','refund.processed','refund.failed'],disputeEvents=['payment.dispute.created','payment.dispute.won','payment.dispute.lost','payment.dispute.closed'];
  if(![...paymentEvents,...refundEvents,...disputeEvents].includes(eventType)){finish('IGNORED');return res.json({ok:true,ignored:true})}
  const relatedPaymentId=String(refund?.payment_id||dispute?.payment_id||payment?.id||'');
  const order=razorpayOrderId?db.prepare("SELECT * FROM orders WHERE razorpay_order_id=? AND payment_method='RAZORPAY'").get(razorpayOrderId):db.prepare("SELECT * FROM orders WHERE payment_method='RAZORPAY' AND (razorpay_payment_id=? OR razorpay_refund_id=?)").get(relatedPaymentId,String(refund?.id||''));
  if(!order){finish('REJECTED','Matching Ashwini order was not found');createSecurityAlert({key:`PAYMENT_ORDER_NOT_FOUND:${razorpayOrderId||relatedPaymentId}`,type:'PAYMENT_ORDER_MISMATCH',title:'Razorpay payment has no matching Ashwini order',severity:'CRITICAL',details:{event_id:eventId,event_type:eventType,razorpay_order_id:razorpayOrderId,payment_id:relatedPaymentId}});return res.json({ok:true,matched:false})}
  if(refundEvents.includes(eventType)){
   const refundStatus=eventType==='refund.processed'?'PROCESSED':eventType==='refund.failed'?'FAILED':String(refund?.status||'PENDING').toUpperCase(),paymentStatus=refundStatus==='PROCESSED'?'REFUNDED':refundStatus==='FAILED'?'REFUND_FAILED':'REFUND_PENDING';
   db.prepare("UPDATE orders SET razorpay_refund_id=COALESCE(NULLIF(?,''),razorpay_refund_id),refund_status=?,refund_amount=CASE WHEN ?>0 THEN ? ELSE refund_amount END,payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(refund?.id||''),refundStatus,Number(refund?.amount||0),Math.round(Number(refund?.amount||0)/100),paymentStatus,order.id);
   finish('PROCESSED');return res.json({ok:true,refund:true});
  }
  if(disputeEvents.includes(eventType)){
   const disputeStatus=eventType.split('.').pop().toUpperCase(),paymentStatus=disputeStatus==='CREATED'?'DISPUTED':disputeStatus==='LOST'?'DISPUTE_LOST':'PAID';
   db.prepare("UPDATE orders SET dispute_id=COALESCE(NULLIF(?,''),dispute_id),dispute_status=?,dispute_reason=?,payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(dispute?.id||''),disputeStatus,String(dispute?.reason_code||dispute?.reason||'').slice(0,200),paymentStatus,order.id);
   finish('PROCESSED');return res.json({ok:true,dispute:true});
  }
  const paidAmount=Number(payment?.amount??orderEntity?.amount_paid??orderEntity?.amount);
  const currency=String(payment?.currency||orderEntity?.currency||'INR').toUpperCase();
  if(!Number.isFinite(paidAmount)||paidAmount!==Number(order.total)*100||currency!=='INR'){finish('REJECTED','Payment amount or currency did not match the Ashwini order');createSecurityAlert({key:`PAYMENT_AMOUNT_MISMATCH:${order.id}:${eventId}`,type:'PAYMENT_AMOUNT_MISMATCH',title:'Razorpay amount/currency does not match order',orderId:order.id,severity:'CRITICAL',details:{event_id:eventId,event_type:eventType,expected_amount_paise:Number(order.total)*100,received_amount_paise:paidAmount,expected_currency:'INR',received_currency:currency}});return res.json({ok:true,matched:false})}
  if(eventType==='payment.failed'){
   if(order.payment_status!=='PAID'){db.prepare("UPDATE orders SET payment_status='FAILED',status=CASE WHEN status IN ('PAYMENT_PENDING','PAYMENT_EXPIRED') THEN 'PAYMENT_FAILED' ELSE status END,razorpay_payment_id=COALESCE(NULLIF(?,''),razorpay_payment_id),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(payment?.id||''),order.id);releaseOrderStock(order.id,'PAYMENT_FAILED')}
  }else{
   if(!reserveReleasedOrderStock(order.id)){db.prepare("UPDATE orders SET status='PAYMENT_REVIEW',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);finish('REJECTED','Payment captured after reservation expired, but stock is no longer available');createSecurityAlert({key:`PAID_STOCK_MISMATCH:${order.id}`,type:'PAID_ORDER_STOCK_MISMATCH',title:'Paid order requires refund/review because stock is unavailable',orderId:order.id,severity:'CRITICAL',details:{event_id:eventId,event_type:eventType,payment_id:String(payment?.id||''),order_status:order.status,payment_status:order.payment_status}});console.error(`[Razorpay webhook] PAID Order #${order.id} requires refund/review because stock is unavailable`);return res.json({ok:true,review:true})}
   db.prepare("UPDATE orders SET payment_status='PAID',status=CASE WHEN status IN ('PAYMENT_PENDING','PAYMENT_FAILED','PAYMENT_EXPIRED') THEN 'CONFIRMED' ELSE status END,razorpay_payment_id=COALESCE(NULLIF(?,''),razorpay_payment_id),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(payment?.id||''),order.id);
  }
  finish('PROCESSED');res.json({ok:true});
 }catch(e){db.prepare("UPDATE razorpay_webhook_events SET status='ERROR',error=? WHERE event_id=?").run(String(e.message||e).slice(0,500),eventId);createSecurityAlert({key:`WEBHOOK_ERROR:${eventId}`,type:'PAYMENT_WEBHOOK_ERROR',title:'Razorpay webhook processing failed',severity:'CRITICAL',details:{event_id:eventId,event_type:eventType,error:String(e.message||e).slice(0,500)}});console.error('[Razorpay webhook]',e.message);res.status(500).json({error:'Webhook processing failed'})}
});

const allowedOrigins=new Set([
  'https://ashwiniweb.com',
  'https://www.ashwiniweb.com',
  String(process.env.PUBLIC_SITE_URL||'').replace(/\/$/,''),
  ...String(process.env.ALLOWED_ORIGINS||'').split(',').map(value=>value.trim().replace(/\/$/,'')).filter(Boolean),
  ...(process.env.NODE_ENV==='production'?[]:['http://localhost:10000','http://127.0.0.1:10000'])
].filter(Boolean));
app.use((req,res,next)=>{
  const csp=[
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://verify.msg91.com https://verify.phone91.com",
    "script-src-attr 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.bigdatacloud.net https://*.razorpay.com https://*.msg91.com https://*.phone91.com wss://*.razorpay.com wss://*.msg91.com wss://*.phone91.com",
    "frame-src https://*.razorpay.com https://*.msg91.com https://*.phone91.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    ...(process.env.NODE_ENV==='production'?["upgrade-insecure-requests"]:[])
  ].join('; ');
  res.setHeader('Content-Security-Policy',csp);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(self), microphone=(self), geolocation=(self), payment=(self)');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(req.secure||String(req.headers['x-forwarded-proto']||'').toLowerCase()==='https')res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  next();
});
app.use((req,res,next)=>{
  const origin=String(req.headers.origin||'').replace(/\/$/,'');
  if(origin&&!allowedOrigins.has(origin))return res.status(403).json({error:'Origin is not allowed'});
  next();
});
app.use(cors({origin:(origin,done)=>done(null,!origin||allowedOrigins.has(String(origin).replace(/\/$/,''))),credentials:true,methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Idempotency-Key']}));
const standardJsonParser=express.json({limit:'256kb'});
const imageJsonParser=express.json({limit:'20mb'});
function isImagePayloadRoute(pathname=''){
  return pathname==='/api/visual-search'
    || pathname==='/api/admin/store-profile'
    || pathname==='/api/admin/offers' || pathname.startsWith('/api/admin/offers/')
    || pathname==='/api/admin/slides' || pathname.startsWith('/api/admin/slides/')
    || pathname==='/api/admin/products' || pathname.startsWith('/api/admin/products/');
}
app.use((req,res,next)=>(isImagePayloadRoute(req.path)?imageJsonParser:standardJsonParser)(req,res,next));
app.use((req,res,next)=>{res.on('finish',()=>{if(req.path.startsWith('/api/')&&res.statusCode>=500)createSecurityAlert({key:`API_5XX:${req.method}:${req.path}:${res.statusCode}`,type:'SERVER_API_ERROR',title:'Server API returned an internal error',severity:'HIGH',details:{method:req.method,path:String(req.path).slice(0,240),status_code:res.statusCode}})});next()});
app.use((err,req,res,next)=>{
  if(err?.type==='entity.too.large')return res.status(413).json({error:'Request is too large'});
  if(err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err,'body'))return res.status(400).json({error:'Invalid JSON request'});
  next(err);
});

// Do not expose the project directory. Only customer-facing files are public;
// server source, SQL, database, environment, deployment and documentation
// files must never be downloadable from the website.
const publicCssFiles=new Set(['/mobile-rebuild-v3.css','/mobile-header.css','/desktop-search-fix.css','/lens-camera.css','/visual-search.css','/recommendations.css','/legal.css']);
const publicPolicyFiles=new Set(['/privacy-policy.html','/terms.html','/shipping-policy.html','/cancellation-policy.html','/refund-policy.html']);
function sendPublicFile(res,fileName){res.sendFile(path.join(__dirname,fileName),err=>{if(err&&!res.headersSent)res.status(err.statusCode===404?404:500).end()})}
app.get(['/', '/index.html'],(req,res)=>sendPublicFile(res,'index.html'));
app.get('/app.js',(req,res)=>sendPublicFile(res,'app.js'));
app.get([...publicCssFiles],(req,res)=>sendPublicFile(res,req.path.slice(1)));
app.get([...publicPolicyFiles],(req,res)=>sendPublicFile(res,req.path.slice(1)));
app.get(/^\/[^/]+\.(?:png|jpe?g|webp|gif|svg|ico)$/i,(req,res)=>sendPublicFile(res,req.path.slice(1)));

// Persist rate limits in SQLite so a Render restart cannot clear an attacker's
// OTP request or verification-attempt counters.
function clientIp(req){return String(req.ip||req.socket.remoteAddress||"unknown").trim();}
function otpKey(req,identifier){return crypto.createHash('sha256').update(clientIp(req)+"|"+String(identifier||"").trim().toLowerCase()).digest('hex');}
function otpDestinationKey(identifier){return crypto.createHash('sha256').update('OTP_DESTINATION|'+String(identifier||'').trim().toLowerCase()).digest('hex')}
function freshOtpLimit(now=Date.now()){return {window_start:now,request_count:0,last_request:0,verify_failures:0,updated_at:now}}
function readOtpLimit(key,now=Date.now(),windowMs=15*60*1000){
 const row=db.prepare('SELECT * FROM auth_rate_limits WHERE key_hash=?').get(key);
 return !row||now-Number(row.window_start)>windowMs?freshOtpLimit(now):row;
}
function saveOtpLimit(key,x){db.prepare(`INSERT INTO auth_rate_limits(key_hash,window_start,request_count,last_request,verify_failures,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET window_start=excluded.window_start,request_count=excluded.request_count,last_request=excluded.last_request,verify_failures=excluded.verify_failures,updated_at=excluded.updated_at`).run(key,x.window_start,x.request_count,x.last_request,x.verify_failures,x.updated_at)}
function otpGuard(req,res,identifier,kind="request") {
 const key=otpKey(req,identifier),destinationKey=otpDestinationKey(identifier),now=Date.now(),windowMs=15*60*1000,destinationWindowMs=60*60*1000,cooldown=45*1000,max=5,destinationMax=10;
 const x=readOtpLimit(key,now,windowMs),destination=readOtpLimit(destinationKey,now,destinationWindowMs);
 if(kind==="request"&&now-Number(x.last_request)<cooldown){res.status(429).json({error:`Please wait ${Math.ceil((cooldown-(now-Number(x.last_request)))/1000)} seconds before requesting another OTP.`});return false}
 if(kind==="request"&&Number(x.request_count)>=max){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((windowMs-(now-Number(x.window_start)))/1000))));res.status(429).json({error:"Too many OTP requests. Please try again later."});return false}
 if(kind==="request"&&Number(destination.request_count)>=destinationMax){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((destinationWindowMs-(now-Number(destination.window_start)))/1000))));res.status(429).json({error:"Too many OTP requests for this destination. Please try again later."});return false}
 if(kind==="request"){x.request_count=Number(x.request_count)+1;x.last_request=now;x.updated_at=now;destination.request_count=Number(destination.request_count)+1;destination.last_request=now;destination.updated_at=now;db.transaction(()=>{saveOtpLimit(key,x);saveOtpLimit(destinationKey,destination)})();}
 return true;
}
function otpVerifyGuard(req,res,identifier,blockedMessage="Too many incorrect sign-in attempts. Please wait 15 minutes before trying again."){
 const key=otpKey(req,identifier), x=readOtpLimit(key);
 if(Number(x.verify_failures)>=5){res.status(429).json({error:blockedMessage});return false}
 return true;
}
function recordOtpFailure(req,identifier){const key=otpKey(req,identifier),now=Date.now(),x=readOtpLimit(key,now);x.verify_failures=Number(x.verify_failures)+1;x.updated_at=now;saveOtpLimit(key,x)}
function clearOtpFailures(req,identifier){const key=otpKey(req,identifier),now=Date.now(),x=readOtpLimit(key,now);x.verify_failures=0;x.updated_at=now;saveOtpLimit(key,x)}
function publicWriteAllowed(req,res,bucket,max,windowMs,identity='',includeIp=true){
 try{
  const now=Date.now(),raw=`${bucket}|${includeIp?clientIp(req):'GLOBAL'}|${String(identity||'').slice(0,120)}`,key=crypto.createHash('sha256').update(raw).digest('hex');
  let row=db.prepare('SELECT window_start,request_count FROM public_rate_limits WHERE key_hash=?').get(key);
  if(!row||now-Number(row.window_start)>=windowMs)row={window_start:now,request_count:0};
  if(Number(row.request_count)>=max){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((windowMs-(now-Number(row.window_start)))/1000))));res.status(429).json({error:'Too many requests. Please wait and try again.'});return false}
  db.prepare(`INSERT INTO public_rate_limits(key_hash,bucket,window_start,request_count,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET bucket=excluded.bucket,window_start=excluded.window_start,request_count=excluded.request_count,updated_at=excluded.updated_at`).run(key,bucket,row.window_start,Number(row.request_count)+1,now);
  return true;
 }catch(error){console.error('[Public rate limit]',error.message);res.status(503).json({error:'Request protection is temporarily unavailable.'});return false}
}
app.use((req,res,next)=>{
 if(req.method==='GET'&&req.path==='/api/help-chat'&&!publicWriteAllowed(req,res,'HELP_CHAT_OPEN',30,60*60*1000))return;
 if(req.method==='POST'&&req.path==='/api/help-chat/messages'){
  if(!publicWriteAllowed(req,res,'HELP_CHAT_IP',60,15*60*1000))return;
  const thread=getHelpThread(req);if(thread&&!publicWriteAllowed(req,res,'HELP_CHAT_THREAD',120,60*60*1000,String(thread.id),false))return;
 }
 if(req.method==='POST'&&req.path==='/api/behavior-events'){
  const sessionId=String(req.body?.session_id||'');
  if(!publicWriteAllowed(req,res,'BEHAVIOR_IP',300,15*60*1000)||!publicWriteAllowed(req,res,'BEHAVIOR_SESSION',120,15*60*1000,sessionId))return;
 }
 if(req.method==='POST'&&req.path==='/api/visual-search'){
  if(!publicWriteAllowed(req,res,'VISUAL_SEARCH_BURST',3,5*60*1000)||!publicWriteAllowed(req,res,'VISUAL_SEARCH_DAILY',20,24*60*60*1000))return;
 }
 if(req.method==='POST'&&req.path==='/api/auth/verify-msg91-login'&&!publicWriteAllowed(req,res,'MSG91_LOGIN_VERIFY',10,15*60*1000))return;
 if(req.method==='POST'&&req.path==='/api/auth/verify-msg91-admin-login'&&!publicWriteAllowed(req,res,'MSG91_ADMIN_VERIFY',10,15*60*1000))return;
 if(req.method==='POST'&&req.path==='/api/auth/request-msg91-registration'&&!publicWriteAllowed(req,res,'REGISTRATION_START',10,60*60*1000))return;
 if(req.method==='POST'&&req.path==='/api/auth/register-msg91'&&!publicWriteAllowed(req,res,'REGISTRATION_VERIFY',10,60*60*1000))return;
 next();
});
function publicOtpResponse(otp,channel,message){const dev=process.env.NODE_ENV!=="production" || String(process.env.SHOW_DEV_OTP||"").toLowerCase()==="true";return {ok:true,channel,message,...(dev?{devOtp:otp}:{})};}
async function sendSmsOtp(to,otp){
 const provider=String(process.env.SMS_PROVIDER||"").trim().toLowerCase();
 if(!provider)return {sent:false,configured:false,error:"SMS provider is not configured"};
 if(provider==="twilio"){
  const sid=process.env.TWILIO_ACCOUNT_SID, auth=process.env.TWILIO_AUTH_TOKEN, from=process.env.TWILIO_FROM;
  if(!sid||!auth||!from)return {sent:false,configured:false,error:"Twilio SMS is not configured"};
  const body=new URLSearchParams({To:`+91${String(to).replace(/\D/g,"")}`,From:from,Body:`Ashwini Clothing OTP: ${otp}. It expires in 5 minutes. Do not share this OTP.`});
  const basic=Buffer.from(`${sid}:${auth}`).toString("base64");
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded"},body});
  if(!r.ok)throw new Error(await r.text());
  return {sent:true,configured:true,provider:"twilio"};
 }
 return {sent:false,configured:false,error:`Unsupported SMS provider: ${provider}`};
}
function sessionHash(value){return crypto.createHash("sha256").update(String(value)).digest("hex")}
// Keep password-check cost similar when an unknown admin identifier is tried,
// so response timing does not disclose whether the private admin account exists.
const dummyAdminPasswordHash=bcrypt.hashSync(crypto.randomBytes(24).toString('hex'),12);
function setSessionCookie(res,raw){res.setHeader("Set-Cookie",`ashwini_session=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionTtlDays*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`)}
function clearSessionCookie(res){res.setHeader("Set-Cookie","ashwini_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")}
function sessionDeviceLabel(userAgent=''){const ua=String(userAgent);const browser=/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/Chrome\//.test(ua)?'Chrome':/Firefox\//.test(ua)?'Firefox':/Safari\//.test(ua)?'Safari':'Browser';const device=/Android/i.test(ua)?'Android phone':/iPhone/i.test(ua)?'iPhone':/iPad/i.test(ua)?'iPad':/Windows/i.test(ua)?'Windows computer':/Macintosh|Mac OS/i.test(ua)?'Mac computer':/Linux/i.test(ua)?'Linux device':'Device';return `${browser} on ${device}`}
const sessionTtlDays=Math.max(1,Math.min(30,Number(process.env.SESSION_TTL_DAYS)||7)),sessionTtlMs=sessionTtlDays*24*60*60*1000;
const sessionAbsoluteTtlDays=Math.max(sessionTtlDays,Math.min(90,Number(process.env.SESSION_ABSOLUTE_TTL_DAYS)||30)),sessionAbsoluteTtlMs=sessionAbsoluteTtlDays*24*60*60*1000;
const maxSessionsPerUser=Math.max(1,Math.min(20,Number(process.env.MAX_ACTIVE_SESSIONS)||10));
try{db.prepare("UPDATE auth_sessions SET absolute_expires_at=? WHERE absolute_expires_at<=0").run(Date.now()+sessionAbsoluteTtlMs)}catch(e){console.error('[Session absolute expiry migration]',e.message)}
function createSession(req,res,userId){const raw=crypto.randomBytes(32).toString("base64url"),hash=sessionHash(raw),now=Date.now(),exp=now+sessionTtlMs,absoluteExp=now+sessionAbsoluteTtlMs,ua=String(req?.headers?.['user-agent']||'').slice(0,500);const create=db.transaction(()=>{db.prepare("DELETE FROM auth_sessions WHERE expires_at<? OR absolute_expires_at<?").run(now,now);db.prepare("INSERT INTO auth_sessions(session_hash,user_id,expires_at,absolute_expires_at,last_seen_at,user_agent,device_label) VALUES(?,?,?,?,?,?,?)").run(hash,userId,exp,absoluteExp,now,ua,sessionDeviceLabel(ua));db.prepare("DELETE FROM auth_sessions WHERE user_id=? AND id NOT IN (SELECT id FROM auth_sessions WHERE user_id=? ORDER BY last_seen_at DESC,id DESC LIMIT ?)").run(userId,userId,maxSessionsPerUser)});create();setSessionCookie(res,raw);return raw}
function readCookie(req,name){const raw=String(req.headers.cookie||"");for(const part of raw.split(";")){const [k,...v]=part.trim().split("=");if(k===name)return decodeURIComponent(v.join("="));}return ""}
function auth(req,res,next){
 try{
  const raw=readCookie(req,"ashwini_session");let u=null;
   if(raw){const s=db.prepare("SELECT id,user_id,expires_at,absolute_expires_at FROM auth_sessions WHERE session_hash=?").get(sessionHash(raw));const now=Date.now();if(s&&Number(s.expires_at)>now&&Number(s.absolute_expires_at)>now){u=db.prepare("SELECT id,name,email,role,phone FROM users WHERE id=?").get(s.user_id);if(u){req.sessionId=Number(s.id);const newExp=Math.min(now+sessionTtlMs,Number(s.absolute_expires_at));db.prepare("UPDATE auth_sessions SET last_seen_at=?,expires_at=? WHERE session_hash=?").run(now,newExp,sessionHash(raw));setSessionCookie(res,raw);}else db.prepare("DELETE FROM auth_sessions WHERE session_hash=?").run(sessionHash(raw));}else if(s)db.prepare("DELETE FROM auth_sessions WHERE id=?").run(s.id)}
  if(!u)return res.status(401).json({error:"Login required. Please sign in again."});
  req.user=u;
  if(req.method==='POST'&&req.path==='/api/me/profile-change/request'){
   if(!publicWriteAllowed(req,res,'PROFILE_CHANGE_REQUEST',5,60*60*1000,String(u.id)))return;
   const account=db.prepare('SELECT email,phone FROM users WHERE id=?').get(u.id)||{},newEmail=String(req.body?.email||account.email||'').trim().toLowerCase(),newPhone=normalizePhone(req.body?.phone||account.phone),targets=[];
   if(newEmail&&newEmail!==String(account.email||'').toLowerCase())targets.push(account.email,newEmail);
   if(newPhone&&newPhone!==String(account.phone||''))targets.push(account.phone,newPhone);
   for(const target of new Set(targets.filter(Boolean)))if(!otpGuard(req,res,`PROFILE_CHANGE:${target}`))return;
  }
  next();
 }catch{res.status(401).json({error:"Login required. Please sign in again."})}
}
function admin(req,res,next){if(req.user?.role!=="admin")return res.status(403).json({error:"Admin only"});next()}
function logAdminActivity(req,action,entityType,entityId,details={}){try{const safeDetails=JSON.stringify(details,(key,value)=>/password|secret|token|signature/i.test(key)?'[REDACTED]':value).slice(0,4000);db.prepare('INSERT INTO admin_activity_logs(admin_user_id,admin_email,action,entity_type,entity_id,details,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,?)').run(req.user?.id||null,String(req.user?.email||'').slice(0,200),String(action).slice(0,80),String(entityType).slice(0,80),String(entityId??'').slice(0,100),safeDetails,clientIp(req).slice(0,100),String(req.headers['user-agent']||'').slice(0,500))}catch(e){console.error('[Admin activity log]',e.message)}}
async function sendEmail(to,subject,text,html){
 const provider=String(process.env.EMAIL_PROVIDER||'resend').trim().toLowerCase();
 const from=process.env.EMAIL_FROM||'Ashwini Clothing <onboarding@resend.dev>';
 const shopUrl=String(process.env.PUBLIC_SITE_URL||'https://ashwiniweb.com').replace(/\/$/,'');
 if(!to)return {sent:false,configured:false,error:'Recipient email is missing'};
 const safeHtml=html||`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#30252a;max-width:560px;margin:auto"><h2 style="color:#5a2e40">Ashwini Clothing</h2><p>${String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p><p style="margin-top:24px"><a href="${shopUrl}" style="display:inline-block;padding:12px 24px;border-radius:7px;background:#5a2e40;color:#fff;text-decoration:none;font-weight:700">Shop Now</a></p><p style="font-size:12px;color:#777">If the button does not open, visit ${shopUrl}</p></div>`;
 try{
  if(provider==='smtp'){
   const nodemailer=(await import('nodemailer')).default;
   const host=process.env.SMTP_HOST,port=Number(process.env.SMTP_PORT||465),user=process.env.SMTP_USER,pass=process.env.SMTP_PASS;
   if(!host||!user||!pass)return {sent:false,configured:false,error:'SMTP email is not configured. Add SMTP_HOST, SMTP_USER and SMTP_PASS.'};
   const transporter=nodemailer.createTransport({host,port,secure:String(process.env.SMTP_SECURE||'true').toLowerCase()==='true',auth:{user,pass}});
   await transporter.sendMail({from,to,subject,text,html:safeHtml});
   return {sent:true,configured:true,provider:'smtp'};
  }
  const key=process.env.RESEND_API_KEY;
  if(!key)return {sent:false,configured:false,error:'Resend email is not configured. Add RESEND_API_KEY.'};
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to,subject,text,html:safeHtml})});
  if(!r.ok)throw new Error(await r.text());
  return {sent:true,configured:true,provider:'resend'};
 }catch(e){
  console.error('[Ashwini Email]',e.message);
  return {sent:false,configured:true,error:e.message};
 }
}
function adminEmail(){return process.env.ADMIN_EMAIL||db.prepare('SELECT email FROM store_profile WHERE id=1').get()?.email||'ashwiniweb88@gmail.com'}
async function notifyEmail(to,subject,details){
 const result=await sendEmail(to,subject,`Ashwini Clothing\n\n${details}\n\nFor help, contact ${adminEmail()}.`);
 if(!result.sent)console.warn(`[Ashwini Email] ${to} was not notified: ${result.error||'unknown error'}`);
 return result;
}
async function sendReturnEmail(to,subject,details){return notifyEmail(to,subject,details)}
function addReturnEvent(returnId,userId,status,title,message){try{db.prepare('INSERT INTO return_events(return_id,user_id,status,title,message) VALUES(?,?,?,?,?)').run(returnId,userId,status,title,message)}catch(e){console.error('[return event]',e.message)}}
function addOrderEvent(orderId,userId,status,title,message){try{db.prepare('INSERT INTO order_events(order_id,user_id,status,title,message) VALUES(?,?,?,?,?)').run(orderId,userId,status,title,message)}catch(e){console.error('[order event]',e.message)}}
try{const rs=db.prepare(`SELECT r.id,r.user_id,r.status,r.order_id,r.created_at,r.pickup_at,r.admin_note FROM returns r LEFT JOIN return_events e ON e.return_id=r.id WHERE e.id IS NULL`).all();const ins=db.prepare('INSERT INTO return_events(return_id,user_id,status,title,message,created_at) VALUES(?,?,?,?,?,?)');for(const r of rs){ins.run(r.id,r.user_id,r.status,`Return ${String(r.status).replaceAll('_',' ')}`,`Return request #${r.id} for Order #${r.order_id} is ${String(r.status).replaceAll('_',' ')}.${r.pickup_at?` Pickup scheduled for ${r.pickup_at}.`:''}${r.admin_note?` Admin note: ${r.admin_note}.`:''}`,r.created_at)}}catch{}

app.get('/api/admin/email-status',auth,admin,(req,res)=>{
 const provider=String(process.env.EMAIL_PROVIDER||'resend').toLowerCase();
 const configured=provider==='smtp' ? !!(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS) : !!process.env.RESEND_API_KEY;
 res.json({provider,configured,admin_email:adminEmail(),from:process.env.EMAIL_FROM||'Ashwini Clothing <onboarding@resend.dev>'});
});
app.get("/api/store-profile",(req,res)=>{const x=db.prepare("SELECT * FROM store_profile WHERE id=1").get()||{};const {whatsapp_number,...safe}=x;res.json(safe)});
const appearanceKeys=['button_bg','button_text','button_border','header_bg','header_text','nav_bg','nav_text','search_bg','search_button_bg','search_button_text','shop_now_bg','shop_now_text','shop_now_border','shop_category_bg','shop_category_text','shop_category_border','quick_filter_bg','quick_filter_text','quick_filter_border'];
function appearanceColor(value,fallback){const x=String(value||fallback).trim();if(!/^#[0-9a-fA-F]{6}$/.test(x))throw Error('Choose a valid colour');return x}
app.get('/api/appearance',(req,res)=>res.json(db.prepare('SELECT * FROM site_appearance WHERE id=1').get()||{}));
app.patch('/api/admin/appearance',auth,admin,(req,res)=>{try{const b=req.body||{},current=db.prepare('SELECT * FROM site_appearance WHERE id=1').get()||{};const colors={};for(const key of appearanceKeys)colors[key]=appearanceColor(b[key],current[key]);const size=Math.max(11,Math.min(24,Number(b.button_font_size||current.button_font_size||15)));if(!Number.isFinite(size))throw Error('Enter a valid button text size');db.prepare(`UPDATE site_appearance SET button_bg=?,button_text=?,button_border=?,button_font_size=?,header_bg=?,header_text=?,nav_bg=?,nav_text=?,search_bg=?,search_button_bg=?,search_button_text=?,shop_now_bg=?,shop_now_text=?,shop_now_border=?,shop_category_bg=?,shop_category_text=?,shop_category_border=?,quick_filter_bg=?,quick_filter_text=?,quick_filter_border=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(colors.button_bg,colors.button_text,colors.button_border,Math.round(size),colors.header_bg,colors.header_text,colors.nav_bg,colors.nav_text,colors.search_bg,colors.search_button_bg,colors.search_button_text,colors.shop_now_bg,colors.shop_now_text,colors.shop_now_border,colors.shop_category_bg,colors.shop_category_text,colors.shop_category_border,colors.quick_filter_bg,colors.quick_filter_text,colors.quick_filter_border);res.json(db.prepare('SELECT * FROM site_appearance WHERE id=1').get())}catch(e){res.status(400).json({error:e.message})}});
app.get("/api/whatsapp-help",(req,res)=>{res.redirect(302,"/");});

function currentHelpCustomer(req){
 let u=null;
 try{const raw=readCookie(req,"ashwini_session");if(raw){const ss=db.prepare("SELECT user_id,expires_at,absolute_expires_at FROM auth_sessions WHERE session_hash=?").get(sessionHash(raw)),now=Date.now();if(ss&&Number(ss.expires_at)>now&&Number(ss.absolute_expires_at)>now)u=db.prepare("SELECT id,name,email FROM users WHERE id=? AND role='customer'").get(ss.user_id)}}catch{}
 return u;
}
function helpGuestToken(req){return String(readCookie(req,"ashwini_help_chat")||"").trim();}
function setHelpGuestCookie(res,token){res.setHeader("Set-Cookie",`ashwini_help_chat=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${process.env.NODE_ENV==='production'?'; Secure':''}`)}
function getHelpThread(req){const u=currentHelpCustomer(req),guest=helpGuestToken(req);if(u){return db.prepare("SELECT * FROM help_chat_threads WHERE user_id=? ORDER BY id DESC LIMIT 1").get(u.id)||null}if(guest){return db.prepare("SELECT * FROM help_chat_threads WHERE guest_token=? ORDER BY id DESC LIMIT 1").get(guest)||null}return null}
app.get('/api/help-chat',(req,res)=>{try{const sp=db.prepare("SELECT whatsapp_enabled,whatsapp_name,whatsapp_message FROM store_profile WHERE id=1").get()||{};if(Number(sp.whatsapp_enabled)!==1)return res.status(404).json({error:'Ashwini Help Desk is currently unavailable.'});let thread=getHelpThread(req);const u=currentHelpCustomer(req);if(!thread){const guest=u?'':crypto.randomBytes(18).toString('hex');if(!u)setHelpGuestCookie(res,guest);const welcome=String(sp.whatsapp_message||'Hello! 👋 How can we help you today?').trim().slice(0,500);const info=u?{user_id:u.id,guest_token:'',customer_name:u.name||'Customer',customer_email:u.email||''}:{user_id:null,guest_token:guest,customer_name:'Guest customer',customer_email:''};const r=db.prepare("INSERT INTO help_chat_threads(user_id,guest_token,customer_name,customer_email) VALUES(?,?,?,?)").run(info.user_id,info.guest_token,info.customer_name,info.customer_email);thread=db.prepare("SELECT * FROM help_chat_threads WHERE id=?").get(r.lastInsertRowid);db.prepare("INSERT INTO help_chat_messages(thread_id,sender_role,message) VALUES(?,?,?)").run(thread.id,'ADMIN',welcome)}db.prepare("UPDATE help_chat_messages SET seen_at=COALESCE(seen_at,CURRENT_TIMESTAMP) WHERE thread_id=? AND sender_role='ADMIN'").run(thread.id);res.json({thread:{id:thread.id,status:thread.status,customer_name:thread.customer_name},messages:db.prepare("SELECT id,sender_role,message,created_at FROM help_chat_messages WHERE thread_id=? ORDER BY id ASC").all(thread.id),name:sp.whatsapp_name||'Ashwini AI Help Desk'})}catch(e){res.status(500).json({error:e.message||'Help Desk unavailable'})}});
app.get('/api/help-chat/unread',(req,res)=>{try{const thread=getHelpThread(req);if(!thread)return res.json({count:0});const row=db.prepare("SELECT COUNT(*) AS count FROM help_chat_messages WHERE thread_id=? AND sender_role='ADMIN' AND seen_at IS NULL").get(thread.id);res.json({count:Number(row?.count||0)})}catch(e){res.status(500).json({error:e.message||'Could not load Help Desk notifications'})}});
app.patch('/api/help-chat/read',(req,res)=>{try{const thread=getHelpThread(req);if(!thread)return res.json({ok:true,count:0});db.prepare("UPDATE help_chat_messages SET seen_at=COALESCE(seen_at,CURRENT_TIMESTAMP) WHERE thread_id=? AND sender_role='ADMIN' AND seen_at IS NULL").run(thread.id);res.json({ok:true,count:0})}catch(e){res.status(500).json({error:e.message||'Could not mark Help Desk notifications read'})}});
app.get('/api/help-chat/stream',(req,res)=>{
 try{
  const thread=getHelpThread(req);
  if(!thread)return res.status(404).end();
  const customer=currentHelpCustomer(req),streamIdentity=customer?`user:${customer.id}`:`guest:${helpGuestToken(req)||clientIp(req)}`;
  if(!reservePublicHelpStream(streamIdentity,res,2))return res.status(429).json({error:'Too many active Help Desk connections. Please close another Help Desk tab and try again.'});
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({type:'connected',thread_id:thread.id})}\n\n`);
  addHelpChatStream(`thread:${thread.id}`,res);
  const keep=setInterval(()=>{try{res.write(': keep-alive\n\n')}catch{}},20000);
  res.on('close',()=>clearInterval(keep));
 }catch{res.status(500).end()}
});
app.get('/api/admin/help-chat/stream/:id',auth,admin,(req,res)=>{
 try{
  const id=Number(req.params.id);const thread=db.prepare('SELECT id FROM help_chat_threads WHERE id=?').get(id);if(!thread)return res.status(404).end();
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({type:'connected',thread_id:id})}\n\n`);
  addHelpChatStream(`thread:${id}`,res);
  const keep=setInterval(()=>{try{res.write(': keep-alive\n\n')}catch{}},20000);
  res.on('close',()=>clearInterval(keep));
 }catch{res.status(500).end()}
});
app.get('/api/admin/help-chat/stream',auth,admin,(req,res)=>{
 try{res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.();res.write(`data: ${JSON.stringify({type:'connected'})}\n\n`);addHelpChatStream('admin:all',res);const keep=setInterval(()=>{try{res.write(': keep-alive\n\n')}catch{}},20000);res.on('close',()=>clearInterval(keep));}catch{res.status(500).end()}
});

app.post('/api/help-chat/messages',(req,res)=>{try{const text=String(req.body?.message||'').trim().slice(0,1000);if(!text)return res.status(400).json({error:'Please enter a message.'});let thread=getHelpThread(req);if(!thread){return res.status(404).json({error:'Help chat session not found. Please open Help Desk again.'});}const r=db.prepare("INSERT INTO help_chat_messages(thread_id,sender_role,message) VALUES(?,?,?)").run(thread.id,'CUSTOMER',text);db.prepare("UPDATE help_chat_threads SET status='OPEN',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(thread.id);const msg=db.prepare("SELECT id,sender_role,message,created_at FROM help_chat_messages WHERE id=?").get(r.lastInsertRowid);publishHelpChat(thread.id,{type:'message',message:msg});res.json({ok:true,message:msg})}catch(e){res.status(500).json({error:e.message||'Message could not be sent'})}});
app.get('/api/help-chat/messages',(req,res)=>{try{const thread=getHelpThread(req);if(!thread)return res.json({thread:null,messages:[]});res.json({thread:{id:thread.id,status:thread.status},messages:db.prepare("SELECT id,sender_role,message,created_at FROM help_chat_messages WHERE thread_id=? ORDER BY id ASC").all(thread.id)})}catch(e){res.status(500).json({error:e.message||'Could not load messages'})}});

app.patch("/api/admin/store-profile",auth,admin,(req,res)=>{try{const b=req.body||{};const logo=String(b.logo_data||"");if(logo && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(logo))return res.status(400).json({error:"Invalid logo image"});if(logo.length>15*1024*1024)return res.status(400).json({error:"Logo image is too large"});const waEnabled=b.whatsapp_enabled===true||b.whatsapp_enabled===1||String(b.whatsapp_enabled).toLowerCase()==='true';const waNumber=String(b.whatsapp_number??'').replace(/\D/g,'');if(waNumber && waNumber.length<10)return res.status(400).json({error:"Enter a valid WhatsApp number"});db.prepare(`UPDATE store_profile SET about_title=?,history=?,address=?,city=?,state=?,pincode=?,email=?,phone=?,logo_data=CASE WHEN ?='' THEN logo_data ELSE ? END,whatsapp_enabled=?,whatsapp_number=?,whatsapp_name=?,whatsapp_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(String(b.about_title||"About Ashwini Clothing").trim(),String(b.history||"").trim(),String(b.address||"").trim(),String(b.city||"").trim(),String(b.state||"").trim(),String(b.pincode||"").trim(),String(b.email||"ashwiniweb88@gmail.com").trim(),String(b.phone||"").trim(),logo,logo,waEnabled?1:0,waNumber,String(b.whatsapp_name||"Ashwini AI Help Desk").trim().slice(0,80),String(b.whatsapp_message||"Hello! 👋 Need help? Chat with us on WhatsApp!").trim().slice(0,500));res.json(db.prepare("SELECT * FROM store_profile WHERE id=1").get())}catch(e){res.status(400).json({error:e.message})}});

const postalLookupCache=new Map(),postalCacheTtlMs=24*60*60*1000,postalNegativeCacheTtlMs=60*60*1000;
async function lookupPostalPin(pin){
 const cached=postalLookupCache.get(pin),now=Date.now();if(cached&&cached.expiresAt>now)return cached.place;
 let place=null;
 try{const r=await fetch(`https://api.postalpincode.in/pincode/${pin}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});if(r.ok){const data=await r.json(),po=data?.[0]?.PostOffice?.[0];if(po)place={pin,area:po.Name||'',district:po.District||'',city:po.Block||po.District||po.Division||'',state:po.State||'',country:po.Country||'India'}}}catch{}
 if(!place)try{const r=await fetch(`https://api.zippopotam.us/in/${pin}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});if(r.ok){const z=await r.json(),p=z?.places?.[0];if(p)place={pin,area:p['place name']||'',district:p['place name']||'',city:p['place name']||'',state:p.state||'',country:z.country||'India'}}}catch{}
 postalLookupCache.set(pin,{place,expiresAt:now+(place?postalCacheTtlMs:postalNegativeCacheTtlMs)});
 if(postalLookupCache.size>2000){for(const [key,value] of postalLookupCache)if(value.expiresAt<=now)postalLookupCache.delete(key);while(postalLookupCache.size>2000)postalLookupCache.delete(postalLookupCache.keys().next().value)}
 return place;
}
app.get("/api/pincode/:pin",async(req,res)=>{
 const pin=String(req.params.pin||'').trim();
 if(!/^\d{6}$/.test(pin)) return res.status(400).json({error:"Enter a valid 6-digit PIN code"});
 if(!publicWriteAllowed(req,res,'POSTAL_LOOKUP',60,15*60*1000))return;
 const place=await lookupPostalPin(pin);if(place)return res.json(place);
 return res.status(404).json({error:"PIN code location could not be found. Please check the 6-digit PIN."});
});
app.get('/api/delivery-estimate/:pin',async(req,res)=>{
 const pin=String(req.params.pin||'').trim();if(!/^\d{6}$/.test(pin))return res.status(400).json({error:'Enter a valid 6-digit PIN code'});
 if(!publicWriteAllowed(req,res,'DELIVERY_ESTIMATE',60,15*60*1000))return;
 const settings=db.prepare('SELECT * FROM delivery_settings WHERE id=1').get(),place=await lookupPostalPin(pin);
 if(!place)return res.status(404).json({error:'PIN code location could not be found. Please check the 6-digit PIN.'});
 const cityText=`${place.city} ${place.district}`.toLowerCase(),state=String(place.state||'').toLowerCase(),baseState=String(settings.dispatch_state||'').toLowerCase();
 const blocked=db.prepare("SELECT * FROM delivery_blocks WHERE active=1 ORDER BY CASE block_type WHEN 'PIN' THEN 0 WHEN 'CITY' THEN 1 ELSE 2 END").all().find(x=>x.block_type==='PIN'?x.block_value===pin:x.block_type==='CITY'?cityText.includes(String(x.block_value||'').toLowerCase()):state===String(x.block_value||'').toLowerCase());
 if(blocked)return res.json({pin,city:place.city||place.district,state:place.state,deliverable:false,message:'Delivery is not available for your area.',blockType:blocked.block_type});
 const nearby=['punjab','chandigarh','delhi','himachal pradesh','jammu and kashmir','rajasthan','uttarakhand','uttar pradesh'];
 let min=settings.rest_min,max=settings.rest_max,zone='Across India';
 if(pin===settings.dispatch_pincode||cityText.includes('ambala')||cityText.includes('jandli')){min=settings.same_city_min;max=settings.same_city_max;zone='Jandli / Ambala Cantt'}
 else if(state===baseState){min=settings.same_state_min;max=settings.same_state_max;zone='Haryana'}
 else if(nearby.includes(state)){min=settings.nearby_min;max=settings.nearby_max;zone='Nearby state'}
 else if(['assam','arunachal pradesh','manipur','meghalaya','mizoram','nagaland','sikkim','tripura','andaman and nicobar islands','lakshadweep'].includes(state)){min=settings.remote_min;max=settings.remote_max;zone='Remote area'}
 const from=new Date(),to=new Date();from.setDate(from.getDate()+Number(min));to.setDate(to.getDate()+Number(max));
 res.json({pin,city:place.city||place.district,state:place.state,deliverable:true,zone,minDays:Number(min),maxDays:Number(max),from:from.toISOString(),to:to.toISOString(),dispatch:{city:settings.dispatch_city,pincode:settings.dispatch_pincode}});
});
app.get('/api/admin/delivery-settings',auth,admin,(req,res)=>res.json(db.prepare('SELECT * FROM delivery_settings WHERE id=1').get()));
app.patch('/api/admin/delivery-settings',auth,admin,(req,res)=>{try{const b=req.body||{},days=['same_city_min','same_city_max','same_state_min','same_state_max','nearby_min','nearby_max','rest_min','rest_max','remote_min','remote_max'];const n={};for(const key of days){n[key]=Math.max(0,Math.min(30,Number(b[key])));if(!Number.isFinite(n[key]))throw Error('Enter valid delivery days')}for(const pair of [['same_city_min','same_city_max'],['same_state_min','same_state_max'],['nearby_min','nearby_max'],['rest_min','rest_max'],['remote_min','remote_max']])if(n[pair[0]]>n[pair[1]])throw Error('Minimum delivery day cannot exceed maximum day');const pin=String(b.dispatch_pincode||'').trim();if(!/^\d{6}$/.test(pin))throw Error('Enter a valid 6-digit dispatch PIN code');db.prepare(`UPDATE delivery_settings SET dispatch_city=?,dispatch_state=?,dispatch_pincode=?,same_city_min=?,same_city_max=?,same_state_min=?,same_state_max=?,nearby_min=?,nearby_max=?,rest_min=?,rest_max=?,remote_min=?,remote_max=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(String(b.dispatch_city||'Jandli, Ambala Cantt').trim(),String(b.dispatch_state||'Haryana').trim(),pin,n.same_city_min,n.same_city_max,n.same_state_min,n.same_state_max,n.nearby_min,n.nearby_max,n.rest_min,n.rest_max,n.remote_min,n.remote_max);res.json(db.prepare('SELECT * FROM delivery_settings WHERE id=1').get())}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/admin/delivery-blocks',auth,admin,(req,res)=>res.json(db.prepare('SELECT * FROM delivery_blocks ORDER BY active DESC,block_type,block_value').all()));
app.post('/api/admin/delivery-blocks',auth,admin,(req,res)=>{try{const b=req.body||{},type=String(b.block_type||'').toUpperCase(),value=String(b.block_value||'').trim();if(!['PIN','CITY','STATE'].includes(type))throw Error('Choose PIN code, city or state');if(type==='PIN'&&!/^\d{6}$/.test(value))throw Error('Enter a valid 6-digit PIN code');if(type!=='PIN'&&!value)throw Error('Enter an area name');const r=db.prepare('INSERT INTO delivery_blocks(block_type,block_value,note,active) VALUES(?,?,?,?)').run(type,type==='PIN'?value:value.toLowerCase(),String(b.note||'').trim().slice(0,160),b.active===false?0:1);res.json(db.prepare('SELECT * FROM delivery_blocks WHERE id=?').get(r.lastInsertRowid))}catch(e){res.status(400).json({error:e.message})}});
app.patch('/api/admin/delivery-blocks/:id',auth,admin,(req,res)=>{try{const active=req.body?.active===false||String(req.body?.active).toLowerCase()==='false'?0:1;db.prepare('UPDATE delivery_blocks SET active=? WHERE id=?').run(active,Number(req.params.id));res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
app.delete('/api/admin/delivery-blocks/:id',auth,admin,(req,res)=>{try{db.prepare('DELETE FROM delivery_blocks WHERE id=?').run(Number(req.params.id));res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});

app.post("/api/coupons/check",auth,(req,res)=>{try{const code=String(req.body?.code||'').trim().toUpperCase();if(code==='NEW2026'){const first=db.prepare("SELECT COUNT(*) n FROM orders WHERE user_id=?").get(req.user.id).n===0;if(!first)throw Error('Coupon already used or not available for this account');return res.json({ok:true,discount_percent:30,code})}const now=new Date().toISOString();const o=db.prepare("SELECT * FROM offers WHERE active=1 AND coupon_code=? AND (start_at='' OR start_at<=?) AND (end_at='' OR end_at>=?) ORDER BY id DESC LIMIT 1").get(code,now,now);if(!o)throw Error('Coupon not recognised or expired');res.json({ok:true,discount_percent:Number(o.discount_percent||0),code:o.coupon_code,title:o.title})}catch(e){res.status(400).json({error:e.message})}});
app.get("/api/slides",(req,res)=>{res.json(db.prepare("SELECT * FROM homepage_slides WHERE active=1 ORDER BY sort_order,id").all())});
app.get("/api/admin/slides",auth,admin,(req,res)=>res.json(db.prepare("SELECT * FROM homepage_slides ORDER BY sort_order,id").all()));
function slideStyle(b,key){const value=String(b[key]||'').trim();if(value&&!/^#[0-9a-fA-F]{6}$/.test(value))throw Error('Choose valid slide colours');return value}
function slideSize(value){const n=Number(value||0);if(!Number.isFinite(n)||n<0||n>90)throw Error('Slide text size must be between 0 and 90');return Math.round(n)}
function slideValues(b){return [String(b.title||'').slice(0,120),String(b.image_url||'').trim(),String(b.button_text||'Shop Now').slice(0,60),String(b.button_action||''),b.active===false?0:1,Math.max(0,Number(b.sort_order||0)),String(b.offer_text||'').slice(0,160),slideStyle(b,'title_color'),slideSize(b.title_size),slideStyle(b,'offer_color'),slideSize(b.offer_size),slideStyle(b,'button_background'),slideStyle(b,'button_color'),slideStyle(b,'button_border')]}
app.post("/api/admin/slides",auth,admin,(req,res)=>{try{const b=req.body||{};if(!String(b.image_url||'').trim())throw Error('Slide image URL is required');const v=slideValues(b),r=db.prepare("INSERT INTO homepage_slides(title,image_url,button_text,button_action,active,sort_order,offer_text,title_color,title_size,offer_color,offer_size,button_background,button_color,button_border) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...v);res.json(db.prepare("SELECT * FROM homepage_slides WHERE id=?").get(r.lastInsertRowid))}catch(e){res.status(400).json({error:e.message})}});
app.patch("/api/admin/slides/:id",auth,admin,(req,res)=>{try{const b=req.body||{};if(!String(b.image_url||'').trim())throw Error('Slide image URL is required');const v=slideValues(b);db.prepare("UPDATE homepage_slides SET title=?,image_url=?,button_text=?,button_action=?,active=?,sort_order=?,offer_text=?,title_color=?,title_size=?,offer_color=?,offer_size=?,button_background=?,button_color=?,button_border=? WHERE id=?").run(...v,req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
app.delete("/api/admin/slides/:id",auth,admin,(req,res)=>{db.prepare("DELETE FROM homepage_slides WHERE id=?").run(req.params.id);res.json({ok:true})});
app.get("/api/categories",(req,res)=>{res.json(db.prepare("SELECT * FROM shop_categories WHERE active=1 ORDER BY sort_order,id").all())});
app.get("/api/product-highlights",(req,res)=>res.json(db.prepare("SELECT * FROM product_highlights WHERE active=1 ORDER BY sort_order,id").all()));
app.get("/api/admin/product-highlights",auth,admin,(req,res)=>res.json(db.prepare("SELECT * FROM product_highlights ORDER BY sort_order,id").all()));
app.post("/api/admin/product-highlights",auth,admin,(req,res)=>{try{const b=req.body||{};const label=String(b.label||'').trim(),value=String(b.value||'').trim();if(!label||!value)throw Error('Label and value are required');const r=db.prepare("INSERT INTO product_highlights(label,value,active,sort_order) VALUES(?,?,?,?)").run(label,value,b.active===false?0:1,Number(b.sort_order||0));res.json(db.prepare("SELECT * FROM product_highlights WHERE id=?").get(r.lastInsertRowid))}catch(e){res.status(400).json({error:e.message})}});
app.patch("/api/admin/product-highlights/:id",auth,admin,(req,res)=>{try{const b=req.body||{};const label=String(b.label||'').trim(),value=String(b.value||'').trim();if(!label||!value)throw Error('Label and value are required');db.prepare("UPDATE product_highlights SET label=?,value=?,active=?,sort_order=? WHERE id=?").run(label,value,b.active?1:0,Number(b.sort_order||0),req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
app.delete("/api/admin/product-highlights/:id",auth,admin,(req,res)=>{db.prepare("DELETE FROM product_highlights WHERE id=?").run(req.params.id);res.json({ok:true})});
app.get("/api/admin/categories",auth,admin,(req,res)=>res.json(db.prepare("SELECT * FROM shop_categories ORDER BY sort_order,id").all()));
app.post("/api/admin/categories",auth,admin,(req,res)=>{try{const b=req.body||{};const name=String(b.name||'').trim();if(!name)throw Error('Category name is required');const r=db.prepare("INSERT INTO shop_categories(name,icon,active,sort_order) VALUES(?,?,?,?)").run(name,String(b.icon||'👗'),b.active===false?0:1,Number(b.sort_order||0));res.json(db.prepare("SELECT * FROM shop_categories WHERE id=?").get(r.lastInsertRowid))}catch(e){res.status(400).json({error:e.message})}});
app.patch("/api/admin/categories/:id",auth,admin,(req,res)=>{try{const b=req.body||{};const name=String(b.name||'').trim();if(!name)throw Error('Category name is required');db.prepare("UPDATE shop_categories SET name=?,icon=?,active=?,sort_order=? WHERE id=?").run(name,String(b.icon||'👗'),b.active?1:0,Number(b.sort_order||0),req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
app.delete("/api/admin/categories/:id",auth,admin,(req,res)=>{try{db.prepare("DELETE FROM shop_categories WHERE id=?").run(req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});

app.get('/api/quick-filters',(req,res)=>res.json(db.prepare('SELECT * FROM quick_filters WHERE active=1 ORDER BY sort_order,id').all()));
app.get('/api/admin/quick-filters',auth,admin,(req,res)=>res.json(db.prepare('SELECT * FROM quick_filters ORDER BY sort_order,id').all()));
app.post('/api/admin/quick-filters',auth,admin,(req,res)=>{try{const b=req.body||{},label=String(b.label||'').trim(),filterType=String(b.filter_type||'').trim();if(!label)throw Error('Filter name is required');if(!['IN_STOCK','RATING_4'].includes(filterType))throw Error('Choose a valid filter type');const r=db.prepare('INSERT INTO quick_filters(label,filter_type,active,sort_order) VALUES(?,?,?,?)').run(label,filterType,b.active===false?0:1,Number(b.sort_order||0));res.json(db.prepare('SELECT * FROM quick_filters WHERE id=?').get(r.lastInsertRowid))}catch(e){res.status(400).json({error:e.message})}});
app.patch('/api/admin/quick-filters/:id',auth,admin,(req,res)=>{try{const b=req.body||{},label=String(b.label||'').trim(),filterType=String(b.filter_type||'').trim();if(!label)throw Error('Filter name is required');if(!['IN_STOCK','RATING_4'].includes(filterType))throw Error('Choose a valid filter type');db.prepare('UPDATE quick_filters SET label=?,filter_type=?,active=?,sort_order=? WHERE id=?').run(label,filterType,b.active?1:0,Number(b.sort_order||0),Number(req.params.id));res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
app.delete('/api/admin/quick-filters/:id',auth,admin,(req,res)=>{try{db.prepare('DELETE FROM quick_filters WHERE id=?').run(Number(req.params.id));res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});

function offerIsCurrentlyActive(o){
 if(!o || Number(o.active)!==1) return false;
 const now=Date.now();
 const parseOfferDate=(v)=>{
  const raw=String(v||'').trim();
  if(!raw) return null;
  const d=new Date(raw);
  return Number.isNaN(d.getTime())?null:d.getTime();
 };
 const start=parseOfferDate(o.start_at), end=parseOfferDate(o.end_at);
 if(start!==null && now<start) return false;
 if(end!==null && now>end) return false;
 return true;
}
app.get("/api/offers/active",(req,res)=>{
 const rows=db.prepare("SELECT * FROM offers WHERE active=1 ORDER BY id DESC").all().filter(offerIsCurrentlyActive);
 res.json(rows);
});
app.get("/api/offers/:id",(req,res)=>{
 const o=db.prepare("SELECT * FROM offers WHERE id=?").get(req.params.id);
 if(!o) return res.status(404).json({error:'Offer not found'});
 res.json({...o,current_active:offerIsCurrentlyActive(o)});
});
app.get("/api/notifications",auth,(req,res)=>{
 if(req.user.role!=='customer') return res.json([]);
 const rows=db.prepare(`SELECT n.*,o.coupon_code,o.discount_percent,o.banner_url,o.button_text,o.button_action
   FROM offer_notifications n
   LEFT JOIN offers o ON o.id=n.offer_id
   WHERE n.user_id=? AND (n.offer_id IS NULL OR n.id=(SELECT MAX(n2.id) FROM offer_notifications n2 WHERE n2.user_id=n.user_id AND n2.offer_id=n.offer_id))
   ORDER BY n.id DESC LIMIT 50`).all(req.user.id);
 res.json(rows);
});
app.patch("/api/notifications/:id/read",auth,(req,res)=>{
 db.prepare("UPDATE offer_notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(req.params.id,req.user.id); res.json({ok:true});
});
app.get("/api/admin/offers",auth,admin,(req,res)=>res.json(db.prepare("SELECT * FROM offers ORDER BY id DESC").all()));
app.post("/api/admin/offers",auth,admin,(req,res)=>{
 try{
  const b=req.body||{}; if(!String(b.title||'').trim())throw Error('Offer title is required');
  const r=db.prepare(`INSERT INTO offers(title,description,coupon_code,discount_percent,banner_url,button_text,button_action,start_at,end_at,active,show_popup) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(String(b.title).trim(),String(b.description||''),String(b.coupon_code||'').trim().toUpperCase(),Number(b.discount_percent||0),String(b.banner_url||''),String(b.button_text||'Shop Now'),String(b.button_action||''),String(b.start_at||''),String(b.end_at||''),b.active===false?0:1,b.show_popup===false?0:1);
  const created=db.prepare("SELECT * FROM offers WHERE id=?").get(r.lastInsertRowid); if(created.active){ const customers=db.prepare("SELECT id FROM users WHERE role='customer'").all(); const add=db.prepare("INSERT INTO offer_notifications(user_id,offer_id,title,message) VALUES(?,?,?,?)"); const msg=`${created.title}${created.description?` — ${created.description}`:''}${created.coupon_code?` Coupon: ${created.coupon_code}`:''}`; const tx=db.transaction(()=>customers.forEach(c=>add.run(c.id,created.id,created.title,msg))); tx(); } res.json(created);
 }catch(e){res.status(400).json({error:e.message})}
});
app.patch("/api/admin/offers/:id",auth,admin,(req,res)=>{
 try{const b=req.body||{};db.prepare(`UPDATE offers SET title=?,description=?,coupon_code=?,discount_percent=?,banner_url=?,button_text=?,button_action=?,start_at=?,end_at=?,active=?,show_popup=? WHERE id=?`).run(String(b.title||''),String(b.description||''),String(b.coupon_code||'').trim().toUpperCase(),Number(b.discount_percent||0),String(b.banner_url||''),String(b.button_text||'Shop Now'),String(b.button_action||''),String(b.start_at||''),String(b.end_at||''),b.active?1:0,b.show_popup?1:0,req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}
});
app.delete("/api/admin/offers/:id",auth,admin,(req,res)=>{db.prepare("DELETE FROM offers WHERE id=?").run(req.params.id);res.json({ok:true})});
app.post("/api/admin/offers/:id/send",auth,admin,(req,res)=>{
 try{
  const o=db.prepare("SELECT * FROM offers WHERE id=?").get(req.params.id); if(!o)throw Error('Offer not found');
  const audience=String(req.body?.audience||'both');
  const customers=db.prepare("SELECT id,email,phone FROM users WHERE role='customer'").all();
  const message=String(req.body?.message||`${o.title}${o.description?` — ${o.description}`:''}${o.coupon_code?` Coupon: ${o.coupon_code}`:''}`);
  const add=db.prepare("INSERT INTO offer_notifications(user_id,offer_id,title,message) VALUES(?,?,?,?)");
  const tx=db.transaction(()=>{let n=0;for(const c of customers){add.run(c.id,o.id,o.title,message);n++}return n});
  const n=tx();res.json({ok:true,sent:n,audience,delivery:'in-app'});
 }catch(e){res.status(400).json({error:e.message})}
});
app.get("/api/products",(req,res)=>{
 const {q="",category="All",sort="featured",filters=""}=req.query;
 let rows=db.prepare(`SELECT * FROM products
 WHERE (?='' OR name LIKE ? OR category LIKE ?)
 AND (?='All' OR lower(trim(category))=lower(trim(?)))`).all(q,`%${q}%`,`%${q}%`,category,category);
 const selected=String(filters).split(',').map(x=>x.trim()).filter(Boolean);
 if(selected.includes('IN_STOCK'))rows=rows.filter(x=>Number(x.stock)>0);
 if(selected.includes('RATING_4'))rows=rows.filter(x=>Number(x.rating)>=4);
 if(sort==="low")rows.sort((a,b)=>a.price-b.price);
 if(sort==="high")rows.sort((a,b)=>b.price-a.price);
 if(sort==="rating")rows.sort((a,b)=>b.rating-a.rating);
 res.json(rows);
});

function behaviorUserId(req){try{const raw=readCookie(req,'ashwini_session');if(!raw)return null;const s=db.prepare('SELECT user_id,expires_at,absolute_expires_at FROM auth_sessions WHERE session_hash=?').get(sessionHash(raw)),now=Date.now();return s&&Number(s.expires_at)>now&&Number(s.absolute_expires_at)>now?Number(s.user_id):null}catch{return null}}
app.post('/api/behavior-events',(req,res)=>{try{const consentVersion=String(req.body?.consent_version||'').trim();if(req.body?.consent!==true||consentVersion!=='2026-08-29-v1')return res.status(403).json({error:'Optional behavior tracking requires current consent'});const allowed=new Set(['product_view','add_to_cart','wishlist','search','recommendation_impression','recommendation_click']),eventType=String(req.body?.event_type||'').trim(),sessionId=String(req.body?.session_id||'').trim().slice(0,80);if(!allowed.has(eventType)||!/^[A-Za-z0-9_-]{16,80}$/.test(sessionId))return res.status(400).json({error:'Invalid behavior event'});const productId=Number(req.body?.product_id)||null,contextProductId=Number(req.body?.context_product_id)||null;if(productId&&!db.prepare('SELECT id FROM products WHERE id=?').get(productId))return res.status(400).json({error:'Invalid product'});const m=req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:{},metadata=JSON.stringify({category:String(m.category||'').slice(0,80),source:String(m.source||'').slice(0,40)});db.prepare('INSERT INTO behavior_events(session_id,user_id,event_type,product_id,context_product_id,metadata,consent_version) VALUES(?,?,?,?,?,?,?)').run(sessionId,behaviorUserId(req),eventType,productId,contextProductId,metadata,consentVersion);res.status(201).json({ok:true})}catch(e){console.error('[Behavior event]',e);res.status(500).json({error:'Event could not be saved'})}});
app.delete('/api/me/behavior-data',auth,(req,res)=>{try{const result=db.prepare('DELETE FROM behavior_events WHERE user_id=?').run(req.user.id);res.json({ok:true,deleted:result.changes})}catch(e){res.status(500).json({error:'Behavior data could not be deleted'})}});
app.delete('/api/behavior-data/session',(req,res)=>{try{const sessionId=String(req.body?.session_id||'').trim();if(!/^[A-Za-z0-9_-]{16,80}$/.test(sessionId))return res.status(400).json({error:'Invalid session'});const result=db.prepare('DELETE FROM behavior_events WHERE session_id=? AND user_id IS NULL').run(sessionId);res.json({ok:true,deleted:result.changes})}catch(e){res.status(500).json({error:'Behavior data could not be deleted'})}});
app.get('/api/recommendations/items/:id',(req,res)=>{try{const productId=Number(req.params.id),limit=Math.max(1,Math.min(12,Number(req.query.limit)||6)),seed=db.prepare('SELECT * FROM products WHERE id=?').get(productId);if(!seed)return res.status(404).json({error:'Product not found'});const raw=db.prepare(`WITH valid_items AS (SELECT DISTINCT oi.order_id,oi.product_id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status NOT IN ('CANCELLED','PAYMENT_FAILED') AND (o.payment_method='COD' OR o.payment_status='PAID' OR o.status NOT IN ('PAYMENT_PENDING'))),seed_orders AS (SELECT order_id FROM valid_items WHERE product_id=?),seed_count AS (SELECT COUNT(*) n FROM seed_orders),candidates AS (SELECT vi.product_id,COUNT(*) together FROM valid_items vi JOIN seed_orders so ON so.order_id=vi.order_id WHERE vi.product_id<>? GROUP BY vi.product_id),frequencies AS (SELECT product_id,COUNT(*) purchases FROM valid_items GROUP BY product_id) SELECT p.*,c.together,f.purchases,(SELECT n FROM seed_count) seed_purchases FROM candidates c JOIN frequencies f ON f.product_id=c.product_id JOIN products p ON p.id=c.product_id WHERE p.stock>0`).all(productId,productId),purchase=raw.map(x=>({...x,cf_score:x.together/Math.sqrt(Math.max(1,x.seed_purchases*x.purchases))})),behavior=db.prepare(`WITH seed_sessions AS (SELECT DISTINCT session_id FROM behavior_events WHERE product_id=? AND event_type IN ('product_view','add_to_cart','wishlist','recommendation_click') AND created_at>=datetime('now','-30 days')) SELECT b.product_id,COUNT(DISTINCT b.session_id) related_sessions,SUM(CASE b.event_type WHEN 'add_to_cart' THEN 4 WHEN 'wishlist' THEN 3 WHEN 'recommendation_click' THEN 2 ELSE 1 END) behavior_score FROM behavior_events b JOIN seed_sessions s ON s.session_id=b.session_id WHERE b.product_id IS NOT NULL AND b.product_id<>? AND b.event_type IN ('product_view','add_to_cart','wishlist','recommendation_click') AND b.created_at>=datetime('now','-30 days') GROUP BY b.product_id`).all(productId,productId),products=new Map(db.prepare('SELECT * FROM products WHERE id<>? AND stock>0').all(productId).map(x=>[Number(x.id),x])),combined=new Map();for(const x of purchase)combined.set(Number(x.id),{...x,ranking_score:Number(x.cf_score||0)*10});for(const b of behavior){const p=products.get(Number(b.product_id));if(!p)continue;const x=combined.get(Number(b.product_id))||{...p,together:0,purchases:0,cf_score:0};combined.set(Number(b.product_id),{...x,related_sessions:Number(b.related_sessions||0),behavior_score:Number(b.behavior_score||0),ranking_score:Number(x.ranking_score||0)+Math.log1p(Number(b.behavior_score||0))})}const rows=[...combined.values()].sort((a,b)=>b.ranking_score-a.ranking_score||b.rating-a.rating).slice(0,limit);if(rows.length)return res.json({strategy:purchase.length?'hybrid':'behavior',seed_product_id:productId,results:rows});const fallback=db.prepare(`SELECT p.*,(CASE WHEN lower(trim(p.category))=lower(trim(?)) THEN 1 ELSE 0 END) category_match,COALESCE(SUM(oi.quantity),0) purchases FROM products p LEFT JOIN order_items oi ON oi.product_id=p.id LEFT JOIN orders o ON o.id=oi.order_id AND o.status NOT IN ('CANCELLED','PAYMENT_FAILED') WHERE p.id<>? AND p.stock>0 GROUP BY p.id ORDER BY category_match DESC,purchases DESC,p.rating DESC,p.id DESC LIMIT ?`).all(seed.category,productId,limit);res.json({strategy:'cold_start',seed_product_id:productId,results:fallback})}catch(e){console.error('[Item recommendations]',e);res.status(500).json({error:'Recommendations could not be loaded.'})}});

function visualSearchOutputText(response){for(const item of response?.output||[])for(const part of item?.content||[])if(part?.type==='output_text'&&part.text)return part.text;return ''}
function visualSearchJson(text){const cleaned=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(cleaned)}catch{}const match=cleaned.match(/\{[\s\S]*\}/);if(match)try{return JSON.parse(match[0])}catch{}throw Error('AI returned an unreadable result. Please try another photo.')}
function productVisualScore(product,a){const hay=[product.name,product.category,product.description,product.badge_text,product.offer_text,product.emoji].filter(Boolean).join(' ').toLowerCase(),weighted=[[a.garment_type,8],[a.category,7],[a.gender,3],[a.style,4],[a.pattern,4],[a.occasion,3],...((a.colors||[]).map(x=>[x,5])),...((a.keywords||[]).map(x=>[x,2]))];let score=0,matched=[];for(const [raw,w] of weighted){const term=String(raw||'').trim().toLowerCase();if(term&&hay.includes(term)){score+=w;matched.push(term)}}return {score,matched:[...new Set(matched)].slice(0,6)}}
app.post('/api/visual-search',async(req,res)=>{try{const imageData=String(req.body?.imageData||'');if(!/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(imageData))return res.status(400).json({error:'Please upload a JPG, PNG or WebP photo.'});if(imageData.length>18_000_000)return res.status(413).json({error:'Photo is too large. Please choose a photo under 12 MB.'});if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'AI photo search is not configured yet.'});const categories=db.prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND trim(category)<>''").all().map(x=>x.category),prompt=`Analyze this clothing/product photo for an Indian fashion store. Return ONLY valid JSON with keys category, garment_type, colors, style, pattern, gender, occasion, keywords, confidence, summary. Use store categories when suitable: ${categories.join(', ')}.`;const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_VISION_MODEL||'gpt-5.4',store:false,max_output_tokens:500,input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:imageData,detail:'low'}]}]})}),body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body?.error?.message||'AI photo analysis failed.');const analysis=visualSearchJson(visualSearchOutputText(body)),ranked=db.prepare('SELECT * FROM products').all().map(product=>({product,...productVisualScore(product,analysis)})).sort((a,b)=>b.score-a.score),positive=ranked.filter(x=>x.score>0),results=(positive.length?positive:ranked).slice(0,12).map(x=>({...x.product,visual_score:x.score,visual_matches:x.matched}));res.json({analysis,results,count:results.length})}catch(e){console.error('Visual search error:',e.message);res.status(502).json({error:e.message||'AI photo search failed.'})}});
function makeOtp(){return String(crypto.randomInt(100000,1000000))}
function hashOtp(otp){return crypto.createHash("sha256").update(String(otp)).digest("hex")}
function otpMatches(input,stored){try{return Boolean(stored)&&crypto.timingSafeEqual(Buffer.from(hashOtp(input),"hex"),Buffer.from(stored,"hex"))}catch{return false}}
function normalizePhone(v){return String(v||"").replace(/\D/g,"")}
function passwordPolicyError(value,label='Password'){
 const password=String(value||'');
 if(Array.from(password).length<8)return `${label} must be at least 8 characters`;
 if(Buffer.byteLength(password,'utf8')>72)return `${label} must not exceed 72 bytes`;
 return '';
}
function findCustomerByIdentifier(identifier){
 const raw=String(identifier||"").trim();
 const phone=normalizePhone(raw);
 if(/^\d{10}$/.test(phone)) return db.prepare("SELECT * FROM users WHERE phone=? AND role='customer'").get(phone);
 return db.prepare("SELECT * FROM users WHERE lower(email)=lower(?) AND role='customer'").get(raw);
}
function issueOtp(u, kind){
 const otp=makeOtp(), hash=hashOtp(otp), exp=Date.now()+5*60*1000;
 if(kind==='login') db.prepare("UPDATE users SET login_otp_hash=?,login_otp_expires_at=? WHERE id=?").run(hash,exp,u.id);
 else db.prepare("UPDATE users SET recovery_otp_hash=?,recovery_otp_expires_at=? WHERE id=?").run(hash,exp,u.id);
 return otp;
}
// MSG91 OTP Widget configuration for the customer-facing mobile OTP flow.
// The widget token is intended for client-side use; the account AuthKey stays server-side.
app.get("/api/auth/msg91-config",(req,res)=>{
 const widgetId=String(process.env.MSG91_WIDGET_ID||"").trim();
 const tokenAuth=String(process.env.MSG91_WIDGET_TOKEN||"").trim();
 if(!widgetId||!tokenAuth)return res.status(503).json({error:"MSG91 OTP is not configured. Add MSG91_WIDGET_ID and MSG91_WIDGET_TOKEN in Render."});
 res.json({widgetId,tokenAuth});
});
async function verifyMsg91AccessToken(accessToken){
 const authkey=String(process.env.MSG91_AUTHKEY||"").trim();
 if(!authkey)throw new Error("MSG91 server AuthKey is not configured.");
 const endpoint="https://control.msg91.com/api/v5/widget/verifyAccessToken",verifiedToken=String(accessToken||"").trim();
 let r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({authkey,"access-token":verifiedToken})});
 let text=await r.text();
 // Some MSG91 accounts accept the server integration payload as JSON instead
 // of a form. Retry only for that specific parsing response.
 if(/access-token field is required/i.test(text)){
  r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",authkey},body:JSON.stringify({"access-token":verifiedToken})});
  text=await r.text();
 }
 let data={}; try{data=JSON.parse(text)}catch{}
 if(!r.ok||String(data.type||"").toLowerCase()==="error"||data.success===false)throw new Error(data.message||data.error||"MSG91 access token verification failed");
 return data;
}
function msg91VerifiedPhone(data){let phone=normalizePhone(data.mobile||data.phone||data.identifier||data.data?.mobile||data.data?.phone||data.data?.identifier);if(phone.length===12&&phone.startsWith('91'))phone=phone.slice(2);return phone}
app.post("/api/auth/verify-msg91-login",async(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim(),phone=normalizePhone(identifier);
 try{
  const accessToken=String(req.body?.accessToken||"").trim();
  if(!/^\d{10}$/.test(phone))return res.status(400).json({error:"MSG91 mobile verification requires a valid 10-digit mobile number."});
  if(!accessToken)return res.status(400).json({error:"MSG91 verification token is missing."});
  if(accessToken.length>4096)return res.status(400).json({error:"MSG91 verification token is invalid."});
  if(!otpVerifyGuard(req,res,phone))return;
  const verification=await verifyMsg91AccessToken(accessToken);
  const verifiedPhone=msg91VerifiedPhone(verification);
  if(verifiedPhone!==phone){recordOtpFailure(req,phone);return res.status(401).json({error:"MSG91 did not verify the requested mobile number."});}
  const u=db.prepare("SELECT * FROM users WHERE phone=? AND role='customer'").get(phone);
  if(!u)return res.status(404).json({error:"Customer account not found. Please register first."});
  db.prepare("UPDATE users SET login_otp_hash='',login_otp_expires_at=0,otp_hash='',otp_expires_at=0 WHERE id=?").run(u.id);
  clearOtpFailures(req,phone);
  const safe={id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone||''};
  createSession(req,res,u.id);res.json({user:safe});
 }catch(e){if(/^\d{10}$/.test(phone))recordOtpFailure(req,phone);console.error("[MSG91 login verification]",e.message);res.status(401).json({error:"MSG91 OTP verification failed. Please try again."});}
});
app.post("/api/auth/request-msg91-registration",(req,res)=>{
 const phone=normalizePhone(req.body?.phone),email=String(req.body?.email||'').trim().toLowerCase();
 if(!/^\d{10}$/.test(phone))return res.status(400).json({error:"Enter a valid 10-digit mobile number"});
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return res.status(400).json({error:'Enter a valid email address'});
 if(db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(email))return res.status(409).json({error:'This email is already registered. Please sign in.'});
 const existing=db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
 const pending=existing&&existing.role==='customer'&&existing.name==='Pending Buyer'&&!String(existing.password_hash||'')&&String(existing.email||'')===`phone_${phone}@ashwini.local`;
 if(existing&&!pending)return res.status(409).json({error:'This mobile number is already registered. Please sign in.'});
 res.json({ok:true});
});
app.post("/api/auth/register-msg91",async(req,res)=>{
 const body=req.body||{},normalized=normalizePhone(body.phone);let msg91Verified=false;
 try{
  const {name,email,password,accessToken}=body;
  const cleanName=String(name||'').trim(),cleanEmail=String(email||'').trim().toLowerCase(),cleanPassword=String(password||'');
  if(!cleanName||!cleanEmail||!password||!/^\d{10}$/.test(normalized)||!accessToken)return res.status(400).json({error:"Name, email, mobile number and MSG91 verification are required"});
  if(cleanName.length>80)return res.status(400).json({error:"Name is too long"});
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail))return res.status(400).json({error:"Enter a valid email address"});
  const passwordError=passwordPolicyError(cleanPassword);if(passwordError)return res.status(400).json({error:passwordError});
  if(String(accessToken).length>4096)return res.status(400).json({error:"MSG91 verification token is invalid."});
  if(!otpVerifyGuard(req,res,normalized))return;
  const verification=await verifyMsg91AccessToken(accessToken);
  const verifiedPhone=msg91VerifiedPhone(verification);
  if(verifiedPhone!==normalized){recordOtpFailure(req,normalized);return res.status(401).json({error:"MSG91 did not verify the requested mobile number."});}
  msg91Verified=true;
  const hash=await bcrypt.hash(cleanPassword,12);
  const createVerifiedAccount=db.transaction(()=>{
   const existing=db.prepare("SELECT * FROM users WHERE phone=?").get(normalized);
   const pending=existing&&existing.role==='customer'&&existing.name==='Pending Buyer'&&!String(existing.password_hash||'')&&String(existing.email||'')===`phone_${normalized}@ashwini.local`;
   if(existing&&!pending)throw Object.assign(Error('This mobile number is already registered. Please sign in.'),{status:409});
   const emailOwner=db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(cleanEmail);
   if(emailOwner&&(!existing||Number(emailOwner.id)!==Number(existing.id)))throw Object.assign(Error('This email is already registered. Please sign in.'),{status:409});
   if(pending){const changed=db.prepare("UPDATE users SET name=?,email=?,password_hash=?,otp_hash='',otp_expires_at=0,login_otp_hash='',login_otp_expires_at=0 WHERE id=? AND name='Pending Buyer' AND password_hash='' AND email=?").run(cleanName,cleanEmail,hash,existing.id,`phone_${normalized}@ashwini.local`);if(changed.changes!==1)throw Object.assign(Error('Account registration state changed. Please sign in or start again.'),{status:409});return Number(existing.id)}
   return Number(db.prepare("INSERT INTO users(name,email,password_hash,phone,role) VALUES(?,?,?,?,?)").run(cleanName,cleanEmail,hash,normalized,'customer').lastInsertRowid);
  });
  const userId=createVerifiedAccount(),u=db.prepare("SELECT id,name,email,role,phone FROM users WHERE id=?").get(userId);
  clearOtpFailures(req,normalized);
  createSession(req,res,u.id);res.json({user:u});
 }catch(e){if(!msg91Verified&&/^\d{10}$/.test(normalized))recordOtpFailure(req,normalized);console.error("[MSG91 registration verification]",e.message);const conflict=e?.code==='SQLITE_CONSTRAINT'||e?.code==='SQLITE_CONSTRAINT_UNIQUE',status=conflict?409:Number(e.status)||401;res.status(status).json({error:conflict?'This email or mobile number is already registered. Please sign in.':status===409?e.message:"MSG91 registration verification failed. Please try again."});}
});
app.post("/api/auth/request-login-otp",async(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim();
 if(!identifier)return res.status(400).json({error:"Enter your email or mobile number"});
 if(!otpGuard(req,res,identifier))return;
 const u=findCustomerByIdentifier(identifier),requested=/^\d{10}$/.test(normalizePhone(identifier))?'mobile':'email';
 if(!u)return res.json({ok:true,channel:requested,message:'If a customer account matches, an OTP has been sent.'});
 const otp=issueOtp(u,'login');
 const configured=String(u.two_step_channel||'AUTO').toUpperCase();
 const channel=Number(u.two_step_enabled)!==0 ? (configured==='EMAIL'?'email':configured==='MOBILE'?'mobile':requested) : requested;
 const destination=channel==='email'?u.email:u.phone;
 try{
  if(channel==='mobile' && !/^\d{10}$/.test(normalizePhone(destination)))throw new Error('A valid registered mobile number is required for Mobile OTP.');
  if(channel==='email' && !destination)throw new Error('A registered email address is required for E-mail OTP.');
  const delivery=channel==='email' ? await sendEmail(destination,'Ashwini Clothing login OTP',`Your Ashwini Clothing login OTP is ${otp}. It expires in 5 minutes. Do not share this OTP.`) : await sendSmsOtp(destination,otp);  if(!delivery.sent && process.env.NODE_ENV==='production' && String(process.env.SHOW_DEV_OTP||'').toLowerCase()!=='true')return res.status(503).json({error:`${channel==='email'?'Email':'SMS'} OTP service is not configured.`});
  clearOtpFailures(req,identifier);
  res.json(publicOtpResponse(otp,channel,`${channel==='mobile'?'Mobile':'Email'} OTP sent. It expires in 5 minutes.`));
 }catch(e){console.error('[Ashwini OTP delivery]',e.message);res.status(503).json({error:"OTP could not be delivered. Please try again later."});}
});
app.post("/api/auth/verify-login-otp",(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim(), otp=String(req.body?.otp||"").trim();
 const u=findCustomerByIdentifier(identifier);
 if(!otpVerifyGuard(req,res,identifier))return;
 if(!u||!/^\d{6}$/.test(otp)||!u.login_otp_hash||u.login_otp_expires_at<Date.now()||!otpMatches(otp,u.login_otp_hash)){recordOtpFailure(req,identifier);return res.status(400).json({error:"Invalid or expired OTP"});}
 db.prepare("UPDATE users SET login_otp_hash='',login_otp_expires_at=0 WHERE id=?").run(u.id);
 clearOtpFailures(req,identifier);
 const safe={id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone||''};
 createSession(req,res,u.id);res.json({user:safe});
});
app.post("/api/auth/request-recovery-otp",async(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim();
 if(!identifier)return res.status(400).json({error:"Enter your registered email or mobile number"});
 if(!otpGuard(req,res,identifier))return;
 const u=findCustomerByIdentifier(identifier),channel=/^\d{10}$/.test(normalizePhone(identifier))?'mobile':'email';
 if(!u)return res.json({ok:true,channel,message:'If a customer account matches, a recovery OTP has been sent.'});
 const otp=issueOtp(u,'recovery');
 try{
  const delivery=channel==='email' ? await sendEmail(u.email,'Ashwini Clothing account recovery OTP',`Your account recovery OTP is ${otp}. It expires in 5 minutes. Do not share it.`) : await sendSmsOtp(u.phone,otp);
  if(!delivery.sent && process.env.NODE_ENV==='production' && String(process.env.SHOW_DEV_OTP||'').toLowerCase()!=='true')return res.status(503).json({error:`${channel==='email'?'Email':'SMS'} OTP service is not configured.`});
  res.json(publicOtpResponse(otp,channel,`Recovery OTP sent. It expires in 5 minutes.`));
 }catch(e){res.status(503).json({error:"OTP could not be delivered. Please try again later."});}
});
app.post("/api/auth/forgot-login-id",(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim(), otp=String(req.body?.otp||"").trim();
 const u=findCustomerByIdentifier(identifier);
 if(!otpVerifyGuard(req,res,identifier))return;
 if(!u||!/^\d{6}$/.test(otp)||!u.recovery_otp_hash||u.recovery_otp_expires_at<Date.now()||!otpMatches(otp,u.recovery_otp_hash)){recordOtpFailure(req,identifier);return res.status(400).json({error:"Invalid or expired OTP"})}
 db.prepare("UPDATE users SET recovery_otp_hash='',recovery_otp_expires_at=0 WHERE id=?").run(u.id);
 clearOtpFailures(req,identifier);
 res.json({ok:true,loginId:u.email,message:"Your login ID is your registered email address."});
});
app.post("/api/auth/reset-password",async(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim(), otp=String(req.body?.otp||"").trim(), password=String(req.body?.password||"");
 const u=findCustomerByIdentifier(identifier);
 const passwordError=passwordPolicyError(password);if(passwordError)return res.status(400).json({error:passwordError});
 if(!otpVerifyGuard(req,res,identifier))return;
 if(!u||!/^\d{6}$/.test(otp)||!u.recovery_otp_hash||u.recovery_otp_expires_at<Date.now()||!otpMatches(otp,u.recovery_otp_hash)){recordOtpFailure(req,identifier);return res.status(400).json({error:"Invalid or expired OTP"})}
 const hash=await bcrypt.hash(password,12);
 const resetAccount=db.transaction(()=>{
  db.prepare("UPDATE users SET password_hash=?,recovery_otp_hash='',recovery_otp_expires_at=0,login_otp_hash='',login_otp_expires_at=0 WHERE id=?").run(hash,u.id);
  db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(u.id);
 });
 resetAccount();
 clearOtpFailures(req,identifier);
 clearSessionCookie(res);
 res.json({ok:true,message:"Password reset successfully. All previous sessions have been signed out. You can now sign in."});
});
// Admin creation is never exposed through a public HTTP request. If the
// database is recreated, the owner must configure ADMIN_EMAIL and
// ADMIN_PASSWORD in the private Render Environment; startup bootstrap above
// will then restore the authorised store-admin account.
app.post("/api/auth/setup-admin",(req,res)=>res.status(404).json({error:"Not found"}));
app.post("/api/auth/request-admin-login-otp",async(req,res)=>{
 const email=String(req.body?.email||"").trim().toLowerCase();
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return res.status(400).json({error:"Enter a valid admin email address"});
 if(!otpGuard(req,res,email))return;
 const u=db.prepare("SELECT * FROM users WHERE lower(email)=lower(?) AND role='admin'").get(email);
 if(!u)return res.json({ok:true,channel:'email',message:'If an authorised admin account matches, an OTP has been sent.'});
 const otp=issueOtp(u,'login');
 try{
  const delivery=await sendEmail(u.email,'Ashwini Clothing admin login OTP',`Your Ashwini Clothing admin login OTP is ${otp}. It expires in 5 minutes. Do not share this OTP.`);
  if(!delivery.sent && process.env.NODE_ENV==='production' && String(process.env.SHOW_DEV_OTP||'').toLowerCase()!=='true')return res.status(503).json({error:"Admin Email OTP service is not configured. Please check Render Email environment variables."});
  res.json(publicOtpResponse(otp,'email','Admin Email OTP sent. It expires in 5 minutes.'));
 }catch(e){console.error('[Ashwini Admin OTP delivery]',e.message);res.status(503).json({error:"Admin Email OTP could not be delivered. Please check email configuration."});}
});
app.post("/api/auth/admin-login-start",async(req,res)=>{
 try{
  const identifier=String(req.body?.identifier||"").trim(),password=String(req.body?.password||"");
  if(!identifier||!password)return res.status(400).json({error:"Enter admin mobile/email and password"});
  if(!otpVerifyGuard(req,res,identifier))return;
  if(Buffer.byteLength(password,'utf8')>72){recordOtpFailure(req,identifier);return res.status(401).json({error:"Incorrect admin login details"});}
  const mobile=normalizePhone(identifier),email=identifier.toLowerCase();
  const u=db.prepare("SELECT * FROM users WHERE role='admin' AND (lower(email)=lower(?) OR phone=?) LIMIT 1").get(email,mobile);
  // Never attach an unknown mobile number during sign-in. A new admin mobile
  // must be added from an authenticated admin session and OTP-verified there.
  const passwordMatches=await bcrypt.compare(password,String(u?.password_hash||dummyAdminPasswordHash));
  if(!u||!passwordMatches){recordOtpFailure(req,identifier);return res.status(401).json({error:"Incorrect admin login details"})}
  clearOtpFailures(req,identifier);
  // A mobile admin sign-in uses the already configured MSG91 secure widget.
  // Email sign-in stays on the existing email-OTP route below.
  if(/^\d{10}$/.test(mobile))return res.json({ok:true,channel:"mobile",phone:mobile});
  if(!otpGuard(req,res,u.email))return;
  const otp=issueOtp(u,'login');
  const delivery=await sendEmail(u.email,'Ashwini Clothing admin login OTP',`Your Ashwini Clothing admin login OTP is ${otp}. It expires in 5 minutes. Do not share this OTP.`);
  if(!delivery.sent && process.env.NODE_ENV==='production' && String(process.env.SHOW_DEV_OTP||'').toLowerCase()!=='true')return res.status(503).json({error:"Admin Email OTP service is not configured. Please check Render Email environment variables."});
  res.json({ok:true,email:u.email});
 }catch(e){console.error('[Ashwini Admin secure login]',e.message);res.status(503).json({error:"Admin OTP could not be delivered. Please check email configuration."});}
});
app.post("/api/auth/verify-msg91-admin-login",async(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim(),phone=normalizePhone(identifier);
 try{
  const password=String(req.body?.password||""),accessToken=String(req.body?.accessToken||"").trim();
  if(!/^\d{10}$/.test(phone))return res.status(400).json({error:"Enter a valid 10-digit admin mobile number."});
  if(!password)return res.status(400).json({error:"Admin password is required."});
  if(!accessToken)return res.status(400).json({error:"MSG91 verification token is missing."});
  if(accessToken.length>4096)return res.status(400).json({error:"MSG91 verification token is invalid."});
  if(!otpVerifyGuard(req,res,phone))return;
  if(Buffer.byteLength(password,'utf8')>72){recordOtpFailure(req,phone);return res.status(401).json({error:"Incorrect admin login details"});}
  const verification=await verifyMsg91AccessToken(accessToken);
  const verifiedPhone=msg91VerifiedPhone(verification);
  if(verifiedPhone!==phone){recordOtpFailure(req,phone);return res.status(401).json({error:"MSG91 did not verify the requested admin mobile number."});}
  const u=db.prepare("SELECT * FROM users WHERE phone=? AND role='admin'").get(phone);
  if(!u||!await bcrypt.compare(password,String(u.password_hash||""))){recordOtpFailure(req,phone);return res.status(401).json({error:"Incorrect admin login details"})}
  db.prepare("UPDATE users SET login_otp_hash='',login_otp_expires_at=0 WHERE id=?").run(u.id);
  clearOtpFailures(req,phone);
  const safe={id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone||''};
  createSession(req,res,u.id);res.json({user:safe});
 }catch(e){if(/^\d{10}$/.test(phone))recordOtpFailure(req,phone);console.error("[MSG91 admin login verification]",e.message);res.status(401).json({error:"MSG91 admin verification failed. Please try again."});}
});
app.post("/api/auth/verify-admin-login-otp",(req,res)=>{
 const email=String(req.body?.email||"").trim().toLowerCase(), otp=String(req.body?.otp||"").trim();
 const u=db.prepare("SELECT * FROM users WHERE lower(email)=lower(?) AND role='admin'").get(email);
 if(!otpVerifyGuard(req,res,email))return;
 if(!u||!/^\d{6}$/.test(otp)||!u.login_otp_hash||Number(u.login_otp_expires_at)<Date.now()||!otpMatches(otp,u.login_otp_hash)){recordOtpFailure(req,email);return res.status(400).json({error:"Invalid or expired admin OTP"});}
 db.prepare("UPDATE users SET login_otp_hash='',login_otp_expires_at=0 WHERE id=?").run(u.id);
 clearOtpFailures(req,email);
 const safe={id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone||''};
 createSession(req,res,u.id);res.json({user:safe});
});
// Do not keep a password-only compatibility login: it would bypass the
// customer OTP flow and the separate password + OTP admin flow above.
app.post("/api/auth/login",(req,res)=>{
 res.status(410).json({error:"Password-only sign in is disabled. Please use secure OTP sign in."});
});
function profileOtpTarget(value){return /^\d{10}$/.test(normalizePhone(value))?"mobile":"email"}
async function deliverProfileOtp(value,otp){const channel=profileOtpTarget(value);return channel==='mobile'?sendSmsOtp(value,otp):sendEmail(value,'Ashwini Clothing profile verification OTP',`Your profile change verification OTP is ${otp}. It expires in 5 minutes. Do not share it.`)}
app.patch('/api/me/name',auth,(req,res)=>{try{const name=String(req.body?.name||'').trim();if(!name)return res.status(400).json({error:'Please enter a valid name'});if(name.length>80)return res.status(400).json({error:'Name is too long'});db.prepare('UPDATE users SET name=? WHERE id=?').run(name,req.user.id);const u=db.prepare('SELECT id,name,email,phone,role,two_step_enabled,two_step_channel FROM users WHERE id=?').get(req.user.id);res.json({ok:true,user:u});}catch(e){res.status(400).json({error:e.message||'Could not save name'})}});
app.post("/api/me/change-password",auth,async(req,res)=>{try{
 const current=String(req.body?.currentPassword||""), next=String(req.body?.newPassword||""), confirm=String(req.body?.confirmPassword||"");
 const passwordCheckKey=`SENSITIVE_PASSWORD:${req.user.id}`;
 if(!otpVerifyGuard(req,res,passwordCheckKey,'Too many incorrect password attempts. Please wait 15 minutes before trying again.'))return;
 const passwordError=passwordPolicyError(next,'New password');if(passwordError)return res.status(400).json({error:passwordError});
 if(next!==confirm)return res.status(400).json({error:"New passwords do not match"});
 const u=db.prepare("SELECT id,password_hash FROM users WHERE id=?").get(req.user.id);
 if(!u||!(await bcrypt.compare(current,u.password_hash))){recordOtpFailure(req,passwordCheckKey);return res.status(401).json({error:"Current password is incorrect"});}
 clearOtpFailures(req,passwordCheckKey);
 const hash=await bcrypt.hash(next,12); db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash,u.id);
 db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(u.id);
 clearSessionCookie(res); res.json({ok:true,message:"Password changed successfully. Please sign in again."});
}catch(e){res.status(400).json({error:e.message||"Could not change password"})}});
app.patch("/api/me/security",auth,(req,res)=>{try{
 const channel=String(req.body?.two_step_channel||"AUTO").toUpperCase();
 if(!["AUTO","EMAIL","MOBILE"].includes(channel))return res.status(400).json({error:"Invalid OTP channel"});
 db.prepare("UPDATE users SET two_step_enabled=?,two_step_channel=? WHERE id=?").run(req.body?.two_step_enabled===false?0:1,channel,req.user.id);
 const u=db.prepare("SELECT id,name,email,phone,role,two_step_enabled,two_step_channel FROM users WHERE id=?").get(req.user.id);
 res.json({ok:true,user:u});
}catch(e){res.status(400).json({error:e.message||"Could not update security settings"})}});
app.post("/api/me/profile-change/request",auth,async(req,res)=>{try{const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);const name=String(req.body?.name||u.name).trim(),newEmail=String(req.body?.email||u.email).trim().toLowerCase(),newPhone=normalizePhone(req.body?.phone||u.phone);if(!name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)||!/^[0-9]{10}$/.test(newPhone))return res.status(400).json({error:"Enter a valid name, email and 10-digit mobile number"});if(db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?").get(newEmail,u.id))return res.status(409).json({error:"Email is already in use"});if(db.prepare("SELECT id FROM users WHERE phone=? AND id<>?").get(newPhone,u.id))return res.status(409).json({error:"Mobile number is already in use"});if(newEmail===String(u.email).toLowerCase()&&newPhone===String(u.phone||"")){db.prepare("UPDATE users SET name=? WHERE id=?").run(name,u.id);return res.json({ok:true,unchanged:true,user:db.prepare("SELECT id,name,email,phone,role FROM users WHERE id=?").get(u.id)});}db.prepare("DELETE FROM profile_change_requests WHERE user_id=?").run(u.id);const r=db.prepare(`INSERT INTO profile_change_requests(user_id,old_email,old_phone,new_email,new_phone,created_at) VALUES(?,?,?,?,?,?)`).run(u.id,u.email,u.phone||"",newEmail,newPhone,Date.now());const targets=[];const changedEmail=newEmail!==String(u.email).toLowerCase(),changedPhone=newPhone!==String(u.phone||"");for(const [key,value,changed] of [["old_email",u.email,changedEmail],["new_email",newEmail,changedEmail],["old_phone",u.phone||"",changedPhone],["new_phone",newPhone,changedPhone]]){if(!changed||!value)continue;const otp=makeOtp(),hash=hashOtp(otp),exp=Date.now()+5*60*1000;db.prepare(`UPDATE profile_change_requests SET ${key}_hash=?,${key}_expires=? WHERE id=?`).run(hash,exp,r.lastInsertRowid);try{const d=await deliverProfileOtp(value,otp);if(!d.sent&&process.env.NODE_ENV==='production'&&String(process.env.SHOW_DEV_OTP||'').toLowerCase()!=='true')return res.status(503).json({error:`${profileOtpTarget(value)==='mobile'?'SMS':'Email'} verification is not configured.`});targets.push({key,channel:profileOtpTarget(value),devOtp:(process.env.NODE_ENV!=='production'||String(process.env.SHOW_DEV_OTP||'').toLowerCase()==='true')?otp:undefined});}catch{return res.status(503).json({error:"Verification OTP could not be delivered. Please try again later."})}}res.json({ok:true,requiresVerification:true,targets});}catch(e){res.status(400).json({error:e.message})}});
app.post("/api/me/profile-change/confirm",auth,async(req,res)=>{try{const r=db.prepare("SELECT * FROM profile_change_requests WHERE user_id=? ORDER BY id DESC LIMIT 1").get(req.user.id);if(!r)return res.status(400).json({error:"No pending profile change"});if(Number(r.attempts)>=5){db.prepare("DELETE FROM profile_change_requests WHERE id=?").run(r.id);return res.status(429).json({error:"Too many verification attempts. Please start again."});}const now=Date.now(),b=req.body||{},checks=[];if(r.new_email!==r.old_email)checks.push(["old_email",b.oldEmailOtp],["new_email",b.newEmailOtp]);if(r.new_phone!==r.old_phone)checks.push(["old_phone",b.oldPhoneOtp],["new_phone",b.newPhoneOtp]);for(const [key,otp] of checks){if(!/^\d{6}$/.test(String(otp||""))||Number(r[`${key}_expires`])<now||!otpMatches(otp,r[`${key}_hash`])){db.prepare("UPDATE profile_change_requests SET attempts=attempts+1 WHERE id=?").run(r.id);return res.status(400).json({error:"Invalid or expired verification OTP"});}}db.prepare("UPDATE users SET name=?,email=?,phone=? WHERE id=?").run(String(b.name||req.user.name).trim(),r.new_email,r.new_phone,req.user.id);db.prepare("DELETE FROM profile_change_requests WHERE id=?").run(r.id);const u=db.prepare("SELECT id,name,email,phone,role FROM users WHERE id=?").get(req.user.id);res.json({ok:true,user:u});}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/me/sessions',auth,(req,res)=>{try{const now=Date.now();db.prepare('DELETE FROM auth_sessions WHERE expires_at<? OR absolute_expires_at<?').run(now,now);const sessions=db.prepare('SELECT id,created_at,last_seen_at,expires_at,absolute_expires_at,device_label FROM auth_sessions WHERE user_id=? ORDER BY last_seen_at DESC').all(req.user.id).map(s=>({...s,current:Number(s.id)===Number(req.sessionId)}));res.json({sessions})}catch(e){res.status(500).json({error:'Could not load active sessions'})}});
app.delete('/api/me/sessions/:id',auth,(req,res)=>{try{const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:'Invalid session'});const found=db.prepare('SELECT id FROM auth_sessions WHERE id=? AND user_id=?').get(id,req.user.id);if(!found)return res.status(404).json({error:'Session not found'});db.prepare('DELETE FROM auth_sessions WHERE id=? AND user_id=?').run(id,req.user.id);const current=id===Number(req.sessionId);if(current)clearSessionCookie(res);res.json({ok:true,current})}catch(e){res.status(500).json({error:'Could not sign out this device'})}});
app.post('/api/me/sessions/logout-all',auth,(req,res)=>{try{db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(req.user.id);clearSessionCookie(res);res.json({ok:true})}catch(e){res.status(500).json({error:'Could not sign out all devices'})}});
app.get('/api/me/personal-data',auth,(req,res)=>{try{
 const id=req.user.id;
 const orders=db.prepare(`SELECT id,total,status,payment_status,payment_method,razorpay_payment_id AS payment_reference,refund_status,refund_amount,dispute_status,address,customer_phone,created_at,updated_at,delivered_at,cancelled_at FROM orders WHERE user_id=? ORDER BY id`).all(id).map(order=>({...order,items:db.prepare('SELECT oi.product_id,p.name,oi.unit_price AS price,oi.quantity,oi.size FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?').all(order.id),events:db.prepare('SELECT status,title,message,created_at FROM order_events WHERE order_id=? AND user_id=? ORDER BY id').all(order.id,id)}));
 const returns=db.prepare('SELECT id,order_id,reason,request_type,replacement_size,replacement_color,pickup_at,admin_note,replacement_order_id,status,created_at,updated_at FROM returns WHERE user_id=? ORDER BY id').all(id).map(item=>({...item,events:db.prepare('SELECT status,title,message,created_at FROM return_events WHERE return_id=? AND user_id=? ORDER BY id').all(item.id,id)}));
 const chats=db.prepare('SELECT id,status,created_at,updated_at FROM help_chat_threads WHERE user_id=? ORDER BY id').all(id).map(thread=>({...thread,messages:db.prepare('SELECT sender_role,message,created_at,seen_at FROM help_chat_messages WHERE thread_id=? ORDER BY id').all(thread.id)}));
 const data={exported_at:new Date().toISOString(),profile:db.prepare('SELECT id,name,email,phone,role,two_step_enabled,two_step_channel,created_at FROM users WHERE id=?').get(id),orders,returns,reviews:db.prepare('SELECT product_id,rating,feedback,created_at FROM product_reviews WHERE user_id=? ORDER BY id').all(id),questions:db.prepare('SELECT product_id,question,created_at FROM product_questions WHERE user_id=? ORDER BY id').all(id),support_requests:db.prepare('SELECT subject,message,contact_method,status,created_at,updated_at FROM customer_help_requests WHERE user_id=? ORDER BY id').all(id),help_chats:chats,behavior_events:db.prepare('SELECT event_type,product_id,context_product_id,metadata,created_at FROM behavior_events WHERE user_id=? ORDER BY id').all(id),account_deletion_requests:db.prepare('SELECT id,status,reason,created_at,updated_at FROM account_deletion_requests WHERE user_id=? ORDER BY id').all(id)};
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Disposition',`attachment; filename="ashwini-personal-data-${id}.json"`);res.json(data)
 }catch(e){console.error('[Personal data export]',e);res.status(500).json({error:'Could not prepare your personal data'})}});
app.post('/api/me/account-deletion-request',auth,async(req,res)=>{try{if(req.user.role==='admin')return res.status(400).json({error:'The store admin account cannot be deleted from the customer page'});const passwordCheckKey=`SENSITIVE_PASSWORD:${req.user.id}`;if(!otpVerifyGuard(req,res,passwordCheckKey,'Too many incorrect password attempts. Please wait 15 minutes before trying again.'))return;const password=String(req.body?.password||''),reason=String(req.body?.reason||'').trim().slice(0,500),account=db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);if(!account||!(await bcrypt.compare(password,account.password_hash))){recordOtpFailure(req,passwordCheckKey);return res.status(401).json({error:'Password is incorrect'})}clearOtpFailures(req,passwordCheckKey);const pending=db.prepare("SELECT id FROM account_deletion_requests WHERE user_id=? AND status IN ('PENDING','IN_REVIEW','APPROVED')").get(req.user.id);if(pending)return res.status(409).json({error:'Your account deletion request is already active'});const result=db.prepare("INSERT INTO account_deletion_requests(user_id,reason) VALUES(?,?)").run(req.user.id,reason);await Promise.allSettled([sendEmail(req.user.email,'Ashwini account deletion request received',`We received your account deletion request #${result.lastInsertRowid}. Your account has not been deleted yet. Ashwini Support will review pending orders, payments, returns and legally required records before completing it.`),sendEmail(adminEmail(),`Ashwini account deletion request #${result.lastInsertRowid}`,`Customer: ${req.user.name} (${req.user.email})\nReason: ${reason||'Not provided'}\nPlease review pending orders, payments and returns before processing this request.`)]);res.status(201).json({ok:true,id:result.lastInsertRowid,message:'Account deletion request submitted. Your account remains active until review is complete.'})}catch(e){res.status(500).json({error:'Could not submit account deletion request'})}});
app.get('/api/me/account-deletion-request',auth,(req,res)=>{try{res.json({requests:db.prepare('SELECT id,status,reason,created_at,updated_at FROM account_deletion_requests WHERE user_id=? ORDER BY id DESC').all(req.user.id)})}catch{res.status(500).json({error:'Could not load account deletion requests'})}});
app.delete('/api/me/account-deletion-request/:id',auth,(req,res)=>{try{const result=db.prepare("UPDATE account_deletion_requests SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status IN ('PENDING','IN_REVIEW')").run(Number(req.params.id),req.user.id);if(!result.changes)return res.status(409).json({error:'This request cannot be cancelled'});res.json({ok:true})}catch{res.status(500).json({error:'Could not cancel account deletion request'})}});
app.post("/api/auth/logout",auth,(req,res)=>{try{const raw=readCookie(req,"ashwini_session");if(raw)db.prepare("DELETE FROM auth_sessions WHERE session_hash=?").run(sessionHash(raw));clearSessionCookie(res);res.json({ok:true});}catch(e){clearSessionCookie(res);res.json({ok:true});}});
app.get("/api/products/:id/questions",(req,res)=>{
 const productId=Number(req.params.id);
 if(!Number.isInteger(productId))return res.status(400).json({error:"Invalid product"});
 const rows=db.prepare(`SELECT q.id,q.product_id,q.question,q.created_at,u.name AS asker_name,
   COALESCE(json_group_array(CASE WHEN a.id IS NULL THEN NULL ELSE json_object('id',a.id,'answer',a.answer,'created_at',a.created_at,'name',COALESCE(au.name,'Customer'),'role',COALESCE(au.role,'customer')) END),'[]') AS answers_json
   FROM product_questions q LEFT JOIN users u ON u.id=q.user_id LEFT JOIN product_answers a ON a.question_id=q.id LEFT JOIN users au ON au.id=a.user_id
   WHERE q.product_id=? GROUP BY q.id ORDER BY q.created_at DESC`).all(productId);
 const out=rows.map(r=>{let answers=[];try{answers=JSON.parse(r.answers_json||'[]').filter(Boolean)}catch{}return {id:r.id,product_id:r.product_id,question:r.question,created_at:r.created_at,asker_name:r.asker_name||'Customer',answers}});
 res.json(out);
});
app.post("/api/products/:id/questions",auth,(req,res)=>{
 const productId=Number(req.params.id), question=String(req.body?.question||'').trim();
 if(!question)return res.status(400).json({error:"Please write a question"});
 if(question.length>500)return res.status(400).json({error:"Question is too long"});
 const p=db.prepare("SELECT id FROM products WHERE id=?").get(productId); if(!p)return res.status(404).json({error:"Product not found"});
 const r=db.prepare("INSERT INTO product_questions(product_id,user_id,question) VALUES(?,?,?)").run(productId,req.user.id,question);
 res.json({ok:true,id:r.lastInsertRowid});
});
app.post("/api/questions/:id/answers",auth,admin,(req,res)=>{
 const questionId=Number(req.params.id), answer=String(req.body?.answer||'').trim();
 if(!answer)return res.status(400).json({error:"Please write an answer"});
 if(answer.length>1000)return res.status(400).json({error:"Answer is too long"});
 const q=db.prepare("SELECT id FROM product_questions WHERE id=?").get(questionId); if(!q)return res.status(404).json({error:"Question not found"});
 const r=db.prepare("INSERT INTO product_answers(question_id,user_id,answer) VALUES(?,?,?)").run(questionId,req.user.id,answer);
 res.json({ok:true,id:r.lastInsertRowid});
});
app.get("/api/admin/questions",auth,admin,(req,res)=>{
 const rows=db.prepare(`SELECT q.id,q.product_id,p.name AS product_name,q.question,q.created_at,u.name AS asker_name,
   (SELECT COUNT(*) FROM product_answers a WHERE a.question_id=q.id) AS answer_count
   FROM product_questions q JOIN products p ON p.id=q.product_id LEFT JOIN users u ON u.id=q.user_id ORDER BY q.created_at DESC`).all();
 res.json(rows.map(r=>({...r,asker_name:r.asker_name||'Customer'})));
});

app.get('/api/products/:id/reviews',(req,res)=>{
 const productId=Number(req.params.id); if(!Number.isInteger(productId))return res.status(400).json({error:'Invalid product'});
 const rows=db.prepare(`SELECT r.id,r.product_id,r.rating,r.feedback,r.created_at,u.name AS customer_name,EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=r.product_id AND o.user_id=r.user_id AND o.status='DELIVERED' AND o.payment_status='PAID') AS verified_purchase FROM product_reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.created_at DESC`).all(productId);
 const summary=db.prepare('SELECT COUNT(*) count, COALESCE(AVG(rating),0) avg FROM product_reviews WHERE product_id=?').get(productId);
 const viewerId=behaviorUserId(req),canReview=viewerId?!!db.prepare("SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.user_id=? AND o.status='DELIVERED' AND o.payment_status='PAID' LIMIT 1").get(productId,viewerId):false;
 res.json({reviews:rows.map(r=>({...r,customer_name:r.customer_name||'Customer',verified_purchase:!!r.verified_purchase})),count:Number(summary.count||0),average:Number(summary.avg||0),can_review:canReview});
});
app.post('/api/products/:id/reviews',auth,(req,res)=>{
 if(req.user.role!=='customer')return res.status(403).json({error:'Customer review only'});
 const productId=Number(req.params.id), rating=Number(req.body?.rating), feedback=String(req.body?.feedback||'').trim();
 if(!Number.isInteger(rating)||rating<1||rating>5)return res.status(400).json({error:'Please select 1 to 5 stars'});
 if(!feedback)return res.status(400).json({error:'Please write your feedback'});
 if(feedback.length>1000)return res.status(400).json({error:'Feedback is too long'});
 if(!db.prepare('SELECT id FROM products WHERE id=?').get(productId))return res.status(404).json({error:'Product not found'});
 const verified=db.prepare("SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.user_id=? AND o.status='DELIVERED' AND o.payment_status='PAID' LIMIT 1").get(productId,req.user.id);
 if(!verified)return res.status(403).json({error:'Only customers with a delivered and paid purchase can review this product'});
 const existing=db.prepare('SELECT id FROM product_reviews WHERE product_id=? AND user_id=?').get(productId,req.user.id);
 if(existing){db.prepare('UPDATE product_reviews SET rating=?,feedback=?,created_at=CURRENT_TIMESTAMP WHERE id=?').run(rating,feedback,existing.id);}
 else db.prepare('INSERT INTO product_reviews(product_id,user_id,rating,feedback) VALUES(?,?,?,?)').run(productId,req.user.id,rating,feedback);
 const avg=db.prepare('SELECT COALESCE(AVG(rating),0) avg FROM product_reviews WHERE product_id=?').get(productId).avg;
 db.prepare('UPDATE products SET rating=? WHERE id=?').run(Number(Number(avg).toFixed(1)),productId);
 res.json({ok:true,rating:Number(Number(avg).toFixed(1))});
});

function resolveItems(items){
 if(!Array.isArray(items)||!items.length)throw Error("Cart is empty");
 if(items.length>50)throw Error("Cart contains too many item lines");
 const combined=new Map(),productQuantities=new Map();
 for(const item of items){
  const productId=Number(item?.id),qty=Number(item?.quantity),size=String(item?.size||'').trim();
  if(!Number.isInteger(productId)||productId<1)throw Error("Invalid product in cart");
  if(!Number.isInteger(qty)||qty<1||qty>20)throw Error("Each product quantity must be a whole number from 1 to 20");
  if(!size||size.length>20)throw Error("Invalid product size in cart");
  productQuantities.set(productId,Number(productQuantities.get(productId)||0)+qty);
  const key=`${productId}|${size}`,existing=combined.get(key);
  if(existing){existing.qty+=qty;if(existing.qty>20)throw Error("Maximum quantity per product and size is 20");}
  else combined.set(key,{productId,qty,size});
 }
 let total=0,out=[];
 for(const x of combined.values()){
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(x.productId);
  if(!p)throw Error("Product not found");
  const availableSizes=String(p.size_options||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(!availableSizes.includes(x.size))throw Error(`Size unavailable for ${p.name}`);
  if(!Number.isInteger(Number(p.stock))||Number(p.stock)<Number(productQuantities.get(x.productId)))throw Error(`Only ${Math.max(0,Number(p.stock)||0)} left for ${p.name}`);
  total+=Number(p.price)*x.qty;out.push({p,qty:x.qty,size:x.size});
 }
 if(!Number.isSafeInteger(total)||total<0)throw Error("Cart total could not be calculated safely");
 return {total,out};
}
app.get('/api/cod/availability',(req,res)=>{
 try{const global=db.prepare('SELECT enabled FROM cod_settings WHERE id=1').get()?.enabled;const state=String(req.query?.state||'').trim();const row=state?db.prepare('SELECT enabled FROM cod_state_settings WHERE lower(state)=lower(?)').get(state):null;const enabled=Number(global??1)===1 && (!row || Number(row.enabled)===1);res.json({enabled,state,global_enabled:Number(global??1)===1,state_override:row?Number(row.enabled)===1:null});}catch(e){res.status(500).json({error:e.message||'Could not check COD availability'})}
});
app.get('/api/admin/cod-settings',auth,admin,(req,res)=>{try{const global=db.prepare('SELECT enabled,updated_at FROM cod_settings WHERE id=1').get()||{enabled:1};const states=db.prepare('SELECT state,enabled,updated_at FROM cod_state_settings ORDER BY state').all();res.json({enabled:Number(global.enabled)!==0,updated_at:global.updated_at||'',states});}catch(e){res.status(500).json({error:e.message||'Could not load COD settings'})}});
app.patch('/api/admin/cod-settings',auth,admin,(req,res)=>{try{const enabled=req.body?.enabled===false||String(req.body?.enabled).toLowerCase()==='false'?0:1;const states=Array.isArray(req.body?.states)?req.body.states:[];const tx=db.transaction(()=>{db.prepare('UPDATE cod_settings SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(enabled);const up=db.prepare('INSERT INTO cod_state_settings(state,enabled,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(state) DO UPDATE SET enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP');const del=db.prepare('DELETE FROM cod_state_settings WHERE state=?');for(const x of states){const state=String(x?.state||'').trim().slice(0,80);if(!state)continue;if(x?.enabled===null||x?.enabled===undefined)del.run(state);else up.run(state,x.enabled?1:0);}});tx();const global=db.prepare('SELECT enabled,updated_at FROM cod_settings WHERE id=1').get();res.json({ok:true,enabled:Number(global.enabled)!==0,updated_at:global.updated_at,states:db.prepare('SELECT state,enabled,updated_at FROM cod_state_settings ORDER BY state').all()});}catch(e){res.status(400).json({error:e.message||'Could not save COD settings'})}});
app.post("/api/checkout/create",auth,async(req,res)=>{
 let createdOrderId=null;
 try{
  const {items,address,payment_method="RAZORPAY",coupon="",delivery_state="",idempotency_key=""}=req.body||{};
  const checkoutKey=String(idempotency_key||'').trim();
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(checkoutKey))throw Error("Secure checkout key is missing. Please reopen checkout and try again.");
  if(!address?.trim())throw Error("Delivery address required");
  if(!['RAZORPAY','COD'].includes(String(payment_method).toUpperCase()))throw Error("Invalid payment method");
  if(String(payment_method).toUpperCase()==='RAZORPAY'&&!razorpay)throw Error("Razorpay not configured. Add keys in Render Environment");
  if(String(payment_method).toUpperCase()==='COD'){
   const global=db.prepare('SELECT enabled FROM cod_settings WHERE id=1').get()?.enabled;
   const state=String(delivery_state||'').trim();
   const override=state?db.prepare('SELECT enabled FROM cod_state_settings WHERE lower(state)=lower(?)').get(state):null;
   if(Number(global??1)!==1 || (override && Number(override.enabled)!==1))throw Error(state?`Cash on Delivery is currently unavailable in ${state}. Please choose another payment method.`:'Cash on Delivery is currently unavailable. Please choose another payment method.');
  }
  const enteredPhone=String(req.body?.mobile||'').replace(/\D/g,'');
  if(!/^\d{10}$/.test(enteredPhone))throw Error("Please enter a valid 10-digit mobile number");

  // Always resolve the authenticated customer from the CURRENT database
  // immediately before creating the order. Never use a stale JWT id directly.
  let currentUser=db.prepare("SELECT id,name,email,role,phone FROM users WHERE id=?").get(req.user.id);
  if(!currentUser && req.user.email) currentUser=db.prepare("SELECT id,name,email,role,phone FROM users WHERE email=?").get(String(req.user.email).toLowerCase());
  if(!currentUser && req.user.phone) currentUser=db.prepare("SELECT id,name,email,role,phone FROM users WHERE phone=?").get(String(req.user.phone).replace(/\D/g,''));
  if(!currentUser)throw Error("Customer account was not found. Please sign in again.");

  const existingOrder=db.prepare("SELECT * FROM orders WHERE user_id=? AND checkout_key=?").get(currentUser.id,checkoutKey);
  if(existingOrder){
   if(existingOrder.payment_method==='COD')return res.json({ok:true,mode:'COD',orderId:existingOrder.id,total:existingOrder.total,duplicate:true});
   if(existingOrder.razorpay_order_id)return res.json({ok:true,mode:'RAZORPAY',orderId:existingOrder.id,total:existingOrder.total,razorpayOrderId:existingOrder.razorpay_order_id,keyId:process.env.RAZORPAY_KEY_ID,duplicate:true});
   return res.status(409).json({error:'This checkout is already being prepared. Please wait a moment and try again.'});
  }

  const accountPhone=String(currentUser.phone||'').replace(/\D/g,'');
  if(accountPhone && /^\d{10}$/.test(accountPhone) && accountPhone!==enteredPhone) throw Error("Please use the same mobile number as your signed-in account");
  const customerPhone=accountPhone && /^\d{10}$/.test(accountPhone) ? accountPhone : enteredPhone;
  if(customerPhone!==accountPhone) db.prepare("UPDATE users SET phone=? WHERE id=?").run(customerPhone,currentUser.id);

  const resolved=resolveItems(items);
  let total=resolved.total;
  const out=resolved.out;
  const firstOrder=db.prepare("SELECT COUNT(*) n FROM orders WHERE user_id=?").get(currentUser.id).n===0;
  const couponCode=String(coupon||'').trim().toUpperCase();
  if(couponCode==="NEW2026"){if(!firstOrder)throw Error("NEW2026 is only available for a new customer"); total=Math.round(total*0.70);}
  else if(couponCode){const now=new Date().toISOString();const offer=db.prepare("SELECT discount_percent FROM offers WHERE active=1 AND coupon_code=? AND (start_at='' OR start_at<=?) AND (end_at='' OR end_at>=?) ORDER BY id DESC LIMIT 1").get(couponCode,now,now);if(!offer)throw Error("Coupon not recognised or expired");const pct=Math.max(0,Math.min(100,Number(offer.discount_percent||0)));total=Math.round(total*(1-pct/100));}

  const createOrder=db.transaction(()=>{
   // Explicitly verify the parent row before the FK insert.
   const parent=db.prepare("SELECT id FROM users WHERE id=?").get(currentUser.id);
   if(!parent)throw Error("Customer account was not found. Please sign in again.");
   const r=db.prepare("INSERT INTO orders(user_id,total,status,payment_status,payment_method,address,customer_phone,checkout_key,stock_reserved_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .run(parent.id,total,payment_method==="COD"?"PLACED":"PAYMENT_PENDING","PENDING",payment_method,address,customerPhone,checkoutKey);
   const add=db.prepare("INSERT INTO order_items(order_id,product_id,size,quantity,unit_price) VALUES(?,?,?,?,?)");
   const dec=db.prepare("UPDATE products SET stock=stock-? WHERE id=?");
   for(const x of out){
    add.run(r.lastInsertRowid,x.p.id,x.size,x.qty,x.p.price);
    dec.run(x.qty,x.p.id);
   }
   return Number(r.lastInsertRowid);
  });

  const orderId=createOrder();createdOrderId=orderId;
  if(payment_method==="COD")return res.json({ok:true,mode:"COD",orderId,total});
  const rp=await razorpay.orders.create({amount:total*100,currency:"INR",receipt:`ASHWINI-${orderId}`});
  db.prepare("UPDATE orders SET razorpay_order_id=? WHERE id=?").run(rp.id,orderId);
  res.json({ok:true,mode:"RAZORPAY",orderId,total,razorpayOrderId:rp.id,keyId:process.env.RAZORPAY_KEY_ID});
 }catch(e){if(createdOrderId){db.prepare("UPDATE orders SET payment_status='FAILED' WHERE id=? AND payment_status<>'PAID'").run(createdOrderId);releaseOrderStock(createdOrderId,'PAYMENT_FAILED')}console.error('[Ashwini checkout]',e);res.status(400).json({error:e.message||"Order could not be created"})}
});
app.post("/api/checkout/verify",auth,async(req,res)=>{
 try{
  const {orderId,razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body;
  const o=db.prepare("SELECT * FROM orders WHERE id=? AND user_id=? AND payment_method='RAZORPAY'").get(orderId,req.user.id);
  if(!o||o.razorpay_order_id!==razorpay_order_id)return res.status(400).json({error:"Order mismatch"});
  if(!razorpay)return res.status(503).json({error:"Razorpay is not configured"});
  const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET||"").update(o.razorpay_order_id+"|"+razorpay_payment_id).digest("hex");
  const supplied=String(razorpay_signature||'');
  const valid=/^[a-f0-9]{64}$/i.test(supplied)&&crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(supplied,'hex'));
  if(!valid)return res.status(400).json({error:"Payment verification failed"});
  const payment=await razorpay.payments.fetch(String(razorpay_payment_id||''));
  const amountMatches=Number(payment.amount)===Math.round(Number(o.total)*100);
  if(payment.order_id!==o.razorpay_order_id||String(payment.currency||'').toUpperCase()!=='INR'||!amountMatches){createSecurityAlert({key:`CHECKOUT_PAYMENT_MISMATCH:${o.id}:${razorpay_payment_id}`,type:'CHECKOUT_PAYMENT_MISMATCH',title:'Checkout payment details do not match order',orderId:o.id,severity:'CRITICAL',details:{expected_razorpay_order_id:o.razorpay_order_id,received_razorpay_order_id:String(payment.order_id||''),expected_amount_paise:Number(o.total)*100,received_amount_paise:Number(payment.amount),received_currency:String(payment.currency||'')}});return res.status(400).json({error:"Payment details do not match this order"})}
  if(payment.status!=='captured')return res.status(409).json({error:"Payment is still being processed. Please check Your Orders shortly."});
  if(!reserveReleasedOrderStock(o.id)){db.prepare("UPDATE orders SET status='PAYMENT_REVIEW',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);createSecurityAlert({key:`CHECKOUT_PAID_STOCK_MISMATCH:${o.id}`,type:'PAID_ORDER_STOCK_MISMATCH',title:'Checkout payment received but stock is unavailable',orderId:o.id,severity:'CRITICAL',details:{payment_id:String(razorpay_payment_id||''),order_status:o.status,payment_status:o.payment_status}});return res.status(409).json({error:"Payment was received after the stock reservation expired. Please contact Ashwini support; the order requires review or refund."})}
  db.prepare("UPDATE orders SET payment_status='PAID',status=CASE WHEN status IN ('PAYMENT_PENDING','PAYMENT_FAILED','PAYMENT_EXPIRED') THEN 'CONFIRMED' ELSE status END,razorpay_payment_id=?,razorpay_signature=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(razorpay_payment_id,razorpay_signature,o.id);
  res.json({ok:true});
 }catch(e){console.error('[Razorpay checkout verification]',e.message);res.status(400).json({error:'Payment could not be verified. Please check Your Orders before trying again.'})}
});

app.get('/api/me',auth,(req,res)=>{const u=db.prepare("SELECT id,name,email,phone,role,two_step_enabled,two_step_channel,created_at FROM users WHERE id=?").get(req.user.id);if(!u)return res.status(404).json({error:'Account not found'});res.json(u)});
app.patch('/api/me',auth,(req,res)=>res.status(410).json({error:'Direct email or mobile changes are disabled. Please use OTP verification.'}));
app.get('/api/return-events',auth,(req,res)=>{try{res.json(db.prepare('SELECT e.* FROM return_events e WHERE e.user_id=? ORDER BY e.id DESC LIMIT 100').all(req.user.id))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/order-events',auth,(req,res)=>{try{res.json(db.prepare('SELECT e.* FROM order_events e WHERE e.user_id=? ORDER BY e.id DESC LIMIT 100').all(req.user.id))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/returns',auth,(req,res)=>{try{res.json(db.prepare(`SELECT r.*,o.total,o.status AS order_status,o.created_at AS order_date,ro.status AS replacement_order_status,ro.address AS replacement_address FROM returns r JOIN orders o ON o.id=r.order_id LEFT JOIN orders ro ON ro.id=r.replacement_order_id WHERE r.user_id=? ORDER BY r.id DESC`).all(req.user.id))}catch(e){res.status(400).json({error:e.message})}});
app.patch('/api/returns/:id/cancel',auth,async(req,res)=>{try{const r=db.prepare(`SELECT r.*,u.name AS customer_name,u.email AS customer_email,o.id AS order_id FROM returns r JOIN users u ON u.id=r.user_id JOIN orders o ON o.id=r.order_id WHERE r.id=? AND r.user_id=?`).get(req.params.id,req.user.id);if(!r)return res.status(404).json({error:'Return request not found'});const cancellable=['REQUESTED','APPROVED','PICKUP_SCHEDULED'];if(!cancellable.includes(String(r.status)))return res.status(400).json({error:'This return can no longer be cancelled because the pickup/inspection process has started'});db.prepare(`UPDATE returns SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(r.id);addReturnEvent(r.id,r.user_id,'CANCELLED','Return request cancelled','Your return request #'+r.id+' for Order #'+r.order_id+' was cancelled by you.');const adminEmail=db.prepare('SELECT email FROM store_profile WHERE id=1').get()?.email||'ashwiniweb88@gmail.com';await Promise.all([sendReturnEmail(adminEmail,`Ashwini Return #${r.id} Cancelled`,`Customer: ${r.customer_name} (${r.customer_email})\nOrder: #${r.order_id}\nThe customer cancelled the return request.`),sendReturnEmail(r.customer_email,`Ashwini Clothing Return Cancelled - Order #${r.order_id}`,`Your return request #${r.id} has been cancelled successfully. Your order remains delivered.`)]);res.json({ok:true,return:db.prepare('SELECT * FROM returns WHERE id=?').get(r.id)})}catch(e){console.error('[Ashwini return cancel]',e);res.status(400).json({error:e.message})}});
app.get('/api/admin/returns',auth,admin,(req,res)=>{try{res.json(db.prepare(`SELECT r.*,o.total,o.created_at AS order_date,o.updated_at AS order_updated_at,o.status AS order_status,u.name AS customer_name,u.email AS customer_email,u.phone AS customer_phone,ro.id AS replacement_order_id,ro.status AS replacement_order_status,ro.address AS replacement_address FROM returns r JOIN orders o ON o.id=r.order_id LEFT JOIN users u ON u.id=r.user_id LEFT JOIN orders ro ON ro.id=r.replacement_order_id ORDER BY CASE r.status WHEN 'REQUESTED' THEN 0 WHEN 'APPROVED' THEN 1 WHEN 'PICKUP_SCHEDULED' THEN 2 WHEN 'COMPLETED' THEN 3 ELSE 4 END, r.id DESC`).all())}catch(e){res.status(400).json({error:e.message})}});
function createReplacementOrderForReturn(returnRow){
 const existing=db.prepare('SELECT id FROM orders WHERE replacement_for_return_id=? ORDER BY id DESC LIMIT 1').get(returnRow.id);
 if(existing?.id)return existing.id;
 const original=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(returnRow.order_id,returnRow.user_id);
 if(!original)throw Error('Original order not found for replacement');
 const originalItems=db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(original.id);
 if(!originalItems.length)throw Error('Original order has no items for replacement');
 const tx=db.transaction(()=>{
   const total=0;
   const ins=db.prepare(`INSERT INTO orders(user_id,total,status,payment_status,payment_method,address,created_at,updated_at,replacement_for_order_id,replacement_for_return_id) VALUES(?,?,?,?,?,?,?,?,?,?)`);
   const result=ins.run(original.user_id,total,'PLACED','PAID','REPLACEMENT',original.address,new Date().toISOString(),new Date().toISOString(),original.id,returnRow.id);
   const newOrderId=Number(result.lastInsertRowid);
   const add=db.prepare('INSERT INTO order_items(order_id,product_id,size,quantity,unit_price) VALUES(?,?,?,?,?)');
   for(const item of originalItems){
     const requestedSize=String(returnRow.replacement_size||'').trim();
     const size=requestedSize||item.size;
     add.run(newOrderId,item.product_id,size,item.quantity,item.unit_price);
   }
   return newOrderId;
 });
 return tx();
}

app.patch('/api/admin/returns/:id',auth,admin,async(req,res)=>{try{
 const status=String(req.body?.status||'').trim().toUpperCase();
 const allowed=['REQUESTED','APPROVED','REJECTED','PICKUP_SCHEDULED','PICKUP_ATTEMPTED','PICKED_UP','IN_TRANSIT','RECEIVED','INSPECTION_PASSED','INSPECTION_FAILED','COMPLETED','CANCELLED'];
 if(!allowed.includes(status))return res.status(400).json({error:'Invalid return status'});
 const pickupAt=String(req.body?.pickup_at||'').trim();
 const adminNote=String(req.body?.admin_note||'').trim().slice(0,1000);
 const r=db.prepare(`SELECT r.*,u.name AS customer_name,u.email AS customer_email,o.id AS order_id,o.total,o.address FROM returns r JOIN users u ON u.id=r.user_id JOIN orders o ON o.id=r.order_id WHERE r.id=?`).get(req.params.id);
 if(!r)return res.status(404).json({error:'Return request not found'});
 const current=String(r.status||'REQUESTED').toUpperCase();
 if(current==='REQUESTED'&&!['APPROVED','REJECTED','CANCELLED'].includes(status))return res.status(409).json({error:'Admin must approve this request before pickup, inspection or completion'});
 if(['REJECTED','CANCELLED','COMPLETED'].includes(current))return res.status(409).json({error:'This return request is already closed'});
 let replacementOrderId=r.replacement_order_id||null;
 db.prepare('UPDATE returns SET status=?,pickup_at=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,pickupAt,adminNote,req.params.id);
 if(status==='COMPLETED' && ['REPLACEMENT','EXCHANGE'].includes(String(r.request_type||'REPLACEMENT').toUpperCase())){
   replacementOrderId=createReplacementOrderForReturn({...r,replacement_order_id:replacementOrderId});
   db.prepare('UPDATE returns SET replacement_order_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(replacementOrderId,req.params.id);
 }
 const replacementText=replacementOrderId?` Replacement order #${replacementOrderId} has been created for the same customer and will be delivered to the original order address (${r.address}).`:'';
 addReturnEvent(r.id,r.user_id,status,`Return ${status.replaceAll('_',' ')}`,`Return request #${r.id} for Order #${r.order_id} is now ${status.replaceAll('_',' ')}.${pickupAt?` Pickup scheduled for ${pickupAt}.`:''}${adminNote?` Admin note: ${adminNote}.`:''}${replacementText}`);
 if(replacementOrderId){
   addOrderEvent(replacementOrderId,r.user_id,'PLACED','Replacement order created',`Replacement order #${replacementOrderId} was created after Return #${r.id} was completed. It will be sent to the same delivery address as Order #${r.order_id}.`);
 }
 const customerDetails=`Return request #${r.id} for Order #${r.order_id} is now ${status.replaceAll('_',' ')}.${pickupAt?` Pickup scheduled for ${pickupAt}.`:''}${adminNote?` Admin note: ${adminNote}`:''}${replacementText}`;
 const adminEmail=db.prepare('SELECT email FROM store_profile WHERE id=1').get()?.email||'ashwiniweb88@gmail.com';
 const mailTasks=[sendReturnEmail(r.customer_email,`Ashwini Clothing Return Update - Order #${r.order_id}`,customerDetails),sendReturnEmail(adminEmail,`Ashwini Clothing Return #${r.id} - ${status}`,`Customer: ${r.customer_name} (${r.customer_email})\nOrder: #${r.order_id}\nReturn status: ${status.replaceAll('_',' ')}${pickupAt?`\nPickup: ${pickupAt}`:''}${replacementOrderId?`\nReplacement Order: #${replacementOrderId}\nReplacement delivery address: ${r.address}`:''}`)];
 if(replacementOrderId)mailTasks.push(sendReturnEmail(r.customer_email,`Ashwini Clothing Replacement Order #${replacementOrderId}`,`Your replacement order #${replacementOrderId} has been created after Return #${r.id} was completed.\n\nIt will be sent to the same delivery address used for your original Order #${r.order_id}:\n${r.address}\n\nYou can track its status from Your Orders.`));
 await Promise.all(mailTasks);
 res.json({ok:true,return:db.prepare('SELECT * FROM returns WHERE id=?').get(req.params.id),replacement_order_id:replacementOrderId});
}catch(e){console.error('[Ashwini return update]',e);res.status(400).json({error:e.message})}});

app.post('/api/returns',auth,async(req,res)=>{try{const orderId=Number(req.body?.order_id),reason=String(req.body?.reason||'').trim(),requestType=String(req.body?.request_type||'REPLACEMENT').trim().toUpperCase(),replacementSize=String(req.body?.replacement_size||'').trim().slice(0,20),replacementColor=String(req.body?.replacement_color||'').trim().slice(0,40);if(!Number.isInteger(orderId)||!reason)return res.status(400).json({error:'Order and return reason are required'});if(!['REPLACEMENT','EXCHANGE','RETURN_REFUND'].includes(requestType))return res.status(400).json({error:'Invalid return option'});const o=db.prepare('SELECT id,status,total FROM orders WHERE id=? AND user_id=?').get(orderId,req.user.id);if(!o)return res.status(404).json({error:'Order not found'});if(o.status!=='DELIVERED')return res.status(400).json({error:'Return can be requested after delivery'});const deliveredAt=Date.parse(String(o.updated_at||o.created_at||''));if(Number.isFinite(deliveredAt)&&Date.now()-deliveredAt>4*24*60*60*1000)return res.status(400).json({error:'The 4-day return period has expired'});const existing=db.prepare("SELECT id FROM returns WHERE order_id=? AND user_id=? AND status NOT IN ('REJECTED','CANCELLED')").get(orderId,req.user.id);if(existing)return res.status(400).json({error:'A return request already exists for this order'});const r=db.prepare('INSERT INTO returns(order_id,user_id,reason,request_type,replacement_size,replacement_color) VALUES(?,?,?,?,?,?)').run(orderId,req.user.id,reason,requestType,replacementSize,replacementColor);addReturnEvent(r.lastInsertRowid,req.user.id,'REQUESTED','Return request submitted',`Your return request #${r.lastInsertRowid} for Order #${orderId} was submitted and is awaiting admin review. ${requestType==='RETURN_REFUND'?'Return/refund will proceed only after admin approval and inspection.':'Replacement is the standard remedy.'}`);const u=db.prepare('SELECT name,email FROM users WHERE id=?').get(req.user.id);const adminEmail=db.prepare('SELECT email FROM store_profile WHERE id=1').get()?.email||'ashwiniweb88@gmail.com';await sendReturnEmail(adminEmail,`New Ashwini Return Request #${r.lastInsertRowid}`,`Customer: ${u?.name||'Customer'} (${u?.email||''})\nOrder: #${orderId}\nReason: ${reason}\nOption: ${requestType}${replacementSize?`\nRequested size: ${replacementSize}`:''}${replacementColor?`\nRequested colour: ${replacementColor}`:''}`);res.json({ok:true,id:r.lastInsertRowid});}catch(e){console.error('[Ashwini return request]',e);res.status(400).json({error:e.message})}});
app.get("/api/orders",auth,(req,res)=>{
 try{
  const me=db.prepare("SELECT id,phone FROM users WHERE id=?").get(req.user.id);
  if(!me)return res.status(401).json({error:"Customer account was not found. Please sign in again."});
  const phone=String(me.phone||'').replace(/\D/g,'');
  const os=phone && /^\d{10}$/.test(phone)
   ? db.prepare(`SELECT o.*,u.name AS customer_name,COALESCE(NULLIF(o.customer_phone,''),u.phone) AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.user_id=? OR o.customer_phone=? ORDER BY o.id DESC`).all(me.id,phone)
   : db.prepare("SELECT o.*,u.name AS customer_name,u.phone AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.user_id=? ORDER BY o.id DESC").all(me.id);
  const items=db.prepare("SELECT oi.*,p.name,p.emoji,p.image FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?");
  const returns=db.prepare('SELECT * FROM returns WHERE order_id=? ORDER BY id DESC');res.json(os.map(o=>{const deliveredAt=o.status==='DELIVERED'?Date.parse(String(o.delivered_at||o.updated_at||o.created_at||'')):NaN;const returnDeadline=Number.isFinite(deliveredAt)?new Date(deliveredAt+4*24*60*60*1000).toISOString():null;return {...o,return_deadline_at:returnDeadline,return_eligible:Boolean(returnDeadline&&Date.now()<=Date.parse(returnDeadline)),items:items.all(o.id),return_request:(()=>{const rr=returns.get(o.id); if(!rr)return null; const ro=rr.replacement_order_id?db.prepare('SELECT id,status,address FROM orders WHERE id=?').get(rr.replacement_order_id):null; return {...rr,replacement_order:ro||null};})(),tracking:{current:o.status,stages:['PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED']}};}));
 }catch(e){console.error('[Ashwini my orders]',e);res.status(500).json({error:e.message||'Could not load orders'})}
});
app.get("/api/orders/:id",auth,(req,res)=>{
 try{
  const me=db.prepare("SELECT id,phone FROM users WHERE id=?").get(req.user.id);
  if(!me)return res.status(401).json({error:"Customer account was not found. Please sign in again."});
  const phone=String(me.phone||'').replace(/\D/g,'');
  const o=(phone && /^\d{10}$/.test(phone))
   ? db.prepare(`SELECT o.*,u.name AS customer_name,COALESCE(NULLIF(o.customer_phone,''),u.phone) AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id=? AND (o.user_id=? OR o.customer_phone=?)`).get(req.params.id,me.id,phone)
   : db.prepare("SELECT o.*,u.name AS customer_name,u.phone AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id=? AND o.user_id=?").get(req.params.id,me.id);
  if(!o)return res.status(404).json({error:"Order not found for this account"});
  const items=db.prepare("SELECT oi.*,p.name,p.emoji,p.image FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?").all(o.id);
  const return_request0=db.prepare('SELECT * FROM returns WHERE order_id=? ORDER BY id DESC LIMIT 1').get(o.id)||null; const return_request=return_request0?( {...return_request0,replacement_order:return_request0.replacement_order_id?db.prepare('SELECT id,status,address FROM orders WHERE id=?').get(return_request0.replacement_order_id):null} ):null;
  const deliveredAt=o.status==='DELIVERED'?Date.parse(String(o.delivered_at||o.updated_at||o.created_at||'')):NaN;const returnDeadline=Number.isFinite(deliveredAt)?new Date(deliveredAt+4*24*60*60*1000).toISOString():null;res.json({...o,return_deadline_at:returnDeadline,return_eligible:Boolean(returnDeadline&&Date.now()<=Date.parse(returnDeadline)),items,return_request,tracking:{current:o.status,stages:['PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED']}});
 }catch(e){res.status(500).json({error:e.message||'Could not load order'})}
});
app.post('/api/orders/:id/cancel',auth,async(req,res)=>{try{const order=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!order)return res.status(404).json({error:'Order not found for this account'});const cancelled=await cancelOrderSafely(order),hasRefund=['REFUND_PENDING','REFUNDED'].includes(String(cancelled.payment_status));if(order.status!==cancelled.status){addOrderEvent(cancelled.id,cancelled.user_id,'CANCELLED','Order cancelled',cancelled.payment_method==='RAZORPAY'&&order.payment_status==='PAID'?`Order #${cancelled.id} was cancelled and its Razorpay refund was initiated.`:`Order #${cancelled.id} was cancelled successfully.`);await Promise.allSettled([notifyEmail(req.user.email,`Ashwini Clothing Order #${cancelled.id} Cancelled`,hasRefund?`Your order #${cancelled.id} was cancelled. A refund of ₹${Number(cancelled.refund_amount||cancelled.total).toLocaleString('en-IN')} has been initiated through Razorpay. The final credit time depends on your bank or payment method.`:`Your order #${cancelled.id} was cancelled successfully. No online refund was required.`),notifyEmail(adminEmail(),`Ashwini Order #${cancelled.id} Cancelled`,`Customer ${req.user.name} cancelled Order #${cancelled.id}. Payment: ${cancelled.payment_status}. Refund: ${cancelled.refund_status||'Not required'}.`)]);}res.json({ok:true,order:cancelled,message:hasRefund?'Order cancelled and refund initiated':'Order cancelled successfully'})}catch(e){res.status(400).json({error:e.message||'Order could not be cancelled'})}});
app.get('/api/orders/:id/invoice',auth,(req,res)=>{try{const order=db.prepare('SELECT o.*,u.name AS customer_name,u.email AS customer_email,COALESCE(NULLIF(o.customer_phone,\'\'),u.phone) AS customer_phone FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=? AND o.user_id=?').get(req.params.id,req.user.id);if(!order)return res.status(404).json({error:'Order not found for this account'});if(order.payment_status!=='PAID')return res.status(400).json({error:'Invoice becomes available after payment is confirmed'});const profile=db.prepare('SELECT about_title,address,city,state,pincode,email,phone FROM store_profile WHERE id=1').get()||{},gstin=String(process.env.STORE_GSTIN||'').trim().toUpperCase(),legalName=String(process.env.STORE_LEGAL_NAME||'Ashwini Clothing').trim(),items=db.prepare('SELECT oi.product_id,p.name,oi.size,oi.quantity,oi.unit_price,(oi.quantity*oi.unit_price) AS line_total FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? ORDER BY oi.id').all(order.id),year=new Date(order.created_at||Date.now()).getFullYear();res.json({invoice_type:gstin?'GST TAX INVOICE':'ORDER INVOICE',invoice_number:`ASH-${year}-${String(order.id).padStart(6,'0')}`,issued_at:order.created_at,seller:{legal_name:legalName,store_name:profile.about_title||'Ashwini Clothing',address:[profile.address,profile.city,profile.state,profile.pincode].filter(Boolean).join(', '),email:profile.email||adminEmail(),phone:profile.phone||'',gstin:gstin||null},buyer:{name:order.customer_name,email:order.customer_email,phone:order.customer_phone||'',delivery_address:order.address},order:{id:order.id,payment_method:order.payment_method,payment_status:order.payment_status,razorpay_payment_id:order.razorpay_payment_id||null,total:Number(order.total),currency:'INR'},items,note:gstin?'Prices are inclusive of applicable taxes.':'This is an order invoice/receipt. GST details are not claimed because a GSTIN is not configured.'})}catch(e){res.status(500).json({error:'Could not generate invoice'})}});

app.get('/api/customer-help',auth,(req,res)=>{
 try{
  const rows=db.prepare(`SELECT h.*,u.name AS customer_name,u.email AS customer_email,u.phone AS customer_phone FROM customer_help_requests h JOIN users u ON u.id=h.user_id WHERE h.user_id=? ORDER BY h.id DESC`).all(req.user.id);
  res.json(rows);
 }catch(e){res.status(500).json({error:e.message||'Could not load help requests'})}
});
app.post('/api/customer-help',auth,async(req,res)=>{
 try{
  if(req.user.role!=='customer')return res.status(403).json({error:'Customer help only'});
  const subject=String(req.body?.subject||'Customer Help').trim().slice(0,160);
  const message=String(req.body?.message||'').trim().slice(0,3000);
  const contactMethod=['EMAIL','CALLBACK'].includes(String(req.body?.contact_method||'').toUpperCase())?String(req.body.contact_method).toUpperCase():'EMAIL';
  if(!message)return res.status(400).json({error:'Please describe your problem'});
  const u=db.prepare("SELECT name,email,phone FROM users WHERE id=? AND role=\'customer\'").get(req.user.id);
  if(!u)return res.status(401).json({error:'Customer account not found. Please sign in again.'});
  if(contactMethod==='CALLBACK' && !/^\d{10}$/.test(String(u.phone||'').replace(/\D/g,'')))return res.status(400).json({error:'Please add a valid 10-digit registered mobile number in Manage Profile before requesting a callback.'});
  const r=db.prepare('INSERT INTO customer_help_requests(user_id,subject,message,contact_method) VALUES(?,?,?,?)').run(req.user.id,subject,message,contactMethod);
  const emailResult=await notifyEmail(adminEmail(),`Ashwini Customer Help #${r.lastInsertRowid} - ${subject}`,`Customer: ${u.name} (${u.email})\nRegistered mobile: ${u.phone||'Not registered'}\nContact method: ${contactMethod}\nRequest ID: #${r.lastInsertRowid}\n\nProblem:\n${message}`);
  res.json({ok:true,id:r.lastInsertRowid,email:adminEmail(),contact_method:contactMethod,email_sent:!!emailResult.sent,customer:{name:u.name,email:u.email,phone:u.phone||''}});
 }catch(e){res.status(400).json({error:e.message||'Could not submit help request'})}
});
app.get('/api/admin/customer-help',auth,admin,(req,res)=>{
 try{res.json(db.prepare(`SELECT h.*,u.name AS customer_name,u.email AS customer_email,u.phone AS customer_phone FROM customer_help_requests h JOIN users u ON u.id=h.user_id ORDER BY CASE h.status WHEN 'NEW' THEN 0 ELSE 1 END,h.id DESC`).all())}catch(e){res.status(500).json({error:e.message||'Could not load customer help requests'})}
});
app.patch('/api/admin/customer-help/:id',auth,admin,async(req,res)=>{
 const status=['NEW','CONTACTED','RESOLVED'].includes(String(req.body?.status||''))?String(req.body.status):null;
 if(!status)return res.status(400).json({error:'Invalid help request status'});
 const h=db.prepare(`SELECT h.*,u.name AS customer_name,u.email AS customer_email FROM customer_help_requests h JOIN users u ON u.id=h.user_id WHERE h.id=?`).get(req.params.id);
 if(!h)return res.status(404).json({error:'Help request not found'});
 db.prepare('UPDATE customer_help_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,req.params.id);
 const emailResult=await notifyEmail(h.customer_email,`Ashwini Support Update #${h.id}`,`Hello ${h.customer_name},\n\nYour Ashwini Clothing support request #${h.id} is now ${status}.\nSubject: ${h.subject}\n\nIf you need further help, contact ${adminEmail()}.`);
 res.json({ok:true,email_sent:!!emailResult.sent});
});

app.get('/api/admin/help-chat/threads',auth,admin,(req,res)=>{try{const rows=db.prepare(`SELECT t.id,t.customer_name,t.customer_email,t.status,t.created_at,t.updated_at,(SELECT message FROM help_chat_messages m WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_message,(SELECT COUNT(*) FROM help_chat_messages m WHERE m.thread_id=t.id AND m.sender_role='CUSTOMER' AND m.seen_at IS NULL) AS unread FROM help_chat_threads t ORDER BY unread DESC,t.updated_at DESC LIMIT 100`).all();res.json(rows)}catch(e){res.status(500).json({error:e.message||'Could not load help chats'})}});
app.get('/api/admin/help-chat/threads/:id',auth,admin,(req,res)=>{try{const id=Number(req.params.id);const thread=db.prepare('SELECT * FROM help_chat_threads WHERE id=?').get(id);if(!thread)return res.status(404).json({error:'Chat not found'});db.prepare("UPDATE help_chat_messages SET seen_at=COALESCE(seen_at,CURRENT_TIMESTAMP) WHERE thread_id=? AND sender_role='CUSTOMER'").run(id);res.json({thread,messages:db.prepare('SELECT id,sender_role,message,created_at FROM help_chat_messages WHERE thread_id=? ORDER BY id ASC').all(id)})}catch(e){res.status(500).json({error:e.message||'Could not load chat'})}});
app.post('/api/admin/help-chat/threads/:id/reply',auth,admin,(req,res)=>{try{const id=Number(req.params.id),text=String(req.body?.message||'').trim().slice(0,1000);if(!text)return res.status(400).json({error:'Please enter a reply.'});const thread=db.prepare('SELECT * FROM help_chat_threads WHERE id=?').get(id);if(!thread)return res.status(404).json({error:'Chat not found'});const r=db.prepare("INSERT INTO help_chat_messages(thread_id,sender_role,message) VALUES(?,?,?)").run(id,'ADMIN',text);db.prepare("UPDATE help_chat_threads SET status='OPEN',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);const msg=db.prepare("SELECT id,sender_role,message,created_at FROM help_chat_messages WHERE id=?").get(r.lastInsertRowid);publishHelpChat(id,{type:'message',message:msg});res.json({ok:true,message:msg})}catch(e){res.status(500).json({error:e.message||'Reply could not be sent'})}});
app.patch('/api/admin/help-chat/threads/:id',auth,admin,(req,res)=>{try{const status=['OPEN','RESOLVED'].includes(String(req.body?.status||''))?String(req.body.status):'OPEN';db.prepare('UPDATE help_chat_threads SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,Number(req.params.id));res.json({ok:true})}catch(e){res.status(400).json({error:e.message||'Could not update chat'})}});
app.get("/api/admin/whatsapp-help-events",auth,admin,(req,res)=>{try{res.json(db.prepare("SELECT * FROM whatsapp_help_events ORDER BY CASE status WHEN 'NEW' THEN 0 ELSE 1 END,id DESC LIMIT 100").all())}catch(e){res.status(500).json({error:e.message||'Could not load WhatsApp help notifications'})}});
app.patch("/api/admin/whatsapp-help-events/:id",auth,admin,(req,res)=>{const status=['NEW','SEEN','RESOLVED'].includes(String(req.body?.status||''))?String(req.body.status):'SEEN';try{db.prepare("UPDATE whatsapp_help_events SET status=?,seen_at=CASE WHEN ?='SEEN' THEN CURRENT_TIMESTAMP ELSE seen_at END WHERE id=?").run(status,status,req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:e.message||'Could not update notification'})}});
app.get('/api/admin/account-deletion-requests',auth,admin,(req,res)=>{try{res.json(db.prepare(`SELECT r.id,r.user_id,r.status,r.reason,r.created_at,r.updated_at,u.name,u.email,u.phone,(SELECT COUNT(*) FROM orders o WHERE o.user_id=r.user_id AND o.status NOT IN ('DELIVERED','CANCELLED','PAYMENT_FAILED','PAYMENT_EXPIRED')) AS active_orders,(SELECT COUNT(*) FROM orders o WHERE o.user_id=r.user_id AND o.payment_status IN ('PENDING','REFUND_PENDING','DISPUTED','REFUND_FAILED','DISPUTE_LOST')) AS payment_issues,(SELECT COUNT(*) FROM returns x WHERE x.user_id=r.user_id AND x.status NOT IN ('COMPLETED','REJECTED','CANCELLED')) AS active_returns FROM account_deletion_requests r JOIN users u ON u.id=r.user_id ORDER BY CASE r.status WHEN 'PENDING' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END,r.id DESC`).all())}catch(e){res.status(500).json({error:'Could not load account deletion requests'})}});
app.patch('/api/admin/account-deletion-requests/:id',auth,admin,async(req,res)=>{try{const status=String(req.body?.status||'').toUpperCase();if(!['IN_REVIEW','APPROVED','REJECTED'].includes(status))return res.status(400).json({error:'Invalid deletion-request status'});const request=db.prepare(`SELECT r.*,u.name,u.email,(SELECT COUNT(*) FROM orders o WHERE o.user_id=r.user_id AND o.status NOT IN ('DELIVERED','CANCELLED','PAYMENT_FAILED','PAYMENT_EXPIRED')) AS active_orders,(SELECT COUNT(*) FROM orders o WHERE o.user_id=r.user_id AND o.payment_status IN ('PENDING','REFUND_PENDING','DISPUTED','REFUND_FAILED','DISPUTE_LOST')) AS payment_issues,(SELECT COUNT(*) FROM returns x WHERE x.user_id=r.user_id AND x.status NOT IN ('COMPLETED','REJECTED','CANCELLED')) AS active_returns FROM account_deletion_requests r JOIN users u ON u.id=r.user_id WHERE r.id=?`).get(Number(req.params.id));if(!request)return res.status(404).json({error:'Account deletion request not found'});if(['APPROVED'].includes(status)&&(Number(request.active_orders)||Number(request.payment_issues)||Number(request.active_returns)))return res.status(409).json({error:'Resolve active orders, payments/refunds/disputes and returns before approving account deletion'});db.prepare('UPDATE account_deletion_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,request.id);await notifyEmail(request.email,`Ashwini account deletion request #${request.id} — ${status.replaceAll('_',' ')}`,`Hello ${request.name||'Customer'},\n\nYour account deletion request #${request.id} is now ${status.replaceAll('_',' ')}. Approval means the request passed operational checks; legally required transaction records may still need to be retained.\n\nContact ${adminEmail()} if you need help.`);res.json({ok:true,status})}catch(e){res.status(500).json({error:e.message||'Could not update account deletion request'})}});
app.get("/api/admin/stats",auth,admin,(req,res)=>{
 const revenue=db.prepare("SELECT COALESCE(SUM(total),0) total FROM orders WHERE payment_status='PAID'").get().total;
 res.json({revenue,orders:db.prepare("SELECT COUNT(*) n FROM orders").get().n,customers:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,products:db.prepare("SELECT COUNT(*) n FROM products").get().n});
});
app.get("/api/admin/orders",auth,admin,(req,res)=>res.json(db.prepare("SELECT o.*,u.name,u.email FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC").all()));
app.get('/api/admin/activity-logs',auth,admin,(req,res)=>{try{const limit=Math.max(1,Math.min(500,Number(req.query?.limit)||200));res.json(db.prepare('SELECT id,admin_user_id,admin_email,action,entity_type,entity_id,details,ip_address,created_at FROM admin_activity_logs ORDER BY id DESC LIMIT ?').all(limit).map(row=>({...row,details:(()=>{try{return JSON.parse(row.details)}catch{return{}}})()})))}catch(e){res.status(500).json({error:'Could not load admin activity logs'})}});
app.get('/api/admin/security-alerts',auth,admin,(req,res)=>{try{const limit=Math.max(1,Math.min(500,Number(req.query?.limit)||200));res.json(db.prepare(`SELECT a.*,o.status AS order_status,o.payment_status,o.total FROM security_alerts a LEFT JOIN orders o ON o.id=a.order_id ORDER BY CASE a.status WHEN 'OPEN' THEN 0 ELSE 1 END,CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,a.id DESC LIMIT ?`).all(limit).map(row=>({...row,details:(()=>{try{return JSON.parse(row.details)}catch{return{}}})()})))}catch(e){res.status(500).json({error:'Could not load security alerts'})}});
app.patch('/api/admin/security-alerts/:id',auth,admin,(req,res)=>{try{const status=String(req.body?.status||'').toUpperCase();if(!['OPEN','IN_REVIEW','RESOLVED'].includes(status))return res.status(400).json({error:'Invalid alert status'});const before=db.prepare('SELECT * FROM security_alerts WHERE id=?').get(Number(req.params.id));if(!before)return res.status(404).json({error:'Alert not found'});db.prepare("UPDATE security_alerts SET status=?,updated_at=CURRENT_TIMESTAMP,resolved_at=CASE WHEN ?='RESOLVED' THEN CURRENT_TIMESTAMP ELSE '' END WHERE id=?").run(status,status,before.id);logAdminActivity(req,'SECURITY_ALERT_UPDATED','SECURITY_ALERT',before.id,{from_status:before.status,to_status:status,alert_type:before.alert_type,order_id:before.order_id||null});res.json({ok:true,alert:db.prepare('SELECT * FROM security_alerts WHERE id=?').get(before.id)})}catch(e){res.status(500).json({error:'Could not update security alert'})}});
app.post("/api/admin/orders/:id/cash-received",auth,admin,async(req,res)=>{
 try{
  const order=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  if(!order)return res.status(404).json({error:"Order not found"});
  if(order.payment_method!=="COD")return res.status(400).json({error:"Cash received can only be recorded for a Cash on Delivery order"});
  if(order.status!=="DELIVERED")return res.status(400).json({error:"Mark the order delivered before recording the COD payment"});
  if(order.payment_status==="PAID")return res.json({ok:true,already_paid:true,order});
  db.prepare("UPDATE orders SET payment_status='PAID',updated_at=CURRENT_TIMESTAMP WHERE id=? AND payment_status<>'PAID'").run(order.id);
  const updated=db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
  logAdminActivity(req,'COD_PAYMENT_RECEIVED','ORDER',updated.id,{from_payment_status:order.payment_status,to_payment_status:updated.payment_status,amount:updated.total});
  addOrderEvent(updated.id,updated.user_id,'PAYMENT_RECEIVED','Cash payment received',`Cash on Delivery payment for Order #${updated.id} was received and recorded as PAID.`);
  const customer=db.prepare("SELECT name,email FROM users WHERE id=?").get(updated.user_id);
  if(customer?.email)await notifyEmail(customer.email,`Ashwini Clothing Payment Received - Order #${updated.id}`,`Hello ${customer.name||'Customer'},\n\nWe received the Cash on Delivery payment for Order #${updated.id}. Its payment status is now PAID.\n\nThank you for shopping with Ashwini Clothing.`);
  res.json({ok:true,order:updated});
 }catch(e){console.error('[Ashwini COD payment]',e);res.status(400).json({error:e.message||'COD payment could not be recorded'})}
});
app.patch("/api/admin/orders/:id",auth,admin,async(req,res)=>{
 const ok=["PAYMENT_PENDING","PLACED","CONFIRMED","PACKED","SHIPPED","OUT_FOR_DELIVERY","DELIVERED","CANCELLED"];
 if(!ok.includes(req.body.status))return res.status(400).json({error:"Invalid status"});
 const before=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
 if(!before)return res.status(404).json({error:"Order not found"});
 const nextStatus=String(req.body.status);
 if(nextStatus===before.status)return res.json({ok:true,unchanged:true,order:before});
 if(req.body.status==='CANCELLED'){
  try{const order=await cancelOrderSafely(before);if(before.status!==order.status){logAdminActivity(req,'ORDER_CANCELLED','ORDER',order.id,{from_status:before.status,to_status:order.status,from_payment_status:before.payment_status,to_payment_status:order.payment_status,refund_status:order.refund_status||''});const msg=order.payment_status==='REFUND_PENDING'||order.payment_status==='REFUNDED'?`Order #${order.id} was cancelled and its Razorpay refund was initiated.`:`Order #${order.id} was cancelled.`;addOrderEvent(order.id,order.user_id,'CANCELLED','Order cancelled',msg);const u=db.prepare('SELECT name,email FROM users WHERE id=?').get(order.user_id);if(u?.email)await notifyEmail(u.email,`Ashwini Clothing Order #${order.id} Cancelled`,msg)}return res.json({ok:true,order})}catch(e){return res.status(400).json({error:e.message||'Order cancellation failed'})}
 }
 const allowedNext={PLACED:['CONFIRMED'],CONFIRMED:['PACKED'],PACKED:['SHIPPED'],SHIPPED:['OUT_FOR_DELIVERY'],OUT_FOR_DELIVERY:['DELIVERED']};
 if(!allowedNext[String(before.status)]?.includes(nextStatus))return res.status(409).json({error:`Order must move forward one step at a time. ${before.status} cannot change directly to ${nextStatus}.`});
 if(before.payment_method==='RAZORPAY'&&before.payment_status!=='PAID')return res.status(409).json({error:'Online payment must be securely confirmed by Razorpay before fulfilment can continue.'});
 const result=db.prepare("UPDATE orders SET status=?,delivered_at=CASE WHEN ?='DELIVERED' AND COALESCE(delivered_at,'')='' THEN CURRENT_TIMESTAMP ELSE delivered_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?").run(nextStatus,nextStatus,req.params.id,before.status);
 if(!result.changes)return res.status(409).json({error:"Order changed in another request. Refresh and try again."});
 const order=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
 logAdminActivity(req,'ORDER_STATUS_CHANGED','ORDER',order.id,{from_status:before.status,to_status:order.status,payment_status:order.payment_status});
 if(order.status==='CANCELLED'&&order.payment_status!=='PAID')releaseOrderStock(order.id,'CANCELLED');
 if(before.status!==order.status){const label=String(order.status).replaceAll("_"," ");const msg=`Order #${order.id} is now ${label}. Payment status: ${String(order.payment_status||'PENDING').replaceAll('_',' ')}.`;addOrderEvent(order.id,order.user_id,order.status,`Order ${label}`,msg);const u=db.prepare("SELECT name,email FROM users WHERE id=?").get(order.user_id);if(u?.email){await notifyEmail(u.email,`Ashwini Clothing Order #${order.id} - ${label}`,`Hello ${u.name||'Customer'},\n\n${msg}\n\nTrack your order from Your Orders in your Ashwini Clothing account.`)}}
 res.json({ok:true,order});
});
app.post("/api/admin/products",auth,admin,(req,res)=>{
 const {name,category,size_options="S,M,L,XL",color="Black",price,mrp,rating=0,emoji="👕",stock=0,description="",image="",gallery="",product_history="",size_chart="",care_instructions="",badge_text="Ashwini Choice",offer_text="",offer_discount=0}=req.body;
 const r=db.prepare("INSERT INTO products(name,category,size_options,color,price,mrp,rating,emoji,stock,description,image,gallery,product_history,size_chart,care_instructions,badge_text,offer_text,offer_discount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(name,category,size_options,color,price,mrp,rating,emoji,stock,description,image,typeof gallery==="string"?gallery:JSON.stringify(gallery||[]),product_history,typeof size_chart==="string"?size_chart:JSON.stringify(size_chart||[]),care_instructions,String(badge_text||''),String(offer_text||''),Number(offer_discount||0));
 logAdminActivity(req,'PRODUCT_CREATED','PRODUCT',r.lastInsertRowid,{name:String(name||'').slice(0,200),stock:Number(stock)||0,price:Number(price)||0});
 res.json(db.prepare("SELECT * FROM products WHERE id=?").get(r.lastInsertRowid));
});
app.patch("/api/admin/products/:id",auth,admin,(req,res)=>{
 const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);if(!p)return res.status(404).json({error:"Not found"});
 const x={...p,...req.body};db.prepare("UPDATE products SET name=?,category=?,size_options=?,color=?,price=?,mrp=?,rating=?,emoji=?,stock=?,description=?,image=?,gallery=?,product_history=?,size_chart=?,care_instructions=?,badge_text=?,offer_text=?,offer_discount=? WHERE id=?")
 .run(x.name,x.category,x.size_options,x.color,x.price,x.mrp,x.rating,x.emoji,x.stock,x.description,x.image,typeof x.gallery==="string"?x.gallery:JSON.stringify(x.gallery||[]),x.product_history||"",typeof x.size_chart==="string"?x.size_chart:JSON.stringify(x.size_chart||[]),x.care_instructions||"",String(x.badge_text||''),String(x.offer_text||''),Number(x.offer_discount||0),p.id);logAdminActivity(req,'PRODUCT_UPDATED','PRODUCT',p.id,{name:String(x.name||'').slice(0,200),from_stock:Number(p.stock)||0,to_stock:Number(x.stock)||0,from_price:Number(p.price)||0,to_price:Number(x.price)||0});res.json(x);
});
app.delete("/api/admin/products/:id",auth,admin,(req,res)=>{const product=db.prepare('SELECT id,name,stock,price FROM products WHERE id=?').get(req.params.id);if(!product)return res.status(404).json({error:'Product not found'});db.prepare("DELETE FROM products WHERE id=?").run(product.id);logAdminActivity(req,'PRODUCT_DELETED','PRODUCT',product.id,{name:product.name,stock:product.stock,price:product.price});res.json({ok:true})});

app.get("/api/webhooks/health",(req,res)=>res.json({razorpayConfigured:Boolean(razorpay)}));
app.use('/api',(req,res)=>res.status(404).json({error:'Not found'}));
app.get(/.*/,(req,res)=>path.extname(req.path)?res.status(404).end():sendPublicFile(res,'index.html'));
app.use((req,res)=>res.status(404).end());
app.listen(PORT,"0.0.0.0",()=>console.log(`Ashwini Clothing: http://0.0.0.0:${PORT}`));
