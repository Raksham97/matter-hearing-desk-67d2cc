import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

P = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'nclt_source_policy.py'
spec=importlib.util.spec_from_file_location('nclt_source_policy', P)
policy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class PolicyTests(unittest.TestCase):
    def test_transient_connection_faults(self):
        base={'status':'failed','docs':[],'successful_pages':0}
        for err in ['cause-list page {\'page\': 0}: ReadTimeout: x',
                    'cause-list page None: HTTPError: 503 Server Error',
                    'cause-list page None: HTTPError: 403 Forbidden',
                    'cause-list page None: ConnectionError: reset']:
            self.assertTrue(policy.classify_cause_outage({**base,'errors':[err]}),err)
    def test_do_not_hide_parser_drift_or_partial(self):
        base={'status':'failed','docs':[],'successful_pages':0}
        for e in [[],['cause-list discovery returned only 0 documents'],
                  ['cause-list page None: TypeError: BUG'],
                  ['cause-list page None: HTTPError: 404 Not Found']]:
            self.assertFalse(policy.classify_cause_outage({**base,'errors':e}))
        self.assertFalse(policy.classify_cause_outage({**base,'successful_pages':1,'errors':['cause-list page 1: ReadTimeout']}))
        self.assertFalse(policy.classify_cause_outage({**base,'docs':[{'url':'x'}],'errors':['cause-list page 1: ReadTimeout']}))
        self.assertFalse(policy.classify_cause_outage({**base,'responded_pages':1,'errors':['cause-list page 1: ReadTimeout']}))
        self.assertFalse(policy.classify_cause_outage({**base,'status':'success','errors':['cause-list page 1: ReadTimeout']}))
    def test_gate_fails_real_issues(self):
        for cls in ['schema-change','ingest-failed','', 'identity-mismatch']:
            self.assertFalse(policy.gate(outcome='failure',error_class=cls,verified_age=1)[0])
        self.assertFalse(policy.gate(outcome='cancelled',error_class='transient-cause-unavailable',verified_age=1)[0])
        for age in [None,-1,30.01,49]:
            self.assertFalse(policy.gate(outcome='failure',error_class='transient-cause-unavailable',verified_age=age)[0])
    def test_gate_warns_for_bounded_outage(self):
        for age in [0,2,29.9,30]:
            self.assertTrue(policy.gate(outcome='failure',error_class='transient-cause-unavailable',verified_age=age)[0])
        self.assertTrue(policy.gate(outcome='success',error_class='',verified_age=None)[0])
    def test_heartbeat_artifact_and_legacy_fallback(self):
        now=datetime(2026,10,15,8,30,tzinfo=timezone.utc)
        def good(path,token):
            if path.startswith('actions/artifacts'):
                return {'artifacts':[{'name':'nclt-cause-verified-25','created_at':'2026-10-15T06:00:00Z','expired':False},
                        {'name':'other','created_at':'2026-10-15T08:00:00Z','expired':False}]}
            raise AssertionError('must not load fallback with evidence present')
        self.assertEqual(policy.latest_verified_time('fake',now=now,fetch=good)[1],'verified-artifact')
        def old(path,token):
            if path.startswith('actions/artifacts'): return {'artifacts':[]}
            return {'workflow_runs':[{'head_sha':policy.BASELINE,'conclusion':'success','created_at':'2026-10-14T08:52:00Z'},
                 {'head_sha':'not-legacy','conclusion':'success','created_at':'2026-10-15T08:00:00Z'}]}
        self.assertEqual(policy.latest_verified_time('fake',now=now,fetch=old)[0].isoformat(),'2026-10-14T08:52:00+00:00')
    def test_artifact_cannot_be_future_or_expired(self):
        now=datetime(2026,10,15,8,30,tzinfo=timezone.utc)
        def fake(path,token):
            if path.startswith('actions/artifacts'):
                return {'artifacts':[{'name':'nclt-cause-verified-99','created_at':'2026-10-15T12:30:00Z','expired':False},
                                     {'name':'nclt-cause-verified-89','created_at':'2026-10-15T07:30:00Z','expired':True}]}
            return {'workflow_runs':[]}
        self.assertEqual(policy.latest_verified_time('fake',now=now,fetch=fake),(None,'none'))
    def test_timestamp_parser_and_age(self):
        self.assertIsNone(policy.parse_stamp('invalid'))
        self.assertIsNone(policy.parse_stamp('2026-10-15T08:30:00'))
        now=datetime(2026,10,15,10,tzinfo=timezone.utc)
        self.assertEqual(policy.age_hours(now-timedelta(hours=3),now),3)

class SimultaneousOutageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scripts=str(pathlib.Path(__file__).resolve().parents[1] / 'scripts')
        if scripts not in sys.path: sys.path.insert(0,scripts)
        import nclt_watch
        cls.watch=nclt_watch

    def test_temporary_case_history_transport_is_classified(self):
        for error in ('case-status fetch: ReadTimeout: upstream',
                      'case-status fetch: ConnectionError: reset',
                      'case-status fetch: HTTPError: 503 temporary'):
            self.assertTrue(policy.classify_case_history_outage(
                {'status':'failed','errors':[error]}))

    def test_nontransient_case_errors_cannot_be_suppressed(self):
        for detail in (
            {'status':'identity_mismatch','errors':['filing source mismatch']},
            {'status':'failed','errors':['case-status page returned too little text']},
            {'status':'failed','errors':['case-status fetch: HTTPError: 404 not found']},
            {'status':'failed','errors':['case-status fetch: ValueError: invalid format']},
            {'status':'success','errors':[]},
            {'status':'failed','errors':[]},
        ):
            self.assertFalse(policy.classify_case_history_outage(detail))

    def test_both_official_sources_transient_no_ingest_and_exit_75(self):
        from types import SimpleNamespace
        config={'matters':[
            {'id':1,'short_name':'Ecstasy','case_number':'CP IB 922 of 2022','nclt_filing_no':'123', 'nclt_bench_slug':'mumbai'},
            {'id':2,'short_name':'Videocon','case_number':'CP IB 2 of 2018','nclt_filing_no':'456', 'nclt_bench_slug':'mumbai'},
            {'id':3,'short_name':'JUD','case_number':'CP IB 25 of 2020','nclt_filing_no':'789', 'nclt_bench_slug':'mumbai'},
            {'id':4,'short_name':'Reliance','case_number':'CP IB 123 of 2020'},
        ]}
        cause={'status':'failed','docs':[],'successful_pages':0,'responded_pages':0,
               'errors':['cause-list page None: ReadTimeout: upstream']}
        def details(session,m):
            if m['id']==4:
                return {'status':'unconfigured','errors':[]}
            return {'status':'failed','errors':['case-status fetch: ReadTimeout: upstream']}
        with patch.object(self.watch,'DESK_URL','https://example.com'), \
             patch.object(self.watch,'SECRET','test'), \
             patch.object(self.watch,'api_get',return_value=config), \
             patch.object(self.watch,'discover_cause_docs',return_value=cause), \
             patch.object(self.watch,'fetch_details',side_effect=details), \
             patch.object(self.watch,'api_post') as post, \
             patch.dict('os.environ',{'GITHUB_OUTPUT':''}):
            result=self.watch.main()
        self.assertEqual(result,75)
        post.assert_not_called()

class CauseFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scripts=str(pathlib.Path(__file__).resolve().parents[1] / 'scripts')
        if scripts not in sys.path: sys.path.insert(0,scripts)
        import nclt_watch
        cls.watch = nclt_watch
    def test_uses_independently_verified_official_alternate_route(self):
        old={'status':'failed','docs':[],'errors':['cause-list page None: ConnectionError: timeout'],
             'successful_pages':0,'responded_pages':0}
        ok={'status':'success','docs':[{'url':f'https://nclt.gov.in/{i}.pdf'} for i in range(6)],
             'errors':[], 'successful_pages':1,'responded_pages':1}
        with patch.object(self.watch,'_discover_cause_route',side_effect=[old,ok]) as fn:
            result=self.watch.discover_cause_docs(object())
        self.assertEqual(result['status'],'success')
        self.assertEqual(fn.call_count,2)
        self.assertIn('index.php',fn.call_args_list[-1].args[1])
    def test_primary_succeeds_without_second_route(self):
        ok={'status':'success','docs':[{'url':'x'} for _ in range(6)],
             'errors':[],'successful_pages':1,'responded_pages':1}
        with patch.object(self.watch,'_discover_cause_route',return_value=ok) as fn:
            self.assertEqual(self.watch.discover_cause_docs(object())['status'],'success')
        self.assertEqual(fn.call_count,1)
    def test_both_official_routes_failed_and_not_accepted(self):
        failure={'status':'failed','docs':[],
                 'errors':['cause-list page None: ReadTimeout: x'],
                 'successful_pages':0,'responded_pages':0}
        with patch.object(self.watch,'_discover_cause_route',side_effect=[failure,failure]):
            result=self.watch.discover_cause_docs(object())
        self.assertEqual(result['status'],'failed')
        self.assertEqual(len(result['errors']),2)
        self.assertTrue(policy.classify_cause_outage(result))



class RealWorldTLSChainFailureTests(unittest.TestCase):
    # 19 October 2026 production traceback, with shortened official URLs.
    CERT = ("SSLError: HTTPSConnectionPool(host='nclt.gov.in', port=443): "
            "Max retries exceeded with url: /all-cause-list "
            "(Caused by SSLError(SSLCertVerificationError(1, "
            "'[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: "
            "self-signed certificate in certificate chain')))" )

    def test_both_official_tls_cause_routes_are_transport_unavailable_not_verified(self):
        cause = {'status':'failed', 'docs':[], 'successful_pages':0, 'responded_pages':0,
                 'errors':[f'cause-list page {page}: {self.CERT}'
                           for page in ('None', "{'page': 0}", "{'page': 1}")]}
        self.assertTrue(policy.classify_cause_outage(cause))
        for mutated in ({'responded_pages':1}, {'successful_pages':1}, {'docs':[{'url':'doc'}]}):
            self.assertFalse(policy.classify_cause_outage({**cause, **mutated}))

    def test_case_history_tls_chain_is_unavailable_not_identity_verified(self):
        err = self.CERT.replace("host='nclt.gov.in'", "host='efiling.nclt.gov.in'")
        self.assertTrue(policy.classify_case_history_outage(
            {'status':'failed','errors':['case-status fetch: '+err]}))
        self.assertFalse(policy.classify_case_history_outage(
            {'status':'identity_mismatch','errors':['case-status fetch: '+err]}))

    def test_arbitrary_ssl_errors_and_parser_drift_remain_hard_failures(self):
        for error in ('SSLError: SSL bad record mac',
                      'SSLError: HTTPSConnectionPool(host=other.example, port=443): bad handshake',
                      'ValueError: parse failure',
                      'HTTPError: 404'):
            self.assertFalse(policy.classify_cause_outage({'status':'failed','docs':[],
                'successful_pages':0,'responded_pages':0,'errors':['cause-list page None: '+error]}))
            self.assertFalse(policy.classify_case_history_outage({'status':'failed',
                'errors':['case-status fetch: '+error]}))

    def test_certificate_outage_is_bounded_by_prior_verified_coverage(self):
        self.assertTrue(policy.gate(outcome='failure',error_class='transient-cause-unavailable',
                                    verified_age=15.8)[0])
        self.assertFalse(policy.gate(outcome='failure',error_class='transient-cause-unavailable',
                                     verified_age=30.01)[0])

    def test_real_tls_simultaneous_failure_never_posts_to_matter_desk(self):
        # The actual production watcher must short-circuit before ANY D1 writes.
        scripts=str(pathlib.Path(__file__).resolve().parents[1] / 'scripts')
        if scripts not in sys.path: sys.path.insert(0,scripts)
        import nclt_watch
        cfg={'matters':[
            {'id':1,'short_name':'Ecstasy','case_number':'CP IB 922 of 2022',
             'nclt_filing_no':'123','nclt_bench_slug':'mumbai'},
            {'id':2,'short_name':'Videocon','case_number':'CP IB 2 of 2018',
             'nclt_filing_no':'456','nclt_bench_slug':'mumbai'},
            {'id':3,'short_name':'JUD','case_number':'CP IB 25 of 2020',
             'nclt_filing_no':'789','nclt_bench_slug':'mumbai'},
            {'id':4,'short_name':'Reliance','case_number':'CP IB 123 of 2020'},
        ]}
        cause={'status':'failed','docs':[],'successful_pages':0,'responded_pages':0,
               'errors':['cause-list page None: '+self.CERT]}
        def fetch(session,m):
            if m['id']==4:return {'status':'unconfigured','errors':[]}
            return {'status':'failed','errors':['case-status fetch: '+self.CERT]}
        with patch.object(nclt_watch,'DESK_URL','https://example.com'), \
             patch.object(nclt_watch,'SECRET','test'), \
             patch.object(nclt_watch,'api_get',return_value=cfg), \
             patch.object(nclt_watch,'discover_cause_docs',return_value=cause), \
             patch.object(nclt_watch,'fetch_details',side_effect=fetch), \
             patch.object(nclt_watch,'api_post') as post, \
             patch.dict('os.environ',{'GITHUB_OUTPUT':''}):
            rc=nclt_watch.main()
        self.assertEqual(rc,75)
        post.assert_not_called()

if __name__=='__main__':unittest.main()
