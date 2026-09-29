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
const nameOf=card=>typeof displayName==='function'?displayName(card?.name||'Unknown card'):String(card?.name||'Unknown card');
let tracker=emptyTracker(),loaded=false,serverBacked=false,deckDraft=null,deckOriginal=null,pendingChanges=[],matchDraft=null;
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
function cardSnapshot(card,quantity){return{entry_id:uid('card'),riftbound_id:card.riftbound_id||card.id||uid('unknown'),name:nameOf(card),quantity:Math.max(1,Number(quantity)||1),image_url:imageOf(card),type:card.classification?.type||card.type||'Card',domains:card.classification?.domain||card.domains||[],energy:card.attributes?.energy??null,set:card.set?.set_id||card.set?.id||''}}
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
function uniqueCatalogType(type){const seen=new Set();return catalog.filter(card=>typeOf(card)===type.toLowerCase()).filter(card=>{const key=norm(nameOf(card));if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>nameOf(a).localeCompare(nameOf(b)))}
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

ROOT.addEventListener('input',event=>{
 if(event.target.matches('[data-deck-search]'))searchDeckCards(event.target.value);
 if(event.target.matches('[data-legend-search]'))event.target.nextElementSibling.innerHTML=selectorItems('Legend','legend',event.target.value,matchDraft.opponent_legend);
 if(event.target.matches('[data-battlefield-search]'))event.target.nextElementSibling.innerHTML=selectorItems('Battlefield','battlefield',event.target.value,matchDraft.opponent_battlefield);
 if(event.target.matches('[data-deck-name]'))deckDraft.name=event.target.value;
 if(event.target.matches('[data-deck-description]'))deckDraft.description=event.target.value;
 if(event.target.matches('[data-match-field]'))matchDraft[event.target.dataset.matchField]=event.target.value;
 if(event.target.matches('[data-entry-qty]')){const found=findEntry(event.target.closest('[data-entry]').dataset.entry);if(found){const old=found.card.quantity,next=Math.max(1,Number(event.target.value)||1);found.card.quantity=next;if(old!==next)pendingChanges.push(`Changed ${found.card.name} quantity from ${old} to ${next}`)}}
});
ROOT.addEventListener('change',event=>{if(event.target.matches('[data-entry-move]'))moveEntry(event.target.closest('[data-entry]').dataset.entry,event.target.value);if(event.target.matches('[data-match-field]'))matchDraft[event.target.dataset.matchField]=event.target.value});
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
 else if(button.matches('[data-remove-entry]')){const found=findEntry(button.closest('[data-entry]').dataset.entry);if(found&&confirm(`Remove ${found.card.name} from this deck?`)){deckDraft.sections[found.key].splice(found.index,1);pendingChanges.push(`Removed ${found.card.quantity}× ${found.card.name} from ${sectionLabel(found.key)}`);renderDeckWorkspace(true)}}
 else if(button.matches('[data-save-deck]'))saveDeck();
 else if(button.matches('[data-delete-deck]'))deleteDeck();
 else if(button.matches('[data-new-match]'))openMatch();
 else if(button.matches('[data-play-deck]'))openMatch(button.dataset.playDeck);
 else if(button.matches('[data-edit-match]'))openMatch(null,button.dataset.editMatch);
 else if(button.matches('[data-delete-match]')){const match=tracker.matches.find(item=>item.id===button.dataset.deleteMatch);if(match&&confirm('Delete this match record?')){tracker.matches=tracker.matches.filter(item=>item.id!==match.id);persist('Match deleted');renderDashboard()}}
 else if(button.matches('[data-select-legend]')){const card=catalogCard(button.dataset.selectLegend);matchDraft.opponent_legend=cardSnapshot(card,1);renderMatchWorkspace()}
 else if(button.matches('[data-select-battlefield]')){const card=catalogCard(button.dataset.selectBattlefield);matchDraft.opponent_battlefield=cardSnapshot(card,1);renderMatchWorkspace()}
 else if(button.matches('[data-clear-legend]')){matchDraft.opponent_legend=null;renderMatchWorkspace()}
 else if(button.matches('[data-clear-battlefield]')){matchDraft.opponent_battlefield=null;renderMatchWorkspace()}
 else if(button.matches('[data-save-match]'))saveMatch();
});
ROOT.addEventListener('dragstart',event=>{const entry=event.target.closest('[data-entry]');if(entry)event.dataTransfer.setData('text/plain',entry.dataset.entry)});
ROOT.addEventListener('dragover',event=>{const zone=event.target.closest('[data-drop-zone]');if(zone){event.preventDefault();zone.classList.add('drag-over')}});
ROOT.addEventListener('dragleave',event=>event.target.closest('[data-drop-zone]')?.classList.remove('drag-over'));
ROOT.addEventListener('drop',event=>{const zone=event.target.closest('[data-drop-zone]');if(zone){event.preventDefault();zone.classList.remove('drag-over');moveEntry(event.dataTransfer.getData('text/plain'),zone.dataset.dropZone)}});
})();
