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
  const run=await context.env.DB.prepare(`INSERT INTO nclt_sync_runs(matter_id,status,source_url,started_at,source_case_status,source_cause_status,coverage_level,cause_docs_scanned) VALUES(?1,'running',?2,datetime('now'),?3,?4,?5,?6)`)
    .bind(matterId,sourceUrl,caseStatus,causeStatus,coverage,docsScanned).run();
  const runId=run.meta.last_row_id;
  let linkedApplications=0,importedOrders=0;
  try{
    const detectedSlug=clean(body.detected_bench_slug,80);
    if(detectedSlug&&!matter.nclt_bench_slug){await context.env.DB.prepare('UPDATE matters SET nclt_bench_slug=?1 WHERE id=?2').bind(detectedSlug,matterId).run();}

    // Recipient-facing IA/application records are user-managed only. The watcher is
    // allowed to enrich an existing manual IA with the exact-dated cause-list / VC
    // link, but it must never create a new IA, alter its status, or invent its date.
    const existingApps=(await context.env.DB.prepare("SELECT * FROM applications WHERE matter_id=?1 AND upper(COALESCE(source,'manual'))!='NCLT'").bind(matterId).all()).results;
    for(const item of (body.applications||[])){
      const label=clean(item.ia_number,180); if(!label)continue;
      const existing=existingApps.find(x=>sameIa(x.ia_number,label));
      if(!existing)continue;
      const causeDate=validDate(item.cause_list_date), causeUrl=clean(item.cause_list_url,1400), vcUrl=clean(item.vc_url,1400);
      const useCause=Boolean(causeDate&&existing.next_hearing_date&&causeDate===existing.next_hearing_date&&causeUrl);
      await context.env.DB.prepare(`UPDATE applications SET
        last_seen_at=datetime('now'),
        cause_list_url=CASE WHEN ?1=1 THEN ?2 WHEN cause_list_date=next_hearing_date THEN cause_list_url ELSE NULL END,
        vc_url=CASE WHEN ?1=1 THEN ?3 WHEN cause_list_date=next_hearing_date THEN vc_url ELSE NULL END,
        cause_list_date=CASE WHEN ?1=1 THEN ?4 WHEN cause_list_date=next_hearing_date THEN cause_list_date ELSE NULL END,
        updated_at=datetime('now') WHERE id=?5`)
        .bind(useCause?1:0,causeUrl,vcUrl,causeDate,existing.id).run();
      if(useCause)linkedApplications++;
    }

    // Orders are background-sourced, but recipient-facing and always retained. All
    // order links discovered on the exact verified case-history page are upserted;
    // PDF parsing is optional enrichment, not a prerequisite for displaying the order.
    for(const item of (body.orders||[])){
      const url=clean(item.source_url,1400);if(!url)continue;const fingerprint=clean(item.fingerprint,300)||url;
      const orderDate=validDate(item.order_date),orderType=clean(item.order_type,120),title=clean(item.title,600),iaText=clean((item.ia_numbers||[]).join(' · '),2000);
      let order=await context.env.DB.prepare('SELECT * FROM nclt_orders WHERE matter_id=?1 AND fingerprint=?2').bind(matterId,fingerprint).first();
      if(!order){
        const r=await context.env.DB.prepare(`INSERT INTO nclt_orders(matter_id,order_date,order_type,title,source_url,fingerprint,ia_numbers,is_new,discovered_at,last_seen_at) VALUES(?1,?2,?3,?4,?5,?6,?7,0,datetime('now'),datetime('now'))`)
          .bind(matterId,orderDate,orderType,title,url,fingerprint,iaText).run();
        order={id:r.meta.last_row_id};importedOrders++;
      } else {
        await context.env.DB.prepare(`UPDATE nclt_orders SET
          order_date=COALESCE(order_date,?1),
          order_type=COALESCE(NULLIF(order_type,''),?2),
          title=COALESCE(NULLIF(title,''),?3),
          ia_numbers=CASE WHEN COALESCE(ia_numbers,'')='' AND ?4 IS NOT NULL THEN ?4 ELSE ia_numbers END,
          is_new=0,last_seen_at=datetime('now') WHERE id=?5`)
          .bind(orderDate,orderType,title,iaText||null,order.id).run();
      }
      for(const label of (item.ia_numbers||[])){
        const app=existingApps.find(x=>sameIa(x.ia_number,label));
        if(app)await context.env.DB.prepare('INSERT OR IGNORE INTO nclt_order_applications(order_id,application_id) VALUES(?1,?2)').bind(order.id,app.id).run();
      }
    }

    const nextListing=validDate(body.next_listing_date), upstreamSummary=upstreamErrors.join('\n').slice(0,3000)||null;
    const causeMeta=body.cause_list||{};
    const causeDate=validDate(causeMeta.cause_list_date), causeUrl=clean(causeMeta.cause_list_url,1400), vcUrl=clean(causeMeta.vc_url,1400);
    // A main-matter VC link is recipient-facing only when it matches a date the user
    // explicitly entered for the matter. The NCLT-detected listing date is stored only
    // as background metadata and never drives the recipient-facing calendar.
    const useCause=Boolean(causeDate&&matter.next_hearing_date&&causeDate===matter.next_hearing_date&&causeUrl);
    const anySourceOk=caseStatus==='success'||causeStatus==='success';
    const fullHealthy=caseStatus==='success'&&causeStatus==='success'&&coverage==='full';
    const health=fullHealthy?'healthy':(anySourceOk?'limited':'failed');
    const syncStatus=health==='healthy'&&upstreamErrors.length===0?'success':(anySourceOk?'partial':'failed');
    const failures=anySourceOk?0:Number(matter.nclt_consecutive_failures||0)+1;
    await context.env.DB.prepare(`UPDATE matters SET nclt_last_checked_at=datetime('now'),nclt_last_error=?1,nclt_next_listing_date=?2,nclt_coverage_level=?3,nclt_watch_health=?4,nclt_source_case_status=?5,nclt_source_cause_status=?6,nclt_last_successful_check_at=CASE WHEN ?7=1 THEN datetime('now') ELSE nclt_last_successful_check_at END,nclt_last_full_check_at=CASE WHEN ?8=1 THEN datetime('now') ELSE nclt_last_full_check_at END,nclt_consecutive_failures=?9,nclt_cause_list_url=CASE WHEN ?10=1 THEN ?11 WHEN nclt_cause_list_date=next_hearing_date THEN nclt_cause_list_url ELSE NULL END,nclt_vc_url=CASE WHEN ?10=1 THEN ?12 WHEN nclt_cause_list_date=next_hearing_date THEN nclt_vc_url ELSE NULL END,nclt_cause_list_date=CASE WHEN ?10=1 THEN ?13 WHEN nclt_cause_list_date=next_hearing_date THEN nclt_cause_list_date ELSE NULL END,updated_at=datetime('now') WHERE id=?14`)
      .bind(upstreamSummary,nextListing,coverage,health,caseStatus,causeStatus,anySourceOk?1:0,fullHealthy?1:0,failures,useCause?1:0,causeUrl,vcUrl,causeDate,matterId).run();
    await context.env.DB.prepare(`UPDATE nclt_sync_runs SET status=?1,finished_at=datetime('now'),new_applications=0,new_orders=?2,error_summary=?3,source_case_status=?4,source_cause_status=?5,coverage_level=?6,cause_docs_scanned=?7 WHERE id=?8`)
      .bind(syncStatus,importedOrders,upstreamSummary,caseStatus,causeStatus,coverage,docsScanned,runId).run();
    return json({ok:true,status:syncStatus,health,coverage_level:coverage,linked_applications:linkedApplications,imported_orders:importedOrders,new_applications:0,new_orders:0,errors:upstreamErrors});
  }catch(e){
    const msg=(e.message||String(e)).slice(0,3000);const failures=Number(matter.nclt_consecutive_failures||0)+1;
    await context.env.DB.prepare(`UPDATE matters SET nclt_last_checked_at=datetime('now'),nclt_last_error=?1,nclt_watch_health='failed',nclt_consecutive_failures=?2 WHERE id=?3`).bind(msg,failures,matterId).run();
    await context.env.DB.prepare(`UPDATE nclt_sync_runs SET status='failed',finished_at=datetime('now'),error_summary=?1 WHERE id=?2`).bind(msg,runId).run();
    return json({error:msg},500);
  }
}
