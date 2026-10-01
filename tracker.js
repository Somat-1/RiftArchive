(function(){
'use strict';
const ROOT=document.querySelector('#trackerRoot');
if(!ROOT)return;
const STORE_KEY='riftarchive_play_tracker_draft_v1';
const SECTIONS=[['legend','Legend'],['main','Main deck'],['sideboard','Sideboard'],['battlefields','Battlefields'],['bench','Bench']];
const emptyTracker=()=>({schema_version:1,updated_at:null,decks:[],matches:[]});
const copy=value=>JSON.parse(JSON.stringify(value));
const html=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const norm=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const uid=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const sectionLabel=id=>SECTIONS.find(row=>row[0]===id)?.[1]||id;
const nowInput=()=>{const date=new Date(),offset=date.getTimezoneOffset();return new Date(date.getTime()-offset*60000).toISOString().slice(0,16)};
const dateText=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Not dated';
const catalogCard=id=>catalog.find(card=>(card.riftbound_id||card.id)===id);
const typeOf=card=>String(card?.classification?.type||card?.type||'').toLowerCase();
const imageOf=card=>card?.media?.image_url||card?.image_url||'card-placeholder.svg';
const canonicalCardName=value=>{
  const raw=typeof value==='object'?value?.name:value;
  const displayed=typeof displayName==='function'?displayName(raw||'Unknown card'):String(raw||'Unknown card');
  return displayed
    .replace(/\s*\((?:alternate art|overnumbered|signature|metal|starter|launch exclusive|ultimate|gg ez|showcase)\)\s*$/i,'')
    .replace(/\s+(?:alternate art|overnumbered|signature|metal|showcase)\s*$/i,'')
    .replace(/\s+-\s+/g,', ')
    .trim();
};
const nameOf=card=>canonicalCardName(card);
const isSpecialPrinting=card=>{
  const metadata=card?.metadata||{},rarity=String(card?.classification?.rarity||card?.rarity||'');
  return /showcase/i.test(rarity)||/(?:alternate art|overnumbered|signature|metal|showcase)\)?\s*$/i.test(String(card?.name||''))||
    ['alternate_art','overnumbered','signature','metal','starter','launch_exclusive','ultimate','gg_ez'].some(key=>Boolean(metadata[key]));
};
let tracker=emptyTracker(),loaded=false,serverBacked=false,deckDraft=null,deckOriginal=null,pendingChanges=[],matchDraft=null,matchStep='deck';
const opponentMetaCache=new Map(),opponentMetaRequests=new Map();let keyCardLens='popular',keyCardBoard='main',keyCardsExpanded=true;
document.addEventListener('riftarchive:tracker-open',()=>loadTracker());
async function loadTracker(){
  if(loaded){renderDashboard();return}
  ROOT.innerHTML='<div class="tracker-loading">Loading your decks and game log&hellip;</div>';let remote=null;
  try{const response=await fetch('api.php?action=tracker',{cache:'no-store'});if(!response.ok)throw new Error();remote=await response.json();serverBacked=true}
  catch(error){try{const response=await fetch('tracker.json',{cache:'no-store'});if(response.ok)remote=await response.json()}catch(fallbackError){}}
  try{const draft=JSON.parse(localStorage.getItem(STORE_KEY));tracker=validTracker(draft)?draft:validTracker(remote)?remote:emptyTracker()}
  catch(error){tracker=validTracker(remote)?remote:emptyTracker()}
  loaded=true;renderDashboard();
}
function validTracker(value){return value&&Array.isArray(value.decks)&&Array.isArray(value.matches)}
async function persist(message){
  tracker.updated_at=new Date().toISOString();localStorage.setItem(STORE_KEY,JSON.stringify(tracker));
  try{const response=await fetch('api.php?action=tracker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tracker})}),result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);tracker.updated_at=result.updated_at;localStorage.removeItem(STORE_KEY);serverBacked=true;toast(message||'Play tracker saved')}
  catch(error){serverBacked=false;toast('Saved as a browser draft — server publish unavailable')}
}
function cardSnapshot(card,quantity){return{entry_id:uid('card'),riftbound_id:card.riftbound_id||card.id||uid('unknown'),name:nameOf(card),quantity:Math.max(1,Number(quantity)||1),image_url:imageOf(card),type:card.classification?.type||card.type||'Card',domains:card.classification?.domain||card.domains||[],energy:card.attributes?.energy??null,set:card.set?.set_id||card.set?.id||'',comment:''}}
function blankSections(){return{legend:[],main:[],sideboard:[],battlefields:[],bench:[]}}
function ensureSections(deck){const base=blankSections();Object.keys(base).forEach(key=>base[key]=Array.isArray(deck.sections?.[key])?deck.sections[key]:[]);deck.sections=base;return deck}
function deckTotal(deck){return SECTIONS.reduce((sum,[key])=>sum+(deck.sections?.[key]||[]).reduce((n,c)=>n+Number(c.quantity||0),0),0)}
function deckMatches(deckId){return tracker.matches.filter(match=>match.deck_id===deckId)}
function renderDashboard(){
 const wins=tracker.matches.filter(m=>Number(m.your_score)>Number(m.opponent_score)).length,completed=tracker.matches.filter(m=>m.status!=='In progress').length;
 ROOT.innerHTML=`<header class="tracker-head"><div><div class="step-label">Godmode play room</div><h1>Decks &amp; game log</h1><p>Build deck lists, preserve every revision, and record matches against the field.</p></div><div class="tracker-head-actions"><span class="save-state ${serverBacked?'online':'draft'}">${serverBacked?'Server storage':'Browser draft'}</span><button class="admin-secondary" data-export-history>Export history</button><button class="admin-secondary" data-export-backup>Backup JSON</button><button class="admin-primary" data-new-deck>+ New deck</button></div></header>
 <div class="tracker-stats"><div><strong>${tracker.decks.length}</strong><span>decks</span></div><div><strong>${tracker.matches.length}</strong><span>matches logged</span></div><div><strong>${completed?Math.round(wins/completed*100):0}%</strong><span>win rate</span></div></div>
 <section class="tracker-section"><div class="tracker-section-head"><div><div class="step-label">Your arsenal</div><h2>Deck library</h2></div></div><div class="deck-library">${tracker.decks.length?tracker.decks.map(deckTile).join(''):'<div class="tracker-empty"><strong>No decks yet</strong><span>Create a deck to start tracking games.</span><button class="admin-primary" data-new-deck>Create first deck</button></div>'}</div></section>
 <section class="tracker-section"><div class="tracker-section-head"><div><div class="step-label">Field notes</div><h2>Recent matches</h2></div>${tracker.decks.length?'<button class="admin-secondary" data-new-match>+ Log a match</button>':''}</div><div class="match-log">${tracker.matches.length?tracker.matches.slice().sort((a,b)=>String(b.played_at).localeCompare(String(a.played_at))).map(matchRow).join(''):'<div class="tracker-empty compact"><span>No games have been recorded.</span></div>'}</div></section>`;
}
function deckTile(deck){ensureSections(deck);const legend=deck.sections.legend[0],games=deckMatches(deck.id).length;return `<article class="deck-tile"><div class="deck-cover">${legend?`<img src="${html(legend.image_url)}" alt="">`:'<span>?</span>'}<div class="deck-cover-count">${deckTotal(deck)} cards</div></div><div class="deck-tile-body"><div><h3>${html(deck.name||'Untitled deck')}</h3><p>${html(deck.description||'No deck notes yet.')}</p></div><div class="deck-tile-meta"><span>${games} match${games===1?'':'es'}</span><span>Edited ${dateText(deck.updated_at)}</span></div><div class="deck-actions"><button data-view-deck="${html(deck.id)}">View</button><button data-edit-deck="${html(deck.id)}">Edit</button><button class="accent" data-play-deck="${html(deck.id)}">Log game</button></div></div></article>`}
function matchRow(match){const deck=tracker.decks.find(item=>item.id===match.deck_id),won=Number(match.your_score)>Number(match.opponent_score),lost=Number(match.your_score)<Number(match.opponent_score);return `<article class="match-row"><div class="match-opponent">${match.opponent_legend?.image_url?`<img src="${html(match.opponent_legend.image_url)}" alt="">`:''}<div><small>${html(deck?.name||'Deleted deck')} vs.</small><strong>${html(match.opponent_legend?.name||'Unknown opponent')}</strong><span>${html(dateText(match.played_at))}${match.opponent_battlefield?.name?' · '+html(match.opponent_battlefield.name):''}</span></div></div><div class="match-score ${won?'won':lost?'lost':'draw'}"><strong>${Number(match.your_score)||0}–${Number(match.opponent_score)||0}</strong><span>${match.status==='In progress'?'In progress':won?'Win':lost?'Loss':'Draw'}</span></div><p>${html(match.comments||'No match notes.')}</p><div class="match-actions"><button data-edit-match="${html(match.id)}">Edit</button><button class="danger" data-delete-match="${html(match.id)}">Delete</button></div></article>`}

function openDeck(id,editing){
 const existing=tracker.decks.find(deck=>deck.id===id);deckOriginal=existing?copy(ensureSections(existing)):null;
 deckDraft=existing?copy(deckOriginal):ensureSections({id:uid('deck'),name:'',description:'',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),history:[],sections:blankSections()});
 pendingChanges=[];renderDeckWorkspace(Boolean(editing||!existing));
}
function renderDeckWorkspace(editing){
 const total=deckTotal(deckDraft);
 ROOT.innerHTML=`<div class="workspace-bar"><button class="back-button" data-dashboard>← Deck library</button><div class="workspace-actions">${deckOriginal?`<button class="admin-secondary" data-toggle-deck>${editing?'Preview':'Edit deck'}</button>`:''}${editing?'<button class="admin-primary" data-save-deck>Save revision</button>':`<button class="admin-primary" data-play-deck="${html(deckDraft.id)}">Log game</button>`}<button class="danger-text" data-delete-deck ${deckOriginal?'':'hidden'}>Delete</button></div></div>
 <section class="deck-editor-head ${editing?'editing':''}"><div><div class="step-label">${editing?'Deck editor':'Deck gallery'}</div>${editing?`<input class="deck-title-input" data-deck-name value="${html(deckDraft.name)}" placeholder="Deck name">`:`<h1>${html(deckDraft.name)}</h1>`}${editing?`<textarea data-deck-description placeholder="What is this deck trying to do?">${html(deckDraft.description||'')}</textarea>`:`<p>${html(deckDraft.description||'No deck notes yet.')}</p>`}</div><div class="deck-total"><strong>${total}</strong><span>cards</span></div></section>
 ${editing?deckAdder():''}<div class="deck-zones ${editing?'editing':''}">${SECTIONS.map(([key,label])=>deckZone(key,label,editing)).join('')}</div>
 <section class="history-panel"><div class="tracker-section-head"><div><div class="step-label">Audit trail</div><h2>Change history</h2></div></div>${historyList(deckDraft.history)}</section>`;
}
function deckAdder(){return `<section class="deck-adder"><div><div class="step-label">Add a card</div><h2>Search the Riftcodex catalog</h2></div><div class="deck-add-controls"><input data-deck-search type="search" placeholder="Start typing a card name…" autocomplete="off"><select data-add-section>${SECTIONS.map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><input data-add-quantity type="number" min="1" value="1" aria-label="Quantity"></div><div class="deck-search-results" data-deck-results><span>Search by full or partial name.</span></div></section>`}
function deckZone(key,label,editing){const cards=deckDraft.sections[key];return `<section class="deck-zone ${key}" data-drop-zone="${key}"><header><div><h2>${label}</h2><span>${cards.reduce((n,c)=>n+Number(c.quantity||0),0)} cards · ${cards.length} entries</span></div>${editing?'<small>Drop cards here</small>':''}</header><div class="deck-card-grid">${cards.length?cards.map(card=>deckEntry(card,key,editing)).join(''):`<div class="zone-empty">${editing?'Drop or add cards here':'No cards in this section'}</div>`}</div></section>`}
function deckEntry(card,section,editing){return `<article class="deck-entry" ${editing?'draggable="true"':''} data-entry="${html(card.entry_id)}" data-section="${section}"><div class="deck-entry-art"><img src="${html(card.image_url)}" alt=""><span>×${card.quantity}</span></div><div class="deck-entry-info"><strong>${html(card.name)}</strong><small>${html(card.type||'Card')}${card.energy!==null&&card.energy!==undefined?' · '+html(card.energy)+' energy':''}</small>${editing?`<div class="entry-controls"><label>Qty <input type="number" min="1" value="${card.quantity}" data-entry-qty></label><select data-entry-move aria-label="Move section">${SECTIONS.map(([key,label])=>`<option value="${key}" ${key===section?'selected':''}>${label}</option>`).join('')}</select><button data-remove-entry title="Remove">×</button></div>`:''}</div></article>`}
function historyList(history){return history?.length?`<ol class="history-list">${history.map(item=>`<li><span></span><div><strong>${html(item.summary||'Deck updated')}</strong><time>${html(dateText(item.at))}</time>${item.changes?.length?`<ul>${item.changes.map(change=>`<li>${html(change)}</li>`).join('')}</ul>`:''}</div></li>`).join('')}</ol>`:'<div class="tracker-empty compact"><span>The first saved version will appear here.</span></div>'}
function searchDeckCards(query){
 const host=ROOT.querySelector('[data-deck-results]');if(!host)return;const q=norm(query);
 if(!q){host.innerHTML='<span>Search by full or partial name.</span>';return}if(!catalogReady){host.innerHTML='<span>The Riftcodex catalog is still loading.</span>';return}
 const tokens=q.split(' '),seen=new Set(),results=catalog.filter(card=>{const name=norm(nameOf(card));return name.includes(q)||tokens.every(token=>name.includes(token))}).sort((a,b)=>Number(!norm(nameOf(a)).startsWith(q))-Number(!norm(nameOf(b)).startsWith(q))||norm(nameOf(a)).localeCompare(norm(nameOf(b)))).filter(card=>{const key=norm(nameOf(card));if(seen.has(key))return false;seen.add(key);return true}).slice(0,10);
 host.innerHTML=results.length?results.map(card=>`<button data-add-card="${html(card.riftbound_id||card.id)}"><img src="${html(imageOf(card))}" alt=""><span><strong>${html(nameOf(card))}</strong><small>${html(card.classification?.type||'Card')} · ${html((card.classification?.domain||[]).join(' / ')||'Colorless')}</small></span><b>+ Add</b></button>`).join(''):'<span>No matching cards found.</span>';
}
function addDeckCard(cardId){const card=catalogCard(cardId);if(!card)return;const target=ROOT.querySelector('[data-add-section]').value,quantity=Math.max(1,Number(ROOT.querySelector('[data-add-quantity]').value)||1),existing=deckDraft.sections[target].find(item=>item.riftbound_id===cardId);if(existing)existing.quantity+=quantity;else deckDraft.sections[target].push(cardSnapshot(card,quantity));pendingChanges.push(`Added ${quantity}× ${nameOf(card)} to ${sectionLabel(target)}`);renderDeckWorkspace(true)}
function findEntry(entryId){for(const [key] of SECTIONS){const index=deckDraft.sections[key].findIndex(card=>card.entry_id===entryId);if(index>=0)return{key,index,card:deckDraft.sections[key][index]}}return null}
function moveEntry(entryId,target){const found=findEntry(entryId);if(!found||found.key===target)return;deckDraft.sections[found.key].splice(found.index,1);const existing=deckDraft.sections[target].find(item=>item.riftbound_id===found.card.riftbound_id);if(existing)existing.quantity+=found.card.quantity;else deckDraft.sections[target].push(found.card);pendingChanges.push(`Moved ${found.card.name} from ${sectionLabel(found.key)} to ${sectionLabel(target)}`);renderDeckWorkspace(true)}
function deckAdder(){return `<section class="deck-adder"><div><div class="step-label">Add cards</div><h2>Search or import</h2><p>Add single cards or paste a complete standard list.</p></div><div class="deck-add-area"><div class="deck-add-controls"><input data-deck-search type="search" placeholder="Start typing a card name…" autocomplete="off"><select data-add-section>${SECTIONS.map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><input data-add-quantity type="number" min="1" value="1" aria-label="Quantity"></div><div class="deck-search-results" data-deck-results><span>Search by full or partial name.</span></div><details class="deck-import"><summary>Import a standard deck list</summary><p>Legend, Champion, MainDeck, Battlefields, Sideboard, and Bench are recognized. Runes are ignored.</p><textarea data-deck-import spellcheck="false" placeholder="Legend:&#10;1 Card name&#10;&#10;MainDeck:&#10;3 Card name&#10;&#10;Bench:&#10;1 Card name"></textarea><div><button class="admin-primary" data-import-deck>Import and replace cards</button><span data-import-status></span></div></details></div></section>`}
function deckEntry(card,section,editing){return `<article class="deck-entry" ${editing?'draggable="true"':''} data-entry="${html(card.entry_id)}" data-section="${section}" title="${card.comment?html(card.comment):''}"><div class="deck-entry-art"><img src="${html(card.image_url)}" alt=""><span>×${card.quantity}</span>${card.comment?`<div class="deck-card-note"><b>Card note</b>${html(card.comment)}</div>`:''}</div><div class="deck-entry-info"><strong>${html(card.name)}</strong><small>${html(card.type||'Card')}${card.energy!==null&&card.energy!==undefined?' · '+html(card.energy)+' energy':''}</small>${editing?`<div class="entry-controls"><label>Qty <input type="number" min="1" value="${card.quantity}" data-entry-qty></label><select data-entry-move aria-label="Move section">${SECTIONS.map(([key,label])=>`<option value="${key}" ${key===section?'selected':''}>${label}</option>`).join('')}</select><button data-remove-entry title="Remove">×</button></div><textarea class="entry-comment" data-entry-comment placeholder="Private note shown on hover…">${html(card.comment||'')}</textarea>`:''}</div></article>`}
function deckImportSection(label){const key=norm(label).replaceAll(' ','');return({legend:'legend',champion:'main',maindeck:'main',main:'main',battlefields:'battlefields',battlefield:'battlefields',sideboard:'sideboard',bench:'bench',runes:null,rune:null})[key]}
function closestCatalogCard(name){const target=norm(name),exact=catalog.filter(card=>norm(nameOf(card))===target);if(exact.length)return exact.find(card=>!card.metadata?.alternate_art&&!card.metadata?.overnumbered&&!card.metadata?.signature)||exact[0];const tokens=target.split(' ');return catalog.find(card=>tokens.every(token=>norm(nameOf(card)).includes(token)))}
function importDeckList(){
 const input=ROOT.querySelector('[data-deck-import]'),status=ROOT.querySelector('[data-import-status]');if(!input?.value.trim()){status.textContent='Paste a deck list first.';return}if(!catalogReady){status.textContent='The card catalog is still loading.';return}
 const parsed=blankSections(),missing=[];let section=null,recognized=0;
 input.value.split(/\r?\n/).forEach(raw=>{const line=raw.trim();if(!line)return;const heading=line.match(/^([^:]+):\s*$/);if(heading){section=deckImportSection(heading[1]);return}const match=line.match(/^(\d+)\s*[x×]?\s+(.+)$/i);if(!match||!section)return;const quantity=Math.max(1,Number(match[1])||1),card=closestCatalogCard(match[2].trim());if(!card){missing.push(match[2].trim());return}const id=card.riftbound_id||card.id,existing=parsed[section].find(item=>item.riftbound_id===id);if(existing)existing.quantity+=quantity;else parsed[section].push(cardSnapshot(card,quantity));recognized++});
 if(!recognized){status.textContent='No recognized cards were found.';return}
 if(deckTotal(deckDraft)&&!confirm('Replace the cards currently in this deck with the imported list?'))return;
 deckDraft.sections=parsed;pendingChanges.push(`Imported a deck list with ${deckTotal(deckDraft)} cards`);status.textContent=`Imported ${recognized} entries${missing.length?` · Not found: ${missing.join(', ')}`:''}`;renderDeckWorkspace(true);
}
async function saveDeck(){
 const name=ROOT.querySelector('[data-deck-name]')?.value.trim();if(!name){toast('Give the deck a name before saving');return}
 deckDraft.name=name;deckDraft.description=ROOT.querySelector('[data-deck-description]')?.value.trim()||'';deckDraft.updated_at=new Date().toISOString();
 const changes=pendingChanges.length?pendingChanges.slice():[deckOriginal?'Updated deck name or notes':'Created the deck'];deckDraft.history=Array.isArray(deckDraft.history)?deckDraft.history:[];deckDraft.history.unshift({id:uid('history'),at:deckDraft.updated_at,summary:deckOriginal?'Saved deck revision':'Created deck',changes});deckDraft.history=deckDraft.history.slice(0,200);
 const index=tracker.decks.findIndex(deck=>deck.id===deckDraft.id);if(index>=0)tracker.decks[index]=copy(deckDraft);else tracker.decks.push(copy(deckDraft));deckOriginal=copy(deckDraft);pendingChanges=[];await persist('Deck revision saved');renderDeckWorkspace(false);
}
function deleteDeck(){if(!deckOriginal)return;const games=deckMatches(deckDraft.id).length;if(!confirm(`Delete “${deckDraft.name}”${games?` and its ${games} logged match${games===1?'':'es'}`:''}? This cannot be undone.`))return;tracker.decks=tracker.decks.filter(deck=>deck.id!==deckDraft.id);tracker.matches=tracker.matches.filter(match=>match.deck_id!==deckDraft.id);persist('Deck deleted');renderDashboard()}

function downloadTrackerFile(filename,contents,type){const blob=new Blob([contents],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url)}
function csvCell(value){return `"${String(value??'').replaceAll('"','""')}"`}
function exportHistory(){
 const rows=[['Record type','Deck','Timestamp','Summary','Changes','Opponent legend','Status','Your score','Opponent score','Comments']];
 tracker.decks.forEach(deck=>(deck.history||[]).forEach(revision=>rows.push(['Deck change',deck.name,revision.at,revision.summary,(revision.changes||[]).join(' | '),'','','','',''])));
 tracker.matches.forEach(match=>{const deck=tracker.decks.find(item=>item.id===match.deck_id);rows.push(['Match',deck?.name||'Deleted deck',match.played_at,'Match recorded','',match.opponent_legend?.name||'',match.status||'',match.your_score??'',match.opponent_score??'',match.comments||''])});
 const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');downloadTrackerFile(`riftarchive-history-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8');toast('Deck and match history exported');
}
function exportBackup(){const backup={...copy(tracker),exported_at:new Date().toISOString()};downloadTrackerFile(`riftarchive-play-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2),'application/json');toast('Complete play tracker backup exported')}

function openMatch(deckId,matchId){
 if(!tracker.decks.length){toast('Create a deck before logging a match');return}
 const existing=tracker.matches.find(match=>match.id===matchId);
 matchDraft=existing?copy(existing):{id:uid('match'),deck_id:deckId||tracker.decks[0].id,played_at:nowInput(),status:'Completed',your_score:0,opponent_score:0,opponent_legend:null,opponent_battlefield:null,comments:'',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 renderMatchWorkspace();
}
function uniqueCatalogType(type){
 const unique=new Map();
 catalog.filter(card=>typeOf(card)===type.toLowerCase()).forEach(card=>{
  const key=norm(canonicalCardName(card)),current=unique.get(key);
  if(!current||(isSpecialPrinting(current)&&!isSpecialPrinting(card)))unique.set(key,card);
 });
 return [...unique.values()].sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
}
function selectorCards(type,query){const q=norm(query);return uniqueCatalogType(type).filter(card=>!q||norm(nameOf(card)).includes(q)).slice(0,36)}
function renderMatchWorkspace(legendQuery='',battlefieldQuery=''){
 const deck=tracker.decks.find(item=>item.id===matchDraft.deck_id)||tracker.decks[0];if(deck)matchDraft.deck_id=deck.id;
 ROOT.innerHTML=`<div class="workspace-bar"><button class="back-button" data-dashboard>← Game log</button><div class="workspace-actions"><button class="admin-primary" data-save-match>Save match</button></div></div>
 <header class="match-workspace-head"><div><div class="step-label">Match recorder</div><h1>${html(deck?.name||'Choose a deck')}</h1><p>Record the matchup while keeping combat-speed answers visible beside it.</p></div></header>
 <div class="match-split"><section class="match-form">
 <div class="match-fields"><label>Your deck<select data-match-field="deck_id">${tracker.decks.map(item=>`<option value="${html(item.id)}" ${item.id===matchDraft.deck_id?'selected':''}>${html(item.name)}</option>`).join('')}</select></label><label>Played at<input type="datetime-local" data-match-field="played_at" value="${html(matchDraft.played_at)}"></label><label>Status<select data-match-field="status"><option ${matchDraft.status==='Completed'?'selected':''}>Completed</option><option ${matchDraft.status==='In progress'?'selected':''}>In progress</option></select></label></div>
 ${cardSelector('Legend','legend',legendQuery,matchDraft.opponent_legend)}${cardSelector('Battlefield','battlefield',battlefieldQuery,matchDraft.opponent_battlefield)}
 <section class="score-card"><div><div class="step-label">Game score</div><h2>Best-of-three result</h2></div><div class="score-inputs"><label>You<select data-match-field="your_score">${[0,1,2,3].map(n=>`<option ${Number(matchDraft.your_score)===n?'selected':''}>${n}</option>`).join('')}</select></label><span>—</span><label>Opponent<select data-match-field="opponent_score">${[0,1,2,3].map(n=>`<option ${Number(matchDraft.opponent_score)===n?'selected':''}>${n}</option>`).join('')}</select></label></div></section>
 <label class="match-comments"><span>Game notes</span><textarea data-match-field="comments" placeholder="Key turns, mistakes, sideboard plan, cards to remember…">${html(matchDraft.comments||'')}</textarea></label>
 </section><aside class="match-reference"><header><div><div class="step-label">Live reference</div><h2>Git Gud</h2></div><a href="git-gud.html" target="_blank">Open full page ↗</a></header><iframe src="git-gud.html?embed=1" title="Git Gud card reference"></iframe></aside></div>`;
}
function cardSelector(title,type,query,selected){
 const optional=type==='battlefield'?' · Optional':'';
 return `<section class="opponent-selector"><header><div><div class="step-label">Opponent ${type}${optional}</div><h2>${selected?html(selected.name):type==='battlefield'?'No battlefield selected':`Choose a ${type}`}</h2></div>${selected?`<button data-clear-${type}>Clear</button>`:''}</header><input type="search" data-${type}-search value="${html(query)}" placeholder="Search ${type}s…"><div class="opponent-grid">${selectorItems(title,type,query,selected)}</div></section>`;
}
function selectorItems(title,type,query,selected){const items=selectorCards(title,query);return catalogReady?(items.length?items.map(card=>`<button class="${selected?.riftbound_id===(card.riftbound_id||card.id)?'selected':''}" data-select-${type}="${html(card.riftbound_id||card.id)}"><img src="${html(imageOf(card))}" alt=""><span>${html(nameOf(card))}</span></button>`).join(''):`<p>No ${type}s found.</p>`):'<p>Catalog is still loading. Try again in a moment.</p>'}
async function saveMatch(){if(!matchDraft.opponent_legend){toast('Select the opponent legend first');return}matchDraft.updated_at=new Date().toISOString();const index=tracker.matches.findIndex(match=>match.id===matchDraft.id);if(index>=0)tracker.matches[index]=copy(matchDraft);else tracker.matches.unshift(copy(matchDraft));await persist(index>=0?'Match updated':'Match logged');renderDashboard()}

function openMatch(deckId,matchId){
 if(!tracker.decks.length){toast('Create a deck before logging a match');return}
 const existing=tracker.matches.find(match=>match.id===matchId);
 matchDraft=existing?copy(existing):{id:uid('match'),deck_id:deckId||null,played_at:nowInput(),status:'Completed',your_score:0,opponent_score:0,opponent_legend:null,opponent_battlefield:null,comments:'',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 keyCardLens='popular';keyCardBoard='main';keyCardsExpanded=true;
 matchStep=existing?'notes':deckId?'legend':'deck';renderMatchWorkspace();
}
function matchProgress(){const steps=[['deck','1','Your deck'],['legend','2','Opponent'],['notes','3','Game notes'],['score','4','Score']],active=Math.max(0,steps.findIndex(row=>row[0]===matchStep));return `<nav class="match-progress">${steps.map((row,index)=>`<span class="${index===active?'active':index<active?'done':''}"><b>${row[1]}</b>${row[2]}</span>`).join('')}</nav>`}
function renderMatchWorkspace(query=''){
 const deck=tracker.decks.find(item=>item.id===matchDraft.deck_id);
 ROOT.innerHTML=`<div class="workspace-bar"><button class="back-button" data-match-back>← Back</button><div class="workspace-actions">${matchStep==='notes'?'<button class="admin-primary" data-score-step>Enter score →</button>':''}</div></div>${matchProgress()}<div class="match-stage">${matchStep==='deck'?deckChoiceMarkup():matchStep==='legend'?legendChoiceMarkup(query):matchStep==='notes'?notesMarkup(deck):scoreMarkup(deck)}</div>`;
 if(matchStep==='notes'){const frame=ROOT.querySelector('.review-gitgud iframe'),link=ROOT.querySelector('.review-gitgud a');if(frame)frame.src=gitGudUrl(true);if(link)link.href=gitGudUrl(false);setTimeout(loadOpponentMeta,0)}
}
function deckChoiceMarkup(){return `<header class="flow-heading"><div class="step-label">Step one</div><h1>Choose your deck</h1><p>Select the deck you played. You will choose the opposing Legend next.</p></header><div class="flow-card-grid deck-choice-grid">${tracker.decks.map(deck=>{const legend=deck.sections?.legend?.[0];return `<button data-match-deck="${html(deck.id)}"><span class="flow-art">${legend?`<img src="${html(legend.image_url)}" alt="">`:'<i>?</i>'}</span><strong>${html(deck.name)}</strong><small>${deckTotal(deck)} cards</small></button>`}).join('')}</div>`}
function legendChoiceMarkup(query=''){const q=norm(query),legends=uniqueCatalogType('Legend').filter(card=>!q||norm(nameOf(card)).includes(q));return `<header class="flow-heading"><div class="step-label">Step two</div><h1>Choose the opposing Legend</h1><p>Each Legend appears once, regardless of printing or artwork.</p></header><div class="flow-search"><input data-match-legend-search value="${html(query)}" type="search" placeholder="Search Legends…"></div><div class="flow-card-grid legend-choice-grid" data-legend-choice-grid>${legendCardsMarkup(legends)}</div>`}
function legendCardsMarkup(cards){return cards.map(card=>`<button data-match-legend="${html(card.riftbound_id||card.id)}"><span class="flow-art"><img src="${html(imageOf(card))}" alt=""></span><strong>${html(nameOf(card))}</strong></button>`).join('')}
function matchupDomains(){return [...new Set((matchDraft?.opponent_legend?.domains||[]).filter(Boolean).map(String))]}
function gitGudUrl(embedded=false){const params=new URLSearchParams();if(embedded)params.set('embed','1');const domains=matchupDomains();if(domains.length)params.set('domains',domains.join(','));const query=params.toString();return `git-gud.html${query?`?${query}`:''}`}
function notesMarkup(deck){return `<header class="flow-heading compact matchup-review-heading"><div><div class="step-label">Step three · ${html(deck?.name||'Deck')}</div><h1>Review the matchup</h1><p>Keep likely answers and the opponent’s core engine visible while you take notes.</p></div><div class="matchup-mini">${deck?.sections?.legend?.[0]?`<img src="${html(deck.sections.legend[0].image_url)}" alt="">`:''}<span>vs</span><img src="${html(matchDraft.opponent_legend?.image_url||'card-placeholder.svg')}" alt=""></div></header><div class="match-review-layout"><aside class="match-review-rail"><section class="match-lens-card"><div class="step-label">Key-card filters</div><div class="match-lens-group"><span>Signal</span><div><button class="${keyCardLens==='curated'?'active':''}" data-key-lens="curated">Curated</button><button class="${keyCardLens==='popular'?'active':''}" data-key-lens="popular">Popular</button><button class="${keyCardLens==='performance'?'active':''}" data-key-lens="performance">Top 16</button></div></div><div class="match-lens-group"><span>Zone</span><div><button class="${keyCardBoard==='main'?'active':''}" data-key-board="main">Main deck</button><button class="${keyCardBoard==='sideboard'?'active':''}" data-key-board="sideboard">Sideboard</button></div></div><p data-key-method>${keyLensCopy()}</p></section><section class="game-notes-card compact-notes"><div class="game-note-head"><label>Played at<input type="datetime-local" data-match-field="played_at" value="${html(matchDraft.played_at)}"></label></div><label><span>Game comments</span><textarea data-match-field="comments" placeholder="Key turns, mistakes, sideboard plan, cards to remember…">${html(matchDraft.comments||'')}</textarea></label></section><details class="key-enablers" ${keyCardsExpanded?'open':''} data-key-enablers><summary><span><small>Opponent deck engine</small><strong>Key enabling cards</strong></span><i aria-hidden="true">⌄</i></summary><div class="key-enabler-body" data-opponent-meta><div class="key-meta-state">Loading cached Legend analysis…</div></div></details></aside><section class="gitgud-stack review-gitgud"><header><div><div class="step-label">Combat reference</div><h2>Git Gud lookup</h2></div><a href="git-gud.html" target="_blank">Open full page ↗</a></header><iframe src="git-gud.html?embed=1" title="Git Gud card reference"></iframe></section></div>`}

function keyLensCopy(){return keyCardLens==='popular'?'Shows the most frequently included cards, including basic curve pieces.':keyCardLens==='performance'?'Shows cards overrepresented in Top-16 lists. Small samples are labeled.':'Hides Common Units costing 2 Energy or less, then ranks high-inclusion engine pieces and positive Top-16 signals.'}
function opponentDotId(){const id=String(matchDraft?.opponent_legend?.riftbound_id||''),match=id.match(/^([a-z0-9]+)-(\d+)(?:-|$)/i);return match?`${match[1].toUpperCase()}-${String(Number(match[2])).padStart(3,'0')}`:''}
function catalogByDotId(id){return catalog.find(card=>{const set=String(card?.set?.set_id||card?.set?.id||'').toUpperCase(),collector=Number(card?.collector_number);return set&&collector&&`${set}-${String(collector).padStart(3,'0')}`===id&&!isSpecialPrinting(card)})||catalog.find(card=>{const set=String(card?.set?.set_id||card?.set?.id||'').toUpperCase(),collector=Number(card?.collector_number);return set&&collector&&`${set}-${String(collector).padStart(3,'0')}`===id})}
async function loadOpponentMeta(){
 const host=ROOT.querySelector('[data-opponent-meta]'),id=opponentDotId();if(!host||!id)return;
 if(opponentMetaCache.has(id)){renderOpponentMeta(opponentMetaCache.get(id));return}
 try{let request=opponentMetaRequests.get(id);if(!request){request=fetchOpponentMeta(id);opponentMetaRequests.set(id,request);request.then(()=>opponentMetaRequests.delete(id),()=>opponentMetaRequests.delete(id))}const result=await request;opponentMetaCache.set(id,result);if(id===opponentDotId())renderOpponentMeta(result)}
 catch(error){if(id!==opponentDotId())return;host.innerHTML=`<div class="key-meta-state"><strong>Matchup profile unavailable</strong><span>${html(error.message)}</span><button data-open-legend-meta>Open Legend Meta</button></div>`}
}
async function fetchOpponentMeta(id){
 const cached=await fetch(`api.php?action=legend_stats&legend_id=${encodeURIComponent(id)}`,{cache:'no-store'}),cachedResult=await cached.json().catch(()=>({}));if(cached.ok)return cachedResult;if(cached.status!==404)throw new Error(cachedResult.error||`HTTP ${cached.status}`);
 const host=ROOT.querySelector('[data-opponent-meta]');if(host)host.innerHTML='<div class="key-meta-state"><strong>Building matchup profile</strong><span>No saved sample yet. Fetching recent tournament decks safely&hellip;</span></div>';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),75000);
 try{const response=await fetch('api.php?action=legend_stats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({legend_id:id,legend_name:matchDraft?.opponent_legend?.name||id,days:180}),signal:controller.signal}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result}
 catch(error){if(error.name==='AbortError')throw new Error('The tournament sample timed out safely. Try again later.');throw error}finally{clearTimeout(timer)}
}
function metaCardDetails(card){const catalogCard=catalogByDotId(card.id)||{},classification=catalogCard.classification||{};return{...card,rarity:card.rarity||classification.rarity||'',energy:card.energy??catalogCard.attributes?.energy??null,type:card.type||classification.type||'Card'}}
function keyCardRows(data){
 let rows=(keyCardBoard==='sideboard'?data?.cards?.sideboard:data?.cards?.main)||[];rows=rows.map(metaCardDetails);
 if(keyCardLens==='curated')rows=rows.filter(card=>!(String(card.type).toLowerCase()==='unit'&&String(card.rarity).toLowerCase()==='common'&&Number(card.energy)<=2)).filter(card=>Number(card.inclusion)>=30&&(Number(card.inclusion)>=55||Number(card.top_16_lift)>=4||/rare|epic|showcase/i.test(card.rarity))).sort((a,b)=>keySignal(b)-keySignal(a));
 else if(keyCardLens==='performance')rows=rows.filter(card=>Number(card.top_deck_count)>=2&&Number(card.top_16_lift)>=3).sort((a,b)=>Number(b.top_16_lift)-Number(a.top_16_lift)||Number(b.inclusion)-Number(a.inclusion));
 else rows=rows.filter(card=>Number(card.inclusion)>=30).sort((a,b)=>Number(b.inclusion)-Number(a.inclusion));
 return rows.slice(0,6);
}
function keySignal(card){const rarity=/epic/i.test(card.rarity)?8:/rare/i.test(card.rarity)?5:0,lift=Math.min(15,Math.max(0,Number(card.top_16_lift)||0));return Number(card.inclusion)*.7+lift*.6+Math.min(3,Number(card.average_copies)||0)*5+rarity}
function renderOpponentMeta(data){
 const host=ROOT.querySelector('[data-opponent-meta]');if(!host)return;const rows=keyCardRows(data),sample=data.sample||{};
 host.innerHTML=`<div class="key-meta-summary"><span>${sample.decks||0} unique lists</span><span>${sample.top_16_decks||0} Top-16</span></div>${rows.length?`<div class="key-card-list">${rows.map(keyCardMarkup).join('')}</div>`:'<div class="key-meta-state"><strong>No strong signal in this view</strong><span>Try Popular or switch between main deck and sideboard.</span></div>'}<small class="key-meta-foot">Cached tournament data · association, not win rate</small>`;
}
function keyCardMarkup(card){const lift=Number(card.top_16_lift);return `<article class="key-card"><img src="${html(card.image_url||'card-placeholder.svg')}" alt="" loading="lazy" onerror="this.src='card-placeholder.svg'"><div><strong>${html(card.name)}</strong><span>${Number(card.inclusion||0).toLocaleString(undefined,{maximumFractionDigits:1})}% of lists · ${Number(card.average_copies||0).toLocaleString(undefined,{maximumFractionDigits:1})} avg.</span></div><b class="${lift>0?'up':''}">${Number.isFinite(lift)&&lift!==0?`${lift>0?'+':''}${lift.toLocaleString(undefined,{maximumFractionDigits:1})} pts`:'core'}</b></article>`}
function scoreMarkup(deck){const yours=deck?.sections?.legend?.[0],opponent=matchDraft.opponent_legend;return `<header class="flow-heading"><div class="step-label">Final step</div><h1>Enter the game score</h1><p>Left-click a Legend to subtract. Right-click it to add, from 0 to 3.</p></header><div class="score-clickers"><button data-score-side="your_score" aria-label="Adjust your score"><span class="score-portrait">${yours?`<img src="${html(yours.image_url)}" alt="">`:'<i>?</i>'}</span><strong>${html(deck?.name||'Your deck')}</strong><b>${Number(matchDraft.your_score)||0}</b><small>Left − · Right +</small></button><div class="score-versus">VS</div><button data-score-side="opponent_score" aria-label="Adjust opponent score"><span class="score-portrait"><img src="${html(opponent?.image_url||'card-placeholder.svg')}" alt=""></span><strong>${html(opponent?.name||'Opponent')}</strong><b>${Number(matchDraft.opponent_score)||0}</b><small>Left − · Right +</small></button></div><div class="score-save"><button class="admin-secondary" data-notes-step>← Notes</button><button class="admin-primary" data-save-match>Save match result</button></div>`}
function adjustScore(field,amount){matchDraft[field]=Math.min(3,Math.max(0,Number(matchDraft[field]||0)+amount));renderMatchWorkspace()}
async function saveMatch(){if(!matchDraft.deck_id||!matchDraft.opponent_legend){toast('Choose both decks before saving');return}matchDraft.status='Completed';matchDraft.updated_at=new Date().toISOString();const index=tracker.matches.findIndex(match=>match.id===matchDraft.id);if(index>=0)tracker.matches[index]=copy(matchDraft);else tracker.matches.unshift(copy(matchDraft));await persist(index>=0?'Match updated':'Match logged');renderDashboard()}

ROOT.addEventListener('input',event=>{
 if(event.target.matches('[data-deck-search]'))searchDeckCards(event.target.value);
 if(event.target.matches('[data-match-legend-search]'))ROOT.querySelector('[data-legend-choice-grid]').innerHTML=legendCardsMarkup(uniqueCatalogType('Legend').filter(card=>norm(nameOf(card)).includes(norm(event.target.value))));
 if(event.target.matches('[data-legend-search]'))event.target.nextElementSibling.innerHTML=selectorItems('Legend','legend',event.target.value,matchDraft.opponent_legend);
 if(event.target.matches('[data-battlefield-search]'))event.target.nextElementSibling.innerHTML=selectorItems('Battlefield','battlefield',event.target.value,matchDraft.opponent_battlefield);
 if(event.target.matches('[data-deck-name]'))deckDraft.name=event.target.value;
 if(event.target.matches('[data-deck-description]'))deckDraft.description=event.target.value;
 if(event.target.matches('[data-entry-comment]')){const found=findEntry(event.target.closest('[data-entry]').dataset.entry);if(found)found.card.comment=event.target.value}
 if(event.target.matches('[data-match-field]'))matchDraft[event.target.dataset.matchField]=event.target.value;
 if(event.target.matches('[data-entry-qty]')){const found=findEntry(event.target.closest('[data-entry]').dataset.entry);if(found){const old=found.card.quantity,next=Math.max(1,Number(event.target.value)||1);found.card.quantity=next;if(old!==next)pendingChanges.push(`Changed ${found.card.name} quantity from ${old} to ${next}`)}}
});
ROOT.addEventListener('change',event=>{if(event.target.matches('[data-entry-move]'))moveEntry(event.target.closest('[data-entry]').dataset.entry,event.target.value);if(event.target.matches('[data-entry-comment]')){const found=findEntry(event.target.closest('[data-entry]').dataset.entry);if(found)pendingChanges.push(`Updated note for ${found.card.name}`)}if(event.target.matches('[data-match-field]'))matchDraft[event.target.dataset.matchField]=event.target.value});
ROOT.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.matches('[data-new-deck]'))openDeck(null,true);
 else if(button.matches('[data-export-history]'))exportHistory();
 else if(button.matches('[data-export-backup]'))exportBackup();
 else if(button.matches('[data-dashboard]'))renderDashboard();
 else if(button.matches('[data-view-deck]'))openDeck(button.dataset.viewDeck,false);
 else if(button.matches('[data-edit-deck]'))openDeck(button.dataset.editDeck,true);
 else if(button.matches('[data-toggle-deck]'))renderDeckWorkspace(!ROOT.querySelector('.deck-editor-head')?.classList.contains('editing'));
 else if(button.matches('[data-add-card]'))addDeckCard(button.dataset.addCard);
 else if(button.matches('[data-import-deck]'))importDeckList();
 else if(button.matches('[data-remove-entry]')){const found=findEntry(button.closest('[data-entry]').dataset.entry);if(found&&confirm(`Remove ${found.card.name} from this deck?`)){deckDraft.sections[found.key].splice(found.index,1);pendingChanges.push(`Removed ${found.card.quantity}× ${found.card.name} from ${sectionLabel(found.key)}`);renderDeckWorkspace(true)}}
 else if(button.matches('[data-save-deck]'))saveDeck();
 else if(button.matches('[data-delete-deck]'))deleteDeck();
 else if(button.matches('[data-new-match]'))openMatch();
 else if(button.matches('[data-play-deck]'))openMatch(button.dataset.playDeck);
 else if(button.matches('[data-edit-match]'))openMatch(null,button.dataset.editMatch);
 else if(button.matches('[data-delete-match]')){const match=tracker.matches.find(item=>item.id===button.dataset.deleteMatch);if(match&&confirm('Delete this match record?')){tracker.matches=tracker.matches.filter(item=>item.id!==match.id);persist('Match deleted');renderDashboard()}}
 else if(button.matches('[data-match-deck]')){matchDraft.deck_id=button.dataset.matchDeck;matchStep='legend';renderMatchWorkspace()}
 else if(button.matches('[data-match-legend]')){matchDraft.opponent_legend=cardSnapshot(catalogCard(button.dataset.matchLegend),1);keyCardLens='popular';keyCardBoard='main';keyCardsExpanded=true;matchStep='notes';renderMatchWorkspace()}
 else if(button.matches('[data-key-lens]')){keyCardLens=button.dataset.keyLens;ROOT.querySelectorAll('[data-key-lens]').forEach(item=>item.classList.toggle('active',item===button));const method=ROOT.querySelector('[data-key-method]');if(method)method.textContent=keyLensCopy();const data=opponentMetaCache.get(opponentDotId());if(data)renderOpponentMeta(data)}
 else if(button.matches('[data-key-board]')){keyCardBoard=button.dataset.keyBoard;ROOT.querySelectorAll('[data-key-board]').forEach(item=>item.classList.toggle('active',item===button));const data=opponentMetaCache.get(opponentDotId());if(data)renderOpponentMeta(data)}
 else if(button.matches('[data-open-legend-meta]'))document.querySelector('[data-admin-view="meta"]')?.click()
 else if(button.matches('[data-score-step]')){matchStep='score';renderMatchWorkspace()}
 else if(button.matches('[data-notes-step]')){matchStep='notes';renderMatchWorkspace()}
 else if(button.matches('[data-match-back]')){if(matchStep==='deck')renderDashboard();else{matchStep=matchStep==='score'?'notes':matchStep==='notes'?'legend':'deck';renderMatchWorkspace()}}
 else if(button.matches('[data-score-side]'))adjustScore(button.dataset.scoreSide,-1);
 else if(button.matches('[data-select-legend]')){const card=catalogCard(button.dataset.selectLegend);matchDraft.opponent_legend=cardSnapshot(card,1);renderMatchWorkspace()}
 else if(button.matches('[data-select-battlefield]')){const card=catalogCard(button.dataset.selectBattlefield);matchDraft.opponent_battlefield=cardSnapshot(card,1);renderMatchWorkspace()}
 else if(button.matches('[data-clear-legend]')){matchDraft.opponent_legend=null;renderMatchWorkspace()}
 else if(button.matches('[data-clear-battlefield]')){matchDraft.opponent_battlefield=null;renderMatchWorkspace()}
 else if(button.matches('[data-save-match]'))saveMatch();
});
ROOT.addEventListener('contextmenu',event=>{const score=event.target.closest('[data-score-side]');if(score){event.preventDefault();adjustScore(score.dataset.scoreSide,1)}});
ROOT.addEventListener('toggle',event=>{if(event.target.matches('[data-key-enablers]'))keyCardsExpanded=event.target.open},true);
ROOT.addEventListener('pointerover',event=>{const image=event.target.closest('.key-card>img');if(!image||image.dataset.previewOpen)return;image.dataset.previewOpen='1';const preview=document.createElement('div');preview.className='key-card-hover-preview';preview.innerHTML=`<img src="${html(image.currentSrc||image.src)}" alt="">`;document.body.append(preview);image._riftPreview=preview;positionKeyPreview(event,preview)});
ROOT.addEventListener('pointermove',event=>{const image=event.target.closest('.key-card>img');if(image?._riftPreview)positionKeyPreview(event,image._riftPreview)});
ROOT.addEventListener('pointerout',event=>{const image=event.target.closest('.key-card>img');if(!image||event.relatedTarget===image)return;image._riftPreview?.remove();delete image._riftPreview;delete image.dataset.previewOpen});
function positionKeyPreview(event,preview){const width=230,gap=18,left=event.clientX+gap+width>innerWidth?event.clientX-width-gap:event.clientX+gap,top=Math.max(12,Math.min(innerHeight-333,event.clientY-110));preview.style.left=`${left}px`;preview.style.top=`${top}px`}
ROOT.addEventListener('dragstart',event=>{const entry=event.target.closest('[data-entry]');if(entry)event.dataTransfer.setData('text/plain',entry.dataset.entry)});
ROOT.addEventListener('dragover',event=>{const zone=event.target.closest('[data-drop-zone]');if(zone){event.preventDefault();zone.classList.add('drag-over')}});
ROOT.addEventListener('dragleave',event=>event.target.closest('[data-drop-zone]')?.classList.remove('drag-over'));
ROOT.addEventListener('drop',event=>{const zone=event.target.closest('[data-drop-zone]');if(zone){event.preventDefault();zone.classList.remove('drag-over');moveEntry(event.dataTransfer.getData('text/plain'),zone.dataset.dropZone)}});
})();
