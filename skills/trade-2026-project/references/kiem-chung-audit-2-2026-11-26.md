# Kiểm-chung audit round 2 — Trade.2026 (26/11/2026)

Scope: full re-audit of main @ `604b3dd` ("auto: cap nhat lich kinh te 2026-11-26 13:13", APP_VERSION 2.17.5) against the verified audit of 06/11/2026 (v2.17.2, 63 findings), plus review of everything landed since (F liq feed `dc27591`, learn.js propose-only `79bc1ab`, Derivs funding/OI `1ca9ec9`, W3 window-logic `659ab25`, economic-calendar script), plus real test runs. Companion document: `ARCHITECTURE.md` (repo root, same snapshot).

Method: every old finding re-checked against current code by grep/read (no reuse of old line numbers); every new claim in this file carries a current `file:line` or a command result. Report only — **no code changed, nothing pushed, nothing deployed** (per instruction).

Constraints honored: Linode 24/7 untouched; main not modified; no PAT handling; no signal-rule/verdict/journal changes; learn.js left propose-only; data-branch caps untouched; journal numbers below come only from the journal file itself (source stated); WhatsApp outbox untouched.

---

## Part A — Recheck of the 63 findings from 06/11

Tally at `604b3dd`:

| Status | Count | IDs |
|---|---|---|
| Fixed since 06/11 (Đợt 0+1, v2.17.3→2.17.5) | **14** | L-01 L-02 L-03 L-04 L-05 L-06 L-08 L-09 L-10 L-12 L-14 P-01 P-02 S-10 |
| Still present, unchanged | **38** | S-01…S-09, D-02 D-03 D-04 D-05 D-06 D-07 D-08 D-09, L-15 L-16 L-17 L-18 L-19 L-20 L-21, P-04 P-05 P-07 P-08 P-09 P-10 P-11, Q-02 Q-03 Q-04 Q-05 Q-06 Q-07 Q-10 |
| Partially correct then, still partial now | **6** | L-11 P-03 P-06 Q-08 Q-09 Q-11 |
| Superseded by code growth | **1** | Q-01 |
| Old verdict stands (not bugs) | **2** | L-07 (deliberate), L-13 (false) |
| Pending user decision | **1** | D-01 |
| Judged wrong by your own verification — agreed | **1** | P-12 |

### A.1 Fixed — verified in current code (14)

| ID | Finding (06/11) | Evidence now |
|---|---|---|
| L-01 | SL/TP wrong side → fake profit | `rrCoDau` + `bracketHopLe` guards, `bot.js:233-310` |
| L-02 | Position-ID collision | `randomUUID`, `bot.js:69-72` |
| L-03 | No notional/quotity check | `notionalMax`, `bot.js:36-41` |
| L-04 | rr1 ignores liquidation | `rr1` `engine.js:156` + rrLiq gate `engine.js:218-220` |
| L-05 | Limit order pending state untracked | `datLenhCho` pending state, `order.js:364-372` |
| L-06 | Spot slot mapped onto perp theo | `SLOT_THEO_SAN` perp map, `datahub-bridge.js:61` |
| L-08 | Session start-time drift | `startTime` normalization, `journal.js:159-170` |
| L-09 | POI chosen without side filter | `chonPOI` `dungPhia`, `smc.js:257-284` |
| L-10 | Alert fires before ready | `alert_ready` gate, `engine.js:406` |
| L-12 | Close assumed at SL price | closes at tick price, `bot.js:396-398` |
| L-14 | Liquidation contrarian unhandled | `LIQ_CONTRARIAN` config, `config.js:86-96` (your decision #2 still open on keep/tune/off) |
| P-01 | WS reconnect storm | guard, `datahub.js:107-124` |
| P-02 | Double subscribe | `exchanges.js:193` |
| S-10 | XSS both roles | escaped, `screens2.js:848` |

### A.2 Still present — unchanged (38)

| ID | Finding | Evidence now |
|---|---|---|
| S-01 | PAT in browser | `Authorization: Bearer` + PAT, `bridge.js:84` — your decision #1 |
| S-02 | LLM keys in localStorage | `aichat.js:90-93` |
| S-03 | Third-party script, no SRI | tesseract from jsdelivr, `advisor.js:66` |
| S-04 | No CSP | no CSP meta/header anywhere; `vercel.json` absent |
| S-05 | `/api/ai-proxy` open relay | no origin/rate/limit check in `api/ai-proxy.js` (grep empty) |
| S-06 | Hash `coin` param unsanitized | `screens.js:346` no regex; `exchanges.js:16` interpolates `sym` without `encodeURIComponent` |
| S-07 | Calendar via public CORS proxies | `config.js:58-62` allorigins/codetabs/corsproxy; jina tier-0 `calendar.js:65-68,137` |
| S-08 | Signals public on GitHub | `data/browser-signals.json` committed to main (3,800 B); `bridge.js:14` |
| S-09 | Worker ORIGINS wrong owner, no rate limit | `tools/proxy/cloudflare-worker.js:24-28` still `mrbit4578.github.io` (repo is `hayhahen-ui`), no rate limit |
| D-02 | Repo/owner hardcoded | `bridge.js:14` + 7 more spots (old audit list) |
| D-03 | AI proxy 404 off Vercel | relative `/api/ai-proxy` `aichat.js:234`; `AI_PROXY_URL` declared in config, used nowhere |
| D-04 | Calendar workflow no concurrency | `.github/workflows/update-calendar.yml` has no `concurrency:` block |
| D-05 | README stale | `README.md:1` still "v2.0.0" vs `config.js:6` 2.17.5 |
| D-06 | No CI runs tests | 6 workflows exist (see N-5), none runs a test |
| D-07 | No vercel.json / package.json | both absent (ls confirmed) |
| D-08 | Missing times → 00:00 UTC | `tools/update_calendar.py:234-236` still `datetime.min.time()` |
| D-09 | Big data in main | `data/` = 1,726,709 B (~1.73 MB) |
| L-15 | Safety check stale at fire | `kiemTraAnToanLenh` `order.js:262` returns items without storing `giaLuc`/`luc`; no re-check at confirm |
| L-16 | Liq price estimate too rough | `order.js:87-88` `entry*(1-0.95/lev)`, one formula for cross+isolated |
| L-17 | Numeric input accepts ≤0/negatives | `order.js:158` `+e.target.value || t[key]` |
| L-18 | Day counting uses machine TZ | `journal.js:139-140` local `getFullYear/getMonth/getDate`, not `Asia/Ho_Chi_Minh` |
| L-19 | Leveraged-token filter catches real coins | `exchanges.js:96` `/(UP|DOWN|BULL|BEAR)$/` still filters JUP/SYRUP-class names |
| L-20 | `smaSeries` wrong around nulls | `ta.js:29-40` |
| L-21 | RSI thresholds inconsistent | `engine.js:223-224` 70/30 vs `ta.js:216` 80/20 (signal-rule change to unify → decision list) |
| P-04 | Klines refetched every cycle | `engine.js:29-31` 3× `fetchKlines` per coin per pass; no cache (heatmap has one) |
| P-05 | flowWindow computed twice | `flowdb.js:409-412` inside `flowScore` + `engine.js:256` |
| P-07 | Every log() serializes whole state | `bot.js:53-58` |
| P-08 | Cap reached → silent stop-write | `journal.js:25-30` `_max` 300, `_hetBoNho` flag (your 26/09 policy — changing it is your call) |
| P-09 | Scan interval never refreshed | `app.js:194` one-shot `setInterval`, handle dropped |
| P-10 | jina data always stamped "fresh" | `calendar.js:163` `generatedAt = now()` |
| P-11 | Score-mark timestamped before the run | `app.js:92-98` |
| Q-02 | Harness reads files outside repo | `tools/harness_v2.js:1450,1452,1540,1542` `/home/hatch/...` (see N-1) |
| Q-03 | UI files monolithic | `screens.js` 955 lines, `screens2.js` 856 |
| Q-04 | Helper duplication | `el` `utils.js:67` vs `e` `datahub-ui.js:23`; `getJson` `datahub.js:139`; `ghiNhan`/`ghiNhanGiay` `journal.js:88`; 4+ time formatters |
| Q-05 | Empty catch blocks | **109 empty of 172 catch blocks** (reproduced with the same multi-line-aware count as 06/11) |
| Q-06 | Version mismatch | `README.md:1` v2.0.0 vs 2.17.5; `?v=` drift (8 distinct strings, `learn.js?v=2.1.0` although added 21/11) |
| Q-07 | Docs promise what code doesn't do | `flowdb.js:12` "keeps 7 days, auto-cleans" — cleanup is manual-only |
| Q-10 | CSV export unescaped | `bot.js:489-494` `rows.map(r=>r.join(","))`, no quoting |

### A.3 Partial then, partial now (6)

| ID | Note |
|---|---|
| L-11 | Forming-candle: pivot/sweep/CHoCH confirmed-only since v2.17.1 (`smc.js:170` A11 comment); residual forming-candle uses remain elsewhere |
| P-03 | Tab-hidden stops DataHub after 5-min grace — deliberate power-saving (`datahub-bridge.js:149-150`), but collection still dies with the tab |
| P-06 | Bybit path still un-throttled (`datahub.js:276` condition unchanged) |
| Q-08 | Dead code: `escapeHtml` `utils.js:81` 0 callers, `SIRO_VERSION` unused — 3/4 of the original claims held |
| Q-09 | Model lists hardcoded in `AI_PROVIDERS` `aichat.js:19-73`; "outdated models" part was overstated then, still is |
| Q-11 | Identifier style (Vietnamese no-diacritics mixed with English) — real as a style fact, the diacritics claim itself was wrong |

### A.4 Superseded / verdict-unchanged / pending / wrong

- **Q-01 (superseded):** the 28-vs-29 script-tag dispute is moot — `index.html` now has exactly 29 `<script src>` tags.
- **L-07:** 15-minute scoring is deliberate design (`journal.js:20-22` `_hanGio: 0.25`) — not a bug, unchanged.
- **L-13:** heatmap does not add/subtract score (`engine.js:294-320` only sets `canhBao` and plan TP) — false then, false now.
- **D-01:** station 24/7 + WhatsApp still not reproducible from the repo — 🔶 pending your decision #3. Note N-4 makes this worse (calendar pipeline now lives entirely outside the repo).
- **P-12:** agreed with your verification — not a code defect. Current code has the TE iframe (`calendar.js:366`) **and** the TradingView-widget fallback (`calendar.js:373-374`); the original claim described normal embed behaviour, nothing to fix.

---

## Part B — Review of code landed since 06/11

All clean; no blocking defects found.

1. **F liq feed — `tools/liq-feed.js` (173 lines, station-only).** Loaded only by `tools/collector-247.js` into the Actions VM; mirrors `datahub.js` semantics faithfully. Minor notes (N-3): expects uppercase `side`; an empty liquidation store yields silent zeros rather than "no data".
2. **learn.js propose-only — verified for real.** `LEARN_AUTO_APPLY=false` is a hard const; proposal objects default `active:false`; `dieuChinhKienThuc` returns `delta:0` — nothing in the propose path mutates weights or verdict thresholds. Constraint "keep propose-only" is satisfied by the code as it stands.
3. **Derivs scoring `tinhDiemDerivs` (commit `1ca9ec9`).** Funding normalized `/0.05` capped ±1; OI uses a 0.5% noise floor; returns null when both inputs missing (no fabricated score). Clean.
4. **W3 window-logic guards (`659ab25`).** Present in all 4 consumer files; `flowdb.js:370-377` filters with `from:/to:` bounds. Tests cover it (Part D).
5. **RAG_WEIGHTS** sum exactly 1.00 including derivs 0.10 — arithmetic checked.
6. **Calendar Linode fallback** (`tools/calendar-linode-fallback.sh` + `tools/update_calendar.py`): staleness gate ≥7h, detached-worktree push, pushes **main** up to 4×/day → new finding N-4.

---

## Part C — New findings (this round)

- **N-1 — Harness is machine-bound (high).** `tools/harness_v2.js:1450-1456` and `:1540-1542` read `/home/hatch/hooks/scripts/trade2026-signal-whatsapp.sh` and `/home/hatch/hooks/definitions/trade2026-signal-whatsapp.json` — absolute paths on your laptop. Here it crashes `ENOENT` at `:1450` after **99 pass / 0 fail across sections [1]–[26]**; the claimed 663-pass baseline is **not reproducible outside your machine**. Fix is cheap: `fs.existsSync` guard + bundled stub, then a CI job (see Part E).
- **N-2 — Station write is not atomic (low).** `tools/collector-247.js:96` `writeFileSync` straight onto the working file; a bridge pull landing mid-write sees torn JSON. Bridge degrades gracefully (last-good), but tmp+rename is the correct pattern.
- **N-3 — liq-feed minor notes (info).** Uppercase-`side` reliance; empty store → silent zeros (see B.1).
- **N-4 — Calendar pipeline moved fully outside the repo (medium).** `update-calendar.yml` schedule is commented out (comment cites 3 failed manual runs #186/#187/#188 — TE blocks GitHub-host egress); the only writer left is the external Linode cron, pushing **main** 4×/day. Consequences: main-branch churn + D-09 growth + D-01 worsened (a repo clone no longer reproduces the calendar feed at all).
- **N-5 — Workflow count grew, test coverage didn't (medium).** Six workflows now (`station-247, station-bridge, station-sender, station-skill-5m, station-snapshot, update-calendar`); none runs a test. D-06's substance is unchanged at larger scale.

---

## Part D — Tests run for real (this machine, 26/11)

| Suite | Result | Exit |
|---|---|---|
| `node tools/test-liq-feed.js` | 43 pass / 0 fail | 0 |
| `node tools/test-window-logic.js` | 23 pass / 0 fail | 0 |
| `node tools/test-derivs-rag.js` | 29 pass / 0 fail | 0 |
| `node tools/test-learn-propose-only.js` | 24 pass / 0 fail | 0 |
| `node tools/harness_v2.js` | 99 pass / 0 fail through section [26], then **crash** `ENOENT` at `harness_v2.js:1450` (N-1) | non-zero |

The four new suites pass cleanly. The harness result is **not** a full pass — it died at the WhatsApp-hook section before completing; the 663 baseline cannot be confirmed here.

---

## Part E — Kaizen plan (proposal only)

Targets: **(a)** warn earlier — catch reversal/risk before the signal fires; **(b)** less latency — engine signal → user; **(c)** most accuracy — fewer bad signals.

Measured baseline for (b)/(c), from the journal file itself (source: `data/data/journal-247.json` on the data branch, fetched 2026-11-26 06:43 UTC, 58,365 B): 144 signals total, 139 resolved, 57 wins, 82 losses, 114 stopped-early, winRate 41%, expectancy −0.33R; per-record (n=115 with numeric r): **zero signals reached +2R**, 114/115 below +1R, avg realized r −0.06R, netR avg −0.32R (worst −6.56R), mean adverse excursion 0.32R, price-slippage proxy 0.22R (n=97). Outcome-pipeline latency from journal timestamps: signal→first scan median 858 s (~14 min), scan→priced outcome median 944 s (~16 min), total median 1,801 s (~30 min), worst 46,806 s (~13 h). Your separately tracked numbers (detection ~52 min, scan ~7 min, delivery ~2 min; 76% RR<2, 37% RR<1, slippage 0.44R) cover a different window/ledger and are not conflated with these.

### E.1 — Fix now, no new decisions needed

| # | Fix | Serves | Old/new ID |
|---|---|---|---|
| 1 | CI workflow: run the 4 test suites + harness with an `fs.existsSync` guard/stub on every push | a, c | N-1, N-5, D-06 |
| 2 | Unify `?v=` cache-bust (one version, or drop params) | c | Q-06 |
| 3 | Deduplicate flowWindow (compute once, pass down) | b | P-05 |
| 4 | Store + refresh scan interval handle | b | P-09 |
| 5 | Klines cache (60 s TTL, like heatmap's) | b | P-04 |
| 6 | `generatedAt` = data time, not fetch time | a | P-10 |
| 7 | Score-mark timestamp after the run completes | a | P-11 |
| 8 | Debounce `_save()` (e.g. 2 s trailing) | b | P-07 |
| 9 | CSV quoting/escaping in `xuatCSV` | c | Q-10 |
| 10 | Validate numeric inputs (> 0, reject negatives) | c | L-17 |
| 11 | Fix `smaSeries` null-window math | c | L-20 |
| 12 | TZ-safe day keys (`Asia/Ho_Chi_Minh`) | c | L-18 |
| 13 | Re-run safety check at confirm with stored `giaLuc`/`luc` | c | L-15 |
| 14 | Liq estimate: maintenance-margin tiers instead of flat 5% | c | L-16 |
| 15 | Replace empty catches in engine/rag/bot/order paths with logged catches | a | Q-05 (subset) |
| 16 | CSP `<meta>` tag (report-only/default-src self) | security | S-04 (partial) |
| 17 | ai-proxy: origin allowlist (`trade-2026-tau.vercel.app` + localhost) + per-IP rate limit | security | S-05 |
| 18 | Atomic station writes (tmp + rename) | integrity | N-2 |
| 19 | README version + workflow-count corrections | hygiene | D-05, Q-06, Q-07 |

### E.2 — Needs your decision (nothing auto-changed)

1. **PAT out of the browser (S-01)** — your pending decision #1. Options: serverless bridge holding the PAT; private repo + fine-grained read-only token; move bridge writes to Supabase upsert. Each trades off simplicity vs. blast radius.
2. **L-14 LIQ_CONTRARIAN** — keep as-is / tune thresholds / disable. Your pending decision #2.
3. **Station 24/7 into the repo (D-01)** — your pending decision #3; N-4 raises the stakes (calendar already unreproducible from repo).
4. **Đợt 1 vs Đợt 1+2 of the 06/11 audit plan** — your pending decision #4.
5. **RWUSD** — add symbols (RWUSD, USDS, BFUSD, U) vs minimal risk floor 14/28 bps. Your pending decision #5.
6. **Latency directions (b)** — the 5 directions proposed 11/11 remain unchosen (not in this repo; I did not guess their content). Repo-visible levers if useful: cron 5 min → 1 min or `repository_dispatch` event-driven runs; bridge poll interval; the new `station-sender.yml` path for delivery; Supabase Realtime channel instead of polling.
7. **L-21 unify RSI thresholds** — changes verdicts → signal-rule change, needs your approval.
8. **L-19 leveraged-token filter (catches JUP-class)** — changes which symbols can signal → needs your approval.
9. **vercel.json security headers** — deploy-behaviour change, needs your approval.
10. **P-08 journal cap policy** — your 26/09 stop-write policy is deliberate; changing rotation behaviour is yours to decide.

---

## Part F — Discrepancies and data-source notes

1. **Three tallies, one corpus.** Old file's own column: 52✅/8⚠️/1🔶/2❌. Your verification note: 49 fully correct / 13 partial / 1 wrong (P-12). My recount above (rule stated in the table): 14 fixed / 38 present / 6 partial / 1 superseded / 2 verdict-unchanged / 1 pending / 1 judged-wrong. The differences are boundary classifications (e.g. whether "deliberate design" counts as correct, whether style-partials count as partial), not contradictions about any specific finding except P-12, where I side with your verification.
2. **P-12** — judged wrong by you; current code confirms (iframe + fallback both present). Closed as not-a-defect.
3. **Q-05 count** — 109 empty catches reproduced exactly (of 172 catch blocks); an earlier working note of "27" was a single-line-only count and is wrong.
4. **L-18 definition corrected** — it is the machine-TZ day-count issue (`journal.js:139-140`); an intermediate note mapping it to `config.js:42-44` `swingL` was wrong; `swingL` 3/4/5 is the TIMEFRAMES config, a different thing.
5. **S-06 / S-09 reclassified** — intermediate notes had them "partial"; current code shows both unchanged (`screens.js:346` + `exchanges.js:16`; `cloudflare-worker.js:24-28` still `mrbit4578`) → still present.
6. **Harness baseline** — 663 pass not reproducible here (N-1); 99/0-before-crash is what actually runs.
7. **Journal source** — all Part E baseline numbers come from `data/data/journal-247.json` (data branch, fetched 2026-11-26 06:43 UTC). Your three hand-ledger versions (134/−41.02R; 114/−34.79R; 132/−40.53R) disagree with each other and with the file (144/139 resolved); per your instruction only the file's numbers are used, and the ledger reconciliation remains open on your side.
