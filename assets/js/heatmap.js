/* ============================================================
 * Trade.2026 — Liquidation Heatmap (kiểu Coinglass) — real-time
 *
 * MÔ HÌNH (chuẩn ngành, như Coinglass Model 1):
 *  · Mỗi nến: một phần khối lượng là vị thế đòn bẩy mới mở tại giá đó
 *    (phân bổ 5x/10x/25x/50x/100x theo trọng số hành vi thị trường)
 *  · Long mở tại P → mức thanh lý ≈ P·(1 − 1/lev); Short → P·(1 + 1/lev)
 *  · Thanh khoản TÍCH LŨY tại từng mức giá, bị TIÊU khi giá quét qua
 *    (đúng bản chất dải màu Coinglass tồn tại tới khi bị quét)
 *  · Đè thêm THANH LÝ THẬT từ DataHub (Bybit/Binance-F/OKX) làm điểm nóng
 *
 * ĐẤU NỐI: cụm thanh lý = NAM CHÂM GIÁ (giá thường được kéo tới cụm lớn
 * gần nhất để lấy thanh khoản) → engine dùng làm vùng giá mục tiêu/TP,
 * cảnh báo hút giá, cân bằng trên/dưới bổ trợ Long/Short.
 * ============================================================ */
"use strict";

const HM_TIMEFRAMES = [
  { id: "12h", ten: "12 giờ",  interval: "5m",  limit: 144 },
  { id: "24h", ten: "24 giờ",  interval: "15m", limit: 96  },
  { id: "3d",  ten: "3 ngày",  interval: "30m", limit: 144 },
  { id: "1w",  ten: "1 tuần",  interval: "1h",  limit: 168 },
  { id: "1M",  ten: "1 tháng", interval: "4h",  limit: 180 },
];
/* Phân bổ đòn bẩy giả định (tỷ trọng vị thế mở theo lev phổ biến) */
const HM_LEV_MODEL = [
  { lev: 10,  w: 0.32 },
  { lev: 25,  w: 0.28 },
  { lev: 50,  w: 0.22 },
  { lev: 100, w: 0.18 },
];
const HM_BINS = 130;            // số mức giá
const HM_VOL_FRACTION = 0.35;   // phần khối lượng coi là vị thế mới có đòn bẩy

const HEATMAP_CACHE = new Map();  // coin|tf → {hm, at}
let HM_STATE = { coin: "BTC", tf: "24h", nguong: 0.25 };

/* ---------- Tính heatmap ---------- */
async function tinhHeatmap(coin, tfId, force = false) {
  const key = `${coin}|${tfId}`;
  const cu = HEATMAP_CACHE.get(key);
  if (!force && cu && Date.now() - cu.at < 3 * 60e3) return cu.hm;
  const tf = HM_TIMEFRAMES.find((t) => t.id === tfId) || HM_TIMEFRAMES[1];
  const candles = await fetchKlines(coin, tf.interval, tf.limit);
  if (!candles?.length) throw new Error("Không có dữ liệu nến");

  // Dải giá hiển thị: quanh vùng giá chạy + đệm 2.5%
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
  const pad = (hi - lo) * 0.35 + (hi + lo) / 2 * 0.005;
  lo -= pad; hi += pad;
  const binH = (hi - lo) / HM_BINS;
  const binOf = (p) => Math.floor((p - lo) / binH);

  const levels = new Float64Array(HM_BINS);  // $ thanh lý ước tính còn tồn tại
  const cols = [];                           // snapshot theo từng nến
  for (const c of candles) {
    // 1) TIÊU: giá quét qua [low, high] → thanh khoản tại đó đã bị thanh lý
    const b0 = clamp(binOf(c.low), 0, HM_BINS - 1);
    const b1 = clamp(binOf(c.high), 0, HM_BINS - 1);
    for (let b = b0; b <= b1; b++) levels[b] = 0;
    // 2) THÊM: vị thế mới mở trong nến này
    const quoteVol = (c.volume || 0) * c.close * HM_VOL_FRACTION;
    for (const { lev, w } of HM_LEV_MODEL) {
      const usd = quoteVol * w * 0.5; // chia đôi long/short
      const liqLong = c.close * (1 - 1 / lev);
      const liqShort = c.close * (1 + 1 / lev);
      const bL = binOf(liqLong), bS = binOf(liqShort);
      if (bL >= 0 && bL < HM_BINS) levels[bL] += usd;
      if (bS >= 0 && bS < HM_BINS) levels[bS] += usd;
    }
    cols.push(levels.slice());
  }
  // chuẩn hóa màu theo phân vị 98 (tránh 1 cụm làm chìm tất cả)
  const all = [];
  for (const col of cols) for (let b = 0; b < HM_BINS; b++) if (col[b] > 0) all.push(col[b]);
  all.sort((a, b) => a - b);
  const maxVal = all.length ? all[Math.min(all.length - 1, Math.floor(all.length * 0.98))] : 1;

  const hm = { coin, tfId, interval: tf.interval, candles, cols, lo, hi, binH, maxVal, levels: levels.slice(), at: Date.now() };
  HEATMAP_CACHE.set(key, { hm, at: Date.now() });
  return hm;
}

/* ---------- Phân tích cụm: nam châm giá ---------- */
function phanTichHeatmap(hm, giaHienTai) {
  const nguong = hm.maxVal * 0.22;
  const clusters = [];
  let dang = null;
  for (let b = 0; b < HM_BINS; b++) {
    const v = hm.levels[b];
    if (v >= nguong) {
      const gia = hm.lo + (b + 0.5) * hm.binH;
      if (dang) { dang.giaDen = gia; dang.usd += v; dang.dinh = Math.max(dang.dinh, v); }
      else dang = { giaTu: gia, giaDen: gia, usd: v, dinh: v };
    } else if (dang) { clusters.push(dang); dang = null; }
  }
  if (dang) clusters.push(dang);
  for (const c of clusters) c.mid = (c.giaTu + c.giaDen) / 2;

  const tren = clusters.filter((c) => c.mid > giaHienTai).sort((a, b) => a.mid - b.mid);
  const duoi = clusters.filter((c) => c.mid < giaHienTai).sort((a, b) => b.mid - a.mid);
  const tongTren = tren.reduce((s, c) => s + c.usd, 0);
  const tongDuoi = duoi.reduce((s, c) => s + c.usd, 0);
  const tong = tongTren + tongDuoi;
  // Nam châm: phía nào nhiều thanh khoản chưa quét hơn → giá dễ bị hút về phía đó
  let namCham = null;
  if (tong > 0) {
    const lech = (tongTren - tongDuoi) / tong; // -1..1
    namCham = {
      huong: lech > 0.2 ? "len" : lech < -0.2 ? "xuong" : "can_bang",
      lechPct: Math.round(lech * 100),
      cumGanNhatTren: tren[0] || null,
      cumLonNhatTren: [...tren].sort((a, b) => b.usd - a.usd)[0] || null,
      cumGanNhatDuoi: duoi[0] || null,
      cumLonNhatDuoi: [...duoi].sort((a, b) => b.usd - a.usd)[0] || null,
    };
  }
  return { clusters, tren: tren.slice(0, 4), duoi: duoi.slice(0, 4), tongTren, tongDuoi, namCham };
}

/* Bản nhanh cho engine (cache 5 phút, khung 24h) */
async function heatmapChoEngine(coin) {
  try {
    const hm = await tinhHeatmap(coin, "24h");
    const gia = PRICE_HUB?.gia(coin) ?? hm.candles[hm.candles.length - 1].close;
    return { ...phanTichHeatmap(hm, gia), at: hm.at };
  } catch { return null; }
}

/* ---------- Màu viridis (tím → xanh → vàng, chuẩn Coinglass) ---------- */
function viridis(t) {
  t = clamp(t, 0, 1);
  const stops = [
    [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
    [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
  ];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* ---------- Vẽ heatmap ---------- */
function veHeatmapCanvas(hm, canvas, nguongLoc = 0.25) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const padR = 76, padB = 24, padL = 26, padT = 8;
  const plotW = W - padR - padL, plotH = H - padB - padT;
  const n = hm.cols.length;
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, W, H);

  const X = (i) => padL + (i / n) * plotW;
  const Y = (p) => padT + plotH * (1 - (p - hm.lo) / (hm.hi - hm.lo));
  const colW = Math.ceil(plotW / n) + 1;
  const rowH = Math.ceil(plotH / HM_BINS) + 1;

  // nền tím (0)
  ctx.fillStyle = viridis(0);
  ctx.fillRect(padL, padT, plotW, plotH);
  // dải thanh khoản
  for (let i = 0; i < n; i++) {
    const col = hm.cols[i];
    for (let b = 0; b < HM_BINS; b++) {
      const v = col[b];
      if (v <= 0) continue;
      const t = Math.min(1, v / hm.maxVal);
      if (t < nguongLoc * 0.25) continue;
      ctx.fillStyle = viridis(0.12 + t * 0.88);
      ctx.fillRect(X(i), Y(hm.lo + (b + 1) * hm.binH), colW, rowH);
    }
  }

  // nến đè lên
  const cw = Math.max(1.5, plotW / n - 1.5);
  for (let i = 0; i < n; i++) {
    const c = hm.candles[i];
    const x = X(i) + colW / 2;
    const tang = c.close >= c.open;
    ctx.strokeStyle = tang ? "#2ed5a8" : "#ff5d6c";
    ctx.beginPath(); ctx.moveTo(x, Y(c.high)); ctx.lineTo(x, Y(c.low)); ctx.stroke();
    ctx.fillStyle = tang ? "#2ed5a8" : "#ff5d6c";
    const yO = Y(c.open), yC = Y(c.close);
    ctx.fillRect(x - cw / 2, Math.min(yO, yC), cw, Math.max(1.2, Math.abs(yC - yO)));
  }

  // thanh lý THẬT từ DataHub (chấm trắng/đỏ)
  try {
    if (window.DataHub) {
      const t0 = hm.candles[0].openTime;
      for (const l of DataHub.liqs(400)) {
        if (l.coin !== hm.coin || l.ts < t0 || l.price < hm.lo || l.price > hm.hi) continue;
        const i = Math.min(n - 1, Math.floor((l.ts - t0) / ((hm.candles[1]?.openTime || t0 + 1) - t0)));
        ctx.fillStyle = l.huong === "LONG" ? "rgba(255,93,108,.95)" : "rgba(255,255,255,.95)";
        const r = Math.min(6, 2 + Math.log10(Math.max(10, l.usd)) - 3);
        ctx.beginPath(); ctx.arc(X(i) + colW / 2, Y(l.price), Math.max(1.5, r), 0, Math.PI * 2); ctx.fill();
      }
    }
  } catch (e) {}

  // giá hiện tại
  const giaLive = PRICE_HUB?.gia(hm.coin) ?? hm.candles[n - 1].close;
  if (giaLive >= hm.lo && giaLive <= hm.hi) {
    const y = Y(giaLive);
    ctx.strokeStyle = "#f5b301"; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#f5b301"; ctx.fillRect(W - padR + 1, y - 8, padR - 2, 15);
    ctx.fillStyle = "#1a1205"; ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.fillText(fmtGia(giaLive), W - padR + 4, y + 3);
  }

  // trục giá phải
  ctx.font = "10px JetBrains Mono, monospace";
  for (let g = 0; g <= 6; g++) {
    const p = hm.lo + (hm.hi - hm.lo) * g / 6;
    ctx.fillStyle = "rgba(180,195,220,.55)";
    ctx.fillText(fmtGia(p), W - padR + 4, Y(p) + 3);
  }
  // trục thời gian
  for (let g = 0; g <= 4; g++) {
    const i = Math.min(n - 1, Math.round(n * g / 4));
    const d = new Date(hm.candles[i].openTime);
    const nhan = hm.tfId === "1w" || hm.tfId === "1M" || hm.tfId === "3d"
      ? d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" })
      : d.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
    ctx.fillStyle = "rgba(180,195,220,.55)";
    ctx.fillText(nhan, Math.min(X(i), W - padR - 36), H - 8);
  }
  // thang màu trái
  const scaleH = plotH * 0.75, scaleY = padT + (plotH - scaleH) / 2;
  for (let s = 0; s < scaleH; s++) {
    ctx.fillStyle = viridis(1 - s / scaleH);
    ctx.fillRect(4, scaleY + s, 10, 1.5);
  }
  ctx.fillStyle = "rgba(220,230,245,.8)"; ctx.font = "9px JetBrains Mono, monospace";
  ctx.save(); ctx.translate(12, scaleY - 6); ctx.fillText(fmtUsd(hm.maxVal), -8, 0); ctx.restore();
}

/* ================= MÀN HÌNH BẢN ĐỒ THANH LÝ ================= */
function renderHeatmap(root, params = {}) {
  if (params.coin) HM_STATE.coin = params.coin;
  root.innerHTML = "";
  root.appendChild(el("div", { class: "note-box" },
    "🔥 ", el("b", {}, "Liquidation Heatmap"), " — dải màu = thanh khoản thanh lý ƯỚC TÍNH còn tồn tại (mô hình đòn bẩy 10x/25x/50x/100x từ volume, tự tiêu khi giá quét qua — cùng phương pháp Coinglass Model 1) + chấm trắng/đỏ = thanh lý THẬT real-time từ DataHub. Cụm sáng = ", el("b", {}, "nam châm giá"), " — thị trường thường kéo giá tới đó lấy thanh khoản trước khi đảo chiều."));

  const bar = el("div", { class: "toolbar" });
  const sel = el("select", { class: "input", onchange: (e) => { HM_STATE.coin = e.target.value; renderHeatmap(root); } });
  for (const c of SETTINGS.watchlist) sel.appendChild(el("option", { value: c, ...(c === HM_STATE.coin ? { selected: "" } : {}) }, `${c}/USDT`));
  bar.appendChild(el("label", { class: "muted small" }, "Coin: "));
  bar.appendChild(sel);
  for (const tf of HM_TIMEFRAMES) {
    bar.appendChild(el("button", {
      class: "btn small " + (HM_STATE.tf === tf.id ? "primary" : ""),
      onclick: () => { HM_STATE.tf = tf.id; renderHeatmap(root); },
    }, tf.ten));
  }
  bar.appendChild(el("button", { class: "btn small", onclick: () => capNhatHeatmapUI(true) }, "🔄"));
  const lbl = el("span", { class: "muted small" }, `Ngưỡng lọc ${Math.round(HM_STATE.nguong * 100)}%`);
  const sli = el("input", { type: "range", min: "0", max: "80", step: "5", value: String(HM_STATE.nguong * 100), style: "width:110px" });
  sli.addEventListener("input", (e) => { HM_STATE.nguong = +e.target.value / 100; lbl.textContent = `Ngưỡng lọc ${e.target.value}%`; capNhatHeatmapUI(false); });
  bar.appendChild(lbl); bar.appendChild(sli);
  root.appendChild(bar);

  const card = el("div", { class: "card", style: "padding:8px" },
    el("div", { class: "card-title", style: "display:flex;gap:10px;align-items:center;padding:4px 8px 0" },
      `🔥 ${HM_STATE.coin}/USDT Liquidation Heatmap — ${HM_TIMEFRAMES.find(t => t.id === HM_STATE.tf).ten}`,
      el("span", { class: "live-badge" }, "● LIVE"),
      el("span", { class: "muted tiny", id: "hm-updated" }, "")),
    el("canvas", { id: "hm-canvas", class: "smc-canvas", width: "1240", height: "520" }));
  root.appendChild(card);
  root.appendChild(el("div", { id: "hm-analysis" }));
  capNhatHeatmapUI(false);
}

async function capNhatHeatmapUI(force) {
  const canvas = $("#hm-canvas");
  if (!canvas) return;
  const box = $("#hm-analysis");
  try {
    const hm = await tinhHeatmap(HM_STATE.coin, HM_STATE.tf, force);
    veHeatmapCanvas(hm, canvas, HM_STATE.nguong);
    const u = $("#hm-updated"); if (u) u.textContent = "cập nhật " + fmtGio(hm.at);
    if (box) veHeatmapAnalysis(box, hm);
  } catch (e) {
    if (box) { box.innerHTML = ""; box.appendChild(el("div", { class: "warn-box" }, "Lỗi heatmap: " + (e.message || e))); }
  }
}

function veHeatmapAnalysis(box, hm) {
  const gia = PRICE_HUB?.gia(hm.coin) ?? hm.candles[hm.candles.length - 1].close;
  const pt = phanTichHeatmap(hm, gia);
  box.innerHTML = "";
  const grid = el("div", { class: "whale-grid" });

  // Cột 1: cụm thanh khoản
  const c1 = el("div", { class: "card" }, el("div", { class: "card-title" }, "🧲 Cụm thanh lý (nam châm giá) — ước tính"));
  const veCum = (ds, nhan, cls) => {
    c1.appendChild(el("b", { class: "small " + cls }, nhan));
    if (!ds.length) { c1.appendChild(el("p", { class: "muted small" }, "Không có cụm đáng kể")); return; }
    const tbl = el("table", { class: "mini-table" });
    tbl.appendChild(el("tr", {}, el("th", {}, "Vùng giá"), el("th", {}, "Cách giá"), el("th", {}, "Cường độ")));
    for (const c of ds) {
      tbl.appendChild(el("tr", {},
        el("td", { class: "mono" }, `${fmtGia(c.giaTu)} – ${fmtGia(c.giaDen)}`),
        el("td", { class: "mono" }, fmtPct((c.mid - gia) / gia * 100)),
        el("td", { class: "mono strong" }, fmtUsd(c.usd))));
    }
    c1.appendChild(tbl);
  };
  veCum(pt.tren, `▲ PHÍA TRÊN (tổng ${fmtUsd(pt.tongTren)}) — short bị thanh lý nếu giá lên`, "up");
  veCum(pt.duoi, `▼ PHÍA DƯỚI (tổng ${fmtUsd(pt.tongDuoi)}) — long bị thanh lý nếu giá xuống`, "down");
  grid.appendChild(c1);

  // Cột 2: quyết định tối ưu — kết hợp toàn hệ thống
  const c2 = el("div", { class: "card" }, el("div", { class: "card-title" }, "🎯 Quyết định tối ưu — heatmap × SMC × dòng tiền"));
  const kq = SIGNAL_CACHE.get(hm.coin);
  const nc = pt.namCham;
  if (nc) {
    const nhanNC = nc.huong === "len" ? `🧲 Nam châm HÚT LÊN (thanh khoản trên nhiều hơn ${Math.abs(nc.lechPct)}%)`
      : nc.huong === "xuong" ? `🧲 Nam châm HÚT XUỐNG (thanh khoản dưới nhiều hơn ${Math.abs(nc.lechPct)}%)`
      : "⚖️ Thanh khoản hai phía cân bằng";
    c2.appendChild(el("div", { class: `verdict ${nc.huong === "len" ? "long" : nc.huong === "xuong" ? "short" : "neutral"}` }, nhanNC));
  }
  const kv = (a, b, cls) => c2.appendChild(el("div", { class: "kv" }, el("span", {}, a), el("b", { class: "mono " + (cls || "") }, b)));
  if (nc?.cumGanNhatTren) kv("Mục tiêu gần nhất phía trên", `${fmtGia(nc.cumGanNhatTren.mid)} (${fmtUsd(nc.cumGanNhatTren.usd)})`, "up");
  if (nc?.cumGanNhatDuoi) kv("Mục tiêu gần nhất phía dưới", `${fmtGia(nc.cumGanNhatDuoi.mid)} (${fmtUsd(nc.cumGanNhatDuoi.usd)})`, "down");
  if (kq) {
    kv("Tín hiệu SMC", `${verdictLabel(kq.verdict)} · ${kq.score}đ · bias 4H ${biasLabel(kq.htf.bias)}`);
    if (kq.dongTien) kv("Dòng tiền đa sàn", `${kq.dongTien.score > 0 ? "+" : ""}${kq.dongTien.score} (${kq.dongTien.huong})`);
  }
  // Kịch bản tối ưu
  const kb = [];
  if (nc) {
    if (kq?.side === "long" || (!kq?.side && nc.huong === "len")) {
      if (nc.cumGanNhatDuoi) kb.push(`LONG tối ưu: chờ giá QUÉT cụm dưới ${fmtGia(nc.cumGanNhatDuoi.mid)} (stop hunt) rồi bật lên mới vào — SL dưới cụm, TP tại cụm trên ${nc.cumGanNhatTren ? fmtGia(nc.cumGanNhatTren.mid) : "gần nhất"}.`);
      else if (nc.cumGanNhatTren) kb.push(`LONG theo nam châm: mục tiêu ${fmtGia(nc.cumGanNhatTren.mid)}; vào khi có xác nhận SMC, tránh fomo đuổi giá.`);
    }
    if (kq?.side === "short" || (!kq?.side && nc.huong === "xuong")) {
      if (nc.cumGanNhatTren) kb.push(`SHORT tối ưu: chờ giá QUÉT cụm trên ${fmtGia(nc.cumGanNhatTren.mid)} rồi gãy xuống mới vào — SL trên cụm, TP tại cụm dưới ${nc.cumGanNhatDuoi ? fmtGia(nc.cumGanNhatDuoi.mid) : "gần nhất"}.`);
    }
    if (!kb.length) kb.push("Chưa có hợp lưu rõ giữa heatmap và tín hiệu SMC — đứng ngoài quan sát cụm bị quét.");
  }
  for (const k of kb) c2.appendChild(el("div", { class: "safety-item" }, el("span", {}, "→"), el("span", { class: "small" }, k)));
  c2.appendChild(el("div", { class: "row-gap" },
    el("button", { class: "btn small primary", onclick: () => moDatLenh({ coin: hm.coin, side: kq?.side || (nc?.huong === "len" ? "long" : "short") }) }, "🛒 Đặt lệnh"),
    el("button", { class: "btn small", onclick: () => { location.hash = `#/bieudo?coin=${hm.coin}`; } }, "Chart"),
    el("button", { class: "btn small", onclick: () => { location.hash = `#/ragauto?coin=${hm.coin}`; } }, "🧬 RAG")));
  c2.appendChild(el("p", { class: "muted tiny" }, "Số liệu là ƯỚC TÍNH tương đối từ mô hình + volume công khai (không phải số dư vị thế thật của sàn). Quyết định cuối cùng luôn thuộc về bạn."));
  grid.appendChild(c2);
  box.appendChild(grid);
}
