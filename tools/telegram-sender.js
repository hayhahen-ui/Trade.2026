/* ============================================================
 * Trade.2026 — telegram-sender.js
 * Gửi tín hiệu coin mới qua Telegram bot (@trademrbit_bot).
 *
 * Chạy mỗi 5 phút (workflow station-sender.yml), đọc thẳng bảng signals:
 *   chỉ gửi tín hiệu THẬT, điểm >= 70, phase alert_ready hoặc
 *   retest_in_progress, vào lệnh trong 180 phút gần nhất, chưa gửi.
 * Chống gửi trùng: danh sách id đã gửi lưu trong station_heartbeat
 * (tram = 'telegram-sender', meta.sent_ids — giữ 200 id mới nhất).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (GitHub Secrets),
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (GitHub Secrets),
 *   DRY_RUN=1: chỉ log, không gửi. SEND_TEST=1: gửi 1 tin test cố định
 *   rồi thoát (không đọc signals). TELEGRAM_API_BASE: override để test
 *   local (mặc định https://api.telegram.org).
 *
 * Quy tắc an toàn: KHÔNG BAO GIỜ in token ra log.
 * ============================================================ */
"use strict";

const writer = require("./supabase-writer.js");

const API_BASE = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const DRY = process.env.DRY_RUN === "1";
const SEND_TEST = process.env.SEND_TEST === "1";

const MIN_DIEM = 70;
const PHASES = new Set(["alert_ready", "retest_in_progress"]);
const WINDOW_MS = 180 * 60 * 1000; // chỉ tín hiệu trong 3h gần nhất
const MAX_GUI_MOI_LAN = 10;
const GIU_SENT_IDS = 200;
const TIMEOUT_MS = 30000;

/* Giờ VN dạng HH:MM dd/MM — khớp cách app hiển thị. */
function gioVN(tsMs) {
  const d = new Date(tsMs + 7 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

function fmtPrice(n) {
  if (n === null || n === undefined || !Number.isFinite(+n)) return "—";
  const v = +n;
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toLocaleString("en-US");
  if (a >= 100) return v.toFixed(2);
  if (a >= 1) return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function fmtRR(n) {
  if (n === null || n === undefined || !Number.isFinite(+n)) return "—";
  return `1:${(+n).toFixed(1).replace(/\.0$/, "")}`;
}

function buildMessage(r) {
  const side = r.side === "long" ? "🟢 LONG" : "🔴 SHORT";
  const lines = [
    `🚨 TÍN HIỆU COIN — ${r.coin}/USDT ${side}`,
    `Điểm hợp lưu: ${r.diem}/100 · Giai đoạn: ${r.phase}`,
    `Bias 4H: ${r.bias_4h || "—"}`,
    `Entry: ${fmtPrice(r.gia_vao)} · SL: ${fmtPrice(r.sl)} · TP1: ${fmtPrice(r.tp1)} (RR ${fmtRR(r.rr)})`,
    `Phiên: ${r.phien || "—"} · Lúc: ${gioVN(Date.parse(r.ts_vao))} (giờ VN)`,
    `Nguồn: trạm 24/7 Trade.2026`,
    `⚠️ Không phải lời khuyên đầu tư. Mọi quyết định lệnh thật do BẠN xác nhận.`,
  ];
  return lines.join("\n");
}

async function sendTelegram(text) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text }),
      signal: ctl.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      let hint = "";
      if (res.status === 401) hint = " — token bot sai, kiểm tra lại GitHub Secret TELEGRAM_BOT_TOKEN";
      if (res.status === 403) hint = " — bot chưa được Start hoặc bị chặn: mở @trademrbit_bot bấm Start rồi chạy lại";
      throw new Error(`Telegram HTTP ${res.status}: ${body.slice(0, 200)}${hint}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  if (!TOKEN) throw new Error("[telegram-sender] thiếu TELEGRAM_BOT_TOKEN — thêm GitHub Secret này (xem HUONG_DAN.md)");
  if (!CHAT_ID) throw new Error("[telegram-sender] thiếu TELEGRAM_CHAT_ID — thêm GitHub Secret này (xem HUONG_DAN.md)");
  console.log(`[telegram-sender] bắt đầu ${new Date().toISOString()}${DRY ? " (DRY_RUN — không gửi)" : ""}${SEND_TEST ? " (SEND_TEST — gửi 1 tin test)" : ""}`);

  if (SEND_TEST) {
    const text = `🧪 BOT ĐÃ NỐI XONG — Trade.Mrbit\nTrạm 24/7 Trade.2026 đã nối Telegram thành công.\nTừ giờ tín hiệu coin đủ điểm (≥70) sẽ báo về đây.\n⚠️ Không phải lời khuyên đầu tư.`;
    if (DRY) {
      console.log("[telegram-sender] DRY_RUN: sẽ gửi tin test (bỏ qua)");
    } else {
      await sendTelegram(text);
      console.log("[telegram-sender] đã gửi tin test ✓");
    }
    return;
  }

  const w = writer.createFromEnv();
  const now = Date.now();

  /* ---------- 1. Nạp id đã gửi ---------- */
  let sentIds = [];
  try {
    const hb = await w.readHeartbeat("telegram-sender");
    if (hb && hb.meta && Array.isArray(hb.meta.sent_ids)) sentIds = hb.meta.sent_ids;
  } catch (e) {
    console.log(`[telegram-sender] ⚠ không nạp được danh sách đã gửi (${e.message.slice(0, 100)}) — chạy với danh sách rỗng`);
  }
  const sent = new Set(sentIds);

  /* ---------- 2. Lọc tín hiệu mới đủ điều kiện ---------- */
  const rows = await w.readSignals(300);
  const moi = (rows || [])
    .filter((r) => {
      if (!r || r.loai !== "that") return false;
      if (!Number.isFinite(+r.diem) || +r.diem < MIN_DIEM) return false;
      if (!PHASES.has(r.phase)) return false;
      const ts = Date.parse(r.ts_vao || "");
      if (!Number.isFinite(ts) || ts > now + 5 * 60 * 1000 || now - ts > WINDOW_MS) return false;
      if (sent.has(r.id)) return false;
      return true;
    })
    .sort((a, b) => Date.parse(a.ts_vao) - Date.parse(b.ts_vao))
    .slice(0, MAX_GUI_MOI_LAN);
  console.log(`[telegram-sender] ${rows ? rows.length : 0} tín hiệu trong bảng, ${moi.length} mới đủ điều kiện gửi`);

  /* ---------- 3. Gửi từng tín hiệu ---------- */
  let guiDuoc = 0;
  const thatBai = [];
  for (const r of moi) {
    const text = buildMessage(r);
    if (DRY) {
      console.log(`[telegram-sender] DRY_RUN: sẽ gửi ${r.coin} ${r.side} ${r.diem}đ (bỏ qua)`);
      continue;
    }
    try {
      await sendTelegram(text);
      sent.add(r.id);
      guiDuoc++;
      console.log(`[telegram-sender] đã gửi ${r.coin} ${r.side} ${r.diem}đ (${r.id})`);
    } catch (e) {
      thatBai.push(r.id);
      console.log(`[telegram-sender] ⚠ gửi ${r.coin} ${r.side} thất bại: ${e.message.slice(0, 160)}`);
    }
  }

  /* ---------- 4. Lưu danh sách đã gửi ---------- */
  const allSent = [...sent].slice(-GIU_SENT_IDS);
  if (!DRY) {
    await w.writeHeartbeat("telegram-sender", {
      sent_ids: allSent,
      last_run: new Date().toISOString(),
      gui_duoc: guiDuoc,
      that_bai: thatBai,
    });
  } else {
    console.log("[telegram-sender] DRY_RUN: không lưu heartbeat (bỏ qua)");
  }
  console.log(`[telegram-sender] xong: gửi ${guiDuoc}/${moi.length}, thất bại ${thatBai.length}, đã gửi tổng ${allSent.length} id`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[telegram-sender] FAIL:", e.message);
    process.exit(1);
  });
}

module.exports = { main, buildMessage, fmtPrice, gioVN };
