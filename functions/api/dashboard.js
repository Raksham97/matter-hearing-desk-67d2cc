import { json } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';
function plusDays(iso,days){const d=new Date(`${iso}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export async function onRequestGet(context){
  const denied=await requireAuth(context);if(denied)return denied;
  const url=new URL(context.request.url);
  const today=/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('today')||'')?url.searchParams.get('today'):new Date().toISOString().slice(0,10);
  const through=plusDays(today,7);
  const [upcomingApps,upcomingMain,matters,recent,recentOrders,orderCount]=await Promise.all([
    context.env.DB.prepare(`SELECT a.id AS application_id,a.ia_number,a.title AS application_title,a.status AS application_status,a.bench AS application_bench,a.next_hearing_date,a.next_hearing_notes,a.cause_list_url,a.vc_url,a.cause_list_date,m.id,m.cause_title,m.short_name,m.forum,m.bench,m.case_number,m.status FROM applications a JOIN matters m ON m.id=a.matter_id WHERE m.status='Active' AND upper(COALESCE(a.source,'manual'))!='NCLT' AND a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed') AND a.next_hearing_date IS NOT NULL AND a.next_hearing_date>=?1 AND a.next_hearing_date<=?2 ORDER BY a.next_hearing_date ASC,m.cause_title ASC,a.ia_number ASC`).bind(today,through).all(),
    context.env.DB.prepare(`SELECT NULL AS application_id,'Main matter' AS ia_number,NULL AS application_title,'Pending' AS application_status,m.bench AS application_bench,m.next_hearing_date AS next_hearing_date,m.next_hearing_notes,m.nclt_cause_list_url AS cause_list_url,m.nclt_vc_url AS vc_url,m.nclt_cause_list_date AS cause_list_date,m.id,m.cause_title,m.short_name,m.forum,m.bench,m.case_number,m.status FROM matters m WHERE m.status='Active' AND m.next_hearing_date IS NOT NULL AND m.next_hearing_date>=?1 AND m.next_hearing_date<=?2 AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.matter_id=m.id AND upper(COALESCE(a.source,'manual'))!='NCLT' AND a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed') AND a.next_hearing_date IS NOT NULL AND a.next_hearing_date>=?1 AND a.next_hearing_date<=?2) ORDER BY m.next_hearing_date ASC,m.cause_title ASC`).bind(today,through).all(),
    context.env.DB.prepare(`SELECT m.*,
      (SELECT COUNT(*) FROM applications a WHERE a.matter_id=m.id AND upper(COALESCE(a.source,'manual'))!='NCLT') AS application_count,
      (SELECT COUNT(*) FROM applications a WHERE a.matter_id=m.id AND upper(COALESCE(a.source,'manual'))!='NCLT' AND a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed')) AS open_application_count,
      (SELECT MIN(a.next_hearing_date) FROM applications a WHERE a.matter_id=m.id AND upper(COALESCE(a.source,'manual'))!='NCLT' AND a.status NOT IN ('Disposed','Allowed','Dismissed','Withdrawn','Closed') AND a.next_hearing_date>=?1) AS application_next_hearing,
      (SELECT COUNT(*) FROM nclt_orders no WHERE no.matter_id=m.id) AS order_count
      FROM matters m ORDER BY CASE m.status WHEN 'Active' THEN 0 ELSE 1 END,m.cause_title ASC`).bind(today).all(),
    context.env.DB.prepare(`SELECT h.id,h.matter_id,h.hearing_date,h.outcome,m.cause_title,COALESCE(GROUP_CONCAT(CASE WHEN upper(COALESCE(a.source,'manual'))!='NCLT' THEN a.ia_number END,' · '),h.ia_number) AS application_numbers FROM hearings h JOIN matters m ON m.id=h.matter_id LEFT JOIN hearing_applications ha ON ha.hearing_id=h.id LEFT JOIN applications a ON a.id=ha.application_id GROUP BY h.id ORDER BY h.hearing_date DESC,h.id DESC LIMIT 12`).all(),
    context.env.DB.prepare(`SELECT no.id,no.matter_id,no.order_date,no.title,no.order_type,no.source_url,no.ia_numbers,m.cause_title,m.short_name FROM nclt_orders no JOIN matters m ON m.id=no.matter_id ORDER BY COALESCE(no.order_date,no.discovered_at) DESC,no.id DESC LIMIT 10`).all(),
    context.env.DB.prepare(`SELECT COUNT(*) AS n FROM nclt_orders`).first(),
  ]);
  const upcoming=[...upcomingApps.results,...upcomingMain.results].sort((a,b)=>(a.next_hearing_date||'').localeCompare(b.next_hearing_date||'')||a.cause_title.localeCompare(b.cause_title));
  return json({today,through,upcoming,matters:matters.results,recent:recent.results,recent_orders:recentOrders.results,order_count:Number(orderCount?.n||0)});
}
