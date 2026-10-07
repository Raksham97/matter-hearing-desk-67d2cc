import { json } from '../../_lib/http.js';
import { requireWatch } from '../../_lib/watch.js';

export async function onRequestGet(context) {
  const denied = requireWatch(context); if (denied) return denied;
  const matters = await context.env.DB.prepare(`
    SELECT id,cause_title,short_name,bench,case_number,next_hearing_date,nclt_filing_no,nclt_bench_slug,
           nclt_last_checked_at,nclt_next_listing_date
    FROM matters WHERE status='Active' AND nclt_watch_enabled=1
    ORDER BY id ASC
  `).all();
  const out=[];
  for (const m of matters.results) {
    const [apps,orders] = await Promise.all([
      context.env.DB.prepare('SELECT ia_number,next_hearing_date,cause_list_date FROM applications WHERE matter_id=?1').bind(m.id).all(),
      context.env.DB.prepare('SELECT source_url FROM nclt_orders WHERE matter_id=?1').bind(m.id).all(),
    ]);
    out.push({...m,
      known_ia_numbers:apps.results.map(x=>x.ia_number),
      known_applications:apps.results,
      known_order_urls:orders.results.map(x=>x.source_url)});
  }
  return json({matters:out});
}
