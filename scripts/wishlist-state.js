export function installWishlistSchema(db){db.exec(`
CREATE TABLE IF NOT EXISTS wishlist_items(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,PRIMARY KEY(user_id,product_id));
CREATE TABLE IF NOT EXISTS wishlist_mutations(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,operation_id TEXT NOT NULL,PRIMARY KEY(user_id,operation_id));
`)}
export function wishlistState(db,userId){return {userId:Number(userId),items:db.prepare('SELECT product_id FROM wishlist_items WHERE user_id=? ORDER BY product_id').all(userId).map(x=>x.product_id)}}
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
export function mutateWishlist(db,userId,body){
 if(Number(body?.userId)!==Number(userId))fail('Your account changed. Refresh before changing your wishlist.',409);
 if(!/^[A-Za-z0-9_-]{16,100}$/.test(body?.operationId||''))fail('Invalid wishlist operation');
 if(!Array.isArray(body.changes)||body.changes.length>1000)fail('Invalid wishlist changes');
 return db.transaction(()=>{
  if(db.prepare('SELECT 1 FROM wishlist_mutations WHERE user_id=? AND operation_id=?').get(userId,body.operationId))return wishlistState(db,userId);
  for(const x of body.changes){
   if(!x||!Number.isInteger(x.id)||x.id<1||typeof x.saved!=='boolean')fail('Invalid product');
   if(x.saved){if(!db.prepare('SELECT id FROM products WHERE id=?').get(x.id)){if(body.legacy===true)continue;fail('Product is no longer available')}
    db.prepare('INSERT OR IGNORE INTO wishlist_items(user_id,product_id) VALUES(?,?)').run(userId,x.id);
   }else db.prepare('DELETE FROM wishlist_items WHERE user_id=? AND product_id=?').run(userId,x.id);
  }
  db.prepare('INSERT INTO wishlist_mutations(user_id,operation_id) VALUES(?,?)').run(userId,body.operationId);
  return wishlistState(db,userId);
 })();
}
