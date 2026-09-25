/* ============================================================
 * Trade.2026 — Bộ điều phối: router, khởi động, vòng lặp dữ liệu
 * ============================================================ */
"use strict";

const SCREENS = {
  tongquan:  { ten: "Tổng quan",     emoji: "📊", render: renderTongQuan },
  bieudo:    { ten: "Biểu đồ",       emoji: "📈", render: renderBieuDo },
  tinhieu:   { ten: "Tín hiệu",      emoji: "🎯", render: renderTinHieu },
  ragauto:   { ten: "RAG Auto",      emoji: "🧬", render: renderRagAuto },
  camap:     { ten: "Radar Cá Mập",  emoji: "🐋", render: renderCaMap },
  heatmap:   { ten: "Bản đồ thanh lý", emoji: "🔥", render: renderHeatmap },
  bot:       { ten: "Bot Trade",     emoji: "🤖", render: renderBot },
  tuhoc:     { ten: "Nhật ký & Tự học", emoji: "📓", render: renderTuHoc },
  lichkinhte:{ ten: "Lịch kinh tế",  emoji: "📅", render: renderLich },
  kienthuc:  { ten: "Kiến thức",     emoji: "📚", render: renderKienThuc },
};
let SCREEN_HIENTAI = "tongquan";

/* ---------- Router hash ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const params = {};
  if (qs) for (const kv of qs.split("&")) {
    const [k, v] = kv.split("=");
    // FIX v2.0: hash lỗi (vd `#/tongquan?x=%`) không được abort toàn bộ boot
    try { params[k] = decodeURIComponent(v || ""); } catch { params[k] = v || ""; }
  }
  return { path: SCREENS[path] ? path : "tongquan", params };
}
function dieuHuong() {
  const { path, params } = parseHash();
  SCREEN_HIENTAI = path;
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.screen === path));
  const root = $("#screen-root");
  SCREENS[path].render(root, params);
  $("#screen-title").textContent = `${SCREENS[path].emoji} ${SCREENS[path].ten}`;
}

/* ---------- Vòng quét tín hiệu ---------- */
let DANG_QUET = false;
async function quetCoin(coin, veLai = false) {
  try {
    const kq = await phanTichCoin(coin);
    capNhatSigChip(kq);
    if (SCREEN_HIENTAI === "tinhieu") veTheTinHieu(kq);
    if (SCREEN_HIENTAI === "bieudo" && coin === CHART_COIN) { vePanelSMC(kq); veCanvasSMC(kq); }
    return kq;
  } catch (e) {
    console.warn("Quét lỗi", coin, e);
    const cell = $(`#sig-${coin}`);
    if (cell) { cell.innerHTML = ""; cell.appendChild(el("span", { class: "badge neutral", title: String(e.message || e) }, "lỗi dữ liệu")); }
    return null;
  }
}
async function quetTatCa(force = false) {
  if (DANG_QUET && !force) return;
  DANG_QUET = true;
  try {
    // quét tuần tự có giãn cách nhẹ để tránh rate-limit
    for (const coin of SETTINGS.watchlist) {
      await quetCoin(coin);
      await new Promise(r => setTimeout(r, 350));
    }
    // sau khi có đủ tín hiệu → cho bot quét
    PAPER_BOT?.tick();
  } finally { DANG_QUET = false; }
  $("#last-scan") && ($("#last-scan").textContent = "Quét xong " + fmtGio(Date.now()));
}

/* ---------- Header trạng thái ---------- */
function veHeaderStatus() {
  const box = $("#conn-status");
  if (!box) return;
  box.innerHTML = "";
  for (const s of ["BINANCE", "OKX", "MEXC"]) {
    const st = ConnState.get(s);
    box.appendChild(el("span", { class: "conn-item", title: st.note || "" },
      el("span", { class: `dot ${st.status === "on" ? "on" : st.status === "retry" ? "retry" : "off"}` }),
      s === "BINANCE" ? "Binance" : s === "OKX" ? "OKX" : "MEXC"));
  }
  capNhatConnCard();
}

/* ---------- Đồng hồ giờ VN ---------- */
function veDongHo() {
  const c = $("#clock-vn");
  if (c) c.textContent = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) + " VN";
}

/* ---------- Khởi động ---------- */
function boot() {
  // Sidebar
  const nav = $("#nav-list");
  for (const [id, s] of Object.entries(SCREENS)) {
    nav.appendChild(el("div", { class: "nav-item", "data-screen": id, onclick: () => { location.hash = `#/${id}`; } },
      el("span", { class: "nav-emoji" }, s.emoji), el("span", { class: "nav-text" }, s.ten)));
  }
  $("#btn-settings").addEventListener("click", moCaiDat);

  // PriceHub
  PRICE_HUB = new PriceHub(SETTINGS.watchlist);
  PRICE_HUB.onTick((san, coin, info) => {
    capNhatGiaTick(san, coin, info);
    if (info?.gia) PAPER_BOT?.onTick(coin, info.gia, san);
    if (typeof capNhatTicketGia === "function") capNhatTicketGia(san, coin);
    if (san === "BINANCE" && typeof capNhatChartTick === "function") capNhatChartTick(coin, info?.gia);
  });
  PRICE_HUB.start();

  // Bot
  PAPER_BOT = new PaperBot();
  if (PAPER_BOT.config.enabled) PAPER_BOT.start();

  // Sự kiện
  document.addEventListener("siro:conn", veHeaderStatus);
  document.addEventListener("siro:botlog", () => { if (SCREEN_HIENTAI === "bot") veBotLogs(); });
  document.addEventListener("siro:botpos", () => { if (SCREEN_HIENTAI === "bot") { veBotPositions(); veBotHistory(); veEquity(); } });
  document.addEventListener("siro:rag", (e) => {
    if (SCREEN_HIENTAI === "ragauto" && e.detail?.coin === RAG.coinDangChon) veRagRun(e.detail);
    if (SCREEN_HIENTAI === "tongquan" && e.detail?.trangThai === "done") veGoiYHero();
  });
  document.addEventListener("siro:tradeClose", () => {
    if (SCREEN_HIENTAI === "tuhoc") renderTuHoc($("#screen-root"));
  });
  window.addEventListener("hashchange", dieuHuong);

  // Real-time chart: phân tích lại coin đang xem mỗi 60s
  setInterval(() => {
    if (SCREEN_HIENTAI === "bieudo") quetCoin(CHART_COIN, true);
  }, 60e3);
  // Heatmap thanh lý: tự làm mới khi đang mở màn hình (real-time)
  setInterval(() => {
    if (SCREEN_HIENTAI === "heatmap" && typeof capNhatHeatmapUI === "function") capNhatHeatmapUI(true);
  }, 60e3);

  // Render đầu tiên
  dieuHuong();
  veHeaderStatus();
  veDongHo();
  setInterval(veDongHo, 1000);
  setInterval(capNhatPhienBar, 30e3);
  setInterval(() => { if (SCREEN_HIENTAI === "bot") { veBotPositions(); veEquity(); } }, 5e3);

  // Lịch kinh tế nạp nền (cho engine/bot né tin ★★★) + làm mới mỗi 15 phút
  taiLichKinhTe().catch(() => {});
  setInterval(() => taiLichKinhTe(true).catch(() => {}), 15 * 60e3);

  // Quét tín hiệu ngay và định kỳ
  quetTatCa();
  setInterval(quetTatCa, SETTINGS.refreshTinHieuSec * 1000);
  // Whale score BTC nền cho bot (nếu bật xác nhận cá mập)
  setInterval(() => {
    if (PAPER_BOT?.config?.whaleXacNhan) {
      for (const c of PAPER_BOT.config.symbols.slice(0, 3)) {
        tinhWhaleScore(c).then(w => WHALE_CACHE.set(c, w)).catch(() => {});
      }
    }
  }, 5 * 60e3);
}

document.addEventListener("DOMContentLoaded", boot);
