# BÁO CÁO ĐỌC DỰ ÁN Trade.2026

**Ngày đọc:** 06/11/2026 · **Người đọc:** Muse (subagent) · **Nguồn:** `~/workspace/trade2026/Trade.2026-main`
**Phương pháp:** đọc trực tiếp toàn bộ file JS lõi (`config`, `engine`, `smc`, `ta`, `neural`, `exchanges`, `bot`, `advisor`, `order`, `rag`, `whale`, `heatmap`, `calendar`, `derivatives`, `datahub*`, `flowdb`, `app`, `bridge`, `index.html`, `api/ai-proxy.js`), skim `screens*.js`, `journal.js`, `learn.js`, `knowledge.js`, `aichat.js`, `utils.js`, toàn bộ `tools/`, `docs/`, `data/` (kiểm tra bằng script), workflow GitHub Actions; grep toàn dự án các từ khóa `telegram|sendMessage|webhook|notify|discord|whatsapp`.
**Quy tắc:** chỉ đọc, không sửa file trong thư mục dự án. Mọi con số đều trích từ code; chỗ nào không tìm thấy sẽ ghi rõ.

## ĐÍNH CHÍNH 06/11/2026 — trạm 24/7 VẪN CHẠY (sửa §8.2, §9.2)
Kết luận "dữ liệu trạm ngừng đẩy từ 02/10" trong bản báo cáo này là **SAI** — do đọc file `data/` trong bản zip, mà zip chỉ chứa nhánh `main` (bản copy `data/` trên main đã cũ từ 02/10). Kiểm chứng trực tiếp nhánh `data` live trên GitHub ngày 06/11/2026 ~09:50 VN:
- `journal-247.json` live: `capNhat 2026-11-06T02:07:49Z` (~40 phút trước lúc kiểm tra), 110 tín hiệu; `flow-247.json`: `capNhat 2026-11-06T02:08:00Z` (giá BTC 76.598 khớp thị trường sáng nay).
- Nhánh `data`: **186 commit từ 01/10 → 06/11**, commit mới nhất `1412e647` lúc 02:08:15Z "trạm 24/7: cập nhật journal + flow"; nhịp đẩy ~2–5 lần/ngày, 3 commit gần nhất cách nhau ~75 phút.
- **Có 2 lần trạm ngưng dài rồi tự chạy lại:** 24–26/10 (~48h) và 30/10–02/11 (~56h). Nguyên nhân chưa rõ (host/cron không có trong repo).
- `browser-signals.json` live ngừng từ **12/10/2026** — cầu nối trình duyệt → trạm đã chết ~3,5 tuần (trạm tự quét top 30 nên tín hiệu chính không ảnh hưởng).
- Thống kê live: 104 tín hiệu, 101 đã xong, win rate 39%, expectancy −0.16 (long 0/51 thắng theo breakdown `theo.side` — con số này mâu thuẫn với tổng thắng 39, cần soi lại logic thống kê trước khi dùng làm thước đo chất lượng).
- **Chưa kiểm chứng được:** WhatsApp có còn gửi tin không (code gửi nằm trên máy trạm, không trong repo, không có trên VM này). Kết luận cho bot Telegram: **DỰA ĐƯỢC vào trạm** để gắn sender Telegram, kèm giám sát (báo động nếu `journal-247.json` quá 2 giờ không cập nhật).

## Mục lục

1. [Kiến trúc tổng thể + cách chạy](#1-kiến-trúc-tổng-thể--cách-chạy)
2. [Engine tín hiệu (engine.js, smc.js, ta.js, neural.js)](#2-engine-tín-hiệu)
3. [Nguồn dữ liệu (exchanges.js, datahub, whale, heatmap, calendar, rag, flowdb)](#3-nguồn-dữ-liệu)
4. [bot.js (paper trading) + advisor.js + order.js](#4-paper-trading-bot--advisor--order-ticket)
5. [config.js — các hằng số quan trọng](#5-configjs--các-hằng-số-quan-trọng)
6. [Tích hợp Telegram / webhook / notify: KHÔNG CÓ](#6-tích-hợp-telegram--webhook--notify-không-có)
7. [Cách chạy thử local và deploy](#7-cách-chạy-thử-local-và-deploy)
8. [Thư mục tools, data, docs và các module phụ](#8-thư-mục-tools-data-docs-và-các-module-phụ)
9. [Điểm chưa rõ / mâu thuẫn / rủi ro phát hiện khi đọc](#9-điểm-chưa-rõ--mâu-thuẫn--rủi-ro-phát-hiện-khi-đọc)
10. [Gợi ý kiến trúc bot Telegram theo đúng luồng này](#10-gợi-ý-kiến-trúc-bot-telegram-theo-đúng-luồng-này)

---

## 1. Kiến trúc tổng thể + cách chạy

### 1.1. Bản chất: web tĩnh, không backend, không build step

- Đây là **static web thuần**: `index.html` (82 dòng) + CSS + 28 file JavaScript trong `assets/js/` (~10.836 dòng), chạy hoàn toàn phía trình duyệt. README (`README.md:1-11`) ghi rõ: *"chạy hoàn toàn tĩnh (static web, không backend, không build step)"*.
- **Không có server riêng, không có database server, không có build tool** (không có `package.json`, không bundler). Toàn bộ state lưu ở `localStorage` / `IndexedDB` của trình duyệt.
- Phiên bản: `APP_VERSION = "2.17.2"` trong `assets/js/config.js:7`. README vẫn ghi v2.0.0 (2026-09-25) — **lệch version** (xem §9).
- Repo (suy ra từ code): `hayhahen-ui/Trade.2026` — ghi literal trong `assets/js/bridge.js:11` (`REPO: "hayhahen-ui/Trade.2026"`), `assets/js/datahub.js` (`HIST12_URL` trỏ `raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/flow-history-12h.json`), `tools/push-247.js` (`--repo hayhahen-ui/Trade.2026`). Nhánh `data` dùng riêng để chứa dữ liệu trạm 24/7.

### 1.2. Thứ tự nạp module (`index.html:45-76`)

27 thẻ `<script>` nạp **tuần tự theo thứ tự phụ thuộc** (không dùng ES module/import):

```
config → utils → ta → smc → exchanges → derivatives → journal → bridge → engine
→ neural → whale → calendar → bot → rag → order → learn → advisor → heatmap
→ knowledge → screens → aichat → screens2 → app
→ datahub.config → datahub → flowdb → datahub-ui → datahub-bridge
```

Mọi module dùng biến/hàm global (`"use strict"` từng file, không `export`). Đổi thứ tự nạp sẽ vỡ (vd `datahub-bridge.js` yêu cầu nạp sau `app.js` vì nó đăng ký thêm màn hình vào router).

### 1.3. Router + 14 màn hình (`assets/js/app.js:4-18`, `datahub-bridge.js`)

Router hash (`#/tinhieu`, `#/bot`…). 13 màn hình trong `app.js`:

| ID | Tên | File render chính |
|---|---|---|
| `tongquan` | 📊 Tổng quan | screens.js |
| `bieudo` | 📈 Biểu đồ | screens.js |
| `tinhieu` | 🎯 Tín hiệu | screens.js |
| `ragauto` | 🧬 RAG Auto | rag.js |
| `camap` | 🐋 Radar Cá Mập | screens2.js |
| `heatmap` | 🔥 Bản đồ thanh lý | heatmap.js |
| `bot` | 🤖 Bot Trade | screens2.js |
| `tuhoc` | 📓 Nhật ký & Tự học | learn.js |
| `sotinhieu` | 📝 Sổ tín hiệu | journal.js |
| `lichkinhte` | 📅 Lịch kinh tế | screens2.js |
| `hoidap` | 💬 AI Hỏi đáp | screens2.js (gọi `aichat.js`) |
| `kienthuc` | 📚 Kiến thức | screens2.js (đọc playbook `knowledge.js`) |
| `huongdan` | 🧭 Hướng dẫn | screens2.js |

Màn hình thứ 14, `dongtien` (🌊 Dòng tiền), do `datahub-bridge.js` đăng ký thêm vào router sau khi nạp.

### 1.4. Vòng đời chạy trong trình duyệt (`assets/js/app.js:150-208`, hàm `boot()`)

1. `BRIDGE.khoiDong()` — bọc `JOURNAL.ghiNhan` để đẩy tín hiệu lên trạm (xem §6).
2. `NN.datCheDo(SETTINGS.nnCheDo)` — mặc định `'shadow'`; nạp `assets/nn-weights.json` (thiếu file thì bỏ qua).
3. `PRICE_HUB = new PriceHub(...)` + `PAPER_BOT = new PaperBot()` (mặc định **tắt**, `enabled: false`).
4. Quét tín hiệu ngay (`quetTatCa()`) rồi lặp theo `SETTINGS.refreshTinHieuSec` (**180 giây**); quét tuần tự từng coin, giãn cách **350 ms** giữa các coin để tránh rate-limit (`app.js:104-115`).
5. Chart coin đang xem phân tích lại mỗi **60 giây**; heatmap làm mới mỗi **60 giây** khi đang mở; lịch kinh tế nạp nền + làm mới mỗi **15 phút**; journal tự chấm điểm mỗi **15 phút**.
6. **Tiết kiệm tài nguyên:** `datahub-bridge.js` — tab ẩn > 5 phút thì `DataHub.stop()`, quay lại thì nối lại.

### 1.5. Phần duy nhất giống "backend": `api/ai-proxy.js` (71 dòng)

- Vercel Serverless Function, chỉ phục vụ màn hình **AI Hỏi đáp** (`aichat.js`): browser → `POST /api/ai-proxy` → Vercel → provider. Allowlist chỉ 2 provider: `apmix` (`https://api.apmix.ai/v1/chat/completions`) và `anthropic` (`https://api.anthropic.com/v1/messages`); `temperature: 0.3`, `max_tokens: 2048`, timeout 85 giây. Key nằm trong body request, "KHÔNG log, KHÔNG lưu".
- File này **không liên quan tới tín hiệu/bot**, và chỉ chạy khi deploy lên Vercel (host tĩnh khác sẽ không có `/api/ai-proxy`).
- `aichat.js` còn hỗ trợ gọi trực tiếp 3 provider từ browser: Google Gemini, OpenAI, Anthropic Claude; key lưu trong trình duyệt (localStorage, hiển thị dạng `••••••••`).

### 1.6. Trạm 24/7 (phần chạy trên server, nằm trong `tools/` — xem §8)

Trạm là các script **Node.js chạy bằng cron trên một server riêng** (host/cấu hình cron không có trong repo — xem §9): `collector-247.js` (quét tín hiệu 15 phút/lần), `flow-collector.js` (thu dòng tiền 15 phút/lần), `bridge-browser.js` (kéo tín hiệu từ trình duyệt, 2 phút/lần), `snapshot-12h.js` (2 lần/ngày), `push-247.js` (đẩy dữ liệu lên nhánh `data` mỗi giờ). Dữ liệu trạm nằm trong `data/` và được web tải về hiển thị.

---

## 2. Engine tín hiệu

### 2.1. Luồng đa khung — `phanTichCoin(coin)` (`assets/js/engine.js:31-452`)

Hàm duy nhất tạo tín hiệu. Mỗi lần chạy:

1. **Tải nến 3 khung song song** (`fetchKlines`, limit 260 nến/khung): 4H (`TIMEFRAMES.HTF`), 1H (`MTF`), 15m (`LTF`). Thiếu khung nào → throw "Thiếu dữ liệu nến".
2. **Khung 4H — bias:** `phanTichCauTruc(c4h, swingL=3)` + EMA200/EMA50. Bias `bullish`/`bearish` chỉ khi cấu trúc và EMA200 **đồng thuận**; nếu chỉ một phía thì `bullish-yếu`/`bearish-yếu`; còn lại `range`. `side = long` nếu bias bắt đầu bằng `bullish`, `short` nếu `bearish`, `null` nếu range (không có hướng → không có tín hiệu).
3. **Khung 1H — bối cảnh:** POI (Order Block / FVG), `volumeProfile` (120 nến gần nhất: POC + HVN), `dealingRange` (premium/discount), `timEqualLevels` (EQH/EQL).
4. **Khung 15m — trigger:** sweep → CHoCH → IDM + RSI reversal (`rsiReversal`).
5. **Trạng thái thị trường v2.6.0:** `danhGiaTrangThai` trên 6 swing gần nhất → `TĂNG` / `GIẢM` / `ĐI NGANG` cho từng khung; 3 cờ: `nguocCauTruc` (4H ngược hướng tín hiệu), `chochNguoc` (CHoCH 1H ngược hướng), `dongPha3Khung` (cả 3 khung cùng hướng).
6. **POI:** `chonPOI()` — 5 tầng ưu tiên (xem §2.3).
7. **Máy trạng thái → checklist → điều chỉnh điểm → verdict → kế hoạch** (chi tiết dưới đây).
8. **Hậu xử lý:** chụp snapshot đặc trưng NN (`NN.taoSnapshotDacTrung` + provenance nến đóng), `NN.danhGia()` (shadow, không ảnh hưởng điểm), `JOURNAL.ghiNhan()` (ghi mọi tín hiệu LONG/SHORT vào nhật ký), phát sự kiện DOM `siro:signal`.

### 2.2. Máy trạng thái 5 bước (`engine.js:13-19` — `PHASE_LABELS`, và `engine.js:127-161`)

```
wait_bias ("Chờ xu hướng rõ")
  → wait_sweep ("Chờ quét thanh khoản")
  → wait_choch ("Chờ CHoCH xác nhận")
  → wait_retest ("Chờ hồi về POI")
  → retest_in_progress ("Đang retest POI")
  → alert_ready ("SẴN SÀNG VÀO LỆNH") | invalidated ("Setup bị vô hiệu")
```

Luật chuyển phase (chỉ khi `side` khác null):

- Có `sweep` đúng phía → `wait_choch`; có `choch` → `wait_retest`.
- Khi có `choch` + `poi`: xét các **nến ĐÃ ĐÓNG sau CHoCH** (vòng lặp `for (i = choch.index + 1; i < c15.length - 1; i++)` — cố tình bỏ nến forming cuối cùng, fix chống repaint v2.0). Dung sai chạm vùng `tol = (zHi − zLo) × 0.15 + ATR15 × 0.1`.
  - Nến đóng **xuyên vùng** quá `ATR × 0.5` theo hướng ngược → `invalidated`.
  - Đã chạm vùng và có nến đóng giữ phía trên/dưới vùng → `alert_ready`, `retest = "held"`.
  - Đang trong vùng (hoặc giá hiện tại trong vùng ± tol) → `retest_in_progress`, `retest = "testing"`.
- Không có `side` → ở mãi `wait_bias`.

**Quy trình 5 bước của Mr.Bit** (header `engine.js:1-11`, cũng là 5 bước hiển thị trên thẻ tín hiệu `screens.js:905-912` — Chờ → Quét TK → CHoCH → Retest → Vào lệnh):

1. Chờ giá về vùng quan trọng trên khung lớn (POI: OB/FVG)
2. Quan sát cú QUÉT THANH KHOẢN (stop hunt / spring)
3. Xuống khung nhỏ chờ CHoCH thật (body close, có sweep trước, IDM)
4. Vào lệnh tại retest POI / vùng Fibo OTE — SL sau wick sweep — TP theo RR
5. Quản lý lệnh: dời SL về hòa vốn khi +1R

### 2.3. SMC core — `assets/js/smc.js` (471 dòng)

| Hàm | Luật chính (trích code) |
|---|---|
| `phanTichCauTruc(candles, swingL)` | Pivot fractal; bias từ 4 swing cuối (≥3 cùng chiều = bullish/bearish) |
| `timSweepGanNhat(candles, cauTruc, maxBars = 24)` | Wick xuyên pivot trước rồi đóng cửa quay lại; **chỉ nến đã đóng**; 2 phía cùng 1 nến → bên thắng theo giá đóng |
| `timChoCh(candles, cauTruc, sweep, swingL, maxBarsSauSweep = 20)` | Phải có sweep trước; **bodyClose** = toàn bộ thân nến vượt mức (wick không tính); tối đa 20 nến sau sweep; chỉ dùng pivot đã xác nhận (`pivotDaXacNhan`) |
| `kiemTraIDM(candles, choch, sweep)` | Pullback ≥ 30% chân sóng rồi tiếp diễn |
| `timFVG(candles, lookback = 80)` | FVG 3 nến; coi là filled nếu giá quay lại quá 50% mid |
| `timOrderBlocks(candles, {lookback = 80, dispAtr = 1.35, bodyAtr = 0.15, impulseBars = 5})` | Mitigated khi giá đóng xuyên vùng |
| `timEqualLevels(cauTruc, tol = 0.0012)` | Dung sai 0.12%, 8 pivot gần nhất |
| `dealingRange(cauTruc, gia)` | Premium ≥ 62%, discount ≤ 38%, equilibrium ở giữa; range < 0.4% coi là không tin cậy |
| `danhGiaTrangThai(cauTruc)` | 6 swing: ≥4 tăng & ≤1 giảm = TĂNG (và ngược lại) |
| `chonPOI({...})` | 5 tầng: (1) OB trước CHoCH ở LTF ≤ 12 nến; (2) OB tươi LTF; (3) OB 1H; (4) FVG chưa fill; (5) dải sweep→CHoCH |
| `danhGiaChatLuongOB(ob, ctx)` | Điểm −100..100; KHỎE ≥ 70, TRUNG BÌNH 40–69, YẾU < 40. Trừ 20 nếu OB bị test ≥ 3 lần; trừ 30 nếu ngược xu hướng 4H; cộng điểm cho momentum, gắn CHoCH, liquidity phía sau (EQH/EQL gần vùng), HTF alignment |
| `danhGiaNen(candles, ctx)` | Pin bar, engulfing, doji, inside bar; chỉ có giá trị khi ở đúng chỗ (POI/S-R/swing); volume ≥ 1.3× trung bình mới xác nhận; body ≥ 1.2 ATR; phân biệt breakout thật/giả. Xếp loại: MẠNH ≥ 70, TRUNG BÌNH ≥ 45, YẾU ≥ 20, còn lại CHỐNG LỆNH |

### 2.4. Chỉ báo kỹ thuật — `assets/js/ta.js` (218 dòng)

`emaSeries` (seed bằng SMA), `rsiSeries` (Wilder, chu kỳ 14), `atrSeries` (SMA của True Range, 14), `findPivots` (fractal k, `confirmedIndex = i + k`, `pivotDaXacNhan`), `highestPrior`/`lowestPrior`, `volumeProfile` (24 bin, POC + HVN tại ≥ 70% max), `fiboOTE` (0.618 / 0.705 / 0.786), `rsiReversal` (Cardwell hidden divergence, 40 pivot gần nhất).

### 2.5. Chấm điểm hợp lưu /100 (`engine.js:232-290` + điều chỉnh sau đó)

**Checklist 6 mục** — trọng số trong `config.js:99-106` (`CHECKLIST_WEIGHTS`):

| # | Mục | Tối đa | Cách tính điểm |
|---|---|---|---|
| 1 | `htf_bias` — Xu hướng 4H rõ ràng | 25 | Rõ ràng = 25; yếu (`bullish-yếu`/`bearish-yếu`) = 15; range = 0 |
| 2 | `poi_context` — POI chất lượng + đúng vùng giá | 15 | Có POI = 8; đủ 15 nếu giá ở đúng phía discount (long) / premium (short) trên 1H |
| 3 | `liquidity_sweep` — Đã quét thanh khoản | 20 | Có sweep đúng phía = 20, không = 0 |
| 4 | `fvg_quality` — CHoCH thật | 15 | Có CHoCH = 5; +5 nếu body close; +5 nếu có IDM |
| 5 | `ltf_confirmation` — Retest giữ vùng POI | 15 | `held` = 15; `testing` = 7; chưa retest = 0 |
| 6 | `risk_reward` — R:R ≥ 1:2 | 10 | Kế hoạch có RR ≥ minRR = 10, không = 0 |

Cộng thêm `KILLZONE_BONUS = 5` nếu đang trong killzone/giờ vàng và có hướng. Tổng clamp 0..100.

**Điều chỉnh điểm sau checklist** (áp theo thứ tự trong code):

| Điều chỉnh | Mức | Điều kiện |
|---|---|---|
| Dòng tiền DataHub đồng thuận / ngược hướng | +5 / −5 | `flowScore` ≥ 15 cùng chiều / ≤ −15 ngược chiều |
| Lịch sử dòng tiền 12h đồng thuận / ngược | +3 / −3 | `flowScore12h` (5 khung) tương tự |
| Ngược cấu trúc 4H | −12 | `cauTruc.nguocCauTruc` |
| CHoCH 1H ngược hướng | −8 | `cauTruc.chochNguoc` |
| Đồng pha 3 khung | +5 | `cauTruc.dongPha3Khung` |
| Chất lượng OB | −10 / +5 | POI là OB và xếp loại YẾU / KHỎE |
| Bối cảnh nến | +5 / −8 / −3 | MẠNH / CHỐNG LỆNH / YẾU |
| Phái sinh (funding/OI/thanh lý/vol) | ±8 tối đa | `phanTichPhaiSinh()` (xem §3.5) |

**Ngưỡng verdict** (`config.js:121` — `VERDICT = { ALERT: 70, PREPARE: 50 }`; `engine.js:398-404`):

- `LONG` / `SHORT`: **điểm ≥ 70 VÀ phase là `alert_ready` hoặc `retest_in_progress`** (điểm cao nhưng chưa retest thì không báo).
- `PREPARE`: điểm ≥ 50 (nhưng chưa đủ điều kiện LONG/SHORT).
- `WAIT_CONFIRM`: có hướng nhưng chưa có CHoCH.
- `NO_TRADE`: không có hướng, hoặc phase `invalidated`.

### 2.6. Kế hoạch entry/SL/TP (`engine.js:163-207`)

Chỉ dựng khi có `side` + `poi` + `sweep` đúng phía; `risk = |entry − SL|`, nếu `risk ≤ 0` thì không có plan:

- **Entry** = mép vùng POI (long: `zHi`, short: `zLo`); **entrySau** (limit 2) = giữa vùng `(zLo + zHi) / 2`.
- **SL** = `min(wick sweep, zLo) − ATR15 × 0.25` (long) / `max(wick sweep, zHi) + ATR15 × 0.25` (short) — tức SL nằm sau râu sweep, có đệm 0.25 ATR.
- **TP1** = entry ± risk × `minRR` (**2**); **TP2** = entry ± risk × `preferRR` (**3**).
- **TP thanh khoản (`tpLiq`)** = EQH/EQL gần nhất hoặc đỉnh/đáy 1H gần nhất theo hướng lệnh; kèm `rrLiq`.
- **Fibo OTE** trên chân sweep → đỉnh CHoCH (0.618–0.786).
- **Sizing:** `riskUsdt = vốn × riskPct%` (vốn = balance của PaperBot nếu có, mặc định 10.000 USDT); `qty = riskUsdt / risk`; `giaTri = qty × entry`.
- **TP nam châm:** nếu heatmap có cụm thanh lý gần nhất theo hướng lệnh → `plan.tpNamCham` + `rrNamCham`.

### 2.7. Chống repaint — CÓ, và được kiểm chứng bằng test

- Sweep/CHoCH/retest **chỉ dùng nến đã đóng**: `timSweepGanNhat` quét tới `lastDong` (nến đóng cuối), `timChoCh` giới hạn 20 nến sau sweep và chỉ pivot đã xác nhận, vòng retest bỏ nến forming (`i < c15.length - 1`) — comment trong code: *"FIX v2.0: bỏ nến forming, chống repaint"*.
- `tools/harness_v2.js` (2.543 dòng) có test riêng cho các fix này (vd `demChamOB` đếm đúng 2 lần chạm, bỏ nến forming cuối).
- **Lưu ý:** giá hiển thị/plan vẫn dùng nến 15m cuối (`gia = c15[last].close`) — tức giá "hiện tại" là giá đóng của nến 15m đang chạy, có thể lệch với giá tick real-time; engine có cảnh báo riêng khi giá DataHub lệch > 0.4% so với giá nến.

### 2.8. Mạng nơ-ron — `assets/js/neural.js` (469 dòng) + `assets/nn-weights.json`

- **Kiến trúc:** MLP **24 → 8 → 1, 209 tham số** (`NN_KIEN_TRUC = [24, 8, 1]`, `NN_SO_DAC_TRUNG = 24`): **12 đặc trưng thô + 12 cờ thiếu (missing-mask)**. Đặc trưng gồm: điểm, RR, side, bias, killzone, cấu trúc ngược, CHoCH ngược, điểm OB, số lần chạm OB, điểm nến, xếp loại nến, số checklist đạt.
- **Nhãn:** `y = 1` nếu `netR > 0` (R ròng sau phí 5bps + trượt giá 2bps mỗi chiều). **Cổng kỹ thuật:** `NN_MAU_TOI_THIEU = 100` mẫu — dưới ngưỡng chỉ quan sát.
- **Chế độ:** `shadow` (mặc định, `SETTINGS.nnCheDo`) hoặc `off`. **Shadow chỉ quan sát: KHÔNG gọi order, KHÔNG đổi điểm/verdict, KHÔNG tự thăng cấp.** `NN.danhGia()` trả assessment `{status, mode, p, modelVersion, phienBanDacTrung, doTreMs, lyDo}`; `calibrated = false` — xác suất **chưa hiệu chuẩn**, UI chỉ hiện % khi `status === "san_sang"`, còn lại không vẽ số giả.
- **Snapshot:** mỗi tín hiệu được chụp `featureSnapshot` kèm provenance (openTime/closeTime của nến đóng cuối mỗi khung 4H/1H/15m + `availableAt`); journal lưu copy, trainer chỉ đọc snapshot đã lưu.
- **Train:** `tools/train-nn.js` — đọc journal đã ngã ngũ → chia train/val/test **60/20/20 theo thời gian** + purge overlap 15 phút → so baseline → ghi file **ứng viên** (không tự thay trọng số runtime). Thăng cấp shadow → chính thức là **quyết định thủ công của user** (theo `docs/NEURAL_SHADOW.md`: ≥ 30 mẫu ngã ngũ + valAcc vượt baseline + user duyệt).
- **Weights:** `assets/nn-weights.json` (version 1). **Phát hiện khi đọc (xem §9):** file này ghi `"sizes": [12, 8, 1]` trong khi `NN_KIEN_TRUC` hiện tại là `[24, 8, 1]` — khớp với logic `kiemTraTuongThich()` thì file weights sẽ bị đánh `khong_tuong_thich` (kiến trúc không khớp), tức NN hiện tại nhiều khả năng **không ở trạng thái `san_sang`**. Chưa chạy kiểm chứng runtime — cần xác minh bằng cách mở app → Cài đặt → "🧠 Mạng nơ-ron" → xem "Trạng thái".

### 2.9. Cảnh báo kèm theo tín hiệu (`engine.js:293-330`)

Mỗi kết quả `ketQua` mang mảng `canhBao`: RSI 15m quá mua/quá bán (≥ 70 / ≤ 30), RSI đảo chiều ngược hướng, giá ở premium (long) / discount (short), ngoài killzone, giá sát POC (< 0.4%), đang trong vùng tin ★★★ hoặc tin ★★★ trong 1h tới, dòng tiền ngược hướng, thanh lý 15 phút > $20M, giá lệch giữa các sàn > 0.4%, nam châm heatmap ngược hướng, cấu trúc ngược, OB/nến xấu, cảnh báo phái sinh. Thẻ tín hiệu hiển thị tất cả (`screens.js` — mục "⚠ N cảnh báo").

### 2.10. Đối tượng kết quả `ketQua` (trường dùng cho bot — `engine.js:406-431`)

`coin, gia, time, dongTien, heatmap, phaiSinh, htf {bias, ctBias, ema200, ema50, dinh, day}, mtf {obCount, poc, hvn, range, eq}, ltf {sweep, choch, idm, rsi, atr}, side, phase, phaseLabel, retest, score, checklist[], verdict, killzone, canhBao[], cauTruc, chatLuongOB, chatLuongNen, poi, plan, candles15 (90 nến cuối), ob15 (4 OB chưa mitigated), fvg15 (4 FVG chưa fill), featureSnapshot, nnDanhGia, nnXacSuat`.

---

## 3. Nguồn dữ liệu

### 3.1. Giá & nến — `assets/js/exchanges.js` (274 dòng), class `PriceHub`

- **Nến:** `fetchKlines()` — Binance `data-api.binance.vision` → fallback `api.binance.com` → fallback **OKX** (`OKX_BAR` map 5m/15m/1h/4h/1d). Limit 260 (engine) / 300. `layTatCaCoinBinance()` qua `exchangeInfo`: chỉ cặp TRADING + USDT, **loại leveraged token**, cache localStorage 24h.
- **Độ sâu:** `fetchDepth(coin, 50)` Binance → OKX. **Fear & Greed:** `api.alternative.me/fng/` (thiếu value → `null`, không bịa).
- **PriceHub — 6 slot giá tách riêng theo nguồn:** `BINANCE`, `OKX`, `MEXC`, `BYBIT_PERP`, `HYPERLIQUID`, `DH_KHAC`. WebSocket: Binance combined `miniTicker`, OKX tickers (ping 25s), MEXC futures `sub.ticker` (ping 20s). Reconnect backoff hàm mũ.
- **Quy tắc provenance (rất chặt, có test trong harness):** `gia()` ưu tiên spot Binance → OKX → MEXC; **giá perp chỉ dùng khi `perpOk = true`** (chỉ cho quản lý vị thế khẩn cấp, không dùng làm giá tín hiệu). `giaTuoiNhat()` trả giá tươi nhất kèm nguồn + cờ `laPerp` để ghi rõ nguồn khi dùng chéo sàn. Giá perp **không bao giờ** được nhét vào slot spot.

### 3.2. DataHub — dòng tiền real-time đa sàn (`assets/js/datahub.js` 643 dòng + `datahub.config.js` 73 dòng)

`DataHub` chạy trong trình duyệt, zero-dependency, event bus `on("whale"|"liq"|"price"|"poly"|"news"|"stats"|"macro"|"etf"|"source")`. Cấu hình bật/tắt từng nguồn trong `datahub.config.js` (`DH_CONFIG.sources`):

| Nguồn | Cách lấy | Trạng thái mặc định | Ghi chú |
|---|---|---|---|
| Binance Futures | WS `aggTrade` + `!forceOrder@arr` + ticker | **Bật** | Lệnh lớn + thanh lý + giá. Sau 4 lần thử kết nối thất bại → hạ cấp sang **spot WS** (mất kênh thanh lý, trạng thái `degraded`) |
| OKX | WS v5 `trades` + `liquidation-orders` | **Bật** | Ping 22s; `ctVal` tải từ `/api/v5/public/instruments` |
| Bybit | WS v5 linear `publicTrade` + `allLiquidation` | **Bật** | Ping 18s; giá Bybit làm dự phòng khi ticker Binance bị chặn |
| Hyperliquid | WS `trades` (DEX perp) | **Bật** | Ping 30s |
| Polymarket | REST poll 5s | **Bật** | Dòng lệnh cá cược; ≥ $500 |
| Macro | REST: Fear&Greed 5 phút/lần; funding + OI Binance Futures 60s/lần (top 6 coin) | **Bật** | |
| ETF Flows | JSON qua proxy | **Tắt** | Chưa cấu hình endpoint |
| News RSS | RSS qua proxy | **Tắt** | Chưa cấu hình endpoint |
| TraderMap | REST + WS bên thứ ba | **Tắt** | Cần quyền + proxy (không CORS cho github.io) |

- **Ngưỡng lọc:** lệnh lớn (whale) ≥ **$100.000**, giữ 600 bản ghi, cửa sổ thống kê 60 phút; thanh lý ≥ **$5.000**, giữ 400; Polymarket ≥ **$500**, giữ 200.
- **`flowScore(coin)`** (−100..+100, cửa sổ 30 phút): `(buy−sell)/(buy+sell) × 70` + `(liqLong−liqShort)/(liqLong+liqShort) × 30`. Có tham số `loaiTruSan` để loại nguồn đã tính ở nơi khác (OKX bị loại khi cộng vào Whale Score — chống đếm trùng).
- **`flowScore12h(coin, soKhung)`** (tối đa 5 khung, mặc định 5): đọc `data/flow-history-12h.json` từ nhánh `data` trên GitHub (3.285 khung 12h, từ 01/01/2026; nguồn Binance whale/taker + CoinEx thanh lý): whale × 50 + taker imbalance × 30 + thanh lý × 20.
- **Độ tươi/provenance:** mỗi nguồn có trạng thái `on | retry | off | degraded` + số message + timestamp; WS stale 45s → tự đóng + reconnect (base 1s, max 30s, backoff ×1.8). Thống kê tổng hợp (`buildStats`) mỗi 2 giây. `DataHubBridge` chỉ bơm giá DataHub vào PriceHub khi giá của app cũ hơn **10 giây**.
- **Giới hạn quan trọng:** DataHub chỉ chạy khi **tab mở**; tab ẩn > 5 phút thì dừng hẳn (`datahub-bridge.js`).

### 3.3. FlowDB — database dòng tiền trong trình duyệt (`assets/js/flowdb.js` 569 dòng)

- Mọi sự kiện whale/thanh lý từ DataHub được ghi **liên tục vào IndexedDB** (`trade2026-flow`, 4 store: `whales`, `liqs`, `buckets`, `alerts`), **giữ 7 ngày**, tự dọn cũ; flush buffer mỗi 2 giây; bucket theo phút từng coin.
- **Khử trùng với trạm 24/7:** web và trạm dùng chung format id (`okx-<tradeId>`, `hl-…`, `okxl-…`); tập id đã thấy lưu localStorage (`fdb_ids_v1`, tối đa 12.000) để merge không đếm trùng. `mergeTram()` nhận dữ liệu trạm (OKX + Hyperliquid thu liên tục kể cả khi tab tắt).
- **Cảnh báo tự động** (check mỗi 30s, cooldown 15 phút, giữ tối đa 100): burst ≥ 3 lệnh cùng chiều tổng ≥ **$1M / 5 phút**; net 15 phút đảo dấu với biên ≥ **$300K**; thanh lý ≥ **$500K / 5 phút**.
- Fallback RAM nếu IndexedDB không dùng được. Hết bộ nhớ → dừng ghi, chờ user dọn (chính sách: **không tự xóa**).
- Engine ưu tiên điểm dòng tiền từ FlowDB ("master") khi đủ dữ liệu (≥ 3 lệnh trong cửa sổ 30 phút), fallback về điểm live RAM.

### 3.4. Radar Cá Mập — `assets/js/whale.js` (143 dòng), `tinhWhaleScore(coin)`

Whale Score **−100..+100**, 8 thành phần (thiếu dữ liệu → 0 điểm cho thành phần đó, không bịa):

| # | Thành phần | Tối đa | Nguồn |
|---|---|---|---|
| 1 | Vị thế Top Trader | ±25 | OKX rubik `long-short-position-ratio-contract-top-trader` (5m) |
| 2 | Dòng Taker 4h | ±20 | OKX rubik `taker-volume` (48 kỳ 5m) |
| 3 | Open Interest 4h | ±15 | OKX rubik OI history × hướng giá |
| 4 | Thanh lý 60 phút | ±15 | OKX `liquidation-orders` |
| 5 | Funding rate | ±10 | OKX funding (contrarian nhẹ: funding dương cao → trừ) |
| 6 | Sổ lệnh Spot | ±10 | `fetchDepth` Binance/OKX, bid/ask |
| 7 | Đám đông (đảo chiều) | ±5 | OKX rubik long-short account ratio (contrarian) |
| 8 | Dòng tiền real-time (DataHub) | ±20 | `DataHubBridge.congVaoWhaleScore` — đã **trừ OKX** để không đếm trùng mục 2 |

Nhãn: ≥ 30 "Cá mập nghiêng MUA mạnh", ≥ 10 "Thiên MUA nhẹ", ≤ −30 "nghiêng BÁN mạnh", ≤ −10 "Thiên BÁN nhẹ", còn lại "Trung lập / phân hóa". Cache 5 phút (`WHALE_CACHE`). `fetchLenhLon(coin, nguongUsd = 100.000)` lấy 30 lệnh lớn gần nhất trên OKX swap.

### 3.5. Phái sinh — `assets/js/derivatives.js` (293 dòng)

Logic trích từ skills Vibe-Trading, dữ liệu từ DataHub (funding/OI Binance Futures) + FlowDB (thanh lý 24h) + DeFiLlama (stablecoin) + nến 1h (HV):

- **Funding regime** (`fundingRegime`, rate 8h theo %): > 0.05 "LONG quá nóng" (mức 2, contrarian short), ≥ 0.02 "Funding dương cao" (mức 1), ≥ 0.005 dương nhẹ, ±0.005 cân bằng, > −0.02 âm nhẹ, còn lại "SHORT quá nóng" (mức −2, contrarian long). Funding annualize = rate × 3 × 365.
- **Ma trận OI × Funding** (`oiFundingSignal`): OI +5% & funding > 0.03 → "Đòn bẩy LONG dồn" (mức −2); OI +5% & funding < −0.03 → "Đòn bẩy SHORT dồn" (mức +2); OI < −5% & |funding| > 0.03 → "Đang xả đòn bẩy".
- **Áp lực thanh lý 24h** (`danhGiaLiq`): long/short ratio > 2 → long squeeze (mức −1); < 0.5 → short squeeze (mức +1); tổng > **$500M** → EXTREME.
- **Stablecoin pulse** (`diemStablecoin`, DeFiLlama, cache 1h): cung 30 ngày > +5% → +8, ≥ +2% → +4, > 0 → 0, > −2% → −2, còn lại −6.
- **HV percentile** (`hvPercentile`, window 30, lookback 250, annualize × √365): percentile < 20 "Vol đang NÉN", > 80 "Vol đang CAO".
- **`phanTichPhaiSinh(coin, {side})`** → `dieuChinh` cộng vào điểm engine, clamp **±8**: funding contrarian cùng hướng lệnh +4 / ngược hướng −4; OI dồn đòn bẩy ngược hướng lệnh −3 / cùng chiều +2. Cache dữ liệu thô 60 giây; OI lưu ring buffer RAM 26 giờ (ghi mỗi 60s).

### 3.6. Liquidation Heatmap — `assets/js/heatmap.js` (351 dòng)

Mô hình ước tính kiểu Coinglass Model 1 (không phải số dư vị thế thật của sàn — UI ghi rõ "ƯỚC TÍNH"):

- Mỗi nến: 35% volume coi là vị thế đòn bẩy mới, phân bổ 10x (0.32) / 25x (0.28) / 50x (0.22) / 100x (0.18); long mở tại P → mức thanh lý ≈ P×(1−1/lev); short → P×(1+1/lev). Thanh khoản **tích lũy** tại từng mức giá, **bị tiêu** khi giá quét qua.
- 5 khung: 12h/5m/144 nến, 24h/15m/96, 3 ngày/30m/144, 1 tuần/1h/168, 1 tháng/4h/180. 130 bins giá; chuẩn hóa màu theo phân vị 98; cache 3 phút.
- **Nam châm giá** (`phanTichHeatmap`): cụm ≥ 22% maxVal; phía nào nhiều thanh khoản chưa quét hơn → giá dễ bị hút về phía đó; `huong = "len" | "xuong" | "can_bang"` với ngưỡng lệch ±20%. `heatmapChoEngine()` (cache 5 phút, khung 24h) đưa vào engine: cụm gần nhất theo hướng lệnh thành `plan.tpNamCham`; nam châm ngược hướng → cảnh báo.
- Thanh lý **thật** từ DataHub (Bybit/Binance-F/OKX) đè lên heatmap dưới dạng chấm trắng/đỏ.

### 3.7. Lịch kinh tế — `assets/js/calendar.js` (382 dòng)

- **Nguồn 3 tầng** (theo thứ tự ưu tiên, chọn bản mới nhất theo `generatedAt`): (0) real-time qua `r.jina.ai` render trang Trading Economics (sao ★ ước lượng theo loại chỉ số + quốc gia vì text không có sao); (1) `data/economic_calendar_data.json` trong repo (cùng origin, không CORS); (2) file JSON user nạp thủ công (localStorage); (2b) dữ liệu nhúng; (3) proxy CORS parse trực tiếp TE (allorigins/codetabs/corsproxy.io — best-effort, TE hay chặn IP datacenter). Có iframe TE trực tiếp + widget TradingView dự phòng.
- **Phân tích tác động:** surprise Actual vs Consensus/Forecast/Previous → nhóm chỉ số (lãi suất, lạm phát, việc làm, thất nghiệp, GDP, sức khỏe KT, thương mại) với hướng dir −1/+1 và trọng số; `tinhMacroPulse()` tổng hợp 48h qua → **−100..+100** (`100 × tanh(raw/12)`); `suKienSapToi()` đếm ngược tin ★★★; **quy tắc: tránh vào lệnh ±30 phút quanh tin 3 sao**.
- **Độ tươi (`lichConTuoi()`):** lịch chỉ được dùng ra quyết định khi `generatedAt` trong 48h **và** sự kiện mới nhất ≥ hiện tại − 24h. Lịch cũ → chỉ hiển thị tham khảo, **không được âm thầm chặn/quyết định** (bot chỉ cảnh báo 1 lần/phiên).
- File trong repo lúc đọc: `generatedAt: 2026-11-05T19:53:25+0000`, sheets Recent 359 / Today 57 / Tomorrow 6 / This Week 130 / Next Week 229. Cập nhật bằng `tools/update_calendar.py` hoặc GitHub Actions 6h/lần (xem §8).

### 3.8. RAG Auto — `assets/js/rag.js` (336 dòng), `ragPipeline(coin)`

Kiến trúc Agentic RAG + Corrective RAG (CRAG):

```
Query(coin) → 🧭 Planner
  → 5 Tool Agent CHẠY SONG SONG:
      📡 Market & Structure (nến 3 khung + SMC engine; dùng cache SIGNAL_CACHE nếu < 5 phút)
      🐋 Whale Flow (OKX rubik; cache 5 phút)
      🌊 Dòng tiền đa sàn (DataHub real-time + thanh lý 15 phút + heatmap nam châm)
      📰 Macro News (lịch kinh tế TE → Macro Pulse + tin sắp tới)
      📚 Knowledge Retriever (truy xuất tối đa 5 quy tắc từ playbook KIEN_THUC khớp bối cảnh)
  → ⚖️ Evaluator/Grader (CRAG): CORRECT / AMBIGUOUS / INCORRECT
      AMBIGUOUS → truy xuất lại, tối đa 2 vòng; INCORRECT → NO_TRADE
  → 🧠 Reasoner (hợp nhất trọng số) → 🛡️ Risk Manager → LONG / SHORT / ĐỨNG NGOÀI + độ tin cậy
```

- **Trọng số Reasoner** (`config.js:112-114` — nguồn sự thật duy nhất): SMC **0.35**, Whale **0.20**, Dòng tiền **0.20**, Macro **0.15**, Momentum (RSI) **0.10**; heatmap là lớp điều chỉnh riêng **±0.06**. Ngưỡng vote `RAG_NGUONG_VOTE = 0.18`: vote ≥ +0.18 và SMC không ngược → LONG; ≤ −0.18 và SMC không ngược → SHORT; vote lớn nhưng mâu thuẫn SMC → đứng ngoài.
- **Độ tin cậy:** `conf = min(1, |vote| / 0.5) × 100`; × 0.7 nếu grade AMBIGUOUS; × 0.5 nếu các lớp lớn mâu thuẫn nhau (disagreement index).
- **Veto (đứng ngoài dù vote đủ):** đang trong vùng tin ★★★ ±30 phút (chỉ khi lịch còn tươi); thanh lý 15 phút > **$20M**.
- Risk Manager kèm kế hoạch entry/SL/TP từ engine + cổng kỷ luật `PAPER_BOT.kiemTraKyLuat()`.
- RAG chạy theo yêu cầu (bấm "▶ Chạy pipeline") hoặc tự chạy khi mở màn hình; áp dụng được cho **bất kỳ coin nào trên Binance** (v2.11.0), không chỉ watchlist — nhưng coin ngoài watchlist có thể thiếu dữ liệu Whale/Dòng tiền.

---

## 4. Paper Trading Bot + Advisor + Order Ticket

### 4.1. `PaperBot` — `assets/js/bot.js` (346 dòng)

Lưu `localStorage` key `siro_paperbot_v1`. **Mặc định TẮT** (`enabled: false`); bật thì `tick()` mỗi **60 giây**.

**Cấu hình mặc định** (`bot.js:15-35`): `minScore = VERDICT.ALERT` (**70**), `riskPct` = 1, `minRR` = 2, `maxViThe` = 3, `loNgayMaxPct` = 4, `cooldownPhut` = 60, `allowLong/allowShort = true`, `chiKillzone = false`, `neTin3Sao = true`, `xacNhanDongTien = true`, `whaleXacNhan = false`, `doiSLveBE = true`, `donBay` = 3, `phiPct` = **0.05%/chiều**, `notionalMax` = 0 (không giới hạn).

**Cổng kỷ luật `kiemTraKyLuat(kq)`** — trả về danh sách lý do từ chối (rỗng = cho phép mở lệnh). Thứ tự kiểm tra:

1. Phải có `side`; verdict phải là LONG/SHORT; điểm ≥ minScore (70).
2. Có plan; `plan.rr1 ≥ minRR`; chưa đủ `maxViThe` vị thế; chưa có vị thế cùng coin.
3. Cooldown: chưa mở lệnh cùng coin trong 60 phút qua.
4. Ngắt mạch lỗ ngày đang bật → từ chối.
5. `chiKillzone` (mặc định tắt): nếu bật mà ngoài killzone → từ chối.
6. **Cổng DataHub** (nếu `xacNhanDongTien`): thanh lý 5 phút > **$20M** → chặn; `flowScore` ngược hướng (long mà ≤ −15, short mà ≥ +15) → chặn.
7. **Né tin ★★★** (nếu `neTin3Sao`): lịch cũ > 48h → **không chặn**, chỉ cảnh báo 1 lần/phiên; lịch tươi và đang trong vùng tin ±30 phút → chặn.
8. **Whale xác nhận** (nếu `whaleXacNhan`, mặc định tắt): long cần whale score ≥ 10, short cần ≤ −10; chưa có dữ liệu whale → chặn.

**Mở lệnh `moLenh(kq)`:** entry = **giá thị trường live** (không phải entry kế hoạch); nếu RR thực tế < `minRR × 0.8` → **bỏ qua, không FOMO đuổi lệnh**; `qty = riskUsdt / risk` với trần notional nếu cấu hình; ghi log + phát sự kiện `siro:botpos`. Tín hiệu cũ hơn **10 phút** thì `tick()` bỏ qua.

**Giám sát `onTick(coin, gia, san)`:** SL/TP canh theo feed của **sàn của vị thế**; **dời SL về hòa vốn khi đạt +1R** (`doiSLveBE`); nếu feed của sàn vị thế chết > **20 giây** → dùng giá tươi nhất chéo sàn (`PRICE_HUB.giaTuoiNhat`, kể cả perp, **có ghi rõ nguồn**).

**Đóng lệnh `dongLenh()`:** PnL trừ **phí taker 2 chiều** (0.05%/chiều); `rQuy` (số R); history tối đa **300** lệnh, equity curve tối đa **500** điểm; mỗi lệnh đóng phát sự kiện `siro:tradeClose` → vòng tự học (`hocTuLichSu()`).

**Ngắt mạch lỗ ngày:** `_capNhatNgay()` — ngày tính theo múi giờ VN (`en-CA`, `Asia/Ho_Chi_Minh`); nếu lỗ trong ngày ≥ `loNgayMaxPct` (**4%**) → `circuitTripped = true`, dừng mở lệnh mới tới hết ngày, reset vào ngày mới.

**Lệnh tay `moLenhTay()`:** từ phiếu đặt lệnh 2 bước (đã qua kiểm tra an toàn UI): sàn, Cross/Isolated, đòn bẩy, entry/SL/TP, riskPct/qty do phiếu quyết định; `nguon: "tay"`.

**Thống kê `thongKe()`:** số lệnh, thắng/thua, winRate, tổng PnL, avgR, balance, equity, PnL mở, drawdown ngày (%). `xuatCSV()` xuất nhật ký lệnh.

### 4.2. Trade Advisor — `assets/js/advisor.js` (411 dòng)

- `parseTradeInput(text)`: regex trích từ text/ảnh chụp phiếu lệnh — coin, side, đòn bẩy (clamp 1..125), entry, giá hiện tại, SL, TP, PnL%. `ocrAnh()`: Tesseract.js 5 qua CDN, lazy-load.
- `phanTichLenhNguoiDung(trade)`: chấm **0–100, bắt đầu từ 50**:
  - SMC thuận/ngược: **±(12 + score/100 × 13)**; RAG đồng thuận/ngược: **±15 × conf**; premium/discount đúng/sai phía: **±8**; đòn bẩy ≤ 3: +5, > 5: −10; RR ≥ 2: +10, ≥ 1.5: +2, thấp hơn: −8; **không có SL: −12**; whale đồng/ngược: ±8; dòng tiền đa sàn đồng/ngược: ±10; thanh lý 15 phút > $20M: −6; heatmap đồng/ngược: ±6; đang trong vùng tin ★★★: −12; trong killzone: +4; delta từ kiến thức đã học (learn.js).
  - Mức độ: ≥ 70 `TOI_UU`, ≥ 50 `KHA`, còn lại `RUI_RO`. Gợi ý quản lý vị thế + "lệnh tốt hơn" (plan của hệ thống hoặc SL 1.5×ATR, TP 2R/3R, đòn bẩy ≤ 3).
  - `autoBook = true` nếu TOI_UU + thuận tín hiệu + không trong vùng tin + có plan tốt hơn → tự mở phiếu đặt lệnh 2 bước.

### 4.3. Phiếu đặt lệnh 2 bước — `assets/js/order.js` (399 dòng)

- **Bước 1 — cấu hình:** sàn (Binance/OKX/MEXC, giá real-time từng sàn), Long/Short, Cross/Isolated, đòn bẩy (preset 3/10/20/50/75/100/125/200/500, tối đa theo `LEV_MAX`), entry Market/Limit, SL/TP **tự map từ kế hoạch tín hiệu** (nếu cùng hướng; khác hướng thì mặc định SL/TP = ±1.5 ATR / ±3 ATR). Sizing 3 cách đổi qua lại: Risk % vốn / Số lượng coin / Giá trị lệnh. Hiển thị live: R:R, rủi ro thực tế (% vốn + USDT), ký quỹ, lãi/lỗ ước tính tại TP/SL, ROI ký quỹ, **giá thanh lý ước tính** (isolated, đệm bảo trì 5%: long `entry × (1 − 0.95/lev)`).
- **Bước 1 — kiểm tra an toàn `kiemTraAnToanLenh()`:** 10 lớp (SMC, RAG Auto, R:R, đòn bẩy, rủi ro thực tế, SL trước thanh lý, lịch kinh tế ★★★, Radar Cá Mập, dòng tiền đa sàn + quét thanh khoản, vùng giá 1H, ngắt mạch/vị thế trùng, phiên/killzone) → `AN_TOAN` (0 bad, 0 warn) / `TRUNG_TINH` (0 bad, ≥ 1 warn — thực tế code: `soBad > 0 → RUI_RO`, còn lại có warn → TRUNG_TINH) / `RUI_RO` (≥ 1 bad). Mức RUI_RO muốn xác nhận phải tick checkbox "Tôi hiểu các rủi ro trên…".
- **Bước 2 — xác nhận:** `PAPER_BOT.moLenhTay()` — lệnh khớp **mô phỏng** bằng giá thật của sàn đã chọn; bot giám sát SL/TP + dời BE +1R. Lệnh thật: user tự đặt trên sàn theo đúng phiếu (nguyên tắc `requiresUserDecision` — ghi trong code).

---

## 5. config.js — các hằng số quan trọng

File `assets/js/config.js` (121 dòng) là **nguồn sự thật duy nhất** cho cấu hình (UI render từ đây, không hard-code số ở nơi khác — ít nhất là với `RAG_WEIGHTS`).

| Nhóm | Hằng số |
|---|---|
| Version | `APP_VERSION = "2.17.2"`; `SIRO_VERSION = "1.0.0"` (tương thích ngược state cũ) |
| Watchlist | `WATCHLIST_CORE` = **6 coin**: BTC, ETH, SOL, BNB, DOGE, DYDX. `WATCHLIST_PHU` = **9 coin**: ARB, OP, RUNE, FET, INJ, TIA, SEI, SUI, WIF. Tổng **15 coin**; màn hình Tín hiệu tối đa **12 coin** (`tinHieuCoins.slice(0, 12)`) |
| Phiên (giờ VN) | Asia 6–14, EU 14–22, US 19–3, **GIỜ VÀNG 19–22** |
| Killzone (giờ UTC) | London 07–10, New York 12–16 |
| Rủi ro mặc định | Vốn ban đầu **10.000 USDT**; risk **1%/lệnh** (tối đa 2%); **minRR 1:2**, preferRR 1:3; tối đa **3 vị thế**; ngắt mạch lỗ ngày **4%**; cooldown **60 phút**; đòn bẩy tham chiếu **3x** (hồ sơ 2–3x) |
| Khung thời gian | 4H swingL 3, 1H swingL 4, 15m swingL 5; limit nến **260** mỗi khung |
| Endpoint | Binance REST `data-api.binance.vision` + `api.binance.com`; WS `wss://stream.binance.com:9443/stream`; OKX REST `www.okx.com`, WS `wss://ws.okx.com:8443/ws/v5/public`; MEXC WS `wss://contract.mexc.com/edge`; F&G `api.alternative.me/fng/`; TE `tradingeconomics.com/calendar`; proxy CORS: allorigins / codetabs / corsproxy.io |
| Checklist | htf_bias 25, poi_context 15, liquidity_sweep 20, fvg_quality 15, ltf_confirmation 15, risk_reward 10; `KILLZONE_BONUS = 5` |
| RAG | `RAG_WEIGHTS = {smc: 0.35, whale: 0.20, flow: 0.20, macro: 0.15, momentum: 0.10}`; `RAG_HEATMAP_ADJ = 0.06`; `RAG_NGUONG_VOTE = 0.18` |
| Verdict | `VERDICT = {ALERT: 70, PREPARE: 50}` |
| Đòn bẩy tối đa | `LEV_MAX = {BINANCE: 125, OKX: 125, MEXC: 500}`; preset [3, 10, 20, 50, 75, 100, 125, 200, 500] |
| Cài đặt user (`loadSettings`, key `siro_settings_v1`) | `refreshTinHieuSec` = **180**; `nnCheDo` = `'shadow'` (hoặc `'off'`); `bridgeBat` = false; `bridgePat` = "" (PAT do user nhập, lưu local) |

---

## 6. Tích hợp Telegram / webhook / notify: KHÔNG CÓ

**Kết quả grep toàn dự án** (tất cả `*.js`, `*.html`, `*.py`, `*.md`, `*.json`, `*.yml`):

- Từ khóa `telegram`, `sendMessage`, `api.telegram`, `webhook`, `notify`, `pushbullet`, `discord`: **0 kết quả**.
- Từ khóa `alert(`: chỉ có `alert()` của trình duyệt (popup JS) trong `order.js`, `screens.js`, `screens2.js` — không phải hệ thống cảnh báo.
- **Kết luận: dự án hiện tại KHÔNG có bất kỳ tích hợp Telegram / webhook / push notification nào.** Tín hiệu chỉ hiển thị trên UI web + sự kiện DOM `siro:signal` + ghi journal local.

**Kênh thông báo duy nhất đang tồn tại là WhatsApp, qua cầu nối GitHub** (không phải Telegram):

1. Trình duyệt: `assets/js/bridge.js` — khi bật trong Cài đặt (`bridgeBat` + `bridgePat`), `BRIDGE.khoiDong()` bọc `JOURNAL.ghiNhan`/`ghiNhanGiay`; mỗi bản ghi tín hiệu mới được rút gọn (`banGhiGon()`: id, coin, side, loai that/giay, tsVao, giaVao, sl, tp, rr, diem, phien, bias4h, trangThai, ketQua, nn, cauTruc, ob, nen, nguon="browser") rồi đẩy lên `data/browser-signals.json` nhánh `data` qua **GitHub Contents API** (PAT fine-grained, chỉ repo này, quyền Contents read+write, lưu trong localStorage; tối đa 1.000 bản ghi trong hàng đợi, đầy thì dừng đẩy — không tự xóa; thử lại 1 lần nếu race SHA 409/422).
2. Trạm: `tools/bridge-browser.js` (cron 2 phút) kéo file đó về, kiểm chứng từng bản ghi, khử trùng theo id, trộn vào store journal trạm + đẩy lên đầu `data/journal-247.json` để cron WhatsApp thấy id mới là gửi tin ngay (không chờ vòng collector 15 phút).
3. Trạm: `tools/collector-247.js` (cron 15 phút) tự quét tín hiệu → ghi `data/journal-247.json` → WhatsApp gửi luôn.
4. **Code gửi WhatsApp không nằm trong repo này** — chỉ được nhắc trong comment (`bridge.js`, `collector-247.js`, `bridge-browser.js`, `screens2.js:539-647` mô tả luồng cho user). `tools/harness_v2.js:1434-1439` có test đọc 2 file ngoài repo: `/home/hatch/hooks/scripts/trade2026-signal-whatsapp.sh` và `/home/hatch/hooks/definitions/trade2026-signal-whatsapp.json` (template tin nhắn có dòng "🏯 Cấu trúc", bỏ dòng nếu `cauTruc` null) — **2 file này không tồn tại trong workspace lúc đọc (06/11)**, tức phần gửi WhatsApp sống ngoài repo, cần kiểm chứng riêng ở phía trạm/hook.

**Hệ quả cho bot Telegram mới:** không có sẵn endpoint, secret, hay module nào để tái dùng cho Telegram; phải xây mới hoàn toàn phần gửi tin (xem §10). Nhưng luồng **tín hiệu → journal → cầu nối → trạm → gửi tin** đã có sẵn và có thể bắt chước y hệt, chỉ thay đầu ra WhatsApp bằng Telegram.

---

## 7. Cách chạy thử local và deploy

### 7.1. Chạy thử local

- **Cách đơn giản nhất (theo README):** mở trực tiếp `index.html` bằng trình duyệt (double-click). Không cần build, không cần `npm install`, không cần server.
- **Cách khuyên dùng:** chạy một static server trong thư mục dự án để tránh hạn chế của `file://` (vd `fetch` file JSON local, ES/Worker):
  - `python3 -m http.server 8000` rồi mở `http://localhost:8000/`, hoặc
  - `npx serve .` / bất kỳ static server nào.
- **Yêu cầu:** internet (gọi trực tiếp API public Binance/OKX/MEXC/Trading Economics/r.jina.ai… từ trình duyệt). Không cần API key cho tín hiệu/giá/dòng tiền/lịch. Key chỉ cần cho màn hình AI Hỏi đáp (Gemini/OpenAI/Anthropic/APMIX) — nhập trong app, lưu ở trình duyệt.
- **Kiểm tra nhanh sau khi mở:** header hiện 3 chấm trạng thái BINANCE/OKX/MEXC (xanh = WS nối được); đồng hồ giờ VN chạy; màn hình Tín hiệu quét xong 6 coin core trong ~1–2 phút (quét tuần tự, 350 ms/coin + thời gian tải nến); tab DevTools Console không báo lỗi nạp script (thứ tự script rất quan trọng).
- **Test không cần trình duyệt:** `node tools/harness_v2.js` — test các hàm thuần (ta/smc/exchanges/datahub/flowdb/bridge/…); `node tools/train-nn.js` — train NN từ journal.

### 7.2. Deploy

- **Bất kỳ static host nào:** GitHub Pages (có sẵn file `.nojekyll`), Vercel, Netlify — chỉ cần upload toàn bộ thư mục, không build step.
- **Vercel thêm:** `api/ai-proxy.js` được Vercel tự nhận diện thành serverless function cho AI chat (không bắt buộc).
- **Không cần server cho app.** Phần duy nhất cần server là **trạm 24/7** (`tools/*.js` chạy cron — xem §8) và cron WhatsApp; cấu hình host/cron của trạm **không có trong repo**.
- **GitHub Actions duy nhất:** `.github/workflows/update-calendar.yml` — chạy 4 lần/ngày (00:15/06:15/12:15/18:15 UTC = 07:15/13:15/19:15/01:15 giờ VN), chạy `tools/update_calendar.py`, commit khi dữ liệu tươi hơn 12h và > 50 dòng.

---

## 8. Thư mục tools, data, docs và các module phụ

### 8.1. `tools/` — trạm 24/7 + tiện ích (chạy bằng Node.js, cron trên server riêng)

| File | Chức năng (trích header code) |
|---|---|
| `collector-247.js` (246 dòng) | Trạm quan trắc 24/7, cron **15 phút**. Chạy engine trong `vm` (tái dùng `assets/js/*.js` nguyên vẹn, không cần mở web). **Chế độ AUTO (quyết định user 01/10/2026):** mỗi vòng lấy **top 30 cặp USDT theo volume 24h** trên Binance Futures + giữ coin cũ; có tín hiệu đạt chuẩn (LONG/SHORT) là ghi journal → WhatsApp luôn, không cần khai báo coin. Ghi `data/journal-247.json` (+ store local `.journal-247-store.json`), đẩy lên nhánh `data` mỗi giờ |
| `flow-collector.js` (182 dòng) | Trạm thu dòng tiền 24/7, cron 15 phút. Poll REST **OKX + Hyperliquid** (Binance/Bybit bị chặn geo từ server); lệnh lớn ≥ **$100K** → whales, thanh lý OKX → liqs; ghi `data/flow-247.json`. Giới hạn bộ nhớ: cảnh báo 3MB, đầy 5MB thì dừng ghi, thoát code 2 để cron nhắc user |
| `bridge-browser.js` (153 dòng) | Cầu nối trình duyệt → trạm, cron **2 phút**. Kéo `data/browser-signals.json`, kiểm chứng + khử trùng theo id, trộn vào store journal trạm và đầu payload `journal-247.json` |
| `snapshot-12h.js` (88 dòng) | Snapshot dòng tiền 12h, **2 lần/ngày 00:07 & 12:07 giờ VN**. Tổng hợp cửa sổ 12h vừa kết thúc, nối vào `data/flow-history-12h.json` (không ghi đè). Lịch sử trước 28/09/2026 do `backfill-flow-12h.py` nạp từ Binance + CoinEx |
| `push-247.js` (28 dòng) | Đẩy `journal-247.json` + `flow-247.json` + `flow-history-12h.json` lên nhánh `data` **mỗi giờ** (qua `gh_push.py`, repo `hayhahen-ui/Trade.2026`) |
| `backfill-flow-12h.py` (301 dòng) | Nạp lịch sử dòng tiền 12h từ Binance (whale) + CoinEx (thanh lý) |
| `update_calendar.py` (206 dòng) | Cập nhật lịch kinh tế TE (guest API, retry backoff 3 lần, ghi file atomic; fetch lỗi thì giữ file cũ, exit 1) |
| `train-nn.js` (144 dòng) | Train MLP (xem §2.8); cổng ≥ 100 mẫu; chia 60/20/20 theo thời gian + purge 15 phút |
| `harness_v2.js` (2.543 dòng) | Test hàm thuần bằng Node, không cần trình duyệt |
| `proxy/cloudflare-worker.js` | Proxy CORS (Cloudflare Worker Free) cho nguồn không mở CORS (ETF, RSS, tradermap). Allowlist: `farside.co.uk`, `api.alternative.me`, `www.coindesk.com`, `cointelegraph.com` |

### 8.2. `data/` — dữ liệu trạm (nhánh `data` trên GitHub; bản trong zip là snapshot)

| File | Nội dung (kiểm tra thực tế 06/11) |
|---|---|
| `browser-signals.json` (3,8 KB) | Tín hiệu từ trình duyệt đẩy lên qua bridge; `capNhat: 2026-10-01T07:36:38Z`; mỗi bản ghi có đủ trường `id/coin/side/loai/tsVao/giaVao/sl/tp/rr/diem/phien/bias4h/trangThai/ketQua/nn/cauTruc/ob/nen/nguon` (vd `BTC-long-1790840197899`, điểm 85, RR 2) |
| `economic_calendar_data.json` (520 KB) | Lịch TE; `generatedAt: 2026-11-05T19:53:25+0000`; sheets Recent 359 / Today 57 / Tomorrow 6 / This Week 130 / Next Week 229 / This Month 359 |
| `flow-247.json` (205 KB) | Dòng tiền trạm; `capNhat: 2026-10-02T00:22:53Z`; 800 whales + 800 liqs; khóa `tram/capNhat/nguon/nguong/whales/liqs/meta` |
| `flow-history-12h.json` (770 KB) | **3.285 khung 12h**; mỗi khung `w/coin/takerMua/takerBan/whaleMua/whaleBan/nWhaleMua/nWhaleBan/liqLong/liqShort/nLiqLong/nLiqShort/srcW/srcL` (vd `srcW: Binance`, `srcL: CoinEx`) |
| `journal-247.json` (13 KB) | Journal trạm; `capNhat: 2026-10-02T00:22:46Z`; khóa `tram/capNhat/vongQuet/thongKe/baiHoc/mucTieuNgay/tinHieu/meta`; 24 tín hiệu |

**Lưu ý vận hành (xem §9):** `capNhat` trong `journal-247.json` và `flow-247.json` là **02/10/2026** — dữ liệu trạm đã hơn 1 tháng tuổi tại thời điểm đọc (06/11/2026).

### 8.3. `docs/`

- `MRBIT_NEURAL_CODING_01.md` (537 dòng) — đặc tả tích hợp NN (P0/P1/P2): feature flag, snapshot/provenance, registry versioned, scorer interface, cổng thăng cấp.
- `NEURAL_SHADOW.md` (40 dòng) — ánh xạ P0 → file thật; trạng thái assessment; vận hành train/thăng cấp thủ công.
- `docs-datahub.md` (ở root) — tài liệu DataHub (chưa đọc chi tiết; không ảnh hưởng luồng tín hiệu).

### 8.4. Các module phụ (đã đọc lướt / grep, không đi sâu vì ngoài luồng tín hiệu chính)

- `journal.js` (733 dòng) — `JOURNAL.ghiNhan()`: mọi tín hiệu LONG/SHORT được ghi với id `${coin}-${side}-${timestamp}`; **cửa sổ đánh giá 15 phút** (`_hanGio = 0.25`, v2.17.1 — trước đó 4h, trước nữa 48h); chấm điểm bằng nến 1m: `thang / thua / khong_ro / khong_hop_le / het_han / thieu_du_lieu`; `netR` sau phí 5bps + trượt 2bps mỗi chiều; kèm MFE/MAE (đơn vị R); tối đa 300 bản ghi; tự chấm điểm mỗi 15 phút trong trình duyệt. `ghiNhanGiay()` cho lệnh giấy (`GIAY-…`).
- `learn.js` (512 dòng) — vòng tự học Kaizen: cắt lát lịch sử theo theo/ngược tín hiệu, killzone, đòn bẩy, phiên, điểm, coin, hướng; so win-rate từng lát với tổng thể; sinh quy tắc áp ngược vào Advisor (`dieuChinhKienThuc`) và engine.
- `knowledge.js` (179 dòng) — playbook `KIEN_THUC`: quy trình 5 bước, công cụ (Premium/Discount, RSI Cardwell…), phiên giao dịch — nguồn cho RAG Knowledge Retriever.
- `screens.js` (951 dòng) + `screens2.js` (831 dòng) — toàn bộ UI: thẻ tín hiệu `veTheTinHieu()` (xem §10.5 để lấy đúng trường), panel SMC + canvas vẽ OB/FVG/sweep/CHoCH, màn hình Bot/Journal/Lịch/Kiến thức/Hướng dẫn, modal Cài đặt (watchlist, risk, NN, bridge WhatsApp).
- `utils.js` (142 dòng) — helper chung (`el`, `fmtGia`, `fmtUsd`, `clamp`, `lsGet/lsSet`…), `phienHienTai()`, `dangKillzone()` (killzone UTC London/NY **hoặc** giờ vàng VN 19–22 → active).
- `aichat.js` (272 dòng) — AI Hỏi đáp (xem §1.5).
- `datahub-ui.js` (785 dòng) — màn hình 🌊 Dòng tiền (bảng whale/liq, KPI, phân bổ size, cảnh báo burst/flip).

---

## 9. Điểm chưa rõ / mâu thuẫn / rủi ro phát hiện khi đọc

1. **Không có Telegram/webhook/notify nào** (xác nhận bằng grep toàn dự án — xem §6). Bot Telegram mới phải xây phần gửi tin từ đầu.
2. **Dữ liệu trạm 24/7 đã cũ:** `journal-247.json` và `flow-247.json` có `capNhat` **02/10/2026**; `browser-signals.json` là **01/10/2026**. Tại thời điểm đọc (06/11/2026) trạm có vẻ đã **ngừng đẩy dữ liệu hơn 1 tháng**. Chỉ có `economic_calendar_data.json` là tươi (05/11/2026, nhờ GitHub Actions chạy độc lập). Cần kiểm tra trạm (host/cron) còn chạy không trước khi dựa vào nó cho bot mới.
3. **File weights NN không khớp kiến trúc hiện tại:** `assets/nn-weights.json` ghi `"sizes": [12, 8, 1]` trong khi `NN_KIEN_TRUC = [24, 8, 1]` (`neural.js:103`). Theo logic `kiemTraTuongThich()` thì file này sẽ bị đánh `khong_tuong_thich` → NN không ở trạng thái `san_sang`. Chưa chạy kiểm chứng runtime; xác minh bằng cách mở app → Cài đặt → "🧠 Mạng nơ-ron" → xem "Trạng thái". (Nếu đúng, bot mới không nên dựa vào `nnDanhGia.p` cho tới khi train lại bằng `tools/train-nn.js`.)
4. **Lệch version:** README ghi v2.0.0 (2026-09-25), `config.js`/`index.html` ghi v2.17.2. README cũng ghi "lịch kinh tế (regenerate 2026-09-25: 454 sự kiện)" trong khi file hiện tại có 359 sự kiện Recent (05/11/2026).
5. **Host/cron của trạm 24/7 không có trong repo:** chỉ có script + comment mô tả cron (15 phút / 2 phút / 1 phút / mỗi giờ / 2 lần/ngày). Không tìm thấy file cấu hình cron, systemd, hay hướng dẫn deploy trạm. Code gửi WhatsApp cũng không trong repo (xem §6).
6. **Rủi ro geo-block Binance:** DataHub tự hạ cấp Binance Futures → Spot sau 4 lần thử thất bại (mất kênh thanh lý); `flow-collector.js` ghi rõ Binance/Bybit **bị chặn geo từ server** nên trạm chỉ thu OKX + Hyperliquid. Bot chạy trên server (Vercel/Railway/…) cần tính tới việc này — xem §10.1.
7. **Lịch TE qua r.jina.ai ước lượng sao:** tầng real-time của lịch dùng sao ★ ước lượng theo loại chỉ số (không phải sao thật của TE); code có cơ chế "mượn sao thật" từ bản JSON trong repo cho sự kiện trùng — nhưng nếu repo JSON cũ thì sao vẫn là ước lượng.
8. **Chưa đọc chi tiết:** `docs-datahub.md`, `screens2.js` (phần màn hình Bot/Journal/Lịch — chỉ grep), `datahub-ui.js` (chỉ biết chức năng tổng thể), `assets/css/*`. Không ảnh hưởng tới luồng tín hiệu/bot.
9. **Không tìm thấy trong code:** cấu hình deploy cụ thể (không có `vercel.json`/`netlify.toml`; chỉ có `.nojekyll` → ngầm hiểu GitHub Pages); số lượng user/người dùng; bất kỳ thông tin đăng nhập nào (không có và không nên có trong repo).

---

## 10. Gợi ý kiến trúc bot Telegram theo đúng luồng này

### 10.1. Bot chạy ở đâu 24/7

- **Không chạy trong trình duyệt.** Engine hiện tại sống trong tab web (`app.js` quét mỗi 180s; tab đóng là hết tín hiệu; DataHub dừng khi tab ẩn > 5 phút). Bot Telegram cần chạy độc lập 24/7.
- **Lựa chọn đúng luồng nhất: tái dùng trạm 24/7 đã có (`tools/collector-247.js`).** Trạm này đã chạy engine thật trong Node `vm` (tái dùng `assets/js/*.js` nguyên vẹn), quét **top 30 cặp USDT theo volume 24h** (AUTO mode từ 01/10/2026), ghi `data/journal-247.json`, và đã có sẵn đầu ra WhatsApp. **Việc cần làm: thêm một đầu ra Telegram song song với đầu ra WhatsApp hiện tại** (cùng một điểm: sau khi `collector-247.js` ghi tín hiệu đạt chuẩn vào journal, và sau khi `bridge-browser.js` trộn tín hiệu từ trình duyệt).
- **Lưu ý geo-block:** trạm hiện tại chỉ thu được OKX + Hyperliquid từ server (Binance/Bybit bị chặn geo — `flow-collector.js`). Engine lấy nến qua `data-api.binance.vision` (không bị chặn geo theo comment trong `config.js`) nên phần **tín hiệu SMC vẫn chạy được trên server**; chỉ phần dòng tiền DataHub live (Binance/Bybit WS) là thiếu trên server — trạm đã bù bằng `flow-247.json` (OKX+HL) + `flow-history-12h.json`. Bot Telegram nên chạy **cùng host với trạm** (nơi collector đang chạy) để dùng chung dữ liệu, thay vì deploy nơi khác rồi đồng bộ lại.
- **Phương án dự phòng nếu trạm đã chết (dữ liệu trạm cũ từ 02/10 — xem §9.2):** kiểm tra và khởi động lại trạm trước; nếu không khôi phục được, dựng worker mới (Node, chạy `collector-247.js` + một sender Telegram) trên VPS/Render/Railway — code trạm không phụ thuộc host cụ thể, chỉ cần Node + cron + quyền ghi nhánh `data` (qua `gh_push.py` như `push-247.js` đang làm).
- **Không nên:** chạy engine trong GitHub Actions theo lịch (mỗi lần chạy là process mới, mất state FlowDB/cooldown/dedupe; Actions cũng giới hạn phút chạy); chạy trên Vercel serverless thuần (thời gian chạy giới hạn, không giữ WS).

### 10.2. Chu kỳ quét

- **Theo đúng app:** `refreshTinHieuSec = 180` (**3 phút/lần**, `config.js`, `app.js: setInterval(quetTatCa, 180s)`); quét tuần tự từng coin, giãn cách **350 ms** giữa các coin.
- **Theo đúng trạm:** `collector-247.js` cron **15 phút/lần** (quét top 30 coin nên chu kỳ dài hơn). Bot Telegram nên theo **chu kỳ trạm (15 phút)** cho tín hiệu chính (vì tín hiệu SMC đổi theo nến 15m — quét nhanh hơn không tạo tín hiệu mới, chỉ tốn API), và dùng chu kỳ 3 phút chỉ khi cần theo dõi retest của các setup đang ở phase `retest_in_progress` (để báo đúng lúc chuyển sang `alert_ready`).
- **Nhịp gửi tin:** gửi ngay khi tín hiệu mới đạt chuẩn xuất hiện (như cron WhatsApp 1 phút hiện tại: thấy id mới là gửi). Không gửi lại tín hiệu cũ — xem chống trùng §10.4.

### 10.3. Ngưỡng điểm + machine state 5 bước

- **Ngưỡng báo (giữ nguyên engine):** chỉ báo khi `verdict === "LONG" | "SHORT"`, tức **điểm hợp lưu ≥ 70 VÀ phase là `alert_ready` hoặc `retest_in_progress`** (`engine.js:398-404`). Không báo ở `PREPARE` (≥ 50) — chỉ có thể gửi bản tin "chuẩn bị" riêng, tần suất thấp, ghi rõ là chưa đủ điều kiện vào lệnh.
- **Machine state 5 bước (giữ nguyên, dùng làm "tiến trình" trong tin nhắn):** `wait_bias → wait_sweep → wait_choch → wait_retest → retest_in_progress → alert_ready | invalidated`. Tin nhắn báo tín hiệu phải ghi rõ phase hiện tại (`phaseLabel`: "SẴN SÀNG VÀO LỆNH" hoặc "Đang retest POI") và 5 bước đã hoàn thành tới đâu (thẻ tín hiệu vẽ 5 bước: Chờ → Quét TK → CHoCH → Retest → Vào lệnh — `screens.js:905-912`).
- **Cổng kỷ luật của PaperBot nên áp thêm trước khi gửi** (để bot Telegram không báo những lệnh mà chính hệ thống cũng không dám vào): `kiemTraKyLuat()` — verdict LONG/SHORT, điểm ≥ 70, có plan, RR ≥ 1:2, chưa đủ 3 vị thế, không trùng coin đang mở, cooldown 60 phút, không ngắt mạch, dòng tiền không ngược hướng, không trong vùng tin ★★★ (lịch còn tươi). Riêng cổng "vị thế/cooldown/ngắt mạch" thuộc về PaperBot (paper trading), không thuộc engine — bot Telegram cần quyết định rõ: **báo mọi tín hiệu đạt chuẩn engine, hay chỉ báo tín hiệu mà PaperBot cũng vào lệnh**. Khuyến nghị: báo mọi tín hiệu đạt chuẩn engine, nhưng gắn nhãn "PaperBot: ĐÃ VÀO / BỊ CHẶN (lý do)" để user biết.
- **Không hạ ngưỡng, không dùng NN để lọc:** NN đang shadow, chưa hiệu chuẩn, weights hiện tại có dấu hiệu không tương thích (§9.3). Chỉ hiển thị `nnDanhGia.p` khi `status === "san_sang"` (như thẻ tín hiệu đang làm), kèm chú thích "chưa hiệu chuẩn".

### 10.4. Chống trùng (dedupe)

Tái dùng đúng 3 cơ chế đã có trong code:

1. **ID tín hiệu:** journal ghi mỗi tín hiệu với id `${coin}-${side}-${timestamp}` (`journal.js:16`); bridge khử trùng theo id khi trộn (`bridge-browser.js`); bot chỉ gửi khi thấy **id mới** (như cron WhatsApp 1 phút hiện tại).
2. **Cooldown 60 phút/coin** (`RISK_DEFAULTS.cooldownPhut`, `bot.js:104-107`): không báo 2 tín hiệu cùng coin trong 60 phút (kể cả khi phase đổi từ `retest_in_progress` → `alert_ready` — chỉ cập nhật tin nhắn cũ hoặc gửi tin "cập nhật phase", không gửi tin mới).
3. **Cửa sổ tươi 10 phút** (`bot.js:146`): tín hiệu cũ hơn 10 phút thì bỏ qua, không gửi bù. **Và:** chỉ gửi tín hiệu **thật** (`loai: "that"`), không gửi tín hiệu giấy (`loai: "giay"`) — đúng quy tắc WhatsApp hiện tại (`screens2.js:599`: "chỉ tín hiệu thật mới gửi WhatsApp").
4. **Lưu trạng thái đã gửi:** ghi lại id đã gửi (file JSON trên trạm, cùng chỗ với `.journal-247-store.json`, hoặc bảng riêng) để process restart không gửi lại. Tuyệt đối không dựa vào bộ nhớ RAM của process.

### 10.5. Định dạng tin nhắn báo tín hiệu (lấy đúng các trường trong thẻ tín hiệu của app)

Thẻ tín hiệu (`screens.js:832-962`, `veTheTinHieu`) hiển thị đúng các trường sau — tin nhắn Telegram nên giữ nguyên thứ tự và nội dung này (không thêm số liệu không có trong `ketQua`):

```
🟢 LONG BTC/USDT — 85/100 · SẴN SÀNG VÀO LỆNH
💰 Giá: <gia hiện tại> (giá DataHub nếu lệch > 0.4% thì ghi chú)
📊 Điểm hợp lưu: 85/100
🧭 Bias 4H: Bullish · 🏯 Cấu trúc: 4H TĂNG · 1H TĂNG ✓đồng pha
🧱 OB: KHỎE 78đ · 🕯️ Nến: MẠNH 72đ · Pin bar (tại POI)
🌊 Dòng tiền đa sàn: +32 · mua ✓ · 💥 Thanh lý 15ph: $X (L $Y / S $Z) — chỉ hiện khi > $1M
📚 Dòng tiền 12h ×5: +18 · mua ✓
🧲 Heatmap TL: hút lên $… (cụm gần nhất)
📋 5 bước: 1.Chờ ✓ 2.Quét TK ✓ 3.CHoCH ✓ 4.Retest ✓ 5.Vào lệnh ✓
📐 Kế hoạch: E <entry> · SL <sl> · TP1 <tp1> · TP2 <tp2> · RR 1:<rr1>
   (kèm TP thanh khoản <tpLiq> RR 1:<rrLiq> và TP nam châm <tpNamCham> nếu có)
✅ Checklist: Xu hướng 4H 25/25 · POI 15/15 · Quét TK 20/20 · CHoCH 15/15 · Retest 15/15 · R:R 10/10
⚠ Cảnh báo (n): <tối đa 3 cảnh báo đầu tiên, vd "Ngoài killzone/giờ vàng", "Đang trong vùng tin ★★★…">
🧠 NN: <chỉ hiện khi san_sang: "NN dự đoán 62% thắng (chưa hiệu chuẩn)">
🕐 Cập nhật <giờ VN> · Không phải lời khuyên đầu tư.
```

- **Nút bấm dưới tin nhắn** (theo mẫu bot NexusPilot hiện tại của hay): [📊 Xem chart] → link app `#/bieudo?coin=BTC`; [🛒 Đặt lệnh] → mở phiếu 2 bước (chỉ mở trong app, không đặt lệnh từ Telegram); [💬 Hỗ trợ] → `https://t.me/soledadhuong90` (nick hỗ trợ đang dùng trong bot NexusPilot).
- **Giới hạn Telegram:** caption ảnh tối đa 1.024 ký tự — nếu kèm chart thì tách ảnh + tin text đầy đủ (theo đúng cách bot NexusPilot đã làm với chart Pillow). Tin text thuần không giới hạn 1.024 (giới hạn 4.096 ký tự/tin).
- **Tin cập nhật phase:** khi setup đang `retest_in_progress` chuyển sang `alert_ready` (cùng id tín hiệu), gửi tin ngắn "cập nhật" thay vì tin đầy đủ mới — hoặc sửa tin cũ (editMessageText) nếu bot giữ message_id.
- **Tin đóng/chấm điểm (tùy chọn, giai đoạn 2):** journal chấm điểm tín hiệu sau tối đa 15 phút (`_hanGio = 0.25`); có thể gửi tin follow-up "thắng/thua/hết hạn + netR" — nhưng chỉ khi đã có cơ chế lưu message_id để reply đúng thread.

### 10.6. Phần nào của code app có thể tái dùng nguyên vẹn

| Phần | File | Cách tái dùng |
|---|---|---|
| Toàn bộ engine tín hiệu | `engine.js` + `smc.js` + `ta.js` | **Nguyên vẹn** — trạm `collector-247.js` đã làm đúng cách này: nạp file vào Node `vm`, gọi `phanTichCoin(coin)`, nhận `ketQua`. Bot Telegram chỉ cần thêm sender sau bước này |
| Cấu hình (hằng số) | `config.js` | Nguyên vẹn — cùng một nguồn sự thật (watchlist, ngưỡng 70/50, trọng số, risk) |
| Nguồn giá/nến | `exchanges.js` (`fetchKlines`, `PriceHub`) | Nguyên vẹn trong Node (cần `fetch` — Node 18+ có sẵn; `localStorage` cần shim vì `layTatCaCoinBinance` cache 24h) |
| Dòng tiền / whale / heatmap / phái sinh / lịch | `datahub.js` (+`datahub.config.js`), `whale.js`, `heatmap.js`, `derivatives.js`, `calendar.js` | Nguyên vẹn về logic; nhưng DataHub dùng WebSocket trình duyệt — trên server cần chạy trong cùng process Node với `ws` (WebSocket client) hoặc dùng dữ liệu trạm đã thu (`flow-247.json`, `flow-history-12h.json`) thay cho live WS |
| RAG Auto | `rag.js` | Tái dùng được (logic thuần + fetch); chỉ chạy khi cần gợi ý bổ sung, không bắt buộc cho tin báo chính |
| Cổng kỷ luật PaperBot | `bot.js` (`kiemTraKyLuat`, `PaperBot`) | Tái dùng logic; cần shim `localStorage` (`lsGet/lsSet` trong `utils.js`) bằng file JSON trên server để giữ state (vị thế, cooldown, ngắt mạch) qua restart |
| Journal + chấm điểm + tự học | `journal.js`, `learn.js` | Tái dùng — journal là nơi duy nhất ghi tín hiệu + chấm điểm 15 phút + sinh bài học Kaizen; bot nên đọc journal thay vì tự chấm |
| Cầu nối trình duyệt → trạm | `bridge.js` + `tools/bridge-browser.js` | **Đã có sẵn, không cần viết lại** — tín hiệu từ trình duyệt của user đã chảy về trạm; bot Telegram chỉ cần đọc cùng nguồn (`journal-247.json` / store) |
| Định dạng tin nhắn | Template WhatsApp trong hook ngoài repo (`trade2026-signal-whatsapp.sh` + `.json` — xem §6) | Tham khảo cấu trúc template (đặc biệt dòng "🏯 Cấu trúc" + quy tắc bỏ dòng khi `cauTruc` null); viết lại template Telegram tương đương |
| **Phải viết mới** | — | **Sender Telegram** (Bot API `sendMessage`/`sendPhoto`, `getUpdates`/webhook, lệnh `/start`, lưu `chat_id` người nhận, lưu message_id đã gửi, dedupe theo id tín hiệu); **không có sẵn trong repo** (§6) |

### 10.7. Thứ tự triển khai đề xuất (giữ đúng luồng, ít rủi ro nhất)

1. **Kiểm tra trạm còn sống không** (dữ liệu trạm cũ từ 02/10 — §9.2): xem cron/collector trên server, `capNhat` mới nhất của `data/journal-247.json`. Nếu trạm chết thì khôi phục trước — bot Telegram dựa vào nó.
2. **Xác minh NN** (§9.3): mở app → Cài đặt → trạng thái NN; nếu `khong_tuong_thich` thì train lại (`node tools/train-nn.js`) hoặc tạm ẩn dòng NN khỏi tin nhắn.
3. **Tạo bot Telegram qua BotFather** (lấy token; token chỉ lưu trên server/trạm, không commit vào repo) — tương tự cách bot NexusPilot đã làm.
4. **Viết sender Telegram tối thiểu** trên trạm: đọc `data/journal-247.json` mỗi phút (như cron WhatsApp), thấy id tín hiệu thật mới + đạt chuẩn (LONG/SHORT, ≥ 70) → gửi tin theo mẫu §10.5 → ghi id đã gửi. Không đụng vào engine.
5. **Thêm cổng kỷ luật + chống trùng** (§10.3–10.4): cooldown 60 phút/coin, chỉ tín hiệu thật, bỏ tín hiệu cũ > 10 phút.
6. **Giai đoạn 2 (sau khi chạy ổn):** tin cập nhật phase (edit tin cũ), tin chấm điểm sau 15 phút, nút [🛒 Đặt lệnh] mở phiếu trong app, lệnh `/tin_hieu` xem tín hiệu mới nhất, lệnh `/bot` xem trạng thái PaperBot.

---

*— Hết báo cáo. Mọi con số trong báo cáo này đều trích từ code trong `~/workspace/trade2026/Trade.2026-main` tại thời điểm đọc 06/11/2026; chỗ nào không tìm thấy đã ghi rõ "không tìm thấy trong code" hoặc "chưa đọc chi tiết".*
