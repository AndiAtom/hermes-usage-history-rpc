#!/usr/bin/env python
"""In-process proof: call usage.history / usage.totals in the gateway server context.
Imports tui_gateway.server (registers ALL methods including ours) and calls
the handlers with real state.db queries. No server start, no side effects
on the running gateway (separate process, read-only SELECTs)."""
import sys
sys.path.insert(0, "/usr/local/lib/hermes-agent")

import tui_gateway.server as srv

methods = sorted(srv._methods.keys())
print("usage.history registered:", "usage.history" in methods)
print("usage.totals registered:", "usage.totals" in methods)
assert "usage.history" in methods and "usage.totals" in methods, "RPC methods missing!"

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
assert len(sess) > 0, "no sessions returned!"

# Deep dive: first session_id, with models=true
sid = sess[0]["id"]
r3 = srv._methods["usage.history"]("test-rid", {"session_id": sid})
res3 = r3["result"]
print("deep-dive %s: sessions=%d model_usage=%d" % (sid[:18], len(res3["sessions"]), len(res3["model_usage"])))

s = res2["sessions"][0]
print("first session:", s["id"][:16], "| in:", s["input_tokens"],
      "cache_rd:", s["cache_read_tokens"], "out:", s["output_tokens"], "| model:", s["model"])
print("ALL OK")
