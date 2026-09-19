# hermes-usage-history-rpc

Server-side usage analytics via gateway RPC for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

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

## Layout

```
tui_gateway/methods_usage_history.py   # Gateway module (HandlerRegistry pattern, like methods_session.py)
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
python3 test_rpc.py

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
