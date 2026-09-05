import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
const frontend=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const backend=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
function setup(existing=false){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE orders(user_id INTEGER,payment_method TEXT,payment_status TEXT,status TEXT);CREATE TABLE offers(id INTEGER,active INTEGER,coupon_code TEXT,start_at TEXT,end_at TEXT,discount_percent REAL,title TEXT);INSERT INTO offers VALUES(1,1,'SAVE10','','',10,'Offer')");
 if(existing)db.exec("INSERT INTO orders VALUES(1,'COD','PENDING','PLACED')");
 let route;
 const server={db,auth(){},app:{post:(url,...handlers)=>route=handlers.at(-1)}};
 vm.createContext(server);
 for(const prefix of ['function isFirstValidOrderCustomer','app.post("/api/coupons/check"'])vm.runInContext(backend.split('\n').find(x=>x.startsWith(prefix)),server);
 const nodes={coupon:{value:'new2026'},couponMsg:{},checkoutTotal:{}};
 const api=async(url,request)=>{let result,status=200;route({user:{id:1},body:request.body},{status(n){status=n;return this},json(v){result=v}});if(status!==200)throw Error(result.error);return result};
 const c={document:{getElementById:id=>nodes[id]},localStorage:{setItem(){},removeItem(){}},esc:x=>x,api};
 vm.createContext(c);vm.runInContext(frontend.split('\n').find(x=>x.startsWith('async function applyCoupon(')),c);
 return {c,nodes,db};
}
test('NEW2026 validates against server and applies 30% to checkout',async()=>{const {c,nodes}=setup();await c.applyCoupon(1000);assert.match(nodes.checkoutTotal.textContent,/700/);assert.match(nodes.couponMsg.innerHTML,/30% OFF/);await c.applyCoupon(1005);assert.match(nodes.checkoutTotal.textContent,/704/);});
test('existing customer is rejected; active other coupon still works',async()=>{const {c,nodes}=setup(true);await c.applyCoupon(1000);assert.match(nodes.couponMsg.textContent,/not available/);assert.match(nodes.checkoutTotal.textContent,/1,000/);nodes.coupon.value='SAVE10';await c.applyCoupon(1000);assert.match(nodes.checkoutTotal.textContent,/900/);});
test('invalid and cleared codes restore full total',async()=>{const {c,nodes}=setup();await c.applyCoupon(1000);nodes.coupon.value='BAD';await c.applyCoupon(1000);assert.match(nodes.couponMsg.textContent,/not recognised/);nodes.coupon.value='';await c.applyCoupon(1000);assert.equal(nodes.couponMsg.textContent,'');assert.match(nodes.checkoutTotal.textContent,/1,000/);});
test('repeat taps retry without overwriting a typed coupon',()=>{const handler=frontend.match(/onclick="(if\(!this.value\)this.value='new2026';applyCoupon\(\$\{subtotal\}\))"/)[1].replace('${subtotal}','1000');const field={value:''};let calls=0;const click=new Function('applyCoupon',handler);click.call(field,()=>calls++);click.call(field,()=>calls++);assert.equal(calls,2);assert.equal(field.value,'new2026');field.value='SAVE10';click.call(field,()=>calls++);assert.equal(field.value,'SAVE10');});
test('stale response cannot restore discount after clearing',async()=>{const {c,nodes}=setup();let finish;c.api=()=>new Promise(resolve=>finish=resolve);const pending=c.applyCoupon(1000);nodes.coupon.value='';await c.applyCoupon(1000);finish({code:'NEW2026',discount_percent:30});await pending;assert.equal(nodes.couponMsg.textContent,'');assert.match(nodes.checkoutTotal.textContent,/1,000/);});
test('storage restrictions do not prevent applying valid discount',async()=>{const {c,nodes}=setup();c.localStorage={setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};await c.applyCoupon(1000);assert.match(nodes.checkoutTotal.textContent,/700/);});
