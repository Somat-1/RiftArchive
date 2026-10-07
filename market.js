(function(){
  'use strict';
  const $=selector=>document.querySelector(selector);
  const $$=selector=>Array.from(document.querySelectorAll(selector));
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fallbackShipping=[
    {code:'DE',country:'Germany',untracked_20g:1.55,tracked:15.49,tracked_above:25,tariff_year:2026},
    {code:'NL',country:'Netherlands',untracked_20g:1.70,tracked:6.20,tracked_above:25,tariff_year:2026},
    {code:'BE',country:'Belgium',untracked_20g:3.37,tracked:12.75,tracked_above:25,tariff_year:2026},
    {code:'FR',country:'France',untracked_20g:2.55,tracked:15.99,tracked_above:25,tariff_year:2026},
    {code:'LU',country:'Luxembourg',untracked_20g:2.00,tracked:13.00,tracked_above:25,tariff_year:2025},
    {code:'ES',country:'Spain',untracked_20g:2.30,tracked:16.04,tracked_above:25,tariff_year:2026}
  ];
  const state={cards:[],shipping:fallbackShipping,updatedAt:null,source:'',view:'all',min:0,max:15,minProfit:2,shippingCode:'NL'};
  const formatter=new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',minimumFractionDigits:2});

  function numberValue(value){if(value==null||value==='')return null;const number=Number(value);return Number.isFinite(number)?number:null}
  function money(value){const number=numberValue(value);return number==null?'—':formatter.format(number)}
  function signedMoney(value){const number=numberValue(value);return number==null?'—':(number>=0?'+':'−')+money(Math.abs(number))}
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
      state.cards=Array.isArray(payload.cards)?payload.cards:[];state.shipping=Array.isArray(payload.shipping)&&payload.shipping.length?payload.shipping:fallbackShipping;state.updatedAt=payload.updated_at||null;state.source=payload.source||'Cardmarket';
      const english=payload.english_prices||{},englishCount=Number(english.matched)||0;
      status.classList.add('ready');status.lastElementChild.textContent=(english.stale?'Cached English prices':english.available?'English prices ready':'English prices unavailable')+' · '+englishCount+'/'+state.cards.length+' Epic printings';
      $('#sourceNote').textContent=english.available
        ?'Lowest offers are English-only Cardmarket minima from EU-27 sellers, supplied by Riftbound Zone and cached daily. Cards without a verified English minimum are omitted. Trend and 7/30-day averages come from Cardmarket’s official all-language guide.'
        :'The English-only price source is unavailable, so no all-language lowest prices are being shown. Trend and averages remain Cardmarket all-language guide values.';
      state.updatedAt=english.updated_at||payload.updated_at||null;
      render();
    }catch(error){
      status.classList.add('error');status.lastElementChild.textContent='Price guide unavailable';
      $('#marketRows').innerHTML='<div class="market-empty"><strong>Could not load Cardmarket prices</strong><small>'+esc(error.message)+' · Try Refresh in a moment.</small></div>';
    }finally{$('#refreshMarket').disabled=false}
  }

  function numericPrice(card){return numberValue(card.price&&card.price.low)}
  function signal(card){const low=numericPrice(card),trend=numberValue(card.price&&card.price.trend);return low!=null&&trend!=null&&trend>0?(low-trend)/trend:null}
  function selectedShipping(){return state.shipping.find(rate=>rate.code===state.shippingCode)||state.shipping[0]||null}
  function shippingFor(card){
    const low=numericPrice(card),rate=selectedShipping();if(low==null||!rate)return null;
    const threshold=numberValue(rate.tracked_above),tracked=numberValue(rate.tracked),untracked=numberValue(rate.untracked_20g),useTracked=threshold!=null&&low>threshold;
    const amount=useTracked?tracked:untracked;if(amount==null)return null;
    return{amount:amount,method:useTracked?'tracked':'20 g untracked',country:rate.country||rate.code,year:rate.tariff_year||''};
  }
  function bargainMetrics(card){
    const low=numericPrice(card),shipping=shippingFor(card);if(low==null||!shipping)return null;
    const total=low+shipping.amount,avg7=numberValue(card.price&&card.price.avg7),avg30=numberValue(card.price&&card.price.avg30);
    const margin7=avg7==null?null:avg7-total,margin30=avg30==null?null:avg30-total;
    if(margin7==null&&margin30==null)return null;
    const use30=margin30!=null&&(margin7==null||margin30>=margin7),best=use30?margin30:margin7;
    return{shipping:shipping,total:total,margin7:margin7,margin30:margin30,best:best,reference:use30?'30d':'7d',referenceValue:use30?avg30:avg7};
  }
  function baseFilteredCards(){
    const query=$('#marketSearch').value.trim().toLowerCase(),min=state.min,max=state.max;
    return state.cards.filter(card=>{const price=numericPrice(card);return(!query||(card.name+' '+(card.set_name||'')).toLowerCase().includes(query))&&price!=null&&price>=min&&price<=max});
  }
  function filteredCards(){
    const sort=$('#marketSort').value;
    const cards=baseFilteredCards().filter(card=>state.view!=='bargains'||(bargainMetrics(card)&&bargainMetrics(card).best>=state.minProfit));
    cards.sort((a,b)=>{
      if(sort==='name')return a.name.localeCompare(b.name);
      if(sort==='trend-desc'){const at=numberValue(a.price.trend),bt=numberValue(b.price.trend);return(bt==null?-1:bt)-(at==null?-1:at)}
      if(sort==='margin-desc'){const am=bargainMetrics(a),bm=bargainMetrics(b);return(bm?bm.best:-999999)-(am?am.best:-999999)}
      if(sort==='discount')return(signal(a)==null?999:signal(a))-(signal(b)==null?999:signal(b));
      return(numericPrice(a)==null?999999:numericPrice(a))-(numericPrice(b)==null?999999:numericPrice(b));
    });
    return cards;
  }
  function render(){
    const cards=filteredCards();
    const bargainCount=baseFilteredCards().filter(card=>{const metrics=bargainMetrics(card);return metrics&&metrics.best>=state.minProfit}).length;
    $('#visibleCount').textContent=cards.length;
    $('#signalCount').textContent=state.view==='bargains'?bargainCount:cards.filter(card=>signal(card)!=null&&signal(card)<0).length;
    $('#signalLabel').textContent=state.view==='bargains'?'best bargains':'below trend';
    $('#guideAge').textContent=ageLabel(state.updatedAt);
    $('#allCount').textContent=state.cards.length;$('#bargainCount').textContent=bargainCount;
    $('#bargainSettings').hidden=state.view!=='bargains';
    const rate=selectedShipping();$('#shippingEstimate').textContent=rate?money(rate.untracked_20g)+' from '+rate.country+' · '+(rate.tariff_year||'current')+' table':'Shipping estimate unavailable';
    $('#marketListHead').innerHTML=state.view==='bargains'?'<span>Card</span><span>English listing</span><span>Shipping</span><span>Total cost</span><span>Reference</span><span>Net margin</span>':'<span>Card</span><span>Lowest EN</span><span>Trend*</span><span>7 days*</span><span>30 days*</span><span>Signal</span>';
    const empty=state.view==='bargains'?'<div class="market-empty"><strong>No bargains meet this margin</strong><small>Try another shipping origin, lower the minimum margin, or widen the listing-price range.</small></div>':'<div class="market-empty"><strong>No Epic cards in this range</strong><small>Adjust the price bounds or clear the card search.</small></div>';
    $('#marketRows').innerHTML=cards.length?cards.map(cardRow).join(''):empty;
  }
  function cardRow(card){
    if(state.view==='bargains')return bargainRow(card);
    const low=numericPrice(card),delta=signal(card),good=delta!=null&&delta<0,high=delta!=null&&delta>0.08;
    const signalText=delta==null?'No signal':(delta<0?'↓ ':'↑ ')+Math.abs(delta*100).toFixed(0)+'% vs trend';
    return '<article class="market-item" data-market-id="'+esc(card.id_product)+'">'+
      '<div class="market-card-row">'+
        '<div class="market-card"><div class="card-thumb-wrap" tabindex="0"><img class="card-thumb" src="'+esc(card.image_url||'card-placeholder.svg')+'" alt="'+esc(card.name)+'" loading="lazy" decoding="async"></div><div class="market-card-copy"><a href="'+esc(card.product_url)+'" target="_blank" rel="noopener noreferrer">'+esc(card.name)+'</a><small>'+esc(card.set_name||'Riftbound')+' · Epic</small></div></div>'+
        '<div class="price-cell primary '+(good?'below':'')+'"><strong>'+money(low)+'</strong><small>English minimum</small></div>'+
        '<div class="price-cell"><strong>'+money(card.price.trend)+'</strong><small>all-language trend</small></div>'+
        '<div class="price-cell"><strong>'+money(card.price.avg7)+'</strong><small>all-language average</small></div>'+
        '<div class="price-cell"><strong>'+money(card.price.avg30)+'</strong><small>all-language average</small></div>'+
        '<span class="trend-chip '+(good?'good':high?'high':'')+'">'+esc(signalText)+'</span>'+
      '</div></article>';
  }
  function bargainRow(card){
    const metrics=bargainMetrics(card);if(!metrics)return'';
    const marginDetail='7d '+signedMoney(metrics.margin7)+' · 30d '+signedMoney(metrics.margin30);
    return '<article class="market-item bargain-item" data-market-id="'+esc(card.id_product)+'"><div class="market-card-row">'+
      '<div class="market-card"><div class="card-thumb-wrap" tabindex="0"><img class="card-thumb" src="'+esc(card.image_url||'card-placeholder.svg')+'" alt="'+esc(card.name)+'" loading="lazy" decoding="async"></div><div class="market-card-copy"><a href="'+esc(card.product_url)+'" target="_blank" rel="noopener noreferrer">'+esc(card.name)+'</a><small>'+esc(card.set_name||'Riftbound')+' · Epic</small></div></div>'+
      '<div class="price-cell primary"><strong>'+money(numericPrice(card))+'</strong><small>English minimum</small></div>'+
      '<div class="price-cell"><strong>'+money(metrics.shipping.amount)+'</strong><small>'+esc(metrics.shipping.method)+'</small></div>'+
      '<div class="price-cell total-cost"><strong>'+money(metrics.total)+'</strong><small>EN low + shipping</small></div>'+
      '<div class="price-cell"><strong>'+money(metrics.referenceValue)+'</strong><small>'+esc(metrics.reference)+' all-language avg</small></div>'+
      '<div class="margin-cell"><strong>'+signedMoney(metrics.best)+'</strong><small>'+esc(marginDetail)+'</small></div>'+
    '</div></article>';
  }

  function ageLabel(date){if(!date)return'—';const stamp=new Date(date);if(Number.isNaN(stamp.getTime()))return'—';const hours=Math.max(0,Math.floor((Date.now()-stamp.getTime())/3600000));return hours<1?'<1h':hours+'h'}

  function setRange(min,max,origin){
    min=Math.max(0,Math.min(50,Number(min)||0));max=Math.max(.5,Math.min(50,Number(max)||0));if(min>max-.5){if(origin==='min')min=max-.5;else max=min+.5}
    state.min=min;state.max=max;$('#priceMin').value=min;$('#priceMax').value=max;$('#priceMinRange').value=min;$('#priceMaxRange').value=max;$('#priceRangeLabel').textContent='€'+formatBound(min)+' – €'+formatBound(max);$('#dualRange').style.setProperty('--low',(min/50*100)+'%');$('#dualRange').style.setProperty('--high',(max/50*100)+'%');
    $$('.range-presets button').forEach(button=>button.classList.toggle('active',button.dataset.range===min+','+max));render();
  }
  function formatBound(value){return Number(value)%1?Number(value).toFixed(1):String(Number(value))}
  function setView(view){
    state.view=view==='bargains'?'bargains':'all';
    $$('[data-market-view]').forEach(button=>{const active=button.dataset.marketView===state.view;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});
    if(state.view==='bargains'&&$('#marketSort').value==='low-asc')$('#marketSort').value='margin-desc';
    render();
  }
  $('#marketSearch').addEventListener('input',render);$('#marketSort').addEventListener('change',render);
  $$('[data-market-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.marketView)));
  $('#shippingCountry').addEventListener('change',event=>{state.shippingCode=event.target.value;render()});
  $('#profitMin').addEventListener('input',event=>{const value=Number(event.target.value);state.minProfit=Number.isFinite(value)?Math.max(0,value):2;render()});
  $('#priceMinRange').addEventListener('input',event=>setRange(event.target.value,state.max,'min'));$('#priceMaxRange').addEventListener('input',event=>setRange(state.min,event.target.value,'max'));
  $('#priceMin').addEventListener('change',event=>setRange(event.target.value,state.max,'min'));$('#priceMax').addEventListener('change',event=>setRange(state.min,event.target.value,'max'));
  $$('.range-presets button').forEach(button=>button.addEventListener('click',()=>{const range=button.dataset.range.split(',').map(Number);setRange(range[0],range[1],'preset')}));
  setRange(0,15,'preset');
})();
