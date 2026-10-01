/* Trade.2026 v2.13.0 — Huấn luyện MLP dự đoán xác suất thắng tín hiệu
 * Chạy: node tools/train-nn.js [--file data/journal-247.json]
 * Đọc bản ghi journal đã ngã ngũ → trích đặc trưng → train/val → so baseline
 * → ghi assets/nn-weights.json (kèm báo cáo trung thực về mức tin cậy).
 * KHÔNG tự thăng cấp: runtime v2.13.0 luôn chạy shadow (quan sát).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const N = require(path.join(ROOT, "assets/js/neural.js"));

function layBanGhi(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.tinHieu)) return raw.tinHieu;
  throw new Error("không thấy mảng bản ghi trong " + file);
}
/* Baseline trung thực để so sánh (tài liệu §3.4: luôn so với quy tắc đơn giản) */
function baseline(X, Y, ds) {
  const n = Y.length;
  const thang = Y.filter(y => y === 1).length;
  const majority = Math.max(thang, n - thang) / n;
  let dung75 = 0;
  for (let i = 0; i < n; i++) {
    const diem = (ds[i] && ds[i][0] != null) ? ds[i][0] * 100 : 0;
    if ((diem >= 75 ? 1 : 0) === Y[i]) dung75++;
  }
  return { majority: +majority.toFixed(3), diem75: +(dung75 / n).toFixed(3) };
}

function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--file");
  const file = fi >= 0 && args[fi + 1] ? args[fi + 1] : path.join(ROOT, "data/journal-247.json");
  console.log(`[train-nn] dữ liệu: ${file}`);
  const records = layBanGhi(file);
  const { X, Y, n } = N.taoTapDuLieu(records);
  console.log(`[train-nn] bản ghi ngã ngũ dùng được: ${n}/${records.length}`);
  if (n < 4) {
    console.log("[train-nn] QUÁ ÍT MẪU — chưa huấn luyện. Cần ≥4 mẫu (khuyến nghị ≥30).");
    process.exit(2);
  }
  const bl = baseline(X, Y, X);
  console.log(`[train-nn] baseline: majority=${bl.majority}, luật điểm≥75=${bl.diem75}`);

  const mlp = new N.MLP([N.NN_SO_DAC_TRUNG, 8, 1], 42);
  const kq = mlp.hoc(X, Y, { lr: 0.05, epochs: 800, patience: 60, seed: 7 });
  if (kq.loi) { console.log("[train-nn] LỖI:", kq.loi); process.exit(1); }
  console.log(`[train-nn] train acc=${kq.trainAcc} (n=${kq.nTrain}) | val acc=${kq.valAcc} (n=${kq.nVal}) @epoch ${kq.epochs}`);

  const duMau = n >= N.NN_MAU_TOI_THIEU;
  const honBaseline = kq.valAcc > Math.max(bl.majority, bl.diem75);
  const cheDo = (duMau && honBaseline) ? "de-xuat-thang-cap (chờ user duyệt)" : "thu-nghiem (shadow)";
  const ngay = new Date().toISOString().slice(0, 10);
  const thang = Y.filter(y => y === 1).length;
  // v2.14.0: metadata artifact đầy đủ (MRBIT_NEURAL_CODING_01 §8) — phiên bản,
  // phiên bản đặc trưng, kiến trúc, số mẫu theo lớp, seed, checksum
  const trongSoTho = mlp.xuat({});
  const meta = {
    phienBan: "nn-" + ngay,
    phienBanDacTrung: N.NN_PHEN_BAN_DAC_TRUNG,
    kienTruc: N.NN_KIEN_TRUC.slice(),
    ngay,
    mau: n, mauThang: thang, mauThua: n - thang,
    trainAcc: kq.trainAcc, valAcc: kq.valAcc, nTrain: kq.nTrain, nVal: kq.nVal,
    seed: 7, epochs: kq.epochs,
    checksum: N.bamKiemTra({ sizes: trongSoTho.sizes, W: trongSoTho.W, b: trongSoTho.b }),
    baseline, cheDo,
    ghiChu: duMau
      ? (honBaseline ? "Val hơn baseline — user xem xét thăng cấp thủ công." : "Val chưa hơn baseline — giữ shadow.")
      : `Mới ${n} mẫu (<${N.NN_MAU_TOI_THIEU}) — mạng chỉ quan sát, KHÔNG ảnh hưởng tín hiệu.`,
  };
  const outPath = path.join(ROOT, "assets/nn-weights.json");
  fs.writeFileSync(outPath, JSON.stringify(mlp.xuat(meta)));
  console.log(`[train-nn] đã ghi ${outPath} (${fs.statSync(outPath).size} bytes) — chế độ: ${cheDo}`);
}
main();
