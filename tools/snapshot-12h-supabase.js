/* ============================================================
 * Trade.2026 — snapshot-12h-supabase.js
 * Snapshot dòng tiền 12h (2 lần/ngày: 00:07 & 12:07 giờ VN = 17:07 & 05:07 UTC).
 *
 * Bản gốc (tools/snapshot-12h.js) đọc .flow-247-store.json local (whales/liqs
 * trạm OKX+Hyperliquid), tổng hợp cửa sổ 12h vừa kết thúc, nối vào
 * data/flow-history-12h.json. Trên GitHub Actions không có file store local
 * nên bản này đọc sự kiện từ Supabase (whale_events + liquidations),
 * tổng hợp y hệt, rồi:
 *   1. upsert vào bảng flow_buckets_12h (khóa chính w+coin — chạy lại vẫn đúng),
 *   2. nối vào file data/flow-history-12h.json local (kéo bản hiện tại từ
 *      nhánh data rồi merge) để workflow đẩy dual-write cho web đọc.
 * Cửa sổ không có sự kiện -> bỏ qua, exit 0 (giống bản gốc).
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (GitHub Secrets).
 * SNAP_HISTORY_URL: ghi đè URL file lịch sử hiện tại (mặc định nhánh data; dùng khi test).
 * DRY_RUN=1: chỉ tính + log, không ghi Supabase và không ghi file.
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const writer = require("./supabase-writer.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "flow-history-12h.json");
const HISTORY_URL =
  process.env.SNAP_HISTORY_URL ||
  "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/flow-history-12h.json";
const DRY = process.env.DRY_RUN === "1";
const W12H = 12 * 3600 * 1000;
const OFF7 = 7 * 3600 * 1000;

const wStartOf = (ts) => Math.floor((ts + OFF7) / W12H) * W12H - OFF7;

function main() {
  return (async () => {
    const w = writer.createFromEnv();
    const now = Date.now();
    const wEnd = Math.floor((now + OFF7) / W12H) * W12H - OFF7;
    const win = wEnd - W12H;
    const fmt = (t) => new Date(t).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    console.log(`[snapshot-12h-supabase] cửa sổ ${fmt(win)} → ${fmt(wEnd)}`);

    const fromISO = new Date(win).toISOString();
    const toISO = new Date(wEnd).toISOString();
    const whales = await w.queryEvents("whale_events", fromISO, toISO, 1000);
    const liqs = await w.queryEvents("liquidations", fromISO, toISO, 1000);
    console.log(`[snapshot-12h-supabase] sự kiện trong cửa sổ: ${whales.length} whales, ${liqs.length} liqs`);

    const agg = {};
    const rec = (coin) =>
      agg[coin] ||
      (agg[coin] = {
        w: win, coin, takerMua: null, takerBan: null,
        whaleMua: 0, whaleBan: 0, nWhaleMua: 0, nWhaleBan: 0,
        liqLong: 0, liqShort: 0, nLiqLong: 0, nLiqShort: 0,
        srcW: "Trạm 24/7 (OKX+HL)", srcL: "Trạm 24/7 (OKX+HL)",
      });
    for (const x of whales) {
      const ts = Date.parse(x.ts || "");
      if (!Number.isFinite(ts) || ts < win || ts >= wEnd || !x.coin) continue;
      const r = rec(x.coin);
      const usd = +x.usd || 0;
      if (x.side === "BUY") { r.whaleMua += usd; r.nWhaleMua++; }
      else { r.whaleBan += usd; r.nWhaleBan++; }
    }
    for (const x of liqs) {
      const ts = Date.parse(x.ts || "");
      if (!Number.isFinite(ts) || ts < win || ts >= wEnd || !x.coin) continue;
      const r = rec(x.coin);
      const usd = +x.usd || 0;
      if (x.side === "LONG") { r.liqLong += usd; r.nLiqLong++; }
      else { r.liqShort += usd; r.nLiqShort++; }
    }
    const buckets = Object.keys(agg).sort().map((coin) => {
      const r = agg[coin];
      for (const k of ["whaleMua", "whaleBan", "liqLong", "liqShort"]) r[k] = Math.round(r[k]);
      return r;
    });
    if (!buckets.length) {
      console.log("[snapshot-12h-supabase] cửa sổ này trạm không có sự kiện — bỏ qua");
      return;
    }
    console.log(`[snapshot-12h-supabase] ${buckets.length} coin có bucket: ${buckets.map((b) => b.coin).join(", ")}`);
    if (DRY) {
      console.log("[snapshot-12h-supabase] DRY_RUN: bỏ qua ghi Supabase + file");
      return;
    }
    await w.writeFlowBuckets(buckets);

    /* Nối vào file lịch sử JSON (dual-write cho web). */
    let payload = { meta: {}, data: [] };
    try {
      const r = await fetch(HISTORY_URL, { signal: AbortSignal.timeout(20000) });
      if (r.ok) payload = await r.json();
    } catch (e) {
      console.log(`[snapshot-12h-supabase] ⚠ không kéo được file lịch sử cũ (${e.message.slice(0, 80)}) — tạo file mới`);
    }
    if (!Array.isArray(payload.data)) payload.data = [];
    const have = new Set(payload.data.map((x) => x.coin + "|" + x.w));
    let them = 0;
    for (const b of buckets) {
      if (have.has(b.coin + "|" + b.w)) {
        console.log(`[snapshot-12h-supabase] ${b.coin} đã có — bỏ qua`);
        continue;
      }
      payload.data.push(b);
      them++;
    }
    payload.data.sort((a, b) => a.w - b.w || (a.coin < b.coin ? -1 : 1));
    payload.meta = Object.assign(payload.meta || {}, {
      window: "12h", tz: "GMT+7",
      moTa: "Mỗi ngày 2 khung (00:00 & 12:00 giờ VN). Whale/taker: Binance (backfill) / trạm 24/7 (từ 28/09/2026). Thanh lý: CoinEx (backfill) / trạm 24/7.",
      capNhat: new Date(now).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      banGhi: payload.data.length,
    });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const tmp = OUT + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, OUT);
    console.log(`[snapshot-12h-supabase] +${them} bản ghi vào file → ${payload.data.length} bản ghi`);
  })();
}

main().catch((e) => {
  console.error("[snapshot-12h-supabase] FAIL:", e.message);
  process.exit(1);
});
