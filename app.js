let token=localStorage.getItem('ashwiniToken')||'';
let user=JSON.parse(localStorage.getItem('ashwiniUser')||'null');
let cart=JSON.parse(localStorage.getItem('ashwiniCart')||'[]');
let wishlist=JSON.parse(localStorage.getItem('ashwiniWishlist')||'[]');
let category='All', sizes={}, adIndex=0, adTimer, adPaused=false, checkoutItems=null;
const stages=['PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED'];

async function api(url,opts={}){
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
  if(out) out.innerHTML=`<b>${esc(d.area)}</b>, ${esc(d.city||d.district)} , ${esc(d.state)}<br><small>PIN ${esc(d.pin)}</small>`;
 }catch(e){if(out)out.textContent=e.message||'PIN code location not found.';}
}
function addressPinChanged(){
 const pin=(document.getElementById('pin')?.value||'').trim();
 if(pin.length===6) lookupAddressPin(pin);
}

function cat(c){category=(c||'All').trim();const s=document.getElementById('searchCat');if(s)s.value=category;document.querySelectorAll('input[name="c"]').forEach(r=>r.checked=(r.value||'')===category);load();document.getElementById('products')?.scrollIntoView({behavior:'smooth',block:'start'})}

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
 <span class="badge">Ashwini Choice</span><div class="pic">${img}</div>
 <h3>${esc(p.name)}</h3><div class="stars">${p.rating>0?'★★★★★ '+p.rating:'New product'}</div>
 <div class="price">₹${Number(p.price||0).toLocaleString('en-IN')} <span class="mrp">₹${Number(p.mrp||0).toLocaleString('en-IN')}</span></div>
 <div class="deal">Limited-time deal</div><small>FREE delivery · ${Number(p.stock||0)} in stock</small>
 <div class="sizebox" id="sizes-card-${p.id}">${sizesList.map(s=>`<button class="size" type="button" onclick="stop(event);pick(${p.id},'${esc(s)}',this)">${esc(s)}</button>`).join('')}</div>
 <button class="add" type="button" onclick="stop(event);add(${p.id},this)">Add to Cart</button>
 <button class="add" type="button" style="margin-top:7px;background:#fff;border-color:#caa6ae" onclick="stop(event);detail(${p.id})">View Details</button>
 </article>`;
}
function pick(id,s,b){const box=b?.parentElement;if(sizes[id]===s){sizes[id]='';b?.classList.remove('sel');return}sizes[id]=s;if(box)box.querySelectorAll('.size').forEach(x=>x.classList.remove('sel'));b?.classList.add('sel')}
function flash(btn,text='✓ Added to Cart'){if(!btn)return;const old=btn.textContent;btn.textContent=text;btn.classList.add('added');setTimeout(()=>{if(btn.isConnected){btn.textContent=old;btn.classList.remove('added')}},1400)}
function add(id,btn){let chosen=sizes[id];if(!chosen){toast('Please select a size');return false}let x=cart.find(a=>a.id===id&&a.size===chosen);if(x)x.quantity++;else cart.push({id,quantity:1,size:chosen});save();flash(btn);toast(`✓ Added to Cart · Size ${chosen}`);return true}
function save(){localStorage.setItem('ashwiniCart',JSON.stringify(cart));const c=document.getElementById('count');if(c)c.textContent=cart.reduce((s,x)=>s+x.quantity,0)}
function openM(html){const m=document.getElementById('modal'),b=document.getElementById('body');if(!m||!b)return;b.innerHTML=html;m.style.display='flex';m.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';document.getElementById('modalClose')?.focus()}
function closeM(){const m=document.getElementById('modal');if(!m)return;m.style.display='none';m.setAttribute('aria-hidden','true');document.body.style.overflow=''}

const galleryFallback={1:['/_model_western.jpg'],2:['/dark-pink-lace-maxi-new.jpg','/dark-pink-lace-maxi.jpg'],3:['/_model_purple.jpg'],4:['/_model_purple.jpg'],5:['/_model_blue.jpg'],6:['/_model_blue.jpg'],7:['/_model_purple.jpg'],8:['/_model_western.jpg'],9:['/_model_blue.jpg'],10:['/_model_pink.jpg'],11:['/_model_western.jpg'],12:['/_model_purple.jpg'],13:['/_model_pink.jpg'],14:['/_model_purple.jpg'],100:['/dark-pink-lace-maxi-new.jpg','/dark-pink-lace-maxi.jpg']};
function getGallery(p){let a=[];try{a=JSON.parse(p.gallery||'[]')}catch{}if(!Array.isArray(a)||!a.length)a=galleryFallback[p.id]||[];if(p.image&&!a.includes(p.image))a.unshift(p.image);return [...new Set(a)].filter(Boolean).slice(0,5)}
function setGalleryImage(id,src,btn){const img=document.getElementById(`gallery-main-${id}`);if(img)img.src=src;btn?.parentElement?.querySelectorAll('.gallery-thumb').forEach(x=>x.classList.remove('active'));btn?.classList.add('active')}

async function detail(id){
 const ps=await api('/api/products');const p=ps.find(x=>x.id===id);if(!p)return;
 const gallery=getGallery(p), liked=wishlist.includes(id);
 let history=p.product_history||p.history||'Product details / history can be added here later.';
 let care=p.care_instructions||'Wash as per garment label. Use mild detergent, avoid harsh bleach and dry in shade.';
 openM(`<div class="detail">
  <div><div class="gallery"><div class="gallery-thumbs">${gallery.map((src,i)=>`<button type="button" class="gallery-thumb ${i===0?'active':''}" onclick="stop(event);setGalleryImage(${p.id},'${esc(src)}',this)"><img src="${esc(src)}" alt="${esc(p.name)} view ${i+1}"></button>`).join('')}</div><div><div class="gallery-main"><img id="gallery-main-${p.id}" src="${esc(gallery[0]||p.image||'')}" alt="${esc(p.name)}"></div><div class="gallery-count">${gallery.length} photo${gallery.length===1?'':'s'} · maximum 5 views</div></div></div></div>
  <div><h1>${esc(p.name)}</h1><div class="stars">${p.rating>0?'★★★★★ '+p.rating+' customer rating':'New product'}</div><p style="font-size:27px;font-weight:bold">₹${Number(p.price||0).toLocaleString('en-IN')} <span class="mrp">₹${Number(p.mrp||0).toLocaleString('en-IN')}</span></p><p>Inclusive of all taxes</p><hr>
  <p><b>Colour:</b> ${esc(p.color)}</p><p><b>Size:</b></p><div class="sizebox" id="sizes-detail-${p.id}">${(p.size_options||'S,M,L,XL').split(',').map(s=>`<button class="size" type="button" onclick="stop(event);pick(${p.id},'${esc(s.trim())}',this)">${esc(s.trim())}</button>`).join('')}</div>
  <p><button class="size-chart-link" type="button" onclick="stop(event);sizeChart(${p.id})">📏 View Size Chart</button></p>
  <p>${esc(p.description||'Premium clothing designed for comfort and everyday style.')}</p>
  <div class="stats" style="grid-template-columns:repeat(3,1fr);margin:15px 0"><div class="stat"><small>Fabric</small><b style="font-size:16px">Premium Feel</b></div><div class="stat"><small>Fit</small><b style="font-size:16px">Comfort Fit</b></div><div class="stat"><small>Delivery</small><b style="font-size:16px">Fast Dispatch</b></div></div>
  <p><b>${Number(p.stock||0)} left in stock.</b> Ships from Ashwini Clothing.</p>
  <div class="delivery-box"><b>📍 Check delivery</b><div class="pin-row"><input id="pin-${p.id}" maxlength="6" inputmode="numeric" placeholder="Enter PIN code"><button class="wishlist" type="button" onclick="stop(event);checkDelivery(${p.id})">Check</button></div><div id="delivery-${p.id}" class="delivery-result">Free delivery available after PIN check.</div></div>
  <div class="buy"><button class="buy-now" type="button" onclick="stop(event);buyNow(${p.id},this)">Buy Now</button><button class="gold" type="button" onclick="stop(event);addFromDetail(${p.id},this)">Add to Cart</button><button class="wishlist" type="button" onclick="stop(event);wish(${p.id})">${liked?'♥':'♡'} Wishlist</button></div>
  <div class="product-info"><h3>Product Details / History</h3><div class="product-history">${esc(history)}</div>${user?.role==='admin'?`<button class="wishlist" type="button" style="margin-top:10px" onclick="stop(event);editProduct(${p.id})">✎ Edit Product</button>`:''}<h3 style="margin-top:18px">Care Instructions</h3><div class="product-history">${esc(care)}</div></div>
  ${policySections()}${securitySection()}${qaSection(p.id)}
  <div class="reviews"><h3>Customer Reviews</h3><div class="review">★★★★★ <b>Great fit</b><br>Comfortable fabric and premium finish.</div><div class="review">★★★★★ <b>Worth it</b><br>Looks exactly like the photos.</div></div>
  </div></div>`);
}
function policySections(){return `<div class="policy-block"><button class="policy-head" type="button" onclick="toggleBlock('return-policy')">↩️ 4 Days Return & Replace Policy <span>+</span></button><div id="return-policy" class="policy-body"><table class="table"><tr><th>Return Reason</th><th>Return Period</th><th>Return Policy</th></tr><tr><td>Size too small,<br>Size too large</td><td>4 days from delivery</td><td>Exchange with a different size or colour</td></tr><tr><td>Any other reason</td><td>4 days from delivery</td><td>Replace only<br><button class="size-chart-link" type="button" onclick="openReturnMore()">Know More</button></td></tr></table><h4>Return Instructions</h4><p>Keep the item in its original condition and packaging along with MRP tag and accessories for a successful pick-up.</p></div></div>`}
function securitySection(){return `<div class="policy-block"><button class="policy-head" type="button" onclick="toggleBlock('secure-info')">🔐 Your transaction is secure <span>+</span></button><div id="secure-info" class="policy-body">We work hard to protect your security and privacy. Our payment security system encrypts your information during transmission. We don’t share your credit card details with third-party sellers, and we don’t sell your information to others.</div></div>`}
function toggleBlock(id){const x=document.getElementById(id);if(x)x.classList.toggle('open')}
function openReturnMore(){openM(`<div style="max-width:620px"><h2>Return & Replacement</h2><p>Returns/exchanges must be requested within 4 days from delivery. Keep the product unused, with original packaging, MRP tag and accessories. Size-related requests can be exchanged for another available size or colour; other eligible reasons are replacement only.</p><h3>Return Instructions</h3><p>Keep the item in its original condition and packaging along with MRP tag and accessories for a successful pick-up.</p></div>`)}

function sizeChart(id){api('/api/products').then(ps=>{const p=ps.find(x=>x.id===id);if(!p)return;let data={};try{data=JSON.parse(p.size_chart||'[]')}catch{}if(Array.isArray(data))data=Object.fromEntries(data.map(x=>[x.size,[x.bust,x.waist,x.hip]]));const defaults={S:[34,28,36],M:[36,30,38],L:[38,32,40],XL:[40,34,42],XXL:[42,36,44]};const ss=(p.size_options||'S,M,L,XL').split(',').map(x=>x.trim());openM(`<div style="max-width:560px"><h2>📏 Size Chart</h2><table class="size-chart-table"><tr><th>Size</th><th>Bust / Chest</th><th>Waist</th><th>Hip</th></tr>${ss.map(s=>{const r=data[s]||defaults[s]||['—','—','—'];return `<tr><td><b>${esc(s)}</b></td><td>${r[0]??'—'}</td><td>${r[1]??'—'}</td><td>${r[2]??'—'}</td></tr>`}).join('')}</table><p class="size-chart-note">Measurements in inches. Compare with a garment that fits you well.</p></div>`)}).catch(e=>toast(e.message))}
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
function qaData(id){return JSON.parse(localStorage.getItem('ashwiniQA_'+id)||'[]')}
function qaSection(id){const q=qaData(id);return `<div class="qa"><h3>Customer Questions & Answers</h3><div class="form"><input id="question-${id}" placeholder="Ask a question about this product"><button class="gold" type="button" onclick="askQuestion(${id})">Ask Question</button></div><div id="qa-list-${id}">${q.length?q.map(x=>`<div class="review"><b>Q:</b> ${esc(x.q)}${x.a?`<br><b>A:</b> ${esc(x.a)}`:'<br><small>Answer will appear here.</small>'}</div>`).join(''):'<p>No questions yet. Be the first to ask.</p>'}</div></div>`}
function askQuestion(id){const input=document.getElementById(`question-${id}`);const q=(input?.value||'').trim();if(!q){toast('Please write a question');return}const arr=qaData(id);arr.push({q,a:''});localStorage.setItem('ashwiniQA_'+id,JSON.stringify(arr));toast('Question added');detail(id)}

function checkDelivery(id){const pin=(document.getElementById(`pin-${id}`)?.value||'').trim();const out=document.getElementById(`delivery-${id}`);if(!/^\d{6}$/.test(pin)){if(out)out.textContent='Please enter a valid 6-digit PIN code.';return}const first=Number(pin.slice(-1));const days=first%3+3;const d=new Date();d.setDate(d.getDate()+days);if(out)out.innerHTML=`<b>Free delivery</b> · Expected by ${d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})} · PIN ${pin}`}

function cartView(){api('/api/products').then(ps=>{let total=0;const rows=cart.map((x,i)=>{const p=ps.find(z=>z.id===x.id);if(!p)return '';total+=p.price*x.quantity;return `<div class="cartrow"><div class="mini">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}">`:p.emoji}</div><div><h3>${esc(p.name)}</h3><p>Size: <b>${esc(x.size)}</b></p><div class="cart-actions"><div class="qty"><button type="button" onclick="changeQty(${i},-1)">−</button><span>${x.quantity}</span><button type="button" onclick="changeQty(${i},1)">+</button></div><button type="button" onclick="removeCart(${i})">Remove</button><button type="button" class="wishlist" onclick="addWishlist(${p.id},${i})">♡ Move to Wishlist</button></div></div><b>₹${(p.price*x.quantity).toLocaleString('en-IN')}</b></div>`}).join('');openM(`<h2>Shopping Cart (${cart.reduce((s,x)=>s+x.quantity,0)})</h2>${cart.length?rows:'<div class="empty-wish">Your cart is empty.</div>'}<div class="total">Subtotal: ₹${total.toLocaleString('en-IN')}</div>${cart.length?`<button class="gold" style="width:100%;font-size:17px" onclick="checkout()">Proceed to Secure Checkout →</button>`:''}<div class="wishlist-section"><h3>♥ Wishlist (${wishlist.length})</h3>${wishlist.length?wishlist.map(id=>{const p=ps.find(z=>z.id===id);return p?`<div class="wish-card"><div class="mini">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}">`:p.emoji}</div><div><h4>${esc(p.name)}</h4><div class="wish-price">₹${Number(p.price).toLocaleString('en-IN')}</div></div><button class="gold" type="button" onclick="addWishlistToCart(${p.id})">Add to Cart</button><button class="remove-wish" type="button" onclick="removeWishlist(${p.id})">Remove</button></div>`:''}).join(''):'<div class="empty-wish">Your wishlist is empty.</div>'}</div>`)}).catch(e=>toast(e.message))}
function changeQty(i,n){cart[i].quantity=Math.max(1,cart[i].quantity+n);save();cartView()}
function removeCart(i){cart.splice(i,1);save();cartView()}

async function checkout(itemsOverride=null){checkoutItems=itemsOverride||checkoutItems;const items=activeCheckoutItems();if(!items.length){toast('Your cart is empty');return}if(!user){const pending=checkoutItems;closeM();auth();checkoutItems=pending;return}const ps=await api('/api/products');let subtotal=items.reduce((s,x)=>{const p=ps.find(z=>z.id===x.id);return s+(p?p.price*x.quantity:0)},0);openM(`<h2>Secure Checkout</h2><div class="coupon-box"><b>New buyer?</b> Use coupon <b>NEW2026</b> for 30% off (subject to eligibility). <div class="pin-row"><input id="coupon" placeholder="Coupon code"><button class="wishlist" type="button" onclick="applyCoupon(${subtotal})">Apply</button></div><div id="couponMsg"></div></div><div class="checkout-grid"><div class="checkout-card"><h3>1. Delivery Address</h3><div class="form"><input id="fullName" value="${esc(user.name||'')}" placeholder="Full Name"><input id="mobile" value="${esc(user.phone||'')}" placeholder="Mobile Number" inputmode="numeric" maxlength="10"><input id="pin" maxlength="6" inputmode="numeric" placeholder="PIN Code" oninput="addressPinChanged()"><div id="addressPinResult" class="delivery-result" style="grid-column:1/-1;margin-top:-6px">Enter PIN to auto-fill area, city and state.</div><input id="city" placeholder="City"><input id="state" placeholder="State"><textarea id="address" rows="4" placeholder="House / Flat / Street / Landmark"></textarea></div><h3>2. Payment Method</h3><select id="payment"><option value="RAZORPAY">Razorpay — UPI / Card / Netbanking</option><option value="COD">Cash on Delivery</option></select><button class="gold" style="width:100%;margin-top:18px" onclick="pay()">Place Order →</button></div><div class="checkout-card"><h3>Order Summary</h3>${items.map(x=>{const p=ps.find(z=>z.id===x.id);return p?`<div class="summary-row"><span>${esc(p.name)} × ${x.quantity}</span><b>₹${(p.price*x.quantity).toLocaleString('en-IN')}</b></div>`:''}).join('')}<hr><div id="checkoutTotal" class="total" style="font-size:20px">Total: ₹${subtotal.toLocaleString('en-IN')}</div><p>🔒 Secure transaction</p><p>🚚 Free delivery after PIN check</p><p>↩️ 4 days return / replace</p></div></div>`)}
function applyCoupon(subtotal){const c=(document.getElementById('coupon')?.value||'').trim().toUpperCase(),msg=document.getElementById('couponMsg');if(c==='NEW2026'){const disc=Math.round(subtotal*.30);localStorage.setItem('ashwiniCoupon','NEW2026');msg.innerHTML=`<b>✓ 30% discount applied:</b> ₹${disc.toLocaleString('en-IN')}`;const t=document.getElementById('checkoutTotal');if(t)t.textContent=`Total: ₹${(subtotal-disc).toLocaleString('en-IN')}`}else msg.textContent='Coupon not recognised.'}
async function pay(){try{const items=activeCheckoutItems();const full=(document.getElementById('fullName').value||user.name||'').trim(),mobile=document.getElementById('mobile').value.trim(),address=document.getElementById('address').value.trim(),city=document.getElementById('city').value.trim(),state=document.getElementById('state').value.trim(),pin=document.getElementById('pin').value.trim();if(!mobile||!address||!city||!state||!/^\d{6}$/.test(pin))throw Error('Please fill all delivery details with a valid 6-digit PIN');let d=await api('/api/checkout/create',{method:'POST',body:{items,mobile,address:[full,mobile,address,city,state,pin].filter(Boolean).join(', '),payment_method:document.getElementById('payment').value,coupon:(document.getElementById('coupon')?.value||'').trim().toUpperCase()}});if(d.mode==='COD'){if(!d.orderId)throw Error('Order was not created correctly.');if(!checkoutItems)cart=[];save();checkoutItems=null;await orderDetails(d.orderId);toast(`✓ Order #${d.orderId} placed successfully`);return}if(!window.Razorpay)throw Error('Payment gateway is not loaded. COD is available.');const r=new Razorpay({key:d.keyId,amount:d.total*100,currency:'INR',name:'Ashwini Clothing',description:'Ashwini Order #'+d.orderId,order_id:d.razorpayOrderId,prefill:{name:user.name,email:user.email,contact:mobile},handler:async res=>{await api('/api/checkout/verify',{method:'POST',body:{orderId:d.orderId,...res}});if(!checkoutItems)cart=[];save();checkoutItems=null;showConfirmation(d.orderId,'PAID')}});r.open()}catch(e){alert(e.message)}}
function showConfirmation(id,method){openM(`<div class="success"><div class="big">✓</div><h2>Order Confirmed!</h2><p>Your Order Number is <b>#${id}</b></p><p>Payment: <b>${method==='PAID'?'Paid Online':'Cash on Delivery'}</b></p><button class="gold" onclick="track(${id})">Track My Order</button></div>`)}
function auth(){openM(user?`<h2>My Account</h2><p>Hello, <b>${esc(user.name)}</b></p><p>📱 ${esc(user.phone||'Mobile not added')}</p><p>${esc(user.email||'')}</p><button class="gold" onclick="orders()">📦 My Orders</button>${user.role==='admin'?`<button class="gold" onclick="dashboard()">👑 Open Admin Dashboard</button>`:''}<button onclick="logout()">Sign out</button>`:`<h2>Sign in to Ashwini</h2><div class="form"><input id="email" placeholder="Email"><input id="pass" type="password" placeholder="Password"><button class="gold" onclick="login()">Sign in</button><hr><h3>New Buyer — Mobile OTP</h3><input id="rn" placeholder="Full name"><input id="re" placeholder="Email"><input id="rp" type="password" placeholder="Password"><input id="rphone" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number"><button type="button" onclick="sendOtp()">Send OTP</button><input id="rotp" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit OTP"><button class="gold" onclick="register()">Verify OTP & Create Account</button><small id="otpHint">For this local test version, the OTP will be shown after Send OTP. Live SMS requires an SMS provider.</small><hr><details><summary>First-time store admin setup</summary><p class="admin-note">Use this only once on your own store before giving customers access.</p><input id="an" placeholder="Store owner name"><input id="ae" placeholder="Admin email"><input id="apw" type="password" placeholder="Admin password (8+ characters)"><button class="gold" onclick="setupAdmin()">Create Store Admin</button></details></div>`)}
async function sendOtp(){const phoneEl=document.getElementById('rphone');const hint=document.getElementById('otpHint');const phone=(phoneEl?.value||'').replace(/\D/g,'');if(!/^\d{10}$/.test(phone)){if(hint)hint.textContent='Please enter a valid 10-digit mobile number.';phoneEl?.focus();return}const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Send OTP');if(btn){btn.disabled=true;btn.textContent='Sending...'}try{const d=await api('/api/auth/request-otp',{method:'POST',body:{phone}});if(hint)hint.textContent=`Demo OTP: ${d.devOtp}. Enter this 6-digit code below. In live mode an SMS provider will send it.`;toast('✓ OTP generated');}catch(e){if(hint)hint.textContent=e.message||'Could not send OTP';alert(e.message)}finally{if(btn){btn.disabled=false;btn.textContent='Send OTP'}}}
async function setupAdmin(){try{const d=await api('/api/auth/setup-admin',{method:'POST',body:{name:an.value,email:ae.value,password:apw.value}});session(d);closeM();dashboard()}catch(e){alert(e.message)}}
async function login(){try{const d=await api('/api/auth/login',{method:'POST',body:{email:email.value,password:pass.value}});session(d);closeM()}catch(e){alert(e.message)}}
async function register(){try{const d=await api('/api/auth/register',{method:'POST',body:{name:rn.value,email:re.value,password:rp.value,phone:rphone.value.trim(),otp:rotp.value.trim()}});session(d);closeM()}catch(e){alert(e.message)}}
function session(d){token=d.token;user=d.user;localStorage.setItem('ashwiniToken',token);localStorage.setItem('ashwiniUser',JSON.stringify(user));if(user.role==='admin'){const a=document.getElementById('admin');if(a)a.style.display='inline'}toast('Welcome to Ashwini')}
function logout(){localStorage.removeItem('ashwiniToken');localStorage.removeItem('ashwiniUser');location.reload()}
async function orders(){
 if(!user){auth();return}
 try{
  const o=await api('/api/orders');
  const rows=o.map(x=>`<div class="cartrow"><div><b>Order #${x.id}</b><br>₹${Number(x.total).toLocaleString('en-IN')} · <strong>${esc(String(x.status).replaceAll('_',' '))}</strong><br><small>Payment: ${esc(x.payment_status||'PENDING')} · ${esc(x.created_at||'')}</small></div><div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center"><button class="gold" type="button" onclick="track(${x.id})">🚚 Track Order</button><button type="button" onclick="orderDetails(${x.id})">View Details</button></div></div>`).join('');
  openM(`<h2>📦 My Orders</h2>${rows||'<p>No orders yet. Place your first order and it will appear here.</p>'}`);
 }catch(e){alert('My Orders could not load: '+e.message)}
}
async function orderDetails(id){try{const o=await api('/api/orders/'+id);openM(`<h2>Order #${o.id}</h2><p><b>Status:</b> ${esc(String(o.status).replaceAll('_',' '))}</p><p><b>Payment:</b> ${esc(o.payment_status||'PENDING')} (${esc(o.payment_method||'')})</p><p><b>Delivery address:</b> ${esc(o.address)}</p><h3>Items</h3>${(o.items||[]).map(i=>`<div class="cartrow"><div><b>${esc(i.name)}</b><br>Size ${esc(i.size)} · Qty ${i.quantity}</div><b>₹${Number(i.unit_price*i.quantity).toLocaleString('en-IN')}</b></div>`).join('')}<div class="total">Total: ₹${Number(o.total).toLocaleString('en-IN')}</div><button class="gold" type="button" onclick="track(${o.id})">🚚 Track Order</button>`)}catch(e){alert('Order details could not load: '+e.message)}}
async function track(id){
 try{
  const o=await api('/api/orders/'+id);
  let i=stages.indexOf(o.status);if(i<0)i=0;
  openM(`<h2>🚚 Track Order #${o.id}</h2><p><b>Current status:</b> ${esc(String(o.status).replaceAll('_',' '))}</p><div class="track">${stages.map((s,n)=>`<div class="step ${n<=i?'active':''}"><div class="dot"></div>${s.replaceAll('_',' ')}</div>`).join('')}</div><p><b>Delivering to:</b> ${esc(o.address)}</p><p><b>Payment:</b> ${esc(o.payment_status||'PENDING')}</p><div class="total">₹${Number(o.total).toLocaleString('en-IN')}</div><button type="button" onclick="orders()">← My Orders</button>`);
 }catch(e){alert('Tracking could not load: '+e.message)}
}
async function productEditor(id=null){
 if(user?.role!=='admin')return alert('Admin only');
 const ps=await api('/api/products');
 const p=id?ps.find(x=>x.id===id):{name:'',category:'Western Dress',size_options:'S,M,L,XL',color:'',price:0,mrp:0,rating:0,emoji:'👗',stock:0,description:'',image:'',gallery:'',product_history:'',size_chart:'[]',care_instructions:''};
 if(!p)return;
 let sc=p.size_chart||'[]';
 openM(`<h2>${id?'✎ Edit Product':'＋ Add New Product'}</h2>
 <div class="admin-form">
 <div><label>Product Name<input id="ap_name" value="${esc(p.name)}"></label></div>
 <div><label>Category<select id="ap_category">${['Western Dress','Co-ord Set','Skirt & Top','Kurta Set','Formal Ladies & Gents Pants','Sarara','Coat Set','Lehenga','Wedding Gown','Shirts','Party Wear'].map(c=>`<option ${c===p.category?'selected':''}>${c}</option>`).join('')}</select></label></div>
 <div><label>Sizes<input id="ap_sizes" value="${esc(p.size_options||'S,M,L,XL')}"></label></div>
 <div><label>Colour<input id="ap_color" value="${esc(p.color||'')}"></label></div>
 <div><label>Selling Price (₹)<input id="ap_price" type="number" min="0" value="${Number(p.price)||0}"></label></div>
 <div><label>MRP (₹)<input id="ap_mrp" type="number" min="0" value="${Number(p.mrp)||0}"></label></div>
 <div><label>Stock Quantity<input id="ap_stock" type="number" min="0" value="${Number(p.stock)||0}"></label></div>
 <div><label>Rating<input id="ap_rating" type="number" min="0" max="5" step="0.1" value="${Number(p.rating)||0}"></label></div>
 <div class="full"><label>Main Photo path<input id="ap_image" value="${esc(p.image||'')}" placeholder="/product-photo.jpg"></label><div class="admin-note">Photos must be placed in the website folder. Later we can add direct upload.</div></div>
 <div class="full"><label>Up to 5 Photo paths<input id="ap_gallery" value="${esc(p.gallery||'')}" placeholder='["/front.jpg","/back.jpg"]'></label></div>
 <div class="full"><label>Product Description<textarea id="ap_desc">${esc(p.description||'')}</textarea></label></div>
 <div class="full"><label>Product History / Details<textarea id="ap_history">${esc(p.product_history||'')}</textarea></label></div>
 <div class="full"><label>Care Instructions<textarea id="ap_care">${esc(p.care_instructions||'')}</textarea></label></div>
 <div class="full"><label>Size Chart JSON<textarea id="ap_sizechart">${esc(sc)}</textarea></label><div class="admin-note">Example: [{"size":"M","bust":"36","waist":"30","hip":"38"}]</div></div>
 </div><div class="admin-actions" style="margin-top:14px"><button class="gold" type="button" onclick="saveProduct(${id||0})">💾 Save Product</button><button type="button" onclick="dashboard()">Cancel</button></div>`);
}
async function saveProduct(id){
 try{
  const body={name:ap_name.value.trim(),category:ap_category.value,size_options:ap_sizes.value.trim(),color:ap_color.value.trim(),price:Number(ap_price.value),mrp:Number(ap_mrp.value),stock:Number(ap_stock.value),rating:Number(ap_rating.value),emoji:'👗',image:ap_image.value.trim(),gallery:ap_gallery.value.trim()||'[]',description:ap_desc.value,product_history:ap_history.value,care_instructions:ap_care.value,size_chart:ap_sizechart.value.trim()||'[]'};
  if(!body.name||!body.category||body.price<0||body.mrp<0||body.stock<0)throw Error('Please fill product name, category, prices and stock correctly');
  JSON.parse(body.gallery);JSON.parse(body.size_chart);
  const d=await api(id?`/api/admin/products/${id}`:'/api/admin/products',{method:id?'PATCH':'POST',body});
  toast('✓ Product saved');dashboard();load();
 }catch(e){alert(e.message)}
}
async function deleteProduct(id){if(user?.role!=='admin')return;if(!confirm('Delete this product?'))return;try{await api(`/api/admin/products/${id}`,{method:'DELETE'});toast('✓ Product deleted');dashboard();load()}catch(e){alert(e.message)}}
async function updateOrderStatus(id,status){try{const d=await api(`/api/admin/orders/${id}`,{method:'PATCH',body:{status}});toast(`✓ Order #${id} → ${String(d.order.status).replaceAll('_',' ')}`);dashboard()}catch(e){alert('Shipping/status update failed: '+e.message)}}
async function dashboard(){
 if(user?.role!=='admin')return alert('Admin only');
 const [s,o,p]=await Promise.all([api('/api/admin/stats'),api('/api/admin/orders'),api('/api/products')]);
 const orderRows=o.length?o.map(x=>`<tr><td>#${x.id}</td><td><b>${esc(x.name||'Customer')}</b><br><small>${esc(x.email||'')}</small></td><td>₹${Number(x.total).toLocaleString('en-IN')}<br><small>${esc(x.payment_method)}</small></td><td><select class="status-select" onchange="updateOrderStatus(${x.id},this.value)">${['PAYMENT_PENDING','PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'].map(st=>`<option ${st===x.status?'selected':''}>${st}</option>`).join('')}</select></td><td>${esc((x.address||'').slice(0,55))}</td></tr>`).join(''):'<tr><td colspan="5">No orders yet.</td></tr>';
 const productRows=p.map(x=>`<tr><td><div class="admin-product">${x.image?`<img src="${esc(x.image)}" alt="">`:'👗'}<div><b>${esc(x.name)}</b><br><small>${esc(x.category)}</small></div></div></td><td>₹${Number(x.price).toLocaleString('en-IN')}<br><small>MRP ₹${Number(x.mrp).toLocaleString('en-IN')}</small></td><td>${x.stock}</td><td><div class="admin-actions"><button type="button" onclick="productEditor(${x.id})">✎ Edit</button><button type="button" class="admin-danger" onclick="deleteProduct(${x.id})">Delete</button></div></td></tr>`).join('');
 openM(`<h2>👑 Ashwini Admin Dashboard</h2><div class="admin-toolbar"><button class="gold" onclick="productEditor()">＋ Add New Product</button><button onclick="dashboard()">↻ Refresh</button></div><div class="admin-grid"><button class="admin-stat stat-button" type="button" onclick="adminStat('revenue')">Revenue<b>₹${Number(s.revenue).toLocaleString('en-IN')}</b><small>View paid orders</small></button><button class="admin-stat stat-button" type="button" onclick="adminStat('orders')">Orders<b>${s.orders}</b><small>View all orders</small></button><button class="admin-stat stat-button" type="button" onclick="adminStat('customers')">Customers<b>${s.customers}</b><small>View customers</small></button><button class="admin-stat stat-button" type="button" onclick="adminStat('products')">Products<b>${s.products}</b><small>View inventory</small></button></div><h3>📦 Inventory / Products</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>${productRows}</tbody></table></div><h3 style="margin-top:24px">🚚 Orders</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Address</th></tr></thead><tbody>${orderRows}</tbody></table></div>`);
}
const editProduct=productEditor;
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
    const rows=list.map(x=>`<tr><td>#${x.id}</td><td>${esc(x.name||'Customer')}</td><td>₹${Number(x.total).toLocaleString('en-IN')}</td><td>${esc(x.payment_status||'')}</td><td>${esc(x.status||'')}</td></tr>`).join('')||'<tr><td colspan="5">No orders yet.</td></tr>';
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

window.openDelivery=openDelivery;window.saveDeliveryLocation=saveDeliveryLocation;window.lookupAddressPin=lookupAddressPin;window.addressPinChanged=addressPinChanged;window.add=add;window.pick=pick;window.detail=detail;window.setGalleryImage=setGalleryImage;window.sizeChart=sizeChart;window.buyNow=buyNow;window.addFromDetail=addFromDetail;window.wish=wish;window.addWishlist=addWishlist;window.addWishlistToCart=addWishlistToCart;window.removeWishlist=removeWishlist;window.renderWishlistOnly=renderWishlistOnly;window.askQuestion=askQuestion;window.checkDelivery=checkDelivery;window.cartView=cartView;window.changeQty=changeQty;window.removeCart=removeCart;window.checkout=checkout;window.applyCoupon=applyCoupon;window.pay=pay;window.auth=auth;window.setupAdmin=setupAdmin;window.login=login;window.register=register;window.logout=logout;window.orders=orders;window.track=track;window.orderDetails=orderDetails;window.editProduct=editProduct;window.productEditor=productEditor;window.saveProduct=saveProduct;window.deleteProduct=deleteProduct;window.updateOrderStatus=updateOrderStatus;window.dashboard=dashboard;window.cat=cat;window.load=load;window.home=home;window.shopSlide=shopSlide;window.adminStat=adminStat;window.showAd=showAd;window.moveAd=moveAd;window.toggleAd=toggleAd;window.closeM=closeM;window.openReturnMore=openReturnMore;window.toggleBlock=toggleBlock;window.stop=stop;

document.addEventListener('DOMContentLoaded',()=>{
 const searchCat=document.getElementById('searchCat');
 const searchInput=document.getElementById('q');
 const searchBtn=document.querySelector('.search button');
 searchCat?.addEventListener('change',e=>{e.stopPropagation();cat(e.target.value)});
 searchBtn?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();load();document.getElementById('products')?.scrollIntoView({behavior:'smooth',block:'start'});});
 searchInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();load();document.getElementById('products')?.scrollIntoView({behavior:'smooth',block:'start'})}});
 searchInput?.addEventListener('input',()=>{clearTimeout(window.__searchTimer);window.__searchTimer=setTimeout(load,250)});
 document.querySelector('.nav')?.addEventListener('click',e=>{const el=e.target.closest('[data-category]');if(el){e.preventDefault();e.stopPropagation();cat(el.dataset.category)}});
 document.getElementById('modalClose')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeM()});
 document.getElementById('modal')?.addEventListener('click',e=>{if(e.target.id==='modal')closeM()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeM()});
 const admin=document.getElementById('admin');if(admin&&user?.role==='admin')admin.style.display='inline';
 save();load();showAd(0);resetAdTimer();
});
