#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -B -m unittest discover -s bridge -p 'test_*.py'
for test in watch/test-*.mjs; do
  node "$test"
done
