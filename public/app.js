const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={dashboard:null,currentMatter:null};
const APP_STATUSES=['Pending','Listed','Part-heard','Reserved','Allowed','Dismissed','Disposed','Withdrawn','Closed'];
const NCLT_CAUSE_LIST='https://nclt.gov.in/all-cause-list';

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{'content-type':'application/json',...(opts.headers||{})}});let j={};try{j=await r.json();}catch{}if(r.status===401){showLogin();throw new Error('Session expired');}if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);return j;}
function showLogin(){$('#appView').classList.add('hidden');$('#loginView').classList.remove('hidden');}
function showApp(){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');}
function daysUntil(iso){if(!iso)return null;const a=new Date(today()+'T00:00:00'),b=new Date(iso+'T00:00:00');return Math.round((b-a)/86400000);}
function fmtDate(s){if(!s)return '—';const [y,m,d]=s.split('-');return `${d}-${m}-${y}`;}
function parseUtc(s){if(!s)return NaN;const v=String(s).includes('T')?String(s):String(s).replace(' ','T')+'Z';return Date.parse(v);}
function ncltCaseUrl(m){if(!m?.nclt_filing_no||!m?.nclt_bench_slug)return '';try{return `https://efiling.nclt.gov.in/nclt/public/details.php?filing_no=${encodeURIComponent(btoa(`${m.nclt_filing_no}/${m.nclt_bench_slug}`))}`;}catch{return '';}}
function watchState(m){if(!String(m?.forum||'').toUpperCase().includes('NCLT'))return {key:'na',label:'—',cls:''};const t=parseUtc(m.nclt_last_checked_at);const stale=!Number.isFinite(t)||Date.now()-t>10*3600000;if(stale||m.nclt_watch_health==='failed')return {key:'degraded',label:'DEGRADED',cls:'watch-bad'};if(m.nclt_watch_health==='healthy'&&m.nclt_coverage_level==='full')return {key:'full',label:'FULL',cls:'watch-full'};return {key:'limited',label:'LIMITED',cls:'watch-limited'};}
function sourceLabel(v){const x=String(v||'unknown');return x==='success'?'OK':x==='unconfigured'?'Not configured':x==='identity_mismatch'?'Identity mismatch':x==='failed'?'Failed':x;}
function openModal(html){$('#modalHost').innerHTML=`<div class="modalback" id="modalBack"><div class="modal">${html}</div></div>`;$('#modalBack').addEventListener('click',e=>{if(e.target.id==='modalBack')closeModal();});}
function closeModal(){$('#modalHost').innerHTML='';}
function statusOptions(current='',includeNoChange=false){return `${includeNoChange?'<option value="">Do not change IA status</option>':''}${APP_STATUSES.map(s=>`<option ${current===s?'selected':''}>${esc(s)}</option>`).join('')}`;}
function exactCauseAccess(x){return Boolean(x?.cause_list_date&&x?.next_hearing_date&&x.cause_list_date===x.next_hearing_date&&x.cause_list_url);}
function accessButtons(x){if(!exactCauseAccess(x))return `<span class="pending-link">Cause list not published/matched yet</span>`;return `<a class="access-btn" href="${esc(x.cause_list_url)}" target="_blank" rel="noopener">Cause list</a>${x.vc_url?`<a class="access-btn vc" href="${esc(x.vc_url)}" target="_blank" rel="noopener">Join VC</a>`:''}`;}
function nextForMatter(m){return m.application_next_hearing||m.next_hearing_date||m.nclt_next_listing_date||null;}

async function loadDashboard(){const j=await api(`/api/dashboard?today=${today()}`);state.dashboard=j;renderDashboard(j);}
function renderDashboard(j){
  showApp();
  const alerts=j.nclt_alerts||{new_applications:[],new_orders:[],count:0};
  $('#sUpcoming').textContent=j.upcoming.length;
  $('#sUpdates').textContent=alerts.count||0;
  $('#sActive').textContent=j.matters.filter(m=>m.status==='Active').length;

  const wh=j.watch_health||{overall:'warning',total:0,healthy:0,limited:0,failed:0,stale:0,full:0};
  const pill=$('#syncPill'),hb=$('#ncltHealth');
  if(!wh.total){pill.className='sync-pill';pill.textContent='NCLT watch ready';hb.classList.add('hidden');}
  else if(wh.overall==='healthy'){pill.className='sync-pill good';pill.textContent='NCLT synced';hb.classList.add('hidden');hb.innerHTML='';}
  else{const bad=wh.failed||wh.stale;pill.className=`sync-pill ${bad?'bad':'warn'}`;pill.textContent=bad?'NCLT needs attention':'NCLT limited';hb.classList.remove('hidden');hb.className=`watch-health ${bad?'health-bad':'health-limited'}`;hb.innerHTML=`<div><strong>${bad?'NCLT source warning':'NCLT coverage limited'}</strong><br><span>${wh.full}/${wh.total} matters FULL · ${wh.stale} stale · ${wh.failed} failed</span></div><div class="health-help">Open the affected matter for source details.</div>`;}

  const alertBox=$('#ncltAlert');
  if(alerts.count){
    const appN=alerts.new_applications.length,ordN=alerts.new_orders.length;
    const names=[...new Set([...alerts.new_applications,...alerts.new_orders].map(x=>x.short_name||x.cause_title))].slice(0,4);
    alertBox.classList.remove('hidden');
    alertBox.innerHTML=`<div><strong>Action needed</strong><br><span>${appN} IA detection${appN===1?'':'s'} · ${ordN} order update${ordN===1?'':'s'}${names.length?` · ${names.map(esc).join(', ')}`:''}</span></div><button class="secondary mini" id="reviewAllNclt">Mark reviewed</button>`;
    $('#reviewAllNclt').onclick=async()=>{if(!confirm('Mark all current NCLT alerts as reviewed?'))return;await api('/api/nclt/review',{method:'POST',body:'{}'});await loadDashboard();};
  }else{alertBox.classList.add('hidden');alertBox.innerHTML='';}

  $('#upcomingList').innerHTML=j.upcoming.map(x=>{
    const d=daysUntil(x.next_hearing_date),urgent=d!==null&&d<=2,bench=x.application_bench||x.bench||'—';
    return `<article class="hearing-card">
      <div class="date-tile ${urgent?'urgent':''}"><strong>${fmtDate(x.next_hearing_date)}</strong><span>${d===0?'Today':d===1?'Tomorrow':`${d} days`}</span></div>
      <div class="hearing-main"><a class="matter-name matter-open" data-id="${x.id}" href="#">${esc(x.short_name||x.cause_title)}</a><div class="ia">${esc(x.ia_number||'Main matter')}</div>${x.application_title?`<div class="muted">${esc(x.application_title)}</div>`:''}</div>
      <div class="hearing-bench"><b>Bench</b>${esc(bench)}</div>
      <div class="hearing-note"><b>Prep</b>${esc(x.next_hearing_notes||'No prep note')}</div>
      <div class="hearing-actions">${accessButtons(x)}<button class="primary mini log-row" data-matter="${x.id}" data-app="${x.application_id||''}">Log update</button></div>
    </article>`;
  }).join('')||'<div class="empty-card">No hearings in the next 7 days.</div>';

  $('#mattersGrid').innerHTML=j.matters.map(m=>{const ws=watchState(m),next=nextForMatter(m),nnew=Number(m.new_application_count||0)+Number(m.new_order_count||0);return `<article class="matter-card matter-open" data-id="${m.id}">
    <div class="matter-card-top"><div><h3>${esc(m.short_name||m.cause_title)}</h3><div class="muted">${esc(m.case_number||m.cause_title)}</div></div><div>${nnew?`<span class="newbadge">${nnew} UPDATE${nnew===1?'':'S'}</span>`:ws.key!=='full'&&ws.key!=='na'?`<span class="watch-badge ${ws.cls}">${ws.label}</span>`:''}</div></div>
    <div class="matter-meta"><span>${esc(m.bench||m.forum||'—')}</span><span>•</span><span class="${m.status==='Active'?'active':'archived'}">${esc(m.status)}</span></div>
    <div class="matter-bottom"><div class="matter-metric"><span>Open IAs</span><b>${Number(m.open_application_count||0)}</b></div><div class="matter-metric"><span>Next hearing</span><b>${fmtDate(next)}</b></div><div class="matter-metric"><span>NCLT</span><b>${ws.key==='full'?'Synced':ws.label}</b></div></div>
  </article>`;}).join('')||'<div class="empty-card">No matters yet. Add the first matter.</div>';

  $('#recentBody').innerHTML=j.recent.map(h=>`<tr><td>${fmtDate(h.hearing_date)}</td><td><a class="link matter-open" data-id="${h.matter_id}" href="#">${esc(h.cause_title)}</a></td><td>${esc(h.application_numbers||'Main matter')}</td><td>${esc(h.outcome||'—')}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No hearing history yet.</td></tr>';
  bindDashboardActions();
}
function bindDashboardActions(){
  $$('.matter-open').forEach(el=>el.onclick=e=>{e.preventDefault();openMatter(Number(el.dataset.id));});
  $$('.log-row').forEach(b=>b.onclick=async()=>{const id=Number(b.dataset.matter),appId=Number(b.dataset.app||0);await openQuickHearing(id,appId||null);});
}

function matterForm(m={}){return `<div class="modal-head"><div><h2>${m.id?'Edit matter':'Add matter'}</h2><div class="muted">Broader matter details</div></div></div><form id="matterForm"><div class="formgrid">
<div class="full"><label>Cause title / broader matter *</label><input name="cause_title" required value="${esc(m.cause_title||'')}" placeholder="e.g. Videocon Industries CIRP"></div>
<div><label>Short name</label><input name="short_name" value="${esc(m.short_name||'')}" placeholder="e.g. Videocon"></div><div><label>Status</label><select name="status"><option ${m.status!=='Archived'?'selected':''}>Active</option><option ${m.status==='Archived'?'selected':''}>Archived</option></select></div>
<div><label>Forum</label><select name="forum"><option ${m.forum==='NCLT'?'selected':''}>NCLT</option><option ${m.forum==='NCLAT'?'selected':''}>NCLAT</option><option ${m.forum==='Other'?'selected':''}>Other</option></select></div><div><label>Bench</label><input name="bench" value="${esc(m.bench||'')}" placeholder="e.g. Mumbai - Bench I"></div>
<div><label>Main case number</label><input name="case_number" value="${esc(m.case_number||'')}"></div><div><label>Client / role</label><input name="client_role" value="${esc(m.client_role||'')}"></div>
<div><label>Main-matter next date</label><input type="date" name="next_hearing_date" value="${esc(m.next_hearing_date||'')}"></div><div><label>Prep note</label><input name="next_hearing_notes" value="${esc(m.next_hearing_notes||'')}"></div>
<div class="full"><label>General matter notes</label><textarea name="notes">${esc(m.notes||'')}</textarea></div><div class="full"><label>Official case / tribunal URL</label><input type="url" name="official_case_url" value="${esc(m.official_case_url||'')}"></div>
</div>
<details class="collapsible"><summary>NCLT matching details</summary><div class="collapsible-body formgrid"><div><label>Filing / diary number</label><input name="nclt_filing_no" value="${esc(m.nclt_filing_no||'')}" placeholder="e.g. 2709138010212022"><span class="field-help">Used for exact case-history/order matching.</span></div><div><label>Bench slug</label><input name="nclt_bench_slug" value="${esc(m.nclt_bench_slug||'')}" placeholder="e.g. mumbai"><span class="field-help">Usually set automatically; edit only if needed.</span></div></div></details>
<div class="modal-actions"><button type="button" class="secondary" id="cancelModal">Cancel</button><button class="primary">Save matter</button></div></form>`;}
function bindMatterForm(m={}){$('#cancelModal').onclick=closeModal;$('#matterForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));try{let id=m.id;if(id)await api(`/api/matters/${id}`,{method:'PUT',body:JSON.stringify(f)});else id=(await api('/api/matters',{method:'POST',body:JSON.stringify(f)})).id;closeModal();await loadDashboard();await openMatter(id);}catch(err){alert(err.message);}};}

function applicationForm(m,a={}){return `<div class="modal-head"><div><h2>${a.id?'Edit IA / application':'Add IA / application'}</h2><div class="muted">${esc(m.short_name||m.cause_title)}</div></div></div><form id="applicationForm"><div class="formgrid">
<div><label>IA / application number *</label><input name="ia_number" required value="${esc(a.ia_number||'')}" placeholder="e.g. IA 2984 of 2026"></div><div><label>Status</label><select name="status">${statusOptions(a.status||'Pending')}</select></div>
<div class="full"><label>Title / purpose</label><input name="title" value="${esc(a.title||'')}"></div><div><label>Bench</label><input name="bench" value="${esc(a.bench||m.bench||'')}"></div><div><label>Next hearing</label><input type="date" name="next_hearing_date" value="${esc(a.next_hearing_date||'')}"></div>
<div class="full"><label>Prep / next-hearing note</label><textarea name="next_hearing_notes">${esc(a.next_hearing_notes||'')}</textarea></div><div class="full"><label>Internal IA note</label><textarea name="notes">${esc(a.notes||'')}</textarea></div><div class="full"><label>Official URL</label><input type="url" name="official_url" value="${esc(a.official_url||'')}"></div>
</div><div class="modal-actions"><button type="button" class="secondary" id="cancelModal">Cancel</button><button class="primary">Save IA</button></div></form>`;}
function bindApplicationForm(m,a={}){$('#cancelModal').onclick=()=>openMatter(m.id);$('#applicationForm').onsubmit=async e=>{e.preventDefault();const f={...Object.fromEntries(new FormData(e.target)),matter_id:m.id};try{if(a.id)await api(`/api/applications/${a.id}`,{method:'PUT',body:JSON.stringify(f)});else await api('/api/applications',{method:'POST',body:JSON.stringify(f)});await loadDashboard();await openMatter(m.id);}catch(err){alert(err.message);}};}

function appChecks(apps,selected=[]){const set=new Set(selected.map(Number));if(!apps.length)return '<div class="notice full">No IA has been added yet; this will be logged against the main matter.</div>';return `<div class="full"><label>IA(s) heard</label><div class="checkgrid">${apps.map(a=>`<label class="checkitem"><input type="checkbox" name="application_ids" value="${a.id}" ${set.has(a.id)?'checked':''}><span><b>${esc(a.ia_number)}</b>${a.title?`<br><span class="muted">${esc(a.title)}</span>`:''}</span></label>`).join('')}</div></div>`;}
function hearingForm(m,apps,h={},preselected=[]){const selected=h.id?(h.application_ids_csv||'').split(',').filter(Boolean).map(Number):preselected;return `<div class="modal-head"><div><h2>${h.id?'Edit hearing':'Log hearing'}</h2><div class="muted">${esc(m.short_name||m.cause_title)}</div></div></div><form id="hearingForm"><input type="hidden" name="matter_id" value="${m.id}"><div class="formgrid">
<div><label>Hearing date *</label><input type="date" name="hearing_date" required value="${esc(h.hearing_date||today())}"></div><div><label>Bench</label><input name="bench" value="${esc(h.bench||m.bench||'')}"></div>${appChecks(apps,selected)}
<div class="full"><label>Outcome *</label><textarea name="outcome" required placeholder="Short result / direction">${esc(h.outcome||'')}</textarea></div><div class="full"><label>Hearing notes</label><textarea name="notes" placeholder="Anything else worth recording">${esc(h.notes||'')}</textarea></div>
<div><label>Next hearing date</label><input type="date" name="next_hearing_date" value="${esc(h.next_hearing_date||'')}"></div><div><label>Update IA status</label><select name="application_status">${statusOptions('',true)}</select></div><div class="full"><label>Prep for next hearing</label><textarea name="next_hearing_notes">${esc(h.next_hearing_notes||'')}</textarea></div>
<div><label>Order URL</label><input type="url" name="order_url" value="${esc(h.order_url||'')}"></div><div><label>Order title</label><input name="order_title" value="${esc(h.order_title||'')}"></div>
</div><div class="modal-actions"><button type="button" class="secondary" id="cancelModal">Cancel</button><button class="primary">${h.id?'Save changes':'Save hearing'}</button></div></form>`;}
function bindHearingForm(m,apps,h={}){$('#cancelModal').onclick=()=>openMatter(m.id);$('#hearingForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),f=Object.fromEntries(fd);f.application_ids=fd.getAll('application_ids').map(Number);try{if(h.id)await api(`/api/hearings/${h.id}`,{method:'PUT',body:JSON.stringify(f)});else await api('/api/hearings',{method:'POST',body:JSON.stringify(f)});await loadDashboard();await openMatter(m.id);}catch(err){alert(err.message);}};}
async function openQuickHearing(matterId,applicationId=null){const j=await api(`/api/matters/${matterId}`);openModal(hearingForm(j.matter,j.applications||[],{},applicationId?[applicationId]:[]));bindHearingForm(j.matter,j.applications||[]);}

async function openMatter(id){
  const j=await api(`/api/matters/${id}`);state.currentMatter=j;const m=j.matter,apps=j.applications||[],orders=j.nclt_orders||[],ws=watchState(m),caseUrl=ncltCaseUrl(m);
  const openApps=apps.filter(a=>!['Disposed','Allowed','Dismissed','Withdrawn','Closed'].includes(a.status));
  const next=[...openApps.map(a=>a.next_hearing_date).filter(Boolean),m.next_hearing_date,m.nclt_next_listing_date].filter(Boolean).sort()[0]||null;
  const appRows=apps.map(a=>{const exact=a.cause_list_date&&a.next_hearing_date&&a.cause_list_date===a.next_hearing_date&&a.cause_list_url;return `<tr><td><b>${esc(a.ia_number)}</b>${a.is_new?' <span class="newbadge">NEW</span>':''}${a.title?`<br><span class="muted">${esc(a.title)}</span>`:''}</td><td class="${['Disposed','Allowed','Dismissed','Withdrawn','Closed'].includes(a.status)?'archived':'active'}">${esc(a.status)}</td><td>${fmtDate(a.next_hearing_date)}</td><td>${esc(a.next_hearing_notes||'—')}</td><td>${exact?`<a class="access-btn" href="${esc(a.cause_list_url)}" target="_blank" rel="noopener">Cause list</a> ${a.vc_url?`<a class="access-btn vc" href="${esc(a.vc_url)}" target="_blank" rel="noopener">VC</a>`:''}`:'<span class="muted">—</span>'}</td><td class="nowrap"><button class="mini secondary edit-app" data-id="${a.id}">Edit</button> <button class="mini danger delete-app" data-id="${a.id}">Delete</button></td></tr>`;}).join('');
  const hist=j.hearings.map(h=>`<div class="hearing"><div class="meta"><strong>${fmtDate(h.hearing_date)}</strong><span class="pill">${esc(h.application_numbers||h.ia_number||'Main matter')}</span>${h.bench?`<span class="muted">${esc(h.bench)}</span>`:''}</div>${h.outcome?`<div><b>Outcome:</b> ${esc(h.outcome)}</div>`:''}${h.notes?`<div class="muted">${esc(h.notes)}</div>`:''}${h.next_hearing_date?`<div><b>Next:</b> ${fmtDate(h.next_hearing_date)}${h.next_hearing_notes?' · '+esc(h.next_hearing_notes):''}</div>`:''}${h.order_url?`<div><a class="link" target="_blank" rel="noopener" href="${esc(h.order_url)}">Open order</a></div>`:''}<div class="hearing-actions"><button class="mini secondary edit-hearing" data-id="${h.id}">Edit</button> <button class="mini danger delete-hearing" data-id="${h.id}">Delete</button></div></div>`).join('');
  const orderRows=orders.map(o=>`<div class="order-card"><div class="order-meta"><strong>${fmtDate(o.order_date)}</strong>${o.is_new?' <span class="newbadge">NEW</span>':''}<span class="pill">${esc(o.application_numbers||o.ia_numbers||'Main / unallocated')}</span></div><div>${esc(o.title||o.order_type||'NCLT order')}</div><a class="link" href="${esc(o.source_url)}" target="_blank" rel="noopener">Open official order</a></div>`).join('');
  const newN=apps.filter(a=>a.is_new).length+orders.filter(o=>o.is_new).length;
  openModal(`<div class="modal-head"><div><h2 class="matter-title">${esc(m.short_name||m.cause_title)}</h2><div class="case-subtitle">${esc(m.case_number||m.cause_title)}</div></div><button class="secondary" id="closeMatter">Close</button></div>
  <div class="matter-toolbar"><button class="primary" id="addHearing">+ Log hearing</button><button class="secondary" id="addApplication">+ Add IA</button><button class="secondary" id="editMatter">Edit matter</button>${newN?`<button class="secondary" id="reviewNclt">Mark ${newN} NCLT update${newN===1?'':'s'} reviewed</button>`:''}</div>
  <div class="summary-chips"><span class="summary-chip">${esc(m.bench||m.forum||'—')}</span><span class="summary-chip">${openApps.length} open IA${openApps.length===1?'':'s'}</span><span class="summary-chip">Next: ${fmtDate(next)}</span><span class="summary-chip ${m.status==='Active'?'active':''}">${esc(m.status)}</span></div>

  <section class="matter-section"><h3>IAs / applications (${apps.length})</h3><div class="tablewrap"><table><thead><tr><th>IA / application</th><th>Status</th><th>Next</th><th>Prep</th><th>Access</th><th></th></tr></thead><tbody>${appRows||'<tr><td colspan="6" class="empty">No IAs yet. Use “+ Add IA”.</td></tr>'}</tbody></table></div></section>

  <details class="collapsible" ${orders.some(o=>o.is_new)?'open':''}><summary>NCLT orders (${orders.length})${orders.some(o=>o.is_new)?' · NEW':''}</summary><div class="collapsible-body">${orderRows||'<div class="empty">No NCLT orders imported yet.</div>'}</div></details>
  <details class="collapsible"><summary>Hearing history (${j.hearings.length})</summary><div class="collapsible-body timeline">${hist||'<div class="empty">No hearings logged yet.</div>'}</div></details>
  <details class="collapsible"><summary>Matter details</summary><div class="collapsible-body kv"><b>Full cause title</b><span>${esc(m.cause_title)}</span><b>Forum</b><span>${esc(m.forum||'—')}</span><b>Bench</b><span>${esc(m.bench||'—')}</span><b>Client / role</b><span>${esc(m.client_role||'—')}</span><b>General notes</b><span>${esc(m.notes||'—')}</span>${m.official_case_url?`<b>Official link</b><span><a class="link" href="${esc(m.official_case_url)}" target="_blank" rel="noopener">Open</a></span>`:''}</div></details>
  <details class="collapsible"><summary>NCLT sync status · ${ws.label}</summary><div class="collapsible-body"><div class="watch-detail ${ws.cls}"><strong>${ws.label} COVERAGE</strong><span>${ws.key==='full'?'Exact case history + cause-list surveillance verified.':ws.key==='limited'?'Monitoring is active but one exact source is limited.':'Automated NCLT source needs attention.'}</span></div><div class="kv"><b>Case-history source</b><span>${esc(sourceLabel(m.nclt_source_case_status))}</span><b>Cause-list source</b><span>${esc(sourceLabel(m.nclt_source_cause_status))}</span><b>Last checked</b><span>${esc(m.nclt_last_checked_at||'—')}</span><b>Last FULL check</b><span>${esc(m.nclt_last_full_check_at||'—')}</span><b>Failures</b><span>${Number(m.nclt_consecutive_failures||0)}</span>${caseUrl?`<b>Official NCLT case history</b><span><a class="link" href="${esc(caseUrl)}" target="_blank" rel="noopener">Open</a></span>`:''}${m.nclt_last_error?`<b>Last issue</b><span class="watch-err">${esc(m.nclt_last_error)}</span>`:''}</div></div></details>
  <details class="collapsible"><summary>More actions</summary><div class="collapsible-body"><button class="danger" id="deleteMatter">Delete broader matter</button></div></details>`);

  $('#closeMatter').onclick=closeModal;
  $('#editMatter').onclick=()=>{openModal(matterForm(m));bindMatterForm(m);};
  $('#addApplication').onclick=()=>{openModal(applicationForm(m));bindApplicationForm(m);};
  $('#addHearing').onclick=()=>{openModal(hearingForm(m,apps));bindHearingForm(m,apps);};
  if($('#reviewNclt'))$('#reviewNclt').onclick=async()=>{await api('/api/nclt/review',{method:'POST',body:JSON.stringify({matter_id:m.id})});await loadDashboard();await openMatter(m.id);};
  $('#deleteMatter').onclick=async()=>{const label=m.short_name||m.cause_title;const typed=prompt(`This permanently deletes “${label}” and its IA/hearing history.\n\nType DELETE to confirm.`);if(typed!=='DELETE')return;await api(`/api/matters/${m.id}`,{method:'DELETE'});closeModal();await loadDashboard();};
  $$('.edit-app').forEach(b=>b.onclick=()=>{const a=apps.find(x=>x.id===Number(b.dataset.id));openModal(applicationForm(m,a));bindApplicationForm(m,a);});
  $$('.delete-app').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this IA/application?'))return;await api(`/api/applications/${b.dataset.id}`,{method:'DELETE'});await loadDashboard();await openMatter(id);});
  $$('.edit-hearing').forEach(b=>b.onclick=()=>{const h=j.hearings.find(x=>x.id===Number(b.dataset.id));openModal(hearingForm(m,apps,h));bindHearingForm(m,apps,h);});
  $$('.delete-hearing').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this hearing entry?'))return;await api(`/api/hearings/${b.dataset.id}`,{method:'DELETE'});await loadDashboard();await openMatter(id);});
}

async function exportData(kind){const d=await api('/api/export-data');if(kind==='json'){const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='matter-desk-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}else{MatterDeskXLSX.downloadWorkbook(d);}}
async function init(){const s=await api('/api/session').catch(()=>({authenticated:false}));if(s.authenticated)await loadDashboard();else showLogin();}

$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});$('#password').value='';await loadDashboard();}catch(err){$('#loginError').textContent=err.message;}};
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST',body:'{}'}).catch(()=>{});showLogin();};
$('#addMatterBtn').onclick=()=>{openModal(matterForm());bindMatterForm();};
$('#quickHearingBtn').onclick=()=>{const ms=state.dashboard?.matters?.filter(m=>m.status==='Active')||[];if(!ms.length){alert('Add a matter first.');return;}openModal(`<div class="modal-head"><div><h2>Log hearing</h2><div class="muted">Choose the broader matter</div></div></div><div class="formgrid"><div class="full"><label>Matter</label><select id="quickMatter">${ms.map(m=>`<option value="${m.id}">${esc(m.short_name||m.cause_title)}</option>`).join('')}</select></div></div><div class="modal-actions"><button class="secondary" id="cancelModal">Cancel</button><button class="primary" id="continueHearing">Continue</button></div>`);$('#cancelModal').onclick=closeModal;$('#continueHearing').onclick=()=>openQuickHearing(Number($('#quickMatter').value));};
$('#exportExcelBtn').onclick=()=>exportData('xlsx').catch(e=>alert(e.message));
$('#backupBtn').onclick=()=>exportData('json').catch(e=>alert(e.message));
init();
