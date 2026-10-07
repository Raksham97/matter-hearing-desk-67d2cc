const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={dashboard:null,currentMatter:null};
const APP_STATUSES=['Pending','Listed','Part-heard','Reserved','Allowed','Dismissed','Disposed','Withdrawn','Closed'];
const NCLT_CAUSE_LIST='https://nclt.gov.in/all-cause-list';

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{'content-type':'application/json',...(opts.headers||{})}});let j={};try{j=await r.json();}catch{}if(r.status===401){showLogin();throw new Error('Session expired');}if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);return j;}
function showLogin(){$('#appView').classList.add('hidden');$('#loginView').classList.remove('hidden');}
function showApp(){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');}
function canonicalDate(value){
  if(!value)return null;
  const s=String(value).trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if(m)return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
function dateSerial(value){const iso=canonicalDate(value);if(!iso)return null;const [y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000;}
function daysUntil(value){const a=dateSerial(today()),b=dateSerial(value);return a===null||b===null?null:Math.round(b-a);}
function fmtDate(value){const iso=canonicalDate(value);if(!iso)return '—';const [y,m,d]=iso.split('-');return `${d}-${m}-${y}`;}
function parseUtc(s){if(!s)return NaN;const v=String(s).includes('T')?String(s):String(s).replace(' ','T')+'Z';return Date.parse(v);}
function ncltCaseUrl(m){if(!m?.nclt_filing_no||!m?.nclt_bench_slug)return '';try{return `https://efiling.nclt.gov.in/nclt/public/details.php?filing_no=${encodeURIComponent(btoa(`${m.nclt_filing_no}/${m.nclt_bench_slug}`))}`;}catch{return '';}}
function watchState(m){if(!String(m?.forum||'').toUpperCase().includes('NCLT'))return {key:'na',label:'—',cls:''};const t=parseUtc(m.nclt_last_checked_at);const stale=!Number.isFinite(t)||Date.now()-t>10*3600000;if(stale||m.nclt_watch_health==='failed')return {key:'degraded',label:'DEGRADED',cls:'watch-bad'};if(m.nclt_watch_health==='healthy'&&m.nclt_coverage_level==='full')return {key:'full',label:'FULL',cls:'watch-full'};return {key:'limited',label:'LIMITED',cls:'watch-limited'};}
function sourceLabel(v){const x=String(v||'unknown');return x==='success'?'OK':x==='unconfigured'?'Not configured':x==='identity_mismatch'?'Identity mismatch':x==='failed'?'Failed':x;}
function openModal(html){$('#modalHost').innerHTML=`<div class="modalback" id="modalBack"><div class="modal">${html}</div></div>`;$('#modalBack').addEventListener('click',e=>{if(e.target.id==='modalBack')closeModal();});}
function closeModal(){$('#modalHost').innerHTML='';}
function statusOptions(current='',includeNoChange=false){return `${includeNoChange?'<option value="">Do not change IA status</option>':''}${APP_STATUSES.map(s=>`<option ${current===s?'selected':''}>${esc(s)}</option>`).join('')}`;}
function exactCauseAccess(x){const c=canonicalDate(x?.cause_list_date),h=canonicalDate(x?.next_hearing_date);return Boolean(c&&h&&c===h&&x.cause_list_url);}
function accessButtons(x){if(!exactCauseAccess(x))return `<span class="pending-link">Cause list not published/matched yet</span>`;return `<a class="access-btn" href="${esc(x.cause_list_url)}" target="_blank" rel="noopener">Cause list</a>${x.vc_url?`<a class="access-btn vc" href="${esc(x.vc_url)}" target="_blank" rel="noopener">Join VC</a>`:''}`;}
function nextForMatter(m){const ds=[m.application_next_hearing,m.next_hearing_date].map(canonicalDate).filter(x=>x&&daysUntil(x)!==null&&daysUntil(x)>=0).sort();return ds[0]||null;}
function hasPastDate(m){return [m.application_next_hearing,m.next_hearing_date].map(canonicalDate).some(x=>x&&daysUntil(x)!==null&&daysUntil(x)<0);}
function matterNextLabel(m){const n=nextForMatter(m);return n?fmtDate(n):(hasPastDate(m)?'Past date — update needed':'—');}
function compactIaRefs(value){
  const parts=String(value||'').split(/\s*[·,]\s*/).map(x=>x.trim()).filter(Boolean);
  if(!parts.length)return '';
  const shown=parts.slice(0,2).join(' · ');
  return parts.length>2?`${shown} · +${parts.length-2} more`:shown;
}
function activateMatterTab(name){
  $$('.matter-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  $$('.matter-tab-panel').forEach(p=>p.classList.toggle('hidden',p.dataset.panel!==name));
}

async function loadDashboard(){const j=await api(`/api/dashboard?today=${today()}`);state.dashboard=j;renderDashboard(j);}
function renderDashboard(j){
  showApp();
  $('#sUpcoming').textContent=j.upcoming.length;
  $('#sOrders').textContent=Number(j.order_count||0);
  $('#sActive').textContent=j.matters.filter(m=>m.status==='Active').length;

  $('#upcomingList').innerHTML=j.upcoming.map(x=>{
    const d=daysUntil(x.next_hearing_date),urgent=d!==null&&d<=2,bench=x.application_bench||x.bench||'—';
    return `<article class="hearing-card">
      <div class="date-tile ${urgent?'urgent':''}"><strong>${fmtDate(x.next_hearing_date)}</strong><span>${d===0?'Today':d===1?'Tomorrow':`${d} days`}</span></div>
      <div class="hearing-main"><a class="matter-name matter-open" data-id="${x.id}" href="#">${esc(x.short_name||x.cause_title)}</a><div class="ia">${esc(x.ia_number||'Main matter')}</div>${x.application_title?`<div class="muted">${esc(x.application_title)}</div>`:''}</div>
      <div class="hearing-bench"><b>Bench</b>${esc(bench)}</div>
      <div class="hearing-note"><b>Prep</b>${esc(x.next_hearing_notes||'No prep note')}</div>
      <div class="hearing-actions">${accessButtons(x)}<button class="primary mini log-row" data-matter="${x.id}" data-app="${x.application_id||''}">Log update</button></div>
    </article>`;
  }).join('')||'<div class="empty-card">No hearings entered for the next 7 days.</div>';

  $('#recentOrders').innerHTML=(j.recent_orders||[]).map(o=>`<article class="dashboard-order">
    <div class="dashboard-order-main"><a class="matter-name matter-open" data-id="${o.matter_id}" href="#">${esc(o.short_name||o.cause_title)}</a><div class="dashboard-order-title">${esc(o.title||o.order_type||'NCLT order')}</div><div class="dashboard-order-meta">${fmtDate(o.order_date)}${o.ia_numbers?` · ${esc(compactIaRefs(o.ia_numbers))}`:''}</div></div>
    <a class="access-btn" href="${esc(o.source_url)}" target="_blank" rel="noopener">Open order</a>
  </article>`).join('')||'<div class="empty-card">No NCLT orders imported yet.</div>';

  const sortedMatters=[...j.matters].sort((a,b)=>{const af=nextForMatter(a),bf=nextForMatter(b);if(af&&bf)return af.localeCompare(bf)||(a.cause_title||'').localeCompare(b.cause_title||'');if(af)return -1;if(bf)return 1;return (a.cause_title||'').localeCompare(b.cause_title||'');});
  $('#mattersGrid').innerHTML=sortedMatters.map(m=>`<article class="matter-card matter-open" data-id="${m.id}">
    <div class="matter-card-top"><div><h3>${esc(m.short_name||m.cause_title)}</h3><div class="muted">${esc(m.case_number||m.cause_title)}</div></div></div>
    <div class="matter-meta"><span>${esc(m.bench||m.forum||'—')}</span><span>•</span><span class="${m.status==='Active'?'active':'archived'}">${esc(m.status)}</span></div>
    <div class="matter-bottom"><div class="matter-metric"><span>Open IAs</span><b>${Number(m.open_application_count||0)}</b></div><div class="matter-metric"><span>Next hearing</span><b>${matterNextLabel(m)}</b></div><div class="matter-metric"><span>Orders</span><b>${Number(m.order_count||0)}</b></div></div>
  </article>`).join('')||'<div class="empty-card">No matters yet. Add the first matter.</div>';

  $('#recentBody').innerHTML=j.recent.map(h=>`<tr><td>${fmtDate(h.hearing_date)}</td><td><a class="link matter-open" data-id="${h.matter_id}" href="#">${esc(h.cause_title)}</a></td><td>${esc(h.application_numbers||h.ia_number||'Main matter')}</td><td>${esc(h.outcome||'—')}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No hearing history yet.</td></tr>';
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
  const j=await api(`/api/matters/${id}`);state.currentMatter=j;const m=j.matter,apps=j.applications||[],orders=j.nclt_orders||[],caseUrl=ncltCaseUrl(m);
  const openApps=apps.filter(a=>!['Disposed','Allowed','Dismissed','Withdrawn','Closed'].includes(a.status));
  const allNextDates=[...openApps.map(a=>a.next_hearing_date).filter(Boolean),m.next_hearing_date].filter(Boolean);
  const futureNextDates=allNextDates.filter(d=>daysUntil(d)!==null&&daysUntil(d)>=0).sort();
  const next=futureNextDates[0]||null;
  const pastOnly=!next&&allNextDates.some(d=>daysUntil(d)!==null&&daysUntil(d)<0);

  const appRows=apps.map(a=>{const exact=a.cause_list_date&&a.next_hearing_date&&a.cause_list_date===a.next_hearing_date&&a.cause_list_url;return `<tr><td><b>${esc(a.ia_number)}</b>${a.title?`<br><span class="muted">${esc(a.title)}</span>`:''}</td><td class="${['Disposed','Allowed','Dismissed','Withdrawn','Closed'].includes(a.status)?'archived':'active'}">${esc(a.status)}</td><td>${fmtDate(a.next_hearing_date)}</td><td>${esc(a.next_hearing_notes||'—')}</td><td>${exact?`<a class="access-btn" href="${esc(a.cause_list_url)}" target="_blank" rel="noopener">Cause list</a> ${a.vc_url?`<a class="access-btn vc" href="${esc(a.vc_url)}" target="_blank" rel="noopener">VC</a>`:''}`:'<span class="muted">—</span>'}</td><td class="nowrap"><button class="mini secondary edit-app" data-id="${a.id}">Edit</button> <button class="mini danger delete-app" data-id="${a.id}">Delete</button></td></tr>`;}).join('');

  const hearingCard=h=>`<div class="hearing compact-hearing"><div class="meta"><strong>${fmtDate(h.hearing_date)}</strong><span class="pill">${esc(h.application_numbers||h.ia_number||'Main matter')}</span>${h.bench?`<span class="muted">${esc(h.bench)}</span>`:''}</div>${h.outcome?`<div class="hearing-line"><b>Outcome:</b> ${esc(h.outcome)}</div>`:''}${h.notes?`<div class="hearing-line muted">${esc(h.notes)}</div>`:''}${h.next_hearing_date?`<div class="hearing-line"><b>Next:</b> ${fmtDate(h.next_hearing_date)}${h.next_hearing_notes?' · '+esc(h.next_hearing_notes):''}</div>`:''}${h.order_url?`<div class="hearing-line"><a class="link" target="_blank" rel="noopener" href="${esc(h.order_url)}">Open order</a></div>`:''}<div class="hearing-actions"><button class="mini secondary edit-hearing" data-id="${h.id}">Edit</button> <button class="mini danger delete-hearing" data-id="${h.id}">Delete</button></div></div>`;
  const recentHearings=j.hearings.slice(0,5).map(hearingCard).join('');
  const olderHearings=j.hearings.slice(5).map(hearingCard).join('');

  const orderRows=orders.map(o=>{const refs=compactIaRefs(o.application_numbers||o.ia_numbers||'');return `<div class="order-row"><div class="order-row-date">${fmtDate(o.order_date)}</div><div class="order-row-main"><b>${esc(o.title||o.order_type||'NCLT order')}</b>${refs?`<div class="muted order-refs">${esc(refs)}</div>`:''}</div><a class="access-btn" href="${esc(o.source_url)}" target="_blank" rel="noopener">Open</a></div>`;}).join('');

  openModal(`<div class="modal-head"><div><h2 class="matter-title">${esc(m.short_name||m.cause_title)}</h2><div class="case-subtitle">${esc(m.case_number||m.cause_title)}</div></div><button class="secondary" id="closeMatter">Close</button></div>
  <div class="matter-toolbar"><button class="primary" id="addHearing">+ Log hearing</button><button class="secondary" id="addApplication">+ Add IA</button><button class="secondary" id="editMatter">Edit matter</button></div>
  <div class="summary-chips"><span class="summary-chip">${esc(m.bench||m.forum||'—')}</span><span class="summary-chip">${openApps.length} open IA${openApps.length===1?'':'s'}</span><span class="summary-chip">${next?`Next: ${fmtDate(next)}`:(pastOnly?'Past date — update needed':'Next: —')}</span><span class="summary-chip ${m.status==='Active'?'active':''}">${esc(m.status)}</span></div>

  <nav class="matter-tabs" aria-label="Matter sections">
    <button class="matter-tab active" data-tab="hearings">Last 5 hearing notes</button>
    <button class="matter-tab" data-tab="ias">IAs (${apps.length})</button>
    <button class="matter-tab" data-tab="orders">Orders (${orders.length})</button>
  </nav>

  <section class="matter-tab-panel" data-panel="hearings">
    <div class="tab-panel-head"><h3>Last 5 hearing notes</h3><span class="muted">Most recent first</span></div>
    <div class="timeline">${recentHearings||'<div class="empty">No hearings logged yet.</div>'}</div>
    ${olderHearings?`<details class="collapsible compact"><summary>Older hearing history (${Math.max(0,j.hearings.length-5)})</summary><div class="collapsible-body timeline">${olderHearings}</div></details>`:''}
  </section>

  <section class="matter-tab-panel hidden" data-panel="ias">
    <div class="tab-panel-head"><h3>IAs / applications (${apps.length})</h3></div>
    <div class="tablewrap"><table><thead><tr><th>IA / application</th><th>Status</th><th>Next</th><th>Prep</th><th>Access</th><th></th></tr></thead><tbody>${appRows||'<tr><td colspan="6" class="empty">No IAs yet. Use “+ Add IA”.</td></tr>'}</tbody></table></div>
  </section>

  <section class="matter-tab-panel hidden" data-panel="orders">
    <div class="tab-panel-head"><h3>NCLT orders (${orders.length})</h3><span class="muted">Official links</span></div>
    <div class="compact-order-list">${orderRows||'<div class="empty">No NCLT orders imported yet.</div>'}</div>
  </section>

  <details class="collapsible"><summary>Matter details</summary><div class="collapsible-body kv"><b>Full cause title</b><span>${esc(m.cause_title)}</span><b>Forum</b><span>${esc(m.forum||'—')}</span><b>Bench</b><span>${esc(m.bench||'—')}</span><b>Client / role</b><span>${esc(m.client_role||'—')}</span><b>General notes</b><span>${esc(m.notes||'—')}</span>${m.official_case_url?`<b>Official link</b><span><a class="link" href="${esc(m.official_case_url)}" target="_blank" rel="noopener">Open</a></span>`:''}${caseUrl?`<b>NCLT case history</b><span><a class="link" href="${esc(caseUrl)}" target="_blank" rel="noopener">Open official case history</a></span>`:''}</div></details>
  <details class="collapsible"><summary>More actions</summary><div class="collapsible-body"><button class="danger" id="deleteMatter">Delete broader matter</button></div></details>`);

  $('#closeMatter').onclick=closeModal;
  $$('.matter-tab').forEach(b=>b.onclick=()=>activateMatterTab(b.dataset.tab));
  $('#editMatter').onclick=()=>{openModal(matterForm(m));bindMatterForm(m);};
  $('#addApplication').onclick=()=>{openModal(applicationForm(m));bindApplicationForm(m);};
  $('#addHearing').onclick=()=>{openModal(hearingForm(m,apps));bindHearingForm(m,apps);};
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
