/* ============================================================
 * Trade.2026 — Cầu nối trình duyệt → trạm (v2.15.0, chạy cron 2 phút)
 * Kéo data/browser-signals.json (nhánh `data`, do trình duyệt user đẩy lên
 * khi cầu nối được bật), trộn tín hiệu mới vào:
 *  1. store journal trạm (data/.journal-247-store.json) — để vòng collector
 *     15 phút chấm điểm + đưa vào thống kê như tín hiệu trạm;
 *  2. payload data/journal-247.json (đầu mảng tinHieu) — để cron WhatsApp
 *     (1 phút) thấy id mới là gửi tin ngay, không chờ vòng collector.
 * Kiểm chứng từng bản ghi (id/coin/side/giá hợp lệ), khử trùng theo id.
 * CHÍNH SÁCH BỘ NHỚ (user 26/09/2026): KHÔNG tự xóa. Kho đầy → dừng trộn,
 * giữ nguyên 100% dữ liệu cũ, báo log để cron nhắc user (tối đa 1 lần/ngày).
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const RAW_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/browser-signals.json";
const STORE_PATH = path.join(DATA_DIR, ".journal-247-store.json");
const SEEN_PATH = path.join(DATA_DIR, ".browser-bridge-seen.json");
const PUBLIC_PATH = path.join(DATA_DIR, "journal-247.json");
const JOURNAL_K = "trade2026_signal_journal";
const JOURNAL_MAX = 300; // = JOURNAL._max (journal.js) — đầy thì dừng, không xóa

/* Kiểm chứng + chuẩn hóa 1 bản ghi từ trình duyệt. Pure — test được. */
function hopLe(r) {
  if (!r || typeof r !== "object") return null;
  const id = String(r.id || "").slice(0, 120);
  const coin = String(r.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const side = r.side;
  if (!id || !coin || (side !== "long" && side !== "short")) return null;
  const duong = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);
  const giaVao = duong(r.giaVao), sl = duong(r.sl), tp = duong(r.tp);
  if (!giaVao || !sl || !tp) return null;
  return {
    id, coin, side,
    loai: r.loai === "giay" ? "giay" : "that",
    tsVao: Number.isFinite(+r.tsVao) ? +r.tsVao : Date.now(),
    giaVao, sl, tp,
    rr: Number.isFinite(+r.rr) ? +r.rr : 0,
    diem: Number.isFinite(+r.diem) ? +r.diem : 0,
    phien: String(r.phien || "—").slice(0, 40),
    bias4h: String(r.bias4h || "—").slice(0, 20),
    trangThai: "dang_theo_doi", ketQua: null, daDanhGiaDen: 0,
    nn: r.nn != null && Number.isFinite(+r.nn) ? +r.nn : null,
    ngay: typeof r.ngay === "string" ? r.ngay.slice(0, 10) : null,
    cauTruc: r.cauTruc && typeof r.cauTruc === "object" ? r.cauTruc : null,
    ob: r.ob && typeof r.ob === "object" ? r.ob : null,
    nen: r.nen && typeof r.nen === "object" ? r.nen : null,
    nguon: "browser",
  };
}

/* Trộn bản ghi mới vào mảng journal của store. Pure — test được.
 * Trả về { journal, daThem: Set(id), dungViDay }. */
function tronVaoStore(journalCu, moi, max) {
  const journal = Array.isArray(journalCu) ? journalCu.slice() : [];
  const coId = new Set(journal.map(r => r && r.id));
  const daThem = new Set();
  let dungViDay = false;
  for (const rec of moi) {
    if (coId.has(rec.id)) continue;
    if (journal.length >= max) { dungViDay = true; break; } // KHÔNG tự xóa
    journal.push(rec);
    coId.add(rec.id);
    daThem.add(rec.id);
  }
  return { journal, daThem, dungViDay };
}

/* Prepend bản đã vào store lên đầu payload.tinHieu (mới nhất trước). Pure — test được. */
function tronVaoPayload(tinHieuCu, moi, daThem, gioiHan) {
  const tinHieu = Array.isArray(tinHieuCu) ? tinHieuCu.slice() : [];
  const coId = new Set(tinHieu.map(r => r && r.id));
  const mapPayload = (rec) => ({
    id: rec.id, coin: rec.coin, side: rec.side, tsVao: rec.tsVao,
    giaVao: rec.giaVao, sl: rec.sl, tp: rec.tp, rr: rec.rr, diem: rec.diem,
    phien: rec.phien, bias4h: rec.bias4h, trangThai: rec.trangThai,
    ketQua: rec.ketQua, daDanhGiaDen: rec.daDanhGiaDen,
    nn: rec.nn, loai: rec.loai, ngay: rec.ngay,
    cauTruc: rec.cauTruc, ob: rec.ob, nen: rec.nen,
  });
  for (const rec of moi) {
    if (!daThem.has(rec.id) || coId.has(rec.id)) continue;
    tinHieu.unshift(mapPayload(rec));
    coId.add(rec.id);
  }
  return tinHieu.slice(0, gioiHan);
}

function docJSON(p, macDinh) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return macDinh; } }

async function main() {
  // 1. kéo hàng đợi từ GitHub (public)
  let hangDoi = null;
  try {
    const r = await fetch(RAW_URL, { signal: AbortSignal.timeout(20000) });
    if (r.status === 404) { console.log("[bridge-browser] KHÔNG CÓ GÌ MỚI (chưa có hàng đợi)"); return; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    hangDoi = await r.json();
  } catch (e) {
    console.log("[bridge-browser] lỗi kéo hàng đợi:", String((e && e.message) || e).slice(0, 100));
    process.exitCode = 1;
    return;
  }
  const ds = hangDoi && Array.isArray(hangDoi.tinHieu) ? hangDoi.tinHieu : [];
  if (!ds.length) { console.log("[bridge-browser] KHÔNG CÓ GÌ MỚI"); return; }

  // 2. lọc bản mới + hợp lệ
  const seen = docJSON(SEEN_PATH, {});
  const moi = [];
  for (const raw of ds) {
    const rec = hopLe(raw);
    if (!rec || seen[rec.id]) continue;
    moi.push(rec);
    seen[rec.id] = 1;
  }
  if (!moi.length) {
    fs.writeFileSync(SEEN_PATH, JSON.stringify(seen));
    console.log("[bridge-browser] KHÔNG CÓ GÌ MỚI");
    return;
  }

  // 3. trộn vào store journal trạm
  const store = docJSON(STORE_PATH, {});
  let journalCu = [];
  try { const p = JSON.parse(store[JOURNAL_K] || "[]"); if (Array.isArray(p)) journalCu = p; } catch {}
  const { journal, daThem, dungViDay } = tronVaoStore(journalCu, moi, JOURNAL_MAX);

  // 4. trộn vào payload để WhatsApp thấy ngay
  let payload = docJSON(PUBLIC_PATH, null);
  let themPayload = 0;
  if (payload && Array.isArray(payload.tinHieu)) {
    const truoc = payload.tinHieu.length;
    payload.tinHieu = tronVaoPayload(payload.tinHieu, moi, daThem, 120);
    themPayload = payload.tinHieu.length - truoc;
    fs.writeFileSync(PUBLIC_PATH, JSON.stringify(payload));
  }

  store[JOURNAL_K] = JSON.stringify(journal);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store));
  fs.writeFileSync(SEEN_PATH, JSON.stringify(seen));

  if (dungViDay) console.log("[bridge-browser] KHO ĐẦY: dừng trộn, giữ nguyên dữ liệu cũ — chờ user dọn");
  console.log(`[bridge-browser] CÓ TIN MỚI: ${daThem.size} vào store, ${themPayload} vào payload (${moi.filter(r => daThem.has(r.id)).map(r => r.coin + " " + r.side).join(", ")})`);
}

if (require.main === module) main();
module.exports = { hopLe, tronVaoStore, tronVaoPayload };
