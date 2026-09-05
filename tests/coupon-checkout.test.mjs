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
 let route,patch;
 const server={db,auth(){},admin(){},app:{post:(url,...handlers)=>route=handlers.at(-1),get(){},patch:(url,...handlers)=>patch=handlers.at(-1)}};
 vm.createContext(server);
 vm.runInContext(backend.slice(backend.indexOf('db.exec("CREATE TABLE IF NOT EXISTS new_buyer_coupon'),backend.indexOf('function isFirstValidOrderCustomer')),server);
 for(const prefix of ['function isFirstValidOrderCustomer','app.post("/api/coupons/check"'])vm.runInContext(backend.split('\n').find(x=>x.startsWith(prefix)),server);
 const nodes={coupon:{value:'new2026'},couponMsg:{},checkoutTotal:{}};
 const api=async(url,request)=>{let result,status=200;route({user:{id:1},body:request.body},{status(n){status=n;return this},json(v){result=v}});if(status!==200)throw Error(result.error);return result};
 const c={document:{getElementById:id=>nodes[id]},localStorage:{setItem(){},removeItem(){}},esc:x=>x,api};
 vm.createContext(c);vm.runInContext(frontend.split('\n').find(x=>x.startsWith('async function applyCoupon(')),c);
 return {c,nodes,db,patch,server};
}
test('NEW2026 validates against server and applies 30% to checkout',async()=>{const {c,nodes}=setup();await c.applyCoupon(1000);assert.match(nodes.checkoutTotal.textContent,/700/);assert.match(nodes.couponMsg.innerHTML,/30% OFF/);await c.applyCoupon(1005);assert.match(nodes.checkoutTotal.textContent,/704/);});
test('existing customer is rejected; active other coupon still works',async()=>{const {c,nodes}=setup(true);await c.applyCoupon(1000);assert.match(nodes.couponMsg.textContent,/not available/);assert.match(nodes.checkoutTotal.textContent,/1,000/);nodes.coupon.value='SAVE10';await c.applyCoupon(1000);assert.match(nodes.checkoutTotal.textContent,/900/);});
test('invalid and cleared codes restore full total',async()=>{const {c,nodes}=setup();await c.applyCoupon(1000);nodes.coupon.value='BAD';await c.applyCoupon(1000);assert.match(nodes.couponMsg.textContent,/not recognised/);nodes.coupon.value='';await c.applyCoupon(1000);assert.equal(nodes.couponMsg.textContent,'');assert.match(nodes.checkoutTotal.textContent,/1,000/);});
test('repeat taps use configured code',()=>{const handler=frontend.split('onclick="if(!this.value)')[1].split('"')[0];const click=new Function('applyCoupon','if(!this.value)'+handler.replace('${subtotal}','1000'));const field={value:'',dataset:{defaultCode:'FIRST25'}};let count=0;click.call(field,()=>count++);click.call(field,()=>count++);assert.equal(count,2);assert.equal(field.value,'FIRST25');});
test('stale response cannot restore discount after clearing',async()=>{const {c,nodes}=setup();let finish;c.api=()=>new Promise(resolve=>finish=resolve);const pending=c.applyCoupon(1000);nodes.coupon.value='';await c.applyCoupon(1000);finish({code:'NEW2026',discount_percent:30});await pending;assert.equal(nodes.couponMsg.textContent,'');assert.match(nodes.checkoutTotal.textContent,/1,000/);});
test('storage restrictions do not prevent applying valid discount',async()=>{const {c,nodes}=setup();c.localStorage={setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};await c.applyCoupon(1000);assert.match(nodes.checkoutTotal.textContent,/700/);});

function edit(x,body){let status=200,result;x.patch({body},{status(n){status=n;return this},json(v){result=v}});return {status,result}}
test('admin changes code and percentage; old code stops working',async()=>{const x=setup();assert.equal(edit(x,{code:'welcome25',discount_percent:25,active:true}).status,200);assert.equal(x.server.getNewBuyerCoupon().code,'WELCOME25');x.nodes.coupon.value='WELCOME25';await x.c.applyCoupon(1000);assert.match(x.nodes.checkoutTotal.textContent,/750/);x.nodes.coupon.value='NEW2026';await x.c.applyCoupon(1000);assert.match(x.nodes.couponMsg.textContent,/not recognised/);});
test('edited coupon enforces eligibility and disabled state',async()=>{const x=setup(true);edit(x,{code:'FIRST20',discount_percent:20,active:true});x.nodes.coupon.value='FIRST20';await x.c.applyCoupon(1000);assert.match(x.nodes.couponMsg.textContent,/not available/);x.db.exec('DELETE FROM orders');edit(x,{code:'FIRST20',discount_percent:20,active:false});x.nodes.coupon.value='FIRST20';await x.c.applyCoupon(1000);assert.match(x.nodes.couponMsg.textContent,/expired/);});
test('invalid settings and duplicate seasonal code are rejected',()=>{const x=setup();for(const b of [{code:'BAD CODE',discount_percent:20,active:true},{code:'FIRST',discount_percent:101,active:true},{code:'FIRST',discount_percent:0,active:true},{code:'SAVE10',discount_percent:20,active:true}])assert.equal(edit(x,b).status,400);assert.equal(x.server.getNewBuyerCoupon().code,'NEW2026');});

function checkoutContext(existing=false){
 const x=setup(existing),originalApi=x.c.api;
 Object.assign(x.nodes,{fullName:{value:'Test Customer'},mobile:{value:'9876543210'},address:{value:'House 4, Main Street'},city:{value:'Delhi'},state:{value:'Delhi'},pin:{value:'110001'},payment:{value:'COD'},placeOrderButton:{}});
 Object.assign(x.c,{checkoutInProgress:false,checkoutItems:null,user:{id:1},window:{__checkoutPinVerified:'110001',__deliveryUnavailable:false},activeCheckoutItems:()=>[{id:1,size:'M',quantity:1}],toast(){},alert(message){throw Error('Unexpected alert: '+message)},showFinalOrderReview(){x.reviewShown=true}});
 x.c.api=(url,request)=>url==='/api/products'?Promise.resolve([{id:1,price:1000,name:'Dress'}]):url.startsWith('/api/delivery-estimate/')?Promise.resolve({deliverable:true}):originalApi(url,request);
 vm.runInContext(frontend.split('\n').find(line=>line.startsWith('async function pay(')),x.c);return x;
}
test('rejected auto-filled coupon is cleared and purchase review proceeds at full total',async()=>{const x=checkoutContext(true);await x.c.applyCoupon(1000);assert.equal(x.nodes.coupon.value,'');await x.c.pay();assert.equal(x.reviewShown,true);assert.equal(x.c.window.__checkoutReview.coupon,'');assert.equal(x.c.window.__checkoutReview.total,1000);});
test('Place Order while invalid coupon remains still reaches undiscounted final review',async()=>{const x=checkoutContext(true);await x.c.pay();assert.equal(x.reviewShown,true);assert.equal(x.c.window.__checkoutReview.coupon,'');assert.equal(x.c.window.__checkoutReview.discount,0);assert.equal(x.c.window.__checkoutReview.total,1000);});
test('valid coupon survives through final order review',async()=>{const x=checkoutContext();await x.c.applyCoupon(1000);await x.c.pay();assert.equal(x.c.window.__checkoutReview.coupon,'NEW2026');assert.equal(x.c.window.__checkoutReview.total,700);});
