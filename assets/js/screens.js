/* ============================================================
 * Trade.2026 — Màn hình 1-3: Tổng quan · Biểu đồ · Tín hiệu
 * ============================================================ */
"use strict";

/* ================= TỔNG QUAN ================= */
function renderTongQuan(root) {
  root.innerHTML = "";
  // Thanh phiên
  const phienBar = el("div", { class: "session-bar", id: "session-bar" });
  root.appendChild(phienBar);
  capNhatPhienBar();

  // Hàng thẻ chỉ số
  const hang = el("div", { class: "stat-row" },
    el("div", { class: "card stat", id: "card-fng" }, el("div", { class: "stat-label" }, "Fear & Greed"), el("div", { class: "stat-value" }, "…")),
    el("div", { class: "card stat", id: "card-btc" }, el("div", { class: "stat-label" }, "BTC/USDT"), el("div", { class: "stat-value" }, "…")),
    el("div", { class: "card stat", id: "card-kz" }, el("div", { class: "stat-label" }, "Killzone"), el("div", { class: "stat-value" }, "…")),
    el("div", { class: "card stat", id: "card-conn" }, el("div", { class: "stat-label" }, "Kết nối sàn"), el("div", { class: "stat-value" }, "…")),
  );
  root.appendChild(hang);

  // Sức khỏe nguồn dữ liệu — cảnh báo trễ/mất tick ngay trên Tổng quan
  root.appendChild(veSucKhoeNguon());
  capNhatSucKhoeNguon();
  clearInterval(window._skTimer);
  window._skTimer = setInterval(() => {
    if (SCREEN_HIENTAI === "tongquan") capNhatSucKhoeNguon();
    else clearInterval(window._skTimer);
  }, 2000);

  // Cố vấn lệnh — gõ text / import ảnh / dán
  root.appendChild(el("div", { id: "advisor-panel" }));
  veAdvisorPanel();

  // Hero gợi ý Long/Short (mapping tín hiệu + RAG Auto)
  root.appendChild(el("div", { id: "goiy-hero" }));
  veGoiYHero();

  // Bảng giá 3 sàn
  const card = el("div", { class: "card" });
  card.appendChild(el("div", { class: "card-title" }, "📊 Watchlist — giá real-time 3 sàn (WebSocket)"));
  const tbl = el("table", { class: "price-table", id: "price-table" });
  tbl.appendChild(el("tr", {},
    el("th", { class: "left" }, "Coin"),
    el("th", {}, "Binance"), el("th", {}, "OKX"), el("th", {}, "MEXC (Fut)"),
    el("th", {}, "24h"), el("th", {}, "Tín hiệu"), el("th", {}, "")));
  for (const coin of SETTINGS.watchlist) {
    const tr = el("tr", { id: `row-${coin}` },
      el("td", { class: "left strong" }, coin),
      el("td", { class: "mono", id: `p-BINANCE-${coin}` }, "—"),
      el("td", { class: "mono", id: `p-OKX-${coin}` }, "—"),
      el("td", { class: "mono", id: `p-MEXC-${coin}` }, "—"),
      el("td", { class: "mono", id: `pct-${coin}` }, "—"),
      el("td", { id: `sig-${coin}` }, el("span", { class: "badge neutral" }, "đang quét…")),
      el("td", { class: "row-actions" },
        el("button", { class: "btn small", onclick: () => { location.hash = `#/bieudo?coin=${coin}`; } }, "Chart"),
        el("button", {
          class: "btn small primary", title: "Đặt lệnh 2 bước (kiểm tra an toàn trước)",
          onclick: () => moDatLenh({ coin, side: SIGNAL_CACHE.get(coin)?.side || "long" }),
        }, "Đặt lệnh")),
    );
    tbl.appendChild(tr);
  }
  card.appendChild(tbl);
  root.appendChild(card);

  // Ghi chú
  root.appendChild(el("p", { class: "muted small" },
    "Giá cập nhật trực tiếp qua WebSocket. MEXC dùng giá Futures (spot WS bị hạn chế). Tín hiệu quét lại mỗi ",
    String(Math.round(SETTINGS.refreshTinHieuSec / 60)), " phút — bấm vào coin ở màn hình Tín hiệu để xem chi tiết."));

  capNhatFng();
}

function capNhatPhienBar() {
  const bar = $("#session-bar");
  if (!bar) return;
  bar.innerHTML = "";
  for (const s of phienHienTai()) {
    bar.appendChild(el("span", { class: `pill ${s.active ? "active" : ""} ${s.id === "golden" && s.active ? "golden" : ""}`, title: s.mota },
      `${s.emoji} ${s.ten} ${s.tu}h–${s.den}h`));
  }
  const kz = dangKillzone();
  const kzCard = $("#card-kz .stat-value");
  if (kzCard) { kzCard.textContent = kz.active ? `🔥 ${kz.ten}` : "Ngoài killzone"; kzCard.className = "stat-value " + (kz.active ? "up" : "muted"); }
}

async function capNhatFng() {
  const c = $("#card-fng .stat-value");
  if (!c) return;
  const f = await fetchFearGreed();
  if (f) { c.textContent = `${f.value} · ${f.nhan}`; c.className = "stat-value " + (f.value >= 55 ? "up" : f.value <= 45 ? "down" : ""); }
  else c.textContent = "—";
}

/* Cập nhật ô giá theo tick (gọi từ app.js) */
function capNhatGiaTick(san, coin, info) {
  const cell = $(`#p-${san}-${coin}`);
  if (cell && info?.gia != null) {
    const cu = parseFloat(cell.dataset.v || "0");
    cell.textContent = fmtGia(info.gia);
    cell.dataset.v = info.gia;
    cell.classList.remove("flash-up", "flash-down");
    if (cu && info.gia !== cu) {
      void cell.offsetWidth;
      cell.classList.add(info.gia > cu ? "flash-up" : "flash-down");
    }
  }
  if (san === "BINANCE") {
    const pc = $(`#pct-${coin}`);
    if (pc && info?.pct24h != null) {
      pc.textContent = fmtPct(info.pct24h);
      pc.className = "mono " + (info.pct24h >= 0 ? "up" : "down");
    }
    const btcCard = $("#card-btc .stat-value");
    if (coin === "BTC" && btcCard) {
      btcCard.textContent = `$${fmtGia(info.gia)} (${fmtPct(info.pct24h)})`;
      btcCard.className = "stat-value " + ((info.pct24h ?? 0) >= 0 ? "up" : "down");
    }
  }
}
function capNhatSigChip(kq) {
  const cell = $(`#sig-${kq.coin}`);
  if (cell) {
    cell.innerHTML = "";
    const cls = kq.verdict === "LONG" ? "long" : kq.verdict === "SHORT" ? "short" : kq.verdict === "PREPARE" ? "prepare" : "neutral";
    cell.appendChild(el("span", { class: `badge ${cls}`, title: kq.phaseLabel }, `${verdictLabel(kq.verdict)} · ${kq.score}đ`));
  }
  veGoiYHero();
}

/* Hero: mapping tín hiệu → gợi ý Long/Short + nút đặt lệnh */
/* FIX v2.0 — Consensus đa lớp cho top-pick đa coin:
 * tổng hợp SMC (engine) · Whale · Dòng tiền DataHub → hướng đồng thuận + disagreement index.
 * Coin điểm cao nhưng các lớp mâu thuẫn mạnh sẽ bị hạ hạng (không để 1 lớp "gánh" cả quyết định). */
function danhGiaDongThuan(coin) {
  const kq = SIGNAL_CACHE.get(coin);
  const lop = [];
  if (kq?.side) lop.push({ ten: "SMC", huong: kq.side === "long" ? 1 : -1, manh: kq.score / 100 });
  const w = (typeof WHALE_CACHE !== "undefined" && WHALE_CACHE.get(coin)) || null;
  if (w && Math.abs(w.score) >= 10) lop.push({ ten: "Whale", huong: Math.sign(w.score), manh: Math.abs(w.score) / 100 });
  try {
    if (window.DataHub && DataHub.isRunning()) {
      const fs = DataHub.flowScore(coin);
      if (Math.abs(fs) >= 15) lop.push({ ten: "Dòng tiền", huong: Math.sign(fs), manh: Math.abs(fs) / 100 });
    }
  } catch {}
  if (!lop.length) return { huong: 0, disagreement: 0, lop: [], dongThuan: "không đủ lớp" };
  const tong = lop.reduce((s, l) => s + l.huong * l.manh, 0);
  const tongManh = lop.reduce((s, l) => s + l.manh, 0) || 1;
  const huongChung = Math.sign(tong) || 0;
  const nguoc = lop.filter(l => huongChung && l.huong !== huongChung).reduce((s, l) => s + l.manh, 0);
  const disagreement = +(nguoc / tongManh).toFixed(2);
  const dongThuan = disagreement >= 0.4 ? "mâu thuẫn mạnh" : disagreement >= 0.2 ? "phân hóa" : "đồng thuận";
  return { huong: huongChung, disagreement, lop, dongThuan };
}

function veGoiYHero() {
  const box = $("#goiy-hero");
  if (!box) return;
  const tatCa = [...SIGNAL_CACHE.values()].filter(k => SETTINGS.watchlist.includes(k.coin));
  if (!tatCa.length) { box.innerHTML = ""; return; }
  // FIX v2.0: xếp hạng top-pick theo điểm SMC đã trừ "phạt mâu thuẫn" + ưu tiên tín hiệu tươi
  const xep = tatCa.map(kq => {
    const dt = danhGiaDongThuan(kq.coin);
    const tuoiPhut = (Date.now() - (kq.time || 0)) / 60e3;
    const diemChung = kq.score * (1 - dt.disagreement * 0.6) * (tuoiPhut > 10 ? 0.85 : 1);
    return { kq, dt, diemChung, tuoiPhut };
  }).sort((a, b) => b.diemChung - a.diemChung);
  const top = xep.slice(0, 3);
  box.innerHTML = "";
  const card = el("div", { class: "card" });
  card.appendChild(el("div", { class: "card-title", style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
    "🎯 Top gợi ý — consensus đa lớp (SMC · Whale · Dòng tiền)",
    el("button", { class: "btn small", onclick: () => { location.hash = `#/ragauto?coin=${top[0]?.kq.coin || "BTC"}`; } }, "🧬 Chạy RAG Auto đầy đủ")));
  const row = el("div", { class: "hero-row" });
  for (const { kq, dt, tuoiPhut } of top) {
    const rag = (typeof RAG !== "undefined" && RAG.runs.get(kq.coin)?.ketLuan) || null;
    const goiY = rag ? rag.goiY : (kq.verdict === "LONG" || kq.verdict === "SHORT" ? kq.verdict : kq.side ? "THEO DÕI " + kq.side.toUpperCase() : "ĐỨNG NGOÀI");
    const cls = /LONG/.test(goiY) ? "long" : /SHORT/.test(goiY) ? "short" : "neutral";
    const dtBadge = dt.disagreement >= 0.2
      ? el("span", { class: "badge warn", title: dt.lop.map(l => `${l.ten}: ${l.huong > 0 ? "mua" : "bán"}`).join(" · ") },
          `⚠ ${dt.dongThuan} ${Math.round(dt.disagreement * 100)}%`)
      : el("span", { class: "badge ok", title: dt.lop.map(l => `${l.ten}: ${l.huong > 0 ? "mua" : "bán"}`).join(" · ") }, "✓ đồng thuận");
    const h = el("div", { class: `hero-card v-${cls}` },
      el("div", { class: "hero-head" },
        el("b", {}, kq.coin + "/USDT"),
        el("span", { class: `badge ${cls}` }, rag ? `${ragGoiYLabel(rag.goiY)} ${rag.conf}%` : `${verdictLabel(kq.verdict)} · ${kq.score}đ`)),
      el("div", { class: "small muted" }, `${kq.phaseLabel} · bias 4H ${biasLabel(kq.htf.bias)}${kq.killzone?.active ? " · 🔥 killzone" : ""}${tuoiPhut > 10 ? ` · ⏳ tín hiệu ${Math.round(tuoiPhut)}ph trước` : ""}`),
      el("div", { class: "small", style: "margin:4px 0" }, dtBadge),
      kq.plan ? el("div", { class: "plan-mini " + kq.plan.side },
        el("span", {}, `E ${fmtGia(kq.plan.entry)}`),
        el("span", { class: "down" }, `SL ${fmtGia(kq.plan.sl)}`),
        el("span", { class: "up" }, `TP ${fmtGia(kq.plan.tp1)}`),
        el("span", { class: "muted" }, `RR 1:${kq.plan.rr1}`)) : el("div", { class: "small muted" }, "Chưa đủ điều kiện dựng kế hoạch lệnh"),
      el("div", { class: "row-gap" },
        el("button", { class: "btn small primary", onclick: () => moDatLenh({ coin: kq.coin, side: kq.side || "long" }) }, "🛒 Đặt lệnh"),
        el("button", { class: "btn small", onclick: () => { location.hash = `#/ragauto?coin=${kq.coin}`; } }, "🧬 RAG"),
        el("button", { class: "btn small", onclick: () => { location.hash = `#/bieudo?coin=${kq.coin}`; } }, "Chart")));
    row.appendChild(h);
  }
  card.appendChild(row);
  card.appendChild(el("p", { class: "muted tiny", style: "margin:8px 0 0" },
    "Xếp hạng đã trừ điểm khi các lớp phân tích mâu thuẫn nhau. Đặt lệnh luôn qua 2 bước: 🛡️ kiểm tra an toàn (tín hiệu, RR, đòn bẩy, vùng tin ★★★, cá mập, thanh lý) → ✅ bạn xác nhận. Lệnh mô phỏng bằng giá thật sàn đã chọn."));
  box.appendChild(card);
}
function capNhatConnCard() {
  const c = $("#card-conn .stat-value");
  if (!c) return;
  const items = ["BINANCE", "OKX", "MEXC"].map(s => {
    const st = ConnState.get(s).status;
    return `<span class="dot ${st === "on" ? "on" : st === "retry" ? "retry" : "off"}"></span>${s === "BINANCE" ? "BN" : s}`;
  });
  c.innerHTML = items.join(" ");
}

/* ============ SỨC KHỎE NGUỒN DỮ LIỆU (cảnh báo trễ/mất tick trên Tổng quan) ============
 * Tick mới nhất = độ trễ thực của dữ liệu bạn đang nhìn (quan trọng hơn ping).
 * WS: sàn đẩy tick liên tục · REST: app hỏi định kỳ. >10s: vàng · >30s/mất kết nối: đỏ. */
const SK_NGUON_GIA = [
  { id: "BINANCE", ten: "Binance", kieu: "WS · spot+fut" },
  { id: "OKX", ten: "OKX", kieu: "WS · spot" },
  { id: "MEXC", ten: "MEXC", kieu: "WS · futures" },
  { id: "BYBIT_PERP", ten: "Bybit", kieu: "WS · perp" },
  { id: "HYPERLIQUID", ten: "Hyperliquid", kieu: "WS · perp" },
];
const SK_TICK_VANG = 10e3, SK_TICK_DO = 30e3;
const SK_BOQUA_DH = new Set(["binance", "okx", "bybit", "hyperliquid"]); // giá đã đếm ở PriceHub

function skTuoiTickMoiNhat(san) {
  const slot = (typeof PRICE_HUB !== "undefined" && PRICE_HUB?.prices?.[san]) || null;
  if (!slot) return null;
  let moi = 0;
  for (const c of (typeof SETTINGS !== "undefined" ? SETTINGS.watchlist : [])) {
    const t = slot[c]?.ts; if (t > moi) moi = t;
  }
  return moi || null;
}
function skFmtTuoi(ms) {
  if (ms == null) return "chưa có";
  if (ms < 1500) return "vừa xong";
  if (ms < 60e3) return `${(ms / 1000).toFixed(ms < 10e3 ? 1 : 0)}s trước`;
  return `${Math.round(ms / 60e3)}ph trước`;
}
function veSucKhoeNguon() {
  const wrap = el("div", { class: "card", id: "card-suckhoe" });
  wrap.appendChild(el("div", { class: "card-title" }, "🛰 Sức khỏe nguồn dữ liệu ",
    el("span", { class: "tiny muted" }, "WS = sàn đẩy real-time · REST = app hỏi định kỳ")));
  wrap.appendChild(el("div", { id: "sk-warn" }));
  wrap.appendChild(el("div", { class: "sk-grid", id: "sk-grid" }));
  wrap.appendChild(el("p", { class: "muted small", style: "margin:8px 0 0" },
    "“Tick mới nhất” = độ trễ thực của con số bạn đang nhìn. Vàng: tick quá 10s · Đỏ: quá 30s hoặc mất kết nối — lúc đó tín hiệu/bot đang dùng giá cũ, nên chờ."));
  return wrap;
}
function capNhatSucKhoeNguon() {
  const grid = $("#sk-grid");
  if (!grid || !grid.isConnected) return;
  const warnBox = $("#sk-warn");
  const nowMs = Date.now();
  const rows = [], warns = [];

  // 1. Giá real-time từ PriceHub (5 sàn)
  for (const n of SK_NGUON_GIA) {
    const ts = skTuoiTickMoiNhat(n.id);
    const tuoi = ts ? nowMs - ts : null;
    let st = "on", cls = "ok", note = "";
    if (tuoi == null) { st = "off"; cls = "neutral"; note = "chưa kết nối"; warns.push(`${n.ten}: chưa có dữ liệu giá`); }
    else if (tuoi > SK_TICK_DO) { st = "off"; cls = "warn"; note = `tick cũ ${skFmtTuoi(tuoi)}`; warns.push(`${n.ten}: tick cũ ${skFmtTuoi(tuoi)} — con số trên màn hình có thể đã lệch`); }
    else if (tuoi > SK_TICK_VANG) { st = "degraded"; cls = "warn"; note = `chậm ${skFmtTuoi(tuoi)}`; warns.push(`${n.ten}: tick chậm ${skFmtTuoi(tuoi)}`); }
    rows.push({ ten: n.ten, kieu: n.kieu, st, cls, tra: skFmtTuoi(tuoi), note });
  }
  // 2. Nguồn bổ trợ từ DataHub (Fear&Greed, Polymarket…)
  if (typeof DataHub !== "undefined" && DataHub) {
    for (const s of DataHub.sources()) {
      if (SK_BOQUA_DH.has(s.id)) continue;
      const tuoi = s.lastMsg ? nowMs - s.lastMsg : null;
      let cls = "ok";
      if (s.status === "off") cls = "neutral";
      else if (s.status === "degraded" || s.status === "retry") cls = "warn";
      rows.push({
        ten: s.ten, kieu: /rest/i.test(s.note || "") || s.id === "macro" || s.id === "polymarket" ? "REST · poll" : "WS",
        st: s.status, cls, tra: s.lastMsg ? skFmtTuoi(tuoi) : (s.note || s.status),
        note: s.status === "on" ? "" : (s.note || ""),
      });
      if (s.status === "degraded" || s.status === "retry") warns.push(`${s.ten}: ${s.note || s.status}`);
      else if (s.status === "off" && s.msgs === 0 && !/đã tắt/.test(s.note || "")) warns.push(`${s.ten}: chưa kết nối`);
    }
  }

  grid.innerHTML = "";
  for (const r of rows)
    grid.appendChild(el("div", { class: "sk-row" },
      el("span", { class: `dh-chip dh-${r.st}` }, el("i", { class: "dh-dot" })),
      el("span", { class: "sk-ten" }, r.ten),
      el("span", { class: "tiny muted" }, r.kieu),
      el("span", { class: `badge ${r.cls} sk-tra` }, r.tra),
      r.note ? el("span", { class: "tiny muted" }, r.note) : null));

  warnBox.innerHTML = "";
  if (warns.length)
    warnBox.appendChild(el("div", { class: "sk-warnbox" },
      el("div", { class: "sk-warn-title" }, `⚠ ${warns.length} cảnh báo dữ liệu`),
      ...warns.slice(0, 6).map(w => el("div", { class: "sk-warn-item" }, "• " + w))));

  // Làm mờ ô giá quá cũ trong bảng watchlist (BINANCE/OKX/MEXC)
  for (const coin of SETTINGS.watchlist) for (const n of SK_NGUON_GIA) {
    const cell = $(`#p-${n.id}-${coin}`);
    if (!cell) continue;
    const ts = PRICE_HUB?.prices?.[n.id]?.[coin]?.ts;
    const cu = ts ? nowMs - ts > SK_TICK_DO : !!cell.dataset.v;
    cell.classList.toggle("gia-cu", cu);
    cell.title = cu && ts ? `Giá cũ ${skFmtTuoi(nowMs - ts)} — ${n.ten} chưa đẩy tick mới` : "";
  }
}

/* ================= BIỂU ĐỒ ================= */
let CHART_COIN = "BTC", CHART_TF = "15";

function renderBieuDo(root, params = {}) {
  if (params.coin) CHART_COIN = params.coin;
  root.innerHTML = "";

  // Bộ chọn
  const chon = el("div", { class: "toolbar" });
  const selCoin = el("select", { class: "input", onchange: (e) => { CHART_COIN = e.target.value; renderBieuDo(root); } });
  for (const c of [...SETTINGS.watchlist, ...SETTINGS.watchlistPhu]) selCoin.appendChild(el("option", { value: c, ...(c === CHART_COIN ? { selected: "" } : {}) }, `${c}/USDT`));
  const selTf = el("select", { class: "input", onchange: (e) => { CHART_TF = e.target.value; renderBieuDo(root); } });
  for (const t of TV_INTERVALS) selTf.appendChild(el("option", { value: t.tv, ...(t.tv === CHART_TF ? { selected: "" } : {}) }, t.ten));
  chon.appendChild(el("label", { class: "muted small" }, "Coin: "));
  chon.appendChild(selCoin);
  chon.appendChild(el("label", { class: "muted small" }, "Khung: "));
  chon.appendChild(selTf);
  chon.appendChild(el("button", { class: "btn", onclick: () => quetCoin(CHART_COIN, true) }, "🔄 Phân tích lại"));
  root.appendChild(chon);

  const grid = el("div", { class: "chart-grid" });
  // TradingView
  const tvCard = el("div", { class: "card chart-card" });
  const tvUrl = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(TV_SYMBOLS(CHART_COIN))}&interval=${CHART_TF}&theme=dark&style=1&locale=vi_VN&hide_side_toolbar=0&allow_symbol_change=0&withdateranges=1&studies=${encodeURIComponent("STD;Volume")}`;
  tvCard.appendChild(el("iframe", { src: tvUrl, class: "tv-iframe", allowtransparency: "true" }));
  grid.appendChild(tvCard);

  // Panel SMC
  const panel = el("div", { class: "card smc-panel", id: "smc-panel" }, el("div", { class: "card-title" }, `🧠 Phân tích SMC — ${CHART_COIN}`), el("p", { class: "muted" }, "Đang phân tích…"));
  grid.appendChild(panel);
  root.appendChild(grid);

  // Canvas SMC 15m — REAL-TIME
  const canvas = el("canvas", { id: "smc-canvas", class: "smc-canvas", width: "1200", height: "440" });
  const cv = el("div", { class: "card" },
    el("div", { class: "card-title", style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
      "🗺️ Bản đồ SMC khung 15m — OB (cam) · FVG (tím) · EQH/EQL (đứt) · POC (vàng) · Entry/SL/TP",
      el("span", { class: "live-badge", id: "smc-live" }, "● LIVE"),
      el("span", { class: "muted tiny", id: "smc-updated" }, "")),
    canvas);
  root.appendChild(cv);
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    CHART_HOVER = { x: e.clientX - r.left, y: e.clientY - r.top }; // tọa độ CSS (vẽ nhân DPR bên trong)
    const kqH = SIGNAL_CACHE.get(CHART_COIN);
    if (kqH) veCanvasSMC(kqH);
  });
  canvas.addEventListener("mouseleave", () => {
    CHART_HOVER = null;
    const kqH = SIGNAL_CACHE.get(CHART_COIN);
    if (kqH) veCanvasSMC(kqH);
  });

  const kq = SIGNAL_CACHE.get(CHART_COIN);
  if (kq) { vePanelSMC(kq); veCanvasSMC(kq); }
  else quetCoin(CHART_COIN, true);
}

/* ---------- REAL-TIME: cập nhật nến sống theo tick giá (gọi từ app.js) ---------- */
let CHART_HOVER = null;
let CHART_VE_CUOI = 0;
let CHART_REFETCH_LUC = 0;
function capNhatChartTick(coin, gia) {
  if (!gia || coin !== CHART_COIN || SCREEN_HIENTAI !== "bieudo") return;
  const kq = SIGNAL_CACHE.get(coin);
  if (!kq?.candles15?.length) return;
  const last = kq.candles15[kq.candles15.length - 1];
  const now = Date.now();
  if (now >= last.openTime + 15 * 60e3) {
    // nến 15m đã đóng → phân tích lại toàn bộ (throttle 20s)
    if (now - CHART_REFETCH_LUC > 20e3) { CHART_REFETCH_LUC = now; quetCoin(coin, true); }
    return;
  }
  // cập nhật nến sống
  last.close = gia;
  if (gia > last.high) last.high = gia;
  if (gia < last.low) last.low = gia;
  if (now - CHART_VE_CUOI > 350) {
    CHART_VE_CUOI = now;
    veCanvasSMC(kq);
    const u = $("#smc-updated");
    if (u) u.textContent = "cập nhật " + fmtGio(now);
  }
}

function vePanelSMC(kq) {
  const panel = $("#smc-panel");
  if (!panel || kq.coin !== CHART_COIN) return;
  panel.innerHTML = "";
  panel.appendChild(el("div", { class: "card-title" }, `🧠 Phân tích SMC — ${kq.coin} · ${fmtGio(kq.time)}`));
  const vd = el("div", { class: `verdict ${biasClass(kq.verdict)}` }, `${verdictLabel(kq.verdict)} — ${kq.score}/100đ`);
  panel.appendChild(vd);
  panel.appendChild(el("div", { class: "kv" }, el("span", {}, "Pha setup"), el("b", {}, kq.phaseLabel)));
  panel.appendChild(el("div", { class: "kv" }, el("span", {}, "Bias 4H"), el("b", { class: biasClass(kq.htf.bias) }, `${biasLabel(kq.htf.bias)} (${kq.htf.ctBias})`)));
  if (kq.htf.ema200) panel.appendChild(el("div", { class: "kv" }, el("span", {}, "EMA200 4H"), el("b", { class: "mono" }, fmtGia(kq.htf.ema200))));
  if (kq.mtf.range) panel.appendChild(el("div", { class: "kv" }, el("span", {}, "Dải giá 1H"), el("b", {}, `${kq.mtf.range.vung.toUpperCase()} (${kq.mtf.range.viTriPct}%)`)));
  if (kq.mtf.poc) panel.appendChild(el("div", { class: "kv" }, el("span", {}, "POC volume 1H"), el("b", { class: "mono" }, fmtGia(kq.mtf.poc))));
  if (kq.dongTien) {
    const dt = kq.dongTien;
    panel.appendChild(el("div", { class: "kv" }, el("span", {}, "🌊 Dòng tiền đa sàn"),
      el("b", { class: dt.score >= 15 ? "up" : dt.score <= -15 ? "down" : "" }, `${dt.score > 0 ? "+" : ""}${dt.score} (${dt.huong})`)));
    if (dt.lenhLon) panel.appendChild(el("div", { class: "kv" }, el("span", {}, "Lệnh lớn 1h (mua/bán)"),
      el("b", { class: "mono" }, `${fmtUsd(dt.lenhLon.buy)} / ${fmtUsd(dt.lenhLon.sell)}`)));
  }
  if (kq.ltf.sweep) panel.appendChild(el("div", { class: "kv" }, el("span", {}, "Sweep"), el("b", {}, `${kq.ltf.sweep.phia === "long" ? "quét đáy" : "quét đỉnh"} ${fmtGia(kq.ltf.sweep.mucQuet)}`)));
  if (kq.ltf.choch) panel.appendChild(el("div", { class: "kv" }, el("span", {}, "CHoCH"), el("b", {}, `${fmtGia(kq.ltf.choch.mucPhaVo)} ${kq.ltf.choch.bodyClose ? "✓body" : "⚠wick"}${kq.ltf.idm ? " ✓IDM" : ""}`)));
  if (kq.ltf.rsi?.rsi != null) panel.appendChild(el("div", { class: "kv" }, el("span", {}, "RSI 15m"), el("b", {}, `${fmtSo(kq.ltf.rsi.rsi, 0)} (${kq.ltf.rsi.zone})${kq.ltf.rsi.reversal ? " · " + (kq.ltf.rsi.reversal === "positive" ? "đảo chiều dương" : "đảo chiều âm") : ""}`)));
  if (kq.poi) panel.appendChild(el("div", { class: "kv" }, el("span", {}, "POI"), el("b", { class: "mono" }, `${kq.poi.nguon}: ${fmtGia(kq.poi.zone[0])} – ${fmtGia(kq.poi.zone[1])}`)));
  if (kq.heatmap?.namCham) {
    const nc = kq.heatmap.namCham;
    panel.appendChild(el("div", { class: "kv" }, el("span", {}, "🧲 Nam châm thanh lý"),
      el("b", { class: nc.huong === "len" ? "up" : nc.huong === "xuong" ? "down" : "" },
        nc.huong === "len" ? `HÚT LÊN ${nc.cumGanNhatTren ? fmtGia(nc.cumGanNhatTren.mid) : ""}` :
        nc.huong === "xuong" ? `HÚT XUỐNG ${nc.cumGanNhatDuoi ? fmtGia(nc.cumGanNhatDuoi.mid) : ""}` : "Cân bằng")));
  }
  if (kq.plan) {
    panel.appendChild(el("hr"));
    panel.appendChild(el("div", { class: "plan-box " + kq.plan.side },
      el("div", { class: "plan-title" }, `📋 Kế hoạch ${kq.plan.side.toUpperCase()}`),
      el("div", { class: "kv" }, el("span", {}, "Entry"), el("b", { class: "mono" }, `${fmtGia(kq.plan.entry)} (limit 2: ${fmtGia(kq.plan.entrySau)})`)),
      el("div", { class: "kv" }, el("span", {}, "Stoploss"), el("b", { class: "mono down" }, fmtGia(kq.plan.sl))),
      el("div", { class: "kv" }, el("span", {}, `TP1 (1:${kq.plan.rr1})`), el("b", { class: "mono up" }, fmtGia(kq.plan.tp1))),
      el("div", { class: "kv" }, el("span", {}, `TP2 (1:${kq.plan.rr2})`), el("b", { class: "mono up" }, fmtGia(kq.plan.tp2))),
      kq.plan.tpLiq ? el("div", { class: "kv" }, el("span", {}, "TP thanh khoản"), el("b", { class: "mono" }, `${fmtGia(kq.plan.tpLiq)} (1:${kq.plan.rrLiq})`)) : null,
      kq.plan.tpNamCham ? el("div", { class: "kv" }, el("span", {}, "🧲 TP nam châm TL"), el("b", { class: "mono" }, `${fmtGia(kq.plan.tpNamCham)}${kq.plan.rrNamCham ? ` (1:${kq.plan.rrNamCham})` : ""} · ${fmtUsd(kq.plan.usdNamCham)}`)) : null,
      el("div", { class: "kv" }, el("span", {}, `Khối lượng (risk ${SETTINGS.risk.riskPct}%)`), el("b", { class: "mono" }, `${kq.plan.sizing.qty} ${kq.coin} ≈ ${fmtUsd(kq.plan.sizing.giaTri)}`)),
    ));
  }
  if (kq.canhBao.length) {
    panel.appendChild(el("div", { class: "warn-box" }, ...kq.canhBao.map(w => el("div", {}, "⚠ " + w))));
  }
}

/* Canvas: nến 15m + zones — phong cách TradingView (HiDPI, trục giá/time chuẩn,
 * crosshair + pill trên trục, volume bars). Nguyên tắc SMC/indicator giữ nguyên:
 * OB (cam) · FVG (tím) · POI (xanh) · EQH/EQL (vàng đứt) · POC (vàng chấm) ·
 * Entry/SL/TP · sweep/CHoCH — chỉ thay đổi cách render. */
function veCanvasSMC(kq) {
  const canvas = $("#smc-canvas");
  if (!canvas || kq.coin !== CHART_COIN) return;
  const candles = kq.candles15;
  if (!candles?.length) return;

  /* ---- HiDPI: vẽ theo CSS pixel, scale bằng DPR cho nét ---- */
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.max(320, Math.round(canvas.clientWidth || 1200));
  const cssH = 440;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;

  /* ---- Bố cục kiểu TradingView ---- */
  const AXIS_W = 78;                       // trục giá phải
  const TIME_H = 24;                       // trục thời gian dưới
  const VOL_H = Math.round(H * 0.13);      // dải volume
  const plotW = W - AXIS_W, plotH = H - TIME_H - VOL_H, padT = 14;
  const volTop = padT + plotH;

  /* ---- Thang giá ---- */
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
  if (kq.plan) { lo = Math.min(lo, kq.plan.sl); hi = Math.max(hi, kq.plan.tp2); }
  const pad = (hi - lo) * 0.07; lo -= pad; hi += pad;
  const X = (i) => (i + 0.5) * (plotW / candles.length);
  const Y = (p) => padT + plotH * (1 - (p - lo) / (hi - lo));
  const barW = plotW / candles.length;
  const cw = Math.max(1.5, Math.min(18, barW * 0.68));

  /* ---- Nền ---- */
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);

  /* ---- Watermark (phong cách TV) ---- */
  ctx.save();
  ctx.fillStyle = "rgba(148,163,184,.10)";
  ctx.font = "800 44px Plus Jakarta Sans, sans-serif";
  ctx.fillText(`${kq.coin}USDT · 15`, 14, 58);
  ctx.restore();

  /* ---- Bước giá "đẹp" kiểu TV (1 / 2 / 2.5 / 5 × 10^n) ---- */
  const niceStep = (range, target) => {
    const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n >= 5 ? 5 : n >= 2.5 ? 2.5 : n >= 2 ? 2 : 1) * mag;
  };
  const step = niceStep(hi - lo, Math.max(3, Math.floor(plotH / 64)));

  /* ---- Zones SMC (dưới nến) ---- */
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, plotW, padT + plotH); ctx.clip();
  const veZone = (zone, mau, nhan) => {
    const y1 = Y(zone[1]), y2 = Y(zone[0]);
    ctx.fillStyle = mau;
    ctx.fillRect(0, y1, plotW, Math.max(2, y2 - y1));
    if (nhan) {
      ctx.fillStyle = "rgba(255,255,255,.72)"; ctx.font = "600 10px JetBrains Mono, monospace";
      ctx.fillText(nhan, 6, y1 + 11);
    }
  };
  for (const ob of kq.ob15 || []) veZone(ob.zone, ob.huong === "bullish" ? "rgba(255,159,28,.15)" : "rgba(255,99,72,.13)", `OB ${ob.huong === "bullish" ? "↑" : "↓"}`);
  for (const g of kq.fvg15 || []) veZone(g.zone, "rgba(155,89,255,.12)", "FVG");
  if (kq.poi) veZone(kq.poi.zone, "rgba(46,213,168,.14)", "POI ★");

  /* ---- Lưới ngang ---- */
  ctx.font = "10px JetBrains Mono, monospace";
  ctx.textBaseline = "middle";
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const y = Math.round(Y(p)) + 0.5;
    ctx.strokeStyle = "rgba(120,150,200,.09)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
  }
  /* ---- Lưới dọc + nhãn thời gian (mật độ thích ứng) ---- */
  const TF_MIN = 15;
  const steps = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96];
  const lblStep = steps.find(s => s * barW >= 84) || 96;
  const fmtGioTV = (t) => {
    const d = new Date(t);
    const opt = lblStep * TF_MIN >= 1440
      ? { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
      : { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" };
    return d.toLocaleTimeString("vi-VN", opt).replace(",", "");
  };
  ctx.fillStyle = "rgba(160,180,210,.5)";
  ctx.textAlign = "center";
  for (let i = 0; i < candles.length; i += lblStep) {
    const x = Math.round(X(i)) + 0.5;
    ctx.strokeStyle = "rgba(120,150,200,.06)";
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    ctx.fillText(fmtGioTV(candles[i].openTime), X(i), H - TIME_H / 2);
  }
  ctx.textAlign = "left";

  /* ---- Volume bars ---- */
  let volMax = 0;
  for (const c of candles) volMax = Math.max(volMax, c.volume || 0);
  if (volMax > 0) {
    ctx.strokeStyle = "rgba(120,150,200,.18)";
    ctx.beginPath(); ctx.moveTo(0, volTop + 0.5); ctx.lineTo(plotW, volTop + 0.5); ctx.stroke();
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i], v = c.volume || 0;
      const vh = Math.max(1, (v / volMax) * (VOL_H - 4));
      ctx.fillStyle = c.close >= c.open ? "rgba(46,213,168,.42)" : "rgba(255,93,108,.42)";
      ctx.fillRect(X(i) - cw / 2, volTop + VOL_H - vh, cw, vh);
    }
  }

  /* ---- Nến (TV: bấc mảnh, thân đặc) ---- */
  ctx.lineWidth = 1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], x = X(i), tang = c.close >= c.open;
    const col = tang ? "#26a69a" : "#ef5350";
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, Math.round(Y(c.high)) + 0.5);
    ctx.lineTo(Math.round(x) + 0.5, Math.round(Y(c.low)) + 0.5);
    ctx.stroke();
    const yO = Y(c.open), yC = Y(c.close);
    ctx.fillStyle = col;
    ctx.fillRect(x - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO)));
  }

  /* ---- Đường ngang SMC: EQH/EQL · POC · Entry/SL/TP ---- */
  const veHLine = (p, mau, dash, rong = 1) => {
    if (p == null) return;
    const y = Math.round(Y(p)) + 0.5;
    ctx.strokeStyle = mau; ctx.lineWidth = rong; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
  };
  for (const e of kq.mtf.eq?.eqh || []) veHLine(e.gia, "rgba(255,209,102,.75)", [5, 4]);
  for (const e of kq.mtf.eq?.eql || []) veHLine(e.gia, "rgba(255,209,102,.75)", [5, 4]);
  if (kq.mtf.poc) veHLine(kq.mtf.poc, "rgba(245,179,1,.8)", [2, 3]);
  if (kq.plan) {
    veHLine(kq.plan.entry, "#4cc9f0", [], 1.2);
    veHLine(kq.plan.sl, "#ff5d6c", [], 1.2);
    veHLine(kq.plan.tp1, "#2ed5a8", [], 1.2);
    veHLine(kq.plan.tp2, "#2ed5a8", [6, 3]);
  }

  /* ---- Đánh dấu sweep / CHoCH ---- */
  const idxBase = kq.candles15.length - candles.length;
  ctx.font = "600 11px Plus Jakarta Sans, sans-serif";
  if (kq.ltf.sweep) {
    const i = kq.ltf.sweep.index - idxBase;
    if (i >= 0 && i < candles.length) {
      ctx.fillStyle = "#ffd166";
      ctx.fillText("⚡", X(i) - 6, Y(kq.ltf.sweep.wick) + (kq.ltf.sweep.phia === "long" ? 16 : -8));
    }
  }
  if (kq.ltf.choch) {
    const i = kq.ltf.choch.index - idxBase;
    if (i >= 0 && i < candles.length) {
      ctx.fillStyle = "#4cc9f0";
      ctx.fillText("CHoCH", X(i) - 18, Y(kq.ltf.choch.mucPhaVo) - 8);
    }
  }
  ctx.restore(); // hết clip

  /* ---- Trục giá phải (nền + nhãn) ---- */
  ctx.fillStyle = "#0e1626";
  ctx.fillRect(plotW, 0, AXIS_W, H - TIME_H);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(plotW, H - TIME_H, AXIS_W, TIME_H);
  ctx.strokeStyle = "rgba(120,150,200,.14)";
  ctx.beginPath(); ctx.moveTo(plotW + 0.5, 0); ctx.lineTo(plotW + 0.5, H - TIME_H); ctx.stroke();
  ctx.font = "10px JetBrains Mono, monospace";
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const y = Y(p);
    if (y < padT - 4 || y > padT + plotH + 4) continue;
    ctx.fillStyle = "rgba(180,200,225,.65)";
    ctx.fillText(fmtGia(p), plotW + 6, y);
  }

  /* ---- Pill nhãn trên trục giá cho các đường SMC (chống đè nhau) ---- */
  const pills = [];
  for (const e of kq.mtf.eq?.eqh || []) pills.push({ p: e.gia, t: "EQH", c: "#8a6d1a", bg: "rgba(255,209,102,.16)" });
  for (const e of kq.mtf.eq?.eql || []) pills.push({ p: e.gia, t: "EQL", c: "#8a6d1a", bg: "rgba(255,209,102,.16)" });
  if (kq.mtf.poc) pills.push({ p: kq.mtf.poc, t: "POC", c: "#f5b301", bg: "rgba(245,179,1,.18)" });
  if (kq.plan) {
    pills.push({ p: kq.plan.entry, t: "ENTRY", c: "#4cc9f0", bg: "rgba(76,201,240,.16)" });
    pills.push({ p: kq.plan.sl, t: "SL", c: "#ff5d6c", bg: "rgba(255,93,108,.16)" });
    pills.push({ p: kq.plan.tp1, t: "TP1", c: "#2ed5a8", bg: "rgba(46,213,168,.16)" });
    pills.push({ p: kq.plan.tp2, t: "TP2", c: "#2ed5a8", bg: "rgba(46,213,168,.10)" });
  }
  pills.sort((a, b) => b.p - a.p);
  let lastY = -Infinity;
  for (const pl of pills) {
    let y = Math.max(padT + 7, Math.min(padT + plotH - 7, Y(pl.p)));
    if (y - lastY < 15) y = lastY + 15; // dồn xuống tránh đè
    if (y > padT + plotH - 7) continue;
    lastY = y;
    const label = `${pl.t} ${fmtGia(pl.p)}`;
    const tw = ctx.measureText(label).width + 10;
    const bx = Math.min(plotW + AXIS_W - tw - 2, plotW + 3);
    ctx.fillStyle = pl.bg;
    ctx.fillRect(bx, y - 7, tw, 14);
    ctx.fillStyle = pl.c;
    ctx.fillText(label, bx + 5, y);
  }

  /* ---- Đường GIÁ HIỆN TẠI (live) — pill màu theo tăng/giảm ---- */
  const giaLive = (typeof PRICE_HUB !== "undefined" && PRICE_HUB?.gia(kq.coin)) ?? candles[candles.length - 1].close;
  const prevClose = candles[candles.length - 2]?.close ?? giaLive;
  if (giaLive >= lo && giaLive <= hi) {
    const yG = Math.round(Y(giaLive)) + 0.5, tang = giaLive >= prevClose;
    const col = tang ? "#26a69a" : "#ef5350";
    ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yG); ctx.lineTo(plotW, yG); ctx.stroke(); ctx.setLineDash([]);
    const txt = fmtGia(giaLive), tw = ctx.measureText(txt).width + 10;
    ctx.fillStyle = col;
    ctx.fillRect(plotW + 1, yG - 8, AXIS_W - 2, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(txt, plotW + 6, yG);
  }

  /* ---- Crosshair kiểu TV: đường đứt + pill giá trên trục + pill giờ dưới trục ---- */
  if (CHART_HOVER && CHART_HOVER.x < plotW && CHART_HOVER.y < padT + plotH + VOL_H) {
    const { x, y } = CHART_HOVER;
    ctx.strokeStyle = "rgba(180,200,225,.35)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, padT + plotH + VOL_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(plotW, Math.round(y) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    // pill giá trên trục phải
    const giaCh = lo + (hi - lo) * (1 - (y - padT) / plotH);
    const tGia = fmtGia(giaCh);
    ctx.fillStyle = "#5b6b85";
    ctx.fillRect(plotW + 1, y - 8, AXIS_W - 2, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(tGia, plotW + 6, y);
    // pill thời gian trên trục dưới
    const iCh = clamp(Math.round(x / plotW * candles.length - 0.5), 0, candles.length - 1);
    const tGio = fmtGioTV(candles[iCh].openTime), twT = ctx.measureText(tGio).width + 12;
    const bxT = clamp(x - twT / 2, 2, plotW - twT - 2);
    ctx.fillStyle = "#5b6b85";
    ctx.fillRect(bxT, H - TIME_H + 4, twT, 16);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.fillText(tGio, bxT + twT / 2, H - TIME_H + 12);
    ctx.textAlign = "left";
  }
  ctx.textBaseline = "alphabetic";
}

/* ================= TÍN HIỆU ================= */
function renderTinHieu(root) {
  root.innerHTML = "";
  const bar = el("div", { class: "toolbar" },
    el("span", { class: "muted" }, `Quét ${SETTINGS.watchlist.length} coin · làm mới mỗi ${Math.round(SETTINGS.refreshTinHieuSec / 60)} phút · điểm ≥ ${VERDICT.ALERT} = tín hiệu vào lệnh`),
    el("button", { class: "btn", onclick: () => quetTatCa(true) }, "🔄 Quét lại tất cả"),
  );
  root.appendChild(bar);
  const grid = el("div", { class: "signal-grid", id: "signal-grid" });
  for (const coin of SETTINGS.watchlist) {
    grid.appendChild(el("div", { class: "card signal-card", id: `sc-${coin}` },
      el("div", { class: "card-title" }, `${coin}/USDT`), el("p", { class: "muted" }, "Đang phân tích…")));
  }
  root.appendChild(grid);
  for (const coin of SETTINGS.watchlist) {
    const kq = SIGNAL_CACHE.get(coin);
    if (kq) veTheTinHieu(kq);
  }
}

function veTheTinHieu(kq) {
  const card = $(`#sc-${kq.coin}`);
  if (!card) return;
  card.innerHTML = "";
  card.className = `card signal-card v-${biasClass(kq.verdict)}`;

  card.appendChild(el("div", { class: "sig-head" },
    el("div", {},
      el("span", { class: "coin-name" }, `${kq.coin}/USDT`),
      el("span", { class: "mono muted", style: "margin-left:8px" }, fmtGia(PRICE_HUB?.gia(kq.coin) ?? kq.gia))),
    el("span", { class: `badge big ${biasClass(kq.verdict)}` }, verdictLabel(kq.verdict)),
  ));

  // Thanh điểm
  const scoreBar = el("div", { class: "score-bar" },
    el("div", { class: "score-fill " + (kq.score >= VERDICT.ALERT ? "hot" : kq.score >= VERDICT.PREPARE ? "warm" : ""), style: `width:${kq.score}%` }));
  card.appendChild(el("div", { class: "kv" }, el("span", {}, `Điểm hợp lưu`), el("b", {}, `${kq.score}/100`)));
  card.appendChild(scoreBar);
  card.appendChild(el("div", { class: "kv" }, el("span", {}, "Pha"), el("b", {}, kq.phaseLabel)));
  card.appendChild(el("div", { class: "kv" }, el("span", {}, "Bias 4H"), el("b", { class: biasClass(kq.htf.bias) }, biasLabel(kq.htf.bias))));
  if (kq.dongTien) {
    const dt = kq.dongTien;
    const cls = dt.score >= 15 ? "up" : dt.score <= -15 ? "down" : "muted";
    card.appendChild(el("div", { class: "kv" }, el("span", {}, "🌊 Dòng tiền đa sàn"),
      el("b", { class: cls }, `${dt.score > 0 ? "+" : ""}${dt.score} · ${dt.huong}${dt.dongThuan ? " ✓" : dt.nguoc ? " ⚠ngược" : ""}`)));
    if (dt.thanhLy15p?.tong > 1e6) card.appendChild(el("div", { class: "kv" }, el("span", {}, "💥 Thanh lý 15ph"),
      el("b", { class: "mono" }, `${fmtUsd(dt.thanhLy15p.tong)} (L ${fmtUsd(dt.thanhLy15p.long)}/S ${fmtUsd(dt.thanhLy15p.short)})`)));
  }
  if (kq.heatmap?.namCham && kq.heatmap.namCham.huong !== "can_bang") {
    const nc = kq.heatmap.namCham;
    card.appendChild(el("div", { class: "kv" }, el("span", {}, "🧲 Heatmap TL"),
      el("b", { class: nc.huong === "len" ? "up" : "down" },
        `${nc.huong === "len" ? "hút lên" : "hút xuống"} ${nc.huong === "len" && nc.cumGanNhatTren ? fmtGia(nc.cumGanNhatTren.mid) : nc.cumGanNhatDuoi ? fmtGia(nc.cumGanNhatDuoi.mid) : ""}`)));
  }

  // Quy trình 5 bước
  const steps = [
    { t: "Chờ", on: !!kq.side },
    { t: "Quét TK", on: !!kq.ltf.sweep },
    { t: "CHoCH", on: !!kq.ltf.choch },
    { t: "Retest", on: kq.retest === "held" || kq.retest === "testing" },
    { t: "Vào lệnh", on: kq.phase === "alert_ready" },
  ];
  card.appendChild(el("div", { class: "steps" }, ...steps.map((s, i) =>
    el("span", { class: "step " + (s.on ? "on" : "") }, `${i + 1}.${s.t}`))));

  // Kế hoạch
  if (kq.plan) {
    card.appendChild(el("div", { class: "plan-mini " + kq.plan.side },
      el("span", {}, `E ${fmtGia(kq.plan.entry)}`),
      el("span", { class: "down" }, `SL ${fmtGia(kq.plan.sl)}`),
      el("span", { class: "up" }, `TP1 ${fmtGia(kq.plan.tp1)}`),
      el("span", { class: "up" }, `TP2 ${fmtGia(kq.plan.tp2)}`),
      el("span", { class: "muted" }, `RR 1:${kq.plan.rr1}`),
    ));
  }

  // Checklist chi tiết (thu gọn)
  const det = el("details", {},
    el("summary", {}, "Checklist hợp lưu chi tiết"),
    ...kq.checklist.map(c => el("div", { class: "chk " + (c.dat ? "ok" : "") },
      el("span", {}, `${c.dat ? "✅" : "▫️"} ${c.ten}`),
      el("b", {}, `${c.diem}/${c.max}`),
      el("div", { class: "muted small" }, c.ghiChu))),
    kq.killzone.active ? el("div", { class: "chk ok" }, el("span", {}, `🔥 Killzone: ${kq.killzone.ten}`), el("b", {}, `+${KILLZONE_BONUS}`)) : null,
  );
  card.appendChild(det);

  if (kq.canhBao.length) {
    card.appendChild(el("details", { class: "warn-det" },
      el("summary", {}, `⚠ ${kq.canhBao.length} cảnh báo`),
      ...kq.canhBao.map(w => el("div", { class: "small" }, "• " + w))));
  }
  card.appendChild(el("div", { class: "muted tiny" }, `Cập nhật ${fmtGio(kq.time)} · Mọi quyết định lệnh thật do BẠN xác nhận`));
  card.appendChild(el("div", { class: "row-gap" },
    el("button", { class: "btn small", onclick: () => { location.hash = `#/bieudo?coin=${kq.coin}`; } }, "Xem chart"),
    el("button", { class: "btn small", onclick: () => quetCoin(kq.coin, true) }, "Quét lại"),
  ));
}
