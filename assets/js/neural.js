/* ============================================================
 * Trade.2026 v2.13.0 — Mạng nơ-ron MLP dự đoán xác suất thắng tín hiệu
 * ----------------------------------------------------------------------------
 * Ý tưởng (từ tài liệu "Bản đồ kiến thức mạng nơ-ron trong AI"):
 *  - Bài toán = HỌC CÓ GIÁM SÁT: đầu vào là đặc trưng tín hiệu (đã có lúc phát
 *    tín hiệu), nhãn là kết quả thật (thắng/thua theo R khi ngã ngũ).
 *  - Kiến trúc = MLP nhỏ (12 → 8 → 1): tài liệu khuyên "bắt đầu từ baseline
 *    rồi thử mô hình chuỗi" — dữ liệu hiện tại quá ít cho LSTM/Transformer.
 *  - Vòng lặp huấn luyện chuẩn: forward → loss (BCE) → backprop → SGD,
 *    chia train/val, early stopping, SO SÁNH VỚI BASELINE trước khi tin.
 *
 * TRUNG THỰC VỀ DỮ LIỆU:
 *  - Mỗi tín hiệu ngã ngũ = 1 mẫu học. Với <30 mẫu, mạng CHỈ CHẠY SHADOW
 *    (quan sát, không ảnh hưởng điểm/verdict) — đúng nguyên tắc "không tự
 *    nới luật theo mẫu nhỏ" của dự án.
 *  - File trọng số luôn ghi rõ số mẫu + valAcc + baselineAcc để ai đọc cũng
 *    biết mức tin cậy. Thăng cấp từ shadow → chính thức là QUYẾT ĐỊNH CỦA
 *    USER, không bao giờ tự động.
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

/* ---------- 12 đặc trưng (đều biết được TẠI THỜI ĐIỂM PHÁT TÍN HIỆU) ----------
 * Mọi đặc trưng chuẩn hóa về 0..1 và null-safe: tín hiệu cũ thiếu trường
 * (cauTruc/ob/nen) thì dùng giá trị trung tính 0.5 thay vì bỏ mẫu. */
const NN_NEN_LOAI = { "MẠNH": 1, "TRUNG BÌNH": 0.66, "YẾU": 0.33, "CHỐNG LỆNH": 0 };
function doManhBias(bias) {
  const b = String(bias || "");
  if (!/bullish|bearish/i.test(b)) return 0;
  return /yếu|yeu/i.test(b) ? 0.5 : 1;
}
function trichDacTrung(f) {
  f = f || {};
  return [
    clamp01((f.diem || 0) / 100),                       // 0  điểm engine
    clamp01(Math.min(f.rr || 0, 3) / 3),                // 1  RR
    f.side === "long" ? 1 : 0,                         // 2  hướng
    clamp01(doManhBias(f.bias)),                        // 3  độ mạnh bias 4H
    f.killzoneNong ? 1 : 0,                            // 4  đang trong killzone nóng
    f.cauTrucNguoc ? 1 : 0,                            // 5  ngược cấu trúc 4H
    f.cauTrucChoch ? 1 : 0,                            // 6  CHoCH 1H ngược hướng
    clamp01((f.obDiem != null ? f.obDiem : 50) / 100),  // 7  điểm chất lượng OB
    1 - Math.min(f.obCham != null ? f.obCham : 2, 4) / 4, // 8  OB còn tươi (ít chạm)
    clamp01((f.nenDiem != null ? f.nenDiem : 50) / 100), // 9  điểm chất lượng nến
    NN_NEN_LOAI[f.nenXepLoai] != null ? NN_NEN_LOAI[f.nenXepLoai] : 0.5, // 10 loại nến
    clamp01(Math.min(f.checklist || 0, 8) / 8),         // 11 checklist đạt
  ];
}
const NN_SO_DAC_TRUNG = 12;

/* Adapter: kết quả engine (lúc phát tín hiệu) → đặc trưng phẳng */
function dacTrungTuEngine(kq) {
  if (!kq) return null;
  const ob = kq.chatLuongOB || {}, nen = kq.chatLuongNen || {}, ct = kq.cauTruc || {};
  const kz = kq.killzone || {};
  return {
    diem: kq.score,
    rr: kq.plan ? kq.plan.rr1 : null,
    side: kq.verdict === "LONG" ? "long" : kq.verdict === "SHORT" ? "short" : (kq.side || null),
    bias: kq.htf ? kq.htf.bias : null,
    killzoneNong: !!(kz.ten || kz.id) && (kz.ten || kz.id) !== "—",
    cauTrucNguoc: !!ct.nguocCauTruc,
    cauTrucChoch: !!ct.chochNguoc,
    obDiem: ob.diem, obCham: ob.soLanCham,
    nenDiem: nen.diem, nenXepLoai: nen.xepLoai,
    checklist: Array.isArray(kq.checklist) ? kq.checklist.length : 0,
  };
}
/* Adapter: bản ghi journal (đã ngã ngũ) → đặc trưng phẳng */
function dacTrungTuJournal(rec) {
  if (!rec) return null;
  const ob = rec.ob || {}, nen = rec.nen || {}, ct = rec.cauTruc || {};
  return {
    diem: rec.diem,
    rr: rec.rr,
    side: rec.side,
    bias: rec.bias4h,
    killzoneNong: rec.phien && rec.phien !== "—",
    cauTrucNguoc: !!ct.nguoc,
    cauTrucChoch: !!ct.choch,
    obDiem: ob.diem, obCham: ob.cham,
    nenDiem: nen.diem, nenXepLoai: nen.xepLoai,
    checklist: Array.isArray(rec.checklist) ? rec.checklist.length : 0,
  };
}
/* Nhãn học: chỉ tín hiệu đã ngã ngũ; thắng = R > 0 (kể cả hết hạn lãi) */
function nhanMau(rec) {
  const tt = rec && rec.trangThai;
  if (tt !== "thang" && tt !== "thua" && tt !== "het_han") return null;
  const r = rec.ketQua && rec.ketQua.r;
  if (r == null || !isFinite(r)) return null;
  return r > 0 ? 1 : 0;
}
function taoTapDuLieu(records) {
  const X = [], Y = [], ids = [];
  for (const rec of records || []) {
    const y = nhanMau(rec);
    if (y == null) continue;
    X.push(trichDacTrung(dacTrungTuJournal(rec)));
    Y.push(y);
    ids.push(rec.id);
  }
  return { X, Y, ids, n: X.length };
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
    const lr = opts.lr || 0.05, epochs = opts.epochs || 500;
    const patience = opts.patience != null ? opts.patience : 40;
    const seed = opts.seed == null ? 7 : opts.seed;
    const n = X.length;
    if (n < 4) return { loi: `quá ít mẫu (n=${n}), cần ≥4 để chia train/val` };
    // xáo trộn có seed rồi chia train/val (giữ ≥1 mẫu val, ≥2 mẫu train)
    const idx = X.map((_, i) => i);
    const rnd = mulberry32(seed);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[idx[i], idx[j]] = [idx[j], idx[i]]; }
    const nVal = Math.max(1, Math.min(n - 2, Math.round(n * 0.25)));
    const valIdx = idx.slice(0, nVal), trainIdx = idx.slice(nVal);
    const tX = trainIdx.map(i => X[i]), tY = trainIdx.map(i => Y[i]);
    const vX = valIdx.map(i => X[i]), vY = valIdx.map(i => Y[i]);

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
const NN_MAU_TOI_THIEU = 30; // dưới ngưỡng này: chỉ quan sát, không ảnh hưởng tín hiệu
/* Feature registry (tài liệu §7): phiên bản + kiến trúc của bộ 12 đặc trưng.
 * ĐỔI NN_PHEN_BAN_DAC_TRUNG khi thêm/bớt/sắp xếp lại đặc trưng — weights cũ
 * sẽ bị từ chối với trạng thái khong_tuong_thich thay vì chạy sai lặng lẽ. */
const NN_PHEN_BAN_DAC_TRUNG = "dac-trung-v1";
const NN_KIEN_TRUC = [NN_SO_DAC_TRUNG, 8, 1];

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
  /* Kiểm tra tương thích artifact (tài liệu T09). Weights v2.13.x chưa có
   * phienBanDacTrung được coi là legacy của dac-trung-v1 nếu kiến trúc khớp. */
  kiemTraTuongThich(obj) {
    if (!obj || obj.version !== 1 || !Array.isArray(obj.sizes)) return { ok: false, lyDo: "CAU_TRUC_FILE_SAI" };
    const sz = obj.sizes;
    const dungKT = sz.length === NN_KIEN_TRUC.length && sz.every((v, i) => v === NN_KIEN_TRUC[i]);
    if (!dungKT) return { ok: false, lyDo: "KIEN_TRUC_KHAC_BIET" };
    const W = obj.W, b = obj.b;
    if (!Array.isArray(W) || !Array.isArray(b) || W.length !== sz.length - 1 || b.length !== sz.length - 1)
      return { ok: false, lyDo: "KICH_THUOC_TRONG_SO_SAI" };
    const meta = obj.meta || {};
    if (meta.phienBanDacTrung != null && meta.phienBanDacTrung !== NN_PHEN_BAN_DAC_TRUNG)
      return { ok: false, lyDo: "PHIEN_BAN_DAC_TRUNG_KHAC" };
    if (meta.checksum != null) {
      const tinh = bamKiemTra({ sizes: obj.sizes, W: obj.W, b: obj.b });
      if (tinh !== meta.checksum) return { ok: false, lyDo: "CHECKSUM_SAI" };
    }
    return { ok: true, legacy: meta.phienBanDacTrung == null };
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
  /* Xác suất thắng 0..1, hoặc null khi chưa có trọng số. KHÔNG quyết định gì. */
  duDoan(dacTrung) {
    try {
      if (!this._mlp || !dacTrung) return null;
      const p = this._mlp.duDoan(trichDacTrung(dacTrung));
      return Math.min(1, Math.max(0, +p.toFixed(4)));
    } catch (e) { return null; }
  },
  duDoanChoEngine(kq) { return this.duDoan(dacTrungTuEngine(kq)); },
  duDoanChoJournal(rec) { return this.duDoan(dacTrungTuJournal(rec)); },
  /* Hợp đồng assessment (tài liệu §6.4): trạng thái rõ ràng, KHÔNG số giả.
   * status: tat | chua_huan_luyen | khong_tuong_thich | thieu_du_lieu | san_sang | loi
   * p: xác suất 0..1 khi san_sang, ngược lại null. */
  danhGia(kq) {
    const bayGio = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const t0 = bayGio();
    const base = {
      mode: this._cheDo, status: "loi", p: null, modelVersion: null,
      phienBanDacTrung: NN_PHEN_BAN_DAC_TRUNG, doTreMs: 0, lyDo: [],
    };
    const xong = (patch) => Object.assign(base, patch, { doTreMs: +((bayGio() - t0).toFixed(2)) });
    if (this._cheDo === "off") return xong({ status: "tat", lyDo: ["NN_MODE_OFF"] });
    if (this._khongTuongThich) return xong({ status: "khong_tuong_thich", lyDo: [this._khongTuongThich] });
    if (!this._mlp) return xong({ status: "chua_huan_luyen", lyDo: ["MODEL_NOT_AVAILABLE"] });
    let fe = null;
    try { fe = dacTrungTuEngine(kq); } catch (e) { return xong({ status: "loi", lyDo: ["TRICH_DAC_TRUNG_LOI"] }); }
    if (!fe) return xong({ status: "thieu_du_lieu", lyDo: ["KHONG_CO_DAC_TRUNG"] });
    const p = this.duDoan(fe);
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
    if (this._khongTuongThich) return "Mô hình không tương thích (" + this._khongTuongThich + ") — cần train lại.";
    if (!this._mlp) return "Chưa huấn luyện (not_trained) — đang quan sát, chưa có dự báo.";
    return "Shadow: đã nạp mô hình (" + mau + " mẫu, valAcc " + val + ") — chỉ quan sát, không ảnh hưởng tín hiệu.";
  },
  /* v2.13.1: bù dự đoán cho các kết quả đã phân tích TRƯỚC khi weights về
   * (tránh race condition: thẻ vẽ trước, weights về sau → thiếu dòng NN).
   * signalCache: Map-like có .values(); veLai(kq): vẽ lại thẻ (tùy chọn).
   * Trả về số kq được bù. */
  buChoCache(signalCache, veLai) {
    if (this._cheDo === "off") return 0; // T01: flag tắt → nhánh NN không hoạt động
    if (!this.sanSang() || !signalCache || typeof signalCache.values !== "function") return 0;
    let n = 0;
    try {
      for (const kq of signalCache.values()) {
        if (kq && kq.nnXacSuat == null) {
          kq.nnXacSuat = this.duDoanChoEngine(kq);
          if (kq.nnXacSuat != null) {
            n++;
            if (typeof veLai === "function") { try { veLai(kq); } catch (e) {} }
          }
        }
      }
    } catch (e) {}
    return n;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { MLP, NN, trichDacTrung, dacTrungTuEngine, dacTrungTuJournal, nhanMau, taoTapDuLieu, NN_MAU_TOI_THIEU, NN_SO_DAC_TRUNG, NN_PHEN_BAN_DAC_TRUNG, NN_KIEN_TRUC, bamKiemTra, mulberry32 };
}
