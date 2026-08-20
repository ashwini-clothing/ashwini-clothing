
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import Razorpay from "razorpay";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(), PORT=process.env.PORT||3000;
const SECRET=process.env.JWT_SECRET||"CHANGE_ME";

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
try{db.exec("ALTER TABLE products ADD COLUMN gallery TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN product_history TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN size_chart TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN care_instructions TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN badge_text TEXT DEFAULT 'Ashwini Choice'")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN offer_text TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE products ADD COLUMN offer_discount REAL DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN otp_hash TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN otp_expires_at INTEGER DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN login_otp_hash TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN login_otp_expires_at INTEGER DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN recovery_otp_hash TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN recovery_otp_expires_at INTEGER DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN replacement_for_order_id INTEGER DEFAULT NULL")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN replacement_for_return_id INTEGER DEFAULT NULL")}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS product_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, user_id INTEGER, question TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS product_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), feedback TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS offers (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '', coupon_code TEXT DEFAULT '', discount_percent REAL DEFAULT 0, banner_url TEXT DEFAULT '', button_text TEXT DEFAULT 'Shop Now', button_action TEXT DEFAULT '', start_at TEXT DEFAULT '', end_at TEXT DEFAULT '', active INTEGER DEFAULT 1, show_popup INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS homepage_slides (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT DEFAULT '', offer_text TEXT DEFAULT '', image_url TEXT NOT NULL, button_text TEXT DEFAULT 'Shop Now', button_action TEXT DEFAULT '', active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec("ALTER TABLE homepage_slides ADD COLUMN offer_text TEXT DEFAULT ''")}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS shop_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, icon TEXT DEFAULT '👗', active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
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
try{db.exec(`CREATE TABLE IF NOT EXISTS customer_help_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, contact_method TEXT NOT NULL DEFAULT 'EMAIL', status TEXT NOT NULL DEFAULT 'NEW', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`)}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS store_profile (id INTEGER PRIMARY KEY CHECK(id=1), about_title TEXT NOT NULL DEFAULT 'About Ashwini Clothing', history TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', pincode TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT 'ashwiniweb88@gmail.com', phone TEXT NOT NULL DEFAULT '', logo_data TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}catch{}
try{db.exec("ALTER TABLE store_profile ADD COLUMN logo_data TEXT NOT NULL DEFAULT ''")}catch{}
try{db.prepare(`INSERT OR IGNORE INTO store_profile(id,about_title,history,address,city,state,pincode,email,phone,logo_data) VALUES(1,?,?,?,?,?,?,?,?,?)`).run('About Ashwini Clothing','Welcome to Ashwini Clothing. Our story and company information can be updated by the store admin.','','','','','ashwiniweb88@gmail.com','', '')}catch{}
try{db.exec(`CREATE TABLE IF NOT EXISTS product_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, user_id INTEGER, answer TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(question_id) REFERENCES product_questions(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL)`)}catch{}
db.exec(fs.readFileSync(path.join(__dirname,"seed.sql"),"utf8"));
// Keep the Ashwini product photo path correct even if an older database already exists.
db.prepare("UPDATE products SET image=? WHERE id=?").run('/new-model-dress-clean.jpg',100);
const razorpay=process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET
 ? new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;

app.use(cors());
app.use(express.json({limit:'25mb'}));
app.use(express.static(__dirname));
function token(u){return jwt.sign({id:u.id,name:u.name,email:u.email,phone:u.phone||"",role:u.role},SECRET,{expiresIn:"7d"})}
function auth(req,res,next){
 try{
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer "))throw 0;
  const claims=jwt.verify(h.slice(7),SECRET);
  // Never trust a stale JWT user id after an old/local database has been
  // reused. Re-hydrate the account from the current database so foreign-key
  // inserts always reference a real users.id.
  let u=db.prepare("SELECT id,name,email,role,phone FROM users WHERE id=?").get(claims.id);
  if(!u && claims.email) u=db.prepare("SELECT id,name,email,role,phone FROM users WHERE email=?").get(String(claims.email).toLowerCase());
  if(!u && claims.phone) u=db.prepare("SELECT id,name,email,role,phone FROM users WHERE phone=?").get(String(claims.phone).replace(/\\D/g,""));
  if(!u) return res.status(401).json({error:"Login required. Please sign in again."});
  req.user=u;
  next();
 }catch{res.status(401).json({error:"Login required. Please sign in again."})}
}
function admin(req,res,next){if(req.user?.role!=="admin")return res.status(403).json({error:"Admin only"});next()}
async function sendEmail(to,subject,text,html){
 const provider=String(process.env.EMAIL_PROVIDER||'resend').trim().toLowerCase();
 const from=process.env.EMAIL_FROM||'Ashwini Clothing <onboarding@resend.dev>';
 if(!to)return {sent:false,configured:false,error:'Recipient email is missing'};
 const safeHtml=html||`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Ashwini Clothing</h2><p>${String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p></div>`;
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
app.get("/api/store-profile",(req,res)=>{res.json(db.prepare("SELECT * FROM store_profile WHERE id=1").get()||{})});
app.patch("/api/admin/store-profile",auth,admin,(req,res)=>{try{const b=req.body||{};const logo=String(b.logo_data||"");if(logo && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(logo))return res.status(400).json({error:"Invalid logo image"});if(logo.length>15*1024*1024)return res.status(400).json({error:"Logo image is too large"});db.prepare(`UPDATE store_profile SET about_title=?,history=?,address=?,city=?,state=?,pincode=?,email=?,phone=?,logo_data=CASE WHEN ?='' THEN logo_data ELSE ? END,updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(String(b.about_title||"About Ashwini Clothing").trim(),String(b.history||"").trim(),String(b.address||"").trim(),String(b.city||"").trim(),String(b.state||"").trim(),String(b.pincode||"").trim(),String(b.email||"ashwiniweb88@gmail.com").trim(),String(b.phone||"").trim(),logo,logo);res.json(db.prepare("SELECT * FROM store_profile WHERE id=1").get())}catch(e){res.status(400).json({error:e.message})}});

app.get("/api/pincode/:pin",async(req,res)=>{
 const pin=String(req.params.pin||'').trim();
 if(!/^\d{6}$/.test(pin)) return res.status(400).json({error:"Enter a valid 6-digit PIN code"});
 // Try India Post first. Some valid PINs can temporarily return an empty response,
 // so fall back to a second postal database instead of immediately saying Not Found.
 try{
  const r=await fetch(`https://api.postalpincode.in/pincode/${pin}`,{headers:{accept:'application/json'}});
  if(r.ok){
   const data=await r.json();
   const offices=data?.[0]?.PostOffice||[];
   const po=offices[0];
   if(po){
    return res.json({pin,area:po.Name||'',district:po.District||'',city:po.Block||po.District||po.Division||'',state:po.State||'',country:po.Country||'India'});
   }
  }
 }catch{}
 try{
  const r2=await fetch(`https://api.zippopotam.us/in/${pin}`,{headers:{accept:'application/json'}});
  if(r2.ok){
   const z=await r2.json();
   const place=z?.places?.[0];
   if(place){
    return res.json({pin,area:place['place name']||'',district:place['place name']||'',city:place['place name']||'',state:place['state']||'',country:z.country||'India'});
   }
  }
 }catch{}
 return res.status(404).json({error:"PIN code location could not be found. Please check the 6-digit PIN."});
});

app.post("/api/coupons/check",auth,(req,res)=>{try{const code=String(req.body?.code||'').trim().toUpperCase();if(code==='NEW2026'){const first=db.prepare("SELECT COUNT(*) n FROM orders WHERE user_id=?").get(req.user.id).n===0;if(!first)throw Error('Coupon already used or not available for this account');return res.json({ok:true,discount_percent:30,code})}const now=new Date().toISOString();const o=db.prepare("SELECT * FROM offers WHERE active=1 AND coupon_code=? AND (start_at='' OR start_at<=?) AND (end_at='' OR end_at>=?) ORDER BY id DESC LIMIT 1").get(code,now,now);if(!o)throw Error('Coupon not recognised or expired');res.json({ok:true,discount_percent:Number(o.discount_percent||0),code:o.coupon_code,title:o.title})}catch(e){res.status(400).json({error:e.message})}});
app.get("/api/slides",(req,res)=>{res.json(db.prepare("SELECT * FROM homepage_slides WHERE active=1 ORDER BY sort_order,id").all())});
app.get("/api/admin/slides",auth,admin,(req,res)=>res.json(db.prepare("SELECT * FROM homepage_slides ORDER BY sort_order,id").all()));
app.post("/api/admin/slides",auth,admin,(req,res)=>{try{const b=req.body||{};if(!String(b.image_url||'').trim())throw Error('Slide image URL is required');const r=db.prepare("INSERT INTO homepage_slides(title,image_url,button_text,button_action,active,sort_order,offer_text) VALUES(?,?,?,?,?,?,?)").run(String(b.title||''),String(b.image_url).trim(),String(b.button_text||'Shop Now'),String(b.button_action||''),b.active===false?0:1,Number(b.sort_order||0),String(b.offer_text||''));res.json(db.prepare("SELECT * FROM homepage_slides WHERE id=?").get(r.lastInsertRowid))}catch(e){res.status(400).json({error:e.message})}});
app.patch("/api/admin/slides/:id",auth,admin,(req,res)=>{try{const b=req.body||{};if(!String(b.image_url||'').trim())throw Error('Slide image URL is required');db.prepare("UPDATE homepage_slides SET title=?,image_url=?,button_text=?,button_action=?,active=?,sort_order=?,offer_text=? WHERE id=?").run(String(b.title||''),String(b.image_url).trim(),String(b.button_text||'Shop Now'),String(b.button_action||''),b.active?1:0,Number(b.sort_order||0),String(b.offer_text||''),req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
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
 const {q="",category="All",sort="featured"}=req.query;
 let rows=db.prepare(`SELECT * FROM products
 WHERE (?='' OR name LIKE ? OR category LIKE ?)
 AND (?='All' OR category=?)`).all(q,`%${q}%`,`%${q}%`,category,category);
 if(sort==="low")rows.sort((a,b)=>a.price-b.price);
 if(sort==="high")rows.sort((a,b)=>b.price-a.price);
 if(sort==="rating")rows.sort((a,b)=>b.rating-a.rating);
 res.json(rows);
});
function makeOtp(){return String(Math.floor(100000+Math.random()*900000))}
function hashOtp(otp){return crypto.createHash("sha256").update(String(otp)).digest("hex")}
function normalizePhone(v){return String(v||"").replace(/\D/g,"")}
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
 console.log(`[Ashwini ${kind.toUpperCase()} OTP] ${u.email || u.phone}: ${otp}`);
 return otp;
}
app.post("/api/auth/request-otp",(req,res)=>{
 const phone=normalizePhone(req.body?.phone);
 if(!/^\d{10}$/.test(phone))return res.status(400).json({error:"Enter a valid 10-digit mobile number"});
 const existing=db.prepare("SELECT id FROM users WHERE phone=?").get(phone);
 if(existing) db.prepare("UPDATE users SET otp_hash='',otp_expires_at=0 WHERE id=?").run(existing.id);
 else db.prepare("INSERT INTO users(name,email,password_hash,phone,otp_hash,otp_expires_at) VALUES(?,?,?,?,?,?)").run("Pending Buyer",`phone_${phone}@ashwini.local`,"",phone,"",0);
 const u=db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
 const otp=issueOtp(u,'login');
 res.json({ok:true,devOtp:otp,channel:'mobile',message:"OTP generated. In live mode connect an SMS provider to deliver it."});
});
app.post("/api/auth/request-login-otp",(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim();
 if(!identifier)return res.status(400).json({error:"Enter your email or mobile number"});
 const u=findCustomerByIdentifier(identifier);
 if(!u)return res.status(404).json({error:"Customer account not found. Please register first."});
 const otp=issueOtp(u,'login');
 const channel=/^\d{10}$/.test(normalizePhone(identifier))?'mobile':'email';
 res.json({ok:true,devOtp:otp,channel,message:`${channel==='mobile'?'Mobile':'Email'} OTP generated. Connect the real SMS/email provider before launch.`});
});
app.post("/api/auth/verify-login-otp",(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim(), otp=String(req.body?.otp||"").trim();
 const u=findCustomerByIdentifier(identifier);
 if(!u)return res.status(404).json({error:"Customer account not found"});
 if(!/^\d{6}$/.test(otp)||!u.login_otp_hash||u.login_otp_expires_at<Date.now()||hashOtp(otp)!==u.login_otp_hash)return res.status(400).json({error:"Invalid or expired OTP"});
 db.prepare("UPDATE users SET login_otp_hash='',login_otp_expires_at=0 WHERE id=?").run(u.id);
 const safe={id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone||''};
 res.json({token:token(safe),user:safe});
});
app.post("/api/auth/request-recovery-otp",(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim();
 if(!identifier)return res.status(400).json({error:"Enter your registered email or mobile number"});
 const u=findCustomerByIdentifier(identifier);
 if(!u)return res.status(404).json({error:"No customer account found with this email or mobile number"});
 const otp=issueOtp(u,'recovery');
 const channel=/^\d{10}$/.test(normalizePhone(identifier))?'mobile':'email';
 res.json({ok:true,devOtp:otp,channel,message:`Recovery OTP generated for ${channel}.`});
});
app.post("/api/auth/forgot-login-id",(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim(), otp=String(req.body?.otp||"").trim();
 const u=findCustomerByIdentifier(identifier);
 if(!u)return res.status(404).json({error:"Customer account not found"});
 if(!/^\d{6}$/.test(otp)||!u.recovery_otp_hash||u.recovery_otp_expires_at<Date.now()||hashOtp(otp)!==u.recovery_otp_hash)return res.status(400).json({error:"Invalid or expired OTP"});
 db.prepare("UPDATE users SET recovery_otp_hash='',recovery_otp_expires_at=0 WHERE id=?").run(u.id);
 res.json({ok:true,loginId:u.email,message:"Your login ID is your registered email address."});
});
app.post("/api/auth/reset-password",async(req,res)=>{
 const identifier=String(req.body?.identifier||"").trim(), otp=String(req.body?.otp||"").trim(), password=String(req.body?.password||"");
 const u=findCustomerByIdentifier(identifier);
 if(!u)return res.status(404).json({error:"Customer account not found"});
 if(password.length<8)return res.status(400).json({error:"Password must be at least 8 characters"});
 if(!/^\d{6}$/.test(otp)||!u.recovery_otp_hash||u.recovery_otp_expires_at<Date.now()||hashOtp(otp)!==u.recovery_otp_hash)return res.status(400).json({error:"Invalid or expired OTP"});
 const hash=await bcrypt.hash(password,12);
 db.prepare("UPDATE users SET password_hash=?,recovery_otp_hash='',recovery_otp_expires_at=0 WHERE id=?").run(hash,u.id);
 res.json({ok:true,message:"Password reset successfully. You can now sign in."});
});
app.post("/api/auth/register",async(req,res)=>{
 const {name,email,password,phone,otp}=req.body||{};
 if(!name||!email||!password||!/^[0-9]{10}$/.test(String(phone||""))||!/^[0-9]{6}$/.test(String(otp||"")))return res.status(400).json({error:"Name, email, mobile number and 6-digit OTP are required"});
 const u0=db.prepare("SELECT * FROM users WHERE phone=?").get(String(phone));
 if(!u0||!u0.login_otp_hash && !u0.otp_hash)return res.status(400).json({error:"Please request a fresh OTP"});
 const expected=u0.login_otp_hash||u0.otp_hash, expires=u0.login_otp_expires_at||u0.otp_expires_at;
 if(expires<Date.now()||hashOtp(otp)!==expected)return res.status(400).json({error:"Invalid or expired OTP"});
 try{const hash=await bcrypt.hash(password,12);db.prepare("UPDATE users SET name=?,email=?,password_hash=?,otp_hash='',otp_expires_at=0,login_otp_hash='',login_otp_expires_at=0 WHERE id=?").run(name,email.toLowerCase(),hash,u0.id);const u=db.prepare("SELECT id,name,email,role,phone FROM users WHERE id=?").get(u0.id);res.json({token:token(u),user:u})}
 catch{res.status(409).json({error:"Email or mobile already registered"})}
});
app.post("/api/auth/setup-admin",async(req,res)=>{
 const admins=db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n;
 if(admins>0)return res.status(403).json({error:"Store admin is already configured"});
 const {name,email,password}=req.body||{};
 if(!name||!email||!password||String(password).length<8)return res.status(400).json({error:"Name, email and an 8+ character password are required"});
 try{const hash=await bcrypt.hash(password,12);const r=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)").run(name,email.toLowerCase(),hash,'admin');const u=db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(r.lastInsertRowid);res.json({token:token(u),user:u})}
 catch{res.status(409).json({error:"Email already registered"})}
});
app.post("/api/auth/login",async(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email||"").toLowerCase());
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password_hash)))return res.status(401).json({error:"Invalid email or password"});
 const safe={id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone||''};res.json({token:token(safe),user:safe});
});
app.get("/api/me",auth,(req,res)=>{
 try{
  const u=db.prepare("SELECT id,name,email,phone,role,created_at FROM users WHERE id=?").get(req.user.id);
  if(!u)return res.status(404).json({error:"Account not found"});
  res.json({user:u});
 }catch(e){res.status(400).json({error:e.message||"Could not load account"})}
});

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
 const rows=db.prepare(`SELECT r.id,r.product_id,r.rating,r.feedback,r.created_at,u.name AS customer_name FROM product_reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.created_at DESC`).all(productId);
 const summary=db.prepare('SELECT COUNT(*) count, COALESCE(AVG(rating),0) avg FROM product_reviews WHERE product_id=?').get(productId);
 res.json({reviews:rows.map(r=>({...r,customer_name:r.customer_name||'Customer'})),count:Number(summary.count||0),average:Number(summary.avg||0)});
});
app.post('/api/products/:id/reviews',auth,(req,res)=>{
 if(req.user.role!=='customer')return res.status(403).json({error:'Customer review only'});
 const productId=Number(req.params.id), rating=Number(req.body?.rating), feedback=String(req.body?.feedback||'').trim();
 if(!Number.isInteger(rating)||rating<1||rating>5)return res.status(400).json({error:'Please select 1 to 5 stars'});
 if(!feedback)return res.status(400).json({error:'Please write your feedback'});
 if(feedback.length>1000)return res.status(400).json({error:'Feedback is too long'});
 if(!db.prepare('SELECT id FROM products WHERE id=?').get(productId))return res.status(404).json({error:'Product not found'});
 const existing=db.prepare('SELECT id FROM product_reviews WHERE product_id=? AND user_id=?').get(productId,req.user.id);
 if(existing){db.prepare('UPDATE product_reviews SET rating=?,feedback=?,created_at=CURRENT_TIMESTAMP WHERE id=?').run(rating,feedback,existing.id);}
 else db.prepare('INSERT INTO product_reviews(product_id,user_id,rating,feedback) VALUES(?,?,?,?)').run(productId,req.user.id,rating,feedback);
 const avg=db.prepare('SELECT COALESCE(AVG(rating),0) avg FROM product_reviews WHERE product_id=?').get(productId).avg;
 db.prepare('UPDATE products SET rating=? WHERE id=?').run(Number(Number(avg).toFixed(1)),productId);
 res.json({ok:true,rating:Number(Number(avg).toFixed(1))});
});

function resolveItems(items){
 if(!Array.isArray(items)||!items.length)throw Error("Cart is empty");
 let total=0,out=[];
 for(const x of items){
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(Number(x.id));
  const qty=Math.max(1,Number(x.quantity||1));
  if(!p)throw Error("Product not found");
  if(!p.size_options.split(",").includes(x.size))throw Error(`Size unavailable for ${p.name}`);
  if(p.stock<qty)throw Error(`Only ${p.stock} left for ${p.name}`);
  total+=p.price*qty;out.push({p,qty,size:x.size});
 }
 return {total,out};
}
app.post("/api/checkout/create",auth,async(req,res)=>{
 try{
  const {items,address,payment_method="RAZORPAY",coupon=""}=req.body||{};
  if(!address?.trim())throw Error("Delivery address required");
  const enteredPhone=String(req.body?.mobile||'').replace(/\D/g,'');
  if(!/^\d{10}$/.test(enteredPhone))throw Error("Please enter a valid 10-digit mobile number");

  // Always resolve the authenticated customer from the CURRENT database
  // immediately before creating the order. Never use a stale JWT id directly.
  let currentUser=db.prepare("SELECT id,name,email,role,phone FROM users WHERE id=?").get(req.user.id);
  if(!currentUser && req.user.email) currentUser=db.prepare("SELECT id,name,email,role,phone FROM users WHERE email=?").get(String(req.user.email).toLowerCase());
  if(!currentUser && req.user.phone) currentUser=db.prepare("SELECT id,name,email,role,phone FROM users WHERE phone=?").get(String(req.user.phone).replace(/\D/g,''));
  if(!currentUser)throw Error("Customer account was not found. Please sign in again.");

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
   const r=db.prepare("INSERT INTO orders(user_id,total,status,payment_status,payment_method,address,customer_phone) VALUES(?,?,?,?,?,?,?)")
    .run(parent.id,total,payment_method==="COD"?"PLACED":"PAYMENT_PENDING","PENDING",payment_method,address,customerPhone);
   const add=db.prepare("INSERT INTO order_items(order_id,product_id,size,quantity,unit_price) VALUES(?,?,?,?,?)");
   const dec=db.prepare("UPDATE products SET stock=stock-? WHERE id=?");
   for(const x of out){
    add.run(r.lastInsertRowid,x.p.id,x.size,x.qty,x.p.price);
    dec.run(x.qty,x.p.id);
   }
   return Number(r.lastInsertRowid);
  });

  const orderId=createOrder();
  if(payment_method==="COD")return res.json({ok:true,mode:"COD",orderId,total});
  if(!razorpay)return res.status(503).json({error:"Razorpay not configured. Add keys in .env"});
  const rp=await razorpay.orders.create({amount:total*100,currency:"INR",receipt:`ASHWINI-${orderId}`});
  db.prepare("UPDATE orders SET razorpay_order_id=? WHERE id=?").run(rp.id,orderId);
  res.json({ok:true,mode:"RAZORPAY",orderId,total,razorpayOrderId:rp.id,keyId:process.env.RAZORPAY_KEY_ID});
 }catch(e){console.error('[Ashwini checkout]',e);res.status(400).json({error:e.message||"Order could not be created"})}
});
app.post("/api/checkout/verify",auth,(req,res)=>{
 const {orderId,razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body;
 const o=db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").get(orderId,req.user.id);
 if(!o||o.razorpay_order_id!==razorpay_order_id)return res.status(400).json({error:"Order mismatch"});
 const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET||"").update(o.razorpay_order_id+"|"+razorpay_payment_id).digest("hex");
 if(expected!==razorpay_signature)return res.status(400).json({error:"Payment verification failed"});
 db.prepare("UPDATE orders SET payment_status='PAID',status='CONFIRMED',razorpay_payment_id=?,razorpay_signature=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(razorpay_payment_id,razorpay_signature,o.id);
 res.json({ok:true});
});

app.get('/api/me',auth,(req,res)=>{const u=db.prepare("SELECT id,name,email,phone,role,created_at FROM users WHERE id=?").get(req.user.id);if(!u)return res.status(404).json({error:'Account not found'});res.json(u)});
app.patch('/api/me',auth,(req,res)=>{try{const name=String(req.body?.name||'').trim(),email=String(req.body?.email||'').trim(),phone=String(req.body?.phone||'').replace(/\D/g,'');if(!name||!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!/^[0-9]{10}$/.test(phone))return res.status(400).json({error:'Enter a valid name, email and 10-digit mobile number'});const exists=db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?").get(email,req.user.id);if(exists)return res.status(409).json({error:'Email is already in use'});db.prepare('UPDATE users SET name=?,email=?,phone=? WHERE id=?').run(name,email,phone,req.user.id);const u=db.prepare("SELECT id,name,email,phone,role FROM users WHERE id=?").get(req.user.id);res.json({ok:true,user:u,token:token(u)});}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/return-events',auth,(req,res)=>{try{res.json(db.prepare('SELECT e.* FROM return_events e WHERE e.user_id=? ORDER BY e.id DESC LIMIT 100').all(req.user.id))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/order-events',auth,(req,res)=>{try{res.json(db.prepare('SELECT e.* FROM order_events e WHERE e.user_id=? ORDER BY e.id DESC LIMIT 100').all(req.user.id))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/returns',auth,(req,res)=>{try{res.json(db.prepare(`SELECT r.*,o.total,o.status AS order_status,o.created_at AS order_date,ro.status AS replacement_order_status,ro.address AS replacement_address FROM returns r JOIN orders o ON o.id=r.order_id LEFT JOIN orders ro ON ro.id=r.replacement_order_id WHERE r.user_id=? ORDER BY r.id DESC`).all(req.user.id))}catch(e){res.status(400).json({error:e.message})}});
app.patch('/api/returns/:id/cancel',auth,async(req,res)=>{try{const r=db.prepare(`SELECT r.*,u.name AS customer_name,u.email AS customer_email,o.id AS order_id FROM returns r JOIN users u ON u.id=r.user_id JOIN orders o ON o.id=r.order_id WHERE r.id=? AND r.user_id=?`).get(req.params.id,req.user.id);if(!r)return res.status(404).json({error:'Return request not found'});const cancellable=['REQUESTED','APPROVED','PICKUP_SCHEDULED'];if(!cancellable.includes(String(r.status)))return res.status(400).json({error:'This return can no longer be cancelled because the pickup/inspection process has started'});db.prepare(`UPDATE returns SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(r.id);addReturnEvent(r.id,r.user_id,'CANCELLED','Return request cancelled','Your return request #'+r.id+' for Order #'+r.order_id+' was cancelled by you.');const adminEmail=db.prepare('SELECT email FROM store_profile WHERE id=1').get()?.email||'ashwiniweb88@gmail.com';await Promise.all([sendReturnEmail(adminEmail,`Ashwini Return #${r.id} Cancelled`,`Customer: ${r.customer_name} (${r.customer_email})\nOrder: #${r.order_id}\nThe customer cancelled the return request.`),sendReturnEmail(r.customer_email,`Ashwini Clothing Return Cancelled - Order #${r.order_id}`,`Your return request #${r.id} has been cancelled successfully. Your order remains delivered.`)]);res.json({ok:true,return:db.prepare('SELECT * FROM returns WHERE id=?').get(r.id)})}catch(e){console.error('[Ashwini return cancel]',e);res.status(400).json({error:e.message})}});
app.get('/api/admin/returns',auth,admin,(req,res)=>{try{res.json(db.prepare(`SELECT r.*,o.total,o.created_at AS order_date,o.status AS order_status,u.name AS customer_name,u.email AS customer_email,u.phone AS customer_phone,ro.id AS replacement_order_id,ro.status AS replacement_order_status,ro.address AS replacement_address FROM returns r JOIN orders o ON o.id=r.order_id LEFT JOIN users u ON u.id=r.user_id LEFT JOIN orders ro ON ro.id=r.replacement_order_id ORDER BY CASE r.status WHEN 'REQUESTED' THEN 0 WHEN 'APPROVED' THEN 1 WHEN 'PICKUP_SCHEDULED' THEN 2 WHEN 'COMPLETED' THEN 3 ELSE 4 END, r.id DESC`).all())}catch(e){res.status(400).json({error:e.message})}});
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

app.post('/api/returns',auth,async(req,res)=>{try{const orderId=Number(req.body?.order_id),reason=String(req.body?.reason||'').trim(),requestType=String(req.body?.request_type||'REPLACEMENT').trim().toUpperCase(),replacementSize=String(req.body?.replacement_size||'').trim().slice(0,20),replacementColor=String(req.body?.replacement_color||'').trim().slice(0,40);if(!Number.isInteger(orderId)||!reason)return res.status(400).json({error:'Order and return reason are required'});if(!['REPLACEMENT','EXCHANGE'].includes(requestType))return res.status(400).json({error:'Invalid return option'});const o=db.prepare('SELECT id,status,total FROM orders WHERE id=? AND user_id=?').get(orderId,req.user.id);if(!o)return res.status(404).json({error:'Order not found'});if(o.status!=='DELIVERED')return res.status(400).json({error:'Return can be requested after delivery'});const deliveredAt=Date.parse(String(o.updated_at||o.created_at||''));if(Number.isFinite(deliveredAt)&&Date.now()-deliveredAt>4*24*60*60*1000)return res.status(400).json({error:'The 4-day return period has expired'});const existing=db.prepare("SELECT id FROM returns WHERE order_id=? AND user_id=? AND status NOT IN ('REJECTED','CANCELLED')").get(orderId,req.user.id);if(existing)return res.status(400).json({error:'A return request already exists for this order'});const r=db.prepare('INSERT INTO returns(order_id,user_id,reason,request_type,replacement_size,replacement_color) VALUES(?,?,?,?,?,?)').run(orderId,req.user.id,reason,requestType,replacementSize,replacementColor);addReturnEvent(r.lastInsertRowid,req.user.id,'REQUESTED','Return request submitted',`Your return request #${r.lastInsertRowid} for Order #${orderId} was submitted and is awaiting admin review.`);const u=db.prepare('SELECT name,email FROM users WHERE id=?').get(req.user.id);const adminEmail=db.prepare('SELECT email FROM store_profile WHERE id=1').get()?.email||'ashwiniweb88@gmail.com';await sendReturnEmail(adminEmail,`New Ashwini Return Request #${r.lastInsertRowid}`,`Customer: ${u?.name||'Customer'} (${u?.email||''})\nOrder: #${orderId}\nReason: ${reason}\nOption: ${requestType}${replacementSize?`\nRequested size: ${replacementSize}`:''}${replacementColor?`\nRequested colour: ${replacementColor}`:''}`);res.json({ok:true,id:r.lastInsertRowid});}catch(e){console.error('[Ashwini return request]',e);res.status(400).json({error:e.message})}});
app.get("/api/orders",auth,(req,res)=>{
 try{
  const me=db.prepare("SELECT id,phone FROM users WHERE id=?").get(req.user.id);
  if(!me)return res.status(401).json({error:"Customer account was not found. Please sign in again."});
  const phone=String(me.phone||'').replace(/\D/g,'');
  const os=phone && /^\d{10}$/.test(phone)
   ? db.prepare(`SELECT o.*,u.name AS customer_name,COALESCE(NULLIF(o.customer_phone,''),u.phone) AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.user_id=? OR o.customer_phone=? ORDER BY o.id DESC`).all(me.id,phone)
   : db.prepare("SELECT o.*,u.name AS customer_name,u.phone AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.user_id=? ORDER BY o.id DESC").all(me.id);
  const items=db.prepare("SELECT oi.*,p.name,p.emoji FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?");
  const returns=db.prepare('SELECT * FROM returns WHERE order_id=? ORDER BY id DESC');res.json(os.map(o=>({...o,items:items.all(o.id),return_request:(()=>{const rr=returns.get(o.id); if(!rr)return null; const ro=rr.replacement_order_id?db.prepare('SELECT id,status,address FROM orders WHERE id=?').get(rr.replacement_order_id):null; return {...rr,replacement_order:ro||null};})(),tracking:{current:o.status,stages:['PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED']}})));
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
  const items=db.prepare("SELECT oi.*,p.name,p.emoji FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?").all(o.id);
  const return_request0=db.prepare('SELECT * FROM returns WHERE order_id=? ORDER BY id DESC LIMIT 1').get(o.id)||null; const return_request=return_request0?( {...return_request0,replacement_order:return_request0.replacement_order_id?db.prepare('SELECT id,status,address FROM orders WHERE id=?').get(return_request0.replacement_order_id):null} ):null;
  res.json({...o,items,return_request,tracking:{current:o.status,stages:['PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED']}});
 }catch(e){res.status(500).json({error:e.message||'Could not load order'})}
});

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

app.get("/api/admin/stats",auth,admin,(req,res)=>{
 const revenue=db.prepare("SELECT COALESCE(SUM(total),0) total FROM orders WHERE payment_status='PAID'").get().total;
 res.json({revenue,orders:db.prepare("SELECT COUNT(*) n FROM orders").get().n,customers:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,products:db.prepare("SELECT COUNT(*) n FROM products").get().n});
});
app.get("/api/admin/orders",auth,admin,(req,res)=>res.json(db.prepare("SELECT o.*,u.name,u.email FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC").all()));
app.patch("/api/admin/orders/:id",auth,admin,async(req,res)=>{
 const ok=["PAYMENT_PENDING","PLACED","CONFIRMED","PACKED","SHIPPED","OUT_FOR_DELIVERY","DELIVERED","CANCELLED"];
 if(!ok.includes(req.body.status))return res.status(400).json({error:"Invalid status"});
 const before=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
 if(!before)return res.status(404).json({error:"Order not found"});
 const result=db.prepare("UPDATE orders SET status=?,payment_status=CASE WHEN ?='DELIVERED' THEN 'PAID' ELSE payment_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.body.status,req.body.status,req.params.id);
 if(!result.changes)return res.status(404).json({error:"Order not found"});
 const order=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
 if(before.status!==order.status){const label=String(order.status).replaceAll("_"," ");const msg=`Order #${order.id} is now ${label}.${order.status==='DELIVERED'?' Payment status is now PAID.':''}`;addOrderEvent(order.id,order.user_id,order.status,`Order ${label}`,msg);const u=db.prepare("SELECT name,email FROM users WHERE id=?").get(order.user_id);if(u?.email){await notifyEmail(u.email,`Ashwini Clothing Order #${order.id} - ${label}`,`Hello ${u.name||'Customer'},\n\n${msg}\n\nTrack your order from Your Orders in your Ashwini Clothing account.`)}}
 res.json({ok:true,order});
});
app.post("/api/admin/products",auth,admin,(req,res)=>{
 const {name,category,size_options="S,M,L,XL",color="Black",price,mrp,rating=0,emoji="👕",stock=0,description="",image="",gallery="",product_history="",size_chart="",care_instructions="",badge_text="Ashwini Choice",offer_text="",offer_discount=0}=req.body;
 const r=db.prepare("INSERT INTO products(name,category,size_options,color,price,mrp,rating,emoji,stock,description,image,gallery,product_history,size_chart,care_instructions,badge_text,offer_text,offer_discount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(name,category,size_options,color,price,mrp,rating,emoji,stock,description,image,typeof gallery==="string"?gallery:JSON.stringify(gallery||[]),product_history,typeof size_chart==="string"?size_chart:JSON.stringify(size_chart||[]),care_instructions,String(badge_text||''),String(offer_text||''),Number(offer_discount||0));
 res.json(db.prepare("SELECT * FROM products WHERE id=?").get(r.lastInsertRowid));
});
app.patch("/api/admin/products/:id",auth,admin,(req,res)=>{
 const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);if(!p)return res.status(404).json({error:"Not found"});
 const x={...p,...req.body};db.prepare("UPDATE products SET name=?,category=?,size_options=?,color=?,price=?,mrp=?,rating=?,emoji=?,stock=?,description=?,image=?,gallery=?,product_history=?,size_chart=?,care_instructions=?,badge_text=?,offer_text=?,offer_discount=? WHERE id=?")
 .run(x.name,x.category,x.size_options,x.color,x.price,x.mrp,x.rating,x.emoji,x.stock,x.description,x.image,typeof x.gallery==="string"?x.gallery:JSON.stringify(x.gallery||[]),x.product_history||"",typeof x.size_chart==="string"?x.size_chart:JSON.stringify(x.size_chart||[]),x.care_instructions||"",String(x.badge_text||''),String(x.offer_text||''),Number(x.offer_discount||0),p.id);res.json(x);
});
app.delete("/api/admin/products/:id",auth,admin,(req,res)=>{db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);res.json({ok:true})});

app.get("/api/webhooks/health",(req,res)=>res.json({razorpayConfigured:Boolean(razorpay)}));
app.use((req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`Ashwini Clothing: http://0.0.0.0:${PORT}`));
