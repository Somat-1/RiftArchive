(function(){
'use strict';
const ROOT=document.querySelector('#legendStatsRoot');
if(!ROOT)return;
const PUBLIC_MODE=document.body.dataset.legendStatsMode==='public';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalize=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const canonical=value=>String(value??'').replace(/\s*\((?:alternate art|overnumbered|signature|metal|starter|launch exclusive|ultimate|gg ez|showcase)\)\s*$/i,'').replace(/\s+-\s+/g,', ').trim();
const imageOf=card=>card?.media?.image_url||card?.image_url||'card-placeholder.svg';
const typeOf=card=>String(card?.classification?.type||card?.type||'').toLowerCase();
const dotId=card=>{const set=String(card?.set?.set_id||card?.set?.id||'').toUpperCase(),collector=Number(card?.collector_number);return set&&collector?`${set}-${String(collector).padStart(3,'0')}`:''};
let booted=false,legends=[],selected='',payload=null,mode='popular',query='',busy=false,loadSequence=0;

document.addEventListener('riftarchive:legend-stats-open',boot);
if(PUBLIC_MODE)boot();
async function boot(){
 if(booted)return;booted=true;renderLoading();
 const cards=await getCatalog();
 const unique=new Map();
 cards.filter(card=>typeOf(card)==='legend').forEach(card=>{const key=normalize(canonical(card.name)),current=unique.get(key),special=/\((?:alternate art|overnumbered|signature|metal|showcase)\)/i.test(card.name)||card.metadata?.alternate_art||card.metadata?.overnumbered||card.metadata?.signature,promo=/promo/i.test(String(card.classification?.rarity||'')),score=special?0:promo?1:2;if(!current||score>current.score)unique.set(key,{card,score})});
 legends=[...unique.values()].map(entry=>entry.card).filter(card=>dotId(card)).sort((a,b)=>canonical(a.name).localeCompare(canonical(b.name)));
 renderShell();
}

async function getCatalog(){
 for(let attempt=0;attempt<30;attempt++){
  if(typeof catalog!=='undefined'&&Array.isArray(catalog)&&catalog.length)return catalog;
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 try{const response=await fetch('catalog.json',{cache:'no-store'});const data=await response.json();return Array.isArray(data.items)?data.items:[]}catch(error){return[]}
}

function renderLoading(){ROOT.innerHTML='<div class="tracker-loading">Preparing Legend analytics&hellip;</div>'}
function renderShell(){
 ROOT.innerHTML=`<header class="meta-head"><div><div class="step-label">Tournament intelligence</div><h1>Legend meta lab</h1><p>Find the cards that define a Legend across recent, legal tournament decklists.</p></div><div class="meta-source">Cache-backed <span></span> DotGG</div></header>
 <section class="meta-picker"><header><div><div class="step-label">Choose a Legend</div><h2>Browse the field</h2><p>One representative artwork is shown for each Legend.</p></div><label class="meta-picker-search"><span>Find Legend</span><input data-meta-legend-search type="search" placeholder="Search Legends…" autocomplete="off"></label></header><div class="meta-legend-grid" data-meta-legend-grid>${legendPickerCards()}</div></section>
 ${PUBLIC_MODE?'':`<section class="meta-toolbar"><label>Sample window<select data-meta-days><option value="30">30 days</option><option value="90">90 days</option><option value="180" selected>180 days</option><option value="365">365 days</option></select></label><button class="admin-primary" data-meta-refresh disabled>Refresh selected Legend</button></section>`}
 <div data-meta-content>${emptyState()}</div>`;
 ROOT.addEventListener('change',handleChange);ROOT.addEventListener('input',handleInput);ROOT.addEventListener('click',handleClick);
}

function legendPickerCards(filter=''){
 const q=normalize(filter),visible=legends.filter(card=>!q||normalize(canonical(card.name)).includes(q));
 return visible.length?visible.map(card=>`<button type="button" class="meta-legend-option ${dotId(card)===selected?'selected':''}" data-meta-legend="${esc(dotId(card))}" aria-pressed="${dotId(card)===selected}"><span><img src="${esc(imageOf(card))}" alt="" loading="lazy" decoding="async"></span><strong>${esc(canonical(card.name))}</strong><small>${esc((card.classification?.domain||[]).join(' / ')||'Colorless')}</small></button>`).join(''):'<div class="meta-no-legends">No Legends match that search.</div>';
}
function renderLegendPicker(filter=''){const host=ROOT.querySelector('[data-meta-legend-grid]');if(host)host.innerHTML=legendPickerCards(filter)}
function emptyState(){return `<section class="meta-empty"><div class="meta-empty-mark">M</div><h2>Select a Legend above</h2><p>${PUBLIC_MODE?'Choose a portrait to open the latest cached tournament analysis. Only the owner can refresh external data.':'Choose a portrait, then build or refresh its safely rate-limited tournament sample.'}</p><div><span>Unique decklists</span><span>Popularity signals</span><span>Top-finish comparison</span></div></section>`}

function handleChange(){}
function handleInput(event){if(event.target.matches('[data-meta-search]')){query=event.target.value;renderResults()}if(event.target.matches('[data-meta-legend-search]'))renderLegendPicker(event.target.value)}
function handleClick(event){
 const button=event.target.closest('button');if(!button)return;
 if(button.matches('[data-meta-legend]')){selected=button.dataset.metaLegend;payload=null;mode='popular';query='';renderLegendPicker(ROOT.querySelector('[data-meta-legend-search]')?.value||'');const refreshButton=ROOT.querySelector('[data-meta-refresh]');if(refreshButton)refreshButton.disabled=false;loadCached();return}
 if(button.matches('[data-meta-refresh]'))refresh();
 if(button.matches('[data-meta-mode]')){mode=button.dataset.metaMode;query='';renderResults()}
}

async function loadCached(){
 const requested=selected,sequence=++loadSequence;
 setContentStatus('Loading the saved analysis&hellip;');
 try{const response=await fetch(`api.php?action=legend_stats&legend_id=${encodeURIComponent(requested)}`,{cache:'no-store'});const result=await response.json();if(sequence!==loadSequence||requested!==selected)return;if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);payload=result;syncDays();renderResults()}
 catch(error){if(sequence!==loadSequence||requested!==selected)return;ROOT.querySelector('[data-meta-content]').innerHTML=`<section class="meta-empty"><div class="meta-empty-mark">+</div><h2>No analysis cached yet</h2><p>${esc(error.message)} ${PUBLIC_MODE?'The owner can build this sample from Godmode.':'Choose a sample window and run the first refresh.'}</p>${PUBLIC_MODE?'':'<button class="admin-primary" data-meta-refresh>Build analysis</button>'}</section>`}
}

async function refresh(){
 if(PUBLIC_MODE||!selected||busy)return;busy=true;const requested=selected,buttons=[...ROOT.querySelectorAll('[data-meta-refresh]')];buttons.forEach(button=>{button.disabled=true;button.textContent='Sampling tournament decks…'});setContentStatus('Contacting DotGG through the rate-limited server pipeline&hellip;');
 const legend=legends.find(card=>dotId(card)===requested),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),75000);
 try{
  const response=await fetch('api.php?action=legend_stats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({legend_id:requested,legend_name:canonical(legend?.name||requested),days:Number(ROOT.querySelector('[data-meta-days]')?.value||180)}),signal:controller.signal});
  const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);payload=result;syncDays();renderResults();
 }catch(error){ROOT.querySelector('[data-meta-content]').innerHTML=`<section class="meta-empty error"><div class="meta-empty-mark">!</div><h2>Refresh unavailable</h2><p>${esc(error.name==='AbortError'?'The refresh timed out safely. Try again later.':error.message)}</p><button class="admin-secondary" data-meta-refresh>Try again</button></section>`}
 finally{clearTimeout(timer);busy=false;ROOT.querySelectorAll('[data-meta-refresh]').forEach(button=>{button.disabled=false;button.textContent='Refresh selected Legend'})}
}
function setContentStatus(message){ROOT.querySelector('[data-meta-content]').innerHTML=`<div class="tracker-loading">${message}</div>`}
function syncDays(){const field=ROOT.querySelector('[data-meta-days]');if(field&&payload?.sample?.window_days)field.value=String(payload.sample.window_days)}

function renderResults(){
 if(!payload)return;
 const legend=legends.find(card=>dotId(card)===selected),sample=payload.sample||{},cache=payload.cache||{};
 ROOT.querySelector('[data-meta-content]').innerHTML=`<section class="meta-legend-hero"><div class="meta-legend-card"><img src="${esc(imageOf(legend))}" alt=""><div><div class="step-label">${esc(selected)}</div><h2>${esc(payload.legend?.name||canonical(legend?.name))}</h2><p>${sample.window_days||180}-day legal tournament sample</p></div></div><div class="meta-kpis"><div><strong>${sample.decks||0}</strong><span>unique lists</span></div><div><strong>${sample.top_16_decks||0}</strong><span>Top-16 finishes</span></div><div><strong>${sample.duplicates_removed||0}</strong><span>copies removed</span></div><div><strong>${sample.pages_read||0}</strong><span>API pages</span></div></div></section>
 ${cache.message?`<div class="meta-notice">${esc(cache.message)}</div>`:''}${cache.stale?'<div class="meta-notice warning">This is stale cached data because the upstream refresh was unavailable.</div>':''}
 <section class="meta-analysis"><header class="meta-analysis-head"><div class="meta-modes"><button data-meta-mode="popular" class="${mode==='popular'?'active':''}">Most popular</button><button data-meta-mode="performing" class="${mode==='performing'?'active':''}">Top-finish signals</button><button data-meta-mode="sideboard" class="${mode==='sideboard'?'active':''}">Sideboard</button></div><label class="meta-search"><input data-meta-search type="search" value="${esc(query)}" placeholder="Filter cards…"></label></header><div class="meta-table" data-meta-table></div></section>
 <section class="meta-method"><div><div class="step-label">How to read this</div><p>${esc(payload.methodology)}</p></div><div><span>Updated ${esc(formatDate(cache.generated_at))}</span><a href="${esc(payload.source?.url||'https://dotgg.gg/api/')}" target="_blank" rel="noopener">${esc(payload.source?.name||'Source')}</a></div></section>
 ${deckListMarkup(payload.decks||[])}`;
 renderTable();
}

function renderTable(){
 const host=ROOT.querySelector('[data-meta-table]');if(!host||!payload)return;
 let cards=mode==='sideboard'?(payload.cards?.sideboard||[]):(payload.cards?.main||[]);
 if(mode==='performing')cards=cards.filter(card=>Number.isFinite(card.top_16_lift)&&card.top_deck_count>=2).slice().sort((a,b)=>b.top_16_lift-a.top_16_lift||b.inclusion-a.inclusion);
 if(query)cards=cards.filter(card=>normalize(card.name).includes(normalize(query)));
 cards=cards.slice(0,50);
 host.innerHTML=`<div class="meta-row meta-table-head"><span>Card</span><span>Popularity</span><span>Decks</span><span>Avg.</span><span>Top 16</span><span>Lift</span></div>${cards.length?cards.map(cardRow).join(''):'<div class="meta-no-results">No cards meet this view’s sample threshold.</div>'}`;
}
function cardRow(card){const lift=card.top_16_lift,positive=Number(lift)>0,negative=Number(lift)<0;return `<article class="meta-row"><div class="meta-card-name"><img src="${esc(card.image_url||'card-placeholder.svg')}" alt="" loading="lazy" onerror="this.src='card-placeholder.svg'"><span><strong>${esc(card.name)}</strong><small>${esc(card.type||'Card')} · ${esc((card.domains||[]).join(' / ')||'Colorless')}</small></span></div><div class="meta-pop"><strong>${number(card.inclusion)}%</strong><span><i style="width:${Math.min(100,Math.max(0,Number(card.inclusion)||0))}%"></i></span></div><div class="meta-cell"><strong>${card.deck_count||0}</strong><small>lists</small></div><div class="meta-cell"><strong>${number(card.average_copies)}</strong><small>copies</small></div><div class="meta-cell"><strong>${card.top_inclusion===null?'—':number(card.top_inclusion)+'%'}</strong><small>${card.top_deck_count||0} lists</small></div><div class="meta-lift ${positive?'positive':negative?'negative':''}">${lift===null?'—':`${positive?'+':''}${number(lift)} pts`}</div></article>`}
function deckListMarkup(decks){if(!decks.length)return'';return `<section class="meta-decks"><div class="step-label">Sample provenance</div><h2>Recent lists in this sample</h2><div>${decks.map(deck=>`<article><span class="meta-place">${deck.place?`#${deck.place}`:'—'}</span><div><strong>${esc(deck.name)}</strong><small>${esc(deck.event||'Tournament deck')}</small></div></article>`).join('')}</div></section>`}
function number(value){return Number(value||0).toLocaleString(undefined,{maximumFractionDigits:1})}
function formatDate(value){if(!value)return'unknown';try{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}catch(error){return value}}
})();
