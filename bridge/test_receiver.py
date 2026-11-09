# All readings, times, codes and keys in these tests are synthetic.
import http.client
import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from reading import describe
from receiver import Receiver, atomic_json, validate


class WatchBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = Path(self.temp.name) / 'latest.json'
        self.now = time.time()

    def tearDown(self):
        self.temp.cleanup()

    def sample(self, **changes):
        return {'source': 'zepp-watch', 'ts': self.now, 'bpm': 72, **changes}

    def activity(self):
        return {'schema': 3, 'source': 'zepp-watch', 'ts': self.now,
                'heart_rate': {'ts': self.now - 10, 'bpm': 72},
                'steps': {'ts': self.now, 'count': 1000, 'since_start': 12,
                          'session_started_at': self.now - 60},
                'motion': {'ts': self.now, 'window_start': self.now - 2, 'samples': 12,
                           'rms_variation_cm_s2': 12.5, 'peak_change_cm_s2': 25,
                           'x': 0, 'y': 0, 'z': 981}}

    def test_activity_preserves_each_timestamp_and_legacy_heart_fields(self):
        sample = self.activity()
        saved = validate(sample, self.now)
        self.assertEqual(saved['ts'], sample['heart_rate']['ts'])
        self.assertEqual(saved['snapshot_ts'], self.now)
        atomic_json(self.output, saved)
        text = describe(self.output, self.now + 11)
        self.assertIn('Heart rate: STALE', text)
        self.assertIn('Steps: LIVE SENSOR READING', text)
        self.assertIn('Wrist motion: LIVE SENSOR READING', text)
        self.assertIn('1000 today; 12 since Start sharing', text)
        self.assertNotIn('LIVE SENSOR READING', describe(self.output, self.now + 21))
        self.assertIn('CLOCK ERROR', describe(self.output, self.now - 6))

    def test_activity_without_heart_does_not_invent_a_pulse(self):
        sample = self.activity()
        del sample['heart_rate']
        saved = validate(sample, self.now)
        self.assertIsNone(saved['bpm'])
        atomic_json(self.output, saved)
        text = describe(self.output, self.now)
        self.assertIn('Heart rate: unavailable', text)
        self.assertNotIn('bpm', text)
        self.assertIn('Wrist motion: LIVE SENSOR READING', text)
        self.assertIn('does not identify a pose', text)

    def test_activity_rejects_invalid_or_stale_components(self):
        for name, key, value in [
            ('heart_rate', 'ts', self.now - 21), ('heart_rate', 'bpm', True),
            ('steps', 'ts', self.now + 1), ('steps', 'count', -1),
            ('steps', 'count', 2.5), ('steps', 'since_start', True),
            ('steps', 'session_started_at', self.now + 1),
            ('motion', 'samples', 1), ('motion', 'x', float('nan')),
            ('motion', 'y', float('inf')), ('motion', 'z', 100001),
            ('motion', 'rms_variation_cm_s2', -1),
            ('motion', 'window_start', self.now), ('motion', 'window_start', self.now - 21),
            ('motion', 'token', 'not-real')]:
            with self.subTest(name=name, key=key), self.assertRaises(ValueError):
                bad = self.activity()
                bad[name][key] = value
                validate(bad, self.now)
        for bad in [{'schema': 3, 'source': 'zepp-watch', 'ts': self.now},
                    {**self.activity(), 'schema': 4}, {**self.activity(), 'source': 'mock'}]:
            with self.assertRaises(ValueError):
                validate(bad, self.now)

    def test_reader_handles_corrupt_activity_and_unverified_sources(self):
        saved = validate(self.activity(), self.now)
        for change in [None, {'ts': self.now, 'count': 12}]:
            bad = copy.deepcopy(saved)
            bad['steps'] = change
            atomic_json(self.output, bad)
            self.assertTrue(describe(self.output, self.now).endswith('No valid watch reading available.'))
        saved['source'] = 'zepp-cloud'
        atomic_json(self.output, saved)
        self.assertNotIn('LIVE SENSOR READING', describe(self.output, self.now))

    def test_never_promote_mock_to_live(self):
        atomic_json(self.output, self.sample(source='mock'))
        self.assertIn('TEST DATA ONLY', describe(self.output, self.now))
        self.assertNotIn('72 bpm', describe(self.output, self.now))

    def test_fresh_stale_future_and_cloud_are_distinct(self):
        atomic_json(self.output, self.sample())
        self.assertIn('LIVE SENSOR READING', describe(self.output, self.now))
        self.assertIn('STALE', describe(self.output, self.now + 21))
        self.assertIn('CLOCK ERROR', describe(self.output, self.now - 10))
        atomic_json(self.output, self.sample(source='zepp-cloud'))
        self.assertIn('not live', describe(self.output, self.now))

    def test_reject_invalid_or_nonwatch_samples(self):
        for changes in [{'source': 'mock'}, {'ts': self.now - 21}, {'ts': self.now + 6},
                        {'bpm': 0}, {'bpm': True}, {'ts': float('nan')},
                        {'bpm': 72.5}, {'password': 'not-a-real-secret'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate(self.sample(**changes), self.now)

    def test_preserve_measurement_time(self):
        result = validate(self.sample(ts=self.now - 10), self.now)
        self.assertEqual(result['ts'], self.now - 10)
        self.assertEqual(result['fetched'], self.now)

    def test_malformed_readings(self):
        for bad in [[], {'source': 'zepp-watch'}, {'ts': True, 'bpm': 72},
                    {'ts': self.now, 'bpm': float('nan')}]:
            atomic_json(self.output, bad)
            self.assertTrue(describe(self.output).endswith('No valid watch reading available.'))

    def test_private_mirrors_keep_original_sensor_times_and_staleness(self):
        mirrors = [Path(self.temp.name) / name / 'latest.json' for name in ['reader-a', 'reader-b']]
        srv = Receiver(('127.0.0.1', 0), 'test-only-key' * 4, self.output, mirror_outputs=mirrors)
        try:
            saved = validate(self.activity(), self.now)
            srv.save_sample(saved)
            for path in mirrors:
                self.assertEqual(json.loads(path.read_text()), saved)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
                self.assertIn('Heart rate: STALE', describe(path, self.now + 11))
                self.assertIn('Steps: LIVE SENSOR READING', describe(path, self.now + 11))
                self.assertNotIn('LIVE SENSOR READING', describe(path, self.now + 21))
        finally:
            srv.server_close()

    def test_mirror_failure_isolated_and_recovers_on_next_sample(self):
        mirrors = [Path(self.temp.name) / name / 'latest.json' for name in ['reader-a', 'reader-b']]
        srv = Receiver(('127.0.0.1', 0), 'test-only-key' * 4, self.output, mirror_outputs=mirrors)
        saved = validate(self.activity(), self.now)
        def fail_one(path, data):
            if path == mirrors[0]:
                raise PermissionError('synthetic mirror failure')
            atomic_json(path, data)
        try:
            with patch('receiver.atomic_json', side_effect=fail_one):
                srv.save_sample(saved)
            self.assertEqual(json.loads(self.output.read_text()), saved)
            self.assertEqual(json.loads(mirrors[1].read_text()), saved)
            self.assertFalse(mirrors[0].exists())
            self.assertEqual(srv.failed_mirrors, {1})
            srv.save_sample(saved)
            self.assertEqual(json.loads(mirrors[0].read_text()), saved)
            self.assertEqual(srv.failed_mirrors, set())
        finally:
            srv.server_close()

    def test_http_auth_ingestion_ordering_and_no_data_read_endpoint(self):
        pairing = Path(self.temp.name) / 'pair.json'
        atomic_json(pairing, {'code': '12345678', 'expires': time.time() + 60})
        mirror = Path(self.temp.name) / 'authorized-agent/latest.json'
        srv = Receiver(('127.0.0.1', 0), 'test-only-key' * 4, self.output, pairing, [mirror])
        th = threading.Thread(target=srv.serve_forever, daemon=True)
        th.start()
        def request(method, path, payload=None, key='test-only-key' * 4):
            conn = http.client.HTTPConnection(*srv.server_address, timeout=3)
            conn.request(method, path, json.dumps(payload) if payload else None,
                         {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            resp = conn.getresponse()
            result = resp.status, json.loads(resp.read())
            conn.close()
            return result
        try:
            self.assertEqual(request('POST', '/v1/pair', {'code': 'wrong'})[0], 403)
            paired = request('POST', '/v1/pair', {'code': '12345678'})
            self.assertEqual(paired[0], 200)
            self.assertEqual(paired[1]['token'], 'test-only-key' * 4)
            self.assertFalse(pairing.exists())
            self.assertEqual(request('POST', '/v1/pair', {'code': '12345678'})[0], 403)
            self.assertEqual(request('GET', '/healthz')[0], 200)
            self.assertEqual(request('POST', '/v1/sample', self.sample(), 'wrong')[0], 401)
            self.assertFalse(self.output.exists())
            self.assertFalse(mirror.exists())
            self.assertEqual(request('POST', '/v1/sample', self.sample())[0], 200)
            self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
            saved = self.output.read_text()
            self.assertEqual(mirror.read_text(), saved)
            self.assertEqual(request('POST', '/v1/sample', self.sample())[0], 409)
            self.assertEqual(request('POST', '/v1/sample', self.sample(source='mock'))[0], 400)
            self.assertEqual(self.output.read_text(), saved)
            self.assertEqual(mirror.read_text(), saved)
            self.assertEqual(request('GET', '/v1/sample')[0], 404)
            activity = self.activity()
            activity['ts'] += 1
            status, result = request('POST', '/v1/sample', activity)
            self.assertEqual(status, 200)
            self.assertEqual(result['accepted_ts'], activity['ts'])
            # Ordering uses snapshot time, even when the pulse has not changed.
            activity['ts'] += 1
            self.assertEqual(request('POST', '/v1/sample', activity)[0], 200)
            self.assertEqual(request('POST', '/v1/sample', activity)[0], 409)
            self.assertIn('Wrist motion: LIVE SENSOR READING', describe(self.output))
            self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        finally:
            srv.shutdown()
            srv.server_close()
            th.join()


if __name__ == '__main__':
    unittest.main()
