"""Source and freshness are evaluated independently for every measurement."""
import json
import time
from pathlib import Path
from thread_clock import clock_info, clock_line, utc
from watch_schema import LIVE_SECONDS, METRICS, metric, timestamp, context


def state(ts, now, source):
    age = now - ts
    if age < -5:
        return 'CLOCK ERROR — measurement is in the future; not live'
    if source != 'zepp-watch':
        return 'HISTORICAL/UNVERIFIED SOURCE — not live'
    if age > LIVE_SECONDS:
        return 'STALE — live connection is not confirmed'
    return 'LIVE SENSOR READING'


def describe(path, now=None, clock=None):
    now = time.time() if now is None else now
    clock = clock_info(now) if clock is None else clock
    prefix = clock_line(clock) + "\n"
    if clock["ntp_synchronized"] is False:
        return prefix + "Clock is not synchronized; current sensor freshness cannot be established."
    try:
        d = json.loads(Path(path).read_text())
        if not isinstance(d, dict):
            raise ValueError()
        if d.get('source') == 'mock':
            return prefix + 'TEST DATA ONLY — simulated heartbeat. The watch is not connected to this feed.'
        source = d.get('source', 'unknown')
        if d.get('schema') not in (3, 4):
            heart = metric('heart_rate', {'ts': d['ts'], 'bpm': d['bpm']})
            age = max(0, int(now - heart['ts']))
            return prefix + f"{state(heart['ts'], now, source)}: {heart['bpm']} bpm; measured {age}s ago at {utc(heart['ts'])}; source={source}."
        snapshot_ts = timestamp(d['snapshot_ts'])
        activity_context = context(d.get('context'), snapshot_ts) if 'context' in d else None
        data = {name: metric(name, d[name]) for name in METRICS if name in d}
        if not data or any(item['ts'] > snapshot_ts for item in data.values()):
            raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        return prefix + 'No valid watch reading available.'
    lines = [prefix.rstrip(), f'Watch measurements; source={source}. Freshness is shown separately for each sensor.']
    if 'fetched' in d:
        try: lines.append(f"Snapshot observed {utc(snapshot_ts)}; computer received {utc(timestamp(d['fetched']))}. Watch clock accuracy is not independently verified.")
        except (ValueError, TypeError, OverflowError): pass
    if activity_context:
        activity = activity_context['activity']
        if activity:
            label_state = 'CURRENT LABEL' if state(snapshot_ts, now, source) == 'LIVE SENSOR READING' and now < activity['expires_at'] else 'LAST KNOWN LABEL; not current'
            lines.append(f"Activity: {activity['label']} — {label_state}; explicitly selected by user, not inferred. Started {utc(activity['started_at'])}; session {activity['session_id']}.")
        else:
            lines.append('Activity: not labeled. No activity prediction has been made.')
    for name, label in [('heart_rate', 'Heart rate'), ('steps', 'Steps'), ('motion', 'Wrist motion')]:
        item = data.get(name)
        if item is None:
            lines.append(f'{label}: unavailable in this snapshot.')
            continue
        age = max(0, int(now - item['ts']))
        status = state(item['ts'], now, source)
        if name == 'heart_rate':
            detail = f"{item['bpm']} bpm; measured {age}s ago"
        elif name == 'steps':
            session = 'since this session started' if activity_context is not None else 'since Start sharing'
            detail = f"{item['count']} today; {item['since_start']} {session}; counter observed {age}s ago"
        else:
            span = item['ts'] - item['window_start']
            detail = (f"{span:.1f}s window ending {age}s ago, {item['samples']} samples; "
                      f"acceleration variation RMS {item['rms_variation_cm_s2']:.1f} cm/s²; "
                      f"peak change between samples {item['peak_change_cm_s2']:.1f} cm/s²; "
                      f"last x/y/z = {item['x']:.1f}/{item['y']:.1f}/{item['z']:.1f} cm/s²")
        lines.append(f"{label}: {status}; {detail}; observed UTC {utc(item['ts'])}.")
    if 'motion' in data:
        lines.append('Motion includes wrist rotation and gravity changes. It does not identify a pose, practice type, or whole-body movement. Step counts may update in batches.')
    return '\n'.join(lines)


if __name__ == '__main__':
    import sys
    print(describe(sys.argv[1]))
