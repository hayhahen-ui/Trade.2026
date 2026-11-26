/* ============================================================
 * Trade.2026 — Nhánh ngoai lé: fast watcher (tier B)
 * Poll ~15s: OKX 1m + 15m candles (primary), Binance klines (fallback).
 * On each newly closed 15m bar → gate.evaluateSync (slow path, chg15mPct);
 * on each newly closed 1m bar → fast path (chg1mPctFast, trigger "1m-fast").
 * Fire → heads-up (formatHeadsUp) → notify.dispatch (3 kênh) → heads-up JSONL.
 * Forward returns logged at +15/+60/+240 phat (log-only, no advice).
 * EXCEPTION_ENABLED=false → sleeps before any fetch/write (nhánh chính untouched).
 * Pure core (processTick/mergeCandles) shared with tests + replay.
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const gate = require("./gate.js");
const news = require("./news.js");
const msg = require("./message.js");
const notify = require("./notify.js");
const { appendJsonl, readJson, atomicWriteJson } = require("./log.js");
const { ROOT, resolvePath } = require("./paths.js");

/* ---------------- config ---------------- */
function loadConfig() {
  const cfgPath = process.env.EX_CONFIG || path.join(__dirname, "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const env = process.env.EXCEPTION_ENABLED;
  if (env === "true" || env === "TRUE" || env === "1") cfg.EXCEPTION_ENABLED = true;
  else if (env === "false" || env === "FALSE" || env === "0") cfg.EXCEPTION_ENABLED = false;
  return cfg;
}

function isEnabled(cfg) {
  return cfg.EXCEPTION_ENABLED === true;
}

/* ---------------- candles ---------------- */
function validCandle(c) {
  return c && Number.isFinite(c.ts) && Number.isFinite(c.open) && Number.isFinite(c.close) &&
    Number.isFinite(c.vol) && c.ts > 0 && c.vol >= 0 && c.open > 0;
}

/* Merge new candles into rolling window: dedupe by ts, ascending, cap last maxKeep. */
function mergeCandles(existing, incoming, maxKeep) {
  const byTs = new Map();
  for (const c of existing || []) byTs.set(c.ts, c);
  for (const c of incoming || []) if (validCandle(c)) byTs.set(c.ts, c);
  const out = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  return maxKeep && out.length > maxKeep ? out.slice(out.length - maxKeep) : out;
}

function freshState(nowMs) {
  return {
    version: 1,
    startedAt: nowMs || Date.now(),
    lastBarTs: { "15m": 0, "1m": 0 },
    lastFire: {},           // key "trigger:DIRECTION" -> tsMs
    pendingForward: [],     // {alertId, coin, mark, baseClose, dueTs}
    lastPollAt: 0,          // giờ vòng quét cuối (epoch ms)
    channels: {             // lần gửi/xếp hàng cuối từng kênh (epoch ms)
      telegram: { lastSentAt: 0 },
      whatsapp: { lastSentAt: 0 },
      tradewatch: { lastSentAt: 0 },
    },
    counters: { alerts: 0, forwards: 0, polls: 0, fetchErrors: 0 },
  };
}

/* Bổ sung trường mới vào state cũ (state file của phiên bản trước). */
function ensureStateFields(state) {
  const fresh = freshState(0);
  for (const k of ["lastPollAt", "channels"]) {
    if (state[k] === undefined) state[k] = fresh[k];
  }
  return state;
}

function gateCfg(cfg, bar) {
  return {
    minCoins: cfg.gate.minCoins,
    chgPct: bar === "15m" ? cfg.gate.chg15mPct : cfg.gate.chg1mPctFast,
    volSpikeX: cfg.gate.volSpikeX,
    volMedianWindow: cfg.gate.volMedianWindow,
    requireVolSpike: cfg.gate.requireVolSpike,
    minSpikeCoins: cfg.gate.minSpikeCoins,
  };
}

/* Price of coin at or before tsSec from its 15m series (for forward returns). */
function priceAt(series, coin, tsSec) {
  const arr = series[coin];
  if (!arr || !arr.length) return null;
  let px = null;
  for (const c of arr) {
    if (c.ts <= tsSec) px = c.close;
    else break;
  }
  return px;
}

/* ---------------- pure core: one poll tick ----------------
 * state: persisted watcher state. series15/series1m: {BTC,ETH,SOL} closed candles.
 * ctx: {nowMs, cal} — cal nullable. Returns {alerts, forwards, state, skipped}.
 * Off-flag → state untouched (same JSON hash), no alerts. */
function processTick(stateIn, series15, series1m, cfg, ctx) {
  if (!isEnabled(cfg)) return { alerts: [], forwards: [], state: stateIn, skipped: "disabled" };
  const nowMs = (ctx && ctx.nowMs) || Date.now();
  const cal = (ctx && ctx.cal) || null;
  const state = JSON.parse(JSON.stringify(stateIn)); // deep copy, caller persists
  ensureStateFields(state);
  state.counters.polls++;
  state.lastPollAt = nowMs; // ghi cùng chỗ số vòng quét
  const alerts = [];
  const forwards = [];

  const evaluateBar = (bar, seriesByCoin) => {
    const last = seriesByCoin.BTC && seriesByCoin.BTC.length ? seriesByCoin.BTC[seriesByCoin.BTC.length - 1] : null;
    if (!last) return;
    if (last.ts <= (state.lastBarTs[bar] || 0)) return; // bar already judged
    const r = gate.evaluateSync(seriesByCoin, gateCfg(cfg, bar));
    state.lastBarTs[bar] = last.ts;
    if (!r.fire) return;
    const tsMs = last.ts * 1000;
    const key = `${bar === "15m" ? "15m" : "1m-fast"}:${r.direction}`;
    if (!gate.cooldownAllows(state.lastFire, key, tsMs, cfg.gate.cooldownMin)) return;
    state.lastFire[key] = tsMs;
    state.counters.alerts++;
    const alert = {
      id: `E-${last.ts}-${key}`,
      tsMs,
      bar,
      trigger: bar === "15m" ? "15m" : "1m-fast",
      direction: r.direction,
      pct: r.pct,
      coins: r.coins.map((c) => ({ coin: c.coin, chgPct: c.chgPct, volX: c.volX, close: c.close })),
      spikeCount: r.spikeCount,
      syncCount: r.coins.length,
      totalTracked: r.rows.length,
      newsEvents: cal ? news.findHigh(cal, tsMs, cfg.gate.newsWindowMin) : [],
      text: null,
    };
    for (const c of alert.coins) {
      for (const mark of cfg.watcher.forwardMarksMin) {
        state.pendingForward.push({ alertId: alert.id, coin: c.coin, mark, baseClose: c.close, dueTs: tsMs + mark * 60000 });
      }
    }
    alerts.push(alert);
  };

  evaluateBar("15m", series15);
  if (series1m) evaluateBar("1m", series1m);

  // forward returns: resolve marks whose due time has a known price; expire >24h
  const keep = [];
  for (const pf of state.pendingForward || []) {
    if (pf.dueTs > nowMs) { keep.push(pf); continue; }
    const tsSec = Math.floor(pf.dueTs / 1000);
    const px = priceAt(series15, pf.coin, tsSec);
    if (px == null) {
      if (nowMs - pf.dueTs > 24 * 3600 * 1000) continue; // expired, price never seen
      keep.push(pf);
      continue;
    }
    state.counters.forwards++;
    forwards.push({
      kind: "forward", alertId: pf.alertId, coin: pf.coin, mark: pf.mark,
      ts: pf.dueTs, baseClose: pf.baseClose, px,
      retPct: (px / pf.baseClose - 1) * 100,
    });
  }
  state.pendingForward = keep;
  return { alerts, forwards, state, skipped: null };
}

/* ---------------- fetchers (network) ---------------- */
async function fetchOkx(coin, bar, limit, opts) {
  const o = opts || {};
  const url = `https://www.okx.com/api/v5/market/history-candles?instId=${coin}-USDT&bar=${bar}&limit=${limit || 30}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 8000);
  try {
    const f = o.fetch || fetch;
    const res = await f(url, { signal: ctl.signal });
    const j = await res.json();
    if (!j || j.code !== "0" || !Array.isArray(j.data)) return [];
    const rows = j.data.map((r) => ({ ts: Number(r[0]) / 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), vol: Number(r[5]) }));
    rows.reverse(); // OKX returns newest-first
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinance(coin, bar, limit, opts) {
  const o = opts || {};
  const url = `https://api.binance.com/api/v3/klines?symbol=${coin}USDT&interval=${bar}&limit=${limit || 30}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 8000);
  try {
    const f = o.fetch || fetch;
    const res = await f(url, { signal: ctl.signal });
    const j = await res.json();
    if (!Array.isArray(j)) return [];
    const nowMs = o.nowMs || Date.now();
    return j
      .filter((r) => Number(r[6]) < nowMs) // closed bars only
      .map((r) => ({ ts: Number(r[0]) / 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), vol: Number(r[5]) }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCoinBar(coin, bar, cfg, opts) {
  const o = { timeoutMs: cfg.watcher.httpTimeoutMs, ...(opts || {}) };
  try {
    const rows = cfg.watcher.primary === "binance"
      ? await fetchBinance(coin, bar, 30, o)
      : await fetchOkx(coin, bar, 30, o);
    if (rows.length) return rows;
  } catch { /* primary failed → fallback */ }
  return cfg.watcher.fallback === "binance"
    ? await fetchBinance(coin, bar, 30, o)
    : await fetchOkx(coin, bar, 30, o);
}

/* ---------------- live loop ---------------- */
function sleepLog(cfg) {
  console.log("[exception] EXCEPTION_ENABLED=false — nhánh ngoai lé sleeps, nhánh chính untouched");
}

async function tick(cfg, mem, state, log) {
  const series15 = {};
  const series1m = {};
  for (const coin of cfg.coins) {
    try {
      const c15 = await fetchCoinBar(coin, "15m", cfg);
      const c1m = await fetchCoinBar(coin, "1m", cfg);
      mem.series15[coin] = mergeCandles(mem.series15[coin], c15, 120);
      mem.series1m[coin] = mergeCandles(mem.series1m[coin], c1m, 120);
    } catch {
      state.counters.fetchErrors++;
    }
  }
  for (const coin of cfg.coins) {
    series15[coin] = mem.series15[coin] || [];
    series1m[coin] = mem.series1m[coin] || [];
  }
  const r = processTick(state, series15, series1m, cfg, { nowMs: Date.now(), cal: mem.cal });
  for (const a of r.alerts) {
    a.text = msg.formatHeadsUp(a);
    const channels = await notify.dispatch(a, cfg);
    // lần gửi/xếp hàng cuối từng kênh: chỉ khi gửi thành công HOẶC xếp vào outbox
    for (const c of channels) {
      if ((c.sent || c.queued) && r.state.channels && r.state.channels[c.channel]) {
        r.state.channels[c.channel].lastSentAt = Date.now();
      }
    }
    log.push({ kind: "alert", ...a, channels });
    console.log(`[exception] ALERT ${a.trigger} ${a.direction} ${a.pct.toFixed(2)}% — ${a.coins.map((c) => c.coin).join("/")}`);
  }
  for (const f of r.forwards) log.push(f);
  if (r.alerts.length || r.forwards.length) {
    for (const rec of log) appendJsonl(resolvePath(cfg.paths.headsUpLog), rec);
    log.length = 0;
  }
  atomicWriteJson(resolvePath(cfg.paths.stateFile), r.state);
  return r.state;
}

async function main(argv) {
  const cfg = loadConfig();
  if (!isEnabled(cfg)) { sleepLog(cfg); return 0; }
  const once = Array.isArray(argv) && argv.includes("--once");
  let cal = null;
  try { cal = news.loadCalendar(resolvePath(cfg.paths.calendar)); } catch { cal = { events: [], skippedTz: -1 }; }
  const mem = { cal, series15: {}, series1m: {} };
  let state = readJson(resolvePath(cfg.paths.stateFile), null) || freshState();
  ensureStateFields(state);
  try {
    const fl = await notify.flushPending(cfg);
    for (const k of Object.keys(state.channels || {})) {
      if (fl[k] && fl[k].sent > 0) state.channels[k].lastSentAt = Date.now();
    }
    if (Object.values(fl).some((c) => c.sent > 0)) atomicWriteJson(resolvePath(cfg.paths.stateFile), state);
  } catch { /* queues stay for next tick */ }
  await tick(cfg, mem, state, []);
  if (once) return 0;
  const timer = setInterval(() => {
    state = readJson(resolvePath(cfg.paths.stateFile), null) || state;
    tick(cfg, mem, state, []).then((s) => { state = s; }).catch(() => {});
  }, (cfg.watcher.pollSecs || 15) * 1000);
  const stop = () => { clearInterval(timer); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return null; // keep running
}

if (require.main === module) {
  main(process.argv.slice(2)).then((rc) => { if (rc != null) process.exit(rc); });
}

module.exports = {
  loadConfig, isEnabled, mergeCandles, freshState, processTick, priceAt, ensureStateFields,
  fetchOkx, fetchBinance, fetchCoinBar, gateCfg, validCandle,
};
