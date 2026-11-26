/* ============================================================
 * Trade.2026 — Nhánh ngoai lé: replay gate on real candles + news calendar
 * Purpose: frequency table — how often the 15m sync gate would have fired
 * over the past N weeks of REAL candles (Binance bulk primary, OKX fallback),
 * joined with ★★★ news (±60 phat) from data/economic_calendar_data.json.
 * Same pure gate (gate.evaluateSync) + same cooldown as the live watcher.
 * Run: node exception/replay.js --weeks 8 [--source binance|okx] [--out file]
 * News coverage is bounded by the calendar snapshot (stated in the table).
 * ============================================================ */
"use strict";
const gate = require("./gate.js");
const news = require("./news.js");
const { resolvePath } = require("./paths.js");

/* ---------------- ranged fetchers ---------------- */
async function fetchRangeBinance(coin, bar, startMs, endMs, opts) {
  const o = opts || {};
  const f = o.fetch || fetch;
  const out = [];
  let cursor = startMs;
  for (let page = 0; page < 60; page++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${coin}USDT&interval=${bar}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 15000);
    let rows;
    try {
      const res = await f(url, { signal: ctl.signal });
      rows = await res.json();
    } finally { clearTimeout(timer); }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      if (Number(r[6]) < endMs) {
        out.push({ ts: Number(r[0]) / 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), vol: Number(r[5]) });
      }
    }
    const lastClose = Number(rows[rows.length - 1][6]);
    if (rows.length < 1000 || lastClose >= endMs) break;
    cursor = lastClose + 1;
  }
  return out;
}

async function fetchRangeOkx(coin, bar, startMs, endMs, opts) {
  const o = opts || {};
  const f = o.fetch || fetch;
  const out = [];
  let cursor = endMs;
  for (let page = 0; page < 200; page++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${coin}-USDT&bar=${bar}&limit=100&after=${cursor}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 15000);
    let j;
    try {
      const res = await f(url, { signal: ctl.signal });
      j = await res.json();
    } finally { clearTimeout(timer); }
    if (!j || j.code !== "0" || !Array.isArray(j.data) || !j.data.length) break;
    let earliest = Infinity;
    for (const r of j.data) {
      const tsMs = Number(r[0]);
      earliest = Math.min(earliest, tsMs);
      if (tsMs >= startMs && tsMs < endMs) {
        out.push({ ts: tsMs / 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), vol: Number(r[5]) });
      }
    }
    if (earliest <= startMs || j.data.length < 100) break;
    cursor = earliest;
  }
  return out.sort((a, b) => a.ts - b.ts);
}

async function fetchRange(coin, bar, startMs, endMs, source, opts) {
  const prim = source === "okx" ? fetchRangeOkx : fetchRangeBinance;
  const alt = source === "okx" ? fetchRangeBinance : fetchRangeOkx;
  try {
    const rows = await prim(coin, bar, startMs, endMs, opts);
    if (rows.length > 100) return rows;
  } catch { /* fall through */ }
  return alt(coin, bar, startMs, endMs, opts);
}

/* ---------------- replay core (pure) ---------------- */
/* Align 3 series on common timestamps, then judge every bar from index
 * volMedianWindow onward with the live gate config + cooldown. */
function alignSeries(seriesByCoin, coins) {
  const maps = coins.map((c) => new Map((seriesByCoin[c] || []).map((x) => [x.ts, x])));
  let common = [...maps[0].keys()];
  for (let i = 1; i < maps.length; i++) common = common.filter((ts) => maps[i].has(ts));
  common.sort((a, b) => a - b);
  return common.map((ts) => {
    const row = { ts };
    coins.forEach((c, i) => { row[c] = maps[i].get(ts); });
    return row;
  });
}

function replaySeries(seriesByCoin, cfg, cal, coins) {
  const cs = coins || Object.keys(seriesByCoin);
  const aligned = alignSeries(seriesByCoin, cs);
  const win = cfg.gate.volMedianWindow;
  const lastFire = {};
  const fires = [];
  let cooldownBlocked = 0;
  for (let i = win; i < aligned.length; i++) {
    const slice = {};
    for (const c of cs) slice[c] = aligned.slice(i - win, i + 1).map((r) => r[c]);
    const r = gate.evaluateSync(slice, require("./watcher.js").gateCfg(cfg, "15m"));
    if (!r.fire) continue;
    const tsMs = aligned[i].ts * 1000;
    const key = `15m:${r.direction}`;
    if (!gate.cooldownAllows(lastFire, key, tsMs, cfg.gate.cooldownMin)) { cooldownBlocked++; continue; }
    lastFire[key] = tsMs;
    const evs = cal ? news.findHigh(cal, tsMs, cfg.gate.newsWindowMin) : [];
    fires.push({
      tsMs, direction: r.direction, pct: r.pct, spikeCount: r.spikeCount,
      strong: r.strong, newsCount: evs.length,
      newsEvent: evs.length ? evs[0].Event : null,
      coins: r.coins.map((c) => ({ coin: c.coin, chgPct: c.chgPct, volX: c.volX })),
    });
  }
  return { barsEvaluated: Math.max(0, aligned.length - win), alignedBars: aligned.length, fires, cooldownBlocked };
}

/* ---------------- frequency table (markdown) ---------------- */
function frequencyTable(result, meta) {
  const { fires, barsEvaluated, cooldownBlocked } = result;
  const weeks = Math.max(1e-6, (meta.endMs - meta.startMs) / (7 * 24 * 3600 * 1000));
  const L = [];
  L.push(`## Frequency table — 15m sync gate on ${meta.weeks} weeks real candles`);
  L.push("");
  L.push(`- Source: ${meta.source} ${meta.bar} candles, ${meta.coins.join("/")} (USDT), ${new Date(meta.startMs).toISOString().slice(0, 10)} → ${new Date(meta.endMs).toISOString().slice(0, 10)}`);
  L.push(`- Bars judged: ${barsEvaluated} (aligned 3-coin bars after ${meta.win}-candle warm-up)`);
  L.push(`- Gate: ≥${meta.minCoins} coins |chg|≥${meta.chgPct}% in one 15m bar, cooldown ${meta.cooldownMin} min per direction, vol spike ×${meta.volSpikeX} logged (not required)`);
  L.push(`- News: ★★★ ±${meta.newsWindowMin} phat from calendar snapshot ${meta.calGeneratedAt} (coverage ${meta.calFrom} → ${meta.calTo})`);
  L.push("");
  L.push(`| Metric | Value |`);
  L.push(`|---|---|`);
  L.push(`| Fires after cooldown (would-send) | **${fires.length}** (${(fires.length / weeks).toFixed(1)}/week) |`);
  L.push(`| Raw threshold passes blocked by cooldown | ${cooldownBlocked} |`);
  const up = fires.filter((x) => x.direction === "UP").length;
  L.push(`| UP / DOWN | ${up} / ${fires.length - up} |`);
  const withNews = fires.filter((x) => x.newsCount > 0).length;
  L.push(`| With ★★★ news ±60 phat | ${withNews} (${fires.length ? Math.round((withNews / fires.length) * 100) : 0}%) |`);
  const strong = fires.filter((x) => x.strong).length;
  L.push(`| With vol spike ×${meta.volSpikeX} (≥${meta.minSpikeCoins} coin) | ${strong} |`);
  L.push("");
  if (fires.length) {
    L.push(`| VN time | Dir | Avg % | vol spike | Coins | News |`);
    L.push(`|---|---|---|---|---|---|`);
    for (const x of fires) {
      const vn = new Date(x.tsMs + 7 * 3600 * 1000);
      const p = (v) => String(v).padStart(2, "0");
      const clock = `${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())} ${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}`;
      L.push(`| ${clock} | ${x.direction} | ${x.pct >= 0 ? "+" : "−"}${Math.abs(x.pct).toFixed(2)} | ×${x.spikeCount} | ${x.coins.map((c) => `${c.coin} ${c.chgPct >= 0 ? "+" : "−"}${Math.abs(c.chgPct).toFixed(2)}`).join(", ")} | ${x.newsCount ? `★★★ ×${x.newsCount}` : "—"} |`);
    }
    L.push("");
  } else {
    L.push("(No bar passed the gate in this window.)");
    L.push("");
  }
  return L.join("\n");
}

/* ---------------- CLI ---------------- */
async function main(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--weeks") args.weeks = Number(argv[++i]);
    else if (argv[i] === "--source") args.source = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  const cfg = require("./watcher.js").loadConfig();
  const weeks = args.weeks || 8;
  const source = args.source || cfg.watcher.primary || "binance";
  const endMs = Date.now();
  const startMs = endMs - weeks * 7 * 24 * 3600 * 1000;
  const cal = news.loadCalendar(resolvePath(cfg.paths.calendar));
  const series = {};
  for (const coin of cfg.coins) {
    process.stderr.write(`[replay] fetch ${coin} 15m ${weeks}w from ${source}...\n`);
    series[coin] = await fetchRange(coin, "15m", startMs, endMs, source);
    process.stderr.write(`[replay] ${coin}: ${series[coin].length} candles\n`);
  }
  const result = replaySeries(series, cfg, cal, cfg.coins);
  const calTs = cal.events.map((e) => e._ts);
  const meta = {
    weeks, source, bar: "15m", coins: cfg.coins, startMs, endMs,
    win: cfg.gate.volMedianWindow, minCoins: cfg.gate.minCoins, chgPct: cfg.gate.chg15mPct,
    cooldownMin: cfg.gate.cooldownMin, volSpikeX: cfg.gate.volSpikeX, minSpikeCoins: cfg.gate.minSpikeCoins,
    newsWindowMin: cfg.gate.newsWindowMin, calGeneratedAt: cal.generatedAt || "unknown",
    calFrom: calTs.length ? new Date(Math.min(...calTs)).toISOString().slice(0, 10) : "none",
    calTo: calTs.length ? new Date(Math.max(...calTs)).toISOString().slice(0, 10) : "none",
  };
  const table = frequencyTable(result, meta);
  console.log(table);
  if (args.out) {
    const fs = require("fs");
    fs.mkdirSync(require("path").dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify({ meta, ...result }, null, 1), "utf8");
    process.stderr.write(`[replay] wrote ${args.out}\n`);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((rc) => process.exit(rc)).catch((e) => { console.error("[replay] failed:", e && e.message); process.exit(1); });
}

module.exports = { fetchRangeBinance, fetchRangeOkx, fetchRange, alignSeries, replaySeries, frequencyTable };
