"""Source and freshness are evaluated independently for every measurement."""
import json
import time
from pathlib import Path
from watch_schema import LIVE_SECONDS, METRICS, metric, timestamp


def state(ts, now, source):
    age = now - ts
    if age < -5:
        return 'CLOCK ERROR — measurement is in the future; not live'
    if source != 'zepp-watch':
        return 'HISTORICAL/UNVERIFIED SOURCE — not live'
    if age > LIVE_SECONDS:
        return 'STALE — live connection is not confirmed'
    return 'LIVE SENSOR READING'


def describe(path, now=None):
    now = time.time() if now is None else now
    try:
        d = json.loads(Path(path).read_text())
        if not isinstance(d, dict):
            raise ValueError()
        if d.get('source') == 'mock':
            return 'TEST DATA ONLY — simulated heartbeat. The watch is not connected to this feed.'
        source = d.get('source', 'unknown')
        if d.get('schema') != 3:
            heart = metric('heart_rate', {'ts': d['ts'], 'bpm': d['bpm']})
            age = max(0, int(now - heart['ts']))
            return f"{state(heart['ts'], now, source)}: {heart['bpm']} bpm; measured {age}s ago; source={source}."
        snapshot_ts = timestamp(d['snapshot_ts'])
        data = {name: metric(name, d[name]) for name in METRICS if name in d}
        if not data or any(item['ts'] > snapshot_ts for item in data.values()):
            raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        return 'No valid watch reading available.'
    lines = [f'Watch measurements; source={source}. Freshness is shown separately for each sensor.']
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
            detail = f"{item['count']} today; {item['since_start']} since Start sharing; counter observed {age}s ago"
        else:
            span = item['ts'] - item['window_start']
            detail = (f"{span:.1f}s window ending {age}s ago, {item['samples']} samples; "
                      f"acceleration variation RMS {item['rms_variation_cm_s2']:.1f} cm/s²; "
                      f"peak change between samples {item['peak_change_cm_s2']:.1f} cm/s²; "
                      f"last x/y/z = {item['x']:.1f}/{item['y']:.1f}/{item['z']:.1f} cm/s²")
        lines.append(f'{label}: {status}; {detail}.')
    if 'motion' in data:
        lines.append('Motion includes wrist rotation and gravity changes. It does not identify a pose, practice type, or whole-body movement. Step counts may update in batches.')
    return '\n'.join(lines)


if __name__ == '__main__':
    import sys
    print(describe(sys.argv[1]))
