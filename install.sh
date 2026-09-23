#!/usr/bin/env bash
# Installiert das usage.history / usage.totals Gateway-Modul in die lokale
# Hermes-Installation (idempotent — nach einem Hermes-Update einfach erneut laufen lassen).
#
# Ziel: $HERMES_LIB (default /usr/local/lib/hermes-agent), Datei tui_gateway/methods_usage_history.py
# Plus: server.py-Hooks (import + register). Anker werden per Regex gesucht, damit
# Upstream-Formatierung (einzeiliger vs. mehrzeiliger Import) den Patch nicht bricht.
set -euo pipefail

HERMES_LIB="${HERMES_LIB:-/usr/local/lib/hermes-agent}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TG="$HERMES_LIB/tui_gateway"

# 1. Modul kopieren
install -m 0644 "$HERE/tui_gateway/methods_usage_history.py" "$TG/methods_usage_history.py"
echo "[ok] methods_usage_history.py -> $TG/"

# 2. server.py-Hooks setzen (idempotent per Marker-Check).
# Python-Code liegt als heredoc in einer temp-Datei (kein $- oder Quote-Expandier-Risiko).
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<'PYEOF'
import re, sys
p = sys.argv[1]
src = open(p).read()
changed = False

if 'methods_usage_history as _methods_usage_history' not in src:
    # Import-Anker: 'methods_connectors as _methods_connectors' plus das nächste
    # Satzzeichen (Komma, Klammer oder Newline) — deckt einzeiligen und
    # mehrzeiligen Upstream-Import ab.
    m = re.search(r'methods_connectors as _methods_connectors([,\)\n])', src)
    if not m:
        sys.exit('server.py: Anker (methods_connectors import) nicht gefunden — Hermes-Version prüfen!')
    tok = m.group(1)
    add = 'methods_usage_history as _methods_usage_history'
    if tok == ')':
        repl = 'methods_connectors as _methods_connectors, ' + add + ')'
    elif tok == ',':
        repl = 'methods_connectors as _methods_connectors, ' + add + ','
    else:  # Newline — Modul als eigene Zeile in den mehrzeiligen Import
        repl = 'methods_connectors as _methods_connectors,\n    ' + add + '\n'
    src = src[:m.start()] + repl + src[m.end():]
    changed = True

# Register-Anker: das for-_m-in-Tupel; Modul vor der schließenden Klammer einfügen.
# Existenz-Check: _methods_usage_history muss als TUPEL-ELEMENT vorkommen — der
# Import-Alias allein (ohne folgendes Komma) zählt nicht als registriert.
fm = src.find('for _m in (')
if fm == -1:
    sys.exit('server.py: Register-Anker (for _m in) nicht gefunden — Hermes-Version prüfen!')
if not re.search(r'for _m in \([^)]*_methods_usage_history', src, re.S):
    close = src.find('):', fm)
    if close == -1:
        sys.exit('server.py: Register-Anker: schließende Klammer nicht gefunden')
    src = src[:close] + ',\n    _methods_usage_history' + src[close:]
    changed = True

if changed:
    open(p, 'w').write(src)
    print('[ok] server.py hooks gesetzt')
else:
    print('[ok] server.py hooks bereits vorhanden')
PYEOF
"$HERMES_LIB/venv/bin/python" "$TMP" "$TG/server.py"

# 3. Syntax-Check
"$HERMES_LIB/venv/bin/python" -c "import ast; ast.parse(open('$TG/server.py').read()); print('[ok] server.py syntax ok')"
"$HERMES_LIB/venv/bin/python" -c "import ast; ast.parse(open('$TG/methods_usage_history.py').read()); print('[ok] methods_usage_history.py syntax ok')"

# 4. Service-Restart anbieten (WICHTIG: Desktop-App/Clients hängen am
#    DASHBOARD-Service auf Port 9119 — nicht am messaging-gateway!)
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
