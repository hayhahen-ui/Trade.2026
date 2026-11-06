/* ============================================================
 * Trade.2026 — telegram-sender.js (BẢN RELAY)
 * Gửi tín hiệu coin mới VỀ BOT QUA RELAY FLASK, không gọi thẳng
 * Telegram API từ Actions — để tin nhắn coin được định dạng giàu
 * như tin NexusPilot (chart Pillow + thẻ chi tiết + nút bấm).
 *
 * Luồng: Actions (5 phút) đọc bảng signals -> với mỗi tín hiệu mới
 * đủ điều kiện, POST về https://bot-tele-2026.vercel.app/api/signal-relay
 * (header X-Signal-Key) -> Flask định tuyến theo kind="coin" (ngưỡng 70,
 * chống trùng 60 phút/coin, chat + token từ bảng bots) -> gửi về
 * Telegram bằng token của bot coin.
 *
 * Chỉ gửi tín hiệu THẬT, điểm >= 70, phase alert_ready hoặc
 * retest_in_progress, vào lệnh trong 180 phút gần nhất, chưa gửi.
 * Chống gửi trùng: danh sách id đã gửi lưu trong station_heartbeat
 * (tram = 'telegram-sender', meta.sent_ids — giữ 200 id mới nhất).
 * Đánh dấu đã gửi CHỈ khi relay trả {ok:true, sent:true}; relay trả
 * sent:false + reason "duplicate" cũng đánh dấu (tin đã gửi rồi);
 * below_threshold / lỗi HTTP thì KHÔNG đánh dấu (chạy sau gửi lại).
 *
 * Nến cho chart: lấy Binance public klines (không cần key). Lấy lỗi
 * thì vẫn relay KHÔNG kèm nến — Flask gửi tin không chart chứ không lỗi.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SIGNAL_KEY (GitHub Secrets —
 * giá trị PHẢI GIỐNG hệt biến SIGNAL_KEY trên Vercel của bot-tele-2026),
 *   RELAY_URL: override để test local (mặc định relay Vercel),
 *   BINANCE_API_BASE: override để test local (mặc định api.binance.com),
 *   DRY_RUN=1: chỉ log, không relay. SEND_TEST=1: relay 1 tín hiệu
 *   DEMO coin (BTC long 78) qua relay rồi thoát (không đọc signals).
 *
 * Quy tắc an toàn: KHÔNG BAO GIỜ in key/token ra log.
 * ============================================================ */
"use strict";

const writer = require("./supabase-writer.js");

const RELAY_URL = (process.env.RELAY_URL || "https://bot-tele-2026.vercel.app/api/signal-relay").replace(/\/+$/, "");
const SIGNAL_KEY = process.env.SIGNAL_KEY || "";
const BINANCE_API_BASE = (process.env.BINANCE_API_BASE || "https://api.binance.com").replace(/\/+$/, "");
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

/* Nến Binance public cho 1 coin (vd BTC -> BTCUSDT, khung 15m, 60 nến).
 * Lỗi mạng / lỗi HTTP -> trả [] (relay vẫn gửi tin không chart). */
async function fetchKlines(coin, limit = 60) {
  const symbol = String(coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "") + "USDT";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(
      `${BINANCE_API_BASE}/api/v3/klines?symbol=${symbol}&interval=15m&limit=${limit}`,
      { signal: ctl.signal, headers: { "User-Agent": "Trade2026Sender/1.0" } }
    );
    if (!res.ok) {
      console.log(`[telegram-sender] ⚠ Binance klines ${symbol} HTTP ${res.status} — relay không kèm nến`);
      return [];
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => Array.isArray(r) && r.length >= 5)
      .map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }))
      .filter((c) => [c.t, c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v)));
  } catch (e) {
    console.log(`[telegram-sender] ⚠ Binance klines ${symbol} lỗi (${String(e.message || e).slice(0, 80)}) — relay không kèm nến`);
    return [];
  } finally {
    clearTimeout(t);
  }
}

/* Bản ghi signals (snake_case) -> payload relay (tên chuẩn + trường coin).
 * Relay tự nhận diện coin qua kind="coin" / bot="trademrbit". */
function buildRelayPayload(r, candles) {
  const side = r.side === "long" ? "long" : "short";
  return {
    bot: "trademrbit",
    kind: "coin",
    coin: r.coin,
    side,
    symbol: String(r.coin || "").toUpperCase() + "USDT",
    direction: side === "long" ? "BUY" : "SELL",
    entry_price: r.gia_vao,
    entry: r.gia_vao,
    stop_loss: r.sl,
    sl: r.sl,
    tp1: r.tp1,
    tp2: r.tp2 || null,
    score: r.diem,
    diem: r.diem,
    rr: r.rr,
    phase: r.phase,
    bias_4h: r.bias_4h,
    phien: r.phien,
    ts_vao: r.ts_vao,
    nguon: "tram",
    source: "Trade.2026",
    timeframe: "M15",
    engine: "Trade.2026",
    engine_name: "Trade.2026 Crypto",
    demo: false,
    candles: candles || [],
  };
}

/* POST 1 tín hiệu về relay Flask. Trả JSON relay ({ok, sent, reason}).
 * HTTP lỗi -> throw (sender không đánh dấu đã gửi, chạy sau gửi lại). */
async function relaySignal(payload) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signal-Key": SIGNAL_KEY },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!res.ok) {
      throw new Error(`Relay HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!body || typeof body !== "object") {
      throw new Error(`Relay trả về không phải JSON: ${text.slice(0, 200)}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  if (!SIGNAL_KEY && !DRY) {
    throw new Error("[telegram-sender] thiếu SIGNAL_KEY — thêm GitHub Secret này, giá trị phải giống hệt biến SIGNAL_KEY trên Vercel của bot-tele-2026 (xem HUONG_DAN_MULTI_BOT.md)");
  }
  console.log(`[telegram-sender] bắt đầu ${new Date().toISOString()}${DRY ? " (DRY_RUN — không relay)" : ""}${SEND_TEST ? " (SEND_TEST — relay 1 tín hiệu demo)" : ""}`);
  console.log(`[telegram-sender] relay: ${RELAY_URL}`);

  const w = writer.createFromEnv();

  if (SEND_TEST) {
    const demo = buildRelayPayload(
      {
        coin: "BTC", side: "long", gia_vao: 97500, sl: 96200, tp1: 100100, tp2: null,
        diem: 78, rr: 2, phase: "alert_ready", bias_4h: "LONG", phien: "Á",
        ts_vao: new Date().toISOString(),
      },
      await fetchKlines("BTC")
    );
    demo.demo = true;
    if (DRY) {
      console.log("[telegram-sender] DRY_RUN: sẽ relay tín hiệu demo BTC long 78 (bỏ qua)");
    } else {
      const res = await relaySignal(demo);
      console.log(`[telegram-sender] đã relay tín hiệu demo: ${JSON.stringify(res).slice(0, 200)}`);
    }
    return;
  }

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
  console.log(`[telegram-sender] ${rows ? rows.length : 0} tín hiệu trong bảng, ${moi.length} mới đủ điều kiện relay`);

  /* ---------- 3. Relay từng tín hiệu ---------- */
  let guiDuoc = 0;
  const thatBai = [];
  for (const r of moi) {
    const candles = await fetchKlines(r.coin);
    const payload = buildRelayPayload(r, candles);
    if (DRY) {
      console.log(`[telegram-sender] DRY_RUN: sẽ relay ${r.coin} ${r.side} ${r.diem}đ (${candles.length} nến, bỏ qua)`);
      continue;
    }
    try {
      const res = await relaySignal(payload);
      if (res.sent) {
        sent.add(r.id);
        guiDuoc++;
        console.log(`[telegram-sender] đã relay ${r.coin} ${r.side} ${r.diem}đ (${r.id}) -> chat ${res.chat_id || "?"}`);
      } else if (res.reason === "duplicate") {
        sent.add(r.id); // relay báo đã gửi rồi -> đánh dấu để khỏi relay lại
        console.log(`[telegram-sender] ${r.coin} ${r.side} relay báo duplicate (đã gửi trước đó) — đánh dấu đã gửi`);
      } else {
        thatBai.push(r.id);
        console.log(`[telegram-sender] ⚠ relay từ chối ${r.coin} ${r.side}: sent=false reason=${res.reason || "?"} — không đánh dấu, chạy sau thử lại`);
      }
    } catch (e) {
      thatBai.push(r.id);
      console.log(`[telegram-sender] ⚠ relay ${r.coin} ${r.side} thất bại: ${e.message.slice(0, 160)} — không đánh dấu, chạy sau thử lại`);
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
  console.log(`[telegram-sender] xong: relay ${guiDuoc}/${moi.length}, thất bại ${thatBai.length}, đã gửi tổng ${allSent.length} id`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[telegram-sender] FAIL:", e.message);
    process.exit(1);
  });
}

module.exports = { main, buildRelayPayload, fetchKlines, relaySignal, gioVN };
