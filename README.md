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

## Web dashboard plugin (v0.6.0)

`plugin_pkg/token-stats/dashboard/` also ships a **web-dashboard plugin**
(`web-entry.js`, referenced by the manifest's `entry` field): a full port of
the desktop pane's design as a tab in the Hermes **web** dashboard (the
browser UI on port 9119 — a separate plugin SDK from the desktop app's).
It registers via `window.__HERMES_PLUGINS__.register()` and fetches live
data from the same ledger backend routes via the host's `fetchJSON`
(30 s poll, calendar-window presets, day-group totals, ⚡ cache-hit bar,
🪙/€ histogram, model/subagent/aux breakdowns, ⚠ anomaly flags).

The pane logic (pricing tables, `estimateCost`, calendar windows,
aggregations) is a verbatim port of the desktop plugin. **Parity rule:**
every change or fix to the desktop pane is ported to the web entry as
well — the two implementations stay in lockstep (pricing changes in
particular must land in both files). The web entry carries its own
version marker (`vX.Y.Z-web.N` in the file header), bumped on every port.

Styling is self-contained: the web build ships a fixed
compiled Tailwind CSS, so the entry injects its own namespaced `.ts-*`
stylesheet built on the dashboard theme variables (`--midground-base` etc.)
and follows the active theme. No Tailwind classes are used.

| Scope | Web port |
|---|---|
| Presets, summary, histogram, day groups, breakdowns, anomaly flags | ✔ |
| Statusbar chip, live-usage overlay, column drag-resize | ✖ (desktop-only — no session event stream in the web SDK) |

## Layout

```
tui_gateway/methods_usage_history.py   # Gateway module (HandlerRegistry pattern, like methods_session.py)
ledger/schema.sql                      # Ledger DB schema (ledger_rows, ledger_events, ledger_meta; WAL)
ledger/engine.py                       # Delta engine: known/last_db/live_db per grain+counter (v0.5.0: write-sparse)
ledger/poller.py                       # state.db → rows mapping (read-only snapshot, v0.5.0: archive cut-off)
ledger/daemon.py                       # 15-s poll loop, per-profile discovery, --once mode (LEDGER_INTERVAL env)
ledger/token-stats-ledger.service      # systemd unit
plugin_pkg/token-stats/                # Plugin backend package (deploys to ~/.hermes/plugins/token-stats/)
plugin_pkg/token-stats/dashboard/      # Backend routes (plugin_api.py) + web-dashboard entry (web-entry.js)
test_ledger_engine.py                  # Delta-rule unit tests (incl. write-sparsity regressions)
test_ledger_poller.py                  # Poller cut-off/reappear/heartbeat tests (v0.5.0)
test_plugin_api.py                     # Backend route tests (TestClient, isolated ENV)
install.sh                             # Idempotent installer (module copy + server.py hooks)
```

## Install / re-install after a Hermes update

```bash
./install.sh
```

All-in-one installer for the full stack — plugin package (backend routes +
web dashboard entry), `plugins.enabled` entry, legacy gateway RPC hooks,
known-ledger systemd daemon, dashboard restart and a smoke check. Idempotent:
safe to re-run at any time (e.g. after a Hermes update wiped the server.py
hooks, or after a `git pull`). No third-party dependencies — the ledger
daemon is pure stdlib, fastapi/ruamel come with the Hermes runtime, and the
installer only verifies their importability.

Flags: `--no-daemon` (plugin backend only), `--no-restart`, `--yes` /
`ASSUME_YES=1` (non-interactive). Env overrides: `HERMES_LIB`,
`HERMES_HOME`, `DASHBOARD_PORT`, `LEDGER_BASE`.

The server.py patch step is anchored on the `methods_connectors` import —
if upstream ever restructures that import list, the installer fails loudly
instead of patching something broken. The config.yaml edit inserts exactly
one list item (no YAML round-trip — a library dump reflows the whole file);
a backup is written next to the config first.

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
