import { json, readJson, clean, validDate } from '../../_lib/http.js';
import { requireWatch, normalizeIa } from '../../_lib/watch.js';
function sameIa(a,b){ return normalizeIa(a) && normalizeIa(a)===normalizeIa(b); }

async function collapseDuplicateApps(context,matterId,rows){
  const groups=new Map();
  for(const row of rows){const key=normalizeIa(row.ia_number);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  let changed=false;
  for(const group of groups.values()){
    if(group.length<2)continue;
    group.sort((a,b)=>((String(a.source||'').toUpperCase()==='NCLT')?1:0)-((String(b.source||'').toUpperCase()==='NCLT')?1:0)||Number(a.id)-Number(b.id));
    const keep=group[0];
    for(const dup of group.slice(1)){
      await context.env.DB.prepare(`UPDATE applications SET
        title=COALESCE(NULLIF(title,''),(SELECT title FROM applications WHERE id=?2)),
        status=CASE WHEN status='Pending' AND COALESCE((SELECT status FROM applications WHERE id=?2),'Pending')!='Pending' THEN (SELECT status FROM applications WHERE id=?2) ELSE status END,
        bench=COALESCE(NULLIF(bench,''),(SELECT bench FROM applications WHERE id=?2)),
        next_hearing_date=COALESCE(next_hearing_date,(SELECT next_hearing_date FROM applications WHERE id=?2)),
        next_hearing_notes=COALESCE(NULLIF(next_hearing_notes,''),(SELECT next_hearing_notes FROM applications WHERE id=?2)),
        notes=CASE WHEN COALESCE(notes,'')='' THEN (SELECT notes FROM applications WHERE id=?2) WHEN COALESCE((SELECT notes FROM applications WHERE id=?2),'')='' OR notes=(SELECT notes FROM applications WHERE id=?2) THEN notes ELSE notes||char(10)||(SELECT notes FROM applications WHERE id=?2) END,
        official_url=COALESCE(NULLIF(official_url,''),(SELECT official_url FROM applications WHERE id=?2)),
        source=COALESCE(NULLIF(source,''),(SELECT source FROM applications WHERE id=?2)),
        source_reference=COALESCE(NULLIF(source_reference,''),(SELECT source_reference FROM applications WHERE id=?2)),
        detected_at=COALESCE(detected_at,(SELECT detected_at FROM applications WHERE id=?2)),
        is_new=CASE WHEN is_new=0 OR COALESCE((SELECT is_new FROM applications WHERE id=?2),0)=0 THEN 0 ELSE 1 END,
        last_seen_at=COALESCE((SELECT last_seen_at FROM applications WHERE id=?2),last_seen_at),
        updated_at=datetime('now') WHERE id=?1`).bind(keep.id,dup.id).run();
      await context.env.DB.prepare('INSERT OR IGNORE INTO hearing_applications(hearing_id,application_id) SELECT hearing_id,?1 FROM hearing_applications WHERE application_id=?2').bind(keep.id,dup.id).run();
      await context.env.DB.prepare('INSERT OR IGNORE INTO nclt_order_applications(order_id,application_id) SELECT order_id,?1 FROM nclt_order_applications WHERE application_id=?2').bind(keep.id,dup.id).run();
      await context.env.DB.prepare('DELETE FROM hearing_applications WHERE application_id=?1').bind(dup.id).run();
      await context.env.DB.prepare('DELETE FROM nclt_order_applications WHERE application_id=?1').bind(dup.id).run();
      await context.env.DB.prepare('DELETE FROM applications WHERE id=?1').bind(dup.id).run();
      changed=true;
    }
  }
  if(!changed)return rows;
  return (await context.env.DB.prepare('SELECT * FROM applications WHERE matter_id=?1').bind(matterId).all()).results;
}

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
    let existingApps=(await context.env.DB.prepare('SELECT * FROM applications WHERE matter_id=?1').bind(matterId).all()).results;
    existingApps=await collapseDuplicateApps(context,matterId,existingApps);
    for(const item of (body.applications||[])){
      const label=clean(item.ia_number,180); if(!label)continue;
      let existing=existingApps.find(x=>sameIa(x.ia_number,label));
      const causeDate=validDate(item.cause_list_date), causeUrl=clean(item.cause_list_url,1400), vcUrl=clean(item.vc_url,1400);
      const incomingNext=validDate(item.next_hearing_date);
      if(existing){
        const effectiveNext=existing.next_hearing_date||incomingNext||null;
        const useCause=Boolean(causeDate&&effectiveNext&&causeDate===effectiveNext);
        await context.env.DB.prepare(`UPDATE applications SET last_seen_at=datetime('now'),source_reference=COALESCE(source_reference,?1),official_url=COALESCE(official_url,?2),next_hearing_date=CASE WHEN next_hearing_date IS NULL AND ?3 IS NOT NULL THEN ?3 ELSE next_hearing_date END,cause_list_url=CASE WHEN ?4=1 THEN ?5 WHEN cause_list_date IS NOT NULL AND cause_list_date!=COALESCE(next_hearing_date,?3) THEN NULL ELSE cause_list_url END,vc_url=CASE WHEN ?4=1 THEN ?6 WHEN cause_list_date IS NOT NULL AND cause_list_date!=COALESCE(next_hearing_date,?3) THEN NULL ELSE vc_url END,cause_list_date=CASE WHEN ?4=1 THEN ?7 WHEN cause_list_date IS NOT NULL AND cause_list_date!=COALESCE(next_hearing_date,?3) THEN NULL ELSE cause_list_date END WHERE id=?8`)
          .bind(clean(item.source_reference,1200),clean(item.official_url,1200),incomingNext,useCause?1:0,causeUrl,vcUrl,causeDate,existing.id).run();
        if(!existing.next_hearing_date&&incomingNext)existing.next_hearing_date=incomingNext;
        if(useCause){existing.cause_list_url=causeUrl;existing.vc_url=vcUrl;existing.cause_list_date=causeDate;}
        continue;
      }
      const markNew=firstSync?0:1;
      const useCause=Boolean(causeDate&&incomingNext&&causeDate===incomingNext);
      const r=await context.env.DB.prepare(`INSERT INTO applications(matter_id,ia_number,title,status,bench,next_hearing_date,next_hearing_notes,notes,official_url,source,source_reference,detected_at,is_new,last_seen_at,cause_list_url,vc_url,cause_list_date,created_at,updated_at) VALUES(?1,?2,?3,'Pending',?4,?5,?6,?7,?8,'NCLT',?9,datetime('now'),?10,datetime('now'),?11,?12,?13,datetime('now'),datetime('now'))`)
        .bind(matterId,label,clean(item.title,500),clean(item.bench,150),incomingNext,clean(item.next_hearing_notes,2000),clean(item.notes,4000),clean(item.official_url,1200),clean(item.source_reference,1200),markNew,useCause?causeUrl:null,useCause?vcUrl:null,useCause?causeDate:null).run();
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
    const expectedMatterDate=nextListing||matter.next_hearing_date||null;
    const useCause=Boolean(causeDate&&expectedMatterDate&&causeDate===expectedMatterDate);
    const anySourceOk=caseStatus==='success'||causeStatus==='success';
    const fullHealthy=caseStatus==='success'&&causeStatus==='success'&&coverage==='full';
    const health=fullHealthy?'healthy':(anySourceOk?'limited':'failed');
    const syncStatus=health==='healthy'&&upstreamErrors.length===0?'success':(anySourceOk?'partial':'failed');
    const failures=anySourceOk?0:Number(matter.nclt_consecutive_failures||0)+1;
    await context.env.DB.prepare(`UPDATE matters SET nclt_last_checked_at=datetime('now'),nclt_last_error=?1,nclt_next_listing_date=?2,nclt_coverage_level=?3,nclt_watch_health=?4,nclt_source_case_status=?5,nclt_source_cause_status=?6,nclt_last_successful_check_at=CASE WHEN ?7=1 THEN datetime('now') ELSE nclt_last_successful_check_at END,nclt_last_full_check_at=CASE WHEN ?8=1 THEN datetime('now') ELSE nclt_last_full_check_at END,nclt_consecutive_failures=?9,nclt_cause_list_url=CASE WHEN ?10=1 THEN ?11 ELSE NULL END,nclt_vc_url=CASE WHEN ?10=1 THEN ?12 ELSE NULL END,nclt_cause_list_date=CASE WHEN ?10=1 THEN ?13 ELSE NULL END,updated_at=datetime('now') WHERE id=?14`)
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
