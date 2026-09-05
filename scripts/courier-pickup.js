export function validatePickupDate(value,now=new Date()){
 const date=String(value||''),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<today)throw Error('Choose a valid pickup date, today or later (India time).');
 return date;
}
export async function requestOrderPickup(db,request,order,date){
 if(order.pickup_state==='CONFIRMED'||['PICKUP_SCHEDULED','PICKED_UP','PICKED','IN_TRANSIT','SHIPPED','OUT_FOR_DELIVERY','DELIVERED'].includes(order.shiprocket_status))return {alreadyScheduled:true};
 if(['REQUESTING','UNKNOWN'].includes(order.pickup_state))throw Error('Pickup confirmation is pending. Check this shipment in Shiprocket before trying again; do not create another booking.');
 validatePickupDate(date);
 const claimed=db.prepare("UPDATE orders SET pickup_state='REQUESTING',pickup_requested_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND COALESCE(pickup_state,'') NOT IN ('REQUESTING','UNKNOWN','CONFIRMED')").run(date,order.id);
 if(!claimed.changes)throw Error('Pickup is already being processed. Refresh the order.');
 let result;
 try{result=await request('/courier/generate/pickup',{method:'POST',body:{shipment_id:[Number(order.shiprocket_shipment_id)],pickup_date:[date],...(order.pickup_state==='FAILED'?{status:'retry'}:{})}})}catch(e){db.prepare("UPDATE orders SET pickup_state='UNKNOWN' WHERE id=?").run(order.id);throw Error('Pickup response could not be confirmed. Check Shiprocket for this AWB before retrying. '+e.message)}
 const confirmed=Number(result?.pickup_status)===1,state=confirmed?'CONFIRMED':[0,'0'].includes(result?.pickup_status)?'FAILED':'UNKNOWN',details=result?.response?.data||result?.response||{};
 db.prepare("UPDATE orders SET pickup_state=?,pickup_confirmed_date=?,pickup_token=?,shiprocket_status=CASE WHEN ?='CONFIRMED' THEN 'PICKUP_SCHEDULED' ELSE shiprocket_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(state,confirmed?String(details.pickup_scheduled_date||'').slice(0,100):'',confirmed?String(details.pickup_token_number||'').slice(0,100):'',state,order.id);
 if(!confirmed)throw Error(state==='FAILED'?'Shiprocket did not schedule pickup. Check availability and retry with a suitable date.':'Pickup response is unconfirmed. Check this AWB in Shiprocket before retrying.');
 return result;
}
