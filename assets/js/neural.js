/* ============================================================
 * Trade.2026 v2.16.0 — Mạng nơ-ron MLP dự đoán xác suất thắng tín hiệu
 * ----------------------------------------------------------------------------
 * Ý tưởng (từ tài liệu "Bản đồ kiến thức mạng nơ-ron trong AI"):
 *  - Bài toán = HỌC CÓ GIÁM SÁT: đầu vào là đặc trưng tín hiệu (đã có lúc phát
 *    tín hiệu), nhãn là kết quả thật (thắng/thua theo netR khi ngã ngũ).
 *  - Kiến trúc = MLP nhỏ (24 → 8 → 1): 12 giá trị đặc trưng + 12 cờ thiếu
 *    (missing mask) — raw thiếu giữ null, KHÔNG dùng 0.5 trung tính.
 *  - Vòng lặp huấn luyện chuẩn: forward → loss (BCE) → backprop → SGD,
 *    chia train/val/test THEO THỜI GIAN + purge overlap, SO SÁNH VỚI BASELINE
 *    (fit trên train) trước khi tin.
 *
 * TRUNG THỰC VỀ DỮ LIỆU (audit 01/10/2026):
 *  - Snapshot đặc trưng v2 được chụp TẠI THỜI ĐIỂM PHÁT TÍN HIỆU; trainer chỉ
 *    đọc snapshot đã lưu — không tái dựng đặc trưng từ dữ liệu thiếu.
 *  - Bản ghi legacy (không có snapshot v2) bị LOẠI khỏi train — báo 0 mẫu
 *    hợp lệ là trung thực, không phải lỗi.
 *  - Nhãn y = 1 nếu netR > 0 (R ròng sau phí 5bps + trượt giá 2bps mỗi chiều).
 *    khong_ro / thieu_du_lieu / tín hiệu giấy bị loại khỏi train.
 *  - Xác suất CHƯA hiệu chuẩn (calibrated=false) — UI phải ghi rõ.
 *  - Mỗi tín hiệu ngã ngũ = 1 mẫu học. Cổng kỹ thuật: 100 mẫu hợp lệ.
 *  - File trọng số luôn ghi rõ số mẫu + metric + baseline + checksum để ai
 *    đọc cũng biết mức tin cậy. Thăng cấp từ shadow → chính thức là QUYẾT
 *    ĐỊNH CỦA USER, không bao giờ tự động.
 *
 * Dùng được ở cả 3 nơi (không dependency): trình duyệt, collector-247 (node),
 * tools/train-nn.js (node). Cuối file có module.exports guard cho node.
 * ============================================================ */
"use strict";

/* ---------- RNG có seed (tái tạo được) ---------- */
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v) => Math.min(1, Math.max(0, +v || 0));

/* ---------- 12 đặc trưng thô + 12 cờ thiếu = 24 đầu vào (v2.16.0, audit A02) ----------
 * Mọi đặc trưng đều phải biết được TẠI THỜI ĐIỂM PHÁT TÍN HIỆU.
 * raw thiếu = null (KHÔNG dùng 0.5 trung tính như v1 — gây lệch train/serve);
 * vector[0..11] = giá trị chuẩn hóa 0..1 (thiếu → 0),
 * vector[12..23] = cờ thiếu (1 = raw thiếu, 0 = có giá trị).
 * Thứ tự cố định theo bảng audit §6.1. */
const NN_NEN_LOAI = { "MẠNH": 1, "TRUNG BÌNH": 0.66, "YẾU": 0.33, "CHỐNG LỆNH": 0 };
const NN_TEN_DAC_TRUNG = ["diem", "rr", "side", "bias", "killzone", "cauTrucNguoc", "chochNguoc",
  "obDiem", "obCham", "nenDiem", "nenXepLoai", "checklistDat"];
function doManhBias(bias) {
  const b = String(bias || "");
  if (!/bullish|bearish/i.test(b)) return 0;
  return /yếu|yeu/i.test(b) ? 0.5 : 1;
}
/* raw: 12 trường, null khi thiếu. BẮT BUỘC: diem, rr, side, bias, checklistDat. */
function dacTrungTho(f) {
  f = f || {};
  const so = (v) => (v == null || !isFinite(+v)) ? null : +v;
  const bl = (v) => (v == null ? null : !!v);
  return {
    diem: so(f.diem),
    rr: so(f.rr),
    side: f.side === "long" ? "long" : f.side === "short" ? "short" : null,
    bias: f.bias != null ? String(f.bias) : null,
    killzone: bl(f.killzone),
    cauTrucNguoc: bl(f.cauTrucNguoc),
    chochNguoc: bl(f.chochNguoc),
    obDiem: so(f.obDiem),
    obCham: so(f.obCham),
    nenDiem: so(f.nenDiem),
    nenXepLoai: f.nenXepLoai != null ? String(f.nenXepLoai) : null,
    checklistDat: so(f.checklistDat),
  };
}
function trichDacTrung(f) {
  const raw = dacTrungTho(f);
  const thieu = (v) => (v == null ? 1 : 0);
  const giaTri = [
    clamp01((raw.diem || 0) / 100),                        // 0  điểm engine
    clamp01(Math.min(raw.rr || 0, 3) / 3),                 // 1  RR
    raw.side === "long" ? 1 : 0,                           // 2  hướng
    clamp01(doManhBias(raw.bias)),                         // 3  độ mạnh bias 4H
    raw.killzone ? 1 : 0,                                 // 4  killzone active (boolean)
    raw.cauTrucNguoc ? 1 : 0,                             // 5  ngược cấu trúc 4H
    raw.chochNguoc ? 1 : 0,                               // 6  CHoCH 1H ngược hướng
    clamp01((raw.obDiem || 0) / 100),                      // 7  điểm chất lượng OB
    1 - Math.min(raw.obCham || 0, 4) / 4,                  // 8  OB còn tươi (ít chạm)
    clamp01((raw.nenDiem || 0) / 100),                     // 9  điểm chất lượng nến
    raw.nenXepLoai != null && NN_NEN_LOAI[raw.nenXepLoai] != null ? NN_NEN_LOAI[raw.nenXepLoai] : 0, // 10 loại nến
    clamp01(Math.min(raw.checklistDat || 0, 6) / 6),       // 11 checklist ĐẠT (v2.16.0: /6, trước đây /8 sai)
  ];
  const co = [
    thieu(raw.diem), thieu(raw.rr), thieu(raw.side), thieu(raw.bias),
    thieu(raw.killzone), thieu(raw.cauTrucNguoc), thieu(raw.chochNguoc),
    thieu(raw.obDiem), thieu(raw.obCham), thieu(raw.nenDiem),
    thieu(raw.nenXepLoai), thieu(raw.checklistDat),
  ];
  return giaTri.concat(co);
}
const NN_SO_DAC_TRUNG = 24; // v2.16.0: 12 giá trị + 12 cờ thiếu
const NN_KIEN_TRUC = [24, 8, 1]; // v2.16.0: 209 tham số
const NN_PHEN_BAN_DAC_TRUNG = "dac-trung-v2-missing-mask";
const NN_STRATEGY_VERSION = "closed-candle-v1";

/* Adapter: kết quả engine (lúc phát tín hiệu) → đặc trưng thô (null-safe).
 * v2.16.0 (A01): checklist đếm mục ĐẠT (dat===true), không đếm tổng — khớp journal.
 * v2.16.0 (A02): killzone dùng boolean active, không suy từ tên. */
function dacTrungTuEngine(kq) {
  if (!kq) return null;
  const ob = kq.chatLuongOB || {}, nen = kq.chatLuongNen || {}, ct = kq.cauTruc || {};
  const kz = kq.killzone || {};
  return dacTrungTho({
    diem: kq.score,
    rr: kq.plan ? kq.plan.rr1 : null,
    side: kq.verdict === "LONG" ? "long" : kq.verdict === "SHORT" ? "short" : (kq.side || null),
    bias: kq.htf ? kq.htf.bias : null,
    killzone: typeof kz.active === "boolean" ? kz.active : null,
    cauTrucNguoc: ct.nguocCauTruc,
    chochNguoc: ct.chochNguoc,
    obDiem: ob.diem, obCham: ob.soLanCham,
    nenDiem: nen.diem, nenXepLoai: nen.xepLoai,
    checklistDat: Array.isArray(kq.checklist) ? kq.checklist.filter(c => c && c.dat).length : null,
  });
}
/* ---------- Hợp đồng snapshot v2 (audit §6.2) ----------
 * Snapshot được chụp TẠI THỜI ĐIỂM PHÁT TÍN HIỆU, copy khi lưu journal.
 * KHÔNG dùng dữ liệu outcome để điền lại raw/vector. */
function taoSnapshotDacTrung(kq, provenance) {
  const raw = dacTrungTuEngine(kq);
  if (!raw) return null;
  // trường bắt buộc: thiếu → snapshot không hợp lệ
  const batBuoc = ["diem", "rr", "side", "bias", "checklistDat"];
  const thieuBB = batBuoc.filter(k => raw[k] == null);
  if (thieuBB.length) return null;
  const asOf = (kq && kq.time) || Date.now();
  const vector = trichDacTrung(raw);
  const missing = NN_TEN_DAC_TRUNG.filter((k, i) => vector[12 + i] === 1);
  return {
    schemaVersion: 2,
    featureVersion: NN_PHEN_BAN_DAC_TRUNG,
    strategyVersion: NN_STRATEGY_VERSION,
    asOf,
    raw,
    vector,
    missing,
    provenance: provenance || null, // 3 bản ghi nến 4h/1h/15m: {khung, openTime, closeTime, availableAt}
  };
}
function kiemTraSnapshot(snap) {
  if (!snap || typeof snap !== "object") return { ok: false, lyDo: "KHONG_PHAI_OBJECT" };
  if (snap.schemaVersion !== 2) return { ok: false, lyDo: "SCHEMA_VERSION_SAI" };
  if (snap.featureVersion !== NN_PHEN_BAN_DAC_TRUNG) return { ok: false, lyDo: "PHIEN_BAN_DAC_TRUNG_SAI" };
  if (!Array.isArray(snap.vector) || snap.vector.length !== NN_SO_DAC_TRUNG)
    return { ok: false, lyDo: "VECTOR_SAI_KICH_THUOC" };
  if (!snap.vector.every(v => typeof v === "number" && isFinite(v)))
    return { ok: false, lyDo: "VECTOR_KHONG_HUU_HAN" };
  if (!(snap.asOf > 0)) return { ok: false, lyDo: "ASOF_SAI" };
  return { ok: true };
}
/* Nhãn học (audit §6.3): y = 1 nếu netR > 0 trong kịch bản mô phỏng đã định nghĩa.
 * LOẠI: khong_ro (SL&TP cùng nến), thieu_du_lieu, dang_theo_doi, tín hiệu giấy. */
function nhanMau(rec) {
  const tt = rec && rec.trangThai;
  if (tt !== "thang" && tt !== "thua" && tt !== "het_han") return null;
  if (rec.loai === "giay") return null; // giấy chọn cuối ngày: lựa chọn sau thời điểm setup
  const kq = rec.ketQua || {};
  if (kq.netR != null && isFinite(+kq.netR)) return +kq.netR > 0 ? 1 : 0;
  // legacy (chưa có netR): suy từ giá vào/kết thúc với cùng giả định chi phí
  const entry = +rec.giaVao;
  const exit = kq.giaKetThuc != null ? +kq.giaKetThuc : (kq.giaKT != null ? +kq.giaKT : NaN);
  const risk = Math.abs(entry - (+rec.sl));
  if (entry > 0 && exit > 0 && risk > 0) {
    const grossR = rec.side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
    const costR = (entry + exit) * 7 / 10000 / risk;
    return (grossR - costR) > 0 ? 1 : 0;
  }
  if (kq.r != null && isFinite(+kq.r)) return +kq.r > 0 ? 1 : 0;
  return null;
}
/* Tập dữ liệu train từ journal: CHỈ bản ghi có snapshot v2 hợp lệ (audit §6.4).
 * Bản ghi legacy thiếu snapshot → bị loại (báo 0 mẫu hợp lệ là trung thực).
 * Trả về thêm asOf/ketQuaAt để trainer chia theo thời gian + purge. */
function taoTapDuLieu(records) {
  const X = [], Y = [], ids = [], asOf = [], ketQuaAt = [];
  const thay = new Set();
  for (const rec of records || []) {
    if (!rec || thay.has(rec.id)) continue;
    thay.add(rec.id);
    const y = nhanMau(rec);
    if (y == null) continue;
    const snap = rec.featureSnapshot || rec.snapshot || null;
    const kt = kiemTraSnapshot(snap);
    if (!kt.ok) continue;
    X.push(snap.vector.slice());
    Y.push(y);
    ids.push(rec.id);
    asOf.push(snap.asOf);
    ketQuaAt.push(rec.ketQua && rec.ketQua.at > 0 ? +rec.ketQua.at : snap.asOf);
  }
  return { X, Y, ids, asOf, ketQuaAt, n: X.length };
}

/* ---------- MLP: forward / backprop / SGD từ scratch ---------- */
const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, z))));
const relu = (z) => (z > 0 ? z : 0);

class MLP {
  constructor(sizes, seed) {
    this.sizes = sizes.slice();
    const rnd = mulberry32(seed == null ? 42 : seed);
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = sizes[l], fanOut = sizes[l + 1];
      const lim = Math.sqrt(6 / (fanIn + fanOut)); // Xavier uniform
      const Wl = [];
      for (let i = 0; i < fanOut; i++) {
        const row = [];
        for (let j = 0; j < fanIn; j++) row.push((rnd() * 2 - 1) * lim);
        Wl.push(row);
      }
      this.W.push(Wl);
      this.b.push(new Array(fanOut).fill(0));
    }
  }
  /* forward trả cache để backprop dùng lại */
  forward(x) {
    const A = [x.slice()], Z = [];
    let cur = x.slice();
    for (let l = 0; l < this.W.length; l++) {
      const last = l === this.W.length - 1;
      const z = this.W[l].map((row, i) => row.reduce((s, w, j) => s + w * cur[j], 0) + this.b[l][i]);
      Z.push(z);
      cur = last ? z.map(sigmoid) : z.map(relu);
      A.push(cur);
    }
    return { A, Z, out: cur[0] };
  }
  duDoan(x) { return this.forward(x).out; }

  /* 1 bước SGD trên batch (BCE loss). Trả về loss trung bình batch. */
  _buocHoc(Xb, Yb, lr) {
    const L = this.W.length;
    const gW = this.W.map(Wl => Wl.map(r => r.map(() => 0)));
    const gb = this.b.map(bl => bl.map(() => 0));
    let loss = 0;
    for (let s = 0; s < Xb.length; s++) {
      const { A, Z } = this.forward(Xb[s]);
      const y = Yb[s], o = Math.min(1 - 1e-9, Math.max(1e-9, A[L][0]));
      loss += -(y * Math.log(o) + (1 - y) * Math.log(1 - o));
      let delta = [o - y]; // dL/dz tầng cuối (BCE + sigmoid)
      for (let l = L - 1; l >= 0; l--) {
        for (let i = 0; i < delta.length; i++) {
          gb[l][i] += delta[i];
          for (let j = 0; j < gW[l][i].length; j++) gW[l][i][j] += delta[i] * A[l][j];
        }
        if (l > 0) {
          const prev = new Array(this.sizes[l]).fill(0);
          for (let j = 0; j < prev.length; j++) {
            let g = 0;
            for (let i = 0; i < delta.length; i++) g += this.W[l][i][j] * delta[i];
            prev[j] = g * (Z[l - 1][j] > 0 ? 1 : 0); // qua ReLU
          }
          delta = prev;
        }
      }
    }
    const n = Xb.length;
    for (let l = 0; l < L; l++)
      for (let i = 0; i < this.W[l].length; i++) {
        for (let j = 0; j < this.W[l][i].length; j++) this.W[l][i][j] -= lr * gW[l][i][j] / n;
        this.b[l][i] -= lr * gb[l][i] / n;
      }
    return loss / n;
  }

  doChinhXac(X, Y, nguong) {
    if (!X.length) return 0;
    const ng = nguong == null ? 0.5 : nguong;
    let dung = 0;
    for (let i = 0; i < X.length; i++) if ((this.duDoan(X[i]) >= ng ? 1 : 0) === Y[i]) dung++;
    return dung / X.length;
  }

  /* Huấn luyện full-batch + early stopping trên val. Trả về báo cáo. */
  hoc(X, Y, opts) {
    opts = opts || {};
    const seed = opts.seed == null ? 7 : opts.seed;
    const n = X.length;
    if (n < 4) return { loi: `quá ít mẫu (n=${n}), cần ≥4 để chia train/val` };
    // xáo trộn có seed rồi chia train/val (giữ ≥1 mẫu val, ≥2 mẫu train)
    const idx = X.map((_, i) => i);
    const rnd = mulberry32(seed);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[idx[i], idx[j]] = [idx[j], idx[i]]; }
    const nVal = Math.max(1, Math.min(n - 2, Math.round(n * 0.25)));
    const valIdx = idx.slice(0, nVal), trainIdx = idx.slice(nVal);
    return this.hocTheoChia(trainIdx.map(i => X[i]), trainIdx.map(i => Y[i]),
      valIdx.map(i => X[i]), valIdx.map(i => Y[i]), opts);
  }
  /* Huấn luyện với phần chia ĐÃ ĐỊNH SẴN (không xáo trộn) — dùng cho chia
   * theo thời gian + purge ở train-nn.js (audit A04). */
  hocTheoChia(tX, tY, vX, vY, opts) {
    opts = opts || {};
    const lr = opts.lr || 0.05, epochs = opts.epochs || 500;
    const patience = opts.patience != null ? opts.patience : 40;
    if (tX.length < 2 || vX.length < 1) return { loi: `phần chia không đủ (train=${tX.length}, val=${vX.length})` };

    let best = null, choDo = 0;
    const snap = () => JSON.parse(JSON.stringify({ W: this.W, b: this.b }));
    for (let ep = 1; ep <= epochs; ep++) {
      const trainLoss = this._buocHoc(tX, tY, lr);
      const valLoss = this._valLoss(vX, vY);
      if (!best || valLoss < best.valLoss - 1e-6) {
        best = { valLoss, trainLoss, ep, snap: snap(), valAcc: this.doChinhXac(vX, vY), trainAcc: this.doChinhXac(tX, tY) };
        choDo = 0;
      } else if (++choDo >= patience) break;
    }
    this.W = best.snap.W; this.b = best.snap.b; // khôi phục trọng số tốt nhất
    return {
      epochs: best.ep, trainLoss: +best.trainLoss.toFixed(4), valLoss: +best.valLoss.toFixed(4),
      trainAcc: +best.trainAcc.toFixed(3), valAcc: +best.valAcc.toFixed(3),
      nTrain: tX.length, nVal: vX.length,
    };
  }
  _valLoss(X, Y) {
    let s = 0;
    for (let i = 0; i < X.length; i++) {
      const o = Math.min(1 - 1e-9, Math.max(1e-9, this.duDoan(X[i])));
      s += -(Y[i] * Math.log(o) + (1 - Y[i]) * Math.log(1 - o));
    }
    return s / Math.max(1, X.length);
  }

  /* Xuất / nạp trọng số */
  xuat(meta) {
    return { version: 1, sizes: this.sizes, W: this.W, b: this.b, meta: meta || {} };
  }
  static nap(obj) {
    const m = new MLP(obj.sizes, 1);
    m.W = obj.W; m.b = obj.b;
    m.meta = obj.meta || {};
    return m;
  }
}

/* ---------- Facade dùng ở runtime (shadow mode) ---------- */
const NN_MAU_TOI_THIEU = 100; // cổng kỹ thuật (audit §6.4): dưới ngưỡng này chỉ quan sát
/* Feature registry (tài liệu §7): phiên bản + kiến trúc của bộ đặc trưng v2.
 * ĐỔI NN_PHEN_BAN_DAC_TRUNG khi thêm/bớt/sắp xếp lại đặc trưng — weights cũ
 * sẽ bị từ chối với trạng thái khong_tuong_thich thay vì chạy sai lặng lẽ.
 * (Khai báo ở đầu file; giữ comment này để nhắc quy tắc.) */

/* Checksum FNV-1a cho artifact trọng số — phát hiện file hỏng khi nạp. */
function bamKiemTra(obj) {
  const s = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8);
}

const NN = {
  _mlp: null,
  _cheDo: "shadow",       // feature flag 'shadow' | 'off' (tài liệu §4 P0)
  _khongTuongThich: null, // lý do lần nạp gần nhất (nếu có)
  /* Feature flag off|shadow. Mặc định shadow; 'off' tắt hẳn nhánh NN. */
  datCheDo(m) { this._cheDo = (m === "off") ? "off" : "shadow"; return this._cheDo; },
  cheDo() { return this._cheDo; },
  /* Kiểm tra tương thích artifact (audit A06): kiểm tra TỪNG HÀNG W/b hữu hạn,
   * phiên bản, kích thước, checksum — báo đúng phần hỏng thay vì chấp nhận mù.
   * v2.16.0: legacy (thiếu phienBanDacTrung/checksum) BỊ TỪ CHỐI. */
  kiemTraTuongThich(obj) {
    if (!obj || obj.version !== 1 || !Array.isArray(obj.sizes)) return { ok: false, lyDo: "CAU_TRUC_FILE_SAI" };
    const sz = obj.sizes;
    const dungKT = sz.length === NN_KIEN_TRUC.length && sz.every((v, i) => v === NN_KIEN_TRUC[i]);
    if (!dungKT) return { ok: false, lyDo: "KIEN_TRUC_KHAC_BIET" };
    const W = obj.W, b = obj.b;
    if (!Array.isArray(W) || !Array.isArray(b) || W.length !== sz.length - 1 || b.length !== sz.length - 1)
      return { ok: false, lyDo: "KICH_THUOC_TRONG_SO_SAI" };
    for (let l = 0; l < W.length; l++) {
      if (!Array.isArray(W[l]) || W[l].length !== sz[l + 1]) return { ok: false, lyDo: "W_SAI_HANG_L" + l };
      for (let i = 0; i < W[l].length; i++) {
        if (!Array.isArray(W[l][i]) || W[l][i].length !== sz[l]) return { ok: false, lyDo: "W_SAI_COT_L" + l };
        for (let j = 0; j < W[l][i].length; j++)
          if (typeof W[l][i][j] !== "number" || !isFinite(W[l][i][j]))
            return { ok: false, lyDo: "W_KHONG_HUU_HAN_L" + l };
      }
      if (!Array.isArray(b[l]) || b[l].length !== sz[l + 1]) return { ok: false, lyDo: "B_SAI_HANG_L" + l };
      for (let i = 0; i < b[l].length; i++)
        if (typeof b[l][i] !== "number" || !isFinite(b[l][i]))
          return { ok: false, lyDo: "B_KHONG_HUU_HAN_L" + l };
    }
    const meta = obj.meta || {};
    /* v2.16.0 (A06): legacy thiếu phiên bản ĐẶC TRƯNG BỊ TỪ CHỐI — không còn
     * nhánh "cho qua". Weights v2.13.x–2.15.x (12 input) đã bị loại ở
     * KIEN_TRUC_KHAC_BIET; nhánh này chặn artifact 24-input không rõ nguồn gốc. */
    if (meta.phienBanDacTrung !== NN_PHEN_BAN_DAC_TRUNG)
      return { ok: false, lyDo: "PHIEN_BAN_DAC_TRUNG_KHAC" };
    if (!(isFinite(+meta.mau) && +meta.mau > 0))
      return { ok: false, lyDo: "SO_MAU_SAI" };
    if (meta.checksum == null) return { ok: false, lyDo: "CHECKSUM_THIEU" };
    const tinh = bamKiemTra({ sizes: obj.sizes, W: obj.W, b: obj.b });
    if (tinh !== meta.checksum) return { ok: false, lyDo: "CHECKSUM_SAI" };
    return { ok: true };
  },
  napTrongSo(obj) {
    try {
      const kt = this.kiemTraTuongThich(obj);
      if (!kt.ok) { this._mlp = null; this._khongTuongThich = kt.lyDo; return false; }
      this._mlp = MLP.nap(obj);
      this._khongTuongThich = null;
      return true;
    } catch (e) { this._mlp = null; this._khongTuongThich = "NAP_THAT_BAI"; return false; }
  },
  sanSang() { return !!this._mlp; },
  thongTin() { return this._mlp ? this._mlp.meta : null; },
  /* Xác suất 0..1 từ VECTOR 24 đã kiểm tra, hoặc null. KHÔNG quyết định gì. */
  duDoan(vector) {
    try {
      if (!this._mlp || !Array.isArray(vector) || vector.length !== NN_SO_DAC_TRUNG) return null;
      if (!vector.every(v => typeof v === "number" && isFinite(v))) return null;
      const p = this._mlp.duDoan(vector);
      return Math.min(1, Math.max(0, +p.toFixed(4)));
    } catch (e) { return null; }
  },
  /* Hợp đồng assessment v2 (audit §6.2): trạng thái rõ ràng, KHÔNG số giả.
   * status: tat | chua_huan_luyen | khong_tuong_thich | thieu_du_lieu | san_sang | loi
   * p: xác suất 0..1 khi san_sang, ngược lại null.
   * calibrated=false: xác suất CHƯA hiệu chuẩn — UI phải ghi rõ. */
  danhGia(kq) {
    const bayGio = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const t0 = bayGio();
    const base = {
      mode: this._cheDo, status: "loi", p: null, modelVersion: null,
      phienBanDacTrung: NN_PHEN_BAN_DAC_TRUNG, doTreMs: 0, lyDo: [], calibrated: false,
    };
    const xong = (patch) => Object.assign(base, patch, { doTreMs: +((bayGio() - t0).toFixed(2)) });
    if (this._cheDo === "off") return xong({ status: "tat", lyDo: ["NN_MODE_OFF"] });
    if (this._khongTuongThich) return xong({ status: "khong_tuong_thich", lyDo: [this._khongTuongThich] });
    if (!this._mlp) return xong({ status: "chua_huan_luyen", lyDo: ["MODEL_NOT_AVAILABLE"] });
    let snap = (kq && kq.featureSnapshot) || null;
    let kt = kiemTraSnapshot(snap);
    if (!kt.ok) {
      try { snap = taoSnapshotDacTrung(kq); } catch (e) { snap = null; }
      kt = kiemTraSnapshot(snap);
    }
    if (!kt.ok) return xong({ status: "thieu_du_lieu", lyDo: [kt.lyDo] });
    const p = this.duDoan(snap.vector);
    if (p == null || !isFinite(p)) return xong({ status: "loi", lyDo: ["DU_DOAN_THAT_BAI"] });
    const meta = this._mlp.meta || {};
    return xong({ status: "san_sang", p, modelVersion: meta.phienBan || meta.ngay || null });
  },
  /* Dòng mô tả trạng thái cho UI chẩn đoán/cài đặt (tiếng Việt, trung thực). */
  moTaTrangThai() {
    const tt = this.thongTin() || {};
    const mau = tt.mau != null ? tt.mau : "?";
    const val = tt.valAcc != null ? tt.valAcc : "?";
    if (this._cheDo === "off") return "Đã tắt (off) — mô-đun NN không chạy.";
    if (this._khongTuongThich) return "Mô hình không tương thích (" + this._khongTuongThich + ") — cần train lại theo hợp đồng v2.";
    if (!this._mlp) return "Chưa huấn luyện (not_trained) — đang quan sát, chưa có dự báo.";
    return "Shadow: đã nạp mô hình (" + mau + " mẫu, valAcc " + val + ", chưa hiệu chuẩn) — chỉ quan sát, không ảnh hưởng tín hiệu.";
  },
  /* v2.16.0 (A19): BỎ buChoCache — xác suất chỉ từ assessment hợp lệ tại thời
   * điểm inference; không bù dự báo vào sự kiện cũ. */
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { MLP, NN, trichDacTrung, dacTrungTho, dacTrungTuEngine, taoSnapshotDacTrung, kiemTraSnapshot, nhanMau, taoTapDuLieu, NN_MAU_TOI_THIEU, NN_SO_DAC_TRUNG, NN_PHEN_BAN_DAC_TRUNG, NN_STRATEGY_VERSION, NN_TEN_DAC_TRUNG, NN_KIEN_TRUC, bamKiemTra, mulberry32 };
}
