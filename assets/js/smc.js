/* ============================================================
 * Trade.2026 — Smart Money Concepts (SMC/ICT) core
 * Cấu trúc thị trường · BOS/CHoCH · Quét thanh khoản · FVG · Order Block
 * EQH/EQL · Premium/Discount · POI ưu tiên 5 tầng
 * (Hợp nhất từ 3 engine nguồn + 19 infographic SMC của Mr.Bit)
 * ============================================================ */
"use strict";

/* Chuẩn hóa nến Binance kline array → object */
function normalizeKlines(raw) {
  return raw.map(k => ({
    openTime: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4],
    volume: +k[5], closeTime: +k[6],
  }));
}

/* ---------- Cấu trúc thị trường: chuỗi HH/HL/LH/LL + sự kiện BOS/CHoCH ---------- */
function phanTichCauTruc(candles, swingL) {
  const { highs, lows } = findPivots(candles, swingL);
  const swings = [...highs.map(h => ({ ...h, loai: "H" })), ...lows.map(l => ({ ...l, loai: "L" }))]
    .sort((a, b) => a.index - b.index);

  // Gắn nhãn HH/HL/LH/LL (đỉnh/đáy bằng nhau vẫn tính là HH/HL — vùng EQH/EQL)
  let lastH = null, lastL = null;
  for (const s of swings) {
    if (s.loai === "H") { s.nhan = lastH == null ? "H" : (s.price >= lastH ? "HH" : "LH"); lastH = s.price; }
    else { s.nhan = lastL == null ? "L" : (s.price <= lastL ? "LL" : "HL"); lastL = s.price; }
  }

  // Bias từ 4 swing gần nhất
  const ganNhat = swings.slice(-4).map(s => s.nhan);
  const demTang = ganNhat.filter(n => n === "HH" || n === "HL").length;
  const demGiam = ganNhat.filter(n => n === "LH" || n === "LL").length;
  let bias = "range";
  if (demTang >= 3) bias = "bullish";
  else if (demGiam >= 3) bias = "bearish";
  else if (demTang >= 2 && demGiam <= 1) bias = "bullish-yếu";
  else if (demGiam >= 2 && demTang <= 1) bias = "bearish-yếu";

  const dinhCuoi = highs.length ? highs[highs.length - 1] : null;
  const dayCuoi  = lows.length ? lows[lows.length - 1] : null;
  return { swings, highs, lows, bias, dinhCuoi, dayCuoi };
}

/* ---------- Quét thanh khoản (liquidity sweep / stop hunt) ----------
 * Sweep đáy: wick xuyên xuống dưới đáy cũ nhưng CLOSE ngược lên trên → setup LONG
 * Sweep đỉnh: wick xuyên lên trên đỉnh cũ nhưng CLOSE ngược xuống dưới → setup SHORT */
function timSweepGanNhat(candles, cauTruc, maxBars = 24) {
  const n = candles.length;
  // FIX v2.0 (C3): chỉ quét nến ĐÃ ĐÓNG (bỏ nến cuối đang hình thành) — chống repaint
  const lastDong = n - 1;
  let sweepLong = null, sweepShort = null;
  const { highs, lows } = cauTruc;
  for (let i = Math.max(1, n - maxBars); i < lastDong; i++) {
    const c = candles[i];
    const dayTruoc = [...lows].reverse().find(p => p.index < i);
    const dinhTruoc = [...highs].reverse().find(p => p.index < i);
    if (dayTruoc && c.low < dayTruoc.price && c.close > dayTruoc.price) {
      sweepLong = { phia: "long", index: i, mucQuet: dayTruoc.price, wick: c.low, time: c.openTime };
    }
    if (dinhTruoc && c.high > dinhTruoc.price && c.close < dinhTruoc.price) {
      sweepShort = { phia: "short", index: i, mucQuet: dinhTruoc.price, wick: c.high, time: c.openTime };
    }
  }
  // FIX v2.0 (m3): nến quét cả 2 phía → chọn theo hướng đóng nến (phe thắng), thay vì ghi đè mù
  if (sweepLong && sweepShort && sweepLong.index === sweepShort.index) {
    const c = candles[sweepLong.index];
    return c.close >= c.open ? sweepLong : sweepShort;
  }
  if (!sweepLong) return sweepShort;
  if (!sweepShort) return sweepLong;
  return sweepLong.index >= sweepShort.index ? sweepLong : sweepShort;
}

/* ---------- CHoCH THẬT sau sweep ----------
 * FIX v2.0 (C2): phá ĐỈNH/ĐÁY SWING đã xác nhận gần nhất (dùng cauTruc),
 * không phá max/min của swingL nến lăn (quá dễ trigger).
 * - Bộ lọc CHoCH giả:
 *   (1) sweptFirst: phải có sweep trước đó
 *   (2) bodyClose: CẢ thân nến đóng vượt mức, không chỉ wick (FIX v2.0 C1: trước đây luôn true)
 *   (3) IDM (inducement): sau CHoCH có nhịp hồi rồi tiếp diễn
 * - Chỉ xét nến đã đóng (chống repaint) */
function timChoCh(candles, cauTruc, sweep, swingL, maxBarsSauSweep = 20) {
  if (!sweep) return null;
  const n = candles.length;
  const lastDong = n - 1;
  for (let i = sweep.index + 1; i < Math.min(lastDong, sweep.index + 1 + maxBarsSauSweep); i++) {
    const c = candles[i];
    if (sweep.phia === "long") {
      const dinhGan = [...cauTruc.highs].reverse().find(p => p.index < i);
      if (!dinhGan) continue;
      const nguong = dinhGan.price;
      if (c.close > nguong) {
        const bodyOk = Math.min(c.open, c.close) > nguong; // cả thân nến vượt mức
        return { phia: "long", index: i, mucPhaVo: nguong, time: c.openTime, bodyClose: bodyOk, sweptFirst: true, swingRef: dinhGan.index };
      }
    } else {
      const dayGan = [...cauTruc.lows].reverse().find(p => p.index < i);
      if (!dayGan) continue;
      const nguong = dayGan.price;
      if (c.close < nguong) {
        const bodyOk = Math.max(c.open, c.close) < nguong; // cả thân nến vượt mức
        return { phia: "short", index: i, mucPhaVo: nguong, time: c.openTime, bodyClose: bodyOk, sweptFirst: true, swingRef: dayGan.index };
      }
    }
  }
  return null;
}

/* IDM — sau CHoCH có pullback ≥ 30% chân sóng rồi tiếp tục theo hướng mới */
function kiemTraIDM(candles, choch, sweep) {
  if (!choch || !sweep) return false;
  const n = candles.length;
  const legStart = sweep.wick; // FIX v2.0: bỏ toán tử 3 ngôi 2 nhánh giống nhau
  const legEnd = choch.mucPhaVo;
  const leg = Math.abs(legEnd - legStart);
  if (!leg) return false;
  let coHoi = false, tiepDien = false;
  for (let i = choch.index + 1; i < n - 1; i++) { // FIX v2.0: bỏ nến đang hình thành (chống repaint)
    const c = candles[i];
    if (choch.phia === "long") {
      if (!coHoi && c.low <= legEnd - leg * 0.3) coHoi = true;
      if (coHoi && c.close > legEnd) { tiepDien = true; break; }
    } else {
      if (!coHoi && c.high >= legEnd + leg * 0.3) coHoi = true;
      if (coHoi && c.close < legEnd) { tiepDien = true; break; }
    }
  }
  return coHoi && tiepDien;
}

/* ---------- Fair Value Gap (3 nến) + trạng thái đã lấp ---------- */
function timFVG(candles, lookback = 80) {
  const out = [];
  const n = candles.length;
  const lastDong = n - 1; // FIX v2.0: không dùng nến đang hình thành (chống repaint)
  for (let i = Math.max(2, n - lookback); i < lastDong; i++) {
    const a = candles[i - 2], c = candles[i];
    if (a.high < c.low) out.push({ huong: "bullish", zone: [a.high, c.low], index: i, time: c.openTime, filled: false });
    if (a.low > c.high) out.push({ huong: "bearish", zone: [c.high, a.low], index: i, time: c.openTime, filled: false });
  }
  // kiểm tra đã lấp (giá quay lại quá 50% gap)
  for (const g of out) {
    const mid = (g.zone[0] + g.zone[1]) / 2;
    for (let i = g.index + 1; i < lastDong; i++) {
      const c = candles[i];
      if (g.huong === "bullish" && c.low <= mid) { g.filled = true; break; }
      if (g.huong === "bearish" && c.high >= mid) { g.filled = true; break; }
    }
  }
  return out;
}

/* ---------- Order Block ----------
 * Nến ngược màu cuối cùng trước cú displacement mạnh (impulse ≥ dispAtr × ATR14)
 * Thân nến OB ≥ bodyAtr × ATR; OB bị vô hiệu (mitigated) khi close xuyên hết vùng */
function timOrderBlocks(candles, { lookback = 80, dispAtr = 1.35, bodyAtr = 0.15, impulseBars = 5 } = {}) {
  const n = candles.length;
  const atr = atrSeries(candles, 14);
  const out = [];
  for (let i = Math.max(15, n - lookback); i < n - 1; i++) {
    const c = candles[i];
    const a = atr[i];
    if (!a) continue;
    const body = Math.abs(c.close - c.open);
    if (body < bodyAtr * a) continue;
    const nenGiam = c.close < c.open, nenTang = c.close > c.open;
    // đo impulse sau nến i
    let maxUp = 0, maxDown = 0;
    for (let j = i + 1; j <= Math.min(n - 1, i + impulseBars); j++) {
      maxUp = Math.max(maxUp, candles[j].high - c.high);
      maxDown = Math.max(maxDown, c.low - candles[j].low);
    }
    if (nenGiam && maxUp >= dispAtr * a) {
      out.push({ huong: "bullish", zone: [c.low, c.high], index: i, time: c.openTime, strength: +(maxUp / a).toFixed(2), mitigated: false });
    }
    if (nenTang && maxDown >= dispAtr * a) {
      out.push({ huong: "bearish", zone: [c.low, c.high], index: i, time: c.openTime, strength: +(maxDown / a).toFixed(2), mitigated: false });
    }
  }
  // mitigation — chỉ xét nến đã đóng (FIX v2.0: chống nhấp nháy trong nến)
  for (const ob of out) {
    for (let i = ob.index + 1; i < n - 1; i++) {
      const c = candles[i];
      if (ob.huong === "bullish" && c.close < ob.zone[0]) { ob.mitigated = true; break; }
      if (ob.huong === "bearish" && c.close > ob.zone[1]) { ob.mitigated = true; break; }
    }
  }
  return out;
}

/* ---------- EQH/EQL — đỉnh/đáy bằng nhau (pool thanh khoản), dung sai 0.12% ---------- */
function timEqualLevels(cauTruc, tol = 0.0012) {
  const eqh = [], eql = [];
  const hs = cauTruc.highs.slice(-8), ls = cauTruc.lows.slice(-8);
  for (let i = 0; i < hs.length - 1; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      if (Math.abs(hs[i].price - hs[j].price) / hs[j].price <= tol)
        eqh.push({ gia: (hs[i].price + hs[j].price) / 2, times: [hs[i].time, hs[j].time] });
    }
  }
  for (let i = 0; i < ls.length - 1; i++) {
    for (let j = i + 1; j < ls.length; j++) {
      if (Math.abs(ls[i].price - ls[j].price) / ls[j].price <= tol)
        eql.push({ gia: (ls[i].price + ls[j].price) / 2, times: [ls[i].time, ls[j].time] });
    }
  }
  return { eqh: eqh.slice(-3), eql: eql.slice(-3) };
}

/* ---------- Dealing range: Premium / Discount / Equilibrium ---------- */
function dealingRange(cauTruc, giaHienTai) {
  const { dinhCuoi, dayCuoi } = cauTruc;
  if (!dinhCuoi || !dayCuoi) return null;
  const hi = dinhCuoi.price, lo = dayCuoi.price;
  if (!(hi > lo)) return null;
  // Dải quá hẹp so với giá (< 0.4%) → không đáng tin, bỏ qua
  if ((hi - lo) / giaHienTai < 0.004) return null;
  const viTri = (giaHienTai - lo) / (hi - lo); // 0 = đáy, 1 = đỉnh
  // Giá vượt ngoài dải swing gần nhất (breakout) → gắn nhãn rõ ràng, không hiện % vô lý
  let vung, viTriPct;
  if (viTri > 1.15) { vung = "trên dải (breakout)"; viTriPct = 100; }
  else if (viTri < -0.15) { vung = "dưới dải (breakdown)"; viTriPct = 0; }
  else {
    viTriPct = Math.round(clamp(viTri, 0, 1) * 100);
    vung = viTri >= 0.62 ? "premium" : viTri <= 0.38 ? "discount" : "equilibrium";
  }
  return { dinh: hi, day: lo, equilibrium: (hi + lo) / 2, viTriPct, vung };
}

/* ---------- POI ưu tiên 5 tầng (Engine A coin-pulse) ----------
 * 1) OB LTF hình thành ngay trước CHoCH  2) OB LTF fresh cùng hướng
 * 3) OB MTF cùng hướng                    4) FVG chưa lấp cùng hướng
 * 5) Dải cấu trúc sweep→CHoCH (fallback) */
function chonPOI({ phia, chochLTF, obLTF, obMTF, fvgLTF, fvgMTF, sweep }) {
  const huong = phia === "long" ? "bullish" : "bearish";
  // Tầng 1
  if (chochLTF) {
    const truocChoCh = obLTF.filter(o => o.huong === huong && !o.mitigated && o.index < chochLTF.index && chochLTF.index - o.index <= 12);
    if (truocChoCh.length) { const o = truocChoCh[truocChoCh.length - 1]; return { ...o, nguon: "OB trước CHoCH (LTF)", tang: 1 }; }
  }
  // Tầng 2
  const freshLTF = obLTF.filter(o => o.huong === huong && !o.mitigated);
  if (freshLTF.length) { const o = freshLTF[freshLTF.length - 1]; return { ...o, nguon: "OB fresh (LTF)", tang: 2 }; }
  // Tầng 3
  const freshMTF = obMTF.filter(o => o.huong === huong && !o.mitigated);
  if (freshMTF.length) { const o = freshMTF[freshMTF.length - 1]; return { ...o, nguon: "OB khung 1H", tang: 3 }; }
  // Tầng 4
  const gaps = [...fvgLTF, ...fvgMTF].filter(g => g.huong === huong && !g.filled);
  if (gaps.length) { const g = gaps[gaps.length - 1]; return { ...g, nguon: "FVG chưa lấp", tang: 4 }; }
  // Tầng 5
  if (sweep && chochLTF) {
    const zone = phia === "long" ? [sweep.wick, chochLTF.mucPhaVo] : [chochLTF.mucPhaVo, sweep.wick];
    return { huong, zone: [Math.min(...zone), Math.max(...zone)], nguon: "Dải sweep→CHoCH", tang: 5 };
  }
  return null;
}
