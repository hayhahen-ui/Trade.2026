# Trade.2026 v2.0.0 — Nền tảng phân tích & tín hiệu Crypto đa chiều

Dashboard phân tích crypto chạy **hoàn toàn tĩnh** (static web, không backend, không build step):
tín hiệu SMC đa khung, điểm hợp lưu Long/Short, RAG AI đa agent, bot paper trading kỷ luật,
radar cá mập, liquidation heatmap, lịch kinh tế — tất cả hiển thị kèm **nguồn dữ liệu và độ tươi**
(provenance), không bịa số liệu.

> ⚠️ **Không phải lời khuyên đầu tư.** Mọi lệnh thật do chính bạn quyết định và thực hiện trên sàn.
> Paper trading trong app dùng lệnh ảo với giá thật để rèn kỷ luật.

## Demo / Deploy

Mở `index.html` trực tiếp hoặc deploy lên bất kỳ static host nào (GitHub Pages, Vercel, Netlify).
Không cần build, không cần server.

## Kiến trúc

```
index.html
└── assets/
    ├── css/            style.css · datahub.css
    └── js/
        ├── config.js       APP_VERSION, watchlist, risk, RAG weights (nguồn sự thật duy nhất)
        ├── utils.js        helper dùng chung (el, fmt, clamp, lsGet/lsSet…)
        ├── ta.js           chỉ báo kỹ thuật (EMA/RSI/ATR/MACD… — guard NaN/null)
        ├── smc.js          Smart Money Concepts: swing, BOS/CHoCH, FVG, OB, sweep, IDM
        │                   (tín hiệu bot CHỈ dùng nến đã đóng — chống repaint)
        ├── exchanges.js    PriceHub: WS giá Binance · OKX · MEXC(+Fut) · Bybit perp · Hyperliquid
        │                   slot spot/perp TÁCH RIÊNG theo provenance
        ├── engine.js       engine tín hiệu đa khung (4H → 1H → 15m): phase, score, plan entry/SL/TP
        ├── whale.js        Radar Cá Mập: OKX rubik + sổ lệnh + DataHub (khử trùng nguồn OKX)
        ├── calendar.js     lịch kinh tế (Trading Economics) + kiểm tra độ tươi ≤ 48h
        ├── datahub*.js     DataHub: gom dòng tiền real-time đa sàn (WS), có bridge vào app
        ├── rag.js          RAG Auto: 5 agents chạy song song (Market → Whale/Flow/Macro/Knowledge),
        │                   trọng số RAG_WEIGHTS trong config, disagreement index, race guard
        ├── bot.js          Paper Trading Bot: cổng kỷ luật, SL/TP đa sàn (fallback chéo sàn),
        │                   phí taker trừ vào PnL, ngắt mạch lỗ ngày, tự học từ lịch sử
        ├── advisor.js      Cố vấn lệnh: phân tích text/ảnh phiếu lệnh, kiểm tra an toàn 2 bước
        ├── order.js        đặt lệnh 2 bước (mô phỏng), heatmap thanh lý
        ├── learn.js        tích lũy kiến thức thực chiến, vòng tự học từ lệnh đóng
        ├── screens*.js     UI: Tổng quan · Biểu đồ · Tín hiệu · Cá mập · Bot · Lịch · Kiến thức
        └── app.js          router hash (guard hash lỗi), boot, vòng lặp quét
tools/
└── update_calendar.py      fetch lịch kinh tế từ Trading Economics guest API (retry, atomic write)
.github/workflows/
└── update-calendar.yml      chạy 6h/lần, commit khi dữ liệu tươi hơn 12h & > 50 dòng
data/economic_calendar_data.json   lịch kinh tế (regenerate 2026-09-25: 454 sự kiện)
```

## Nguồn dữ liệu & độ tươi

| Nguồn | Cách lấy | Độ tươi hiển thị |
|---|---|---|
| Giá Binance / OKX / MEXC | WebSocket trực tiếp | timestamp mỗi tick |
| Giá Bybit (linear/perp), Hyperliquid | WebSocket (DataHub) | slot `BYBIT_PERP`/`HYPERLIQUID` tách riêng, **không** trộn vào giá spot |
| Fear & Greed | API Alternative.me | thiếu `value` → hiện `null`, không gắn nhãn giả |
| Whale (OKX rubik) | REST OKX | cache 5 phút |
| Dòng tiền real-time | WS đa sàn (DataHub) | 30 phút gần nhất |
| Lịch kinh tế | Trading Economics guest API → JSON | `generatedAt`; app từ chối dùng khi cũ hơn 48h |

Nguyên tắc: **không có dữ liệu thì hiện "không có", không bịa**. Giá perp không bao giờ được
dán nhãn thành giá spot Binance.

## Quy trình tín hiệu (5 bước)

1. **HTF 4H** — bias xu hướng, vùng POI (OB/FVG)
2. **LTF 1H/15m** — cấu trúc BOS/CHoCH (swing đã xác nhận, nến đã đóng)
3. **Entry model** — sweep + displacement + retest
4. **Hợp lưu đa lớp** — SMC 35% · Whale 20% · Flow 20% · Macro 15% · Momentum 10%
   (heatmap thanh lý điều chỉnh riêng ±6%)
5. **Kỷ luật** — RR ≥ tối thiểu, né tin ★★★, killzone, ngắt mạch lỗ ngày

Top gợi ý ở màn hình Tổng quan xếp hạng theo **consensus đa lớp**: điểm SMC trừ "phạt mâu thuẫn"
(disagreement index) và ưu tiên tín hiệu tươi.

## Bot Paper Trading

- Lệnh **ảo**, giá **thật** (theo sàn của vị thế).
- SL/TP được canh bởi feed của sàn vị thế; nếu feed chết > 20s → tự dùng giá chéo sàn tốt nhất
  (kể cả perp, có ghi rõ nguồn) thay vì bỏ mặc.
- PnL đã trừ **phí taker 2 chiều** (mặc định 0.05%/chiều, chỉnh trong cài đặt) — trước đây "miễn phí"
  nên đẹp hơn thực tế.
- Trần notional/vị thế (mặc định tắt), dời SL về hòa vốn ở +1R, ngắt mạch khi lỗ ngày ≥ ngưỡng.

## Lịch sử phiên bản

- **v2.0.0** (2026-09-25): audit toàn diện + kaizen từ codebase SIRO v1:
  vá 12 lỗi critical (repaint SMC, CHoCH sai swing, bodyClose luôn true, giá perp trộn vào spot,
  lịch kinh tế cũ 52 ngày, PnL không tính phí, whale đếm trùng…), tách provenance giá spot/perp,
  consensus disagreement index, bot fallback chéo sàn, rebrand Trade.2026.
- **v1.x**: bản gốc SIRO.

## Giấy phép

Nội dung trong repo chỉ phục vụ mục đích nghiên cứu & học tập.
