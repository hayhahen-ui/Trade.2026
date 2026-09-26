/* ============================================================
 * Trade.2026 — Trạm quan trắc 24/7 (collector-247)
 * Chạy trên server (cron 15 phút), KHÔNG cần mở web, KHÔNG cần máy user bật.
 * Mỗi vòng: engine phân tích 6 coin → ghi nhận tín hiệu LONG/SHORT →
 * chấm điểm bằng nến thật → rút bài học Kaizen → ghi data/journal-247.json
 * (đẩy lên nhánh `data` của GitHub mỗi giờ để web tải về hiển thị).
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_PATH = path.join(DATA_DIR, "journal-247.json"); // payload web tải về
const STORE_PATH = path.join(DATA_DIR, ".journal-247-store.json"); // toàn bộ localStorage sandbox
const PUSH_STAMP = path.join(DATA_DIR, ".journal-247-push.txt");
const COINS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "DYDX"];
const PUSH_MOI_GIO_MS = 60 * 60 * 1000;

/* ---------- Stub browser API ---------- */
const lsMem = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Map, Set, RegExp, Object, Array,
  Number, String, Boolean, Error, TypeError, SyntaxError,
  URL, URLSearchParams, TextEncoder, TextDecoder,
  fetch: (...a) => fetch(...a),
  AbortController,
  CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  document: { dispatchEvent() {}, addEventListener() {} },
  window: {},
  navigator: { userAgent: "collector-247" },
  localStorage: {
    getItem: (k) => (k in lsMem ? lsMem[k] : null),
    setItem: (k, v) => { lsMem[k] = String(v); },
    removeItem: (k) => { delete lsMem[k]; },
  },
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
const get = (name) => vm.runInContext(name, ctx);

/* ---------- Nạp store vòng trước ---------- */
function napStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const o = JSON.parse(raw);
    for (const [k, v] of Object.entries(o)) lsMem[k] = v;
    return Object.keys(o).length;
  } catch { return 0; }
}
function luuStore() {
  try { fs.writeFileSync(STORE_PATH, JSON.stringify(lsMem)); } catch {}
}
/* Chính sách bộ nhớ (theo yêu cầu user 26/09/2026): KHÔNG tự xóa.
 * Kho ≥ MAX → dừng ghi, đánh dấu payload, thoát code 2 để cron nhắc user. */
const JOURNAL_CB = 512 * 1024;   // cảnh báo
const JOURNAL_MAX = 1024 * 1024; // đầy → dừng ghi
function dungLuongKhoJournal() {
  try { return fs.statSync(STORE_PATH).size; } catch { return 0; }
}
function danhDauDungGhi(lyDo) {
  try {
    const p = JSON.parse(fs.readFileSync(PUBLIC_PATH, "utf8"));
    p.meta = p.meta || {};
    p.meta.hetBoNho = true;
    p.meta.lyDo = lyDo;
    fs.writeFileSync(PUBLIC_PATH, JSON.stringify(p));
  } catch {}
}

async function main() {
  const batDau = Date.now();
  console.log(`[collector-247] bắt đầu ${new Date().toISOString()}`);
  const khoBytes = dungLuongKhoJournal();
  if (khoBytes >= JOURNAL_MAX) {
    const lyDo = `kho journal ${Math.round(khoBytes / 1024)}KB ≥ giới hạn`;
    danhDauDungGhi(lyDo);
    console.log(`[collector-247] STORAGE_FULL: ${lyDo} — dừng ghi, chờ user dọn`);
    process.exit(2);
  }
  if (khoBytes >= JOURNAL_CB) console.log(`[collector-247] STORAGE_WARN: kho ${Math.round(khoBytes / 1024)}KB gần đầy`);
  const n0 = napStore();
  console.log(`  store: ${n0} keys`);

  ["assets/js/config.js", "assets/js/utils.js", "assets/js/ta.js", "assets/js/smc.js",
   "assets/js/exchanges.js", "assets/js/derivatives.js", "assets/js/journal.js",
   "assets/js/engine.js"].forEach(load);

  const phanTichCoin = get("phanTichCoin");
  const JOURNAL = get("JOURNAL");
  const thongKeJournal = get("thongKeJournal");
  const rutBaiHocKaizen = get("rutBaiHocKaizen");

  const tomTat = [];
  for (const coin of COINS) {
    try {
      const kq = await phanTichCoin(coin);
      tomTat.push(`${coin}:${kq.verdict || "?"}${kq.score}`);
      const rec = JOURNAL.ghiNhan(kq);
      if (rec) console.log(`  📝 mới: ${coin} ${rec.side} @${rec.giaVao} điểm ${rec.diem}`);
    } catch (e) {
      tomTat.push(`${coin}:LỖI`);
      console.log(`  ⚠ ${coin}: ${String(e.message || e).slice(0, 120)}`);
    }
  }

  const cham = await JOURNAL.chamDiemTatCa();
  const ds = JOURNAL.all();
  const st = thongKeJournal(ds);
  const baiHoc = rutBaiHocKaizen(st, ds);

  const payload = {
    tram: "collector-247",
    capNhat: new Date().toISOString(),
    vongQuet: tomTat,
    thongKe: st,
    baiHoc,
    tinHieu: ds.slice(-120).reverse().map((r) => ({
      id: r.id, coin: r.coin, side: r.side, tsVao: r.tsVao,
      giaVao: r.giaVao, sl: r.sl, tp: r.tp, rr: r.rr, diem: r.diem,
      phien: r.phien, bias4h: r.bias4h, trangThai: r.trangThai,
      ketQua: r.ketQua, daDanhGiaDen: r.daDanhGiaDen,
    })),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PUBLIC_PATH, JSON.stringify(payload));
  luuStore();
  /* meta dung lượng: web hiện cảnh báo chiếm dụng */
  try {
    const statPub = fs.statSync(PUBLIC_PATH);
    let storeBytes = 0;
    try { storeBytes = fs.statSync(STORE_PATH).size; } catch {}
    payload.meta = {
      bytes: statPub.size, storeBytes,
      banGhi: ds.length, gioiHanBoNho: "1MB",
      hetBoNho: false,
      chinhSach: "không tự xóa; đầy thì dừng ghi và nhắc user",
      chuThich: "file công khai (nhánh data) + kho server",
    };
    fs.writeFileSync(PUBLIC_PATH, JSON.stringify(payload));
  } catch {}
  console.log(`  quét: ${tomTat.join(" ")}`);
  console.log(`  journal: ${ds.length} bản ghi | chấm: ${cham.ok}/${cham.tong} (lỗi ${cham.loi})`);
  console.log(`  xong trong ${((Date.now() - batDau) / 1000).toFixed(0)}s → ${PUBLIC_PATH}`);

  /* Ghi chú: việc đẩy lên GitHub do tools/push-247.js đảm nhiệm (mỗi giờ 1 lần),
     chạy ngay sau collector trong cùng cron. */
}

main().catch((e) => { console.error("[collector-247] FAIL:", e); process.exit(1); });
