/* ============================================================
 * Trade.2026 — Test Derivs RAG (21/11/2026)
 * Chạy: node tools/test-derivs-rag.js
 * Kiểm chứng thành phần Derivs (funding + OI) trong điểm RAG:
 *  D1 tinhDiemDerivs (hàm thuần, datahub.js): funding ngược chiều
 *    (dương cao = long chen chúc → âm), ngưỡng ±0,05%/8h; OI tăng +
 *    giá cùng chiều = tiền mới tiếp diễn; OI giảm = cạn lực (ngược
 *    nửa điểm); |ΔOI| < 0,5% = nhiễu → 0; thiếu cả hai → null.
 *  D2 derivsScore(coin): đọc funding + lịch sử OI 60s (mẫu tham
 *    chiếu ≥10 phút tuổi); thiếu lịch sử → chỉ funding; thiếu cả
 *    hai → null.
 *  D3 guard tĩnh: RAG_WEIGHTS tổng = 1.00, có derivs 0.10; rag.js
 *    gọi derivsScore + cộng RAG_WEIGHTS.derivs; datahub.js giữ
 *    tối đa 20 mẫu OI.
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
function eq(a, b, eps) { return a != null && b != null && Math.abs(a - b) <= (eps === undefined ? 0.001 : eps); }

function vnToMs(s) { // "2026-11-20 22:22" VN -> ms epoch
  const [d, t] = s.split(" ");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m] = t.split(":").map(Number);
  return Date.UTC(Y, M - 1, D, h - 7, m);
}
const CP = vnToMs("2026-11-20 22:22");

/* Context VM như test-window-logic.js: Date giả lập đúng checkpoint. */
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
    navigator: { userAgent: "test-derivs-rag" },
    localStorage: {
      getItem: (k) => (k in lsMem ? lsMem[k] : null),
      setItem: (k, v) => { lsMem[k] = String(v); },
      removeItem: (k) => { delete lsMem[k]; },
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
  const run = (js) => vm.runInContext(js, ctx);
  return { ctx, load, run };
}

/* ---------- D1: tinhDiemDerivs (hàm thuần) ---------- */
function testPure() {
  console.log("D1 tinhDiemDerivs (hàm thuần)");
  const c = makeCtx();
  c.load("assets/js/config.js");
  c.load("assets/js/utils.js");
  c.load("assets/js/datahub.config.js");
  c.load("assets/js/datahub.js");
  const f = (rate, oi, px) => c.run(`window.DataHub.tinhDiemDerivs(${rate}, ${oi}, ${px})`);
  // funding: ngược chiều, ngưỡng ±0,05%/8h
  let r = f(0.10, null, null); ok(r && eq(r.score, -1) && eq(r.funding, -1) && r.oi === null, "funding +0,10% → −1 (long chen chúc)");
  r = f(0, null, null); ok(r && eq(r.score, 0), "funding 0 → 0");
  r = f(-0.06, null, null); ok(r && eq(r.score, 1) && eq(r.funding, 1), "funding −0,06% → +1 (kẹp ở 1)");
  r = f(0.025, null, null); ok(r && eq(r.score, -0.5), "funding +0,025% → −0,5 (tuyến tính)");
  // OI: tiền mới tiếp diễn theo chiều giá
  r = f(null, 0.10, 0.01); ok(r && eq(r.score, 1) && eq(r.oi, 1), "OI +10% & giá +1% → +1 (long mới vào)");
  r = f(null, 0.10, -0.01); ok(r && eq(r.score, -1) && eq(r.oi, -1), "OI +10% & giá −1% → −1 (short mới vào)");
  // OI giảm = đóng vị thế, ngược nửa điểm
  r = f(null, -0.05, 0.01); ok(r && eq(r.score, -0.5) && eq(r.oi, -0.5), "OI −5% & giá +1% → −0,5 (short đóng, cạn lực)");
  r = f(null, -0.05, -0.01); ok(r && eq(r.score, 0.5), "OI −5% & giá −1% → +0,5 (long đóng, cạn lực)");
  // nhiễu + thiếu dữ liệu
  r = f(null, 0.002, 0.01); ok(r && eq(r.score, 0) && eq(r.oi, 0), "|ΔOI| 0,2% → 0 (nhiễu)");
  r = f(null, 0.10, 0); ok(r === null, "OI đổi nhưng giá đứng yên → null (không đọc được chiều)");
  r = f(null, null, null); ok(r === null, "thiếu cả funding lẫn OI → null");
  // kết hợp 50/50
  r = f(0.05, 0.10, 0.01); ok(r && eq(r.score, 0), "funding −1 + OI +1 → 0 (triệt tiêu)");
  r = f(-0.025, -0.05, -0.01); ok(r && eq(r.score, 0.5), "funding +0,5 + OI +0,5 → +0,5");
}

/* ---------- D2: derivsScore(coin) qua store thật ---------- */
function testWrapper() {
  console.log("D2 derivsScore(coin)");
  const c = makeCtx();
  c.load("assets/js/config.js");
  c.load("assets/js/utils.js");
  c.load("assets/js/datahub.config.js");
  c.load("assets/js/datahub.js");
  const seed = (js) => c.run(js);
  const get = (coin) => c.run(`window.DataHub.derivsScore("${coin}")`);

  // Lịch sử 12 mẫu (mỗi phút), OI 100→111 (+11%), mark 60000→60550 (+0,9%);
  // mẫu tham chiếu = mẫu mới nhất ≥10p tuổi = mẫu CP-10p (oi 102, mark 60100).
  seed(`window.DataHub.funding().BTC = { rate: 0.08, mark: 60550, next: 0 };
    window.DataHub.oiHist().BTC = [];
    for (let i = 12; i >= 1; i--) window.DataHub.oiHist().BTC.push({ oi: 100 + (12 - i), mark: 60000 + 50 * (12 - i), ts: Date.now() - i * 60e3 });`);
  let r = get("BTC");
  ok(r && eq(r.score, 0, 0.01), "funding −1 + OI +1 → 0", JSON.stringify(r));
  ok(r && eq(r.fundingRate, 0.08), "fundingRate giữ nguyên 0,08%/8h");
  ok(r && eq(r.oiChgPct, (111 - 102) / 102, 0.001), "oiChgPct tính từ mẫu CP-10p", JSON.stringify(r));
  ok(r && r.chiFunding === true, "chiFunding = true khi có funding");

  // Chỉ funding (lịch sử OI trống) → điểm funding thuần.
  seed(`window.DataHub.oiHist().BTC = []; window.DataHub.funding().BTC = { rate: -0.03, mark: 60550, next: 0 };`);
  r = get("BTC");
  ok(r && eq(r.score, 0.6) && r.oiChgPct === null, "chưa có lịch sử OI → chỉ funding (+0,6)", JSON.stringify(r));

  // Lịch sử quá ngắn (<10p) → vẫn chỉ funding.
  seed(`window.DataHub.oiHist().BTC = [];
    for (let i = 3; i >= 1; i--) window.DataHub.oiHist().BTC.push({ oi: 100 + i, mark: 60000 + i * 10, ts: Date.now() - i * 60e3 });
    window.DataHub.funding().BTC = { rate: 0.02, mark: 60030, next: 0 };`);
  r = get("BTC");
  ok(r && eq(r.score, -0.4) && r.oiChgPct === null, "lịch sử 3p → chỉ funding (−0,4)", JSON.stringify(r));

  // Thiếu cả hai → null.
  seed(`window.DataHub.oiHist().ETH = []; delete window.DataHub.funding().ETH;`);
  r = get("ETH");
  ok(r === null, "coin không có funding/OI → null");
}

/* ---------- D3: guard tĩnh ---------- */
function testStatic() {
  console.log("D3 guard tĩnh (weights + nối dây)");
  const cfgSrc = fs.readFileSync(path.join(ROOT, "assets/js/config.js"), "utf8");
  const m = cfgSrc.match(/RAG_WEIGHTS\s*=\s*\{([^}]+)\}/);
  ok(!!m, "config.js có RAG_WEIGHTS");
  const entries = m ? [...m[1].matchAll(/(\w+):\s*([\d.]+)/g)] : [];
  const w = Object.fromEntries(entries.map((e) => [e[1], +e[2]]));
  const tong = Object.values(w).reduce((a, b) => a + b, 0);
  ok(eq(tong, 1, 0.001), `tổng trọng số = 1.00 (đang ${tong.toFixed(2)})`);
  ok(eq(w.derivs, 0.10), "derivs = 0.10");
  ok(Object.keys(w).length === 6, `đủ 6 thành phần (đang ${Object.keys(w).length})`);
  const ragSrc = fs.readFileSync(path.join(ROOT, "assets/js/rag.js"), "utf8");
  ok(ragSrc.includes("DataHub.derivsScore"), "rag.js gọi DataHub.derivsScore");
  ok(ragSrc.includes("RAG_WEIGHTS.derivs"), "rag.js cộng RAG_WEIGHTS.derivs ở Reasoner");
  ok(ragSrc.includes("flow?.derivs"), "rag.js chỉ cộng khi flow.derivs có dữ liệu");
  const dhSrc = fs.readFileSync(path.join(ROOT, "assets/js/datahub.js"), "utf8");
  ok(/if \(hist\.length > 20\) hist\.shift\(\)/.test(dhSrc), "oiHist giữ tối đa 20 mẫu");
  ok(dhSrc.includes("derivsScore, tinhDiemDerivs"), "DataHub export derivsScore + tinhDiemDerivs");
}

testPure();
testWrapper();
testStatic();
console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
