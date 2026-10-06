(function(){
  'use strict';
  const $=selector=>document.querySelector(selector);
  const $$=selector=>Array.from(document.querySelectorAll(selector));
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const state={cards:[],updatedAt:null,source:'',openId:null,listings:new Map(),min:0,max:15};
  const formatter=new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',minimumFractionDigits:2});

  function money(value){return Number.isFinite(Number(value))?formatter.format(Number(value)):'—'}
  function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2600)}
  async function api(url,options){
    const response=await fetch(url,Object.assign({cache:'no-store'},options||{}));
    let payload={};try{payload=await response.json()}catch(error){}
    if(response.status===401){sessionStorage.removeItem('riftarchive_admin');location.reload();throw new Error('Godmode session expired')}
    if(!response.ok)throw new Error(payload.error||('Request failed ('+response.status+')'));
    return payload;
  }

  $('#loginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const error=$('#loginError');error.textContent='Checking…';
    try{
      await api('api.php?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#adminPassword').value.trim()})});
      sessionStorage.setItem('riftarchive_admin','yes');error.textContent='';unlock();
    }catch(loginError){error.textContent=loginError.message}
  });
  $('#lockAdmin').addEventListener('click',async()=>{try{await fetch('api.php?action=logout',{method:'POST'})}catch(error){}sessionStorage.removeItem('riftarchive_admin');location.reload()});
  $('#refreshMarket').addEventListener('click',()=>loadMarket(true));

  restoreSession();
  async function restoreSession(){
    if(sessionStorage.getItem('riftarchive_admin')!=='yes')return;
    try{const session=await api('api.php?action=session');if(session.authenticated)unlock();else sessionStorage.removeItem('riftarchive_admin')}catch(error){sessionStorage.removeItem('riftarchive_admin')}
  }
  function unlock(){$('#loginGate').hidden=true;$('#marketShell').hidden=false;loadMarket(false)}

  async function loadMarket(force){
    const status=$('#marketStatus');status.classList.remove('ready','error');status.lastElementChild.textContent='Loading Cardmarket guide…';
    $('#refreshMarket').disabled=true;
    if(!state.cards.length)$('#marketRows').innerHTML='<div class="market-loading"><span class="market-spinner"></span><strong>Reading the latest price guide</strong><small>Matching Epic printings to Cardmarket…</small></div>';
    try{
      const payload=await api('api.php?action=market_prices'+(force?'&refresh=1':''));
      state.cards=Array.isArray(payload.cards)?payload.cards:[];state.updatedAt=payload.updated_at||null;state.source=payload.source||'Cardmarket';
      status.classList.add('ready');status.lastElementChild.textContent=(payload.stale?'Cached guide':'Guide ready')+' · '+state.cards.length+' Epic printings';
      $('#sourceNote').textContent=(payload.stale?'Using the most recent cached Cardmarket guide. ':'Daily prices come from Cardmarket’s official public guide. ')+'Seller rows are requested live only when expanded.';
      render();
    }catch(error){
      status.classList.add('error');status.lastElementChild.textContent='Price guide unavailable';
      $('#marketRows').innerHTML='<div class="market-empty"><strong>Could not load Cardmarket prices</strong><small>'+esc(error.message)+' · Try Refresh in a moment.</small></div>';
    }finally{$('#refreshMarket').disabled=false}
  }

  function numericPrice(card){const value=Number(card.price&&card.price.low);return Number.isFinite(value)?value:null}
  function signal(card){const low=numericPrice(card),trend=Number(card.price&&card.price.trend);return low!=null&&Number.isFinite(trend)&&trend>0?(low-trend)/trend:null}
  function filteredCards(){
    const query=$('#marketSearch').value.trim().toLowerCase();
    const min=state.min,max=state.max,sort=$('#marketSort').value;
    const cards=state.cards.filter(card=>{
      const price=numericPrice(card);return(!query||(card.name+' '+(card.set_name||'')).toLowerCase().includes(query))&&price!=null&&price>=min&&price<=max;
    });
    cards.sort((a,b)=>{
      if(sort==='name')return a.name.localeCompare(b.name);
      if(sort==='trend-desc')return(Number(b.price.trend)||-1)-(Number(a.price.trend)||-1);
      if(sort==='discount')return(signal(a)==null?999:signal(a))-(signal(b)==null?999:signal(b));
      return(numericPrice(a)==null?999999:numericPrice(a))-(numericPrice(b)==null?999999:numericPrice(b));
    });
    return cards;
  }
  function render(){
    const cards=filteredCards();
    $('#visibleCount').textContent=cards.length;
    $('#belowCount').textContent=cards.filter(card=>signal(card)!=null&&signal(card)<0).length;
    $('#guideAge').textContent=ageLabel(state.updatedAt);
    $('#marketRows').innerHTML=cards.length?cards.map(cardRow).join(''):'<div class="market-empty"><strong>No Epic cards in this range</strong><small>Adjust the price bounds or clear the card search.</small></div>';
    $$('[data-toggle-card]').forEach(button=>button.addEventListener('click',()=>toggleCard(button.dataset.toggleCard)));
  }
  function cardRow(card){
    const low=numericPrice(card),delta=signal(card),good=delta!=null&&delta<0,high=delta!=null&&delta>0.08;
    const signalText=delta==null?'No signal':(delta<0?'↓ ':'↑ ')+Math.abs(delta*100).toFixed(0)+'% vs trend';
    return '<article class="market-item" data-market-id="'+esc(card.id_product)+'">'+
      '<div class="market-card-row">'+
        '<div class="market-card"><div class="card-thumb-wrap" tabindex="0"><img class="card-thumb" src="'+esc(card.image_url||'card-placeholder.svg')+'" alt="'+esc(card.name)+'" loading="lazy" decoding="async"></div><div class="market-card-copy"><a href="'+esc(card.product_url)+'" target="_blank" rel="noopener noreferrer">'+esc(card.name)+'</a><small>'+esc(card.set_name||'Riftbound')+' · Epic</small></div></div>'+
        '<div class="price-cell primary '+(good?'below':'')+'"><strong>'+money(low)+'</strong><small>daily low</small></div>'+
        '<div class="price-cell"><strong>'+money(card.price.trend)+'</strong><small>market trend</small></div>'+
        '<div class="price-cell"><strong>'+money(card.price.avg7)+'</strong><small>average</small></div>'+
        '<div class="price-cell"><strong>'+money(card.price.avg30)+'</strong><small>average</small></div>'+
        '<span class="trend-chip '+(good?'good':high?'high':'')+'">'+esc(signalText)+'</span>'+
        '<button class="row-toggle" type="button" data-toggle-card="'+esc(card.id_product)+'" aria-label="Show sellers for '+esc(card.name)+'" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>'+
      '</div><div class="seller-panel" hidden></div></article>';
  }

  async function toggleCard(id){
    const item=document.querySelector('[data-market-id="'+CSS.escape(String(id))+'"]');if(!item)return;
    const panel=item.querySelector('.seller-panel'),button=item.querySelector('.row-toggle'),opening=!item.classList.contains('is-open');
    $$('.market-item.is-open').forEach(other=>{if(other!==item){other.classList.remove('is-open');other.querySelector('.seller-panel').hidden=true;other.querySelector('.row-toggle').setAttribute('aria-expanded','false')}});
    item.classList.toggle('is-open',opening);panel.hidden=!opening;button.setAttribute('aria-expanded',String(opening));state.openId=opening?id:null;
    if(!opening)return;
    if(state.listings.has(id)){renderListings(panel,state.listings.get(id),id);return}
    panel.innerHTML='<div class="seller-loading"><span class="market-spinner"></span>Requesting live Cardmarket sellers through the secure proxy…</div>';
    try{const payload=await api('api.php?action=market_listings&idProduct='+encodeURIComponent(id));state.listings.set(id,payload);renderListings(panel,payload,id)}catch(error){panel.innerHTML='<div class="seller-error"><strong>Live sellers are unavailable.</strong><br>'+esc(error.message)+'</div>'}
  }
  function renderListings(panel,payload,id){
    const offers=Array.isArray(payload.offers)?payload.offers:[];
    if(!offers.length){panel.innerHTML='<div class="seller-error">No seller rows were returned for this card.</div>';return}
    panel.innerHTML='<div class="seller-panel-head"><strong>Live seller offers</strong><span>'+esc(payload.fetched_at||'just now')+' · first '+offers.length+' visible offers</span></div><div class="seller-head"><span>Seller</span><span>Condition</span><span>Qty</span><span>Price</span><span>Vs trend</span><span>Other Epic cards</span></div>'+offers.map((offer,index)=>sellerRow(offer,id,index)).join('');
    const stockButtons=Array.from(panel.querySelectorAll('[data-load-stock]'));
    stockButtons.forEach(button=>button.addEventListener('click',()=>loadSellerStock(button)));
    stockButtons.slice(0,4).forEach((button,index)=>setTimeout(()=>loadSellerStock(button),index*350));
  }
  function sellerRow(offer,id,index){
    const delta=Number(offer.vs_trend),klass=Number.isFinite(delta)?(delta<=0?'good':'high'):'';
    return '<div class="seller-row"><div class="seller-identity"><span class="seller-flag">'+countryFlag(offer.country)+'</span><span><strong>'+esc(offer.seller||'Unknown seller')+'</strong><small>'+esc(offer.country||'Country unavailable')+'</small></span></div><span class="seller-condition">'+esc(offer.condition||'—')+'</span><strong>'+esc(offer.quantity==null?'—':offer.quantity)+'</strong><span class="seller-price">'+money(offer.price)+'</span><span class="seller-vs '+klass+'">'+(Number.isFinite(delta)?(delta<=0?'↓ ':'↑ ')+Math.abs(delta*100).toFixed(0)+'%':'—')+'</span><div class="seller-stock" id="stock-'+esc(id)+'-'+index+'"><button class="load-stock" type="button" data-load-stock data-seller="'+esc(offer.seller||'')+'">Check Epic stock</button></div></div>';
  }
  async function loadSellerStock(button){
    if(button.disabled)return;const host=button.parentElement,seller=button.dataset.seller;if(!seller)return;
    button.disabled=true;button.textContent='Checking…';
    try{const payload=await api('api.php?action=market_seller&seller='+encodeURIComponent(seller));renderStock(host,payload.cards||[])}catch(error){host.innerHTML='<span class="stock-empty">'+esc(error.message)+'</span>'}
  }
  function renderStock(host,cards){
    if(!cards.length){host.innerHTML='<span class="stock-empty">No other Epic cards on the first seller page.</span>';return}
    host.innerHTML='<div class="epic-stock">'+cards.slice(0,8).map(card=>{
      const klass=card.below_trend?'good':'high';
      return '<a class="stock-card '+klass+'" href="'+esc(card.product_url||'#')+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc(card.name)+', '+money(card.price)+', quantity '+esc(card.quantity)+'"><img src="'+esc(card.image_url||'card-placeholder.svg')+'" alt="" loading="lazy"><span class="stock-popover"><img src="'+esc(card.image_url||'card-placeholder.svg')+'" alt=""><span><strong>'+esc(card.name)+'</strong><span>'+money(card.price)+'</span><small>Qty '+esc(card.quantity==null?'—':card.quantity)+' · '+(card.below_trend?'below':'above')+' trend</small></span></span></a>';
    }).join('')+'</div>';
  }

  function countryFlag(country){
    const names={Austria:'AT',Belgium:'BE',Croatia:'HR',Cyprus:'CY','Czech Republic':'CZ',Denmark:'DK',Estonia:'EE',Finland:'FI',France:'FR',Germany:'DE',Greece:'GR',Hungary:'HU',Ireland:'IE',Italy:'IT',Latvia:'LV',Lithuania:'LT',Luxembourg:'LU',Malta:'MT',Netherlands:'NL',Norway:'NO',Poland:'PL',Portugal:'PT',Romania:'RO',Slovakia:'SK',Slovenia:'SI',Spain:'ES',Sweden:'SE',Switzerland:'CH','United Kingdom':'GB'};
    const code=(names[country]||country||'').toUpperCase();return /^[A-Z]{2}$/.test(code)?Array.from(code).map(char=>String.fromCodePoint(127397+char.charCodeAt(0))).join(''):'•';
  }
  function ageLabel(date){if(!date)return'—';const stamp=new Date(date);if(Number.isNaN(stamp.getTime()))return'—';const hours=Math.max(0,Math.floor((Date.now()-stamp.getTime())/3600000));return hours<1?'<1h':hours+'h'}

  function setRange(min,max,origin){
    min=Math.max(0,Math.min(50,Number(min)||0));max=Math.max(.5,Math.min(50,Number(max)||0));if(min>max-.5){if(origin==='min')min=max-.5;else max=min+.5}
    state.min=min;state.max=max;$('#priceMin').value=min;$('#priceMax').value=max;$('#priceMinRange').value=min;$('#priceMaxRange').value=max;$('#priceRangeLabel').textContent='€'+formatBound(min)+' – €'+formatBound(max);$('#dualRange').style.setProperty('--low',(min/50*100)+'%');$('#dualRange').style.setProperty('--high',(max/50*100)+'%');
    $$('.range-presets button').forEach(button=>button.classList.toggle('active',button.dataset.range===min+','+max));render();
  }
  function formatBound(value){return Number(value)%1?Number(value).toFixed(1):String(Number(value))}
  $('#marketSearch').addEventListener('input',render);$('#marketSort').addEventListener('change',render);
  $('#priceMinRange').addEventListener('input',event=>setRange(event.target.value,state.max,'min'));$('#priceMaxRange').addEventListener('input',event=>setRange(state.min,event.target.value,'max'));
  $('#priceMin').addEventListener('change',event=>setRange(event.target.value,state.max,'min'));$('#priceMax').addEventListener('change',event=>setRange(state.min,event.target.value,'max'));
  $$('.range-presets button').forEach(button=>button.addEventListener('click',()=>{const range=button.dataset.range.split(',').map(Number);setRange(range[0],range[1],'preset')}));
  setRange(0,15,'preset');
})();
