#!/usr/bin/env python3
"""Check the Git index, not just ignored working files, before publication.

This is a release guard, not a comprehensive secret detector. Review is required.
"""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    entries = {}
    failures = []
    for record in git('ls-files', '--stage', '-z').split(b'\0'):
        if not record:
            continue
        info, path = record.split(b'\t', 1)
        mode, oid, stage = info.decode().split()
        path = path.decode()
        if mode not in ('100644', '100755') or stage != '0':
            failures.append(f'{path}: symlink, submodule or unresolved index entry')
        entries[path] = oid
    if 'PUBLIC_FILES.txt' not in entries:
        sys.exit('Stage the reviewed PUBLIC_FILES.txt file first.')
    approved = set(git('cat-file', 'blob', entries['PUBLIC_FILES.txt']).decode().splitlines())
    for path in sorted(set(entries) ^ approved):
        failures.append(f'{path}: index differs from the reviewed file list')
    forbidden = re.compile(r'(?i)(?:^|/)(?:\.zeus|\.env(?:\..*)?|latest\.json|pairing\.json|install-(?:url|qr).*|.*\.(?:key|pem|sqlite\w*|db|jsonl|csv|tsv|log|zab|zpk|zip|bak))$')
    secret = re.compile(rb'-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{24,}')
    allowed_json = {'watch/app.json', 'watch/package.json'}
    allowed_images = {'watch/assets/bip-max/icon.png', 'watch/assets/432x514-amazfit-bip-max/icon.png'}
    for path, oid in entries.items():
        data = git('cat-file', 'blob', oid)
        if forbidden.search(path) or any(part in path.split('/') for part in ('node_modules', 'dist', 'private-health', 'runtime', 'state')):
            failures.append(f'{path}: runtime or private artifact')
        if path.endswith('.json') and path not in allowed_json:
            failures.append(f'{path}: unreviewed JSON data file')
        if len(data) > 512_000:
            failures.append(f'{path}: unexpectedly large source artifact')
        if secret.search(data):
            failures.append(f'{path}: credential-shaped content; value withheld')
        if path in allowed_images:
            if not data.startswith(b'\x89PNG\r\n\x1a\n'):
                failures.append(f'{path}: expected app icon PNG')
        else:
            try:
                data.decode('utf-8')
            except UnicodeDecodeError:
                failures.append(f'{path}: unreviewed binary content')
    if failures:
        sys.exit('\n'.join(failures))
    print(f'Publication check passed for {len(entries)} staged source/documentation/icon files.')
    print('No runtime artifact, unreviewed JSON/binary, or recognized credential pattern found.')


if __name__ == '__main__':
    main()
