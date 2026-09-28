/* ============================================================
 * Trade.2026 — Tích lũy kiến thức thực chiến & Tự học
 * Sau mỗi lệnh đóng (lãi/lỗ) → phân tích lịch sử → tự rút bài học,
 * sinh QUY TẮC áp dụng ngược lại cho Cố vấn lệnh & Engine tín hiệu
 * (vòng lặp cải tiến: giao dịch sau tốt hơn giao dịch trước).
 *
 * Cắt lát theo: theo/ngược tín hiệu · killzone · đòn bẩy · phiên ·
 * điểm hợp lưu · coin · hướng. So sánh win-rate từng lát với tổng thể.
 * ============================================================ */
"use strict";

const LEARN_KEY = "siro_learn_v1";
let LEARN = lsGet(LEARN_KEY, { rules: [], lessons: [], stats: null, updatedAt: 0 });

function luuLearn() { lsSet(LEARN_KEY, LEARN); }

/* ============================================================
 * HỌC TỪ TÍN HIỆU HỆ THỐNG (v2.3.0) — mapping toàn bộ tín hiệu
 * đã chấm điểm từ 📝 Sổ tín hiệu (local) + 🛰️ Trạm 24/7 vào
 * Nhật ký & Tự học, sinh quy tắc Kaizen áp ngược vào Cố vấn.
 * Mỗi tín hiệu ngã ngũ (thang/thua/het_han) = 1 "lệnh" để học.
 * ============================================================ */
const TRAM_JOURNAL_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/journal-247.json";
let TIN_HIEU_TRAM = null;      // tinHieu[] của trạm (cache)
let _tramBaiHoc = [];          // bài học Kaizen do trạm tự rút
let _tramCapNhat = 0;
let _tramTimer = 0;
let SIG = { stats: null, lessons: [], rules: [] }; // kết quả học từ tín hiệu (phiên hiện tại)

/* 1 record journal (local hoặc trạm) → 1 mục lịch sử học. Thuần — test được. */
function tinHieuSangMuc(r, nguon) {
  if (!r) return null;
  const tt = r.trangThai;
  if (tt !== "thang" && tt !== "thua" && tt !== "het_han") return null; // đang theo dõi → chưa học được
  const kq = r.ketQua || {};
  let R = (typeof kq.r === "number" && isFinite(kq.r)) ? kq.r
        : (typeof r.r === "number" && isFinite(r.r)) ? r.r : null;
  if (R == null) { const rr = +r.rr || 0; R = tt === "thang" ? rr : tt === "thua" ? -1 : 0; }
  const coin = String(r.coin || "").toUpperCase();
  const sideU = String(r.side || "").toUpperCase();   // LONG/SHORT (lát cắt)
  const sideL = String(r.side || "").toLowerCase();   // long/short (khớp ctx advisor)
  return {
    coin, side: sideU, pnl: R, rQuy: R, ts: +r.tsVao || Date.now(), nguon,
    trangThai: tt, // thang | thua | het_han — het_han không tính WR
    ctx: {
      theoTinHieu: true, nguon, coin, side: sideL,
      score: (typeof r.diem === "number" && isFinite(r.diem)) ? r.diem : null,
      phien: r.phien || null, bias4h: r.bias4h || null,
    },
  };
}

/* Gom toàn bộ tín hiệu đã chấm điểm: local JOURNAL + trạm 24/7. */
function layLichSuTinHieu() {
  const ds = [];
  try {
    if (typeof JOURNAL !== "undefined" && JOURNAL && typeof JOURNAL.all === "function") {
      for (const r of JOURNAL.all()) {
        const m = tinHieuSangMuc(r, "local");
        if (m) ds.push(m);
      }
    }
  } catch (e) {}
  const thay = new Set();
  for (const r of (TIN_HIEU_TRAM || [])) {
    if (!r || (r.id != null && thay.has(r.id))) continue;
    if (r.id != null) thay.add(r.id);
    const m = tinHieuSangMuc(r, "tram_247");
    if (m) ds.push(m);
  }
  return ds.sort((a, b) => a.ts - b.ts);
}

/* Tải tín hiệu trạm (cache 5 phút). fetchFn để test chích được. */
async function napTinHieuTram(fetchFn) {
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return false;
  if (TIN_HIEU_TRAM && Date.now() - _tramTimer < 5 * 60e3) return false;
  try {
    const resp = await f(TRAM_JOURNAL_URL + "?t=" + Date.now());
    if (!resp.ok) return false;
    const d = await resp.json();
    const th = Array.isArray(d && d.tinHieu) ? d.tinHieu : [];
    TIN_HIEU_TRAM = th;
    _tramBaiHoc = Array.isArray(d && d.baiHoc) ? d.baiHoc : [];
    _tramCapNhat = (d && d.capNhat) || 0;
    _tramTimer = Date.now();
    return th.length > 0;
  } catch (e) { return false; }
}

/* Học từ lịch sử tín hiệu: cắt lát Hướng/Coin/Điểm/Phiên/Nguồn.
 * Thuần (nhận mảng, trả kết quả) — test được. */
function hocTuTinHieu(ds) {
  // het_han là outcome riêng — không tính vào win-rate
  const ket = (ds || []).filter((h) => h.trangThai === "thang" || h.trangThai === "thua");
  const hetHan = (ds || []).length - ket.length;
  const n = ket.length;
  const thang = ket.filter((h) => h.pnl > 0).length;
  const stats = {
    n: (ds || []).length, ket: n, hetHan, thang,
    winRate: n ? Math.round(thang / n * 100) : 0,
    avgR: n ? +(ket.reduce((a, h) => a + h.rQuy, 0) / n).toFixed(2) : 0,
    tram: (ds || []).filter((h) => h.nguon === "tram_247").length,
    local: (ds || []).filter((h) => h.nguon === "local").length,
    tienBo: null,
  };
  if (n >= 6) {
    const half = Math.floor(n / 2);
    const wr = (arr) => Math.round(arr.filter((h) => h.pnl > 0).length / arr.length * 100);
    stats.tienBo = { dau: wr(ket.slice(0, half)), sau: wr(ket.slice(half)), n1: half, n2: n - half };
  }
  const lessons = [], rules = [];
  const them = (dim, nhan, s, base, khuyenNghi, rule) => {
    if (!s || s.n < 3) return;
    const wr = _wr(s), diff = wr - base;
    if (Math.abs(diff) < 15 && Math.abs(s.sumR) < 3) return;
    const tot = diff >= 0;
    lessons.push({
      dim: dim + " · tín hiệu", nhan, winRate: wr, n: s.n,
      avgR: +(s.sumR / s.n).toFixed(2), diff, tot, khuyenNghi, nguon: "tin_hieu",
    });
    if (rule) {
      const cu = (typeof LEARN !== "undefined" && LEARN.rules || []).find((x) => x.kieu === rule.kieu);
      rules.push({
        ...rule, nhan, winRate: wr, n: s.n, nguon: "tin_hieu",
        delta: tot ? Math.min(8, Math.round(Math.abs(diff) / 4)) : -Math.min(15, Math.round(Math.abs(diff) / 3)),
        khuyenNghi, active: cu ? cu.active : true,
      });
    }
  };
  if (n >= 3) {
    const base = stats.winRate;
    // Hướng — quy tắc áp ngược vào Cố vấn (khớp ctx.side)
    const mSide = _slice(ket, (h) => h.side);
    for (const [k, s] of mSide) {
      const xau = _wr(s) < base;
      them("Hướng", `Tín hiệu ${k} của hệ thống`, s, base,
        xau ? `Tín hiệu ${k} đang thua nhiều (WR ${_wr(s)}%) — Cố vấn tự trừ điểm mỗi khi gặp setup ${k}.`
             : `Tín hiệu ${k} đang hiệu quả (WR ${_wr(s)}%) — giữ nguyên.`,
        { kieu: "tin_hieu_huong_" + k.toLowerCase(), side: k.toLowerCase() });
    }
    // Coin (n≥4) — quy tắc áp ngược theo coin Cố vấn đang phân tích
    const mCoin = _slice(ket, (h) => h.coin);
    for (const [k, s] of mCoin) {
      if (s.n < 4) continue;
      const xau = _wr(s) < base;
      them("Coin", `Tín hiệu ${k}`, s, base,
        xau ? `${k} đang cho tín hiệu kém (WR ${_wr(s)}%) — Cố vấn tự trừ điểm khi phân tích ${k}.`
            : `${k} đang cho tín hiệu tốt (WR ${_wr(s)}%) — ưu tiên.`,
        { kieu: "tin_hieu_coin_" + k, coin: k });
    }
    // Nhóm điểm — điểm thấp mà thua → quy tắc trừ điểm trực tiếp
    const mScore = _slice(ket, (h) => h.ctx.score == null ? null : h.ctx.score >= 70 ? "≥70" : h.ctx.score >= 50 ? "50–69" : "<50");
    if (mScore.get("<50")) {
      const s = mScore.get("<50");
      them("Điểm hợp lưu", "Tín hiệu điểm thấp (<50)", s, base,
        `Tín hiệu dưới 50 điểm thắng chỉ ${_wr(s)}% — Cố vấn tự trừ điểm setup <50.`,
        { kieu: "tin_hieu_diem_thap" });
    }
    if (mScore.get("≥70")) {
      const s = mScore.get("≥70");
      them("Điểm hợp lưu", "Tín hiệu điểm cao (≥70)", s, base,
        `Tín hiệu ≥70 điểm thắng ${_wr(s)}% — ${_wr(s) >= base ? "tiếp tục chờ điểm cao." : "điểm cao vẫn thua — xem lại trọng số hợp lưu."}`,
        null);
    }
    // Phiên — chỉ bài học (không áp rule vì ctx Cố vấn không có tên phiên)
    const mPhien = _slice(ket, (h) => h.ctx.phien && h.ctx.phien !== "—" ? h.ctx.phien : null);
    for (const [k, s] of mPhien)
      them("Phiên", `Tín hiệu trong phiên ${k}`, s, base,
        `Phiên ${k}: WR ${_wr(s)}% qua ${s.n} tín hiệu — ${_wr(s) < base ? "cân nhắc né." : "ưu tiên."}`, null);
    // Nguồn — so sánh trạm vs local
    const mNguon = _slice(ket, (h) => h.nguon === "tram_247" ? "Trạm 24/7" : "Local");
    if (mNguon.size >= 2) {
      const arr = [...mNguon.entries()].sort((a, b) => _wr(a[1]) - _wr(b[1]));
      const [kW, sW] = arr[0], [kB, sB] = arr[arr.length - 1];
      them("Nguồn", `Tín hiệu từ ${kW} vs ${kB}`, sW, _wr(sB),
        `${kW} (WR ${_wr(sW)}%) đang kém hơn ${kB} (WR ${_wr(sB)}%) — kiểm tra lại pipeline thu tín hiệu bên kém.`, null);
    }
  }
  return { stats, lessons: lessons.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), rules };
}

/* ---------- Thống kê 1 lát ---------- */
function _slice(history, keyFn) {
  const map = new Map();
  for (const h of history) {
    const k = keyFn(h);
    if (k == null) continue;
    const s = map.get(k) || { n: 0, win: 0, sumR: 0, sumPnl: 0 };
    s.n++; if (h.pnl > 0) s.win++; s.sumR += h.rQuy || 0; s.sumPnl += h.pnl || 0;
    map.set(k, s);
  }
  return map;
}
function _wr(s) { return s.n ? Math.round(s.win / s.n * 100) : 0; }

/* ---------- Học từ lịch sử ---------- */
function hocTuLichSu() {
  const history = (typeof PAPER_BOT !== "undefined" && PAPER_BOT?.state?.history) || [];
  const closed = history.filter((h) => typeof h.pnl === "number");
  const n = closed.length;
  const overall = {
    n, win: closed.filter((h) => h.pnl > 0).length,
    winRate: n ? Math.round(closed.filter((h) => h.pnl > 0).length / n * 100) : 0,
    avgR: n ? +(closed.reduce((a, h) => a + (h.rQuy || 0), 0) / n).toFixed(2) : 0,
    tongPnl: +closed.reduce((a, h) => a + (h.pnl || 0), 0).toFixed(2),
  };

  const lessons = [], rules = [];
  const ctxOf = (h) => h.ctx || {};
  const themLesson = (dim, nhan, s, base, khuyenNghi, ruleKieu) => {
    if (s.n < 3) return;
    const wr = _wr(s), diff = wr - base;
    if (Math.abs(diff) < 15 && Math.abs(s.sumR) < 3) return;
    const tot = diff >= 0;
    lessons.push({
      dim, nhan, winRate: wr, n: s.n, avgR: +(s.sumR / s.n).toFixed(2),
      diff, tot, khuyenNghi,
    });
    if (ruleKieu) {
      const cu = LEARN.rules.find((r) => r.kieu === ruleKieu);
      rules.push({
        kieu: ruleKieu, nhan, winRate: wr, n: s.n,
        delta: tot ? Math.min(8, Math.round(Math.abs(diff) / 4)) : -Math.min(15, Math.round(Math.abs(diff) / 3)),
        khuyenNghi, active: cu ? cu.active : true,
      });
    }
  };

  if (n >= 3) {
    const base = overall.winRate;
    // Theo vs ngược tín hiệu
    const mSig = _slice(closed, (h) => ctxOf(h).theoTinHieu === true ? "theo" : ctxOf(h).theoTinHieu === false ? "nguoc" : null);
    if (mSig.get("nguoc")) themLesson("Tín hiệu", "Vào lệnh NGƯỢC tín hiệu hệ thống", mSig.get("nguoc"), base, "Chỉ vào lệnh thuận hướng SMC/RAG — bỏ qua lệnh ngược cấu trúc.", "nguoc_tin_hieu");
    if (mSig.get("theo")) themLesson("Tín hiệu", "Vào lệnh THUẬN tín hiệu hệ thống", mSig.get("theo"), base, "Tiếp tục ưu tiên setup thuận hệ thống — đang hiệu quả.", "theo_tin_hieu");
    // Killzone
    const mKz = _slice(closed, (h) => ctxOf(h).killzone === true ? "trong" : ctxOf(h).killzone === false ? "ngoai" : null);
    if (mKz.get("ngoai")) themLesson("Phiên", "Vào lệnh NGOÀI killzone/giờ vàng", mKz.get("ngoai"), base, "Hạn chế vào lệnh ngoài giờ vàng (19–22h VN) — thanh khoản mỏng.", "ngoai_killzone");
    if (mKz.get("trong")) themLesson("Phiên", "Vào lệnh TRONG killzone", mKz.get("trong"), base, "Ưu tiên khung giờ vàng — tỷ lệ thắng cao hơn.", "trong_killzone");
    // Đòn bẩy
    const mLev = _slice(closed, (h) => { const l = ctxOf(h).lev || h.lev; return l == null ? null : l <= 3 ? "≤3x" : l <= 5 ? "4–5x" : ">5x"; });
    if (mLev.get(">5x")) themLesson("Đòn bẩy", "Đòn bẩy cao (>5x)", mLev.get(">5x"), base, "Giữ đòn bẩy 2–3x — đòn bẩy cao khiến SL bị quét sớm.", "don_bay_cao");
    // Điểm hợp lưu
    const mScore = _slice(closed, (h) => { const s = ctxOf(h).score; return s == null ? null : s >= 70 ? "≥70" : s >= 50 ? "50–69" : "<50"; });
    if (mScore.get("<50")) themLesson("Điểm hợp lưu", "Vào khi điểm hợp lưu thấp (<50)", mScore.get("<50"), base, "Chờ điểm hợp lưu ≥70 mới vào — điểm thấp thắng kém.", "diem_thap");
    if (mScore.get("≥70")) themLesson("Điểm hợp lưu", "Vào khi điểm hợp lưu cao (≥70)", mScore.get("≥70"), base, "Kiên nhẫn chờ điểm cao — đang cho kết quả tốt.", null);
    // Hướng
    const mSide = _slice(closed, (h) => h.side);
    for (const [k, s] of mSide) themLesson("Hướng", `Lệnh ${k.toUpperCase()}`, s, base, `Xem lại hiệu quả lệnh ${k.toUpperCase()}.`, null);
    // Coin
    const mCoin = _slice(closed, (h) => h.coin);
    for (const [k, s] of mCoin) if (s.n >= 4) themLesson("Coin", k, s, base, `Cân nhắc ${_wr(s) < base ? "giảm/loại" : "ưu tiên"} ${k} trong watchlist.`, null);
    // Dời BE
    const mBE = _slice(closed, (h) => h.beDaDoi ? "coBE" : "khongBE");
    if (mBE.get("coBE") && mBE.get("khongBE")) themLesson("Quản lý lệnh", "Có dời SL về hòa vốn (+1R)", mBE.get("coBE"), _wr(mBE.get("khongBE")), "Duy trì kỷ luật dời SL về BE khi +1R — bảo vệ thành quả.", null);
  }

  LEARN.stats = overall;
  LEARN.lessons = lessons.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  // gộp rule: giữ trạng thái active cũ, thay số liệu mới
  const activeMap = new Map(LEARN.rules.map((r) => [r.kieu, r.active]));
  LEARN.rules = rules.map((r) => ({ ...r, active: activeMap.has(r.kieu) ? activeMap.get(r.kieu) : r.active }));

  /* --- v2.3.0: Kaizen từ tín hiệu hệ thống (trạm 24/7 + local) ---
   * Mapping toàn bộ tín hiệu đã chấm điểm → sinh quy tắc tin_hieu_*
   * áp ngược vào Cố vấn qua dieuChinhKienThuc (cùng cơ chế rule Bot). */
  try {
    const sig = hocTuTinHieu(layLichSuTinHieu());
    SIG.stats = sig.stats; SIG.lessons = sig.lessons; SIG.rules = sig.rules;
    LEARN.tinHieu = { stats: sig.stats, lessons: sig.lessons, rules: sig.rules, updatedAt: Date.now() };
    for (const r of sig.rules) {
      const i = LEARN.rules.findIndex((x) => x.kieu === r.kieu);
      if (i >= 0) LEARN.rules[i] = { ...r, active: LEARN.rules[i].active }; // refresh số liệu, giữ toggle
      else LEARN.rules.push({ ...r, active: activeMap.has(r.kieu) ? activeMap.get(r.kieu) : r.active });
    }
  } catch (e) { /* học tín hiệu lỗi → giữ nguyên rule Bot */ }

  LEARN.updatedAt = Date.now();
  luuLearn();
  document.dispatchEvent(new CustomEvent("siro:learn"));
  return LEARN;
}

/* ---------- Áp dụng kiến thức (gọi từ Advisor/Engine) ---------- */
function dieuChinhKienThuc(ctx) {
  if (!LEARN.rules.length) return { delta: 0, canhBao: [] };
  let delta = 0; const canhBao = [];
  const sideN = String(ctx.side || "").toLowerCase();
  const coinN = String(ctx.coin || "").toUpperCase();
  for (const r of LEARN.rules) {
    if (!r.active) continue;
    let khop = false;
    /* v2.3.0: quy tắc Kaizen từ tín hiệu hệ thống */
    if (r.kieu.indexOf("tin_hieu_huong_") === 0) khop = !!sideN && sideN === r.side;
    else if (r.kieu.indexOf("tin_hieu_coin_") === 0) khop = !!coinN && coinN === String(r.coin || "").toUpperCase();
    else switch (r.kieu) {
      case "tin_hieu_diem_thap": khop = ctx.score != null && ctx.score < 50; break;
      case "nguoc_tin_hieu": khop = ctx.theoTinHieu === false; break;
      case "theo_tin_hieu": khop = ctx.theoTinHieu === true; break;
      case "ngoai_killzone": khop = ctx.killzone === false; break;
      case "trong_killzone": khop = ctx.killzone === true; break;
      case "don_bay_cao": khop = (ctx.lev || 0) > 5; break;
      case "diem_thap": khop = ctx.score != null && ctx.score < 50; break;
    }
    if (khop) {
      delta += r.delta;
      if (r.delta < 0) canhBao.push(`${r.nhan} — thắng ${r.winRate}% qua ${r.n} lệnh. ${r.khuyenNghi}`);
    }
  }
  return { delta, canhBao };
}

/* ---------- v2.3.0: thẻ học từ tín hiệu hệ thống ---------- */
function veHocTinHieu(root) {
  const st = (SIG && SIG.stats) || { n: 0, ket: 0, hetHan: 0, thang: 0, winRate: 0, avgR: 0, tram: 0, local: 0, tienBo: null };
  const c = el("div", { class: "card" },
    el("div", { class: "card-title" }, "📡 Học từ tín hiệu hệ thống — Kaizen thuật toán"),
    el("p", { class: "muted small" },
      "Mapping toàn bộ tín hiệu đã chấm điểm từ ", el("b", {}, "📝 Sổ tín hiệu"), " (local) + ",
      el("b", {}, "🛰️ Trạm quan trắc 24/7"), " — cùng 1 bộ dữ liệu chấm bằng nến 15m thật. ",
      "Bài học ở đây sinh ", el("b", {}, "quy tắc Kaizen"), " (thẻ ⚙️ bên dưới, nhãn ",
      el("span", { class: "badge short" }, "Tín hiệu"), "): Cố vấn lệnh tự ± điểm mỗi khi setup mới trùng điều kiện."),
    el("div", { class: "kv" },
      el("span", {}, `Tín hiệu đã ngã ngũ: ${st.n} (trạm ${st.tram} + local ${st.local})${st.hetHan ? ` · ${st.hetHan} hết hạn` : ""}`),
      el("b", { class: st.winRate >= 50 ? "up" : "down" }, `WR ${st.winRate}% · ${st.avgR >= 0 ? "+" : ""}${st.avgR}R`)));
  if (_tramCapNhat) {
    const gio = (typeof fmtNgayGio === "function") ? fmtNgayGio(new Date(_tramCapNhat).getTime()) : new Date(_tramCapNhat).toLocaleString("vi-VN");
    c.appendChild(el("div", { class: "muted small" }, "🛰️ Trạm cập nhật: " + gio));
  } else {
    c.appendChild(el("div", { class: "muted small" }, "🛰️ Đang tải tín hiệu trạm 24/7…"));
  }
  if (st.n < 3) {
    c.appendChild(el("p", { class: "muted" },
      `Cần tối thiểu 3 tín hiệu đã ngã ngũ để rút bài học (hiện có ${st.n}). Trạm 24/7 đang chấm tự động — quay lại sau.`));
  } else {
    if (st.tienBo) {
      const t = st.tienBo;
      c.appendChild(el("div", { class: "kv" },
        el("span", {}, `WR ${t.n1} tín hiệu đầu`),
        el("b", {}, t.dau + "%")),
        el("div", { class: "kv" },
          el("span", {}, `WR ${t.n2} tín hiệu sau`),
          el("b", { class: t.sau >= t.dau ? "up" : "down" }, t.sau + "% " + (t.sau >= t.dau ? "▲ thuật toán tiến bộ" : "▼ cần xem lại"))));
    }
    for (const l of (SIG.lessons || [])) {
      c.appendChild(el("div", { class: "lesson " + (l.tot ? "tot" : "xau") },
        el("div", { class: "lesson-head" },
          el("b", {}, (l.tot ? "✅ " : "⚠️ ") + l.nhan),
          el("span", { class: "badge " + (l.tot ? "long" : "short") }, `WR ${l.winRate}% · ${l.n} tín hiệu · ${l.avgR >= 0 ? "+" : ""}${l.avgR}R`)),
        el("div", { class: "small muted" }, `[${l.dim}] ${l.khuyenNghi} (lệch ${l.diff >= 0 ? "+" : ""}${l.diff}% so với trung bình)`)));
    }
    // Bài học Kaizen do trạm tự rút (gợi ý trước đó → mapping về đây để theo dõi)
    if (_tramBaiHoc.length) {
      const cT = el("div", {}, el("div", { class: "card-title small" }, `🧠 Gợi ý Kaizen từ trạm 24/7 (${_tramBaiHoc.length})`));
      for (const l of _tramBaiHoc.slice(0, 6)) {
        const mau = l.muc === "tot" ? "up" : l.muc === "xau" ? "down" : "warn";
        cT.appendChild(el("div", { class: "kv" },
          el("div", {}, el("b", { class: mau }, l.tieuDe), el("div", { class: "muted small" }, l.chiTiet)),
          el("div", { class: "muted small", style: "max-width:46%" }, "💡 " + (l.goiY || ""))));
      }
      c.appendChild(cT);
    }
  }
  root.appendChild(c);
}

/* ================= MÀN HÌNH NHẬT KÝ & TỰ HỌC ================= */
function renderTuHoc(root) {
  root.innerHTML = "";
  hocTuLichSu();
  const st = LEARN.stats || { n: 0, winRate: 0, avgR: 0, tongPnl: 0 };

  root.appendChild(el("div", { class: "note-box" },
    "📓 Màn hình này ", el("b", {}, "tự học sau mỗi lệnh đóng và mỗi tín hiệu hệ thống ngã ngũ"),
    ": phân tích lãi/lỗ, rút bài học, sinh quy tắc và ",
    el("b", {}, "áp dụng ngược lại Cố vấn lệnh + Engine"), " để lần sau tốt hơn. Kiến thức lưu ngay trên máy bạn."));

  // Thống kê tổng (Bot)
  root.appendChild(el("div", { class: "stat-row" },
    theStat("Tổng lệnh đã đóng", String(st.n)),
    theStat("Win rate", st.winRate + "%", st.winRate >= 50 ? "up" : "down"),
    theStat("R trung bình", (st.avgR >= 0 ? "+" : "") + st.avgR + "R", st.avgR >= 0 ? "up" : "down"),
    theStat("Tổng PnL", fmtUsd(st.tongPnl), st.tongPnl >= 0 ? "up" : "down"),
  ));

  const bar = el("div", { class: "toolbar" },
    el("button", { class: "btn primary", onclick: () => { hocTuLichSu(); renderTuHoc(root); } }, "🔄 Tổng hợp lại kiến thức"),
    el("button", { class: "btn", onclick: xuatKienThuc }, "⬇ Xuất kiến thức (JSON)"),
    el("span", { class: "muted small" }, LEARN.updatedAt ? "Cập nhật " + fmtGio(LEARN.updatedAt) : ""));
  root.appendChild(bar);

  /* v2.3.0: thẻ học từ tín hiệu — luôn hiện, kể cả khi Bot chưa có lệnh */
  veHocTinHieu(root);

  if (st.n < 3) {
    root.appendChild(el("div", { class: "card" },
      el("div", { class: "card-title" }, "🌱 Chưa đủ dữ liệu để rút bài học"),
      el("p", { class: "muted" }, `Cần tối thiểu 3 lệnh đã đóng (hiện có ${st.n}). Hãy để Bot chạy hoặc đặt lệnh qua Cố vấn/phiếu lệnh — sau mỗi lệnh kết thúc, hệ thống tự phân tích và tích lũy kinh nghiệm tại đây.`),
      el("p", { class: "muted small" }, "Trong lúc chờ, nền tảng kỷ luật vẫn áp dụng: risk 1–2%/lệnh · RR ≥ 1:2 · thuận bias 4H · né tin ★★★ · chỉ trade giờ vàng.")));
    // vẫn hiện nguyên tắc gốc
    veNguyenTacGoc(root);
    return;
  }

  // Tiến bộ (nửa đầu vs nửa sau)
  // FIX v2.0: guard PAPER_BOT — renderTuHoc có thể chạy trước khi bot khởi tạo
  const lichSu = (typeof PAPER_BOT !== "undefined" && PAPER_BOT?.state?.history) || [];
  const closed = lichSu.filter((h) => typeof h.pnl === "number").slice().reverse();
  const half = Math.floor(closed.length / 2);
  if (half >= 2) {
    const wr = (arr) => Math.round(arr.filter((h) => h.pnl > 0).length / arr.length * 100);
    const dau = wr(closed.slice(0, half)), sau = wr(closed.slice(half));
    const c = el("div", { class: "card" }, el("div", { class: "card-title" }, "📈 Tiến bộ theo thời gian"),
      el("div", { class: "kv" }, el("span", {}, `Win rate nửa đầu (${half} lệnh)`), el("b", {}, dau + "%")),
      el("div", { class: "kv" }, el("span", {}, `Win rate nửa sau (${closed.length - half} lệnh)`), el("b", { class: sau >= dau ? "up" : "down" }, sau + "% " + (sau >= dau ? "▲ tiến bộ" : "▼ cần xem lại"))));
    root.appendChild(c);
  }

  // Bài học tự rút
  const cL = el("div", { class: "card" }, el("div", { class: "card-title" }, `🧠 Kinh nghiệm tự rút ra từ Bot (${LEARN.lessons.length})`));
  if (!LEARN.lessons.length) cL.appendChild(el("p", { class: "muted" }, "Chưa có lát dữ liệu nào lệch đủ mạnh để thành bài học rõ ràng."));
  if (!LEARN.lessons.length) cL.appendChild(el("p", { class: "muted" }, "Chưa có lát dữ liệu nào lệch đủ mạnh để thành bài học rõ ràng."));
  for (const l of LEARN.lessons) {
    cL.appendChild(el("div", { class: "lesson " + (l.tot ? "tot" : "xau") },
      el("div", { class: "lesson-head" },
        el("b", {}, (l.tot ? "✅ " : "⚠️ ") + l.nhan),
        el("span", { class: "badge " + (l.tot ? "long" : "short") }, `WR ${l.winRate}% · ${l.n} lệnh · ${l.avgR >= 0 ? "+" : ""}${l.avgR}R`)),
      el("div", { class: "small muted" }, `[${l.dim}] ${l.khuyenNghi} (lệch ${l.diff >= 0 ? "+" : ""}${l.diff}% so với trung bình)`)));
  }
  root.appendChild(cL);

  // Quy tắc đã học (áp dụng ngược) — nhãn nguồn Bot / Tín hiệu
  const cR = el("div", { class: "card" }, el("div", { class: "card-title" }, `⚙️ Quy tắc đã học — tự áp dụng cho Cố vấn & Engine (${LEARN.rules.length})`));
  if (!LEARN.rules.length) cR.appendChild(el("p", { class: "muted" }, "Chưa sinh quy tắc tự động."));
  for (const r of LEARN.rules) {
    const laTinHieu = r.nguon === "tin_hieu";
    const line = el("label", { class: "rule-line" },
      el("input", { type: "checkbox", ...(r.active ? { checked: "" } : {}), onchange: (e) => { r.active = e.target.checked; luuLearn(); } }),
      el("span", {},
        el("span", { class: "badge " + (laTinHieu ? "short" : "long") }, laTinHieu ? "Tín hiệu" : "Bot"), " ",
        el("b", {}, r.nhan), " ",
        el("span", { class: "mono " + (r.delta < 0 ? "down" : "up") }, `(${r.delta > 0 ? "+" : ""}${r.delta}đ tối ưu)`),
        el("div", { class: "small muted" }, `${r.khuyenNghi} — bằng chứng: thắng ${r.winRate}% qua ${r.n} ${laTinHieu ? "tín hiệu" : "lệnh"}`)));
    cR.appendChild(line);
  }
  root.appendChild(cR);

  // Breakdown tables
  veBreakdown(root, closed);
  veNguyenTacGoc(root);

  /* v2.3.0: tải ngầm tín hiệu trạm 24/7 → học lại → vẽ lại (1 lần) */
  napTinHieuTram().then((moi) => {
    if (moi && root.isConnected) { hocTuLichSu(); renderTuHoc(root); }
  });
}

function veBreakdown(root, closed) {
  const dims = [
    { ten: "Theo/Ngược tín hiệu", key: (h) => (h.ctx?.theoTinHieu === true ? "Thuận" : h.ctx?.theoTinHieu === false ? "Ngược" : "—") },
    { ten: "Killzone", key: (h) => (h.ctx?.killzone === true ? "Trong giờ vàng" : h.ctx?.killzone === false ? "Ngoài" : "—") },
    { ten: "Đòn bẩy", key: (h) => { const l = h.ctx?.lev || h.lev; return l == null ? "—" : l <= 3 ? "≤3x" : l <= 5 ? "4–5x" : ">5x"; } },
    { ten: "Hướng", key: (h) => (h.side ? h.side.toUpperCase() : "—") },
    { ten: "Coin", key: (h) => h.coin || "—" },
  ];
  const grid = el("div", { class: "knowledge-grid" });
  for (const d of dims) {
    const m = _slice(closed, d.key);
    if (!m.size) continue;
    const card = el("div", { class: "card" }, el("div", { class: "card-title" }, "📊 " + d.ten));
    const tbl = el("table", { class: "mini-table" });
    tbl.appendChild(el("tr", {}, el("th", { class: "left" }, "Nhóm"), el("th", {}, "Số lệnh"), el("th", {}, "Win"), el("th", {}, "Avg R")));
    for (const [k, s] of [...m.entries()].sort((a, b) => b[1].n - a[1].n)) {
      const wr = _wr(s);
      tbl.appendChild(el("tr", {},
        el("td", { class: "left" }, k),
        el("td", { class: "mono" }, String(s.n)),
        el("td", { class: "mono " + (wr >= 50 ? "up" : "down") }, wr + "%"),
        el("td", { class: "mono " + (s.sumR >= 0 ? "up" : "down") }, (s.sumR / s.n >= 0 ? "+" : "") + (s.sumR / s.n).toFixed(2) + "R")));
    }
    card.appendChild(tbl);
    grid.appendChild(card);
  }
  root.appendChild(grid);
}

function veNguyenTacGoc(root) {
  const c = el("div", { class: "card" }, el("div", { class: "card-title" }, "📜 Nguyên tắc nền tảng (luôn áp dụng)"));
  const items = [
    "Chỉ dùng tiền nhàn rỗi · risk 1–2%/lệnh · R:R tối thiểu 1:2",
    "Không giao dịch ngược dòng chảy khung lớn (bias 4H)",
    "Chờ QUÉT THANH KHOẢN → CHoCH thật → retest POI mới vào",
    "Ngắt mạch khi lỗ 3–5%/ngày · không FOMO · không revenge trade",
    "Đặt SL/TP xong thì QUÊN ĐI — dời SL về hòa vốn khi +1R",
    "Né tin ★★★ ±30 phút · ưu tiên killzone/giờ vàng",
  ];
  c.appendChild(el("ul", {}, ...items.map((x) => el("li", {}, x))));
  root.appendChild(c);
}

function xuatKienThuc() {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([JSON.stringify(LEARN, null, 2)], { type: "application/json" }));
  a.href = url;
  a.download = "trade2026-kien-thuc.json";
  document.body.appendChild(a); // FIX v2.0: Safari cần node trong DOM mới cho download
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000); // FIX v2.0: thu hồi object URL, chống leak
}
