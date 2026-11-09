#!/usr/bin/env python3
"""Read the private snapshot named by WATCH_VITALS_FILE or a positional path."""
import argparse
import os
from pathlib import Path
from reading import describe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', nargs='?', type=Path,
                        default=Path(os.environ.get('WATCH_VITALS_FILE', '~/.local/state/live-heart/latest.json')))
    args = parser.parse_args()
    print(describe(args.path.expanduser()))


if __name__ == '__main__':
    main()
