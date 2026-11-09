"""Align a labeled activity window with UTC events; prepare learning features.

No network, classifier, diagnosis or exertion limit. Missing sensors stay missing.
This is a local adapter for a future separately trained FabricPC activity model.
"""
from statistics import mean
from watch_schema import context, metric, METRICS
from thread_clock import utc

MAX_GAP_SECONDS = 30


def activity_window(samples, session_id, related_events=()):
    usable = []
    rejected = 0
    for sample in samples:
        try:
            ts = sample['snapshot_ts']
            c = context(sample.get('context'), ts)
            a = c['activity']
            if not a or a['session_id'] != session_id:
                continue
            if sample.get('source') != 'zepp-watch' or sample['timeline']['receiver_clock']['ntp_synchronized'] is not True:
                raise ValueError('Source or receiver clock unverified')
            data = {name: metric(name, sample[name]) for name in METRICS if name in sample}
            if not data or any(not 0 <= ts - m['ts'] <= 20 for m in data.values()):
                raise ValueError('Invalid sensor timing')
            if not -5 <= sample['fetched'] - ts <= 20:
                raise ValueError('Outside accepted clock/delivery skew')
            usable.append((ts, a, data))
        except (KeyError, TypeError, ValueError):
            rejected += 1
    usable.sort(key=lambda item: item[0])
    if not usable:
        return {'status': 'insufficient_verified_data', 'rejected': rejected, 'prediction': None}
    labels = {a['label'] for _, a, _ in usable}
    if len(labels) != 1:
        return {'status': 'conflicting_labels', 'rejected': rejected, 'prediction': None}
    # Do not count a repeated pulse or motion window as another measurement.
    hearts = {d['heart_rate']['ts']: d['heart_rate']['bpm'] for _, _, d in usable if 'heart_rate' in d}
    motion = {d['motion']['ts']: d['motion']['rms_variation_cm_s2'] for _, _, d in usable if 'motion' in d}
    gaps = sum(b[0] - a[0] > MAX_GAP_SECONDS for a, b in zip(usable, usable[1:]))
    duration = usable[-1][0] - usable[0][0]
    steps = [d['steps'] for _, _, d in usable if 'steps' in d]
    same_step_session = len({s['session_started_at'] for s in steps}) == 1
    step_delta = steps[-1]['since_start'] - steps[0]['since_start'] if len(steps) >= 2 and same_step_session else None
    if step_delta is not None and step_delta < 0:
        step_delta = None
    features = {'heart_mean_bpm': mean(hearts.values()) if hearts else None,
                'heart_min_bpm': min(hearts.values()) if hearts else None,
                'heart_max_bpm': max(hearts.values()) if hearts else None,
                'step_delta': step_delta, 'duration_s': duration,
                'motion_mean_rms_cm_s2': mean(motion.values()) if motion else None}
    matches = []
    for event in related_events:
        ts = event.get('observed_ts')
        if type(ts) in (int, float) and usable[0][0] <= ts <= usable[-1][0] and event.get('clock_verified') is True:
            matches.append({'event_id': event.get('event_id'), 'observed_utc': utc(ts)})
    return {'status': 'gaps_present' if gaps else 'window_ready', 'session_id': session_id,
            'label': next(iter(labels)), 'label_source': 'user',
            'start_utc': utc(usable[0][0]), 'end_utc': utc(usable[-1][0]),
            'features': features, 'missing_features': [name for name, value in features.items() if value is None],
            'sensor_counts': {'heart': len(hearts), 'motion': len(motion), 'snapshots': len(usable)},
            'gaps_over_30s': gaps, 'rejected': rejected, 'coincident_events': matches,
            'prediction': None, 'model_status': 'not_trained', 'causal_claim': False,
            'watch_clock_verified': False, 'medical_limits': None}
