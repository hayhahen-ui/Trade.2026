# Trade.2026 — Nháhn ngoai lé (exception branch, tier B) — guide

Date: 26/11/2026 · Status: built + tested, **default OFF** · Scope: tier (B) heads-up + đđng nhank ONLY — tier (A) auto-action is deliberately NOT built.

---

## 1. What this is (and is not)

- **(B) heads-up only.** When ≥3 coins move ≥1% in the same 15m candle (or ≥0.6% in one 1m candle — đđng nhank), the branch sends a heads-up message. It never places orders, never sizes tickets, never touches nháhn main state.
- **No auto-action (A).** The branch's only import graph is itself: `watcher.js` requires `gate/news/message/notify/log/paths` and nothing else (exception/watcher.js:12-19) — no `order.js`, no `bot.js`, no `bridge.js`.
- **Default OFF.** `EXCEPTION_ENABLED: false` in exception/config.json:3. Env `EXCEPTION_ENABLED=true|false|1|0` overrides the file for a systemd-style toggle (watcher.js:26-27); `isEnabled()` (watcher.js:31-33) is checked **before any fetch or write** — off = the module sleeps and nháhn main is untouched.
- **Writes confined to `exception/logs/`** (heads-up.jsonl, watcher-state.json, pending-alerts.jsonl, outbox-wa-pending.json). The only repo file it reads is `data/economic_calendar_data.json` (calendar, read-only, config.json `paths.calendar`).

## 2. Case-study calibration — real night 25/11 → 26/11/2026 (VN time, OKX 15m)

Fixture: `exception/testdata/case-night-15m-okx.json` — 100 × 15m OKX candles per BTC/ETH/SOL, 00:30 25/11 → 01:15 26/11 VN, `ts` in epoch **seconds** (tests multiply ×1000, tools/test-exception.js:59). Key bars: idx 80=20:30, 84=21:30, 85=21:45, 94=00:00.

| VN time | Bars | BTC / ETH / SOL chg | vol × | Gate | Why |
|---|---|---|---|---|---|
| 20:30 25/11 | idx 80 | −0,96 / −1,09 / −1,35 | ×4,39 / ×8,20 / ×6,58 | **no fire** | only 2 of 3 coins cross \|1%\| (BTC −0,96 sub-threshold) → `minCoins 3` unmet (`no-sync`) |
| 21:30 25/11 | idx 84 | −1,37 / −1,44 / −1,48 (avg −1,43) | spike 3/3 | **FIRE DOWN** | 3-coin sync + 5 ★★★ news within ±60 ph (GDP Q3 QoQ, Core PCE…) — the calibration fire |
| 21:45 25/11 | idx 85 | +1,49 / +2,19 / +2,24 (avg +1,97) | spike 3/3 | **FIRE UP** | reversal. Cooldown is per-direction, so the opposite direction is always allowed (gate.js:95-101) — the real night's whipsaw (SHORT 21:07, SHORT 22:52 → het_han, net −0,16R / −0,33R) becomes a visible V-flip in the heads-up instead of a blind re-short |
| 00:00 26/11 | idx 94 | +1,09 / +0,90 / +1,08 | — | **no fire** | ETH +0,90 sub-threshold → 2/3 coins |

Design lessons encoded: near-miss bars stay quiet (20:30, 00:00); the 21:45 flip is *shown*, not traded; no-news bars never get a cause assigned.

## 3. Module map

| File | Role | Key exports / lines |
|---|---|---|
| `exception/watcher.js` | Orchestrator: polls ~15 s, OKX 1m+15m primary, Binance fallback; on each newly closed 15m bar → slow gate, on each 1m bar → đđng nhank; fire → format → dispatch → JSONL; forward returns logged at +15/+60/+240 ph (log-only, no advice) | `loadConfig`, `isEnabled`, pure core `processTick`/`mergeCandles` shared with tests + replay |
| `exception/gate.js` | Sync gate + cooldown | `evaluateSync` (:47), `cooldownAllows` (:97), `median`, `candleMetrics` |
| `exception/news.js` | Economic calendar: load, dedupe, ★★★ HIGH filter ±60 ph | `loadCalendar`, `findHigh`, `parseClock12`, `tzOffsetMin`, `isHigh`; no-news rule note :9 |
| `exception/message.js` | Heads-up text (locked tokens) | `formatHeadsUp`; banner :33, TĂNG/GIẢM :30, đđng nhank :34+:44, no-news line :48, VN clock UTC+7 :22 |
| `exception/notify.js` | 3-channel dispatcher + outbox | `dispatch`, `sendTelegram`, `sendWhatsapp`, `sendTradewatch`, `flushPending`, `waOutboxPush`, `pickToken`, `maskSecret` |
| `exception/log.js` | JSONL/JSON IO, atomic writes | `appendJsonl`, `readJsonl`, `readJson`, `atomicWriteJson` |
| `exception/paths.js` | Repo-root paths | `ROOT`, `resolvePath` |
| `exception/replay.js` | Offline replay on real candles | `fetchRange` (OKX/Binance), `alignSeries`, `replaySeries`, `frequencyTable` |
| `exception/config.json` | Flags, gate thresholds, channels, paths | see §4–§5 |

Internal trigger key stays ASCII `"1m-fast"` (watcher.js:105,113); the user-facing word is `đđng nhank` (message.js:34). Direction display words `TĂNG`/`GIẢM` are the same bytes as the UI strings in assets/js/utils.js:157.

## 4. Gate rules (as configured, exception/config.json `gate`)

| Rule | Value | Meaning |
|---|---|---|
| `minCoins` | 3 | all 3 tracked coins (BTC/ETH/SOL) must agree |
| `chg15mPct` | 1.0% | slow path: 15m candle change threshold |
| `chg1mPctFast` | 0.6% | đđng nhank: 1m candle threshold |
| `volSpikeX` | 3.0 | vol ≥ 3× median of prior 20 candles (`volMedianWindow 20`) — **logged, not required** (`requireVolSpike: false`, `minSpikeCoins: 1`) |
| `newsWindowMin` | 60 | ★★★ calendar events ±60 ph attach to the alert |
| `cooldownMin` | 45 | per **direction** (`15m:UP`, `1m-fast:DOWN`, …, watcher.js:105); the opposite direction has its own key → always allowed (dao chia V, gate.js:95-101); boundary is `≥` (test :112) |

Tie-break: equal up/down counts → stronger total move wins (gate.js:71-76). Misaligned or short history → no fire (`misaligned-bars` / `insufficient-history`, gate.js:57-63).

## 5. Three channels (exception/config.json `channels`)

| Channel | Default | Transport | Failure path |
|---|---|---|---|
| Telegram | enabled | Bot API, chatId `5753439659`, token from env (`TELEGRAM_BOT_TOKEN` or `BOT_TOKEN_TRADEMRBIT`) | HTTP 400/429 → queued as send-failed, retried by `flushPending` (test E6) |
| WhatsApp | enabled | Cloud API v21.0, token `WHATSAPP_CLOUD_TOKEN`, recipient `WHATSAPP_TO` | no token/recipient → outbox file `exception/logs/outbox-wa-pending.json` (`waOutboxPush`), flushed later |
| Tradewatch | **disabled** | **INSERT into Supabase `signals` table** (project almond-fence, `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` from env) — tradewatch has **no receiving webhook**; it only READS the signals table. `tsVao` is epoch ms, same format as journal `tinHieu`. Optional trigger: `POST /api/monitor/run` with `MONITOR_SECRET` after a successful insert. No env keys → outbox `exception/logs/outbox-tw-pending.json`, no crash. Never POSTs alerts to tradewatch directly |

Token **names** live in config; token **values** come from env only and are masked in logs (`maskSecret`).

## 6. Replay — 8 weeks real candles (tightened gate, regenerated 26/11/2026)

Source: Binance 15m candles, BTC/ETH/SOL (USDT), 2026-10-01 → 2026-11-26; 5376 aligned bars judged (after 20-candle warm-up). Saved result: `exception/logs/replay-8w.json`. Gate tightened on 26/11 to bring frequency inside the brief's 1–3/week target: `chg15mPct` 1.0 → **1.3** and `requireVolSpike: true` (vol spike ×≥3 mandatory). Regenerate with:
`node -e "const rp=require('./exception/replay.js');const s=JSON.parse(require('fs').readFileSync('exception/logs/replay-8w.json'));console.log(rp.frequencyTable(s,s.meta))"`

| Metric | Old (chg 1.0) | New (chg 1.3 + mandatory vol spike) |
|---|---|---|
| Fires after cooldown (would-send) | 30 (3.8/week — over target) | **15 (1.9/week — inside 1–3 target)** |
| UP / DOWN | 13 / 17 | 6 / 9 |
| With ★★★ news ±60 ph | 1 (3%) | **1 (7%) — the 21:30 25/11 calibration case** |

Reading: 3.8/week exceeded the brief's 1–3/week target, so the gate was tightened (mandatory vol spike + chg15mPct 1.3). At 1.9/week the calibration is preserved: the gate still fires on the 21:30 25/11 macro night (DOWN −1,43, 5 news events) and on the 21:45 whipsaw mirror (UP +1,97 — opposite-direction cooldown key, intentional per-direction cooldown, gate.js:95-101).

Full fire list is in the saved `frequencyTable` output (30 rows, VN clock, per-coin %, vol spike, news tag).

## 7. Test coverage — `node tools/test-exception.js` → **75 pass / 0 fail**

| Section | Covers |
|---|---|
| E1 gate on fixture | 20:30 no-fire + %/vol pins (±0,01 / ±0,05); 21:30 fire DOWN −1,43 (coins −1,37/−1,44/−1,48, spike 3/3); 21:45 UP +1,97; 00:00 no-fire (ETH +0,90 pinned); cooldown same-dir block, +45 min boundary `≥`, opposite-dir always allowed |
| E2 news calendar | loads >400 events, dedupe (sheet overlap removed), `findHigh` = 5 ★★★ at 20:30 and at 21:30 (−60 ph boundary inclusive, names GDP + Core PCE), `parseClock12` and `tzOffsetMin` pins |
| E3 heads-up locked tokens | banner `⚠️ RUNG LẮC ĐĐNG LOẬT — heads-up (B), nháhn ngoai lé`; `21:30 VN 25/11 \| nến 15m \| GIẢM −1,43%`; coin line; sync/spike line; news line `(+4 tin HIGH caá trong ±60 ph)`; locked no-news line (no cause attributed); đđng nhank fast line `nến đđng nhank \| TĂNG +0,67%` |
| E4 on/off flag | default false, env override both ways, off = no fetch/write |
| E5 watcher pure core | `processTick` / `mergeCandles` candle merging + closed-bar detection |
| E6 3-channel dispatcher | TG queue on HTTP 400, WA outbox cap, tradewatch: default off → no fetch; Supabase INSERT (id/side/loai=giay/trang_thai=heads_up, epoch-ms tsVao); missing SUPABASE env → outbox no-crash; optional POST /api/monitor/run with MONITOR_SECRET after insert |
| E7 latency + abort wiring | poll timing and abort paths; measured end-to-end (bar close → heads-up written + queued): 4.7 ms cold, 2.8 ms avg over 100 dispatches (2026-11-26, real clock) |

## 8. Constraints honored (from the brief)

1. (B) only — heads-up + đđng nhank; no (A) auto-action anywhere in the branch (import graph §1).
2. Writes only under `exception/logs/`.
3. Default off (`EXCEPTION_ENABLED:false`), env toggle for the station.
4. No-news case is never attributed a cause — locked line message.js:48, rule note news.js:9.
5. Forward returns +15/+60/+240 ph are logged, never advice (watcher.js:7, config `forwardMarksMin`).
6. Locked Vietnamese tokens byte-pinned by tests: banner (test :154), no-news line (:160), `TĂNG`/`GIẢM` (:155, :165), `đđng nhank` (:165) — direction words share bytes with assets/js/utils.js:157.
