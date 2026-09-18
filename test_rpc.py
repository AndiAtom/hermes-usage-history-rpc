#!/usr/bin/env python
"""In-process Proof: usage.history / usage.totals im Gateway-Server-Kontext aufrufen.
Importiert tui_gateway.server (registriert ALLE Methoden inkl. unserer) und ruft
die Handler mit echten state.db-Queries auf. Kein Server-Start, keine Side-Effects
auf den laufenden Gateway (separater Prozess, read-only SELECTs)."""
import sys
sys.path.insert(0, "/usr/local/lib/hermes-agent")

import tui_gateway.server as srv

methods = sorted(srv._methods.keys())
print("usage.history registriert:", "usage.history" in methods)
print("usage.totals registriert:", "usage.totals" in methods)
assert "usage.history" in methods and "usage.totals" in methods, "RPC-Methoden fehlen!"

r = srv._methods["usage.totals"]("test-rid", {"days": 7})
assert "error" not in r or r.get("error") is None, f"usage.totals error: {r.get('error')}"
res = r["result"]
t = res["totals"]
print("totals(7d): calls=%s in=%s cache_rd=%s out=%s" % (
    t["api_calls"], t["input_tokens"], t["cache_read_tokens"], t["output_tokens"]))
print("by_model rows:", len(res["by_model"]), "| by_day rows:", len(res["by_day"]))

r2 = srv._methods["usage.history"]("test-rid", {"days": 7, "limit": 5})
res2 = r2["result"]
sess, mu = res2["sessions"], res2["model_usage"]
print("usage.history(7d, limit 5): sessions=%d model_usage=%d" % (len(sess), len(mu)))
assert len(sess) > 0, "keine Sessions zurueck!"

# Deep-Dive: erste session_id, mit models=true
sid = sess[0]["id"]
r3 = srv._methods["usage.history"]("test-rid", {"session_id": sid})
res3 = r3["result"]
print("deep-dive %s: sessions=%d model_usage=%d" % (sid[:18], len(res3["sessions"]), len(res3["model_usage"])))

s = res2["sessions"][0]
print("erste session:", s["id"][:16], "| in:", s["input_tokens"],
      "cache_rd:", s["cache_read_tokens"], "out:", s["output_tokens"], "| model:", s["model"])
print("ALL OK")
