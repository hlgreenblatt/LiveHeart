"""Use the installed ThreadWatch clock without importing the QUIC stack.

Uses an explicitly configured file or an installed ThreadLink distribution.
No network requests or messages.
Unknown sync status stays unknown; the upstream banner alone is not NTP proof.
"""
import importlib.util
from importlib import metadata
import os
import time
from datetime import datetime, timezone
from pathlib import Path

_watch = None
_loaded = False
_sync = None
_checked = -float('inf')


def utc(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def toolkit_watch():
    global _watch, _loaded
    if not _loaded:
        _loaded = True
        configured = os.environ.get('THREADWATCH_PATH')
        candidates = [Path(configured).expanduser()] if configured else []
        if not configured:
            try:
                candidates.append(Path(metadata.distribution('threadlink').locate_file('threadlink/watch.py')))
            except metadata.PackageNotFoundError:
                pass
        for path in candidates:
            if not path.is_file():
                continue
            try:
                spec = importlib.util.spec_from_file_location('_live_heart_threadwatch', path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                if callable(module.clock_synced) and callable(module.utc_iso):
                    _watch = module
                    break
            except (OSError, ImportError, AttributeError, SyntaxError):
                continue
    return _watch


def clock_info(now=None):
    global _sync, _checked
    watch = toolkit_watch()
    if time.monotonic() - _checked >= 30:
        _checked = time.monotonic()
        try:
            _sync = watch.clock_synced() if watch else None
        except Exception:
            _sync = None
    now = time.time() if now is None else now
    return {'unix': now, 'utc': utc(now), 'source': 'ThreadWatch' if watch else 'host-clock fallback',
            'ntp_synchronized': _sync, 'precision': 'milliseconds; accuracy not measured'}


def clock_line(info):
    state = {True: 'NTP synchronized', False: 'NOT synchronized; do not trust freshness',
             None: 'sync state unknown; freshness uses the host clock'}[info['ntp_synchronized']]
    return f"Check watch first — {info['source']}: {info['utc']} (unix {info['unix']:.3f}); {state}."


def timeline(sample):
    ts = sample.get('snapshot_ts', sample['ts'])
    return {'event_id': 'zepp-watch:' + str(round(ts * 1000)), 'observed_utc': utc(ts),
            'received_utc': utc(sample['fetched']), 'receiver_clock': clock_info(sample['fetched']),
            'sensor_utc': {name: utc(sample[name]['ts']) for name in ('heart_rate', 'steps', 'motion') if name in sample},
            'watch_clock_verified': False}
