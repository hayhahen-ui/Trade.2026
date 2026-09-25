/* ============================================================
 * Trade.2026 — Chỉ báo kỹ thuật thuần (không phụ thuộc thư viện)
 * EMA (seed SMA) · RSI Wilder · ATR · Pivot fractal · Volume Profile · Fibo OTE
 * ============================================================ */
"use strict";

/* Chuẩn hoá 1 giá trị số: null/undefined/NaN/Infinity → null */
function _num(v) { return (v == null || !isFinite(+v)) ? null : +v; }

/* EMA seed bằng SMA (chuẩn Pine) — trả về mảng cùng độ dài, null khi chưa đủ dữ liệu */
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) { const v = _num(values[i]); if (v == null) return out; sum += v; }
  let ema = sum / period;
  out[period - 1] = ema;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    const v = _num(values[i]);
    if (v == null) { out[i] = ema; continue; } // thiếu dữ liệu: giữ EMA cũ, không lan NaN
    ema = v * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}
function emaLast(values, period) { const s = emaSeries(values, period); return s[s.length - 1]; }

function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    sum += v;
    if (i >= period) sum -= values[i - period] ?? 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/* RSI Wilder chuẩn */
function rsiSeries(closes, len = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= len) return out;
  const cs = closes.map(_num);
  let gain = 0, loss = 0;
  for (let i = 1; i <= len; i++) {
    if (cs[i] == null || cs[i - 1] == null) return out; // dữ liệu lỗ hổng trong seed → không tính
    const d = cs[i] - cs[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / len, avgL = loss / len;
  out[len] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = len + 1; i < cs.length; i++) {
    if (cs[i] == null || cs[i - 1] == null) { out[i] = out[i - 1]; continue; }
    const d = cs[i] - cs[i - 1];
    avgG = (avgG * (len - 1) + Math.max(d, 0)) / len;
    avgL = (avgL * (len - 1) + Math.max(-d, 0)) / len;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

/* ATR trung bình đơn giản của True Range */
function atrSeries(candles, len = 14) {
  const out = new Array(candles.length).fill(null);
  const trs = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    // FIX v2.0: nến null/lỗi → TR null, không crash, không lan NaN
    const ch = _num(c?.high), cl = _num(c?.low);
    let tr = null;
    if (ch != null && cl != null) {
      const pc = _num(p?.close);
      tr = (p && pc != null)
        ? Math.max(ch - cl, Math.abs(ch - pc), Math.abs(cl - pc))
        : ch - cl;
      if (!(tr >= 0)) tr = null;
    }
    trs.push(tr);
    if (i >= len - 1) {
      const win = trs.slice(i - len + 1, i + 1);
      out[i] = win.every(v => v != null) ? win.reduce((s, v) => s + v, 0) / len : null;
    }
  }
  return out;
}
function atrLast(candles, len = 14) { const s = atrSeries(candles, len); return s[s.length - 1]; }

/* Pivot fractal: đỉnh/đáy xác nhận khi cao/thấp NGHIÊM NGẶT hơn k nến hai bên */
function isPivotHigh(highs, i, k) {
  if (i < k || i >= highs.length - k) return false;
  for (let j = i - k; j <= i + k; j++) { if (j !== i && highs[j] >= highs[i]) return false; }
  return true;
}
function isPivotLow(lows, i, k) {
  if (i < k || i >= lows.length - k) return false;
  for (let j = i - k; j <= i + k; j++) { if (j !== i && lows[j] <= lows[i]) return false; }
  return true;
}
function findPivots(candles, k) {
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const ph = [], pl = [];
  for (let i = k; i < candles.length - k; i++) {
    if (isPivotHigh(highs, i, k)) ph.push({ index: i, price: highs[i], time: candles[i].openTime });
    if (isPivotLow(lows, i, k))  pl.push({ index: i, price: lows[i],  time: candles[i].openTime });
  }
  return { highs: ph, lows: pl };
}

/* Max/min của N nến TRƯỚC endIndex (LOẠI TRỪ nến hiện tại — fix quan trọng từ Pine port) */
function highestPrior(values, endIndex, length) {
  let m = -Infinity;
  for (let i = Math.max(0, endIndex - length); i < endIndex; i++) m = Math.max(m, values[i]);
  return m;
}
function lowestPrior(values, endIndex, length) {
  let m = Infinity;
  for (let i = Math.max(0, endIndex - length); i < endIndex; i++) m = Math.min(m, values[i]);
  return m;
}

/* Volume Profile đơn giản: histogram khối lượng theo giá → POC + HVN */
function volumeProfile(candles, bins = 24) {
  if (!candles.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins;
  const vols = new Array(bins).fill(0);
  for (const c of candles) {
    // phân bổ volume của nến đều vào các bin mà nến đi qua
    const b0 = clamp(Math.floor((c.low - lo) / step), 0, bins - 1);
    const b1 = clamp(Math.floor((c.high - lo) / step), 0, bins - 1);
    const share = c.volume / (b1 - b0 + 1);
    for (let b = b0; b <= b1; b++) vols[b] += share;
  }
  let pocBin = 0;
  for (let b = 1; b < bins; b++) if (vols[b] > vols[pocBin]) pocBin = b;
  const total = vols.reduce((a, b) => a + b, 0) || 1;
  const rows = vols.map((v, b) => ({
    giaTu: lo + b * step, giaDen: lo + (b + 1) * step, mid: lo + (b + 0.5) * step,
    volume: v, tyLe: v / total,
  }));
  const nguongHvn = Math.max(...vols) * 0.7;
  return {
    poc: rows[pocBin].mid,
    pocZone: [rows[pocBin].giaTu, rows[pocBin].giaDen],
    hvn: rows.filter(r => r.volume >= nguongHvn).map(r => r.mid),
    rows,
  };
}

/* Fibonacci OTE (Optimal Trade Entry 0.618–0.786) trên chân sóng impulse */
function fiboOTE(swingStart, swingEnd, huong /* 'long' | 'short' */) {
  const range = Math.abs(swingEnd - swingStart);
  if (!range) return null;
  if (huong === "long") {
    // impulse tăng từ start(đáy) → end(đỉnh), chờ hồi về vùng OTE
    return {
      ote618: swingEnd - range * 0.618,
      ote705: swingEnd - range * 0.705,
      ote786: swingEnd - range * 0.786,
      zone: [swingEnd - range * 0.786, swingEnd - range * 0.618],
    };
  }
  return {
    ote618: swingEnd + range * 0.618,
    ote705: swingEnd + range * 0.705,
    ote786: swingEnd + range * 0.786,
    zone: [swingEnd + range * 0.618, swingEnd + range * 0.786],
  };
}

/* Phân kỳ ẩn RSI kiểu Cardwell (positive/negative reversal) */
function rsiReversal(closes, highs, lows, len = 14) {
  const rsi = rsiSeries(closes, len);
  const n = rsi.length;
  const pivotsOf = (arr, cmpLow) => {
    const out = [];
    for (let i = 3; i < n - 3; i++) {
      if (arr[i] == null) continue;
      let ok = true;
      for (let j = i - 3; j <= i + 3; j++) {
        if (j === i || arr[j] == null) continue;
        if (cmpLow ? arr[j] <= arr[i] : arr[j] >= arr[i]) { ok = false; break; }
      }
      if (ok) out.push(i);
    }
    return out;
  };
  const pl = pivotsOf(rsi, true).filter(i => i >= n - 40);
  const ph = pivotsOf(rsi, false).filter(i => i >= n - 40);
  let tinHieu = null;
  if (pl.length >= 2) {
    const [a, b] = pl.slice(-2);
    if (b >= n - 12 && rsi[b] < rsi[a] && lows[b] > lows[a]) tinHieu = "positive"; // đảo chiều dương → thiên tăng
  }
  if (!tinHieu && ph.length >= 2) {
    const [a, b] = ph.slice(-2);
    if (b >= n - 12 && rsi[b] > rsi[a] && highs[b] < highs[a]) tinHieu = "negative"; // đảo chiều âm → thiên giảm
  }
  const cuoi = rsi[n - 1];
  const zone = cuoi == null ? null : cuoi >= 80 ? "quá mua" : cuoi >= 60 ? "vùng tăng" : cuoi > 40 ? "trung tính" : cuoi > 20 ? "vùng giảm" : "quá bán";
  return { rsi: cuoi, zone, reversal: tinHieu };
}
