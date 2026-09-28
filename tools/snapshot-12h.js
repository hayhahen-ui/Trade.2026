/* ============================================================
 * Trade.2026 — Snapshot dòng tiền 12h (2 lần/ngày: 00:07 & 12:07 giờ VN)
 * Đọc .flow-247-store.json (whales/liqs trạm OKX+Hyperliquid), tổng hợp
 * cửa sổ 12h vừa kết thúc ([00:00→12:00) hoặc [12:00→24:00) giờ VN),
 * nối vào data/flow-history-12h.json (không ghi đè cửa sổ đã có).
 * Lịch sử trước 28/09/2026 do tools/backfill-flow-12h.py nạp từ
 * Binance (whale) + CoinEx (thanh lý); từ 28/09/2026 trạm ghi tiếp.
 * Chính sách bộ nhớ: KHÔNG tự xóa — file quá lớn thì báo, không cắt.
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STORE = process.env.SNAP_STORE || path.join(ROOT, "data", ".flow-247-store.json");
const OUT = process.env.SNAP_OUT || path.join(ROOT, "data", "flow-history-12h.json");
const W12H = 12 * 3600 * 1000;
const OFF7 = 7 * 3600 * 1000;
const MAX_BYTES = 20 * 1024 * 1024; // 20MB: to thì báo, không tự cắt

const wStartOf = (ts) => Math.floor((ts + OFF7) / W12H) * W12H - OFF7;

function main() {
  const now = Date.now();
  // cửa sổ 12h vừa kết thúc (cron chạy lúc :07 để collector kịp xong)
  const wEnd = Math.floor((now + OFF7) / W12H) * W12H - OFF7;
  const w = wEnd - W12H;
  const fmt = (t) => new Date(t).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  console.log(`[snapshot-12h] cửa sổ ${fmt(w)} → ${fmt(wEnd)}`);

  let store;
  try { store = JSON.parse(fs.readFileSync(STORE, "utf8")); }
  catch (e) { console.log("[snapshot-12h] không đọc được store:", e.message); return; }

  const agg = {}; // coin -> bản ghi
  const rec = (coin) => agg[coin] || (agg[coin] = {
    w, coin, takerMua: null, takerBan: null,
    whaleMua: 0, whaleBan: 0, nWhaleMua: 0, nWhaleBan: 0,
    liqLong: 0, liqShort: 0, nLiqLong: 0, nLiqShort: 0,
    srcW: "Trạm 24/7 (OKX+HL)", srcL: "Trạm 24/7 (OKX+HL)",
  });
  for (const x of store.whales || []) {
    if (x.ts < w || x.ts >= wEnd || !x.coin) continue;
    const r = rec(x.coin), usd = +x.usd || 0;
    if (x.side === "BUY") { r.whaleMua += usd; r.nWhaleMua++; }
    else { r.whaleBan += usd; r.nWhaleBan++; }
  }
  for (const x of store.liqs || []) {
    if (x.ts < w || x.ts >= wEnd || !x.coin) continue;
    const r = rec(x.coin), usd = +x.usd || 0;
    if (x.huong === "LONG") { r.liqLong += usd; r.nLiqLong++; }
    else { r.liqShort += usd; r.nLiqShort++; }
  }
  if (!Object.keys(agg).length) {
    console.log("[snapshot-12h] cửa sổ này trạm không có sự kiện — bỏ qua");
    return;
  }

  let payload = { meta: {}, data: [] };
  try { payload = JSON.parse(fs.readFileSync(OUT, "utf8")); }
  catch { /* file chưa có: tạo mới */ }
  if (!Array.isArray(payload.data)) payload.data = [];
  const have = new Set(payload.data.map((r) => r.coin + "|" + r.w));
  let them = 0;
  for (const coin of Object.keys(agg).sort()) {
    if (have.has(coin + "|" + w)) { console.log(`[snapshot-12h] ${coin} đã có — bỏ qua`); continue; }
    const r = agg[coin];
    for (const k of ["whaleMua", "whaleBan", "liqLong", "liqShort"]) r[k] = Math.round(r[k]);
    payload.data.push(r);
    them++;
  }
  payload.data.sort((a, b) => a.w - b.w || (a.coin < b.coin ? -1 : 1));
  payload.meta = Object.assign(payload.meta || {}, {
    window: "12h", tz: "GMT+7",
    moTa: "Mỗi ngày 2 khung (00:00 & 12:00 giờ VN). Whale/taker: Binance (backfill) / trạm 24/7 (từ 28/09/2026). Thanh lý: CoinEx (backfill) / trạm 24/7.",
    capNhat: new Date(now).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    banGhi: payload.data.length,
  });
  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, OUT);
  const bytes = fs.statSync(OUT).size;
  console.log(`[snapshot-12h] +${them} bản ghi → ${payload.data.length} bản ghi (${(bytes / 1024).toFixed(0)} KB)`);
  if (bytes >= MAX_BYTES) {
    console.log("STORAGE_WARN: file lịch sử 12h đã lớn — KHÔNG tự xóa, chờ user quyết định");
  }
}
main();
