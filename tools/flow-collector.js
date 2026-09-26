/* ============================================================
 * Trade.2026 — Trạm thu thập dòng tiền 24/7 (flow-collector)
 * Chạy trên server (cron 15 phút), KHÔNG cần mở web.
 * Poll REST: OKX + Hyperliquid (2 sàn gọi được từ server; Binance/Bybit
 * bị chặn geo từ server nhưng web ở VN vẫn thu live đủ 4 sàn).
 *  - Lệnh lớn ≥ $100K → whales (id trùng format web để khử trùng)
 *  - Thanh lý OKX → liqs
 * Ghi data/flow-247.json → web tải về merge vào FlowDB (master data).
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_PATH = path.join(DATA_DIR, "flow-247.json");
const STORE_PATH = path.join(DATA_DIR, ".flow-247-store.json");
const COINS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "DYDX"];
const NGUONG = 100000;          // $100K như web
const GIU_NGAY = 7;

const jget = async (url, opt = {}) => {
  const r = await fetch(url, { headers: { "User-Agent": "trade2026-flow-247" }, ...opt });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 60)}`);
  return r.json();
};
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

function napStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); }
  catch { return { last: {}, whales: [], liqs: [] }; }
}
function luuStore(s) { fs.writeFileSync(STORE_PATH, JSON.stringify(s)); }
function prune(arr) {
  const han = Date.now() - GIU_NGAY * 864e5;
  return arr.filter((o) => o.ts >= han).slice(-4000);
}

async function okxTrades(st) {
  let moi = 0;
  for (const coin of COINS) {
    try {
      const d = await jget(`https://www.okx.com/api/v5/market/trades?instId=${coin}-USDT-SWAP&limit=100`);
      const last = st.last["okxT" + coin] || "0";
      let maxId = last;
      for (const t of (d.data || [])) {
        if (String(t.tradeId) <= last) continue;
        if (String(t.tradeId) > maxId) maxId = String(t.tradeId);
        const price = num(t.px), qty = num(t.sz), usd = price * qty;
        if (usd < NGUONG) continue;
        st.whales.push({
          id: `okx-${t.tradeId}`, san: "OKX", coin,
          price, qty, usd: Math.round(usd),
          side: String(t.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
          ts: num(t.ts) || Date.now(),
        });
        moi++;
      }
      st.last["okxT" + coin] = maxId;
    } catch (e) { console.log(`  ⚠ OKX trades ${coin}: ${e.message.slice(0, 80)}`); }
  }
  return moi;
}

async function hlTrades(st) {
  let moi = 0;
  for (const coin of COINS) {
    try {
      const arr = await jget("https://api.hyperliquid.xyz/info", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "recentTrades", coin }),
      });
      const last = st.last["hlT" + coin] || 0;
      let maxTid = last;
      for (const t of (Array.isArray(arr) ? arr : [])) {
        const tid = num(t.tid);
        if (tid <= last) continue;
        if (tid > maxTid) maxTid = tid;
        const price = num(t.px), qty = num(t.sz), usd = price * qty;
        if (usd < NGUONG) continue;
        st.whales.push({
          id: `hl-${t.hash || t.tid || t.time}-${t.sz}`, san: "HYPERLIQUID", coin,
          price, qty, usd: Math.round(usd),
          side: t.side === "B" ? "BUY" : "SELL",
          ts: num(t.time) || Date.now(),
        });
        moi++;
      }
      st.last["hlT" + coin] = maxTid;
    } catch (e) { console.log(`  ⚠ HL trades ${coin}: ${e.message.slice(0, 80)}`); }
  }
  return moi;
}

async function okxLiqs(st) {
  let moi = 0;
  for (const coin of COINS) {
    try {
      const d = await jget(`https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=${coin}-USDT&state=filled&limit=100`);
      const last = st.last["okxL" + coin] || 0;
      let maxTs = last;
      for (const g of (d.data || [])) {
        for (const x of (g.details || [])) {
          const ts = num(x.ts);
          if (ts <= last) continue;
          if (ts > maxTs) maxTs = ts;
          const price = num(x.bkPx), qty = num(x.sz), usd = price * qty;
          st.liqs.push({
            id: `okxl-${x.ts}-${coin}-${x.sz}`, san: "OKX", coin,
            price, qty, usd: Math.round(usd),
            huong: String(x.side).toUpperCase() === "SELL" ? "LONG" : "SHORT",
            ts: ts || Date.now(),
          });
          moi++;
        }
      }
      st.last["okxL" + coin] = maxTs;
    } catch (e) { console.log(`  ⚠ OKX liq ${coin}: ${e.message.slice(0, 80)}`); }
  }
  return moi;
}

async function main() {
  const t0 = Date.now();
  console.log(`[flow-247] bắt đầu ${new Date().toISOString()}`);
  const st = napStore();
  const w1 = await okxTrades(st);
  const w2 = await hlTrades(st);
  const l1 = await okxLiqs(st);
  st.whales = prune(st.whales);
  st.liqs = prune(st.liqs);
  luuStore(st);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payloadFlow = {
    tram: "flow-247",
    capNhat: new Date().toISOString(),
    nguon: ["OKX", "Hyperliquid"],
    nguong: NGUONG,
    whales: st.whales.slice(-800),
    liqs: st.liqs.slice(-800),
  };
  fs.writeFileSync(PUBLIC_PATH, JSON.stringify(payloadFlow));
  /* meta dung lượng: web hiện cảnh báo chiếm dụng */
  try {
    const statPub = fs.statSync(PUBLIC_PATH);
    let storeBytes = 0;
    try { storeBytes = fs.statSync(STORE_PATH).size; } catch {}
    payloadFlow.meta = {
      bytes: statPub.size, storeBytes,
      whales: st.whales.length, liqs: st.liqs.length,
      giuToiDa: 4000, giuNgay: GIU_NGAY,
      chuThich: "file công khai (nhánh data) + kho server",
    };
    fs.writeFileSync(PUBLIC_PATH, JSON.stringify(payloadFlow));
  } catch {}
  console.log(`  mới: ${w1 + w2} lệnh lớn, ${l1} thanh lý | kho: ${st.whales.length}W/${st.liqs.length}L | ${(Date.now() - t0) / 1000 | 0}s`);
}
main().catch((e) => { console.error("[flow-247] FAIL:", e.message); process.exit(1); });
