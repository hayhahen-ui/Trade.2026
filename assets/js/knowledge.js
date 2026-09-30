/* ============================================================
 * Trade.2026 — Kho kiến thức: bản phân tích hệ thống hóa của Mr.Bit
 * (3 chủ đề cốt lõi · phân tích cộng hưởng · sơ đồ tư duy · quy trình 5 bước)
 * Engine tín hiệu của app này được xây đúng theo tài liệu này.
 * ============================================================ */
"use strict";

const KIEN_THUC = {
  chuDeCotLoi: [
    {
      ten: "1. Cấu trúc thị trường là Xương sống",
      emoji: "🏗️",
      noiDung: [
        "Xác định đỉnh/đáy (Highs/Lows) và xu hướng là bước đầu tiên bắt buộc.",
        "BOS (phá vỡ cấu trúc) · CHoCH (thay đổi đặc tính) · đỉnh đáy STL/ITL/LTL.",
        "KHÔNG BAO GIỜ giao dịch ngược dòng chảy chính của khung thời gian lớn.",
      ],
      trongApp: "Engine đọc cấu trúc HH/HL/LH/LL khung 4H làm bias, chỉ tìm setup thuận chiều.",
    },
    {
      ten: "2. Thanh khoản và Sự thao túng",
      emoji: "💧",
      noiDung: [
        "Smart Money luôn quét thanh khoản (Stop Hunt / Judas Swing) tại đỉnh/đáy cũ trước khi di chuyển thật.",
        "Thị trường Futures điều khiển giá Spot qua cơ chế thanh lý (Liquidation).",
        "Hiểu 'bẫy giá' là điều kiện tiên quyết để không thành nạn nhân.",
      ],
      trongApp: "Tín hiệu chỉ kích hoạt SAU cú sweep; Radar Cá Mập soi thanh lý + funding + top trader OKX.",
    },
    {
      ten: "3. Hợp lưu đa yếu tố",
      emoji: "🎯",
      noiDung: [
        "Không bao giờ vào lệnh chỉ với 1 tín hiệu.",
        "Công thức: Cấu trúc + Vùng quan trọng (POI) + Tín hiệu xác nhận (Trigger).",
        "Kết hợp SMC với Volume Profile, RSI phân kỳ, đa khung thời gian.",
      ],
      trongApp: "Checklist 6 tiêu chí có trọng số (tối đa 100đ + 5đ killzone) — chỉ báo LONG/SHORT khi ≥ 70đ.",
    },
  ],

  congHuong: [
    { cap: "Lý thuyết SMC ↔ Thực chiến Scalping", y: "Lý thuyết (OB, FVG, Premium/Discount) giúp chọn vùng đúng; thực chiến M1-M15 + Fibo OTE 0.618–0.786 giúp bóp cò chính xác với RR cao." },
    { cap: "Cơ chế thao túng ↔ Volume Profile", y: "Hiểu vì sao giá giật râu (Futures thanh lý) và dùng POC/HVN để biết giá dừng ở đâu (nơi dòng tiền lớn đỡ giá)." },
    { cap: "Hệ thống kỹ thuật ↔ Tâm lý & Vị thế cuộc sống", y: "Hệ thống tốt đến đâu mà dùng tiền vay, áp lực phải thắng thì vẫn thua (chuyện anh A/anh B). Hệ thống chỉ là công cụ — tâm lý và quản lý vốn 1–2% mới là người điều khiển." },
  ],

  /* v2.6.0 → v2.8.0: kiến thức từ tài liệu mới (infographic 18 phút, Order Block, đọc nến).
   * Mỗi mục có "trongApp" để cột tự động hóa hiển thị đúng như các chủ đề cốt lõi. */
  khoaHocMoi: [
    {
      ten: "Cấu trúc thị trường 18 phút",
      emoji: "🏯",
      nguon: "v2.6.0 — tài liệu '18 phút đổi góc nhìn'",
      noiDung: [
        "TĂNG = chuỗi đỉnh cao dần + đáy cao dần (HH + HL) → chỉ tìm LONG tại đáy cao dần (HL).",
        "GIẢM = chuỗi đỉnh thấp dần + đáy thấp dần (LH + LL) → chỉ tìm SHORT tại đỉnh thấp dần (LH).",
        "ĐI NGANG = không có chuỗi rõ → đứng ngoài, chờ phá vỡ biên.",
        "Quy trình 18 phút: nhìn 4H lấy xu hướng lớn → 1H xác nhận cấu trúc → 15m tìm điểm vào.",
        "ĐỪNG BAO GIỜ giao dịch ngược cấu trúc khung 4H — đó là lý do 4 lệnh LONG thua liên tiếp của hệ thống.",
      ],
      trongApp: "Engine đánh giá cấu trúc 3 khung (4H/1H/15m): ngược cấu trúc 4H −12đ, CHoCH 1H ngược −8đ, đồng pha 3 khung +5đ. Hiện trên thẻ tín hiệu dòng '🏯 Cấu trúc'.",
    },
    {
      ten: "Chất lượng Order Block",
      emoji: "🧱",
      nguon: "v2.7.0 — tài liệu Order Block",
      noiDung: [
        "4 yếu tố OB chất lượng: momentum mạnh (impulse ≥ 1.35 ATR) · gắn với BOS/CHoCH (≤ 12 nến) · có sweep thanh khoản hoặc EQH/EQL · đúng xu hướng khung lớn.",
        "4 kiểu OB nên NÉ: trong vùng tích lũy · thiếu thanh khoản phía trước · ngược xu hướng 4H · bị giá test quá 3 lần.",
        "OB bị test càng nhiều càng yếu — lần chạm thứ 4 trở đi coi như đã hết lệnh.",
        "Xếp loại: KHỎE ≥ 70đ · TRUNG BÌNH 40–69đ · YẾU < 40đ.",
      ],
      trongApp: "Engine tự chấm chất lượng OB khi POI là Order Block: OB YẾU −10đ, OB KHỎE +5đ. Hiện '🧱 OB: KHỎE 85đ' trên thẻ tín hiệu.",
    },
    {
      ten: "Bối cảnh nến — đọc nến đúng cách",
      emoji: "🕯️",
      nguon: "v2.8.0 — tài liệu đọc nến",
      noiDung: [
        "'Nến là tín hiệu, vị trí là độ cậy' — một cây nến không có ý nghĩa nếu không biết nó xuất hiện ở đâu.",
        "3 vị trí quan trọng quyết định giá trị nến: vùng hỗ trợ/kháng cự · vùng cung–cầu (supply/demand) · Order Block.",
        "Nến đẹp GIỮA RANGE = nhiễu, do dự, dễ là trap — không bao giờ vào lệnh vì một mẫu nến lơ lửng.",
        "5 điều trước khi tin một mẫu nến: vị trí trong cấu trúc · phản ứng tại key level · volume xác nhận (≥ 1.3× TB) · cường độ (thân lớn vs thân nhỏ) · bối cảnh đa khung.",
        "Doji / Inside bar đơn độc KHÔNG phải tín hiệu buy/sell — chỉ là 'tạm dừng', phải chờ nến xác nhận.",
      ],
      trongApp: "Engine đọc mẫu nến (pin bar, nhấn chìm, doji, inside bar) trên khung 15m: nến MẠNH +5đ, nến CHỐNG LỆNH −8đ. Hiện '🕯️ Nến' trên thẻ tín hiệu.",
    },
    {
      ten: "Breakout thật vs Breakout giả",
      emoji: "💥",
      nguon: "v2.8.0 — tài liệu đọc nến",
      noiDung: [
        "Breakout THẬT: nến thân lớn (momentum mạnh) + ĐÓNG CỬA bên ngoài vùng kháng cự + volume TĂNG — dòng tiền lớn tham gia.",
        "Breakout GIẢ (bull/bear trap): râu nến dài từ chối giá + đóng cửa QUAY LẠI trong vùng + volume thấp — bẫy FOMO.",
        "Không đuổi theo breakout giả; breakout thật thì chờ retest vùng phá vỡ rồi mới vào.",
        "Breakout tại vùng quan trọng có độ tin cậy cao hơn breakout giữa range.",
      ],
      trongApp: "Engine tự phân loại breakout tại key level 15m: breakout giả cùng hướng lệnh −20đ + cảnh báo 'không đuổi theo'; breakout ngược hướng lệnh với lực mạnh −15đ.",
    },
    {
      ten: "Nến quét thanh khoản (Liquidity Grab)",
      emoji: "🧹",
      nguon: "v2.8.0 — tài liệu đọc nến",
      noiDung: [
        "Dấu hiệu: râu nến rất dài quét qua vùng hỗ trợ/kháng cự, nhưng thân nến ĐÓNG LẠI trong vùng giá cũ — tổ chức lớn đang 'đi chợ' stop loss của trader nhỏ lẻ.",
        "Vì sao trader bị stop loss trước khi giá chạy: tổ chức cần thanh khoản lớn để khớp lệnh, họ đẩy giá quét qua vùng đặt SL rồi mới chạy theo hướng thật.",
        "Sai lầm: giao dịch mù quáng chỉ vì thấy râu dài — phải chờ XÁC NHẬN đảo chiều (CHoCH/BOS nhỏ, pin bar, nhấn chìm) sau cú quét.",
        "Bối cảnh ưu tiên: xu hướng chính rõ ràng · gần vùng hỗ trợ/kháng cự mạnh · phiên Âu–Mỹ (thanh khoản cao).",
      ],
      trongApp: "Engine phát hiện sweep tự động (wick xuyên swing + close quay lại) — tín hiệu chỉ kích hoạt SAU cú sweep. Nến xác nhận sau sweep được chấm ở module bối cảnh nến.",
    },
    {
      ten: "Quản lý lệnh bằng nến (sắp có)",
      emoji: "🛡️",
      nguon: "tài liệu đọc nến — chưa tự động hóa",
      noiDung: [
        "Dời stop loss theo nến (trailing): khi xu hướng tiếp diễn, dời SL về dưới đáy nến tăng trước đó — vừa bảo vệ lợi nhuận vừa để lệnh chạy.",
        "Thoát lệnh sớm: xuất hiện nến đảo chiều mạnh (ví dụ Shooting Star thân nhỏ râu dài) tại kháng cự + volume tăng đột biến → thoát lệnh mua ngay.",
        "Chốt lời từng phần: khi nến thân nhỏ dần / râu dài xuất hiện trước mục tiêu — lực mua đang suy yếu, chốt một phần thay vì chờ đảo chiều.",
        "Nguyên tắc chung: vào lệnh theo kế hoạch, quản lý lệnh theo nến — 'biết tiến biết lùi mới là cao thủ'.",
      ],
      trongApp: "Chưa tự động hóa — paper bot hiện chỉ dời SL về hòa vốn khi +1R. Đang cân nhắc cho phiên bản tới.",
    },
  ],

  quyTrinh5Buoc: [
    { buoc: "CHỜ ĐỢI", en: "Wait", mota: "Đợi giá về vùng quan trọng (Key Level / OB) trên khung H4/D1. Không có setup = không làm gì.", may: "phase: wait_sweep — theo dõi tự động" },
    { buoc: "QUAN SÁT", en: "Watch", mota: "Tại vùng đó, tìm cú QUÉT THANH KHOẢN — giá chọc thủng hỗ trợ rồi rút chân nhanh (Spring/Stop Hunt). Dấu hiệu Big Boy tham gia.", may: "engine phát hiện sweep wick-close tự động" },
    { buoc: "XÁC NHẬN", en: "Confirm", mota: "Xuống khung M15/M5, đợi cấu trúc đổi chiều CHoCH THẬT (body close, có sweep trước, có IDM).", may: "bộ lọc CHoCH giả 3 lớp" },
    { buoc: "VÀO LỆNH", en: "Execute", mota: "Entry tại cú hồi về FVG/OB khung nhỏ hoặc vùng Fibo OTE. SL sau đỉnh/đáy vừa quét. TP tại thanh khoản đối diện, RR tối thiểu 1:2.", may: "kế hoạch entry/SL/TP tự dựng trên thẻ tín hiệu" },
    { buoc: "QUÊN ĐI", en: "Forget", mota: "Đặt SL/TP xong thì tắt máy, để xác suất làm việc. Dời SL về hòa vốn khi +1R. Đừng để tâm lý 'anh B' chi phối.", may: "paper bot tự dời SL về BE khi +1R" },
  ],

  quanTri: [
    { ten: "Vị thế cuộc sống", items: ["Chỉ dùng tiền nhàn rỗi (vốn A, không phải vốn B)", "Loại bỏ tư duy đánh bạc / làm giàu nhanh"] },
    { ten: "Quản trị rủi ro", items: ["Rủi ro tối đa 1–2% mỗi lệnh", "R:R tối thiểu 1:2 (thua 1, thắng 2+)", "Ngắt mạch cảm xúc: dừng khi lỗ 3–5%/ngày"] },
    { ten: "Kỷ luật", items: ["Tuân thủ tuyệt đối kế hoạch", "Không FOMO, không Revenge Trading (trả thù thị trường)", "Checklist > linh cảm"] },
  ],

  congCu: [
    { ten: "Order Block (OB)", mota: "Nến ngược màu cuối trước cú displacement mạnh — vùng vào lệnh chính. App yêu cầu impulse ≥ 1.35×ATR." },
    { ten: "Fair Value Gap (FVG)", mota: "Khoảng trống 3 nến — vùng hút giá quay về. Chỉ dùng FVG chưa lấp quá 50%." },
    { ten: "Liquidity (EQH/EQL)", mota: "Đỉnh/đáy bằng nhau (dung sai 0.12%) — nơi giá sẽ quét qua trước khi đảo chiều; đồng thời là mục tiêu TP." },
    { ten: "Premium / Discount", mota: "Chia dải giá theo equilibrium 50%: chỉ MUA ở discount (<38%), chỉ BÁN ở premium (>62%)." },
    { ten: "Volume Profile", mota: "POC/HVN — nơi dòng tiền lớn tích lũy để bảo vệ vị thế. Giá sát POC = vùng tranh chấp." },
    { ten: "Fibonacci OTE", mota: "Vùng hồi quy 0.618–0.786 của chân sóng impulse — điểm vào lệnh tối ưu RR cao." },
    { ten: "RSI (Wilder) + Cardwell", mota: "Lọc quá mua/quá bán 70/30 + đảo chiều dương/âm (hidden divergence) làm cảnh báo ngược hướng." },
    { ten: "EMA 200 khung lớn", mota: "Bộ lọc xu hướng: chỉ LONG khi giá trên EMA200 4H, chỉ SHORT khi dưới." },
  ],

  phien: [
    { ten: "🌏 Phiên Á (Tokyo)", gio: "6H–14H VN", dacDiem: "Biến động vừa, tích lũy, dễ nhiễu — hạn chế vào lệnh" },
    { ten: "🇪🇺 Phiên Âu (London)", gio: "14H–22H VN", dacDiem: "Thanh khoản lớn, sóng bắt đầu — Judas Swing thường xuất hiện đầu phiên" },
    { ten: "🇺🇸 Phiên Mỹ (New York)", gio: "19H–3H VN", dacDiem: "Biến động mạnh nhất — tin tức macro đổ bộ" },
    { ten: "🔥 GIỜ VÀNG (Âu+Mỹ)", gio: "19H–22H VN", dacDiem: "Sôi động nhất, dòng tiền lớn — killzone chính của hệ thống" },
  ],

  mindmapText: `TRUNG TÂM: CHIẾN LƯỢC GIAO DỊCH CRYPTO LỢI NHUẬN BỀN VỮNG
│
├── 1. TƯ DUY & QUẢN TRỊ (NỀN MÓNG)
│   ├── Vị thế cuộc sống: chỉ dùng tiền nhàn rỗi · bỏ tư duy đánh bạc
│   ├── Quản trị rủi ro: 1–2%/lệnh · RR ≥ 1:2 · ngắt mạch lỗ 3–5%/ngày
│   └── Kỷ luật: tuân thủ kế hoạch · không FOMO · không revenge trade
│
├── 2. PHÂN TÍCH BỐI CẢNH (BẢN ĐỒ)
│   ├── Đa khung: W1/D1 xu hướng → H4/H1 cấu trúc & dòng tiền → M15/M5/M1 entry
│   ├── Cấu trúc: BOS & CHoCH · đỉnh/đáy mạnh-yếu · Premium (bán) & Discount (mua)
│   └── Thời gian: phiên Á tích lũy · Kill Zones Âu/Mỹ săn thanh khoản (Judas Swing)
│
├── 3. CÔNG CỤ & TÍN HIỆU (VŨ KHÍ)
│   ├── SMC: Order Block · Fair Value Gap · Liquidity EQH/EQL
│   └── Bổ trợ: Volume Profile (POC/HVN) · Fibo OTE 0.618–0.786 · RSI/Stoch phân kỳ · EMA
│
└── 4. QUY TRÌNH VÀO LỆNH (THỰC CHIẾN)
    ├── B1: HTF chạm POI (OB/FVG)          ├── B2: chờ QUÉT THANH KHOẢN
    ├── B3: LTF xác nhận CHoCH/BOS          ├── B4: entry OB mới/Fibo OTE · SL sau wick quét · TP thanh khoản cũ
    └── B5: dời SL hòa vốn khi +1R — rồi QUÊN ĐI, để xác suất làm việc`,
};
