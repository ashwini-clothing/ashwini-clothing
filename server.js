
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
try{db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN otp_hash TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN otp_expires_at INTEGER DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT DEFAULT ''")}catch{}
db.exec(fs.readFileSync(path.join(__dirname,"seed.sql"),"utf8"));
// Keep the Ashwini product photo path correct even if an older database already exists.
db.prepare("UPDATE products SET image=? WHERE id=?").run('/new-model-dress-clean.jpg',100);
const razorpay=process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET
 ? new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;

app.use(cors());
app.use(express.json());
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
app.post("/api/auth/request-otp",(req,res)=>{
 const phone=String(req.body?.phone||"").replace(/\D/g,"");
 if(!/^\d{10}$/.test(phone))return res.status(400).json({error:"Enter a valid 10-digit mobile number"});
 const otp=String(Math.floor(100000+Math.random()*900000));
 const hash=crypto.createHash("sha256").update(otp).digest("hex");
 const exp=Date.now()+5*60*1000;
 const existing=db.prepare("SELECT id FROM users WHERE phone=?").get(phone);
 if(existing) db.prepare("UPDATE users SET otp_hash=?,otp_expires_at=? WHERE id=?").run(hash,exp,existing.id);
 else db.prepare("INSERT INTO users(name,email,password_hash,phone,otp_hash,otp_expires_at) VALUES(?,?,?,?,?,?)").run("Pending Buyer",`phone_${phone}@ashwini.local`,"",phone,hash,exp);
 // Development mode: return the OTP so the local store can be tested without an SMS gateway.
 console.log(`[Ashwini OTP] ${phone}: ${otp}`);
 res.json({ok:true,devOtp:otp,message:"OTP generated. In live mode this code will be sent by SMS provider."});
});
app.post("/api/auth/register",async(req,res)=>{
 const {name,email,password,phone,otp}=req.body||{};
 if(!name||!email||!password||!/^\d{10}$/.test(String(phone||""))||!/^\d{6}$/.test(String(otp||"")))return res.status(400).json({error:"Name, email, mobile number and 6-digit OTP are required"});
 const u0=db.prepare("SELECT * FROM users WHERE phone=?").get(String(phone));
 if(!u0||!u0.otp_hash||u0.otp_expires_at<Date.now()||crypto.createHash("sha256").update(String(otp)).digest("hex")!==u0.otp_hash)return res.status(400).json({error:"Invalid or expired OTP"});
 try{const hash=await bcrypt.hash(password,12);db.prepare("UPDATE users SET name=?,email=?,password_hash=?,otp_hash=NULL,otp_expires_at=0 WHERE id=?").run(name,email.toLowerCase(),hash,u0.id);const u=db.prepare("SELECT id,name,email,role,phone FROM users WHERE id=?").get(u0.id);res.json({token:token(u),user:u})}
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
app.get("/api/me",auth,(req,res)=>res.json({user:req.user}));

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
  if(String(coupon).toUpperCase()==="NEW2026" && firstOrder) total=Math.round(total*0.70);

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
app.get("/api/orders",auth,(req,res)=>{
 try{
  const me=db.prepare("SELECT id,phone FROM users WHERE id=?").get(req.user.id);
  if(!me)return res.status(401).json({error:"Customer account was not found. Please sign in again."});
  const phone=String(me.phone||'').replace(/\D/g,'');
  const os=phone && /^\d{10}$/.test(phone)
   ? db.prepare(`SELECT o.*,u.name AS customer_name,COALESCE(NULLIF(o.customer_phone,''),u.phone) AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.user_id=? OR o.customer_phone=? ORDER BY o.id DESC`).all(me.id,phone)
   : db.prepare("SELECT o.*,u.name AS customer_name,u.phone AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.user_id=? ORDER BY o.id DESC").all(me.id);
  const items=db.prepare("SELECT oi.*,p.name,p.emoji FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?");
  res.json(os.map(o=>({...o,items:items.all(o.id),tracking:{current:o.status,stages:['PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED']}})));
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
  res.json({...o,items,tracking:{current:o.status,stages:['PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED']}});
 }catch(e){res.status(500).json({error:e.message||'Could not load order'})}
});
app.get("/api/admin/stats",auth,admin,(req,res)=>{
 const revenue=db.prepare("SELECT COALESCE(SUM(total),0) total FROM orders WHERE payment_status='PAID'").get().total;
 res.json({revenue,orders:db.prepare("SELECT COUNT(*) n FROM orders").get().n,customers:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,products:db.prepare("SELECT COUNT(*) n FROM products").get().n});
});
app.get("/api/admin/orders",auth,admin,(req,res)=>res.json(db.prepare("SELECT o.*,u.name,u.email FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC").all()));
app.patch("/api/admin/orders/:id",auth,admin,(req,res)=>{
 const ok=["PAYMENT_PENDING","PLACED","CONFIRMED","PACKED","SHIPPED","OUT_FOR_DELIVERY","DELIVERED","CANCELLED"];
 if(!ok.includes(req.body.status))return res.status(400).json({error:"Invalid status"});
 const result=db.prepare("UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.body.status,req.params.id);
 if(!result.changes)return res.status(404).json({error:'Order not found'});
 const order=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);res.json({ok:true,order});
});
app.post("/api/admin/products",auth,admin,(req,res)=>{
 const {name,category,size_options="S,M,L,XL",color="Black",price,mrp,rating=0,emoji="👕",stock=0,description="",image="",gallery="",product_history="",size_chart="",care_instructions=""}=req.body;
 const r=db.prepare("INSERT INTO products(name,category,size_options,color,price,mrp,rating,emoji,stock,description,image,gallery,product_history,size_chart,care_instructions) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(name,category,size_options,color,price,mrp,rating,emoji,stock,description,image,typeof gallery==="string"?gallery:JSON.stringify(gallery||[]),product_history,typeof size_chart==="string"?size_chart:JSON.stringify(size_chart||[]),care_instructions);
 res.json(db.prepare("SELECT * FROM products WHERE id=?").get(r.lastInsertRowid));
});
app.patch("/api/admin/products/:id",auth,admin,(req,res)=>{
 const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);if(!p)return res.status(404).json({error:"Not found"});
 const x={...p,...req.body};db.prepare("UPDATE products SET name=?,category=?,size_options=?,color=?,price=?,mrp=?,rating=?,emoji=?,stock=?,description=?,image=?,gallery=?,product_history=?,size_chart=?,care_instructions=? WHERE id=?")
 .run(x.name,x.category,x.size_options,x.color,x.price,x.mrp,x.rating,x.emoji,x.stock,x.description,x.image,typeof x.gallery==="string"?x.gallery:JSON.stringify(x.gallery||[]),x.product_history||"",typeof x.size_chart==="string"?x.size_chart:JSON.stringify(x.size_chart||[]),x.care_instructions||"",p.id);res.json(x);
});
app.delete("/api/admin/products/:id",auth,admin,(req,res)=>{db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);res.json({ok:true})});

app.get("/api/webhooks/health",(req,res)=>res.json({razorpayConfigured:Boolean(razorpay)}));
app.use((req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`Ashwini Clothing: http://0.0.0.0:${PORT}`));
