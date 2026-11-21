/* ============================================================
 * Trade.2026 — Test learn.js chỉ-đề-xuất (21/11/2026)
 * Chạy: node tools/test-learn-propose-only.js
 * User chốt (A): quy tắc tự học chỉ đề xuất, duyệt tay mới áp.
 *  L1 hocTuTinHieu: rule mới sinh có active === false (dòng ~129)
 *  L2 hocTuLichSu: rule từ lịch sử (themLesson) cũng active === false (~227)
 *  L3 dieuChinhKienThuc: công tắc LEARN_AUTO_APPLY=false → delta 0,
 *     canhBao rỗng, kể cả khi ctx khớp rule
 *  L4 công tắc tắt vô hiệu hoá cả rule đang ACTIVE sẵn trong
 *     localStorage (không xoá rule — bật lại là dùng tiếp)
 *  L5 guard tĩnh: không còn `active: cu ? cu.active : true`;
 *     cả 2 chỗ đều là `... : false`; có LEARN_AUTO_APPLY = false
 *  L6 học vẫn chạy: lessons + rules vẫn sinh ra để hiển thị
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

/* Journal: 4 LONG BTC thua + 1 SHORT ETH thắng (khớp fixture harness §18). */
const journalRecs = [
  ...[0, 1, 2, 3].map((i) => ({ id: "L" + i, coin: "BTC", side: "long", trangThai: "thua", tsVao: 1000 + i, diem: 82, giaVao: 84000, sl: 83500, tp: 85000, rr: 2, ketQua: { r: -1 }, phien: "—", bias4h: "bullish" })),
  { id: "S0", coin: "ETH", side: "short", trangThai: "thang", tsVao: 2000, diem: 83, giaVao: 2690, sl: 2698, tp: 2673, rr: 2, ketQua: { r: 2 }, phien: "New York KZ", bias4h: "bearish-yếu" },
];
/* Lịch sử bot giấy: 3 lệnh thua (ngược tín hiệu, điểm thấp, ngoài killzone)
 * + 2 lệnh thắng (thuận, điểm cao, trong killzone) để lát thua lệch WR rõ. */
const botHistory = [
  ...[0, 1, 2].map((i) => ({ pnl: -1, rQuy: -1, side: "long", coin: "BTC", ts: 3000 + i, ctx: { theoTinHieu: false, score: 40, killzone: false, lev: 2 } })),
  ...[0, 1].map((i) => ({ pnl: 2, rQuy: 2, side: "short", coin: "ETH", ts: 4000 + i, ctx: { theoTinHieu: true, score: 80, killzone: true, lev: 2 } })),
];

function makeCtx() {
  const store = {};
  const sandbox = {
    console, Math, JSON, Promise, Map, Set, RegExp, Object, Array,
    Number, String, Boolean, Error, TypeError, SyntaxError,
    Date, setTimeout, clearTimeout, setInterval, clearInterval,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    document: { dispatchEvent() {} },
    lsGet: (k, fb) => (k in store ? store[k] : fb),
    lsSet: (k, v) => { store[k] = v; },
    JOURNAL: { all: () => journalRecs },
    PAPER_BOT: { state: { history: botHistory } },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
  const run = (js) => vm.runInContext(js, ctx);
  return { ctx, load, run, store };
}

/* ---------- L1: hocTuTinHieu — rule mới sinh mặc định INACTIVE ---------- */
function testHocTuTinHieu() {
  console.log("L1 hocTuTinHieu — rule mới sinh mặc định INACTIVE");
  const c = makeCtx();
  c.load("assets/js/learn.js");
  const kq = c.run("hocTuTinHieu(layLichSuTinHieu())");
  const rule = (kq.rules || []).find((r) => r.kieu === "tin_hieu_huong_long");
  ok(!!rule, "sinh được rule tin_hieu_huong_long");
  ok(rule && rule.delta < 0, `rule vẫn mang delta âm (${rule && rule.delta})`, JSON.stringify(rule));
  ok(rule && rule.active === false, "rule mới sinh active === false (không tự áp)");
  ok((kq.lessons || []).length > 0, "lessons vẫn sinh ra để hiển thị");
}

/* ---------- L2: hocTuLichSu — rule từ lịch sử cũng INACTIVE ---------- */
function testHocTuLichSu() {
  console.log("L2 hocTuLichSu — rule từ lịch sử (themLesson) mặc định INACTIVE");
  const c = makeCtx();
  c.load("assets/js/learn.js");
  const learn = c.run("hocTuLichSu()");
  const rules = learn.rules || [];
  const find = (kieu) => rules.find((r) => r.kieu === kieu);
  for (const kieu of ["nguoc_tin_hieu", "diem_thap", "ngoai_killzone", "tin_hieu_huong_long"]) {
    const r = find(kieu);
    ok(!!r, `sinh được rule ${kieu}`);
    ok(r && r.delta < 0, `${kieu} delta âm (${r && r.delta})`);
    ok(r && r.active === false, `${kieu} active === false`);
  }
  ok((learn.lessons || []).length > 0, "lessons lịch sử vẫn sinh ra");
}

/* ---------- L3+L4: dieuChinhKienThuc trả delta 0 khi công tắc tắt ---------- */
function testDieuChinh() {
  console.log("L3/L4 dieuChinhKienThuc — công tắc tắt → delta 0");
  const c = makeCtx();
  c.load("assets/js/learn.js");
  c.run("hocTuLichSu()");
  const ctxKhop = `{ side: "long", coin: "BTC", score: 40, theoTinHieu: false, killzone: false, lev: 2 }`;
  const r1 = c.run(`dieuChinhKienThuc(${ctxKhop})`);
  ok(r1.delta === 0 && r1.canhBao.length === 0,
    "ctx khớp 4 rule mà delta vẫn 0, không cảnh báo", JSON.stringify(r1));
  // L4: rule ACTIVE sẵn trong localStorage cũng bị chặn, và không bị xoá
  c.run(`LEARN.rules.push({ kieu: "tin_hieu_huong_long", side: "long", delta: -8, active: true, nhan: "seed test", winRate: 17, n: 5, khuyenNghi: "x" })`);
  const r2 = c.run(`dieuChinhKienThuc({ side: "long", coin: "BTC", score: 80, theoTinHieu: true, killzone: true, lev: 2 })`);
  ok(r2.delta === 0 && r2.canhBao.length === 0,
    "rule ACTIVE sẵn vẫn bị công tắc chặn (delta 0)", JSON.stringify(r2));
  const seedCon = c.run(`LEARN.rules.some((r) => r.nhan === "seed test" && r.active === true)`);
  ok(seedCon === true, "rule seed không bị xoá khỏi LEARN.rules");
}

/* ---------- L5: guard tĩnh ---------- */
function testStatic() {
  console.log("L5 guard tĩnh trên source learn.js");
  const src = fs.readFileSync(path.join(ROOT, "assets/js/learn.js"), "utf8");
  ok(src.includes("const LEARN_AUTO_APPLY = false"), "có công tắc LEARN_AUTO_APPLY = false");
  ok(src.includes("if (!LEARN_AUTO_APPLY) return { delta: 0, canhBao: [] };"),
    "dieuChinhKienThuc chặn ngay đầu khi công tắc tắt");
  ok(!src.includes("active: cu ? cu.active : true"), "không còn rule mới mặc định active:true");
  ok((src.match(/active: cu \? cu\.active : false/g) || []).length === 2,
    "cả 2 chỗ sinh rule đều mặc định false");
}

testHocTuTinHieu();
testHocTuLichSu();
testDieuChinh();
testStatic();
console.log(`\nlearn propose-only: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
