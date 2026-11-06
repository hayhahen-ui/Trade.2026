/* ============================================================
 * Trade.2026 — station-run.js (wrapper chạy trạm 24/7 trên GitHub Actions)
 *
 * VẤN ĐỀ: GitHub Actions mỗi lần chạy là máy mới — file local
 * (.journal-247-store.json, .flow-247-store.json) không tồn tại qua các lần chạy.
 * GIẢI PHÁP (không sửa file gốc collector-247.js / flow-collector.js):
 *   1. Nạp state từ Supabase vào file store local (journal 300 bản ghi mới nhất,
 *      best-setup của ngày, con trỏ last của flow-collector).
 *   2. Chạy script gốc y như trên server (node tools/collector-247.js,
 *      node tools/flow-collector.js) — chúng đọc/ghi file local bình thường.
 *   3. Đọc lại file store + payload sau khi chạy, đẩy lên Supabase
 *      (signals / whale_events / liquidations / station_heartbeat),
 *      đồng thời dựng lại file data/flow-247.json đủ 800 sự kiện mới nhất
 *      để workflow đẩy dual-write lên nhánh data cho web đọc.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (GitHub Secrets).
 * DRY_RUN=1: vẫn chạy collector/flow và vẫn đọc Supabase, nhưng KHÔNG ghi
 * gì lên Supabase (dùng để chạy thử workflow lần đầu).
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const writer = require("./supabase-writer.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const JOURNAL_STORE = path.join(DATA_DIR, ".journal-247-store.json");
const FLOW_STORE = path.join(DATA_DIR, ".flow-247-store.json");
const JOURNAL_PAYLOAD = path.join(DATA_DIR, "journal-247.json");
const FLOW_PAYLOAD = path.join(DATA_DIR, "flow-247.json");
const SETTINGS_FILE = path.join(__dirname, "station-settings.json");

const DRY = process.env.DRY_RUN === "1";
const JOURNAL_KEY = "trade2026_signal_journal";
const BEST_KEY = "trade2026_best_setup_ngay";
const SETTINGS_KEY = "siro_settings_v1";

/* Ngày giờ VN (YYYY-MM-DD) từ epoch ms — khớp cách collector tính ngayStr. */
function ngayVN(tsMs) {
  const d = new Date(tsMs + 7 * 3600e3);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function parseJsonOrNull(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* Dòng signals (snake_case) -> bản ghi journal (camelCase) để nạp lại localStorage.
 * Các trường không có cột trong signals (featureSnapshot, nnDanhGia, checklist,
 * giaVaoKeHoach, daDanhGiaDen, nn...) bị bỏ — xem ghi chú trong supabase-writer.js. */
function rowToRecord(row) {
  const tsVao = Date.parse(row.ts_vao || "");
  if (!Number.isFinite(tsVao)) return null;
  return {
    id: row.id,
    coin: row.coin,
    side: row.side,
    loai: row.loai || "that",
    tsVao,
    giaVao: row.gia_vao,
    sl: row.sl,
    tp: row.tp1,
    rr: row.rr,
    diem: row.diem,
    phase: row.phase || null,
    nn: null,
    phien: row.phien || "—",
    bias4h: row.bias_4h || "—",
    cauTruc: parseJsonOrNull(row.cau_truc),
    ob: parseJsonOrNull(row.ob),
    nen: parseJsonOrNull(row.nen),
    checklist: [],
    featureSnapshot: null,
    nnDanhGia: null,
    trangThai: row.trang_thai || "dang_theo_doi",
    ketQua: parseJsonOrNull(row.ket_qua),
    daDanhGiaDen: 0,
    giaVaoKeHoach: null,
    ngay: row.loai === "giay" ? ngayVN(tsVao) : null,
    nguon: row.nguon || "tram",
  };
}

function runNode(relScript) {
  console.log(`[station-run] chạy: node ${relScript}`);
  const r = spawnSync("node", [path.join(ROOT, relScript)], { cwd: ROOT, stdio: "inherit" });
  if (r.error) throw new Error(`[station-run] không chạy được ${relScript}: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`[station-run] ${relScript} thoát code ${r.status} — dừng, không ghi Supabase (heartbeat cũ sẽ báo trạm chết)`);
  }
}

function readJsonFile(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const batDau = Date.now();
  console.log(`[station-run] bắt đầu ${new Date().toISOString()}${DRY ? " (DRY_RUN — không ghi Supabase)" : ""}`);
  const w = writer.createFromEnv();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  /* ---------- 1. Nạp state journal từ Supabase ---------- */
  let records = [];
  try {
    const rows = await w.readSignals(300);
    records = (rows || []).map(rowToRecord).filter(Boolean).reverse(); // mới nhất trước -> xếp lại cũ trước
    console.log(`[station-run] nạp journal từ Supabase: ${records.length} bản ghi`);
  } catch (e) {
    console.log(`[station-run] ⚠ không nạp được journal (${e.message.slice(0, 120)}) — chạy với journal rỗng`);
  }
  const store = { [JOURNAL_KEY]: JSON.stringify(records) };
  try {
    const hb = await w.readHeartbeat("collector-247");
    if (hb && hb.meta && hb.meta.best_setup) {
      store[BEST_KEY] = JSON.stringify(hb.meta.best_setup);
      console.log("[station-run] nạp best-setup của ngày từ heartbeat");
    }
  } catch (e) {
    console.log(`[station-run] ⚠ không nạp được best-setup (${e.message.slice(0, 100)})`);
  }
  /* Cài đặt risk (vốn, % risk, RR) — chỉ khi có file station-settings.json trong repo.
   * Không có file thì engine dùng mặc định (vốn 10000, risk 1%, TP1 RR 1:2, TP2 RR 1:3). */
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      store[SETTINGS_KEY] = fs.readFileSync(SETTINGS_FILE, "utf8");
      console.log("[station-run] nạp cài đặt từ tools/station-settings.json");
    }
  } catch (e) {
    console.log(`[station-run] ⚠ station-settings.json lỗi (${e.message.slice(0, 100)}) — dùng mặc định`);
  }
  fs.writeFileSync(JOURNAL_STORE, JSON.stringify(store));

  /* ---------- 2. Nạp con trỏ flow (last) từ Supabase ---------- */
  let last = {};
  try {
    const hb = await w.readHeartbeat("flow-247");
    if (hb && hb.meta && hb.meta.last) last = hb.meta.last;
    console.log(`[station-run] nạp con trỏ flow: ${Object.keys(last).length} cursor`);
  } catch (e) {
    console.log(`[station-run] ⚠ không nạp được con trỏ flow (${e.message.slice(0, 100)}) — quét lại 100 lệnh/coin`);
  }
  fs.writeFileSync(FLOW_STORE, JSON.stringify({ last, whales: [], liqs: [] }));

  /* ---------- 3. Chạy collector gốc ---------- */
  runNode("tools/collector-247.js");

  /* ---------- 4. Đẩy journal lên Supabase ---------- */
  const storeAfter = readJsonFile(JOURNAL_STORE, {});
  let ds = [];
  try {
    ds = JSON.parse(storeAfter[JOURNAL_KEY] || "[]");
    if (!Array.isArray(ds)) ds = [];
  } catch {
    ds = [];
  }
  if (DRY) {
    console.log(`[station-run] DRY_RUN: sẽ upsert ${ds.length} bản ghi signals (bỏ qua)`);
  } else {
    await w.writeSignals(ds);
  }
  const payload = readJsonFile(JOURNAL_PAYLOAD, null);
  let bestSetup = null;
  try {
    bestSetup = JSON.parse(storeAfter[BEST_KEY] || "null");
  } catch {
    bestSetup = null;
  }
  if (payload) {
    const meta = {
      vong_quet: payload.vongQuet || [],
      thong_ke: payload.thongKe || null,
      bai_hoc: Array.isArray(payload.baiHoc) ? payload.baiHoc.length : 0,
      ban_ghi: ds.length,
      best_setup: bestSetup,
    };
    if (DRY) {
      console.log("[station-run] DRY_RUN: sẽ ghi heartbeat collector-247 (bỏ qua)");
    } else {
      await w.writeHeartbeat("collector-247", meta);
    }
  } else {
    console.log("[station-run] ⚠ không thấy file data/journal-247.json sau khi chạy collector");
  }

  /* ---------- 5. Chạy flow-collector gốc ---------- */
  runNode("tools/flow-collector.js");

  /* ---------- 6. Đẩy dòng tiền lên Supabase ---------- */
  const flowStoreAfter = readJsonFile(FLOW_STORE, { last: {}, whales: [], liqs: [] });
  const whalesMoi = Array.isArray(flowStoreAfter.whales) ? flowStoreAfter.whales : [];
  const liqsMoi = Array.isArray(flowStoreAfter.liqs) ? flowStoreAfter.liqs : [];
  if (DRY) {
    console.log(`[station-run] DRY_RUN: sẽ upsert ${whalesMoi.length} whales + ${liqsMoi.length} liqs (bỏ qua)`);
  } else {
    await w.writeWhales(whalesMoi);
    await w.writeLiquidations(liqsMoi);
    /* Dựng lại payload đủ 800 sự kiện mới nhất để dual-write cho web.
     * (Store trên Actions chỉ có sự kiện của vòng này; Supabase mới có đủ lịch sử.) */
    const whales800 = (await w.readLatest("whale_events", 800)).reverse();
    const liqs800 = (await w.readLatest("liquidations", 800)).reverse();
    const flowPayload = {
      tram: "flow-247",
      capNhat: new Date().toISOString(),
      nguon: ["OKX", "Hyperliquid"],
      nguong: 100000,
      whales: whales800.map((r) => ({
        id: r.id, san: r.san, coin: r.coin, price: +r.price, qty: +r.qty,
        usd: Math.round(+r.usd || 0), side: r.side, ts: Date.parse(r.ts),
      })),
      liqs: liqs800.map((r) => ({
        id: r.id, san: r.san, coin: r.coin, price: +r.price, qty: +r.qty,
        usd: Math.round(+r.usd || 0), huong: r.side, ts: Date.parse(r.ts),
      })),
    };
    fs.writeFileSync(FLOW_PAYLOAD, JSON.stringify(flowPayload));
    try {
      const statPub = fs.statSync(FLOW_PAYLOAD);
      flowPayload.meta = {
        bytes: statPub.size, storeBytes: 0,
        whales: whales800.length, liqs: liqs800.length,
        hetBoNho: false,
        chinhSach: "Supabase giữ lịch sử; file này chỉ là ảnh 800 mới nhất cho web",
        chuThich: "dual-write: Supabase (live) + nhánh data (web)",
      };
      fs.writeFileSync(FLOW_PAYLOAD, JSON.stringify(flowPayload));
    } catch {}
    await w.writeHeartbeat("flow-247", {
      cap_nhat: flowPayload.capNhat,
      last: flowStoreAfter.last || {},
      whales: whales800.length,
      liqs: liqs800.length,
    });
  }
  console.log(`[station-run] xong trong ${((Date.now() - batDau) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error("[station-run] FAIL:", e.message);
  process.exit(1);
});
