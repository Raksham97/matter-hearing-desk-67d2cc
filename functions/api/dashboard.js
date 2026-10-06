import { json } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';

function plusDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
}

export async function onRequestGet(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const url = new URL(context.request.url);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('today')||'') ? url.searchParams.get('today') : new Date().toISOString().slice(0,10);
  const through = plusDays(today, 7);

  const [upcomingApps, upcomingMain, matters, recent] = await Promise.all([
    context.env.DB.prepare(`
      SELECT a.id AS application_id, a.ia_number, a.title AS application_title, a.status AS application_status,
             a.bench AS application_bench, a.next_hearing_date, a.next_hearing_notes,
             m.id, m.cause_title, m.short_name, m.forum, m.bench, m.case_number, m.status
      FROM applications a JOIN matters m ON m.id=a.matter_id
      WHERE m.status='Active'
        AND a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed')
        AND a.next_hearing_date IS NOT NULL
        AND a.next_hearing_date >= ?1 AND a.next_hearing_date <= ?2
      ORDER BY a.next_hearing_date ASC, m.cause_title ASC, a.ia_number ASC
    `).bind(today,through).all(),
    context.env.DB.prepare(`
      SELECT NULL AS application_id, 'Main matter' AS ia_number, NULL AS application_title,
             'Pending' AS application_status, m.bench AS application_bench,
             m.next_hearing_date, m.next_hearing_notes,
             m.id, m.cause_title, m.short_name, m.forum, m.bench, m.case_number, m.status
      FROM matters m
      WHERE m.status='Active' AND m.next_hearing_date IS NOT NULL
        AND m.next_hearing_date >= ?1 AND m.next_hearing_date <= ?2
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.matter_id=m.id)
      ORDER BY m.next_hearing_date ASC, m.cause_title ASC
    `).bind(today,through).all(),
    context.env.DB.prepare(`
      SELECT m.*,
             COUNT(a.id) AS application_count,
             SUM(CASE WHEN a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed') THEN 1 ELSE 0 END) AS open_application_count,
             MIN(CASE WHEN a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed') THEN a.next_hearing_date END) AS application_next_hearing
      FROM matters m LEFT JOIN applications a ON a.matter_id=m.id
      GROUP BY m.id
      ORDER BY CASE m.status WHEN 'Active' THEN 0 ELSE 1 END,
               CASE WHEN application_next_hearing IS NULL AND m.next_hearing_date IS NULL THEN 1 ELSE 0 END,
               COALESCE(application_next_hearing,m.next_hearing_date) ASC, m.cause_title ASC
    `).all(),
    context.env.DB.prepare(`
      SELECT h.id, h.matter_id, h.hearing_date, h.outcome, m.cause_title,
             COALESCE(GROUP_CONCAT(a.ia_number, ' · '), h.ia_number) AS application_numbers
      FROM hearings h JOIN matters m ON m.id=h.matter_id
      LEFT JOIN hearing_applications ha ON ha.hearing_id=h.id
      LEFT JOIN applications a ON a.id=ha.application_id
      GROUP BY h.id
      ORDER BY h.hearing_date DESC, h.id DESC LIMIT 12
    `).all(),
  ]);

  const upcoming = [...upcomingApps.results, ...upcomingMain.results].sort((a,b)=>(a.next_hearing_date||'').localeCompare(b.next_hearing_date||'') || a.cause_title.localeCompare(b.cause_title));
  return json({today,through,upcoming,matters:matters.results,recent:recent.results});
}
