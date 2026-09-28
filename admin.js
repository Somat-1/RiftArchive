const API='https://api.riftcodex.com';
const LANGUAGES={en:['English','GB'],fr:['French','FR'],de:['German','DE'],es:['Spanish','ES'],it:['Italian','IT'],pt:['Portuguese','PT'],pl:['Polish','PL'],ja:['Japanese','JP'],ko:['Korean','KR'],zh:['Chinese','CN']};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalize=value=>String(value??'').toLowerCase().replace(/[’‘]/g,"'").replace(/\s*[-–—,]\s*/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const flag=language=>{const cc=(LANGUAGES[language]||LANGUAGES.en)[1];return [...cc].map(c=>String.fromCodePoint(127397+c.charCodeAt())).join('')};
const clone=value=>JSON.parse(JSON.stringify(value));
const baseName=name=>String(name).replace(/\s*\((?:alternate art|overnumbered|signature|metal)\)\s*$/i,'').trim();
const displayName=name=>baseName(name).replace(/\s+-\s+/g,', ');

let database=null,originalCards=[],workingCards=[],catalog=[],catalogReady=false;
let sessionLog=[],searchTimer=null,currentEditor=null,allocations=[],importQueue=[],importCompleted=0;

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2400)}

$('#loginForm').addEventListener('submit',event=>{event.preventDefault();if($('#adminPassword').value==='123'){sessionStorage.setItem('riftarchive_admin','yes');unlock()}else{$('#loginError').textContent='Incorrect password'}});
$('#lockAdmin').addEventListener('click',()=>{sessionStorage.removeItem('riftarchive_admin');location.reload()});
if(sessionStorage.getItem('riftarchive_admin')==='yes')unlock();

async function unlock(){
  $('#loginGate').hidden=true;$('#adminShell').hidden=false;
  await loadDatabase();
  loadCatalog();
}

async function loadDatabase(){
  try{
    const response=await fetch('cards.json',{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    database=await response.json();originalCards=clone(database.cards);
    const draft=localStorage.getItem('riftarchive_admin_draft');
    workingCards=draft?JSON.parse(draft).cards:clone(originalCards);
    updateWorkingUI();$('#catalogStatus').textContent=draft?'Working from saved browser draft':'Collection loaded · loading Riftcodex catalog';
  }catch(error){$('#catalogStatus').textContent='Could not load cards.json';$('.catalog-status').classList.add('error');console.error(error)}
}

async function loadCatalog(){
  try{
    const first=await fetch(`${API}/cards?size=100&page=1&sort=name`).then(checkResponse).then(r=>r.json());
    const requests=[];for(let page=2;page<=first.pages;page++)requests.push(fetch(`${API}/cards?size=100&page=${page}&sort=name`).then(checkResponse).then(r=>r.json()));
    const rest=await Promise.all(requests),all=[...first.items,...rest.flatMap(page=>page.items)],seen=new Set();
    catalog=all.filter(card=>{const key=card.riftbound_id||card.id;if(seen.has(key))return false;seen.add(key);return true});
    catalogReady=true;$('.catalog-status').classList.add('ready');$('#catalogStatus').textContent=`Riftcodex ready · ${catalog.length} printings`;
  }catch(error){$('.catalog-status').classList.add('error');$('#catalogStatus').textContent='Riftcodex catalog unavailable';console.error(error)}
}
function checkResponse(response){if(!response.ok)throw new Error('HTTP '+response.status);return response}

function updateWorkingUI(){
  $('#workingTotal').textContent=workingCards.reduce((sum,c)=>sum+Number(c.quantity||0),0);
  renderManage();renderSession();
}

$$('[data-admin-view]').forEach(button=>button.addEventListener('click',()=>{$$('[data-admin-view]').forEach(b=>b.classList.toggle('active',b===button));$$('.admin-view').forEach(view=>view.classList.toggle('active',view.id===button.dataset.adminView+'View'));if(button.dataset.adminView==='manage')renderManage()}));

$('#singleSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderSearch,180)});
function relevance(name,query){const n=normalize(baseName(name)),q=normalize(query);if(n===q)return 0;if(n.startsWith(q))return 1;if(n.includes(q))return 2;const tokens=q.split(' ');return 3+tokens.filter(t=>n.includes(t)).length*-0.1}
function groupedMatches(query){
  const q=normalize(query);if(!q)return[];
  const groups=new Map();
  catalog.filter(card=>normalize(baseName(card.name)).includes(q)||q.split(' ').every(t=>normalize(card.name).includes(t))).forEach(card=>{const key=normalize(baseName(card.name));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(card)});
  return [...groups.values()].sort((a,b)=>relevance(a[0].name,query)-relevance(b[0].name,query)||a[0].name.localeCompare(b[0].name)).slice(0,12);
}
function renderSearch(){
  const query=$('#singleSearch').value.trim(),host=$('#searchResults');
  if(!query){host.innerHTML='<div class="admin-empty">The Riftcodex catalog will appear here as you type.</div>';return}
  if(!catalogReady){host.innerHTML='<div class="admin-empty">Riftcodex is still loading. Try again in a moment.</div>';return}
  const groups=groupedMatches(query);
  host.innerHTML=groups.length?groups.map((versions,index)=>{const card=preferredVersion(versions);return `<button class="search-result" data-result="${index}"><img src="${esc(card.media.image_url)}" alt=""><span><strong>${esc(displayName(card.name))}</strong><small>${esc(card.set.label)} · ${esc(card.classification.type)} · ${esc((card.classification.domain||[]).join(' / '))}</small></span><span class="version-count">${versions.length} version${versions.length===1?'':'s'}</span></button>`}).join(''):'<div class="admin-empty">No close Riftcodex match was found.</div>';
  $$('.search-result').forEach(button=>button.addEventListener('click',()=>openEditor({versions:groups[Number(button.dataset.result)],requested:1,mode:'add'})));
}

function preferredVersion(versions){return versions.find(card=>!card.metadata?.alternate_art&&!card.metadata?.overnumbered&&!card.metadata?.signature&&!/\(Metal\)$/i.test(card.name))||versions[0]}
function versionLabel(card){if(card.metadata?.alternate_art)return'Alternate Art';if(card.metadata?.overnumbered)return'Overnumbered';if(card.metadata?.signature)return'Signature';if(/\(Metal\)$/i.test(card.name))return'Metal';if(card.classification?.rarity==='Promo')return'Promo';return'Standard'}
function versionOption(card){return `${versionLabel(card)} · ${card.set.set_id} #${card.collector_number} · ${card.classification.rarity}`}

function openEditor(options){
  currentEditor=options;const versions=options.versions,first=preferredVersion(versions),existing=options.existing;
  allocations=existing?[{versionId:existing.riftbound_id,quantity:existing.quantity,language:existing.language||'en',english:(existing.language||'en')==='en',foil:Boolean(existing.foil)}]:[{versionId:first.riftbound_id,quantity:options.requested||1,language:'fr',english:true,foil:false}];
  $('#requestedTotal').value=options.requested||existing?.quantity||1;
  $('#variantTitle').textContent=displayName(first.name);
  $('#variantStep').textContent=options.fromImport?`Import ${importCompleted+1} of ${importCompleted+importQueue.length+1}`:existing?'Edit inventory record':'Configure inventory';
  $('#variantHint').textContent=`${versions.length} printing${versions.length===1?'':'s'} available · quantities can be split`;
  $('#selectedCard').innerHTML=`<img src="${esc(first.media.image_url)}" alt=""><div><strong>${esc(displayName(first.name))}</strong><small>${esc(first.set.label)} · ${esc((first.classification.domain||[]).join(' / '))}</small></div>`;
  $('#saveVariant').textContent=existing?'Save changes':options.fromImport?'Save and review next':'Add to working copy';
  renderAllocations();$('#variantModal').hidden=false;
}

function renderAllocations(){
  const host=$('#allocationList'),versions=currentEditor.versions;
  host.innerHTML=allocations.map((entry,index)=>`<div class="allocation-row" data-allocation="${index}">
    <label>Printing<select data-field="version">${versions.map(card=>`<option value="${esc(card.riftbound_id)}" ${card.riftbound_id===entry.versionId?'selected':''}>${esc(versionOption(card))}</option>`).join('')}</select></label>
    <label>Quantity<input data-field="quantity" type="number" min="1" value="${entry.quantity}"></label>
    <label class="english-check"><input data-field="english" type="checkbox" ${entry.english?'checked':''}> ${flag('en')} English</label>
    <label>Other language<select data-field="language" ${entry.english?'disabled':''}>${Object.entries(LANGUAGES).filter(([code])=>code!=='en').map(([code,data])=>`<option value="${code}" ${entry.language===code?'selected':''}>${flag(code)} ${data[0]}</option>`).join('')}</select></label>
    <button class="remove-split" data-remove="${index}" title="Remove split" ${allocations.length===1?'disabled':''}>×</button>
    <label class="english-check"><input data-field="foil" type="checkbox" ${entry.foil?'checked':''}> Foil finish</label>
  </div>`).join('');
  $$('.allocation-row').forEach(row=>row.addEventListener('change',event=>{const index=Number(row.dataset.allocation),field=event.target.dataset.field;if(!field)return;if(field==='quantity')allocations[index].quantity=Math.max(1,Number(event.target.value)||1);else if(field==='english'){allocations[index].english=event.target.checked;event.target.closest('.allocation-row').querySelector('[data-field=language]').disabled=event.target.checked}else if(field==='foil')allocations[index].foil=event.target.checked;else allocations[index][field]=event.target.value;updateAllocationStatus()}));
  $$('[data-remove]').forEach(button=>button.addEventListener('click',()=>{allocations.splice(Number(button.dataset.remove),1);renderAllocations()}));
  updateAllocationStatus();
}

function updateAllocationStatus(){
  const total=Number($('#requestedTotal').value)||0,allocated=allocations.reduce((sum,row)=>sum+Number(row.quantity||0),0),status=$('#allocationStatus');
  status.textContent=`${allocated} of ${total} copies allocated`;status.style.color=allocated===total?'#2d765c':'#b84a43';$('#saveVariant').disabled=allocated!==total||total<1;
}
$('#requestedTotal').addEventListener('input',updateAllocationStatus);
$('#addSplit').addEventListener('click',()=>{if(allocations[0].quantity>1)allocations[0].quantity--;allocations.push({versionId:currentEditor.versions[0].riftbound_id,quantity:1,language:'fr',english:true,foil:false});renderAllocations()});
$('#closeVariant').addEventListener('click',cancelEditor);$('#cancelVariant').addEventListener('click',cancelEditor);
function cancelEditor(){const continuing=currentEditor?.fromImport;$('#variantModal').hidden=true;currentEditor=null;if(continuing)openNextImport()}

function inventoryFromApi(card,allocation,suffix){
  const language=allocation.english?'en':allocation.language,version=versionLabel(card);
  return{collection_id:`${card.riftbound_id}-${language}-${normalize(version).replaceAll(' ','-')}-${allocation.foil?'foil':'nf'}-${Date.now()}-${suffix}`,name:displayName(card.name),quantity:Number(allocation.quantity),riftbound_id:card.riftbound_id,type:card.classification.type,rarity:card.classification.rarity,domains:[...new Set(card.classification.domain||[])],set:{id:card.set.set_id,label:card.set.label},attributes:card.attributes||{energy:null,might:null,power:null},image_url:card.media.image_url,orientation:card.orientation||'portrait',version:{label:version,alternate_art:Boolean(card.metadata?.alternate_art),overnumbered:Boolean(card.metadata?.overnumbered),signature:Boolean(card.metadata?.signature)},foil:Boolean(allocation.foil),language};
}

$('#saveVariant').addEventListener('click',()=>{
  const total=Number($('#requestedTotal').value),allocated=allocations.reduce((sum,row)=>sum+Number(row.quantity),0);if(total!==allocated)return;
  const existing=currentEditor.existing,wasImport=currentEditor.fromImport;
  if(existing){const index=workingCards.findIndex(card=>card.collection_id===existing.collection_id);if(index>=0)workingCards.splice(index,1)}
  const added=allocations.map((allocation,index)=>{
    const card=inventoryFromApi(currentEditor.versions.find(card=>card.riftbound_id===allocation.versionId),allocation,index);
    // Keep the first record's stable ID while editing so older session entries remain clickable.
    if(existing&&index===0)card.collection_id=existing.collection_id;
    return card;
  });
  workingCards.push(...added);
  added.forEach(card=>sessionLog.unshift({action:existing?'edited':'added',collectionId:card.collection_id,name:card.name}));
  $('#variantModal').hidden=true;currentEditor=null;if(wasImport)importCompleted++;
  updateWorkingUI();toast(existing?'Inventory record updated':'Card added to working copy');if(wasImport)openNextImport();
});

function parseImport(text){
  const grouped=new Map();
  text.split(/\r?\n/).forEach(raw=>{const line=raw.trim();if(!line||/^[^\d]+:\s*$/.test(line))return;const match=line.match(/^(\d+)\s*[x×]?\s+(.+)$/i);if(!match)return;const name=match[2].trim(),key=normalize(name);if(!grouped.has(key))grouped.set(key,{name,quantity:0});grouped.get(key).quantity+=Number(match[1])});
  return[...grouped.values()];
}
$('#analyzeImport').addEventListener('click',()=>{
  if(!catalogReady){toast('Wait for the Riftcodex catalog to finish loading');return}
  const items=parseImport($('#importInput').value),missing=[];importQueue=[];
  items.forEach(item=>{const versions=catalog.filter(card=>normalize(baseName(card.name))===normalize(item.name));versions.length?importQueue.push({...item,versions}):missing.push(item.name)});
  importCompleted=0;$('#importStatus').textContent=`${importQueue.length} cards ready for review${missing.length?' · Not found: '+missing.join(', '):''}`;
  openNextImport();
});
function openNextImport(){if(!importQueue.length){if(importCompleted)toast(`Import review complete · ${importCompleted} cards configured`);return}const item=importQueue.shift();openEditor({versions:item.versions,requested:item.quantity,mode:'add',fromImport:true})}
$('#clearImport').addEventListener('click',()=>{$('#importInput').value='';$('#importStatus').textContent='';importQueue=[]});

function renderManage(){
  const host=$('#manageList');if(!host)return;const query=normalize($('#manageSearch').value),items=workingCards.filter(card=>!query||normalize(card.name).includes(query)).sort((a,b)=>a.name.localeCompare(b.name));
  host.innerHTML=items.length?items.slice(0,250).map(card=>`<div class="manage-row"><img src="${esc(card.image_url)}" alt=""><div class="manage-name"><strong>${esc(card.name)}</strong><small>${flag(card.language)} ${esc(card.version?.label||'Standard')}${card.foil?' · Foil':''}</small></div><span>${esc(card.set?.id)} · ${esc(card.type)}</span><strong>×${card.quantity}</strong><span><button data-edit="${esc(card.collection_id)}">Edit</button> <button class="remove" data-remove-card="${esc(card.collection_id)}">Remove</button></span></div>`).join(''):'<div class="admin-empty">No matching inventory records.</div>';
  $$('[data-edit]').forEach(button=>button.addEventListener('click',()=>editInventory(button.dataset.edit)));
  $$('[data-remove-card]').forEach(button=>button.addEventListener('click',()=>removeInventory(button.dataset.removeCard)));
}
$('#manageSearch').addEventListener('input',renderManage);
function versionsForInventory(card){const exact=catalog.filter(item=>normalize(baseName(item.name))===normalize(card.name));return exact.length?exact:[{name:card.name,riftbound_id:card.riftbound_id,collector_number:'—',classification:{type:card.type,rarity:card.rarity,domain:card.domains},set:{set_id:card.set.id,label:card.set.label},attributes:card.attributes,media:{image_url:card.image_url},metadata:card.version||{},orientation:card.orientation}]}
function editInventory(id){const card=workingCards.find(item=>item.collection_id===id);if(card)openEditor({versions:versionsForInventory(card),requested:card.quantity,existing:card,mode:'edit'})}
function removeInventory(id){const index=workingCards.findIndex(card=>card.collection_id===id);if(index<0)return;const card=workingCards[index];if(!confirm(`Remove ${card.quantity}× ${card.name} from the working copy?`))return;workingCards.splice(index,1);sessionLog.unshift({action:'removed',name:card.name,snapshot:card});updateWorkingUI();toast('Card removed from working copy')}

function renderSession(){
  const host=$('#sessionList');$('#sessionCount').textContent=sessionLog.length;
  host.innerHTML=sessionLog.length?sessionLog.map((log,index)=>{const card=workingCards.find(item=>item.collection_id===log.collectionId)||log.snapshot;return`<button class="session-item ${log.action==='removed'?'removed':''}" data-session="${index}" ${log.action==='removed'?'disabled':''}><img src="${esc(card?.image_url||'')}" alt=""><span><strong>${esc(log.name)}</strong><small>${card?flag(card.language)+' '+esc(card.version?.label||'Standard')+(card.foil?' · Foil':'')+' ×'+card.quantity:''}</small></span><span class="action">${log.action}</span></button>`}).join(''):'<div class="admin-empty">No changes yet.</div>';
  $$('[data-session]:not(:disabled)').forEach(button=>button.addEventListener('click',()=>{const log=sessionLog[Number(button.dataset.session)];editInventory(log.collectionId)}));
}

$('#exportJson').addEventListener('click',()=>{
  const output={...database,schema_version:2,updated_at:new Date().toISOString(),cards:workingCards};
  const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='cards.json';link.click();URL.revokeObjectURL(url);toast('Updated cards.json downloaded');
});
$('#saveDraft').addEventListener('click',()=>{localStorage.setItem('riftarchive_admin_draft',JSON.stringify({...database,cards:workingCards}));toast('Browser draft saved')});
$('#discardDraft').addEventListener('click',()=>{if(!confirm('Discard all unexported session changes?'))return;localStorage.removeItem('riftarchive_admin_draft');workingCards=clone(originalCards);sessionLog=[];updateWorkingUI();toast('Working changes discarded')});
