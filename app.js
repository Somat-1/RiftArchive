const PAGE_SIZE=50;
const DOMAINS=['Body','Calm','Chaos','Colorless','Fury','Mind','Order'];
const DOMAIN_ICONS={
  Body:'icons/RB_body_rune_icon.png',
  Calm:'icons/RB_calm_rune_icon.png',
  Chaos:'icons/RB_chaos_rune_icon.png',
  Fury:'icons/RB_fury_rune_icon.png',
  Mind:'icons/RB_mind_rune_icon.png',
  Order:'icons/RB_order_rune_icon.png'
};
const LANGUAGES={en:['English','GB'],fr:['French','FR'],de:['German','DE'],es:['Spanish','ES'],it:['Italian','IT'],pt:['Portuguese','PT'],pl:['Polish','PL'],ja:['Japanese','JP'],ko:['Korean','KR'],zh:['Chinese','CN']};
const DECK_FORMAT=`Legend:
1 Card Name

Champion:
1 Card Name

MainDeck:
3 Card Name
2 Another Card

Battlefields:
1 Battlefield Name

Runes:
6 Rune Name

Sideboard:
2 Card Name`;

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalize=value=>String(value??'').toLowerCase().replace(/[’‘]/g,"'").replace(/\s*[-–—,]\s*/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const flag=(language='en')=>{const cc=(LANGUAGES[language]||LANGUAGES.en)[1];return [...cc].map(c=>String.fromCodePoint(127397+c.charCodeAt())).join('')};
const languageName=code=>(LANGUAGES[code]||[code.toUpperCase()])[0];

const domainIconStyles=document.createElement('link');
domainIconStyles.rel='stylesheet';
domainIconStyles.href='icons/domain-icons.css';
document.head.append(domainIconStyles);

let cards=[],filtered=[],page=1,mode='gallery',randomOrder=new Map();
const activeTypes=new Set(),activeDomains=new Set();

async function loadCollection(){
  const status=$('#loadStatus');
  try{
    let database;
    try{const response=await fetch('api.php?action=collection',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);database=await response.json();if(!Array.isArray(database.cards))throw new Error('Invalid collection')}catch(serverError){const response=await fetch('cards.json',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);database=await response.json()}
    const draft=localStorage.getItem('riftarchive_admin_draft');
    cards=draft?JSON.parse(draft).cards:database.cards;
    randomizeCollection();
    status.textContent=draft?'Local admin draft':'Published collection';
    status.classList.add('ready');
    initialize();
  }catch(error){
    status.textContent='Database unavailable';
    $('#cardGrid').innerHTML='<div class="empty">Could not load cards.json. Open this folder through a local web server rather than file://.</div>';
    console.error(error);
  }
}

function initialize(){
  $('#sortSelect').innerHTML='<option value=random>Random order</option><option value=quantity>Quantity high–low</option><option value=type>Card type</option>';
  buildTypeFilters();
  buildDomainFilters();
  $('#deckInput').value='';
  $('#deckInput').placeholder=DECK_FORMAT;
  bindEvents();
  updateTotals();
  renderCollection();
  renderDeckEmpty();
  if(location.hash==='#deck')showView('deck');
}

function randomizeCollection(){
  const shuffled=[...cards];
  for(let index=shuffled.length-1;index>0;index--){
    const swap=Math.floor(Math.random()*(index+1));
    [shuffled[index],shuffled[swap]]=[shuffled[swap],shuffled[index]];
  }
  randomOrder=new Map(shuffled.map((card,index)=>[card,index]));
}

function updateTotals(){
  const total=cards.reduce((sum,c)=>sum+Number(c.quantity||0),0);
  const unique=new Set(cards.map(c=>normalize(c.name))).size;
  $('#sideUnique').textContent=unique+' unique';
  $('#sideTotal').textContent=total+' cards total';
  $('#headerCount').textContent=unique+' unique';
}

function buildTypeFilters(){
  const counts=cards.reduce((map,card)=>{if(card.type!=='Rune')map[card.type]=(map[card.type]||0)+1;return map},{});
  $('#typeFilters').innerHTML=Object.keys(counts).sort().map(type=>`<label class="check-item"><input type="checkbox" value="${esc(type)}"><span>${esc(type)}</span><span>${counts[type]}</span></label>`).join('');
  $$('#typeFilters input').forEach(input=>input.addEventListener('change',()=>{input.checked?activeTypes.add(input.value):activeTypes.delete(input.value);page=1;renderCollection()}));
}

function buildDomainFilters(){
  const counts=cards.reduce((map,card)=>{(card.domains||[]).forEach(d=>map[d]=(map[d]||0)+1);return map},{});
  $('#domainFilters').innerHTML=DOMAINS.map(domain=>`<button class="domain-button" type="button" data-domain="${domain}" aria-pressed="false"><em>${counts[domain]||0}</em><span class="domain-icon">${DOMAIN_ICONS[domain]}</span><span>${domain}</span></button>`).join('');
  $('#domainFilters').innerHTML=DOMAINS.map(domain=>{
    const icon=DOMAIN_ICONS[domain];
    const artwork=icon?`<img class='domain-icon' src='${esc(icon)}' alt=''>`:`<span class='domain-icon domain-icon-fallback' aria-hidden='true'>○</span>`;
    return`<button class='domain-button' type='button' data-domain='${domain}' aria-pressed='false'><em>${counts[domain]||0}</em>${artwork}<span>${domain}</span></button>`;
  }).join('');
  $$('#domainFilters button').forEach(button=>button.addEventListener('click',()=>{const domain=button.dataset.domain;activeDomains.has(domain)?activeDomains.delete(domain):activeDomains.add(domain);button.classList.toggle('active',activeDomains.has(domain));button.setAttribute('aria-pressed',String(activeDomains.has(domain)));page=1;renderCollection()}));
}

function getFiltered(){
  const query=normalize($('#cardSearch').value),sort=$('#sortSelect').value;
  return cards.filter(card=>
    (!query||normalize(card.name).includes(query))&&
    (!activeTypes.size||activeTypes.has(card.type))&&
    (!activeDomains.size||(card.domains||[]).some(domain=>activeDomains.has(domain)))
  ).sort((a,b)=>{
    if(sort==='quantity')return b.quantity-a.quantity||(randomOrder.get(a)-randomOrder.get(b));
    if(sort==='type')return a.type.localeCompare(b.type)||(randomOrder.get(a)-randomOrder.get(b));
    return randomOrder.get(a)-randomOrder.get(b);
  });
}

function variantLabel(card){return card.version?.label||'Standard'}
function details(card){const grading=card.grading?.company?[card.grading.company,card.grading.value,card.grading.label].filter(Boolean).join(' '):'';return `${flag(card.language)} ${esc(languageName(card.language))} · ${esc(variantLabel(card))}${card.foil?' · Foil':''}${card.condition?' · '+esc(card.condition):''}${grading?' · '+esc(grading):''}${card.notes?' · '+esc(card.notes):''}`}

function cardMarkup(card){
  const landscape=card.orientation==='landscape'?' landscape':'';
  return `<article class="card-tile${landscape}">
    <div class="card-art"><img src="${esc(card.image_url)}" alt="${esc(card.name)} card" loading="lazy"><span class="quantity-pill">×${card.quantity}</span><div class="variant-hover">${details(card)}</div></div>
    <div class="card-info"><div class="card-name">${esc(card.name)}</div><div class="card-set">${esc(card.set?.id)} · ${esc(card.type)} · ${esc((card.domains||[]).join(' / '))}</div></div>
  </article>`;
}

function rowMarkup(card){
  return `<div class="list-row">
    <div class="list-card"><img class="list-thumb" src="${esc(card.image_url)}" alt=""><strong>${esc(card.name)}</strong></div>
    <span>${esc(variantLabel(card))}${card.foil?' · Foil':''}</span>
    <span class="language-cell">${flag(card.language)} ${esc(languageName(card.language))}</span>
    <span class="type-chip">${esc(card.type)}</span><strong>×${card.quantity}</strong>
  </div>`;
}

function renderCollection(){
  filtered=getFiltered();
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  page=Math.min(Math.max(1,page),pages);
  const start=(page-1)*PAGE_SIZE,end=Math.min(start+PAGE_SIZE,filtered.length),visible=filtered.slice(start,end);
  $('#shownCount').textContent=filtered.length?`${start+1}–${end} of ${filtered.length}`:'0';
  const empty='<div class="empty">No cards match these filters.</div>';
  $('#cardGrid').innerHTML=visible.length?visible.map(cardMarkup).join(''):empty;
  $('#listRows').innerHTML=visible.length?visible.map(rowMarkup).join(''):empty;
  renderPagination(pages);
}

function renderPagination(pages){
  const host=$('#pagination');host.replaceChildren();
  const button=(label,target,disabled,active=false)=>{const el=document.createElement('button');el.className='page-button'+(active?' active':'');el.textContent=label;el.disabled=disabled;el.onclick=()=>{page=target;renderCollection();$('#resultsTop').scrollIntoView({behavior:'smooth',block:'start'})};host.append(el)};
  button('Previous',page-1,page===1);
  for(let n=1;n<=pages;n++)button(String(n),n,false,n===page);
  button('Next',page+1,page===pages);
  const info=document.createElement('span');info.className='page-info';info.textContent=`Page ${page} of ${pages}`;host.append(info);
}

function showView(view){
  $$('.view').forEach(el=>el.classList.toggle('active',el.id===view+'View'));
  $$('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  $('#crumb').textContent=view==='browse'?'Browse All':'Deck Search';
  scrollTo({top:0,behavior:'smooth'});
}

function parseDeck(text){
  return text.split(/\r?\n/).map(raw=>{
    const line=raw.trim();
    if(!line)return{kind:'blank'};
    if(/^[^\d]+:\s*$/.test(line))return{kind:'section',label:line.replace(/:\s*$/,'')};
    const match=line.match(/^\s*(\d+)\s*[x×]?\s+(.+?)\s*$/i);
    return match?{kind:'card',quantity:Number(match[1]),name:match[2].trim()}:{kind:'card',quantity:1,name:line};
  });
}

function holdingsIndex(){
  const map=new Map();
  cards.forEach(card=>{const key=normalize(card.name);if(!map.has(key))map.set(key,[]);map.get(key).push(card)});
  return map;
}

function editDistance(left,right){
  const previous=[...Array(right.length+1).keys()];
  for(let row=1;row<=left.length;row++){
    let diagonal=previous[0];previous[0]=row;
    for(let column=1;column<=right.length;column++){
      const above=previous[column],cost=left[row-1]===right[column-1]?0:1;
      previous[column]=Math.min(previous[column]+1,previous[column-1]+1,diagonal+cost);
      diagonal=above;
    }
  }
  return previous[right.length];
}

function closestHoldings(name,holdings){
  const query=normalize(name),exact=holdings.get(query);
  if(exact)return{exact:true,groups:[{key:query,cards:exact}]};
  if(query.length<2)return{exact:false,groups:[]};
  const queryTokens=query.split(' ');
  const ranked=[...holdings.entries()].map(([key,matchingCards])=>{
    const nameTokens=key.split(' ');
    let score=Number.POSITIVE_INFINITY;
    if(key.startsWith(query))score=0;
    else if(key.includes(query))score=1;
    else if(queryTokens.every(token=>nameTokens.some(nameToken=>nameToken.startsWith(token))))score=2;
    else{
      const distance=Math.min(...nameTokens.map(token=>editDistance(query,token)));
      if(distance<=Math.max(1,Math.floor(query.length*.25)))score=3+distance;
    }
    return{key,cards:matchingCards,score};
  }).filter(candidate=>Number.isFinite(candidate.score)).sort((a,b)=>a.score-b.score||a.key.length-b.key.length||a.key.localeCompare(b.key)).slice(0,8);
  return{exact:false,groups:ranked};
}

function candidateMarkup(group){
  const matchingCards=group.cards,owned=matchingCards.reduce((sum,card)=>sum+Number(card.quantity||0),0),first=matchingCards[0];
  const variants=matchingCards.map(card=>`<span class="holding-variant">${flag(card.language)} ${esc(variantLabel(card))}${card.foil?' · Foil':''} ×${card.quantity}</span>`).join('');
  return`<div class="match-candidate"><img class="candidate-thumb" src="${esc(first.image_url)}" alt=""><div class="match-data"><div class="match-name">${esc(first.name)}</div><div class="match-variants">${variants}</div></div><span class="owned-count">${owned} owned</span></div>`;
}

function renderDeckEmpty(message='Enter or paste a deck list to check your collection.'){
  $('#comparison').innerHTML=`<div class="empty deck-empty">${esc(message)}</div>`;
  $('#matchSummary').innerHTML='';
  $('#checkDeck').disabled=!$('#deckInput').value.trim();
}

function checkDeck(){
  const input=$('#deckInput').value.trim();
  if(!input){renderDeckEmpty();return}
  const parsed=parseDeck(input),holdings=holdingsIndex();
  if(!parsed.some(item=>item.kind==='card')){renderDeckEmpty('Add at least one card line, for example “3 Card Name”.');return}
  let found=0,missing=0,short=0,suggested=0,lines=0;
  $('#comparison').innerHTML=parsed.map(item=>{
    if(item.kind==='blank')return'';
    if(item.kind==='section')return`<div class="section-row">${esc(item.label)}</div>`;
    lines++;
    const result=closestHoldings(item.name,holdings),matches=result.exact?result.groups[0].cards:[],owned=matches.reduce((sum,c)=>sum+Number(c.quantity||0),0);
    const status=result.exact?(owned>=item.quantity?'found':'short'):result.groups.length?'suggested':'missing';
    if(status==='found')found++;else if(status==='short')short++;else if(status==='suggested')suggested++;else missing++;
    const icon=status==='found'?'✓':status==='missing'?'×':'!';
    let right;
    if(result.exact)right=`<div class="match-candidates">${candidateMarkup(result.groups[0])}</div>`;
    else if(result.groups.length)right=`<div class="match-candidates"><div class="suggestion-label">Closest collection matches</div>${result.groups.map(candidateMarkup).join('')}</div>`;
    else right='<span class="no-match">No matching card found</span>';
    return`<div class="compare-row ${status}"><div class="compare-cell"><span class="status-icon">${icon}</span><span class="input-card-name"><b>${item.quantity}×</b>${esc(item.name)}</span></div><div class="compare-cell">${right}</div></div>`;
  }).join('')||'<div class="empty">Paste a deck list on the left to begin.</div>';
  $('#matchSummary').innerHTML=`<span class="summary-chip"><i class="summary-dot green"></i><strong>${found}</strong> covered</span><span class="summary-chip"><i class="summary-dot gold"></i><strong>${short}</strong> short</span>${suggested?`<span class="summary-chip"><i class="summary-dot suggestion-dot"></i><strong>${suggested}</strong> suggested</span>`:''}<span class="summary-chip"><i class="summary-dot red"></i><strong>${missing}</strong> missing</span><span class="summary-chip"><strong>${lines}</strong> deck lines</span>`;
}

function clearFilters(){
  $('#cardSearch').value='';activeTypes.clear();activeDomains.clear();page=1;
  $$('#typeFilters input').forEach(input=>input.checked=false);
  $$('#domainFilters button').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false')});
  renderCollection();
}

function bindEvents(){
  $$('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
  $$('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;$$('[data-mode]').forEach(el=>el.classList.toggle('active',el.dataset.mode===mode));$('#cardGrid').hidden=mode!=='gallery';$('#listView').hidden=mode!=='list'}));
  $('#cardSearch').addEventListener('input',()=>{page=1;renderCollection()});
  $('#sortSelect').addEventListener('change',()=>{page=1;renderCollection()});
  $('#clearFilters').addEventListener('click',clearFilters);
  $('#checkDeck').addEventListener('click',checkDeck);
  $('#deckInput').addEventListener('input',()=>{$('#checkDeck').disabled=!$('#deckInput').value.trim();if(!$('#deckInput').value.trim())renderDeckEmpty()});
  $('#clearDeck').addEventListener('click',()=>{$('#deckInput').value='';renderDeckEmpty();$('#deckInput').focus()});
}

loadCollection();
