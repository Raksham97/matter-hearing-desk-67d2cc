import { json, readJson, clean, validDate } from '../../_lib/http.js';
import { requireWatch, normalizeIa } from '../../_lib/watch.js';

function sameIa(a,b){ return normalizeIa(a) && normalizeIa(a)===normalizeIa(b); }

export async function onRequestPost(context) {
  const denied = requireWatch(context); if (denied) return denied;
  let body;
  try { body=await readJson(context.request); } catch(e) { return json({error:'Invalid JSON'},400); }
  const matterId=Number(body.matter_id);
  const matter=await context.env.DB.prepare('SELECT id,nclt_watch_enabled,nclt_last_checked_at FROM matters WHERE id=?1').bind(matterId).first();
  if (!matter || !matter.nclt_watch_enabled) return json({error:'Matter is not enabled for NCLT watch'},404);

  const sourceUrl=clean(body.source_url,1200);
  const upstreamErrors=(Array.isArray(body.errors)?body.errors:[])
    .map(x=>clean(String(x||''),500)).filter(Boolean).slice(0,20);
  const firstSync=!matter.nclt_last_checked_at;
  const run = await context.env.DB.prepare(`INSERT INTO nclt_sync_runs(matter_id,status,source_url,started_at) VALUES(?1,'running',?2,datetime('now'))`)
    .bind(matterId,sourceUrl).run();
  const runId=run.meta.last_row_id;
  let newApplications=0,newOrders=0,importedApplications=0,importedOrders=0;
  const errors=[];
  try {
    const existingApps=(await context.env.DB.prepare('SELECT * FROM applications WHERE matter_id=?1').bind(matterId).all()).results;
    for (const item of (body.applications||[])) {
      const label=clean(item.ia_number,180); if(!label) continue;
      let existing=existingApps.find(x=>sameIa(x.ia_number,label));
      if (existing) {
        await context.env.DB.prepare(`UPDATE applications SET last_seen_at=datetime('now'), source_reference=COALESCE(source_reference,?1), official_url=COALESCE(official_url,?2) WHERE id=?3`)
          .bind(clean(item.source_reference,1200),clean(item.official_url,1200),existing.id).run();
        continue;
      }
      const markNew=firstSync?0:1;
      const r=await context.env.DB.prepare(`
        INSERT INTO applications(matter_id,ia_number,title,status,bench,next_hearing_date,next_hearing_notes,notes,official_url,
          source,source_reference,detected_at,is_new,last_seen_at,created_at,updated_at)
        VALUES(?1,?2,?3,'Pending',?4,?5,?6,?7,?8,'NCLT',?9,datetime('now'),?10,datetime('now'),datetime('now'),datetime('now'))
      `).bind(matterId,label,clean(item.title,500),clean(item.bench,150),validDate(item.next_hearing_date),
        clean(item.next_hearing_notes,2000),clean(item.notes,4000),clean(item.official_url,1200),clean(item.source_reference,1200),markNew).run();
      existing={id:r.meta.last_row_id,ia_number:label}; existingApps.push(existing); importedApplications++;
      if(markNew) newApplications++;
    }

    for (const item of (body.orders||[])) {
      const url=clean(item.source_url,1400); if(!url) continue;
      const fingerprint=clean(item.fingerprint,300)||url;
      let order=await context.env.DB.prepare('SELECT * FROM nclt_orders WHERE matter_id=?1 AND fingerprint=?2').bind(matterId,fingerprint).first();
      if (!order) {
        const markNew=firstSync?0:1;
        const r=await context.env.DB.prepare(`
          INSERT INTO nclt_orders(matter_id,order_date,order_type,title,source_url,fingerprint,ia_numbers,is_new,discovered_at,last_seen_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,datetime('now'),datetime('now'))
        `).bind(matterId,validDate(item.order_date),clean(item.order_type,120),clean(item.title,600),url,fingerprint,
          clean((item.ia_numbers||[]).join(' · '),2000),markNew).run();
        order={id:r.meta.last_row_id}; importedOrders++;
        if(markNew) newOrders++;
      } else {
        await context.env.DB.prepare('UPDATE nclt_orders SET last_seen_at=datetime(\'now\') WHERE id=?1').bind(order.id).run();
      }
      for (const label of (item.ia_numbers||[])) {
        const app=existingApps.find(x=>sameIa(x.ia_number,label));
        if (app) await context.env.DB.prepare('INSERT OR IGNORE INTO nclt_order_applications(order_id,application_id) VALUES(?1,?2)').bind(order.id,app.id).run();
      }
    }

    const nextListing=validDate(body.next_listing_date);
    const upstreamSummary=upstreamErrors.join('\n').slice(0,2000)||null;
    const status=upstreamErrors.length?'partial':'success';
    await context.env.DB.prepare(`UPDATE matters SET nclt_last_checked_at=datetime('now'),nclt_last_error=?1,nclt_next_listing_date=?2,updated_at=datetime('now') WHERE id=?3`)
      .bind(upstreamSummary,nextListing,matterId).run();
    await context.env.DB.prepare(`UPDATE nclt_sync_runs SET status=?1,finished_at=datetime('now'),new_applications=?2,new_orders=?3,error_summary=?4 WHERE id=?5`)
      .bind(status,newApplications,newOrders,upstreamSummary,runId).run();
    return json({ok:true,status,first_sync:firstSync,new_applications:newApplications,new_orders:newOrders,
      imported_applications:importedApplications,imported_orders:importedOrders,errors:upstreamErrors});
  } catch(e) {
    errors.push(e.message||String(e));
    await context.env.DB.prepare(`UPDATE matters SET nclt_last_checked_at=datetime('now'),nclt_last_error=?1 WHERE id=?2`).bind(errors.join('\n').slice(0,2000),matterId).run();
    await context.env.DB.prepare(`UPDATE nclt_sync_runs SET status='failed',finished_at=datetime('now'),error_summary=?1 WHERE id=?2`).bind(errors.join('\n').slice(0,4000),runId).run();
    return json({error:errors[0]},500);
  }
}
