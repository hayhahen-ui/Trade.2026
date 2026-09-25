/* ============================================================
 * Trade.2026 — Derivatives: phân tích phái sinh cho confluence
 * ------------------------------------------------------------
 * Logic trích từ skills Vibe-Trading (HKUDS) — đã dịch + Việt hóa:
 *   · perp-funding-basis    → funding regime, ma trận OI×funding
 *   · liquidation-heatmap   → áp lực thanh lý long/short
 *   · volatility            → HV percentile (crypto annualize ×365)
 *   · stablecoin-flow       → composite dòng tiền stablecoin
 * Nguồn: funding/OI từ DataHub (Binance Futures), thanh lý từ FlowDB,
 *        stablecoin từ DeFiLlama. Không bịa dữ liệu — thiếu thì degraded.
 * ============================================================ */
"use strict";

/* ---------- Funding rate: pure ---------- */

/** Annualized funding từ rate 8h (%): rate × 3 × 365 */
function annualizedFunding(rate8hPct) {
  const r = Number(rate8hPct);
  if (!isFinite(r)) return null;
  return r * 3 * 365;
}

/**
 * Phân loại funding regime theo bảng skill perp-funding-basis.
 * rate8hPct: funding 8h theo % (vd 0.01 = 0.01%).
 * Trả về { id, nhan, muc: -2..2, canhBao, contrarian: "long"|"short"|null }
 */
function fundingRegime(rate8hPct) {
  const r = Number(rate8hPct);
  if (!isFinite(r)) return { id: "unknown", nhan: "Không có dữ liệu funding", muc: 0, canhBao: null, contrarian: null, annualized: null };
  const ann = annualizedFunding(r);
  if (r > 0.05) return { id: "overheated_long", nhan: "🔥 LONG quá nóng", muc: 2,
    canhBao: `Funding ${r.toFixed(4)}%/8h (≈${ann.toFixed(0)}%/năm) — đám đông LONG chen chúc, dễ bị long squeeze. Không FOMO long, cân nhắc chốt bớt.`,
    contrarian: "short", annualized: ann };
  if (r >= 0.02) return { id: "bullish_carry", nhan: "📈 Funding dương cao", muc: 1,
    canhBao: `Funding ${r.toFixed(4)}%/8h (≈${ann.toFixed(0)}%/năm) — phe long trả phí cao, long mới kém hiệu quả.`,
    contrarian: null, annualized: ann };
  if (r >= 0.005) return { id: "mild_long", nhan: "Funding dương nhẹ", muc: 0, canhBao: null, contrarian: null, annualized: ann };
  if (r > -0.005) return { id: "balanced", nhan: "Funding cân bằng", muc: 0, canhBao: null, contrarian: null, annualized: ann };
  if (r > -0.02) return { id: "mild_short", nhan: "Funding âm nhẹ", muc: 0, canhBao: null, contrarian: null, annualized: ann };
  return { id: "overheated_short", nhan: "🧊 SHORT quá nóng", muc: -2,
    canhBao: `Funding ${r.toFixed(4)}%/8h (≈${ann.toFixed(0)}%/năm) — đám đông SHORT chen chúc, vùng short squeeze. Không FOMO short.`,
    contrarian: "long", annualized: ann };
}

/**
 * Ma trận OI × Funding (skill perp-funding-basis):
 * OI tăng + funding cực dương → đòn bẩy long dồn → nguy cơ long squeeze.
 */
function oiFundingSignal(oiChangePct, rate8hPct) {
  const oc = Number(oiChangePct), r = Number(rate8hPct);
  if (!isFinite(oc) || !isFinite(r)) return { id: "unknown", nhan: "—", canhBao: null, muc: 0 };
  if (oc > 5 && r > 0.03) return { id: "leveraged_long_buildup", nhan: "⚠ Đòn bẩy LONG dồn", muc: -2,
    canhBao: `OI +${oc.toFixed(1)}% mà funding ${r.toFixed(4)}%/8h — long đòn bẩy mới vào dày, dễ bị quét long (long squeeze).` };
  if (oc > 5 && r < -0.03) return { id: "leveraged_short_buildup", nhan: "⚠ Đòn bẩy SHORT dồn", muc: 2,
    canhBao: `OI +${oc.toFixed(1)}% mà funding ${r.toFixed(4)}%/8h — short đòn bẩy mới vào dày, dễ bị quét short (short squeeze).` };
  if (oc < -5 && Math.abs(r) > 0.03) return { id: "unwinding", nhan: "Đang xả đòn bẩy", muc: 0,
    canhBao: `OI ${oc.toFixed(1)}% — vị thế đòn bẩy đang bị ép đóng, biến động mạnh nhưng funding sẽ hạ nhiệt.` };
  return { id: "neutral", nhan: "OI/Funding bình thường", muc: 0, canhBao: null };
}

/* ---------- Áp lực thanh lý: pure ---------- */

/**
 * Đánh giá áp lực thanh lý 24h (skill liquidation-heatmap).
 * longUsd/shortUsd: tổng USD bị thanh lý. totalUsd: tổng.
 */
function danhGiaLiq(longUsd, shortUsd) {
  const L = Number(longUsd) || 0, S = Number(shortUsd) || 0, T = L + S;
  if (T <= 0) return { id: "none", nhan: "Chưa có thanh lý đáng kể", muc: 0, canhBao: null, ratio: null, total: 0 };
  const ratio = S > 0 ? L / S : (L > 0 ? 99 : null);
  let id = "balanced", nhan = "Thanh lý cân bằng", muc = 0, canhBao = null;
  if (ratio != null && ratio > 2) { id = "long_squeeze"; nhan = "🔥 Long bị ép mạnh"; muc = -1;
    canhBao = `Thanh lý LONG gấp ${ratio.toFixed(1)}× short (${fmtUsdSafe(T)} trong 24h) — phe long vừa bị quét, giá có thể hồi kỹ thuật nhưng trend yếu.`; }
  else if (ratio != null && ratio < 0.5) { id = "short_squeeze"; nhan = "🧊 Short bị ép mạnh"; muc = 1;
    canhBao = `Thanh lý SHORT gấp ${(1 / ratio).toFixed(1)}× long (${fmtUsdSafe(T)} trong 24h) — phe short vừa bị quét, cẩn trọng đu theo đà tăng nóng.`; }
  if (T > 500e6) { canhBao = (canhBao ? canhBao + " " : "") + `Tổng thanh lý 24h ${fmtUsdSafe(T)} — mức EXTREME, thị trường đang thanh lọc đòn bẩy.`; }
  return { id, nhan, muc, canhBao, ratio, total: T };
}

function fmtUsdSafe(v) {
  try { return fmtUsd(v); } catch (e) {
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    return "$" + Math.round(v);
  }
}

/* ---------- Stablecoin pulse: pure + fetch ---------- */

/**
 * Composite stablecoin −10..+10 (skill stablecoin-flow, rút gọn cho static site):
 * supplyChange30dPct: % thay đổi tổng cung stablecoin 30 ngày.
 */
function diemStablecoin(supplyChange30dPct) {
  const c = Number(supplyChange30dPct);
  if (!isFinite(c)) return { diem: 0, nhan: "Không có dữ liệu stablecoin", muc: 0 };
  if (c > 5)  return { diem: 8,  nhan: "💵 Stablecoin mint mạnh", muc: 2, ghiChu: `Cung stablecoin +${c.toFixed(1)}%/30d — tiền mới ùn ùn vào crypto, mạnh bullish.` };
  if (c >= 2) return { diem: 4,  nhan: "💵 Dòng tiền vào ổn định", muc: 1, ghiChu: `Cung stablecoin +${c.toFixed(1)}%/30d — dòng tiền vào đều, bullish.` };
  if (c > 0)  return { diem: 0,  nhan: "Stablecoin đi ngang", muc: 0, ghiChu: `Cung stablecoin +${c.toFixed(1)}%/30d — không có tiền mới đáng kể.` };
  if (c > -2) return { diem: -2, nhan: "Stablecoin rút nhẹ", muc: 0, ghiChu: `Cung stablecoin ${c.toFixed(1)}%/30d — rút nhẹ, thận trọng.` };
  return { diem: -6, nhan: "💵 Tiền rút khỏi crypto", muc: -1, ghiChu: `Cung stablecoin ${c.toFixed(1)}%/30d — tiền rút ra, bearish.` };
}

const STABLECOIN_STATE = { at: 0, data: null };
async function taiStablecoinPulse() {
  const TTL = 3600e3;
  if (STABLECOIN_STATE.data && Date.now() - STABLECOIN_STATE.at < TTL) return STABLECOIN_STATE.data;
  let out = { ok: false, lyDo: "chưa tải", at: Date.now() };
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    // Tổng cung hiện tại theo từng stablecoin
    const j = await (await fetch("https://stablecoins.llama.fi/stablecoins?includeOrder=false", { signal: ctrl.signal })).json();
    clearTimeout(to);
    const list = j?.peggedAssets || j?.data || [];
    let tong = 0;
    for (const s of list) {
      const c = s?.circulating?.peggedUSD ?? s?.circulating ?? 0;
      if (isFinite(+c)) tong += +c;
    }
    if (tong > 0) {
      // % thay đổi 30d: so với cache hôm trước (lưu localStorage), thiếu thì chỉ báo tổng
      let doi30d = null;
      try {
        const key = "trade2026_stablecoin_hist";
        const hist = JSON.parse(localStorage.getItem(key) || "[]");
        const cutoff = Date.now() - 30 * 86400e3;
        const cu = hist.find(h => h.at >= cutoff);
        hist.push({ at: Date.now(), tong });
        localStorage.setItem(key, JSON.stringify(hist.filter(h => h.at > Date.now() - 45 * 86400e3).slice(-60)));
        if (cu && cu.tong > 0) doi30d = (tong - cu.tong) / cu.tong * 100;
      } catch (e) {}
      const dg = diemStablecoin(doi30d);
      out = { ok: true, tong, doi30d, ...dg, at: Date.now() };
    } else out = { ok: false, lyDo: "parse lỗi", at: Date.now() };
  } catch (e) { out = { ok: false, lyDo: "mạng/CORS", at: Date.now() }; }
  STABLECOIN_STATE.data = out; STABLECOIN_STATE.at = Date.now();
  return out;
}

/* ---------- Volatility: HV percentile (pure) ---------- */

/**
 * HV percentile (skill volatility): HV = stdev(log return, hvWindow) × √365.
 * percentile = thứ hạng HV hiện tại trong lookback nến gần nhất.
 */
function hvPercentile(dongCua, hvWindow = 30, lookback = 250) {
  const cs = (dongCua || []).map(Number).filter(isFinite);
  if (cs.length < hvWindow + 2) return { hv: null, pct: null, regime: "unknown", nhan: "Thiếu nến" };
  const rets = [];
  for (let i = 1; i < cs.length; i++) rets.push(Math.log(cs[i] / cs[i - 1]));
  const hvTai = (arr) => {
    const w = arr.slice(-hvWindow);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1 || 1));
    return sd * Math.sqrt(365) * 100;
  };
  const hvHienTai = hvTai(rets);
  const mau = [];
  for (let i = hvWindow + 1; i <= rets.length; i++) mau.push(hvTai(rets.slice(0, i)));
  const duoi = mau.filter(v => v <= hvHienTai).length;
  const pct = mau.length ? duoi / mau.length * 100 : 50;
  let regime = "mid", nhan = "Vol trung bình";
  if (pct < 20) { regime = "low_vol"; nhan = "🗜️ Vol đang NÉN"; }
  else if (pct > 80) { regime = "high_vol"; nhan = "🌪️ Vol đang CAO"; }
  return { hv: +hvHienTai.toFixed(1), pct: Math.round(pct), regime, nhan };
}

/* ---------- OI history (ring buffer RAM) ---------- */
const OI_LUU = {}; // coin -> [{ts, oi}]
let _oiTimer = null;
function ghiNhanOI() {
  try {
    const ois = window.DataHub?.oi?.() || {};
    const now = Date.now();
    for (const [coin, o] of Object.entries(ois)) {
      const v = Number(o?.oi);
      if (!isFinite(v) || v <= 0) continue;
      const arr = OI_LUU[coin] || (OI_LUU[coin] = []);
      arr.push({ ts: now, oi: v });
      while (arr.length && now - arr[0].ts > 26 * 3600e3) arr.shift();
      if (arr.length > 1600) arr.splice(0, arr.length - 1600);
    }
  } catch (e) {}
}
function oiThayDoi(coin, gio) {
  const arr = OI_LUU[coin] || [];
  if (arr.length < 2) return null;
  const now = Date.now(), moc = now - gio * 3600e3;
  const hienTai = arr[arr.length - 1].oi;
  let cu = null;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].ts <= moc) { cu = arr[i].oi; break; }
  if (!cu) cu = arr[0].oi;
  if (!cu) return null;
  return (hienTai - cu) / cu * 100;
}

/* ---------- Tổng hợp phái sinh cho 1 coin (async, cache dữ liệu 60s) ---------- */
const DERIV_CACHE = new Map();
/* Dữ liệu thô (không phụ thuộc side) — cache theo coin */
async function duLieuPhaiSinh(coin, opts = {}) {
  coin = String(coin || "").toUpperCase();
  const cached = DERIV_CACHE.get(coin);
  if (cached && Date.now() - cached.at < 60e3) return { data: cached.data, fromCache: true };

  const canhBao = [];
  let funding = fundingRegime(NaN), oi = { thayDoi1h: null, thayDoi24h: null, tinHieu: oiFundingSignal(NaN, NaN) }, liq = null, hv = null;

  // 1. Funding + OI từ DataHub
  try {
    const fundMap = window.DataHub?.funding?.() || {};
    const oiMap = window.DataHub?.oi?.() || {};
    const f = fundMap[coin];
    if (f && isFinite(+f.rate)) {
      funding = fundingRegime(+f.rate);
      if (funding.canhBao) canhBao.push(funding.canhBao);
    }
    const o = oiMap[coin];
    if (o && isFinite(+o.oi)) {
      const d1 = oiThayDoi(coin, 1), d24 = oiThayDoi(coin, 24);
      oi = { hienTai: +o.oi, thayDoi1h: d1, thayDoi24h: d24,
             tinHieu: oiFundingSignal(d24, isFinite(+f?.rate) ? +f.rate : NaN) };
      if (oi.tinHieu.canhBao) canhBao.push(oi.tinHieu.canhBao);
    }
  } catch (e) {}

  // 2. Áp lực thanh lý 24h từ FlowDB
  try {
    if (window.FlowDB?.recentLiqs) {
      const ls = await window.FlowDB.recentLiqs({ coin, since: Date.now() - 24 * 3600e3, limit: 2000 });
      let L = 0, S = 0;
      for (const x of ls || []) { if (x.huong === "SHORT") S += +x.usd || 0; else L += +x.usd || 0; }
      liq = danhGiaLiq(L, S);
      if (liq.canhBao) canhBao.push(liq.canhBao);
    }
  } catch (e) {}

  // 3. HV percentile từ nến 1h (engine truyền vào)
  if (opts.dongCua1h?.length) {
    hv = hvPercentile(opts.dongCua1h);
    if (hv.regime === "high_vol") canhBao.push(`🌪️ Volatilty đang CAO (HV ${hv.hv}%/năm, percentile ${hv.pct}) — nên giảm size, chờ vol co lại.`);
    else if (hv.regime === "low_vol") canhBao.push(`🗜️ Volatility đang NÉN (percentile ${hv.pct}) — thị trường tích lũy, chuẩn bị cho cú bung mạnh.`);
  }

  const data = { coin, at: Date.now(), funding, oi, liq, hv, canhBao,
    tomTat: `${funding.nhan}${oi.thayDoi24h != null ? ` · OI 24h ${oi.thayDoi24h >= 0 ? "+" : ""}${oi.thayDoi24h.toFixed(1)}%` : ""}${liq?.total ? ` · TL 24h ${fmtUsdSafe(liq.total)}` : ""}` };
  DERIV_CACHE.set(coin, { at: Date.now(), data });
  return { data, fromCache: false };
}

/* Phân tích đầy đủ cho engine: dữ liệu cache + điều chỉnh theo side của lệnh */
async function phanTichPhaiSinh(coin, opts = {}) {
  const { data, fromCache } = await duLieuPhaiSinh(coin, opts);
  const side = opts.side || null;
  let dieuChinh = 0;
  if (side) {
    const funding = data.funding, oiT = data.oi.tinHieu;
    // funding contrarian: đám đông ngược hướng lệnh = thuận lợi (squeeze ủng hộ)
    if (funding.contrarian === side) dieuChinh += 4;
    else if (funding.contrarian && funding.contrarian !== side) dieuChinh -= 4;
    // OI dồn đòn bẩy ngược hướng lệnh = nguy hiểm
    if (oiT.id === "leveraged_long_buildup" && side === "long") dieuChinh -= 3;
    if (oiT.id === "leveraged_short_buildup" && side === "short") dieuChinh -= 3;
    if (oiT.id === "leveraged_long_buildup" && side === "short") dieuChinh += 2;
    if (oiT.id === "leveraged_short_buildup" && side === "long") dieuChinh += 2;
  }
  dieuChinh = Math.max(-8, Math.min(8, dieuChinh));
  return { ...data, dieuChinh, fromCache };
}

/* Cảnh báo phái sinh toàn watchlist cho strip Tổng quan (không spam: mỗi coin 1 dòng) */
async function canhBaoPhaiSinhToanCanh(watchlist) {
  const out = [];
  for (const coin of (watchlist || []).slice(0, 8)) {
    try {
      const d = await phanTichPhaiSinh(coin);
      if (d.funding.id === "overheated_long" || d.funding.id === "overheated_short")
        out.push({ coin, loai: "funding", text: `${coin}: ${d.funding.nhan} (${(+d.funding.annualized || 0).toFixed(0)}%/năm)` });
      if (d.oi.tinHieu.id === "leveraged_long_buildup" || d.oi.tinHieu.id === "leveraged_short_buildup")
        out.push({ coin, loai: "oi", text: `${coin}: ${d.oi.tinHieu.nhan}` });
      if (d.liq && (d.liq.id === "long_squeeze" || d.liq.id === "short_squeeze") && d.liq.total > 50e6)
        out.push({ coin, loai: "liq", text: `${coin}: ${d.liq.nhan} (${fmtUsdSafe(d.liq.total)}/24h)` });
    } catch (e) {}
  }
  return out;
}

function khoiDongDerivatives() {
  if (_oiTimer) return;
  ghiNhanOI();
  _oiTimer = setInterval(ghiNhanOI, 60e3);
}
