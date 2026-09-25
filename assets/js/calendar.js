/* ============================================================
 * Trade.2026 — Lịch kinh tế (Trading Economics) + Engine phân tích tác động
 *
 * NGUỒN DỮ LIỆU 3 TẦNG (đúng schema economic_agent.py của Mr.Bit):
 *   1. data/economic_calendar_data.json trong repo (cùng origin — không CORS)
 *      → cập nhật bằng: python3 tools/update_calendar.py (hoặc economic_agent.py --refresh)
 *   2. File JSON nạp thủ công (nút 📥 — lưu localStorage, dùng cả khi offline)
 *   3. Proxy CORS parse trực tiếp TE (best-effort, TE hay chặn IP datacenter)
 * Chế độ xem thêm: iframe TE trực tiếp + widget TradingView dự phòng.
 *
 * PHÂN TÍCH: surprise Actual vs Consensus/Forecast → tác động risk-on/off
 * cho crypto, Macro Pulse 48h (−100..+100), đếm ngược tin ★★★,
 * quy tắc mindmap: TRÁNH VÀO LỆNH ±30 phút quanh tin 3 sao.
 * ============================================================ */
"use strict";

const CAL = { payload: null, rows: [], nguon: null, generatedAt: null, loi: null };
const CAL_IMPORT_KEY = "siro_cal_import_v1";

/* ================= CHUẨN HÓA SCHEMA AGENT ================= */
function tzOffsetTuPayload(tz) {
  const m = String(tz || "UTC").match(/UTC\s*([+-]\s*\d+(?:\.\d+)?)?/i);
  return m && m[1] ? parseFloat(m[1].replace(/\s/g, "")) : 0;
}
function parseGio12h(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = +m[1] % 12;
  if (/pm/i.test(m[3])) h += 12;
  return { h, m: +m[2] };
}
function demSao(impact) { return (String(impact || "").match(/★/g) || []).length; }

function normalizeAgentPayload(payload) {
  const offset = tzOffsetTuPayload(payload.timezone);
  const seen = new Map();
  for (const sheetName of Object.keys(payload.sheets || {})) {
    for (const r of payload.sheets[sheetName] || []) {
      const imp = demSao(r.Impact);
      if (imp < 1 || !r.Date) continue;
      const key = [r.Date, r.Time, r.CountryCode, r.Event].join("|");
      const cu = seen.get(key);
      if (cu && (cu.raw.Actual || !r.Actual) && demSao(cu.raw.Impact) >= imp) continue;
      const dm = String(r.Date).match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!dm) continue;
      const g = parseGio12h(r.Time) || { h: 0, m: 0 };
      const ts = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], g.h, g.m) - offset * 3600e3;
      seen.set(key, {
        ts, imp,
        iso: r.CountryCode || "", quocGia: r.Country || "",
        suKien: r.Event || "", actual: r.Actual || "", previous: r.Previous || "",
        consensus: r.Consensus || "", forecast: r.Forecast || "",
        url: r.DetailURL || "", coGio: !!parseGio12h(r.Time),
        raw: r,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.ts - b.ts);
}

/* ================= NẠP DỮ LIỆU 3 TẦNG ================= */
async function taiLichKinhTe(force = false) {
  if (!force && CAL.rows.length && Date.now() - (CAL.taiLuc || 0) < 5 * 60e3) return CAL;
  const ungVien = [];
  // Tầng 0: REAL-TIME qua r.jina.ai (tự động, không cần push repo)
  try {
    const p = await fetchTEQuaJina(force);
    if (p?.sheets) ungVien.push({ payload: p, nguon: "⚡ TE real-time (r.jina.ai — tự động)" });
  } catch (e) { /* rơi xuống tầng dưới */ }
  // Tầng 1: JSON trong repo (cùng origin)
  try {
    const p = await fetchJson(`data/economic_calendar_data.json?_=${Date.now()}`, { timeoutMs: 10000 });
    if (p?.sheets) ungVien.push({ payload: p, nguon: "📦 JSON trong repo (tools/update_calendar.py)" });
  } catch {}
  // Tầng 2: file đã nạp thủ công
  const imported = lsGet(CAL_IMPORT_KEY, null);
  if (imported?.sheets) ungVien.push({ payload: imported, nguon: "📥 File JSON đã nạp thủ công" });
  // Tầng 2b: dữ liệu nhúng sẵn (bản single-file)
  if (typeof globalThis !== "undefined" && globalThis.SIRO_CAL_EMBED?.sheets)
    ungVien.push({ payload: globalThis.SIRO_CAL_EMBED, nguon: "📎 Dữ liệu nhúng trong file" });

  // chọn bản MỚI NHẤT theo generatedAt
  ungVien.sort((a, b) => (Date.parse(b.payload.generatedAt || 0) || 0) - (Date.parse(a.payload.generatedAt || 0) || 0));
  let chon = ungVien[0] || null;

  // Nếu bản chọn là jina (sao ước lượng) mà có bản khác chứa sao THẬT → mượn sao thật cho sự kiện trùng
  if (chon && chon.nguon.includes("jina") && ungVien.length > 1) {
    const saoThat = new Map();
    for (const uv of ungVien.slice(1)) {
      for (const sheet of Object.values(uv.payload.sheets || {})) {
        for (const r of sheet || []) {
          if (r.Date && r.Impact) saoThat.set(`${r.Date}|${r.Time}|${r.CountryCode}|${String(r.Event).toLowerCase().slice(0, 14)}`, r.Impact);
        }
      }
    }
    if (saoThat.size) {
      for (const r of chon.payload.sheets.Recent || []) {
        const th = saoThat.get(`${r.Date}|${r.Time}|${r.CountryCode}|${String(r.Event).toLowerCase().slice(0, 14)}`);
        if (th) r.Impact = th;
      }
    }
  }

  // Tầng 3: proxy CORS (chỉ khi 2 tầng trên trống)
  if (!chon) {
    try {
      const p = await fetchTEQuaProxy();
      chon = { payload: p, nguon: "🌐 Proxy CORS (trực tiếp TE)" };
    } catch (e) { CAL.loi = e.message || String(e); }
  }
  if (chon) {
    CAL.payload = chon.payload;
    CAL.nguon = chon.nguon;
    CAL.generatedAt = Date.parse(chon.payload.generatedAt || "") || null;
    CAL.rows = normalizeAgentPayload(chon.payload);
    CAL.taiLuc = Date.now();
    CAL.loi = null;
  }
  return CAL;
}

function napFileJson(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const p = JSON.parse(reader.result);
      if (!p.sheets) throw new Error("File không đúng schema economic_agent (thiếu 'sheets')");
      lsSet(CAL_IMPORT_KEY, p);
      CAL.taiLuc = 0;
      cb(null, p);
    } catch (e) { cb(e); }
  };
  reader.onerror = () => cb(new Error("Không đọc được file"));
  reader.readAsText(file);
}

/* ============ TẦNG 0 — REAL-TIME qua r.jina.ai (có CORS, tự động) ============
 * r.jina.ai render trang TE và trả text có bảng sự kiện dạng TSV:
 *   "Monday August 03 2026\tActual\tPrevious\tConsensus\tForecast"
 *   "12:30 AM" / "\tID" / "\tS&P Global Manufacturing PMI JUL\t50.2\t46.9\t\t47.4\t"
 * Giờ hiển thị theo UTC (phiên ẩn danh). Mức sao KHÔNG có trong text
 * → ước lượng theo loại chỉ số + quốc gia (đủ tốt cho engine phân tích). */
const CAL_JINA_KEY = "siro_cal_jina_v1";
const CAL_JINA_TTL = 15 * 60e3;

function uocLuongImp(event, iso) {
  const major = ["US", "EA", "EU", "GB", "JP", "CN", "DE"].includes(iso);
  const sieuManh = /interest rate decision|rate decision|fomc|fed funds|non.?farm|nfp|payrolls|cpi|inflation rate yoy|gdp growth rate|ecb|unemployment rate|pce price/i.test(event);
  const manh = /inflation|ppi|gdp|pmi|ism |retail sales|employment|jobless|claims|confidence|sentiment|ifo|zew|core|balance of trade|industrial production|durable goods/i.test(event);
  if (sieuManh && major) return 3;
  if (sieuManh || (manh && major)) return 2;
  return 1;
}

async function fetchTEQuaJina(force = false) {
  const cache = lsGet(CAL_JINA_KEY, null);
  if (!force && cache?.sheets && Date.now() - (Date.parse(cache.generatedAt) || 0) < CAL_JINA_TTL) return cache;
  const text = await fetchText("https://r.jina.ai/" + ENDPOINTS.teCalendar, { timeoutMs: 25000 });
  if (!text || text.length < 3000) throw new Error("jina trả nội dung rỗng");
  const rows = parseJinaTE(text);
  if (rows.length < 15) throw new Error("jina parse được quá ít dòng (" + rows.length + ")");
  const payload = {
    generatedAt: new Date().toISOString(), source: ENDPOINTS.teCalendar + " (via r.jina.ai)",
    timezone: "UTC", impact: "ước lượng theo loại chỉ số", sheets: { Recent: rows },
  };
  lsSet(CAL_JINA_KEY, payload);
  return payload;
}

function parseJinaTE(text) {
  const THANG = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
  const lines = text.split("\n");
  const rows = [];
  let date = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const md = l.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s+(\d{4})/);
    if (md) { date = `${md[3]}-${String(THANG[md[1]]).padStart(2, "0")}-${String(+md[2]).padStart(2, "0")}`; continue; }
    if (!date) continue;
    const mt = l.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))\s*$/i);
    if (!mt) continue;
    // tìm mã quốc gia và dòng sự kiện trong tối đa 5 dòng kế
    let iso = null, ev = null;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const s = lines[j].replace(/^\t+|\t+$/g, "").trim();
      if (!iso) { if (/^[A-Z]{2}$/.test(s)) { iso = s; } continue; }
      if (s && lines[j].includes("\t")) {
        const p = lines[j].replace(/^\t/, "").split("\t");
        if (p[0] && p[0].length > 2) { ev = p; i = j; break; }
      } else if (s && /[A-Za-z]/.test(s)) { ev = [s]; i = j; break; }
    }
    if (!iso || !ev) continue;
    const event = clean_(ev[0]);
    if (!event || event.length < 3) continue;
    const imp = uocLuongImp(event, iso);
    rows.push({
      Sheet: "Recent", Date: date, Time: mt[1].toUpperCase().replace(/\s+/, " "),
      Country: iso, CountryCode: iso, Event: event,
      Actual: clean_(ev[1]), Previous: clean_(ev[2]), Consensus: clean_(ev[3]), Forecast: clean_(ev[4]),
      Impact: "★".repeat(imp), EventKey: event.toLowerCase(), DetailURL: "", Timezone: "UTC",
    });
  }
  return rows;
  function clean_(s) { return String(s ?? "").replace(/\s+/g, " ").trim(); }
}

/* Tầng 3: parse HTML TE qua proxy → payload đúng schema agent */
async function fetchTEQuaProxy() {
  let html = null;
  for (const proxy of ENDPOINTS.corsProxies) {
    try {
      html = await fetchText(proxy(ENDPOINTS.teCalendar), { timeoutMs: 20000 });
      if (html && html.includes("calendar-date-")) break;
      html = null;
    } catch {}
  }
  if (!html) throw new Error("Các proxy CORS đều không truy cập được TE (TE chặn IP datacenter). Hãy chạy tools/update_calendar.py rồi push.");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = [];
  for (const tr of doc.querySelectorAll("tr[data-id]")) {
    const td0 = tr.querySelector("td");
    const date = ((td0?.className || "").match(/\b\d{4}-\d{2}-\d{2}\b/) || [""])[0];
    const span = tr.querySelector("span[class*='calendar-date-']");
    const imp = +((span?.className.match(/calendar-date-(\d)/) || [])[1] || 0);
    if (!imp || !date) continue;
    const g = (sel) => tr.querySelector(sel)?.textContent.trim().replace(/\s+/g, " ") || "";
    rows.push({
      Sheet: "Recent", Date: date, Time: span ? span.textContent.trim() : "",
      Country: tr.getAttribute("data-country") || "",
      CountryCode: g(".calendar-iso").toUpperCase(),
      Event: g("a.calendar-event") || tr.getAttribute("data-event") || "",
      Actual: g("#actual"), Previous: g("#previous"), Consensus: g("#consensus"), Forecast: g("#forecast"),
      Impact: "★".repeat(imp), EventKey: tr.getAttribute("data-event") || "",
      DetailURL: "https://tradingeconomics.com" + (tr.getAttribute("data-url") || ""),
      Timezone: "UTC",
    });
  }
  if (!rows.length) throw new Error("Proxy trả về HTML nhưng không parse được dòng nào (TE đổi cấu trúc?)");
  return {
    generatedAt: new Date().toISOString(), source: ENDPOINTS.teCalendar,
    timezone: "UTC", impact: "1, 2, and 3 stars", sheets: { Recent: rows },
  };
}

/* ================= ENGINE PHÂN TÍCH TÁC ĐỘNG ================= */
function parseNumTE(s) {
  if (s == null) return null;
  let t = String(s).trim().replace(/[,\s]/g, "").replace(/[¥$€£₫]/g, "");
  if (!t || t === "-" || t === "—") return null;
  let mul = 1;
  const suf = t.match(/([KMBT])$/i);
  if (suf) { mul = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[suf[1].toUpperCase()]; t = t.slice(0, -1); }
  if (t.endsWith("%")) t = t.slice(0, -1);
  const v = parseFloat(t);
  return isFinite(v) ? v * mul : null;
}

/* Phân loại chỉ số → hướng tác động crypto khi Actual CAO HƠN dự báo
 * dir = -1: cao hơn → diều hâu/USD mạnh → crypto chịu áp lực (risk-off)
 * dir = +1: cao hơn → risk-on / dovish */
const NHOM_CHI_SO = [
  { re: /interest rate|rate decision|prime rate|deposit facility|refinancing|fed funds|cash rate|repo rate|bank rate|selic|policy rate/i, nhom: "Lãi suất", dir: -1, w: 1.6 },
  { re: /core inflation|inflation|cpi|ppi|pce|deflator|hicp/i, nhom: "Lạm phát", dir: -1, w: 1.5 },
  { re: /non.?farm|payroll|adp employment|employment change|jolts/i, nhom: "Việc làm", dir: -1, w: 1.3 },
  { re: /unemployment|jobless|initial claims|continuing claims/i, nhom: "Thất nghiệp", dir: +1, w: 1.2 },
  { re: /gdp/i, nhom: "GDP", dir: +1, w: 1.2 },
  { re: /pmi|ism |ifo|zew|sentiment|confidence|business climate|retail sales|industrial production|durable goods|factory orders/i, nhom: "Sức khỏe KT", dir: +1, w: 1.0 },
  { re: /balance of trade|current account|trade balance/i, nhom: "Thương mại", dir: 0, w: 0.5 },
];
function phanLoaiSuKien(ten) {
  for (const n of NHOM_CHI_SO) if (n.re.test(ten)) return n;
  return { nhom: "Khác", dir: 0, w: 0.5 };
}
function trongSoQuocGia(iso) {
  return { US: 3, EA: 2, EU: 2, CN: 2, GB: 1.5, JP: 1.5, DE: 1.5 }[iso] || 1;
}
function saoW(imp) { return imp === 3 ? 5 : imp === 2 ? 2.5 : 1; }

/* Đánh giá 1 sự kiện đã công bố */
function danhGiaSuKien(r) {
  const a = parseNumTE(r.actual);
  const ref = parseNumTE(r.consensus) ?? parseNumTE(r.forecast) ?? parseNumTE(r.previous);
  const refNguon = r.consensus ? "đồng thuận" : r.forecast ? "dự báo" : "kỳ trước";
  if (a == null || ref == null) return null;
  const lech = a - ref;
  const phanLoai = phanLoaiSuKien(r.suKien);
  // độ lớn chuẩn hóa 0..1 (tránh chia 0 với ref nhỏ)
  const mag = Math.min(1, Math.abs(lech) / Math.max(Math.abs(ref) * 0.25, 0.1));
  const diem = phanLoai.dir === 0 || lech === 0 ? 0
    : Math.sign(lech) * phanLoai.dir * mag * saoW(r.imp) * trongSoQuocGia(r.iso) * phanLoai.w;
  return {
    lech, refNguon, phanLoai, diem,
    khop: lech === 0,
    nhan: lech === 0 ? "khớp dự báo" : (lech > 0 ? "CAO hơn " : "THẤP hơn ") + refNguon,
    tacDong: diem > 0.4 ? "up" : diem < -0.4 ? "down" : "flat",
  };
}

/* Macro Pulse: tổng hợp 48h qua → −100..+100 */
function tinhMacroPulse(rows, now = Date.now()) {
  const tu = now - 48 * 3600e3;
  let raw = 0;
  const dongGop = [];
  for (const r of rows) {
    if (r.ts < tu || r.ts > now || !r.actual || r.imp < 2) continue;
    const dg = danhGiaSuKien(r);
    if (!dg || dg.diem === 0) continue;
    raw += dg.diem;
    dongGop.push({ r, dg });
  }
  dongGop.sort((x, y) => Math.abs(y.dg.diem) - Math.abs(x.dg.diem));
  const score = clamp(Math.round(100 * Math.tanh(raw / 12)), -100, 100);
  const nhan = score >= 25 ? "🌊 RISK-ON — macro thuận cho crypto"
    : score >= 8 ? "Thiên risk-on nhẹ"
    : score <= -25 ? "⛈️ RISK-OFF — macro bất lợi, ưu tiên phòng thủ"
    : score <= -8 ? "Thiên risk-off nhẹ" : "Trung tính / phân hóa";
  return { score, nhan, dongGop: dongGop.slice(0, 8), soSuKien: dongGop.length };
}

/* Sự kiện sắp tới + quy tắc ±30 phút */
function suKienSapToi(rows, now = Date.now(), gioToiDa = 72) {
  const den = now + gioToiDa * 3600e3;
  const list = rows.filter(r => r.ts >= now - 15 * 60e3 && r.ts <= den && r.imp >= 2 && r.coGio);
  const nextBig = list.find(r => r.imp === 3) || null;
  let vungTin = null;
  for (const r of rows) {
    if (r.imp === 3 && Math.abs(r.ts - now) <= 30 * 60e3) { vungTin = r; break; }
  }
  return { list: list.slice(0, 20), nextBig, vungTin };
}

/* FIX v2.0: lịch có đủ tươi để DÙNG RA QUYẾT ĐỊNH (chặn tin ★★★) không?
 * - generatedAt trong 48h, và
 * - dữ liệu bao phủ hiện tại (sự kiện mới nhất ≥ now - 24h).
 * Lịch cũ → chỉ hiển thị tham khảo, KHÔNG được âm thầm chặn/quyết định giao dịch. */
function lichConTuoi(now = Date.now()) {
  if (!CAL.rows.length || !CAL.generatedAt) return false;
  if (now - CAL.generatedAt > 48 * 3600e3) return false;
  let moiNhat = 0;
  for (const r of CAL.rows) if ((r.ts || 0) > moiNhat) moiNhat = r.ts;
  return moiNhat >= now - 24 * 3600e3;
}
function fmtDemNguoc(ms) {
  if (ms <= 0) return "ĐANG DIỄN RA";
  const h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3);
  return (h ? h + "h " : "") + m + "ph";
}
function fmtNgayVN(ts) {
  return new Date(ts).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit" });
}
function fmtGioVN(ts) {
  return new Date(ts).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
}

/* Kết quả vừa công bố (36h qua) */
function ketQuaGanNhat(rows, now = Date.now()) {
  return rows
    .filter(r => r.actual && r.imp >= 2 && r.ts <= now && r.ts >= now - 36 * 3600e3)
    .map(r => ({ r, dg: danhGiaSuKien(r) }))
    .reverse().slice(0, 14);
}

/* ================= CHẾ ĐỘ XEM PHỤ (giữ nguyên) ================= */
function renderTEIframe(container) {
  container.innerHTML = "";
  container.appendChild(el("div", { class: "muted small", html: "Nhúng trực tiếp <b>tradingeconomics.com/calendar</b> — chỉnh Impact ★★★ và múi giờ UTC+7 ngay trong bảng. Nếu trống, dùng tab <b>Widget dự phòng</b>." }));
  const wrap = el("div", { class: "te-iframe-wrap" });
  wrap.appendChild(el("iframe", { src: ENDPOINTS.teCalendar, class: "te-iframe", referrerpolicy: "no-referrer", loading: "lazy" }));
  container.appendChild(wrap);
}
function renderTVEvents(container) {
  container.innerHTML = "";
  const box = el("div", { class: "tradingview-widget-container", style: "height:640px" });
  box.appendChild(el("div", { class: "tradingview-widget-container__widget", style: "height:100%" }));
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
  s.async = true;
  s.innerHTML = JSON.stringify({ colorTheme: "dark", isTransparent: true, width: "100%", height: 620, locale: "vi_VN", importanceFilter: "0,1", countryFilter: "us,eu,cn,jp,gb,de" });
  box.appendChild(s);
  container.appendChild(el("p", { class: "muted small" }, "Widget lịch kinh tế TradingView — nguồn dự phòng luôn hoạt động."));
  container.appendChild(box);
}
