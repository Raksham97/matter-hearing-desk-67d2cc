import { json } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function onRequestGet(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const url = new URL(context.request.url);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('today') || '')
    ? url.searchParams.get('today')
    : new Date().toISOString().slice(0, 10);
  const through = addDays(today, 7);

  const [upcoming, matters, recent] = await Promise.all([
    context.env.DB.prepare(`
      SELECT id, cause_title, short_name, forum, bench, case_number, status,
             next_hearing_date, next_ia_number, next_hearing_notes, official_case_url
      FROM matters
      WHERE status = 'Active' AND next_hearing_date IS NOT NULL
        AND next_hearing_date >= ?1 AND next_hearing_date <= ?2
      ORDER BY next_hearing_date ASC, cause_title ASC
    `).bind(today, through).all(),
    context.env.DB.prepare(`
      SELECT id, cause_title, short_name, forum, bench, case_number, client_role, status,
             next_hearing_date, next_ia_number, next_hearing_notes, notes, official_case_url,
             updated_at
      FROM matters
      ORDER BY CASE status WHEN 'Active' THEN 0 ELSE 1 END,
               CASE WHEN next_hearing_date IS NULL THEN 1 ELSE 0 END,
               next_hearing_date ASC, cause_title ASC
    `).all(),
    context.env.DB.prepare(`
      SELECT h.id, h.matter_id, h.hearing_date, h.ia_number, h.bench, h.outcome,
             m.cause_title
      FROM hearings h JOIN matters m ON m.id = h.matter_id
      ORDER BY h.hearing_date DESC, h.id DESC LIMIT 12
    `).all(),
  ]);

  return json({ today, through, upcoming: upcoming.results, matters: matters.results, recent: recent.results });
}
