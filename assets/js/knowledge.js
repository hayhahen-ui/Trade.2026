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
