const API='https://api.riftcodex.com';
const CATALOG_CACHE_KEY='riftarchive_catalog_cache_v2';
const LANGUAGES={en:['English','GB'],fr:['French','FR'],de:['German','DE'],es:['Spanish','ES'],it:['Italian','IT'],pt:['Portuguese','PT'],pl:['Polish','PL'],ja:['Japanese','JP'],ko:['Korean','KR'],zh:['Chinese','CN']};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalize=value=>String(value??'').toLowerCase().replace(/[’‘]/g,"'").replace(/\s*[-–—,]\s*/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const flag=language=>{const cc=(LANGUAGES[language]||LANGUAGES.en)[1];return [...cc].map(c=>String.fromCodePoint(127397+c.charCodeAt())).join('')};
const clone=value=>JSON.parse(JSON.stringify(value));
const baseName=name=>String(name).replace(/\s*\((?:alternate art|overnumbered|signature|metal)\)\s*$/i,'').trim();
const displayName=name=>baseName(name).replace(/\s+-\s+/g,', ');
const languageCode=value=>{const normalized=normalize(value);return Object.entries(LANGUAGES).find(([code,data])=>normalize(code)===normalized||normalize(data[0])===normalized)?.[0]||'en'};

let database=null,originalCards=[],workingCards=[],catalog=[],catalogReady=false;
let sessionLog=[],searchTimer=null,currentEditor=null,allocations=[],importQueue=[],importCompleted=0,pendingCsvImport=false,csvImportRunning=false,lastImportedCsvText=null,catalogLoading=false;
let modalReturnFocus=null,zeroAllocationTemplate=null;

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2400)}

$('#loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const password=$('#adminPassword').value.trim(),error=$('#loginError');error.textContent='Checking…';
  try{const response=await fetch('api.php?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});if(!response.ok)throw new Error(response.status===401?'Incorrect password':'Login service unavailable');sessionStorage.setItem('riftarchive_admin','yes');error.textContent='';unlock()}catch(loginError){error.textContent=loginError.message}
});
$('#lockAdmin').addEventListener('click',async()=>{try{await fetch('api.php?action=logout',{method:'POST'})}catch(error){}sessionStorage.removeItem('riftarchive_admin');location.reload()});
restoreAdminSession();
async function restoreAdminSession(){
  if(sessionStorage.getItem('riftarchive_admin')!=='yes')return;
  try{const response=await fetch('api.php?action=session',{cache:'no-store'}),state=await response.json();if(state.authenticated)unlock();else sessionStorage.removeItem('riftarchive_admin')}catch(error){sessionStorage.removeItem('riftarchive_admin')}
}

async function unlock(){
  $('#loginGate').hidden=true;$('#adminShell').hidden=false;
  await loadDatabase();
  loadCatalog();
  if(new URLSearchParams(location.search).get('view')==='play')$('[data-admin-view="play"]').click();
}

async function loadDatabase(){
  try{
    try{const response=await fetch('api.php?action=collection',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);database=await response.json();if(!Array.isArray(database.cards))throw new Error('Invalid collection')}catch(serverError){const response=await fetch('cards.json',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);database=await response.json()}
    originalCards=clone(database.cards);
    const draft=localStorage.getItem('riftarchive_admin_draft');
    workingCards=draft?JSON.parse(draft).cards:clone(originalCards);
    updateWorkingUI();$('#catalogStatus').textContent=draft?'Working from saved browser draft':'Collection loaded · loading Riftcodex catalog';
  }catch(error){$('#catalogStatus').textContent='Could not load cards.json';$('.catalog-status').classList.add('error');console.error(error)}
}

async function loadCatalog(){
  if(catalogLoading)return;catalogLoading=true;
  try{
    const cached=JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY));
    if(Array.isArray(cached?.cards)&&cached.cards.length){catalog=cached.cards;catalogReady=true;$('.catalog-status').classList.add('ready');$('#catalogStatus').textContent=`Riftcodex cache ready · ${catalog.length} printings`}
  }catch(error){localStorage.removeItem(CATALOG_CACHE_KEY)}
  try{
    let all;
    try{
      const local=await fetchJson('api.php?action=catalog');
      if(!Array.isArray(local.items)||!local.items.length)throw new Error('Empty local catalog');
      all=local.items;
    }catch(proxyError){
      console.warn('Local catalog proxy unavailable; trying bundled snapshot',proxyError);
      try{
        const snapshot=await fetchJson('catalog.json');
        if(!Array.isArray(snapshot.items)||!snapshot.items.length)throw new Error('Empty catalog snapshot');
        all=snapshot.items;
      }catch(snapshotError){
        console.warn('Bundled catalog unavailable; trying Riftcodex directly',snapshotError);
        const first=await fetchJson(`${API}/cards?size=100&page=1&sort=name`);
        const requests=[];for(let page=2;page<=first.pages;page++)requests.push(fetchJson(`${API}/cards?size=100&page=${page}&sort=name`));
        const rest=await Promise.all(requests);all=[...first.items,...rest.flatMap(page=>page.items)];
      }
    }
    const seen=new Set();
    catalog=all.filter(card=>{const key=card.riftbound_id||card.id;if(seen.has(key))return false;seen.add(key);return true}).map(card=>({name:card.name,riftbound_id:card.riftbound_id||card.id,collector_number:card.collector_number,classification:card.classification,set:card.set,attributes:card.attributes,media:{image_url:card.media?.image_url},metadata:card.metadata,orientation:card.orientation,tags:card.tags||[],text:card.text||null}));
    catalogReady=true;try{localStorage.setItem(CATALOG_CACHE_KEY,JSON.stringify({savedAt:Date.now(),cards:catalog}))}catch(cacheError){console.warn('Could not cache Riftcodex catalog',cacheError)}$('.catalog-status').classList.add('ready');$('#catalogStatus').textContent=`Riftcodex ready · ${catalog.length} printings`;
  }catch(error){if(!catalogReady){$('.catalog-status').classList.add('error');$('#catalogStatus').textContent='Riftcodex catalog unavailable · CSV import is waiting';$('#importStatus').textContent='The card catalog could not be loaded. Keep this page open and try Import cards again.'}console.error(error)}
  catalogLoading=false;if(catalogReady&&pendingCsvImport)importCollectionCsv($('#importInput').value);
}
function checkResponse(response){if(!response.ok)throw new Error('HTTP '+response.status);return response}
async function fetchJson(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{return await fetch(url,{signal:controller.signal}).then(checkResponse).then(response=>response.json())}finally{clearTimeout(timer)}}

function updateWorkingUI(){
  $('#workingTotal').textContent=workingCards.reduce((sum,c)=>sum+Number(c.quantity||0),0);
  renderManage();renderSession();
}

$$('[data-admin-view]').forEach(button=>button.addEventListener('click',()=>{$$('[data-admin-view]').forEach(b=>b.classList.toggle('active',b===button));$$('.admin-view').forEach(view=>view.classList.toggle('active',view.id===button.dataset.adminView+'View'));const mode=button.dataset.adminView,wideMode=mode==='play';$('.admin-main').classList.toggle('play-mode',wideMode);$('[data-admin-home]')?.classList.toggle('active',!wideMode);if(mode==='manage')renderManage();if(mode==='play')document.dispatchEvent(new CustomEvent('riftarchive:tracker-open'))}));
$('[data-admin-home]')?.addEventListener('click',()=>{$('[data-admin-view=single]').click();$('[data-admin-home]').classList.add('active')});

$('#singleSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderSearch,180)});
function relevance(name,query){const n=normalize(baseName(name)),q=normalize(query);if(n===q)return 0;if(n.startsWith(q))return 1;if(n.includes(q))return 2;const tokens=q.split(' ');return 3+tokens.filter(t=>n.includes(t)).length*-0.1}
function groupedMatches(query){
  const q=normalize(query);if(!q)return[];
  const groups=new Map();
  catalog.filter(card=>normalize(baseName(card.name)).includes(q)||q.split(' ').every(t=>normalize(card.name).includes(t))).forEach(card=>{const key=normalize(baseName(card.name));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(card)});
  return [...groups.values()].sort((a,b)=>relevance(a[0].name,query)-relevance(b[0].name,query)||a[0].name.localeCompare(b[0].name)).slice(0,12);
}
function inventoryKey(name){return normalize(baseName(displayName(name)))}
function ownedRecordsFor(versions){
  const first=preferredVersion(versions),key=inventoryKey(first?.name||'');
  return workingCards.filter(card=>inventoryKey(card.name)===key);
}
function ownedQuantity(records){return records.reduce((sum,card)=>sum+Number(card.quantity||0),0)}
function renderSearch(){
  const query=$('#singleSearch').value.trim(),host=$('#searchResults');
  if(!query){host.innerHTML='<div class="admin-empty">The Riftcodex catalog will appear here as you type.</div>';return}
  if(!catalogReady){host.innerHTML='<div class="admin-empty">Riftcodex is still loading. Try again in a moment.</div>';return}
  const groups=groupedMatches(query);
  host.innerHTML=groups.length?groups.map((versions,index)=>{const card=preferredVersion(versions),owned=ownedQuantity(ownedRecordsFor(versions));return `<button class="search-result" type="button" data-result="${index}"><img src="${esc(card.media.image_url)}" alt="" loading="lazy" decoding="async"><span><strong>${esc(displayName(card.name))}</strong><small>${esc(card.set.label)} · ${esc(card.classification.type)} · ${esc((card.classification.domain||[]).join(' / '))}</small></span><span class="search-result-meta"><span class="owned-count-chip">${owned} owned</span><span class="version-count">${versions.length} version${versions.length===1?'':'s'}</span></span></button>`}).join(''):'<div class="admin-empty">No close Riftcodex match was found.</div>';
  $$('.search-result').forEach(button=>button.addEventListener('click',()=>openEditor({versions:groups[Number(button.dataset.result)],mode:'inventory'})));
}

function preferredVersion(versions){return versions.find(card=>!card.metadata?.alternate_art&&!card.metadata?.overnumbered&&!card.metadata?.signature&&!/\(Metal\)$/i.test(card.name))||versions[0]}
function versionLabel(card){if(card.metadata?.alternate_art)return'Alternate Art';if(card.metadata?.overnumbered)return'Overnumbered';if(card.metadata?.signature)return'Signature';if(/\(Metal\)$/i.test(card.name))return'Metal';if(card.classification?.rarity==='Promo')return'Promo';return'Standard'}
function versionOption(card){return `${versionLabel(card)} · ${card.set.set_id} #${card.collector_number} · ${card.classification.rarity}`}

function inventoryMetadata(card){return{condition:card.condition,grading:card.grading,notes:card.notes,importReference:card.import_reference}}
function allocationFromRecord(record,versions){
  const version=versions.find(card=>card.riftbound_id===record.riftbound_id)||preferredVersion(versions);
  return{versionId:version.riftbound_id,quantity:Math.max(1,Number(record.quantity)||1),language:record.language||'en',english:(record.language||'en')==='en',foil:Boolean(record.foil),sourceId:record.collection_id,inventoryMetadata:inventoryMetadata(record)};
}
function defaultAllocation(quantity=1){
  return{versionId:preferredVersion(currentEditor.versions).riftbound_id,quantity:Math.max(1,Number(quantity)||1),language:'fr',english:true,foil:false};
}
function openEditor(options){
  const versions=options.versions,first=preferredVersion(versions),existing=options.existing,inventoryMode=options.mode==='inventory';
  const ownedRecords=ownedRecordsFor(versions),baselineOwned=ownedQuantity(ownedRecords);
  currentEditor={...options,inventoryMode,ownedRecords,baselineOwned};
  allocations=options.initialAllocations?clone(options.initialAllocations):existing?[allocationFromRecord(existing,versions)]:inventoryMode&&ownedRecords.length?ownedRecords.map(card=>allocationFromRecord(card,versions)):[{versionId:first.riftbound_id,quantity:options.requested||1,language:'fr',english:true,foil:false}];
  const requested=inventoryMode?(baselineOwned||1):(options.requested||existing?.quantity||1);
  $('#requestedTotal').min=inventoryMode&&baselineOwned?'0':'1';$('#requestedTotal').value=requested;
  zeroAllocationTemplate=clone(allocations[0]||{versionId:first.riftbound_id,quantity:1,language:'fr',english:true,foil:false});
  $('#variantTitle').textContent=displayName(first.name);
  $('#variantStep').textContent=options.fromImport?`Import ${importCompleted+1} of ${importCompleted+importQueue.length+1}`:inventoryMode?'Collection inventory':existing?'Edit inventory record':'Configure inventory';
  const imported=options.inventoryMetadata,importDetails=imported?[imported.condition,imported.grading?.company&&`Graded by ${imported.grading.company}`,imported.notes].filter(Boolean).join(' · '):'';
  $('#variantHint').textContent=`${versions.length} printing${versions.length===1?'':'s'} available · split copies by printing, language, or finish${importDetails?' · '+importDetails:''}`;
  $('#selectedCard').innerHTML=`<img src="${esc(first.media.image_url)}" alt="" decoding="async"><div><strong>${esc(displayName(first.name))}</strong><small>${esc(first.set.label)} · ${esc((first.classification.domain||[]).join(' / '))}</small></div>`;
  $('#saveVariant').textContent=existing?'Save changes':options.fromImport?'Save and review next':'Add to working copy';
  modalReturnFocus=document.activeElement;document.body.classList.add('modal-open');$('#variantModal').hidden=false;renderAllocations();
  requestAnimationFrame(()=>$('#requestedTotal').focus());
}

function renderAllocations(){
  const host=$('#allocationList'),versions=currentEditor.versions;
  host.innerHTML=allocations.length?allocations.map((entry,index)=>`<div class="allocation-row" data-allocation="${index}">
    <div class="allocation-row-head"><span>Configuration ${index+1}</span><button class="remove-split" type="button" data-remove="${index}" ${allocations.length===1?'disabled':''}>Remove</button></div>
    <label class="allocation-field">Printing<select data-field="version">${versions.map(card=>`<option value="${esc(card.riftbound_id)}" ${card.riftbound_id===entry.versionId?'selected':''}>${esc(versionOption(card))}</option>`).join('')}</select></label>
    <label class="allocation-field">Quantity<input data-field="quantity" type="number" min="1" value="${entry.quantity}" inputmode="numeric"></label>
    <div class="allocation-options">
      <label class="choice-toggle"><input data-field="english" type="checkbox" ${entry.english?'checked':''}><span class="choice-box">✓</span><span>${flag('en')} English</span></label>
      <label class="choice-toggle"><input data-field="foil" type="checkbox" ${entry.foil?'checked':''}><span class="choice-box">✓</span><span>Foil finish</span></label>
      <label class="allocation-field language-select ${entry.english?'is-disabled':''}">Other language<select data-field="language" ${entry.english?'disabled':''}>${Object.entries(LANGUAGES).filter(([code])=>code!=='en').map(([code,data])=>`<option value="${code}" ${entry.language===code?'selected':''}>${flag(code)} ${data[0]}</option>`).join('')}</select></label>
    </div>
  </div>`).join(''):'<div class="allocation-empty"><strong>Zero copies selected.</strong><br>Saving will remove this card from the working collection.</div>';
  host.querySelectorAll('.allocation-row').forEach(row=>{
    row.addEventListener('input',event=>{if(event.target.dataset.field!=='quantity')return;const index=Number(row.dataset.allocation);allocations[index].quantity=Math.max(1,Number(event.target.value)||1);updateAllocationStatus()});
    row.addEventListener('change',event=>{const index=Number(row.dataset.allocation),field=event.target.dataset.field;if(!field||field==='quantity')return;if(field==='english'){allocations[index].english=event.target.checked;const language=row.querySelector('[data-field=language]');language.disabled=event.target.checked;language.closest('.language-select').classList.toggle('is-disabled',event.target.checked)}else if(field==='foil')allocations[index].foil=event.target.checked;else allocations[index][field]=event.target.value;updateAllocationStatus()});
  });
  host.querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>{const removed=allocations.splice(Number(button.dataset.remove),1)[0];if(allocations.length)allocations[0].quantity+=Number(removed.quantity||0);renderAllocations()}));
  updateAllocationStatus();
}

function updateAllocationStatus(){
  if(!currentEditor)return;
  const total=Math.max(0,Number($('#requestedTotal').value)||0),allocated=allocations.reduce((sum,row)=>sum+Number(row.quantity||0),0),status=$('#allocationStatus');
  const minimum=currentEditor.inventoryMode&&currentEditor.baselineOwned?0:1,valid=allocated===total&&total>=minimum;
  const existingQuantity=Number(currentEditor.existing?.quantity||0),after=currentEditor.inventoryMode?total:currentEditor.existing?currentEditor.baselineOwned-existingQuantity+total:currentEditor.baselineOwned+total;
  const delta=after-currentEditor.baselineOwned,recordCount=currentEditor.ownedRecords.length;
  $('#currentOwned').textContent=currentEditor.baselineOwned;$('#ownedBreakdown').textContent=recordCount?`${recordCount} inventory record${recordCount===1?'':'s'}`:'Not yet in the collection';
  $('#quantityLabel').textContent=currentEditor.inventoryMode?'Collection total':currentEditor.existing?'Record quantity':'Copies to add';
  $('#afterOwned').textContent=after;$('#inventoryDelta').textContent=delta===0?'No count change':`${delta>0?'+':''}${delta} cop${Math.abs(delta)===1?'y':'ies'}`;
  status.textContent=valid?`${allocated} ${allocated===1?'copy':'copies'} configured`:`Configure ${total-allocated>0?total-allocated+' more':Math.abs(total-allocated)+' fewer'} ${Math.abs(total-allocated)===1?'copy':'copies'}`;
  status.classList.toggle('is-valid',valid);status.classList.toggle('is-invalid',!valid);$('#saveVariant').disabled=!valid;
  $('#decreaseTotal').disabled=total<=minimum;$('#addSplit').disabled=total===0;
  if(currentEditor.inventoryMode)$('#saveVariant').textContent=total===0?'Remove from collection':currentEditor.baselineOwned?'Save collection':'Add to collection';
}
function setEditorTotal(value){
  if(!currentEditor)return;const minimum=currentEditor.inventoryMode&&currentEditor.baselineOwned?0:1,next=Math.min(999,Math.max(minimum,Math.round(Number(value)||0)));
  let allocated=allocations.reduce((sum,row)=>sum+Number(row.quantity||0),0);
  if(next>allocated){if(!allocations.length){const seed=clone(zeroAllocationTemplate||defaultAllocation(1));seed.quantity=next;allocations.push(seed)}else allocations[0].quantity+=next-allocated}
  else if(next<allocated){let remove=allocated-next;for(let index=allocations.length-1;index>=0&&remove>0;index--){const take=Math.min(remove,allocations[index].quantity);allocations[index].quantity-=take;remove-=take;if(allocations[index].quantity<=0)allocations.splice(index,1)}}
  $('#requestedTotal').value=next;renderAllocations();
}
$('#requestedTotal').addEventListener('input',updateAllocationStatus);
$('#requestedTotal').addEventListener('change',event=>setEditorTotal(event.target.value));
$('#decreaseTotal').addEventListener('click',()=>setEditorTotal((Number($('#requestedTotal').value)||0)-1));
$('#increaseTotal').addEventListener('click',()=>setEditorTotal((Number($('#requestedTotal').value)||0)+1));
$('#addSplit').addEventListener('click',()=>{let donor=allocations.find(row=>row.quantity>1);if(!donor){setEditorTotal((Number($('#requestedTotal').value)||0)+1);donor=allocations.find(row=>row.quantity>1)}if(donor)donor.quantity--;allocations.push(defaultAllocation(1));renderAllocations()});
$('#closeVariant').addEventListener('click',cancelEditor);$('#cancelVariant').addEventListener('click',cancelEditor);
$('#variantModal').addEventListener('click',event=>{if(event.target===$('#variantModal'))cancelEditor()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#variantModal').hidden)cancelEditor()});
function closeEditor(){$('#variantModal').hidden=true;document.body.classList.remove('modal-open');currentEditor=null;zeroAllocationTemplate=null;modalReturnFocus?.focus?.();modalReturnFocus=null}
function cancelEditor(){const continuing=currentEditor?.fromImport;closeEditor();if(continuing)openNextImport()}

function inventoryFromApi(card,allocation,suffix,inventoryMetadata){
  const language=allocation.english?'en':allocation.language,importedLabel=inventoryMetadata?.importReference?.variant_label,version=importedLabel&&normalize(importedLabel)!=='standard'?importedLabel:versionLabel(card);
  const record={collection_id:`${card.riftbound_id}-${language}-${normalize(version).replaceAll(' ','-')}-${allocation.foil?'foil':'nf'}-${Date.now()}-${suffix}`,name:displayName(card.name),quantity:Number(allocation.quantity),riftbound_id:card.riftbound_id,type:card.classification.type,supertype:card.classification.supertype||null,rarity:card.classification.rarity,domains:[...new Set(card.classification.domain||[])],set:{id:card.set.set_id,label:card.set.label},attributes:card.attributes||{energy:null,might:null,power:null},image_url:card.media.image_url,orientation:card.orientation||'portrait',version:{label:version,alternate_art:Boolean(card.metadata?.alternate_art),overnumbered:Boolean(card.metadata?.overnumbered),signature:Boolean(card.metadata?.signature)},foil:Boolean(allocation.foil),language};
  return inventoryMetadata?{...record,condition:inventoryMetadata.condition||null,grading:inventoryMetadata.grading||null,notes:inventoryMetadata.notes||null,import_reference:inventoryMetadata.importReference||null}:record;
}

$('#saveVariant').addEventListener('click',()=>{
  const total=Number($('#requestedTotal').value),allocated=allocations.reduce((sum,row)=>sum+Number(row.quantity),0);if(total!==allocated)return;
  const editor=currentEditor,existing=editor.existing,wasImport=editor.fromImport,inventoryMode=editor.inventoryMode;
  if(inventoryMode){const ownedIds=new Set(editor.ownedRecords.map(card=>card.collection_id));workingCards=workingCards.filter(card=>!ownedIds.has(card.collection_id))}
  else if(existing){const index=workingCards.findIndex(card=>card.collection_id===existing.collection_id);if(index>=0)workingCards.splice(index,1)}
  const added=allocations.map((allocation,index)=>{
    const metadata=allocation.inventoryMetadata||editor.inventoryMetadata||existing&&inventoryMetadata(existing);
    const apiCard=editor.versions.find(card=>card.riftbound_id===allocation.versionId)||preferredVersion(editor.versions);
    const card=inventoryFromApi(apiCard,allocation,index,metadata);
    // Keep the first record's stable ID while editing so older session entries remain clickable.
    if(allocation.sourceId)card.collection_id=allocation.sourceId;else if(existing&&index===0)card.collection_id=existing.collection_id;
    return card;
  });
  workingCards.push(...added);
  if(inventoryMode&&!added.length){const removed=editor.ownedRecords[0];if(removed)sessionLog.unshift({action:'removed',collectionId:removed.collection_id,name:removed.name,snapshot:removed})}
  else added.forEach(card=>sessionLog.unshift({action:inventoryMode&&editor.baselineOwned||existing?'edited':'added',collectionId:card.collection_id,name:card.name}));
  const message=inventoryMode?(total===0?'Card removed from working collection':editor.baselineOwned?'Collection count updated':'Card added to working collection'):existing?'Inventory record updated':'Card added to working copy';
  closeEditor();if(wasImport)importCompleted++;
  updateWorkingUI();if(inventoryMode)renderSearch();toast(message);if(wasImport)openNextImport();
});

function parseImport(text){
  const grouped=new Map();
  text.split(/\r?\n/).forEach(raw=>{const line=raw.trim();if(!line||/^[^\d]+:\s*$/.test(line))return;const match=line.match(/^(\d+)\s*[x×]?\s+(.+)$/i);if(!match)return;const name=match[2].trim(),key=normalize(name);if(!grouped.has(key))grouped.set(key,{name,quantity:0});grouped.get(key).quantity+=Number(match[1])});
  return[...grouped.values()];
}

function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let index=0;index<text.length;index++){
    const character=text[index];
    if(quoted){if(character==='"'&&text[index+1]==='"'){field+='"';index++}else if(character==='"')quoted=false;else field+=character;continue}
    if(character==='"'){quoted=true;continue}
    if(character===','){row.push(field);field='';continue}
    if(character==='\n'){row.push(field);if(row.some(value=>value.trim()))rows.push(row);row=[];field='';continue}
    if(character!=='\r')field+=character;
  }
  row.push(field);if(row.some(value=>value.trim()))rows.push(row);
  if(!rows.length)return[];
  const headers=rows.shift().map((header,index)=>(index===0?header.replace(/^\uFEFF/,''):header).trim());
  return rows.map(values=>Object.fromEntries(headers.map((header,index)=>[header,(values[index]||'').trim()])));
}

function isCollectionCsv(text){return /^\s*(?:\uFEFF)?Variant Number\s*,\s*Card Name\s*,/i.test(text)}
function csvImportItems(text){
  return parseCsv(text).map((row,index)=>{
    const quantity=Math.max(1,Number.parseInt(row.Quantity,10)||1),language=languageCode(row.Language),grading=[row['Grading Company'],row['Grading Value'],row['Grading Label']].some(Boolean)?{company:row['Grading Company']||null,value:row['Grading Value']||null,label:row['Grading Label']||null}:null,nexusNight=/-Nexus$/i.test(row['Variant Number'])||/-NN$/i.test(row['Set Prefix']),notes=[row.Notes,nexusNight?`Nexus Night ×${quantity}`:''].filter(Boolean).join(' · ')||null;
    return{name:row['Card Name'],quantity,variantNumber:row['Variant Number'],setPrefix:row['Set Prefix'],setName:row.Set,rarity:row.Rarity,foil:String(row.Foil).toLowerCase()==='true',language,sourceRow:index+2,inventoryMetadata:{condition:row.Condition||null,grading,notes,importReference:{variant_number:row['Variant Number']||null,variant_type:row['Variant Type']||null,variant_label:row['Variant Label']||null}}};
  }).filter(item=>item.name&&item.variantNumber);
}
function collectorKey(value){const raw=String(value??'').trim().toUpperCase();return /^\d+$/.test(raw)?String(Number(raw)):raw.replace(/^0+(?=\d)/,'')}
function csvVersions(item){
  const [numberPrefix,...numberParts]=item.variantNumber.split('-'),prefixes=[item.setPrefix,numberPrefix].filter(Boolean).map(value=>value.toUpperCase()),collector=collectorKey(numberParts[0]);
  const exact=catalog.filter(card=>prefixes.includes(String(card.set?.set_id||'').toUpperCase())&&collectorKey(card.collector_number)===collector);
  if(exact.length)return exact;
  return catalog.filter(card=>normalize(baseName(card.name))===normalize(item.name)&&(!prefixes.length||prefixes.includes(String(card.set?.set_id||'').toUpperCase())));
}
function inventoryFromCsvFallback(item,index){
  const reference=item.inventoryMetadata.importReference,version=reference.variant_label||reference.variant_type||'Standard',language=item.language||'en',setId=(item.variantNumber.split('-')[0]||item.setPrefix||'').toUpperCase();
  return{collection_id:`${normalize(item.variantNumber)}-${language}-${normalize(version)}-${item.foil?'foil':'nf'}-${Date.now()}-${index}`,name:item.name,quantity:item.quantity,riftbound_id:item.variantNumber.toLowerCase(),type:/-[Tt]\d+/.test(item.variantNumber)?'Token':'Card',rarity:item.rarity||'Unknown',domains:[],set:{id:setId,label:item.setName||setId},attributes:{energy:null,might:null,power:null},image_url:'card-placeholder.svg',orientation:'portrait',version:{label:version,alternate_art:false,overnumbered:false,signature:false},foil:item.foil,language,condition:item.inventoryMetadata.condition||null,grading:item.inventoryMetadata.grading||null,notes:item.inventoryMetadata.notes||null,import_reference:reference};
}

$('#importFile').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  $('#importFileName').textContent=file.name;
  $('#importInput').value=await file.text();
  pendingCsvImport=isCollectionCsv($('#importInput').value);
  $('#importStatus').textContent=pendingCsvImport?`Loaded ${file.name} · ${catalogReady?'importing now':'waiting for the card catalog'}`:`Loaded ${file.name} · click Import cards to continue`;
  if(pendingCsvImport&&catalogReady)importCollectionCsv($('#importInput').value);
});
$('#analyzeImport').addEventListener('click',()=>{
  const text=$('#importInput').value,csv=isCollectionCsv(text);
  if(!text.trim()){$('#importStatus').textContent='Choose a CSV or paste a card list first.';return}
  if(!catalogReady){pendingCsvImport=csv;$('#importStatus').textContent='Waiting for the Riftcodex card catalog. The import will start automatically when it is ready.';loadCatalog();return}
  if(csv){importCollectionCsv(text);return}
  const items=parseImport(text),missing=[];importQueue=[];
  items.forEach(item=>{const versions=catalog.filter(card=>normalize(baseName(card.name))===normalize(item.name));versions.length?importQueue.push({...item,versions}):missing.push(item.name)});
  importCompleted=0;$('#importStatus').textContent=`${importQueue.length} cards ready for review${missing.length?' · Not found: '+missing.join(', '):''}`;
  openNextImport();
});
function importCollectionCsv(text){
  if(csvImportRunning)return;
  if(text===lastImportedCsvText){$('#importStatus').textContent='This CSV has already been imported into the current working copy. Clear it before importing again.';return}
  csvImportRunning=true;pendingCsvImport=false;
  try{
    const items=csvImportItems(text),fallback=[],added=[];
    items.forEach((item,index)=>{
      const versions=csvVersions(item),selected=versions.find(card=>normalize(baseName(card.name))===normalize(item.name))||versions[0];
      if(!selected){fallback.push(`${item.variantNumber} ${item.name}`);added.push(inventoryFromCsvFallback(item,index));return}
      added.push(inventoryFromApi(selected,{versionId:selected.riftbound_id,quantity:item.quantity,language:item.language,english:item.language==='en',foil:item.foil},index,item.inventoryMetadata));
    });
    workingCards.push(...added);added.forEach(card=>sessionLog.unshift({action:'added',collectionId:card.collection_id,name:card.name}));lastImportedCsvText=text;
    localStorage.setItem('riftarchive_admin_draft',JSON.stringify({...database,cards:workingCards}));updateWorkingUI();
    const copies=added.reduce((sum,card)=>sum+card.quantity,0),fallbackPreview=fallback.slice(0,6).join(', ');
    $('#importStatus').textContent=`Imported ${added.length} inventory rows · ${copies} cards · browser draft saved${fallback.length?` · ${fallback.length} catalog-missing cards used placeholders: ${fallbackPreview}${fallback.length>6?'…':''}`:''}`;
    toast(`Imported ${copies} cards into the working copy`);
  }catch(error){$('#importStatus').textContent=`CSV import failed: ${error.message}`;console.error(error)}finally{csvImportRunning=false}
}
function openNextImport(){if(!importQueue.length){if(importCompleted)toast(`Import review complete · ${importCompleted} cards configured`);return}const item=importQueue.shift();openEditor({versions:item.versions,requested:item.quantity,mode:'add',fromImport:true,initialAllocations:item.initialAllocations,inventoryMetadata:item.inventoryMetadata})}
$('#clearImport').addEventListener('click',()=>{$('#importInput').value='';$('#importFile').value='';$('#importFileName').textContent='No file selected';$('#importStatus').textContent='';importQueue=[];pendingCsvImport=false;lastImportedCsvText=null});

function renderManage(){
  const host=$('#manageList');if(!host)return;const query=normalize($('#manageSearch').value),items=workingCards.filter(card=>!query||normalize(card.name).includes(query)).sort((a,b)=>a.name.localeCompare(b.name));
  host.innerHTML=items.length?items.slice(0,250).map(card=>`<div class="manage-row"><img src="${esc(card.image_url)}" alt=""><div class="manage-name"><strong>${esc(card.name)}</strong><small>${flag(card.language)} ${esc(card.version?.label||'Standard')}${card.foil?' · Foil':''}${card.condition?' · '+esc(card.condition):''}${card.grading?.company?' · '+esc(card.grading.company):''}</small></div><span>${esc(card.set?.id)} · ${esc(card.type)}</span><strong>×${card.quantity}</strong><span><button data-edit="${esc(card.collection_id)}">Edit</button> <button class="remove" data-remove-card="${esc(card.collection_id)}">Remove</button></span></div>`).join(''):'<div class="admin-empty">No matching inventory records.</div>';
  $$('[data-edit]').forEach(button=>button.addEventListener('click',()=>editInventory(button.dataset.edit)));
  $$('[data-remove-card]').forEach(button=>button.addEventListener('click',()=>removeInventory(button.dataset.removeCard)));
}
$('#manageSearch').addEventListener('input',renderManage);
function versionsForInventory(card){const exact=catalog.filter(item=>normalize(baseName(item.name))===normalize(card.name));return exact.length?exact:[{name:card.name,riftbound_id:card.riftbound_id,collector_number:'—',classification:{type:card.type,supertype:card.supertype||null,rarity:card.rarity,domain:card.domains},set:{set_id:card.set.id,label:card.set.label},attributes:card.attributes,media:{image_url:card.image_url},metadata:card.version||{},orientation:card.orientation}]}
function editInventory(id){const card=workingCards.find(item=>item.collection_id===id);if(card)openEditor({versions:versionsForInventory(card),requested:card.quantity,existing:card,mode:'edit'})}
function removeInventory(id){const index=workingCards.findIndex(card=>card.collection_id===id);if(index<0)return;const card=workingCards[index];if(!confirm(`Remove ${card.quantity}× ${card.name} from the working copy?`))return;workingCards.splice(index,1);sessionLog.unshift({action:'removed',name:card.name,snapshot:card});updateWorkingUI();toast('Card removed from working copy')}

function renderSession(){
  const host=$('#sessionList');$('#sessionCount').textContent=sessionLog.length;
  host.innerHTML=sessionLog.length?sessionLog.map((log,index)=>{const card=workingCards.find(item=>item.collection_id===log.collectionId)||log.snapshot;return`<button class="session-item ${log.action==='removed'?'removed':''}" data-session="${index}" ${log.action==='removed'?'disabled':''}><img src="${esc(card?.image_url||'')}" alt=""><span><strong>${esc(log.name)}</strong><small>${card?flag(card.language)+' '+esc(card.version?.label||'Standard')+(card.foil?' · Foil':'')+' ×'+card.quantity:''}</small></span><span class="action">${log.action}</span></button>`}).join(''):'<div class="admin-empty">No changes yet.</div>';
  $$('[data-session]:not(:disabled)').forEach(button=>button.addEventListener('click',()=>{const log=sessionLog[Number(button.dataset.session)];editInventory(log.collectionId)}));
}

$('#exportJson').addEventListener('click',()=>{
  const output={...database,schema_version:3,updated_at:new Date().toISOString(),cards:workingCards};
  const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='cards.json';link.click();URL.revokeObjectURL(url);toast('Updated cards.json downloaded');
});
$('#saveDraft').addEventListener('click',async()=>{
  const button=$('#saveDraft'),output={...database,schema_version:3,updated_at:new Date().toISOString(),cards:workingCards};button.disabled=true;button.textContent='Publishing…';
  try{
    const response=await fetch('api.php?action=collection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({database:output})}),result=await response.json();
    if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);
    database=output;originalCards=clone(workingCards);localStorage.removeItem('riftarchive_admin_draft');$('#catalogStatus').textContent=`Published collection · ${result.copies} cards`;toast('Collection published for every device');
  }catch(error){toast(`Publish failed: ${error.message}`)}finally{button.disabled=false;button.textContent='Publish collection'}
});
$('#discardDraft').addEventListener('click',()=>{if(!confirm('Discard all unexported session changes?'))return;localStorage.removeItem('riftarchive_admin_draft');workingCards=clone(originalCards);sessionLog=[];updateWorkingUI();toast('Working changes discarded')});
