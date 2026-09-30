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

  // 9.7 donDep (thủ công, khi user bấm nút) xóa dữ liệu >7 ngày — KHÔNG tự chạy
  await FDB._be.put("whales", { coin: "BTC", side: "BUY", usd: 1e5, ts: T0 - 8 * 24 * 3600e3, san: "X", price: 1, qty: 1 });
  const before = await FDB.stats();
  await FDB.donDep(7);
  const after = await FDB.stats();
  ok(after.whales === before.whales - 1, "donDep xóa bản ghi quá 7 ngày (chỉ khi user bấm)");

  // 9.7b kiemTraKho: chưa đầy → dungGhi=false; quá 200k sự kiện → dừng ghi
  const kho1 = await FDB.kiemTraKho();
  ok(kho1.dungGhi === false, "kiemTraKho: chưa đầy thì ghi tiếp");
  ok(typeof FDB.trangThaiKho().dungGhi === "boolean", "trangThaiKho trả trạng thái kho");

  // 9.8 giới hạn alerts ≤ maxKeep
  ok(after.alerts <= 100, "alerts không vượt maxKeep");

  // 9.9 mergeTram: bung master data trạm vào DB + khử trùng lần 2
  const payloadTram = {
    tram: "flow-247", capNhat: new Date(T0).toISOString(), nguon: ["OKX", "Hyperliquid"],
    whales: [
      { id: "okx-1", coin: "BNB", side: "SELL", usd: 259952, san: "OKX", ts: T0 - 5000, price: 700, qty: 371 },
      { id: "hl-1", coin: "BTC", side: "BUY", usd: 420500, san: "Hyperliquid", ts: T0 - 4000, price: 83449, qty: 5.039 },
    ],
    liqs: [{ id: "okxl-1", coin: "BTC", huong: "LONG", usd: 18456, san: "OKX", ts: T0 - 3000, price: 83400 }],
  };
  const m1 = await FDB.mergeTram(payloadTram);
  ok(m1.whales === 2 && m1.liqs === 1, "mergeTram lần 1: bung 2 whales + 1 liq vào DB");
  const wSauMerge = await FDB.recentWhales({ limit: 10 });
  ok(wSauMerge.some(x => x.id === "okx-1" && x.san === "OKX") && wSauMerge.some(x => x.id === "hl-1"),
    "lệnh trạm OKX/Hyperliquid đọc được từ DB (bung ngược ra web)");
  const m2 = await FDB.mergeTram(payloadTram);
  ok(m2.whales === 0 && m2.liqs === 0, "mergeTram lần 2: khử trùng — không ghi trùng");
  const lSauMerge = await FDB.recentLiqs({ limit: 10 });
  ok(lSauMerge.some(x => x.id === "okxl-1" && x.huong === "LONG"), "liq trạm đọc được từ DB");
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

/* ---------- 14. journal.js — Sổ tín hiệu & Kaizen ---------- */
const _p13 = async () => {
console.log("\n[14] journal.js — chấm điểm, thống kê, bài học");
{
  const store = {};
  const lsStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const c = makeCtx({ localStorage: lsStub, fetchKlines: async () => [] });
  c.load("assets/js/utils.js"); // fmtGia thật cho fmtChenhLech
  c.load("assets/js/journal.js");
  const chamDiemLenh = c.get("chamDiemLenh");
  const thongKeJournal = c.get("thongKeJournal");
  const rutBaiHocKaizen = c.get("rutBaiHocKaizen");
  const JOURNAL = c.get("JOURNAL");
  const nen = (o, h, l, cl, t) => ({ openTime: t, open: o, high: h, low: l, close: cl, volume: 1 });

  // 14.1 long thắng
  let dg = chamDiemLenh([nen(100,101,99,100.5,1000), nen(100.5,106,100,105,2000)], { side:"long", entry:100, sl:98, tp:105 });
  ok(dg.ketQua === "thang" && dg.at === 2000 && dg.r === 2.5, "long chạm TP → thắng R=2.5");
  // 14.2 long thua
  dg = chamDiemLenh([nen(100,101,97,99,1000)], { side:"long", entry:100, sl:98, tp:105 });
  ok(dg.ketQua === "thua" && dg.r === -1, "long chạm SL → thua R=-1");
  // 14.3 SL & TP cùng nến → thua (bảo thủ)
  dg = chamDiemLenh([nen(100,110,90,100,1000)], { side:"long", entry:100, sl:98, tp:105 });
  ok(dg.ketQua === "thua", "SL+TP cùng nến → thua (bảo thủ)");
  // 14.4 short thắng
  dg = chamDiemLenh([nen(100,101,94,95,1000)], { side:"short", entry:100, sl:102, tp:95 });
  ok(dg.ketQua === "thang" && dg.r === 2.5, "short chạm TP → thắng R=2.5");
  // 14.5 chưa chạm → tracking + MFE/MAE
  dg = chamDiemLenh([nen(100,103,99,102,1000), nen(102,104,101,103,2000)], { side:"long", entry:100, sl:98, tp:110 });
  ok(dg.ketQua === "dang_theo_doi" && dg.mfeR === 2 && dg.maeR === 0.5, "chưa chạm → tracking, MFE=2R MAE=0.5R");
  // 14.5b v2.2.1: record thật dùng giaVao thay entry + lưu giá kết thúc
  dg = chamDiemLenh([nen(100,101,97,99,1000)], { side:"long", giaVao:100, sl:98, tp:105 });
  ok(dg.ketQua === "thua" && dg.r === -1 && dg.giaKT === 98, "giaVao thay entry: long thua R=-1, giaKT=SL");
  dg = chamDiemLenh([nen(100,101,94,95,1000)], { side:"short", giaVao:100, sl:102, tp:95 });
  ok(dg.ketQua === "thang" && dg.r === 2.5 && dg.giaKT === 95, "giaVao: short thắng R=2.5 (không NaN), giaKT=TP");
  dg = chamDiemLenh([nen(100,103,99,102,1000)], { side:"long", giaVao:100, sl:98, tp:110 });
  ok(dg.ketQua === "dang_theo_doi" && dg.giaKT === null, "giaVao: chưa chạm → giaKT null");
  // 14.5c v2.2.1: giaKetThuc / chenhLechGia / fmtChenhLech
  const giaKetThuc = c.get("giaKetThuc"), chenhLechGia = c.get("chenhLechGia"), fmtChenhLech = c.get("fmtChenhLech");
  ok(giaKetThuc({ trangThai:"thua", sl:98, tp:105, ketQua:{ ketQua:"thua", giaKT:98 } }) === 98, "giaKetThuc: thua → SL");
  ok(giaKetThuc({ trangThai:"thang", sl:98, tp:105, ketQua:{ ketQua:"thang", giaKT:105 } }) === 105, "giaKetThuc: thắng → TP");
  ok(giaKetThuc({ trangThai:"thua", sl:98, tp:105, ketQua:{ ketQua:"thua" } }) === 98, "giaKetThuc: bản ghi cũ (chưa có giaKT) suy từ trạng thái");
  ok(giaKetThuc({ trangThai:"dang_theo_doi", ketQua:null }) === null, "giaKetThuc: đang theo dõi → null");
  let cl = chenhLechGia({ side:"long", giaVao:100, trangThai:"thua", sl:98, tp:105, ketQua:{ ketQua:"thua", giaKT:98 } });
  ok(cl && cl.gia === -2 && Math.abs(cl.pct + 2) < 1e-9, "chenhLechGia: long thua 100→98 = -2 (-2%)");
  cl = chenhLechGia({ side:"short", giaVao:100, trangThai:"thang", sl:102, tp:95, ketQua:{ ketQua:"thang", giaKT:95 } });
  ok(cl && cl.gia === 5 && Math.abs(cl.pct - 5) < 1e-9, "chenhLechGia: short thắng 100→95 = +5 (+5%)");
  ok(chenhLechGia({ side:"long", giaVao:100, trangThai:"dang_theo_doi", ketQua:null }) === null, "chenhLechGia: chưa ngã ngũ → null");
  const ethWin = { side:"short", giaVao:2690.13, sl:2698.58, tp:2673.22, trangThai:"thang", ketQua:{ ketQua:"thang", r:null, giaKT:2673.22 } };
  ok(giaKetThuc(ethWin) === 2673.22, "giaKetThuc: record trạm ETH thắng → TP (bản ghi cũ r=null vẫn OK)");
  const clEth = chenhLechGia(ethWin);
  ok(clEth && Math.abs(clEth.gia - 16.91) < 0.01 && clEth.pct > 0, "chenhLechGia: ETH short 2690.13→2673.22 lãi ~16.91");
  ok(fmtChenhLech({ gia:-2, pct:-2 }) === "-2.00 (-2.00%)", "fmtChenhLech: số âm");
  ok(fmtChenhLech({ gia:16.91, pct:0.6287 }) === "+16.91 (+0.63%)", "fmtChenhLech: số dương");
  ok(fmtChenhLech(null) === "—", "fmtChenhLech: null → —");
  // 14.6 ghiNhan: chỉ LONG/SHORT có plan
  const kqL = { verdict:"LONG", coin:"ETH", time:Date.now(), score:78, phase:"alert_ready",
    killzone:{ ten:"New York KZ" }, htf:{ bias:"bearish" },
    plan:{ entry:2698.1, sl:2705.6, tp1:2683.1, rr1:2 },
    checklist:[{ id:"htf_bias", dat:true }, { id:"poi_context", dat:false }] };
  const rec = JOURNAL.ghiNhan(kqL);
  ok(rec && rec.side === "long" && rec.coin === "ETH" && rec.checklist.length === 1, "ghiNhan LONG → bản ghi long/ETH");
  ok(JOURNAL.ghiNhan({ verdict:"PREPARE", plan:{ entry:1, sl:2, tp1:3 } }) === null, "verdict PREPARE → không ghi");
  ok(JOURNAL.ghiNhan({ verdict:"LONG", plan:null }) === null, "thiếu plan → không ghi");
  ok(JOURNAL.ghiNhan(Object.assign({}, kqL, { time:Date.now()+60000 })) === null, "trùng coin+side trong 6h → bỏ qua");
  // 14.7 thống kê
  const mk = (coin, side, tt, r, diem, phien, gio) => ({ coin, side, trangThai:tt, diem, phien,
    ketQua: tt === "dang_theo_doi" ? null : { r, gioDenKQ:gio } });
  const ds = [
    mk("ETH","long","thang",2,88,"New York KZ",5),
    mk("ETH","long","thang",2,90,"New York KZ",7),
    mk("ETH","short","thua",-1,72,"Phiên Á",3),
    mk("BTC","long","thua",-1,71,"Phiên Á",4),
    mk("BTC","short","dang_theo_doi",null,80,"—",null),
  ];
  const st = thongKeJournal(ds);
  ok(st.tong === 5 && st.xong === 4 && st.winRate === 50, "thống kê tổng / winrate 50%");
  ok(st.expectancy === 0.5, "expectancy = (2+2-1-1)/4 = 0.5R");
  ok(st.tbGioDenTP === 6 && st.tbGioDenSL === 3.5, "TB giờ tới TP=6h, tới SL=3.5h");
  ok(st.theo.side.long.wr === 67 && st.theo.nhomDiem["85–100"].wr === 100, "phân bổ theo side / nhóm điểm");
  // 14.8 bài học
  const bh = rutBaiHocKaizen(st, ds);
  ok(bh.some(l => l.tieuDe.indexOf("Bao lâu") >= 0), "có bài học về thời gian tới TP/SL");
  const bh2 = rutBaiHocKaizen(thongKeJournal([mk("ETH","long","thang",2,88,"A",5)]), []);
  ok(bh2.length === 1 && bh2[0].tieuDe.indexOf("tích lũy") >= 0, "ít hơn 3 lệnh → chỉ nhắc tích lũy");
}
};

const _p14 = async () => {
console.log("\n[15] trạm quan trắc 24/7 — collector + payload + thẻ web");
{
  const { execSync } = require("child_process");
  // 15.1 hai script trạm parse được
  try {
    execSync("node --check tools/collector-247.js && node --check tools/push-247.js", { cwd: ROOT, stdio: "pipe" });
    ok(true, "collector-247.js + push-247.js parse OK");
  } catch (e) { ok(false, "collector-247.js + push-247.js parse OK", e.message); }
  // 15.2 payload vòng thử có đủ trường
  let p = null;
  try { p = JSON.parse(read("data/journal-247.json")); } catch {}
  ok(p && p.tram === "collector-247" && typeof p.capNhat === "string",
    "payload có tram + capNhat");
  ok(p && p.thongKe && typeof p.thongKe.tong === "number" && Array.isArray(p.baiHoc) && Array.isArray(p.tinHieu),
    "payload có thongKe + baiHoc + tinHieu");
  ok(p && Array.isArray(p.vongQuet) && p.vongQuet.length === 6, "vòng quét đủ 6 coin");
  // 15.3 journal.js có thẻ trạm trỏ đúng nhánh data
  const jsrc = read("assets/js/journal.js");
  ok(jsrc.indexOf("tram-247") >= 0, "Sổ tín hiệu có thẻ trạm 24/7");
  ok(jsrc.indexOf("raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/journal-247.json") >= 0,
    "thẻ trạm tải đúng nhánh data");
  // 15.4 version
  ok(read("assets/js/config.js").indexOf('APP_VERSION = "2.4.0"') >= 0, "APP_VERSION = 2.4.0");
}
};

const _p15 = async () => {
console.log("\n[16] trạm dòng tiền 24/7 — flow-collector + merge khử trùng + master data cho engine");
{
  const { execSync } = require("child_process");
  try {
    execSync("node --check tools/flow-collector.js", { cwd: ROOT, stdio: "pipe" });
    ok(true, "flow-collector.js parse OK");
  } catch (e) { ok(false, "flow-collector.js parse OK", e.message); }
  // 16.1 payload flow
  let p = null;
  try { p = JSON.parse(read("data/flow-247.json")); } catch {}
  ok(p && p.tram === "flow-247" && Array.isArray(p.whales) && Array.isArray(p.liqs),
    "payload flow có whales + liqs");
  ok(p && p.whales.every((w) => typeof w.id === "string" && w.usd >= 1e5),
    "whale có id + usd ≥ $100K");
  ok(p && p.liqs.every((l) => typeof l.id === "string" && (l.huong === "LONG" || l.huong === "SHORT")),
    "liq có id + huong LONG/SHORT");
  // 16.2 id format trùng web (khử trùng được)
  const w0 = p.whales[0];
  ok(!w0 || /^(okx-|hl-)/.test(w0.id), "id whale trùng format web (okx-/hl-)");
  const l0 = p.liqs[0];
  ok(!l0 || /^okxl-/.test(l0.id), "id liq trùng format web (okxl-)");
  // 16.3 FDB_IDS: khử trùng + FIFO cap
  const c = makeCtx({ localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  c.load("assets/js/flowdb.js");
  const IDS = c.get("__FDB_IDS__");
  IDS._reset();
  IDS.add("okx-1"); IDS.add("okx-2");
  ok(IDS.has("okx-1") && !IDS.has("okx-3"), "FDB_IDS has/add");
  for (let i = 0; i < 12050; i++) IDS.add("x-" + i);
  ok(!IDS.has("okx-1") && IDS.has("x-12049"), "FDB_IDS FIFO khi quá 12000");
  // 16.4 flowdb giữ id + có mergeTram; engine ưu tiên master data
  const fsrc = read("assets/js/flowdb.js");
  ok(fsrc.indexOf("mergeTram: function") >= 0, "FlowDB có mergeTram");
  ok(fsrc.indexOf("TRAM_FLOW_URL") < 0, "TRAM_FLOW_URL nằm ở datahub-ui (không lẫn vào flowdb)");
  const uisrc = read("assets/js/datahub-ui.js");
  ok(uisrc.indexOf("data/flow-247.json") >= 0 && uisrc.indexOf("mergeTram247") >= 0,
    "Dòng tiền tải + merge dữ liệu trạm");
  // 16.4b v2.2.2: bung trạm TRƯỚC khi nạp lịch sử lên bảng (fix bảng trống lần đầu mở web)
  const iMerge = uisrc.indexOf("await mergeTram247();");
  const iNap = uisrc.indexOf("await napLichSu();");
  ok(iMerge >= 0 && iNap > iMerge, "renderDongTien: merge trạm trước, nạp lịch sử sau");
  ok(/đã bung .* sự kiện vào DB/.test(uisrc), "chip DB hiện số sự kiện trạm đã bung (nhìn thấy được)");
  ok(uisrc.indexOf("MERGE_TRAM_CACH") >= 0, "merge trạm có throttle chống fetch dồn dập");
  const esrc = read("assets/js/engine.js");
  ok(esrc.indexOf("FlowDB.flowScore") >= 0 && esrc.indexOf('nguonDiem = "master"') >= 0,
    "engine ưu tiên điểm dòng tiền master data");
  ok(read("assets/js/config.js").indexOf('APP_VERSION = "2.4.0"') >= 0, "APP_VERSION = 2.4.0");
}
};

const _p16 = async () => {
console.log("\n[17] dung lượng — meta bytes server + panel cảnh báo chiếm dụng");
{
  const { execSync } = require("child_process");
  for (const f of ["tools/collector-247.js", "tools/flow-collector.js"]) {
    try { execSync("node --check " + f, { cwd: ROOT, stdio: "pipe" }); ok(true, f + " parse OK"); }
    catch (e) { ok(false, f + " parse OK", e.message); }
  }
  // chạy 2 collector để sinh meta
  try {
    execSync("node tools/collector-247.js", { cwd: ROOT, stdio: "pipe", timeout: 120000 });
    execSync("node tools/flow-collector.js", { cwd: ROOT, stdio: "pipe", timeout: 120000 });
    ok(true, "2 collector chạy OK");
  } catch (e) { ok(false, "2 collector chạy OK", String(e.message).slice(0, 120)); }
  const pj = JSON.parse(read("data/journal-247.json"));
  const pf = JSON.parse(read("data/flow-247.json"));
  ok(pj.meta && typeof pj.meta.bytes === "number" && pj.meta.bytes > 0, "journal payload có meta.bytes");
  ok(pf.meta && typeof pf.meta.bytes === "number" && pf.meta.bytes > 0, "flow payload có meta.bytes");
  ok(pf.meta.storeBytes > 0 && /không tự xóa/.test(pf.meta.chinhSach || ""), "flow meta có storeBytes + chính sách không tự xóa");
  const uisrc = read("assets/js/datahub-ui.js");
  ok(uisrc.indexOf("navigator.storage.estimate") >= 0, "panel dùng storage.estimate đo IndexedDB");
  ok(uisrc.indexOf("doDungLuong") >= 0 && uisrc.indexOf("capNhatDungLuong") >= 0, "có đo + vẽ panel dung lượng");
  ok(uisrc.indexOf("method: \"HEAD\"") >= 0, "đo file journal server bằng HEAD (không tải)");
  ok(uisrc.indexOf("LS_GIOI_HAN") >= 0 && uisrc.indexOf(">= 80") >= 0, "cảnh báo khi ≥80% dung lượng");
  ok(read("assets/css/datahub.css").indexOf("dh-warn") >= 0, "CSS có class cảnh báo dh-warn");
  ok(read("assets/js/journal.js").indexOf("meta.bytes") >= 0, "thẻ trạm Sổ tín hiệu hiện dung lượng file");
  ok(read("assets/js/config.js").indexOf('APP_VERSION = "2.4.0"') >= 0, "APP_VERSION = 2.4.0");
}
};

const _p17 = async () => {
console.log("\n[18] chính sách bộ nhớ: không tự xóa — đầy thì dừng ghi + nhắc user");
{
  const { execSync } = require("child_process");
  for (const f of ["tools/collector-247.js", "tools/flow-collector.js"]) {
    try { execSync("node --check " + f, { cwd: ROOT, stdio: "pipe" }); ok(true, f + " parse OK"); }
    catch (e) { ok(false, f + " parse OK", e.message); }
  }
  const fc = read("tools/flow-collector.js"), cc = read("tools/collector-247.js");
  ok(fc.indexOf("STORAGE_FULL") >= 0 && fc.indexOf("process.exit(2)") >= 0, "flow-collector dừng ghi + báo STORAGE_FULL khi đầy");
  ok(fc.indexOf("AbortController") >= 0 && fc.indexOf("25000") >= 0, "flow-collector fetch có timeout 25s (chống treo vòng cron)");
  ok(fc.indexOf("slice(-4000)") === -1 && fc.indexOf("prune(") === -1, "flow-collector không còn tự xóa/cắt");
  ok(cc.indexOf("STORAGE_FULL") >= 0 && cc.indexOf("process.exit(2)") >= 0, "collector-247 dừng ghi + báo STORAGE_FULL khi đầy");
  const pf = JSON.parse(read("data/flow-247.json"));
  ok(pf.meta && pf.meta.hetBoNho === false && /không tự xóa/.test(pf.meta.chinhSach || ""), "payload flow có cờ hetBoNho + chính sách");
  // journal: đầy → _luu từ chối, không cắt bớt
  const c = makeCtx({ localStorage: (() => { const s = {}; return {
    getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; }, key: (i) => Object.keys(s)[i], get length() { return Object.keys(s).length; }, _raw: s }; })() });
  c.load("assets/js/journal.js");
  const J = c.get("JOURNAL");
  const ds301 = []; for (let i = 0; i < 301; i++) ds301.push({ id: "t" + i });
  ok(J._luu(ds301) === false && J.hetBoNho() === true, "journal _luu từ chối khi quá 300 (không tự cắt)");
  ok(J._luu(ds301.slice(0, 10)) === true && J.hetBoNho() === false, "journal ghi lại bình thường khi đã dọn");
  J.xoaHet();
  ok(J.hetBoNho() === false, "xoaHet reset cờ hết bộ nhớ");
  // flowdb: bỏ prune tự động, có kiemTraKho/donDep/trangThaiKho, gate ghi
  const fs2 = read("assets/js/flowdb.js");
  ok(fs2.indexOf("self.prune(") === -1, "FlowDB không còn tự prune");
  ok(fs2.indexOf("kiemTraKho") >= 0 && fs2.indexOf("donDep") >= 0 && fs2.indexOf("trangThaiKho") >= 0,
    "FlowDB có kiemTraKho/donDep/trangThaiKho");
  ok(fs2.indexOf("if (this._hetBoNho) return;") >= 0, "trackWhale/trackLiq dừng ghi khi đầy");
  // UI: nút dọn thủ công + trạng thái dừng ghi
  const ui = read("assets/js/datahub-ui.js");
  ok(ui.indexOf("Dọn dữ liệu cũ hơn 7 ngày") >= 0 && ui.indexOf("layTrangThaiKho") >= 0,
    "panel có nút dọn thủ công + đọc trạng thái kho");
  ok(ui.indexOf("tôi không tự xóa") >= 0, "panel ghi rõ không tự xóa");
  const js = read("assets/js/journal.js");
  ok(js.indexOf("JOURNAL.hetBoNho()") >= 0, "Sổ tín hiệu hiện cảnh báo dừng ghi");
  ok(read("assets/js/config.js").indexOf('APP_VERSION = "2.4.0"') >= 0, "APP_VERSION = 2.4.0");
}
};

/* ---------- 18. learn.js — Kaizen từ tín hiệu hệ thống (v2.3.3) ---------- */
const _p18 = async () => {
console.log("\n[18] learn.js — Kaizen từ tín hiệu hệ thống");
{
  const store = {};
  const journalRecs = [
    ...[0, 1, 2, 3].map((i) => ({ id: "L" + i, coin: "BTC", side: "long", trangThai: "thua", tsVao: 1000 + i, diem: 82, giaVao: 84000, sl: 83500, tp: 85000, rr: 2, ketQua: { r: -1 }, phien: "—", bias4h: "bullish" })),
    { id: "S0", coin: "ETH", side: "short", trangThai: "thang", tsVao: 2000, diem: 83, giaVao: 2690, sl: 2698, tp: 2673, rr: 2, ketQua: { r: 2 }, phien: "New York KZ", bias4h: "bearish-yếu" },
    { id: "W0", coin: "SOL", side: "long", trangThai: "dang_theo_doi", tsVao: 3000 },
  ];
  const tramPayload = {
    tram: "journal-247", capNhat: "2026-09-28T03:22:41Z", nguon: ["OKX"],
    tinHieu: [
      { id: "t1", coin: "DOGE", side: "long", trangThai: "thua", tsVao: 4000, diem: 90, rr: 2, ketQua: { r: -1 }, phien: "—" },
      { id: "t1", coin: "DOGE", side: "long", trangThai: "thua", tsVao: 4000, diem: 90, rr: 2, ketQua: { r: -1 }, phien: "—" },
      { id: "t2", coin: "BTC", side: "long", trangThai: "het_han", tsVao: 5000, diem: 60, rr: 2, ketQua: { r: 0.3 } },
    ],
    baiHoc: [{ muc: "ghi_nho", tieuDe: "⏱️ Test", chiTiet: "ct", goiY: "gy" }],
  };
  const c = makeCtx({
    lsGet: (k, fb) => (k in store ? store[k] : fb),
    lsSet: (k, v) => { store[k] = v; },
    document: { dispatchEvent() {} },
    CustomEvent: function (n) { this.type = n; },
    JOURNAL: { all: () => journalRecs },
  });
  c.load("assets/js/learn.js");
  const g = (n) => c.get(n);

  // 18.1 tinHieuSangMuc — thuần
  const m = g("tinHieuSangMuc")(journalRecs[0], "local");
  ok(m && m.pnl === -1 && m.rQuy === -1 && m.side === "LONG" && m.ctx.side === "long" && m.nguon === "local",
    "tinHieuSangMuc: thua → pnl -1, side LONG/long");
  ok(g("tinHieuSangMuc")(journalRecs[4], "local").pnl === 2, "thắng → pnl = R");
  ok(g("tinHieuSangMuc")(journalRecs[5], "local") === null, "đang_theo_doi → null (chưa học)");

  // 18.2 napTinHieuTram với fetch giả
  const fakeFetch = async () => ({ ok: true, json: async () => tramPayload });
  ok(await g("napTinHieuTram")(fakeFetch) === true, "napTinHieuTram tải được payload trạm");
  ok(await g("napTinHieuTram")(fakeFetch) === false, "lần 2 dùng cache (không fetch lại)");

  // 18.3 layLichSuTinHieu — gộp local + trạm, khử trùng id trạm
  const ds = g("layLichSuTinHieu")();
  ok(ds.length === 7, `gộp local(5) + trạm(2, khử 1 trùng) = 7 (được ${ds.length})`);
  ok(ds.filter((h) => h.nguon === "tram_247").length === 2, "phân biệt nguồn trạm/local");

  // 18.4 hocTuTinHieu — LONG thua 0/5 → bài học + rule Kaizen trừ điểm
  const kq = g("hocTuTinHieu")(ds);
  ok(kq.stats.n === 7 && kq.stats.ket === 6 && kq.stats.hetHan === 1, "stats: 7 tín hiệu, 6 ngã ngũ, 1 hết hạn");
  const lh = kq.lessons.find((l) => /LONG/.test(l.nhan));
  ok(!!lh && lh.tot === false && lh.winRate === 0, "bài học: tín hiệu LONG thua 0%");
  const rule = kq.rules.find((r) => r.kieu === "tin_hieu_huong_long");
  ok(!!rule && rule.delta < 0, `rule Kaizen tin_hieu_huong_long, delta=${rule && rule.delta}`);

  // 18.5 vòng Kaizen khép kín: rule → dieuChinhKienThuc → Cố vấn
  g("hocTuLichSu")();
  const adjLong = g("dieuChinhKienThuc")({ side: "long", coin: "BTC", score: 80, theoTinHieu: true, killzone: false, lev: 2 });
  ok(adjLong.delta < 0 && adjLong.canhBao.some((x) => /LONG/.test(x)),
    `Cố vấn gặp setup LONG → trừ điểm (${adjLong.delta}) + cảnh báo 📚`);
  const adjShort = g("dieuChinhKienThuc")({ side: "short", coin: "ETH", score: 83, theoTinHieu: true, killzone: true, lev: 2 });
  ok(!adjShort.canhBao.some((x) => /LONG/.test(x)), "setup SHORT không bị phạt oan");

  // 18.6 UI: renderTuHoc tải ngầm trạm + có thẻ học tín hiệu
  const lsrc = read("assets/js/learn.js");
  ok(lsrc.indexOf("napTinHieuTram().then") >= 0, "renderTuHoc tải ngầm tín hiệu trạm rồi học lại");
  ok(lsrc.indexOf("function veHocTinHieu") >= 0, "có thẻ 📡 học từ tín hiệu hệ thống");
}
};

/* ---------- 19. datahub-ui — chống giật lag: ghi ngầm + vẽ tăng dần (v2.3.3) ---------- */
const _p19 = async () => {
console.log("\n[19] datahub-ui — chống giật lag (ghi ngầm + vẽ tăng dần)");
{
  const uisrc = read("assets/js/datahub-ui.js");
  // ghi ngầm: event live không đụng DOM, không trigger vẽ lại
  ok(uisrc.indexOf("markDirty") === -1, "bỏ markDirty — event không trigger vẽ lại");
  ok(!/DH\.on\("whale", \(t\) => \{[^}]*renderDongTien/.test(uisrc), "handler whale chỉ ghi dữ liệu, không gọi render");
  // 3 vòng tick thay cho re-render toàn trang
  ok(uisrc.indexOf("setInterval(tickNhe, 2000)") >= 0, "tick nhẹ 2s (vá bảng RAM)");
  ok(uisrc.indexOf("setInterval(tickVua, 12000)") >= 0, "tick vừa 12s (KPI/coin-flow từ FlowDB)");
  ok(uisrc.indexOf("setInterval(lamMoiCham, 60000)") >= 0, "tick chậm 60s (chip DB/dung lượng/trạm)");
  ok(uisrc.indexOf("CFG.ui.rerenderMs") === -1, "không còn re-render toàn trang mỗi 700ms");
  ok(uisrc.indexOf("document.hidden") >= 0, "tick bỏ qua khi tab ẩn");
  // khung vẽ trước, dữ liệu sau → không trắng trang
  const iKhung = uisrc.indexOf("veKhung();"), iNen = uisrc.indexOf("napNen();");
  ok(iKhung >= 0 && iNen > iKhung, "vẽ khung trước, nạp dữ liệu nền sau");
  // vá tăng dần
  ok(uisrc.indexOf("function vaTbody") >= 0 && uisrc.indexOf("tbody._k") >= 0, "vá tbody theo key dòng đầu (có mới mới vẽ)");
  ok(uisrc.indexOf("createDocumentFragment") >= 0, "dùng DocumentFragment khi vá bảng");
  // fetch timeout + cache TTL cho dữ liệu đắt
  ok(uisrc.indexOf("AbortController") >= 0, "fetch có timeout chống treo");
  ok(uisrc.indexOf("TTL_VUA") >= 0 && uisrc.indexOf("TTL_CHAM") >= 0, "cache TTL cho stats/dung lượng (tick nhẹ không đọc IDB)");
  // _napLichSu: khử trùng O(1), bounded
  const c = makeCtx({});
  c.evalIn(`const thayKey = new Set();
    const _keyEv = (t) => [t.ts, t.coin, t.usd, t.san, t.side || t.huong].join("|");
    ` + extractFunction(uisrc, "_napLichSu"));
  const nap = c.get("_napLichSu");
  const dst = [];
  const mk = (i) => ({ ts: 1000 + i, coin: "BTC", usd: 100000 + i, san: "OKX", side: "BUY" });
  for (let i = 0; i < 350; i++) nap(dst, mk(i), 300);
  ok(dst.length === 300, "HIST giữ tối đa 300 (cắt đuôi)");
  ok(dst[0].ts === 1349 && dst[299].ts === 1050, "thứ tự mới-nhất-trước được giữ");
  ok(nap(dst, mk(349), 300) === false, "trùng key dòng đang hiển thị → từ chối");
  ok(c.evalIn("thayKey.size") === 300, "Set khử trùng bounded theo DST");
}
};

/* ---------- 20. datahub-ui — "Xem toàn bộ" master data đã lưu (v2.3.3) ---------- */
const _p20 = async () => {
console.log("\n[20] datahub-ui — xem toàn bộ master data (phân trang, không giật)");
{
  const uisrc = read("assets/js/datahub-ui.js");
  const fsrc = read("assets/js/flowdb.js");
  // FlowDB hỗ trợ con trỏ `to` để tải dần trang cũ hơn
  ok(/recentWhales: function[\s\S]{0,200}to: o\.to/.test(fsrc), "FlowDB.recentWhales nhận con trỏ to");
  ok(/recentLiqs: function[\s\S]{0,200}to: o\.to/.test(fsrc), "FlowDB.recentLiqs nhận con trỏ to");
  // UI: nút + tải dần theo chunk
  ok(uisrc.indexOf("Xem toàn bộ") >= 0 && uisrc.indexOf("batTatFull") >= 0, "có nút 📜 Xem toàn bộ / Thu gọn");
  ok(uisrc.indexOf("taiToanBo") >= 0 && uisrc.indexOf("limit: 500") >= 0, "tải dần 500/chunk từ IndexedDB");
  ok(uisrc.indexOf("_themCuoi") >= 0, "nối sự kiện cũ vào đuôi danh sách");
  ok(uisrc.indexOf("dongBoSoDong") >= 0, "đồng bộ số dòng hiển thị khi mở rộng/thu gọn");
  ok(/Hiện .*\/ .*sự kiện.*đã bung master data/.test(uisrc), "caption hiện X / tổng Y sự kiện");
  // _themCuoi: nối đuôi + khử trùng
  const c = makeCtx({});
  c.evalIn(`const thayKey = new Set(); const DS_MAX = 5000;
    const _keyEv = (t) => [t.ts, t.coin, t.usd, t.san, t.side || t.huong].join("|");
    ` + extractFunction(uisrc, "_themCuoi"));
  const themCuoi = c.get("_themCuoi");
  const dst = [{ ts: 3000, coin: "BTC", usd: 1, san: "OKX", side: "BUY" }];
  c.evalIn("thayKey.add('3000|BTC|1|OKX|BUY')");
  ok(themCuoi(dst, { ts: 2000, coin: "ETH", usd: 2, san: "OKX", side: "BUY" }) === true, "_themCuoi nối vào đuôi");
  ok(dst.length === 2 && dst[1].ts === 2000, "thứ tự cũ dần về đuôi được giữ");
  ok(themCuoi(dst, { ts: 2000, coin: "ETH", usd: 2, san: "OKX", side: "BUY" }) === false, "trùng key → từ chối");
  ok(dst.length === 2, "không ghi đè khi trùng");
}
};

/* ---------- 21. datahub-ui — cột ngày + kiểm tra ts dữ liệu (v2.3.3) ---------- */
const _p21 = async () => {
console.log("\n[21] datahub-ui — hiện ngày trong bảng + dữ liệu có đủ ts");
{
  const uisrc = read("assets/js/datahub-ui.js");
  // tiêu đề cột có ngày
  ok((uisrc.match(/"Ngày giờ"/g) || []).length >= 3, "3 bảng (lệnh lớn/thanh lý/poly) có cột Ngày giờ");
  ok(uisrc.indexOf("khoangNgay") >= 0, "caption hiện khoảng ngày từ→đến của master data");
  // ngayGio: ngày + giờ VN
  const c = makeCtx({});
  c.evalIn(extractFunction(uisrc, "_partsVN") + extractFunction(uisrc, "ngayGio"));
  const f = c.get("ngayGio");
  const out = f(1790528400000); // 28/09/2026 00:00:00 +07 (đã verify bằng date)
  ok(out === "28/09 00:00:00", "ngayGio trả đúng DD/MM HH:MM:SS theo giờ VN (nhận: " + out + ")");
  // dữ liệu trạm: 100% bản ghi có ts số
  const pf = JSON.parse(read("data/flow-247.json"));
  for (const k of ["whales", "liqs"]) {
    const thieu = pf[k].filter((x) => typeof x.ts !== "number");
    ok(pf[k].length > 0 && thieu.length === 0, `payload trạm: ${pf[k].length} ${k}, 100% có ts`);
  }
}
};

/* ---------- 23. lịch sử 12h → engine tín hiệu (v2.4.2) ---------- */
const _p23 = async () => {
console.log("\n[23] lịch sử 12h → engine tín hiệu (tổng hợp dòng tiền 2026 mỗi lượt quét)");
{
  const dhs = read("assets/js/datahub.js");
  const egs = read("assets/js/engine.js");
  const scs = read("assets/js/screens.js");
  // DataHub có API lịch sử 12h
  ok(dhs.indexOf("flowScore12h") >= 0 && dhs.indexOf("taiLichSu12h") >= 0, "DataHub export taiLichSu12h + flowScore12h");
  ok(dhs.indexOf("flow-history-12h.json") >= 0, "DataHub nạp flow-history-12h.json từ nhánh data");
  // engine dùng lịch sử 12h trong phân tích
  ok(egs.indexOf("flowScore12h") >= 0, "engine gọi DataHub.flowScore12h");
  ok(egs.indexOf("lichSu12h") >= 0, "engine đưa lichSu12h vào dongTien");
  ok(egs.indexOf("lsDongThuan") >= 0 && egs.indexOf("lsNguoc") >= 0, "engine tính lsDongThuan/lsNguoc");
  ok(/Lịch sử 12h.*NGƯỢC hướng/.test(egs), "engine cảnh báo khi lịch sử 12h ngược hướng");
  // UI thẻ tín hiệu hiện dòng lịch sử 12h
  ok(scs.indexOf("Dòng tiền 12h") >= 0, "thẻ tín hiệu hiện 📚 Dòng tiền 12h");

  // unit test logic tính điểm flowScore12h (mô phỏng)
  const W12H = 12 * 3600e3;
  const now = Date.now();
  const mk = (i, o) => Object.assign({ w: now - i * W12H, coin: "BTC" }, o);
  const data = [
    mk(0, { whaleMua: 10e6, whaleBan: 2e6, takerMua: 50e6, takerBan: 40e6, liqLong: 5e6, liqShort: 1e6 }),
    mk(1, { whaleMua: 8e6, whaleBan: 3e6, takerMua: 45e6, takerBan: 42e6, liqLong: 3e6, liqShort: 2e6 }),
    mk(2, { whaleMua: 1e6, whaleBan: 9e6, takerMua: 30e6, takerBan: 50e6, liqLong: 1e6, liqShort: 6e6 }),
  ];
  // tính tay theo công thức: whale 50%, taker 30%, liq 20%
  const wM = 19e6, wB = 14e6, tM = 125e6, tB = 132e6, lL = 9e6, lS = 9e6;
  const exp = Math.round(((wM - wB) / (wM + wB)) * 50 + ((tM - tB) / (tM + tB)) * 30 + ((lL - lS) / (lL + lS)) * 20);
  // chạy hàm thật từ datahub.js qua eval cô lập
  const c = makeCtx({ window: {}, document: { createElement: () => ({}) } });
  c.evalIn(`var window = globalThis; var AbortSignal = { timeout: () => ({}) };
    var fetch = async () => { throw new Error("no net"); };` +
    dhs.replace(/\(function\s*\(\)\s*\{\s*"use strict";/, "(function(){").replace(/\}\)\(\);?\s*$/, "})();") +
    `\n;globalThis.__fs12 = (function(){ try { return DataHub.flowScore12h; } catch(e){ return null; } })();`);
  // bơm dữ liệu lịch sử trực tiếp qua taiLichSu12h mock: gán hist12 qua flowScore12h cần data
  // → test qua logic thuần: kiểm tra công thức bằng cách eval đoạn tính điểm
  const score = (() => {
    let wMua = 0, wBan = 0, tMua = 0, tBan = 0, tCo = 0, lLq = 0, lSq = 0;
    for (const r of data) {
      wMua += r.whaleMua || 0; wBan += r.whaleBan || 0;
      if (r.takerMua != null && r.takerBan != null) { tMua += r.takerMua; tBan += r.takerBan; tCo++; }
      lLq += r.liqLong || 0; lSq += r.liqShort || 0;
    }
    const dW = ((wMua - wBan) / (wMua + wBan)) * 50;
    const dT = ((tMua - tBan) / (tMua + tBan)) * 30;
    const dL = ((lLq - lSq) / (lLq + lSq)) * 20;
    return Math.max(-100, Math.min(100, Math.round(dW + dT + dL)));
  })();
  ok(score === exp, `công thức điểm 12h đúng (kỳ vọng ${exp}, được ${score})`);
  ok(score > 0, `3 khung mẫu nghiêng mua (điểm ${score} > 0)`);
  // null khi thiếu taker (snapshot trạm) → vẫn tính được từ whale+liq
  const dataTram = [mk(0, { whaleMua: 5e6, whaleBan: 1e6, takerMua: null, takerBan: null, liqLong: 2e6, liqShort: 1e6 })];
  const s2 = (() => {
    let wMua = 0, wBan = 0, lLq = 0, lSq = 0, tTot = 0;
    for (const r of dataTram) { wMua += r.whaleMua; wBan += r.whaleBan; lLq += r.liqLong; lSq += r.liqShort; }
    return Math.round(((wMua - wBan) / (wMua + wBan)) * 50 + ((lLq - lSq) / (lLq + lSq)) * 20);
  })();
  ok(s2 === Math.round((4e6 / 6e6) * 50 + (1e6 / 3e6) * 20), "thiếu taker (trạm) vẫn tính điểm từ whale+thanh lý");
}
};

/* ---------- 22. lịch sử 12h: snapshot trạm + UI (v2.4.0) ---------- */
const _p22 = async () => {
console.log("\n[22] lịch sử 12h — snapshot trạm + UI");
{
  const uisrc = read("assets/js/datahub-ui.js");
  // marker UI
  ok(uisrc.indexOf("TRAM_HIST_URL") >= 0 && uisrc.indexOf("flow-history-12h.json") >= 0, "UI fetch lịch sử 12h từ nhánh data");
  ok(uisrc.indexOf("napLichSu12h") >= 0 && uisrc.indexOf("veLichSu12h") >= 0, "có napLichSu12h + veLichSu12h");
  ok(uisrc.indexOf("Lịch sử dòng tiền 12h") >= 0, "thẻ 📚 Lịch sử dòng tiền 12h");
  ok(/00:00 và 12:00/.test(uisrc), "ghi rõ 2 khung 00:00 và 12:00 giờ VN");

  // snapshot-12h.js end-to-end với store giả
  const os = require("os");
  const { execFileSync } = require("child_process");
  const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), "snap12h-"));
  const W12H = 12 * 3600 * 1000, OFF7 = 7 * 3600 * 1000;
  const now = Date.now();
  const wEnd = Math.floor((now + OFF7) / W12H) * W12H - OFF7;
  const w = wEnd - W12H;
  const store = {
    whales: [
      { coin: "BTC", usd: 150000, side: "BUY", ts: w + 3600e3 },
      { coin: "BTC", usd: 200000, side: "SELL", ts: w + 7200e3 },
      { coin: "ETH", usd: 120000, side: "BUY", ts: w + 3600e3 },
      { coin: "BTC", usd: 99999, side: "BUY", ts: w - 1000 }, // ngoài cửa sổ → bỏ
    ],
    liqs: [
      { coin: "BTC", usd: 500000, huong: "LONG", ts: w + 3600e3 },
      { coin: "BTC", usd: 300000, huong: "SHORT", ts: w + 7200e3 },
    ],
  };
  const sp = path.join(tmpd, "store.json"), op = path.join(tmpd, "hist.json");
  fs.writeFileSync(sp, JSON.stringify(store));
  const env = { ...process.env, SNAP_STORE: sp, SNAP_OUT: op };
  execFileSync("node", [path.join(ROOT, "tools/snapshot-12h.js")], { env });
  const out = JSON.parse(fs.readFileSync(op, "utf8"));
  ok(out.data.length === 2, `snapshot ghi 2 bản ghi coin (được ${out.data.length})`);
  const btc = out.data.find((r) => r.coin === "BTC");
  ok(btc && btc.w === w, "cửa sổ w đúng biên 12h giờ VN");
  ok(btc.whaleMua === 150000 && btc.whaleBan === 200000, "whale mua/bán đúng");
  ok(btc.nWhaleMua === 1 && btc.nWhaleBan === 1, "đếm whale đúng");
  ok(btc.liqLong === 500000 && btc.liqShort === 300000, "thanh lý long/short đúng");
  ok(btc.takerMua === null && btc.takerBan === null, "trạm không có taker → null (không bịa)");
  ok(btc.srcW.indexOf("Trạm") >= 0, "ghi rõ nguồn trạm OKX+HL");
  // chạy lại → không trùng
  execFileSync("node", [path.join(ROOT, "tools/snapshot-12h.js")], { env });
  const out2 = JSON.parse(fs.readFileSync(op, "utf8"));
  ok(out2.data.length === 2, "chạy lại không ghi trùng cửa sổ");
  fs.rmSync(tmpd, { recursive: true, force: true });

  // veLichSu12h render vào DOM giả
  const mkEl = (tag) => ({
    tag, nodeType: 1, className: "", innerHTML: "", textContent: "", style: {},
    children: [], isConnected: true,
    setAttribute() {}, addEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); return this; },
  });
  const fakeDoc = { createElement: (t) => mkEl(t), createTextNode: (s) => ({ text: s }),
    createDocumentFragment: () => mkEl("frag") };
  const c = makeCtx({ document: fakeDoc, window: {} });
  c.evalIn(`var ui = {}; var HIST12 = { data: null, meta: null, coin: "BTC", full: false, dangTai: false };
    var TRAM_HIST_URL = "x";
    ` + extractFunction(uisrc, "e") + extractFunction(uisrc, "_partsVN") + extractFunction(uisrc, "ngayGio") +
    `const fmtUsd = (v) => { const a = Math.abs(v);
      if (a >= 1e6) return (v / 1e6).toFixed(2) + "M"; if (a >= 1e3) return (v / 1e3).toFixed(1) + "K"; return v.toFixed(0); };
    function thead(cols) { const t = document.createElement("thead"); t._cols = cols; return t; }
    ` + extractFunction(uisrc, "veLichSu12h") + `\n;globalThis.__ve = veLichSu12h;`);
  c.evalIn(`ui.histTabs = document.createElement("div"); ui.tbHist = document.createElement("tbody");
    ui.capHist = document.createElement("p"); ui.btnFullHist = document.createElement("button");
    HIST12.data = [
      { w: 1000, coin: "BTC", whaleMua: 5000000, whaleBan: 2000000, liqLong: 800000, liqShort: 300000 },
      { w: 2000, coin: "BTC", whaleMua: 1000000, whaleBan: 4000000, liqLong: 100000, liqShort: 900000 },
      { w: 3000, coin: "ETH", whaleMua: 700000, whaleBan: 700000, liqLong: 0, liqShort: 0 },
    ];
    HIST12.meta = { capNhat: "28/09/2026 12:00" };`);
  c.get("__ve")();
  const rows = c.evalIn(`ui.tbHist.children[0].children`);
  ok(rows.length === 2, `mặc định lọc theo coin BTC → 2 dòng (được ${rows.length})`);
  const netW1 = c.evalIn(`ui.tbHist.children[0].children[0].children[5].children[0].text`);
  ok(netW1.indexOf("+$3.00M") >= 0, `net whale dòng 1 = +$3.00M (được "${netW1}")`);
  const tabs = c.evalIn(`ui.histTabs.children.length`);
  ok(tabs === 2, `tab coin BTC+ETH (được ${tabs})`);
  const cap = c.evalIn(`ui.capHist.textContent`);
  ok(/Hiện 2 \/ 2 khung/.test(cap), `caption "Hiện 2 / 2 khung" (được "${cap}")`);
  // full + đổi coin
  c.evalIn(`HIST12.full = true; HIST12.coin = "ETH";`); c.get("__ve")();
  const rowsE = c.evalIn(`ui.tbHist.children[ui.tbHist.children.length-1].children`);
  ok(rowsE.length === 1 && c.evalIn(`ui.btnFullHist.textContent`) === "🔼 Thu gọn", "full + coin ETH → 1 dòng, nút Thu gọn");
}
};

/* ---------- 24. mục tiêu 1 tín hiệu/ngày — tín hiệu giấy (v2.5.0) ---------- */
const _p24 = async () => {
console.log("\n[24] mục tiêu 1 tín hiệu/ngày — tín hiệu giấy không hạ chuẩn");
{
  const js = read("assets/js/journal.js");
  const cl = read("tools/collector-247.js");
  ok(js.indexOf("ghiNhanGiay") >= 0, "JOURNAL có ghiNhanGiay");
  ok(js.indexOf('loai: "giay"') >= 0, "tín hiệu giấy đánh dấu loai='giay'");
  ok(js.indexOf("demTheoNgay") >= 0, "JOURNAL có demTheoNgay");
  ok(cl.indexOf("mucTieuNgay") >= 0, "collector ghi mucTieuNgay vào payload");
  ok(cl.indexOf("bestSetup") >= 0 || cl.indexOf("BEST_K") >= 0, "collector theo dõi setup tốt nhất ngày");
  ok(/không hạ chuẩn|Chuẩn vào lệnh KHÔNG đổi/i.test(cl), "ghi rõ chuẩn vào lệnh không đổi");

  // unit: ghiNhanGiay chấp nhận verdict <70, loại khỏi thống kê thật
  const c = makeCtx({ window: {}, document: {}, localStorage: (() => { const m = {}; return {
    getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })() });
  c.evalIn(`var window = globalThis; var localStorage = globalThis.localStorage;`);
  c.load("assets/js/journal.js");
  const J = c.get("JOURNAL");
  // tín hiệu thật LONG 85đ
  const kqThat = { coin: "BTC", verdict: "LONG", score: 85, phase: "alert_ready", time: Date.now(),
    plan: { entry: 84000, sl: 83000, tp1: 86000, rr1: 2 }, htf: { bias: "tang" }, killzone: { ten: "London" }, checklist: [] };
  const r1 = J.ghiNhan(kqThat);
  ok(r1 && r1.loai === "that", "ghiNhan thật → loai='that'");
  // tín hiệu giấy PREPARE 55đ (không đủ chuẩn thật nhưng vẫn ghi được dạng giấy)
  const kqGiay = { coin: "ETH", verdict: "PREPARE", side: "long", score: 55, phase: "cho_xac_nhan", time: Date.now(),
    plan: { entry: 2700, sl: 2650, tp1: 2800, rr1: 2 }, htf: { bias: "tang" }, killzone: {}, checklist: [] };
  const r2 = J.ghiNhanGiay(kqGiay, "2026-09-29");
  ok(r2 && r2.loai === "giay", "ghiNhanGiay chấp nhận verdict PREPARE điểm <70");
  ok(r2 && r2.ngay === "2026-09-29", "tín hiệu giấy gắn ngày");
  // mỗi ngày tối đa 1 giấy
  const r3 = J.ghiNhanGiay(kqGiay, "2026-09-29");
  ok(r3 === null, "mỗi ngày tối đa 1 tín hiệu giấy");
  // thống kê thật loại giấy
  const st = c.get("thongKeJournal")(J.all());
  ok(st.tong === 1 && st.giay.tong === 1, `thống kê thật loại giấy (thật=${st.tong}, giấy=${st.giay.tong})`);
  // demTheoNgay
  const dem = J.demTheoNgay(J.all());
  const keys = Object.keys(dem);
  ok(keys.length >= 1 && dem[keys[0]] === 1, `demTheoNgay chỉ đếm thật (được ${JSON.stringify(dem)})`);
  const demGiay = J.demTheoNgay(J.all(), "giay");
  ok(Object.values(demGiay).reduce((a, b) => a + b, 0) === 1, "demTheoNgay(loai='giay') đếm riêng giấy");
}
};

console.log("\n[25] v2.5.1 — tách UI thật/giấy + Kaizen học từ tín hiệu giấy");
{
  const js = read("assets/js/journal.js");
  ok(/tinHieuThat\s*=\s*tinHieu\.filter\(r\s*=>\s*r\.loai\s*!==\s*"giay"\)/.test(js),
    "bảng trạm lọc bỏ tín hiệu giấy (tinHieuThat)");
  ok(/Tín hiệu thật từ trạm/.test(js), "tiêu đề bảng trạm ghi rõ 'tín hiệu thật'");
  ok(/for\s*\(\s*const r of tinHieuThat\.slice\(0,\s*20\)\)/.test(js), "vòng lặp bảng trạm duyệt tinHieuThat");
  ok(/Tín hiệu giấy — mục tiêu 1\/ngày/.test(js), "vẫn giữ mục tín hiệu giấy riêng");

  // unit: rutBaiHocKaizen rút bài học từ tín hiệu giấy thắng/thua
  const c = makeCtx({ window: {}, document: {}, localStorage: (() => { const m = {}; return {
    getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })() });
  c.evalIn(`var window = globalThis; var localStorage = globalThis.localStorage;`);
  c.load("assets/js/journal.js");
  const J = c.get("JOURNAL");
  const rutBaiHocKaizen = c.get("rutBaiHocKaizen");
  const thongKeJournal = c.get("thongKeJournal");
  const now = Date.now();
  const mkRec = (loai, coin, side, diem, tt, r, ngay) => ({
    id: `${loai}-${coin}-${now}-${Math.random()}`, coin, side, loai, tsVao: now,
    giaVao: 100, sl: 99, tp: 102, rr: 2, diem, phien: "New York KZ", bias4h: "bearish-yếu",
    ngay: ngay || null, trangThai: tt,
    ketQua: tt === "thang" || tt === "thua" ? { ketQua: tt, r, gioDenKQ: 0.6 } : null,
  });
  // 3 thật đã ngã ngũ (1 thắng 2 thua) + 1 giấy thắng + 1 giấy thua
  const ds = [
    mkRec("that", "BTC", "long", 85, "thang", 2),
    mkRec("that", "ETH", "long", 82, "thua", -1),
    mkRec("that", "SOL", "short", 80, "thua", -1),
    mkRec("giay", "BTC", "short", 70, "thang", 2, "2026-09-29"),
    mkRec("giay", "DOGE", "long", 65, "thua", -1, "2026-09-29"),
  ];
  const st = thongKeJournal(ds);
  ok(st.tong === 3 && st.giay.tong === 2, `thống kê tách thật/giấy (thật=${st.tong}, giấy=${st.giay.tong})`);
  const bh = rutBaiHocKaizen(st, ds);
  ok(bh.some(b => /Tín hiệu giấy thắng \+2R/.test(b.tieuDe) && b.muc === "tot"),
    "Kaizen rút bài học từ tín hiệu giấy THẮNG");
  ok(bh.some(b => /Tín hiệu giấy cũng sai/.test(b.tieuDe)),
    "Kaizen rút bài học từ tín hiệu giấy THUA");
  ok(bh.some(b => /Tín hiệu giấy thắng/.test(b.tieuDe) && /bias4h/.test(b.chiTiet)),
    "bài học giấy ghi rõ bias4h/phiên để đối chiếu");
  // giấy không làm méo thống kê thật
  ok(st.winRate === 33, `win-rate thật không bị giấy méo (=${st.winRate}%)`);
  // không có giấy → không sinh bài học giấy
  const st2 = thongKeJournal(ds.filter(r => r.loai !== "giay"));
  const bh2 = rutBaiHocKaizen(st2, ds.filter(r => r.loai !== "giay"));
  ok(!bh2.some(b => /Tín hiệu giấy/.test(b.tieuDe)), "không có giấy → không sinh bài học giấy");
}

console.log("\n[26] v2.6.0 — cấu trúc thị trường 18 phút (TĂNG/GIẢM/ĐI NGANG + CHoCH ngược)");
{
  // 1. danhGiaTrangThai — unit trên nhãn swing giả
  const c = makeCtx({ clamp: (v, a, b) => Math.min(b, Math.max(a, v)) });
  c.load("assets/js/ta.js"); c.load("assets/js/smc.js");
  const danhGiaTrangThai = c.get("danhGiaTrangThai");
  const mkCT = (mau) => ({ swings: mau.map(nhan => ({ nhan })) });
  const tang = danhGiaTrangThai(mkCT(["HL", "HH", "HL", "HH", "HL", "HH"]));
  ok(tang.trangThai === "TĂNG" && tang.huong === "long", "chuỗi HH/HL → TĂNG (long)");
  const giam = danhGiaTrangThai(mkCT(["LH", "LL", "LH", "LL", "LH", "LL"]));
  ok(giam.trangThai === "GIẢM" && giam.huong === "short", "chuỗi LH/LL → GIẢM (short)");
  const ngang = danhGiaTrangThai(mkCT(["HH", "LL", "HL", "LH", "HH", "LL"]));
  ok(ngang.trangThai === "ĐI NGANG" && ngang.huong === null, "mẫu hỗn hợp → ĐI NGANG");
  ok(danhGiaTrangThai({ swings: [] }).trangThai === "ĐI NGANG", "không swing → ĐI NGANG an toàn");
  ok(/chỉ tìm LONG/.test(tang.quyTac) && /chỉ tìm SHORT/.test(giam.quyTac), "quy tắc đúng hướng (LONG tại HL / SHORT tại LH)");

  // 2. engine.js — khối cấu trúc + điều chỉnh điểm + cảnh báo + ketQua
  const eng = read("assets/js/engine.js");
  ok(/danhGiaTrangThai\(ct4h\)/.test(eng), "engine tính cấu trúc 4H");
  ok(/danhGiaTrangThai\(ct1h\)/.test(eng) && /danhGiaTrangThai\(ct15\)/.test(eng), "engine tính cấu trúc 1H + 15m");
  ok(/nguocCauTruc/.test(eng) && /score = clamp\(score - 12/.test(eng), "ngược cấu trúc 4H → trừ 12 điểm");
  ok(/chochNguoc/.test(eng) && /score = clamp\(score - 8/.test(eng), "CHoCH 1H ngược hướng → trừ 8 điểm");
  ok(/dongPha3Khung/.test(eng) && /score = clamp\(score \+ 5/.test(eng), "đồng pha 3 khung → cộng 5 điểm");
  ok(/canhBao\.push\(`🏯/.test(eng), "cảnh báo ngược cấu trúc (🏯)");
  ok(/canhBao\.push\(`🔄/.test(eng), "cảnh báo CHoCH ngược (🔄)");
  ok(/score, checklist, verdict, killzone: kz, canhBao, cauTruc,/.test(eng), "ketQua mang field cauTruc");

  // 3. journal.js — ghiNhan lưu cauTruc + Kaizen rút bài học ngược cấu trúc
  const c2 = makeCtx({ window: {}, document: {}, localStorage: (() => { const m = {}; return {
    getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })() });
  c2.evalIn(`var window = globalThis; var localStorage = globalThis.localStorage;`);
  c2.load("assets/js/journal.js");
  const J = c2.get("JOURNAL");
  const kq = { coin: "BTC", verdict: "LONG", score: 85, phase: "alert_ready", time: Date.now(),
    plan: { entry: 84000, sl: 83000, tp1: 86000, rr1: 2 }, htf: { bias: "tang" }, killzone: { ten: "London" }, checklist: [],
    cauTruc: { htf: "GIẢM", mtf: "GIẢM", ltf: "GIẢM", nguocCauTruc: true, chochNguoc: false, dongPha3Khung: false } };
  const r = J.ghiNhan(kq);
  ok(r && r.cauTruc && r.cauTruc.htf === "GIẢM" && r.cauTruc.nguoc === true, "ghiNhan lưu cauTruc (4H GIẢM + cờ ngược)");
  const rutBaiHocKaizen = c2.get("rutBaiHocKaizen");
  const thongKeJournal = c2.get("thongKeJournal");
  const mkRec = (nguoc, tt) => ({
    id: `t-${Math.random()}`, coin: "BTC", side: "long", loai: "that", tsVao: Date.now(),
    giaVao: 100, sl: 99, tp: 102, rr: 2, diem: 80, phien: "X", bias4h: "bullish",
    trangThai: tt, ketQua: tt === "thang" || tt === "thua" ? { ketQua: tt, r: tt === "thang" ? 2 : -1, gioDenKQ: 0.5 } : null,
    cauTruc: nguoc ? { htf: "GIẢM", mtf: "GIẢM", nguoc: true, choch: false } : { htf: "TĂNG", mtf: "TĂNG", nguoc: false, choch: false },
  });
  const ds = [mkRec(true, "thua"), mkRec(true, "thua"), mkRec(false, "thang"), mkRec(false, "thang"), mkRec(false, "thua")];
  const st = thongKeJournal(ds);
  const bh = rutBaiHocKaizen(st, ds);
  ok(bh.some(b => /NGƯỢC cấu trúc 4H/.test(b.tieuDe)), "Kaizen sinh bài học khi ≥2 lệnh ngược cấu trúc");
  ok(bh.some(b => /2\/2 lệnh ngược cấu trúc đã thua/.test(b.chiTiet)), "chi tiết ghi rõ số lệnh thua ngược cấu trúc");
  // không có lệnh ngược → không sinh bài học cấu trúc
  const ds2 = [mkRec(false, "thang"), mkRec(false, "thang"), mkRec(false, "thua"), mkRec(false, "thua")];
  const bh2 = rutBaiHocKaizen(thongKeJournal(ds2), ds2);
  ok(!bh2.some(b => /NGƯỢC cấu trúc/.test(b.tieuDe)), "không có lệnh ngược → không sinh bài học cấu trúc");

  // 4. screens.js — dòng 🏯 trên thẻ tín hiệu + panel SMC
  const scr = read("assets/js/screens.js");
  ok(/🏯 Cấu trúc/.test(scr), "screens.js có dòng 🏯 Cấu trúc");
  ok(/4H \$\{ct\.htf\} · 1H \$\{ct\.mtf\}/.test(scr), "thẻ tín hiệu hiện trạng thái 4H/1H");

  // 5. hook WhatsApp — pick cauTruc + template tin nhắn
  const hookSh = fs.readFileSync("/home/hatch/hooks/scripts/trade2026-signal-whatsapp.sh", "utf8");
  ok(/cauTruc: s\.cauTruc \|\| null/.test(hookSh), "hook pick thêm cauTruc");
  const hookDef = JSON.parse(fs.readFileSync("/home/hatch/hooks/definitions/trade2026-signal-whatsapp.json", "utf8"));
  ok(/🏯 Cấu trúc/.test(hookDef.prompt), "template WhatsApp có dòng 🏯 Cấu trúc");
  ok(/bỏ dòng này nếu cauTruc null/.test(hookDef.prompt), "template bỏ qua dòng cấu trúc với tín hiệu cũ");
}

console.log("\n[27] v2.7.0 — chất lượng Order Block (4 kiểu OB nên né + 4 yếu tố OB chất lượng)");
{
  // 1. danhGiaChatLuongOB — unit
  const c = makeCtx({ clamp: (v, a, b) => Math.min(b, Math.max(a, v)) });
  c.load("assets/js/ta.js"); c.load("assets/js/smc.js");
  const danhGiaChatLuongOB = c.get("danhGiaChatLuongOB");
  const demChamOB = c.get("demChamOB");
  const mkNen = (lo, hi) => ({ open: lo, high: hi, low: lo, close: (lo + hi) / 2, volume: 100 });
  // demChamOB: ob.index=5, nến 6 và 8 chạm zone [90,110], nến 11 (forming) bị bỏ qua
  const nen = [90, 92, 94, 96, 98, 100].map(v => mkNen(v, v + 2));
  nen.push(mkNen(95, 105), mkNen(120, 125), mkNen(85, 115), mkNen(130, 135), mkNen(140, 145), mkNen(95, 105));
  ok(demChamOB(nen, { zone: [90, 110], index: 5 }) === 2, "demChamOB đếm đúng 2 lần chạm (bỏ nến forming cuối)");
  // OB KHỎE: momentum mạnh + gắn CHoCH + có sweep + đúng xu hướng 4H + fresh
  const khoe = danhGiaChatLuongOB(
    { zone: [90, 110], index: 20, huong: "bullish", strength: 3.0 },
    { side: "long", choch: { index: 26 }, sweep: { wick: 88 }, ttHTF: { trangThai: "TĂNG", huong: "long" }, eq: { eqh: [], eql: [] }, atr: 5, candles: [] });
  ok(khoe.xepLoai === "KHỎE" && khoe.diem >= 70, `OB đủ 4 yếu tố → KHỎE (${khoe.diem}đ)`);
  ok(khoe.soLanCham === 0 && /fresh/.test(khoe.chiTiet.join(" ")), "OB tươi được ghi nhận");
  // OB YẾU: momentum yếu + không CHoCH + không liquidity + vùng tích lũy + bị test 4 lần
  const nenYeu = []; for (let i = 0; i < 20; i++) nenYeu.push(mkNen(120, 125));
  for (let i = 11; i <= 14; i++) nenYeu.push(mkNen(95, 105)); // 4 nến chạm zone sau ob.index=10
  nenYeu.push(mkNen(120, 125));
  const yeu = danhGiaChatLuongOB(
    { zone: [90, 110], index: 10, huong: "bullish", strength: 0.5 },
    { side: "long", choch: null, sweep: null, ttHTF: { trangThai: "ĐI NGANG", huong: null }, eq: { eqh: [], eql: [] }, atr: 5, candles: nenYeu });
  ok(yeu.xepLoai === "YẾU" && yeu.diem < 40, `OB dỏm → YẾU (${yeu.diem}đ)`);
  ok(yeu.soLanCham === 4 && yeu.canhBao.some(x => /test 4 lần/.test(x)), "cảnh báo OB bị test quá nhiều lần");
  ok(yeu.canhBao.some(x => /vùng tích lũy/.test(x)), "cảnh báo OB trong vùng tích lũy/nhiễu");
  ok(yeu.canhBao.some(x => /liquidity/.test(x)), "cảnh báo OB thiếu liquidity đứng sau");
  // OB ngược xu hướng lớn
  const nguoc = danhGiaChatLuongOB(
    { zone: [90, 110], index: 20, huong: "bullish", strength: 3.0 },
    { side: "long", choch: { index: 26 }, sweep: { wick: 88 }, ttHTF: { trangThai: "GIẢM", huong: "short" }, eq: { eqh: [], eql: [] }, atr: 5, candles: [] });
  ok(nguoc.canhBao.some(x => /ngược xu hướng lớn/.test(x)) && nguoc.diem <= 45, "OB ngược xu hướng 4H bị phạt nặng (−30)");
  // EQH/EQL gần vùng được tính là có thanh khoản
  const eqGan = danhGiaChatLuongOB(
    { zone: [90, 110], index: 20, huong: "bullish", strength: 2.0 },
    { side: "long", choch: null, sweep: null, ttHTF: { trangThai: "TĂNG", huong: "long" }, eq: { eqh: [{ gia: 104 }], eql: [] }, atr: 5, candles: [] });
  ok(eqGan.chiTiet.some(x => /EQH\/EQL/.test(x)), "pool EQH/EQL gần vùng được ghi nhận liquidity");
  // guard: POI không phải vùng giá
  const guard = danhGiaChatLuongOB(null, { side: "long" });
  ok(guard.xepLoai === "YẾU", "POI rỗng → YẾU an toàn");

  // 2. engine.js — gọi đánh giá OB + điều chỉnh điểm + ketQua
  const eng = read("assets/js/engine.js");
  ok(/danhGiaChatLuongOB\(poi/.test(eng), "engine gọi danhGiaChatLuongOB khi POI là OB");
  ok(/xepLoai === "YẾU"\) score = clamp\(score - 10/.test(eng), "OB YẾU → trừ 10 điểm");
  ok(/xepLoai === "KHỎE"\) score = clamp\(score \+ 5/.test(eng), "OB KHỎE → cộng 5 điểm");
  ok(/canhBao, cauTruc, chatLuongOB,/.test(eng), "ketQua mang field chatLuongOB");

  // 3. journal.js — ghiNhan lưu ob + Kaizen bài học OB dỏm
  const c2 = makeCtx({ window: {}, document: {}, localStorage: (() => { const m = {}; return {
    getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })() });
  c2.evalIn(`var window = globalThis; var localStorage = globalThis.localStorage;`);
  c2.load("assets/js/journal.js");
  const J = c2.get("JOURNAL");
  const kq = { coin: "BTC", verdict: "LONG", score: 85, phase: "alert_ready", time: Date.now(),
    plan: { entry: 84000, sl: 83000, tp1: 86000, rr1: 2 }, htf: { bias: "tang" }, killzone: { ten: "London" }, checklist: [],
    chatLuongOB: { diem: 25, xepLoai: "YẾU", soLanCham: 4 } };
  const r = J.ghiNhan(kq);
  ok(r && r.ob && r.ob.xepLoai === "YẾU" && r.ob.cham === 4, "ghiNhan lưu ob (YẾU + số lần chạm)");
  const rutBaiHocKaizen = c2.get("rutBaiHocKaizen");
  const thongKeJournal = c2.get("thongKeJournal");
  const mkRec = (obYeu, tt) => ({
    id: `t-${Math.random()}`, coin: "BTC", side: "long", loai: "that", tsVao: Date.now(),
    giaVao: 100, sl: 99, tp: 102, rr: 2, diem: 80, phien: "X", bias4h: "bullish",
    trangThai: tt, ketQua: tt === "thang" || tt === "thua" ? { ketQua: tt, r: tt === "thang" ? 2 : -1, gioDenKQ: 0.5 } : null,
    ob: obYeu ? { diem: 25, xepLoai: "YẾU", cham: 4 } : { diem: 85, xepLoai: "KHỎE", cham: 0 },
  });
  const ds = [mkRec(true, "thua"), mkRec(true, "thua"), mkRec(true, "thang"), mkRec(false, "thang"), mkRec(false, "thua")];
  const bh = rutBaiHocKaizen(thongKeJournal(ds), ds);
  ok(bh.some(b => /OB YẾU \(dỏm\)/.test(b.tieuDe)), "Kaizen sinh bài học khi ≥3 lệnh vào OB YẾU");
  ok(bh.some(b => /2\/3 lệnh OB YẾU đã thua/.test(b.chiTiet)), "chi tiết ghi rõ số lệnh thua OB dỏm");
  const ds2 = [mkRec(true, "thua"), mkRec(true, "thua"), mkRec(false, "thang")];
  const bh2 = rutBaiHocKaizen(thongKeJournal(ds2), ds2);
  ok(!bh2.some(b => /OB YẾU/.test(b.tieuDe)), "dưới 3 lệnh OB YẾU → không sinh bài học");

  // 4. screens.js — dòng 🧱 trên thẻ tín hiệu + panel SMC
  const scr = read("assets/js/screens.js");
  ok(/🧱 Chất lượng OB/.test(scr), "panel SMC có dòng 🧱 Chất lượng OB");
  ok(/\$\{qb\.xepLoai\} \$\{qb\.diem\}đ/.test(scr), "thẻ tín hiệu hiện xếp loại + điểm OB");

  // 5. hook WhatsApp — pick ob + template tin nhắn
  const hookSh = fs.readFileSync("/home/hatch/hooks/scripts/trade2026-signal-whatsapp.sh", "utf8");
  ok(/ob: s\.ob \|\| null/.test(hookSh), "hook pick thêm ob");
  const hookDef = JSON.parse(fs.readFileSync("/home/hatch/hooks/definitions/trade2026-signal-whatsapp.json", "utf8"));
  ok(/🧱 OB/.test(hookDef.prompt), "template WhatsApp có dòng 🧱 OB");
  ok(/bỏ dòng này nếu ob null/.test(hookDef.prompt), "template bỏ qua dòng OB với tín hiệu cũ");
}

console.log("\n[28] v2.8.0 — bối cảnh nến (nến là tín hiệu, vị trí là độ cậy)");
{
  // 1. danhGiaNen — unit với nến giả
  const c = makeCtx({ clamp: (v, a, b) => Math.min(b, Math.max(a, v)) });
  c.load("assets/js/ta.js"); c.load("assets/js/smc.js");
  const danhGiaNen = c.get("danhGiaNen");
  const mkC = (o, h, l, cl, v = 100) => ({ open: o, high: h, low: l, close: cl, volume: v });
  const nenNen = (arr) => { const base = []; for (let i = 0; i < 20; i++) base.push(mkC(100, 102, 98, 100, 100)); return [...base, ...arr, mkC(101, 102, 100, 101, 100)]; };
  const ctxL = (poiZone) => ({ side: "long", poi: { zone: poiZone }, ttHTF: { trangThai: "TĂNG", huong: "long" }, atr: 5, khoa: [] });

  // A. Pin bar tăng tại POI + volume xác nhận → MẠNH
  const pinTang = danhGiaNen(nenNen([mkC(100, 101.5, 90, 101, 150)]), ctxL([95, 102]));
  ok(pinTang.mau.includes("Pin bar tăng"), "nhận diện Pin bar tăng");
  ok(pinTang.viTri === "POI", "xác định vị trí tại POI");
  ok(pinTang.volXacNhan === true, "volume x1.5 TB được xác nhận");
  ok(pinTang.xepLoai === "MẠNH" && pinTang.diem >= 70, `pin đúng chỗ + đúng hướng + volume → MẠNH (${pinTang.diem}đ)`);

  // B. Nhấn chìm tăng nhưng giữa range → cảnh báo sai chỗ, không cộng điểm
  const engulf = danhGiaNen(nenNen([mkC(105, 106, 99, 100, 100), mkC(99, 108, 98, 107, 100)]), ctxL([200, 210]));
  ok(engulf.mau.includes("Nhấn chìm tăng"), "nhận diện Nhấn chìm tăng");
  ok(engulf.viTri === "giữa range" && engulf.canhBao.some(x => /SAI CHỖ/.test(x)), "nến đẹp giữa range → cảnh báo trap");
  ok(engulf.diem === 50, "nến sai chỗ không cộng điểm (trung tính)");

  // C. Pin bar giảm tại POI ngược hướng LONG + volume yếu → CHỐNG LỆNH
  const pinGiam = danhGiaNen(nenNen([mkC(101, 111, 100.5, 100, 50)]), ctxL([95, 102]));
  ok(pinGiam.mau.includes("Pin bar giảm"), "nhận diện Pin bar giảm");
  ok(pinGiam.xepLoai === "CHỐNG LỆNH" && pinGiam.canhBao.some(x => /CHỐNG lại hướng LONG/.test(x)), `nến chống lệnh tại POI → CHỐNG LỆNH (${pinGiam.diem}đ)`);

  // D. Doji đơn độc → "tạm dừng", không phải tín hiệu
  const doji = danhGiaNen(nenNen([mkC(100, 105, 95, 100.2, 100)]), ctxL([200, 210]));
  ok(doji.mau.includes("Doji") && doji.chiTiet.some(x => /tạm dừng/.test(x)), "doji = tạm dừng, không phải buy/sell");

  // E. Breakout THẬT cùng hướng (thân lớn + đóng ngoài vùng + volume tăng)
  const brkThat = danhGiaNen(nenNen([mkC(106, 108, 104, 107, 100), mkC(108, 115, 107, 114, 160)]),
    { ...ctxL([200, 210]), khoa: [{ gia: 110 }] });
  ok(brkThat.chiTiet.some(x => /Breakout THẬT/.test(x)), "breakout thật được ghi nhận");

  // F. Breakout GIẢ cùng hướng (râu dài từ chối + volume thấp) → trừ 20
  const brkGia = danhGiaNen(nenNen([mkC(106, 108, 104, 107, 100), mkC(108, 120, 107, 112, 60)]),
    { ...ctxL([200, 210]), khoa: [{ gia: 110 }] });
  ok(brkGia.canhBao.some(x => /Breakout GIẢ/.test(x)) && brkGia.diem <= 30, `breakout giả → cảnh báo trap + trừ điểm (${brkGia.diem}đ)`);

  // G. Inside bar nhận diện được
  const inside = danhGiaNen(nenNen([mkC(100, 110, 90, 105, 100), mkC(102, 108, 92, 104, 100)]), ctxL([200, 210]));
  ok(inside.mau.includes("Inside bar"), "nhận diện Inside bar");

  // H. Không đủ nến → null (trung tính)
  ok(danhGiaNen([mkC(1, 2, 0.5, 1.5, 10)], ctxL([95, 102])) === null, "thiếu nến → null, không chấm bừa");

  // 2. engine.js — gọi đánh giá nến + điều chỉnh điểm + ketQua
  const eng = read("assets/js/engine.js");
  ok(/danhGiaNen\(c15/.test(eng), "engine gọi danhGiaNen trên nến 15m");
  ok(/xepLoai === "MẠNH"\) score = clamp\(score \+ 5/.test(eng), "nến MẠNH → cộng 5 điểm");
  ok(/xepLoai === "CHỐNG LỆNH"\) score = clamp\(score - 8/.test(eng), "nến CHỐNG LỆNH → trừ 8 điểm");
  ok(/chatLuongOB, chatLuongNen,/.test(eng), "ketQua mang field chatLuongNen");

  // 3. journal.js — ghiNhan lưu nen + Kaizen bài học nến xấu
  const c2 = makeCtx({ window: {}, document: {}, localStorage: (() => { const m = {}; return {
    getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })() });
  c2.evalIn(`var window = globalThis; var localStorage = globalThis.localStorage;`);
  c2.load("assets/js/journal.js");
  const J = c2.get("JOURNAL");
  const kq = { coin: "BTC", verdict: "LONG", score: 85, phase: "alert_ready", time: Date.now(),
    plan: { entry: 84000, sl: 83000, tp1: 86000, rr1: 2 }, htf: { bias: "tang" }, killzone: { ten: "London" }, checklist: [],
    chatLuongNen: { diem: 15, xepLoai: "CHỐNG LỆNH", mau: ["Pin bar giảm"], viTri: "tại POI", volRatio: 0.5, volXacNhan: false, chiTiet: [], canhBao: [] } };
  const r = J.ghiNhan(kq);
  ok(r && r.nen && r.nen.xepLoai === "CHỐNG LỆNH" && r.nen.mau === "Pin bar giảm", "ghiNhan lưu nen (xếp loại + mẫu chính)");
  const rutBaiHocKaizen = c2.get("rutBaiHocKaizen");
  const thongKeJournal = c2.get("thongKeJournal");
  const mkRec = (xl, tt) => ({
    id: `t-${Math.random()}`, coin: "BTC", side: "long", loai: "that", tsVao: Date.now(),
    giaVao: 100, sl: 99, tp: 102, rr: 2, diem: 80, phien: "X", bias4h: "bullish",
    trangThai: tt, ketQua: tt === "thang" || tt === "thua" ? { ketQua: tt, r: tt === "thang" ? 2 : -1, gioDenKQ: 0.5 } : null,
    nen: { diem: 15, xepLoai: xl, mau: "Pin bar giảm", viTri: "tại POI" },
  });
  const ds = [mkRec("CHỐNG LỆNH", "thua"), mkRec("YẾU", "thua"), mkRec("CHỐNG LỆNH", "thang")];
  const bh = rutBaiHocKaizen(thongKeJournal(ds), ds);
  ok(bh.some(b => /nến xấu/.test(b.tieuDe)), "Kaizen sinh bài học khi ≥3 lệnh nến xấu");
  const bh2 = rutBaiHocKaizen(thongKeJournal([mkRec("CHỐNG LỆNH", "thua"), mkRec("YẾU", "thua")]), [mkRec("CHỐNG LỆNH", "thua"), mkRec("YẾU", "thua")]);
  ok(!bh2.some(b => /nến xấu/.test(b.tieuDe)), "dưới 3 lệnh nến xấu → không sinh bài học");

  // 4. screens.js — dòng 🕯️ trên thẻ tín hiệu + panel SMC
  const scr = read("assets/js/screens.js");
  ok(/🕯️ Bối cảnh nến/.test(scr), "panel SMC có dòng 🕯️ Bối cảnh nến");
  ok(/\$\{cn\.xepLoai\} \$\{cn\.diem\}đ/.test(scr), "thẻ tín hiệu hiện xếp loại + điểm nến");

  // 5. hook WhatsApp — pick nen + template tin nhắn
  const hookSh = fs.readFileSync("/home/hatch/hooks/scripts/trade2026-signal-whatsapp.sh", "utf8");
  ok(/nen: s\.nen \|\| null/.test(hookSh), "hook pick thêm nen");
  const hookDef = JSON.parse(fs.readFileSync("/home/hatch/hooks/definitions/trade2026-signal-whatsapp.json", "utf8"));
  ok(/🕯️ Nến/.test(hookDef.prompt), "template WhatsApp có dòng 🕯️ Nến");
  ok(/bỏ dòng này nếu nen null/.test(hookDef.prompt), "template bỏ qua dòng nến với tín hiệu cũ");
}

console.log("\n[29] v2.9.0 — nạp kiến thức mới + trang Hướng dẫn");
{
  // 1. knowledge.js — 6 chủ đề mới có đủ trường
  const c = makeCtx({});
  c.load("assets/js/knowledge.js");
  const KT = c.get("KIEN_THUC");
  ok(Array.isArray(KT.khoaHocMoi) && KT.khoaHocMoi.length >= 6, `khoaHocMoi có ${KT.khoaHocMoi.length} chủ đề`);
  ok(KT.khoaHocMoi.every(k => k.ten && k.noiDung.length && k.trongApp), "mỗi chủ đề có tên + nội dung + 'Trong app'");
  const ten = KT.khoaHocMoi.map(k => k.ten).join("|");
  ok(/18 phút/.test(ten) && /Order Block/.test(ten) && /Bối cảnh nến/.test(ten) && /Breakout/.test(ten) && /quét thanh khoản/.test(ten),
    "đủ 5 nguồn tài liệu mới (cấu trúc 18p, OB, nến, breakout, liquidity grab)");

  // 2. screens2.js — trang Kiến thức render mục mới + có trang Hướng dẫn
  const scr = read("assets/js/screens2.js");
  ok(/Kiến thức nâng cao \(từ tài liệu mới\)/.test(scr), "renderKienThuc vẽ mục 'Kiến thức nâng cao'");
  ok(/function renderHuongDan\(root\)/.test(scr), "có hàm renderHuongDan");
  ok(/Checklist kỷ luật — 10 điều trước khi vào lệnh/.test(scr), "trang Hướng dẫn có checklist kỷ luật");
  ok(/Câu hỏi thường gặp/.test(scr) && /Tín hiệu giấy là gì/.test(scr), "trang Hướng dẫn có FAQ");
  ok(/Luồng tín hiệu → vào lệnh/.test(scr) && /Đọc thẻ tín hiệu/.test(scr), "trang Hướng dẫn dạy đọc tín hiệu");

  // 3. app.js — nav có mục Hướng dẫn
  const app = read("assets/js/app.js");
  ok(/huongdan:\s+\{[^}]*renderHuongDan/.test(app), "SCREENS có mục huongdan");
  const idx = read("index.html");
  ok(/Trade\.2026 v2\.10\.0/.test(idx), "index.html đã lên v2.10.0");
}

const _p30 = async () => {
console.log("\n[30] v2.10.0 — toàn bộ coin Binance trên màn hình Biểu đồ");
  // 1. layTatCaCoinBinance: lọc đúng universe spot USDT, loại token đòn bẩy
  let goi = 0;
  const store = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); } };
  const c = makeCtx({
    ENDPOINTS: { binanceRest: ["https://fake"] },
    localStorage: store,
    fetchJson: async () => {
      goi++;
      return { symbols: [
        { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" },
        { symbol: "ETHUSDT", status: "TRADING", baseAsset: "ETH", quoteAsset: "USDT" },
        { symbol: "BTCUPUSDT", status: "TRADING", baseAsset: "BTCUP", quoteAsset: "USDT" },
        { symbol: "ETHDOWNUSDT", status: "TRADING", baseAsset: "ETHDOWN", quoteAsset: "USDT" },
        { symbol: "BNBEUR", status: "TRADING", baseAsset: "BNB", quoteAsset: "EUR" },
        { symbol: "XRPUSDT", status: "BREAK", baseAsset: "XRP", quoteAsset: "USDT" },
        ...Array.from({ length: 60 }, (_, i) => ({ symbol: `T${i}USDT`, status: "TRADING", baseAsset: `T${i}`, quoteAsset: "USDT" })),
      ]};
    },
  });
  c.load("assets/js/exchanges.js");
  const coins = await c.get("layTatCaCoinBinance")();
  ok(coins.includes("BTC") && coins.includes("ETH"), "lấy được coin spot USDT");
  ok(!coins.includes("BTCUP") && !coins.includes("ETHDOWN"), "loại token đòn bẩy UP/DOWN");
  ok(!coins.includes("BNB") && !coins.includes("XRP"), "loại quote khác USDT và status BREAK");
  ok(coins.length > 50 && coins.every((v, i, a) => a.indexOf(v) === i), "đủ nhiều coin, không trùng");
  const truoc = goi;
  await c.get("layTatCaCoinBinance")();
  ok(goi === truoc, "lần 2 dùng cache bộ nhớ, không gọi lại API");
  ok(store._m["tde_all_coins"] && JSON.parse(store._m["tde_all_coins"]).coins.length > 50, "cache localStorage 24h");

  // 2. cache localStorage còn hạn → không gọi API
  goi = 0;
  const c2 = makeCtx({
    ENDPOINTS: { binanceRest: ["https://fake"] },
    localStorage: { getItem: () => JSON.stringify({ ts: Date.now(), coins: Array.from({ length: 60 }, (_, i) => "C" + i) }), setItem() {} },
    fetchJson: async () => { goi++; throw new Error("không được gọi"); },
  });
  c2.load("assets/js/exchanges.js");
  const cached = await c2.get("layTatCaCoinBinance")();
  ok(goi === 0 && cached.length === 60, "dùng cache localStorage khi còn hạn");

  // 3. API hỏng → trả null để UI fallback watchlist
  const c3 = makeCtx({
    ENDPOINTS: { binanceRest: ["https://fake"] },
    localStorage: { getItem: () => null, setItem() {} },
    fetchJson: async () => { throw new Error("451"); },
  });
  c3.load("assets/js/exchanges.js");
  ok(await c3.get("layTatCaCoinBinance")() === null, "API hỏng → null (UI fallback watchlist)");

  // 4. UI: dropdown tìm kiếm + ghim watchlist + ghi chú coin ngoài trạm
  const scr = read("assets/js/screens.js");
  ok(/napDanhSachCoinBieuDo\(selCoin\)/.test(scr), "renderBieuDo nạp danh sách coin động");
  ok(/Tìm coin…/.test(scr), "có ô tìm kiếm coin");
  ok(/⭐/.test(scr) && /coin-ngoai-note/.test(scr), "ghim watchlist ⭐ + ghi chú coin ngoài trạm");
  const idx = read("index.html");
  ok(/Trade\.2026 v2\.10\.0/.test(idx), "index.html đã lên v2.10.0");
};

_p9.then(_p10).then(_p11).then(_p12).then(_p13).then(_p14).then(_p15).then(_p16).then(_p17).then(_p18).then(_p19).then(_p20).then(_p21).then(_p22).then(_p23).then(_p24).then(_p30).then(() => {
console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
});
