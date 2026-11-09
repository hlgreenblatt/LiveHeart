"""Bounded private UTC event store for local correlation experiments."""
import json
import os
import sqlite3
from pathlib import Path

RETENTION_SECONDS = 7 * 86400
MAX_ROWS = 50000


class EventHistory:
    def __init__(self, path):
        self.path = Path(path)
        if self.path.is_symlink():
            raise ValueError('History must not be a symlink')
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(fd)
        self.path.chmod(0o600)
        self.last_received = 0
        self.last_activity = None
        self.last_prune = 0
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, observed REAL, received REAL, session TEXT, body TEXT)')
        self.db.execute('CREATE INDEX IF NOT EXISTS events_received ON events(received)')
        self.db.commit()

    def record(self, sample):
        if sample.get('schema') not in (3, 4) or 'timeline' not in sample:
            return
        received = sample['fetched']
        activity = (sample.get('context') or {}).get('activity')
        session = activity['session_id'] if activity else None
        # At most one summary each 15 seconds, plus explicit label changes.
        if 0 <= received - self.last_received < 15 and session == self.last_activity:
            return
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?)',
                            (sample['timeline']['event_id'], sample['snapshot_ts'], received,
                             session, json.dumps(sample, separators=(',', ':'))))
            if received < self.last_prune or received - self.last_prune >= 60:
                self.db.execute('DELETE FROM events WHERE received < ?', (received - RETENTION_SECONDS,))
                self.db.execute('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY received DESC LIMIT -1 OFFSET ?)', (MAX_ROWS,))
                self.last_prune = received
        self.last_received, self.last_activity = received, session

    def close(self):
        self.db.close()
