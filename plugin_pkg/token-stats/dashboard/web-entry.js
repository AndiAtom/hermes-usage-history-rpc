/**
 * Token Stats — Hermes Web-Dashboard plugin entry (companion to the
 * desktop plugin.js in AndiAtom/hermes-token-stats).
 *
 * @version v4.7.5-web.1
 *
 * Port of the desktop pane design to the web dashboard plugin SDK
 * (window.__HERMES_PLUGIN_SDK__ + window.__HERMES_PLUGINS__.register).
 * Live data comes from the known-ledger backend
 * (/api/plugins/token-stats/ledger, plugin_api.py in this repo) via
 * sdk.fetchJSON — same data the desktop pane shows, ~15 s daemon lag.
 *
 * Scope vs. desktop pane:
 *   ✔ Presets 1d/5d/7d/30d/∞ (calendar windows, windowFor ported 1:1)
 *   ✔ Summary card + ⚡ Cache-Hit bar
 *   ✔ Mini histogram with 🪙/€ metric toggle (1d preset: hidden)
 *   ✔ Session list with day separators + per-day totals, collapsible
 *     day groups (today expanded, others collapsed), ⚠ anomaly flags
 *   ✔ Sortable columns (In / ⚡ / Out / 💰 / activity)
 *   ✔ Footer breakdowns: Modelle / Subagenten / Aux-Tasks (€-columns,
 *     relative inline size bars — ported verbatim)
 *   ✖ no statusbar chip, no live-usage overlay (web has no session
 *     event stream; the ledger's known counters are the floor),
 *     no column drag-resize (desktop persistence feature).
 *
 * Styling: the web build ships a FIXED compiled Tailwind CSS — utilities
 * it doesn't itself use don't exist (same failure class as the desktop
 * arbitrary-utility lessons, but systemic). This entry therefore injects
 * its own <style> block with .ts-* classes built on the dashboard theme
 * variables (--midground-base etc.), which ThemeProvider rewrites live —
 * no Tailwind classes are used at all.
 *
 * Deploy: ~/.hermes/plugins/token-stats/dashboard/{web-entry.js,manifest.json}
 * (repo copy in plugin_pkg/token-stats/dashboard/ is the source of truth).
 * After changes: restart the dashboard process (plugin manifest + asset
 * cache are per-process), then hard-reload the browser tab.
 */
(function () {
  'use strict'

  const SDK = window.__HERMES_PLUGIN_SDK__
  const React = SDK.React
  const { useState, useEffect, useMemo, useRef } = SDK.hooks
  const fetchJSON = SDK.fetchJSON
  const h = React.createElement
  const ID = 'token-stats'
  const VERSION = 'v4.7.5-web.1'

  // ── Injected stylesheet (namespaced .ts-* classes) ─────────────────
  // Built on theme vars so the active dashboard theme flows through:
  // --midground-base = accent, --midground = primary text, --background-base
  // = canvas. All transparencies via color-mix (compiled-in, no runtime
  // utility generation involved — immune to the missing-utility class).
  const CSS = `
.tsweb{-webkit-font-smoothing:antialiased;--tsw-accent:var(--midground-base);
 --tsw-text:var(--midground);
 --tsw-t2:color-mix(in srgb, var(--midground-base) 80%, transparent);
 --tsw-t3:color-mix(in srgb, var(--midground-base) 65%, transparent);
 --tsw-t4:color-mix(in srgb, var(--midground-base) 45%, transparent);
 --tsw-stroke:color-mix(in srgb, var(--midground-base) 15%, transparent);
 --tsw-card:color-mix(in srgb, var(--midground-base) 4%, var(--background-base));
 display:flex;flex-direction:column;gap:.5rem;height:100%;
 max-width:540px;min-height:0;overflow:hidden;padding:.75rem;
 box-sizing:border-box;font-size:.75rem;color:var(--tsw-t2)}
.tsweb *{box-sizing:border-box}
.ts-head{display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.ts-title{font-weight:600;font-size:.875rem;color:var(--tsw-text)}
.ts-headbtns{display:flex;align-items:center;gap:.375rem}
.ts-note{font-size:.625rem;color:#f59e0b}
.tsbtn{background:transparent;border:none;padding:.125rem .375rem;font-size:.625rem;
 color:var(--tsw-t4);cursor:pointer;border-radius:.25rem;font-family:inherit;line-height:1.4}
.tsbtn:hover{background:var(--tsw-stroke)}
.tsbtn.on{background:var(--tsw-accent);color:var(--background-base)}
.tsbtn.tint{background:color-mix(in srgb, var(--tsw-accent) 15%, transparent);
 color:var(--tsw-accent);font-weight:500}
.ts-card{border:1px solid var(--tsw-stroke);border-radius:.375rem;
 padding:.375rem .5rem;flex-shrink:0}
.tstable{width:100%;table-layout:fixed;border-collapse:collapse}
.tsq{font-size:.625rem;text-transform:uppercase;color:var(--tsw-t4)}
.ts-num{font-variant-numeric:tabular-nums;text-align:right;
 padding:.25rem .25rem;white-space:nowrap}
.ts-acc{color:var(--tsw-accent)}
.ts-dim{color:var(--tsw-t4)}
.ts-chlab{display:flex;align-items:center;justify-content:space-between;
 font-size:.625rem;color:var(--tsw-t4);margin-bottom:.125rem}
.ts-chtrack{height:3px;width:100%;border-radius:9999px;overflow:hidden;
 background:var(--tsw-stroke)}
.ts-chfill{height:100%;background:var(--tsw-accent)}
.ts-hist{border:1px solid var(--tsw-stroke);border-radius:.375rem;
 padding:.375rem .5rem;flex-shrink:0}
.ts-hbars{display:flex;align-items:flex-end;gap:2px;height:2rem}
.ts-hcol{flex:1;display:flex;flex-direction:column;justify-content:end;height:100%}
.ts-hbar{width:100%;border-radius:.125rem}
.ts-scroll{flex:1;min-height:0;overflow:auto}
.ts-empty{color:var(--tsw-t4);text-align:center;padding:1rem 0}
.ts-th{font-size:.625rem;text-transform:uppercase;color:var(--tsw-t4);
 font-weight:400;padding:.25rem 0;cursor:pointer;user-select:none;
 border-bottom:1px solid var(--tsw-stroke)}
.ts-th:hover{color:var(--tsw-t3)}
.ts-th.l{text-align:left;padding-right:.5rem}
.ts-th.r{text-align:right;padding:0 .25rem}
.ts-thead{position:sticky;top:0;background:var(--tsw-card);z-index:10}
.ts-day{font-size:.625rem;color:var(--tsw-t4);cursor:pointer;
 border-bottom:1px solid color-mix(in srgb, var(--midground-base) 8%, transparent)}
.ts-day td{padding:.25rem .25rem;white-space:nowrap}
.ts-day .dl{font-weight:500;padding-right:.5rem;text-align:left}
.ts-tr{border-bottom:1px solid color-mix(in srgb, var(--midground-base) 8%, transparent)}
.ts-tdl{padding:.25rem .5rem .25rem 0;overflow:hidden;text-overflow:ellipsis;
 white-space:nowrap;max-width:100%}
.ts-outcell{position:relative;text-align:right}
.ts-outbar{position:absolute;top:3px;bottom:3px;right:0;border-radius:.125rem;
 background:color-mix(in srgb, var(--tsw-accent) 10%, transparent);z-index:0}
.ts-brkwrap{flex-shrink:0}
.ts-brkhead{display:flex;align-items:center;justify-content:space-between;
 font-size:.625rem;color:var(--tsw-t4);margin-bottom:.125rem;padding:0 .125rem}
.ts-brkhead .up{text-transform:uppercase}
.ts-brklist{border:1px solid var(--tsw-stroke);border-radius:.375rem;
 max-height:10rem;overflow:auto}
.ts-brkrow{position:relative;display:flex;align-items:center;
 justify-content:space-between;gap:.5rem;padding:.25rem .5rem;overflow:hidden;
 border-bottom:1px solid color-mix(in srgb, var(--midground-base) 8%, transparent)}
.ts-brkrow:last-child{border-bottom:none}
.ts-brkbar{position:absolute;top:3px;bottom:3px;left:0;border-radius:2px;
 background:var(--tsw-accent);opacity:.1}
.ts-brkname{display:flex;align-items:baseline;gap:.375rem;min-width:0;
 position:relative;z-index:1}
.ts-brkname .nm{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ts-brkname .mt{font-size:.625rem;color:var(--tsw-t4);flex-shrink:0}
.ts-brknum{display:flex;align-items:center;gap:.5rem;flex-shrink:0;position:relative;z-index:1;
 font-variant-numeric:tabular-nums;color:var(--tsw-t2)}
.ts-brknum .eur{color:var(--tsw-t4);min-width:3.5rem;text-align:right}
.ts-foot{flex-shrink:0;font-size:.625rem;color:var(--tsw-t4);text-align:center;padding-top:.25rem}
.tslink{background:transparent;border:none;padding:0;font:inherit;color:inherit;
 cursor:pointer;text-decoration:underline dotted var(--tsw-stroke);
 text-underline-offset:2px}
.tslink:hover,.tslink.on{color:var(--tsw-t3)}
.tslink.on{font-weight:500}
.ts-err{border:1px solid var(--tsw-stroke);border-radius:.375rem;padding:.75rem;
 color:var(--tsw-t3);font-size:.75rem;flex-shrink:0}
.ts-err .retry{margin-top:.5rem}
`

  function injectStyle() {
    if (document.getElementById('tsweb-style')) return
    const s = document.createElement('style')
    s.id = 'tsweb-style'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  // ── Pricing table (USD per 1M tokens) ───────────────────────────────
  // VERBATIM PORT from the desktop plugin.js (v4.7.5). Keep both files in
  // sync — same keys, same policy (Mistral list prices, never sale prices;
  // OpenRouter catalog for foreign billing_provider; unpriced stays null).
  const PRICES = {
    // ── Premier frontier (docs.mistral.ai/inference/pricing, verified 2026-09-19) ──
    // ── Mistral Large 4 "le Chonk" (verified 2026-10-07: list price;
    //    public-preview sale is $0.68/$0.07/$2.09 — we track the regular list,
    //    same policy as every other row) ──
    'mistral-large-4-0': { input: 1.36, cached: 0.14, output: 4.18 },      // 1.05T MoE, 52B active
    'mistral-large-4': { input: 1.36, cached: 0.14, output: 4.18 },        // API alias → -0
    'mistral-large-latest': { input: 0.50, cached: 0.05, output: 1.50 },    // Mistral Large 3
    'mistral-large-2512': { input: 0.50, cached: 0.05, output: 1.50 },
    'mistral-medium-latest': { input: 1.50, cached: 0.15, output: 7.50 },   // Mistral Medium 3.5
    'mistral-medium-2604': { input: 1.50, cached: 0.15, output: 7.50 },
    'mistral-medium-3-5': { input: 1.50, cached: 0.15, output: 7.50 },
    'mistral-medium-3.5': { input: 1.50, cached: 0.15, output: 7.50 },
    'mistral-medium': { input: 1.50, cached: 0.15, output: 7.50 },          // alias → 3.5
    'mistral-medium-3': { input: 0.40, cached: 0.04, output: 2.00 },         // Medium 3 legacy tier
    'mistral-small-latest': { input: 0.15, cached: 0.015, output: 0.60 },   // Mistral Small 4
    'mistral-small-2603': { input: 0.15, cached: 0.015, output: 0.60 },
    // ── Ministral 3 (official pricing page) ──
    'ministral-14b-latest': { input: 0.20, cached: 0.02, output: 0.20 },
    'ministral-14b-2512': { input: 0.20, cached: 0.02, output: 0.20 },
    'ministral-8b-latest': { input: 0.15, cached: 0.015, output: 0.15 },
    'ministral-8b-2512': { input: 0.15, cached: 0.015, output: 0.15 },
    'ministral-3b-latest': { input: 0.10, cached: 0.01, output: 0.10 },
    'ministral-3b-2512': { input: 0.10, cached: 0.01, output: 0.10 },
    // ── Codestral (official pricing page) ──
    'codestral-latest': { input: 0.30, cached: 0.03, output: 0.90 },
    'codestral-2508': { input: 0.30, cached: 0.03, output: 0.90 },
    'mistral-code-latest': { input: 0.30, cached: 0.03, output: 0.90 },     // Devstral-2-based
    'mistral-code-fim-latest': { input: 0.30, cached: 0.03, output: 0.90 }, // Codestral FIM
    'mistral-vibe-cli-latest': { input: 0.30, cached: 0.03, output: 0.90 }, // Devstral-2-based
    'mistral-vibe-cli-fast': { input: 0.30, cached: 0.03, output: 0.90 },
    'mistral-vibe-cli-with-tools': { input: 0.30, cached: 0.03, output: 0.90 },
    // ── Magistral (deprecated but live on the API; legacy list prices,
    //    no longer on the pricing page. Cache = 10% input, Mistral pattern) ──
    'magistral-medium-latest': { input: 2.00, cached: 0.20, output: 5.00 },
    'magistral-small-latest': { input: 0.50, cached: 0.05, output: 1.50 },
    // ── Third-party hosted on La Plateforme (official pricing page) ──
    'zai-glm-latest': { input: 1.40, cached: 0.14, output: 4.40 },  // Z.ai GLM 5.3/5.2 alias
    'zai-glm-5-3': { input: 1.40, cached: 0.14, output: 4.40 },
    'zai-glm-5-2': { input: 1.40, cached: 0.14, output: 4.40 },
    'zai-glm-5': { input: 1.40, cached: 0.14, output: 4.40 },      // API alias, same listing
    'glm-5-2': { input: 1.40, cached: 0.14, output: 4.40 },
    // Nous Inference API (inference-api.nousresearch.com) serves OpenRouter-style
    // model IDs. Andi decision 2026-09-30: price with MISTRAL's own list prices,
    // not OpenRouter's. Where Mistral hosts the same model, use its La Plateforme
    // price (docs.mistral.ai/inference/pricing, verified 2026-09-30); models
    // Mistral does NOT host stay unpriced ('—', never fabricate a number):
    'z-ai/glm-5.3': { input: 1.40, cached: 0.14, output: 4.40 },  // = Z.ai GLM 5.3 hosted on La Plateforme
    // 'openai/gpt-6-astra-pro': not hosted by Mistral → no Mistral price → unpriced ('—').
    // Voxtral Small (audio→text, token-priced; legacy list, secondary source Sep 2026 —
    // no longer on the official pricing page)
    'voxtral-small-latest': { input: 0.10, cached: 0.01, output: 0.30 },
    'voxtral-small-2507': { input: 0.10, cached: 0.01, output: 0.30 },
    // Embeddings: input-only, per 1M tokens (output n/a)
    'codestral-embed': { input: 0.15, cached: 0.015, output: 0.00 },
    'codestral-embed-2505': { input: 0.15, cached: 0.015, output: 0.00 },
    'mistral-embed': { input: 0.10, cached: 0.01, output: 0.00 },   // legacy list price
    'mistral-embed-2312': { input: 0.10, cached: 0.01, output: 0.00 },
    // ── Free / research (API returns usage but costs 0) ──
    'labs-leanstral-1-5': { input: 0.00, cached: 0.00, output: 0.00 },
    'labs-leanstral-1-5-1': { input: 0.00, cached: 0.00, output: 0.00 },
    'mistral-moderation-2603': { input: 0.00, cached: 0.00, output: 0.00 },
    'stepfun/step-3.7-flash:free': { input: 0.00, cached: 0.00, output: 0.00 },  // OpenRouter free tier
    // NOT priced here (non-token billing, can't map to token usage):
    //   voxtral-mini-* / *-transcribe-* ($/min), voxtral-mini-tts-* ($/M chars),
    //   mistral-ocr-* ($/1000 pages). estimateCost() returns null → pane shows '—'.
  }

  // ── Provider-aware pricing (v4.5.0) ─────────────────────────────────
  // Lookup order in estimateCost():
  //   1. PRICES_PROVIDER[billing_provider][model]  — exact provider match
  //   2. PRICES[model]                              — model-only (provider unknown/other)
  //   3. null → '—'                                 — never guess
  // Provider keys match billing_provider from state.db EXACTLY ('openrouter',
  // 'nous') — no prefix matching (custom:mistral variants fall through to the
  // model-only path). Nous publishes no machine-readable price list; the
  // OpenRouter catalog is the best documented source.
  const PRICES_PROVIDER = {
    openrouter: null, // filled below with the generated OpenRouter catalog table
    nous: null,       // same source, separately maintained: Nous may deviate
  }

  // ── OpenRouter catalog prices (source: openrouter.ai/api/v1/models,
  //    generated 2026-10-04 via scripts/gen_prices_openrouter.py —
  //    USD per 1M tokens; cached = input_cache_read; 0.00 = free tier.)
  //    459 curated models (text-in/text-out, priced or free, not expired,
  //    OR routing models excluded — they carry no own price).
  const PRICES_OPENROUTER = {
    'aion-labs/aion-2.0': { input: 0.8, cached: 0.2, output: 1.6 },
    'aion-labs/aion-3.0': { input: 3, cached: 0.75, output: 6 },
    'aion-labs/aion-3.0-mini': { input: 0.7, cached: 0.18, output: 1.4 },
    'aion-labs/aion-3.5': { input: 3, cached: 0.75, output: 6 },
    'aion-labs/aion-3.5-mini': { input: 0.7, cached: 0.18, output: 1.4 },
    'aion-labs/aion-rp-llama-3.1-8b': { input: 0.8, cached: 0, output: 1.6 },
    'amazon/nova-2-lite-v1': { input: 0.3, cached: 0, output: 2.5 },
    'amazon/nova-lite-v1': { input: 0.06, cached: 0, output: 0.24 },
    'amazon/nova-micro-v1': { input: 0.035, cached: 0, output: 0.14 },
    'amazon/nova-premier-v1': { input: 2.5, cached: 0.625, output: 12.5 },
    'amazon/nova-pro-v1': { input: 0.8, cached: 0, output: 3.2 },
    'anthracite-org/magnum-v4-72b': { input: 2.5, cached: 0, output: 5 },
    'anthropic/claude-fable-5': { input: 10, cached: 1, output: 50 },
    'anthropic/claude-fable-5.1': { input: 10, cached: 0.25, output: 50 },
    'anthropic/claude-fable-5.1:batch': { input: 5, cached: 0.125, output: 25 },
    'anthropic/claude-fable-5:batch': { input: 5, cached: 0.5, output: 25 },
    'anthropic/claude-haiku-4.5': { input: 1, cached: 0.1, output: 5 },
    'anthropic/claude-haiku-4.5:batch': { input: 0.5, cached: 0.05, output: 2.5 },
    'anthropic/claude-opus-4.1': { input: 15, cached: 1.5, output: 75 },
    'anthropic/claude-opus-4.1:batch': { input: 7.5, cached: 0.75, output: 37.5 },
    'anthropic/claude-opus-4.5': { input: 5, cached: 0.5, output: 25 },
    'anthropic/claude-opus-4.5:batch': { input: 2.5, cached: 0.25, output: 12.5 },
    'anthropic/claude-opus-4.6': { input: 5, cached: 0.5, output: 25 },
    'anthropic/claude-opus-4.6:batch': { input: 2.5, cached: 0.25, output: 12.5 },
    'anthropic/claude-opus-4.7': { input: 5, cached: 0.5, output: 25 },
    'anthropic/claude-opus-4.7:batch': { input: 2.5, cached: 0.25, output: 12.5 },
    'anthropic/claude-opus-4.8': { input: 5, cached: 0.5, output: 25 },
    'anthropic/claude-opus-4.8:batch': { input: 2.5, cached: 0.25, output: 12.5 },
    'anthropic/claude-opus-5': { input: 5, cached: 0.5, output: 25 },
    'anthropic/claude-opus-5.5': { input: 4, cached: 0.2, output: 20 },
    'anthropic/claude-opus-5.5:batch': { input: 2, cached: 0.1, output: 10 },
    'anthropic/claude-opus-5:batch': { input: 2.5, cached: 0.25, output: 12.5 },
    'anthropic/claude-sonnet-4': { input: 3, cached: 0.3, output: 15 },
    'anthropic/claude-sonnet-4.5': { input: 3, cached: 0.3, output: 15 },
    'anthropic/claude-sonnet-4.5:batch': { input: 1.5, cached: 0.15, output: 7.5 },
    'anthropic/claude-sonnet-4.6': { input: 3, cached: 0.3, output: 15 },
    'anthropic/claude-sonnet-4.6:batch': { input: 1.5, cached: 0.15, output: 7.5 },
    'anthropic/claude-sonnet-5': { input: 2, cached: 0.2, output: 10 },
    'anthropic/claude-sonnet-5.5': { input: 2, cached: 0.2, output: 10 },
    'anthropic/claude-sonnet-5.5:batch': { input: 1, cached: 0.1, output: 5 },
    'anthropic/claude-sonnet-5:batch': { input: 1, cached: 0.1, output: 5 },
    'apodex/apodex-1.1-mini:free': { input: 0, cached: 0, output: 0 },
    'arcee-ai/trinity-large-thinking': { input: 0.25, cached: 0.06, output: 0.8 },
    'baidu/ernie-4.5-vl-424b-a47b': { input: 0.42, cached: 0, output: 1.25 },
    'bytedance/ui-tars-1.5-7b': { input: 0.1, cached: 0.1, output: 0.2 },
    'bytedance-seed/seed-1.6': { input: 0.25, cached: 0, output: 2 },
    'bytedance-seed/seed-1.6-flash': { input: 0.075, cached: 0, output: 0.3 },
    'bytedance-seed/seed-2-1-turbo': { input: 0.5, cached: 0, output: 2.5 },
    'bytedance-seed/seed-2.0-code': { input: 0.5, cached: 0, output: 3 },
    'bytedance-seed/seed-2.0-lite': { input: 0.25, cached: 0, output: 2 },
    'bytedance-seed/seed-2.0-mini': { input: 0.1, cached: 0, output: 0.4 },
    'cognitivecomputations/dolphin-mistral-24b-venice-edition': { input: 0.2, cached: 0, output: 0.9 },
    'cohere/command-a': { input: 2.5, cached: 0, output: 10 },
    'cohere/command-a-plus': { input: 0.3, cached: 0.15, output: 1.5 },
    'cohere/command-r-08-2024': { input: 0.15, cached: 0, output: 0.6 },
    'cohere/command-r-plus-08-2024': { input: 2.5, cached: 0, output: 10 },
    'cohere/command-r7b-12-2024': { input: 0.0375, cached: 0, output: 0.15 },
    'cohere/north-mini-code:free': { input: 0, cached: 0, output: 0 },
    'deepseek/deepseek-chat': { input: 0.2574, cached: 0, output: 1.0287 },
    'deepseek/deepseek-chat-v3-0324': { input: 0.25, cached: 0, output: 1 },
    'deepseek/deepseek-chat-v3.1': { input: 0.25, cached: 0.13, output: 0.95 },
    'deepseek/deepseek-r1': { input: 0.7, cached: 0, output: 2.5 },
    'deepseek/deepseek-r1-0528': { input: 0.5, cached: 0.35, output: 2.15 },
    'deepseek/deepseek-v3.1-terminus': { input: 0.27, cached: 0, output: 1 },
    'deepseek/deepseek-v3.2': { input: 0.28, cached: 0.028, output: 0.42 },
    'deepseek/deepseek-v3.2-exp': { input: 0.27, cached: 0, output: 0.41 },
    'deepseek/deepseek-v4-flash': { input: 0.0224, cached: 0.0224, output: 1.28 },
    'deepseek/deepseek-v4-flash-0731': { input: 0.0152, cached: 0.0152, output: 1.28 },
    'deepseek/deepseek-v4-flash-vision-exp': { input: 0.2156, cached: 0.00686, output: 0.6468 },
    'deepseek/deepseek-v4-pro': { input: 0.2088, cached: 0.0174, output: 0.4176 },
    'deepseek/deepseek-v4-pro-0813': { input: 0.85, cached: 0.7, output: 5 },
    'deepseek/deepseek-v4.1-flash': { input: 0.003, cached: 0.003, output: 2.4 },
    'deepseek/deepseek-v4.1-flash:batch': { input: 0.112, cached: 0.00336, output: 0.336 },
    'dots-studio/dots-3-note-preview:free': { input: 0, cached: 0, output: 0 },
    'fireworks/ember-1': { input: 3, cached: 0.3, output: 15 },
    'google/gemini-2.5-flash': { input: 0.3, cached: 0.03, output: 2.5 },
    'google/gemini-2.5-flash-image': { input: 0.3, cached: 0.03, output: 2.5 },
    'google/gemini-2.5-flash-lite': { input: 0.1, cached: 0.01, output: 0.4 },
    'google/gemini-2.5-flash-lite:batch': { input: 0.05, cached: 0.01, output: 0.2 },
    'google/gemini-2.5-flash:batch': { input: 0.15, cached: 0.03, output: 1.25 },
    'google/gemini-2.5-pro': { input: 1.25, cached: 0.125, output: 10 },
    'google/gemini-2.5-pro-preview': { input: 1.25, cached: 0.125, output: 10 },
    'google/gemini-2.5-pro:batch': { input: 0.625, cached: 0.125, output: 5 },
    'google/gemini-3-flash-preview': { input: 0.5, cached: 0.05, output: 3 },
    'google/gemini-3-flash-preview:batch': { input: 0.25, cached: 0, output: 1.5 },
    'google/gemini-3-pro-image': { input: 2, cached: 0.2, output: 12 },
    'google/gemini-3-pro-image-preview': { input: 2, cached: 0.2, output: 12 },
    'google/gemini-3.1-flash-image': { input: 0.5, cached: 0, output: 3 },
    'google/gemini-3.1-flash-image-preview': { input: 0.5, cached: 0, output: 3 },
    'google/gemini-3.1-flash-lite': { input: 0.25, cached: 0.025, output: 1.5 },
    'google/gemini-3.1-flash-lite-image': { input: 0.25, cached: 0, output: 1.5 },
    'google/gemini-3.1-flash-lite-preview': { input: 0.25, cached: 0.025, output: 1.5 },
    'google/gemini-3.1-flash-lite:batch': { input: 0.125, cached: 0.0125, output: 0.75 },
    'google/gemini-3.1-pro-preview': { input: 2, cached: 0.2, output: 12 },
    'google/gemini-3.1-pro-preview-customtools': { input: 2, cached: 0.2, output: 12 },
    'google/gemini-3.1-pro-preview:batch': { input: 1, cached: 0, output: 6 },
    'google/gemini-3.5-flash': { input: 1.5, cached: 0.15, output: 9 },
    'google/gemini-3.5-flash-lite': { input: 0.3, cached: 0.03, output: 2.5 },
    'google/gemini-3.5-flash-lite:batch': { input: 0.15, cached: 0.015, output: 1.25 },
    'google/gemini-3.5-flash:batch': { input: 0.75, cached: 0.075, output: 4.5 },
    'google/gemini-3.6-flash': { input: 0.75, cached: 0.075, output: 3.75 },
    'google/gemini-3.6-flash:batch': { input: 0.375, cached: 0.0375, output: 1.875 },
    'google/gemini-3.7-flash': { input: 0.75, cached: 0.075, output: 3.75 },
    'google/gemini-3.7-flash:batch': { input: 0.375, cached: 0.0375, output: 1.875 },
    'google/gemini-3.8-flash': { input: 0.75, cached: 0.075, output: 3.75 },
    'google/gemini-3.8-flash:batch': { input: 0.375, cached: 0.0375, output: 1.875 },
    'google/gemma-2-27b-it': { input: 0.65, cached: 0, output: 0.65 },
    'google/gemma-3-12b-it': { input: 0.05, cached: 0, output: 0.15 },
    'google/gemma-3-27b-it': { input: 0.08, cached: 0.04, output: 0.45 },
    'google/gemma-3-4b-it': { input: 0.05, cached: 0, output: 0.1 },
    'google/gemma-4-26b-a4b-it': { input: 0.0675, cached: 0.0375, output: 0.225 },
    'google/gemma-4-26b-a4b-it:free': { input: 0, cached: 0, output: 0 },
    'google/gemma-4-31b-it': { input: 0.09, cached: 0.05, output: 0.34 },
    'google/gemma-4-31b-it:free': { input: 0, cached: 0, output: 0 },
    'google/lyria-3-clip-preview': { input: 0, cached: 0, output: 0 },
    'google/lyria-3-pro-preview': { input: 0, cached: 0, output: 0 },
    'gryphe/mythomax-l2-13b': { input: 0.08, cached: 0, output: 0.11 },
    'ibm-granite/granite-4.0-h-micro': { input: 0.017, cached: 0, output: 0.112 },
    'ibm-granite/granite-4.2-8b': { input: 0.06, cached: 0.015, output: 0.25 },
    'inception/mercury-2': { input: 0.25, cached: 0.025, output: 0.75 },
    'inception/mercury-2.5': { input: 0.04, cached: 0.004, output: 0.15 },
    'inclusionai/ling-3.0-flash': { input: 0.021, cached: 0.0042, output: 0.063 },
    'inclusionai/ling-3.0-flash-fin': { input: 0.042, cached: 0.0084, output: 0.1232 },
    'inclusionai/ling-3.0-flash-sante:free': { input: 0, cached: 0, output: 0 },
    'inclusionai/ling-3.0-flash-vl': { input: 0.021, cached: 0.0042, output: 0.0616 },
    'inclusionai/ling-3.1-flash': { input: 0, cached: 0, output: 0 },
    'inference-net/schematron-v2-small': { input: 0.05, cached: 0.05, output: 0.23 },
    'inference-net/schematron-v2-turbo': { input: 0.03, cached: 0.03, output: 0.15 },
    'kwaipilot/kat-coder-pro-v2.5': { input: 0.74, cached: 0.15, output: 2.96 },
    'liquid/lfm-2.5-2.6b:free': { input: 0, cached: 0, output: 0 },
    'mancer/weaver': { input: 0.4, cached: 0, output: 0.75 },
    'meituan/longcat-2.0': { input: 0.3, cached: 0.006, output: 1.2 },
    'meta/muse-glimmer-30b': { input: 0.35, cached: 0.04, output: 1.5 },
    'meta/muse-spark-1.1': { input: 1.25, cached: 0.15, output: 4.25 },
    'meta/muse-spark-1.2': { input: 1.25, cached: 0.15, output: 4.25 },
    'meta/muse-spark-1.2-contributor': { input: 0.1, cached: 0.002, output: 0.2 },
    'meta/muse-spark-1.3': { input: 1.25, cached: 0.15, output: 4.25 },
    'meta/muse-spark-1.3-contributor': { input: 0.1, cached: 0.002, output: 0.2 },
    'meta-llama/llama-3.1-70b-instruct': { input: 0.4, cached: 0, output: 0.4 },
    'meta-llama/llama-3.1-8b-instruct': { input: 0.05, cached: 0.025, output: 0.08 },
    'meta-llama/llama-3.2-1b-instruct': { input: 0.027, cached: 0, output: 0.201 },
    'meta-llama/llama-3.2-3b-instruct': { input: 0.05, cached: 0, output: 0.33 },
    'meta-llama/llama-3.3-70b-instruct': { input: 0.22, cached: 0.11, output: 0.5 },
    'meta-llama/llama-4-maverick': { input: 0.1875, cached: 0, output: 0.6525 },
    'meta-llama/llama-4-scout': { input: 0.1, cached: 0, output: 0.3 },
    'meta-llama/llama-guard-4-12b': { input: 0.18, cached: 0, output: 0.18 },
    'microsoft/phi-4': { input: 0.07, cached: 0, output: 0.14 },
    'microsoft/wizardlm-2-8x22b': { input: 0.62, cached: 0, output: 0.62 },
    'minimax/minimax-01': { input: 0.2, cached: 0, output: 1.1 },
    'minimax/minimax-m1': { input: 0.55, cached: 0, output: 2.2 },
    'minimax/minimax-m2': { input: 0.3, cached: 0, output: 1.2 },
    'minimax/minimax-m2-her': { input: 0.3, cached: 0.03, output: 1.2 },
    'minimax/minimax-m2.1': { input: 0.3, cached: 0.03, output: 1.2 },
    'minimax/minimax-m2.5': { input: 0.27, cached: 0.027, output: 1.08 },
    'minimax/minimax-m2.7': { input: 0.21, cached: 0.042, output: 0.84 },
    'minimax/minimax-m3': { input: 0.3, cached: 0.06, output: 1.2 },
    'mistralai/codestral-2508': { input: 0.3, cached: 0.03, output: 0.9 },
    'mistralai/codestral-2508:batch': { input: 0.15, cached: 0.015, output: 0.45 },
    'mistralai/devstral-2512': { input: 0.4, cached: 0.04, output: 2 },
    'mistralai/ministral-14b-2512': { input: 0.2, cached: 0.02, output: 0.2 },
    'mistralai/ministral-3b-2512': { input: 0.1, cached: 0.01, output: 0.1 },
    'mistralai/ministral-8b-2512': { input: 0.15, cached: 0.015, output: 0.15 },
    'mistralai/ministral-8b-2512:batch': { input: 0.075, cached: 0.0075, output: 0.075 },
    'mistralai/mistral-large': { input: 2, cached: 0.2, output: 6 },
    'mistralai/mistral-large-2407': { input: 2, cached: 0.2, output: 6 },
    'mistralai/mistral-large-2512': { input: 0.5, cached: 0.05, output: 1.5 },
    'mistralai/mistral-large-2512:batch': { input: 0.25, cached: 0.025, output: 0.75 },
    'mistralai/mistral-medium-3': { input: 0.4, cached: 0.04, output: 2 },
    'mistralai/mistral-medium-3-5': { input: 1.5, cached: 0, output: 7.5 },
    'mistralai/mistral-medium-3-5:batch': { input: 0.75, cached: 0, output: 3.75 },
    'mistralai/mistral-medium-3.1': { input: 0.4, cached: 0.04, output: 2 },
    'mistralai/mistral-medium-3.1:batch': { input: 0.2, cached: 0.02, output: 1 },
    'mistralai/mistral-nemo': { input: 0.019, cached: 0, output: 0.03 },
    'mistralai/mistral-saba': { input: 0.2, cached: 0.02, output: 0.6 },
    'mistralai/mistral-small-24b-instruct-2501': { input: 0.05, cached: 0, output: 0.08 },
    'mistralai/mistral-small-2603': { input: 0.15, cached: 0.015, output: 0.6 },
    'mistralai/mistral-small-2603:batch': { input: 0.075, cached: 0.0075, output: 0.3 },
    'mistralai/mistral-small-3.1-24b-instruct': { input: 0.351, cached: 0, output: 0.555 },
    'mistralai/mistral-small-3.2-24b-instruct': { input: 0.09375, cached: 0, output: 0.25 },
    'mistralai/mixtral-8x22b-instruct': { input: 2, cached: 0.2, output: 6 },
    'mistralai/voxtral-small-24b-2507': { input: 0.1, cached: 0.01, output: 0.3 },
    'moonshotai/kimi-k2': { input: 0.57, cached: 0, output: 2.3 },
    'moonshotai/kimi-k2-0905': { input: 0.6, cached: 0, output: 2.5 },
    'moonshotai/kimi-k2-thinking': { input: 0.6, cached: 0, output: 2.5 },
    'moonshotai/kimi-k2.5': { input: 0.45, cached: 0.07, output: 2.25 },
    'moonshotai/kimi-k2.6': { input: 0.95, cached: 0.16, output: 4 },
    'moonshotai/kimi-k2.7-code': { input: 0.6712, cached: 0.18, output: 3.35 },
    'moonshotai/kimi-k3': { input: 0.72, cached: 0.7, output: 13 },
    'moonshotai/kimi-k3:batch': { input: 2.28, cached: 0.228, output: 11.4 },
    'morph/morph-v3-fast': { input: 0.8, cached: 0, output: 1.2 },
    'morph/morph-v3-large': { input: 0.9, cached: 0, output: 1.9 },
    'nex-agi/nex-n2.5-mini': { input: 0.025, cached: 0.0025, output: 0.1 },
    'nex-agi/nex-n2.5-pro': { input: 0.075, cached: 0.015, output: 0.25 },
    'nousresearch/hermes-3-llama-3.1-405b': { input: 1, cached: 0, output: 1 },
    'nousresearch/hermes-3-llama-3.1-70b': { input: 0.7, cached: 0, output: 0.7 },
    'nousresearch/hermes-4-405b': { input: 1, cached: 0, output: 3 },
    'nvidia/nemotron-3-nano-30b-a3b': { input: 0.05, cached: 0.03, output: 0.2 },
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': { input: 0, cached: 0, output: 0 },
    'nvidia/nemotron-3-super-120b-a12b': { input: 0.08, cached: 0, output: 0.45 },
    'nvidia/nemotron-3-super-120b-a12b:free': { input: 0, cached: 0, output: 0 },
    'nvidia/nemotron-3-ultra-550b-a55b': { input: 0.5, cached: 0.1, output: 2.2 },
    'nvidia/nemotron-3-ultra-550b-a55b:free': { input: 0, cached: 0, output: 0 },
    'nvidia/nemotron-3.5-content-safety': { input: 0.2, cached: 0, output: 0.2 },
    'nvidia/nemotron-3.5-content-safety:free': { input: 0, cached: 0, output: 0 },
    'nvidia/nemotron-3.5-lightning': { input: 0.0595, cached: 0.02975, output: 0.17 },
    'nvidia/nemotron-3.5-lightning:free': { input: 0, cached: 0, output: 0 },
    'openai/gpt-3.5-turbo': { input: 0.5, cached: 0, output: 1.5 },
    'openai/gpt-3.5-turbo-0613': { input: 1, cached: 0, output: 2 },
    'openai/gpt-3.5-turbo-16k': { input: 3, cached: 0, output: 4 },
    'openai/gpt-3.5-turbo-instruct': { input: 1.5, cached: 0, output: 2 },
    'openai/gpt-3.5-turbo:batch': { input: 0.25, cached: 0, output: 0.75 },
    'openai/gpt-4': { input: 30, cached: 0, output: 60 },
    'openai/gpt-4-turbo': { input: 10, cached: 0, output: 30 },
    'openai/gpt-4-turbo:batch': { input: 5, cached: 0, output: 15 },
    'openai/gpt-4.1': { input: 2, cached: 0.5, output: 8 },
    'openai/gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
    'openai/gpt-4.1-mini:batch': { input: 0.2, cached: 0.05, output: 0.8 },
    'openai/gpt-4.1-nano': { input: 0.1, cached: 0.025, output: 0.4 },
    'openai/gpt-4.1-nano:batch': { input: 0.05, cached: 0.0125, output: 0.2 },
    'openai/gpt-4.1:batch': { input: 1, cached: 0.25, output: 4 },
    'openai/gpt-4o': { input: 2.5, cached: 1.25, output: 10 },
    'openai/gpt-4o-2024-05-13': { input: 5, cached: 0, output: 15 },
    'openai/gpt-4o-2024-08-06': { input: 2.5, cached: 1.25, output: 10 },
    'openai/gpt-4o-2024-11-20': { input: 2.5, cached: 1.25, output: 10 },
    'openai/gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
    'openai/gpt-4o-mini-2024-07-18': { input: 0.15, cached: 0.075, output: 0.6 },
    'openai/gpt-4o-mini:batch': { input: 0.075, cached: 0.0375, output: 0.3 },
    'openai/gpt-4o:batch': { input: 1.25, cached: 0.625, output: 5 },
    'openai/gpt-5': { input: 1.25, cached: 0.125, output: 10 },
    'openai/gpt-5-image': { input: 10, cached: 1.25, output: 10 },
    'openai/gpt-5-image-mini': { input: 2.5, cached: 0.25, output: 2 },
    'openai/gpt-5-mini': { input: 0.25, cached: 0.025, output: 2 },
    'openai/gpt-5-mini:batch': { input: 0.125, cached: 0.0125, output: 1 },
    'openai/gpt-5-nano': { input: 0.05, cached: 0.005, output: 0.4 },
    'openai/gpt-5-nano:batch': { input: 0.025, cached: 0.0025, output: 0.2 },
    'openai/gpt-5-pro': { input: 15, cached: 0, output: 120 },
    'openai/gpt-5-pro:batch': { input: 7.5, cached: 0, output: 60 },
    'openai/gpt-5.1': { input: 1.25, cached: 0.125, output: 10 },
    'openai/gpt-5.1-codex': { input: 1.25, cached: 0.13, output: 10 },
    'openai/gpt-5.1-codex-max': { input: 1.25, cached: 0.125, output: 10 },
    'openai/gpt-5.1-codex-mini': { input: 0.25, cached: 0.03, output: 2 },
    'openai/gpt-5.1:batch': { input: 0.625, cached: 0.0625, output: 5 },
    'openai/gpt-5.2': { input: 1.75, cached: 0.175, output: 14 },
    'openai/gpt-5.2-chat': { input: 1.75, cached: 0.175, output: 14 },
    'openai/gpt-5.2-codex': { input: 1.75, cached: 0.175, output: 14 },
    'openai/gpt-5.2-pro': { input: 21, cached: 0, output: 168 },
    'openai/gpt-5.2-pro:batch': { input: 10.5, cached: 0, output: 84 },
    'openai/gpt-5.2:batch': { input: 0.875, cached: 0.0875, output: 7 },
    'openai/gpt-5.3-codex': { input: 1.75, cached: 0.175, output: 14 },
    'openai/gpt-5.4': { input: 2.5, cached: 0.25, output: 15 },
    'openai/gpt-5.4-image-2': { input: 8, cached: 2, output: 15 },
    'openai/gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
    'openai/gpt-5.4-mini:batch': { input: 0.375, cached: 0.0375, output: 2.25 },
    'openai/gpt-5.4-nano': { input: 0.2, cached: 0.02, output: 1.25 },
    'openai/gpt-5.4-nano:batch': { input: 0.1, cached: 0.01, output: 0.625 },
    'openai/gpt-5.4-pro': { input: 30, cached: 0, output: 180 },
    'openai/gpt-5.4-pro:batch': { input: 15, cached: 0, output: 90 },
    'openai/gpt-5.4:batch': { input: 1.25, cached: 0.125, output: 7.5 },
    'openai/gpt-5.5': { input: 5, cached: 0.5, output: 30 },
    'openai/gpt-5.5-pro': { input: 30, cached: 0, output: 180 },
    'openai/gpt-5.5-pro:batch': { input: 15, cached: 0, output: 90 },
    'openai/gpt-5.5:batch': { input: 2.5, cached: 0.25, output: 15 },
    'openai/gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2 },
    'openai/gpt-5.6-luna-pro': { input: 0.2, cached: 0.02, output: 1.2 },
    'openai/gpt-5.6-luna-pro:batch': { input: 0.1, cached: 0.01, output: 0.6 },
    'openai/gpt-5.6-luna:batch': { input: 0.1, cached: 0.01, output: 0.6 },
    'openai/gpt-5.6-sol': { input: 2, cached: 0.2, output: 10 },
    'openai/gpt-5.6-sol-pro': { input: 4, cached: 0.4, output: 20 },
    'openai/gpt-5.6-sol-pro:batch': { input: 1, cached: 0.1, output: 5 },
    'openai/gpt-5.6-sol:batch': { input: 1, cached: 0.1, output: 5 },
    'openai/gpt-5.6-terra': { input: 2, cached: 0.2, output: 12 },
    'openai/gpt-5.6-terra-pro': { input: 2, cached: 0.2, output: 12 },
    'openai/gpt-5.6-terra-pro:batch': { input: 1, cached: 0.1, output: 6 },
    'openai/gpt-5.6-terra:batch': { input: 1, cached: 0.1, output: 6 },
    'openai/gpt-5:batch': { input: 0.625, cached: 0.0625, output: 5 },
    'openai/gpt-6-astra': { input: 10, cached: 1, output: 50 },
    'openai/gpt-6-astra-pro': { input: 10, cached: 1, output: 50 },
    'openai/gpt-6-astra-pro:batch': { input: 5, cached: 0.5, output: 25 },
    'openai/gpt-6-astra:batch': { input: 5, cached: 0.5, output: 25 },
    'openai/gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
    'openai/gpt-6-luna-pro': { input: 0.1, cached: 0.01, output: 0.5 },
    'openai/gpt-6-luna-pro:batch': { input: 0.05, cached: 0.005, output: 0.25 },
    'openai/gpt-6-luna:batch': { input: 0.05, cached: 0.005, output: 0.25 },
    'openai/gpt-6-sol': { input: 2, cached: 0.2, output: 10 },
    'openai/gpt-6-sol-pro': { input: 2, cached: 0.2, output: 10 },
    'openai/gpt-6-sol-pro:batch': { input: 1, cached: 0.1, output: 5 },
    'openai/gpt-6-sol:batch': { input: 1, cached: 0.1, output: 5 },
    'openai/gpt-6.1-sol': { input: 2, cached: 0.1, output: 10 },
    'openai/gpt-6.1-sol-pro': { input: 2, cached: 0.1, output: 10 },
    'openai/gpt-audio': { input: 2.5, cached: 0, output: 10 },
    'openai/gpt-audio-mini': { input: 0.6, cached: 0, output: 2.4 },
    'openai/gpt-chat-latest': { input: 5, cached: 0.5, output: 30 },
    'openai/gpt-oss-120b': { input: 0.037, cached: 0, output: 0.17 },
    'openai/gpt-oss-120b:batch': { input: 0.0296, cached: 0, output: 0.136 },
    'openai/gpt-oss-20b': { input: 0.018, cached: 0.009, output: 0.09 },
    'openai/gpt-oss-20b:batch': { input: 0.024, cached: 0, output: 0.112 },
    'openai/gpt-oss-safeguard-20b': { input: 0.075, cached: 0.0375, output: 0.3 },
    'openai/o1': { input: 15, cached: 7.5, output: 60 },
    'openai/o1-pro': { input: 150, cached: 0, output: 600 },
    'openai/o3': { input: 2, cached: 0.5, output: 8 },
    'openai/o3-mini': { input: 1.1, cached: 0.55, output: 4.4 },
    'openai/o3-mini-high': { input: 1.1, cached: 0.55, output: 4.4 },
    'openai/o3-mini:batch': { input: 0.55, cached: 0.275, output: 2.2 },
    'openai/o3-pro': { input: 20, cached: 0, output: 80 },
    'openai/o3:batch': { input: 1, cached: 0.25, output: 4 },
    'openai/o4-mini': { input: 1.1, cached: 0.275, output: 4.4 },
    'openai/o4-mini-high': { input: 1.1, cached: 0.275, output: 4.4 },
    'openai/o4-mini:batch': { input: 0.55, cached: 0.1375, output: 2.2 },
    'openrouter/free': { input: 0, cached: 0, output: 0 },
    'perceptron/perceptron-mk1': { input: 0.15, cached: 0, output: 1.5 },
    'perceptron/perceptron-mk1.5': { input: 0.15, cached: 0, output: 1.5 },
    'perplexity/sonar': { input: 1, cached: 0, output: 1 },
    'perplexity/sonar-deep-research': { input: 2, cached: 0, output: 8 },
    'perplexity/sonar-pro': { input: 3, cached: 0, output: 15 },
    'perplexity/sonar-pro-search': { input: 3, cached: 0, output: 15 },
    'perplexity/sonar-reasoning-pro': { input: 2, cached: 0, output: 8 },
    'poolside/laguna-s-2.1': { input: 0.09, cached: 0.009, output: 0.18 },
    'poolside/laguna-s-2.1:free': { input: 0, cached: 0, output: 0 },
    'poolside/laguna-xs-2.1': { input: 0.06, cached: 0.03, output: 0.12 },
    'poolside/laguna-xs-2.1:free': { input: 0, cached: 0, output: 0 },
    'prism-ml/ternary-bonsai-2-27b': { input: 0.075, cached: 0.0375, output: 0.5 },
    'qwen/qwen-2.5-72b-instruct': { input: 0.36, cached: 0, output: 0.4 },
    'qwen/qwen-2.5-7b-instruct': { input: 0.1, cached: 0, output: 0.2 },
    'qwen/qwen-2.5-coder-32b-instruct': { input: 0.66, cached: 0, output: 1 },
    'qwen/qwen-plus': { input: 0.26, cached: 0.052, output: 0.78 },
    'qwen/qwen-plus-2025-07-28': { input: 0.26, cached: 0, output: 0.78 },
    'qwen/qwen2.5-vl-72b-instruct': { input: 0.8, cached: 0.4, output: 1 },
    'qwen/qwen3-14b': { input: 0.12, cached: 0, output: 0.24 },
    'qwen/qwen3-235b-a22b': { input: 0.455, cached: 0, output: 1.82 },
    'qwen/qwen3-235b-a22b-2507': { input: 0.0875, cached: 0.0175, output: 0.35 },
    'qwen/qwen3-235b-a22b-thinking-2507': { input: 0.23, cached: 0, output: 2.3 },
    'qwen/qwen3-30b-a3b': { input: 0.12, cached: 0, output: 0.5 },
    'qwen/qwen3-30b-a3b-instruct-2507': { input: 0.04815, cached: 0, output: 0.19305 },
    'qwen/qwen3-30b-a3b-thinking-2507': { input: 0.2, cached: 0, output: 2.4 },
    'qwen/qwen3-32b': { input: 0.08, cached: 0, output: 0.28 },
    'qwen/qwen3-8b': { input: 0.117, cached: 0, output: 0.455 },
    'qwen/qwen3-coder': { input: 0.3, cached: 0.1, output: 1 },
    'qwen/qwen3-coder-30b-a3b-instruct': { input: 0.07, cached: 0, output: 0.28 },
    'qwen/qwen3-coder-flash': { input: 0.195, cached: 0.039, output: 0.975 },
    'qwen/qwen3-coder-next': { input: 0.12, cached: 0.07, output: 0.8 },
    'qwen/qwen3-coder-plus': { input: 0.65, cached: 0.13, output: 3.25 },
    'qwen/qwen3-max': { input: 0.78, cached: 0.156, output: 3.9 },
    'qwen/qwen3-max-thinking': { input: 0.78, cached: 0, output: 3.9 },
    'qwen/qwen3-next-80b-a3b-instruct': { input: 0.1, cached: 0.07, output: 1.1 },
    'qwen/qwen3-next-80b-a3b-thinking': { input: 0.15, cached: 0, output: 1.2 },
    'qwen/qwen3-vl-235b-a22b-instruct': { input: 0.21, cached: 0.1, output: 1.9 },
    'qwen/qwen3-vl-235b-a22b-thinking': { input: 0.4, cached: 0, output: 4 },
    'qwen/qwen3-vl-30b-a3b-instruct': { input: 0.15, cached: 0, output: 0.6 },
    'qwen/qwen3-vl-30b-a3b-thinking': { input: 0.2, cached: 0, output: 2.4 },
    'qwen/qwen3-vl-32b-instruct': { input: 0.104, cached: 0, output: 0.416 },
    'qwen/qwen3-vl-8b-instruct': { input: 0.117, cached: 0, output: 0.455 },
    'qwen/qwen3-vl-8b-thinking': { input: 0.18, cached: 0, output: 2.1 },
    'qwen/qwen3.5-122b-a10b': { input: 0.26, cached: 0, output: 2.08 },
    'qwen/qwen3.5-27b': { input: 0.195, cached: 0, output: 1.56 },
    'qwen/qwen3.5-35b-a3b': { input: 0.15, cached: 0.05, output: 1 },
    'qwen/qwen3.5-397b-a17b': { input: 0.55, cached: 0.225, output: 3.5 },
    'qwen/qwen3.5-9b': { input: 0.1, cached: 0, output: 0.15 },
    'qwen/qwen3.5-flash-02-23': { input: 0.065, cached: 0, output: 0.26 },
    'qwen/qwen3.5-plus-02-15': { input: 0.26, cached: 0, output: 1.56 },
    'qwen/qwen3.5-plus-20260420': { input: 0.3, cached: 0, output: 1.8 },
    'qwen/qwen3.6-27b': { input: 0.32, cached: 0, output: 3.2 },
    'qwen/qwen3.6-35b-a3b': { input: 0.15, cached: 0.05, output: 1 },
    'qwen/qwen3.6-flash': { input: 0.1875, cached: 0, output: 1.125 },
    'qwen/qwen3.6-max-preview': { input: 1.027, cached: 0, output: 6.162 },
    'qwen/qwen3.6-plus': { input: 0.325, cached: 0, output: 1.95 },
    'qwen/qwen3.7-flash': { input: 0.03, cached: 0.006, output: 0.13 },
    'qwen/qwen3.7-max': { input: 1.475, cached: 0.295, output: 4.425 },
    'qwen/qwen3.7-plus': { input: 0.32, cached: 0.064, output: 1.28 },
    'qwen/qwen3.8-2.4t-a95b': { input: 2, cached: 0.25, output: 6 },
    'qwen/qwen3.8-27b': { input: 0.425, cached: 0.085, output: 2.55 },
    'qwen/qwen3.8-27b:free': { input: 0, cached: 0, output: 0 },
    'qwen/qwen3.8-flash': { input: 0.15, cached: 0.016, output: 0.47 },
    'qwen/qwen3.8-max-0902': { input: 2, cached: 0.25, output: 6 },
    'qwen/qwen3.8-max-prime': { input: 4, cached: 0.5, output: 12 },
    'qwen/qwen3.8-omni-flash': { input: 0.15, cached: 0.016, output: 0.47 },
    'rekaai/reka-edge': { input: 0.1, cached: 0, output: 0.1 },
    'rekaai/reka-flash-3': { input: 0.1, cached: 0, output: 0.2 },
    'relace/relace-apply-3': { input: 0.85, cached: 0, output: 1.25 },
    'relace/relace-search': { input: 1, cached: 0, output: 3 },
    'sakana/fugu-max': { input: 2, cached: 0.25, output: 6 },
    'sakana/fugu-ultra': { input: 5, cached: 0.5, output: 30 },
    'sakana/fugu-ultra-v2': { input: 5, cached: 0.5, output: 30 },
    'sakana/sakana-namazu': { input: 0.95, cached: 0.15, output: 4 },
    'sao10k/l3-lunaris-8b': { input: 0.04, cached: 0, output: 0.05 },
    'sao10k/l3.1-euryale-70b': { input: 0.85, cached: 0, output: 0.85 },
    'sao10k/l3.3-euryale-70b': { input: 0.65, cached: 0, output: 0.75 },
    'stealth/space-bunny-alpha': { input: 0, cached: 0, output: 0 },
    'stepfun/step-3.5-flash': { input: 0.1, cached: 0, output: 0.3 },
    'stepfun/step-3.7-flash': { input: 0.2, cached: 0.04, output: 1.15 },
    'tencent/hunyuan-a13b-instruct': { input: 0.14, cached: 0, output: 0.57 },
    'tencent/hy-mt2-1.8b': { input: 0.044, cached: 0, output: 0.177 },
    'tencent/hy-mt2-30b-a3b': { input: 0.074, cached: 0, output: 0.295 },
    'tencent/hy-mt2-7b': { input: 0.074, cached: 0, output: 0.295 },
    'tencent/hy3': { input: 0.132, cached: 0.033, output: 0.528 },
    'tencent/hy3-preview': { input: 0.18, cached: 0.06, output: 0.6 },
    'tencent/hy4-preview': { input: 0.834, cached: 0.042, output: 2.501 },
    'thedrummer/cydonia-24b-v4.1': { input: 0.3, cached: 0.15, output: 0.5 },
    'thedrummer/skyfall-36b-v2': { input: 0.55, cached: 0.25, output: 0.8 },
    'thedrummer/unslopnemo-12b': { input: 0.4, cached: 0, output: 0.4 },
    'thinkingmachines/inkling': { input: 0.95, cached: 0.16, output: 4.05 },
    'thinkingmachines/inkling-small': { input: 0.45, cached: 0.1, output: 1.2 },
    'thinkingmachines/inkling-small:free': { input: 0, cached: 0, output: 0 },
    'thinkingmachines/inkling:free': { input: 0, cached: 0, output: 0 },
    'unbiased/pareto': { input: 2.5, cached: 0.25, output: 7.5 },
    'unbiased/pareto-26.10-preview': { input: 0.8, cached: 0.03, output: 3.2 },
    'undi95/remm-slerp-l2-13b': { input: 0.35, cached: 0, output: 0.65 },
    'upstage/solar-mini4': { input: 0.05, cached: 0.005, output: 0.2 },
    'upstage/solar-pro-3': { input: 0.15, cached: 0.015, output: 0.6 },
    'upstage/solar-pro4': { input: 0.09, cached: 0.018, output: 0.36 },
    'writer/palmyra-x5': { input: 0.6, cached: 0, output: 6 },
    'x-ai/grok-4.20': { input: 1.25, cached: 0.2, output: 2.5 },
    'x-ai/grok-4.20-multi-agent': { input: 1.25, cached: 0.2, output: 2.5 },
    'x-ai/grok-4.3': { input: 1.25, cached: 0.2, output: 2.5 },
    'x-ai/grok-4.3:batch': { input: 1, cached: 0.16, output: 2 },
    'x-ai/grok-4.5': { input: 2, cached: 0.3, output: 6 },
    'x-ai/grok-4.6': { input: 2, cached: 0.5, output: 6 },
    'x-ai/grok-4.7': { input: 2, cached: 0.5, output: 6 },
    'x-ai/grok-build-0.1': { input: 1, cached: 0.2, output: 2 },
    'xiaomi/mimo-v2.5': { input: 0.14, cached: 0.0028, output: 0.28 },
    'xiaomi/mimo-v2.5-pro': { input: 0.435, cached: 0.0036, output: 0.87 },
    'xiaomi/mimo-v2.6-flash': { input: 0.14, cached: 0.0028, output: 0.28 },
    'xiaomi/mimo-v2.6-pro': { input: 0.435, cached: 0.0036, output: 0.87 },
    'xiaomi/mimo-v2.6-pro-ultraspeed': { input: 4.35, cached: 0.036, output: 8.7 },
    'z-ai/glm-4.5': { input: 0.6, cached: 0.11, output: 2.2 },
    'z-ai/glm-4.5-air': { input: 0.13, cached: 0.025, output: 0.85 },
    'z-ai/glm-4.5v': { input: 0.6, cached: 0.11, output: 1.8 },
    'z-ai/glm-4.6': { input: 0.43, cached: 0.08, output: 1.75 },
    'z-ai/glm-4.6v': { input: 0.3, cached: 0.05, output: 0.9 },
    'z-ai/glm-4.7': { input: 0.6, cached: 0.11, output: 2.2 },
    'z-ai/glm-4.7-flash': { input: 0.0605, cached: 0, output: 0.4 },
    'z-ai/glm-5': { input: 0.6, cached: 0.12, output: 1.92 },
    'z-ai/glm-5-turbo': { input: 1.2, cached: 0.24, output: 4 },
    'z-ai/glm-5.1': { input: 1.4, cached: 0.26, output: 4.4 },
    'z-ai/glm-5.2': { input: 0.38, cached: 0.26, output: 3.49 },
    'z-ai/glm-5.3': { input: 1.4, cached: 0.14, output: 4.4 },
    'z-ai/glm-5.3-flash': { input: 0.15, cached: 0.03, output: 0.5 },
    'z-ai/glm-5.3-flash:batch': { input: 0.06, cached: 0.012, output: 0.2 },
    'z-ai/glm-5.3-flashx': { input: 0.37, cached: 0.09, output: 1.25 },
    'z-ai/glm-5.3-prime': { input: 2.8, cached: 0.56, output: 8.8 },
    'z-ai/glm-5.3:batch': { input: 0.45, cached: 0.1, output: 2 },
    'z-ai/glm-5v-turbo': { input: 1.2, cached: 0.24, output: 4 },
    '~anthropic/claude-fable-latest': { input: 10, cached: 0.25, output: 50 },
    '~anthropic/claude-haiku-latest': { input: 1, cached: 0.1, output: 5 },
    '~anthropic/claude-opus-latest': { input: 4, cached: 0.2, output: 20 },
    '~anthropic/claude-sonnet-latest': { input: 2, cached: 0.2, output: 10 },
    '~deepseek/deepseek-flash-latest': { input: 0.003, cached: 0.003, output: 2.4 },
    '~deepseek/deepseek-pro-latest': { input: 0.1901, cached: 0.19, output: 4.2 },
    '~deepseek/deepseek-v4-flash-latest': { input: 0.0152, cached: 0.0152, output: 1.28 },
    '~google/gemini-flash-latest': { input: 0.75, cached: 0.075, output: 3.75 },
    '~google/gemini-pro-latest': { input: 2, cached: 0.2, output: 12 },
    '~moonshotai/kimi-latest': { input: 0.6756, cached: 0.45, output: 13 },
    '~openai/gpt-astra-latest': { input: 10, cached: 1, output: 50 },
    '~openai/gpt-luna-latest': { input: 0.1, cached: 0.01, output: 0.5 },
    '~openai/gpt-mini-latest': { input: 0.75, cached: 0.075, output: 4.5 },
    '~openai/gpt-sol-latest': { input: 2, cached: 0.1, output: 10 },
    '~openai/gpt-terra-latest': { input: 2, cached: 0.2, output: 12 },
    '~x-ai/grok-latest': { input: 2, cached: 0.5, output: 6 },
    '~z-ai/glm-flash-latest': { input: 0.0352, cached: 0.0352, output: 0.5 },
    '~z-ai/glm-latest': { input: 0.05, cached: 0.04, output: 5 },
  }

  // Wiring (after the table declaration — TDZ-safe):
  PRICES_PROVIDER.openrouter = PRICES_OPENROUTER
  PRICES_PROVIDER.nous = PRICES_OPENROUTER

  // USD → EUR conversion factor (Mistral La Plateforme lists GLM 5.2 at
  // $1.40 / €1.19 → 0.85). Update when the official EUR listing shifts.
  const EUR_RATE = 0.85

  // Estimate session cost from usage fields. Returns null when the model is
  // unpriced (never fabricate a number) or usage is missing.
  // Provider-aware lookup — exact billing_provider match first
  // (PRICES_PROVIDER), then model-only (PRICES).
  function estimateCost(u) {
    if (!u) return null
    const model = String(u.model || '').trim()
    let p = null
    const provider = String(u.billing_provider || '').trim().toLowerCase()
    if (provider && PRICES_PROVIDER[provider]) {
      p = PRICES_PROVIDER[provider][model] || null
    }
    if (!p) p = PRICES[model] || null
    if (!p) return null
    const input = Number(u.input) || 0
    const cached = Number(u.cache_read) || 0
    const output = Number(u.output) || 0
    if (!input && !cached && !output) return null
    // "input" from the gateway excludes cache reads (CanonicalUsage.input_tokens
    // is fresh input); bill cached tokens at the cheaper cache-read rate.
    const cost = (input * p.input + cached * p.cached + output * p.output) / 1_000_000
    return cost
  }

  // ── Helpers (ported 1:1 from the desktop pane) ───────────────────────

  function fmt(n) {
    if (n == null || isNaN(n)) return '—'
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
    return String(n)
  }

  function fmtFull(n) {
    if (n == null || isNaN(n)) return '—'
    return n.toLocaleString('de-DE')
  }

  function fmtDate(ts) {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  // History range presets — CALENDAR windows, not rolling:
  //   day      = today 0:00 → open
  //   workweek = Mon 0:00 → Sat 0:00 (exclusive, i.e. Mon–Fri 23:59:59)
  //   week     = Mon 0:00 → open (full Mon–Sun calendar week)
  //   month    = 1st of month 0:00 → open
  //   all      = everything
  const RANGE_PRESETS = [
    { key: 'day', label: '1d', tip: 'Heute (ab 0:00 Uhr)' },
    { key: 'workweek', label: '5d', tip: 'Laufende Arbeitswoche: Mo 0:00 – Fr 23:59:59' },
    { key: 'week', label: '7d', tip: 'Laufende Kalenderwoche: Mo 0:00 – So 23:59:59' },
    { key: 'month', label: '30d', tip: 'Laufender Monat (ab dem 1., 0:00 Uhr)' },
    { key: 'all', label: '∞', tip: 'Alles' },
  ]

  // Compute the calendar window for a preset in LOCAL time.
  // Returns { since, until } — epoch seconds, `since` inclusive,
  // `until` EXCLUSIVE (0 = open-ended).
  function windowFor(key) {
    const p = RANGE_PRESETS.find(p => p.key === key) || RANGE_PRESETS[3]
    if (p.key === 'all') return { since: 0, until: 0 }
    const now = new Date()
    const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate()
    if (p.key === 'day') {
      return { since: Math.floor(new Date(y, mo, d).getTime() / 1000), until: 0 }
    }
    if (p.key === 'month') {
      return { since: Math.floor(new Date(y, mo, 1).getTime() / 1000), until: 0 }
    }
    // week / workweek: start of the current calendar week (Monday 0:00)
    const dow = (now.getDay() + 6) % 7 // Mon=0 … Sun=6
    const since = Math.floor(new Date(y, mo, d - dow).getTime() / 1000)
    if (p.key === 'workweek') {
      // Mon 0:00 → Sat 0:00 (exclusive) = Mon–Fri 23:59:59
      const until = Math.floor(new Date(y, mo, d - dow + 5).getTime() / 1000)
      return { since, until }
    }
    return { since, until: 0 } // full week, open-ended
  }

  function _pad(n) { return String(n).padStart(2, '0') }
  function dayKeyDate(d) {
    return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate())
  }
  function dayKeyTs(ts) { return dayKeyDate(new Date(ts * 1000)) }

  function dayLabel(key) {
    const now = new Date()
    if (key === dayKeyDate(now)) return 'Heute'
    if (key === dayKeyDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Gestern'
    const [y, m, d] = key.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  function windowLabel(range) {
    const win = windowFor(range)
    if (!win.since) return 'Alle Zeit'
    const since = new Date(win.since * 1000)
    const f = d => d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
    if (range === 'day') return 'Heute'
    if (range === 'workweek') return f(since) + ' – ' + f(new Date((win.until - 1) * 1000))
    if (range === 'week') return 'ab ' + f(since)
    return 'ab ' + since.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  const EMPTY_MSG = {
    day: 'Noch keine Sitzungen heute',
    workweek: 'Keine Sitzungen in der Arbeitswoche (Mo–Fr)',
    week: 'Keine Sitzungen in dieser Kalenderwoche',
    month: 'Keine Sitzungen im laufenden Monat',
    all: 'Noch keine Sitzungen im Ledger',
  }

  const AUX_LABELS = {
    background_review: 'Hintergrund-Review',
    compression: 'Kompression',
    vision: 'Vision',
    title_generation: 'Titel-Generierung',
    approval: 'Approval',
  }
  const auxLabel = (t) => AUX_LABELS[t] || t

  const SORTS = {
    activity: { dir: 'desc', val: r => (r.lastActive == null ? -Infinity : r.lastActive) },
    in: { dir: 'desc', val: r => r.u.input || 0 },
    cached: { dir: 'desc', val: r => r.u.cache_read || 0 },
    out: { dir: 'desc', val: r => r.u.output || 0 },
    cost: { dir: 'desc', val: r => r.cost != null ? r.cost : -Infinity },
  }

  // Per-day token totals over the window, for the mini histogram. A
  // session's tokens are attributed to its last-active day. Capped at 30
  // bars. Each bucket also carries the day's estimated PAYG-equivalent
  // cost (same estimateCost as everywhere; null-cost rows contribute 0).
  function buildHistogram(rows, range) {
    const win = windowFor(range)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const end = win.until
      ? new Date(Math.min(today.getTime(), (win.until - 1) * 1000))
      : today
    const start = new Date(Math.max(
      win.since ? win.since * 1000 : end - 29 * 86400000,
      end - 29 * 86400000))
    const buckets = []
    const idx = {}
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = dayKeyDate(d)
      if (key in idx) continue // DST edge: 86400s steps can repeat a local day
      idx[key] = buckets.length
      buckets.push({ key, tokens: 0, cost: 0, sessions: 0 })
    }
    const todayKey = dayKeyDate(new Date())
    for (const r of rows) {
      const key = r.lastActive != null ? dayKeyTs(r.lastActive) : todayKey
      const i = idx[key]
      if (i == null) continue
      buckets[i].tokens += (r.u.input || 0) + (r.u.cache_read || 0) + (r.u.output || 0)
      const c = estimateCost({ input: r.u.input, cache_read: r.u.cache_read, output: r.u.output, model: r.u.model, billing_provider: r.u.billing_provider })
      if (c != null) buckets[i].cost += c
      buckets[i].sessions++
    }
    return buckets
  }

  // ── Data hooks ──────────────────────────────────────────────────────

  // Known-ledger fetch: monotonic per-session totals + per-model rows,
  // same calendar-window params the desktop pane sends. 30 s poll.
  function useLedger(range, reload) {
    const win = windowFor(range)
    const since = win.since, until = win.until
    const [state, setState] = useState(null) // {ok:true,res} | {ok:false,error} | null
    useEffect(() => {
      let dead = false
      const load = async () => {
        try {
          const res = await fetchJSON(
            `/api/plugins/token-stats/ledger?since=${since}&until=${until}&days=0&limit=200`)
          if (!dead) setState({ ok: true, res })
        } catch (e) {
          if (!dead) setState({ ok: false, error: String(e && e.message ? e.message : e) })
        }
      }
      load()
      const iv = setInterval(load, 30_000)
      return () => { dead = true; clearInterval(iv) }
    }, [range, since, until, reload])
    return state
  }

  // Anomaly lookup: /events per session (once per session-ID set, capped
  // at 60 lookups) → Set of session IDs with at least one decrease event.
  function useAnomalies(sids) {
    const [flags, setFlags] = useState({})
    const key = sids.slice(0, 60).join(',')
    useEffect(() => {
      if (!key) return
      let dead = false
      ;(async () => {
        const out = {}
        for (const sid of sids.slice(0, 60)) {
          try {
            const ev = await fetchJSON(
              `/api/plugins/token-stats/events?session_id=${encodeURIComponent(sid)}&limit=10`)
            out[sid] = Boolean(ev && Array.isArray(ev.events)
              && ev.events.some(e => e.kind === 'decrease'))
          } catch (e) {
            out[sid] = false
          }
        }
        if (!dead) setFlags(out)
      })()
      return () => { dead = true }
    }, [key])
    const set = new Set()
    for (const [sid, bad] of Object.entries(flags)) if (bad) set.add(sid)
    return set
  }

  // ── Component ───────────────────────────────────────────────────────

  function TokenStatsWeb() {
    injectStyle()
    const [range, setRange] = useState('month')
    const [sortBy, setSortBy] = useState('activity') // activity | in | cached | out | cost
    const [sortDir, setSortDir] = useState('desc')
    const [collapsedDays, setCollapsedDays] = useState({})
    const [modelOpen, setModelOpen] = useState(false)
    const [subOpen, setSubOpen] = useState(false)
    const [auxOpen, setAuxOpen] = useState(false)
    const [histMetric, setHistMetric] = useState('tokens') // 'tokens' | 'cost'
    const [reload, setReload] = useState(0)

    const ledger = useLedger(range, reload)
    const ledgerOk = ledger && ledger.ok
    const histSessions = ledgerOk ? (ledger.res.sessions || []) : []
    const histByModel = ledgerOk ? (ledger.res.model_usage || []) : []

    // model_usage rows → { [sid]: [modelRows] }
    const modelRowsBySid = {}
    for (const r of histByModel) {
      const sid = r.session_id
      if (!modelRowsBySid[sid]) modelRowsBySid[sid] = []
      modelRowsBySid[sid].push(r)
    }

    // Per-model aggregate over the active window (footer model list).
    // Same counter semantics as the desktop: known counters, max'd with
    // the ledger's last-db-snapshot live values.
    const modelAgg = {}
    for (const r of histByModel) {
      const m = modelAgg[r.model] || (modelAgg[r.model] = {
        model: r.model,
        in: 0, cached: 0, out: 0, calls: 0, sessions: new Set(), cost: 0, unpriced: false,
      })
      m.in += Math.max(r.input_tokens || 0, r.live_in || 0)
      m.cached += Math.max(r.cache_read_tokens || 0, r.live_cached || 0)
      m.out += Math.max(r.output_tokens || 0, r.live_out || 0)
      m.calls += Math.max(r.api_calls || 0, r.live_calls || 0)
      m.sessions.add(r.session_id)
      const c = estimateCost({ input: r.input_tokens, cache_read: r.cache_read_tokens, output: r.output_tokens, model: r.model, billing_provider: r.billing_provider })
      if (c != null) m.cost += c; else if ((r.input_tokens || 0) + (r.output_tokens || 0) > 0) m.unpriced = true
    }
    const modelAggList = Object.values(modelAgg)
      .sort((a, b) => ((b.in + b.cached + b.out) - (a.in + a.cached + a.out)))
    const maxModelTotal = modelAggList.reduce((m, e) => Math.max(m, e.in + e.cached + e.out), 0)

    // Subagent rows over the active window (ledger sessions flagged by
    // the backend via source='subagent' / $._delegate_from).
    const subRows = histSessions
      .filter(s => s.is_subagent)
      .map(s => ({
        id: s.id,
        title: s.title || s.id.slice(0, 12),
        parent: s.parent_session_id || null,
        in: s.input_tokens || 0,
        cached: s.cache_read_tokens || 0,
        out: s.output_tokens || 0,
        calls: s.api_call_count || 0,
        cost: 0, unpriced: false,
      }))
    // Subagent costs: price each ledger model-row individually (a
    // subagent may use several models), using the same max'd counters.
    const subById = Object.fromEntries(subRows.map(s => [s.id, s]))
    for (const r of histByModel) {
      const s = subById[r.session_id]
      if (!s) continue
      const c = estimateCost({
        input: Math.max(r.input_tokens || 0, r.live_in || 0),
        cache_read: Math.max(r.cache_read_tokens || 0, r.live_cached || 0),
        output: Math.max(r.output_tokens || 0, r.live_out || 0),
        model: r.model, billing_provider: r.billing_provider,
      })
      if (c != null) s.cost += c
      else if ((r.input_tokens || 0) + (r.output_tokens || 0) > 0) s.unpriced = true
    }
    const maxSubTotal = subRows.reduce((m, e) => Math.max(m, e.in + e.cached + e.out), 0)

    // Aux-task aggregate over the active window: model rows with
    // task != '' grouped by task. Pure VIEW over data that already counts
    // in the session totals — no filtering.
    const auxAgg = {}
    for (const r of histByModel) {
      if (!r.task) continue
      const a = auxAgg[r.task] || (auxAgg[r.task] = {
        task: r.task,
        in: 0, cached: 0, out: 0, calls: 0, sessions: new Set(),
        cost: 0, unpriced: false,
        models: new Map(),
      })
      a.in += Math.max(r.input_tokens || 0, r.live_in || 0)
      a.cached += Math.max(r.cache_read_tokens || 0, r.live_cached || 0)
      a.out += Math.max(r.output_tokens || 0, r.live_out || 0)
      a.calls += Math.max(r.api_calls || 0, r.live_calls || 0)
      a.sessions.add(r.session_id)
      const c = estimateCost({
        input: Math.max(r.input_tokens || 0, r.live_in || 0),
        cache_read: Math.max(r.cache_read_tokens || 0, r.live_cached || 0),
        output: Math.max(r.output_tokens || 0, r.live_out || 0),
        model: r.model, billing_provider: r.billing_provider,
      })
      if (c != null) a.cost += c; else if ((r.input_tokens || 0) + (r.output_tokens || 0) > 0) a.unpriced = true
      const mo = a.models.get(r.model) || { in: 0, cached: 0, out: 0, calls: 0 }
      mo.in += Math.max(r.input_tokens || 0, r.live_in || 0)
      mo.cached += Math.max(r.cache_read_tokens || 0, r.live_cached || 0)
      mo.out += Math.max(r.output_tokens || 0, r.live_out || 0)
      mo.calls += Math.max(r.api_calls || 0, r.live_calls || 0)
      a.models.set(r.model, mo)
    }
    const auxAggList = Object.values(auxAgg)
      .sort((a, b) => ((b.in + b.cached + b.out) - (a.in + a.cached + a.out)))
    const maxAuxTotal = auxAggList.reduce((m, e) => Math.max(m, e.in + e.cached + e.out), 0)

    // Anomaly flags (⚠ DB-Reset), fetched once per session-ID set.
    const anomalySids = useAnomalies(ledgerOk ? histSessions.map(s => s.id) : [])

    // Unified row set (no live overlay — web has no usage event stream;
    // the ledger's known counters are the floor, ≤15 s daemon lag).
    const rows = histSessions.map(h => ({
      id: h.id,
      title: h.title || h.id.slice(0, 12),
      hadReset: anomalySids.has(h.id),
      lastActive: h.last_active,
      ledgerOnly: Boolean(h.ledger_only),
      modelRows: modelRowsBySid[h.id] || [],
      u: {
        input: h.input_tokens != null ? h.input_tokens : (h.input || 0),
        cache_read: h.cache_read_tokens != null ? h.cache_read_tokens : (h.cache_read || 0),
        output: h.output_tokens != null ? h.output_tokens : (h.output || 0),
        model: h.model || '',
        billing_provider: h.billing_provider || '',
      },
    }))
    for (const r of rows) {
      r.cost = estimateCost({ input: r.u.input, cache_read: r.u.cache_read, output: r.u.output, model: r.u.model, billing_provider: r.u.billing_provider })
    }

    // Sorted view (activity = server order + day separators).
    const sortedRows = (() => {
      if (sortBy === 'activity') return rows
      const val = SORTS[sortBy].val
      const s = [...rows].sort((a, b) => val(a) - val(b))
      return sortDir === 'asc' ? s : s.reverse()
    })()

    // Resolved collapse state: explicit override if set, else default
    // (today expanded, every other day collapsed).
    const todayKey = dayKeyDate(new Date())
    const isDayCollapsed = (k) => (k in collapsedDays ? Boolean(collapsedDays[k]) : k !== todayKey)
    const dayKeys = []
    {
      const seen = new Set()
      for (const r of rows) {
        if (r.lastActive == null) continue
        const k = dayKeyTs(r.lastActive)
        if (!seen.has(k)) { seen.add(k); dayKeys.push(k) }
      }
    }
    const allDaysCollapsed = dayKeys.length > 0 && dayKeys.every(k => isDayCollapsed(k))

    const toggleDayCollapse = (key) => {
      // Flip the RESOLVED state, then write an explicit override — a
      // naive "set true" is a no-op for default-collapsed days.
      setCollapsedDays(prev => {
        const resolved = (key in prev) ? Boolean(prev[key]) : (key !== todayKey)
        return { ...prev, [key]: !resolved }
      })
    }

    // Mini-histogram: both maxima precomputed so the metric toggle needs
    // no rebuild; tooltip always shows both values.
    const histBuckets = buildHistogram(rows, range)
    const histMaxTokens = histBuckets.reduce((m, b) => Math.max(m, b.tokens), 0)
    const histMaxCost = histBuckets.reduce((m, b) => Math.max(m, b.cost), 0)
    const histMax = histMetric === 'cost' ? histMaxCost : histMaxTokens

    // Aggregates over the unified rows.
    const grandInput = rows.reduce((s, r) => s + (r.u.input || 0), 0)
    const grandCached = rows.reduce((s, r) => s + (r.u.cache_read || 0), 0)
    const grandOutput = rows.reduce((s, r) => s + (r.u.output || 0), 0)
    let grandCost = 0
    let unpricedRows = 0
    for (const r of rows) {
      if (r.cost != null) grandCost += r.cost
      else if ((r.u.input || 0) + (r.u.output || 0) > 0) unpricedRows++
    }

    const onSortHeader = (key) => {
      if (sortBy === key) {
        setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
      } else {
        setSortBy(key)
        setSortDir(SORTS[key].dir)
      }
    }

    const Th = (i, cls, children, title, sortKey) => {
      const active = Boolean(sortKey) && sortBy === sortKey
      const arrow = active ? h('span', { style: { fontSize: '0.5rem' } }, sortDir === 'asc' ? '▲' : '▼') : null
      return h('th', {
        className: 'ts-th ' + cls,
        title,
        ...(sortKey ? { onClick: () => onSortHeader(sortKey) } : {}),
      }, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.125rem' } }, children, arrow))
    }

    const colW = [48, 14, 14, 13, 11]

    // ── Render ────────────────────────────────────────────────────────
    return h('div', { className: 'tsweb', title: `Token Stats ${VERSION} · Web-Port der Desktop-Pane` },
      // Header + history window selector
      h('div', { className: 'ts-head' },
        h('span', { className: 'ts-title' }, 'Token Stats'),
        h('div', { className: 'ts-headbtns' },
          ledger && !ledgerOk
            ? h('span', {
                className: 'ts-note',
                title: 'Ledger-Backend nicht erreichbar.\nBackend: ~/.hermes/plugins/token-stats/ (plugin_api.py)\nDaemon: systemctl status token-stats-ledger',
              }, 'Backend?')
            : null,
          sortBy === 'activity' && dayKeys.length > 0
            ? h('button', {
                type: 'button',
                className: 'tsbtn',
                title: allDaysCollapsed
                  ? 'Alle Tagesgruppen aufklappen'
                  : 'Alle Tagesgruppen zuklappen (Summenzeilen bleiben sichtbar)',
                onClick: () => {
                  const next = {}
                  // allDaysCollapsed → explicitly EXPAND every day
                  // (clearing the map would restore the default, which
                  // keeps non-today days collapsed); else collapse all.
                  for (const k of dayKeys) next[k] = !allDaysCollapsed
                  setCollapsedDays(next)
                },
              }, allDaysCollapsed ? '▸▸' : '▾▾')
            : null,
          ...RANGE_PRESETS.map(p => h('button', {
              type: 'button',
              className: 'tsbtn' + (p.key === range ? ' on' : ''),
              title: p.tip,
              onClick: () => setRange(p.key),
            }, p.label)),
        ),
      ),

      // Backend error card (fetch failed entirely — show a retry).
      ledger && !ledgerOk
        ? h('div', { className: 'ts-err' },
            'Ledger-Backend nicht erreichbar: ' + (ledger.error || 'unbekannter Fehler'),
            h('div', { className: 'retry' },
              h('button', {
                type: 'button', className: 'tsbtn tint',
                onClick: () => setReload(reload + 1),
              }, 'Erneut versuchen')),
            h('div', { style: { marginTop: '0.5rem', fontSize: '0.625rem' } },
              'Prüfen: systemctl status token-stats-ledger · Dashboard-Prozess muss das Plugin-Backend gemountet haben (Restart nach Deploy).'))
        : null,

      // Aggregate summary — column-aligned with the session table.
      ledgerOk
        ? h('div', { className: 'ts-card' },
            h('table', { className: 'tstable' },
              h('tbody', {},
                h('tr', { className: 'tsq' },
                  h('td', { style: { width: colW[0] + '%' } }, 'Total'),
                  h('td', { className: 'ts-num', style: { width: colW[1] + '%', fontWeight: 500 } }, fmt(grandInput)),
                  h('td', {
                    className: 'ts-num ts-acc', style: { width: colW[2] + '%', fontWeight: 500 },
                    title: grandCached > 0 && grandInput + grandCached > 0
                      ? `${fmtFull(grandCached)} of ${fmtFull(grandInput + grandCached)} prompt tokens served from cache (${Math.round(grandCached / (grandInput + grandCached) * 100)}%)`
                      : undefined,
                  }, fmt(grandCached)),
                  h('td', { className: 'ts-num', style: { width: colW[3] + '%', fontWeight: 500 } }, fmt(grandOutput)),
                  h('td', {
                    className: 'ts-num', style: { width: colW[4] + '%', fontWeight: 500 },
                    title: grandCost > 0
                      ? `Known-Ledger, monoton · Estimated: ${(grandCost * EUR_RATE).toFixed(2)} € (USD ${grandCost.toFixed(2)})${unpricedRows > 0 ? ` — ${unpricedRows} unpriced session(s) excluded` : ''}`
                      : 'Known-Ledger, monoton',
                  }, grandCost > 0
                    ? `${unpricedRows > 0 ? '≈ ' : ''}${(grandCost * EUR_RATE).toFixed(2)} €`
                    : '—'),
                ))))
        : null,

      // Cache-hit bar: visual share of cached vs. uncached prompt tokens.
      ledgerOk && grandInput + grandCached > 0
        ? h('div', { className: 'ts-card' },
            h('div', { className: 'ts-chlab' },
              h('span', { title: 'Anteil der Prompt-Tokens, die aus dem Prompt-Cache kamen (statt neu berechnet)' }, '⚡ Cache-Hit'),
              h('span', { title: `${fmt(grandCached)} von ${fmt(grandInput + grandCached)} Prompt-Tokens aus dem Cache` },
                Math.round(grandCached / (grandInput + grandCached) * 100) + '%')),
            h('div', { className: 'ts-chtrack' },
              h('div', { className: 'ts-chfill', style: { width: Math.min(100, grandCached / (grandInput + grandCached) * 100) + '%' } })))
        : null,

      // Mini histogram: tokens (or cost) per day. Skipped ONLY for the
      // 1d preset — other presets render even with a single bucket
      // (calendar windows legitimately span one day; geometry-based
      // hiding bit us once already on the desktop side).
      ledgerOk && rows.length > 0 && range !== 'day'
        ? h('div', { className: 'ts-hist' },
            h('div', { className: 'ts-chlab' },
              h('span', { title: 'Tages-Balken: Höhe relativ zum stärksten Tag im Fenster' },
                histMetric === 'cost' ? '€ pro Tag' : 'Tokens pro Tag'),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.125rem' } },
                h('button', {
                  type: 'button',
                  className: 'tsbtn' + (histMetric !== 'cost' ? ' tint' : ''),
                  title: 'Balkenhöhe = Tokens pro Tag',
                  onClick: () => setHistMetric('tokens'),
                }, '🪙'),
                h('button', {
                  type: 'button',
                  className: 'tsbtn' + (histMetric === 'cost' ? ' tint' : ''),
                  title: 'Balkenhöhe = geschätzte Kosten (PAYG-Äquivalent) pro Tag',
                  onClick: () => setHistMetric('cost'),
                }, '€'))),
            h('div', { className: 'ts-hbars' },
              histBuckets.map(b => {
                const v = histMetric === 'cost' ? b.cost : b.tokens
                const hgt = histMax ? Math.max(4, Math.round(v / histMax * 100)) : 0
                return h('div', {
                  className: 'ts-hcol',
                  key: b.key,
                  title: `${dayLabel(b.key)} · ${fmt(b.tokens)} Tokens · ≈ ${(b.cost * EUR_RATE).toFixed(2)} € · ${b.sessions} Sitzung${b.sessions === 1 ? '' : 'en'}`,
                }, h('div', {
                  className: 'ts-hbar',
                  style: {
                    height: (v === 0 ? 3 : hgt) + '%',
                    background: v === 0
                      ? 'color-mix(in srgb, var(--tsw-accent) 30%, transparent)'
                      : 'var(--tsw-accent)',
                  },
                }))
              })))
        : null,

      // Session list
      h('div', { className: 'ts-scroll' },
        !ledgerOk
          ? null
          : rows.length === 0
            ? h('div', { className: 'ts-empty' },
                h('div', { style: { fontSize: '1rem', marginBottom: '0.25rem' } }, '🌫️'),
                EMPTY_MSG[range] || 'No sessions')
            : h('table', { className: 'tstable' },
                h('thead', { className: 'ts-thead' },
                  h('tr', {},
                    Th(0, 'l', 'Session', 'Sortieren: letzte Aktivität', 'activity'),
                    Th(1, 'r', 'In', 'Sortieren: Input-Tokens', 'in'),
                    Th(2, 'r', '⚡', 'Sortieren: Cache-Reads · Cached input tokens', 'cached'),
                    Th(3, 'r', 'Out', 'Sortieren: Output-Tokens', 'out'),
                    Th(4, 'r', '💰', 'Sortieren: geschätzte Kosten · Estimated cost (client-side pricing table)', 'cost'))),
                h('tbody', {}, (() => {
                  // Day separators (with per-day totals) only in the
                  // default activity sort — any other sort interleaves
                  // days, separators would lie.
                  const showDays = sortBy === 'activity'
                  const out = []
                  let lastDay = null
                  const maxOut = sortedRows.reduce((m, r) => Math.max(m, r.u.output || 0), 0)
                  const dayAgg = {}
                  if (showDays) {
                    for (const row of sortedRows) {
                      if (row.lastActive == null) continue
                      const k = dayKeyTs(row.lastActive)
                      const a = dayAgg[k] || (dayAgg[k] = { in: 0, cached: 0, out: 0, cost: 0, unpriced: 0 })
                      a.in += row.u.input || 0
                      a.cached += row.u.cache_read || 0
                      a.out += row.u.output || 0
                      if (row.cost != null) a.cost += row.cost
                      else if ((row.u.input || 0) + (row.u.output || 0) > 0) a.unpriced++
                    }
                  }
                  for (const row of sortedRows) {
                    if (showDays && row.lastActive != null) {
                      const key = dayKeyTs(row.lastActive)
                      if (key !== lastDay) {
                        lastDay = key
                        const a = dayAgg[key]
                        const daySessions = sortedRows.filter(r => r.lastActive != null && dayKeyTs(r.lastActive) === key).length
                        const isCollapsed = isDayCollapsed(key)
                        out.push(h('tr', {
                          className: 'ts-day',
                          key: 'day-' + key,
                          onClick: () => toggleDayCollapse(key),
                          title: `${dayLabel(key)} — ${fmtFull(a.in)} in · ${fmtFull(a.cached)} ⚡ · ${fmtFull(a.out)} out${a.cost > 0 ? ` · ${(a.cost * EUR_RATE).toFixed(2)} €` : ''}\n${isCollapsed ? 'Aufklappen' : 'Zuklappen'} (${daySessions} Sitzung${daySessions === 1 ? '' : 'en'})`,
                        },
                          h('td', { className: 'dl' },
                            h('span', { style: { display: 'inline-block', width: '0.5rem', marginRight: '0.25rem', fontSize: '0.5rem' } }, isCollapsed ? '▸' : '▾'),
                            dayLabel(key),
                            isCollapsed ? h('span', { style: { marginLeft: '0.25rem', fontWeight: 400 } }, `(${daySessions})`) : null),
                          h('td', { className: 'ts-num', title: `Input gesamt: ${fmtFull(a.in)}` }, fmt(a.in)),
                          h('td', { className: 'ts-num ts-acc', title: `Cache-Reads gesamt: ${fmtFull(a.cached)}` }, fmt(a.cached)),
                          h('td', { className: 'ts-num', title: `Output gesamt: ${fmtFull(a.out)}` }, fmt(a.out)),
                          h('td', {
                            className: 'ts-num',
                            title: a.cost > 0
                              ? `Geschätzt: ${(a.cost * EUR_RATE).toFixed(2)} € (USD ${a.cost.toFixed(2)})${a.unpriced > 0 ? ` — ${a.unpriced} unbepreis${a.unpriced === 1 ? 'te Sitzung' : 'te Sitzungen'} ausgeschlossen` : ''}`
                              : 'Keine Kosten für diesen Tag',
                          }, a.cost > 0
                            ? `${a.unpriced > 0 ? '≈ ' : ''}${(a.cost * EUR_RATE).toFixed(2)} €`
                            : '—')))
                      }
                    }
                    // Skip session rows of collapsed day groups
                    if (showDays && row.lastActive != null && isDayCollapsed(dayKeyTs(row.lastActive))) continue
                    const u = row.u
                    const cached = u.cache_read || 0
                    const cost = row.cost
                    const modelTip = row.modelRows.length
                      ? '\nModelle: ' + row.modelRows
                          .map(m => `${m.model}${m.task ? ' (' + m.task + ')' : ''}: in ${fmt(m.input_tokens)}, ⚡ ${fmt(m.cache_read_tokens)}, out ${fmt(m.output_tokens)}`)
                          .join(' · ')
                      : ''
                    const resetTip = row.hadReset
                      ? '\n⚠ DB-Reset erkannt — Werte aus dem Known-Ledger (monoton)'
                      : ''
                    const ledgerOnlyTip = row.ledgerOnly
                      ? '\n● Nur im Ledger (Session aus state.db gelöscht)'
                      : ''
                    const outBar = maxOut > 0 && (u.output || 0) > 0
                      ? h('div', {
                          className: 'ts-outbar',
                          style: { width: Math.max(4, (u.output / maxOut) * 100) + '%' },
                        })
                      : null
                    out.push(h('tr', { className: 'ts-tr', key: row.id },
                      h('td', {
                        className: 'ts-tdl',
                        title: (row.title || row.id) + (row.lastActive ? ` (${fmtDate(row.lastActive)})` : '') + resetTip + ledgerOnlyTip + modelTip,
                      },
                        row.hadReset
                          ? h('span', { style: { color: '#f59e0b', marginRight: '0.25rem' }, title: 'DB-Reset/Anomalie im Ledger verzeichnet — known-Werte bleiben monoton' }, '⚠')
                          : null,
                        row.ledgerOnly
                          ? h('span', { className: 'ts-dim', style: { marginRight: '0.25rem' }, title: 'Nur im Ledger (aus state.db gelöscht)' }, '●')
                          : null,
                        row.title || row.id.slice(0, 12)),
                      h('td', { className: 'ts-num' }, fmt(u.input || 0)),
                      h('td', {
                        className: 'ts-num',
                        title: cached > 0 ? `Cached: ${fmtFull(cached)}` : undefined,
                      }, cached > 0
                        ? h('span', { className: 'ts-acc' }, fmt(cached))
                        : h('span', { className: 'ts-dim' }, '—')),
                      h('td', {
                        className: 'ts-num ts-outcell',
                        title: maxOut > 0 ? `Output relativ zur größten Session (${fmt(maxOut)})` : undefined,
                      }, outBar, h('span', { style: { position: 'relative', zIndex: 1 } }, fmt(u.output || 0))),
                      h('td', {
                        className: 'ts-num ts-dim',
                        title: cost != null
                          ? `Estimated: ${(cost * EUR_RATE).toFixed(2)} € (USD ${cost.toFixed(4)})${modelTip}`
                          : 'No price for ' + (u.model || 'this model'),
                      }, cost != null
                        ? (cost * EUR_RATE).toFixed(2) + ' €'
                        : '—')))
                  }
                  return out
                })()))),

      // Per-model breakdown (footer toggle) — compact total-token rows
      // with relative size bars, breakdown in the tooltip.
      modelOpen && ledgerOk && modelAggList.length > 0
        ? h('div', { className: 'ts-brkwrap' },
            h('div', { className: 'ts-brkhead' },
              h('span', { className: 'up' }, 'Modelle'),
              h('span', {} , `${modelAggList.length} Modell${modelAggList.length === 1 ? '' : 'e'}`)),
            h('div', { className: 'ts-brklist' },
              modelAggList.map(m => {
                const total = m.in + m.cached + m.out
                const mCost = m.cost > 0 ? (m.cost * EUR_RATE).toFixed(2) + ' €' : null
                const tip = m.sessions.size === 1 ? '1 Sitzung' : `${m.sessions.size} Sitzungen`
                const bar = maxModelTotal > 0 && total > 0
                  ? h('div', { className: 'ts-brkbar', style: { width: Math.max(4, total / maxModelTotal * 100) + '%' } })
                  : null
                return h('div', {
                  className: 'ts-brkrow',
                  key: m.model,
                  title: `${m.model}\nIn: ${fmtFull(m.in)} · ⚡: ${fmtFull(m.cached)} · Out: ${fmtFull(m.out)}\nGesamt: ${fmtFull(total)} Tokens · Calls: ${fmtFull(m.calls)} · ${tip}${mCost != null ? ` · Geschätzt: ${(m.cost * EUR_RATE).toFixed(2)} € (USD ${m.cost.toFixed(2)})` : (m.unpriced ? ' · kein Preis' : '')}`,
                },
                  bar,
                  h('div', { className: 'ts-brkname' },
                    h('span', { className: 'nm' }, m.model),
                    h('span', { className: 'mt' }, tip)),
                  h('div', { className: 'ts-brknum' },
                    h('span', { title: `Gesamttokens: ${fmtFull(total)}` }, fmt(total)),
                    h('span', { className: 'eur' }, mCost != null ? (m.unpriced ? '≈ ' : '') + mCost : '—')))
              })))
        : null,

      // Subagent breakdown (footer toggle)
      subOpen && ledgerOk && subRows.length > 0
        ? h('div', { className: 'ts-brkwrap' },
            h('div', { className: 'ts-brkhead' },
              h('span', { className: 'up' }, 'Subagenten'),
              h('span', {}, `${subRows.length} Subagent${subRows.length === 1 ? '' : 'en'}`)),
            h('div', { className: 'ts-brklist' },
              subRows.map(sr => {
                const total = sr.in + sr.cached + sr.out
                const bar = maxSubTotal > 0 && total > 0
                  ? h('div', { className: 'ts-brkbar', style: { width: Math.max(4, total / maxSubTotal * 100) + '%' } })
                  : null
                return h('div', {
                  className: 'ts-brkrow',
                  key: sr.id,
                  title: `${sr.title}\n${sr.id}${sr.parent ? `\nParent: ${sr.parent}` : ''}\nIn: ${fmtFull(sr.in)} · ⚡: ${fmtFull(sr.cached)} · Out: ${fmtFull(sr.out)}\nGesamt: ${fmtFull(total)} Tokens · Calls: ${fmtFull(sr.calls)}`,
                },
                  bar,
                  h('div', { className: 'ts-brkname' },
                    h('span', { className: 'nm' }, sr.title),
                    sr.parent ? h('span', { className: 'mt' }, '↳ Parent') : null),
                  h('div', { className: 'ts-brknum' },
                    h('span', { title: `Gesamttokens: ${fmtFull(total)}` }, fmt(total)),
                    h('span', {
                      className: 'eur',
                      title: sr.cost > 0 ? `Geschätzte Kosten: ${(sr.cost * EUR_RATE).toFixed(2)} € (USD ${sr.cost.toFixed(2)})` : undefined,
                    }, sr.cost > 0 ? (sr.unpriced ? '≈ ' : '') + (sr.cost * EUR_RATE).toFixed(2) + ' €' : '—')))
              })))
        : null,

      // Aux-task breakdown (footer toggle)
      auxOpen && ledgerOk && auxAggList.length > 0
        ? h('div', { className: 'ts-brkwrap' },
            h('div', { className: 'ts-brkhead' },
              h('span', { className: 'up' }, 'Aux-Tasks'),
              h('span', {}, `${auxAggList.length} Task${auxAggList.length === 1 ? '' : 's'}`)),
            h('div', { className: 'ts-brklist' },
              auxAggList.map(a => {
                const total = a.in + a.cached + a.out
                const tip = a.sessions.size === 1 ? '1 Sitzung' : `${a.sessions.size} Sitzungen`
                const bar = maxAuxTotal > 0 && total > 0
                  ? h('div', { className: 'ts-brkbar', style: { width: Math.max(4, total / maxAuxTotal * 100) + '%' } })
                  : null
                const modelTip = a.models.size > 1
                  ? '\nModelle: ' + [...a.models.entries()]
                      .map(([mo, v]) => `${mo}: in ${fmt(v.in)}, ⚡ ${fmt(v.cached)}, out ${fmt(v.out)}`)
                      .join(' · ')
                  : ''
                return h('div', {
                  className: 'ts-brkrow',
                  key: a.task,
                  title: `${auxLabel(a.task)} (${a.task})\nIn: ${fmtFull(a.in)} · ⚡: ${fmtFull(a.cached)} · Out: ${fmtFull(a.out)}\nGesamt: ${fmtFull(total)} Tokens · Calls: ${fmtFull(a.calls)} · ${tip}${a.cost > 0 ? ` · Geschätzt: ${(a.cost * EUR_RATE).toFixed(2)} € (USD ${a.cost.toFixed(2)})${a.unpriced ? ' (≈ — unpriced Rows ausgeschlossen)' : ''}` : ''}${modelTip}`,
                },
                  bar,
                  h('div', { className: 'ts-brkname' },
                    h('span', { className: 'nm' }, auxLabel(a.task)),
                    h('span', { className: 'mt' }, tip)),
                  h('div', { className: 'ts-brknum' },
                    h('span', { title: `Gesamttokens: ${fmtFull(total)}` }, fmt(total)),
                    h('span', {
                      className: 'eur',
                      title: a.cost > 0 ? `Geschätzte Kosten: ${(a.cost * EUR_RATE).toFixed(2)} € (USD ${a.cost.toFixed(2)})` : undefined,
                    }, a.cost > 0 ? (a.unpriced ? '≈ ' : '') + (a.cost * EUR_RATE).toFixed(2) + ' €' : '—')))
              })))
        : null,

      // Footer: session/model counts + active calendar window.
      ledgerOk
        ? h('div', { className: 'ts-foot' },
            `${rows.length} Sitzung${rows.length === 1 ? '' : 'en'} · `,
            h('button', {
              type: 'button',
              className: 'tslink' + (modelOpen ? ' on' : ''),
              title: modelOpen
                ? 'Modell-Liste zuklappen'
                : 'Modell-Liste aufklappen (auf- und absteigend über das aktive Fenster)',
              onClick: () => setModelOpen(!modelOpen),
            }, `${modelAggList.length} Modell${modelAggList.length === 1 ? '' : 'e'}`),
            subRows.length > 0
              ? [' · ',
                 h('button', {
                   type: 'button',
                   className: 'tslink' + (subOpen ? ' on' : ''),
                   title: subOpen
                     ? 'Subagenten-Liste zuklappen'
                     : 'Subagenten-Liste aufklappen (delegierte Tasks im aktiven Fenster)',
                   onClick: () => setSubOpen(!subOpen),
                 }, `${subRows.length} Subagent${subRows.length === 1 ? '' : 'en'}`)]
              : null,
            auxAggList.length > 0
              ? [' · ',
                 h('button', {
                   type: 'button',
                   className: 'tslink' + (auxOpen ? ' on' : ''),
                   title: auxOpen
                     ? 'Aux-Task-Liste zuklappen'
                     : 'Aux-Task-Liste aufklappen (Auxiliary-Calls: Hintergrund-Review, Kompression, Vision, Titel, Approval — im aktiven Fenster)',
                   onClick: () => setAuxOpen(!auxOpen),
                 }, `${auxAggList.length} Aux-Task${auxAggList.length === 1 ? '' : 's'}`)]
              : null,
            ` · ${windowLabel(range)}`)
        : null,
    )
  }

  // ── Register with the dashboard host ────────────────────────────────
  if (window.__HERMES_PLUGINS__ && window.__HERMES_PLUGINS__.register) {
    window.__HERMES_PLUGINS__.register(ID, TokenStatsWeb)
  } else {
    console.warn('[token-stats] __HERMES_PLUGINS__.register unavailable — SDK host mismatch')
  }
})()
