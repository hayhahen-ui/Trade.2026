/* ============================================================
 * Trade.2026 — Màn hình "Nhánh ngoại lệ" (tier B) — #/ngoaile
 * CHỈ HIỂN THỊ: đọc exception/config.json + exception/logs/*.
 * Không đặt lệnh, không sửa journal/verdict nhánh chính, không ghi đè log.
 * Bật/tắt nhánh: tĩnh site không ghi được file → hiện hướng dẫn bật thật
 * (sửa exception/config.json / env trên trạm), KHÔNG giả vờ đã bật.
 * LIVE: file trạng thái (state/heads-up/outbox) chỉ có trên trạm — trạm đẩy
 * lên nhánh data (data/exception/*) mỗi giờ, màn hình đọc từ đó trước,
 * rớt về file tĩnh trên bản deploy nếu nhánh data chưa có. Config + replay
 * nằm trên main nên đọc thẳng từ bản deploy. Nhãn ĐANG CHẠY dựa vào
 * lastPollAt THẬT trong file trạng thái (ngưỡng 65 phút = chu kỳ đẩy 1 giờ),
 * không dựa vào config tĩnh. Tự tải lại mỗi 60 giây.
 * Pure helpers ở cuối file để test bằng Node (tools/test-ngoaile-ui.js).
 * ============================================================ */
"use strict";

const DATA_BRANCH = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/exception";
const NGOAILE_FILES = {
  config: "exception/config.json",
  headsUp: "exception/logs/heads-up.jsonl",
  state: "exception/logs/watcher-state.json",
  replay: "exception/logs/replay-8w.json",
  outboxWa: "exception/logs/outbox-wa-pending.json",
  outboxTw: "exception/logs/outbox-tw-pending.json",
};

/* URL đọc 1 file: state/heads-up/outbox → nhánh data trước, file tĩnh sau;
 * config/replay chỉ có trên bản deploy. */
function urlTrangThai(khoa) {
  const rel = NGOAILE_FILES[khoa];
  if (!rel) return [];
  if (khoa === "config" || khoa === "replay") return [rel];
  const ten = rel.split("/").pop();
  return [`${DATA_BRANCH}/${ten}`, rel];
}

async function taiJson(url, fallback) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return fallback;
    return await r.json();
  } catch { return fallback; }
}
async function taiText(url, fallback) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return fallback;
    return await r.text();
  } catch { return fallback; }
}
/* Thử lần lượt các URL, lấy cái đầu tiên đọc được (undefined = chưa đọc được). */
async function taiJsonThu(urls, fallback) {
  for (const u of urls) {
    const v = await taiJson(u, undefined);
    if (v !== undefined) return v;
  }
  return fallback;
}
async function taiTextThu(urls, fallback) {
  for (const u of urls) {
    const v = await taiText(u, undefined);
    if (v !== undefined) return v;
  }
  return fallback;
}

function renderNgoaile(root) {
  root.innerHTML = "";
  const wrap = el("div", { class: "grid gap" });

  const docGia = async () => {
    const [cfg, headsUpTxt, state, replay, waTxt, twTxt] = await Promise.all([
      taiJson(NGOAILE_FILES.config, null),
      taiTextThu(urlTrangThai("headsUp"), null),
      taiJsonThu(urlTrangThai("state"), null),
      taiJson(NGOAILE_FILES.replay, null),
      taiTextThu(urlTrangThai("outboxWa"), null),
      taiTextThu(urlTrangThai("outboxTw"), null),
    ]);
    wrap.innerHTML = "";
    const bat = !!(cfg && cfg.EXCEPTION_ENABLED);
    veTrangThai(wrap, cfg, state);
    veCong(wrap, cfg);
    veKenh(wrap, cfg, state, waTxt, twTxt);
    veTre(wrap);
    veHeadsUp(wrap, parseJsonl(headsUpTxt), bat);
    veReplay(wrap, replay);
  };
  docGia().catch((e) => {
    if (!wrap.children.length) {
      wrap.appendChild(el("div", { class: "card" }, "Lỗi tải dữ liệu nhánh ngoại lệ: " + String((e && e.message) || e)));
    }
  });
  root.appendChild(wrap);
  // Tự tải lại mỗi 60 giây để trạng thái theo kịp lần đẩy mới nhất từ trạm.
  if (typeof window !== "undefined") {
    if (window.__ngoaileTimer) clearInterval(window.__ngoaileTimer);
    window.__ngoaileTimer = setInterval(() => { docGia().catch(() => {}); }, 60000);
  }
}

/* ---------- 1. Trạng thái watcher ---------- */
function veTrangThai(wrap, cfg, state) {
  const polls = state && state.counters ? state.counters.polls : null;
  const lanQuet = state && state.counters && polls > 0
    ? `đã quét ${polls} lần` : (state ? "chưa có vòng quét nào" : "chưa có trạng thái (file chưa được tạo — watcher chưa chạy lần nào)");
  const tt = nhanTrangThai(cfg, state, Date.now());
  const card = el("div", { class: "card" },
    el("h3", {}, "Trạng thái watcher"),
    el("div", { style: "display:flex;flex-direction:column;gap:6px;align-items:flex-start" },
      el("span", { class: `badge ${tt.lop}` }, tt.nhan),
      el("span", { class: "tiny" }, lanQuet)),
    el("div", { class: "tiny", style: "margin-top:4px" }, `Lần quét cuối: ${fmtLastPoll(state)}`));
  card.appendChild(huongDanBatBtn());
  wrap.appendChild(card);
}

/* Nút thật: app tĩnh không ghi được exception/config.json → nút mở hướng dẫn
 * bật THẬT trên trạm; không có nút giả chỉ đổi giao diện. */
function huongDanBatBtn() {
  const btn = el("button", { class: "btn small" }, "📖 Cách bật nhánh này (thật)");
  btn.addEventListener("click", () => {
    const modal = el("div", { class: "modal", id: "ngoaile-enable-modal", onclick: (e) => { if (e.target.id === "ngoaile-enable-modal") modal.remove(); } },
      el("div", { class: "modal-body card" },
        el("h3", {}, "Bật nhánh ngoại lệ ( heads-up rung lắc — chỉ cảnh báo, không đặt lệnh)"),
        el("ol", {},
          el("li", {}, "Trên trạm 24/7 chạy watcher, đặt biến môi trường ", el("code", {}, "EXCEPTION_ENABLED=true"), " (hoặc sửa ", el("code", {}, "exception/config.json"), " → ", el("code", {}, "\"EXCEPTION_ENABLED\": true"), " trong repo trạm)."),
          el("li", {}, "Chạy: ", el("code", {}, "node exception/watcher.js"), " (thử một vòng: ", el("code", {}, "node exception/watcher.js --once"), ")."),
          el("li", {}, "Watcher tự ghi trạng thái vào ", el("code", {}, "exception/logs/watcher-state.json"), " và heads-up vào ", el("code", {}, "exception/logs/heads-up.jsonl"), " — màn hình này đọc 2 file đó.")),
        el("p", { class: "tiny" }, "App là site tĩnh nên không tự ghi được file config — đây là hướng dẫn bật thật, không phải công tắc giả.")));
    document.body.appendChild(modal);
  });
  return btn;
}

/* ---------- 2. Bảng cổng (đọc từ config, không hard-code) ---------- */
function veCong(wrap, cfg) {
  const g = (cfg && cfg.gate) || {};
  const hang = [
    ["Số coin đồng loạt tối thiểu", g.minCoins],
    ["Ngưỡng 15m (%)", g.chg15mPct],
    ["Ngưỡng 1m nhanh (%)", g.chg1mPctFast],
    ["Vol spike ×", g.volSpikeX],
    ["Cửa sổ vol median (nến)", g.volMedianWindow],
    ["Bắt buộc vol spike", g.requireVolSpike ? "Có" : "Không"],
    ["Cửa sổ tin lân cận (phút)", g.newsWindowMin],
    ["Cooldown (phút, theo từng chiều)", g.cooldownMin],
  ];
  const t = el("table", { class: "table" });
  for (const [k, v] of hang) t.appendChild(el("tr", {}, el("td", {}, k), el("td", {}, v == null ? "—" : String(v))));
  wrap.appendChild(el("div", { class: "card" }, el("h3", {}, "Cổng kích hoạt (đọc từ exception/config.json)"), t));
}

/* ---------- 3. 3 kênh ---------- */
function veKenh(wrap, cfg, state, waTxt, twTxt) {
  const ch = (cfg && cfg.channels) || {};
  const waBox = parseOutbox(waTxt);
  const twBox = parseOutbox(twTxt);
  const tgBox = state && state.pendingTelegram ? state.pendingTelegram.length : 0;
  const rows = [
    { ten: "Telegram", bat: !!(ch.telegram && ch.telegram.enabled), cho: tgBox, key: "telegram" },
    { ten: "WhatsApp", bat: !!(ch.whatsapp && ch.whatsapp.enabled), cho: waBox.length, key: "whatsapp" },
    { ten: "Tradewatch (ghi bảng signals Supabase)", bat: !!(ch.tradewatch && ch.tradewatch.enabled), cho: twBox.length, key: "tradewatch" },
  ];
  const t = el("table", { class: "table" });
  t.appendChild(el("tr", {}, el("th", {}, "Kênh"), el("th", {}, "Trạng thái"), el("th", {}, "Tin chờ outbox"), el("th", {}, "Lần gửi cuối")));
  for (const r of rows) {
    t.appendChild(el("tr", {},
      el("td", {}, r.ten),
      el("td", {}, el("span", { class: `badge ${r.bat ? "buy" : "neutral"}` }, r.bat ? "Bật" : "Tắt")),
      el("td", {}, String(r.cho)),
      el("td", {}, fmtLastSent(state, r.key))));
  }
  wrap.appendChild(el("div", { class: "card" }, el("h3", {}, "Kênh gửi"), t));
}

/* ---------- 4. Độ trễ ---------- */
function veTre(wrap) {
  wrap.appendChild(el("div", { class: "card" },
    el("h3", {}, "Độ trễ đầu-cuối (đo bằng đồng hồ thật, 26/11/2026)"),
    el("p", {}, "Xử lý trong code: 4,7 ms lạnh / 2,8 ms trung bình (100 lần dispatch)."),
    el("p", { class: "tiny" }, "Đây là thời gian xử lý trong code — CHƯA tính chu kỳ quét ~15 giây của watcher.")));
}

/* ---------- 5. Lịch sử heads-up ---------- */
function veHeadsUp(wrap, recs, bat) {
  const card = el("div", { class: "card" }, el("h3", {}, "Lịch sử heads-up (exception/logs/heads-up.jsonl)"));
  if (!recs || !recs.length) {
    card.appendChild(el("p", { class: "tiny" }, headsUpEmptyText(bat)));
    wrap.appendChild(card);
    return;
  }
  const t = el("table", { class: "table" });
  t.appendChild(el("tr", {}, el("th", {}, "Giờ VN"), el("th", {}, "Chiều"), el("th", {}, "%"), el("th", {}, "Coins (vol ×)"), el("th", {}, "Tin")));
  for (const r of recs.filter((x) => x && x.kind === "alert").reverse()) {
    const row = alertRow(r);
    t.appendChild(el("tr", {},
      el("td", {}, row.gioVN),
      el("td", {}, el("span", { class: `badge ${row.dir === "UP" ? "buy" : "sell"}` }, row.dir)),
      el("td", {}, row.pct),
      el("td", {}, row.coins),
      el("td", {}, row.tin)));
  }
  card.appendChild(t);
  wrap.appendChild(card);
}

/* ---------- 6. Replay 8 tuần ---------- */
function veReplay(wrap, replay) {
  const card = el("div", { class: "card" }, el("h3", {}, "Replay 8 tuần (exception/logs/replay-8w.json)"));
  if (!replay || !Array.isArray(replay.fires)) {
    card.appendChild(el("p", { class: "tiny" }, "Chưa có dữ liệu replay."));
    wrap.appendChild(card);
    return;
  }
  const s = replaySummary(replay);
  card.appendChild(el("p", {},
    el("b", {}, `${s.fires} lần kích ≈ ${s.perWeek} lần/tuần`), ` — ${s.up} UP / ${s.down} DOWN — ${s.newsHits} lần trùng tin HIGH.`,
    ` Nguồn nến: ${s.source} 15m, BTC/ETH/SOL, cửa sổ 8 tuần (${s.window}).`));
  const t = el("table", { class: "table" });
  t.appendChild(el("tr", {}, el("th", {}, "Giờ VN"), el("th", {}, "Chiều"), el("th", {}, "%"), el("th", {}, "Vol spike"), el("th", {}, "Tin")));
  for (const r of replay.fires) {
    const row = replayRow(r);
    t.appendChild(el("tr", {}, el("td", {}, row.gioVN), el("td", {}, row.dir), el("td", {}, row.pct), el("td", {}, row.vol), el("td", {}, row.tin)));
  }
  card.appendChild(t);
  wrap.appendChild(card);
}

/* ==================== PURE HELPERS (Node-testable) ==================== */

/* Tolerant JSONL parse: bỏ dòng rỗng / dòng hỏng cuối file. */
function parseJsonl(txt) {
  if (typeof txt !== "string" || !txt.trim()) return [];
  const out = [];
  for (const line of txt.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* torn tail line */ }
  }
  return out;
}
function parseOutbox(txt) {
  if (typeof txt !== "string" || !txt.trim()) return [];
  try { const j = JSON.parse(txt); return Array.isArray(j) ? j : []; } catch { return []; }
}

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtGioVN(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return "—";
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false, day: "2-digit", month: "2-digit" }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}`;
}
function fmtPct(x) {
  if (typeof x !== "number" || !isFinite(x)) return "—";
  return (x > 0 ? "+" : "") + x.toFixed(2).replace(".", ",") + "%";
}

function tinLabel(rec) {
  const n = rec && (rec.newsEvent || rec.news);
  if (n && n.ten) return `★★★ ${n.ten}`;
  if (typeof n === "string" && n) return `★★★ ${n}`;
  return "chưa rõ trigger";
}
function coinsLabel(rec) {
  const cs = (rec && rec.coins) || [];
  return cs.map((c) => `${c.coin} ${fmtPct(c.chgPct)} (×${String(c.volX).replace(".", ",")})`).join(", ");
}
function alertRow(rec) {
  return { gioVN: fmtGioVN(rec.tsMs || rec.ts), dir: rec.direction || "—", pct: fmtPct(rec.pct), coins: coinsLabel(rec), tin: tinLabel(rec) };
}
function replayRow(f) {
  const d = new Date(f.tsMs);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  const gio = `${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
  return {
    gioVN: gio, dir: f.direction || "—", pct: fmtPct(f.pct),
    vol: `×${String(f.spikeCount || 0).replace(".", ",")}`,
    tin: f.newsCount ? `★★★ ${f.newsEvent || ""} (×${f.newsCount})` : "—",
  };
}
function replaySummary(replay) {
  const fires = (replay && Array.isArray(replay.fires)) ? replay.fires : [];
  const meta = (replay && replay.meta) || {};
  const weeks = meta.weeks || 8;
  const startMs = meta.startMs, endMs = meta.endMs;
  const windowTxt = (startMs && endMs)
    ? `${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
    : "—";
  return {
    fires: fires.length,
    perWeek: (fires.length / weeks).toFixed(1).replace(".", ","),
    up: fires.filter((f) => f.direction === "UP").length,
    down: fires.filter((f) => f.direction === "DOWN").length,
    newsHits: fires.filter((f) => f.newsCount).length,
    source: meta.source || "—",
    window: windowTxt,
  };
}

/* Nhãn trạng thái watcher theo file trạng thái THẬT (không theo config tĩnh):
 * - lastPollAt trong 65 phút → ĐANG CHẠY (ngưỡng 65' = chu kỳ trạm đẩy lên
 *   nhánh data mỗi giờ; lần quét cuối trong file là giờ quét trên trạm).
 * - đã từng quét (polls > 0) nhưng lần cuối đã cũ → ĐÃ DỪNG.
 * - chưa có state, config bật → ĐANG BẬT (chờ file trạng thái đầu tiên).
 * - chưa có state, config tắt → ĐANG TẮT (mặc định). */
function nhanTrangThai(cfg, state, nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const last = state && state.lastPollAt;
  const polls = state && state.counters ? state.counters.polls : 0;
  if (typeof last === "number" && last > 0 && now - last <= 65 * 60000) return { nhan: "ĐANG CHẠY", lop: "buy" };
  if (polls > 0) return { nhan: "ĐÃ DỪNG", lop: "neutral" };
  if (cfg && cfg.EXCEPTION_ENABLED) return { nhan: "ĐANG BẬT", lop: "buy" };
  return { nhan: "ĐANG TẮT (mặc định)", lop: "neutral" };
}
/* Lần quét cuối từ watcher-state.json (lastPollAt, epoch ms) — không bịa giờ. */
function fmtLastPoll(state) {
  const ms = state && state.lastPollAt;
  return typeof ms === "number" && ms > 0 ? fmtGioVN(ms) : "—";
}
/* Lần gửi/xếp hàng cuối của 1 kênh: state.channels.<key>.lastSentAt → giờ VN. */
function fmtLastSent(state, key) {
  const ch = state && state.channels;
  const ms = ch && ch[key] && ch[key].lastSentAt;
  return typeof ms === "number" && ms > 0 ? fmtGioVN(ms) : "—";
}
/* Câu chữ trạng thái trống của lịch sử heads-up, tuỳ theo nhánh bật/tắt. */
function headsUpEmptyText(bat) {
  return bat
    ? "Chưa có heads-up nào — watcher chưa từng kích kể từ khi bật."
    : "Nhánh đang tắt — bật watcher để bắt đầu ghi nhận.";
}

/* Trạng thái tổng hợp cho test: watcher đang bật? bao nhiêu tin chờ? */
function tinhTrangThai({ cfg, state, outboxWa, outboxTw }) {
  const bat = !!(cfg && cfg.EXCEPTION_ENABLED);
  return {
    bat,
    watcherChay: !!(state && state.counters && state.counters.polls > 0),
    polls: (state && state.counters && state.counters.polls) || 0,
    alerts: (state && state.counters && state.counters.alerts) || 0,
    cho: { telegram: 0, whatsapp: parseOutbox(outboxWa).length, tradewatch: parseOutbox(outboxTw).length },
  };
}

/* UMD-ish: Node tests + browser */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseJsonl, parseOutbox, fmtGioVN, fmtPct, alertRow, replayRow, replaySummary, tinhTrangThai, tinLabel, coinsLabel, fmtLastPoll, fmtLastSent, headsUpEmptyText, nhanTrangThai, urlTrangThai, DATA_BRANCH };
}
if (typeof window !== "undefined") {
  window.renderNgoaile = renderNgoaile;
}
