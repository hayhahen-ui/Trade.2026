/* ============================================================
 * Trade.2026 — Test Liq Feed (hướng F, 20/11/2026)
 * Chạy: node tools/test-liq-feed.js
 * Kiểm chứng assets/js/liq-feed.js (DataHub/DataHubBridge cho trạm):
 *  T1 mapping thanhLyGanDay: đúng coin, đúng cửa sổ, loại bản ghi cũ,
 *    chữ hoa/thường, tham số phut.
 *  T2 mapping flowScore: đúng công thức datahub.js (whale*70 + liq*30),
 *    loaiTruSan loại trừ nguồn.
 *  T3 read time: đổi file kho giữa 2 vòng napLiqFeed -> engine thấy
 *    số mới ngay, không cache xuyên vòng; trong 1 vòng thì ổn định.
 *  T4 sự kiện thật 20/11: replay BTC 4 mốc 22:07/22:22/22:37/22:52 với
 *    kho fixture thật — dongTien.thanhLy15p khớp tính độc lập, cảnh báo
 *    "Thanh lý mạnh" xuất hiện đúng ngưỡng $20M, không tự sinh tín hiệu.
 *  T5 an toàn: kho thiếu/hỏng -> isRunning false, engine chạy tiếp,
 *    dongTien null (không crash, không đổi tín hiệu).
 * Fixture: tools/testdata/liqs-2026-11-20-2130-2330.json (BTC/ETH,
 * 21:00-23:30 VN 20/11) + btc-2026-11-20-klines-{4h,1h,15m}.json.
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const TD = path.join(__dirname, "testdata");
let pass = 0, fail = 0;
function ok(cond, ten, chiTiet) {
  if (cond) { pass++; console.log(`  ✅ ${ten}`); }
  else { fail++; console.log(`  ❌ ${ten}${chiTiet ? " — " + chiTiet : ""}`); }
}
function eq(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 0.5 : eps); }

function vnToMs(s) { // "2026-11-20 22:22" VN -> ms epoch
  const [d, t] = s.split(" ");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m] = t.split(":").map(Number);
  return Date.UTC(Y, M - 1, D, h - 7, m);
}
const CP_2222 = vnToMs("2026-11-20 22:22");

function loadKlines(tf) {
  const raw = JSON.parse(fs.readFileSync(path.join(TD, `btc-2026-11-20-klines-${tf}.json`), "utf8"));
  return raw.map(k => ({ openTime: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: +k[6] }));
}
const KL = { "4h": loadKlines("4h"), "1h": loadKlines("1h"), "15m": loadKlines("15m") };

/* Context VM như collector-247.js: window là object riêng (không phải global),
 * Date giả lập đúng checkpoint, __docKhoFlow đọc file kho theo đường dẫn cho trước. */
function makeCtx({ checkpointMs, khoPath }) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [checkpointMs])); }
    static now() { return checkpointMs; }
  }
  const lsMem = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Promise, Map, Set, RegExp, Object, Array,
    Number, String, Boolean, Error, TypeError, SyntaxError,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    fetch: (...a) => fetch(...a),
    AbortController,
    Date: checkpointMs ? FakeDate : RealDate,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    document: { dispatchEvent() {}, addEventListener() {} },
    window: {},
    navigator: { userAgent: "test-liq-feed" },
    localStorage: {
      getItem: (k) => (k in lsMem ? lsMem[k] : null),
      setItem: (k, v) => { lsMem[k] = String(v); },
      removeItem: (k) => { delete lsMem[k]; },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.__docKhoFlow = () => JSON.parse(fs.readFileSync(khoPath, "utf8"));
  const ctx = vm.createContext(sandbox);
  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
  const get = (name) => vm.runInContext(name, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { sandbox, ctx, load, get, run };
}

function loadEngine(c) {
  ["assets/js/config.js", "assets/js/utils.js", "assets/js/ta.js", "assets/js/smc.js",
   "assets/js/exchanges.js", "assets/js/derivatives.js", "assets/js/journal.js",
   "assets/js/neural.js", "assets/js/engine.js", "assets/js/liq-feed.js"].forEach(c.load);
  try {
    const NN = c.get("NN");
    const wPath = path.join(ROOT, "assets/nn-weights.json");
    if (fs.existsSync(wPath)) NN.napTrongSo(JSON.parse(fs.readFileSync(wPath, "utf8")));
  } catch (e) {}
  // Stub fetchKlines: cắt nến fixture đúng mốc checkpoint (giữ cả nến forming)
  c.sandbox.__stubFetchKlines = async (coin, interval, limit = 260) => {
    const CP = c.get("Date.now()");
    return KL[interval].filter(x => x.openTime <= CP).slice(-limit);
  };
  c.run("fetchKlines = __stubFetchKlines;");
  c.run("JOURNAL.ghiNhan = function(){};");
}

/* Tính độc lập (không qua stub) để đối chiếu mapping. Cửa sổ ĐÚNG là
 * [t0, now]: chặn cả hai đầu để dữ liệu tương lai không rò vào. */
function tlDocLap(kho, coin, cpMs, phut) {
  const t0 = cpMs - phut * 60e3;
  const l = kho.liqs.filter(x => String(x.coin).toUpperCase() === coin && +x.ts >= t0 && +x.ts <= cpMs);
  const long = l.reduce((s, x) => s + (x.huong === "LONG" ? +x.usd : 0), 0);
  const short = l.reduce((s, x) => s + (x.huong === "SHORT" ? +x.usd : 0), 0);
  return { long, short, tong: long + short, count: l.length };
}
function fsDocLap(kho, coin, cpMs) {
  const t0 = cpMs - 30 * 60e3;
  const w = kho.whales.filter(x => String(x.coin).toUpperCase() === coin && +x.ts >= t0 && +x.ts <= cpMs);
  const l = kho.liqs.filter(x => String(x.coin).toUpperCase() === coin && +x.ts >= t0 && +x.ts <= cpMs);
  if (!w.length && !l.length) return 0;
  const buy = w.reduce((s, x) => s + (x.side === "BUY" ? +x.usd : 0), 0);
  const sell = w.reduce((s, x) => s + (x.side === "SELL" ? +x.usd : 0), 0);
  const flow = buy + sell ? ((buy - sell) / (buy + sell)) * 70 : 0;
  const lg = l.reduce((s, x) => s + (x.huong === "LONG" ? +x.usd : 0), 0);
  const ls = l.reduce((s, x) => s + (x.huong === "SHORT" ? +x.usd : 0), 0);
  const liq = lg + ls ? ((lg - ls) / (lg + ls)) * 30 : 0;
  return Math.max(-100, Math.min(100, Math.round(flow + liq)));
}

async function main() {
  /* ---------- T1: mapping thanhLyGanDay ---------- */
  console.log("\n[T1] mapping thanhLyGanDay");
  {
    const kho = { whales: [], liqs: [
      { coin: "BTC", huong: "LONG", usd: 50000000, ts: CP_2222 - 5 * 60e3 },
      { coin: "BTC", huong: "SHORT", usd: 5000000, ts: CP_2222 - 10 * 60e3 },
      { coin: "BTC", huong: "LONG", usd: 999000000, ts: CP_2222 - 20 * 60e3 }, // ngoài cửa sổ 15p -> loại
      { coin: "BTC", huong: "LONG", usd: 1, ts: CP_2222 - 15 * 60e3 }, // đúng biên t0 -> giữ
      { coin: "BTC", huong: "LONG", usd: 888000000, ts: CP_2222 + 5 * 60e3 }, // TƯƠNG LAI so với mốc -> loại (lỗi rò đã bắt ở T4)
      { coin: "ETH", huong: "SHORT", usd: 30000000, ts: CP_2222 - 5 * 60e3 },
      { coin: "DOGE", huong: "LONG", usd: 1000000, ts: CP_2222 - 5 * 60e3 },
    ]};
    const p = path.join(os.tmpdir(), "t1-kho.json");
    fs.writeFileSync(p, JSON.stringify(kho));
    const c = makeCtx({ checkpointMs: CP_2222, khoPath: p });
    loadEngine(c);
    ok(c.run("napLiqFeed()") === true, "napLiqFeed đọc được kho tổng hợp");
    const btc15 = c.run("DataHubBridge.thanhLyGanDay('BTC', 15)");
    ok(eq(btc15.long, 50000001) && eq(btc15.short, 5000000) && eq(btc15.tong, 55000001) && btc15.count === 3,
      "BTC 15p: long 50.000.001 / short 5.000.000 / count 3 (loại $999M cũ, giữ $1 đúng biên, loại $888M tương lai)",
      JSON.stringify(btc15));
    const btc5 = c.run("DataHubBridge.thanhLyGanDay('BTC', 5)");
    ok(eq(btc5.long, 50000000) && btc5.count === 1, "BTC 5p: chỉ 1 lệnh trong cửa sổ", JSON.stringify(btc5));
    const btcLow = c.run("DataHubBridge.thanhLyGanDay('btc', 15)");
    ok(eq(btcLow.tong, 55000001), "coin chữ thường 'btc' map đúng BTC");
    const eth15 = c.run("DataHubBridge.thanhLyGanDay('ETH', 15)");
    ok(eq(eth15.short, 30000000) && eq(eth15.long, 0) && eth15.count === 1, "ETH 15p: short 30M, không lẫn BTC/DOGE", JSON.stringify(eth15));
    const xrp = c.run("DataHubBridge.thanhLyGanDay('XRP', 15)");
    ok(eq(xrp.tong, 0) && xrp.count === 0, "coin không có dữ liệu -> tong 0, count 0");
    fs.unlinkSync(p);
  }

  /* ---------- T2: mapping flowScore ---------- */
  console.log("\n[T2] mapping flowScore");
  {
    const kho = { whales: [
      { coin: "BTC", side: "BUY", usd: 650000, ts: CP_2222 - 10 * 60e3, san: "OKX" },
      { coin: "BTC", side: "SELL", usd: 100000, ts: CP_2222 - 10 * 60e3, san: "OKX" },
      { coin: "BTC", side: "BUY", usd: 999000000, ts: CP_2222 - 40 * 60e3, san: "OKX" }, // ngoài 30p -> loại
      { coin: "ETH", side: "BUY", usd: 700000, ts: CP_2222 - 5 * 60e3, san: "OKX" },
    ], liqs: [
      { coin: "BTC", huong: "LONG", usd: 600000, ts: CP_2222 - 5 * 60e3, san: "OKX" },
    ]};
    const p = path.join(os.tmpdir(), "t2-kho.json");
    fs.writeFileSync(p, JSON.stringify(kho));
    const c = makeCtx({ checkpointMs: CP_2222, khoPath: p });
    loadEngine(c);
    c.run("napLiqFeed()");
    // flow=(650-100)/750*70=51.33; liq=(600-0)/600*30=30; tổng 81.33 -> 81
    const sc = c.run("DataHub.flowScore('BTC')");
    ok(sc === 81, `flowScore(BTC)=81 (kỳ vọng 81: whale 51.33 + liq 30)`, `được ${sc}`);
    ok(c.run("DataHub.flowScore('ETH')") === 70, "flowScore(ETH) toàn BUY = 70");
    ok(c.run("DataHub.flowScore('DOGE')") === 0, "flowScore(DOGE) không dữ liệu = 0");
    ok(c.run("DataHub.flowScore('BTC', {loaiTruSan:['OKX']})") === 0, "loaiTruSan OKX loại hết -> 0");
    const st = c.run("DataHub.stats()");
    // stats() dùng cửa sổ 60 phút (DH_CONFIG.whale.windowMin) nên lệnh BUY $999M
    // ở -40p VẪN được tính (count 3, buy 999.650.000), trong khi flowScore
    // (cửa sổ 30p) đã loại nó — hai cửa sổ khác nhau, test này khóa đúng điểm đó.
    ok(st.coinStats.BTC && st.coinStats.BTC.buy === 999650000 && st.coinStats.BTC.sell === 100000 && st.coinStats.BTC.count === 3,
      "stats().coinStats.BTC: buy 999.650.000 / sell 100.000 / count 3 (cửa sổ 60p gồm cả lệnh -40p)", JSON.stringify(st.coinStats.BTC));
    fs.unlinkSync(p);
  }

  /* ---------- T3: read time — đổi kho giữa 2 vòng ---------- */
  console.log("\n[T3] read time (đổi kho giữa 2 vòng napLiqFeed)");
  {
    const p = path.join(os.tmpdir(), "t3-kho.json");
    const v1 = { whales: [], liqs: [{ coin: "BTC", huong: "LONG", usd: 50000000, ts: CP_2222 - 1 * 60e3 }] };
    fs.writeFileSync(p, JSON.stringify(v1));
    const c = makeCtx({ checkpointMs: CP_2222, khoPath: p });
    loadEngine(c);
    c.run("napLiqFeed()");
    const kq1 = await c.run("phanTichCoin('BTC')");
    ok(kq1.dongTien && eq(kq1.dongTien.thanhLy15p.tong, 50000000) && eq(kq1.dongTien.thanhLy15p.long, 50000000),
      "vòng 1: engine thấy long $50M vừa ghi vào kho", JSON.stringify(kq1.dongTien && kq1.dongTien.thanhLy15p));
    const v2 = { whales: [], liqs: [{ coin: "BTC", huong: "SHORT", usd: 7000000, ts: CP_2222 - 1 * 60e3 }] };
    fs.writeFileSync(p, JSON.stringify(v2));
    c.run("napLiqFeed()"); // đọc lại file mới, không cache xuyên vòng
    const kq2 = await c.run("phanTichCoin('BTC')");
    ok(kq2.dongTien && eq(kq2.dongTien.thanhLy15p.tong, 7000000) && eq(kq2.dongTien.thanhLy15p.long, 0) && eq(kq2.dongTien.thanhLy15p.short, 7000000),
      "vòng 2 (file đã đổi): engine thấy short $7M, long $50M cũ biến mất", JSON.stringify(kq2.dongTien && kq2.dongTien.thanhLy15p));
    const kq2b = await c.run("phanTichCoin('BTC')");
    ok(eq(kq2b.dongTien.thanhLy15p.tong, 7000000), "trong 1 vòng (không nap lại): số ổn định, không đổi");
    fs.unlinkSync(p);
  }

  /* ---------- T4: sự kiện thật 20/11 — replay 4 mốc ---------- */
  console.log("\n[T4] sự kiện thật 20/11 (fixture kho + nến thật)");
  {
    const khoFix = JSON.parse(fs.readFileSync(path.join(TD, "liqs-2026-11-20-2130-2330.json"), "utf8"));
    const khoPath = path.join(TD, "liqs-2026-11-20-2130-2330.json");
    const baseline = { "2026-11-20 22:07": 28, "2026-11-20 22:22": 33, "2026-11-20 22:37": 28, "2026-11-20 22:52": 28 };
    for (const cpLabel of Object.keys(baseline)) {
      const cpMs = vnToMs(cpLabel);
      const c = makeCtx({ checkpointMs: cpMs, khoPath });
      loadEngine(c);
      ok(c.run("napLiqFeed()") === true, `${cpLabel}: napLiqFeed OK`);
      const kq = await c.run("phanTichCoin('BTC')");
      const exp = tlDocLap(khoFix, "BTC", cpMs, 15);
      const tl = kq.dongTien && kq.dongTien.thanhLy15p;
      ok(!!kq.dongTien && !!tl, `${cpLabel}: dongTien có dữ liệu (không còn null)`, `dongTien=${JSON.stringify(kq.dongTien)}`);
      if (tl) {
        ok(eq(tl.long, exp.long, 1) && eq(tl.short, exp.short, 1) && eq(tl.tong, exp.tong, 1) && tl.count === exp.count,
          `${cpLabel}: thanhLy15p khớp tính độc lập — long $${(exp.long / 1e6).toFixed(1)}M / short $${(exp.short / 1e6).toFixed(1)}M / count ${exp.count}`,
          `engine=${JSON.stringify(tl)} exp=${JSON.stringify(exp)}`);
        const expFs = fsDocLap(khoFix, "BTC", cpMs);
        ok(kq.dongTien.score === expFs, `${cpLabel}: flowScore khớp tính độc lập (${expFs})`, `engine=${kq.dongTien.score}`);
      }
      const coCanhBao = (kq.canhBao || []).some(s => String(s).startsWith("💥 Thanh lý mạnh"));
      ok(coCanhBao === (exp.tong > 20e6), `${cpLabel}: cảnh báo "Thanh lý mạnh" ${exp.tong > 20e6 ? "CÓ" : "KHÔNG"} (tong $${(exp.tong / 1e6).toFixed(1)}M, ngưỡng $20M)`);
      ok(kq.verdict === "WAIT_CONFIRM" && Math.abs(kq.score - baseline[cpLabel]) <= 8,
        `${cpLabel}: verdict giữ WAIT_CONFIRM, điểm ${kq.score} (baseline không-feed ${baseline[cpLabel]}, lệch ≤8)`, `score=${kq.score} verdict=${kq.verdict}`);
    }
  }

  /* ---------- T5: an toàn — kho thiếu/hỏng ---------- */
  console.log("\n[T5] an toàn (kho thiếu/hỏng)");
  {
    const c1 = makeCtx({ checkpointMs: CP_2222, khoPath: path.join(os.tmpdir(), "khong-ton-tai-kho.json") });
    loadEngine(c1);
    ok(c1.run("napLiqFeed()") === false, "kho thiếu -> napLiqFeed false");
    ok(c1.run("DataHub.isRunning()") === false, "kho thiếu -> isRunning false");
    const kq1 = await c1.run("phanTichCoin('BTC')");
    ok(kq1.dongTien === null && kq1.score >= 0, "kho thiếu -> engine chạy tiếp, dongTien null, không crash", `score=${kq1.score}`);
    const pBad = path.join(os.tmpdir(), "t5-kho-hong.json");
    fs.writeFileSync(pBad, "{json hong");
    const c2 = makeCtx({ checkpointMs: CP_2222, khoPath: pBad });
    loadEngine(c2);
    ok(c2.run("napLiqFeed()") === false, "kho hỏng (JSON sai) -> napLiqFeed false");
    const kq2 = await c2.run("phanTichCoin('BTC')");
    ok(kq2.dongTien === null, "kho hỏng -> engine chạy tiếp, dongTien null");
    fs.unlinkSync(pBad);
  }

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
