/* ============================================================
 * Trade.2026 — Nhánh ngoai lé: dispatcher 3 kênh (tier B)
 *  TG  : Telegram bot sendMessage — token từ env (tokenEnv list);
 *        no token / queueMode / send-fail → queue pending-alerts.jsonl.
 *  WA  : WhatsApp Cloud API — no token/to → outbox-wa-pending.json
 *        (nhánh chính outbox KAÔT touched, file riêng exception/logs/).
 *  TW  : tradewatch KHONG co webhook nhan canh bao — no chi DOC bang `signals`
 *        tren Supabase. Kenh nay GHI 1 ban ghi heads-up vao bang signals
 *        (tsVao epoch ms nhu journal), roi tuy chon POST /api/monitor/run
 *        (MONITOR_SECRET). enabled:false default; khong co env key → outbox.
 * No secrets in results/logs: token masked. fetch injectable for tests.
 * ============================================================ */
"use strict";
const fs = require("fs");
const { appendJsonl, readJsonl, readJson, atomicWriteJson, ensureDir } = require("./log.js");
const { resolvePath } = require("./paths.js");
const { mapSignal } = require("../tools/supabase-writer.js");

/* pendingLog is JSONL (appendJsonl) — rewrite must stay JSONL, not a JSON array. */
function writeJsonl(filePath, arr) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, arr.map((o) => JSON.stringify(o)).join("\n") + (arr.length ? "\n" : ""), "utf8");
}

function maskSecret(s) {
  const str = String(s == null ? "" : s);
  return str.length <= 4 ? "***" : str.slice(0, 2) + "***" + str.slice(-2);
}

function pickToken(envNames) {
  const list = Array.isArray(envNames) ? envNames : [envNames];
  for (const n of list) {
    const v = process.env[n];
    if (v && String(v).trim()) return { name: n, token: String(v).trim() };
  }
  return null;
}

async function postJson(url, body, headers, timeoutMs, fetchImpl) {
  const f = fetchImpl || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 8000);
  try {
    const res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { ok: res.ok === true, status: res.status, json, text: String(text).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

function p(cfg, rel, deps) {
  if (deps && deps.paths && deps.paths[rel]) return deps.paths[rel];
  return resolvePath(cfg.paths[rel]);
}

/* ---------------- Telegram ---------------- */
async function sendTelegram(text, cfg, deps) {
  const ch = cfg.channels.telegram;
  if (!ch.enabled) return { channel: "telegram", skipped: "disabled" };
  const tok = pickToken(ch.tokenEnv);
  const pendingPath = p(cfg, "pendingLog", deps);
  const queue = (reason) => {
    appendJsonl(pendingPath, { channel: "telegram", ts: new Date().toISOString(), reason, text });
    return { channel: "telegram", sent: false, queued: true, reason };
  };
  if (ch.queueMode) return queue("queue-mode");
  if (!tok) return queue("no-token");
  try {
    const r = await postJson(
      `${ch.apiBase}/bot${tok.token}/sendMessage`,
      { chat_id: ch.chatId, text, disable_web_page_preview: true },
      {}, 8000, deps && deps.fetch
    );
    if (r.ok) return { channel: "telegram", sent: true, status: r.status };
    return queue(`send-failed HTTP ${r.status}`);
  } catch (e) {
    return queue(`send-failed ${maskSecret(e && e.message)}`);
  }
}

/* ---------------- WhatsApp Cloud API ---------------- */
function waOutboxPush(outboxPath, entry, cap) {
  const arr = readJson(outboxPath, []);
  const list = Array.isArray(arr) ? arr : [];
  list.push(entry);
  while (list.length > (cap || 200)) list.shift();
  atomicWriteJson(outboxPath, list);
  return list.length;
}

async function sendWhatsapp(text, cfg, deps) {
  const ch = cfg.channels.whatsapp;
  if (!ch.enabled) return { channel: "whatsapp", skipped: "disabled" };
  const outboxPath = p(cfg, "outboxPath", deps);
  const token = process.env[ch.tokenEnv];
  const to = (deps && deps.waTo) || process.env[ch.toEnv] || ch.to || "";
  const outbox = (reason) => {
    const n = waOutboxPush(outboxPath, { ts: new Date().toISOString(), reason, to: to || null, text });
    return { channel: "whatsapp", sent: false, queued: "outbox", reason, outboxSize: n };
  };
  if (!token || !to) return outbox(!token ? "no-token" : "no-to");
  try {
    const r = await postJson(
      `${ch.graphBase}/${ch.graphVersion}/${ch.phoneNumberId}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: text } },
      { Authorization: `Bearer ${token}` }, 8000, deps && deps.fetch
    );
    if (r.ok) return { channel: "whatsapp", sent: true, status: r.status };
    return outbox(`send-failed HTTP ${r.status}`);
  } catch (e) {
    return outbox(`send-failed ${maskSecret(e && e.message)}`);
  }
}

/* ---------------- tradewatch (Supabase signals) ---------------- */
/* tradewatch KHONG co webhook nhan canh bao: no chi DOC bang `signals` tren
 * Supabase (project almond-fence). Dung cach noi duy nhat: GHI 1 ban ghi
 * heads-up vao signals (tsVao epoch ms nhu journal), roi tuy chon kich hoat
 * quet lai qua POST /api/monitor/run (MONITOR_SECRET). Khong POST canh bao
 * toi tradewatch. Key chi lay tu env (SUPABASE_URL + SUPABASE_SERVICE_KEY);
 * thieu key → outbox-tw-pending.json, khong crash. */
function twOutboxPush(outboxPath, entry) {
  const arr = readJson(outboxPath, []);
  const list = Array.isArray(arr) ? arr : [];
  list.push(entry);
  while (list.length > 200) list.shift();
  atomicWriteJson(outboxPath, list);
  return list.length;
}

function buildTwRecord(alert) {
  return mapSignal({
    id: `EXC-${alert.direction}-${alert.tsMs}`,
    coin: (alert.coins && alert.coins[0] && alert.coins[0].coin) || "BTC",
    side: alert.direction === "UP" ? "long" : "short",
    loai: "giay",
    tsVao: alert.tsMs, /* epoch ms, dung dinh dang journal tinHieu.tsVao */
    phase: alert.trigger,
    trangThai: "heads_up",
    ketQua: null,
    note: alert.text,
    pct: alert.pct,
    coins: alert.coins,
  });
}

async function sendTradewatch(alert, cfg, deps) {
  const ch = cfg.channels.tradewatch;
  if (!ch.enabled) return { channel: "tradewatch", skipped: "disabled" };
  const outboxPath = (deps && deps.paths && deps.paths.outboxPath) || resolvePath(ch.outboxPath);
  const record = buildTwRecord(alert);
  const su = (deps && deps.supabaseUrl) || process.env.SUPABASE_URL;
  const sk = (deps && deps.supabaseKey) || process.env.SUPABASE_SERVICE_KEY;
  if (!su || !sk) {
    const n = twOutboxPush(outboxPath, { ts: new Date().toISOString(), reason: "no-supabase-env", record });
    return { channel: "tradewatch", sent: false, queued: "outbox", reason: "no-supabase-env", outboxSize: n };
  }
  const headers = { apikey: sk, Authorization: `Bearer ${sk}`, Prefer: "return=minimal" };
  try {
    const r = await postJson(
      `${su.replace(/\/$/, "")}/rest/v1/${ch.signalsTable || "signals"}`,
      record, headers, ch.timeoutMs || 5000, deps && deps.fetch
    );
    if (!r.ok) {
      const n = twOutboxPush(outboxPath, { ts: new Date().toISOString(), reason: `HTTP ${r.status}`, record });
      return { channel: "tradewatch", sent: false, queued: "outbox", reason: `HTTP ${r.status}`, outboxSize: n };
    }
  } catch (e) {
    const n = twOutboxPush(outboxPath, { ts: new Date().toISOString(), reason: maskSecret(e && e.message), record });
    return { channel: "tradewatch", sent: false, queued: "outbox", reason: maskSecret(e && e.message), outboxSize: n };
  }
  /* Tuy chon: quet lai tradewatch ngay sau khi ghi — chi khi co secret. */
  const mon = (deps && deps.monitorUrl) || process.env.TRADEWATCH_MONITOR_URL;
  const mSec = (deps && deps.monitorSecret) || process.env.MONITOR_SECRET;
  if (mon && mSec) {
    try {
      const url = `${mon.replace(/\/$/, "")}${ch.monitorPath || "/api/monitor/run"}`;
      await postJson(url, { source: "exception" }, { Authorization: `Bearer ${mSec}`, "x-monitor-secret": mSec }, ch.timeoutMs || 5000, deps && deps.fetch);
    } catch { /* trigger la best-effort, ban ghi da ghi thanh cong */ }
  }
  return { channel: "tradewatch", sent: true };
}

/* ---------------- dispatch all ---------------- */
async function dispatch(alert, cfg, deps) {
  const res = [];
  res.push(await sendTelegram(alert.text, cfg, deps));
  res.push(await sendWhatsapp(alert.text, cfg, deps));
  res.push(await sendTradewatch(alert, cfg, deps));
  return res;
}

/* ---------------- flush pending queues ---------------- */
/* Drains pending-alerts.jsonl (TG) + outbox-wa-pending.json (WA) when creds
 * are now available; successfully sent entries are removed. */
async function flushPending(cfg, deps) {
  const out = { telegram: { tried: 0, sent: 0, kept: 0 }, whatsapp: { tried: 0, sent: 0, kept: 0 }, tradewatch: { tried: 0, sent: 0, kept: 0 } };
  const pendingPath = p(cfg, "pendingLog", deps);
  const outboxPath = p(cfg, "outboxPath", deps);

  const tgTok = pickToken(cfg.channels.telegram.tokenEnv);
  const pend = readJsonl(pendingPath).filter((r) => r && typeof r.text === "string");
  const keptTg = [];
  for (const rec of pend) {
    if (!tgTok || cfg.channels.telegram.queueMode) { keptTg.push(rec); continue; }
    out.telegram.tried++;
    let okSend = false;
    try {
      const r = await postJson(
        `${cfg.channels.telegram.apiBase}/bot${tgTok.token}/sendMessage`,
        { chat_id: cfg.channels.telegram.chatId, text: rec.text, disable_web_page_preview: true },
        {}, 8000, deps && deps.fetch
      );
      okSend = r.ok;
    } catch { okSend = false; }
    if (okSend) out.telegram.sent++; else { keptTg.push(rec); out.telegram.kept++; }
  }
  if (pend.length) writeJsonl(pendingPath, keptTg);

  const waTok = process.env[cfg.channels.whatsapp.tokenEnv];
  const waTo = (deps && deps.waTo) || process.env[cfg.channels.whatsapp.toEnv] || cfg.channels.whatsapp.to || "";
  const box = readJson(outboxPath, []);
  const keptWa = [];
  for (const rec of Array.isArray(box) ? box : []) {
    if (!waTok || !waTo) { keptWa.push(rec); continue; }
    out.whatsapp.tried++;
    let okSend = false;
    try {
      const r = await postJson(
        `${cfg.channels.whatsapp.graphBase}/${cfg.channels.whatsapp.graphVersion}/${cfg.channels.whatsapp.phoneNumberId}/messages`,
        { messaging_product: "whatsapp", to: waTo, type: "text", text: { preview_url: false, body: rec.text } },
        { Authorization: `Bearer ${waTok}` }, 8000, deps && deps.fetch
      );
      okSend = r.ok;
    } catch { okSend = false; }
    if (okSend) out.whatsapp.sent++; else { keptWa.push(rec); out.whatsapp.kept++; }
  }
  if (Array.isArray(box) && box.length) atomicWriteJson(outboxPath, keptWa);

  const twCh = cfg.channels.tradewatch;
  if (twCh && twCh.enabled) {
    const su = (deps && deps.supabaseUrl) || process.env.SUPABASE_URL;
    const sk = (deps && deps.supabaseKey) || process.env.SUPABASE_SERVICE_KEY;
    const twBox = readJson(p(cfg, "outboxPath", deps), []);
    const keptTw = [];
    for (const rec of Array.isArray(twBox) ? twBox : []) {
      if (!su || !sk) { keptTw.push(rec); continue; }
      out.tradewatch.tried++;
      let okSend = false;
      try {
        const r = await postJson(
          `${su.replace(/\/$/, "")}/rest/v1/${twCh.signalsTable || "signals"}`,
          rec.record,
          { apikey: sk, Authorization: `Bearer ${sk}`, Prefer: "return=minimal" },
          twCh.timeoutMs || 5000, deps && deps.fetch
        );
        okSend = r.ok;
      } catch { okSend = false; }
      if (okSend) out.tradewatch.sent++; else { keptTw.push(rec); out.tradewatch.kept++; }
    }
    if (Array.isArray(twBox) && twBox.length) atomicWriteJson((deps && deps.paths && deps.paths.outboxPath) || resolvePath(twCh.outboxPath), keptTw);
  }
  return out;
}

module.exports = { dispatch, flushPending, sendTelegram, sendWhatsapp, sendTradewatch, pickToken, maskSecret, waOutboxPush };
