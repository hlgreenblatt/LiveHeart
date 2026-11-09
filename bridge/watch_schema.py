"""Validation shared by the write-only receiver and read-only agent tools."""
import math
import re

LIVE_SECONDS = 20
METRICS = ('heart_rate', 'steps', 'motion')
ACTIVITIES = ('tai_chi', 'yoga', 'tantra', 'mowing', 'shoveling', 'walking')


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def integer(value, low, high):
    return number(value) and int(value) == value and low <= value <= high


def timestamp(value):
    if not number(value) or not 0 < value < 253402300800:
        raise ValueError('Invalid timestamp')
    return value


def context(data, snapshot_ts):
    if not isinstance(data, dict) or set(data) != {'monitor_started_at', 'mode', 'activity'}:
        raise ValueError('Invalid context')
    if timestamp(data['monitor_started_at']) > snapshot_ts or data['mode'] not in ('background', 'practice'):
        raise ValueError('Invalid monitoring context')
    activity = data['activity']
    if activity is not None:
        if not isinstance(activity, dict) or set(activity) != {'label', 'source', 'started_at', 'expires_at', 'session_id'}:
            raise ValueError('Invalid activity')
        if activity['label'] not in ACTIVITIES or activity['source'] != 'user':
            raise ValueError('Only explicit user labels are accepted')
        start, end = timestamp(activity['started_at']), timestamp(activity['expires_at'])
        if not data['monitor_started_at'] <= start <= snapshot_ts < end or end - start > 4 * 3600:
            raise ValueError('Invalid or expired activity label')
        if not isinstance(activity['session_id'], str) or not re.fullmatch(r'watch-[a-z0-9-]{1,55}', activity['session_id']):
            raise ValueError('Invalid activity session id')
    return {**data, 'activity': dict(activity) if activity else None}


def metric(name, data):
    if not isinstance(data, dict):
        raise ValueError('Invalid metric')
    timestamp(data.get('ts'))
    fields = {
        'heart_rate': {'ts', 'bpm'},
        'steps': {'ts', 'count', 'since_start', 'session_started_at'},
        'motion': {'ts', 'window_start', 'samples', 'rms_variation_cm_s2',
                   'peak_change_cm_s2', 'x', 'y', 'z'},
    }
    if set(data) != fields[name]:
        raise ValueError('Unexpected or missing metric fields')
    if name == 'heart_rate':
        if not integer(data['bpm'], 1, 300):
            raise ValueError('Invalid heart rate')
    elif name == 'steps':
        if not integer(data['count'], 0, 1000000) or not integer(data['since_start'], 0, 10000000):
            raise ValueError('Invalid step count')
        if timestamp(data['session_started_at']) > data['ts']:
            raise ValueError('Invalid session start')
    else:
        span = data['ts'] - timestamp(data['window_start'])
        if not 0 < span <= 20 or not integer(data['samples'], 2, 10000):
            raise ValueError('Invalid motion window')
        for key in ('x', 'y', 'z'):
            if not number(data[key]) or abs(data[key]) > 100000:
                raise ValueError('Invalid acceleration')
        for key in ('rms_variation_cm_s2', 'peak_change_cm_s2'):
            if not number(data[key]) or not 0 <= data[key] <= 400000:
                raise ValueError('Invalid motion summary')
    return dict(data)


def fresh_timestamp(ts, now):
    timestamp(ts)
    if ts > now + 5 or now - ts > LIVE_SECONDS:
        raise ValueError('Old or future-dated measurement')


def validate_sample(payload, now):
    if not isinstance(payload, dict) or payload.get('source') != 'zepp-watch':
        raise ValueError('Only watch sensor samples are accepted')
    ts = payload.get('ts')
    fresh_timestamp(ts, now)
    if 'schema' not in payload:
        if set(payload) != {'ts', 'bpm', 'source'}:
            raise ValueError('Unexpected fields')
        heart = metric('heart_rate', {'ts': ts, 'bpm': payload['bpm']})
        return {**heart, 'source': 'zepp-watch', 'fetched': now,
                'sample_kind': 'continuous-heart-rate', 'schema': 2}
    if type(payload['schema']) is not int or payload['schema'] not in (3, 4):
        raise ValueError('Unsupported schema')
    allowed = {'schema', 'source', 'ts', *METRICS}
    if payload['schema'] == 4:
        allowed.add('context')
    if set(payload) - allowed:
        raise ValueError('Unexpected fields')
    # Keep stored sensor snapshots compatible with already-running 1.1 readers.
    # Schema 4 is the wire format; its validated context is an additive field.
    result = {'schema': 3, 'source': 'zepp-watch', 'snapshot_ts': ts,
              'fetched': now, 'sample_kind': 'heart-steps-motion'}
    if payload['schema'] == 4:
        result['wire_schema'] = 4
        result['context'] = context(payload.get('context'), ts)
    for name in METRICS:
        if name not in payload:
            continue
        data = metric(name, payload[name])
        fresh_timestamp(data['ts'], now)
        if data['ts'] > ts:
            raise ValueError('Metric is newer than its snapshot')
        result[name] = data
    if not any(name in result for name in METRICS):
        raise ValueError('No sensor data')
    # Preserve the old top-level heart timestamp; activity never refreshes it.
    heart = result.get('heart_rate')
    result['ts'] = heart['ts'] if heart else ts
    result['bpm'] = heart['bpm'] if heart else None
    return result
