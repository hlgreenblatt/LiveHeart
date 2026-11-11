# Live Heart

Live watch measurements for personal agents, through a local computer receiver.
Built for an Amazfit Bip Max and an Android phone running Zepp.

```text
Watch sensors → Bluetooth → Zepp phone side service → local receiver
                                                     ├─ private snapshot → agent reader
                                                     └─ optional private UTC history
```

The agent reads a local snapshot through a command or a read-only MCP tool.
The receiver has no HTTP endpoint for reading health data and does not log into
a Zepp account. Each measurement retains its own time and freshness status.

## Current status

**1.2.3 is the next watch-test candidate.** It recovers from an unanswered send
after 20 seconds, on the next collection tick, and collects practice motion
across the full send interval. Motion also accumulates while waiting for a reply
or a phone reconnection, up to a 20-second window. A longer interruption starts
a new window; a window already sent is not replayed if delivery fails. Synthetic
tests cover these cases. Physical-watch verification of 1.2.3 is still pending.

**1.2.2 passed a one-minute background check on the physical watch.** With the
watch showing its normal clock face, fresh heart-rate and step timestamps kept
advancing at each authorized reader throughout the check. Local tests and the
Zepp build also pass. Long-duration reliability, battery endurance, reconnection
and restart behavior remain unverified. Earlier foreground sharing of heart
rate, steps and motion also worked on hardware.

The 1.2.1 watch reported `Timer returned object` during startup. JavaScript uses
that type name for both objects and `null`, so the report does not establish
which was returned. The 1.2.2 candidate preserves non-null timer objects without
coercion, rejects `null` explicitly, and flags a timer that does not tick.

| Capability | Status |
| --- | --- |
| Heart rate and daily/session steps | Sensor timestamps preserved; one-minute clock-face check passed |
| Wrist motion summary | Foreground practice screen only |
| Activity labels | Explicit user selection: tai chi, yoga, tantra, mowing, shoveling, walking |
| UTC-aware readers | Clock checked before reading; stale and missing data remain explicit |
| Local history | Optional seven-day store of summaries and label changes |
| Activity recognition | Not implemented; labels are not predictions |
| ThreadLink correlation | UTC event alignment and optional ThreadWatch clock integration |
| FabricPC | Future integration point; no trained activity model |

This is a personal development project, not a medical device or emergency
monitor. It does not establish safe exertion limits or send automatic alerts.

## Repository contents and data

- `watch/`: watch app, phone side service, settings page, synthetic tests.
- `bridge/`: Python receiver, readers, UTC history and correlation code, synthetic tests.
- `scripts/`: test runner and publication checks.
- `THIRD_PARTY_NOTICES.md`: attribution for the vendored Zepp messaging library.

All health values, session records, keys and pairing codes in tests are invented
fixtures. No personal health recordings, database, live snapshot, account login,
bridge key, installation QR/link, deployment manifest or private network
configuration is included. The two PNG files are app icons.

Runtime health data and pairing state belong **outside this repository**.
The `.gitignore` excludes common runtime artifacts. The publication check also
checks the actual Git index against a reviewed file list and secret patterns.
These checks complement review; they cannot prove that arbitrary future prose
or code contains no sensitive information.

## Computer receiver

Requires Python 3.10 or newer. The bridge uses the standard library.

Create a private state directory and a bridge-only ingestion key:

```sh
umask 077
LIVE_HEART_STATE="$HOME/.local/state/live-heart"
mkdir -p "$LIVE_HEART_STATE"
python3 bridge/receiver.py --init-key \
  --key-file "$LIVE_HEART_STATE/ingest.key" \
  --output "$LIVE_HEART_STATE/latest.json"
python3 bridge/open_pairing.py --pairing-file "$LIVE_HEART_STATE/pairing.json"
```

The pairing command displays a new one-use code, valid for ten minutes. Replace
the example address below with the computer's actual private LAN address, then
start the receiver in a terminal:

```sh
python3 bridge/receiver.py \
  --host 192.168.1.100 --port 18962 \
  --key-file "$LIVE_HEART_STATE/ingest.key" \
  --pairing-file "$LIVE_HEART_STATE/pairing.json" \
  --output "$LIVE_HEART_STATE/latest.json" \
  --history-file "$LIVE_HEART_STATE/events.sqlite3"
```

Omit `--history-file` to keep only the latest snapshot. Repeat `--mirror-output`
with private file paths for additional authorized readers. A failed mirror does
not stop delivery to the other readers. The receiver limits pairing to five
attempts per process; restart it after reaching that limit.

The phone must be on a network that can reach the computer. The computer may use
Ethernet. Guest Wi-Fi and separate home networks can prevent the connection.
In the app's Zepp settings, save the complete receiver address, such as
`http://192.168.1.100:18962`, then enter the pairing code and pair.

`GET /healthz` confirms reachability only. It does not confirm that watch readings
are arriving. Other GET requests return `No read API`.

## Build and install the watch app

Use the [Zepp developer tools](https://docs.zepp.com/) and a compatible device.
The current configuration targets a Bip Max, 432 × 514, API level 4.0.
Configure your own app identity and device target before distributing a fork.

With the Zeus CLI installed:

```sh
cd watch
npm install --ignore-scripts
zeus build
```

For your own development installation, authenticate with Zeus locally and run
`zeus preview -t 'Amazfit Bip Max'`. Preview uploads the package to Zepp and
generates an installation QR. Keep account credentials and that QR out of Git.
Scan the QR with Zepp's developer scanner on the phone.

On the physical watch, open Live Heart, start background monitoring, and allow
background access if requested. First verify fresh readings in the receiver;
then return to the clock face and verify continued heart-rate and step updates.
Do not infer successful background operation from one initial reading.

Diagnostic codes:

| Code | Meaning |
| --- | --- |
| T0 | Required system timer API is unavailable |
| T1 | Native timer creation threw an exception |
| T2 | Timer creation returned a missing or unsupported handle; `null` is named explicitly |
| T3 | No timer callback for at least 20 seconds while the monitor is running |
| S0 | Other startup exception |
| L0 | Bluetooth connection-state query threw an exception |

Zepp's [system timer documentation](https://docs.zepp.com/docs/reference/device-app-api/newAPI/timer/createSysTimer/)
describes numeric IDs. This candidate keeps numeric and non-null object handles
unchanged when calling `stopTimer`. Tests verify object identity, cancellation,
timeouts and repeated collection; they do not emulate watch firmware.

## Agent access and UTC

For a command-based agent:

```sh
python3 bridge/watch_vitals_now.py "$HOME/.local/state/live-heart/latest.json"
```

For an MCP-capable agent, start `python3 bridge/agent_reader.py` as a stdio server.
Set `WATCH_VITALS_FILE` to that agent's authorized snapshot path. The tool is
`watch_vitals_now`; it has no watch-control or account-login capability.

The optional [ThreadLink toolkit](https://github.com/hlgreenblatt/ThreadLink)
provides ThreadWatch. The reader uses an installed distribution or the trusted
local file selected by `THREADWATCH_PATH`. Without it, the reader explicitly
reports a host-clock fallback and unknown synchronization status. An explicitly
unsynchronized clock prevents a live-freshness claim. Watch clock accuracy is
not independently verified.

`correlation.activity_window()` aligns an explicitly labeled session with
caller-supplied UTC events. Missing features remain missing, gaps are reported,
and time coincidence is not treated as causation. It neither trains FabricPC
nor broadcasts health events to an agent bus.

## Related pet-sensing work

[Ishtar Listener](https://github.com/hlgreenblatt/ishtar-listener) measures audio
and video clips and maintains pet profiles and clip history. A future collar
adapter could align motion observations with those clips using a pet identifier
and UTC timestamps. That integration is not implemented. It needs a separate
pet sensor schema and evaluation; human activity labels and health assumptions
must not silently transfer to animals.

## Privacy boundaries

Pairing gives the phone a narrowly scoped ingestion key, not a Zepp account
password. Samples are validated and written to owner-only files. Those file
permissions do not isolate agents that run as the same operating-system user.
Grant file access only to intended readers.

The built-in receiver uses HTTP. Use it only on a trusted private LAN; the
pairing code, ingestion key and readings are not encrypted on that HTTP hop.
HTTPS endpoints are accepted by the phone relay but require a separately
configured TLS proxy. Do not expose the built-in receiver to the public internet.

Giving a cloud-backed agent a reading can send that reading to its model
provider. The bridge itself does not choose or contact a model provider.
The optional history stores summaries for seven days, capped at roughly 50,000
rows; it does not store raw accelerometer streams.

## Tests and publication review

```sh
bash scripts/test.sh
git add README.md LICENSE .gitignore PUBLIC_FILES.txt THIRD_PARTY_NOTICES.md bridge watch scripts
python3 scripts/check_public_tree.py
```

Tests create synthetic readings in temporary directories and use loopback-only
HTTP servers. No physical watch, account login, real health file or network
receiver is required. Update `PUBLIC_FILES.txt` deliberately when adding reviewed
source files; do not add runtime files to make the check pass.

## Licence

MIT; see `LICENSE`. The vendored messaging library in `watch/lib/zml-app.js`
keeps its own Apache License 2.0; see `THIRD_PARTY_NOTICES.md`.
