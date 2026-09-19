# hermes-usage-history-rpc

Server-side Usage-Analytics via Gateway-RPC für [Hermes Agent](https://github.com/NousResearch/hermes-agent).

## Was das macht

Zwei neue JSON-RPC-Methoden im Hermes-Gateway, die **persistente** Token-/Kosten-Daten aus
`state.db` lesen — unabhängig vom Client und über Gateway-Neustarts hinweg (die Lücke: der
existierende `session.usage`-RPC liefert nur live in-memory Daten der fokussierten Session).

| Methode | Parameter | Rückgabe |
|---|---|---|
| `usage.history` | `days` (default 30, 0 = alles), `since` (unix ts), `limit` (default 200), `models` (bool, default true), `session_id` (Deep-Dive) | `sessions: [...]` kompakte Zeilen mit Token-Totals + `model_usage: [...]` Per-Model/Task-Breakdown |
| `usage.totals` | `days` / `since` | `totals` (Summen), `by_model` (Rollup), `by_day` (Rollup mit Kosten) |

Datenquellen: `sessions` (Lifetime-Totals pro Session) + `session_model_usage`
(Per-Model/Task, inkl. Auxiliary-Tasks wie `title_generation`, `background_review`).
Read-only, keine Writes.

## Layout

```
tui_gateway/methods_usage_history.py   # Gateway-Modul (HandlerRegistry-Pattern wie methods_session.py)
install.sh                             # Idempotenter Installer (Modul-Kopie + server.py-Hooks)
```

## Install / Re-Install nach Hermes-Update

```bash
./install.sh
systemctl --user restart hermes-gateway.service
```

Der Installer prüft per Marker, ob die server.py-Hooks (Import + Register-Loop) schon
gesetzt sind, und tut nichts, wenn alles vorhanden ist. Anker ist der `methods_connectors`
Import — wenn upstream die Import-Liste umbaut, schlägt der Installer sauber fehl statt
kaputtzupatchen.

## Verifikation nach Install

```bash
# RPC-Test direkt gegen den Gateway:
# (Desktop-Plugin nutzt host.request('usage.history', {days: 7}))
sqlite3 ~/.hermes/state.db "SELECT count(*) FROM sessions;"  # vorher/nachher gleich
```

## Kontext

- Ergänzt das **token-stats Desktop-Plugin** (Plugin zeigt live + historische Daten)
- `state.db` ist pro Profil; das `profile`-Parameter-Grundgerüst ist im Handler vorbereitet
- Upstream-Kandidat: sauber als PR gegen NousResearch/hermes-agent einreichbar
  (HandlerRegistry-Pattern, keine Writes, keine neuen Dependencies)
