# hermes-usage-history-rpc

Server-side usage analytics for [Hermes Agent](https://github.com/NousResearch/hermes-agent):
two patched-in gateway RPCs **plus** a known-ledger daemon + plugin backend
serving **monotonic** (compression-safe) token counters.

## What it does

Two new JSON-RPC methods for the Hermes gateway that read **persistent** token/cost
data from `state.db` — client-independent and across gateway restarts (the gap:
the existing `session.usage` RPC only serves live in-memory data of the focused
session).

| Method | Parameters | Returns |
|---|---|---|
| `usage.history` | `days` (default 30, 0 = all time), `since` (unix ts), `limit` (default 200), `models` (bool, default true), `session_id` (deep dive) | `sessions: [...]` compact rows with token totals + `model_usage: [...]` per-model/task breakdown |
| `usage.totals` | `days` / `since` | `totals` (sums), `by_model` (rollup), `by_day` (rollup with cost) |

Data sources: `sessions` (lifetime totals per session) + `session_model_usage`
(per model/task, including auxiliary tasks like `title_generation`,
`background_review`). Read-only, no writes.

## Known-Ledger (monotonic counters)

`state.db` is NOT monotonic: compression resets, `ON DELETE CASCADE` on
`session_model_usage` and rewinds make counters drop. Client-side
"largest seen value" heuristics lose deltas. The ledger fixes that:

- **Daemon** (`ledger/daemon.py`, systemd unit `token-stats-ledger.service`)
  polls every profile's `state.db` read-only (`mode=ro`) every 15 s
  (configurable via `LEDGER_INTERVAL`) and accumulates per-grain
  `(session_id, model, provider, base_url, mode, task)` counters: `known`
  (monotonic, never drops — what the client sees), `last_db` (diff base),
  `live_db` (last poll). Negative deltas add the new DB value
  (re-baseline), vanished rows log `removed`/`reappeared` events in
  `ledger_events`. One ledger DB per profile:
  `~/token-stats-ledger/<profile>/ledger.db` (`LEDGER_BASE`, default below
  the invoking user's home — for a root systemd service that is
  `/root/token-stats-ledger`).
  **Archive cut-off (v0.5.0):** rows of archived sessions
  (`sessions.archived = 1`) whose last usage write is older than 1 h
  (`ARCHIVE_GRACE_SECONDS`) drop out of the poll snapshot — their `known`
  counters freeze at the final value (removed-path) and stay visible.
  Resume/unarchive re-adds them (reappear-path, baseline without delta;
  a DB value above `known` pulls the delta in). Measured effect:
  ~95 % fewer disk writes (133 KiB → 7 KiB per poll).
  **Write sparsity (v0.5.0):** cycles with no changes write nothing but a
  heartbeat row (`ledger_meta.heartbeat`, ~16 bytes) — `last_poll` on a
  row means "last change", daemon liveness is the heartbeat. Ledger DB
  connections stay open across cycles (WAL allows concurrent backend
  readers).
- **Plugin backend** (`plugin_pkg/token-stats/`) mounts under
  `/api/plugins/token-stats/` (official plugin backend — `ctx.rest` from the
  desktop plugin reaches it; survives Hermes updates since it lives in
  `~/.hermes/plugins/`):

| Route | Parameters | Returns |
|---|---|---|
| `/api/plugins/token-stats/ledger` | `days`, `since` (inclusive), `until` (EXCLUSIVE upper bound, calendar windows), `limit`, `session_id`, `models`, `profile` | `sessions[]` + `model_usage[]` — shape-compatible with `usage.history` (known counters + state.db metadata, window/filter on real activity) |
| `/api/plugins/token-stats/events` | `session_id`, `limit`, `profile` | anomaly history (decrease/removed/reappeared) |
| `/api/plugins/token-stats/profiles` | — | available ledger profiles |
| `/api/plugins/token-stats/health` | `profile` | daemon liveness via heartbeat (`source: heartbeat`), rows, age; `last_poll` fallback for pre-v0.5.0 ledger DBs |

The RPCs (`usage.history`/`usage.totals`) remain as **legacy fallback** for
the client (old gateways, OAuth remotes where `ctx.rest` is a no-op).

## Layout

```
tui_gateway/methods_usage_history.py   # Gateway module (HandlerRegistry pattern, like methods_session.py)
ledger/schema.sql                      # Ledger DB schema (ledger_rows, ledger_events, ledger_meta; WAL)
ledger/engine.py                       # Delta engine: known/last_db/live_db per grain+counter (v0.5.0: write-sparse)
ledger/poller.py                       # state.db → rows mapping (read-only snapshot, v0.5.0: archive cut-off)
ledger/daemon.py                       # 15-s poll loop, per-profile discovery, --once mode (LEDGER_INTERVAL env)
ledger/token-stats-ledger.service      # systemd unit
plugin_pkg/token-stats/                # Plugin backend package (deploys to ~/.hermes/plugins/token-stats/)
test_ledger_engine.py                  # Delta-rule unit tests (incl. write-sparsity regressions)
test_ledger_poller.py                  # Poller cut-off/reappear/heartbeat tests (v0.5.0)
test_plugin_api.py                     # Backend route tests (TestClient, isolated ENV)
install.sh                             # Idempotent installer (module copy + server.py hooks)
```

## Install / re-install after a Hermes update

```bash
./install.sh
```

The installer is idempotent: it checks markers whether the server.py hooks
(import + register loop) are already in place and does nothing if so. The anchor
is the `methods_connectors` import — if upstream ever restructures that import
list, the installer fails loudly instead of patching something broken.

After installing, restart the service the **desktop app actually talks to**
(`hermes-dashboard.service`, port 9119 — NOT `hermes-gateway.service`): the
installer offers this as a y/N prompt and also supports `ASSUME_YES=1` for
non-interactive runs.

## Verification after install

```bash
# RPC test in-process (imports tui_gateway.server, invokes the handlers):
# Hermes-venv required (system python3 lacks deps like dotenv):
/usr/local/lib/hermes-agent/venv/bin/python3 test_rpc.py

# state.db must be untouched (read-only module):
sqlite3 ~/.hermes/state.db "SELECT count(*) FROM sessions;"   # same before/after

# Desktop app consumes it via host.request('usage.history', {days: 7})
```

## Context

- Companion to the **[token-stats desktop plugin](https://github.com/AndiAtom/hermes-token-stats)**
  (plugin shows live + historical data; without this module its pane degrades
  to `live only`)
- `state.db` is per-profile; the `profile` parameter scaffolding is prepared in the handler
- Upstream candidate: cleanly submittable as a PR against NousResearch/hermes-agent
  (HandlerRegistry pattern, no writes, no new dependencies)

## License

[MIT](LICENSE) — © 2026 AndiAtom
