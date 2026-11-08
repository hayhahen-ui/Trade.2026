/* Trade.2026 — Skill Auto Run, moi 5 phut
 *
 * Chay skill trade-2026-project tu dong: doc heartbeat tram, doc tin hieu
 * moi, review theo luat review-trade-signal, ghi 1 run record, roi dung.
 * CHI DOC Supabase, khong ghi Supabase, khong gui Telegram, khong trade.
 *
 * Key AI (tuy chon, doc tu env, thu theo thu tu):
 *   1. NOVITA_API_KEY  -> https://api.novita.ai/v3/openai, model deepseek/deepseek-v4.1-flash
 *   2. UTIM_API_KEY    -> https://api.utim.dev/v1, model lay tu UTIM_MODEL (khong co thi bo qua)
 *   3. APINEX_API_KEY  -> https://api.apinex.bond/v1, model lay tu APINEX_MODEL (khong co thi bo qua)
 *   4. RIVER_API_KEY   -> https://api.river.ai/v1, model lay tu RIVER_MODEL
 *      (mac dinh moonshotai/Kimi-K3.1-Pro, hay chon 08/11, $2/$10 1M token)
 *      River la dich vu TRA PHI, de cuoi chuoi nen chi ton tien khi 3 free deu hong.
 * Chi goi AI toi da 1 lan THANH CONG moi run, chi khi co it nhat 1 tin hieu REPORT moi.
 * Neu provider hong (sai key, het han, timeout) thi thu provider tiep theo trong
 * chuoi — cuoc goi hong khong ton token. AI hong het -> bo qua tom tat, run van xanh.
 *
 * Env bat buoc (tru dry-run): SUPABASE_URL, SUPABASE_SERVICE_KEY.
 * Co: node tools/skill-autorun-5m.js [--dry-run] [--help]
 * Exit 0 khi doc Supabase duoc (ke ca tram STALE hay khong co tin moi).
 * Exit 1 chi khi runner tu hong (khong toi duoc Supabase, thieu env).
 */
"use strict";

const fs = require("fs");
const { createFromEnv } = require("./supabase-writer.js");

const PHASES_REPORT = new Set(["alert_ready", "retest_in_progress"]);
const AI_TIMEOUT_MS = 20_000;
const HEARTBEAT_FRESH_MIN = 20;
const SIGNAL_MAX_AGE_MIN = 10;
const DEDUPE_MIN = 60;

const PROVIDERS = [
  {
    name: "novita",
    base: "https://api.novita.ai/v3/openai",
    keyEnv: "NOVITA_API_KEY",
    model: "deepseek/deepseek-v4.1-flash",
  },
  {
    name: "utim",
    base: "https://api.utim.dev/v1",
    keyEnv: "UTIM_API_KEY",
    modelEnv: "UTIM_MODEL",
  },
  {
    name: "apinex",
    base: "https://api.apinex.bond/v1",
    keyEnv: "APINEX_API_KEY",
    modelEnv: "APINEX_MODEL",
  },
  {
    name: "river",
    base: "https://api.river.ai/v1",
    keyEnv: "RIVER_API_KEY",
    modelEnv: "RIVER_MODEL",
    model: "moonshotai/Kimi-K3.1-Pro",
  },
];

function log(msg) {
  console.log(`[skill-autorun-5m] ${msg}`);
}

function minutesAgo(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 60000));
}

function mockData(nowMs) {
  const min = (m) => new Date(nowMs - m * 60000).toISOString();
  return {
    heartbeat: [{ tram: "collector-247", cap_nhat: min(6) }],
    signals: [
      { id: "AAVE-short-mock1", coin: "AAVE", side: "short", diem: 73, phase: "alert_ready", giaVao: 300, sl: 312, tp: 276, tsVao: min(4) },
      { id: "ETH-short-mock1", coin: "ETH", side: "short", diem: 81, phase: "alert_ready", giaVao: 3500, sl: 3580, tp: 3340, tsVao: min(9) },
      { id: "ETH-short-mock2", coin: "ETH", side: "short", diem: 78, phase: "alert_ready", giaVao: 3500, sl: 3580, tp: 3340, tsVao: min(8) },
      { id: "BTC-long-mock1", coin: "BTC", side: "long", diem: 62, phase: "wait_bias", giaVao: 90000, sl: 88000, tp: 94000, tsVao: min(3) },
      { id: "SOL-long-mock1", coin: "SOL", side: "long", diem: 74, phase: null, giaVao: 150, sl: 145, tp: 160, tsVao: min(2) },
    ],
  };
}

function slTpOk(r) {
  if (r.sl == null || r.tp == null || r.giaVao == null) return true;
  if (r.side === "long") return r.sl < r.giaVao && r.tp > r.giaVao;
  if (r.side === "short") return r.sl > r.giaVao && r.tp < r.giaVao;
  return true;
}

function reviewSignal(r, nowMs, seen) {
  const age = minutesAgo(r.tsVao, nowMs);
  const base = { id: r.id, coin: r.coin, side: r.side, diem: r.diem, phase: r.phase, age_min: age };
  if (age == null || age > SIGNAL_MAX_AGE_MIN) return { ...base, verdict: "REJECT", reason: "stale hon 10 phut" };
  if (!r.phase) return { ...base, verdict: "REJECT", reason: "thieu phase, NOT VERIFIED" };
  const key = `${r.coin}-${r.side}`;
  const lastAge = seen.get(key);
  if (lastAge != null && age - lastAge < DEDUPE_MIN) {
    return { ...base, verdict: "REJECT", reason: "trung trong 60 phut/coin" };
  }
  seen.set(key, age);
  if (!slTpOk(r)) return { ...base, verdict: "REJECT", reason: "SL/TP sai phia" };
  if (r.diem >= 70 && PHASES_REPORT.has(r.phase)) return { ...base, verdict: "REPORT", reason: "diem >= 70 va phase alert_ready/retest" };
  if (r.diem >= 50) return { ...base, verdict: "PREPARE", reason: "diem 50-69, chi chuan bi" };
  return { ...base, verdict: "REJECT", reason: "diem duoi 50" };
}

async function callAi(provider, model, reports) {
  const key = process.env[provider.keyEnv];
  const lines = reports.map((r) => `${r.coin} ${r.side} ${r.diem}d phase ${r.phase}`).join(", ");
  const body = {
    model,
    messages: [
      { role: "system", content: "Ban la tro ly phan tich coin. Tra loi tieng Viet, toi da 2 dong." },
      { role: "user", content: `Tom tat ngan gon tin hieu moi nay cho nguoi doc: ${lines}. Chi tom tat, khong khuyen mua ban.` },
    ],
    temperature: 0.3,
    max_tokens: 200,
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(`${provider.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || "").trim().slice(0, 500);
    return { ok: true, text: text || "(rong)" };
  } catch (err) {
    return { ok: false, reason: err && err.name === "AbortError" ? "timeout 20s" : String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function runAi(reports) {
  let lastFail = null;
  for (const p of PROVIDERS) {
    const key = process.env[p.keyEnv];
    if (!key) continue;
    const model = (p.modelEnv ? process.env[p.modelEnv] : null) || p.model;
    if (!model) {
      log(`AI: bo qua ${p.name} (co key nhung chua dat ${p.modelEnv})`);
      continue;
    }
    log(`AI: goi ${p.name} model ${model}`);
    const res = await callAi(p, model, reports);
    if (res.ok) return { provider: p.name, model, status: "ok", summary: res.text };
    log(`AI: ${p.name} hong (${res.reason}), thu provider tiep theo`);
    lastFail = { provider: p.name, model, reason: res.reason };
  }
  if (lastFail) return { provider: lastFail.provider, model: lastFail.model, status: "skipped", reason: lastFail.reason };
  return { provider: null, status: "skipped", reason: "khong co key AI nao" };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    console.log("Dung: node tools/skill-autorun-5m.js [--dry-run] [--help]");
    console.log("Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (bat buoc tru dry-run).");
    console.log("Key AI tuy chon: NOVITA_API_KEY, UTIM_API_KEY (+UTIM_MODEL), APINEX_API_KEY (+APINEX_MODEL), RIVER_API_KEY (+RIVER_MODEL, mac dinh moonshotai/Kimi-K3.1-Pro).");
    return 0;
  }
  const dryRun = argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const nowMs = Date.now();
  const runAt = new Date(nowMs).toISOString();
  let heartbeatRows = [];
  let signalRows = [];
  if (dryRun) {
    log("DRY_RUN: dung du lieu mock, khong doc Supabase");
    const mock = mockData(nowMs);
    heartbeatRows = mock.heartbeat;
    signalRows = mock.signals;
  } else {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      log("Loi: thieu SUPABASE_URL hoac SUPABASE_SERVICE_KEY");
      return 1;
    }
    let sb;
    try {
      sb = createFromEnv();
    } catch (err) {
      log(`Loi: khong tao duoc Supabase client (${err.message})`);
      return 1;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        heartbeatRows = await sb.readLatest("station_heartbeat", 5, "cap_nhat");
        signalRows = await sb.readSignals(50);
        break;
      } catch (err) {
        log(`Doc Supabase hong lan ${attempt} (${err.message})`);
        if (attempt === 2) return 1;
      }
    }
  }
  const hb = Array.isArray(heartbeatRows) && heartbeatRows.length ? heartbeatRows[0] : null;
  const hbAge = hb ? minutesAgo(hb.cap_nhat, nowMs) : null;
  const station = hbAge == null ? "UNKNOWN" : hbAge < HEARTBEAT_FRESH_MIN ? "OK" : "STALE";
  log(`Tram: ${station} (heartbeat ${hb ? hbAge + " phut truoc" : "khong co"})`);
  const fresh = (Array.isArray(signalRows) ? signalRows : []).filter(
    (r) => minutesAgo(r.tsVao, nowMs) != null && minutesAgo(r.tsVao, nowMs) <= SIGNAL_MAX_AGE_MIN
  ).sort((a, b) => Date.parse(b.tsVao) - Date.parse(a.tsVao));
  const seen = new Map();
  const verdicts = fresh.map((r) => reviewSignal(r, nowMs, seen));
  for (const v of verdicts) log(`Tin hieu ${v.coin} ${v.side} ${v.diem}d ${v.phase || "?"}: ${v.verdict} (${v.reason})`);
  const reports = verdicts.filter((v) => v.verdict === "REPORT");
  const ai = reports.length ? await runAi(reports) : { provider: null, status: "skipped", reason: "khong co tin hieu REPORT moi" };
  if (ai.status === "ok") log(`AI (${ai.provider}): ${ai.summary}`);
  else log(`AI: bo qua (${ai.reason})`);
  const record = {
    run_at: runAt,
    mode: dryRun ? "dry-run" : "live",
    station,
    heartbeat_age_min: hbAge,
    signals_reviewed: verdicts.length,
    verdicts,
    ai,
    exit_code: 0,
  };
  const file = `skill-run-${runAt.replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  log(`Ghi run record: ${file}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log(`Runner hong: ${err && err.message || err}`);
    process.exit(1);
  });
