import { json, readJson, clean, validDate } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';

function isNclt(forum) { return String(forum || 'NCLT').toUpperCase().includes('NCLT'); }

export async function onRequestGet(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const data = await context.env.DB.prepare(`
    SELECT m.*,
           COUNT(a.id) AS application_count,
           SUM(CASE WHEN a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed') THEN 1 ELSE 0 END) AS open_application_count,
           MIN(CASE WHEN a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed') THEN a.next_hearing_date END) AS application_next_hearing,
           SUM(CASE WHEN a.is_new=1 THEN 1 ELSE 0 END) AS new_application_count,
           (SELECT COUNT(*) FROM nclt_orders no WHERE no.matter_id=m.id AND no.is_new=1) AS new_order_count
    FROM matters m LEFT JOIN applications a ON a.matter_id=m.id
    GROUP BY m.id
    ORDER BY CASE m.status WHEN 'Active' THEN 0 ELSE 1 END,
             CASE WHEN application_next_hearing IS NULL AND m.next_hearing_date IS NULL AND m.nclt_next_listing_date IS NULL THEN 1 ELSE 0 END,
             COALESCE(application_next_hearing,m.next_hearing_date,m.nclt_next_listing_date) ASC, m.cause_title ASC
  `).all();
  return json({ matters:data.results });
}

export async function onRequestPost(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  try {
    const b = await readJson(context.request);
    const cause = clean(b.cause_title,500);
    if (!cause) return json({error:'Cause title is required'},400);
    const r = await context.env.DB.prepare(`
      INSERT INTO matters
      (cause_title,short_name,forum,bench,case_number,client_role,status,
       next_hearing_date,next_ia_number,next_hearing_notes,notes,official_case_url,
       nclt_watch_enabled,nclt_filing_no,nclt_bench_slug,
       created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,?10,?11,?12,?13,?14,datetime('now'),datetime('now'))
    `).bind(
      cause,clean(b.short_name,150),clean(b.forum,80)||'NCLT',clean(b.bench,150),
      clean(b.case_number,150),clean(b.client_role,150),clean(b.status,30)||'Active',
      validDate(b.next_hearing_date),clean(b.next_hearing_notes,2000),clean(b.notes,4000),
      clean(b.official_case_url,1000),isNclt(b.forum)?1:0,clean(b.nclt_filing_no,80),clean(b.nclt_bench_slug,80)
    ).run();
    return json({ok:true,id:r.meta.last_row_id},201);
  } catch(e) {
    return json({error:e.message||'Could not create matter'},400);
  }
}
