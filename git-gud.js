const GG_PAGE_SIZE=48;
const GG_PARAMS=new URLSearchParams(location.search);
const GG_EMBEDDED=GG_PARAMS.get('embed')==='1';
const GG_PRESET_DOMAINS=GG_PARAMS.get('domains')?.split(',').map(value=>value.trim()).filter(Boolean)||[];
const GG_CHAMPION_TAG=GG_PARAMS.get('champion')?.trim()||'';
if(GG_EMBEDDED)document.body.classList.add('embedded');
const GG_KEYWORDS=['Hidden','Action','Reaction','Ambush','Quick-Draw','Accelerate'];
const GG_DOMAINS=['Body','Calm','Chaos','Colorless','Fury','Mind','Order'];
const GG_BANNED_NAMES=new Set([
  'Called Shot','Ekko, Recurrent','Draven, Vanquisher','Fight or Flight','Scrapheap','Stealthy Pursuer','Stacked Deck',
  "The Arena's Greatest","Aspirant's Climb",'Dreaming Tree','Obelisk of Power',"Reaver's Row"
].map(value=>String(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()));
const GG_DOMAIN_ICONS={
  Body:'icons/RB_body_rune_icon.png',
  Calm:'icons/RB_calm_rune_icon.png',
  Chaos:'icons/RB_chaos_rune_icon.png',
  Fury:'icons/RB_fury_rune_icon.png',
  Mind:'icons/RB_mind_rune_icon.png',
  Order:'icons/RB_order_rune_icon.png'
};

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const normalize=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const canonicalName=value=>String(value??'')
  .replace(/\s*\((?:alternate art|overnumbered|signature|metal|starter|launch exclusive|ultimate|gg ez|showcase)\)\s*$/i,'')
  .replace(/\s+(?:alternate art|overnumbered|signature|metal|showcase)\s*$/i,'')
  .replace(/\s+-\s+/g,', ')
  .trim();
const specialPrinting=card=>/showcase/i.test(String(card?.rarity||''))||/(?:alternate art|overnumbered|signature|metal|showcase)\)?\s*$/i.test(String(card?.name||''));
function playableUniqueCards(cards){
  const unique=new Map();
  cards.forEach(card=>{
    const name=canonicalName(card?.name),key=normalize(name);
    if(!name||String(card?.type||'').toLowerCase()==='legend'||GG_BANNED_NAMES.has(key))return;
    const current=unique.get(key),candidate={card:{...card,name},special:specialPrinting(card)};
    if(!current||(current.special&&!candidate.special))unique.set(key,candidate);
  });
  return [...unique.values()].map(entry=>entry.card);
}

let ggCards=[];
let ggFiltered=[];
let ggPage=1;
const activeKeywords=new Set();
const activeDomains=new Set();

async function loadGitGud(){
  const status=$('#ggLoadStatus');
  try{
    const response=await fetch('gitgud-cards.json',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    ggCards=playableUniqueCards(Array.isArray(data.cards)?data.cards:[]);
    buildKeywordFilters();
    buildDomainFilters();
    applyPresetDomains();
    buildEnergyFilters();
    bindGitGudEvents();
    $('#ggTotal').textContent=`${ggCards.length} cards`;
    $('#ggHeaderCount').textContent=`${ggCards.length} possibilities`;
    status.textContent='Riftcodex combat reference';
    status.classList.add('ready');
    renderGitGud();
  }catch(error){
    status.textContent='Combat reference unavailable';
    $('#ggCardGrid').innerHTML='<div class="empty">Could not load the Git Gud card data.</div>';
    console.error(error);
  }
}

function buildKeywordFilters(){
  const counts=GG_KEYWORDS.reduce((result,keyword)=>{
    result[keyword]=ggCards.filter(card=>(card.keywords||[]).includes(keyword)).length;
    return result;
  },{});
  $('#ggKeywordFilters').innerHTML=GG_KEYWORDS.map(keyword=>`<button class="gg-keyword" type="button" data-keyword="${keyword}" aria-pressed="false"><em>${counts[keyword]}</em>${keyword}</button>`).join('');
  $$('#ggKeywordFilters button').forEach(button=>button.addEventListener('click',()=>{
    const keyword=button.dataset.keyword;
    activeKeywords.has(keyword)?activeKeywords.delete(keyword):activeKeywords.add(keyword);
    button.classList.toggle('active',activeKeywords.has(keyword));
    button.setAttribute('aria-pressed',String(activeKeywords.has(keyword)));
    ggPage=1;
    renderGitGud();
  }));
}

function buildDomainFilters(){
  const counts=ggCards.reduce((result,card)=>{
    (card.domains||[]).forEach(domain=>result[domain]=(result[domain]||0)+1);
    return result;
  },{});
  $('#ggDomainFilters').innerHTML=GG_DOMAINS.map(domain=>{
    const icon=GG_DOMAIN_ICONS[domain];
    const artwork=icon?`<img class="domain-icon" src="${escapeHtml(icon)}" alt="">`:'<span class="domain-icon domain-icon-fallback" aria-hidden="true">○</span>';
    return `<button class="domain-button" type="button" data-domain="${domain}" aria-pressed="false"><em>${counts[domain]||0}</em>${artwork}<span>${domain}</span></button>`;
  }).join('');
  $$('#ggDomainFilters button').forEach(button=>button.addEventListener('click',()=>{
    const domain=button.dataset.domain;
    activeDomains.has(domain)?activeDomains.delete(domain):activeDomains.add(domain);
    button.classList.toggle('active',activeDomains.has(domain));
    button.setAttribute('aria-pressed',String(activeDomains.has(domain)));
    ggPage=1;
    renderGitGud();
  }));
}

function applyPresetDomains(){
  GG_PRESET_DOMAINS.filter(domain=>GG_DOMAINS.includes(domain)).forEach(domain=>activeDomains.add(domain));
  $$('#ggDomainFilters button').forEach(button=>{
    const active=activeDomains.has(button.dataset.domain);
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  const scope=$('#ggDomainScope');
  if(scope&&GG_PRESET_DOMAINS.length){
    scope.hidden=false;
    scope.innerHTML=`<span>Matchup scope</span><strong>${GG_PRESET_DOMAINS.map(escapeHtml).join(' + ')}${GG_CHAMPION_TAG?` &middot; ${escapeHtml(GG_CHAMPION_TAG)} signatures`:''}</strong>`;
  }
}

function buildEnergyFilters(){
  const energies=[...new Set(ggCards.map(card=>card.energy).filter(value=>Number.isFinite(value)))].sort((a,b)=>a-b);
  const options='<option value="">Any</option>'+energies.map(value=>`<option value="${value}">${value}</option>`).join('');
  $('#ggMinEnergy').innerHTML=options;
  $('#ggMaxEnergy').innerHTML=options;
}

function bindGitGudEvents(){
  $('#ggSearch').addEventListener('input',()=>{ggPage=1;renderGitGud()});
  $('#ggSort').addEventListener('change',()=>{ggPage=1;renderGitGud()});
  $('#ggMinEnergy').addEventListener('change',()=>{synchronizeEnergyRange('min');ggPage=1;renderGitGud()});
  $('#ggMaxEnergy').addEventListener('change',()=>{synchronizeEnergyRange('max');ggPage=1;renderGitGud()});
  $('#ggNoCost').addEventListener('change',()=>{ggPage=1;renderGitGud()});
  $('#ggClear').addEventListener('click',clearGitGudFilters);
}

function synchronizeEnergyRange(source){
  const min=$('#ggMinEnergy'),max=$('#ggMaxEnergy');
  if(min.value===''||max.value==='')return;
  if(Number(min.value)<=Number(max.value))return;
  if(source==='min')max.value=min.value;else min.value=max.value;
}

function getFilteredGitGud(){
  const query=normalize($('#ggSearch').value);
  const minValue=$('#ggMinEnergy').value;
  const maxValue=$('#ggMaxEnergy').value;
  const min=minValue===''?null:Number(minValue);
  const max=maxValue===''?null:Number(maxValue);
  const includeNoCost=$('#ggNoCost').checked;
  const sort=$('#ggSort').value;

  return ggCards.filter(card=>{
    if(query&&!normalize(card.name).includes(query))return false;
    if(GG_EMBEDDED&&normalize(card.supertype)==='signature'&&(!GG_CHAMPION_TAG||!(card.tags||[]).some(tag=>normalize(tag)===normalize(GG_CHAMPION_TAG))))return false;
    if(activeKeywords.size&&!(card.keywords||[]).some(keyword=>activeKeywords.has(keyword)))return false;
    if(activeDomains.size&&!(card.domains||[]).some(domain=>activeDomains.has(domain)))return false;
    if(card.energy===null||card.energy===undefined)return min===null&&max===null&&includeNoCost;
    if(min!==null&&card.energy<min)return false;
    if(max!==null&&card.energy>max)return false;
    return true;
  }).sort((a,b)=>{
    if(sort==='name')return a.name.localeCompare(b.name);
    const aEnergy=Number.isFinite(a.energy)?a.energy:Number.POSITIVE_INFINITY;
    const bEnergy=Number.isFinite(b.energy)?b.energy:Number.POSITIVE_INFINITY;
    return sort==='energy-desc'?(bEnergy-aEnergy||a.name.localeCompare(b.name)):(aEnergy-bEnergy||a.name.localeCompare(b.name));
  });
}

function cardMarkup(card){
  const landscape=card.orientation==='landscape'?' landscape':'';
  const keywordChips=(card.keywords||[]).map(keyword=>`<span class="gg-chip ${keyword.toLowerCase()}">${escapeHtml(keyword)}</span>`).join('');
  const domainDots=(card.domains||[]).map(domain=>`<span class="gg-domain-dot ${domain.toLowerCase()}" title="${escapeHtml(domain)}"></span>`).join('');
  const energy=Number.isFinite(card.energy)?card.energy:'—';
  return `<article class="gg-card${landscape}">
    <div class="gg-art"><img src="${escapeHtml(card.image_url)}" alt="${escapeHtml(card.name)} card" loading="lazy" onerror="this.src='card-placeholder.svg'"><span class="gg-energy" title="Energy cost">${energy}</span><div class="gg-card-keywords">${keywordChips}</div></div>
    <div class="gg-info"><div class="gg-name">${escapeHtml(card.name)}</div><div class="gg-meta"><span>${escapeHtml(card.set?.id)}</span><span>·</span><span>${escapeHtml(card.type)}</span><span class="gg-domain-dots">${domainDots}</span></div></div>
  </article>`;
}

function renderGitGud(){
  ggFiltered=getFilteredGitGud();
  const pages=Math.max(1,Math.ceil(ggFiltered.length/GG_PAGE_SIZE));
  ggPage=Math.min(Math.max(1,ggPage),pages);
  const start=(ggPage-1)*GG_PAGE_SIZE;
  const end=Math.min(start+GG_PAGE_SIZE,ggFiltered.length);
  const visible=ggFiltered.slice(start,end);
  $('#ggShownCount').textContent=ggFiltered.length?`${start+1}–${end} of ${ggFiltered.length}`:'0';
  $('#ggCardGrid').innerHTML=visible.length?visible.map(cardMarkup).join(''):'<div class="empty">No cards match this combination.</div>';
  renderGitGudPagination(pages);
}

function renderGitGudPagination(pages){
  const host=$('#ggPagination');
  host.replaceChildren();
  const addButton=(label,target,disabled,active=false)=>{
    const button=document.createElement('button');
    button.className='page-button'+(active?' active':'');
    button.textContent=label;
    button.disabled=disabled;
    button.addEventListener('click',()=>{ggPage=target;renderGitGud();$('#ggResultsTop').scrollIntoView({behavior:'smooth',block:'start'})});
    host.append(button);
  };
  addButton('Previous',ggPage-1,ggPage===1);
  for(let number=1;number<=pages;number++)addButton(String(number),number,false,number===ggPage);
  addButton('Next',ggPage+1,ggPage===pages);
  const info=document.createElement('span');
  info.className='page-info';
  info.textContent=`Page ${ggPage} of ${pages}`;
  host.append(info);
}

function clearGitGudFilters(){
  activeKeywords.clear();
  activeDomains.clear();
  GG_PRESET_DOMAINS.filter(domain=>GG_DOMAINS.includes(domain)).forEach(domain=>activeDomains.add(domain));
  $('#ggSearch').value='';
  $('#ggMinEnergy').value='';
  $('#ggMaxEnergy').value='';
  $('#ggNoCost').checked=true;
  $('#ggSort').value='energy-asc';
  $$('#ggKeywordFilters button').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false')});
  $$('#ggDomainFilters button').forEach(button=>{const active=activeDomains.has(button.dataset.domain);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
  ggPage=1;
  renderGitGud();
}

loadGitGud();
