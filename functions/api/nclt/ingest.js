import { json, readJson, clean, validDate } from '../../_lib/http.js';
import { requireWatch, normalizeIa } from '../../_lib/watch.js';
function sameIa(a,b){ return normalizeIa(a) && normalizeIa(a)===normalizeIa(b); }

export async function onRequestPost(context) {
  const denied=requireWatch(context); if(denied)return denied;
  let body; try{body=await readJson(context.request);}catch{return json({error:'Invalid JSON'},400);}
  const matterId=Number(body.matter_id);
  const matter=await context.env.DB.prepare('SELECT * FROM matters WHERE id=?1').bind(matterId).first();
  if(!matter||!matter.nclt_watch_enabled)return json({error:'Matter is not enabled for NCLT watch'},404);
  const sourceUrl=clean(body.source_url,1200);
  const upstreamErrors=(Array.isArray(body.errors)?body.errors:[]).map(x=>clean(String(x||''),500)).filter(Boolean).slice(0,30);
  const sh=body.source_health||{};
  const caseStatus=clean(sh.case_status,60)||'unknown', causeStatus=clean(sh.cause_list,60)||'unknown';
  const coverage=clean(sh.coverage_level,80)||'degraded';
  const docsScanned=Math.max(0,Number(sh.cause_docs_scanned||0));
  const firstSync=!matter.nclt_last_checked_at;
  const run=await context.env.DB.prepare(`INSERT INTO nclt_sync_runs(matter_id,status,source_url,started_at,source_case_status,source_cause_status,coverage_level,cause_docs_scanned) VALUES(?1,'running',?2,datetime('now'),?3,?4,?5,?6)`)
    .bind(matterId,sourceUrl,caseStatus,causeStatus,coverage,docsScanned).run();
  const runId=run.meta.last_row_id;
  let newApplications=0,newOrders=0,importedApplications=0,importedOrders=0;
  try{
    const detectedSlug=clean(body.detected_bench_slug,80);
    if(detectedSlug&&!matter.nclt_bench_slug){await context.env.DB.prepare('UPDATE matters SET nclt_bench_slug=?1 WHERE id=?2').bind(detectedSlug,matterId).run();}
    const existingApps=(await context.env.DB.prepare('SELECT * FROM applications WHERE matter_id=?1').bind(matterId).all()).results;
    for(const item of (body.applications||[])){
      const label=clean(item.ia_number,180); if(!label)continue;
      let existing=existingApps.find(x=>sameIa(x.ia_number,label));
      const causeDate=validDate(item.cause_list_date), causeUrl=clean(item.cause_list_url,1400), vcUrl=clean(item.vc_url,1400);
      if(existing){
        const useCause = causeDate && (!existing.cause_list_date || causeDate >= existing.cause_list_date);
        await context.env.DB.prepare(`UPDATE applications SET last_seen_at=datetime('now'),source_reference=COALESCE(source_reference,?1),official_url=COALESCE(official_url,?2),cause_list_url=CASE WHEN ?3=1 THEN ?4 ELSE cause_list_url END,vc_url=CASE WHEN ?3=1 THEN ?5 ELSE vc_url END,cause_list_date=CASE WHEN ?3=1 THEN ?6 ELSE cause_list_date END WHERE id=?7`)
          .bind(clean(item.source_reference,1200),clean(item.official_url,1200),useCause?1:0,causeUrl,vcUrl,causeDate,existing.id).run();
        if(useCause){existing.cause_list_url=causeUrl;existing.vc_url=vcUrl;existing.cause_list_date=causeDate;}
        continue;
      }
      const markNew=firstSync?0:1;
      const r=await context.env.DB.prepare(`INSERT INTO applications(matter_id,ia_number,title,status,bench,next_hearing_date,next_hearing_notes,notes,official_url,source,source_reference,detected_at,is_new,last_seen_at,cause_list_url,vc_url,cause_list_date,created_at,updated_at) VALUES(?1,?2,?3,'Pending',?4,?5,?6,?7,?8,'NCLT',?9,datetime('now'),?10,datetime('now'),?11,?12,?13,datetime('now'),datetime('now'))`)
        .bind(matterId,label,clean(item.title,500),clean(item.bench,150),validDate(item.next_hearing_date),clean(item.next_hearing_notes,2000),clean(item.notes,4000),clean(item.official_url,1200),clean(item.source_reference,1200),markNew,causeUrl,vcUrl,causeDate).run();
      existing={id:r.meta.last_row_id,ia_number:label};existingApps.push(existing);importedApplications++;if(markNew)newApplications++;
    }
    for(const item of (body.orders||[])){
      const url=clean(item.source_url,1400);if(!url)continue;const fingerprint=clean(item.fingerprint,300)||url;
      let order=await context.env.DB.prepare('SELECT * FROM nclt_orders WHERE matter_id=?1 AND fingerprint=?2').bind(matterId,fingerprint).first();
      if(!order){const markNew=firstSync?0:1;const r=await context.env.DB.prepare(`INSERT INTO nclt_orders(matter_id,order_date,order_type,title,source_url,fingerprint,ia_numbers,is_new,discovered_at,last_seen_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,datetime('now'),datetime('now'))`).bind(matterId,validDate(item.order_date),clean(item.order_type,120),clean(item.title,600),url,fingerprint,clean((item.ia_numbers||[]).join(' · '),2000),markNew).run();order={id:r.meta.last_row_id};importedOrders++;if(markNew)newOrders++;}
      else await context.env.DB.prepare("UPDATE nclt_orders SET last_seen_at=datetime('now') WHERE id=?1").bind(order.id).run();
      for(const label of (item.ia_numbers||[])){const app=existingApps.find(x=>sameIa(x.ia_number,label));if(app)await context.env.DB.prepare('INSERT OR IGNORE INTO nclt_order_applications(order_id,application_id) VALUES(?1,?2)').bind(order.id,app.id).run();}
    }
    const nextListing=validDate(body.next_listing_date), upstreamSummary=upstreamErrors.join('\n').slice(0,3000)||null;
    const causeMeta=body.cause_list||{};
    const causeDate=validDate(causeMeta.cause_list_date), causeUrl=clean(causeMeta.cause_list_url,1400), vcUrl=clean(causeMeta.vc_url,1400);
    const useCause = causeDate && (!matter.nclt_cause_list_date || causeDate >= matter.nclt_cause_list_date);
    const anySourceOk=caseStatus==='success'||causeStatus==='success';
    const fullHealthy=caseStatus==='success'&&causeStatus==='success'&&coverage==='full';
    const health=fullHealthy?'healthy':(anySourceOk?'limited':'failed');
    const syncStatus=health==='healthy'&&upstreamErrors.length===0?'success':(anySourceOk?'partial':'failed');
    const failures=anySourceOk?0:Number(matter.nclt_consecutive_failures||0)+1;
    await context.env.DB.prepare(`UPDATE matters SET nclt_last_checked_at=datetime('now'),nclt_last_error=?1,nclt_next_listing_date=?2,nclt_coverage_level=?3,nclt_watch_health=?4,nclt_source_case_status=?5,nclt_source_cause_status=?6,nclt_last_successful_check_at=CASE WHEN ?7=1 THEN datetime('now') ELSE nclt_last_successful_check_at END,nclt_last_full_check_at=CASE WHEN ?8=1 THEN datetime('now') ELSE nclt_last_full_check_at END,nclt_consecutive_failures=?9,nclt_cause_list_url=CASE WHEN ?10=1 THEN ?11 ELSE nclt_cause_list_url END,nclt_vc_url=CASE WHEN ?10=1 THEN ?12 ELSE nclt_vc_url END,nclt_cause_list_date=CASE WHEN ?10=1 THEN ?13 ELSE nclt_cause_list_date END,updated_at=datetime('now') WHERE id=?14`)
      .bind(upstreamSummary,nextListing,coverage,health,caseStatus,causeStatus,anySourceOk?1:0,fullHealthy?1:0,failures,useCause?1:0,causeUrl,vcUrl,causeDate,matterId).run();
    await context.env.DB.prepare(`UPDATE nclt_sync_runs SET status=?1,finished_at=datetime('now'),new_applications=?2,new_orders=?3,error_summary=?4,source_case_status=?5,source_cause_status=?6,coverage_level=?7,cause_docs_scanned=?8 WHERE id=?9`)
      .bind(syncStatus,newApplications,newOrders,upstreamSummary,caseStatus,causeStatus,coverage,docsScanned,runId).run();
    return json({ok:true,status:syncStatus,health,coverage_level:coverage,first_sync:firstSync,new_applications:newApplications,new_orders:newOrders,imported_applications:importedApplications,imported_orders:importedOrders,errors:upstreamErrors});
  }catch(e){
    const msg=(e.message||String(e)).slice(0,3000);const failures=Number(matter.nclt_consecutive_failures||0)+1;
    await context.env.DB.prepare(`UPDATE matters SET nclt_last_checked_at=datetime('now'),nclt_last_error=?1,nclt_watch_health='failed',nclt_consecutive_failures=?2 WHERE id=?3`).bind(msg,failures,matterId).run();
    await context.env.DB.prepare(`UPDATE nclt_sync_runs SET status='failed',finished_at=datetime('now'),error_summary=?1 WHERE id=?2`).bind(msg,runId).run();
    return json({error:msg},500);
  }
}
