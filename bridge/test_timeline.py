# All readings, times, codes and keys in these tests are synthetic.
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from correlation import activity_window
from event_history import EventHistory, RETENTION_SECONDS
from reading import describe
from receiver import atomic_json
from thread_clock import clock_info, timeline
from watch_schema import validate_sample

NOW = 1794237000.0


def packet(ts=NOW):
    return {'schema': 4, 'source': 'zepp-watch', 'ts': ts,
            'steps': {'ts': ts, 'count': 100, 'since_start': int(ts - NOW), 'session_started_at': NOW},
            'heart_rate': {'ts': NOW, 'bpm': 72},
            'context': {'monitor_started_at': NOW - 10, 'mode': 'background', 'activity': {
                'label': 'tai_chi', 'source': 'user', 'started_at': NOW, 'expires_at': NOW + 14400,
                'session_id': 'watch-test-session'}}}


def saved(ts=NOW):
    sample = validate_sample(packet(ts), ts + 1)
    with patch('thread_clock.clock_info', return_value={'ntp_synchronized': True}):
        sample['timeline'] = timeline(sample)
    return sample


class TimelineTests(unittest.TestCase):
    def test_context_requires_explicit_supported_label_and_bounded_session(self):
        self.assertEqual(validate_sample(packet(), NOW)['context']['activity']['label'], 'tai_chi')
        for key, value in [('source', 'model'), ('label', 'secret instruction'), ('expires_at', NOW + 14401),
                           ('started_at', NOW + 1), ('session_id', '../path')]:
            p = packet(); p['context']['activity'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_sample(p, NOW)
        p = packet(); p['context']['activity'] = None
        self.assertIsNone(validate_sample(p, NOW)['context']['activity'])

    def test_old_reader_can_still_read_new_watch_sensor_packet(self):
        import types
        old = types.ModuleType('old_reader')
        path = Path(__file__).parent / 'test_fixtures/reader_v1_1.py'
        exec(path.read_text(), old.__dict__)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'latest.json'
            sample = saved()
            self.assertEqual(sample['schema'], 3)
            self.assertEqual(sample['wire_schema'], 4)
            atomic_json(target, sample)
            text = old.describe(target, NOW + 1)
            self.assertIn('Heart rate: LIVE SENSOR READING', text)
            self.assertIn('Steps: LIVE SENSOR READING', text)

    def test_reader_checks_clock_first_preserves_utc_and_ages_each_metric(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'latest.json'
            atomic_json(path, saved())
            good = {'unix': NOW + 1, 'utc': '2026-11-09T15:10:01.000Z', 'source': 'ThreadWatch', 'ntp_synchronized': True}
            text = describe(path, NOW + 1, good)
            self.assertTrue(text.startswith('Check watch first — ThreadWatch'))
            self.assertIn('2026-11-09T15:10:00.000Z', text)
            self.assertIn('explicitly selected by user, not inferred', text)
            self.assertIn('CURRENT LABEL', text)
            stale = describe(path, NOW + 21, good)
            self.assertIn('LAST KNOWN LABEL; not current', stale)
            self.assertNotIn('LIVE SENSOR READING', stale)
            bad = {**good, 'ntp_synchronized': False}
            self.assertNotIn('LIVE SENSOR READING', describe(path, NOW + 1, bad))
            self.assertIn('cannot be established', describe(path, NOW + 1, bad))

    def test_correlation_keeps_missing_data_and_labels_distinct_from_prediction(self):
        data = [saved(NOW), saved(NOW + 15)]
        result = activity_window(data, 'watch-test-session', [
            {'observed_ts': NOW + 2, 'event_id': 'thread-event-1', 'clock_verified': True},
            {'observed_ts': NOW + 2, 'event_id': 'unverified', 'clock_verified': False}])
        self.assertEqual(result['status'], 'window_ready')
        self.assertEqual(result['sensor_counts']['heart'], 1, 'Repeated pulse not counted twice')
        self.assertEqual(result['features']['step_delta'], 15)
        self.assertIsNone(result['features']['motion_mean_rms_cm_s2'])
        self.assertEqual(result['label_source'], 'user')
        self.assertIsNone(result['prediction'])
        self.assertIsNone(result['medical_limits'])
        self.assertFalse(result['causal_claim'])
        self.assertEqual([x['event_id'] for x in result['coincident_events']], ['thread-event-1'])
        data[0]['timeline']['receiver_clock']['ntp_synchronized'] = None
        data[1]['source'] = 'mock'
        self.assertEqual(activity_window(data, 'watch-test-session')['status'], 'insufficient_verified_data')

    def test_history_is_private_bounded_and_records_label_transitions(self):
        with tempfile.TemporaryDirectory() as tmp:
            history = EventHistory(Path(tmp) / 'private/events.sqlite3')
            try:
                self.assertEqual(history.path.stat().st_mode & 0o777, 0o600)
                history.record(saved()); history.record(saved(NOW + 5))
                self.assertEqual(history.db.execute('SELECT count(*) FROM events').fetchone()[0], 1)
                changed = saved(NOW + 6); changed['context']['activity'] = None
                history.record(changed)
                self.assertEqual(history.db.execute('SELECT count(*) FROM events').fetchone()[0], 2)
                later = saved(); later['fetched'] += RETENTION_SECONDS + 70
                later['snapshot_ts'] = later['fetched']; later['timeline']['event_id'] = 'later'
                history.record(later)
                self.assertEqual(history.db.execute('SELECT count(*) FROM events').fetchone()[0], 1)
            finally:
                history.close()


if __name__ == '__main__':
    unittest.main()
