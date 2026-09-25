/* ============================================================
 * Trade.2026 — Tiện ích chung (định dạng, DOM, thời gian, lưu trữ)
 * ============================================================ */
"use strict";

/* ---------- Định dạng số ---------- */
function fmtGia(v) {
  if (v == null || !isFinite(v)) return "—";
  const n = Number(v);
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (Math.abs(n) >= 100)  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1)    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}
function fmtPct(v, daux = true) {
  if (v == null || !isFinite(v)) return "—";
  const s = (v > 0 && daux ? "+" : "") + Number(v).toFixed(2) + "%";
  return s;
}
function fmtUsd(v) {
  if (v == null || !isFinite(v)) return "—";
  const n = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (n >= 1e9) return sign + "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return sign + "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return sign + "$" + (n / 1e3).toFixed(1) + "K";
  return sign + "$" + n.toFixed(2);
}
function fmtSo(v, dec = 2) { return v == null || !isFinite(v) ? "—" : Number(v).toFixed(dec); }

/* ---------- Thời gian (giờ VN) ---------- */
function gioVN(d = new Date()) {
  // Lấy giờ theo Asia/Ho_Chi_Minh bất kể máy người dùng ở đâu
  try {
    const s = d.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
    const m = s.match(/(\d{2}):(\d{2}):(\d{2})/);
    return m ? { h: +m[1] % 24, m: +m[2] } : { h: d.getHours(), m: d.getMinutes() };
  } catch { return { h: d.getHours(), m: d.getMinutes() }; }
}
function fmtThoiGian(ts) {
  const d = new Date(ts);
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}
function fmtGio(ts) {
  return new Date(ts).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function trongKhungGio(h, tu, den) { return tu <= den ? (h >= tu && h < den) : (h >= tu || h < den); }

function phienHienTai() {
  const { h } = gioVN();
  return SESSIONS_VN.map(s => ({ ...s, active: trongKhungGio(h, s.tu, s.den) }));
}
function dangKillzone() {
  const hUtc = new Date().getUTCHours();
  const kz = KILLZONES_UTC.find(k => trongKhungGio(hUtc, k.tu, k.den));
  const golden = trongKhungGio(gioVN().h, 19, 22);
  return { active: !!kz || golden, ten: kz ? kz.ten : (golden ? "GIỜ VÀNG (Âu+Mỹ)" : null) };
}

/* ---------- DOM helpers ---------- */
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Toán ---------- */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function lamTron(v) {
  if (v == null || !isFinite(v)) return v;
  if (Math.abs(v) >= 1000) return Math.round(v * 100) / 100;
  if (Math.abs(v) >= 1) return Math.round(v * 10000) / 10000;
  return Math.round(v * 1e8) / 1e8;
}
function trungBinh(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

/* ---------- Lưu trữ ---------- */
function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

/* ---------- Fetch với timeout + fallback nhiều endpoint ---------- */
async function fetchJson(url, { timeoutMs = 10000, ...opts } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
async function fetchText(url, { timeoutMs = 15000, ...opts } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

/* ---------- Trạng thái kết nối toàn cục ---------- */
const ConnState = {
  map: new Map(),
  set(id, status, note = "") {
    this.map.set(id, { status, note, at: Date.now() });
    document.dispatchEvent(new CustomEvent("siro:conn", { detail: { id, status, note } }));
  },
  get(id) { return this.map.get(id) || { status: "off", note: "" }; },
};

/* ---------- Badge màu theo hướng ---------- */
function biasClass(b) {
  if (!b) return "neutral";
  const s = String(b).toLowerCase();
  if (s.includes("long") || s.includes("bull") || s.includes("tăng")) return "long";
  if (s.includes("short") || s.includes("bear") || s.includes("giảm")) return "short";
  return "neutral";
}
function biasLabel(b) {
  const c = biasClass(b);
  return c === "long" ? "TĂNG" : c === "short" ? "GIẢM" : "TRUNG LẬP";
}
