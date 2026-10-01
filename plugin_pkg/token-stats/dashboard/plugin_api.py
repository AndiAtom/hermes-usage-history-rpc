"""token-stats known-ledger backend: monotonic (known) token counters for the
token-stats desktop plugin. Official plugin backend — auto-mounts under
/api/plugins/token-stats/ (the DESKTOP plugin's own ID — ctx.rest is
namespace-locked, so the backend must mount under the client's ID) when the
plugin is in plugins.enabled.

Two data sources, clean split:
- Ledger DB (<LEDGER_BASE>/<profile>/ledger.db, WAL): the monotonic known
  counters per (session_id, model, provider, base_url, mode, task).
  Written ONLY by the token-stats-ledger daemon; this backend reads it
  via mode=ro (WAL allows parallel readers).
- Hermes state.db (~/.hermes/state.db): session METADATA (title, source,
  timestamps, cache_write/reasoning tokens, cost estimates) that the
  ledger deliberately does not track.

Answer shape is compatible with the legacy usage.history RPC (sessions[] +
model_usage[]) so the client can swap data sources almost 1:1. Sessions
that exist only in the ledger (deleted from state.db via ON DELETE
CASCADE) stay visible — money is spent.
"""

import glob
import os
import sqlite3

from fastapi import APIRouter

router = APIRouter()

LEDGER_BASE = os.environ.get("LEDGER_BASE", "/root/token-stats-ledger")
STATE_DB = os.environ.get(
    "LEDGER_STATE_DB", os.path.expanduser("~/.hermes/state.db")
)


def _ro(path):
    """Read-only SQLite connection (WAL-safe for ledger reads)."""
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def available_profiles():
    """Profiles = directories under LEDGER_BASE containing a ledger.db."""
    out = []
    if os.path.isdir(LEDGER_BASE):
        for d in sorted(glob.glob(os.path.join(LEDGER_BASE, "*", "ledger.db"))):
            out.append(os.path.basename(os.path.dirname(d)))
    return out


def _ledger_rows(profile, session_id=""):
    """All ledger rows for a profile, grouped by session_id."""
    path = os.path.join(LEDGER_BASE, profile, "ledger.db")
    if not os.path.exists(path):
        return None
    conn = _ro(path)
    try:
        sql = (
            "SELECT session_id, model, billing_provider, billing_base_url, "
            "billing_mode, task, known_in, known_cached, known_out, "
            "known_calls, last_db_in, last_db_cached, last_db_out, "
            "last_db_calls, live_db_in, live_db_cached, live_db_out, "
            "live_db_calls, first_seen, last_poll FROM ledger_rows"
        )
        params = ()
        if session_id:
            sql += " WHERE session_id = ?"
            params = (session_id,)
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def _session_meta(session_ids):
    """Metadata for the given sessions from state.db (read-only).

    Returns {session_id: {title, source, started_at, ended_at, last_active,
    message_count, model, billing_provider, billing_mode,
    cache_write_tokens, reasoning_tokens, estimated_cost_usd}}.
    """
    out = {}
    if not session_ids or not os.path.exists(STATE_DB):
        return out
    conn = _ro(STATE_DB)
    try:
        for sid in session_ids:
            r = conn.execute(
                """
                SELECT id, COALESCE(title, '') AS title, source,
                       started_at, ended_at,
                       COALESCE(last_activity_at, ended_at, started_at) AS last_active,
                       message_count, model, billing_provider, billing_mode,
                       cache_write_tokens, reasoning_tokens, estimated_cost_usd
                  FROM sessions WHERE id = ?
                """,
                (sid,),
            ).fetchone()
            if r:
                out[sid] = dict(r)
    finally:
        conn.close()
    return out


@router.get("/profiles")
async def profiles():
    """Available ledger profiles."""
    return {"profiles": available_profiles()}


@router.get("/ledger")
async def ledger(days: int = 30, since: float = 0, limit: int = 200,
                session_id: str = "", models: bool = True,
                profile: str = "default"):
    """Monotonic known counters, shape-compatible with usage.history.

    Returns sessions[] (one entry per session_id, sums of known counters,
    plus state.db metadata where available) and model_usage[] (per-grain
    ledger rows with known + live values).
    """
    import time as _time
    from fastapi import HTTPException
    if profile not in available_profiles():
        raise HTTPException(
            status_code=404,
            detail={
                "error": f"profile '{profile}' not found",
                "available": available_profiles(),
                "ts": _time.time(),
            },
        )
    now = _time.time()
    cutoff = since if since else (now - days * 86400 if days and days > 0 else 0)

    rows = _ledger_rows(profile, session_id=session_id)
    if rows is None:
        return {"sessions": [], "model_usage": []}

    # group grain rows by session
    by_sid = {}
    for r in rows:
        by_sid.setdefault(r["session_id"], []).append(r)

    # session list, most recent ledger activity first.
    # Day-window filtering (days/since) applies SERVER-side on the
    # ledger's last_poll — same semantics as usage.history's window.
    sids = [s for s in by_sid if max(
        r["last_poll"] for r in by_sid[s]) >= cutoff]
    if session_id:
        sids = [s for s in sids if s == session_id]
    sids = sorted(sids, key=lambda s: max(
        r["last_poll"] for r in by_sid[s]), reverse=True)
    if not session_id:
        sids = sids[:limit]

    meta = _session_meta(sids)

    sessions = []
    for sid in sids:
        rs = by_sid[sid]
        m = meta.get(sid, {})
        last_active = max(r["last_poll"] for r in rs)
        sessions.append({
            "id": sid,
            "title": m.get("title", ""),
            "source": m.get("source", "ledger"),
            "started_at": m.get("started_at", min(r["first_seen"] for r in rs)),
            "ended_at": m.get("ended_at"),
            "last_active": m.get("last_active", last_active),
            "message_count": m.get("message_count"),
            "api_call_count": sum(r["known_calls"] for r in rs),
            "input_tokens": sum(r["known_in"] for r in rs),
            "output_tokens": sum(r["known_out"] for r in rs),
            "cache_read_tokens": sum(r["known_cached"] for r in rs),
            "cache_write_tokens": m.get("cache_write_tokens"),
            "reasoning_tokens": m.get("reasoning_tokens"),
            "estimated_cost_usd": m.get("estimated_cost_usd"),
            "model": m.get("model", rs[0]["model"] if rs else ""),
            "billing_provider": m.get("billing_provider"),
            "billing_mode": m.get("billing_mode"),
            # ledger extras
            "ledger_only": sid not in meta,
            "last_poll": last_active,
        })

    model_usage = []
    if models:
        sid_set = set(sids)
        for r in rows:
            if r["session_id"] not in sid_set:
                continue
            model_usage.append({
                "session_id": r["session_id"],
                "model": r["model"],
                "task": r["task"],
                "billing_provider": r["billing_provider"],
                "billing_base_url": r["billing_base_url"],
                "billing_mode": r["billing_mode"],
                "api_calls": r["known_calls"],
                "input_tokens": r["known_in"],
                "output_tokens": r["known_out"],
                "cache_read_tokens": r["known_cached"],
                "first_seen": r["first_seen"],
                "last_seen": r["last_poll"],
                # ledger extras
                "live_in": r["live_db_in"],
                "live_cached": r["live_db_cached"],
                "live_out": r["live_db_out"],
                "live_calls": r["live_db_calls"],
                "last_db_in": r["last_db_in"],
            })

    return {"sessions": sessions, "model_usage": model_usage}


@router.get("/events")
async def events(session_id: str, limit: int = 50, profile: str = "default"):
    """Anomaly history (decrease/removed/reappeared) per session."""
    path = os.path.join(LEDGER_BASE, profile, "ledger.db")
    if not os.path.exists(path):
        from fastapi import HTTPException
        raise HTTPException(
            status_code=404,
            detail={"error": f"profile '{profile}' not found",
                    "available": available_profiles()},
        )
    conn = _ro(path)
    try:
        return {"events": [dict(r) for r in conn.execute(
            "SELECT * FROM ledger_events WHERE session_id = ? "
            "ORDER BY id DESC LIMIT ?", (session_id, limit)).fetchall()]}
    finally:
        conn.close()


@router.get("/health")
async def health(profile: str = "default"):
    """Daemon liveness: row count + freshness of the last poll."""
    path = os.path.join(LEDGER_BASE, profile, "ledger.db")
    if not os.path.exists(path):
        return {"ok": False, "profile": profile,
                "available": available_profiles()}
    import time as _time
    conn = _ro(path)
    try:
        rows = conn.execute("SELECT COUNT(*) FROM ledger_rows").fetchone()[0]
        last_poll = conn.execute(
            "SELECT COALESCE(MAX(last_poll), 0) FROM ledger_rows"
        ).fetchone()[0]
        age = _time.time() - last_poll if last_poll else None
        return {
            "ok": bool(last_poll) and age is not None and age < 120,
            "profile": profile,
            "rows": rows,
            "last_poll": last_poll,
            "age_seconds": round(age, 1) if age is not None else None,
        }
    finally:
        conn.close()
