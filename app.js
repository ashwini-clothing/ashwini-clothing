let token='';
// Authentication is stored in the server-side HttpOnly session cookie.
// Never clear it on page load; that was forcing users to sign in repeatedly.
let user=JSON.parse(localStorage.getItem('ashwiniUser')||'null');
let cart=JSON.parse(localStorage.getItem('ashwiniCart')||'[]');
let wishlist=JSON.parse(localStorage.getItem('ashwiniWishlist')||'[]');
let category='All', sizes={}, adIndex=0, adTimer, adPaused=false, checkoutItems=null;
const stages=['PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED'];

async function api(url,opts={}){
  opts.credentials='same-origin';
  opts.headers={...(opts.headers||{}),...(token?{Authorization:'Bearer '+token}:{})};
  if(opts.body && typeof opts.body!=='string'){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(opts.body)}
  const r=await fetch(url,opts);const d=await r.json().catch(()=>({}));
  if(!r.ok) throw Error(d.error||'Request failed'); return d;
}
function toast(t){const x=document.getElementById('toast');if(!x)return;x.textContent=t;x.style.display='block';clearTimeout(window.__toast);window.__toast=setTimeout(()=>x.style.display='none',1800)}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function stop(e){if(e){e.preventDefault();e.stopPropagation()}}
function openDelivery(){
 const saved=localStorage.getItem('ashwiniDeliveryPin')||'';
 openM(`<div style="max-width:520px"><h2>📍 Choose delivery location</h2><p>Enter your 6-digit PIN code to automatically find the area, city and state.</p><div class="pin-row"><input id="headerPin" maxlength="6" inputmode="numeric" value="${esc(saved)}" placeholder="Enter PIN code"><button class="gold" type="button" onclick="saveDeliveryLocation()">Check PIN</button></div><div id="headerDeliveryResult" style="margin-top:12px;color:#4f6f58">${saved?'Saved PIN: '+esc(saved):'Enter your PIN to find your delivery area.'}</div></div>`);
 if(saved) lookupDeliveryPin(saved);
}
async function lookupDeliveryPin(pin){
 const x=document.getElementById('headerDeliveryResult');
 if(x) x.textContent='Checking PIN location...';
 try{
  const d=await api('/api/pincode/'+encodeURIComponent(pin));
  localStorage.setItem('ashwiniDeliveryPin',pin);
  localStorage.setItem('ashwiniDeliveryLocation',JSON.stringify(d));
  const h=document.getElementById('deliverLocation');if(h)h.textContent=pin+' ▾';
  if(x)x.innerHTML=`<b>${esc(d.area)}</b>, ${esc(d.city||d.district)}, ${esc(d.state)}<br><small>PIN ${esc(d.pin)}</small>`;
 }catch(e){if(x)x.textContent=e.message||'PIN code location not found.'}
}
async function saveDeliveryLocation(){
 const pin=(document.getElementById('headerPin')?.value||'').trim();
 if(!/^\d{6}$/.test(pin)){const x=document.getElementById('headerDeliveryResult');if(x)x.textContent='Please enter a valid 6-digit PIN code.';return}
 await lookupDeliveryPin(pin);
 toast('✓ Delivery location updated');
}
async function lookupAddressPin(pin){
 pin=String(pin||'').trim();
 const out=document.getElementById('addressPinResult');
 if(!/^\d{6}$/.test(pin)){if(out)out.textContent='Enter a valid 6-digit PIN code.';return}
 if(out)out.textContent='Checking PIN location...';
 try{
  const d=await api('/api/pincode/'+encodeURIComponent(pin));
  const city=document.getElementById('city'), state=document.getElementById('state');
  if(city) city.value=d.city||d.district||'';
  if(state) state.value=d.state||'';
  updateCodAvailability();
  if(out) out.innerHTML=`<b>${esc(d.area)}</b>, ${esc(d.city||d.district)} , ${esc(d.state)}<br><small>PIN ${esc(d.pin)}</small>`;
 }catch(e){if(out)out.textContent=e.message||'PIN code location not found.';}
}
function addressPinChanged(){
 const pin=(document.getElementById('pin')?.value||'').trim();
 if(pin.length===6) lookupAddressPin(pin);
}

function cat(c){category=(c||'All').trim();const q=document.getElementById('q');if(q)q.value='';const s=document.getElementById('searchCat');if(s)s.value=category;document.querySelectorAll('input[name="c"]').forEach(r=>r.checked=(r.value||'')===category);load();document.getElementById('products')?.scrollIntoView({behavior:'smooth',block:'start'})}

async function load(){
 try{
  const q=document.getElementById('q')?.value||'', sort=document.getElementById('sort')?.value||'featured';
  const p=await api(`/api/products?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&sort=${sort}`);
  const grid=document.getElementById('grid'); if(!grid)return;
  document.getElementById('resultCount').textContent=`(${p.length} results)`;
  grid.innerHTML=p.map(productCard).join('');
 }catch(e){console.error(e);const g=document.getElementById('grid');if(g)g.innerHTML=`<div style="padding:20px"><b>Products could not load.</b><br>${esc(e.message)}<br><br>Please refresh the page.</div>`}
}
function productCard(p){
 const img=p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`:esc(p.emoji||'👗');
 const sizesList=(p.size_options||'S,M,L,XL').split(',').map(s=>s.trim()).filter(Boolean);
 return `<article class="card product-card" onclick="detail(${p.id})" tabindex="0" onkeydown="if(event.key==='Enter')detail(${p.id})">
 ${p.badge_text?`<span class="badge">${esc(p.badge_text)}</span>`:''}<div class="pic">${img}</div>
 <h3>${esc(p.name)}</h3><div class="stars">${p.rating>0?'★★★★★ '+p.rating:'New product'}</div>
 <div class="price">₹${Number(p.price||0).toLocaleString('en-IN')} <span class="mrp">₹${Number(p.mrp||0).toLocaleString('en-IN')}</span></div>
 ${p.offer_text?`<div class="deal">${esc(p.offer_text)}${Number(p.offer_discount||0)>0?` · ${Number(p.offer_discount)}% OFF`:''}</div>`:'<div class="deal">Limited-time deal</div>'}<small>FREE delivery · ${Number(p.stock||0)} in stock</small>
 <div class="sizebox" id="sizes-card-${p.id}">${sizesList.map(s=>`<button class="size" type="button" onclick="stop(event);pick(${p.id},'${esc(s)}',this)">${esc(s)}</button>`).join('')}</div>
 <button class="add" type="button" onclick="stop(event);add(${p.id},this)">Add to Cart</button>
 <button class="add" type="button" style="margin-top:7px;background:#fff;border-color:#caa6ae" onclick="stop(event);detail(${p.id})">View Details</button>
 </article>`;
}
function pick(id,s,b){const box=b?.parentElement;if(sizes[id]===s){sizes[id]='';b?.classList.remove('sel');return}sizes[id]=s;if(box)box.querySelectorAll('.size').forEach(x=>x.classList.remove('sel'));b?.classList.add('sel')}
function flash(btn,text='✓ Added to Cart'){if(!btn)return;const old=btn.textContent;btn.textContent=text;btn.classList.add('added');setTimeout(()=>{if(btn.isConnected){btn.textContent=old;btn.classList.remove('added')}},1400)}
function add(id,btn){let chosen=sizes[id];if(!chosen){toast('Please select a size');return false}let x=cart.find(a=>a.id===id&&a.size===chosen);if(x)x.quantity++;else cart.push({id,quantity:1,size:chosen});save();flash(btn);toast(`✓ Added to Cart · Size ${chosen}`);return true}
function save(){localStorage.setItem('ashwiniCart',JSON.stringify(cart));const c=document.getElementById('count');if(c)c.textContent=cart.reduce((s,x)=>s+x.quantity,0)}
function ensureAdminNotificationBadgeStyle(){if(document.getElementById('ashwiniAdminNotifBadgeStyle'))return;const st=document.createElement('style');st.id='ashwiniAdminNotifBadgeStyle';st.textContent='.admin-notif-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;margin-left:6px;border-radius:999px;background:#d71920;color:#fff;font-size:11px;font-weight:800;line-height:20px;vertical-align:middle;box-shadow:0 1px 3px rgba(0,0,0,.18)}.admin-toolbar .admin-notif-badge{position:relative;top:-1px}.admin-stat .admin-notif-badge{position:absolute;top:8px;right:8px}.admin-stat{position:relative}h3>.admin-notif-badge{font-size:10px;height:18px;min-width:18px;line-height:18px}';document.head.appendChild(st)}
ensureAdminNotificationBadgeStyle();

function enhancePasswordInputs(root=document){
 try{
  if(!document.getElementById('ashwiniPasswordEyeStyle')){const st=document.createElement('style');st.id='ashwiniPasswordEyeStyle';st.textContent='.ash-pw-wrap{position:relative;display:block}.ash-pw-wrap>input{width:100%;padding-right:46px!important}.ash-pw-eye{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent!important;padding:6px!important;min-width:32px;cursor:pointer;font-size:18px;line-height:1}';document.head.appendChild(st)}
  const scope=root||document;scope.querySelectorAll?.('input[type="password"]:not([data-ash-eye])').forEach(input=>{const wrap=document.createElement('span');wrap.className='ash-pw-wrap';input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);input.dataset.ashEye='1';const b=document.createElement('button');b.type='button';b.className='ash-pw-eye';b.setAttribute('aria-label','Show password');b.textContent='👁';b.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';b.textContent=show?'🙈':'👁';b.setAttribute('aria-label',show?'Hide password':'Show password')});wrap.appendChild(b)})
 }catch{}
}
function openM(html){const m=document.getElementById('modal'),b=document.getElementById('body');if(!m||!b)return;b.innerHTML=html;enhancePasswordInputs(b);m.style.display='flex';m.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';document.getElementById('modalClose')?.focus()}
function closeM(){if(window.__helpChatTimer){clearInterval(window.__helpChatTimer);window.__helpChatTimer=null}if(window.__helpChatStream){window.__helpChatStream.close();window.__helpChatStream=null}const m=document.getElementById('modal');if(!m)return;m.style.display='none';m.setAttribute('aria-hidden','true');document.body.style.overflow=''}

const galleryFallback={1:['/_model_western.jpg'],2:['/dark-pink-lace-maxi-new.jpg','/dark-pink-lace-maxi.jpg'],3:['/_model_purple.jpg'],4:['/_model_purple.jpg'],5:['/_model_blue.jpg'],6:['/_model_blue.jpg'],7:['/_model_purple.jpg'],8:['/_model_western.jpg'],9:['/_model_blue.jpg'],10:['/_model_pink.jpg'],11:['/_model_western.jpg'],12:['/_model_purple.jpg'],13:['/_model_pink.jpg'],14:['/_model_purple.jpg'],100:['/dark-pink-lace-maxi-new.jpg','/dark-pink-lace-maxi.jpg']};
function getGallery(p){let a=[];try{a=JSON.parse(p.gallery||'[]')}catch{}if(!Array.isArray(a)||!a.length)a=galleryFallback[p.id]||[];if(p.image&&!a.includes(p.image))a.unshift(p.image);return [...new Set(a)].filter(Boolean).slice(0,5)}
function setGalleryImage(id,src,btn){const img=document.getElementById(`gallery-main-${id}`);if(img){img.src=src;resetZoom(id)}btn?.parentElement?.querySelectorAll('.gallery-thumb').forEach(x=>x.classList.remove('active'));btn?.classList.add('active')}
const zoomState={};
function applyZoom(id){const st=zoomState[id]||{scale:1,x:0,y:0};const img=document.getElementById(`gallery-main-${id}`);const label=document.getElementById(`zoom-level-${id}`);if(st.scale<=1){st.x=0;st.y=0}if(img){img.style.transform=`translate3d(${st.x||0}px,${st.y||0}px,0) scale(${st.scale})`;img.style.cursor=st.scale>1?'grab':'default'}if(label)label.textContent=`${Math.round(st.scale*100)}%`}
function clampPan(id){
 const st=zoomState[id]||{scale:1,x:0,y:0};
 const wrap=document.getElementById(`gallery-main-wrap-${id}`),img=document.getElementById(`gallery-main-${id}`);
 if(!wrap||!img)return;
 const ratio=(img.naturalWidth&&img.naturalHeight)?img.naturalWidth/img.naturalHeight:1;
 const baseW=Math.min(wrap.clientWidth,wrap.clientHeight*ratio);
 const baseH=Math.min(wrap.clientHeight,wrap.clientWidth/ratio);
 const maxX=Math.max(0,(baseW*(st.scale-1))/2);
 const maxY=Math.max(0,(baseH*(st.scale-1))/2);
 st.x=Math.max(-maxX,Math.min(maxX,Number(st.x)||0));
 st.y=Math.max(-maxY,Math.min(maxY,Number(st.y)||0));
 zoomState[id]=st;
}
function zoomImage(id,delta){
 const st=zoomState[id]||(zoomState[id]={scale:1,x:0,y:0});
 const next=Math.max(1,Math.min(3,Math.round((st.scale+delta)*10)/10));
 st.scale=next;
 if(next===1){st.x=0;st.y=0}else clampPan(id);
 applyZoom(id);
}
function resetZoom(id){zoomState[id]={scale:1,x:0,y:0};applyZoom(id)}
function bindImageZoom(id){
 const wrap=document.getElementById(`gallery-main-wrap-${id}`),img=document.getElementById(`gallery-main-${id}`);
 if(!wrap||!img||wrap.dataset.zoomBound)return;
 wrap.dataset.zoomBound='1';
 wrap.style.touchAction='none';
 img.style.touchAction='none';
 let activePointer=null,startX=0,startY=0,startPanX=0,startPanY=0,startDist=0,startScale=1;
 const getState=()=>zoomState[id]||(zoomState[id]={scale:1,x:0,y:0});
 const startPan=e=>{
   const st=getState();
   if(st.scale<=1)return;
   activePointer=e.pointerId; startX=e.clientX; startY=e.clientY; startPanX=st.x||0; startPanY=st.y||0;
   try{wrap.setPointerCapture(e.pointerId)}catch{}
   img.style.cursor='grabbing';
 };
 const movePan=e=>{
   if(activePointer!==e.pointerId)return;
   const st=getState(); if(st.scale<=1)return;
   st.x=startPanX+(e.clientX-startX); st.y=startPanY+(e.clientY-startY);
   clampPan(id); applyZoom(id); e.preventDefault();
 };
 const endPan=e=>{
   if(activePointer===e.pointerId)activePointer=null;
   try{wrap.releasePointerCapture(e.pointerId)}catch{}
   img.style.cursor=(getState().scale>1)?'grab':'default';
 };
 wrap.addEventListener('pointerdown',e=>{
   if(e.target.closest('.zoom-controls,.gallery-thumb'))return;
   if(e.pointerType==='mouse' && e.button!==0)return;
   if(e.pointerType!=='mouse' && e.isPrimary===false)return;
   startPan(e);
 },{passive:false});
 wrap.addEventListener('pointermove',movePan,{passive:false});
 wrap.addEventListener('pointerup',endPan,{passive:false});
 wrap.addEventListener('pointercancel',endPan,{passive:false});
 wrap.addEventListener('lostpointercapture',()=>{activePointer=null;img.style.cursor=getState().scale>1?'grab':'default'});
 wrap.addEventListener('wheel',e=>{e.preventDefault();zoomImage(id,e.deltaY<0?.2:-.2)},{passive:false});
 wrap.addEventListener('dblclick',e=>{e.preventDefault();const st=getState();if(st.scale>1)resetZoom(id);else zoomImage(id,1)});
 wrap.addEventListener('touchstart',e=>{
   if(e.touches.length===2){
     startDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
     startScale=getState().scale;
   }
 },{passive:true});
 wrap.addEventListener('touchmove',e=>{
   if(e.touches.length===2){
     e.preventDefault();
     const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
     const st=getState(); st.scale=Math.max(1,Math.min(3,Math.round((startScale*(d/Math.max(startDist,1)))*10)/10));
     if(st.scale===1){st.x=0;st.y=0} else clampPan(id);
     applyZoom(id);
   }
 },{passive:false});
 img.addEventListener('dragstart',e=>e.preventDefault());
 img.addEventListener('load',()=>{clampPan(id);applyZoom(id)});
 window.addEventListener('resize',()=>{if(zoomState[id]){clampPan(id);applyZoom(id)}});
}


async function detail(id){
 const ps=await api('/api/products');const p=ps.find(x=>x.id===id);if(!p)return;
 const gallery=getGallery(p), liked=wishlist.includes(id);
 const qaHtml=await qaSection(p.id);
 const reviewsHtml=await reviewsSection(p.id);
 const highlights=await api('/api/product-highlights').catch(()=>[]);
 let history=p.product_history||p.history||'Product details / history can be added here later.';
 let care=p.care_instructions||'Wash as per garment label. Use mild detergent, avoid harsh bleach and dry in shade.';
 openM(`<div class="detail">
  <div><div class="gallery"><div class="gallery-thumbs">${gallery.map((src,i)=>`<button type="button" class="gallery-thumb ${i===0?'active':''}" onclick="stop(event);setGalleryImage(${p.id},'${esc(src)}',this)"><img src="${esc(src)}" alt="${esc(p.name)} view ${i+1}"></button>`).join('')}</div><div><div class="gallery-main" id="gallery-main-wrap-${p.id}"><img id="gallery-main-${p.id}" src="${esc(gallery[0]||p.image||'')}" alt="${esc(p.name)}"><div class="zoom-controls"><button class="zoom-btn" type="button" title="Zoom out" onclick="stop(event);zoomImage(${p.id},-.2)">−</button><span class="zoom-level" id="zoom-level-${p.id}">100%</span><button class="zoom-btn" type="button" title="Zoom in" onclick="stop(event);zoomImage(${p.id},.2)">+</button><button class="zoom-btn" type="button" title="Reset" onclick="stop(event);resetZoom(${p.id})">↺</button></div></div><div class="gallery-count">${gallery.length} photo${gallery.length===1?'':'s'} · maximum 5 views · Use +/−, wheel or pinch to zoom</div></div></div></div>
  <div>${p.badge_text?`<div style="margin-bottom:8px"><span class="badge" style="position:static;display:inline-block">${esc(p.badge_text)}</span></div>`:''}<h1>${esc(p.name)}</h1><div class="stars">${p.rating>0?'★★★★★ '+p.rating+' customer rating':'New product'}</div><p style="font-size:27px;font-weight:bold">₹${Number(p.price||0).toLocaleString('en-IN')} <span class="mrp">₹${Number(p.mrp||0).toLocaleString('en-IN')}</span></p><p>Inclusive of all taxes</p>${p.offer_text?`<div class="coupon-box"><b>🎁 ${esc(p.offer_text)}</b>${Number(p.offer_discount||0)>0?`<div style="font-size:18px;font-weight:700;margin-top:4px">${Number(p.offer_discount)}% OFF</div>`:''}</div>`:''}<hr>
  <p><b>Colour:</b> ${esc(p.color)}</p><p><b>Size:</b></p><div class="sizebox" id="sizes-detail-${p.id}">${(p.size_options||'S,M,L,XL').split(',').map(s=>`<button class="size" type="button" onclick="stop(event);pick(${p.id},'${esc(s.trim())}',this)">${esc(s.trim())}</button>`).join('')}</div>
  <p><button class="size-chart-link" type="button" onclick="stop(event);sizeChart(${p.id})">📏 View Size Chart</button></p>
  <div id="size-chart-inline-${p.id}" class="size-chart-inline" style="display:none"></div>
  <p>${esc(p.description||'Premium clothing designed for comfort and everyday style.')}</p>
  <div class="stats" style="grid-template-columns:repeat(3,1fr);margin:15px 0">${highlights.map(h=>`<div class="stat"><small>${esc(h.label)}</small><b style="font-size:16px">${esc(h.value)}</b></div>`).join('')}</div>
  <p><b>${Number(p.stock||0)} left in stock.</b> Ships from Ashwini Clothing.</p>
  <div class="delivery-box"><b>📍 Check delivery</b><div class="pin-row"><input id="pin-${p.id}" maxlength="6" inputmode="numeric" placeholder="Enter PIN code"><button class="wishlist" type="button" onclick="stop(event);checkDelivery(${p.id})">Check</button></div><div id="delivery-${p.id}" class="delivery-result">Free delivery available after PIN check.</div></div>
  <div class="buy"><button class="buy-now" type="button" onclick="stop(event);buyNow(${p.id},this)">Buy Now</button><button class="gold" type="button" onclick="stop(event);addFromDetail(${p.id},this)">Add to Cart</button><button class="wishlist" type="button" onclick="stop(event);wish(${p.id})">${liked?'♥':'♡'} Wishlist</button></div>
  <div class="product-info"><h3>Product Details / History</h3><div class="product-history">${esc(history)}</div>${user?.role==='admin'?`<button class="wishlist" type="button" style="margin-top:10px" onclick="stop(event);editProduct(${p.id})">✎ Edit Product</button>`:''}<h3 style="margin-top:18px">Care Instructions</h3><div class="product-history">${esc(care)}</div></div>
  ${policySections()}${securitySection()}${qaHtml}${reviewsHtml}
  </div></div>`);
 bindImageZoom(p.id);
}
async function reviewsSection(id){
 try{
  const d=await api(`/api/products/${id}/reviews`);
  const stars=(n,cls='')=>`<span class="review-stars ${cls}" aria-label="${n} out of 5 stars">${[1,2,3,4,5].map(i=>`<span class="star ${i<=n?'on':''}">★</span>`).join('')}</span>`;
  const list=(d.reviews||[]).map(r=>`<div class="review"><div>${stars(r.rating)} <b>${esc(r.customer_name||'Customer')}</b></div><div style="margin-top:5px">${esc(r.feedback)}</div><small>${new Date(r.created_at).toLocaleDateString('en-IN')}</small></div>`).join('')||'<div class="review">No customer reviews yet. Be the first to review this product.</div>';
  const form=user?.role==='customer'?`<div class="review-form"><h4>Write a review</h4><div class="star-picker" id="review-stars-${id}">${[1,2,3,4,5].map(i=>`<button type="button" class="pick-star" aria-label="${i} stars" onclick="pickReviewStar(${id},${i})">★</button>`).join('')}</div><input type="hidden" id="review-rating-${id}" value="0"><textarea id="review-feedback-${id}" rows="3" maxlength="1000" placeholder="Share your experience with this product"></textarea><button class="gold" type="button" onclick="submitReview(${id})">Submit Review</button></div>`:`<p><button class="wishlist" type="button" onclick="auth()">Login to write a review</button></p>`;
  return `<div class="reviews"><h3>Customer Reviews & Feedback ${d.count?`(${d.count})`:''}</h3><div style="margin:6px 0 12px">${d.count?`${stars(Math.round(d.average))} <b>${Number(d.average).toFixed(1)}/5</b>`:'No ratings yet'}</div>${form}<div class="review-list">${list}</div></div>`;
 }catch(e){return `<div class="reviews"><h3>Customer Reviews & Feedback</h3><p>Reviews could not load.</p></div>`}
}
function pickReviewStar(id,n){const input=document.getElementById(`review-rating-${id}`);if(input)input.value=n;document.querySelectorAll(`#review-stars-${id} .pick-star`).forEach((b,i)=>b.classList.toggle('selected',i<n))}
async function submitReview(id){
 if(!user){auth();return}
 const rating=Number(document.getElementById(`review-rating-${id}`)?.value||0), feedback=(document.getElementById(`review-feedback-${id}`)?.value||'').trim();
 if(!rating){toast('Please select a star rating');return} if(!feedback){toast('Please write your feedback');return}
 try{await api(`/api/products/${id}/reviews`,{method:'POST',body:{rating,feedback}});toast('Review submitted');detail(id)}catch(e){toast(e.message||'Could not submit review')}
}
function policySections(){return `<div class="policy-block"><button class="policy-head" type="button" onclick="toggleBlock('return-policy')">↩️ 4 Days Return & Replace Policy <span>+</span></button><div id="return-policy" class="policy-body"><table class="table"><tr><th>Return Reason</th><th>Return Period</th><th>Return Policy</th></tr><tr><td>Size too small,<br>Size too large</td><td>4 days from delivery</td><td>Exchange with a different size or colour</td></tr><tr><td>Any other reason</td><td>4 days from delivery</td><td>Replace only<br><button class="size-chart-link" type="button" onclick="openReturnMore()">Know More</button></td></tr></table><h4>Return Instructions</h4><p>Keep the item in its original condition and packaging along with MRP tag and accessories for a successful pick-up.</p></div></div>`}
function securitySection(){return `<div class="policy-block"><button class="policy-head" type="button" onclick="toggleBlock('secure-info')">🔐 Your transaction is secure <span>+</span></button><div id="secure-info" class="policy-body">We work hard to protect your security and privacy. Our payment security system encrypts your information during transmission. We don’t share your credit card details with third-party sellers, and we don’t sell your information to others.</div></div>`}
function toggleBlock(id){const x=document.getElementById(id);if(x)x.classList.toggle('open')}
function openReturnMore(){openM(`<div style="max-width:620px"><h2>Return & Replacement</h2><p>Returns/exchanges must be requested within 4 days from delivery. Keep the product unused, with original packaging, MRP tag and accessories. Size-related requests can be exchanged for another available size or colour; other eligible reasons are replacement only.</p><h3>Return Instructions</h3><p>Keep the item in its original condition and packaging along with MRP tag and accessories for a successful pick-up.</p></div>`)}

function sizeChart(id){
 const box=document.getElementById(`size-chart-inline-${id}`);
 if(!box)return;
 if(box.style.display==='block'){box.style.display='none';box.innerHTML='';return}
 box.style.display='block';
 box.innerHTML='<div class="size-chart-loading">Loading size chart...</div>';
 api('/api/products').then(ps=>{
  const p=ps.find(x=>x.id===id);if(!p)return;
  let data=[];try{data=JSON.parse(p.size_chart||'[]')}catch{}
  if(!Array.isArray(data))data=[];
  const bySize=Object.fromEntries(data.map(x=>[String(x.size||'').trim(),x]));
  const defaults={S:['34','28','36','—'],M:['36','30','38','—'],L:['38','32','40','—'],XL:['40','34','42','—'],XXL:['42','36','44','—']};
  const ss=(p.size_options||'S,M,L,XL').split(',').map(x=>x.trim()).filter(Boolean);
  box.innerHTML=`<div class="size-chart-mini"><div class="size-chart-mini-head"><b>📏 Size Chart</b><button type="button" class="size-chart-close" onclick="stop(event);sizeChart(${id})">×</button></div><table class="size-chart-table"><tr><th>Size</th><th>Bust / Chest</th><th>Waist</th><th>Hip</th><th>Length</th></tr>${ss.map(s=>{const x=bySize[s]||{};const d=defaults[s]||['—','—','—','—'];return `<tr><td><b>${esc(s)}</b></td><td>${esc(x.bust??d[0]??'—')}</td><td>${esc(x.waist??d[1]??'—')}</td><td>${esc(x.hip??d[2]??'—')}</td><td>${esc(x.length??d[3]??'—')}</td></tr>`}).join('')}</table><p class="size-chart-note">Measurements in inches.</p></div>`;
 }).catch(e=>{box.innerHTML=`<div class="size-chart-mini">${esc(e.message||'Size chart could not load.')}</div>`})
}

function addFromDetail(id,btn){if(add(id,btn))setTimeout(closeM,450)}
function buyNow(id,btn){if(!sizes[id]){toast('Please select a size first');return}checkoutItems=[{id,quantity:1,size:sizes[id]}];checkout(checkoutItems)}
function activeCheckoutItems(){return checkoutItems||cart}

function wish(id){if(wishlist.includes(id))wishlist=wishlist.filter(x=>x!==id);else wishlist.push(id);localStorage.setItem('ashwiniWishlist',JSON.stringify(wishlist));toast(wishlist.includes(id)?'♥ Added to Wishlist':'Removed from Wishlist');detail(id)}
function addWishlist(id,fromCartIndex=null){if(!wishlist.includes(id))wishlist.push(id);if(Number.isInteger(fromCartIndex)&&fromCartIndex>=0&&fromCartIndex<cart.length){cart.splice(fromCartIndex,1);save()}else{localStorage.setItem('ashwiniWishlist',JSON.stringify(wishlist));}toast('♥ Moved to Wishlist');if(document.getElementById('modal')?.innerHTML?.includes('Shopping Cart'))cartView()}
async function addWishlistToCart(id){
 try{
  const ps=await api('/api/products');
  const p=ps.find(x=>Number(x.id)===Number(id));
  if(!p){toast('Product not found');return}
  const existing=cart.find(x=>Number(x.id)===Number(id));
  const stock=Math.max(1,Number(p.stock||99));
  if(existing){
   if(existing.quantity>=stock){toast('Maximum available stock reached');return}
   existing.quantity=Math.min(existing.quantity+1,stock);
  }else{
   const sizeList=String(p.size_options||p.sizes||'M').split(',').map(x=>x.trim()).filter(Boolean);
   cart.push({id:Number(p.id),quantity:1,size:sizeList[0]||'M'});
  }
  wishlist=wishlist.filter(x=>Number(x)!==Number(id));
  localStorage.setItem('ashwiniWishlist',JSON.stringify(wishlist));
  save();
  toast('✓ Added to Cart');
  cartView();
 }catch(e){toast('Could not add product to cart');}
}
function removeWishlist(id){wishlist=wishlist.filter(x=>x!==id);localStorage.setItem('ashwiniWishlist',JSON.stringify(wishlist));if(document.getElementById('modal')?.innerHTML?.includes('Shopping Cart'))cartView();else renderWishlistOnly()}
async function renderWishlistOnly(){const ps=await api('/api/products');window.__wishlistProducts=ps;openM(`<h2>Wishlist</h2><p class="muted">Wishlist is shown inside your cart, so opening it will not close your cart.</p>${wishlist.length?wishlist.map(id=>{const p=ps.find(x=>x.id===id);return p?`<div class="wish-card"><div class="mini">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}">`:p.emoji}</div><div><h4>${esc(p.name)}</h4><div class="wish-price">₹${Number(p.price).toLocaleString('en-IN')}</div></div><button class="gold" type="button" onclick="addWishlistToCart(${p.id})">Add to Cart</button><button class="remove-wish" type="button" onclick="removeWishlist(${p.id})">Remove from Wishlist</button></div>`:''}).join(''):'<div class="empty-wish">Your wishlist is empty.</div>'}`)}
function qaData(id){try{return JSON.parse(localStorage.getItem('ashwiniQA_'+id)||'[]')}catch{return[]}}
async function qaSection(id){
 try{
  const q=await api(`/api/products/${id}/questions`);
  const cards=q.length?q.map(x=>`<div class="review qa-item"><b>Q:</b> ${esc(x.question)} <small>— ${esc(x.asker_name||'Customer')}</small>${x.answers?.length?x.answers.map(a=>`<div class="qa-answer"><b>A (${esc(a.role==='admin'?'Admin':'Customer')}):</b> ${esc(a.answer)} <small>— ${esc(a.name||'Customer')}</small></div>`).join(''):'<div class="qa-empty">No answer yet.</div>'}${user?.role==='admin'?`<div class="form" style="margin-top:8px"><input id="answer-${x.id}" placeholder="Write an answer"><button class="gold" type="button" onclick="answerQuestion(${x.id},${id})">Answer</button></div>`:''}</div>`).join(''):'<p>No questions yet. Be the first to ask.</p>';
  return `<div class="qa"><h3>Customer Questions & Answers</h3><div class="form"><input id="question-${id}" placeholder="Ask a question about this product"><button class="gold" type="button" onclick="askQuestion(${id})">Ask Question</button></div><div id="qa-list-${id}">${cards}</div></div>`;
 }catch(e){
  const old=qaData(id);
  return `<div class="qa"><h3>Customer Questions & Answers</h3><div class="form"><input id="question-${id}" placeholder="Ask a question about this product"><button class="gold" type="button" onclick="askQuestion(${id})">Ask Question</button></div><div id="qa-list-${id}">${old.length?old.map(x=>`<div class="review"><b>Q:</b> ${esc(x.q)}${x.a?`<br><b>A:</b> ${esc(x.a)}`:'<br><small>Answer will appear here.</small>'}</div>`).join(''):'<p>No questions yet. Be the first to ask.</p>'}</div></div>`;
 }
}
async function askQuestion(id){
 const input=document.getElementById(`question-${id}`), q=(input?.value||'').trim();
 if(!q){toast('Please write a question');return}
 if(!user){toast('Please login to ask a question');auth();return}
 try{await api(`/api/products/${id}/questions`,{method:'POST',body:{question:q}});toast('Question added');detail(id)}catch(e){toast(e.message||'Could not add question')}
}
async function answerQuestion(questionId,productId){
 const input=document.getElementById(`answer-${questionId}`), answer=(input?.value||'').trim();
 if(!answer){toast('Please write an answer');return}
 if(!user){toast('Please login to answer');auth();return}
 try{await api(`/api/questions/${questionId}/answers`,{method:'POST',body:{answer}});toast('Answer added');detail(productId)}catch(e){toast(e.message||'Could not add answer')}
}

function checkDelivery(id){const pin=(document.getElementById(`pin-${id}`)?.value||'').trim();const out=document.getElementById(`delivery-${id}`);if(!/^\d{6}$/.test(pin)){if(out)out.textContent='Please enter a valid 6-digit PIN code.';return}const first=Number(pin.slice(-1));const days=first%3+3;const d=new Date();d.setDate(d.getDate()+days);if(out)out.innerHTML=`<b>Free delivery</b> · Expected by ${d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})} · PIN ${pin}`}

function cartView(){api('/api/products').then(ps=>{let total=0;const rows=cart.map((x,i)=>{const p=ps.find(z=>z.id===x.id);if(!p)return '';total+=p.price*x.quantity;return `<div class="cartrow"><div class="mini">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}">`:p.emoji}</div><div><h3>${esc(p.name)}</h3><p>Size: <b>${esc(x.size)}</b></p><div class="cart-actions"><div class="qty"><button type="button" onclick="changeQty(${i},-1)">−</button><span>${x.quantity}</span><button type="button" onclick="changeQty(${i},1)">+</button></div><button type="button" onclick="removeCart(${i})">Remove</button><button type="button" class="wishlist" onclick="addWishlist(${p.id},${i})">♡ Move to Wishlist</button></div></div><b>₹${(p.price*x.quantity).toLocaleString('en-IN')}</b></div>`}).join('');openM(`<h2>Shopping Cart (${cart.reduce((s,x)=>s+x.quantity,0)})</h2>${cart.length?rows:'<div class="empty-wish">Your cart is empty.</div>'}<div class="total">Subtotal: ₹${total.toLocaleString('en-IN')}</div>${cart.length?`<button class="gold" style="width:100%;font-size:17px" onclick="checkout()">Proceed to Secure Checkout →</button>`:''}<div class="wishlist-section"><h3>♥ Wishlist (${wishlist.length})</h3>${wishlist.length?wishlist.map(id=>{const p=ps.find(z=>z.id===id);return p?`<div class="wish-card"><div class="mini">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}">`:p.emoji}</div><div><h4>${esc(p.name)}</h4><div class="wish-price">₹${Number(p.price).toLocaleString('en-IN')}</div></div><button class="gold" type="button" onclick="addWishlistToCart(${p.id})">Add to Cart</button><button class="remove-wish" type="button" onclick="removeWishlist(${p.id})">Remove</button></div>`:''}).join(''):'<div class="empty-wish">Your wishlist is empty.</div>'}</div>`)}).catch(e=>toast(e.message))}
function changeQty(i,n){cart[i].quantity=Math.max(1,cart[i].quantity+n);save();cartView()}
function removeCart(i){cart.splice(i,1);save();cartView()}

async function checkout(itemsOverride=null){checkoutItems=itemsOverride||checkoutItems;const items=activeCheckoutItems();if(!items.length){toast('Your cart is empty');return}if(!user){const pending=checkoutItems;closeM();auth();checkoutItems=pending;return}const ps=await api('/api/products');let subtotal=items.reduce((s,x)=>{const p=ps.find(z=>z.id===x.id);return s+(p?p.price*x.quantity:0)},0);openM(`<h2>Secure Checkout</h2><div class="coupon-box"><b>New buyer?</b> Use the coupon shown in the current offer, or <b>NEW2026</b> for eligible new customers. <div class="pin-row"><input id="coupon" placeholder="Coupon code"><button class="wishlist" type="button" onclick="applyCoupon(${subtotal})">Apply</button></div><div id="couponMsg"></div></div><div class="checkout-grid"><div class="checkout-card"><h3>1. Delivery Address</h3><div class="form"><input id="fullName" value="${esc(user.name||'')}" placeholder="Full Name"><input id="mobile" value="${esc(user.phone||'')}" placeholder="Mobile Number" inputmode="numeric" maxlength="10"><input id="pin" maxlength="6" inputmode="numeric" placeholder="PIN Code" oninput="addressPinChanged()"><div id="addressPinResult" class="delivery-result" style="grid-column:1/-1;margin-top:-6px">Enter PIN to auto-fill area, city and state.</div><input id="city" placeholder="City"><input id="state" placeholder="State" oninput="updateCodAvailability()"><textarea id="address" rows="4" placeholder="House / Flat / Street / Landmark"></textarea></div><h3>2. Payment Method</h3><select id="payment" onchange="updateCodAvailability()"><option value="RAZORPAY">Razorpay — UPI / Card / Netbanking</option><option value="COD">Cash on Delivery</option></select><small id="codAvailability" class="muted" style="display:block;margin-top:6px">COD availability depends on store settings and delivery state.</small><button class="gold" style="width:100%;margin-top:18px" onclick="pay()">Place Order →</button></div><div class="checkout-card"><h3>Order Summary</h3>${items.map(x=>{const p=ps.find(z=>z.id===x.id);return p?`<div class="summary-row"><span>${esc(p.name)} × ${x.quantity}</span><b>₹${(p.price*x.quantity).toLocaleString('en-IN')}</b></div>`:''}).join('')}<hr><div id="checkoutTotal" class="total" style="font-size:20px">Total: ₹${subtotal.toLocaleString('en-IN')}</div><p>🔒 Secure transaction</p><p>🚚 Free delivery after PIN check</p><p>↩️ 4 days return / replace</p></div></div>`)}
async function updateCodAvailability(){
 try{
  const state=(document.getElementById('state')?.value||'').trim();const payment=document.getElementById('payment');const note=document.getElementById('codAvailability');if(!payment)return;
  const d=await api(`/api/cod/availability?state=${encodeURIComponent(state)}`);
  const opt=[...payment.options].find(x=>x.value==='COD');if(!opt)return;
  opt.disabled=!d.enabled;
  if(!d.enabled && payment.value==='COD')payment.value='RAZORPAY';
  if(note)note.textContent=d.enabled?'Cash on Delivery is available for this delivery state.':'Cash on Delivery is currently unavailable for this delivery state.';
 }catch(e){const note=document.getElementById('codAvailability');if(note)note.textContent='COD availability could not be checked. Online payment remains available.';const opt=[...(document.getElementById('payment')?.options||[])].find(x=>x.value==='COD');if(opt)opt.disabled=false}
}
async function applyCoupon(subtotal){const c=(document.getElementById('coupon')?.value||'').trim().toUpperCase(),msg=document.getElementById('couponMsg');try{if(c==='NEW2026'){const d=await api('/api/coupons/check',{method:'POST',body:{code:c}});const disc=Math.round(subtotal*Number(d.discount_percent)/100);localStorage.setItem('ashwiniCoupon',c);msg.innerHTML=`<b>✓ ${Number(d.discount_percent)}% discount applied:</b> ₹${disc.toLocaleString('en-IN')}`;const t=document.getElementById('checkoutTotal');if(t)t.textContent=`Total: ₹${(subtotal-disc).toLocaleString('en-IN')}`;return}const d=await api('/api/coupons/check',{method:'POST',body:{code:c}});const disc=Math.round(subtotal*Number(d.discount_percent)/100);localStorage.setItem('ashwiniCoupon',c);msg.innerHTML=`<b>✓ ${Number(d.discount_percent)}% offer applied:</b> ₹${disc.toLocaleString('en-IN')}`;const t=document.getElementById('checkoutTotal');if(t)t.textContent=`Total: ₹${(subtotal-disc).toLocaleString('en-IN')}`}catch(e){localStorage.removeItem('ashwiniCoupon');msg.textContent=e.message||'Coupon not recognised.'}}
async function pay(){try{const items=activeCheckoutItems();const full=(document.getElementById('fullName').value||user.name||'').trim(),mobile=document.getElementById('mobile').value.trim(),address=document.getElementById('address').value.trim(),city=document.getElementById('city').value.trim(),state=document.getElementById('state').value.trim(),pin=document.getElementById('pin').value.trim();if(!mobile||!address||!city||!state||!/^\d{6}$/.test(pin))throw Error('Please fill all delivery details with a valid 6-digit PIN');let d=await api('/api/checkout/create',{method:'POST',body:{items,mobile,address:[full,mobile,address,city,state,pin].filter(Boolean).join(', '),payment_method:document.getElementById('payment').value,delivery_state:document.getElementById('state')?.value||'',coupon:(document.getElementById('coupon')?.value||'').trim().toUpperCase()}});if(d.mode==='COD'){if(!d.orderId)throw Error('Order was not created correctly.');if(!checkoutItems)cart=[];save();checkoutItems=null;await orderDetails(d.orderId);toast(`✓ Order #${d.orderId} placed successfully`);return}if(!window.Razorpay)throw Error('Payment gateway is not loaded. COD is available.');const r=new Razorpay({key:d.keyId,amount:d.total*100,currency:'INR',name:'Ashwini Clothing',description:'Ashwini Order #'+d.orderId,order_id:d.razorpayOrderId,prefill:{name:user.name,email:user.email,contact:mobile},handler:async res=>{await api('/api/checkout/verify',{method:'POST',body:{orderId:d.orderId,...res}});if(!checkoutItems)cart=[];save();checkoutItems=null;showConfirmation(d.orderId,'PAID')}});r.open()}catch(e){alert(e.message)}}
function showConfirmation(id,method){openM(`<div class="success"><div class="big">✓</div><h2>Order Confirmed!</h2><p>Your Order Number is <b>#${id}</b></p><p>Payment: <b>${method==='PAID'?'Paid Online':'Cash on Delivery'}</b></p><button class="gold" onclick="track(${id})">Track My Order</button></div>`)}
async function accountMenu(){
 if(!user){auth();return}
 const pop=document.getElementById('accountPopover');
 if(!pop){openM(`<h2>👤 My Account</h2>`);return}
 const name=esc(user.name||'Customer');
 const wasOpen=pop.classList.contains('open');
 if(wasOpen){pop.classList.remove('open');return}
 pop.innerHTML=`<h3>👤 My Account</h3><p class="account-popover-note">Hello, <b>${name}</b> · Choose an account option below.</p><div class="account-menu-grid">
 <button class="account-menu-card" type="button" onclick="closeAccountMenu();buyAgain()"><b>🔄 Buy Again</b><small>Shop products from your previous orders</small><span class="account-chevron" aria-hidden="true">›</span></button>
 <button class="account-menu-card" type="button" onclick="closeAccountMenu();manageProfile()"><b>👤 Manage Profile</b><small>Update your name, email and mobile</small><span class="account-chevron" aria-hidden="true">›</span></button>
 <button class="account-menu-card" type="button" onclick="closeAccountMenu();loginSecurity()"><b>🔐 Login & Security</b><small>Manage email, mobile, password and 2-step verification</small><span class="account-chevron" aria-hidden="true">›</span></button>
 <button class="account-menu-card" type="button" onclick="closeAccountMenu();logout()"><b>🚪 Sign Out</b><small>Securely sign out of your account</small><span class="account-chevron" aria-hidden="true">›</span></button>
 <button class="account-menu-card" type="button" onclick="closeAccountMenu();returnsPanel()"><b>↩️ Returns & Replacements</b><small>Request and check return status</small><span class="account-chevron" aria-hidden="true">›</span></button>
 <button class="account-menu-card" type="button" onclick="closeAccountMenu();orders()"><b>📦 Your Orders</b><small>View, track and manage orders</small><span class="account-chevron" aria-hidden="true">›</span></button>
 <button class="account-menu-card" type="button" onclick="closeAccountMenu();customerHelp()"><b>❓ Customer Help</b><small>Get help with orders, returns and account</small><span class="account-chevron" aria-hidden="true">›</span></button>
 </div>${user.role==='admin'?`<button class="gold" style="width:100%" onclick="closeAccountMenu();dashboard()">👑 Open Admin Dashboard</button>`:''}`;
 pop.classList.add('open');
}
function closeAccountMenu(){const pop=document.getElementById('accountPopover');if(pop)pop.classList.remove('open')}
document.addEventListener('click',e=>{const wrap=document.querySelector('.account-wrap');if(wrap && !wrap.contains(e.target))closeAccountMenu()});
async function buyAgain(){
 try{const os=await api('/api/orders');const seen=new Set(),items=[];for(const o of os){for(const i of (o.items||[])){const k=String(i.product_id)+'|'+String(i.size);if(seen.has(k))continue;seen.add(k);items.push(i)}}if(!items.length){openM('<h2>🔄 Buy Again</h2><p>You have no previous purchased products yet.</p>');return}const ps=await api('/api/products');const cards=items.map(i=>{const p=ps.find(x=>Number(x.id)===Number(i.product_id));if(!p)return '';const size=String(i.size||'M');return `<div class="cartrow"><div class="mini">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}">`:esc(p.emoji||'👕')}</div><div><h3>${esc(p.name)}</h3><p>Previous size: <b>${esc(size)}</b></p><b>₹${Number(p.price).toLocaleString('en-IN')}</b></div><button class="gold" type="button" onclick="buyAgainOne(${p.id},'${size.replace(/'/g,"\\'")}')">Add Again</button></div>`}).join('');openM(`<h2>🔄 Buy Again</h2>${cards}`)}catch(e){alert(e.message||'Could not load Buy Again')}
}
async function buyAgainOne(id,size){try{const ps=await api('/api/products'),p=ps.find(x=>Number(x.id)===Number(id));if(!p)return toast('Product not found');const sz=(String(p.size_options||'M').split(',').map(x=>x.trim()).filter(Boolean).includes(size)?size:String(p.size_options||'M').split(',')[0]||'M');const x=cart.find(a=>Number(a.id)===id&&a.size===sz);if(x)x.quantity++;else cart.push({id:Number(id),quantity:1,size:sz});save();toast('✓ Added to Cart');cartView()}catch(e){toast(e.message||'Could not add product')}}
async function loginSecurity(){
 try{
  const me=(await api('/api/me')).user||await api('/api/me');
  const u=me.user||me;
  const channel=String(u.two_step_channel||'AUTO').toUpperCase();
  openM(`<h2>🔐 Login & Security</h2><p>Manage your Ashwini account security. Passkey and compromised-account tools are not included.</p>
  <div class="help-list">
   <button class="help-row account-action" type="button" onclick="securityEditProfile()"><div><b>👤 Name</b><small>${esc(u.name||'Not set')} · Edit</small></div><span>›</span></button>
   <button class="help-row account-action" type="button" onclick="securityEditContact('email')"><div><b>✉️ E-mail</b><small>${esc(u.email||'Not set')} · Edit with OTP verification</small></div><span>›</span></button>
   <button class="help-row account-action" type="button" onclick="securityEditContact('mobile')"><div><b>📱 Primary mobile number</b><small>${esc(u.phone||'Not set')} · Edit with OTP verification</small></div><span>›</span></button>
   <button class="help-row account-action" type="button" onclick="securityChangePassword()"><div><b>🔑 Password</b><small>Change password · Current password required</small></div><span>›</span></button>
   <button class="help-row account-action" type="button" onclick="securityTwoStep()"><div><b>🛡️ 2-step verification</b><small>${u.two_step_enabled?'On':'Off'} · ${channel==='AUTO'?'Automatic':channel==='EMAIL'?'Email OTP':'Mobile OTP'}</small></div><span>›</span></button>
  </div>`);
 }catch(e){alert(e.message||'Could not load Login & Security')}
}
function securityEditProfile(){
 try{
  const u=user||{};
  openM(`<h2>👤 Name</h2><p>Your name will be used across your Ashwini account.</p><div class="form"><label><b>Full Name</b></label><input id="securityName" value="${esc(u.name||'')}" autocomplete="name" placeholder="Enter your full name"><div style="display:flex;gap:8px"><button class="gold" type="button" onclick="securitySaveName()">Save Name</button><button type="button" onclick="loginSecurity()">Cancel</button></div></div>`);
 }catch(e){alert(e.message||'Could not edit name')}
}
async function securitySaveName(){
 const name=(document.getElementById('securityName')?.value||'').trim();
 if(!name){alert('Please enter your name.');return}
 try{
  const d=await api('/api/me/name',{method:'PATCH',body:{name}});
  session(d);
  toast('✓ Name updated');
  loginSecurity();
 }catch(e){alert(e.message||'Could not save name')}
}
async function securityEditContact(kind){
 try{
  const me=(await api('/api/me')).user||await api('/api/me'); const u=me.user||me;
  const isEmail=kind==='email', current=isEmail?(u.email||''):(u.phone||'');
  openM(`<h2>${isEmail?'✉️ Edit E-mail':'📱 Edit Primary mobile number'}</h2><p>Enter the new ${isEmail?'email address':'10-digit mobile number'}. OTP verification is required before the change is saved.</p><div class="form"><label><b>Current</b></label><input value="${esc(current)}" disabled><label><b>New ${isEmail?'E-mail':'mobile number'}</b></label><input id="securityNewContact" type="${isEmail?'email':'tel'}" inputmode="${isEmail?'email':'numeric'}" maxlength="${isEmail?'120':'10'}" placeholder="Enter new ${isEmail?'email':'mobile number'}"><button class="gold" type="button" onclick="securityRequestContact('${kind}')">Send OTP</button></div>`);
 }catch(e){alert(e.message)}
}
async function securityRequestContact(kind){
 const value=(document.getElementById('securityNewContact')?.value||'').trim();
 if(kind==='email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)){alert('Enter a valid new email address.');return}
 if(kind==='mobile' && !/^\d{10}$/.test(value.replace(/\D/g,''))){alert('Enter a valid 10-digit mobile number.');return}
 try{
  const me=(await api('/api/me')).user||await api('/api/me'); const u=me.user||me;
  const body={name:u.name,email:kind==='email'?value:u.email,phone:kind==='mobile'?value.replace(/\D/g,''):u.phone};
  const d=await api('/api/me/profile-change/request',{method:'POST',body});
  if(d.unchanged){alert('Please enter a different '+(kind==='email'?'email address.':'mobile number.'));return}
  const targets=d.targets||[]; const hints=targets.map(x=>`<div><b>${esc(x.channel==='mobile'?'Mobile':'Email')}</b> — ${esc(x.key.replaceAll('_',' '))}${x.devOtp?`<br><small>Demo OTP: <b>${esc(x.devOtp)}</b></small>`:''}</div>`).join('');
  openM(`<h2>Verify ${kind==='email'?'E-mail':'Mobile'} change</h2><p>Enter the OTPs shown/sent below to confirm the change.</p>${hints}<div class="form"><label>Old ${kind==='email'?'E-mail':'Mobile'} OTP</label><input id="secOldOtp" inputmode="numeric" maxlength="6" placeholder="6-digit OTP"><label>New ${kind==='email'?'E-mail':'Mobile'} OTP</label><input id="secNewOtp" inputmode="numeric" maxlength="6" placeholder="6-digit OTP"><button class="gold" type="button" onclick="securityConfirmContact('${kind}','${esc(value)}')">Verify & Save</button></div>`);
 }catch(e){alert(e.message)}
}
async function securityConfirmContact(kind,value){
 const oldOtp=(document.getElementById('secOldOtp')?.value||'').trim(),newOtp=(document.getElementById('secNewOtp')?.value||'').trim();
 try{const me=(await api('/api/me')).user||await api('/api/me');const u=me.user||me;const body={name:u.name,email:kind==='email'?value:u.email,phone:kind==='mobile'?value.replace(/\D/g,''):u.phone,oldEmailOtp:kind==='email'?oldOtp:'',newEmailOtp:kind==='email'?newOtp:'',oldPhoneOtp:kind==='mobile'?oldOtp:'',newPhoneOtp:kind==='mobile'?newOtp:''};const d=await api('/api/me/profile-change/confirm',{method:'POST',body});session(d);toast('✓ Security detail updated');loginSecurity()}catch(e){alert(e.message)}}
async function securityChangePassword(){openM(`<h2>🔑 Change Password</h2><div class="form"><label>Current password</label><input id="secCurrentPassword" type="password" autocomplete="current-password" placeholder="Current password"><label>New password</label><input id="secNewPassword" type="password" minlength="8" autocomplete="new-password" placeholder="New password (8+ characters)"><label>Confirm new password</label><input id="secConfirmPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Confirm new password"><button class="gold" type="button" onclick="securitySavePassword()">Change Password</button></div>`)}
async function securitySavePassword(){try{const d=await api('/api/me/change-password',{method:'POST',body:{currentPassword:document.getElementById('secCurrentPassword')?.value||'',newPassword:document.getElementById('secNewPassword')?.value||'',confirmPassword:document.getElementById('secConfirmPassword')?.value||''}});closeM();toast('✓ Password changed. Please sign in again.');auth()}catch(e){alert(e.message)}}
async function securityTwoStep(){try{
 const me=(await api('/api/me')).user||await api('/api/me');const u=me.user||me;
 const enabled=Number(u.two_step_enabled)!==0;const ch=String(u.two_step_channel||'AUTO').toUpperCase();
 openM(`<h2>🛡️ 2-step verification</h2><p>Choose whether extra login verification is enabled and where the OTP should be delivered.</p><div class="form"><label><input type="radio" name="sec2stepEnabled" value="ON" ${enabled?'checked':''}> On</label><label><input type="radio" name="sec2stepEnabled" value="OFF" ${!enabled?'checked':''}> Off</label><div id="sec2stepChannels" style="display:${enabled?'grid':'none'};gap:8px;margin-top:8px"><label><input type="radio" name="sec2step" value="AUTO" ${ch==='AUTO'?'checked':''}> Automatic</label><label><input type="radio" name="sec2step" value="EMAIL" ${ch==='EMAIL'?'checked':''}> E-mail OTP</label><label><input type="radio" name="sec2step" value="MOBILE" ${ch==='MOBILE'?'checked':''}> Mobile OTP</label></div><button class="gold" type="button" onclick="securitySaveTwoStep()">Save Security Setting</button><button type="button" onclick="loginSecurity()">Cancel</button></div>`);
 document.querySelectorAll('input[name="sec2stepEnabled"]').forEach(x=>x.addEventListener('change',()=>{const box=document.getElementById('sec2stepChannels');if(box)box.style.display=x.checked&&x.value==='ON'?'grid':'none'}));
 }catch(e){alert(e.message||'Could not load 2-step verification')}
}
async function securitySaveTwoStep(){
 const enabled=document.querySelector('input[name="sec2stepEnabled"]:checked')?.value==='ON';
 const channel=document.querySelector('input[name="sec2step"]:checked')?.value||'AUTO';
 try{const d=await api('/api/me/security',{method:'PATCH',body:{two_step_enabled:enabled,two_step_channel:channel}});session(d);toast(enabled?'✓ 2-step verification enabled':'✓ 2-step verification turned off');loginSecurity()}catch(e){alert(e.message||'Could not update security setting')}
}

async function manageProfile(){
 try{
  const [me,os,rs]=await Promise.all([api('/api/me'),api('/api/orders'),api('/api/returns')]);
  const byOrder=new Map();
  (rs||[]).forEach(r=>{const oid=Number(r.order_id),cur=byOrder.get(oid);if(!cur||Number(r.id)>Number(cur.id))byOrder.set(oid,r)});
  const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})};
  const label=v=>String(v||'').replaceAll('_',' ');
  const history=(os||[]).map(o=>{
    const r=byOrder.get(Number(o.id));
    const items=(o.items||[]).map(i=>`<div class="profile-history-item">
      <div><b>${esc(i.name||'Product')}</b><br><small>Size: ${esc(i.size||'—')} · Qty: ${Number(i.quantity||1)} · ₹${Number(i.unit_price||0).toLocaleString('en-IN')}</small></div>
      <div class="profile-item-actions">
        <button class="gold" type="button" onclick="buyAgainOne(${Number(i.product_id||i.id||0)},'${String(i.size||'').replace(/'/g,"\'")}')">Buy Again</button>
        <button type="button" onclick="addWishlist(${Number(i.product_id||i.id||0)})">Wishlist</button>
        <button type="button" onclick="buyAgainOne(${Number(i.product_id||i.id||0)},'${String(i.size||'').replace(/'/g,"\'")}')">Move to Cart</button>
      </div>
    </div>`).join('');
    return `<div class="profile-history-card">
      <div class="profile-history-head"><div><b>Order #${o.id}</b><br><small>Ordered: ${esc(fmt(o.created_at||o.order_date||o.date))}</small></div><span class="status-pill">${esc(label(o.status))}</span></div>
      <div><small>Payment: ${esc(o.status==='DELIVERED'?'PAID':(o.payment_status||'PENDING'))} · Total: <b>₹${Number(o.total||0).toLocaleString('en-IN')}</b></small></div>
      ${items||'<small>No item details available.</small>'}
      ${r?`<div class="profile-return-box"><b>Return & Replacement</b><br><small>Return #${r.id} · Requested: ${esc(fmt(r.created_at||r.requested_at||r.date))} · Status: ${esc(label(r.status))}</small>${r.pickup_at?`<br><small>Pickup: ${esc(fmt(r.pickup_at))}</small>`:''}${r.replacement_order_id?`<br><small>Replacement Order #${r.replacement_order_id} · Status: ${esc(label(r.replacement_order_status||''))}</small>`:''}${r.replacement_address?`<br><small>Replacement address: ${esc(r.replacement_address)}</small>`:''}</div>`:''}
      <div class="profile-order-actions"><button class="gold" type="button" onclick="orderDetails(${o.id})">View Order</button>${r?`<button class="account-action" type="button" onclick="returnsPanel()">View Return Status</button>`:''}</div>
    </div>`;
  }).join('');
  openM(`<h2>👤 Manage Profile</h2>
   <div class="profile-summary">
    <div class="form">
     <label>Name</label><input id="profileName" value="${esc(me.name||'')}">
     <label>Email</label><input id="profileEmail" type="email" value="${esc(me.email||'')}">
     <label>Mobile Number</label><input id="profilePhone" inputmode="numeric" maxlength="10" value="${esc(me.phone||'')}">
     <button class="gold" type="button" onclick="saveProfile()">Save Changes</button>
    </div>
   </div>
   <div class="profile-history">
    <h3>Complete Order & Return History</h3>
    <p><small>Your complete purchase history is shown with date and year. Each product includes Buy Again, Wishlist and Move to Cart.</small></p>
    ${history||'<p>No orders yet. Your future orders will appear here.</p>'}
   </div>`);
 }catch(e){alert(e.message)}
}
async function saveProfile(){try{const body={name:document.getElementById('profileName')?.value,email:document.getElementById('profileEmail')?.value,phone:document.getElementById('profilePhone')?.value};const current=await api('/api/me');const same=String(current.email||'').toLowerCase()===String(body.email||'').trim().toLowerCase()&&String(current.phone||'')===String(body.phone||'').replace(/\D/g,'');if(same){const d=await api('/api/me',{method:'PATCH',body});session(d);toast('✓ Profile updated and saved');await manageProfile();return}const d=await api('/api/me/profile-change/request',{method:'POST',body});if(d.unchanged){session(d);await manageProfile();return}const hints=(d.targets||[]).map(x=>`<div><b>${esc(x.channel==='mobile'?'Mobile':'Email')}</b> — ${esc(x.key.replaceAll('_',' '))}${x.devOtp?`<br><small>Demo OTP: <b>${esc(x.devOtp)}</b></small>`:''}</div>`).join('');openM(`<h2>Verify Profile Change</h2><p>For security, changes to email/mobile require verification of both the old and new contact method.</p>${hints}<div class='form'><label>Old Email OTP</label><input id='oldEmailOtp' inputmode='numeric' maxlength='6'><label>New Email OTP</label><input id='newEmailOtp' inputmode='numeric' maxlength='6'><label>Old Mobile OTP</label><input id='oldPhoneOtp' inputmode='numeric' maxlength='6'><label>New Mobile OTP</label><input id='newPhoneOtp' inputmode='numeric' maxlength='6'><button class='gold' type='button' onclick='confirmProfileChange()'>Verify & Save Profile</button></div>`)}catch(e){alert(e.message)}}
async function confirmProfileChange(){try{const d=await api('/api/me/profile-change/confirm',{method:'POST',body:{name:document.getElementById('profileName')?.value,oldEmailOtp:document.getElementById('oldEmailOtp')?.value,newEmailOtp:document.getElementById('newEmailOtp')?.value,oldPhoneOtp:document.getElementById('oldPhoneOtp')?.value,newPhoneOtp:document.getElementById('newPhoneOtp')?.value}});session(d);toast('✓ Profile verified and updated');await manageProfile()}catch(e){alert(e.message)}}
function returnLockKey(id){return `ashwiniReturnRequested:${String(id)}`}
function hasReturnLock(id){try{return localStorage.getItem(returnLockKey(id))==='1'}catch{return false}}
function setReturnLock(id){try{localStorage.setItem(returnLockKey(id),'1')}catch{}}
function clearReturnLock(id){try{localStorage.removeItem(returnLockKey(id))}catch{}}
function returnWindowInfo(o){
 const deadline=o?.return_deadline_at?Date.parse(o.return_deadline_at):NaN;
 const eligible=o?.status==='DELIVERED' && Number.isFinite(deadline) && Date.now()<=deadline;
 return {deadline,eligible};
}
function returnDeadlineText(o){const x=returnWindowInfo(o);return Number.isFinite(x.deadline)?new Date(x.deadline).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):''}
async function returnsPanel(){
 try{
  const [os,rs,evs]=await Promise.all([api('/api/orders'),api('/api/returns'),api('/api/return-events')]);
  const rmap=new Map();rs.forEach(r=>{const oid=Number(r.order_id),current=rmap.get(oid);if(!current||Number(r.id)>Number(current.id))rmap.set(oid,r)});
  const byReturn=new Map();evs.forEach(e=>{const a=byReturn.get(Number(e.return_id))||[];a.push(e);byReturn.set(Number(e.return_id),a)});
  const delivered=os.filter(o=>o.status==='DELIVERED');
  const label=v=>String(v||'').replaceAll('_',' ');
  const canCancel=r=>['REQUESTED','APPROVED','PICKUP_SCHEDULED'].includes(String(r.status));
  const canRequestAgain=r=>!r||['REJECTED','CANCELLED'].includes(String(r.status));
  const rows=delivered.map(o=>{
   const r=rmap.get(Number(o.id));
   const win=returnWindowInfo(o);
   const locked=hasReturnLock(o.id);
   const formId=`return-form-${o.id}`;
   const history=(r?(byReturn.get(Number(r.id))||[]).slice(0,12):[]);
   const windowText=win.eligible?`Return / Replace available until ${returnDeadlineText(o)}`:`Return window expired on ${returnDeadlineText(o)}`;
   const action=r?`<span class="status-pill">${esc(label(r.status))}</span>${canCancel(r)?`<br><button class="account-action" type="button" style="margin-top:8px" onclick="cancelReturn(${r.id})">Cancel Return Request</button>`:''}${canRequestAgain(r)&&win.eligible?`<br><button class="account-action" type="button" style="margin-top:8px" onclick="toggleReturnForm(${o.id})">Request Return / Replace Again</button>`:''}`:win.eligible&&!locked?`<button class="account-action" type="button" onclick="toggleReturnForm(${o.id})">Request Return / Replace</button>`:`<span class="status-pill">RETURN WINDOW CLOSED</span>`;
   const form=(!r&&win.eligible&&!locked)?`<div id="${formId}" style="display:none;margin:-6px 0 14px;padding:14px;background:#fffaf7;border:1px solid #eaded8;border-radius:9px"><div class="form"><label><b>Return reason</b></label><select id="return-reason-${o.id}" onchange="syncReturnOption(${o.id})"><option value="">Select reason</option><option>Size too small</option><option>Size too large</option><option>Colour / Style issue</option><option>Damaged / Defective</option><option>Other</option></select><label><b>What do you want?</b></label><select id="return-type-${o.id}" onchange="syncReturnOption(${o.id})"><option value="EXCHANGE">Exchange / Replace with another size or colour</option><option value="REPLACEMENT">Replacement</option></select><div id="return-extra-${o.id}" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input id="return-size-${o.id}" placeholder="New size (optional)"><input id="return-color-${o.id}" placeholder="New colour (optional)"></div><button class="gold" type="button" onclick="submitReturn(${o.id})">Submit Return Request</button><button type="button" onclick="toggleReturnForm(${o.id})">Cancel</button></div></div>`:'';
   const returnProducts=(o.items||[]).map(i=>{const pid=Number(i.product_id||i.id||0);const img=i.image?`<img src="${esc(i.image)}" alt="${esc(i.name||'Product')}" loading="lazy" style="width:72px;height:88px;object-fit:cover;border-radius:8px;display:block">`:esc(i.emoji||'👗');return `<div style="display:flex;align-items:center;gap:10px;margin:8px 0 10px"><button class="order-product-link" type="button" title="Open original product page" onclick="stop(event);detail(${pid})" style="border:1px solid #ead8df;background:#fff;border-radius:9px;padding:3px;cursor:pointer;width:78px;height:94px;display:flex;align-items:center;justify-content:center">${img}</button><button class="order-product-title" type="button" title="Open original product page" onclick="stop(event);detail(${pid})" style="border:0;background:none;padding:0;text-align:left;cursor:pointer;font-weight:800;color:#4b2633;font-size:15px">${esc(i.name||'Product')} × ${Number(i.quantity||1)}</button></div>`}).join('');
   return `<div class="cartrow" style="grid-template-columns:1fr auto"><div><b>Order #${o.id}</b>${returnProducts}<div>₹${Number(o.total).toLocaleString('en-IN')}</div><small>${r?`Return #${r.id}: ${esc(label(r.status))} · ${esc(r.reason)} · ${esc(r.request_type||'REPLACEMENT')}${r.pickup_at?` · Pickup: ${esc(r.pickup_at)}`:''}`:esc(windowText)}</small>${r?.admin_note?`<br><small>Admin note: ${esc(r.admin_note)}</small>`:''}${r?.replacement_order_id?`<br><small>📦 Replacement Order #${r.replacement_order_id} · Status: ${esc(label(r.replacement_order_status||''))}</small><br><small>Replacement delivery address: ${esc(r.replacement_address||o.address)}</small>`:''}${history.length?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee"><b>Return updates</b>${history.map(e=>`<div style="margin-top:5px"><small><b>${esc(e.title)}</b> · ${esc(e.created_at)}</small><br><small>${esc(e.message)}</small></div>`).join('')}</div>`:''}</div><div>${action}</div></div>${form}`;
  }).join('');
  openM(`<h2>↩️ Returns & Replacements</h2><p>Returns/replacements are available for <b>4 days from the delivery date</b>. After 4 days the request button automatically closes.</p>${rows||'<p>No delivered orders are currently eligible for a return request.</p>'}`)
 }catch(e){alert(e.message)}
}

function cancelReturn(id){openM(`<div style="text-align:center;padding:20px 8px"><div style="font-size:40px">↩️</div><h2>Cancel Return Request?</h2><p>Are you sure you want to cancel this return request? You can request a return again later while the order is still within the return period.</p><div style="display:flex;justify-content:center;gap:10px;margin-top:18px"><button type="button" onclick="returnsPanel()">Keep Return</button><button class="gold" type="button" onclick="confirmCancelReturn(${id})">Yes, Cancel Return</button></div></div>`)}
async function confirmCancelReturn(id){try{await api(`/api/returns/${id}/cancel`,{method:'PATCH'});clearReturnLock(id);toast('✓ Return request cancelled');returnsPanel()}catch(e){alert(e.message)}}
function toggleReturnForm(id){const x=document.getElementById(`return-form-${id}`);if(x)x.style.display=x.style.display==='none'?'block':'none'}
function syncReturnOption(id){const reason=document.getElementById(`return-reason-${id}`)?.value||'',type=document.getElementById(`return-type-${id}`),extra=document.getElementById(`return-extra-${id}`);if(reason==='Size too small'||reason==='Size too large'){if(type){type.value='EXCHANGE';[...type.options].forEach(o=>o.disabled=false)}if(extra)extra.style.display='grid'}else{if(type)type.value='REPLACEMENT';if(extra)extra.style.display='none'}}
async function submitReturn(id){const reason=document.getElementById(`return-reason-${id}`)?.value||'',request_type=document.getElementById(`return-type-${id}`)?.value||'REPLACEMENT',replacement_size=document.getElementById(`return-size-${id}`)?.value||'',replacement_color=document.getElementById(`return-color-${id}`)?.value||'';if(!reason){toast('Please select a return reason');return}try{await api('/api/returns',{method:'POST',body:{order_id:id,reason,request_type,replacement_size,replacement_color}});setReturnLock(id);toast('✓ Return request submitted');returnsPanel()}catch(e){alert(e.message)}}
async function requestReturn(id){toggleReturnForm(id)}
async function customerHelp(){
 try{
  const rows=await api('/api/customer-help/mine');
  const history=rows.length?`<h3 style="margin:20px 0 10px">Your Help Requests</h3><div class="help-list">${rows.map(r=>`<div class="help-row"><div><b>${esc(r.subject)}</b><small>Contact: ${esc(r.contact_method)} · Status: <span class="status-pill">${esc(r.status)}</span></small></div><span>›</span></div>`).join('')}</div>`:'';
  openM(`<h2>❓ Customer Help</h2><p>Choose a help topic. Each option opens the relevant Ashwini support section.</p>
  <div class="help-list">
   <button class="help-row account-action" type="button" onclick="orders()"><div><b>📦 Your Orders</b><small>View, track and manage your orders</small></div><span>›</span></button>
   <button class="help-row account-action" type="button" onclick="returnsPanel()"><div><b>↩️ Returns & Replacements</b><small>Request a return and check return status</small></div><span>›</span></button>
   <button class="help-row" type="button" onclick="customerPaymentHelp()"><div><b>💳 Payment & Checkout</b><small>Payment, Razorpay and checkout help</small></div><span>›</span></button>
   <button class="help-row" type="button" onclick="manageProfile()"><div><b>🔐 Account & Login</b><small>Manage profile, login and account access</small></div><span>›</span></button>
   <button class="help-row" type="button" onclick="customerWebsiteHelp()"><div><b>🛠️ Website & Technical Help</b><small>Report a website or technical problem</small></div><span>›</span></button>
   <button class="help-row" type="button" onclick="contactAshwiniSupport()"><div><b>✉️ Contact Ashwini Support</b><small>Email support or request a callback</small></div><span>›</span></button>
  </div>${history}`);
 }catch(e){alert(e.message||'Could not load Customer Help')}
}
function customerPaymentHelp(){
 openM(`<h2>💳 Payment & Checkout</h2><p>For payment problems, check your order payment status first. Ashwini Clothing supports the payment methods available at checkout, including Razorpay and COD where available.</p><div class="help-list"><button class="help-row" type="button" onclick="checkout()"><div><b>🛒 Open Checkout</b><small>Go to checkout and review payment options</small></div><span>›</span></button><button class="help-row account-action" type="button" onclick="orders()"><div><b>📦 Check Order Payment Status</b><small>View your orders and payment status</small></div><span>›</span></button></div>`);
}
function customerWebsiteHelp(){
 openM(`<h2>🌐 Website & Technical Help</h2><p>If a button, product page, search, category or another website feature is not working, describe the problem below and send it to Ashwini Support.</p><div class="checkout-card"><div class="form"><input id="helpSubject" placeholder="Subject / Problem" value="Website Help"><textarea id="helpMessage" rows="5" maxlength="3000" placeholder="Describe your problem"></textarea><button class="gold" type="button" onclick="sendCustomerHelp('EMAIL')">✉️ Send Help Request by Email</button></div></div>`);
}
function contactAshwiniSupport(){
 openM(`<h2>✉️ Contact Ashwini Support</h2><p>Support email: <b>ashwiniweb88@gmail.com</b></p><div class="checkout-card"><div class="form"><input id="helpSubject" placeholder="Subject / Problem" value="Customer Help"><textarea id="helpMessage" rows="5" maxlength="3000" placeholder="Describe your problem"></textarea><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="gold" type="button" onclick="sendCustomerHelp('EMAIL')">✉️ Send Help Request by Email</button><button class="wishlist" type="button" onclick="sendCustomerHelp('CALLBACK')">📞 Request a Call Back</button></div><small>Your registered mobile number will be shared with our admin only for a callback request.</small></div></div>`);
}
async function sendCustomerHelp(method){
 const subject=(document.getElementById('helpSubject')?.value||'Customer Help').trim();
 const message=(document.getElementById('helpMessage')?.value||'').trim();
 if(!message){alert('Please describe your problem first.');return}
 let emailTab=null;
 try{
  if(method==='EMAIL') emailTab=window.open('about:blank','_blank');
  const d=await api('/api/customer-help',{method:'POST',body:{subject,message,contact_method:method}});
  if(method==='EMAIL'){
   const body=`Customer: ${user?.name||''}\nRegistered email: ${user?.email||''}\nRegistered mobile: ${user?.phone||''}\nHelp Request ID: ${d.id}\n\nProblem:\n${message}`;
   const gmailUrl=`https://mail.google.com/mail/?view=cm&fs=1&to=ashwiniweb88@gmail.com&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
   if(emailTab && !emailTab.closed){
    emailTab.location.href=gmailUrl;
   }else{
    window.location.href=`mailto:ashwiniweb88@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
   }
   toast(`✓ Help request #${d.id} saved. Gmail compose opened — click Send to email Ashwini Support.`);
   customerHelp();
  }else{
   toast(`✓ Callback request #${d.id} sent to Admin`);
   customerHelp();
  }
 }catch(e){
  if(emailTab && !emailTab.closed) emailTab.close();
  alert(e.message||'Could not send help request')
 }
}
function showTermsOfUse(){
 openM(`<div class="amazon-login-wrap policy-page"><div class="ashwini-login-logo" aria-label="Ashwini">ASHWINI</div><h2>Ashwini Terms of Use</h2><div class="policy-content"><p>Welcome to Ashwini Clothing. By using this website, creating an account, placing an order, or using our services, you agree to these Terms of Use.</p><h3>1. Using Ashwini</h3><p>You agree to provide accurate account and delivery information and to use the website only for lawful purchases and genuine customer support requests.</p><h3>2. Products & Prices</h3><p>Product descriptions, sizes, colours, availability and prices are shown on the product page and may be updated when necessary. Orders are subject to availability and confirmation.</p><h3>3. Orders & Payments</h3><p>When you place an order, you agree to provide correct delivery details and complete the selected payment method. Payment information is processed through the payment service used by Ashwini.</p><h3>4. Returns & Replacements</h3><p>Returns and replacements are governed by Ashwini's return policy shown on the product and order pages. Items must meet the stated eligibility conditions.</p><h3>5. Account Security</h3><p>You are responsible for keeping your login information secure. If you enable 2-step verification, an additional OTP may be required when signing in.</p><h3>6. Contact</h3><p>For help with an order, account or website feature, contact Ashwini Support through the website.</p></div><button type="button" class="gold amazon-continue-btn" onclick="auth()">Back to Sign in</button></div>`);
}
function showPrivacyNotice(){
 openM(`<div class="amazon-login-wrap policy-page"><div class="ashwini-login-logo" aria-label="Ashwini">ASHWINI</div><h2>Ashwini Privacy Policy</h2><div class="policy-content"><p>Your privacy matters to Ashwini Clothing. This policy explains what information we use to provide shopping, account, payment and support services.</p><h3>1. Information We Use</h3><p>We may use information such as your name, mobile number, email address, delivery address, order details and account preferences to operate the website and fulfil orders.</p><h3>2. How We Use Information</h3><p>We use this information to sign you in, process orders and payments, arrange delivery, provide returns and replacements, send important order or security messages, and respond to support requests.</p><h3>3. OTP & Account Security</h3><p>When you use OTP or 2-step verification, your verification code is used only to confirm access to your account. Never share an OTP with anyone.</p><h3>4. Payments</h3><p>Payment details are handled through the payment provider used by Ashwini. Ashwini does not ask customers to share card PINs, CVVs or OTPs with support staff.</p><h3>5. Cookies & Local Storage</h3><p>The website may use browser storage and cookies to keep your cart, wishlist, login state and preferences working correctly.</p><h3>6. Your Choices</h3><p>You can update eligible account information from Login & Security and Manage Profile. You can also contact Ashwini Support for privacy-related questions.</p></div><button type="button" class="gold amazon-continue-btn" onclick="auth()">Back to Sign in</button></div>`);
}
function auth(){
 if(user){accountMenu();return}
 openM(`<div class="amazon-login-wrap">
 <div class="ashwini-login-logo" aria-label="Ashwini">ASHWINI</div>
 <h2>Sign in or create account</h2>
 <div class="form">
   <label class="login-label"><b>Enter mobile number or email</b></label>
   <input id="loginIdentifier" placeholder="Mobile number or email" autocomplete="username" autofocus>
   <button type="button" class="gold amazon-continue-btn" onclick="continueCustomerLogin()">Continue</button>
   <p class="login-legal">By continuing, you agree to Ashwini's <a href="#" onclick="showTermsOfUse();return false">Terms of Use</a> and <a href="#" onclick="showPrivacyNotice();return false">Privacy Policy</a>.</p>
   <div class="login-divider"><span>or</span></div>
   <button type="button" class="linkbtn admin-login-link login-action-link" onclick="showAdminLoginPanel()">Store admin sign in</button>
   <button type="button" class="linkbtn login-action-link" onclick="showRegisterPanel()">Create a new Ashwini account</button>
   <button type="button" class="linkbtn login-action-link" onclick="forgotPasswordFlow()">Forgot account / password?</button>
 </div>
 </div>`);
}
async function continueCustomerLogin(){
 const el=document.getElementById('loginIdentifier');
 const identifier=(el?.value||'').trim();
 if(!identifier){alert('Enter your mobile number or email.');el?.focus();return}
 try{
   window.__pendingLoginIdentifier=identifier;
   const d=await api('/api/auth/request-login-otp',{method:'POST',body:{identifier}});
   openM(`<div class="amazon-login-wrap">
    <div class="ashwini-login-logo" aria-label="Ashwini">ASHWINI</div>
    <h2>Sign in</h2>
    <p class="login-account-id">${esc(identifier)} <button type="button" class="text-change" onclick="auth()">Change</button></p>
    <div class="form">
      <label class="login-label"><b>Enter OTP</b></label>
      <input id="loginOtp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit OTP" autofocus>
      <button class="gold amazon-continue-btn" type="button" onclick="verifyLoginOtpFor()">Sign in</button>
      <small id="loginOtpHint">${d.devOtp?`Demo OTP: ${esc(d.devOtp)}`:`OTP sent to your ${d.channel==='mobile'?'mobile number':'email'}. It expires in about 5 minutes.`}</small>
      <button type="button" class="linkbtn" onclick="resendLoginOtp()">Resend OTP</button>
      <button type="button" class="linkbtn" onclick="auth()">← Back</button>
    </div>
   </div>`);
 }catch(e){alert(e.message||'Could not continue sign in')}
}
async function resendLoginOtp(){
 const identifier=window.__pendingLoginIdentifier||'';
 try{const d=await api('/api/auth/request-login-otp',{method:'POST',body:{identifier}});const h=document.getElementById('loginOtpHint');if(h)h.textContent=d.devOtp?`Demo OTP: ${d.devOtp}`:`OTP sent securely. It expires in about 5 minutes.`;toast('✓ OTP sent')}catch(e){alert(e.message)}
}
async function verifyLoginOtpFor(){
 const identifier=window.__pendingLoginIdentifier||'';
 const otp=(document.getElementById('loginOtp')?.value||'').trim();
 if(!/^\d{6}$/.test(otp)){alert('Please enter the 6-digit OTP.');return}
 try{const d=await api('/api/auth/verify-login-otp',{method:'POST',body:{identifier,otp}});session(d);closeM();toast('✓ Signed in')}catch(e){alert(e.message||'OTP verification failed')}
}
function showRegisterPanel(){
 openM(`<h2>Create your Ashwini account</h2><p>Verify your mobile once and your account will be created. Existing mobile numbers will not create duplicate accounts.</p><div class="form">
 <input id="rn" placeholder="Full name" autocomplete="name"><input id="re" placeholder="Email" autocomplete="email"><input id="rp" type="password" placeholder="Password (8+ characters)" autocomplete="new-password"><input id="rphone" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number" autocomplete="tel">
 <button type="button" class="gold" onclick="sendOtp()">Send OTP</button><input id="rotp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="Enter 6-digit OTP"><button class="gold" type="button" onclick="register()">Verify OTP & Create Account</button><small id="otpHint">OTP will be shown only in local/demo mode.</small><button type="button" class="linkbtn" onclick="auth()">← Back to Sign in</button></div>`);
}
function showAdminLoginPanel(){
 openM(`<h2>Store admin sign in</h2><p>Admin access uses the store admin email and password. After sign-in, the secure session remains active until logout or expiry.</p><div class="form"><input id="adminLoginEmail" type="email" placeholder="Admin email" autocomplete="username"><input id="adminLoginPassword" type="password" placeholder="Admin password" autocomplete="current-password"><button class="gold" type="button" onclick="adminPasswordLogin()">Sign in as Admin</button><button type="button" class="linkbtn" onclick="auth()">← Back to Customer Sign in</button></div>`);
}
async function adminPasswordLogin(){
 const email=(document.getElementById('adminLoginEmail')?.value||'').trim().toLowerCase(), password=document.getElementById('adminLoginPassword')?.value||'';
 if(!email||!password){alert('Enter admin email and password.');return}
 try{const d=await api('/api/auth/login',{method:'POST',body:{email,password}});session(d);closeM();toast('✓ Admin signed in');}
 catch(e){alert(e.message||'Admin sign in failed')}
}
function chooseOtpChannel(channel){const el=document.getElementById('loginIdentifier');if(el)el.placeholder=channel==='mobile'?'Mobile number':'Email address'}
function showLoginMode(mode){}
async function sendLoginOtp(){return continueCustomerLogin()}
async function verifyLoginOtp(){const identifier=(document.getElementById('loginIdentifier')?.value||'').trim();return verifyLoginOtpFor(identifier)}
async function requestRecoveryOtp(identifier,hint){try{const d=await api('/api/auth/request-recovery-otp',{method:'POST',body:{identifier}});if(hint)hint.textContent=`Demo OTP: ${d.devOtp}`;return d.devOtp}catch(e){if(hint)hint.textContent=e.message;throw e}}
async function forgotLoginIdFlow(){openM(`<h2>Forgot Login ID?</h2><p>Enter your registered email or mobile number. We will verify it with OTP.</p><div class="form"><input id="recoveryId" placeholder="Email or 10-digit mobile number"><button onclick="sendRecoveryOtp('loginid')">Send OTP</button><input id="recoveryOtp" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit OTP"><button class="gold" onclick="verifyForgotLoginId()">Show Login ID</button><small id="recoveryHint"></small><div id="recoveryResult"></div></div>`)}
async function sendRecoveryOtp(kind){const identifier=(document.getElementById('recoveryId')?.value||'').trim();const hint=document.getElementById('recoveryHint');if(!identifier){hint.textContent='Enter your registered email or mobile number.';return}try{await requestRecoveryOtp(identifier,hint);toast('✓ Recovery OTP generated')}catch(e){alert(e.message)}}
async function verifyForgotLoginId(){const identifier=(document.getElementById('recoveryId')?.value||'').trim(),otp=(document.getElementById('recoveryOtp')?.value||'').trim();try{const d=await api('/api/auth/forgot-login-id',{method:'POST',body:{identifier,otp}});document.getElementById('recoveryResult').innerHTML=`<p class="success"><b>Your Login ID:</b> ${esc(d.loginId)}</p>`}catch(e){alert(e.message)}}
async function forgotPasswordFlow(){openM(`<h2>Forgot Password?</h2><p>Enter your registered email or mobile number, generate OTP, then enter the OTP below to reset your password.</p><div class="form"><label><b>Registered Email / Mobile Number</b></label><input id="passwordRecoveryId" placeholder="Email or 10-digit mobile number" autocomplete="username"><button type="button" class="gold" onclick="sendPasswordRecoveryOtp()">Send OTP</button><label style="margin-top:6px"><b>Enter 6-digit OTP</b></label><input id="passwordRecoveryOtp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="Enter OTP here"><small id="passwordRecoveryHint">OTP will appear here after you click Send OTP.</small><label><b>New Password</b></label><input id="newPassword" type="password" minlength="8" placeholder="New password (8+ characters)" autocomplete="new-password"><label><b>Confirm New Password</b></label><input id="newPassword2" type="password" minlength="8" placeholder="Confirm new password" autocomplete="new-password"><button type="button" class="gold" onclick="resetPasswordFlow()">Reset Password</button></div>`)}
async function sendPasswordRecoveryOtp(){const identifier=(document.getElementById('passwordRecoveryId')?.value||'').trim(),hint=document.getElementById('passwordRecoveryHint');if(!identifier){if(hint)hint.textContent='Enter your registered email or mobile number first.';return}try{const d=await api('/api/auth/request-recovery-otp',{method:'POST',body:{identifier}});if(hint)hint.textContent=`Demo OTP: ${d.devOtp} · Enter this 6-digit OTP in the box above.`;const otp=document.getElementById('passwordRecoveryOtp');otp?.focus();toast('✓ Recovery OTP generated')}catch(e){if(hint)hint.textContent=e.message;alert(e.message)}}
async function resetPasswordFlow(){const identifier=(document.getElementById('passwordRecoveryId')?.value||'').trim(),otp=(document.getElementById('passwordRecoveryOtp')?.value||'').trim(),password=document.getElementById('newPassword')?.value||'',confirm=document.getElementById('newPassword2')?.value||'';if(!identifier){alert('Enter your registered email or mobile number.');return}if(!/^\d{6}$/.test(otp)){alert('Please enter the 6-digit OTP.');document.getElementById('passwordRecoveryOtp')?.focus();return}if(password.length<8){alert('Password must be at least 8 characters.');return}if(password!==confirm){alert('Passwords do not match');return}try{await api('/api/auth/reset-password',{method:'POST',body:{identifier,otp,password}});openM(`<div class="success"><div class="big">✓</div><h2>Password Reset Successfully</h2><p>You can now sign in with your new password.</p><button class="gold" onclick="auth()">Back to Login</button></div>`)}catch(e){alert(e.message)}}
async function sendOtp(){const phoneEl=document.getElementById('rphone');const hint=document.getElementById('otpHint');const phone=(phoneEl?.value||'').replace(/\D/g,'');if(!/^\d{10}$/.test(phone)){if(hint)hint.textContent='Please enter a valid 10-digit mobile number.';phoneEl?.focus();return}const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Send OTP');if(btn){btn.disabled=true;btn.textContent='Sending...'}try{const d=await api('/api/auth/request-otp',{method:'POST',body:{phone}});if(hint)hint.textContent=`Demo OTP: ${d.devOtp}. Enter this 6-digit code below.`;toast('✓ OTP generated');}catch(e){if(hint)hint.textContent=e.message||'Could not send OTP';alert(e.message)}finally{if(btn){btn.disabled=false;btn.textContent='Send OTP'}}}
async function setupAdmin(){try{const d=await api('/api/auth/setup-admin',{method:'POST',body:{name:an.value,email:ae.value,password:apw.value}});session(d);closeM();dashboard()}catch(e){alert(e.message)}}
async function login(){try{const d=await api('/api/auth/login',{method:'POST',body:{email:email.value,password:pass.value}});session(d);closeM()}catch(e){alert(e.message)}}
async function register(){try{const d=await api('/api/auth/register',{method:'POST',body:{name:rn.value,email:re.value,password:rp.value,phone:rphone.value.trim(),otp:rotp.value.trim()}});session(d);closeM()}catch(e){alert(e.message)}}
function refreshAccountHeader(){const link=document.getElementById('accountTopLink');if(!link)return;const small=link.querySelector('small'),bold=link.querySelector('b');if(user){const short=String(user.name||'Customer').trim().split(/\s+/)[0]||'Customer';if(small)small.textContent=`Hello, ${short}`;if(bold)bold.textContent='Account & Lists';link.setAttribute('aria-label',`Account & Lists for ${short}`)}else{if(small)small.textContent='Hello, sign in';if(bold)bold.textContent='Account & Lists';link.setAttribute('aria-label','Sign in to Ashwini')}}
function session(d){token='';user=d.user||d;localStorage.removeItem('ashwiniToken');localStorage.setItem('ashwiniUser',JSON.stringify(user));if(user.role==='admin'){const a=document.getElementById('admin');if(a)a.style.display='inline'}refreshAccountHeader();toast('Welcome to Ashwini')}
async function logout(){try{await api('/api/auth/logout',{method:'POST'})}catch{}localStorage.removeItem('ashwiniToken');localStorage.removeItem('ashwiniUser');token='';user=null;const a=document.getElementById('admin');if(a)a.style.display='none';refreshAccountHeader();auth()}
async function restoreSession(){try{const d=await api('/api/me');user=d.user||d;localStorage.setItem('ashwiniUser',JSON.stringify(user));if(user.role==='admin'){const a=document.getElementById('admin');if(a)a.style.display='inline'}refreshAccountHeader()}catch{localStorage.removeItem('ashwiniUser');user=null;refreshAccountHeader()}}
async function orders(){
 try{
  const [os,evs]=await Promise.all([api('/api/orders'),api('/api/return-events')]);
  const label=v=>String(v||'').replaceAll('_',' ');
  const byReturn=new Map();evs.forEach(e=>{const a=byReturn.get(Number(e.return_id))||[];a.push(e);byReturn.set(Number(e.return_id),a)});
  const rows=os.map(x=>{
   const r=x.return_request;
   const events=r?(byReturn.get(Number(r.id))||[]).slice(0,5):[];
   const win=returnWindowInfo(x);
   const canAgain=r&&['REJECTED','CANCELLED'].includes(String(r.status))&&win.eligible;
   const locked=hasReturnLock(x.id);
   const returnAction=x.status==='DELIVERED'&&win.eligible&&!r&&!locked?`<br><button class="account-action" type="button" style="margin-top:7px" onclick="returnsPanel()">↩️ Return / Replace</button>`:canAgain?`<br><button class="account-action" type="button" style="margin-top:7px" onclick="returnsPanel()">↩️ Return / Replace Again</button>`:r?`<br><button class="account-action" type="button" style="margin-top:7px" onclick="returnsPanel()">View Return Status</button>`:x.status==='DELIVERED'?`<br><small class="return-expired-note">Return window closed${returnDeadlineText(x)?` · ${returnDeadlineText(x)}`:''}</small>`:'';
   const purchasedItems=(x.items||[]).map(i=>{const img=i.image?`<img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy" style="width:58px;height:70px;object-fit:cover;border-radius:7px;display:block">`:esc(i.emoji||'👗');return `<button class="order-product-link" type="button" title="Open product page" onclick="stop(event);detail(${Number(i.product_id)})" style="border:1px solid #ead8df;background:#fff;border-radius:8px;padding:2px;cursor:pointer;width:64px;height:76px;display:flex;align-items:center;justify-content:center">${img}</button>`}).join('');
   const purchasedText=(x.items||[]).map(i=>`<button class="order-product-title" type="button" title="Open original product page" onclick="stop(event);detail(${Number(i.product_id)})" style="border:0;background:none;padding:0;margin:0 8px 0 0;color:#4b2633;font-weight:800;text-decoration:none;cursor:pointer">${esc(i.name)} × ${Number(i.quantity||1)}</button>`).join('');
   return `<div class="cartrow" style="grid-template-columns:1fr auto"><div><b>Order #${x.id}</b><div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;margin:8px 0 5px">${purchasedItems||''}</div><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">${purchasedText}</div><br><span>₹${Number(x.total).toLocaleString('en-IN')}</span><br><small>Ordered: ${new Date(x.created_at||'').toLocaleString('en-IN')}</small>${x.status==='DELIVERED'&&x.updated_at?`<br><small>Delivered: ${new Date(x.updated_at).toLocaleString('en-IN')}</small>`:''}<br><small>Status: ${esc(label(x.status))} · Payment: ${esc(x.status==='DELIVERED'?'PAID':(x.payment_status||'PENDING'))}</small>${x.status==='DELIVERED'?`<br><small>${win.eligible?`Return / Replace available until ${returnDeadlineText(x)}`:`Return window expired${returnDeadlineText(x)?` on ${returnDeadlineText(x)}`:''}`}</small>`:''}${r?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee"><small><b>↩️ Return & Replacement: ${esc(label(r.status))}</b>${r.pickup_at?` · Pickup: ${esc(r.pickup_at)}`:''}</small>${r.replacement_order?`<div style="margin-top:6px"><small><b>📦 Replacement Order #${r.replacement_order.id}</b> · Status: ${esc(label(r.replacement_order.status))}<br>Same original delivery address will be used.</small></div>`:''}${events.map(e=>`<div style="margin-top:4px"><small>• ${esc(e.title)} — ${esc(e.message)}</small></div>`).join('')}</div>`:''}</div><div><button class="account-action" type="button" onclick="orderDetails(${x.id})">View Details</button>${returnAction}</div></div>`;
  }).join('');
  openM(`<h2>📦 My Orders</h2><p>Every order shows its current delivery, payment and return/replacement status. Return/Replace closes automatically after 4 days from delivery.</p>${rows||'<p>No orders yet. Place your first order and it will appear here.</p>'}`)
 }catch(e){alert('My Orders could not load: '+e.message)}
}

async function orderDetails(id){
 try{
  const [o,evs]=await Promise.all([api('/api/orders/'+id),api('/api/return-events')]);
  const label=v=>String(v||'').replaceAll('_',' ');const r=o.return_request;const events=r?(evs.filter(e=>Number(e.return_id)===Number(r.id)).slice(0,12)):[];const canCancel=r&&['REQUESTED','APPROVED','PICKUP_SCHEDULED'].includes(String(r.status));const win=returnWindowInfo(o);const canRequestAgain=r&&['REJECTED','CANCELLED'].includes(String(r.status))&&win.eligible;
  const returnBlock=o.status==='DELIVERED'?`<div class="wishlist-section"><h3>↩️ Return & Replacement</h3>${r?`<p><b>Return #${r.id}</b> · <span class="status-pill">${esc(label(r.status))}</span></p><p>Reason: ${esc(r.reason)} · Option: ${esc(r.request_type||'REPLACEMENT')}${r.pickup_at?`<br>Pickup: ${esc(r.pickup_at)}`:''}</p>${r.admin_note?`<p>Admin note: ${esc(r.admin_note)}</p>`:''}${events.length?`<div style="margin-top:10px;padding-top:10px;border-top:1px solid #eee"><b>Return notifications</b>${events.map(e=>`<div style="margin-top:6px"><small><b>${esc(e.title)}</b> · ${esc(e.created_at)}</small><br><small>${esc(e.message)}</small></div>`).join('')}</div>`:''}${r.replacement_order?`<div style="margin-top:10px;padding:12px;border:1px solid #ead8df;border-radius:8px;background:#fffafc"><b>📦 Replacement Order #${r.replacement_order.id}</b><br><small>Status: ${esc(label(r.replacement_order.status))}</small><br><small>Delivery address: ${esc(r.replacement_order.address||o.address)}</small><br><small>The replacement is being sent to the same address as the original order.</small></div>`:''}<div style="margin-top:10px"><button type="button" onclick="returnsPanel()">View Return Updates</button>${canCancel?`<button class="account-action" type="button" style="margin-left:8px" onclick="cancelReturn(${r.id})">Cancel Return Request</button>`:''}${canRequestAgain?`<button class="gold" type="button" style="margin-left:8px" onclick="returnsPanel()">Request Return / Replace Again</button>`:''}</div>`:`<p>${win.eligible?`This delivered order is eligible for return/replacement until <b>${returnDeadlineText(o)}</b>.`:`The 4-day return/replacement window has expired${returnDeadlineText(o)?` on ${returnDeadlineText(o)}`:''}.`}</p>${win.eligible?`<button class="account-action" type="button" onclick="returnsPanel()">Return / Replace Product</button>`:''}`}</div>`:'';
  const detailItems=(o.items||[]).map(i=>{const img=i.image?`<img src="${esc(i.image)}" alt="${esc(i.name)}" style="width:86px;height:104px;object-fit:cover;border-radius:8px;display:block">`:esc(i.emoji||'👗');return `<div class="cartrow" style="grid-template-columns:96px 1fr auto;align-items:center"><button type="button" title="Open original product page" onclick="stop(event);detail(${Number(i.product_id)})" style="border:1px solid #ead8df;background:#fff;border-radius:9px;padding:3px;cursor:pointer;width:92px;height:110px;display:flex;align-items:center;justify-content:center">${img}</button><div><button class="order-product-title" type="button" onclick="stop(event);detail(${Number(i.product_id)})" style="border:0;background:none;padding:0;text-align:left;cursor:pointer;color:#4b2633;font-weight:800">${esc(i.name)}</button><br>Size ${esc(i.size)} · Qty ${i.quantity}</div><b>₹${Number(i.unit_price*i.quantity).toLocaleString('en-IN')}</b></div>`}).join('');
  openM(`<h2>Order #${o.id}</h2><p><b>Ordered:</b> ${new Date(o.created_at||'').toLocaleString('en-IN')}</p>${o.status==='DELIVERED'&&o.updated_at?`<p><b>Delivered:</b> ${new Date(o.updated_at).toLocaleString('en-IN')}</p>`:''}<p><b>Status:</b> ${esc(label(o.status))}</p><p><b>Payment:</b> ${esc(o.status==='DELIVERED'?'PAID':(o.payment_status||'PENDING'))} (${esc(o.payment_method||'')})</p><p><b>Delivery address:</b> ${esc(o.address)}</p><h3>Items</h3>${detailItems||'<p>No product items found for this order.</p>'}<div class="total">Total: ₹${Number(o.total).toLocaleString('en-IN')}</div>${returnBlock}<button class="gold" type="button" onclick="track(${o.id})">🚚 Track Order</button>`)
 }catch(e){alert('Order details could not load: '+e.message)}
}

async function track(id){
 try{
  const o=await api('/api/orders/'+id);
  let i=stages.indexOf(o.status);if(i<0)i=0;
  openM(`<h2>🚚 Track Order #${o.id}</h2><p><b>Current status:</b> ${esc(String(o.status).replaceAll('_',' '))}</p><div class="track">${stages.map((s,n)=>`<div class="step ${n<=i?'active':''}"><div class="dot"></div>${s.replaceAll('_',' ')}</div>`).join('')}</div><p><b>Delivering to:</b> ${esc(o.address)}</p><p><b>Payment:</b> ${esc(o.status==='DELIVERED'?'PAID':(o.payment_status||'PENDING'))}</p><div class="total">₹${Number(o.total).toLocaleString('en-IN')}</div><button class="account-action" type="button" onclick="orders()">← My Orders</button>`);
 }catch(e){alert('Tracking could not load: '+e.message)}
}
function normalizeSizeChart(raw){
 try{
  const a=JSON.parse(raw||'[]');
  if(Array.isArray(a))return a.map(x=>({size:String(x.size||''),bust:String(x.bust??''),waist:String(x.waist??''),hip:String(x.hip??''),length:String(x.length??'')}));
 }catch(e){}
 return [];
}
function sizeChartRowsFromEditor(){
 return [...document.querySelectorAll('#ap_size_rows tr[data-size-row]')].map(tr=>({
  size:tr.querySelector('.ap-sc-size')?.value.trim()||'',
  bust:tr.querySelector('.ap-sc-bust')?.value.trim()||'',
  waist:tr.querySelector('.ap-sc-waist')?.value.trim()||'',
  hip:tr.querySelector('.ap-sc-hip')?.value.trim()||'',
  length:tr.querySelector('.ap-sc-length')?.value.trim()||''
 })).filter(x=>x.size);
}
function addSizeChartRow(row={size:'',bust:'',waist:'',hip:'',length:''}){
 const tbody=document.getElementById('ap_size_rows');if(!tbody)return;
 const tr=document.createElement('tr');tr.setAttribute('data-size-row','1');
 tr.innerHTML=`<td><input class="ap-sc-size" value="${esc(row.size)}" placeholder="M"></td><td><input class="ap-sc-bust" value="${esc(row.bust)}" placeholder="36"></td><td><input class="ap-sc-waist" value="${esc(row.waist)}" placeholder="30"></td><td><input class="ap-sc-hip" value="${esc(row.hip)}" placeholder="38"></td><td><input class="ap-sc-length" value="${esc(row.length)}" placeholder="40"></td><td><button type="button" class="admin-danger" onclick="this.closest('tr').remove()">Remove</button></td>`;
 tbody.appendChild(tr);
}
async function productEditor(id=null){
 if(user?.role!=='admin')return alert('Admin only');
 const [ps,cats]=await Promise.all([api('/api/products'),api('/api/admin/categories')]);
 const p=id?ps.find(x=>x.id===id):{name:'',category:(cats[0]?.name||'Western Dress'),size_options:'S,M,L,XL',color:'',price:0,mrp:0,rating:0,emoji:'👗',stock:0,description:'',image:'',gallery:'',product_history:'',size_chart:'[]',care_instructions:'',badge_text:'Ashwini Choice',offer_text:'',offer_discount:0};
 if(!p)return;
 const rows=normalizeSizeChart(p.size_chart);
 openM(`<h2>${id?'✎ Edit Product':'＋ Add New Product'}</h2>
 <div class="admin-form">
 <div><label>Product Name<input id="ap_name" value="${esc(p.name)}"></label></div>
 <div><label>Category<select id="ap_category">${cats.map(c=>`<option ${c.name===p.category?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div>
 <div><label>Sizes<input id="ap_sizes" value="${esc(p.size_options||'S,M,L,XL')}" placeholder="S,M,L,XL"></label><div class="admin-note">Enter sizes separated by commas. The chart below can be edited separately.</div></div>
 <div><label>Colour<input id="ap_color" value="${esc(p.color||'')}"></label></div>
 <div><label>Selling Price (₹)<input id="ap_price" type="number" min="0" value="${Number(p.price)||0}"></label></div>
 <div><label>MRP (₹)<input id="ap_mrp" type="number" min="0" value="${Number(p.mrp)||0}"></label></div>
 <div><label>Stock Quantity<input id="ap_stock" type="number" min="0" value="${Number(p.stock)||0}"></label></div>
 <div><label>Rating<input id="ap_rating" type="number" min="0" max="5" step="0.1" value="${Number(p.rating)||0}"></label></div>
 <div><label>🏷️ Product Sticker / Badge<input id="ap_badge" value="${esc(p.badge_text||'')}" placeholder="Ashwini Choice (leave blank to remove)"></label></div>
 <div><label>🎁 Extra Product Offer<input id="ap_offer_text" value="${esc(p.offer_text||'')}" placeholder="Extra 10% off"></label></div>
 <div><label>Offer Discount %<input id="ap_offer_discount" type="number" min="0" max="100" step="0.1" value="${Number(p.offer_discount)||0}"></label></div>
 <div class="full"><label><b>📷 Product Photos</b></label>
 <div class="admin-note">Upload up to 5 photos. The first photo becomes the main product photo. Existing photo paths remain supported.</div>
 <input id="ap_photo_files" type="file" accept="image/*" multiple onchange="handleProductPhotoUpload(this)" style="margin-top:8px">
 <div id="ap_photo_preview" class="admin-photo-preview" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"></div>
 <label style="margin-top:10px">Main Photo<input id="ap_image" value="${esc(p.image||'')}" placeholder="/product-photo.jpg"></label>
 <label style="margin-top:10px">Up to 5 Photo paths<input id="ap_gallery" value="${esc(p.gallery||'')}" placeholder='["/front.jpg","/back.jpg"]'></label>
 </div>
 <div class="full"><label>Product Description<textarea id="ap_desc">${esc(p.description||'')}</textarea></label></div>
 <div class="full"><label>Product History / Details<textarea id="ap_history">${esc(p.product_history||'')}</textarea></label></div>
 <div class="full"><label>Care Instructions<textarea id="ap_care">${esc(p.care_instructions||'')}</textarea></label></div>
 <div class="full"><label><b>📏 Size Chart — Edit</b></label>
 <div class="admin-note">Edit measurements here. Add or remove sizes as needed. Measurements are in inches.</div>
 <div style="overflow:auto"><table class="size-chart-table admin-size-chart"><thead><tr><th>Size</th><th>Bust / Chest</th><th>Waist</th><th>Hip</th><th>Length</th><th></th></tr></thead><tbody id="ap_size_rows"></tbody></table></div>
 <button type="button" style="margin-top:8px" onclick="addSizeChartRow()">＋ Add Size</button>
 </div>
 </div><div class="admin-actions" style="margin-top:14px"><button class="gold" type="button" onclick="saveProduct(${id||0})">💾 Save Product</button><button type="button" onclick="adminHighlights()">✨ Edit Product Highlights</button><button type="button" onclick="dashboard()">Cancel</button></div>`);
 rows.forEach(r=>addSizeChartRow(r));
}
async function handleProductPhotoUpload(input){
 try{
  const files=[...(input.files||[])].slice(0,5);
  if(!files.length)return;
  const existing=getAdminPhotoList();
  const remaining=Math.max(0,5-existing.length);
  const picked=files.slice(0,remaining);
  const encoded=[];
  for(const file of picked) encoded.push(await compressProductPhoto(file));
  const merged=[...existing,...encoded].filter(Boolean).slice(0,5);
  syncAdminPhotoFields(merged);
  renderAdminPhotoPreview(merged);
  if(files.length>picked.length)toast('Only 5 product photos can be saved. Remove or replace an existing photo first.');
 }catch(e){alert('Photo upload failed: '+e.message)}
}
function compressBannerImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read image'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('Invalid image'));img.onload=()=>{const max=1800,scale=Math.min(1,max/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,w,h);resolve(c.toDataURL('image/jpeg',0.78))};img.src=reader.result};reader.readAsDataURL(file)})}
async function handleOfferBannerUpload(input){try{const f=input.files?.[0];if(!f)return;const data=await compressBannerImage(f);of_banner.value=data;renderOfferBannerPreview(data)}catch(e){alert('Banner upload failed: '+e.message)}}
function renderOfferBannerPreview(src){const b=document.getElementById('of_banner_preview');if(b)b.innerHTML=src?`<img src="${esc(src)}" style="max-width:100%;max-height:180px;object-fit:cover;border-radius:8px;border:1px solid #ddd">`:''}
async function handleSlideImageUpload(input){try{const f=input.files?.[0];if(!f)return;const data=await compressBannerImage(f);sl_img.value=data;renderSlideImagePreview(data)}catch(e){alert('Slide image upload failed: '+e.message)}}
function renderSlideImagePreview(src){const b=document.getElementById('sl_img_preview');if(b)b.innerHTML=src?`<img src="${esc(src)}" style="max-width:100%;max-height:180px;object-fit:cover;border-radius:8px;border:1px solid #ddd">`:''}
function compressProductPhoto(file){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('Could not read image'));
  reader.onload=()=>{
   const img=new Image();
   img.onerror=()=>reject(new Error('Invalid image'));
   img.onload=()=>{
    const max=1000, scale=Math.min(1,max/Math.max(img.width,img.height));
    const w=Math.max(1,Math.round(img.width*scale)), h=Math.max(1,Math.round(img.height*scale));
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0,w,h);
    resolve(c.toDataURL('image/jpeg',0.70));
   };
   img.src=reader.result;
  };
  reader.readAsDataURL(file);
 });
}
function getAdminPhotoList(){
 const gi=document.getElementById('ap_gallery');
 let a=[];try{a=JSON.parse(gi?.value||'[]')}catch{}
 const im=document.getElementById('ap_image')?.value?.trim();
 if(im && !a.includes(im)) a.unshift(im);
 return a.filter(Boolean).slice(0,5);
}
function syncAdminPhotoFields(list){
 const arr=(list||[]).filter(Boolean).slice(0,5);
 const gi=document.getElementById('ap_gallery'), im=document.getElementById('ap_image');
 if(gi) gi.value=JSON.stringify(arr);
 if(im) im.value=arr[0]||'';
 return arr;
}
function renderAdminPhotoPreview(list){
 const box=document.getElementById('ap_photo_preview'); if(!box)return;
 const arr=(list||[]).filter(Boolean).slice(0,5);
 box.innerHTML=arr.map((src,i)=>`<div style="width:115px;text-align:center;border:1px solid #ddd;border-radius:10px;padding:7px;background:#fff">
   <img src="${esc(src)}" alt="Photo ${i+1}" style="width:95px;height:105px;object-fit:cover;border-radius:8px;border:1px solid #ddd">
   <small style="display:block;margin:4px 0">${i===0?'Main Photo':'Photo '+(i+1)}</small>
   <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
    <label style="font-size:11px;padding:4px 6px;border:1px solid #bbb;border-radius:5px;cursor:pointer">Replace
      <input type="file" accept="image/*" style="display:none" onchange="replaceAdminPhoto(${i},this)">
    </label>
    <button type="button" style="font-size:11px;padding:4px 6px" onclick="removeAdminPhoto(${i})">Remove</button>
   </div>
 </div>`).join('');
}
function removeAdminPhoto(index){
 const arr=getAdminPhotoList();
 if(index<0 || index>=arr.length)return;
 arr.splice(index,1);
 syncAdminPhotoFields(arr);
 renderAdminPhotoPreview(arr);
}
async function replaceAdminPhoto(index,input){
 try{
  const file=input?.files?.[0]; if(!file)return;
  const arr=getAdminPhotoList();
  if(index<0 || index>=arr.length)return;
  arr[index]=await compressProductPhoto(file);
  syncAdminPhotoFields(arr);
  renderAdminPhotoPreview(arr);
 }catch(e){alert('Photo replace failed: '+e.message)}
}
function initAdminPhotoPreview(){
 const gi=document.getElementById('ap_gallery'); if(!gi)return;
 let a=[];try{a=JSON.parse(gi.value||'[]')}catch{}
 const im=document.getElementById('ap_image')?.value?.trim(); if(im&&!a.includes(im))a.unshift(im);
 renderAdminPhotoPreview(a);
}
async function saveProduct(id){
 try{
  const body={name:ap_name.value.trim(),category:ap_category.value,size_options:ap_sizes.value.trim(),color:ap_color.value.trim(),price:Number(ap_price.value),mrp:Number(ap_mrp.value),stock:Number(ap_stock.value),rating:Number(ap_rating.value),emoji:'👗',image:ap_image.value.trim(),gallery:ap_gallery.value.trim()||'[]',description:ap_desc.value,product_history:ap_history.value,care_instructions:ap_care.value,size_chart:JSON.stringify(sizeChartRowsFromEditor()),badge_text:ap_badge.value.trim(),offer_text:ap_offer_text.value.trim(),offer_discount:Number(ap_offer_discount.value||0)};
  if(!body.name||!body.category||body.price<0||body.mrp<0||body.stock<0)throw Error('Please fill product name, category, prices and stock correctly');
  JSON.parse(body.gallery);JSON.parse(body.size_chart);
  const d=await api(id?`/api/admin/products/${id}`:'/api/admin/products',{method:id?'PATCH':'POST',body});
  toast('✓ Product saved');dashboard();load();
 }catch(e){alert(e.message)}
}
async function deleteProduct(id){if(user?.role!=='admin')return;if(!confirm('Delete this product?'))return;try{await api(`/api/admin/products/${id}`,{method:'DELETE'});toast('✓ Product deleted');dashboard();load()}catch(e){alert(e.message)}}
async function updateOrderStatus(id,status){try{const d=await api(`/api/admin/orders/${id}`,{method:'PATCH',body:{status}});toast(`✓ Order #${id} → ${String(d.order.status).replaceAll('_',' ')}`);dashboard()}catch(e){alert('Shipping/status update failed: '+e.message)}}
async function updateHelpStatus(id,status){try{await api(`/api/admin/customer-help/${id}`,{method:'PATCH',body:{status}});toast(`✓ Help request #${id} → ${status}`);dashboard()}catch(e){alert(e.message||'Could not update help request')}}
async function updateWhatsAppHelpNotification(id,status){try{await api(`/api/admin/whatsapp-help-events/${id}`,{method:'PATCH',body:{status}});dashboard()}catch(e){alert(e.message||'Could not update WhatsApp notification')}}
let helpChatState={threadId:null};
function helpChatDateTime(v){const s=String(v||'');const d=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)?new Date(s.replace(' ','T')+'Z'):new Date(s);if(Number.isNaN(d.getTime()))return esc(s);return d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});}
function helpChatBubble(m){const mine=m.sender_role==='CUSTOMER';return `<div class="help-chat-row ${mine?'mine':'theirs'}"><div class="help-chat-bubble">${esc(m.message)}<small>${helpChatDateTime(m.created_at)}</small></div></div>`}
async function whatsappHelp(){try{const d=await api('/api/help-chat');helpChatState.threadId=d.thread.id;updateHelpUnreadBadge(0);openM(`<div class="help-chat-modal"><div class="help-chat-hero"><div class="help-chat-hero-lady"><img src="/ai-help-lady-transparent.png" alt="Ashwini Help Desk"></div><div class="help-chat-hero-copy"><h2>${esc((d.name||'Ashwini Help Desk').replace(/^Ashwini AI Help Desk$/,'Ashwini Help Desk'))}</h2><p>Smart customer support from inside the Ashwini website. No WhatsApp login and no admin mobile number is shown.</p><span class="help-online-dot">● Online</span></div></div><div id="helpChatMessages" class="help-chat-messages">${d.messages.map(helpChatBubble).join('')}</div><form class="help-chat-compose" onsubmit="event.preventDefault();sendHelpChatMessage()"><textarea id="helpChatInput" maxlength="1000" rows="2" placeholder="Type your message..." aria-label="Type your message"></textarea><button class="gold" type="submit">Send ➤</button></form><div class="help-chat-private">🔒 Secure Ashwini website chat · Admin mobile number is never shown.</div></div>`);const box=document.getElementById('helpChatMessages');if(box)box.scrollTop=box.scrollHeight;document.getElementById('helpChatInput')?.focus();if(window.__helpChatTimer)clearInterval(window.__helpChatTimer);if(window.__helpChatStream)window.__helpChatStream.close();window.__helpChatStream=new EventSource('/api/help-chat/stream');window.__helpChatStream.onmessage=()=>refreshHelpChat(false);window.__helpChatStream.onerror=()=>{if(window.__helpChatStream){window.__helpChatStream.close();window.__helpChatStream=null}window.__helpChatTimer=setInterval(()=>refreshHelpChat(false),5000)}}catch(e){alert(e.message||'Ashwini Help Desk is currently unavailable.')}}
async function updateHelpUnreadBadge(forceCount=null){try{const count=forceCount===null?Number((await api('/api/help-chat/unread')).count||0):Number(forceCount||0);const badge=document.getElementById('ashwiniHelpUnreadBadge');if(!badge)return;const n=Math.max(0,count);badge.textContent=n>99?'99+':String(n);badge.classList.toggle('show',n>0);badge.setAttribute('aria-label',n?`${n} unread Help Desk repl${n===1?'y':'ies'}`:'No unread Help Desk replies')}catch{}}

async function refreshHelpChat(scroll=true){try{const d=await api('/api/help-chat/messages');if(!d.thread)return;const box=document.getElementById('helpChatMessages');if(!box)return;box.innerHTML=d.messages.map(helpChatBubble).join('');if(scroll)box.scrollTop=box.scrollHeight}catch{}}
async function sendHelpChatMessage(){const input=document.getElementById('helpChatInput');const text=input?.value.trim();if(!text)return;try{input.disabled=true;await api('/api/help-chat/messages',{method:'POST',body:{message:text}});input.value='';await refreshHelpChat(true)}catch(e){alert(e.message||'Message could not be sent')}finally{if(input){input.disabled=false;input.focus()}}}
async function adminHelpChat(id){try{const d=await api(`/api/admin/help-chat/threads/${id}`);const t=d.thread;openM(`<div class="admin-help-chat"><div class="admin-help-head"><div><h2>💬 ${esc(t.customer_name||'Customer')}</h2><small>${esc(t.customer_email||'Guest customer')}</small></div><span class="status-pill">${esc(t.status)}</span></div><div id="adminHelpMessages" class="help-chat-messages admin-chat-messages">${d.messages.map(helpChatBubble).join('')}</div><form class="help-chat-compose" onsubmit="event.preventDefault();sendAdminHelpReply(${id})"><textarea id="adminHelpInput" maxlength="1000" rows="2" placeholder="Write a reply..."></textarea><button class="gold" type="submit">Reply ➤</button></form><div class="admin-actions"><button type="button" onclick="updateAdminHelpChat(${id},'RESOLVED')">✓ Mark Resolved</button><button type="button" onclick="dashboard()">Back to Dashboard</button></div></div>`);const box=document.getElementById('adminHelpMessages');if(box)box.scrollTop=box.scrollHeight;document.getElementById('adminHelpInput')?.focus();if(window.__helpChatTimer)clearInterval(window.__helpChatTimer);if(window.__helpChatStream)window.__helpChatStream.close();window.__helpChatStream=new EventSource(`/api/admin/help-chat/stream/${id}`);window.__helpChatStream.onmessage=()=>refreshAdminHelpChat(id);window.__helpChatStream.onerror=()=>{if(window.__helpChatStream){window.__helpChatStream.close();window.__helpChatStream=null}window.__helpChatTimer=setInterval(()=>refreshAdminHelpChat(id),5000)}}catch(e){alert(e.message||'Could not open customer chat')}}
async function refreshAdminHelpChat(id){try{const d=await api(`/api/admin/help-chat/threads/${id}`);const box=document.getElementById('adminHelpMessages');if(!box)return;box.innerHTML=d.messages.map(helpChatBubble).join('');box.scrollTop=box.scrollHeight}catch{}}
async function sendAdminHelpReply(id){const input=document.getElementById('adminHelpInput'),text=input?.value.trim();if(!text)return;try{input.disabled=true;await api(`/api/admin/help-chat/threads/${id}/reply`,{method:'POST',body:{message:text}});input.value='';await refreshAdminHelpChat(id)}catch(e){alert(e.message||'Reply could not be sent')}finally{if(input){input.disabled=false;input.focus()}}}
async function updateAdminHelpChat(id,status){try{await api(`/api/admin/help-chat/threads/${id}`,{method:'PATCH',body:{status}});toast(status==='RESOLVED'?'✓ Chat marked resolved':'✓ Chat reopened');dashboard()}catch(e){alert(e.message||'Could not update chat')}}
async function dashboard(){
 if(user?.role!=='admin')return alert('Admin only');
 const results=await Promise.allSettled([api('/api/admin/stats'),api('/api/admin/orders'),api('/api/products'),api('/api/admin/questions'),api('/api/admin/customer-help'),api('/api/admin/whatsapp-help-events'),api('/api/admin/help-chat/threads'),api('/api/admin/returns')]);
 const [rs,ro,rp,rq,rh,rw,rhc,rr]=results.map(x=>x.status==='fulfilled'?x.value:null);
 const s=rs||{revenue:0,orders:0,customers:0,products:0},o=Array.isArray(ro)?ro:[],p=Array.isArray(rp)?rp:[],q=Array.isArray(rq)?rq:[],h=Array.isArray(rh)?rh:[],w=Array.isArray(rw)?rw:[],hc=Array.isArray(rhc)?rhc:[],returns=Array.isArray(rr)?rr:[];
 const waUnread=hc.reduce((n,x)=>n+Math.max(0,Number(x.unread||0)),0);
 const returnCount=returns.filter(x=>['REQUESTED','APPROVED','PICKUP_SCHEDULED','PICKUP_ATTEMPTED','PICKED_UP','IN_TRANSIT','RECEIVED','INSPECTION_PASSED'].includes(String(x.status||''))).length;
 const orderCount=o.filter(x=>['PAYMENT_PENDING','PLACED','CONFIRMED'].includes(String(x.status||''))).length;
 const questionCount=q.filter(x=>Number(x.answer_count||0)===0).length;
 const notifBadge=n=>Number(n)>0?`<span class="admin-notif-badge">${Number(n)>99?'99+':Number(n)}</span>`:'';
 const orderRows=o.length?o.map(x=>`<tr><td>#${x.id}<br><small>Ordered: ${new Date(x.created_at||'').toLocaleString('en-IN')}</small>${x.status==='DELIVERED'&&x.updated_at?`<br><small>Delivered: ${new Date(x.updated_at).toLocaleString('en-IN')}</small>`:''}</td><td><b>${esc(x.name||'Customer')}</b><br><small>${esc(x.email||'')}</small></td><td>₹${Number(x.total).toLocaleString('en-IN')}<br><small>${esc(x.payment_method)}</small></td><td><select class="status-select" onchange="updateOrderStatus(${x.id},this.value)">${['PAYMENT_PENDING','PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'].map(st=>`<option ${st===x.status?'selected':''}>${st}</option>`).join('')}</select></td><td>${esc((x.address||'').slice(0,55))}</td></tr>`).join(''):'<tr><td colspan="5">No orders yet.</td></tr>';
 const productRows=p.map(x=>`<tr><td><div class="admin-product">${x.image?`<img src="${esc(x.image)}" alt="">`:'👗'}<div><b>${esc(x.name)}</b><br><small>${esc(x.category)}</small></div></div></td><td>₹${Number(x.price).toLocaleString('en-IN')}<br><small>MRP ₹${Number(x.mrp).toLocaleString('en-IN')}</small></td><td>${x.stock}</td><td><div class="admin-actions"><button type="button" onclick="productEditor(${x.id})">✎ Edit</button><button type="button" class="admin-danger" onclick="deleteProduct(${x.id})">Delete</button></div></td></tr>`).join('');
 openM(`<h2>👑 Ashwini Admin Dashboard</h2><div class="admin-toolbar"><button class="gold" onclick="productEditor()">＋ Add New Product</button><button onclick="adminOffers()">🎁 Offer Management</button><button onclick="adminReturns()">↩️ Return Management ${notifBadge(returnCount)}</button><button onclick="adminSlides()">🖼️ Slides</button><button onclick="adminCategories()">🏷️ Shop by Category</button><button onclick="adminHighlights()">✨ Product Highlights</button><button onclick="adminStoreProfile()">🏢 Ashwini Information</button><button onclick="adminCodControl()">💵 COD Control</button><button onclick="adminHelpInbox()">💬 WhatsApp Help Desk ${notifBadge(waUnread)}</button><button onclick="dashboard()">↻ Refresh</button></div><div class="admin-grid"><button class="admin-stat stat-button" type="button" onclick="adminStat('revenue')">Revenue<b>₹${Number(s.revenue).toLocaleString('en-IN')}</b><small>View paid orders</small></button><button class="admin-stat stat-button" type="button" onclick="adminStat('orders')">Orders${notifBadge(orderCount)}<b>${s.orders}</b><small>View all orders</small></button><button class="admin-stat stat-button" type="button" onclick="adminStat('customers')">Customers<b>${s.customers}</b><small>View customers</small></button><button class="admin-stat stat-button" type="button" onclick="adminStat('products')">Products<b>${s.products}</b><small>View inventory</small></button></div><h3>📦 Inventory / Products</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>${productRows}</tbody></table></div><h3 style="margin-top:24px">🚚 Orders</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Address</th></tr></thead><tbody>${orderRows}</tbody></table></div><h3 style="margin-top:24px">💬 Ashwini Help Desk Notifications ${hc.filter(x=>Number(x.unread)>0).length?`<span class="status-pill" style="margin-left:8px">${hc.filter(x=>Number(x.unread)>0).length} NEW</span>`:''}</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Customer</th><th>Latest Message</th><th>Updated</th><th>Unread</th><th>Action</th></tr></thead><tbody>${hc.length?hc.map(x=>`<tr><td><b>${esc(x.customer_name||'Guest customer')}</b>${x.customer_email?`<br><small>${esc(x.customer_email)}</small>`:''}</td><td style="max-width:360px">${esc(x.last_message||'No messages')}</td><td><small>${new Date(x.updated_at||x.created_at).toLocaleString('en-IN')}</small></td><td>${Number(x.unread)>0?`<span class="status-pill">${x.unread} NEW</span>`:'✓'}</td><td><button class="gold" type="button" onclick="adminHelpChat(${x.id})">Open Chat</button></td></tr>`).join(''):'<tr><td colspan="5">No customer help messages yet.</td></tr>'}</tbody></table></div><h3 style="margin-top:24px">📞 Customer Help & Callback Requests</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Customer</th><th>Problem</th><th>Contact</th><th>Mobile</th><th>Status</th><th>Action</th></tr></thead><tbody>${h.length?h.map(x=>`<tr><td>${esc(x.customer_name)}<br><small>${esc(x.customer_email)}</small></td><td><b>${esc(x.subject)}</b><br>${esc(x.message)}</td><td>${esc(x.contact_method)}</td><td>${x.customer_phone?`<a href="tel:${esc(x.customer_phone)}">${esc(x.customer_phone)}</a>`:'Not registered'}</td><td><span class="status-pill">${esc(x.status)}</span></td><td><button type="button" onclick="updateHelpStatus(${x.id},'CONTACTED')">Contacted</button> <button class="gold" type="button" onclick="updateHelpStatus(${x.id},'RESOLVED')">Resolved</button></td></tr>`).join(''):'<tr><td colspan="6">No customer help requests.</td></tr>'}</tbody></table></div><h3 style="margin-top:24px">❓ Customer Questions ${notifBadge(questionCount)}</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Question</th><th>Customer</th><th>Answers</th><th>Action</th></tr></thead><tbody>${q.length?q.map(x=>`<tr><td>${esc(x.product_name)}</td><td>${esc(x.question)}</td><td>${esc(x.asker_name)}</td><td>${x.answer_count}</td><td><div style="display:flex;gap:6px;align-items:flex-start;min-width:280px"><textarea id="admin-answer-${x.id}" rows="2" maxlength="1000" placeholder="Write answer here" style="flex:1;min-width:170px;padding:8px;border:1px solid #d8c7cc;border-radius:7px;resize:vertical"></textarea><button class="gold" type="button" onclick="adminAnswerQuestion(${x.id},${x.product_id})">Answer</button></div></td></tr>`).join(''):'<tr><td colspan="5">No customer questions yet.</td></tr>'}</tbody></table></div>`);
}
async function adminReturns(){
 if(user?.role!=='admin')return alert('Admin only');
 try{
  const rs=await api('/api/admin/returns');
  const statusOptions=['REQUESTED','APPROVED','REJECTED','PICKUP_SCHEDULED','PICKUP_ATTEMPTED','PICKED_UP','IN_TRANSIT','RECEIVED','INSPECTION_PASSED','INSPECTION_FAILED','COMPLETED','CANCELLED'];
  const rows=rs.map(r=>`<tr><td>#${r.id}<br><small>Order #${r.order_id}</small></td><td><b>${esc(r.customer_name||'Customer')}</b><br><small>${esc(r.customer_email||'')}<br>${r.customer_phone?`<a href="tel:${esc(r.customer_phone)}">${esc(r.customer_phone)}</a>`:'No mobile'}</small></td><td>₹${Number(r.total||0).toLocaleString('en-IN')}<br><small>${esc(r.order_status||'')}</small></td><td>${esc(r.reason)}<br><small>${esc(r.request_type||'REPLACEMENT')}${r.replacement_size?` · Size ${esc(r.replacement_size)}`:''}${r.replacement_color?` · ${esc(r.replacement_color)}`:''}</small>${r.replacement_order_id?`<br><small><b>📦 Replacement #${r.replacement_order_id}</b> · ${esc(String(r.replacement_order_status||'').replaceAll('_',' '))}<br>Same address: ${esc(r.replacement_address||'')}</small>`:''}</td><td><select id="return-status-${r.id}" class="status-select">${statusOptions.map(st=>`<option ${st===r.status?'selected':''}>${st}</option>`).join('')}</select><br><input id="return-pickup-${r.id}" type="datetime-local" value="${esc((r.pickup_at||'').replace(' ','T'))}" style="margin-top:6px;padding:7px;border:1px solid #d8c7cc;border-radius:7px;width:190px"><br><textarea id="return-note-${r.id}" placeholder="Admin note (optional)" style="margin-top:6px;padding:7px;border:1px solid #d8c7cc;border-radius:7px;width:190px;min-height:55px">${esc(r.admin_note||'')}</textarea><br><small>Return requested: ${new Date(r.created_at).toLocaleString('en-IN')}</small><br><small>Order placed: ${r.order_date?new Date(r.order_date).toLocaleString('en-IN'):'—'}</small>${r.order_status==='DELIVERED'&&r.order_updated_at?`<br><small>Delivered: ${new Date(r.order_updated_at).toLocaleString('en-IN')}</small>`:''}</td><td><button class="gold" type="button" onclick="saveReturnAdmin(${r.id})">Save Status</button></td></tr>`).join('')||'<tr><td colspan="6">No return requests yet.</td></tr>';
  openM(`<h2>↩️ Return Management</h2><div class="admin-note">Approve/reject returns, schedule pickup, update pickup/inspection stages, and keep the customer updated. When a replacement/exchange return reaches <b>COMPLETED</b>, a replacement order is automatically created for the same customer using the original delivery address.</div><div class="admin-toolbar"><button type="button" onclick="dashboard()">Back to Dashboard</button><button class="gold" type="button" onclick="adminReturns()">↻ Refresh</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Request</th><th>Customer</th><th>Order</th><th>Reason / Option</th><th>Status & Pickup</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`)
 }catch(e){alert(e.message)}
}
async function saveReturnAdmin(id){try{const status=document.getElementById(`return-status-${id}`)?.value,pickup_at=document.getElementById(`return-pickup-${id}`)?.value||'',admin_note=document.getElementById(`return-note-${id}`)?.value||'';if(status==='PICKUP_SCHEDULED'&&!pickup_at){toast('Please select a pickup date and time');return}await api(`/api/admin/returns/${id}`,{method:'PATCH',body:{status,pickup_at,admin_note}});toast('✓ Return updated and customer notified');adminReturns()}catch(e){alert(e.message)}}
async function updateReturnStatus(id,status){const sel=document.getElementById(`return-status-${id}`);if(sel)sel.value=status;return saveReturnAdmin(id)}
async function previewStoreLogo(input){const f=input?.files?.[0],out=document.getElementById('sp_logo_preview');if(!f||!out)return;if(f.size>10*1024*1024){alert('Logo image must be 10MB or smaller');input.value='';return}const r=new FileReader();r.onload=()=>{out.innerHTML=`<img src="${esc(String(r.result||''))}" alt="New logo preview" style="max-width:180px;max-height:100px;object-fit:contain;border:1px solid #ddd;border-radius:8px;padding:8px;background:#fff">`};r.readAsDataURL(f)}
async function loadSiteLogo(){try{const x=await api('/api/store-profile');const src=x.logo_data||'logo-clear.png';document.querySelectorAll('img[src="logo-clear.png"]').forEach(img=>{img.src=src});const brand=document.querySelector('a.logo img');if(brand)brand.src=src}catch(e){console.warn('Logo load failed',e)}}
async function storeProfilePage(){
 try{
  const x=await api('/api/store-profile');
  const address=[x.address,x.city,x.state,x.pincode].filter(Boolean).join(', ');
  const contact=`${x.email?`<div>✉️ Email: <a href="mailto:${esc(x.email)}">${esc(x.email)}</a></div>`:''}${x.phone?`<div>📞 Phone: <a href="tel:${esc(x.phone)}">${esc(x.phone)}</a></div>`:''}${address?`<div>📍 Address: ${esc(address)}</div>`:''}`;
  openM(`<div class="store-profile-page"><img class="store-profile-logo" src="${esc(x.logo_data||'logo-clear.png')}" alt="Ashwini Clothing logo"><h2 class="store-profile-title">${esc(x.about_title||'About Ashwini Clothing')}</h2><div class="store-profile-section"><h3>Our History</h3><div class="store-profile-history">${esc(x.history||'Ashwini Clothing information will be updated soon.')}</div></div><div class="store-profile-section"><h3>📍 Ashwini Clothing Address & Contact</h3><div class="store-profile-contact">${contact||'Contact information will be updated soon.'}</div></div>${user?.role==='admin'?`<button class="gold" type="button" onclick="adminStoreProfile()">✎ Edit Ashwini Information</button>`:''}</div>`);
 }catch(e){alert('Could not load Ashwini information: '+e.message)}
}
async function adminCodControl(){
 if(user?.role!=='admin')return alert('Admin only');
 try{
  const d=await api('/api/admin/cod-settings');
  const states=['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh','Puducherry','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Lakshadweep','Andaman and Nicobar Islands'];
  const overrides=new Map((d.states||[]).map(x=>[String(x.state).toLowerCase(),Number(x.enabled)!==0]));
  const rows=states.map(st=>{const key=st.toLowerCase(),has=overrides.has(key),on=has?overrides.get(key):true;return `<tr><td>${esc(st)}</td><td><select class="cod-state-select" data-state="${esc(st)}"><option value="DEFAULT" ${!has?'selected':''}>Use global (${d.enabled?'ON':'OFF'})</option><option value="ON" ${has&&on?'selected':''}>ON</option><option value="OFF" ${has&&!on?'selected':''}>OFF</option></select></td></tr>`}).join('');
  openM(`<h2>💵 Cash on Delivery Control</h2><p class="admin-note">Use this control to temporarily hold COD globally or disable it only for selected states. Online Razorpay payment remains unchanged.</p><div class="checkout-card"><label><b>COD System</b></label><div style="display:flex;gap:10px;margin-top:8px"><button id="codGlobalOn" type="button" class="${d.enabled?'gold':''}" onclick="setCodGlobalUi(true)">ON</button><button id="codGlobalOff" type="button" class="${!d.enabled?'gold':''}" onclick="setCodGlobalUi(false)">OFF</button></div><small id="codGlobalText" style="display:block;margin-top:8px">COD is currently <b>${d.enabled?'ON':'OFF'}</b>.</small></div><div class="admin-table-wrap" style="margin-top:14px"><table class="admin-table"><thead><tr><th>State</th><th>COD</th></tr></thead><tbody>${rows}</tbody></table></div><div class="admin-actions"><button class="gold" type="button" onclick="saveCodSettings()">💾 Save COD Settings</button><button type="button" onclick="dashboard()">Back</button></div>`);
  window.__codGlobalEnabled=!!d.enabled;
 }catch(e){alert(e.message||'Could not load COD settings')}
}
function setCodGlobalUi(on){window.__codGlobalEnabled=!!on;const a=document.getElementById('codGlobalOn'),b=document.getElementById('codGlobalOff'),t=document.getElementById('codGlobalText');if(a)a.classList.toggle('gold',!!on);if(b)b.classList.toggle('gold',!on);if(t)t.innerHTML=`COD is currently <b>${on?'ON':'OFF'}</b>.`}
async function saveCodSettings(){
 try{const states=[...document.querySelectorAll('.cod-state-select')].map(x=>({state:x.dataset.state,enabled:x.value==='DEFAULT'?null:x.value==='ON'}));await api('/api/admin/cod-settings',{method:'PATCH',body:{enabled:window.__codGlobalEnabled!==false,states}});toast('✓ COD settings saved');adminCodControl()}catch(e){alert(e.message||'Could not save COD settings')}
}
async function adminHelpInbox(){
 if(user?.role!=='admin')return alert('Admin only');
 try{
  const threads=await api('/api/admin/help-chat/threads');
  const rows=(Array.isArray(threads)?threads:[]).map(t=>`<tr><td><b>${esc(t.customer_name||'Guest customer')}</b>${t.customer_email?`<br><small>${esc(t.customer_email)}</small>`:''}</td><td style="max-width:360px">${esc(t.last_message||'No messages')}</td><td><small>${helpChatDateTime(t.updated_at||t.created_at)}</small></td><td>${Number(t.unread)>0?`<span class="status-pill">${Number(t.unread)} NEW</span>`:'✓'}</td><td><button class="gold" type="button" onclick="adminHelpChat(${Number(t.id)})">Open Chat</button></td></tr>`).join('')||'<tr><td colspan="5">No customer messages yet.</td></tr>';
  openM(`<h2>💬 Ashwini Help Desk</h2><p class="admin-note">Open a customer conversation here and reply directly. Customer mobile numbers are never exposed in this chat.</p><div class="admin-toolbar"><button class="gold" type="button" onclick="adminWhatsAppHelp()">⚙️ Help Desk Settings</button><button type="button" onclick="adminHelpInbox()">↻ Refresh Messages</button><button type="button" onclick="dashboard()">Back</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Customer</th><th>Latest Message</th><th>Updated</th><th>Unread</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`);
 }catch(e){alert(e.message||'Could not load Help Desk messages')}
}
async function adminWhatsAppHelp(){
 if(user?.role!=='admin')return alert('Admin only');
 try{const x=await api('/api/store-profile');openM(`<h2>⚙️ Ashwini Help Desk Settings</h2><p class="admin-note">Customers chat with your support team inside the website. Your mobile number is never shown to customers.</p><div class="admin-toolbar"><button class="gold" type="button" onclick="adminHelpInbox()">💬 Open Customer Messages</button><button type="button" onclick="dashboard()">Back</button></div><div class="admin-form"><label class="full"><span><input id="wa_enabled" type="checkbox" ${Number(x.whatsapp_enabled??0)===1?'checked':''}> Enable Help Desk</span><small>Customers will see the animated 3D AI support button when enabled.</small></label><label>Display Name<input id="wa_name" value="${esc(x.whatsapp_name||'Ashwini Help Desk')}"></label><label class="full">Welcome Message<textarea id="wa_message" rows="4">${esc(x.whatsapp_message||'Hello! 👋 How can we help you today?')}</textarea></label></div><div class="admin-actions"><button class="gold" type="button" onclick="saveAdminWhatsAppHelp()">💾 Save Help Desk Settings</button></div>`)}catch(e){alert(e.message||'Could not load Help Desk settings')}}
async function saveAdminWhatsAppHelp(){
 try{const x=await api('/api/store-profile');await api('/api/admin/store-profile',{method:'PATCH',body:{about_title:x.about_title,history:x.history,address:x.address,city:x.city,state:x.state,pincode:x.pincode,email:x.email,phone:x.phone,whatsapp_enabled:document.getElementById('wa_enabled')?.checked?1:0,whatsapp_number:x.whatsapp_number||'',whatsapp_name:document.getElementById('wa_name')?.value.trim(),whatsapp_message:document.getElementById('wa_message')?.value.trim()}});toast('✓ Help Desk settings saved');dashboard()}catch(e){alert(e.message||'Could not save Help Desk settings')}}
async function adminStoreProfile(){
 if(user?.role!=='admin')return alert('Admin only');
 try{
  const x=await api('/api/store-profile');
  openM(`<h2>🏢 Edit Ashwini Information</h2><div class="admin-note">Edit the customer-facing Ashwini information, logo and WhatsApp Help Desk settings.</div><div class="admin-form"><label class="full">Store Logo<input id="sp_logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange="previewStoreLogo(this)"><small>Upload a new logo. The current logo remains unchanged until you save.</small><div id="sp_logo_preview" style="margin-top:10px"><img src="${esc(x.logo_data||'logo-clear.png')}" alt="Current logo" style="max-width:180px;max-height:100px;object-fit:contain;border:1px solid #ddd;border-radius:8px;padding:8px;background:#fff"></div></label><label>Page Heading<input id="sp_title" value="${esc(x.about_title||'About Ashwini Clothing')}"></label><label>Email<input id="sp_email" value="${esc(x.email||'ashwiniweb88@gmail.com')}"></label><label class="full">History / About Ashwini<textarea id="sp_history" rows="7">${esc(x.history||'')}</textarea></label><label>Address<input id="sp_address" value="${esc(x.address||'')}"></label><label>City<input id="sp_city" value="${esc(x.city||'')}"></label><label>State<input id="sp_state" value="${esc(x.state||'')}"></label><label>PIN Code<input id="sp_pin" value="${esc(x.pincode||'')}" maxlength="6"></label><label>Phone<input id="sp_phone" value="${esc(x.phone||'')}"></label><div class="admin-section-heading full">💬 WhatsApp Help Desk</div><label class="full"><span><input id="sp_wa_enabled" type="checkbox" ${Number(x.whatsapp_enabled??0)===1?'checked':''}> Enable WhatsApp Help Desk</span><small>Customers will see the floating animated help button when this is enabled.</small></label><label>WhatsApp Display Name<input id="sp_wa_name" value="${esc(x.whatsapp_name||'Ashwini Help Desk')}" placeholder="Ashwini Help Desk"></label><label>WhatsApp Number<input id="sp_wa_number" value="${esc(x.whatsapp_number||'')}" inputmode="numeric" maxlength="15" placeholder="10-digit WhatsApp number"></label><label class="full">Welcome Message<textarea id="sp_wa_message" rows="3" placeholder="Hello! 👋 Need help? Chat with us on WhatsApp!">${esc(x.whatsapp_message||'Hello! 👋 Need help? Chat with us on WhatsApp!')}</textarea></label></div><div class="admin-actions" style="margin-top:14px"><button class="gold" type="button" onclick="saveStoreProfile()">💾 Save Information</button><button type="button" onclick="dashboard()">Back</button></div>`);
 }catch(e){alert(e.message)}
}

async function saveStoreProfile(){
 try{
  let logo_data='';const f=document.getElementById('sp_logo')?.files?.[0];if(f){if(f.size>10*1024*1024)throw Error('Logo image must be 10MB or smaller');logo_data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(Error('Could not read logo file'));r.readAsDataURL(f)});}
  const body={about_title:sp_title.value.trim(),history:sp_history.value,address:sp_address.value.trim(),city:sp_city.value.trim(),state:sp_state.value.trim(),pincode:sp_pin.value.trim(),email:sp_email.value.trim(),phone:sp_phone.value.trim(),logo_data,whatsapp_enabled:document.getElementById('sp_wa_enabled')?.checked?1:0,whatsapp_name:document.getElementById('sp_wa_name')?.value.trim(),whatsapp_number:document.getElementById('sp_wa_number')?.value.replace(/\D/g,''),whatsapp_message:document.getElementById('sp_wa_message')?.value.trim()};
  await api('/api/admin/store-profile',{method:'PATCH',body});toast('✓ Ashwini information & WhatsApp settings saved');await loadSiteLogo();storeProfilePage();
 }catch(e){alert(e.message||'Could not save Ashwini information')}
}

const editProduct=productEditor;
async function adminAnswerQuestion(questionId,productId){
 const input=document.getElementById(`admin-answer-${questionId}`);
 const text=String(input?.value||'').trim();
 if(!text){toast('Please write an answer');input?.focus();return}
 try{await api(`/api/questions/${questionId}/answers`,{method:'POST',body:{answer:text}});toast('✓ Answer added');await dashboard()}catch(e){alert(e.message||'Could not add answer')}
}
async function offersPanel(){
 try{
  const offers=await api('/api/offers/active');
  if(!user){
   const cards=offers.map(o=>{const img=o.banner_url?`<img src="${esc(o.banner_url)}" style="width:100%;max-height:220px;object-fit:contain;border-radius:8px">`:'';return `<div class="checkout-card" style="margin-bottom:12px">${img}<h3>${esc(o.title)}</h3><p>${esc(o.description||'')}</p>${Number(o.discount_percent||0)>0?`<b>${Number(o.discount_percent)}% OFF</b><br>`:''}${o.coupon_code?`<p><b>Coupon:</b> ${esc(o.coupon_code)}</p>`:''}<button class="gold" type="button" onclick="showOfferDetails(${Number(o.id)})">🎁 ${esc(o.button_text||'Shop Now')}</button></div>`}).join('');
   openM(`<h2>🎁 Ashwini Offers</h2>${cards||'<p>No active offers right now.</p>'}`);return;
  }
  const n=await api('/api/notifications');
  const notes=n.map(x=>{
   const read=x.read_at?'':'<button style="float:right" onclick="markNotificationRead('+x.id+')">Mark read</button>';
   const image=x.banner_url?`<img src="${esc(x.banner_url)}" alt="${esc(x.title)}" style="width:100%;max-height:180px;object-fit:contain;border-radius:8px;margin:8px 0">`:'';
   const go=x.offer_id?`<button class="gold" type="button" onclick="showOfferDetails(${Number(x.offer_id)})">🎁 View Offer</button>`:'';
   return `<div class="review" style="margin-bottom:10px">${read}<b>${esc(x.title)}</b>${image}<p>${esc(x.message)}</p><small>${esc(x.created_at||'')}</small><div style="margin-top:10px">${go}</div></div>`
  }).join('');
  const current=offers.map(o=>`<div class="checkout-card" style="margin-bottom:10px">${o.banner_url?`<img src="${esc(o.banner_url)}" style="width:100%;max-height:220px;object-fit:contain;border-radius:8px">`:''}<h4>${esc(o.title)}</h4><p>${esc(o.description||'')}</p>${Number(o.discount_percent||0)>0?`<b>${Number(o.discount_percent)}% OFF</b><br>`:''}${o.coupon_code?`<b>Coupon: ${esc(o.coupon_code)}</b><br>`:''}<button class="gold" type="button" onclick="showOfferDetails(${Number(o.id)})">🎁 ${esc(o.button_text||'Shop Now')}</button></div>`).join('');
  openM(`<h2>🎁 Offers & Notifications</h2>${notes||'<p>No notifications yet.</p>'}${current?`<hr><h3>Current Offers</h3>${current}`:''}`);
 }catch(e){toast(e.message||'Could not load offers')}
}
async function markNotificationRead(id){try{await api(`/api/notifications/${id}/read`,{method:'PATCH'});offersPanel()}catch(e){toast(e.message)}}
async function showOfferDetails(offerId){
 try{
  const o=await api(`/api/offers/${Number(offerId)}`);
  const img=o.banner_url?`<img src="${esc(o.banner_url)}" style="width:100%;max-height:280px;object-fit:contain;border-radius:10px;margin-bottom:12px">`:'';
  const action=o.button_action||'offersPanel()';
  openM(`<div style="text-align:center">${img}<h2>🎁 ${esc(o.title)}</h2>${o.current_active?`<span class="status-pill">Active offer</span>`:`<span class="status-pill" style="background:#f1eeee;color:#765d65">Offer period ended / not active</span>`}<p>${esc(o.description||'')}</p>${Number(o.discount_percent||0)>0?`<div style="font-size:25px;font-weight:800;margin:12px 0">${Number(o.discount_percent)}% OFF</div>`:''}${o.coupon_code?`<p><b>Coupon: ${esc(o.coupon_code)}</b></p>`:''}<button class="gold" type="button" onclick="closeM();setTimeout(()=>{${action}},50)">${esc(o.button_text||'Shop Now')}</button></div>`);
 }catch(e){toast(e.message||'Could not open offer')}
}
async function openOfferFromNotification(offerId){return showOfferDetails(offerId)}
async function showOfferPopup(){try{const offers=await api('/api/offers/active');const o=offers.find(x=>Number(x.show_popup)===1);if(!o)return;const popupKey=`ashwiniOfferSession:${o.id}`;if(sessionStorage.getItem(popupKey)==='1')return;sessionStorage.setItem(popupKey,'1');openM(`<div style="text-align:center">${o.banner_url?`<img src="${esc(o.banner_url)}" style="width:100%;max-height:300px;object-fit:contain;border-radius:10px;margin-bottom:12px">`:''}<h2>🎉 ${esc(o.title)}</h2><p>${esc(o.description||'')}</p>${o.discount_percent?`<div style="font-size:24px;font-weight:bold;margin:10px 0">${Number(o.discount_percent)}% OFF</div>`:''}${o.coupon_code?`<p><b>Coupon: ${esc(o.coupon_code)}</b></p>`:''}<button class="gold" onclick="closeM();${o.button_action||'offersPanel()'}">${esc(o.button_text||'Shop Now')}</button></div>`)}catch{}}
async function shopCategoryMenu(){
 try{
  const box=document.getElementById('shopCategoryDropdown');
  if(!box)return;
  if(box.classList.contains('open')){box.classList.remove('open');box.setAttribute('aria-hidden','true');return;}
  const cats=await api('/api/categories');
  const rows=(cats||[]).map(c=>`<button class="shop-category-row" type="button" data-shop-category="${esc(String(c.name))}"><span>${esc(c.name)}</span><b>›</b></button>`).join('');
  box.innerHTML=rows||'<p style="padding:10px;margin:0">No categories available.</p>';
  box.classList.add('open');box.setAttribute('aria-hidden','false');
 }catch(e){alert(e.message||'Could not load categories')}
}
function selectShopCategory(name){
 const value=String(name||'').trim();
 if(!value)return;
 const box=document.getElementById('shopCategoryDropdown');
 if(box){box.classList.remove('open');box.setAttribute('aria-hidden','true');}
 cat(value);
}
document.addEventListener('click',e=>{
 const row=e.target.closest?.('.shop-category-row[data-shop-category]');
 if(!row)return;
 e.preventDefault();
 e.stopPropagation();
 selectShopCategory(row.getAttribute('data-shop-category')||'');
});
async function loadShopCategories(){try{const cats=await api('/api/categories');const box=document.getElementById('shopCategoryCards');if(box)box.innerHTML=cats.map(c=>`<button class="cat" type="button" onclick="cat('${String(c.name).replace(/'/g,"\\'")}')">${esc(c.icon||'👗')}<strong>${esc(c.name)}</strong></button>`).join('');return cats}catch(e){console.error(e);return []}}
async function adminCategories(){if(user?.role!=='admin')return alert('Admin only');try{const cats=await api('/api/admin/categories');const rows=cats.map(x=>`<tr><td>${esc(x.icon||'👗')}</td><td><b>${esc(x.name)}</b></td><td>${x.active?'Active':'Inactive'}</td><td>${x.sort_order}</td><td><button class="gold" type="button" onclick="categoryEditor(${x.id})">✎ Edit</button> <button class="admin-danger" type="button" onclick="deleteCategory(${x.id})">Delete</button></td></tr>`).join('')||'<tr><td colspan="5">No categories.</td></tr>';openM(`<h2>🏷️ Shop by Category Management</h2><div class="admin-toolbar"><button class="gold" type="button" onclick="categoryEditor()">＋ Add Category</button><button type="button" onclick="dashboard()">Back</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Icon</th><th>Category</th><th>Status</th><th>Order</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`)}catch(e){alert(e.message)}}
async function categoryEditor(id){let x={name:'',icon:'👗',active:1,sort_order:0};if(id)x=await api('/api/admin/categories').then(xs=>xs.find(a=>a.id===id)||x);openM(`<h2>🏷️ ${id?'Edit':'Add'} Shop by Category</h2><div class="admin-form"><label>Category Name<input id="cat_name" value="${esc(x.name||'')}" placeholder="Western Dress"></label><label>Icon / Emoji<input id="cat_icon" value="${esc(x.icon||'👗')}" placeholder="👗"></label><label>Display Order<input id="cat_order" type="number" min="0" value="${Number(x.sort_order||0)}"></label><label><input id="cat_active" type="checkbox" ${x.active?'checked':''}> Active</label></div><div class="admin-actions"><button class="gold" type="button" onclick="saveCategory(${id||0})">💾 Save Category</button><button type="button" onclick="adminCategories()">Cancel</button></div>`)}
async function saveCategory(id){try{const body={name:cat_name.value,icon:cat_icon.value||'👗',sort_order:Number(cat_order.value||0),active:cat_active.checked};await api(id?`/api/admin/categories/${id}`:'/api/admin/categories',{method:id?'PATCH':'POST',body});toast('✓ Category saved');await loadShopCategories();adminCategories()}catch(e){alert(e.message)}}
async function deleteCategory(id){if(!confirm('Remove this Shop by Category item? Existing products will not be deleted.'))return;try{await api(`/api/admin/categories/${id}`,{method:'DELETE'});toast('Category removed');await loadShopCategories();adminCategories()}catch(e){alert(e.message)}}
async function adminHighlights(){if(user?.role!=='admin')return alert('Admin only');try{const hs=await api('/api/admin/product-highlights');const rows=hs.map(x=>`<tr><td>${esc(x.sort_order)}</td><td><b>${esc(x.label)}</b></td><td>${esc(x.value)}</td><td>${x.active?'Active':'Inactive'}</td><td><button class="gold" type="button" onclick="highlightEditor(${x.id})">✎ Edit</button> <button class="admin-danger" type="button" onclick="deleteHighlight(${x.id})">Delete</button></td></tr>`).join('')||'<tr><td colspan="5">No highlights.</td></tr>';openM(`<h2>✨ Product Highlights Management</h2><div class="admin-note">These highlights appear on every product detail page. You can edit Fabric, Fit, Delivery, add new highlights, remove any highlight, and change the display order. Changes apply immediately to the product page.</div><div class="admin-toolbar"><button class="gold" type="button" onclick="highlightEditor()">＋ Add Highlight</button><button type="button" onclick="dashboard()">Back</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Label</th><th>Value</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`)}catch(e){alert(e.message)}}
async function highlightEditor(id){let x={label:'',value:'',active:1,sort_order:0};if(id)x=await api('/api/admin/product-highlights').then(xs=>xs.find(a=>a.id===id)||x);openM(`<h2>✨ ${id?'Edit':'Add'} Product Highlight</h2><div class="admin-form"><label>Label<input id="ph_label" value="${esc(x.label||'')}" placeholder="Fabric"></label><label>Value<input id="ph_value" value="${esc(x.value||'')}" placeholder="Premium Feel"></label><label>Display Order<input id="ph_order" type="number" min="0" value="${Number(x.sort_order||0)}"></label><label><input id="ph_active" type="checkbox" ${x.active?'checked':''}> Active</label></div><div class="admin-actions"><button class="gold" type="button" onclick="saveHighlight(${id||0})">💾 Save Highlight</button><button type="button" onclick="adminHighlights()">Cancel</button></div>`)}
async function saveHighlight(id){try{const body={label:ph_label.value.trim(),value:ph_value.value.trim(),sort_order:Number(ph_order.value||0),active:ph_active.checked};await api(id?`/api/admin/product-highlights/${id}`:'/api/admin/product-highlights',{method:id?'PATCH':'POST',body});toast('✓ Highlight saved');adminHighlights()}catch(e){alert(e.message)}}
async function deleteHighlight(id){if(!confirm('Remove this product highlight?'))return;try{await api(`/api/admin/product-highlights/${id}`,{method:'DELETE'});toast('Highlight removed');adminHighlights()}catch(e){alert(e.message)}}

async function adminOffers(){
 if(user?.role!=='admin')return alert('Admin only');
 try{const offers=await api('/api/admin/offers');const rows=offers.map(o=>`<tr><td><b>${esc(o.title)}</b><br><small>${esc(o.coupon_code||'No coupon')}</small></td><td>${Number(o.discount_percent||0)}%</td><td>${o.active?'Active':'Inactive'}</td><td>${o.show_popup?'Popup':'Hidden'}</td><td><button class="gold" onclick="offerEditor(${o.id})">✎ Edit</button> <button onclick="sendOffer(${o.id})">📢 Send</button> <button class="admin-danger" onclick="deleteOffer(${o.id})">Delete</button></td></tr>`).join('')||'<tr><td colspan="5">No offers yet.</td></tr>';openM(`<h2>🎁 Offer Management</h2><div class="admin-toolbar"><button class="gold" onclick="offerEditor()">＋ New Seasonal Offer</button><button onclick="dashboard()">Back</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Offer</th><th>Discount</th><th>Status</th><th>Popup</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`)}catch(e){alert(e.message)}
}
async function offerEditor(id){
 let o={title:'',description:'',coupon_code:'',discount_percent:0,banner_url:'',button_text:'Shop Now',button_action:'',start_at:'',end_at:'',active:1,show_popup:1};
 if(id)o=await api(`/api/admin/offers`).then(xs=>xs.find(x=>x.id===id)||o);
 openM(`<h2>🎉 ${id?'Edit':'Create'} Seasonal Offer</h2><div class="admin-form"><label>Offer Title<input id="of_title" value="${esc(o.title)}" placeholder="Ashwini Anniversary Big Sale"></label><label>Description<textarea id="of_desc" rows="3" placeholder="Up to 50% off on selected styles">${esc(o.description||'')}</textarea></label><label>Coupon Code<input id="of_coupon" value="${esc(o.coupon_code||'')}" placeholder="ASHWINI50"></label><label>Discount %<input id="of_disc" type="number" min="0" max="100" value="${Number(o.discount_percent||0)}"></label><label>Banner Image — Upload<input id="of_banner_file" type="file" accept="image/*" onchange="handleOfferBannerUpload(this)"><small>Choose a banner from your computer. You can also paste an image URL below.</small><div id="of_banner_preview" style="margin-top:8px"></div></label><label>Banner Image URL<input id="of_banner" value="${esc(o.banner_url||'')}" placeholder="/offer-banner.jpg or https://..."></label><label>Button Text<input id="of_btn" value="${esc(o.button_text||'Shop Now')}"></label><label>Where should this offer open?<select id="of_dest"><option value="offers" ${o.button_action==='offersPanel()'?'selected':''}>Sale / Offer Section</option><option value="all" ${o.button_action==="shopSlide('All')"?'selected':''}>All Products</option><option value="western" ${o.button_action==="shopSlide('Western Dress')"?'selected':''}>Western Dress</option><option value="party" ${o.button_action==="shopSlide('Party Wear')"?'selected':''}>Party Wear</option><option value="kurta" ${o.button_action==="shopSlide('Kurta Set')"?'selected':''}>Kurta Set</option><option value="lehenga" ${o.button_action==="shopSlide('Lehenga')"?'selected':''}>Lehenga</option><option value="coord" ${o.button_action==="shopSlide('Co-ord Set')"?'selected':''}>Co-ord Set</option><option value="shirt" ${o.button_action==="shopSlide('Shirt')"?'selected':''}>Shirt</option></select></label><input id="of_action" type="hidden" value="${esc(o.button_action||'')}"><label>Start date/time<input id="of_start" type="datetime-local" value="${esc((o.start_at||'').slice(0,16))}"></label><label>End date/time<input id="of_end" type="datetime-local" value="${esc((o.end_at||'').slice(0,16))}"></label><label><input id="of_active" type="checkbox" ${o.active?'checked':''}> Active</label><label><input id="of_popup" type="checkbox" ${o.show_popup?'checked':''}> Show popup</label></div><div class="admin-actions"><button class="gold" onclick="saveOffer(${id||0})">💾 Save Offer</button><button onclick="adminOffers()">Cancel</button></div>`);if(o.banner_url)renderOfferBannerPreview(o.banner_url)
}
function offerDestinationAction(v){return ({offers:'offersPanel()',all:"shopSlide('All')",western:"shopSlide('Western Dress')",party:"shopSlide('Party Wear')",kurta:"shopSlide('Kurta Set')",lehenga:"shopSlide('Lehenga')",coord:"shopSlide('Co-ord Set')",shirt:"shopSlide('Shirt')"})[v]||'offersPanel()'}
async function saveOffer(id){try{const action=offerDestinationAction(of_dest.value);const body={title:of_title.value,description:of_desc.value,coupon_code:of_coupon.value,discount_percent:Number(of_disc.value||0),banner_url:of_banner.value,button_text:of_btn.value,button_action:action,start_at:of_start.value,end_at:of_end.value,active:of_active.checked,show_popup:of_popup.checked};await api(id?`/api/admin/offers/${id}`:'/api/admin/offers',{method:id?'PATCH':'POST',body});toast('✓ Offer saved');adminOffers()}catch(e){alert(e.message)}}
async function deleteOffer(id){if(!confirm('Delete this offer?'))return;try{await api(`/api/admin/offers/${id}`,{method:'DELETE'});toast('Offer deleted');adminOffers()}catch(e){alert(e.message)}}
async function sendOffer(id){const audience=prompt('Send to: both / mobile / email','both');if(audience===null)return;const message=prompt('Offer message to customers:','New Ashwini Clothing offer is live!');if(message===null)return;try{const d=await api(`/api/admin/offers/${id}/send`,{method:'POST',body:{audience,message}});toast(`✓ Offer notification created for ${d.sent} customers`)}catch(e){alert(e.message)}}
async function loadSlides(){
 try{
  const slides=await api('/api/slides');
  const track=document.getElementById('adTrack'),dots=document.getElementById('adDots');
  if(!track||!dots)return;
  if(!slides.length){track.innerHTML='';dots.innerHTML='';return}
  track.innerHTML=slides.map((x,i)=>{
   const src=esc(x.image_url||'');
   return `<div class="ad-slide ${i===0?'active':''}" data-slide-id="${Number(x.id)||0}">
    <div class="ad-copy-panel">${x.title?`<div class="ad-kicker">ASHWINI CLOTHING</div><h2>${esc(x.title)}</h2>`:''}${x.offer_text?`<div class="ad-offer-text">${esc(x.offer_text)}</div>`:''}${x.button_text?`<button class="ad-cta" type="button" onclick="${esc(x.button_action||'')}">${esc(x.button_text)}</button>`:''}</div>
    <div class="ad-image-panel"><img src="${src}" loading="eager" decoding="async" alt="${esc(x.title||'Ashwini offer')}" onerror="this.style.visibility='hidden'"></div>
   </div>`
  }).join('');
  dots.innerHTML=slides.map((x,i)=>`<button class="ad-dot ${i===0?'active':''}" onclick="showAd(${i})" aria-label="Show promotion ${i+1}"></button>`).join('');
  adIndex=0;showAd(0);resetAdTimer();
 }catch(e){console.error('Slides load failed',e)}
}

async function adminSlides(){if(user?.role!=='admin')return alert('Admin only');try{const slides=await api('/api/admin/slides');const rows=slides.map(x=>`<tr><td>${x.sort_order+1}</td><td>${x.image_url?`<img src="${esc(x.image_url)}" style="width:130px;height:52px;object-fit:cover;border-radius:6px">`:''}</td><td><b>${esc(x.title||'Slide')}</b><br><small>${esc(x.offer_text||'')}</small><br><small>${esc(x.button_text||'')}</small></td><td>${x.active?'Active':'Inactive'}</td><td><button class="gold" onclick="slideEditor(${x.id})">✎ Edit</button> <button class="admin-danger" onclick="deleteSlide(${x.id})">Delete</button></td></tr>`).join('')||'<tr><td colspan="5">No slides.</td></tr>';openM(`<h2>🖼️ Homepage Slide Management</h2><div class="admin-toolbar"><button class="gold" onclick="slideEditor()">＋ Add Slide</button><button onclick="adminOffers()">Back to Offers</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Preview</th><th>Slide</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`)}catch(e){alert(e.message)}}
async function slideEditor(id){let x={title:'',offer_text:'',image_url:'',button_text:'Shop Now',button_action:'',active:1,sort_order:0};if(id)x=await api('/api/admin/slides').then(xs=>xs.find(a=>a.id===id)||x);openM(`<h2>🖼️ ${id?'Edit':'Add'} Homepage Slide</h2><div class="admin-form"><label>Slide Title<input id="sl_title" value="${esc(x.title||'')}" placeholder="Ashwini Anniversary Sale"></label><label>Offer Text<input id="sl_offer" value="${esc(x.offer_text||'')}" placeholder="Up to 50% OFF"></label><label>Slide Image — Upload<input id="sl_img_file" type="file" accept="image/*" onchange="handleSlideImageUpload(this)"><small>Choose a slide image from your computer. You can also paste an image URL below.</small><div id="sl_img_preview" style="margin-top:8px"></div></label><label>Slide Image URL<input id="sl_img" value="${esc(x.image_url||'')}" placeholder="/ad1-clean.jpg or https://..."></label><label>Button Text<input id="sl_btn" value="${esc(x.button_text||'')}" placeholder="Shop Now"></label><label>Where should this slide open?<select id="sl_dest"><option value="offers" ${x.button_action==='offersPanel()'?'selected':''}>Sale / Offer Section</option><option value="all" ${x.button_action==="shopSlide('All')"?'selected':''}>All Products</option><option value="western" ${x.button_action==="shopSlide('Western Dress')"?'selected':''}>Western Dress</option><option value="party" ${x.button_action==="shopSlide('Party Wear')"?'selected':''}>Party Wear</option><option value="kurta" ${x.button_action==="shopSlide('Kurta Set')"?'selected':''}>Kurta Set</option><option value="lehenga" ${x.button_action==="shopSlide('Lehenga')"?'selected':''}>Lehenga</option><option value="coord" ${x.button_action==="shopSlide('Co-ord Set')"?'selected':''}>Co-ord Set</option><option value="shirt" ${x.button_action==="shopSlide('Shirt')"?'selected':''}>Shirt</option></select></label><input id="sl_action" type="hidden" value="${esc(x.button_action||'')}"><label>Display Order<input id="sl_order" type="number" min="0" value="${Number(x.sort_order||0)}"></label><label><input id="sl_active" type="checkbox" ${x.active?'checked':''}> Active</label></div><div class="admin-actions"><button class="gold" onclick="saveSlide(${id||0})">💾 Save Slide</button><button onclick="adminSlides()">Cancel</button></div>`);if(x.image_url)renderSlideImagePreview(x.image_url)}
function slideDestinationAction(v){return ({offers:'offersPanel()',all:"shopSlide('All')",western:"shopSlide('Western Dress')",party:"shopSlide('Party Wear')",kurta:"shopSlide('Kurta Set')",lehenga:"shopSlide('Lehenga')",coord:"shopSlide('Co-ord Set')",shirt:"shopSlide('Shirt')"})[v]||'offersPanel()'}
async function saveSlide(id){try{const action=slideDestinationAction(sl_dest.value);const body={title:sl_title.value,offer_text:sl_offer.value,image_url:sl_img.value,button_text:sl_btn.value,button_action:action,sort_order:Number(sl_order.value||0),active:sl_active.checked};await api(id?`/api/admin/slides/${id}`:'/api/admin/slides',{method:id?'PATCH':'POST',body});toast('✓ Slide saved');await loadSlides();adminSlides()}catch(e){alert(e.message)}}
async function deleteSlide(id){if(!confirm('Delete this slide?'))return;try{await api(`/api/admin/slides/${id}`,{method:'DELETE'});toast('Slide deleted');await loadSlides();adminSlides()}catch(e){alert(e.message)}}

function home(){category='All';document.getElementById('q').value='';document.getElementById('searchCat').value='All';load();scrollTo({top:0,behavior:'smooth'})}
async function adminStat(type){
 if(user?.role!=='admin')return alert('Admin only');
 try{
  if(type==='products'){
   const p=await api('/api/products');
   const rows=p.map(x=>`<tr><td><b>${esc(x.name)}</b><br><small>${esc(x.category)}</small></td><td>₹${Number(x.price).toLocaleString('en-IN')}</td><td>${x.stock}</td><td><button class="gold" type="button" onclick="productEditor(${x.id})">✎ Edit</button></td></tr>`).join('')||'<tr><td colspan="4">No products.</td></tr>';
   openM(`<h2>📦 Products (${p.length})</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  } else if(type==='orders' || type==='revenue' || type==='customers'){
   const o=await api('/api/admin/orders');
   if(type==='customers'){
    const map=new Map(); o.forEach(x=>{const key=x.user_id||x.email||x.name||('order-'+x.id); if(!map.has(key))map.set(key,x)});
    const rows=[...map.values()].map(x=>`<tr><td><b>${esc(x.name||'Customer')}</b></td><td>${esc(x.email||'')}</td><td>${esc(x.phone||'—')}</td><td>Order #${x.id}</td></tr>`).join('')||'<tr><td colspan="4">No customers yet.</td></tr>';
    openM(`<h2>👤 Customers (${map.size})</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Latest Order</th></tr></thead><tbody>${rows}</tbody></table></div>`);
   } else {
    const list=type==='revenue'?o.filter(x=>x.payment_status==='PAID'):o;
    const total=list.reduce((a,x)=>a+Number(x.total||0),0);
    const rows=list.map(x=>`<tr><td>#${x.id}<br><small>Ordered: ${new Date(x.created_at||'').toLocaleString('en-IN')}</small>${x.status==='DELIVERED'&&x.updated_at?`<br><small>Delivered: ${new Date(x.updated_at).toLocaleString('en-IN')}</small>`:''}</td><td>${esc(x.name||'Customer')}</td><td>₹${Number(x.total).toLocaleString('en-IN')}</td><td>${esc(x.payment_status||'')}</td><td>${esc(x.status||'')}</td></tr>`).join('')||'<tr><td colspan="5">No orders yet.</td></tr>';
    openM(`<h2>${type==='revenue'?'💰 Revenue':'📦 Orders'} ${type==='revenue'?`— ₹${total.toLocaleString('en-IN')}`:`(${list.length})`}</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Payment</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`);
   }
  }
 }catch(e){alert(e.message)}
}
function shopSlide(c){cat(c);document.getElementById('products')?.scrollIntoView({behavior:'smooth',block:'start'})}
function showAd(n){const slides=document.querySelectorAll('.ad-slide'),dots=document.querySelectorAll('.ad-dot');if(!slides.length)return;adIndex=(n+slides.length)%slides.length;slides.forEach((x,i)=>x.classList.toggle('active',i===adIndex));dots.forEach((x,i)=>x.classList.toggle('active',i===adIndex))}
function moveAd(n){showAd(adIndex+n);resetAdTimer()}
function resetAdTimer(){clearInterval(adTimer);if(!adPaused)adTimer=setInterval(()=>showAd(adIndex+1),5000)}
function toggleAd(){adPaused=!adPaused;resetAdTimer();const b=document.getElementById('adPause');if(b)b.textContent=adPaused?'▶':'⏸'}

window.updateHelpUnreadBadge=updateHelpUnreadBadge;window.showRegisterPanel=showRegisterPanel;window.whatsappHelp=whatsappHelp;window.sendHelpChatMessage=sendHelpChatMessage;window.adminHelpChat=adminHelpChat;window.sendAdminHelpReply=sendAdminHelpReply;window.updateAdminHelpChat=updateAdminHelpChat;window.showAdminLoginPanel=showAdminLoginPanel;window.adminPasswordLogin=adminPasswordLogin;window.chooseOtpChannel=chooseOtpChannel;window.showLoginMode=showLoginMode;window.sendLoginOtp=sendLoginOtp;window.verifyLoginOtp=verifyLoginOtp;window.sendRecoveryOtp=sendRecoveryOtp;window.forgotLoginIdFlow=forgotLoginIdFlow;window.verifyForgotLoginId=verifyForgotLoginId;window.forgotPasswordFlow=forgotPasswordFlow;window.resetPasswordFlow=resetPasswordFlow;window.openDelivery=openDelivery;window.saveDeliveryLocation=saveDeliveryLocation;window.lookupAddressPin=lookupAddressPin;window.addressPinChanged=addressPinChanged;window.add=add;window.pick=pick;window.detail=detail;window.setGalleryImage=setGalleryImage;window.zoomImage=zoomImage;window.resetZoom=resetZoom;window.sizeChart=sizeChart;window.addSizeChartRow=addSizeChartRow;window.buyNow=buyNow;window.addFromDetail=addFromDetail;window.wish=wish;window.addWishlist=addWishlist;window.addWishlistToCart=addWishlistToCart;window.removeWishlist=removeWishlist;window.renderWishlistOnly=renderWishlistOnly;window.askQuestion=askQuestion;window.pickReviewStar=pickReviewStar;window.submitReview=submitReview;window.answerQuestion=answerQuestion;window.adminAnswerQuestion=adminAnswerQuestion;window.checkDelivery=checkDelivery;window.cartView=cartView;window.changeQty=changeQty;window.removeCart=removeCart;window.checkout=checkout;window.applyCoupon=applyCoupon;window.pay=pay;window.auth=auth;window.accountMenu=accountMenu;window.closeAccountMenu=closeAccountMenu;window.buyAgain=buyAgain;window.buyAgainOne=buyAgainOne;window.manageProfile=manageProfile;window.loginSecurity=loginSecurity;window.securityEditProfile=securityEditProfile;window.securityEditContact=securityEditContact;window.securityRequestContact=securityRequestContact;window.securityConfirmContact=securityConfirmContact;window.securityChangePassword=securityChangePassword;window.securitySavePassword=securitySavePassword;window.securitySaveName=securitySaveName;window.securityTwoStep=securityTwoStep;window.securitySaveTwoStep=securitySaveTwoStep;window.saveProfile=saveProfile;window.confirmProfileChange=confirmProfileChange;window.returnsPanel=returnsPanel;window.requestReturn=requestReturn;window.toggleReturnForm=toggleReturnForm;window.syncReturnOption=syncReturnOption;window.submitReturn=submitReturn;window.cancelReturn=cancelReturn;window.saveReturnAdmin=saveReturnAdmin;window.customerHelp=customerHelp;window.setupAdmin=setupAdmin;window.login=login;window.register=register;window.logout=logout;window.orders=orders;window.track=track;window.orderDetails=orderDetails;window.editProduct=editProduct;window.productEditor=productEditor;window.saveProduct=saveProduct;window.deleteProduct=deleteProduct;window.updateOrderStatus=updateOrderStatus;window.updateHelpStatus=updateHelpStatus;window.dashboard=dashboard;window.adminStoreProfile=adminStoreProfile;window.adminWhatsAppHelp=adminWhatsAppHelp;window.adminHelpInbox=adminHelpInbox;window.adminCodControl=adminCodControl;window.setCodGlobalUi=setCodGlobalUi;window.saveCodSettings=saveCodSettings;window.saveAdminWhatsAppHelp=saveAdminWhatsAppHelp;window.previewStoreLogo=previewStoreLogo;window.loadSiteLogo=loadSiteLogo;window.cat=cat;window.load=load;window.home=home;window.shopSlide=shopSlide;window.selectShopCategory=selectShopCategory;window.adminStat=adminStat;window.offersPanel=offersPanel;window.markNotificationRead=markNotificationRead;window.showOfferPopup=showOfferPopup;window.adminOffers=adminOffers;window.adminReturns=adminReturns;window.updateReturnStatus=updateReturnStatus;window.adminSlides=adminSlides;window.adminCategories=adminCategories;window.adminHighlights=adminHighlights;window.highlightEditor=highlightEditor;window.saveHighlight=saveHighlight;window.deleteHighlight=deleteHighlight;window.categoryEditor=categoryEditor;window.saveCategory=saveCategory;window.deleteCategory=deleteCategory;window.loadShopCategories=loadShopCategories;window.slideEditor=slideEditor;window.handleOfferBannerUpload=handleOfferBannerUpload;window.handleSlideImageUpload=handleSlideImageUpload;window.saveSlide=saveSlide;window.deleteSlide=deleteSlide;window.offerEditor=offerEditor;window.saveOffer=saveOffer;window.deleteOffer=deleteOffer;window.sendOffer=sendOffer;window.loadSlides=loadSlides;window.showAd=showAd;window.moveAd=moveAd;window.toggleAd=toggleAd;window.closeM=closeM;window.openReturnMore=openReturnMore;window.toggleBlock=toggleBlock;window.stop=stop;

document.addEventListener('DOMContentLoaded',()=>{
 const searchCat=document.getElementById('searchCat');
 const searchInput=document.getElementById('q');
 const searchBtn=document.querySelector('.search button');
 searchCat?.addEventListener('change',e=>{e.stopPropagation();cat(e.target.value)});
 searchBtn?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();load();document.getElementById('products')?.scrollIntoView({behavior:'smooth',block:'start'});});
 searchInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();load();document.getElementById('products')?.scrollIntoView({behavior:'smooth',block:'start'})}});
 searchInput?.addEventListener('input',()=>{clearTimeout(window.__searchTimer);window.__searchTimer=setTimeout(load,250)});
 document.addEventListener('click',e=>{if(!e.target.closest('.shop-category-section')){const b=document.getElementById('shopCategoryDropdown');if(b){b.classList.remove('open');b.setAttribute('aria-hidden','true')}}});
document.querySelector('.nav')?.addEventListener('click',e=>{const el=e.target.closest('[data-category]');if(el){e.preventDefault();e.stopPropagation();cat(el.dataset.category)}});
 document.getElementById('modalClose')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeM()});
 document.getElementById('modal')?.addEventListener('click',e=>{if(e.target.id==='modal')closeM()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeM()});
 const admin=document.getElementById('admin');if(admin&&user?.role==='admin')admin.style.display='inline';
 restoreSession().finally(()=>{save();loadSiteLogo();load();loadSlides();loadShopCategories();updateHelpUnreadBadge();if(window.__helpUnreadTimer)clearInterval(window.__helpUnreadTimer);window.__helpUnreadTimer=setInterval(updateHelpUnreadBadge,2500);setTimeout(showOfferPopup,1200);});
});
