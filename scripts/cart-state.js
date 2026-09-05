export function installCartSchema(db){db.exec(`
CREATE TABLE IF NOT EXISTS cart_mutations(user_id INTEGER NOT NULL,operation_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,operation_id),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
`)}
export function cartState(db,userId){return {userId:Number(userId),items:db.prepare('SELECT product_id AS id,quantity,size FROM cart_items WHERE user_id=? ORDER BY updated_at,product_id,size').all(userId)}}
function fail(message,status=400){throw Object.assign(new Error(message),{status})}
export function applyCartMutation(db,userId,body){
 if(Number(body?.userId)!==Number(userId))fail('Your account changed. Refresh before changing your cart.',409);
 const operationId=String(body?.operationId||'');if(!/^[A-Za-z0-9_-]{16,100}$/.test(operationId))fail('Invalid shopping operation');
 const changes=body.changes||[];
 if(!Array.isArray(changes)||changes.length>50)fail('Too many shopping changes');
 return db.transaction(()=>{
  if(db.prepare('SELECT 1 FROM cart_mutations WHERE user_id=? AND operation_id=?').get(userId,operationId))return cartState(db,userId);
  const seen=new Set();
  for(const x of changes){
   if(!x||!Number.isInteger(x.id)||!Number.isInteger(x.before)||!Number.isInteger(x.after)||x.before<0||x.before>20||x.after<0||x.after>20||typeof x.size!=='string'||!x.size.trim()||x.size.length>20)fail('Use quantities from 1 to 20 and a valid size');
   const key=JSON.stringify([x.id,x.size]);if(seen.has(key))fail('Duplicate cart change');seen.add(key);
   const current=db.prepare('SELECT quantity FROM cart_items WHERE user_id=? AND product_id=? AND size=?').get(userId,x.id,x.size)?.quantity||0;
   if(current!==x.before)fail('This item changed on another device. Load the latest cart and review your change.',409);
   if(x.after){const p=db.prepare('SELECT id,size_options FROM products WHERE id=?').get(x.id);if(!p)fail('This product is no longer available');if(!String(p.size_options||'').split(',').map(s=>s.trim()).includes(x.size))fail('This size is no longer available')}
  }
  for(const x of changes){if(x.after)db.prepare('INSERT INTO cart_items(user_id,product_id,size,quantity,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,product_id,size) DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP').run(userId,x.id,x.size,x.after);else db.prepare('DELETE FROM cart_items WHERE user_id=? AND product_id=? AND size=?').run(userId,x.id,x.size)}
  if(db.prepare('SELECT count(*) n FROM cart_items WHERE user_id=?').get(userId).n>50)fail('Your cart can contain up to 50 different items');
  db.prepare('INSERT INTO cart_mutations(user_id,operation_id) VALUES(?,?)').run(userId,operationId);
  return cartState(db,userId);
 })();
}
