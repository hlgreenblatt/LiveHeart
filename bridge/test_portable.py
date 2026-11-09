"""Portable setup tests use only temporary files and synthetic clock functions."""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import thread_clock


class PortableSetupTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in [('_watch', None), ('_loaded', False), ('_sync', None), ('_checked', -float('inf'))]:
            self.stack.enter_context(patch.object(thread_clock, name, value))

    def test_explicit_threadwatch_file_does_not_search_machine_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'watch.py'
            source.write_text('def clock_synced(): return True\ndef utc_iso(): return "synthetic"\n')
            with patch.dict(os.environ, {'THREADWATCH_PATH': str(source)}), \
                 patch.object(thread_clock.metadata, 'distribution') as lookup:
                info = thread_clock.clock_info(1700000000)
                self.assertEqual(info['source'], 'ThreadWatch')
                self.assertIs(info['ntp_synchronized'], True)
                self.assertEqual(info['utc'], '2023-11-14T22:13:20.000Z')
                lookup.assert_not_called()

    def test_missing_optional_toolkit_is_explicit_fallback(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(thread_clock.metadata, 'distribution', side_effect=thread_clock.metadata.PackageNotFoundError):
            info = thread_clock.clock_info(1700000000)
            self.assertEqual(info['source'], 'host-clock fallback')
            self.assertIsNone(info['ntp_synchronized'])

    def test_pairing_helper_private_output_and_source_tree_refusal(self):
        script = Path(__file__).with_name('open_pairing.py')
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'private' / 'pairing.json'
            subprocess.run([sys.executable, '-B', str(script), '--pairing-file', str(target)],
                           capture_output=True, check=True)
            config = json.loads(target.read_text())
            self.assertRegex(config['code'], r'^\d{8}$')
            self.assertLess(abs(config['expires'] - time.time() - 600), 5)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(target.parent.stat().st_mode & 0o777, 0o700)
        blocked = script.parent.parent / 'state' / 'pairing.json'
        result = subprocess.run([sys.executable, '-B', str(script), '--pairing-file', str(blocked)], capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(blocked.exists())


if __name__ == '__main__':
    unittest.main()
