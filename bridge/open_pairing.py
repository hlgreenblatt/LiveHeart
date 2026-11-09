#!/usr/bin/env python3
"""Create a one-use, ten-minute pairing code in a private file outside the repo."""
import argparse
from pathlib import Path
import secrets
import time
from receiver import atomic_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairing-file', type=Path, required=True)
    args = parser.parse_args()
    target = args.pairing_file.expanduser().resolve()
    repository = Path(__file__).resolve().parents[1]
    if target.is_relative_to(repository):
        parser.error('Store pairing state outside the source repository')
    code = f'{secrets.randbelow(100000000):08d}'
    atomic_json(target, {'code': code, 'expires': time.time() + 600})
    print(f'Pairing code: {code}\nValid for ten minutes and one successful use.')
    print('If the receiver has reached its five-attempt limit, restart it before trying again.')


if __name__ == '__main__':
    main()
