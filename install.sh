#!/usr/bin/env bash
# Installiert das usage.history / usage.totals Gateway-Modul in die lokale
# Hermes-Installation (idempotent — nach einem Hermes-Update einfach erneut laufen lassen).
#
# Ziel: $HERMES_LIB (default /usr/local/lib/hermes-agent), Datei tui_gateway/methods_usage_history.py
# Plus: server.py-Hooks (import + register) via Patch-Marker.
set -euo pipefail

HERMES_LIB="${HERMES_LIB:-/usr/local/lib/hermes-agent}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TG="$HERMES_LIB/tui_gateway"

# 1. Modul kopieren
install -m 0644 "$HERE/tui_gateway/methods_usage_history.py" "$TG/methods_usage_history.py"
echo "[ok] methods_usage_history.py -> $TG/"

# 2. server.py-Hooks setzen (idempotent per Marker-Check)
PY() { "$HERMES_LIB/venv/bin/python" -c "$1"; }

PY "
import re, sys
p = '$TG/server.py'
src = open(p).read()
changed = False
if 'methods_usage_history as _methods_usage_history' not in src:
    if 'methods_connectors as _methods_connectors)' not in src:
        sys.exit('server.py: Anker (methods_connectors import) nicht gefunden — Hermes-Version prüfen!')
    src = src.replace(
        'methods_connectors as _methods_connectors)',
        'methods_connectors as _methods_connectors, methods_usage_history as _methods_usage_history)')
    changed = True
if '_methods_connectors, _methods_usage_history):' not in src:
    if '_methods_connectors):' not in src:
        sys.exit('server.py: Register-Anker nicht gefunden — Hermes-Version prüfen!')
    src = src.replace(
        '_methods_connectors):',
        '_methods_connectors, _methods_usage_history):')
    changed = True
if changed:
    open(p, 'w').write(src)
    print('[ok] server.py hooks gesetzt')
else:
    print('[ok] server.py hooks bereits vorhanden')
"

# 3. Syntax-Check
PY "import ast; ast.parse(open('$TG/server.py').read()); print('[ok] server.py syntax ok')"
PY "import ast; ast.parse(open('$TG/methods_usage_history.py').read()); print('[ok] methods_usage_history.py syntax ok')"

# 4. Service-Restart anbieten (WICHTIG: Desktop-App/Clients hängen am
#    DASHBOARD-Service auf Port 9119 — nicht am messaging-gateway!).
#    Ohne Neustart serviert der laufende Prozess alte Module ohne die RPCs.
SERVICE="hermes-dashboard.service"
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active "$SERVICE" >/dev/null 2>&1; then
  if [ "${ASSUME_YES:-}" = "1" ]; then
    RESTART=y
  else
    read -r -p ">>> $SERVICE jetzt neu starten, damit die RPCs live gehen? [y/N] " RESTART
  fi
  case "$RESTART" in
    [yY]|[yY][eE][sS])
      systemctl --user restart "$SERVICE"
      sleep 3
      if systemctl --user is-active "$SERVICE" >/dev/null 2>&1; then
        echo "[ok] $SERVICE neu gestartet und aktiv"
      else
        echo "[FEHLER] $SERVICE nicht aktiv nach Restart — prüfen: journalctl --user -u $SERVICE -n 30" >&2
        exit 1
      fi
      ;;
    *)
      echo "[skip] kein Restart — RPCs erst nach 'systemctl --user restart $SERVICE' verfügbar"
      ;;
  esac
else
  echo "[skip] $SERVICE läuft nicht (systemctl --user) — manuell starten, falls dieser Host der Dashboard-/Desktop-Backend ist"
fi
