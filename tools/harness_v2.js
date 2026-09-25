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

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
