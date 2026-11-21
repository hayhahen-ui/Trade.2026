/* ============================================================
 * Trade.2026 — Test Window Logic (W3, 21/11/2026)
 * Chạy: node tools/test-window-logic.js
 * Kiểm chứng cửa sổ thời gian chặn CẢ HAI ĐẦU (ts >= t0 && ts <= now)
 * ở 3 bản sao logic cửa sổ (Caffeine audit §2 + đối chiếu Wave 1/2):
 *  W1 datahub.js buildStats + flowScore — bản ghi tương lai không
 *    được tính vào thống kê/điểm (lỗi look-ahead T4 ở liq-feed.js).
 *  W2 datahub-bridge.js thanhLyGanDay + xacNhanCaMap — cùng lỗi.
 *  W3 flowdb.js flowWindow/flowScore + buckets + cảnh báo burst/liq —
 *    query IndexedDB/RAM phải có chặn trên `to` (backend đã hỗ trợ).
 *  W4 guard tĩnh: quét source 3 file (+ liq-feed.js), mọi filter/
 *    query cửa sổ phải có chặn trên — chống hồi quy khi thêm filter mới.
 * Checkpoint giả lập: 2026-11-20 22:22 VN (cùng test-liq-feed.js).
 * ============================================================ */
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
function eq(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 0.5 : eps); }

function vnToMs(s) { // "2026-11-20 22:22" VN -> ms epoch
  const [d, t] = s.split(" ");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m] = t.split(":").map(Number);
  return Date.UTC(Y, M - 1, D, h - 7, m);
}
const CP = vnToMs("2026-11-20 22:22");
const M = 60e3;

/* Context VM như test-liq-feed.js: Date giả lập đúng checkpoint. */
function makeCtx() {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [CP])); }
    static now() { return CP; }
  }
  const lsMem = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Promise, Map, Set, RegExp, Object, Array,
    Number, String, Boolean, Error, TypeError, SyntaxError,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    fetch: (...a) => fetch(...a),
    AbortController,
    Date: FakeDate,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    document: { dispatchEvent() {}, addEventListener() {}, hidden: false },
    window: {},
    navigator: { userAgent: "test-window-logic" },
    localStorage: {
      getItem: (k) => (k in lsMem ? lsMem[k] : null),
      setItem: (k, v) => { lsMem[k] = String(v); },
      removeItem: (k) => { delete lsMem[k]; },
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
  const loadSrc = (src, name) => vm.runInContext(src, ctx, { filename: name });
  const get = (name) => vm.runInContext(name, ctx);
  return { sandbox, ctx, load, loadSrc, get };
}

/* ---------- W1: datahub.js — buildStats + flowScore ---------- */
function testDataHub() {
  console.log("W1 datahub.js (buildStats + flowScore)");
  const c = makeCtx();
  c.load("assets/js/config.js");
  c.load("assets/js/utils.js");
  c.load("assets/js/datahub.config.js"); // bắt buộc: datahub.js return sớm nếu thiếu DH_CONFIG
  // Tiêm hook test vào trong IIFE (chỉ trong test, không sửa file thật):
  // chèn ngay trước dòng đóng `})(window);` cuối file.
  const src = fs.readFileSync(path.join(ROOT, "assets/js/datahub.js"), "utf8");
  const hook = "\n;globalThis.__DH_TEST__ = { pushWhale, pushLiq, buildStats, flowScore };\n";
  const idx = src.lastIndexOf("})(window);");
  if (idx < 0) { ok(false, "tìm được điểm tiêm hook vào datahub.js"); return; }
  c.loadSrc(src.slice(0, idx) + hook + src.slice(idx), "assets/js/datahub.js");
  const T = c.get("__DH_TEST__");
  const DH = c.get("window.DataHub"); // datahub.js gán vào window (IIFE global=window)
  ok(!!DH && typeof DH.flowScore === "function", "DataHub nạp được trong VM");

  // Fixture: quá khứ trong cửa sổ + tương lai + quá cũ (24h trước).
  T.pushWhale({ coin: "BTC", side: "BUY", usd: 200000, san: "BINANCE", ts: CP - 10 * M });
  T.pushWhale({ coin: "BTC", side: "SELL", usd: 100000, san: "BINANCE", ts: CP - 5 * M });
  T.pushWhale({ coin: "BTC", side: "BUY", usd: 2000000, san: "BINANCE", ts: CP + 30 * M }); // tương lai
  T.pushWhale({ coin: "BTC", side: "BUY", usd: 2000000, san: "BINANCE", ts: CP - 24 * 3600e3 }); // quá cũ
  T.pushLiq({ coin: "BTC", huong: "LONG", usd: 160000, san: "OKX", ts: CP - 10 * M });
  T.pushLiq({ coin: "BTC", huong: "SHORT", usd: 40000, san: "OKX", ts: CP - 5 * M });
  T.pushLiq({ coin: "BTC", huong: "LONG", usd: 1800000, san: "OKX", ts: CP + 30 * M }); // tương lai
  // Bản ghi tương lai CÓ trong kho (chứng minh test bắt được lỗi nếu có):
  ok(DH.whales(10).length === 4, "kho whales chứa đủ 4 bản ghi (kể cả tương lai/quá cũ)", `có ${DH.whales(10).length}`);
  ok(DH.liqs(10).length === 3, "kho liqs chứa đủ 3 bản ghi (kể cả tương lai)", `có ${DH.liqs(10).length}`);

  // flowScore 30': flow (200-100)/300*70 = 23,33; liq (160-40)/200*30 = 18 → 41.
  // Không có fix: future BUY 2M + LONG 1,8M sẽ đẩy điểm lên ~93.
  const sc = T.flowScore("BTC");
  ok(sc === 41, "flowScore(BTC) = 41 (chỉ tính quá khứ trong cửa sổ)", `được ${sc}`);
  const st = T.buildStats();
  ok(st.whale.totalVolume === 300000, "buildStats whale.totalVolume = 300000", `được ${st.whale.totalVolume}`);
  ok(st.whale.tradeCount === 2, "buildStats whale.tradeCount = 2", `được ${st.whale.tradeCount}`);
  ok(st.liquidation.totalVolume === 200000, "buildStats liquidation.totalVolume = 200000", `được ${st.liquidation.totalVolume}`);
  ok(st.liquidation.count === 2, "buildStats liquidation.count = 2", `được ${st.liquidation.count}`);
}

/* ---------- W2: datahub-bridge.js — thanhLyGanDay + xacNhanCaMap ---------- */
function testBridge() {
  console.log("W2 datahub-bridge.js (thanhLyGanDay + xacNhanCaMap)");
  const c = makeCtx();
  const LIQS = [
    { coin: "BTC", huong: "LONG", usd: 160000, ts: CP - 2 * M },
    { coin: "BTC", huong: "SHORT", usd: 40000, ts: CP - 1 * M },
    { coin: "BTC", huong: "LONG", usd: 1800000, ts: CP + 30 * M }, // tương lai
  ];
  const WHALES = [
    { coin: "BTC", side: "BUY", usd: 200000, ts: CP - 5 * M },
    { coin: "BTC", side: "SELL", usd: 100000, ts: CP - 4 * M },
    { coin: "BTC", side: "SELL", usd: 2000000, ts: CP + 30 * M }, // tương lai
  ];
  c.sandbox.window.DataHub = {
    on() {}, flowScore: () => 0,
    liqs: () => LIQS, whales: () => WHALES,
    isRunning: () => false, start() {}, stop() {},
  };
  c.load("assets/js/datahub-bridge.js");
  const B = c.get("window.DataHubBridge"); // bridge gán vào window
  ok(!!B, "DataHubBridge nạp được trong VM (DH stub)");
  const g = B.thanhLyGanDay("BTC", 5);
  ok(g.long === 160000 && g.short === 40000 && g.tong === 200000 && g.count === 2,
    "thanhLyGanDay 5' chỉ tính quá khứ (long 160K/short 40K/count 2)",
    `được long=${g.long} short=${g.short} count=${g.count}`);
  // BUY 200K > SELL 100K*1,2 = 120K → true; không fix: SELL tương lai 2M → false.
  ok(B.xacNhanCaMap("BTC", "LONG", 15) === true, "xacNhanCaMap LONG = true (bỏ SELL tương lai 2M)");
  ok(B.xacNhanCaMap("BTC", "SHORT", 15) === false, "xacNhanCaMap SHORT = false");
}

/* ---------- W3: flowdb.js — flowWindow/flowScore/buckets ---------- */
async function testFlowDB() {
  console.log("W3 flowdb.js (flowWindow + flowScore + buckets)");
  const c = makeCtx();
  c.load("assets/js/config.js");
  c.load("assets/js/utils.js");
  c.load("assets/js/flowdb.js");
  const FDB = c.get("window.FlowDB"); // flowdb.js gán vào window
  ok(!!FDB, "FlowDB nạp được trong VM");
  await FDB.init(); // không có IndexedDB trong VM → rơi về memBackend
  await FDB.mergeTram({
    whales: [
      { id: "w1", coin: "BTC", side: "BUY", usd: 200000, san: "BINANCE", ts: CP - 10 * M },
      { id: "w2", coin: "BTC", side: "SELL", usd: 100000, san: "BINANCE", ts: CP - 5 * M },
      { id: "w3", coin: "BTC", side: "BUY", usd: 2000000, san: "BINANCE", ts: CP + 30 * M }, // tương lai
    ],
    liqs: [
      { id: "l1", coin: "BTC", huong: "LONG", usd: 160000, san: "OKX", ts: CP - 10 * M },
      { id: "l2", coin: "BTC", huong: "SHORT", usd: 40000, san: "OKX", ts: CP - 5 * M },
      { id: "l3", coin: "BTC", huong: "LONG", usd: 1800000, san: "OKX", ts: CP + 30 * M }, // tương lai
    ],
  });
  const fw = await FDB.flowWindow(30);
  ok(fw.buy === 200000 && fw.sell === 100000, "flowWindow buy/sell chỉ tính quá khứ", `buy=${fw.buy} sell=${fw.sell}`);
  ok(fw.liqLong === 160000 && fw.liqShort === 40000, "flowWindow liqLong/liqShort chỉ tính quá khứ", `long=${fw.liqLong} short=${fw.liqShort}`);
  ok(fw.count === 2 && fw.liqCount === 2, "flowWindow count/liqCount = 2", `count=${fw.count} liqCount=${fw.liqCount}`);
  const sc = await FDB.flowScore("BTC");
  ok(sc === 41, "flowScore(BTC) = 41 (cùng công thức datahub.js)", `được ${sc}`);
  // buckets: chỉ bucket quá khứ được ghi (bucket tương lai không bao giờ flush).
  FDB.trackWhale({ coin: "BTC", side: "BUY", usd: 200000, san: "BINANCE", ts: CP - 10 * M });
  FDB.trackWhale({ coin: "BTC", side: "BUY", usd: 2000000, san: "BINANCE", ts: CP + 30 * M });
  await FDB._flushBuckets();
  const bk = await FDB.buckets("BTC", 120);
  const futureBk = bk.filter((b) => b.t > CP);
  ok(bk.length >= 1 && futureBk.length === 0, "buckets không chứa bucket tương lai", `có ${bk.length} bucket, ${futureBk.length} tương lai`);
  const pastBk = bk.find((b) => b.t <= CP);
  ok(!!pastBk && pastBk.buy === 200000, "bucket quá khứ ghi đủ BUY 200K", pastBk ? `buy=${pastBk.buy}` : "không thấy bucket quá khứ");
}

/* ---------- W4: guard tĩnh — mọi filter/query cửa sổ phải có chặn trên ---------- */
function testStaticGuard() {
  console.log("W4 guard tĩnh (quét source)");
  const files = ["assets/js/datahub.js", "assets/js/datahub-bridge.js", "assets/js/liq-feed.js"];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const lines = src.split("\n");
    let bad = [];
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("*") || t.startsWith("//")) return; // comment, không phải code
      if (line.includes(">= t0") && !line.includes("<= now")) bad.push(i + 1);
    });
    ok(bad.length === 0, `${rel}: mọi filter ">= t0" đều có chặn trên "<= now"`, bad.length ? `dòng chưa chặn: ${bad.join(",")}` : undefined);
  }
  // flowdb.js: mọi query có `from:` đều phải có `to:` (trừ query alerts không theo cửa sổ).
  const fdb = fs.readFileSync(path.join(ROOT, "assets/js/flowdb.js"), "utf8");
  const badQ = [];
  fdb.split("\n").forEach((line, i) => {
    if (line.includes("_be.query(") && line.includes("from:") && !line.includes("to:")) badQ.push(i + 1);
  });
  ok(badQ.length === 0, "flowdb.js: mọi query có from: đều có to:", badQ.length ? `dòng chưa chặn: ${badQ.join(",")}` : undefined);
}

(async () => {
  try {
    testDataHub();
    testBridge();
    await testFlowDB();
    testStaticGuard();
  } catch (e) {
    fail++;
    console.log(`  ❌ lỗi chạy test: ${e && e.stack || e}`);
  }
  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
