"""``usage.history`` / ``usage.totals`` JSON-RPC handlers: persistent token/cost analytics
from ``state.db`` (``sessions`` + ``session_model_usage``), covering sessions written by
any client and across gateway restarts. Read-only: plain SELECTs over the shared read pool.

Bodies are rebound onto server.py's globals at install time (method_ctx.bind_module).
"""

import time

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method


def register(server) -> None:
    bind_module(globals(), server, skip=("_",))


_MAIN_TASK = ""
_USAGE_COLS = (
    "api_call_count", "input_tokens", "output_tokens",
    "cache_read_tokens", "cache_write_tokens", "reasoning_tokens",
)


def _usage_totals_rows(db, since: float) -> dict:
    """Aggregate over ``session_model_usage`` joined with live ``sessions`` rows: returns
    a per-(session_id) dict of per-model rows so the client can fold session-level totals.
    ``since`` is a unix timestamp; 0 = no filter."""
    sql = f"""
        SELECT smu.session_id, smu.model, smu.task,
               smu.billing_provider, smu.billing_mode,
               COALESCE(SUM(smu.api_call_count), 0) AS api_calls,
               COALESCE(SUM(smu.input_tokens), 0) AS input_tokens,
               COALESCE(SUM(smu.output_tokens), 0) AS output_tokens,
               COALESCE(SUM(smu.cache_read_tokens), 0) AS cache_read_tokens,
               COALESCE(SUM(smu.cache_write_tokens), 0) AS cache_write_tokens,
               COALESCE(SUM(smu.reasoning_tokens), 0) AS reasoning_tokens,
               COALESCE(SUM(smu.estimated_cost_usd), 0) AS estimated_cost_usd,
               MIN(smu.first_seen) AS first_seen,
               MAX(smu.last_seen) AS last_seen,
               MAX(COALESCE(s.last_activity_at, s.ended_at, s.started_at)) AS last_active
          FROM session_model_usage smu
          JOIN sessions s ON s.id = smu.session_id
         WHERE (? = 0 OR COALESCE(s.last_activity_at, s.ended_at, s.started_at) >= ?)
         GROUP BY smu.session_id, smu.model, smu.task, smu.billing_provider, smu.billing_mode
    """
    params = (since, since)
    rows = db._read_all(sql, params)
    return rows


def _sessions_since(db, since: float, limit: int) -> list:
    """Compact session rows (id, title, timestamps, token totals) since ``since``."""
    sql = """
        SELECT s.id, COALESCE(s.title, '') AS title, s.source,
               s.started_at, s.ended_at,
               COALESCE(s.last_activity_at, s.ended_at, s.started_at) AS last_active,
               s.message_count, s.api_call_count,
               s.input_tokens, s.output_tokens,
               s.cache_read_tokens, s.cache_write_tokens, s.reasoning_tokens,
               s.estimated_cost_usd, s.actual_cost_usd,
               s.model, s.billing_provider, s.billing_mode
          FROM sessions s
         WHERE (? = 0 OR COALESCE(s.last_activity_at, s.ended_at, s.started_at) >= ?)
           AND COALESCE(s.hidden, 0) = 0
         ORDER BY COALESCE(s.last_activity_at, s.ended_at, s.started_at) DESC
         LIMIT ?
    """
    return db._read_all(sql, (since, since, limit))


def _since_param(params: dict) -> float:
    """``days`` (int) or ``since`` (unix ts) → cutoff; default 30 days. 0/negative = no filter."""
    days = params.get("days")
    if days is None:
        since = params.get("since")
        if since:
            try:
                return float(since)
            except (TypeError, ValueError):
                return 0.0
        return time.time() - 30 * 86400
    try:
        d = float(days)
        return 0.0 if d <= 0 else time.time() - d * 86400
    except (TypeError, ValueError):
        return time.time() - 30 * 86400


def _rows_to_dicts(rows) -> list:
    out = []
    for r in rows:
        try:
            d = dict(r)
        except (TypeError, ValueError):
            d = {k: r[k] for k in (r.keys() if hasattr(r, "keys") else range(len(r)))}
        out.append(d)
    return out


@method("usage.history")
def _usage_history(rid, params: dict) -> dict:
    """Per-session persistent usage rows (optionally per-model breakdown) from state.db.

    Params: ``days`` (default 30; 0 = all time) or ``since`` (unix ts),
    ``limit`` (default 200 sessions), ``models`` (bool, default true → include the
    per-model/task breakdown), ``session_id`` (single-session deep dive).
    Returns ``sessions: [...]`` (compact rows with token totals) and, when ``models``,
    ``model_usage: [{session_id, model, task, ...}]``.
    """
    try:
        profile_home = params.get("profile")
        with _profile_db({"profile_home": profile_home} if profile_home else {}) as db:
            if db is None:
                return _err(rid, 5010, "state.db unavailable")
            since = _since_param(params)
            session_id = str(params.get("session_id") or "").strip()
            limit = int(params.get("limit") or 200)
            if session_id:
                rows = _sessions_since(db, 0.0, 10000)
                rows = [r for r in rows if r["id"] == session_id] or db._read_all(
                    """
                    SELECT s.id, COALESCE(s.title, '') AS title, s.source,
                           s.started_at, s.ended_at, COALESCE(s.last_activity_at, s.ended_at, s.started_at) AS last_active,
                           s.message_count, s.api_call_count,
                           s.input_tokens, s.output_tokens,
                           s.cache_read_tokens, s.cache_write_tokens, s.reasoning_tokens,
                           s.estimated_cost_usd, s.actual_cost_usd,
                           s.model, s.billing_provider, s.billing_mode
                      FROM sessions s WHERE s.id = ?
                    """, (session_id,))
                model_rows = db._read_all(
                    """
                    SELECT session_id, model, task, billing_provider, billing_mode,
                           api_call_count AS api_calls, input_tokens, output_tokens,
                           cache_read_tokens, cache_write_tokens, reasoning_tokens,
                           estimated_cost_usd, first_seen, last_seen
                      FROM session_model_usage WHERE session_id = ?
                    """, (session_id,))
                return _ok(rid, {"sessions": _rows_to_dicts(rows),
                                  "model_usage": _rows_to_dicts(model_rows)})
            rows = _sessions_since(db, since, limit)
            if params.get("models", True):
                mu_rows = _usage_totals_rows(db, since)
                by_session = {}
                for r in mu_rows:
                    by_session.setdefault(r["session_id"], []).append(dict(r))
                keep = {r["id"] for r in rows}
                model_usage = [d for sid, lst in by_session.items() if sid in keep for d in lst]
            else:
                model_usage = []
            return _ok(rid, {"sessions": _rows_to_dicts(rows), "model_usage": model_usage})
    except Exception as e:
        logger.exception("usage.history failed")
        return _err(rid, 5010, f"usage.history failed: {e}")


@method("usage.totals")
def _usage_totals(rid, params: dict) -> dict:
    """Aggregate totals since a cutoff (or all time) + per-model and per-day rollups."""
    try:
        profile_home = params.get("profile")
        with _profile_db({"profile_home": profile_home} if profile_home else {}) as db:
            if db is None:
                return _err(rid, 5010, "state.db unavailable")
            since = _since_param(params)
            totals = db._read_one(
                """
                SELECT COALESCE(SUM(api_call_count), 0),
                       COALESCE(SUM(input_tokens), 0),
                       COALESCE(SUM(output_tokens), 0),
                       COALESCE(SUM(cache_read_tokens), 0),
                       COALESCE(SUM(cache_write_tokens), 0),
                       COALESCE(SUM(reasoning_tokens), 0),
                       COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0)
                  FROM sessions s
                 WHERE (? = 0 OR COALESCE(s.last_activity_at, s.ended_at, s.started_at) >= ?)
                   AND COALESCE(s.hidden, 0) = 0
                """, (since, since))
            by_model = db._read_all(
                """
                SELECT smu.model,
                       COALESCE(SUM(smu.api_call_count), 0) AS api_calls,
                       COALESCE(SUM(smu.input_tokens), 0) AS input_tokens,
                       COALESCE(SUM(smu.output_tokens), 0) AS output_tokens,
                       COALESCE(SUM(smu.cache_read_tokens), 0) AS cache_read_tokens,
                       COALESCE(SUM(smu.cache_write_tokens), 0) AS cache_write_tokens,
                       COALESCE(SUM(smu.reasoning_tokens), 0) AS reasoning_tokens,
                       COALESCE(SUM(smu.estimated_cost_usd), 0) AS estimated_cost_usd
                  FROM session_model_usage smu
                  JOIN sessions s ON s.id = smu.session_id
                 WHERE (? = 0 OR COALESCE(s.last_activity_at, s.ended_at, s.started_at) >= ?)
                   AND COALESCE(s.hidden, 0) = 0
                 GROUP BY smu.model
                 ORDER BY SUM(smu.input_tokens + smu.cache_read_tokens) DESC
                """, (since, since))
            by_day = db._read_all(
                """
                SELECT date(COALESCE(s.last_activity_at, s.ended_at, s.started_at), 'unixepoch') AS day,
                       COUNT(*) AS sessions,
                       COALESCE(SUM(s.api_call_count), 0) AS api_calls,
                       COALESCE(SUM(s.input_tokens), 0) AS input_tokens,
                       COALESCE(SUM(s.output_tokens), 0) AS output_tokens,
                       COALESCE(SUM(s.cache_read_tokens), 0) AS cache_read_tokens,
                       COALESCE(SUM(s.cache_write_tokens), 0) AS cache_write_tokens,
                       COALESCE(SUM(s.reasoning_tokens), 0) AS reasoning_tokens,
                       COALESCE(SUM(COALESCE(s.actual_cost_usd, s.estimated_cost_usd, 0)), 0) AS cost_usd
                  FROM sessions s
                 WHERE (? = 0 OR COALESCE(s.last_activity_at, s.ended_at, s.started_at) >= ?)
                   AND COALESCE(s.hidden, 0) = 0
                 GROUP BY day ORDER BY day DESC
                """, (since, since))
            return _ok(rid, {
                "totals": {
                    "api_calls": totals[0], "input_tokens": totals[1],
                    "output_tokens": totals[2], "cache_read_tokens": totals[3],
                    "cache_write_tokens": totals[4], "reasoning_tokens": totals[5],
                    "cost_usd": totals[6],
                },
                "by_model": _rows_to_dicts(by_model),
                "by_day": _rows_to_dicts(by_day),
            })
    except Exception as e:
        logger.exception("usage.totals failed")
        return _err(rid, 5010, f"usage.totals failed: {e}")
