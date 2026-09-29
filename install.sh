#!/usr/bin/env bash
# Installs the usage.history / usage.totals gateway module into the local
# Hermes installation (idempotent — just run again after a Hermes update).
#
# Target: $HERMES_LIB (default /usr/local/lib/hermes-agent), file tui_gateway/methods_usage_history.py
# Plus: server.py hooks (import + register). Anchors are located via regex, so
# upstream formatting (single-line vs. multi-line import) does not break the patch.
set -euo pipefail

HERMES_LIB="${HERMES_LIB:-/usr/local/lib/hermes-agent}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TG="$HERMES_LIB/tui_gateway"

# 1. Copy the module
install -m 0644 "$HERE/tui_gateway/methods_usage_history.py" "$TG/methods_usage_history.py"
echo "[ok] methods_usage_history.py -> $TG/"

# 2. Set server.py hooks (idempotent via marker check).
# Python code lives in a temp file as a heredoc (no $ or quote expansion risk).
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<'PYEOF'
import re, sys
p = sys.argv[1]
src = open(p).read()
changed = False

if 'methods_usage_history as _methods_usage_history' not in src:
    # Import anchor: 'methods_connectors as _methods_connectors' plus the next
    # punctuation (comma, parenthesis, or newline) — covers single-line and
    # multi-line upstream imports.
    m = re.search(r'methods_connectors as _methods_connectors([,\)\n])', src)
    if not m:
        sys.exit('server.py: anchor (methods_connectors import) not found — check the Hermes version!')
    tok = m.group(1)
    add = 'methods_usage_history as _methods_usage_history'
    if tok == ')':
        repl = 'methods_connectors as _methods_connectors, ' + add + ')'
    elif tok == ',':
        repl = 'methods_connectors as _methods_connectors, ' + add + ','
    else:  # Newline — add the module as its own line in the multi-line import
        repl = 'methods_connectors as _methods_connectors,\n    ' + add + '\n'
    src = src[:m.start()] + repl + src[m.end():]
    changed = True

# Register anchor: the for-_m-in tuple; insert the module before the closing parenthesis.
# Existence check: _methods_usage_history must appear as a TUPLE ELEMENT — the
# import alias alone (without a following comma) does not count as registered.
fm = src.find('for _m in (')
if fm == -1:
    sys.exit('server.py: register anchor (for _m in) not found — check the Hermes version!')
if not re.search(r'for _m in \([^)]*_methods_usage_history', src, re.S):
    close = src.find('):', fm)
    if close == -1:
        sys.exit('server.py: register anchor: closing parenthesis not found')
    src = src[:close] + ',\n    _methods_usage_history' + src[close:]
    changed = True

if changed:
    open(p, 'w').write(src)
    print('[ok] server.py hooks set')
else:
    print('[ok] server.py hooks already present')
PYEOF
"$HERMES_LIB/venv/bin/python" "$TMP" "$TG/server.py"

# 3. Syntax check
"$HERMES_LIB/venv/bin/python" -c "import ast; ast.parse(open('$TG/server.py').read()); print('[ok] server.py syntax ok')"
"$HERMES_LIB/venv/bin/python" -c "import ast; ast.parse(open('$TG/methods_usage_history.py').read()); print('[ok] methods_usage_history.py syntax ok')"

# 4. Offer a service restart (IMPORTANT: desktop app/clients talk to the
#    DASHBOARD service on port 9119 — not the messaging gateway!)
SERVICE="hermes-dashboard.service"
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active "$SERVICE" >/dev/null 2>&1; then
  if [ "${ASSUME_YES:-}" = "1" ]; then
    RESTART=y
  else
    read -r -p ">>> Restart $SERVICE now so the RPCs go live? [y/N] " RESTART
  fi
  case "$RESTART" in
    [yY]|[yY][eE][sS])
      systemctl --user restart "$SERVICE"
      sleep 3
      if systemctl --user is-active "$SERVICE" >/dev/null 2>&1; then
        echo "[ok] $SERVICE restarted and active"
      else
        echo "[ERROR] $SERVICE not active after restart — check: journalctl --user -u $SERVICE -n 30" >&2
        exit 1
      fi
      ;;
    *)
      echo "[skip] no restart — RPCs only available after 'systemctl --user restart $SERVICE'"
      ;;
  esac
else
  echo "[skip] $SERVICE not running (systemctl --user) — start it manually if this host is the dashboard/desktop backend"
fi
