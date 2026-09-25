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
  LEARN.updatedAt = Date.now();
  luuLearn();
  document.dispatchEvent(new CustomEvent("siro:learn"));
  return LEARN;
}

/* ---------- Áp dụng kiến thức (gọi từ Advisor/Engine) ---------- */
function dieuChinhKienThuc(ctx) {
  if (!LEARN.rules.length) return { delta: 0, canhBao: [] };
  let delta = 0; const canhBao = [];
  for (const r of LEARN.rules) {
    if (!r.active) continue;
    let khop = false;
    switch (r.kieu) {
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

/* ================= MÀN HÌNH NHẬT KÝ & TỰ HỌC ================= */
function renderTuHoc(root) {
  root.innerHTML = "";
  hocTuLichSu();
  const st = LEARN.stats || { n: 0, winRate: 0, avgR: 0, tongPnl: 0 };

  root.appendChild(el("div", { class: "note-box" },
    "📓 Màn hình này ", el("b", {}, "tự học sau mỗi lệnh đóng"), ": phân tích lãi/lỗ, rút bài học, sinh quy tắc và ",
    el("b", {}, "áp dụng ngược lại Cố vấn lệnh + Engine"), " để lần sau tốt hơn. Kiến thức lưu ngay trên máy bạn."));

  // Thống kê tổng
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
  const cL = el("div", { class: "card" }, el("div", { class: "card-title" }, `🧠 Kinh nghiệm tự rút ra (${LEARN.lessons.length})`));
  if (!LEARN.lessons.length) cL.appendChild(el("p", { class: "muted" }, "Chưa có lát dữ liệu nào lệch đủ mạnh để thành bài học rõ ràng."));
  for (const l of LEARN.lessons) {
    cL.appendChild(el("div", { class: "lesson " + (l.tot ? "tot" : "xau") },
      el("div", { class: "lesson-head" },
        el("b", {}, (l.tot ? "✅ " : "⚠️ ") + l.nhan),
        el("span", { class: "badge " + (l.tot ? "long" : "short") }, `WR ${l.winRate}% · ${l.n} lệnh · ${l.avgR >= 0 ? "+" : ""}${l.avgR}R`)),
      el("div", { class: "small muted" }, `[${l.dim}] ${l.khuyenNghi} (lệch ${l.diff >= 0 ? "+" : ""}${l.diff}% so với trung bình)`)));
  }
  root.appendChild(cL);

  // Quy tắc đã học (áp dụng ngược)
  const cR = el("div", { class: "card" }, el("div", { class: "card-title" }, `⚙️ Quy tắc đã học — tự áp dụng cho Cố vấn & Engine (${LEARN.rules.length})`));
  if (!LEARN.rules.length) cR.appendChild(el("p", { class: "muted" }, "Chưa sinh quy tắc tự động."));
  for (const r of LEARN.rules) {
    const line = el("label", { class: "rule-line" },
      el("input", { type: "checkbox", ...(r.active ? { checked: "" } : {}), onchange: (e) => { r.active = e.target.checked; luuLearn(); } }),
      el("span", {},
        el("b", {}, r.nhan), " ",
        el("span", { class: "mono " + (r.delta < 0 ? "down" : "up") }, `(${r.delta > 0 ? "+" : ""}${r.delta}đ tối ưu)`),
        el("div", { class: "small muted" }, `${r.khuyenNghi} — bằng chứng: thắng ${r.winRate}% qua ${r.n} lệnh`)));
    cR.appendChild(line);
  }
  root.appendChild(cR);

  // Breakdown tables
  veBreakdown(root, closed);
  veNguyenTacGoc(root);
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
