#!/usr/bin/env python3
"""Local, write-only watch receiver. No Zepp account access or cloud polling."""
import argparse
import hmac
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from thread_clock import timeline
from event_history import EventHistory
from watch_schema import LIVE_SECONDS, validate_sample as validate

MAX_BODY = 4096


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


class Receiver(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, token, output, pairing_file=None, mirror_outputs=(), history_file=None):
        self.token, self.output = token, Path(output)
        self.mirror_outputs = tuple(dict.fromkeys(Path(p) for p in mirror_outputs if Path(p) != self.output))
        self.failed_mirrors = set()
        self.lock = threading.Lock()
        self.latest_ts = 0
        self.last_received = 0
        self.pairing_file = Path(pairing_file) if pairing_file else None
        self.pair_attempts = 0
        self.history = EventHistory(history_file) if history_file else None
        self.history_failed = False
        super().__init__(address, Handler)

    def save_sample(self, sample):
        atomic_json(self.output, sample)
        if self.history:
            try:
                self.history.record(sample)
                if self.history_failed:
                    print('Watch event history recovered.', flush=True)
                self.history_failed = False
            except Exception:
                # History failure must not interrupt the live readers.
                if not self.history_failed:
                    print('Watch event history unavailable; live delivery continues.', flush=True)
                self.history_failed = True
        # A disconnected reader must not stop delivery to the other agents.
        # Preserve every timestamp; a failed mirror naturally becomes STALE.
        for index, path in enumerate(self.mirror_outputs, 1):
            try:
                atomic_json(path, sample)
            except OSError:
                if index not in self.failed_mirrors:
                    print(f'Watch reader mirror {index} unavailable; retrying on each sample.', flush=True)
                self.failed_mirrors.add(index)
            else:
                if index in self.failed_mirrors:
                    print(f'Watch reader mirror {index} recovered.', flush=True)
                self.failed_mirrors.discard(index)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log credentials, readings, or request bodies.

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def reply(self, status, data):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == '/healthz':
            print('Connection check reached receiver.', flush=True)
            self.reply(200, {'ok': True, 'service': 'watch-bridge'})
        else:
            self.reply(404, {'ok': False, 'error': 'No read API'})

    def do_POST(self):
        if self.path == '/v1/pair':
            return self.pair()
        if self.path != '/v1/sample':
            return self.reply(404, {'ok': False, 'error': 'Unknown endpoint'})
        auth = self.headers.get('Authorization', '')
        if not hmac.compare_digest(auth.encode(), ('Bearer ' + self.server.token).encode()):
            return self.reply(401, {'ok': False, 'error': 'Invalid bridge key'})
        try:
            if self.headers.get('Transfer-Encoding'):
                raise ValueError('Chunked requests are not supported')
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= MAX_BODY:
                raise ValueError('Invalid body size')
            sample = validate(json.loads(self.rfile.read(size)), time.time())
            sample['timeline'] = timeline(sample)
        except (ValueError, UnicodeError, TimeoutError):
            return self.reply(400, {'ok': False, 'error': 'Invalid, old, or future-dated sample'})
        with self.server.lock:
            packet_ts = sample.get('snapshot_ts', sample['ts'])
            if packet_ts <= self.server.latest_ts:
                return self.reply(409, {'ok': False, 'error': 'Duplicate or older sample'})
            try:
                self.server.save_sample(sample)
            except OSError:
                return self.reply(503, {'ok': False, 'error': 'Could not save sample'})
            self.server.latest_ts = packet_ts
            self.server.last_received = sample['fetched']
        self.reply(200, {'ok': True, 'accepted_ts': packet_ts})

    def pair(self):
        print('Pairing request reached receiver.', flush=True)
        with self.server.lock:
            pairing = self.server.pairing_file
            reason = 'window closed or attempt limit reached'
            try:
                if pairing is None or self.server.pair_attempts >= 5:
                    raise ValueError()
                reason = 'invalid request format'
                size = int(self.headers.get('Content-Length', '0'))
                if self.headers.get('Transfer-Encoding') or not 0 < size <= 128:
                    raise ValueError()
                config = json.loads(pairing.read_text())
                reason = 'code expired'
                if config['expires'] <= time.time():
                    raise ValueError()
                reason = 'invalid request format'
                data = json.loads(self.rfile.read(size))
                self.server.pair_attempts += 1
                reason = 'code did not match'
                if not isinstance(data, dict) or not hmac.compare_digest(
                        str(data.get('code', '')).encode(), str(config['code']).encode()):
                    raise ValueError()
                pairing.unlink()  # One use only, before returning the bridge key.
            except (OSError, ValueError, KeyError, TypeError, TimeoutError):
                print('Pairing rejected: ' + reason + '.', flush=True)
                return self.reply(403, {'ok': False, 'error': 'Pairing closed or code incorrect'})
        print('Pairing accepted.', flush=True)
        return self.reply(200, {'ok': True, 'token': self.server.token})


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=18962)
    p.add_argument('--key-file', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--mirror-output', type=Path, action='append', default=[],
                   help='Additional private snapshot file for an authorized agent; repeatable')
    p.add_argument('--init-key', action='store_true')
    p.add_argument('--pairing-file', type=Path)
    p.add_argument('--history-file', type=Path, help='Private seven-day UTC summary history for local correlation')
    args = p.parse_args()
    if args.init_key:
        args.key_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(args.key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_urlsafe(32))
        print('Created a bridge-only ingestion key. No Zepp credentials used.')
        return
    if args.key_file.stat().st_mode & 0o077:
        p.error('Bridge key must be readable by its owner only')
    key = args.key_file.read_text().strip()
    if len(key) < 32:
        p.error('Bridge key is too short')
    server = Receiver((args.host, args.port), key, args.output, args.pairing_file, args.mirror_output, args.history_file)
    print(f'Watch receiver listening on {args.host}:{args.port}; waiting for sensor data.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if server.history:
            server.history.close()


if __name__ == '__main__':
    main()
