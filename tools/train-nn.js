/* Trade.2026 v2.17.0 — Huấn luyện MLP dự đoán xác suất thắng tín hiệu (audit A04/A05)
 * Chạy: node tools/train-nn.js [--file data/journal-247.json] [--out artifacts/nn-candidate.json]
 * Đọc bản ghi journal đã ngã ngũ → snapshot v2 → nhãn netR → chia train/val/test
 * THEO THỜI GIAN + purge overlap → train → so baseline (fit trên train) →
 * ghi file ỨNG VIÊN (không tự thay trọng số runtime).
 * KHÔNG tự thăng cấp: runtime luôn chạy shadow (quan sát).
 */
"use strict";
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const N = require(path.join(ROOT, "assets/js/neural.js"));

const MAU_TOI_THIEU = 100;      // cổng kỹ thuật (audit §6.4)
const TY_LE = [0.6, 0.2, 0.2];  // train / val / test theo thời gian
const PURGE_MS = 15 * 60e3;     // purge overlap 15m

function layBanGhi(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.tinHieu)) return raw.tinHieu;
  throw new Error("không thấy mảng bản ghi trong " + file);
}
/* Chia theo thời gian toàn bộ coin (A04): sắp xếp theo asOf, cắt 60/20/20,
 * purge các mẫu train/val có thời điểm kết thúc nhãn quá gần khối kế tiếp. */
function chiaTheoThoiGian(ds) {
  // v2.17.0: ds là object {asOf, ketQuaAt, X, Y, ids} — dựng chỉ số rồi sắp xếp theo asOf
  const sx = Array.from({ length: ds.asOf.length }, (_, i) => i).sort((a, b) => ds.asOf[a] - ds.asOf[b]);
  const n = sx.length;
  let nTrain = Math.floor(n * TY_LE[0]), nVal = Math.floor(n * TY_LE[1]);
  if (nTrain < 1) nTrain = 1;
  if (nVal < 1 && n - nTrain > 1) nVal = 1;
  const iTrain = sx.slice(0, nTrain), iVal = sx.slice(nTrain, nTrain + nVal), iTest = sx.slice(nTrain + nVal);
  const batDauVal = iVal.length ? ds.asOf[iVal[0]] : Infinity;
  const batDauTest = iTest.length ? ds.asOf[iTest[0]] : Infinity;
  const loc = (idx, gioiHan) => idx.filter(i => ds.ketQuaAt[i] <= gioiHan - PURGE_MS);
  return {
    train: loc(iTrain, batDauVal), val: loc(iVal, batDauTest), test: iTest,
    purgeTrain: iTrain.length - loc(iTrain, batDauVal).length,
    purgeVal: iVal.length - loc(iVal, batDauTest).length,
  };
}
function layPhan(ds, idx) {
  return { X: idx.map(i => ds.X[i]), Y: idx.map(i => ds.Y[i]), ids: idx.map(i => ds.ids[i]) };
}
/* Metric trên 1 phần (A05): accuracy, Brier, log-loss, confusion. */
function metric(phan, duDoan) {
  const { X, Y } = phan;
  const n = Y.length;
  let dung = 0, brier = 0, logloss = 0, tp = 0, tn = 0, fp = 0, fn = 0;
  for (let i = 0; i < n; i++) {
    let p = duDoan(X[i], i); // v2.17.0: truyền index để baseline điểm≥75 tra đúng diem[i]
    p = Math.min(1 - 1e-9, Math.max(1e-9, +p));
    if ((p >= 0.5 ? 1 : 0) === Y[i]) dung++;
    brier += (p - Y[i]) ** 2;
    logloss += -(Y[i] * Math.log(p) + (1 - Y[i]) * Math.log(1 - p));
    if (Y[i] === 1 && p >= 0.5) tp++; else if (Y[i] === 0 && p < 0.5) tn++;
    else if (Y[i] === 0) fp++; else fn++;
  }
  const r3 = (v) => n ? +v.toFixed(3) : null;
  return { n, accuracy: r3(dung / n), brier: r3(brier / n), logLoss: r3(logloss / n), tp, tn, fp, fn };
}
/* Baseline (A04/A05): tần suất lớp FIT TRÊN TRAIN; luật điểm≥75; đánh giá trên cùng holdout. */
function baseline(trainY, phan, diem) {
  const nT = trainY.length;
  const tyLeThang = nT ? trainY.filter(y => y === 1).length / nT : 0.5;
  const duDoanMajority = () => tyLeThang; // xác suất = tần suất lớp trên train
  const mMaj = metric(phan, duDoanMajority);
  const m75 = metric(phan, (x, i) => ((diem[i] >= 75 ? 1 : 0)));
  return { tyLeThang: +tyLeThang.toFixed(3), majority: mMaj, diem75: m75 };
}

function main() {
  const args = process.argv.slice(2);
  const layOpt = (k, macDinh) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : macDinh; };
  const file = layOpt("--file", path.join(ROOT, "data/journal-247.json"));
  const outFile = layOpt("--out", path.join(ROOT, "artifacts/nn-candidate.json"));
  console.log(`[train-nn] dữ liệu: ${file}`);
  const records = layBanGhi(file);
  const ds = N.taoTapDuLieu(records);
  console.log(`[train-nn] bản ghi: ${records.length} → mẫu hợp lệ (snapshot v2 + nhãn netR): ${ds.n}`);
  if (ds.n < MAU_TOI_THIEU) {
    console.log(`[train-nn] CHƯA ĐỦ MẪU — cần ≥${MAU_TOI_THIEU} mẫu hợp lệ (hiện ${ds.n}).`);
    console.log("[train-nn] Gợi ý: bản ghi legacy thiếu snapshot v2 bị loại là đúng — để hệ thống tích lũy snapshot mới rồi train lại.");
    process.exit(2);
  }
  const chia = chiaTheoThoiGian(ds);
  console.log(`[train-nn] chia thời gian: train=${chia.train.length} val=${chia.val.length} test=${chia.test.length} (purge: train-${chia.purgeTrain} val-${chia.purgeVal})`);
  if (!chia.train.length || !chia.val.length || !chia.test.length) {
    console.log("[train-nn] phần chia rỗng sau purge — chưa huấn luyện."); process.exit(2);
  }
  const phanTrain = layPhan(ds, chia.train), phanVal = layPhan(ds, chia.val), phanTest = layPhan(ds, chia.test);
  const duLop = (p) => p.Y.some(y => y === 1) && p.Y.some(y => y === 0);
  if (!duLop(phanTrain) || !duLop(phanVal) || !duLop(phanTest)) {
    console.log("[train-nn] có phần thiếu 1 lớp — chưa huấn luyện (cần đủ thắng+thua mỗi phần)."); process.exit(2);
  }

  const mlp = new N.MLP(N.NN_KIEN_TRUC, 42);
  const kq = mlp.hocTheoChia(phanTrain.X, phanTrain.Y, phanVal.X, phanVal.Y, { lr: 0.05, epochs: 800, patience: 60 });
  if (kq.loi) { console.log("[train-nn] LỖI:", kq.loi); process.exit(1); }
  const duDoanMLP = (x) => mlp.duDoan(x);
  const mTrain = metric(phanTrain, duDoanMLP), mVal = metric(phanVal, duDoanMLP), mTest = metric(phanTest, duDoanMLP);
  // điểm engine cho baseline diem75: lấy từ raw.diem trong snapshot
  const diemCua = (phan) => phan.ids.map(id => {
    const rec = records.find(r => r.id === id);
    const snap = rec && (rec.featureSnapshot || rec.snapshot);
    return snap && snap.raw ? snap.raw.diem : 0;
  });
  const blVal = baseline(phanTrain.Y, phanVal, diemCua(phanVal));
  const blTest = baseline(phanTrain.Y, phanTest, diemCua(phanTest));
  console.log(`[train-nn] MLP  val: acc=${mVal.accuracy} brier=${mVal.brier} | test: acc=${mTest.accuracy} brier=${mTest.brier}`);
  console.log(`[train-nn] baseline(val): majority acc=${blVal.majority.accuracy}, điểm≥75 acc=${blVal.diem75.accuracy}`);

  const honBaselineVal = mVal.accuracy > Math.max(blVal.majority.accuracy, blVal.diem75.accuracy);
  const ngay = new Date().toISOString().slice(0, 10);
  const datasetHash = crypto.createHash("sha256").update(JSON.stringify(ds.ids)).digest("hex");
  const trongSoTho = mlp.xuat({});
  const meta = {
    phienBan: "nn-" + ngay,
    phienBanDacTrung: N.NN_PHEN_BAN_DAC_TRUNG,
    strategyVersion: N.NN_STRATEGY_VERSION,
    kienTruc: N.NN_KIEN_TRUC.slice(),
    calibrated: false,
    ngay,
    mau: ds.n,
    mauThang: ds.Y.filter(y => y === 1).length, mauThua: ds.Y.filter(y => y === 0).length,
    chia: { train: phanTrain.ids, val: phanVal.ids, test: phanTest.ids, purgeTrain: chia.purgeTrain, purgeVal: chia.purgeVal },
    datasetSha256: datasetHash,
    mlp: { train: mTrain, val: mVal, test: mTest, epochs: kq.epochs, trainLoss: kq.trainLoss, valLoss: kq.valLoss },
    baseline: { val: blVal, test: blTest },
    honBaselineVal,
    seed: 42,
    checksum: N.bamKiemTra({ sizes: trongSoTho.sizes, W: trongSoTho.W, b: trongSoTho.b }),
    cheDo: "ung-vien (chờ user xem xét thủ công — KHÔNG tự thay runtime)",
    ghiChu: honBaselineVal
      ? "Val hơn baseline trên holdout thời gian — user xem báo cáo rồi quyết định thủ công."
      : "Val chưa hơn baseline — giữ shadow, không dùng.",
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(mlp.xuat(meta)));
  console.log(`[train-nn] đã ghi ỨNG VIÊN ${outFile}. KHÔNG tự chép vào assets/nn-weights.json — user xem xét thủ công.`);
}
main();
