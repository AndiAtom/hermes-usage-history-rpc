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
echo "[done] Gateway neu starten:  systemctl --user restart hermes-gateway.service"
