#!/usr/bin/env python3
"""Read-only MCP access to the watch's latest sample; no account credentials."""
import json
import os
import sys
from pathlib import Path
from reading import describe

PATH = Path(os.environ.get('WATCH_VITALS_FILE', '~/.local/state/live-heart/latest.json')).expanduser()
TOOL = {
    'name': 'watch_vitals_now',
    'description': 'Check ThreadWatch UTC first, then read watch heart rate, daily/session steps, wrist motion, and explicit activity labels. Each metric has its own timestamp and freshness. Motion does not identify poses or practices. No watch controls.',
    'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False},
    'annotations': {'readOnlyHint': True, 'destructiveHint': False, 'openWorldHint': False}
}


def main():
    for raw in sys.stdin:
        try:
            req = json.loads(raw)
            if not isinstance(req, dict):
                continue
        except ValueError:
            continue
        if 'id' not in req:
            continue
        method = req.get('method')
        error = None
        if method == 'initialize':
            requested = req.get('params', {}).get('protocolVersion', '2024-11-05')
            version = requested if requested in ('2024-11-05', '2025-03-26', '2025-06-18') else '2024-11-05'
            result = {'protocolVersion': version, 'capabilities': {'tools': {}},
                      'serverInfo': {'name': 'live-heart', 'version': '1.2.2'}}
        elif method == 'ping':
            result = {}
        elif method == 'tools/list':
            result = {'tools': [TOOL]}
        elif method == 'tools/call' and req.get('params', {}).get('name') == TOOL['name']:
            result = {'content': [{'type': 'text', 'text': describe(PATH)}], 'isError': False}
        else:
            error = {'code': -32601, 'message': 'Unknown method or tool'}
        response = {'jsonrpc': '2.0', 'id': req['id']}
        response['error' if error else 'result'] = error or result
        print(json.dumps(response), flush=True)


if __name__ == '__main__':
    main()
