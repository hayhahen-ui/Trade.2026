/* Trade.2026 v2.0.0 — Harness kiểm thử hàm thuần (node)
 * Chạy: node tools/harness_v2.js
 * Kiểm tra các bản vá P0/P1 mà không cần trình duyệt:
 *  - ta.js: EMA/RSI/ATR không lan NaN với null/NaN/Infinity
 *  - smc.js: bodyClose thật/giả, CHoCH dùng swing xác nhận, bỏ nến forming
 *  - exchanges.js: PriceHub tách slot spot/perp, gia() ưu tiên spot, perpOk fallback
 *  - datahub.js: flowScore(loaiTruSan) loại trừ nguồn thật (test hàm thật, store giả)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function ok(cond, ten, chiTiet) {
  if (cond) { pass++; console.log(`  ✅ ${ten}`); }
  else { fail++; console.log(`  ❌ ${ten}${chiTiet ? " — " + chiTiet : ""}`); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* Context VM dùng chung: function/class khai báo đều truy cập được qua get() */
function makeCtx(extra = {}) {
  const ctx = vm.createContext({ console, ...extra });
  return {
    load(rel) { vm.runInContext(read(rel), ctx, { filename: rel }); },
    get(name) { return vm.runInContext(name, ctx); },
    evalIn(src) { return vm.runInContext(src, ctx); },
  };
}
/* Tách nguyên văn 1 function từ source (brace-matching) để test hàm thật với store giả */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error("không tìm thấy " + name);
  // bỏ qua default param dạng {…}: tìm dấu ) đóng của danh sách tham số trước
  let depthP = 0, i = src.indexOf("(", start);
  for (; i < src.length; i++) {
    if (src[i] === "(") depthP++;
    else if (src[i] === ")") { depthP--; if (!depthP) break; }
  }
  let depth = 0;
  i = src.indexOf("{", i);
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

/* ---------- 1. ta.js ---------- */
console.log("\n[1] ta.js — guard null/NaN");
{
  const c = makeCtx(); c.load("assets/js/ta.js");
  const emaSeries = c.get("emaSeries"), rsiSeries = c.get("rsiSeries"), atrSeries = c.get("atrSeries");
  const e1 = emaSeries([null, NaN, 100, 101, 102, 103, 104], 3);
  ok(e1.every(v => v === null || Number.isFinite(v)), "emaSeries(null/NaN đầu vào) không sinh NaN");
  const e2 = emaSeries([100, 101, 102, 103, 104, 105], 3);
  ok(e2[5] !== null && Number.isFinite(e2[5]) && e2.slice(0, 2).every(v => v === null),
    "emaSeries chuẩn: null khi chưa đủ kỳ, số hữu hạn sau đó");
  const r1 = rsiSeries([100, null, 102, NaN, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114], 14);
  ok(r1.every(v => v === null || Number.isFinite(v)), "rsiSeries(null/NaN) không lan NaN");
  const r2 = rsiSeries(Array.from({ length: 20 }, (_, i) => 100 + i), 14);
  ok(r2[19] !== null && r2[19] > 50 && r2[19] <= 100, `rsiSeries tăng đều → RSI cao (${(+r2[19]).toFixed(1)})`);
  const nen = Array.from({ length: 20 }, (_, i) => ({ open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }));
  const a = atrSeries([...nen.slice(0, 5), null, ...nen.slice(6)], 14);
  ok(a.every(v => v === null || Number.isFinite(v)), "atrSeries(nến null) không crash, không lan NaN");
}

/* ---------- 2. smc.js (chung ctx với ta.js vì dùng findPivots) ---------- */
console.log("\n[2] smc.js — CHoCH / sweep / forming candle");
{
  const c = makeCtx({ clamp: (v, a, b) => Math.min(b, Math.max(a, v)) });
  c.load("assets/js/ta.js"); c.load("assets/js/smc.js");
  const phanTichCauTruc = c.get("phanTichCauTruc"), timSweepGanNhat = c.get("timSweepGanNhat"), timChoCh = c.get("timChoCh");
  const N = (o, h, l, cl, t = 0) => ({ open: o, high: h, low: l, close: cl, openTime: t });

  const candles = [
    N(100, 102, 98, 101), N(101, 103, 99, 102), N(102, 104, 90, 103),   // 2: swing low 90
    N(103, 105, 100, 104), N(104, 106, 101, 105), N(105, 107, 102, 106),
    N(106, 110, 104, 107),                                             // 6: swing high 110
    N(107, 108, 103, 104), N(104, 105, 95, 96),                        // 8: giảm
    N(96, 97, 88, 95),                                                 // 9: sweep dưới 90, đóng trên 90
    N(110.5, 113, 110.2, 112),                                         // 10: CHoCH — CẢ thân vượt 110
    N(112, 114, 111, 113),                                             // 11: nến đóng thêm
    N(113, 115, 112, 114),                                             // 12: forming (bị bỏ qua)
  ];
  const ct = phanTichCauTruc(candles, 2);
  ok(ct.lows.some(p => p.price === 90), "phanTichCauTruc tìm swing low 90");
  ok(ct.highs.some(p => p.price === 110), "phanTichCauTruc tìm swing high 110");

  const sweep = timSweepGanNhat(candles, ct);
  ok(sweep && sweep.phia === "long" && sweep.index === 9, `timSweepGanNhat bắt sweep long ở nến 9 (được ${sweep?.index})`);

  const choch = timChoCh(candles, ct, sweep, 2);
  ok(choch && choch.phia === "long", "timChoCh phát hiện CHoCH long");
  ok(choch && choch.bodyClose === true, "bodyClose=true khi CẢ thân nến vượt swing high");
  ok(choch && choch.swingRef < choch.index, `CHoCH tham chiếu swing đã xác nhận (swingRef=${choch?.swingRef} < index=${choch?.index})`);

  // bodyClose GIẢ: bấc vượt nhưng thân chưa vượt hẳn
  const candles2 = candles.map(x => ({ ...x }));
  candles2[10] = N(105, 112, 104, 111); // bấc 112 > 110 nhưng thân 105..111 còn dưới 110
  const choch2 = timChoCh(candles2, ct, sweep, 2);
  ok(choch2 && choch2.bodyClose === false, "bodyClose=false khi bấc vượt nhưng thân chưa vượt hẳn");

  // Sweep CHỈ ở nến forming (cuối) → không bắt
  const candles3 = [
    N(100, 102, 98, 101), N(101, 103, 99, 102), N(102, 104, 90, 103),
    N(103, 105, 100, 104), N(104, 106, 101, 105), N(105, 107, 102, 106),
    N(96, 97, 88, 95), // forming: sweep dưới 90 nhưng là nến cuối
  ];
  const ct3 = phanTichCauTruc(candles3, 2);
  ok(!timSweepGanNhat(candles3, ct3), "timSweepGanNhat BỎ QUA nến đang hình thành (chống repaint)");

  // CHoCH CHỈ ở nến forming (cuối) → không bắt
  const candles4 = candles.slice(0, 10).map(x => ({ ...x })); // nến đóng đến index 9
  candles4.push(N(105, 112, 104, 111)); // index 10 = forming, vượt 110
  const choch4 = timChoCh(candles4, ct, sweep, 2);
  ok(!choch4, "timChoCh BỎ QUA nến đang hình thành");
}

/* ---------- 3. exchanges.js — PriceHub provenance ---------- */
console.log("\n[3] exchanges.js — PriceHub tách slot spot/perp");
{
  const c = makeCtx({ document: { dispatchEvent() {} }, localStorage: { getItem: () => null, setItem() {} } });
  c.load("assets/js/exchanges.js");
  const PriceHub = c.get("PriceHub");
  const hub = new PriceHub(["BTC"]);
  ok(hub.prices.BYBIT_PERP && hub.prices.HYPERLIQUID, "PriceHub có slot BYBIT_PERP và HYPERLIQUID riêng");

  hub.prices.BYBIT_PERP.BTC = { gia: 67000, ts: Date.now() };
  ok(hub.gia("BTC") === null, "gia() KHÔNG lấy giá perp khi không có spot (mặc định)");
  ok(hub.gia("BTC", { perpOk: true }) === 67000, "gia(perpOk) dùng perp làm fallback khẩn cấp");
  const kn = hub.giaKemNguon("BTC");
  ok(kn && kn.laPerp === true && kn.san === "BYBIT_PERP", `giaKemNguon gắn nhãn perp rõ ràng (${kn?.san})`);

  hub.prices.BINANCE.BTC = { gia: 67100, pct24h: 1.2, ts: Date.now() };
  ok(hub.gia("BTC", { perpOk: true }) === 67100, "có spot thì ưu tiên spot trước perp");
  const kn2 = hub.giaKemNguon("BTC");
  ok(kn2 && kn2.laPerp === false && kn2.san === "BINANCE", "giaKemNguon ưu tiên BINANCE spot");

  // giaTuoiNhat: chọn giá tươi nhất, không phải giá "ưu tiên" nhưng đã cũ
  hub.prices.BINANCE.BTC = { gia: 67100, ts: Date.now() - 60_000 };
  hub.prices.BYBIT_PERP.BTC = { gia: 67050, ts: Date.now() };
  const tuoi = hub.giaTuoiNhat("BTC");
  ok(tuoi && tuoi.san === "BYBIT_PERP" && tuoi.gia === 67050, `giaTuoiNhat chọn giá tươi nhất (${tuoi?.san}) thay vì spot cũ`);
}

/* ---------- 4. datahub.js — flowScore loại trừ nguồn (hàm THẬT, store giả) ---------- */
console.log("\n[4] datahub.js — flowScore(loaiTruSan) khử trùng OKX");
{
  const src = read("assets/js/datahub.js");
  const fnSrc = extractFunction(src, "flowScore");
  ok(/loaiTruSan/.test(fnSrc), "flowScore có tham số loaiTruSan");
  const c = makeCtx({
    up: (s) => String(s || "").toUpperCase(),
    now: () => 1_000_000,
    store: {
      // cá voi: OKX mua 1000, Bybit mua 1000 → không loại: flow +70; loại OKX: chỉ còn Bybit +70 (mẫu nhỏ)
      whales: [
        { coin: "BTC", san: "OKX", side: "BUY", usd: 1000, ts: 999_000 },
        { coin: "BTC", san: "BYBIT", side: "SELL", usd: 1000, ts: 999_000 },
      ],
      liqs: [],
    },
  });
  c.evalIn(fnSrc + "\n;globalThis.__fs = flowScore;");
  const fsFn = c.get("__fs");
  const diemFull = fsFn("BTC");                       // cả 2 nguồn: buy 1000 / sell 1000 → flow 0
  const diemTruOKX = fsFn("BTC", { loaiTruSan: ["OKX"] }); // chỉ Bybit SELL 1000 → flow -70
  ok(diemFull === 0, `không loại trừ: buy/sell cân bằng → 0 (được ${diemFull})`);
  ok(diemTruOKX === -70, `loại OKX: chỉ còn Bybit SELL → -70 (được ${diemTruOKX})`);
}

/* ---------- 5. bot.js — phí PnL + fallback giá chéo sàn ---------- */
console.log("\n[5] bot.js — phí taker trừ vào PnL · SL/TP fallback chéo sàn");
{
  const priceHubStub = {
    prices: { BINANCE: {}, OKX: {}, MEXC: {}, BYBIT_PERP: {}, HYPERLIQUID: {}, DH_KHAC: {} },
    gia(coin, opts = {}) {
      const g = this.prices.BINANCE[coin]?.gia ?? this.prices.OKX[coin]?.gia ?? this.prices.MEXC[coin]?.gia ?? null;
      if (g != null || !opts.perpOk) return g;
      return this.prices.BYBIT_PERP[coin]?.gia ?? null;
    },
    giaKemNguon(coin) {
      for (const s of ["BINANCE", "OKX", "MEXC"])
        if (this.prices[s][coin]?.gia != null) return { ...this.prices[s][coin], san: s, laPerp: false };
      for (const s of ["BYBIT_PERP", "HYPERLIQUID"])
        if (this.prices[s][coin]?.gia != null) return { ...this.prices[s][coin], san: s, laPerp: true };
      return null;
    },
    giaTuoiNhat(coin) {
      let best = null;
      for (const s of Object.keys(this.prices)) {
        const p = this.prices[s][coin];
        if (p?.gia != null && p.ts && (!best || p.ts > best.ts))
          best = { ...p, san: s, laPerp: s === "BYBIT_PERP" || s === "HYPERLIQUID" };
      }
      return best;
    },
  };
  const c = makeCtx({
    document: { dispatchEvent() {} },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); } },
    lsGet: (k, fb) => fb, lsSet: () => {},
    PRICE_HUB: priceHubStub,
    SIGNAL_CACHE: new Map(), WHALE_CACHE: new Map(),
    SETTINGS: { watchlist: ["BTC"], risk: { vonBanDau: 10000, riskPct: 1, minRR: 2, maxViThe: 3, loNgayMaxPct: 3, cooldownPhut: 30, donBay: 3 } },
    VERDICT: { ALERT: 70 },
    fmtGia: (v) => String(v), fmtUsd: (v) => "$" + (+v).toFixed(2), fmtSo: (v) => String(v),
    dangKillzone: () => ({ active: false }), phienHienTai: () => [],
    hocTuLichSu: () => {},
  });
  c.load("assets/js/bot.js");
  const PaperBot = c.get("PaperBot");
  const bot = new PaperBot();
  bot.config.phiPct = 0.05;

  // Mở vị thế long BTC @ 67000, SL 66330 (risk 670), TP 68340
  const pos = { id: "T1", coin: "BTC", side: "long", san: "BINANCE", entry: 67000, sl: 66330, slGoc: 66330,
                tp: 68340, qty: 0.014925, riskUsdt: 10, moLuc: Date.now(), beDaDoi: false };
  bot.state.positions.push(pos);

  // 5a. Phí: đóng ở TP → PnL gộp = (68340-67000)*0.014925 = 20; phí = 0.014925*(67000+68340)*0.05% ≈ 1.01
  const balTruoc = bot.state.balance;
  bot.dongLenh(pos, 68340, "TP");
  const h = bot.state.history[0];
  const pnlGoc = (68340 - 67000) * 0.014925;
  const phiDk = 0.014925 * (67000 + 68340) * 0.05 / 100;
  ok(Math.abs(h.phi - phiDk) < 0.01, `phí taker 2 chiều được trừ (phi=${h.phi?.toFixed(2)}, kỳ vọng ${phiDk.toFixed(2)})`);
  ok(Math.abs(h.pnl - (pnlGoc - phiDk)) < 0.01, `PnL ròng = gộp − phí (${h.pnl?.toFixed(2)})`);
  ok(Math.abs(bot.state.balance - (balTruoc + h.pnl)) < 1e-9, "balance cộng PnL ròng");

  // 5b. Fallback chéo sàn: feed Binance chết (>20s), chỉ còn Bybit perp → vẫn canh được SL
  const pos2 = { id: "T2", coin: "BTC", side: "long", san: "BINANCE", entry: 67000, sl: 66330, slGoc: 66330,
                 tp: 68340, qty: 0.014925, riskUsdt: 10, moLuc: Date.now(), beDaDoi: false };
  bot.state.positions.push(pos2);
  priceHubStub.prices.BINANCE.BTC = { gia: 67000, ts: Date.now() - 60_000 }; // feed Binance chết 60s
  priceHubStub.prices.BYBIT_PERP.BTC = { gia: 66200, ts: Date.now() };       // perp đã xuyên SL
  bot.config.doiSLveBE = false; // tắt dời BE để test thuần SL
  bot.onTick("BTC", 67100, "OKX"); // tick từ sàn khác → kích hoạt fallback
  ok(!bot.state.positions.some(p => p.id === "T2"), "feed Binance chết → dùng giá chéo sàn, SL vẫn khớp");
  ok(/SL/.test(bot.state.history[0]?.lyDo || ""), `lý do đóng là SL (${bot.state.history[0]?.lyDo})`);

  // 5c. Feed Binance còn tươi → KHÔNG dùng giá perp (tránh đóng oan vì basis)
  const pos3 = { id: "T3", coin: "BTC", side: "long", san: "BINANCE", entry: 67000, sl: 66330, slGoc: 66330,
                 tp: 68340, qty: 0.014925, riskUsdt: 10, moLuc: Date.now(), beDaDoi: true };
  bot.state.positions.push(pos3);
  priceHubStub.prices.BINANCE.BTC = { gia: 67050, ts: Date.now() }; // feed tươi
  bot.onTick("BTC", 67100, "BINANCE"); // tick đúng sàn, giá trên SL
  ok(bot.state.positions.some(p => p.id === "T3"), "feed tươi + giá trên SL → vị thế còn mở");
}

/* ---------- 6. screens.js — panel sức khỏe nguồn dữ liệu ---------- */
console.log("\n[6] screens.js — panel sức khỏe nguồn dữ liệu");
{
  // DOM stub tối thiểu cho el()/$
  const mkEl = (tag) => ({
    tag, className: "", innerHTML: "", textContent: "", title: "", style: {},
    dataset: {}, children: [], isConnected: true,
    classList: { _s: new Set(), toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, remove() {}, add() {}, contains(c) { return this._s.has(c); } },
    setAttribute() {}, addEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
  });
  const fakeDoc = {
    createElement: (t) => mkEl(t),
    createTextNode: (s) => ({ text: s }),
  };
  const nowMs = Date.now();
  const c = makeCtx({
    document: fakeDoc,
    window: {},
    $: () => null,
    PRICE_HUB: { prices: {
      BINANCE: { BTC: { gia: 67000, ts: nowMs - 500 } },       // tươi
      OKX: { BTC: { gia: 67010, ts: nowMs - 15_000 } },          // vàng (>10s)
      MEXC: { BTC: { gia: 66990, ts: nowMs - 45_000 } },         // đỏ (>30s)
      BYBIT_PERP: {}, HYPERLIQUID: { BTC: { gia: 67005, ts: nowMs - 800 } },
    } },
    SETTINGS: { watchlist: ["BTC"] },
    DataHub: { sources: () => [
      { id: "macro", ten: "Macro", status: "on", note: "REST", msgs: 12, lastMsg: nowMs - 60_000 },
      { id: "polymarket", ten: "Polymarket", status: "degraded", note: "REST poll chậm", msgs: 3, lastMsg: nowMs - 300_000 },
    ] },
    SCREEN_HIENTAI: "tongquan",
  });
  c.load("assets/js/utils.js"); // el, $
  // screens.js gọi nhiều hàm toàn cục khác ở top-level? chỉ load phần cần: trích function sức khỏe
  const src = read("assets/js/screens.js");
  const names = ["skTuoiTickMoiNhat", "skFmtTuoi", "veSucKhoeNguon", "capNhatSucKhoeNguon",
                 "SK_NGUON_GIA", "SK_TICK_VANG", "SK_TICK_DO", "SK_BOQUA_DH"];
  // nạp const + function bằng extract
  for (const n of ["skTuoiTickMoiNhat", "skFmtTuoi", "veSucKhoeNguon", "capNhatSucKhoeNguon"]) {
    try { c.evalIn(extractFunction(src, n) + `\n;globalThis.__${n} = ${n};`); }
    catch (e) { console.log("  ⚠ không trích được " + n + ": " + e.message); }
  }
  const skFmtTuoi = c.get("__skFmtTuoi"), skTuoi = c.get("__skTuoiTickMoiNhat");
  ok(skFmtTuoi(500) === "vừa xong", "skFmtTuoi <1.5s → 'vừa xong'");
  ok(skFmtTuoi(5500) === "5.5s trước", `skFmtTuoi 5.5s (được "${skFmtTuoi(5500)}")`);
  ok(skFmtTuoi(95000) === "2ph trước", "skFmtTuoi >60s → phút");
  ok(skFmtTuoi(null) === "chưa có", "skFmtTuoi null → 'chưa có'");
  const tMoi = skTuoi("BINANCE");
  ok(tMoi && nowMs - tMoi < 2000, "skTuoiTickMoiNhat lấy ts mới nhất của sàn");
  ok(skTuoi("BYBIT_PERP") === null, "slot rỗng → null (chưa kết nối)");

  // smoke test render panel
  const veSK = c.get("__veSucKhoeNguon");
  const panel = veSK();
  ok(panel && panel.children.length >= 3, "veSucKhoeNguon render đủ khối (title/warn/grid)");
  const grid = panel.children.find(x => x.tag === "div" && x.className === "sk-grid");
  ok(!!grid, "có sk-grid chứa các dòng nguồn");
}

/* ---------- 7. screens.js — chart TradingView-style ---------- */
console.log("\n[7] screens.js — chart TradingView-style");
{
  // Canvas 2D mock: ghi lại các lệnh vẽ
  const calls = [];
  const grad = { addColorStop() {} };
  const ctxMock = new Proxy({
    canvas: null,
    measureText: (t) => ({ width: String(t).length * 6 }),
  }, {
    get(t, k) {
      if (k === "measureText") return t.measureText;
      if (k === "canvas") return t.canvas;
      if (typeof t[k] !== "undefined") return t[k];
      return (...a) => { calls.push(k); t[k] = t[k]; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const canvasMock = {
    clientWidth: 1200, width: 0, height: 0,
    getContext: () => ctxMock,
  };
  const nowT = Date.now();
  const mkC = (i, o, h, l, c, v) => ({ openTime: nowT - (60 - i) * 900000, open: o, high: h, low: l, close: c, volume: v });
  const candles = [];
  let p = 83000;
  for (let i = 0; i < 60; i++) {
    const o = p, drift = (i % 7 - 3) * 40;
    const c = o + drift, h = Math.max(o, c) + 30, l = Math.min(o, c) - 30;
    candles.push(mkC(i, o, h, l, c, 100 + (i % 5) * 20));
    p = c;
  }
  const c = makeCtx({
    window: { devicePixelRatio: 2 },
    document: {},
    $: (sel) => sel === "#smc-canvas" ? canvasMock : null,
    CHART_COIN: "BTC",
    CHART_HOVER: { x: 600, y: 200 },   // crosshair giữa chart
    PRICE_HUB: { gia: () => 84200 },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    fmtGia: (v) => Number(v).toLocaleString("en-US"),
  });
  const src = read("assets/js/screens.js");
  try { c.evalIn(extractFunction(src, "veCanvasSMC") + "\n;globalThis.__veCanvasSMC = veCanvasSMC;"); }
  catch (e) { console.log("  ⚠ không trích được veCanvasSMC: " + e.message); }
  const ve = c.get("__veCanvasSMC");
  const kq = {
    coin: "BTC",
    candles15: candles, candles15full: candles,
    ob15: [{ zone: [83800, 84000], huong: "bullish" }],
    fvg15: [{ zone: [84100, 84150] }],
    poi: { zone: [83600, 83700] },
    mtf: { eq: { eqh: [{ gia: 84915 }], eql: [{ gia: 84646 }] }, poc: 84413 },
    ltf: { sweep: { index: 55, wick: 83200, phia: "long" }, choch: { index: 50, mucPhaVo: 84500 } },
    plan: { entry: 84300, sl: 83800, tp1: 84800, tp2: 85200 },
  };
  // CHART_COIN là let trong ctx? gán qua eval
  c.evalIn("CHART_COIN = 'BTC';");
  ve(kq);
  ok(canvasMock.width === 2400 && canvasMock.height === 880, `HiDPI: canvas 2400x880 theo DPR=2 (được ${canvasMock.width}x${canvasMock.height})`);
  ok(calls.includes("fillRect") && calls.includes("moveTo"), "có lệnh vẽ nền + đường");
  const nFillText = calls.filter(k => k === "fillText").length;
  ok(nFillText > 20, `vẽ đủ nhãn trục/pill/marker (fillText ×${nFillText})`);
  // không hover → vẫn vẽ xong
  calls.length = 0;
  c.evalIn("CHART_HOVER = null;");
  ve(kq);
  ok(calls.includes("fillRect"), "vẽ lại OK khi không có crosshair");
  // coin khác → bỏ qua
  calls.length = 0;
  c.evalIn("CHART_COIN = 'ETH';");
  ve(kq);
  ok(calls.length === 0, "coin khác CHART_COIN thì không vẽ");
  // nến rỗng → không crash
  c.evalIn("CHART_COIN = 'BTC';");
  ve({ ...kq, candles15: [] });
  ok(true, "candles rỗng không crash");
}


/* ---------- 9. flowdb.js — database dòng tiền ---------- */
console.log("\n[9] flowdb.js — database dòng tiền (backend RAM)");
const _p9 = (async () => {
  const c = makeCtx();
  c.load("assets/js/flowdb.js");
  const FDB = c.get("FlowDB");
  const T0 = Date.now();
  const W = (coin, side, usd, ts, san) => ({ coin, side, usd, ts: ts || T0, san: san || "BINANCE", price: 100, qty: usd / 100 });
  const L = (coin, huong, usd, ts) => ({ coin, huong, usd, ts: ts || T0, san: "BYBIT", price: 100 });

  await FDB._useBackend(FDB._memBackend());
  ok(true, "init với backend RAM");

  // 9.1 track + flush + đọc desc
  FDB.trackWhale(W("BTC", "BUY", 400e3, T0 - 3000));
  FDB.trackWhale(W("BTC", "SELL", 100e3, T0 - 2000));
  FDB.trackWhale(W("ETH", "BUY", 250e3, T0 - 1000));
  FDB.trackLiq(L("BTC", "LONG", 600e3));
  await FDB._flushBuf();
  const wAll = await FDB.recentWhales({ limit: 10 });
  ok(wAll.length === 3 && wAll[0].coin === "ETH" && wAll[2].coin === "BTC",
    "recentWhales trả desc theo ts");
  const wBtc = await FDB.recentWhales({ coin: "btc", limit: 10 });
  ok(wBtc.length === 2 && wBtc.every(x => x.coin === "BTC"), "lọc theo coin (không phân biệt hoa/thường)");
  const lAll = await FDB.recentLiqs({ limit: 10 });
  ok(lAll.length === 1 && lAll[0].huong === "LONG" && lAll[0].usd === 600e3, "recentLiqs ghi đúng");

  // 9.2 flowWindow 60'
  const fw = await FDB.flowWindow(60);
  ok(fw.buy === 650e3 && fw.sell === 100e3 && fw.net === 550e3 && fw.count === 3,
    "flowWindow: buy/sell/net/count đúng");
  ok(fw.perCoin.BTC.volume === 500e3 && fw.perCoin.BTC.count === 2, "perCoin gom đúng");
  ok(fw.liqLong === 600e3 && fw.liqShort === 0 && fw.liqCount === 1, "tổng thanh lý đúng");
  const d = fw.dist["100K-500K"];
  ok(d && d.count === 3 && d.volume === 750e3, "phân bổ cỡ lệnh đúng");

  // 9.3 flowScore cùng công thức DataHub: flow=(650-100)/750*70, liq=(600-0)/600*30
  const sc = await FDB.flowScore("BTC");
  const expect = Math.round(((400e3 - 100e3) / 500e3) * 70 + 30);
  ok(sc === expect, `flowScore(BTC)=${sc}, kỳ vọng ${expect}`);
  const scEth = await FDB.flowScore("ETH");
  ok(scEth === 70, `flowScore(ETH) toàn BUY = 70 (được ${scEth})`);
  const scX = await FDB.flowScore("DOGE");
  ok(scX === 0, "coin không có dữ liệu → 0");

  // 9.4 bucket gom theo phút trong RAM
  ok(FDB._bk.size >= 2, "bucket phút được gom trong RAM");
  const bk = [...FDB._bk.values()].find(b => b.coin === "BTC");
  ok(bk && bk.buy === 400e3 && bk.sell === 100e3 && bk.n === 2, "bucket BTC: buy/sell/n đúng");

  // 9.5 cảnh báo whale burst: 3 lệnh BUY BTC tổng ≥$1M trong 5'
  FDB._lastAlert = {};
  FDB.trackWhale(W("BTC", "BUY", 400e3, T0 - 4 * 60e3));
  FDB.trackWhale(W("BTC", "BUY", 400e3, T0 - 3 * 60e3));
  FDB.trackWhale(W("BTC", "BUY", 400e3, T0 - 2 * 60e3));
  await FDB._flushBuf();
  await FDB._checkAlerts();
  const als = await FDB.alerts({ limit: 20 });
  const burst = als.find(a => a.loai === "burst" && a.coin === "BTC");
  ok(!!burst && /\d+ lệnh MUA/.test(burst.text), "phát hiện whale burst BTC (" + (burst ? burst.text : "?") + ")");
  // chống spam: check lại ngay → không thêm alert trùng
  const n1 = als.length;
  await FDB._checkAlerts();
  const als2 = await FDB.alerts({ limit: 20 });
  ok(als2.length === n1, "cooldown chống spam cảnh báo trùng");

  // 9.6 liq cascade: thanh lý ≥$500K/5'
  FDB._lastAlert = {};
  FDB.trackLiq(L("ETH", "SHORT", 300e3, T0 - 60000));
  FDB.trackLiq(L("ETH", "LONG", 300e3, T0 - 30000));
  await FDB._flushBuf();
  await FDB._checkAlerts();
  const als3 = await FDB.alerts({ limit: 20 });
  ok(als3.some(a => a.loai === "liq" && a.coin === "ETH"), "phát hiện liq cascade ETH");

  // 9.7 prune xóa dữ liệu >7 ngày
  await FDB._be.put("whales", { coin: "BTC", side: "BUY", usd: 1e5, ts: T0 - 8 * 24 * 3600e3, san: "X", price: 1, qty: 1 });
  const before = await FDB.stats();
  await FDB.prune(7);
  const after = await FDB.stats();
  ok(after.whales === before.whales - 1, "prune xóa bản ghi quá 7 ngày");

  // 9.8 giới hạn alerts ≤ maxKeep
  ok(after.alerts <= 100, "alerts không vượt maxKeep");
})();

/* ---------- 10. derivatives.js — funding/OI/liq/stablecoin/vol ---------- */
console.log("\n[10] derivatives.js — phân tích phái sinh");
{
  const c = makeCtx();
  c.load("assets/js/derivatives.js");
  const g = (n) => c.get(n);

  // 10.1 annualized
  ok(Math.abs(g("annualizedFunding")(0.01) - 10.95) < 1e-9, "annualizedFunding(0.01%) = 10.95%/năm");
  ok(g("annualizedFunding")(NaN) === null, "annualizedFunding(NaN) = null");

  // 10.2 funding regime theo bảng skill perp-funding-basis
  const fr = g("fundingRegime");
  ok(fr(0.06).id === "overheated_long" && fr(0.06).contrarian === "short", "funding >0.05% → overheated_long, contrarian short");
  ok(fr(-0.03).id === "overheated_short" && fr(-0.03).contrarian === "long", "funding <-0.02% → overheated_short, contrarian long");
  ok(fr(0.03).id === "bullish_carry", "funding 0.03% → bullish_carry");
  ok(fr(0.001).id === "balanced", "funding ~0 → balanced");
  ok(fr(0.01).id === "mild_long" && fr(-0.01).id === "mild_short", "vùng mild ±");
  ok(fr(NaN).id === "unknown", "funding NaN → unknown, không crash");

  // 10.3 ma trận OI×funding
  const oif = g("oiFundingSignal");
  ok(oif(8, 0.04).id === "leveraged_long_buildup", "OI+8% & funding>0.03 → leveraged_long_buildup");
  ok(oif(8, -0.04).id === "leveraged_short_buildup", "OI+8% & funding<-0.03 → leveraged_short_buildup");
  ok(oif(-8, 0.05).id === "unwinding", "OI-8% & funding cực → unwinding");
  ok(oif(2, 0.01).id === "neutral", "OI/funding thường → neutral");
  ok(oif(NaN, NaN).id === "unknown", "thiếu dữ liệu → unknown");

  // 10.4 áp lực thanh lý
  const dl = g("danhGiaLiq");
  const r1 = dl(300e6, 100e6);
  ok(r1.id === "long_squeeze" && Math.abs(r1.ratio - 3) < 1e-9, "L/S=3 → long_squeeze");
  ok(dl(100e6, 300e6).id === "short_squeeze", "L/S=0.33 → short_squeeze");
  ok(dl(600e6, 100e6).canhBao.includes("EXTREME"), "tổng TL >$500M → cảnh báo EXTREME");
  ok(dl(0, 0).id === "none", "không có thanh lý → none");

  // 10.5 stablecoin composite
  const dsc = g("diemStablecoin");
  ok(dsc(6).diem === 8 && dsc(-3).diem === -6, "stablecoin ±: mint mạnh +8, rút vốn -6");
  ok(dsc(1).diem === 0 && dsc(NaN).diem === 0, "đi ngang/thiếu → 0");

  // 10.6 HV percentile: cuối kỳ vol bùng → percentile cao
  const hv = g("hvPercentile");
  const closes = [];
  let p = 100;
  for (let i = 0; i < 280; i++) { p *= 1 + (i % 2 ? 0.0005 : -0.0005); closes.push(p); }
  for (let i = 0; i < 30; i++) { p *= 1 + (i % 2 ? 0.04 : -0.04); closes.push(p); }
  const r6 = hv(closes);
  ok(r6.pct > 80 && r6.regime === "high_vol", `HV percentile phát hiện vol bùng (pct=${r6.pct})`);
  const flat = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i) * 0.01);
  const r6b = hv(flat);
  ok(r6b.hv < 5 && r6b.pct <= 100, "chuỗi phẳng → HV thấp");
  ok(hv([100]).regime === "unknown", "thiếu nến → unknown");
}

/* ---------- 11. aichat.js — provider adapters + key vault ---------- */
const _p10 = async () => {
console.log("\n[11] aichat.js — AI Hỏi đáp (RAG)");
{
  const store = {};
  const localStorageMock = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  let lastReq = null;
  const fetchMock = async (url, opts) => {
    lastReq = { url, opts: JSON.parse(JSON.stringify(opts)) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Xin chào từ AI" }] } }] }) };
  };
  const c = makeCtx({ localStorage: localStorageMock, fetch: fetchMock, window: {}, AbortController, setTimeout, clearTimeout });
  c.load("assets/js/aichat.js");
  const g = (n) => c.get(n);
  const P = g("AI_PROVIDERS");

  // 11.1 3 providers đủ adapter
  ok(P.gemini && P.openai && P.anthropic && P.apmix, "đủ 4 provider: gemini/openai/anthropic/apmix");
  ok(P.gemini.endpoint("gemini-2.5-flash").includes("generativelanguage.googleapis.com"), "gemini endpoint đúng");
  ok(P.openai.endpoint().includes("api.openai.com/v1/chat/completions"), "openai endpoint đúng");
  ok(P.anthropic.endpoint().includes("api.anthropic.com/v1/messages"), "anthropic endpoint đúng");
  ok(P.apmix.endpoint().includes("api.apmix.ai/v1/chat/completions"), "apmix endpoint đúng");
  ok(P.apmix.headers("k").Authorization === "Bearer k", "apmix: Bearer token (OpenAI-compatible)");
  ok(P.apmix.modelMacDinh === "deepseek-v4-flash-free", "apmix model mặc định là bản free");
  ok(P.apmix.proxy === true && P.anthropic.proxy === true, "apmix + anthropic đi qua proxy");
  ok(typeof P.apmix.proxyNote === "string" && P.apmix.proxyNote.length > 10, "apmix có ghi chú proxy");

  // 11.2 headers/body đúng chuẩn từng provider
  ok(P.openai.headers("k123").Authorization === "Bearer k123", "openai: Bearer token");
  ok(P.gemini.headers("k123")["x-goog-api-key"] === "k123", "gemini: x-goog-api-key");
  ok(P.anthropic.headers("k123")["anthropic-version"] === "2023-06-01", "anthropic: version header");
  const bA = P.anthropic.body("m", "sys", [{ role: "user", content: "hi" }]);
  ok(bA.system === "sys" && bA.messages[0].role === "user" && bA.max_tokens === 2048, "anthropic body: system riêng + max_tokens");
  const bG = P.gemini.body("m", "sys", [{ role: "assistant", content: "hi" }]);
  ok(bG.contents[0].role === "model", "gemini: assistant → model");

  // 11.3 parse response
  ok(P.gemini.parse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) === "ok", "parse gemini");
  ok(P.openai.parse({ choices: [{ message: { content: "hi" } }] }) === "hi", "parse openai");
  ok(P.anthropic.parse({ content: [{ type: "text", text: "yo" }] }) === "yo", "parse anthropic");

  // 11.4 key vault: lưu/đọc/xóa trong localStorage
  const K = g("AI_KEYS");
  K.set("gemini", "key-that");
  ok(K.get("gemini") === "key-that" && K.co("gemini"), "vault: lưu + đọc key");
  ok(store["trade2026_ai_keys"].includes("key-that"), "vault: key nằm trong localStorage key riêng");
  K.del("gemini");
  ok(!K.co("gemini"), "vault: xóa key");

  // 11.5 system prompt: tiếng Việt + nguyên tắc chống bịa
  const sys = g("systemPromptRAG")();
  ok(sys.includes("TIẾNG VIỆT") && sys.includes("Không bịa"), "system prompt: tiếng Việt + chống bịa dữ liệu");

  // 11.6 hoiAI không key → lỗi rõ ràng, không gọi mạng
  let loiKhongKey = "";
  try { await g("hoiAI")("gemini", null, [{ role: "user", content: "hi" }], { boNgucanh: true }); }
  catch (e) { loiKhongKey = e.message; }
  ok(loiKhongKey.includes("Chưa nhập API key"), "hoiAI không key → báo thiếu key");

  // 11.7 hoiAI gọi đúng endpoint + body có system (RAG context)
  K.set("gemini", "k-test");
  const tl = await g("hoiAI")("gemini", "gemini-2.5-flash", [{ role: "user", content: "BTC thế nào?" }], { boNgucanh: true });
  ok(tl === "Xin chào từ AI", "hoiAI parse đúng text gemini");
  ok(lastReq.url.includes(":generateContent"), "hoiAI gọi đúng endpoint gemini");
  const bodySent = JSON.parse(lastReq.opts.body);
  ok(bodySent.system_instruction.parts[0].text.includes("Trade.2026"), "request mang system prompt RAG");
  ok(bodySent.contents[0].parts[0].text === "BTC thế nào?", "request mang đúng câu hỏi user");
  K.del("gemini");
}
};

/* ---------- 12. phanTichPhaiSinh với DataHub/FlowDB giả ---------- */
const _p11 = async () => {
console.log("\n[12] phanTichPhaiSinh — tích hợp live (mock)");
{
  const windowMock = {
    DataHub: {
      funding: () => ({ BTC: { rate: 0.06 } }),
      oi: () => ({ BTC: { oi: 5e9 } }),
    },
    FlowDB: {
      recentLiqs: async () => [
        { coin: "BTC", huong: "LONG", usd: 300e6, ts: Date.now() - 3600e3 },
        { coin: "BTC", huong: "SHORT", usd: 100e6, ts: Date.now() - 7200e3 },
      ],
    },
  };
  const c = makeCtx({ window: windowMock, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  c.load("assets/js/derivatives.js");
  const d = await c.get("phanTichPhaiSinh")("BTC", { side: "long" });
  ok(d.funding.id === "overheated_long", "funding 0.06% → overheated_long");
  ok(d.liq.id === "long_squeeze", "liq L/S=3 → long_squeeze");
  ok(d.canhBao.length >= 2, `sinh cảnh báo (${d.canhBao.length})`);
  ok(d.dieuChinh === -4, `side long + đám đông long → điều chỉnh -4 (được ${d.dieuChinh})`);
  const d2 = await c.get("phanTichPhaiSinh")("BTC", { side: "short" });
  ok(d2.dieuChinh === 4, `side short + đám đông long → contrarian +4 (được ${d2.dieuChinh})`);
  // cache 60s: gọi lại không tính lại
  const d3 = await c.get("phanTichPhaiSinh")("BTC", { side: "long" });
  ok(d3.at === d.at, "cache 60s hoạt động");
  ok(d3.fromCache === true, "lần 2 đọc từ cache");
}
};

/* ---------- 13. api/ai-proxy.js — Vercel proxy vượt chặn mạng/CORS ---------- */
const _p12 = async () => {
console.log("\n[13] api/ai-proxy.js — proxy");
{
  const handler = require(path.join(ROOT, "api/ai-proxy.js"));
  ok(typeof handler === "function", "export handler function");
  const goi = async (method, body) => {
    const calls = [];
    const req = { method, body };
    const res = {
      statusCode: 0, headers: {}, payload: null,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { this.headers[k] = v; return this; },
      json(o) { this.payload = o; return this; },
      send(t) { this.payload = t; return this; },
    };
    await handler(req, res);
    return { res, calls };
  };
  // 13.1 chặn method khác POST
  let r = await goi("GET", {});
  ok(r.res.statusCode === 405, "GET → 405");
  // 13.2 chặn provider ngoài allowlist (chống open-proxy)
  r = await goi("POST", { provider: "evil", key: "k", model: "m" });
  ok(r.res.statusCode === 400, "provider lạ → 400");
  // 13.3 thiếu key/model
  r = await goi("POST", { provider: "apmix", key: "", model: "m" });
  ok(r.res.statusCode === 400, "thiếu key → 400");
  // 13.4 forward đúng tới APMIX (fetch mock), không log key
  const realFetch = global.fetch;
  let lastReq = null;
  global.fetch = async (url, opts) => {
    lastReq = { url, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
    return { status: 200, text: async () => '{"choices":[{"message":{"content":"pong"}}]}' };
  };
  r = await goi("POST", { provider: "apmix", key: "k-bi-mat", model: "deepseek-v4-flash-free", system: "sys", messages: [{ role: "user", content: "hi" }] });
  global.fetch = realFetch;
  ok(r.res.statusCode === 200, "proxy forward → 200");
  ok(lastReq.url === "https://api.apmix.ai/v1/chat/completions", "proxy gọi đúng endpoint APMIX");
  ok(lastReq.auth === "Bearer k-bi-mat", "proxy gắn Bearer key");
  ok(lastReq.body.model === "deepseek-v4-flash-free" && lastReq.body.messages[0].role === "system", "proxy dựng body OpenAI-compatible + system");
  ok(!JSON.stringify(r.res.headers).includes("k-bi-mat"), "response không lộ key ở header");
  // 13.5 provider down → 502 gọn, không crash
  global.fetch = async () => { throw new Error("down"); };
  r = await goi("POST", { provider: "apmix", key: "k", model: "m", system: "", messages: [] });
  global.fetch = realFetch;
  ok(r.res.statusCode === 502, "provider down → 502");
}
};

_p9.then(_p10).then(_p11).then(_p12).then(() => {
console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
});
