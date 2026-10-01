# Trade.2026 — Mạng nơ-ron shadow mode (tích hợp MRBIT_NEURAL_CODING_01)

Triển khai phạm vi **P0** của `docs/MRBIT_NEURAL_CODING_01.md` trên codebase thật
(v2.14.0). Nguyên tắc: shadow chỉ quan sát — **không** gọi order router,
**không** đổi điểm/verdict, **không** tự thăng cấp.

## Ánh xạ P0 → file thật

| Yêu cầu P0 (tài liệu) | Triển khai |
|---|---|
| Feature flag `off\|shadow` | `NN.datCheDo()` (`assets/js/neural.js`); `SETTINGS.nnCheDo` (`config.js`, mặc định `shadow`); công tắc trong modal Cài đặt (`screens2.js`) |
| Adapter nhận setup | Hook cuối `engine.js` — nhận `ketQua` sau khi engine tính xong |
| Snapshot có version/provenance | Journal record (`journal.js`): id, thời gian, `nn`; weights meta: `phienBan`, `ngay`, `checksum` |
| Feature registry versioned | `NN_PHEN_BAN_DAC_TRUNG = "dac-trung-v1"` + `NN_KIEN_TRUC` (`neural.js`); đổi bộ đặc trưng → đổi version, weights cũ bị từ chối |
| Scorer interface + NotTrained | `NN.danhGia(kq)` trả assessment `{status, mode, p, modelVersion, phienBanDacTrung, doTreMs, lyDo}`; status `chua_huan_luyen` = NotTrainedScorer |
| Persistence + dedup | Journal theo id tín hiệu; không ghi đè snapshot đã dự báo |
| Tương thích artifact (T09) | `NN.kiemTraTuongThich()`: kiến trúc, kích thước W/b, phiên bản đặc trưng, checksum → `khong_tuong_thich` |
| UI trạng thái (§11) | Thẻ tín hiệu: chỉ hiện % khi `san_sang`; `khong_tuong_thich` → cảnh báo muted; còn lại **không vẽ số giả**. Modal Cài đặt hiện `NN.moTaTrangThai()` |
| Kiểm thử (§12) | `tools/harness_v2.js` mục [34]: T01/T02/T09/T13/T14 |

## Trạng thái assessment (`kq.nnDanhGia.status`)

`tat` (flag off) · `chua_huan_luyen` (chưa có weights) · `khong_tuong_thich`
(weights sai kiến trúc/phiên bản/checksum) · `thieu_du_lieu` · `san_sang` · `loi`.
`p` chỉ có giá trị khi `san_sang`, ngược lại luôn `null` — không bao giờ 0%/50%/100% giả.

## Vận hành

- **Bật/tắt:** modal Cài đặt → "🧠 Mạng nơ-ron" → Theo dõi thử / Tắt hẳn → Lưu & tải lại.
- **Xem trạng thái:** cùng modal Cài đặt, dòng "Trạng thái:" (số mẫu, valAcc, lý do).
- **Train lại:** `node tools/train-nn.js` (đọc journal đã ngã ngũ, so baseline,
  ghi `assets/nn-weights.json`). Không tự chạy định kỳ — chạy khi có thêm mẫu
  hoặc user yêu cầu.
- **Cổng thăng cấp (thủ công):** ≥30 mẫu ngã ngũ + valAcc vượt baseline + user duyệt.
  Chưa đạt thì mọi bản train đều ở chế độ `thu-nghiem (shadow)`.

## Còn lại cho P1/P2 (chưa làm)

Outcome recorder chi tiết theo policy thoát lệnh, hiệu chuẩn xác suất (reliability
diagram), TCN/LSTM, champion/challenger, quy trình xét thăng cấp chính thức.
