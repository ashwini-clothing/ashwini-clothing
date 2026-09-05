export const GST_SELLER = Object.freeze({
  legal_name:'Ashwini',gstin:'18BFYPD4444M1ZR',address:'Beltola Tiniali',
  city:'Guwahati',state:'Assam',state_code:'18',pincode:'781028'
});
export function installGstSchema(db){
 db.exec("CREATE TABLE IF NOT EXISTS order_gst_snapshots(order_id INTEGER PRIMARY KEY REFERENCES orders(id),snapshot TEXT NOT NULL)");
}
export function moneyPaise(value){const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error('Invalid monetary value');return Math.round(n*100)}
// Inclusive sale values must resolve to a consistent pre-tax slab.
// Do not silently guess a rate in the discontinuity between the two slabs.
export function garmentRate(grossPaise,quantity){
 const perPiece=grossPaise/quantity;
 if(perPiece<=262500)return 5;
 if(perPiece>295000)return 18;
 throw Error('GST slab needs review: discounted inclusive value falls between ₹2,625 and ₹2,950 per piece.');
}
export function buildGstSnapshot({items,total,state,orderId,createdAt,buyer}){
 const totalPaise=moneyPaise(total),weights=items.map(x=>moneyPaise(x.unit_price)*Number(x.quantity));
 if(!items.length||items.some(x=>!Number.isInteger(Number(x.quantity))||Number(x.quantity)<=0))throw Error('Invalid GST items');
 const subtotal=weights.reduce((a,b)=>a+b,0);
 if(!subtotal||totalPaise>subtotal)throw Error('GST total does not match item values');
 if(!String(state||'').trim())throw Error('Delivery state is required');
 const intra=String(state).trim().toLowerCase()==='assam';
 const date=new Date(createdAt);if(Number.isNaN(+date))throw Error('Invalid invoice date');
 const indiaDate=new Date(+date+330*60000);
 const year=indiaDate.getUTCFullYear()-(indiaDate.getUTCMonth()<3?1:0);
 const allocation=weights.map(w=>Math.floor(totalPaise*w/subtotal));
 const rank=weights.map((w,i)=>({i,remainder:totalPaise*w/subtotal-allocation[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 for(let n=totalPaise-allocation.reduce((a,b)=>a+b,0),i=0;i<n;i++)allocation[rank[i].i]++;
 const lines=items.map((x,i)=>{
  const gross=allocation[i],rate=garmentRate(gross,Number(x.quantity)),tax=Math.round(gross*rate/(100+rate));
  const cgst=intra?Math.floor(tax/2):0,sgst=intra?tax-cgst:0;
  return {...x,gross_paise:gross,taxable_paise:gross-tax,rate,cgst_paise:cgst,sgst_paise:sgst,igst_paise:intra?0:tax};
 });
 const sum=key=>lines.reduce((n,x)=>n+x[key],0);
 return {version:1,seller:{...GST_SELLER},buyer,place_of_supply:state,invoice_number:'A'+String(year).slice(-2)+String(year+1).slice(-2)+'-'+orderId,issued_at:createdAt,intra_state:intra,lines,subtotal_paise:subtotal,discount_paise:subtotal-totalPaise,total_paise:totalPaise,taxable_paise:sum('taxable_paise'),cgst_paise:sum('cgst_paise'),sgst_paise:sum('sgst_paise'),igst_paise:sum('igst_paise')};
}
export function saveGstSnapshot(db,order,items){
 const data={items,total:order.total,state:order.delivery_state,orderId:order.id,createdAt:order.created_at,buyer:{name:order.delivery_name,address:order.address,phone:order.customer_phone}};
 let snapshot;
 try{snapshot=buildGstSnapshot(data)}catch(error){snapshot={version:1,review_required:true,reason:error.message,seller:{...GST_SELLER},...data}}
 db.prepare('INSERT INTO order_gst_snapshots(order_id,snapshot) VALUES(?,?)').run(order.id,JSON.stringify(snapshot));
 return snapshot;
}
export function readGstSnapshot(db,id){const row=db.prepare('SELECT snapshot FROM order_gst_snapshots WHERE order_id=?').get(id);return row?JSON.parse(row.snapshot):null}
