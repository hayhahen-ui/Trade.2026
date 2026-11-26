/* ============================================================
 * Trade.2026 — Test Nhánh ngoai lé (exception branch, tier B, 26/11/2026)
 * Chạy: node tools/test-exception.js
 * Sections:
 *  E1 cánc pháán (gate) on 25/11 fixture — 4 bars pinned + cooldown boundaries
 *  E2 tin kinh teá calendar — dedupe, findHigh ★★★, clock/timezone parsers
 *  E3 heads-up message — locked tokens, VN format
 *  E4 EXCEPTION_ENABLED on/off — default false, env override, off = state
 *     hash identical, subprocess --once sleeps + writes nothing
 *  E5 watcher pure core — mergeCandles, tick fire/no-repeat/cooldown,
 *     đđng nhank path, forward returns, expiry
 *  E6 3 kênh dispatcher — TG queue/send/fail, WA outbox cap, tradewatch,
 *     flushPending drains both
 *  E7 latency + AbortController wiring
 * Channel token env names are read from exception/config.json (tokenEnv /
 * toEnv) — never hardcoded in this file; only fake values are set.
 * Fixture: exception/testdata/case-night-15m-okx.json (100×15m OKX candles
 * per BTC/ETH/SOL, 00:30 25/11 → 01:15 26/11 VN; bar idx 80=20:30, 84=21:30,
 * 85=21:45, 94=00:00).
 * ============================================================ */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const gate = require(ROOT + "/exception/gate.js");
const news = require(ROOT + "/exception/news.js");
const msg = require(ROOT + "/exception/message.js");
const notify = require(ROOT + "/exception/notify.js");
const watcher = require(ROOT + "/exception/watcher.js");
const { appendJsonl, readJsonl, readJson, atomicWriteJson } = require(ROOT + "/exception/log.js");

let pass = 0, fail = 0;
function ok(cond, ten, chiTiet) {
  if (cond) { pass++; console.log(`  ✅ ${ten}`); }
  else { fail++; console.log(`  ❌ ${ten}${chiTiet ? " — " + chiTiet : ""}`); }
}
function eq(a, b, eps) { return Math.abs(a - b) <= eps; }

const CFG0 = JSON.parse(fs.readFileSync(path.join(ROOT, "exception/config.json"), "utf8"));
const TG_TOK = [].concat(CFG0.channels.telegram.tokenEnv);
const WA_TOK = CFG0.channels.whatsapp.tokenEnv;
const WA_TO = CFG0.channels.whatsapp.toEnv;

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "exception/testdata/case-night-15m-okx.json"), "utf8"));
const COINS = CFG0.coins;
const GATE_CFG = {
  minCoins: 3, chgPct: 1.0, volSpikeX: 3.0, volMedianWindow: 20,
  requireVolSpike: false, minSpikeCoins: 1,
};

function sliceTo(idx) {
  const s = {};
  for (const c of COINS) s[c] = FIX[c].slice(0, idx + 1);
  return s;
}
const TS = (idx) => FIX.BTC[idx].ts * 1000;

/* ---- env helpers (names come from config, values are fake) ---- */
const ENV_SAVED = new Map();
function envSet(name, val) {
  if (!ENV_SAVED.has(name)) ENV_SAVED.set(name, process.env[name]);
  process.env[name] = val;
}
function envDel(names) {
  for (const n of names) {
    if (!ENV_SAVED.has(n)) ENV_SAVED.set(n, process.env[n]);
    delete process.env[n];
  }
}
function envRestore() {
  for (const [n, v] of ENV_SAVED) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ex-test-"));

/* ---------------- E1 gate on fixture ---------------- */
function testGate() {
  console.log("E1 — cánc pháán (gate) on 25/11 fixture");
  const r80 = gate.evaluateSync(sliceTo(80), GATE_CFG);
  ok(r80.fire === false && r80.reason === "no-sync", "20:30 no-fire (BTC −0,96% sub-threshold)", JSON.stringify({ fire: r80.fire, reason: r80.reason }));
  const by80 = Object.fromEntries(r80.rows.map((r) => [r.coin, r]));
  ok(eq(by80.BTC.chgPct, -0.960, 0.01) && eq(by80.ETH.chgPct, -1.086, 0.01) && eq(by80.SOL.chgPct, -1.354, 0.01),
    "20:30 % pins ±0,01 (BTC −0,96 / ETH −1,09 / SOL −1,35)",
    JSON.stringify([by80.BTC.chgPct, by80.ETH.chgPct, by80.SOL.chgPct]));
  ok(eq(by80.BTC.volX, 4.39, 0.05) && eq(by80.ETH.volX, 8.20, 0.05) && eq(by80.SOL.volX, 6.58, 0.05),
    "20:30 volX pins ±0,05 (×4,39/×8,20/×6,58 — median of prior 20 rule)",
    JSON.stringify([by80.BTC.volX, by80.ETH.volX, by80.SOL.volX]));

  const r84 = gate.evaluateSync(sliceTo(84), GATE_CFG);
  ok(r84.fire === true && r84.direction === "DOWN" && eq(r84.pct, -1.428, 0.01), "21:30 fire DOWN −1,43%", JSON.stringify({ dir: r84.direction, pct: r84.pct }));
  ok(eq(r84.coins[0].chgPct, -1.369, 0.01) && eq(r84.coins[1].chgPct, -1.436, 0.01) && eq(r84.coins[2].chgPct, -1.479, 0.01),
    "21:30 coins −1,37/−1,44/−1,48", JSON.stringify(r84.coins.map((c) => c.chgPct)));
  ok(r84.spikeCount === 3, "21:30 vol spike 3/3", String(r84.spikeCount));

  const r85 = gate.evaluateSync(sliceTo(85), GATE_CFG);
  ok(r85.fire === true && r85.direction === "UP" && eq(r85.pct, 1.973, 0.01), "21:45 fire UP +1,97 (whipsaw reversal)", JSON.stringify({ dir: r85.direction, pct: r85.pct }));

  const r94 = gate.evaluateSync(sliceTo(94), GATE_CFG);
  ok(r94.fire === false && r94.reason === "no-sync", "00:00 no-fire", JSON.stringify({ fire: r94.fire, reason: r94.reason }));
  const by94 = Object.fromEntries(r94.rows.map((r) => [r.coin, r]));
  ok(eq(by94.ETH.chgPct, 0.899, 0.01), "00:00 ETH +0,90 pinned", String(by94.ETH.chgPct));

  const t = TS(84);
  ok(gate.cooldownAllows({}, "15m:UP", t, 45) === true, "cooldown: empty → allowed");
  ok(gate.cooldownAllows({ "15m:UP": t }, "15m:UP", t + 10 * 60000, 45) === false, "cooldown: same-dir +10 min blocked");
  ok(gate.cooldownAllows({ "15m:UP": t }, "15m:UP", t + 45 * 60000, 45) === true, "cooldown: same-dir +45 min allowed (boundary ≥)");
  ok(gate.cooldownAllows({ "15m:UP": t }, "15m:DOWN", t + 10 * 60000, 45) === true, "cooldown: opposite dir always allowed (dao chia V)");
}

/* ---------------- E2 news calendar ---------------- */
function testNews() {
  console.log("E2 — tin kinh teá (news) calendar");
  const cal = news.loadCalendar();
  ok(Array.isArray(cal.events) && cal.events.length > 400, `calendar loads (${cal.events.length} events, skippedTz ${cal.skippedTz})`);
  const seen = new Set();
  let dups = 0;
  for (const e of cal.events) {
    const k = [e.Date, e.Time, e.Country, e.Event, e.Actual, e.Impact].join("|");
    if (seen.has(k)) dups++;
    seen.add(k);
  }
  ok(dups === 0 && seen.size === cal.events.length, "dedupe: unique count == events (sheet overlap removed)", `dups=${dups}`);
  const hi0 = news.findHigh(cal, TS(80), 60);
  ok(hi0.length === 5, "findHigh@20:30 = 5 ★★★ (delta 0)", String(hi0.length));
  const hi = news.findHigh(cal, TS(84), 60);
  ok(hi.length === 5, "findHigh@21:30 = 5 ★★★ (boundary −60 phat inclusive)", String(hi.length));
  const names = hi.map((e) => e.Event).join(" | ");
  ok(names.includes("GDP Growth Rate QoQ") && names.includes("Core PCE Price Index"), "5 events include GDP + Core PCE", names);
  ok(news.parseClock12("12:00 AM") === 0 && news.parseClock12("12:00 PM") === 720 && news.parseClock12("11:59 PM") === 1439, "parseClock12 12-hour pins");
  ok(news.tzOffsetMin("UTC+5:30") === 330 && news.tzOffsetMin("UTC") === 0 && news.tzOffsetMin("IST") === null, "tzOffsetMin pins (UTC+5:30→330, UTC→0, IST→null)");
}

/* ---------------- E3 heads-up message ---------------- */
function testMessage() {
  console.log("E3 — heads-up message (locked tokens)");
  const cal = news.loadCalendar();
  const hi = news.findHigh(cal, TS(84), 60);
  const alert = {
    tsMs: TS(84), bar: "15m", trigger: "15m", direction: "DOWN", pct: -1.4283333,
    coins: [
      { coin: "BTC", chgPct: -1.369, volX: 5.51, close: 57384.6 },
      { coin: "ETH", chgPct: -1.436, volX: 10.23, close: 1610.94 },
      { coin: "SOL", chgPct: -1.479, volX: 7.25, close: 65.95 },
    ],
    spikeCount: 3, syncCount: 3, totalTracked: 3, newsEvents: hi,
  };
  const text = msg.formatHeadsUp(alert);
  ok(text.startsWith("⚠️ RUNG LẮC ĐỒNG LOẬT — heads-up (B), nhánh ngoai lé"), "locked banner");
  ok(text.includes("21:30 VN 25/11 | nến 15m | GIẢM −1,43%"), "line2: VN clock + nến 15m + GIẢM −1,43%");
  ok(text.includes("• BTC −1,37% vol ×5,5 — 57.385"), "coin line BTC −1,37% ×5,5 — 57.385");
  ok(text.includes("Sync 3/3 coin | vol spike 3/3"), "sync line 3/3 + spike 3/3");
  ok(text.includes("Tin: [★★★] Core PCE Price Index MoM") && text.includes("(+4 tin HIGH caá trong ±60 ph)"), "news line names event + (+4 tin HIGH caá)");
  const noNews = msg.formatHeadsUp({ ...alert, newsEvents: [] });
  ok(noNews.includes("Tin: không có tin liachk ±60 ph — trigger chu^a cleaà (không gán nguyên neân)"), "locked no-news token (no cause attributed)");
  const fast = msg.formatHeadsUp({
    ...alert, bar: "1m", trigger: "1m-fast", direction: "UP", pct: 0.67, newsEvents: [],
    coins: [{ coin: "BTC", chgPct: 0.67, volX: 1.2, close: 61388 }],
  });
  ok(fast.includes("nến đđng nhank | TĂNG +0,67%"), "fast-path word đđng nhank + TĂNG +0,67%");
}

/* ---------------- E4 on/off flag ---------------- */
function testOnOff() {
  console.log("E4 — EXCEPTION_ENABLED on/off");
  envDel(["EXCEPTION_ENABLED", "EX_CONFIG"]);
  ok(watcher.loadConfig().EXCEPTION_ENABLED === false, "config default false");
  envSet("EXCEPTION_ENABLED", "true");
  ok(watcher.loadConfig().EXCEPTION_ENABLED === true, "env true overrides file");
  envSet("EXCEPTION_ENABLED", "0");
  ok(watcher.loadConfig().EXCEPTION_ENABLED === false, "env 0 → false");
  envDel(["EXCEPTION_ENABLED"]);

  const st = watcher.freshState(TS(84));
  const before = JSON.stringify(st);
  const cfgOff = { ...CFG0, EXCEPTION_ENABLED: false };
  const rOff = watcher.processTick(st, sliceTo(84), undefined, cfgOff, { nowMs: TS(84), cal: null });
  ok(rOff.alerts.length === 0 && rOff.skipped === "disabled" && JSON.stringify(rOff.state) === before,
    "processTick off → no alerts + state hash identical");

  const cfgOn = { ...CFG0, EXCEPTION_ENABLED: true };
  const rOn = watcher.processTick(watcher.freshState(TS(84)), sliceTo(84), undefined, cfgOn, { nowMs: TS(84), cal: null });
  ok(rOn.alerts.length === 1 && rOn.alerts[0].direction === "DOWN" && rOn.alerts[0].trigger === "15m", "processTick on → 1 DOWN alert @21:30");

  const sub = path.join(TMP, "sub");
  fs.mkdirSync(sub, { recursive: true });
  const subCfg = JSON.parse(JSON.stringify(CFG0));
  subCfg.EXCEPTION_ENABLED = false;
  subCfg.paths = {
    calendar: path.join(sub, "cal.json"),
    headsUpLog: path.join(sub, "heads-up.jsonl"),
    stateFile: path.join(sub, "state.json"),
    pendingLog: path.join(sub, "pending.jsonl"),
  };
  subCfg.channels.whatsapp.outboxPath = path.join(sub, "outbox.json");
  const subCfgPath = path.join(sub, "config.json");
  fs.writeFileSync(subCfgPath, JSON.stringify(subCfg, null, 1));
  const env = { ...process.env };
  delete env.EXCEPTION_ENABLED;
  env.EX_CONFIG = subCfgPath;
  const out = execFileSync("node", [path.join(ROOT, "exception", "watcher.js"), "--once"], { cwd: ROOT, env, encoding: "utf8" });
  ok(out.includes("sleeps"), "subprocess --once prints sleeps when off", out.slice(0, 120));
  ok(fs.readdirSync(sub).filter((f) => f !== "config.json").length === 0, "subprocess wrote zero files when off");
}

/* ---------------- E5 watcher pure core ---------------- */
function testWatcherCore() {
  console.log("E5 — watcher pure core");
  const ex = [{ ts: 300, open: 10, close: 11, vol: 5 }, { ts: 100, open: 10, close: 10.5, vol: 4 }];
  const inc = [
    { ts: 200, open: 10, close: 10.2, vol: 3 },
    { ts: 200, open: 9, close: 9.9, vol: 99 },
    { ts: 400, open: 0, close: 1, vol: 1 },
    { ts: 500, open: 10, close: 10, vol: NaN },
  ];
  const merged = watcher.mergeCandles(ex, inc, 0);
  ok(JSON.stringify(merged.map((c) => c.ts)) === "[100,200,300]", "mergeCandles dedupe/sort/drop-invalid → [100,200,300]", JSON.stringify(merged.map((c) => c.ts)));
  ok(merged[1].vol === 99, "mergeCandles: incoming wins on dup ts");
  ok(JSON.stringify(watcher.mergeCandles(merged, [], 2).map((c) => c.ts)) === "[200,300]", "mergeCandles maxKeep caps to last 2");
  ok(!watcher.validCandle({ ts: 1, open: 1, close: 1, vol: -1 }) && !watcher.validCandle(null), "validCandle rejects negative vol / null");
  ok(watcher.priceAt({ BTC: [{ ts: 10, close: 5 }, { ts: 20, close: 7 }] }, "BTC", 15) === 5 && watcher.priceAt({ BTC: [{ ts: 10, close: 5 }, { ts: 20, close: 7 }] }, "BTC", 25) === 7 && watcher.priceAt({}, "BTC", 5) === null, "priceAt walks last close ≤ ts");

  const cfgOn = { ...CFG0, EXCEPTION_ENABLED: true };
  const t1 = watcher.processTick(watcher.freshState(TS(84)), sliceTo(84), undefined, cfgOn, { nowMs: TS(84) + 1000, cal: null });
  ok(t1.alerts.length === 1 && t1.alerts[0].direction === "DOWN", "tick1: DOWN alert @21:30");
  ok(t1.state.pendingForward.length === 9, "tick1: 3 coins × 3 forward marks = 9 pending", String(t1.state.pendingForward.length));

  const t2 = watcher.processTick(t1.state, sliceTo(84), undefined, cfgOn, { nowMs: TS(84) + 2000, cal: null });
  ok(t2.alerts.length === 0, "tick2: same bar judged once (no repeat)");

  const t3 = watcher.processTick(t2.state, sliceTo(85), undefined, cfgOn, { nowMs: TS(85) + 1000, cal: null });
  ok(t3.alerts.length === 1 && t3.alerts[0].direction === "UP", "tick3: 21:45 UP passes (own cooldown key)");

  const st4 = JSON.parse(JSON.stringify(t3.state));
  st4.lastBarTs["15m"] = 0;
  const t4 = watcher.processTick(st4, sliceTo(85), undefined, cfgOn, { nowMs: TS(85) + 1000, cal: null });
  ok(t4.alerts.length === 0 && t4.state.counters.alerts === t3.state.counters.alerts, "same-dir UP re-fire inside cooldown blocked");

  const T = 1795800000;
  const mkSyn = (mult) => {
    const s = {};
    for (const c of COINS) {
      s[c] = Array.from({ length: 21 }, (_, i) => ({
        ts: T - (20 - i) * 900, open: 100, close: i === 20 ? 100 * mult : 100, high: 101, low: 99, vol: i === 20 ? 40 : 10,
      }));
    }
    return s;
  };
  const s1 = watcher.processTick(watcher.freshState(T * 1000), mkSyn(0.985), undefined, cfgOn, { nowMs: T * 1000 + 1000, cal: null });
  ok(s1.alerts.length === 1 && s1.alerts[0].direction === "DOWN", "synthetic 15m −1,5% fires DOWN");

  const mk1m = (close) => {
    const s = {};
    for (const c of COINS) {
      s[c] = Array.from({ length: 21 }, (_, i) => ({
        ts: 1795700000 + i * 60, open: 100, close: i === 20 ? close : 100, high: Math.max(100, close), low: Math.min(100, close), vol: i === 20 ? 40 : 10,
      }));
    }
    return s;
  };
  const tf = watcher.processTick(watcher.freshState(0), {}, mk1m(100.7), cfgOn, { nowMs: (1795700000 + 20 * 60) * 1000 + 1000, cal: null });
  ok(tf.alerts.length === 1 && tf.alerts[0].trigger === "1m-fast" && tf.alerts[0].direction === "UP" && eq(tf.alerts[0].pct, 0.7, 0.001), "1m +0,7% → trigger 1m-fast UP");
  const tslow = watcher.processTick(watcher.freshState(0), {}, mk1m(100.5), cfgOn, { nowMs: (1795700000 + 20 * 60) * 1000 + 1000, cal: null });
  ok(tslow.alerts.length === 0, "1m +0,5% sub-threshold → no alert");

  const syn2 = {};
  for (const c of COINS) syn2[c] = s1.alerts ? mkSyn(0.985)[c].concat([{ ts: T + 900, open: 98.5, high: 99, low: 98, close: 98.5 * 1.001, vol: 10 }]) : [];
  const s2 = watcher.processTick(s1.state, syn2, undefined, cfgOn, { nowMs: (T + 900) * 1000 + 1000, cal: null });
  ok(s2.forwards.length === 3, "forward +15 phat resolves for 3 coins", String(s2.forwards.length));
  ok(s2.forwards.every((f) => eq(f.retPct, 0.1, 0.005)), "forward retPct ≈ +0,1% (later close = base × 1,001)", JSON.stringify(s2.forwards.map((f) => f.retPct)));
  ok(s2.state.pendingForward.length === 6, "6 pending left (+60/+240 marks)", String(s2.state.pendingForward.length));

  const stExp = JSON.parse(JSON.stringify(s2.state));
  stExp.pendingForward.push({ alertId: "E-expired", coin: "BTC", mark: 240, baseClose: 100, dueTs: T * 1000 - 25 * 3600 * 1000 });
  const s3 = watcher.processTick(stExp, {}, undefined, cfgOn, { nowMs: T * 1000 + 3600 * 1000 });
  ok(s3.state.pendingForward.length === 6 && s3.state.pendingForward.every((p) => p.alertId !== "E-expired"), "expired >24h no-price pending dropped");
}

/* ---------------- E6 channels ---------------- */
async function testChannels() {
  console.log("E6 — 3 kênh dispatcher");
  const dir = path.join(TMP, "ch");
  fs.mkdirSync(dir, { recursive: true });
  const paths = { pendingLog: path.join(dir, "pending.jsonl"), outboxPath: path.join(dir, "outbox.json") };
  const cfgC = JSON.parse(JSON.stringify(CFG0));
  cfgC.EXCEPTION_ENABLED = true;
  ok(notify.maskSecret("abcd") === "***" && notify.maskSecret("abcdefgh").includes("***"), "maskSecret masks short + long");

  envDel(TG_TOK);
  let r = await notify.sendTelegram("hello", cfgC, { paths });
  ok(r.queued === true && r.reason === "no-token", "TG no-token → queued no-token", JSON.stringify(r));
  ok(readJsonl(paths.pendingLog).length === 1, "TG queue file has 1 entry");

  envSet(TG_TOK[0], "fake-token-for-test");
  let capUrl = null;
  r = await notify.sendTelegram("hello", cfgC, {
    paths,
    fetch: async (url) => { capUrl = url; return { ok: true, status: 200, text: async () => "{\"ok\":true,\"result\":{}}" }; },
  });
  ok(r.sent === true && r.status === 200, "TG token + 200 → sent", JSON.stringify(r));
  ok(String(capUrl).startsWith("https://api.telegram.org/bot"), "TG URL starts https://api.telegram.org/bot");
  ok(!JSON.stringify(r).includes("fake-token-for-test"), "TG result leaks no token");

  r = await notify.sendTelegram("hello", cfgC, {
    paths,
    fetch: async () => ({ ok: false, status: 400, text: async () => "{\"ok\":false}" }),
  });
  ok(r.queued === true && r.reason === "send-failed HTTP 400", "TG HTTP 400 → queued send-failed", JSON.stringify(r));

  const cfgQ = JSON.parse(JSON.stringify(cfgC));
  cfgQ.channels.telegram.queueMode = true;
  let calls = 0;
  r = await notify.sendTelegram("hello", cfgQ, {
    paths,
    fetch: async () => { calls++; return { ok: true, status: 200, text: async () => "{}" }; },
  });
  ok(r.queued === true && r.reason === "queue-mode" && calls === 0, "TG queueMode → queued without network call");

  envDel([WA_TOK, WA_TO]);
  r = await notify.sendWhatsapp("wa hello", cfgC, { paths });
  ok(r.queued === "outbox" && r.reason === "no-token", "WA no-token → outbox", JSON.stringify(r));
  for (let i = 0; i < 205; i++) notify.waOutboxPush(paths.outboxPath, { ts: "t", reason: "no-token", text: "m" + i }, 200);
  ok(readJson(paths.outboxPath, []).length === 200, "WA outbox capped at 200", String(readJson(paths.outboxPath, []).length));
  ok(readJson(paths.outboxPath, [])[0].text === "m5", "WA outbox shifted oldest (first kept = m5)");

  envSet(WA_TOK, "fake-wa-token");
  r = await notify.sendWhatsapp("wa direct", cfgC, {
    paths: { outboxPath: path.join(dir, "ob2.json") },
    waTo: "15559999999",
    fetch: async () => ({ ok: true, status: 200, text: async () => "{}" }),
  });
  ok(r.sent === true && r.status === 200, "WA token + to + 200 → sent", JSON.stringify(r));

  let twCalls = 0;
  const twAlert = { tsMs: 1, trigger: "15m", direction: "UP", pct: 1.5, coins: [{ coin: "BTC", chgPct: 1.5, volX: 2 }], text: "tw-text" };
  r = await notify.sendTradewatch(twAlert, cfgC, { fetch: async () => { twCalls++; return { ok: true, status: 200, text: async () => "{}" }; } });
  ok(r.skipped === "disabled" && twCalls === 0, "tradewatch disabled default → no fetch");

  const cfgTW = JSON.parse(JSON.stringify(cfgC));
  cfgTW.channels.tradewatch = { enabled: true, signalsTable: "signals", outboxPath: path.join(TMP, "tw-outbox.json"), timeoutMs: 1000, retries: 0 };
  let twBody = null, twUrl = null;
  r = await notify.sendTradewatch(twAlert, cfgTW, {
    supabaseUrl: "https://ex.supabase.co", supabaseKey: "srv-key",
    fetch: async (u, i) => { twUrl = u; twBody = JSON.parse(i.body); return { ok: true, status: 201, text: async () => "" }; },
  });
  ok(r.sent === true && twBody && twBody.id === "EXC-UP-1" && twBody.side === "long" && twBody.loai === "giay" && twBody.trang_thai === "heads_up" && /\/rest\/v1\/signals$/.test(twUrl), "tradewatch → INSERT Supabase signals record", JSON.stringify(r));

  r = await notify.sendTradewatch(twAlert, cfgTW, { fetch: async () => ({ ok: true, status: 201, text: async () => "" }) });
  ok(r.queued === "outbox" && r.reason === "no-supabase-env", "tradewatch no SUPABASE env → outbox, no crash", JSON.stringify(r));
  const twBox = JSON.parse(fs.readFileSync(cfgTW.channels.tradewatch.outboxPath, "utf8"));
  ok(Array.isArray(twBox) && twBox.length === 1 && twBox[0].record.id === "EXC-UP-1", "tradewatch outbox holds pending record");

  let monCalls = 0, monUrl = null, monHdr = null;
  r = await notify.sendTradewatch(twAlert, { ...cfgTW, channels: { ...cfgTW.channels, tradewatch: { ...cfgTW.channels.tradewatch, monitorPath: "/api/monitor/run" } } }, {
    supabaseUrl: "https://ex.supabase.co", supabaseKey: "srv-key",
    monitorUrl: "https://tradewatch.example.invalid", monitorSecret: "m-sec",
    fetch: async (u, i) => {
      if (/monitor\/run$/.test(u)) { monCalls++; monUrl = u; monHdr = i.headers; return { ok: true, status: 200, text: async () => "{}" }; }
      return { ok: true, status: 201, text: async () => "" };
    },
  });
  ok(r.sent === true && monCalls === 1 && /\/api\/monitor\/run$/.test(monUrl) && monHdr.Authorization === "Bearer m-sec", "tradewatch → optional POST /api/monitor/run after insert", JSON.stringify(r));

  envSet(TG_TOK[0], "fake-token-for-test");
  const dir2 = path.join(TMP, "flush");
  fs.mkdirSync(dir2, { recursive: true });
  const fp = { pendingLog: path.join(dir2, "pending.jsonl"), outboxPath: path.join(dir2, "outbox.json") };
  appendJsonl(fp.pendingLog, { channel: "telegram", ts: "t", reason: "no-token", text: "q1" });
  appendJsonl(fp.pendingLog, { channel: "telegram", ts: "t", reason: "no-token", text: "q2" });
  atomicWriteJson(fp.outboxPath, [
    { ts: "t", reason: "no-token", to: null, text: "w1" },
    { ts: "t", reason: "no-token", to: null, text: "w2" },
  ]);
  const sentUrls = [];
  const flushRes = await notify.flushPending(cfgC, {
    paths: fp, waTo: "15551234567",
    fetch: async (u) => { sentUrls.push(u); return { ok: true, status: 200, text: async () => "{}" }; },
  });
  ok(flushRes.telegram.tried === 2 && flushRes.telegram.sent === 2 && flushRes.telegram.kept === 0, "flush TG tried 2 sent 2 kept 0", JSON.stringify(flushRes.telegram));
  ok(flushRes.whatsapp.tried === 2 && flushRes.whatsapp.sent === 2 && flushRes.whatsapp.kept === 0, "flush WA tried 2 sent 2 kept 0", JSON.stringify(flushRes.whatsapp));
  ok(readJsonl(fp.pendingLog).length === 0 && readJson(fp.outboxPath, []).length === 0, "queue files empty after flush");
  ok(sentUrls.length === 4 && sentUrls[0].startsWith("https://api.telegram.org/bot") && sentUrls[2].includes("/messages"), "flush hit TG bot + WA Graph endpoints", JSON.stringify(sentUrls.length));
}

/* ---------------- E7 latency + abort wiring ---------------- */
async function testLatency() {
  console.log("E7 — latency + abort wiring");
  const s84 = sliceTo(84);
  let t0 = Date.now();
  for (let i = 0; i < 500; i++) gate.evaluateSync(s84, GATE_CFG);
  const dtGate = Date.now() - t0;
  ok(dtGate < 2000, `500 × evaluateSync = ${dtGate} ms < 2000 ms`);
  const ex = [];
  for (let i = 0; i < 120; i++) ex.push({ ts: i, open: 10, close: 10.1, vol: 5 });
  t0 = Date.now();
  for (let i = 0; i < 2000; i++) watcher.mergeCandles(ex, ex.slice(0, 30), 120);
  const dtMerge = Date.now() - t0;
  ok(dtMerge < 2000, `2000 × mergeCandles = ${dtMerge} ms < 2000 ms`);

  let sigCap = null;
  await watcher.fetchOkx("BTC", "1m", 5, {
    fetch: async (u, i) => { sigCap = i && i.signal; return { json: async () => ({ code: "0", data: [] }) }; },
  });
  ok(sigCap && typeof sigCap.addEventListener === "function" && sigCap.aborted === false, "fetchOkx wires AbortController signal");
}

/* ---------------- run ---------------- */
(async () => {
  try {
    testGate();
    testNews();
    testMessage();
    testOnOff();
    testWatcherCore();
    await testChannels();
    await testLatency();
  } catch (e) {
    fail++;
    console.log(`  ❌ lỗi chạy test: ${e && e.stack || e}`);
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ }
  envRestore();
  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
