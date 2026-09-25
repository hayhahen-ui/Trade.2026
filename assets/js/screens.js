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
    CHART_HOVER = { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
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

/* Canvas: nến 15m + zones — real-time với lưới, trục thời gian, crosshair */
function veCanvasSMC(kq) {
  const canvas = $("#smc-canvas");
  if (!canvas || kq.coin !== CHART_COIN) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, padR = 74, padT = 14, padB = 26;
  ctx.clearRect(0, 0, W, H);
  const candles = kq.candles15;
  if (!candles?.length) return;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
  if (kq.plan) { lo = Math.min(lo, kq.plan.sl); hi = Math.max(hi, kq.plan.tp2); }
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const X = (i) => (W - padR) * (i / candles.length) + 2;
  const Y = (p) => padT + (H - padT - padB) * (1 - (p - lo) / (hi - lo));
  const cw = Math.max(2, (W - padR) / candles.length - 2);

  // Lưới giá ngang + nhãn trục phải
  ctx.font = "10px JetBrains Mono, monospace";
  const soMuc = 5;
  for (let g = 0; g <= soMuc; g++) {
    const p = lo + (hi - lo) * g / soMuc;
    ctx.strokeStyle = "rgba(120,150,200,.10)";
    ctx.beginPath(); ctx.moveTo(0, Y(p)); ctx.lineTo(W - padR, Y(p)); ctx.stroke();
    ctx.fillStyle = "rgba(160,180,210,.45)";
    ctx.fillText(fmtGia(p), W - padR + 4, Y(p) + 3);
  }
  // Nhãn thời gian (4 mốc)
  for (let g = 0; g <= 3; g++) {
    const i = Math.min(candles.length - 1, Math.round(candles.length * g / 3));
    const c = candles[i];
    ctx.fillStyle = "rgba(160,180,210,.45)";
    const nhan = new Date(c.openTime).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
    ctx.fillText(nhan, Math.min(X(i), W - padR - 34), H - 8);
  }

  // vẽ vùng zone helper
  const veZone = (zone, mau, nhan) => {
    const y1 = Y(zone[1]), y2 = Y(zone[0]);
    ctx.fillStyle = mau;
    ctx.fillRect(0, y1, W - padR, Math.max(2, y2 - y1));
    if (nhan) { ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.font = "10px JetBrains Mono, monospace"; ctx.fillText(nhan, 4, y1 + 10); }
  };
  for (const ob of kq.ob15 || []) veZone(ob.zone, ob.huong === "bullish" ? "rgba(255,159,28,.16)" : "rgba(255,99,72,.14)", `OB ${ob.huong === "bullish" ? "↑" : "↓"}`);
  for (const g of kq.fvg15 || []) veZone(g.zone, "rgba(155,89,255,.13)", "FVG");
  if (kq.poi) veZone(kq.poi.zone, "rgba(46,213,168,.15)", "POI ★");

  // EQH/EQL + POC
  const veLine = (p, mau, dash, nhan) => {
    if (p == null) return;
    ctx.strokeStyle = mau; ctx.setLineDash(dash); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(p)); ctx.lineTo(W - padR, Y(p)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = mau; ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillText(`${nhan} ${fmtGia(p)}`, W - padR + 4, Y(p) + 3);
  };
  for (const e of kq.mtf.eq?.eqh || []) veLine(e.gia, "#ffd166", [5, 4], "EQH");
  for (const e of kq.mtf.eq?.eql || []) veLine(e.gia, "#ffd166", [5, 4], "EQL");
  if (kq.mtf.poc) veLine(kq.mtf.poc, "#f5b301", [2, 3], "POC");
  if (kq.plan) {
    veLine(kq.plan.entry, "#4cc9f0", [], "ENTRY");
    veLine(kq.plan.sl, "#ff5d6c", [], "SL");
    veLine(kq.plan.tp1, "#2ed5a8", [], "TP1");
    veLine(kq.plan.tp2, "#2ed5a8", [6, 3], "TP2");
  }

  // nến
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const x = X(i);
    const tang = c.close >= c.open;
    ctx.strokeStyle = tang ? "#2ed5a8" : "#ff5d6c";
    ctx.fillStyle = tang ? "rgba(46,213,168,.9)" : "rgba(255,93,108,.9)";
    ctx.beginPath(); ctx.moveTo(x + cw / 2, Y(c.high)); ctx.lineTo(x + cw / 2, Y(c.low)); ctx.stroke();
    const yO = Y(c.open), yC = Y(c.close);
    ctx.fillRect(x, Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO)));
  }
  // đánh dấu sweep/choch
  ctx.font = "11px Plus Jakarta Sans, sans-serif";
  const idx0 = candles[0] ? kq.candles15.length - candles.length : 0;
  if (kq.ltf.sweep) {
    const i = kq.ltf.sweep.index - (kq.candles15.length - candles.length);
    if (i >= 0 && i < candles.length) { ctx.fillStyle = "#ffd166"; ctx.fillText("⚡sweep", X(i) - 14, Y(kq.ltf.sweep.wick) + (kq.ltf.sweep.phia === "long" ? 14 : -6)); }
  }
  if (kq.ltf.choch) {
    const i = kq.ltf.choch.index - (kq.candles15.length - candles.length);
    if (i >= 0 && i < candles.length) { ctx.fillStyle = "#4cc9f0"; ctx.fillText("CHoCH", X(i) - 14, Y(kq.ltf.choch.mucPhaVo) - 6); }
  }

  // Đường GIÁ HIỆN TẠI (live) — nhãn nền vàng bên phải
  const giaLive = PRICE_HUB?.gia(kq.coin) ?? candles[candles.length - 1].close;
  if (giaLive >= lo && giaLive <= hi) {
    const yG = Y(giaLive);
    ctx.strokeStyle = "rgba(245,179,1,.85)"; ctx.setLineDash([2, 2]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, yG); ctx.lineTo(W - padR, yG); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#f5b301";
    ctx.fillRect(W - padR + 1, yG - 8, padR - 2, 15);
    ctx.fillStyle = "#1a1205";
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.fillText(fmtGia(giaLive), W - padR + 4, yG + 3);
    ctx.font = "10px JetBrains Mono, monospace";
  }

  // Crosshair khi rê chuột
  if (CHART_HOVER && CHART_HOVER.x < W - padR) {
    const { x, y } = CHART_HOVER;
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    const giaCh = lo + (hi - lo) * (1 - (y - padT) / (H - padT - padB));
    const iCh = clamp(Math.round(x / (W - padR) * candles.length), 0, candles.length - 1);
    const cCh = candles[iCh];
    const nhanGio = new Date(cCh.openTime).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
    const txt = `${fmtGia(giaCh)} · ${nhanGio} · O${fmtGia(cCh.open)} H${fmtGia(cCh.high)} L${fmtGia(cCh.low)} C${fmtGia(cCh.close)}`;
    ctx.font = "11px JetBrains Mono, monospace";
    const tw = ctx.measureText(txt).width + 12;
    const bx = clamp(x + 10, 4, W - padR - tw - 4), by = clamp(y - 26, 4, H - 40);
    ctx.fillStyle = "rgba(10,18,34,.92)";
    ctx.fillRect(bx, by, tw, 18);
    ctx.strokeStyle = "rgba(245,179,1,.5)"; ctx.strokeRect(bx, by, tw, 18);
    ctx.fillStyle = "#e8eefb";
    ctx.fillText(txt, bx + 6, by + 13);
  }
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
