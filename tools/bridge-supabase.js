/* ============================================================
 * Trade.2026 — bridge-supabase.js (cầu nối trình duyệt -> Supabase)
 * Chạy trên GitHub Actions mỗi 5 phút (cron tối thiểu của Actions).
 *
 * Luồng gốc (tools/bridge-browser.js, cron 2 phút trên server cũ):
 *   kéo data/browser-signals.json (nhánh data) -> kiểm chứng từng bản ghi
 *   -> trộn vào store journal + payload journal-247.json để WhatsApp thấy ngay.
 * Bản Supabase (stateless):
 *   kéo cùng file đó -> kiểm chứng bằng hopLe() của script gốc
 *   -> upsert bản mới vào bảng signals (khử trùng theo id — miễn phí,
 *      không cần file store) -> ghi tập id đã thấy vào heartbeat
 *   (tram='bridge-browser', meta.seen, giữ 1000 id mới nhất) để lần sau
 *   không upsert lại cả hàng đợi.
 * KHÁC BIỆT so với bản gốc: không chạm vào file journal-247.json nữa —
 * tín hiệu trình duyệt sẽ vào payload web ở vòng collector 15 phút tiếp theo;
 * sender Telegram đọc thẳng bảng signals nên thấy tin trong tối đa 5 phút.
 *
 * LƯU Ý: file browser-signals.json trên nhánh data đã ngừng cập nhật từ
 * 12/10/2026 (trình duyệt của user không còn đẩy) — workflow này sẽ chạy
 * no-op cho tới khi cầu nối trình duyệt được bật lại trong app.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (GitHub Secrets).
 * BRIDGE_RAW_URL: ghi đè URL hàng đợi (mặc định file trên nhánh data; dùng khi test).
 * DRY_RUN=1: chỉ đọc + log, không ghi Supabase.
 * ============================================================ */
"use strict";

const writer = require("./supabase-writer.js");
const { hopLe } = require("./bridge-browser.js");

const RAW_URL =
  process.env.BRIDGE_RAW_URL ||
  "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/browser-signals.json";
const DRY = process.env.DRY_RUN === "1";
const SEEN_MAX = 1000;

async function main() {
  console.log(`[bridge-supabase] bắt đầu ${new Date().toISOString()}${DRY ? " (DRY_RUN)" : ""}`);
  const w = writer.createFromEnv();

  let hangDoi = null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(RAW_URL, { signal: ctl.signal });
      if (r.status === 404) {
        console.log("[bridge-supabase] KHÔNG CÓ GÌ MỚI (chưa có hàng đợi)");
        return;
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      hangDoi = await r.json();
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    console.log("[bridge-supabase] lỗi kéo hàng đợi:", String((e && e.message) || e).slice(0, 100));
    process.exitCode = 1;
    return;
  }
  const ds = hangDoi && Array.isArray(hangDoi.tinHieu) ? hangDoi.tinHieu : [];
  if (!ds.length) {
    console.log("[bridge-supabase] KHÔNG CÓ GÌ MỚI");
    return;
  }

  let seen = [];
  try {
    const hb = await w.readHeartbeat("bridge-browser");
    if (hb && hb.meta && Array.isArray(hb.meta.seen)) seen = hb.meta.seen;
  } catch (e) {
    console.log(`[bridge-supabase] ⚠ không đọc được seen (${e.message.slice(0, 100)}) — coi như chưa thấy gì`);
  }
  const seenSet = new Set(seen);
  const moi = [];
  for (const raw of ds) {
    const rec = hopLe(raw);
    if (!rec || seenSet.has(rec.id)) continue;
    moi.push(rec);
    seenSet.add(rec.id);
  }
  if (!moi.length) {
    console.log("[bridge-supabase] KHÔNG CÓ GÌ MỚI");
    return;
  }
  console.log(
    `[bridge-supabase] CÓ TIN MỚI: ${moi.length} bản ghi (${moi.map((r) => r.coin + " " + r.side).join(", ")})`
  );
  if (DRY) {
    console.log("[bridge-supabase] DRY_RUN: bỏ qua ghi Supabase");
    return;
  }
  await w.writeSignals(moi);
  const seenMoi = [...seenSet].slice(-SEEN_MAX);
  await w.writeHeartbeat("bridge-browser", { seen: seenMoi });
  console.log(`[bridge-supabase] xong: ${moi.length} vào signals, seen giữ ${seenMoi.length} id`);
}

main().catch((e) => {
  console.error("[bridge-supabase] FAIL:", e.message);
  process.exit(1);
});
