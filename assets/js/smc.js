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

/* ---------- 3 TRẠNG THÁI CƠ BẢN CỦA THỊ TRƯỜNG (v2.6.0 — kiến thức "18 phút") ----------
 * 1. TĂNG (UPTREND): chuỗi HH + HL — người mua kiểm soát → chỉ tìm LONG tại HL
 * 2. GIẢM (DOWNTREND): chuỗi LH + LL — người bán kiểm soát → chỉ tìm SHORT tại LH
 * 3. ĐI NGANG (SIDEWAYS): cân bằng cung cầu → chờ phá vỡ, không giao dịch giữa dải
 * Dùng 6 swing gần nhất của phanTichCauTruc. EQH/EQL (đỉnh/đáy bằng nhau) tự rơi vào ĐI NGANG. */
function danhGiaTrangThai(cauTruc) {
  const mau = (cauTruc && cauTruc.swings ? cauTruc.swings.slice(-6) : []).map(s => s.nhan).filter(Boolean);
  const tang = mau.filter(n => n === "HH" || n === "HL").length;
  const giam = mau.filter(n => n === "LH" || n === "LL").length;
  let trangThai = "ĐI NGANG", huong = null, quyTac = "Chờ phá vỡ khỏi vùng đi ngang — không giao dịch giữa dải";
  if (tang >= 4 && giam <= 1) {
    trangThai = "TĂNG"; huong = "long";
    quyTac = "Người mua kiểm soát — chỉ tìm LONG tại đáy cao hơn (HL)";
  } else if (giam >= 4 && tang <= 1) {
    trangThai = "GIẢM"; huong = "short";
    quyTac = "Người bán kiểm soát — chỉ tìm SHORT tại đỉnh thấp hơn (LH)";
  }
  return { trangThai, huong, tang, giam, mau, quyTac };
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

/* ---------- Chất lượng Order Block (v2.7.0 — kiến thức "4 kiểu OB nên né") ----------
 * 4 YẾU TỐ OB CHẤT LƯỢNG (cộng điểm):
 *  1. Xuất hiện trước cú đẩy mạnh — momentum (strength = độ dài impulse / ATR)
 *  2. Gắn với phá cấu trúc BOS/CHoCH (OB được xác nhận, không phải nhiễu)
 *  3. Có thanh khoản đứng sau (sweep trước đó, hoặc pool EQH/EQL gần vùng)
 *  4. Nằm ở vị trí hợp lý trong xu hướng (đúng hướng cấu trúc HTF)
 * 4 KIỂU OB NÊN NÉ (trừ điểm + cảnh báo):
 *  1. OB trong vùng tích lũy/nhiễu (HTF ĐI NGANG) — thị trường chưa chọn hướng
 *  2. OB bẫy thanh khoản — hình thành mà không có sweep/liquidity đứng sau
 *  3. OB ngược xu hướng lớn (HTF) — chỉ là nhịp hồi yếu, dễ bị quét SL
 *  4. OB bị test quá nhiều lần — mỗi lần chạm hút bớt lệnh chờ, mất sức mạnh
 * Xếp loại: ≥70 KHỎE · 40–69 TRUNG BÌNH · <40 YẾU */
function demChamOB(candles, ob) {
  let dem = 0;
  const [zLo, zHi] = ob.zone;
  for (let i = ob.index + 1; i < candles.length - 1; i++) { // chỉ nến đã đóng
    const c = candles[i];
    if (c.low <= zHi && c.high >= zLo) dem++;
  }
  return dem;
}

function danhGiaChatLuongOB(ob, ctx) {
  const chiTiet = [], canhBao = [];
  if (!ob || !ob.zone || ob.zone.length < 2) {
    return { diem: -100, xepLoai: "YẾU", chiTiet, canhBao: ["POI không phải vùng giá hợp lệ"], soLanCham: 0, strength: 0 };
  }
  let diem = 0;
  const mid = (ob.zone[0] + ob.zone[1]) / 2;

  // 1. Momentum trước OB
  const st = ob.strength || 0;
  if (st >= 2.5) { diem += 25; chiTiet.push(`Momentum mạnh (strength ${st} ATR)`); }
  else if (st >= 1.35) { diem += 12; chiTiet.push(`Momentum vừa (strength ${st} ATR)`); }
  else { diem -= 10; canhBao.push("OB momentum yếu — không có lực đẩy rõ ràng (nhiễu)"); }

  // 2. Gắn với BOS/CHoCH
  if (ctx.choch && Math.abs(ob.index - ctx.choch.index) <= 12) {
    diem += 25; chiTiet.push("OB gắn với CHoCH (xác nhận đổi tính chất)");
  }

  // 3. Thanh khoản đứng sau
  if (ctx.sweep) { diem += 25; chiTiet.push("Có sweep thanh khoản đứng sau"); }
  else {
    const eq = ctx.eq || { eqh: [], eql: [] };
    const atrRef = ctx.atr || mid * 0.002;
    const eqGan = [...(eq.eqh || []), ...(eq.eql || [])].some(e => Math.abs(e.gia - mid) <= atrRef * 1.5);
    if (eqGan) { diem += 10; chiTiet.push("Có pool EQH/EQL gần vùng"); }
    else { diem -= 10; canhBao.push("OB không có liquidity đứng sau — dễ bị quét"); }
  }

  // 4. Vị trí trong xu hướng + kiểu né "ngược xu hướng lớn" / "vùng tích lũy"
  const tt = ctx.ttHTF;
  if (tt && tt.huong) {
    const cungHuong = (ctx.side === "long" && tt.huong === "long") || (ctx.side === "short" && tt.huong === "short");
    if (cungHuong) { diem += 25; chiTiet.push(`Đúng xu hướng 4H ${tt.trangThai}`); }
    else { diem -= 30; canhBao.push(`OB đi ngược xu hướng lớn 4H ${tt.trangThai} — chỉ là nhịp hồi yếu, dễ bị quét SL`); }
  } else {
    diem -= 15; canhBao.push("OB nằm giữa vùng tích lũy/đi ngang — thị trường chưa chọn hướng, OB chỉ là nhiễu");
  }

  // 5. Số lần bị test (mitigated nhiều lần → mất sức mạnh)
  const soLanCham = demChamOB(ctx.candles || [], ob);
  if (soLanCham >= 3) { diem -= 20; canhBao.push(`OB đã bị test ${soLanCham} lần — mất dần sức mạnh, không còn giá trị`); }
  else if (soLanCham >= 1) { diem -= 5; chiTiet.push(`Đã bị chạm ${soLanCham} lần`); }
  else chiTiet.push("OB tươi (fresh) — chưa bị test");

  diem = clamp(diem, -100, 100);
  const xepLoai = diem >= 70 ? "KHỎE" : diem >= 40 ? "TRUNG BÌNH" : "YẾU";
  return { diem, xepLoai, chiTiet, canhBao, soLanCham, strength: st };
}

/* ---------- Bối cảnh nến (v2.8.0 — kiến thức "đọc nến") ----------
 * Doctrine: "Nến là tín hiệu, vị trí là độ cậy."
 *  - Mẫu nến chỉ có giá trị khi xuất hiện ĐÚNG CHỖ (vùng quan trọng: POI / S-R / swing).
 *    Nến đẹp giữa range = nhiễu, dễ là trap → cảnh báo, không cộng điểm.
 *  - Đúng hướng xu hướng + volume xác nhận (≥1.3× TB) + thân nến đủ lực (≥1.2 ATR).
 *  - Breakout THẬT: thân lớn + đóng cửa ngoài vùng + volume tăng.
 *    Breakout GIẢ: râu dài từ chối giá + đóng cửa quay lại trong vùng + volume thấp.
 *  - Doji / Inside bar đơn độc KHÔNG phải tín hiệu buy/sell — chỉ là "tạm dừng", chờ nến xác nhận.
 *  - Nến quét thanh khoản (râu dài quét S/R + đóng cửa quay lại): engine đã có sweepDungPhia;
 *    ở đây chỉ chấm các mẫu XÁC NHẬN sau sweep để tránh double-count.
 * Chỉ dùng nến ĐÃ ĐÓNG (bỏ nến cuối đang hình thành) — chống repaint. */
function thongSoNen(c) {
  const body = Math.abs(c.close - c.open);
  const range = (c.high - c.low) || 1e-9;
  const tang = c.close >= c.open;
  return {
    body, range, tang,
    rauTren: c.high - Math.max(c.open, c.close),
    rauDuoi: Math.min(c.open, c.close) - c.low,
    dongGanDinh: (c.high - c.close) / range <= 0.25,
    dongGanDay: (c.close - c.low) / range <= 0.25,
  };
}

function nhanDienMauNen(dong) { // dong: nến đã đóng, mới nhất ở cuối
  const mau = [];
  const n = dong.length;
  if (n < 2) return mau;
  const c = dong[n - 1], p = dong[n - 2];
  const s = thongSoNen(c), sp = thongSoNen(p);
  // Pin bar (búa / sao băng): râu dài ≥2× thân, thân nhỏ ở 1 đầu
  if (s.rauDuoi >= 2 * s.body && s.rauTren <= s.body && s.rauDuoi >= 0.55 * s.range)
    mau.push({ ten: "Pin bar tăng", huong: "tang" });
  if (s.rauTren >= 2 * s.body && s.rauDuoi <= s.body && s.rauTren >= 0.55 * s.range)
    mau.push({ ten: "Pin bar giảm", huong: "giam" });
  // Nhấn chìm: thân nến sau bao trùm thân nến trước, ngược màu
  if (!sp.tang && s.tang && c.open <= p.close && c.close >= p.open && s.body >= sp.body)
    mau.push({ ten: "Nhấn chìm tăng", huong: "tang" });
  if (sp.tang && !s.tang && c.open >= p.close && c.close <= p.open && s.body >= sp.body)
    mau.push({ ten: "Nhấn chìm giảm", huong: "giam" });
  // Doji: thân ≤10% range → lưỡng lự, không phải tín hiệu đơn độc
  if (s.body <= 0.1 * s.range) mau.push({ ten: "Doji", huong: "luong_lu" });
  // Inside bar: nằm gọn trong nến mẹ → nén, chờ phá vỡ
  if (c.high <= p.high && c.low >= p.low) mau.push({ ten: "Inside bar", huong: "luong_lu" });
  return mau;
}

function danhGiaNen(candles, ctx) {
  const chiTiet = [], canhBao = [];
  const n = candles.length;
  if (n < 22 || !ctx.side) return null; // không đủ dữ liệu → trung tính
  const dong = candles.slice(0, n - 1); // bỏ nến đang hình thành
  const atr = ctx.atr || 1e-9;
  const mau = nhanDienMauNen(dong.slice(-3));
  const c = dong[dong.length - 1], p = dong[dong.length - 2];
  const s = thongSoNen(c);
  const side = ctx.side;

  // --- Vị trí: đúng chỗ (POI / S-R / swing) hay giữa range ---
  const zone = ctx.poi && ctx.poi.zone ? [Math.min(...ctx.poi.zone), Math.max(...ctx.poi.zone)] : null;
  const tol = atr * 0.5;
  const chamPOI = zone && c.low <= zone[1] + tol && c.high >= zone[0] - tol;
  const khoa = (ctx.khoa || []).map(k => (k && k.gia != null ? k.gia : k)).filter(g => typeof g === "number");
  const chamKhoa = khoa.some(g => Math.abs(c.low - g) <= tol || Math.abs(c.high - g) <= tol || (c.low <= g && c.high >= g));
  const dungCho = chamPOI || chamKhoa;
  const viTri = chamPOI ? "POI" : chamKhoa ? "vùng S/R" : "giữa range";

  // --- Volume xác nhận ---
  const vols = dong.slice(-21, -1).map(k => k.volume || 0).filter(v => v > 0);
  const volTB = vols.length >= 10 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
  const volRatio = volTB > 0 && c.volume > 0 ? c.volume / volTB : 1;
  const volXacNhan = volRatio >= 1.3, volYeu = volRatio < 0.7;

  // --- Lực nến ---
  const lucManh = s.body >= 1.2 * atr && (s.dongGanDinh || s.dongGanDay);

  let diem = 50;
  const cungHuong = m => (side === "long" && m.huong === "tang") || (side === "short" && m.huong === "giam");
  const nguocHuong = m => (side === "long" && m.huong === "giam") || (side === "short" && m.huong === "tang");
  const mauChinh = mau.filter(m => m.huong !== "luong_lu");

  if (!mau.length) {
    chiTiet.push("Không có mẫu nến rõ ràng — trung tính, chờ giá về đúng chỗ");
  } else if (!mauChinh.length) {
    chiTiet.push(`${mau.map(m => m.ten).join(" + ")} — chỉ là "tạm dừng", KHÔNG phải tín hiệu buy/sell; chờ nến xác nhận`);
    if (!dungCho) canhBao.push("Nến lưỡng lự giữa range — không có giá trị giao dịch");
  } else {
    for (const m of mauChinh) {
      if (cungHuong(m) && dungCho) { diem += 25; chiTiet.push(`${m.ten} ĐÚNG CHỖ (${viTri}) + đúng hướng — xác nhận mạnh`); }
      else if (cungHuong(m)) { canhBao.push(`${m.ten} đẹp nhưng SAI CHỖ (giữa range) — dễ là trap, không vội vào lệnh`); }
      else if (nguocHuong(m) && dungCho) { diem -= 30; canhBao.push(`${m.ten} tại ${viTri} đang CHỐNG lại hướng ${side.toUpperCase()} — phe đối lập phản kháng mạnh`); }
      else if (nguocHuong(m)) { diem -= 10; canhBao.push(`${m.ten} ngược hướng lệnh (giữa range)`); }
    }
  }

  if (volXacNhan) { diem += 10; chiTiet.push(`Volume xác nhận (x${volRatio.toFixed(1)} TB) — dòng tiền đứng sau`); }
  else if (volYeu) { diem -= 5; canhBao.push(`Volume yếu (x${volRatio.toFixed(1)} TB) — thiếu dòng tiền ủng hộ`); }
  if (lucManh && dungCho && mauChinh.some(cungHuong)) { diem += 10; chiTiet.push("Thân nến lớn (≥1.2 ATR), đóng cửa dứt khoát — lực mạnh"); }

  // --- Breakout thật / giả tại key level ---
  for (const g of khoa) {
    const phaLen = p.close <= g && c.close > g + tol * 0.5;
    const phaXuong = p.close >= g && c.close < g - tol * 0.5;
    if (!phaLen && !phaXuong) continue;
    const huongPha = phaLen ? "tang" : "giam";
    const cungHuongLenh = (side === "long" && huongPha === "tang") || (side === "short" && huongPha === "giam");
    const that = s.body >= 1.0 * atr && volRatio >= 1.2;                    // thân lớn + volume tăng
    const gia = (s.rauTren >= 2 * s.body || s.rauDuoi >= 2 * s.body) || volRatio < 0.8; // râu dài từ chối / volume thấp
    if (that && cungHuongLenh) { diem += 10; chiTiet.push("Breakout THẬT: thân lớn + đóng cửa ngoài vùng + volume tăng"); }
    else if (gia && cungHuongLenh) { diem -= 20; canhBao.push("Breakout GIẢ (bull/bear trap): râu dài từ chối giá + đóng cửa quay lại — không đuổi theo"); }
    else if (that && !cungHuongLenh) { diem -= 15; canhBao.push("Giá đang breakout NGƯỢC hướng lệnh với lực mạnh — cân nhắc đứng ngoài"); }
    else if (gia && !cungHuongLenh) { diem += 5; chiTiet.push("Phe ngược thử phá nhưng bị từ chối (breakout giả ngược hướng) — phe ta đang thắng thế"); }
    break; // chỉ chấm key level gần nhất bị phá
  }

  diem = clamp(diem, 0, 100);
  const xepLoai = diem >= 70 ? "MẠNH" : diem >= 45 ? "TRUNG BÌNH" : diem >= 20 ? "YẾU" : "CHỐNG LỆNH";
  return { diem, xepLoai, mau: mau.map(m => m.ten), viTri, volRatio: +volRatio.toFixed(2), volXacNhan, chiTiet, canhBao };
}
