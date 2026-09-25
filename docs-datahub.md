# 🌊 SIRO DataHub — Nạp dữ liệu real-time & đấu nối vào Siro

Module bổ sung cho repo **mrbit4578/Siro**: gom **toàn bộ dòng dữ liệu thị trường theo thời gian thực** từ nhiều
nguồn công khai, chuẩn hoá về một định dạng chung, rồi cắm thẳng vào app tĩnh hiện có (không build step,
không dependency, chạy nguyên trên GitHub Pages).

## Nguồn dữ liệu

| Nguồn | Kênh | Dữ liệu |
|---|---|---|
| Binance Futures | WebSocket | lệnh khớp (cá mập), **thanh lý** `forceOrder`, ticker 24h |
| OKX | WebSocket v5 | lệnh khớp spot, **liquidation-orders** toàn sàn SWAP |
| Bybit | WebSocket v5 linear | `publicTrade`, `allLiquidation` |
| Hyperliquid | WebSocket | lệnh khớp perp DEX |
| Polymarket | REST poll 5s | dòng lệnh thị trường dự đoán |
| Macro | REST | Fear & Greed, funding rate, open interest |
| ETF / Tin tức | REST qua proxy | dòng tiền ETF, RSS (tuỳ chọn) |

Tất cả đều là endpoint công khai và cho phép gọi trực tiếp từ trình duyệt — **không cần server riêng**.
Hai nguồn cuối (ETF, RSS) chặn cross-origin nên đi qua Worker trong `tools/proxy/`.

## Cài đặt — 3 bước

**1. Chép file vào repo Siro**

```
assets/js/datahub.config.js
assets/js/datahub.js
assets/js/datahub-ui.js
assets/js/datahub-bridge.js
assets/css/datahub.css
tools/proxy/cloudflare-worker.js   (tuỳ chọn)
```

**2. Khai báo trong `index.html`**

Thêm CSS vào `<head>`, sau `style.css`:

```html
<link rel="stylesheet" href="assets/css/datahub.css" />
```

Thêm 4 thẻ script **ngay sau `app.js`** (thứ tự bắt buộc):

```html
<script src="assets/js/app.js"></script>
<!-- DataHub -->
<script src="assets/js/datahub.config.js"></script>
<script src="assets/js/datahub.js"></script>
<script src="assets/js/datahub-ui.js"></script>
<script src="assets/js/datahub-bridge.js"></script>
```

**3. Commit → GitHub Pages tự deploy.** Mở `https://mrbit4578.github.io/Siro/#/dongtien`.

Cầu nối tự đăng ký màn hình **🌊 Dòng tiền** vào `SCREENS` và chèn mục vào sidebar ngay dưới *Radar Cá Mập* —
không phải sửa `app.js`.

## Màn hình mới có gì

- Chip sức khoẻ từng nguồn (xanh = đang chạy, vàng = đang nối lại, cam = suy giảm, xám = tắt) kèm số gói nhận được
- KPI 1 giờ trượt: net flow, khối lượng cá mập, áp lực mua/bán, tổng thanh lý long vs short
- Bảng lệnh lớn real-time (giờ VN, coin, chiều, giá, khối lượng, giá trị, sàn), ngưỡng đổi được ngay trên UI
- Bảng thanh lý, phân bổ theo cỡ lệnh (10K–100K … 10M+), dòng tiền theo coin kèm điểm −100…+100
- Dòng lệnh Polymarket, bối cảnh vĩ mô (Fear & Greed, funding, OI, ETF)
- Nút **Xuất snapshot** ra JSON để đối chiếu / backtest

## Dùng dữ liệu ở các module khác

```js
// Nghe sự kiện
DataHub.on("whale", t => console.log(t.coin, t.side, t.usd, t.san));
DataHub.on("liq",   l => console.log(l.coin, l.huong, l.usd));
DataHub.on("stats", s => console.log(s.whale.netFlow, s.liquidation));

// Hoặc qua sự kiện DOM chung của Siro
document.addEventListener("siro:datahub", e => { /* e.detail.loai = whale | liq | stats */ });

// Truy vấn tức thời
DataHub.stats();          // thống kê 1h
DataHub.prices();         // giá mới nhất theo coin
DataHub.flowScore("BTC"); // điểm dòng tiền −100…+100
DataHub.snapshot();       // toàn cảnh, JSON hoá được
```

### Cộng dòng tiền real-time vào Whale Score (`whale.js`)

Cuối hàm `tinhWhaleScore(coin)`, trước khi trả kết quả:

```js
if (window.DataHubBridge) kq.diem = DataHubBridge.congVaoWhaleScore(coin, kq.diem); // tối đa ±20
```

### Cổng xác nhận cho bot (`bot.js`)

```js
if (window.DataHubBridge && !DataHubBridge.xacNhanCaMap(coin, huong, 15)) return; // cá mập chưa cùng chiều → bỏ lệnh
const tl = DataHubBridge.thanhLyGanDay(coin, 5);
if (tl.tong > 20e6) return; // đang quét thanh khoản mạnh → đứng ngoài
```

## Cấu hình

Mọi thứ nằm trong `assets/js/datahub.config.js`:

- `coins` — danh sách coin theo dõi (nên khớp watchlist Siro)
- `whale.minUsd` — ngưỡng coi là lệnh cá mập (mặc định $100K)
- `whale.windowMin` — cửa sổ thống kê (mặc định 60 phút)
- `sources.*` — bật/tắt từng nguồn
- `endpoints.proxy` — URL Worker nếu dùng ETF/RSS

## Proxy (chỉ khi cần ETF / RSS)

1. Cloudflare → Workers & Pages → Create Worker → dán `tools/proxy/cloudflare-worker.js` → Deploy
2. Điền vào config:

```js
proxy:       "https://siro-proxy.<tai-khoan>.workers.dev/?url=",
etfFlowsUrl: "https://siro-proxy.<tai-khoan>.workers.dev/?url=" + encodeURIComponent("https://farside.co.uk/…"),
```

Worker có danh sách host cho phép — thêm host mới vào mảng `ALLOW` trước khi dùng.

## Về nguồn tradermap.io

Log và HAR bạn gửi cho thấy tradermap.io lấy dữ liệu qua backend riêng của họ
(`/api/prices`, `/api/stats`, `/api/trade-size-distribution`, `/api/btc-predictions`, `/api/etf-flows`,
WebSocket `/polymarket` và `/news`). Adapter tương ứng đã có sẵn trong `datahub.js` nhưng **mặc định tắt**, vì:

- API đó không mở CORS cho `mrbit4578.github.io` → gọi thẳng từ trình duyệt sẽ bị chặn, phải qua proxy
- Đây là hạ tầng trả phí của bên thứ ba, không có giấy phép sử dụng công khai; `userId` trong log là phiên của bạn, không phải khoá API

Vì vậy DataHub lấy **cùng loại dữ liệu từ chính các sàn gốc** (Binance/OKX/Bybit/Hyperliquid/Polymarket) —
độ trễ thấp hơn, không phụ thuộc bên trung gian và không có rủi ro pháp lý. Nếu bạn có thoả thuận sử dụng API
tradermap, bật `sources.tradermap = true`, điền `tmUserId` và mở host trong Worker là chạy.

## Khắc phục sự cố

| Hiện tượng | Nguyên nhân & xử lý |
|---|---|
| Chip Binance màu cam "Futures bị chặn" | `fstream.binance.com` bị chặn theo vùng — module tự hạ cấp sang Spot WS (mất kênh thanh lý). Dùng VPN hoặc dựa vào OKX/Bybit cho thanh lý. |
| Chip Polymarket cam | Bị chặn cross-origin hoặc rate limit → trỏ qua proxy. |
| Bảng trống nhưng chip xanh | Ngưỡng lệnh lớn đang quá cao — hạ xuống $50K trên thanh công cụ. |
| Không thấy mục sidebar | Script DataHub nạp trước `app.js`. Kiểm tra lại thứ tự thẻ `<script>`. |
| Tab nền lâu bị ngắt | Cố ý: ẩn quá 5 phút sẽ ngắt WebSocket, quay lại tab tự nối lại. |

## Ghi chú kỹ thuật

- Mọi WebSocket có heartbeat riêng theo chuẩn từng sàn và tự kết nối lại theo backoff luỹ thừa có jitter (1s → 30s)
- Kênh chết quá 45 giây không có gói tin sẽ bị đóng chủ động và mở lại
- Bộ đệm vòng: 600 lệnh cá mập, 400 thanh lý, 200 lệnh Polymarket — không phình bộ nhớ khi chạy cả ngày
- Khối lượng thanh lý OKX được quy đổi từ hợp đồng sang coin bằng `ctVal` tải trực tiếp từ `/api/v5/public/instruments`
- Giao diện chỉ vẽ lại khi màn hình đang mở, tiết chế 700ms/lần

_Không phải lời khuyên đầu tư. Dữ liệu công khai từ sàn, có thể trễ hoặc gián đoạn._
