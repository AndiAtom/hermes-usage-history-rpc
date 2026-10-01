"""state.db-Poller: liest session_model_usage read-only und mappt die Felder.

Feinstes Korn (PK von session_model_usage), NICHT die Session-Totals aus
`sessions` — die mutieren sichtbar (Kompression, Rewinds).
"""

import sqlite3

from .engine import LedgerEngine

# state.db-Spalte → Counter-Name (Poller-Mapping, Task 2 des Plans)
COLUMN_MAP = {
    "input_tokens": "in",
    "cache_read_tokens": "cached",
    "output_tokens": "out",
    "api_call_count": "calls",
}

QUERY = (
    "SELECT session_id, model, billing_provider, billing_base_url, "
    "billing_mode, task, input_tokens, cache_read_tokens, output_tokens, "
    "api_call_count FROM session_model_usage"
)


def read_rows(state_db_path):
    """Vollständigen Tabellenstand (Snapshot) read-only lesen.

    mode=ro garantiert: niemals schreibend auf die state.db —
    der Daemon ist der einzige Schreiber der Ledger-DB, nicht der Quelle.
    """
    conn = sqlite3.connect(f"file:{state_db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = []
        for r in conn.execute(QUERY).fetchall():
            row = {c: r[c] for c in (
                "session_id", "model", "billing_provider",
                "billing_base_url", "billing_mode", "task",
            )}
            for col, counter in COLUMN_MAP.items():
                row[counter] = r[col]
            rows.append(row)
        return rows
    finally:
        conn.close()


def poll_profile(state_db_path, engine):
    """Ein Zyklus: state.db lesen → Engine füttern (Full-Snapshot)."""
    rows = read_rows(state_db_path)
    engine.apply_poll(rows, snapshot=True)
    return len(rows)
