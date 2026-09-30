/* ============================================================
 * Trade.2026 — Nhật ký tín hiệu & Tự học Kaizen (v2.2.1)
 * Mỗi cảnh báo LONG/SHORT được xác nhận → ghi nhận thời điểm, entry/SL/TP.
 * Dùng nến 15m thật sau đó để chấm điểm đúng/sai → thống kê → rút bài học.
 * Giả định: khớp entry tại giá tín hiệu (ghi rõ trong UI).
 * v2.2.1: bảng chi tiết thêm cột STOP / KẾT THÚC / ±(chênh lệch giá);
 *   fix chamDiemLenh nhận cả "giaVao" (record thật) lẫn "entry" (test cũ);
 *   kết quả chấm điểm lưu thêm giá kết thúc lệnh (giaKT/giaKetThuc).
 * ============================================================ */
"use strict";

const JOURNAL = {
  _k: "trade2026_signal_journal",
  _max: 300,
  _hanGio: 48, // cửa sổ đánh giá 1 tín hiệu

  _doc() { try { return JSON.parse(localStorage.getItem(this._k) || "[]"); } catch (e) { return []; } },
  /* Chính sách bộ nhớ (user 26/09/2026): KHÔNG tự xóa.
   * Đầy (quá _max hoặc localStorage hết chỗ) → dừng ghi, chờ user dọn thủ công. */
  _luu(ds) {
    try {
      if (ds.length > this._max) { this._hetBoNho = true; return false; }
      localStorage.setItem(this._k, JSON.stringify(ds));
      this._hetBoNho = false;
      return true;
    } catch (e) { this._hetBoNho = true; return false; }
  },
  all() { return this._doc(); },
  hetBoNho() { return !!this._hetBoNho; },
  xoaHet() { try { localStorage.removeItem(this._k); } catch (e) {} this._hetBoNho = false; },

  /* Ghi nhận 1 tín hiệu đã xác nhận từ engine (tự động).
   * Chống trùng: cùng coin+hướng đang theo dõi trong 6h → bỏ qua. */
  ghiNhan(kq) {
    try {
      if (!kq || (kq.verdict !== "LONG" && kq.verdict !== "SHORT")) return null;
      const p = kq.plan;
      if (!p || !(p.entry > 0) || !(p.sl > 0) || !(p.tp1 > 0)) return null;
      const side = kq.verdict === "LONG" ? "long" : "short";
      const coin = String(kq.coin || "").toUpperCase();
      const now = Date.now();
      const ds = this._doc();
      const trung = ds.find(r => r.coin === coin && r.side === side &&
        r.trangThai === "dang_theo_doi" && now - r.tsVao < 6 * 3600e3);
      if (trung) return null;
      const rec = {
        id: `${coin}-${side}-${now}`,
        coin, side, loai: "that", // that = tín hiệu thật (đủ chuẩn vào lệnh)
        tsVao: kq.time || now,
        giaVao: p.entry, sl: p.sl, tp: p.tp1,
        rr: p.rr1 || +(Math.abs(p.tp1 - p.entry) / Math.abs(p.entry - p.sl)).toFixed(2),
        diem: kq.score, phase: kq.phase,
        phien: kq.killzone?.ten || kq.killzone?.id || "—",
        bias4h: kq.htf?.bias || "—",
        checklist: (kq.checklist || []).filter(c => c.dat).map(c => c.id),
        trangThai: "dang_theo_doi",
        ketQua: null,
        daDanhGiaDen: 0,
      };
      ds.push(rec);
      if (!this._luu(ds)) return null; // đầy bộ nhớ → không ghi, báo null
      return rec;
    } catch (e) { return null; }
  },

  /* v2.5.0 — Mục tiêu 1 tín hiệu/ngày (không hạ chuẩn vào lệnh):
   * Ghi nhận "tín hiệu giấy" = setup tốt nhất trong ngày khi không có tín hiệu thật.
   * - Chấp nhận mọi verdict có plan hợp lệ (kể cả PREPARE/WAIT_CONFIRM điểm <70).
   * - loai:"giay" → LOẠI KHỎI thống kê win-rate/expectancy thật, NHƯNG vẫn được
   *   chấm điểm bằng nến thật để vòng Kaizen luôn có dữ liệu học mỗi ngày.
   * - Mỗi ngày tối đa 1 tín hiệu giấy. */
  ghiNhanGiay(kq, ngayStr) {
    try {
      if (!kq) return null;
      const p = kq.plan;
      if (!p || !(p.entry > 0) || !(p.sl > 0) || !(p.tp1 > 0)) return null;
      const verdict = kq.verdict;
      const side = verdict === "LONG" ? "long" : verdict === "SHORT" ? "short"
        : (kq.side === "long" || kq.side === "short") ? kq.side : null;
      if (!side) return null;
      const coin = String(kq.coin || "").toUpperCase();
      const now = Date.now();
      const ds = this._doc();
      // mỗi ngày tối đa 1 tín hiệu giấy
      if (ngayStr && ds.some(r => r.loai === "giay" && r.ngay === ngayStr)) return null;
      const rec = {
        id: `GIAY-${coin}-${side}-${now}`,
        coin, side, loai: "giay", ngay: ngayStr || null,
        verdictGoc: verdict,
        tsVao: kq.time || now,
        giaVao: p.entry, sl: p.sl, tp: p.tp1,
        rr: p.rr1 || +(Math.abs(p.tp1 - p.entry) / Math.abs(p.entry - p.sl)).toFixed(2),
        diem: kq.score, phase: kq.phase,
        phien: kq.killzone?.ten || kq.killzone?.id || "—",
        bias4h: kq.htf?.bias || "—",
        checklist: (kq.checklist || []).filter(c => c.dat).map(c => c.id),
        lyDo: "Setup tốt nhất trong ngày — không đủ chuẩn vào lệnh thật, ghi nhận để Kaizen học",
        trangThai: "dang_theo_doi",
        ketQua: null,
        daDanhGiaDen: 0,
      };
      ds.push(rec);
      if (!this._luu(ds)) return null;
      return rec;
    } catch (e) { return null; }
  },

  /* Đếm tín hiệu thật theo ngày (giờ VN) — phục vụ mục tiêu 1 tín hiệu/ngày */
  demTheoNgay(ds, loai) {
    const dem = {};
    for (const r of ds || this._doc()) {
      if (loai && r.loai !== loai) continue;
      if (!loai && r.loai === "giay") continue; // mặc định chỉ đếm thật
      const d = new Date(r.tsVao);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dem[key] = (dem[key] || 0) + 1;
    }
    return dem;
  },

  /* Chấm điểm 1 bản ghi bằng nến 15m thật. Trả về bản ghi đã cập nhật. */
  async chamDiem(rec) {
    const now = Date.now();
    let nen = [];
    try {
      nen = await fetchKlines(rec.coin, "15m", 400);
    } catch (e) { return { rec, loi: "Không tải được nến: " + e.message }; }
    const sau = nen.filter(n => n.openTime >= rec.tsVao - 15 * 60e3);
    if (!sau.length) return { rec, loi: "Chưa có nến sau thời điểm tín hiệu" };
    const dg = chamDiemLenh(sau, rec);
    const hetHan = now - rec.tsVao > this._hanGio * 3600e3;
    if (dg.ketQua === "thang" || dg.ketQua === "thua") {
      rec.trangThai = dg.ketQua;
      rec.ketQua = { ...dg, gioDenKQ: +((dg.at - rec.tsVao) / 3600e3).toFixed(1) };
    } else if (hetHan) {
      const giaCuoi = sau[sau.length - 1].close;
      const risk = Math.abs(rec.giaVao - rec.sl);
      const rRaw = rec.side === "long" ? (giaCuoi - rec.giaVao) / risk : (rec.giaVao - giaCuoi) / risk;
      rec.trangThai = "het_han";
      rec.ketQua = { ketQua: "het_han", at: sau[sau.length - 1].openTime, r: +rRaw.toFixed(2), mfeR: dg.mfeR, maeR: dg.maeR, gioDenKQ: this._hanGio, giaKetThuc: giaCuoi };
    }
    rec.daDanhGiaDen = now;
    const ds = this._doc().map(r => r.id === rec.id ? rec : r);
    this._luu(ds);
    return { rec };
  },

  /* Chấm điểm toàn bộ bản ghi đang theo dõi. onTienDo(i, n) để UI báo tiến độ. */
  async chamDiemTatCa(onTienDo) {
    const ds = this._doc();
    const cho = ds.filter(r => r.trangThai === "dang_theo_doi");
    let ok = 0, loi = 0;
    for (let i = 0; i < cho.length; i++) {
      try { const { loi: e } = await this.chamDiem(cho[i]); if (e) loi++; else ok++; }
      catch (e) { loi++; }
      if (onTienDo) onTienDo(i + 1, cho.length);
      await new Promise(r => setTimeout(r, 250)); // nhẹ tay với API nến
    }
    return { ok, loi, tong: cho.length };
  },
};

/* ---------- Thuần: chấm điểm 1 lệnh từ nến (dễ test) ----------
 * nen: [{openTime, high, low, close}] tăng dần. SL chạm trước TP trong
 * cùng nến → tính thua (bảo thủ). Trả về {ketQua, at, r, mfeR, maeR}. */
function chamDiemLenh(nen, lenh) {
  // v2.2.1: record thật trong JOURNAL lưu "giaVao", test cũ dùng "entry" — nhận cả hai
  const entry = lenh.entry != null ? +lenh.entry : +lenh.giaVao;
  const { side, sl, tp } = lenh;
  const isLong = side === "long";
  const risk = Math.abs(entry - sl);
  let mfe = 0, mae = 0;
  const r2 = (v) => +v.toFixed(2);
  for (const n of nen) {
    if (!(n.high >= n.low)) continue;
    const fav = isLong ? n.high - entry : entry - n.low;
    const adv = isLong ? entry - n.low : n.high - entry;
    if (risk > 0) { mfe = Math.max(mfe, fav / risk); mae = Math.max(mae, adv / risk); }
    const chamSL = isLong ? n.low <= sl : n.high >= sl;
    const chamTP = isLong ? n.high >= tp : n.low <= tp;
    if (chamSL && chamTP)
      return { ketQua: "thua", at: n.openTime, r: -1, mfeR: r2(mfe), maeR: r2(mae), giaKT: sl, ghiChu: "SL & TP cùng nến — tính thua (bảo thủ)" };
    if (chamSL) return { ketQua: "thua", at: n.openTime, r: -1, mfeR: r2(mfe), maeR: r2(mae), giaKT: sl };
    if (chamTP) return { ketQua: "thang", at: n.openTime, r: r2(Math.abs(tp - entry) / (risk || 1)), mfeR: r2(mfe), maeR: r2(mae), giaKT: tp };
  }
  return { ketQua: "dang_theo_doi", at: null, r: null, mfeR: r2(mfe), maeR: r2(mae), giaKT: null };
}

/* ---------- v2.2.1: giá kết thúc + chênh lệch (cột mới Sổ tín hiệu) ----------
 * giaKetThuc(rec): thắng → TP, thua → SL, hết hạn → giá cuối đã lưu.
 * Bản ghi cũ chưa có giaKetThuc/giaKT trong ketQua thì suy từ trạng thái.
 * chenhLechGia(rec): {gia, pct} có dấu theo hướng lệnh (long: KT−entry,
 *   short: entry−KT) — dương là lãi, âm là lỗ so với giá vào. */
function giaKetThuc(rec) {
  if (!rec) return null;
  const kq = rec.ketQua || {};
  const luu = kq.giaKetThuc != null ? +kq.giaKetThuc : (kq.giaKT != null ? +kq.giaKT : NaN);
  if (luu > 0) return luu;
  if (rec.trangThai === "thang" && +rec.tp > 0) return +rec.tp;
  if (rec.trangThai === "thua" && +rec.sl > 0) return +rec.sl;
  return null;
}
function chenhLechGia(rec) {
  if (!rec) return null;
  const g = giaKetThuc(rec), vao = +rec.giaVao;
  if (!(g > 0) || !(vao > 0)) return null;
  const d = rec.side === "long" ? g - vao : vao - g;
  return { gia: d, pct: d / vao * 100 };
}
/* Chuỗi hiển thị cột ±, vd "+12.5 (+0.01%)" — màu do caller quyết theo dấu */
function fmtChenhLech(cl) {
  if (!cl || !isFinite(cl.gia)) return "—";
  const dau = cl.gia >= 0 ? "+" : "-";
  const pct = isFinite(cl.pct) ? ` (${dau}${Math.abs(cl.pct).toFixed(2)}%)` : "";
  return dau + fmtGia(Math.abs(cl.gia)) + pct;
}

/* ---------- Thuần: thống kê từ danh sách bản ghi ---------- */
function thongKeJournal(ds, opts = {}) {
  // v2.5.0: mặc định LOẠI tín hiệu giấy khỏi thống kê thật (không làm méo win-rate);
  // opts.gomGiay=true → tính riêng cho mục Kaizen.
  const that = (ds || []).filter(r => r.loai !== "giay");
  const giay = (ds || []).filter(r => r.loai === "giay");
  const st = _thongKeCore(that);
  st.giay = _thongKeCore(giay);
  st.giay.tong = giay.length;
  return st;
}
function _thongKeCore(ds) {
  const xong = ds.filter(r => r.trangThai === "thang" || r.trangThai === "thua");
  const thang = ds.filter(r => r.trangThai === "thang");
  const thua = ds.filter(r => r.trangThai === "thua");
  const st = {
    tong: ds.length, xong: xong.length, thang: thang.length, thua: thua.length,
    hetHan: ds.filter(r => r.trangThai === "het_han").length,
    dangTheoDoi: ds.filter(r => r.trangThai === "dang_theo_doi").length,
    winRate: xong.length ? Math.round(thang.length / xong.length * 100) : 0,
    expectancy: 0, tbGioDenTP: 0, tbGioDenSL: 0,
    theo: { side: {}, coin: {}, nhomDiem: {}, phien: {} },
  };
  if (xong.length) st.expectancy = +(xong.reduce((s, r) => s + (r.ketQua?.r || 0), 0) / xong.length).toFixed(2);
  const gioTP = thang.map(r => r.ketQua?.gioDenKQ).filter(v => v != null);
  const gioSL = thua.map(r => r.ketQua?.gioDenKQ).filter(v => v != null);
  if (gioTP.length) st.tbGioDenTP = +(gioTP.reduce((a, b) => a + b, 0) / gioTP.length).toFixed(1);
  if (gioSL.length) st.tbGioDenSL = +(gioSL.reduce((a, b) => a + b, 0) / gioSL.length).toFixed(1);

  const gom = (keyFn, bucket) => {
    for (const r of xong) {
      const k = keyFn(r);
      bucket[k] = bucket[k] || { n: 0, thang: 0 };
      bucket[k].n++;
      if (r.trangThai === "thang") bucket[k].thang++;
    }
    for (const k of Object.keys(bucket)) bucket[k].wr = Math.round(bucket[k].thang / bucket[k].n * 100);
  };
  const nhomDiem = (r) => r.diem >= 85 ? "85–100" : r.diem >= 70 ? "70–84" : "<70";
  gom(r => r.side, st.theo.side);
  gom(r => r.coin, st.theo.coin);
  gom(nhomDiem, st.theo.nhomDiem);
  gom(r => r.phien || "—", st.theo.phien);
  return st;
}

/* ---------- Thuần: rút bài học Kaizen từ thống kê ----------
 * Mỗi bài học: {muc: "tot"|"xau"|"ghi_nho", tieuDe, chiTiet, goiY} */
function rutBaiHocKaizen(st, ds) {
  const bh = [];
  const MIN = 6; // mẫu tối thiểu để kết luận
  if (st.xong < 3) {
    bh.push({ muc: "ghi_nho", tieuDe: "🌱 Đang tích lũy dữ liệu", chiTiet: `Mới có ${st.xong} lệnh đã ngã ngũ — cần tối thiểu 3 để bắt đầu rút bài học, ${MIN}+ để kết luận đáng tin.`, goiY: "Cứ để app tự ghi nhận mỗi tín hiệu LONG/SHORT; mở màn hình này và bấm chấm điểm mỗi ngày." });
    return bh;
  }
  // 1. Win rate tổng
  if (st.xong >= MIN) {
    if (st.winRate < 40) bh.push({ muc: "xau", tieuDe: "⚠️ Win rate tổng thấp", chiTiet: `Chỉ ${st.winRate}% thắng trên ${st.xong} lệnh đã ngã ngũ.`, goiY: "Cân nhắc nâng ngưỡng vào lệnh (ví dụ chỉ đánh khi điểm ≥ 80) hoặc lọc thêm phiên giao dịch." });
    else if (st.winRate >= 55) bh.push({ muc: "tot", tieuDe: "✅ Hệ thống đang dương", chiTiet: `Win rate ${st.winRate}% với expectancy ${st.expectancy >= 0 ? "+" : ""}${st.expectancy}R trên ${st.xong} lệnh.`, goiY: "Giữ kỷ luật — đừng phá vỡ quy tắc khi đang thắng." });
  }
  // 2. Expectancy
  if (st.xong >= MIN && st.expectancy < 0)
    bh.push({ muc: "xau", tieuDe: "📉 Expectancy âm", chiTiet: `Trung bình ${st.expectancy}R mỗi lệnh — về dài hạn hệ thống đang mất tiền.`, goiY: "Xem nhóm điểm/phiên nào kéo xuống dưới để loại bỏ." });
  // 3. Nhóm điểm tốt nhất / tệ nhất
  const nhom = Object.entries(st.theo.nhomDiem).filter(([, v]) => v.n >= 4).sort((a, b) => b[1].wr - a[1].wr);
  if (nhom.length >= 2) {
    const [totK, totV] = nhom[0], [xauK, xauV] = nhom[nhom.length - 1];
    if (totV.wr - xauV.wr >= 20)
      bh.push({ muc: "tot", tieuDe: "🎯 Điểm số phân biệt rõ", chiTiet: `Nhóm điểm ${totK} thắng ${totV.wr}% (n=${totV.n}), nhóm ${xauK} chỉ ${xauV.wr}% (n=${xauV.n}).`, goiY: `Ưu tiên vốn cho nhóm điểm ${totK}; cân nhắc bỏ qua nhóm ${xauK}.` });
  }
  // 4. Hướng long/short
  for (const [side, v] of Object.entries(st.theo.side)) {
    if (v.n >= MIN && v.wr < 35)
      bh.push({ muc: "xau", tieuDe: `⚠️ Lệnh ${side.toUpperCase()} kém hiệu quả`, chiTiet: `${v.wr}% thắng trên ${v.n} lệnh ${side}.`, goiY: `Giai đoạn này thị trường không ủng hộ ${side} — giảm size hoặc đứng ngoài.` });
    else if (v.n >= MIN && v.wr >= 60)
      bh.push({ muc: "tot", tieuDe: `💪 Lệnh ${side.toUpperCase()} đang thuận`, chiTiet: `${v.wr}% thắng trên ${v.n} lệnh ${side}.`, goiY: "Tận dụng khi setup đạt điểm cao." });
  }
  // 5. Thời gian tới TP — bài học cốt lõi user yêu cầu
  if (st.tbGioDenTP > 0)
    bh.push({
      muc: "ghi_nho", tieuDe: "⏱️ Bao lâu thì lệnh đúng?",
      chiTiet: `Lệnh thắng chạm TP1 trung bình sau ${st.tbGioDenTP} giờ; lệnh thua chạm SL sau ${st.tbGioDenSL} giờ.`,
      goiY: st.tbGioDenSL < st.tbGioDenTP
        ? `Lệnh sai thường "chết" nhanh (${st.tbGioDenSL}h) — nếu sau ${Math.ceil(st.tbGioDenTP * 1.5)}h giá vẫn lình xình quanh entry, cân nhắc thoát sớm thay vì chờ đủ 48h.`
        : "Theo dõi thêm để có ngưỡng thời gian thoát sớm.",
    });
  // 6. Phiên giao dịch
  const phien = Object.entries(st.theo.phien).filter(([, v]) => v.n >= 4).sort((a, b) => b[1].wr - a[1].wr);
  if (phien.length >= 2 && phien[0][1].wr - phien[phien.length - 1][1].wr >= 25)
    bh.push({ muc: "ghi_nho", tieuDe: "🕰️ Phiên giao dịch matter", chiTiet: `${phien[0][0]}: ${phien[0][1].wr}% (n=${phien[0][1].n}) vs ${phien[phien.length - 1][0]}: ${phien[phien.length - 1][1].wr}% (n=${phien[phien.length - 1][1].n}).`, goiY: "Ưu tiên vào lệnh trong phiên hiệu quả nhất." });
  // 7. Coin yếu nhất
  const coins = Object.entries(st.theo.coin).filter(([, v]) => v.n >= 4).sort((a, b) => a[1].wr - b[1].wr);
  if (coins.length && coins[0][1].wr < 35)
    bh.push({ muc: "xau", tieuDe: `🪙 ${coins[0][0]} đang "khó ăn"`, chiTiet: `Win rate ${coins[0][1].wr}% trên ${coins[0][1].n} lệnh.`, goiY: "Tạm đứng ngoài coin này cho đến khi setup cải thiện." });
  // 8. Tín hiệu giấy — Kaizen học từ setup tốt nhất ngày (v2.5.1)
  //    Giấy KHÔNG tính vào win-rate/expectancy thật, nhưng được chấm bằng nến thật
  //    nên vẫn rút được bài học: setup nào bị chuẩn thật loại bỏ mà vẫn đúng/sai.
  const G = st.giay;
  if (G && G.xong > 0) {
    const dsGiay = (ds || []).filter(r => r.loai === "giay");
    for (const r of dsGiay.filter(x => x.trangThai === "thang").slice(-3)) {
      const rR = r.ketQua && r.ketQua.r != null ? `+${r.ketQua.r}R` : "thắng";
      const gio = r.ketQua && r.ketQua.gioDenKQ != null ? ` trong ${r.ketQua.gioDenKQ}h` : "";
      bh.push({
        muc: "tot",
        tieuDe: `📝 Tín hiệu giấy thắng ${rR}`,
        chiTiet: `${r.coin} ${String(r.side).toUpperCase()} ${r.diem}đ ngày ${r.ngay || "—"} — setup tốt nhất ngày nhưng không đủ chuẩn vào lệnh thật; bias4h ${r.bias4h || "—"}, phiên ${r.phien || "—"}${gio}.`,
        goiY: "Đối chiếu điều kiện đã chặn nó thành tín hiệu thật (thường là phase SMC chưa đạt alert_ready/retest_in_progress): nếu mẫu 'giấy thắng' lặp lại khi bias4h đồng thuận hướng, đó là ứng viên để nới lỏng có kiểm soát — quyết định thuộc về bạn, không tự động đổi luật.",
      });
    }
    for (const r of dsGiay.filter(x => x.trangThai === "thua").slice(-3)) {
      bh.push({
        muc: "ghi_nho",
        tieuDe: "📝 Tín hiệu giấy cũng sai",
        chiTiet: `${r.coin} ${String(r.side).toUpperCase()} ${r.diem}đ ngày ${r.ngay || "—"} thua — chuẩn vào lệnh thật đã lọc đúng trường hợp này.`,
        goiY: "Không có gì phải tiếc: hệ thống đã tránh được một lệnh thua.",
      });
    }
    if (G.xong >= 3 && st.xong >= 3 && G.winRate - st.winRate >= 20)
      bh.push({
        muc: "warn",
        tieuDe: "📝 Giấy đang 'ăn' hơn thật",
        chiTiet: `Tín hiệu giấy thắng ${G.winRate}% (${G.xong} lệnh) so với tín hiệu thật ${st.winRate}% (${st.xong} lệnh).`,
        goiY: "Mẫu còn nhỏ nhưng đáng theo dõi: gom các setup giấy thắng, tìm điểm chung (bias4h/phiên/khung điểm) rồi mới quyết định có điều chỉnh chuẩn vào lệnh.",
      });
  }
  if (!bh.length)
    bh.push({ muc: "ghi_nho", tieuDe: "📊 Chưa có điểm khác biệt rõ", chiTiet: `Đã có ${st.xong} lệnh nhưng các nhóm chưa phân hóa đủ mạnh.`, goiY: "Tiếp tục tích lũy — bài học sẽ rõ dần theo mẫu." });
  return bh;
}

/* ============================================================
 * Màn hình: 📝 Sổ tín hiệu — nhật ký, thống kê, bài học Kaizen
 * ============================================================ */
const TRANG_THAI_JOURNAL = {
  dang_theo_doi: ["⏳ Đang theo dõi", "warn"],
  thang: ["✅ Thắng (chạm TP1)", "up"],
  thua: ["❌ Thua (chạm SL)", "down"],
  het_han: ["⌛ Hết hạn 48h", "muted"],
};
function fmtNgayGio(ts) {
  try { return new Date(ts).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return "—"; }
}
function bangPhanBo(tieuDe, bucket) {
  const ks = Object.keys(bucket).sort((a, b) => bucket[b].wr - bucket[a].wr);
  if (!ks.length) return null;
  const tbl = el("table", { class: "mini-table" });
  tbl.appendChild(el("tr", {}, el("th", {}, tieuDe), el("th", {}, "Lệnh"), el("th", {}, "Win rate")));
  for (const k of ks.slice(0, 8)) {
    const v = bucket[k];
    tbl.appendChild(el("tr", {},
      el("td", {}, k),
      el("td", {}, String(v.n)),
      el("td", { class: v.wr >= 55 ? "up" : v.wr < 40 ? "down" : "" }, v.wr + "%")));
  }
  return el("div", { class: "card" }, el("div", { class: "card-title" }, tieuDe), tbl);
}

function renderSoTinHieu(root) {
  root.innerHTML = "";
  if (JOURNAL.hetBoNho()) {
    root.appendChild(el("div", { class: "note-box warn" },
      "⏸ Sổ đã ", el("b", {}, "dừng ghi"), " vì đầy (300 bản ghi). Tôi không tự xóa — bạn bấm nút Xóa bên dưới để dọn, hệ thống sẽ ghi tiếp."));
  }
  root.appendChild(el("div", { class: "note-box" },
    "📝 Mỗi tín hiệu ", el("b", {}, "LONG/SHORT được xác nhận"), " tự ghi lại thời điểm, entry/SL/TP vào sổ này. ",
    "Hệ thống dùng ", el("b", {}, "nến 15m thật"), " sau đó để chấm điểm đúng/sai → rút bài học Kaizen. ",
    el("span", { class: "muted small" }, "Giả định: khớp entry tại giá tín hiệu; SL chạm trước TP trong cùng nến → tính thua (bảo thủ); quá 48h chưa chạm → hết hạn."),
    el("br", {}),
    el("span", { class: "muted small" }, "Cột ", el("b", {}, "Stop"), ": giá SL khuyến nghị · ", el("b", {}, "Kết thúc"), ": giá TP/SL/giá cuối thực tế · ", el("b", {}, "±"), ": chênh lệch kết thúc − vào (", el("span", { class: "up" }, "xanh lãi"), "/", el("span", { class: "down" }, "đỏ lỗ"), ").")));

  const bar = el("div", { class: "toolbar" },
    el("button", { class: "btn primary", id: "journal-cham" }, "🔄 Chấm điểm tất cả"),
    el("button", { class: "btn danger", id: "journal-xoa" }, "🗑 Xóa nhật ký"),
    el("span", { class: "muted small", id: "journal-tiendo" }, ""));
  root.appendChild(bar);

  /* ---------- Trạm quan trắc 24/7 (chạy trên server, không cần mở web) ---------- */
  const TRAM_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/journal-247.json";
  const cTram = el("div", { class: "card", id: "tram-247" },
    el("div", { class: "card-title" }, "🛰️ Trạm quan trắc 24/7"),
    el("p", { class: "muted small" }, "Đang tải dữ liệu trạm…"));
  root.appendChild(cTram);
  (async () => {
    try {
      const resp = await fetch(TRAM_URL + "?t=" + Date.now());
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const d = await resp.json();
      cTram.innerHTML = "";
      const capNhat = d.capNhat ? fmtNgayGio(new Date(d.capNhat).getTime()) : "—";
      const dlTram = d.meta && d.meta.bytes ? ` · file ${d.meta.bytes < 1048576 ? Math.round(d.meta.bytes / 1024) + " KB" : (d.meta.bytes / 1048576).toFixed(1) + " MB"}` : "";
      cTram.appendChild(el("div", { class: "card-title" }, "🛰️ Trạm quan trắc 24/7",
        el("span", { class: "muted small" }, ` · cập nhật ${capNhat}${dlTram} · ${Array.isArray(d.vongQuet) ? d.vongQuet.join(" ") : ""}`)));
      const st = d.thongKe || {};
      cTram.appendChild(el("div", { class: "stat-row" },
        theStat("Tín hiệu trạm", String(st.tong || 0)),
        theStat("Đã ngã ngũ", String(st.xong || 0)),
        theStat("Win rate", (st.winRate || 0) + "%", st.xong >= 6 ? (st.winRate >= 50 ? "up" : "down") : ""),
        theStat("Expectancy", ((st.expectancy || 0) >= 0 ? "+" : "") + (st.expectancy || 0) + "R", st.xong >= 6 ? (st.expectancy >= 0 ? "up" : "down") : ""),
        theStat("Đang theo dõi", String(st.dangTheoDoi || 0)),
      ));
      const lessons = Array.isArray(d.baiHoc) ? d.baiHoc : [];
      if (lessons.length) {
        const cL = el("div", {}, el("div", { class: "card-title" }, `🧠 Bài học Kaizen từ trạm (${lessons.length})`));
        for (const l of lessons.slice(0, 6)) {
          const mau = l.muc === "tot" ? "up" : l.muc === "xau" ? "down" : "warn";
          cL.appendChild(el("div", { class: "kv" },
            el("div", {}, el("b", { class: mau }, l.tieuDe), el("div", { class: "muted small" }, l.chiTiet)),
            el("div", { class: "muted small", style: "max-width:46%" }, "💡 " + l.goiY)));
        }
        cTram.appendChild(cL);
      }
      // v2.5.1: bảng trạm CHỈ hiện tín hiệu thật — tín hiệu giấy nằm riêng ở mục bên dưới (tránh hiển thị trùng, tránh nhầm lẫn)
      const tinHieu = Array.isArray(d.tinHieu) ? d.tinHieu : [];
      const tinHieuThat = tinHieu.filter(r => r.loai !== "giay");
      const cT = el("div", {}, el("div", { class: "card-title" }, `📋 Tín hiệu thật từ trạm (${tinHieuThat.length})`));
      if (tinHieuThat.length) {
        const tbl = el("table", { class: "mini-table" });
        tbl.appendChild(el("tr", {},
          el("th", {}, "Giờ vào"), el("th", {}, "Coin"), el("th", {}, "Hướng"),
          el("th", {}, "Entry"), el("th", {}, "Stop"), el("th", {}, "Kết thúc"), el("th", {}, "±"),
          el("th", {}, "Điểm"), el("th", {}, "Trạng thái"), el("th", {}, "R")));
        for (const r of tinHieuThat.slice(0, 20)) {
          const [nhan, cls] = TRANG_THAI_JOURNAL[r.trangThai] || ["?", ""];
          const kq = r.ketQua;
          const gkt = giaKetThuc(r), cl = chenhLechGia(r);
          tbl.appendChild(el("tr", {},
            el("td", {}, fmtNgayGio(r.tsVao)),
            el("td", { class: "strong" }, r.coin),
            el("td", { class: r.side === "long" ? "up" : "down" }, r.side === "long" ? "🟢 LONG" : "🔴 SHORT"),
            el("td", {}, fmtGia(r.giaVao)),
            el("td", { class: "down" }, fmtGia(r.sl)),
            el("td", {}, gkt != null ? fmtGia(gkt) : "—"),
            el("td", { class: cl ? (cl.gia >= 0 ? "up" : "down") : "" }, fmtChenhLech(cl)),
            el("td", {}, String(r.diem)),
            el("td", { class: cls }, nhan),
            el("td", { class: kq && kq.r != null ? (kq.r >= 0 ? "up" : "down") : "" },
              kq && kq.r != null ? (kq.r >= 0 ? "+" : "") + kq.r + "R" : "—")));
        }
        cT.appendChild(tbl);
      } else {
        cT.appendChild(el("p", { class: "muted" }, "Trạm chưa ghi nhận tín hiệu LONG/SHORT nào."));
      }
      cTram.appendChild(cT);
      // v2.5.0: tín hiệu giấy (mục tiêu 1 tín hiệu/ngày) — tách khỏi thống kê thật
      const giay = tinHieu.filter(r => r.loai === "giay");
      if (giay.length) {
        const cG = el("div", {}, el("div", { class: "card-title" }, `📝 Tín hiệu giấy — mục tiêu 1/ngày (${giay.length})`),
          el("p", { class: "muted small" }, "Setup tốt nhất trong ngày khi không đủ chuẩn vào lệnh thật. Không tính vào win-rate thật, nhưng vẫn chấm điểm để Kaizen học mỗi ngày."));
        const tblG = el("table", { class: "mini-table" });
        tblG.appendChild(el("tr", {},
          el("th", {}, "Ngày"), el("th", {}, "Coin"), el("th", {}, "Hướng"),
          el("th", {}, "Entry"), el("th", {}, "Điểm"), el("th", {}, "Trạng thái"), el("th", {}, "R")));
        for (const r of giay.slice(0, 10)) {
          const [nhan, cls] = TRANG_THAI_JOURNAL[r.trangThai] || ["?", ""];
          const kq = r.ketQua;
          tblG.appendChild(el("tr", {},
            el("td", {}, r.ngay || fmtNgayGio(r.tsVao)),
            el("td", { class: "strong" }, r.coin),
            el("td", { class: r.side === "long" ? "up" : "down" }, r.side === "long" ? "🟢 LONG" : "🔴 SHORT"),
            el("td", {}, fmtGia(r.giaVao)),
            el("td", {}, String(r.diem)),
            el("td", { class: cls }, nhan),
            el("td", { class: kq && kq.r != null ? (kq.r >= 0 ? "up" : "down") : "" },
              kq && kq.r != null ? (kq.r >= 0 ? "+" : "") + kq.r + "R" : "—")));
        }
        cG.appendChild(tblG);
        cTram.appendChild(cG);
      }
    } catch (e) {
      cTram.innerHTML = "";
      cTram.appendChild(el("div", { class: "card-title" }, "🛰️ Trạm quan trắc 24/7"));
      cTram.appendChild(el("p", { class: "muted" }, "Không tải được dữ liệu trạm lúc này (mạng/GitHub). Trạm vẫn chạy ngầm trên server, mở lại sau sẽ thấy."));
    }
  })();

  const ve = () => {
    const ds = JOURNAL.all().slice().reverse();
    const st = thongKeJournal(JOURNAL.all());
    // dọn stat cũ
    root.querySelectorAll(".journal-dong").forEach(n => n.remove());

    const khoi = el("div", { class: "journal-dong" });
    khoi.appendChild(el("div", { class: "stat-row" },
      theStat("Tổng tín hiệu", String(st.tong)),
      theStat("Đã ngã ngũ", String(st.xong)),
      theStat("Win rate", st.winRate + "%", st.xong >= 6 ? (st.winRate >= 50 ? "up" : "down") : ""),
      theStat("Expectancy", (st.expectancy >= 0 ? "+" : "") + st.expectancy + "R", st.xong >= 6 ? (st.expectancy >= 0 ? "up" : "down") : ""),
      theStat("TB giờ tới TP", st.tbGioDenTP ? st.tbGioDenTP + "h" : "—"),
    ));

    // Phân bổ
    const grid = el("div", { class: "bot-grid" });
    const b1 = bangPhanBo("📊 Theo hướng", st.theo.side);
    const b2 = bangPhanBo("🪙 Theo coin", st.theo.coin);
    const b3 = bangPhanBo("🎯 Theo nhóm điểm", st.theo.nhomDiem);
    const b4 = bangPhanBo("🕰️ Theo phiên", st.theo.phien);
    for (const b of [b1, b2, b3, b4]) if (b) grid.appendChild(b);
    khoi.appendChild(grid);

    // Bài học Kaizen
    const lessons = rutBaiHocKaizen(st, JOURNAL.all());
    const cL = el("div", { class: "card" }, el("div", { class: "card-title" }, `🧠 Bài học Kaizen (${lessons.length})`));
    for (const l of lessons) {
      const mau = l.muc === "tot" ? "up" : l.muc === "xau" ? "down" : "warn";
      cL.appendChild(el("div", { class: "kv" },
        el("div", {}, el("b", { class: mau }, l.tieuDe), el("div", { class: "muted small" }, l.chiTiet)),
        el("div", { class: "muted small", style: "max-width:46%" }, "💡 " + l.goiY)));
    }
    khoi.appendChild(cL);

    // Bảng chi tiết
    const cT = el("div", { class: "card" }, el("div", { class: "card-title" }, `📋 Chi tiết tín hiệu (${ds.length})`));
    if (!ds.length) {
      cT.appendChild(el("p", { class: "muted" }, "Chưa có tín hiệu nào được ghi nhận. Mỗi khi màn hình Tín hiệu cho ra LONG/SHORT xác nhận, hệ thống tự lưu vào đây."));
    } else {
      const tbl = el("table", { class: "mini-table" });
      tbl.appendChild(el("tr", {},
        el("th", {}, "Giờ vào"), el("th", {}, "Coin"), el("th", {}, "Hướng"),
        el("th", {}, "Entry"), el("th", {}, "SL"), el("th", {}, "TP1"),
        el("th", {}, "Kết thúc"), el("th", {}, "±"),
        el("th", {}, "Điểm"), el("th", {}, "Trạng thái"), el("th", {}, "R"), el("th", {}, "Giờ tới KQ")));
      for (const r of ds.slice(0, 100)) {
        const [nhan, cls] = TRANG_THAI_JOURNAL[r.trangThai] || ["?", ""];
        const kq = r.ketQua;
        const gkt = giaKetThuc(r), cl = chenhLechGia(r);
        tbl.appendChild(el("tr", {},
          el("td", {}, fmtNgayGio(r.tsVao)),
          el("td", { class: "strong" }, r.coin),
          el("td", { class: r.side === "long" ? "up" : "down" }, r.side === "long" ? "🟢 LONG" : "🔴 SHORT"),
          el("td", {}, fmtGia(r.giaVao)),
          el("td", {}, fmtGia(r.sl)),
          el("td", {}, fmtGia(r.tp)),
          el("td", {}, gkt != null ? fmtGia(gkt) : "—"),
          el("td", { class: cl ? (cl.gia >= 0 ? "up" : "down") : "" }, fmtChenhLech(cl)),
          el("td", {}, String(r.diem)),
          el("td", { class: cls }, nhan),
          el("td", { class: kq && kq.r != null ? (kq.r >= 0 ? "up" : "down") : "" },
            kq && kq.r != null ? (kq.r >= 0 ? "+" : "") + kq.r + "R" : "—"),
          el("td", {}, kq?.gioDenKQ != null ? kq.gioDenKQ + "h" : "—")));
      }
      cT.appendChild(tbl);
      if (ds.length > 100) cT.appendChild(el("p", { class: "muted small" }, `Hiện 100/${ds.length} tín hiệu mới nhất.`));
    }
    khoi.appendChild(cT);
    root.appendChild(khoi);
  };
  ve();

  $("#journal-cham").onclick = async (e) => {
    const btn = e.target, td = $("#journal-tiendo");
    btn.disabled = true;
    try {
      const kq = await JOURNAL.chamDiemTatCa((i, n) => { if (td) td.textContent = `Đang chấm ${i}/${n}…`; });
      if (td) td.textContent = kq.tong ? `Xong: ${kq.ok} chấm được, ${kq.loi} lỗi (trong ${kq.tong} đang theo dõi)` : "Không có tín hiệu nào đang theo dõi.";
    } catch (err) { if (td) td.textContent = "Lỗi: " + err.message; }
    btn.disabled = false;
    ve();
  };
  $("#journal-xoa").onclick = () => {
    if (confirm("Xóa toàn bộ nhật ký tín hiệu? Không thể hoàn tác.")) { JOURNAL.xoaHet(); ve(); }
  };
}
