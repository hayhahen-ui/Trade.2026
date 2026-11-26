/* ============================================================
 * Trade.2026 — Nhánh ngoai lé: Cáng phaán (gate) — PURE, no I/O
 * Case fixtuare: rạng 25/11→26/11/2026 (nến 15m OKX, đoi chiéu baá user na):
 *   20:30 VN BTC −0,96% ×3,9 | ETH −1,09% ×7,0 | SOL −1,35% ×6,1
 *   21:30 VN BTC −1,37% ×5,3 | ETH −1,44% ×9,1 | SOL −1,48% ×7,0  (caá 3 cu`ng chiavo)
 *   21:45 VN dao chia^ V: BTC +1,49% | ETH +2,19% | SOL +2,24%
 *   00:00 VN BTC +1,09% ×3,3 | ETH +0,90% | SOL +1,08%
 * Calibration 26/11/2026: OKX open→close % reproduces user's 12/12 figures (±0,01pp);
 * volume ratio = nến volume / median of prior 20 candles (rule as stated by user).
 * Giai: (2) caá ≥minCoins coin cu`ng chiavo |chg|≥chgPct trong CÁ nến 15m
 *       (3) volume nến ≥ volSpikeX × trung viy 20 nến qua (confirm/strength)
 *       (1) tin HIGH ±60 phat = context attached (HOẛC "không có tin liachk")
 *       (4) thanh lyaaq $20M/15p — CHA ĐO (not measurable from repo data) — log-only
 *       (5) bias 4H — context log only, KAÔT caáng chaan
 * Caáng laá: cooldowon per-direction (dao chia^ V always passes — different key).
 * ============================================================ */
"use strict";

function median(xs) {
  if (!xs || xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* candles: ascending [{ts(sec), open, high, low, close, vol}] — last = candle judged.
 * chgPct = open→close (calibrated choice, see header). volX = vol / median(prior N). */
function candleMetrics(candles, opts) {
  const win = opts.volMedianWindow || 20;
  if (!Array.isArray(candles) || candles.length < win + 1) return null;
  const cur = candles[candles.length - 1];
  const prior = candles.slice(candles.length - 1 - win, candles.length - 1);
  const med = median(prior.map((c) => c.vol));
  return {
    ts: cur.ts,
    chgPct: (cur.close / cur.open - 1) * 100,
    volX: med > 0 ? cur.vol / med : 0,
    low: cur.low,
    high: cur.high,
    close: cur.close,
  };
}

/* seriesByCoin: { BTC:[...], ETH:[...], SOL:[...] } — same bar, ascending.
 * cfg: {minCoins, chgPct, volSpikeX, volMedianWindow, requireVolSpike, minSpikeCoins}
 * Returns {fire, reason, direction, pct, coins, spikeCount, strong, rows} */
function evaluateSync(seriesByCoin, cfg) {
  const minCoins = cfg.minCoins || 3;
  const rows = [];
  let lastTs = null;
  for (const [coin, candles] of Object.entries(seriesByCoin)) {
    const m = candleMetrics(candles, cfg);
    if (!m) continue; // insufficient history for this coin
    if (lastTs === null) lastTs = m.ts;
    rows.push({ coin, ...m });
  }
  if (rows.length < minCoins) {
    return { fire: false, reason: "insufficient-history", rows, aligned: true };
  }
  // all judged candles must be the same candle (aligned bars)
  if (rows.some((r) => r.ts !== lastTs)) {
    return { fire: false, reason: "misaligned-bars", rows, aligned: false };
  }
  const ups = rows.filter((r) => r.chgPct >= cfg.chgPct);
  const downs = rows.filter((r) => r.chgPct <= -cfg.chgPct);
  let dir = 0;
  let sync = [];
  if (ups.length >= minCoins || downs.length >= minCoins) {
    if (ups.length > downs.length) { dir = 1; sync = ups; }
    else if (downs.length > ups.length) { dir = -1; sync = downs; }
    else { // tie → stronger total move wins
      const upSum = ups.reduce((a, r) => a + Math.abs(r.chgPct), 0);
      const dnSum = downs.reduce((a, r) => a + Math.abs(r.chgPct), 0);
      dir = upSum >= dnSum ? 1 : -1;
      sync = dir === 1 ? ups : downs;
    }
  }
  if (!dir) return { fire: false, reason: "no-sync", rows, aligned: true };
  const spike = sync.filter((r) => r.volX >= cfg.volSpikeX);
  const strong = spike.length >= (cfg.minSpikeCoins || 1);
  const fire = cfg.requireVolSpike ? strong : true;
  return {
    fire,
    reason: fire ? "sync" : "sync-without-vol-spike",
    direction: dir === 1 ? "UP" : "DOWN",
    pct: sync.reduce((a, r) => a + r.chgPct, 0) / sync.length,
    coins: sync,
    spikeCount: spike.length,
    strong,
    rows,
    aligned: true,
  };
}

/* Cooldown per-direction: same-direction repeats inside cooldownMin are blocked;
 * the opposite direction (dao chia^ V) has its own key → always allowed. */
function cooldownAllows(lastFireByDir, direction, tsMs, cooldownMin) {
  const last = lastFireByDir ? lastFireByDir[direction] : null;
  if (last == null) return true;
  return tsMs - last >= cooldownMin * 60000;
}

module.exports = { median, candleMetrics, evaluateSync, cooldownAllows };
