/* ============================================================
 * Trade.2026 — Radar Cá Mập (OKX public/rubik API + sổ lệnh Binance)
 * Whale Score −100..+100:
 *   Top trader position ±25 · Taker flow 4h ±20 · OI×giá ±15
 *   Thanh lý 60ph ±15 · Funding ±10 · Sổ lệnh ±10 · Đám đông đảo chiều ±5
 * (Cơ chế Future & Market Maker trong mindmap: nhà cái dùng Futures
 *  thanh lý đòn bẩy để tạo thanh khoản — radar này soi dấu chân đó)
 * ============================================================ */
"use strict";

async function okxJson(path) {
  const j = await fetchJson(`${ENDPOINTS.okxRest}${path}`, { timeoutMs: 12000 });
  if (j.code !== "0") throw new Error(`OKX ${j.code}: ${j.msg || path}`);
  return j.data;
}

async function tinhWhaleScore(coin = "BTC") {
  const ccy = coin;
  const inst = `${coin}-USDT-SWAP`;
  const parts = [];
  let score = 0;
  const add = (ten, diem, max, ghiChu) => { const d = clamp(diem, -max, max); score += d; parts.push({ ten, diem: +d.toFixed(1), max, ghiChu }); };

  /* 1. Top trader position ratio (±25) */
  try {
    const d = await okxJson(`/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader?instId=${inst}&period=5m`);
    const ratio = +d[0]?.[1];
    if (isFinite(ratio)) {
      // ratio >1: top trader nghiêng long; scale quanh 1.0, ±0.5 → hết thang
      add("Vị thế Top Trader", (ratio - 1) * 50, 25, `Tỷ lệ L/S theo vị thế: ${ratio.toFixed(3)} ${ratio > 1 ? "(nghiêng LONG)" : ratio < 1 ? "(nghiêng SHORT)" : ""}`);
    }
  } catch (e) { parts.push({ ten: "Vị thế Top Trader", diem: 0, max: 25, ghiChu: "Không lấy được dữ liệu" }); }

  /* 2. Taker flow 4h (±20) */
  try {
    const d = await okxJson(`/api/v5/rubik/stat/taker-volume?ccy=${ccy}&instType=CONTRACTS&period=5m`);
    let buy = 0, sell = 0;
    for (const r of d.slice(0, 48)) { buy += +r[1]; sell += +r[2]; } // ~4h gần nhất
    const tong = buy + sell;
    if (tong > 0) {
      const lech = (buy - sell) / tong; // -1..1
      add("Dòng Taker 4h", lech * 100, 20, `Mua ${fmtSo(buy / tong * 100, 1)}% / Bán ${fmtSo(sell / tong * 100, 1)}%`);
    }
  } catch { parts.push({ ten: "Dòng Taker 4h", diem: 0, max: 20, ghiChu: "Không lấy được dữ liệu" }); }

  /* 3. Open Interest thay đổi (±15) — OI tăng + giá tăng = long mới vào */
  try {
    const d = await okxJson(`/api/v5/rubik/stat/contracts/open-interest-history?instId=${inst}&period=5m&limit=48`);
    if (d.length >= 2) {
      const moi = +d[0][1], cu = +d[d.length - 1][1];
      const oiPct = cu ? (moi - cu) / cu * 100 : 0;
      const giaMoi = PRICE_HUB?.gia(coin);
      const nen = SIGNAL_CACHE.get(coin);
      const giaCu = nen?.candles15?.[nen.candles15.length - 17]?.close; // ~4h trước
      const giaPct = giaMoi && giaCu ? (giaMoi - giaCu) / giaCu * 100 : 0;
      // cùng chiều: xác nhận xu hướng; OI tăng giá giảm = short mới
      const diem = Math.sign(giaPct || 0) * Math.min(Math.abs(oiPct) * 3, 15) * (oiPct > 0 ? 1 : -0.5);
      add("Open Interest 4h", diem, 15, `OI ${fmtPct(oiPct)} · Giá ${fmtPct(giaPct)}`);
    }
  } catch { parts.push({ ten: "Open Interest 4h", diem: 0, max: 15, ghiChu: "Không lấy được dữ liệu" }); }

  /* 4. Thanh lý 60 phút (±15) — short bị thanh lý nhiều → lực đẩy tăng */
  try {
    const d = await okxJson(`/api/v5/public/liquidation-orders?instType=SWAP&state=filled&uly=${coin}-USDT&limit=100`);
    let longLiq = 0, shortLiq = 0;
    const gio = Date.now() - 3600e3;
    for (const row of d) for (const det of row.details || []) {
      if (+det.ts < gio) continue;
      const usd = (+det.sz || 0) * (+det.bkPx || 0) * (coin === "BTC" ? 0.01 : 1);
      if (det.posSide === "long") longLiq += usd; else if (det.posSide === "short") shortLiq += usd;
    }
    const tong = longLiq + shortLiq;
    if (tong > 1000) {
      add("Thanh lý 60ph", (shortLiq - longLiq) / tong * 15, 15, `Short bị thanh lý ${fmtUsd(shortLiq)} · Long ${fmtUsd(longLiq)}`);
    } else parts.push({ ten: "Thanh lý 60ph", diem: 0, max: 15, ghiChu: "Không đáng kể" });
  } catch { parts.push({ ten: "Thanh lý 60ph", diem: 0, max: 15, ghiChu: "Không lấy được dữ liệu" }); }

  /* 5. Funding rate (±10) — funding quá dương = long đông đúc (điểm âm nhẹ cho long mới) */
  try {
    const d = await okxJson(`/api/v5/public/funding-rate?instId=${inst}`);
    const fr = +d[0]?.fundingRate;
    if (isFinite(fr)) {
      const frPct = fr * 100;
      // funding trong ±0.01% trung tính; dương cao → trừ; âm → cộng (contrarian nhẹ)
      add("Funding rate", -frPct * 400, 10, `${(frPct).toFixed(4)}%/kỳ ${frPct > 0.03 ? "(long trả phí cao — đông đúc)" : frPct < -0.01 ? "(short trả phí — thiên mua)" : ""}`);
    }
  } catch { parts.push({ ten: "Funding rate", diem: 0, max: 10, ghiChu: "Không lấy được dữ liệu" }); }

  /* 6. Sổ lệnh spot ±10 — mất cân bằng bid/ask */
  try {
    const depth = await fetchDepth(coin, 50);
    const sum = (side) => side.reduce((a, [p, q]) => a + (+p) * (+q), 0);
    const bid = sum(depth.bids || []), ask = sum(depth.asks || []);
    if (bid + ask > 0) {
      const r = bid / Math.max(ask, 1);
      add("Sổ lệnh Spot", (r - 1) * 12, 10, `Bid/Ask = ${r.toFixed(2)}x ${r > 1.2 ? "(tường mua)" : r < 0.83 ? "(tường bán)" : ""}`);
    }
  } catch { parts.push({ ten: "Sổ lệnh Spot", diem: 0, max: 10, ghiChu: "Không lấy được dữ liệu" }); }

  /* 7. Đám đông — contrarian (±5): retail nghiêng 1 phía quá đà → điểm ngược lại */
  try {
    const d = await okxJson(`/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=5m`);
    const ratio = +d[0]?.[1];
    if (isFinite(ratio)) {
      add("Đám đông (đảo chiều)", -(ratio - 1) * 6, 5, `Tài khoản L/S: ${ratio.toFixed(2)} ${ratio > 1.5 ? "(retail FOMO long)" : ratio < 0.67 ? "(retail sợ hãi)" : ""}`);
    }
  } catch { parts.push({ ten: "Đám đông (đảo chiều)", diem: 0, max: 5, ghiChu: "Không lấy được dữ liệu" }); }

  /* 8. Dòng tiền real-time từ DataHub (đa sàn: lệnh lớn + thanh lý) — tối đa ±20
   * FIX v2.0: loại OKX (đã tính ở mục 2 "Dòng Taker 4h" qua rubik) — chống đếm trùng */
  try {
    if (window.DataHub && window.DataHubBridge) {
      const fs = DataHub.flowScore(coin, { loaiTruSan: ["OKX"] });
      const st = DataHub.stats();
      const cs = st?.coinStats?.[coin];
      if (fs !== 0 || cs) {
        const truoc = score;
        score = DataHubBridge.congVaoWhaleScore(coin, score);
        const ghi = cs
          ? `Lệnh lớn ${cs.count} lệnh · mua ${fmtUsd(cs.buy)} / bán ${fmtUsd(cs.sell)} (điểm số đã trừ OKX)`
          : `Điểm dòng tiền ${fs > 0 ? "+" : ""}${fs} (đã trừ OKX)`;
        parts.push({ ten: "Dòng tiền real-time (DataHub)", diem: +(score - truoc).toFixed(1), max: 20, ghiChu: ghi });
      }
    }
  } catch (e) {}

  score = clamp(Math.round(score), -100, 100);
  const nhan = score >= 30 ? "🐋 Cá mập nghiêng MUA mạnh" : score >= 10 ? "🐋 Thiên MUA nhẹ"
    : score <= -30 ? "🐋 Cá mập nghiêng BÁN mạnh" : score <= -10 ? "🐋 Thiên BÁN nhẹ" : "🐋 Trung lập / phân hóa";
  return { coin, score, nhan, parts, at: Date.now() };
}

/* Giao dịch lớn gần nhất trên OKX swap (feed cá mập) */
async function fetchLenhLon(coin = "BTC", nguongUsd = 100000) {
  try {
    const d = await okxJson(`/api/v5/market/trades?instId=${coin}-USDT-SWAP&limit=200`);
    const ctVal = coin === "BTC" ? 0.01 : coin === "ETH" ? 0.1 : 1; // giá trị hợp đồng gần đúng
    return d.map(t => ({
      ts: +t.ts, side: t.side, gia: +t.px,
      usd: (+t.sz) * ctVal * (+t.px),
    })).filter(t => t.usd >= nguongUsd).slice(0, 30);
  } catch { return []; }
}
