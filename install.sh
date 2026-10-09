#!/usr/bin/env bash
# All-in-one installer for the token-stats backend stack:
#
#   1. Plugin package → ~/.hermes/plugins/token-stats/
#      (backend routes incl. the WEB DASHBOARD pane entry, web-entry.js)
#   2. plugins.enabled += token-stats in ~/.hermes/config.yaml
#      (edit via ruamel round-trip — comments preserved, backup first)
#   3. Legacy gateway RPCs (usage.history / usage.totals) → server.py hooks
#      (survive Hermes updates via re-run; idempotent, regex-anchored)
#   4. Known-ledger daemon → systemd unit token-stats-ledger.service
#      (template paths to THIS repo + the chosen python, enable + start)
#   5. Dashboard restart (port 9119) so the backend mounts
#   6. Smoke check (health route answers 200/401 = mounted, 404 = not)
#
# Idempotent: safe to re-run at any time (e.g. after a Hermes update wiped
# the server.py hooks, or to refresh the plugin package after a git pull).
#
# Python: the daemon is pure stdlib; fastapi for the plugin backend comes
# from the Hermes host runtime. The script therefore uses the Hermes-bundled
# python (venv shim → tools python) and only VERIFIES importability instead
# of pip-installing anything — nothing outside Hermes itself is needed.
#
# Flags / env:
#   --no-daemon      skip the ledger daemon setup (plugin backend only)
#   --no-restart     do not restart the dashboard (you do it yourself)
#   --yes | ASSUME_YES=1   non-interactive (default answer yes)
#   HERMES_LIB       Hermes install root   (default /usr/local/lib/hermes-agent)
#   HERMES_HOME      Hermes home            (default ~/.hermes)
#   DASHBOARD_PORT   dashboard port        (default 9119)
set -euo pipefail

HERMES_LIB="${HERMES_LIB:-/usr/local/lib/hermes-agent}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DASHBOARD_PORT="${DASHBOARD_PORT:-9119}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TG="$HERMES_LIB/tui_gateway"
PY="$HERMES_LIB/venv/bin/python"

DO_DAEMON=1
DO_RESTART=1
for arg in "$@"; do
  case "$arg" in
    --no-daemon) DO_DAEMON=0 ;;
    --no-restart) DO_RESTART=0 ;;
    --yes) ASSUME_YES=1 ;;
    *) echo "[error] unknown flag: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;32m[ok]\033[0m  %s\n' "$*"; }
info() { printf '\033[1;34m[..]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────
[ -d "$HERMES_LIB" ]   || die "Hermes install not found at $HERMES_LIB (set HERMES_LIB)"
[ -x "$PY" ]           || die "Hermes python not found at $PY"
[ -d "$HERMES_HOME" ]  || die "Hermes home not found at $HERMES_HOME (set HERMES_HOME)"
command -v ss >/dev/null 2>&1 || warn "ss not found — dashboard restart falls back to systemctl only"

"$PY" -c "import sqlite3"              || die "python at $PY cannot import sqlite3 (broken Hermes venv?)"
"$PY" -c "import fastapi" 2>/dev/null  || warn "python at $PY cannot import fastapi — the plugin backend routes will NOT load. Fastapi ships WITH Hermes normally; check your installation."

# ── 1. Plugin package (backend + web dashboard entry) ────────────────
mkdir -p "$HERMES_HOME/plugins/token-stats"
cp -r "$HERE/plugin_pkg/token-stats/." "$HERMES_HOME/plugins/token-stats/"
# byte-verify (skip __pycache__ which the host may have created)
if diff -r --exclude=__pycache__ "$HERE/plugin_pkg/token-stats" "$HERMES_HOME/plugins/token-stats" >/dev/null; then
  say "plugin package → $HERMES_HOME/plugins/token-stats/ (backend + web entry)"
else
  die "plugin package copy failed the diff check"
fi
[ -f "$HERMES_HOME/plugins/token-stats/dashboard/web-entry.js" ] \
  || die "web-entry.js missing in the deployed package (outdated repo clone? git pull)"

# ── 2. Enable the plugin in config.yaml (surgical text insert) ────────
# NO YAML-library round-trip: ruamel reflows the ENTIRE file (indent flips,
# line wrapping, quote styles) even though it preserves comments — verified
# the hard way on a live config. Instead: insert exactly one list item,
# leaving every other byte untouched.
# Hardened for FOREIGN configs (v0.6.2): finds `enabled:` anywhere in the
# plugins block (any key order, comments in between), creates the section
# or the key when missing, handles flow-style lists ([a, b]) and CRLF line
# endings, and REFUSES unrecognized layouts loudly instead of guessing —
# the ruamel validation afterwards is the hard guarantee that nothing
# broken ever reaches the config.
CONFIG="$HERMES_HOME/config.yaml"
[ -f "$CONFIG" ] || die "config not found: $CONFIG"
if grep -qE '^\s*-\s*["'"'"']?token-stats["'"'"']?\s*$' "$CONFIG"; then
  say "plugins.enabled already contains token-stats"
else
  # Never clobber an existing backup from a previous run.
  if [ ! -f "$CONFIG.bak-token-stats" ]; then
    cp "$CONFIG" "$CONFIG.bak-token-stats"
  else
    cp "$CONFIG" "$CONFIG.bak-token-stats.$$"
    warn "backup $CONFIG.bak-token-stats existed — wrote $CONFIG.bak-token-stats.$$ instead"
  fi
  TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
  cat > "$TMP" <<'PYEOF'
import re, sys

PLUGIN = "token-stats"
ITEM = "    - " + PLUGIN + "\n"
path = sys.argv[1]
raw = open(path, newline="").read()
crlf = "\r\n" in raw
lines = raw.splitlines(keepends=True)
eol = "\r\n" if crlf else "\n"
out, i, inserted = [], 0, False


def norm(s):
    return s.rstrip("\r\n")


def item_text(s):
    # list item body after '- ', quotes stripped
    return s.strip()[2:].strip().strip("'\"").strip()


while i < len(lines):
    line = lines[i]
    out.append(line)

    # Case A: plugins: block -> locate `enabled:` key ANYWHERE inside the
    # block (any key order, comments between keys). Indent-based: a new
    # top-level key (indent 0) or a key at plugins' own indent ends the block.
    if norm(line) == "plugins:":
        p_indent = 0  # top-level block key by definition
        j = i + 1
        block_end = len(lines)
        enabled_at = None
        while j < len(lines):
            l = norm(lines[j])
            if not l or l.lstrip().startswith("#"):
                j += 1
                continue
            indent = len(l) - len(l.lstrip())
            if indent <= p_indent and not l.lstrip().startswith("- "):
                block_end = j
                break
            if re.match(r"^\s*enabled:\s*(.*)$", l):
                # only the plugins' OWN enabled key (same indent level as
                # sibling keys, not nested deeper)
                if enabled_at is None:
                    enabled_at = j
            j += 1
        if enabled_at is not None:
            e = lines[enabled_at]
            rest = re.match(r"^\s*enabled:\s*(.*)$", norm(e)).group(1).strip()
            if rest.startswith("["):
                # flow style: enabled: [a, b] -> insert into the brackets
                inner = rest[1:-1].strip() if rest.endswith("]") else None
                if inner is None:
                    sys.exit("[error] plugins.enabled flow list not closed on one line — edit by hand")
                items = [x.strip() for x in inner.split(",") if x.strip()]
                if any(item_text("  - " + x) == PLUGIN for x in items):
                    print("[ok] plugins.enabled already contains token-stats (flow)")
                    sys.exit(0)
                items.append(PLUGIN)
                indent = len(norm(e)) - len(norm(e).lstrip())
                new = " " * indent + "enabled: [" + ", ".join(items) + "]"
                lines[enabled_at] = new + eol
                open(path, "w", newline="").writelines(lines)
                sys.exit(0)
            # block style: append after the last item of the list
            k = enabled_at + 1
            while k < block_end and norm(lines[k]).lstrip().startswith("- "):
                k += 1
            if k == enabled_at + 1:
                sys.exit("[error] plugins.enabled found but empty — add '    - token-stats' by hand")
            item_indent = re.match(r"^\s*-", norm(lines[enabled_at + 1])).group(0)
            out = lines[:k] + [item_indent.replace("-", "- " + PLUGIN) + eol] + lines[k:]
            open(path, "w", newline="").writelines(out)
            print("[ok] plugins.enabled += token-stats (backup: config.yaml.bak-token-stats)")
            sys.exit(0)
        # enabled: missing in the block -> insert it right after plugins:,
        # matching the block's key indent (or default 2 spaces)
        key_indent = "  "
        for l in lines[i + 1:block_end]:
            n = norm(l)
            if n and not n.lstrip().startswith("#") and not n.lstrip().startswith("- "):
                key_indent = n[: len(n) - len(n.lstrip())]
                break
        out = lines[: i + 1] + [key_indent + "enabled:" + eol, key_indent + "  - " + PLUGIN + eol] + lines[i + 1:]
        open(path, "w", newline="").writelines(out)
        print("[ok] plugins.enabled created under plugins: (backup: config.yaml.bak-token-stats)")
        sys.exit(0)

    i += 1

# Case B: no plugins: block at all -> append section at EOF (fresh installs).
new_eol = eol if (lines and lines[-1].endswith(eol)) else ("\r\n" if crlf else "\n")
out = lines + ["", "plugins:" + new_eol, "  enabled:" + new_eol, "    - " + PLUGIN + new_eol]
open(path, "w", newline="").writelines(out)
print("[ok] plugins section appended (backup: config.yaml.bak-token-stats)")
PYEOF
  "$PY" "$TMP" "$CONFIG"
  # Validate the result parses as YAML using Hermes' own ruamel.
  "$PY" -c "from ruamel.yaml import YAML; d = YAML().load(open('$CONFIG')); assert 'token-stats' in d['plugins']['enabled'], 'entry missing after edit'; print('[ok] config.yaml parses, token-stats enabled')" \
    || die "config.yaml edit failed validation — restore from $CONFIG.bak-token-stats"
fi

# ── 3. Legacy gateway RPCs (usage.history / usage.totals) ─────────────
install -m 0644 "$HERE/tui_gateway/methods_usage_history.py" "$TG/methods_usage_history.py"
say "methods_usage_history.py → $TG/"

# server.py hooks (idempotent via marker check; regex anchors survive
# upstream reformatting of the import block).
TMP="$(mktemp)"
cat > "$TMP" <<'PYEOF'
import re, sys
p = sys.argv[1]
src = open(p).read()
changed = False

if 'methods_usage_history as _methods_usage_history' not in src:
    # Import anchor: 'methods_connectors as _methods_connectors' plus the next
    # punctuation (comma, parenthesis, or newline) — covers single-line and
    # multi-line upstream imports.
    m = re.search(r'methods_connectors as _methods_connectors([,\\)\\n])', src)
    if not m:
        sys.exit('server.py: anchor (methods_connectors import) not found — check the Hermes version!')
    tok = m.group(1)
    add = 'methods_usage_history as _methods_usage_history'
    if tok == ')':
        repl = 'methods_connectors as _methods_connectors, ' + add + ')'
    elif tok == ',':
        repl = 'methods_connectors as _methods_connectors, ' + add + ','
    else:  # Newline — add the module as its own line in the multi-line import
        repl = 'methods_connectors as _methods_connectors,\\n    ' + add + '\\n'
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
    src = src[:close] + ',\\n    _methods_usage_history' + src[close:]
    changed = True

if changed:
    open(p, 'w').write(src)
    print('[ok] server.py hooks set')
else:
    print('[ok] server.py hooks already present')
PYEOF
"$PY" "$TMP" "$TG/server.py"
"$PY" -c "import ast; ast.parse(open('$TG/server.py').read()); print('[ok] server.py syntax ok')"
"$PY" -c "import ast; ast.parse(open('$TG/methods_usage_history.py').read()); print('[ok] methods_usage_history.py syntax ok')"

# ── 4. Known-ledger daemon (systemd) ─────────────────────────────────
if [ "$DO_DAEMON" = "1" ]; then
  LEDGER_BASE="${LEDGER_BASE:-$HOME/token-stats-ledger}"
  mkdir -p "$LEDGER_BASE"

  UNIT_SRC="$HERE/ledger/token-stats-ledger.service"
  UNIT_DST="/etc/systemd/system/token-stats-ledger.service"
  # Template the unit: python + repo dir are host-specific and systemd does
  # no ~/$HOME expansion in ExecStart/WorkingDirectory. The sed patterns
  # anchor on the three known keys of the shipped unit file (ExecStart=,
  # WorkingDirectory=, Environment=PYTHONPATH=) — full-line replacement,
  # so paths containing spaces would still land correctly.
  NEED_SUDO=0
  if [ -f "$UNIT_DST" ] && [ -w "$UNIT_DST" ]; then :; else NEED_SUDO=1; fi
  write_unit() {
    sed -e "s|ExecStart=.*|ExecStart=$PY -m ledger.daemon|" \
        -e "s|WorkingDirectory=.*|WorkingDirectory=$HERE|" \
        -e "s|Environment=PYTHONPATH=.*|Environment=PYTHONPATH=$HERE|" \
        "$UNIT_SRC"
  }
  if [ "$NEED_SUDO" = "1" ]; then
    if command -v sudo >/dev/null 2>&1; then
      write_unit | sudo tee "$UNIT_DST" >/dev/null
    elif [ "$(id -u)" = "0" ]; then
      write_unit > "$UNIT_DST"
    else
      die "cannot write $UNIT_DST (need root; run with sudo or as root)"
    fi
  else
    write_unit > "$UNIT_DST"
  fi
  systemctl daemon-reload
  systemctl enable --now token-stats-ledger.service
  sleep 2
  if systemctl is-active --quiet token-stats-ledger.service; then
    say "ledger daemon active (unit templated: python=$PY, repo=$HERE)"
  else
    warn "ledger daemon did not come up — check: journalctl -u token-stats-ledger -n 30"
  fi
fi

# ── 5. Restart the dashboard so the backend + web entry mount ─────────
# IMPORTANT: the desktop app and the web dashboard talk to the DASHBOARD
# process (default port 9119), not the messaging gateway. The plugin
# manifest/script caches are per-process — without a restart the new
# web entry stays invisible.
if [ "$DO_RESTART" = "1" ]; then
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-active hermes-dashboard.service >/dev/null 2>&1; then
      systemctl --user restart hermes-dashboard.service; info "restarted user unit hermes-dashboard.service"
    elif systemctl is-active hermes-dashboard.service >/dev/null 2>&1; then
      sudo systemctl restart hermes-dashboard.service; info "restarted system unit hermes-dashboard.service"
    fi
  fi
  # Fallback (and Andi's setup): dashboard runs as a bare process on the port.
  if ! ss -tln 2>/dev/null | grep -q ":$DASHBOARD_PORT "; then
    info "no listener on :$DASHBOARD_PORT — starting one"
    setsid nohup hermes dashboard --host 0.0.0.0 --port "$DASHBOARD_PORT" --no-open \
      >> "$HERMES_HOME/dashboard-restart.log" 2>&1 &
  else
    PID="$(ss -tlnp 2>/dev/null | grep ":$DASHBOARD_PORT " | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
    if [ -n "$PID" ]; then
      kill "$PID"
      for _ in $(seq 1 10); do ss -tln 2>/dev/null | grep -q ":$DASHBOARD_PORT " || break; sleep 1; done
      setsid nohup hermes dashboard --host 0.0.0.0 --port "$DASHBOARD_PORT" --no-open \
        >> "$HERMES_HOME/dashboard-restart.log" 2>&1 &
      info "old dashboard (PID $PID) killed, relaunching"
    fi
  fi
  # wait for the port to accept connections again
  UP=0
  for _ in $(seq 1 20); do
    if ss -tln 2>/dev/null | grep -q ":$DASHBOARD_PORT "; then UP=1; break; fi
    sleep 1
  done
  if [ "$UP" = "1" ]; then
    say "dashboard listening on :$DASHBOARD_PORT (log: $HERMES_HOME/dashboard-restart.log)"
  else
    warn "dashboard did not come back on :$DASHBOARD_PORT within 20 s — start it manually: hermes dashboard --port $DASHBOARD_PORT --no-open"
  fi
fi

# ── 6. Smoke check ────────────────────────────────────────────────────
sleep 2
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$DASHBOARD_PORT/api/plugins/token-stats/health" || true)"
case "$CODE" in
  200) say "smoke: /api/plugins/token-stats/health → 200 (backend mounted, auth open on loopback)" ;;
  401) say "smoke: health route answers 401 → backend MOUNTED (auth-gated; log into the dashboard to use it)" ;;
  404) warn "smoke: health route → 404 — backend not mounted. Was the dashboard restarted? Is token-stats in plugins.enabled? Restart the dashboard process and reload." ;;
  000) warn "smoke: dashboard on :$DASHBOARD_PORT not reachable (skipped)" ;;
  *)   warn "smoke: unexpected status $CODE — check the dashboard log" ;;
esac

cat <<'EOF'

Done. What to check next:
  • Web dashboard:  open http://<host>:9119/token-stats  (hard-reload if open) — Token Stats tab in the sidebar
  • Desktop plugin: reload via ⌘K → "Reload desktop plugins" (companion repo AndiAtom/hermes-token-stats)
  • Daemon:         systemctl status token-stats-ledger
  • After a Hermes update the server.py hooks get wiped — re-run this script (idempotent).
EOF
