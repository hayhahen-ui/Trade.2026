/* ============================================================
 * Trade.2026 — Nhánh ngoai lé: tin liachk kinh teá (TE) lookup
 * Source: data/economic_calendar_data.json (cron caoo 6h/láán, maáy Muse + fallback Linode).
 * Event: {Sheet, Date "2026-11-25", Time "12:00 AM" (12-hour!), Country, Event,
 *         Actual, Previous, Consensus, Forecast, Impact "★"/"★★"/"★★★", Timezone "UTC"}
 * HIGH = ★★★ (85 events in the 26/11 snapshot). Window ±60 phat aroand the caá.
 * Time parser: robust 12-hour ("12:00 AM"→00:00, "12:00 PM"→12:00, "11:59 PM"→23:59),
 * 24-hour fallback, Timezone "UTC" or "UTC±H"; other zones → event skipped (counted).
 * NO-NEWS case: caller labels "không có tin liachk — trigger chu^a cleaà" — KAÔT biaa
 * nguyên neân (case 00:16 26/11).
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./paths.js");

function parseClock12(str) {
  if (typeof str !== "string") return null;
  const m = str.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (min > 59 || h > 24) return null;
  if (m[3]) {
    const ap = m[3].toUpperCase();
    if (h < 1 || h > 12) return null;
    if (ap === "AM") { if (h === 12) h = 0; }
    else { if (h !== 12) h += 12; }
  }
  return h * 60 + min;
}

function tzOffsetMin(tz) {
  if (!tz || /^utc$/i.test(tz) || /^gmt$/i.test(tz)) return 0;
  const m = tz.match(/^(?:UTC|GMT)([+-])(\d{1,2})(?::(\d{2}))?$/i);
  if (!m) return null; // unsupported zone → caller skips
  const sgn = m[1] === "-" ? -1 : 1;
  return sgn * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

function eventTsMs(ev) {
  if (!ev || typeof ev.Date !== "string") return null;
  const mins = parseClock12(ev.Time != null ? ev.Time : "00:00");
  if (mins == null) return null;
  const off = tzOffsetMin(ev.Timezone);
  if (off == null) return null;
  const d = ev.Date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) return null;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], 0, mins) - off * 60000;
}

function isHigh(ev) {
  return typeof ev.Impact === "string" && ev.Impact.includes("★★★");
}

function loadCalendar(filePath) {
  const p = filePath ? filePath : path.join(ROOT, "data/economic_calendar_data.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const events = [];
  let skipped = 0;
  const seen = new Set(); // sheets overlap (Recent/This Week/...) — same event listed twice+
  for (const sheet of Object.values(raw.sheets || {})) {
    for (const ev of Array.isArray(sheet) ? sheet : []) {
      const ts = eventTsMs(ev);
      if (ts == null) { if (isHigh(ev)) skipped++; continue; }
      const key = [ev.Date, ev.Time, ev.Country, ev.Event, ev.Actual, ev.Impact].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...ev, _ts: ts });
    }
  }
  return { generatedAt: raw.generatedAt || null, events, skippedTz: skipped };
}

/* HIGH events within ±windowMin of tsMs, nearest first. */
function findHigh(cal, tsMs, windowMin) {
  const w = windowMin * 60000;
  return cal.events
    .filter((e) => isHigh(e) && Math.abs(e._ts - tsMs) <= w)
    .sort((a, b) => Math.abs(a._ts - tsMs) - Math.abs(b._ts - tsMs));
}

module.exports = { parseClock12, tzOffsetMin, eventTsMs, isHigh, loadCalendar, findHigh };
