/* ============================================================
 * Trade.2026 — Nhanh ngoai le: heads-up message format (tier B)
 * Format per brief: "RUNG LAC DONG LOAT — direction, %, coins/total, vol xn,
 * tin: ten su kien hoac 'khong co tin lich'" + gia hien tai 3 coin dau.
 * No-news case is NEVER attributed a cause ("trigger chua ro").
 * ============================================================ */
"use strict";

function vnNum(n, dec) {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(dec == null ? 2 : dec).replace(".", ",");
}

function fmtPrice(px) {
  if (px == null || !isFinite(px)) return "—";
  if (px >= 1000) return Math.round(px).toLocaleString("en-US").replace(/,/g, ".");
  if (px >= 10) return vnNum(px, 2);
  return vnNum(px, 4);
}

function vnClock(tsMs) {
  const d = new Date(tsMs + 7 * 3600 * 1000); // VN = UTC+7
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} VN ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

/* alert: {tsMs, bar, direction, pct, coins:[{coin,chgPct,volX,close}], spikeCount,
 *         syncCount, totalTracked, newsEvents:[...], trigger:"15m"|"1m-fast"} */
function formatHeadsUp(alert) {
  const dirTxt = alert.direction === "UP" ? "TĂNG" : "GIẢM";
  const sign = alert.direction === "UP" ? "+" : "−";
  const lines = [];
  lines.push(`⚠️ RUNG LẮC ĐỒNG LOẬT — heads-up (B), nhánh ngoai lé`);
  const barTxt = alert.trigger === "1m-fast" ? "đđng nhank" : alert.bar;
  lines.push(`${vnClock(alert.tsMs)} | nến ${barTxt} | ${dirTxt} ${sign}${vnNum(Math.abs(alert.pct))}%`);
  for (const c of alert.coins) {
    const s = c.chgPct >= 0 ? "+" : "−";
    lines.push(`• ${c.coin} ${s}${vnNum(Math.abs(c.chgPct))}% vol ×${vnNum(c.volX, 1)} — ${fmtPrice(c.close)}`);
  }
  lines.push(`Sync ${alert.syncCount}/${alert.totalTracked} coin | vol spike ${alert.spikeCount}/${alert.coins.length}`);
  if (alert.newsEvents && alert.newsEvents.length) {
    const e = alert.newsEvents[0];
    const delta = Math.round((e._ts - alert.tsMs) / 60000);
    const when = delta === 0 ? "đđng nhank" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ph`;
    lines.push(`Tin: [★★★] ${e.Event}${e.Actual ? " " + e.Actual : ""}${e.Forecast ? " (fc " + e.Forecast + ")" : ""} — ${when}`);
    if (alert.newsEvents.length > 1) lines.push(`(+${alert.newsEvents.length - 1} tin HIGH caá trong ±60 ph)`);
  } else {
    lines.push(`Tin: không có tin liachk ±60 ph — trigger chu^a cleaà (không gán nguyên neân)`);
  }
  return lines.join("\n");
}

module.exports = { formatHeadsUp, vnNum, fmtPrice, vnClock };
