/* ============================================================
 * Trade.2026 v2.0.0 — Cấu hình trung tâm
 * ============================================================ */
"use strict";

const APP_VERSION = "2.17.5"; // v2.17.5: Panel fix 404 workflow (chua co file = trang thai cho) — đổi version thì bump cả hai
const APP_NAME = "Trade.2026";
const SIRO_VERSION = "1.0.0"; // giữ tương thích ngược với state cũ

/* ---------- Watchlist (hồ sơ Mr.Bit) ---------- */
const WATCHLIST_CORE = ["BTC", "ETH", "SOL", "BNB", "DOGE", "DYDX"];
const WATCHLIST_PHU  = ["ARB", "OP", "RUNE", "FET", "INJ", "TIA", "SEI", "SUI", "WIF"];

/* ---------- Phiên giao dịch (giờ VN) ---------- */
const SESSIONS_VN = [
  { id: "asia",   ten: "Phiên Á",    emoji: "🌏", tu: 6,  den: 14, mota: "Tích lũy, dễ nhiễu" },
  { id: "eu",     ten: "Phiên Âu",   emoji: "🇪🇺", tu: 14, den: 22, mota: "Thanh khoản lớn, sóng bắt đầu" },
  { id: "us",     ten: "Phiên Mỹ",   emoji: "🇺🇸", tu: 19, den: 3,  mota: "Biến động mạnh nhất" },
  { id: "golden", ten: "GIỜ VÀNG",   emoji: "🔥", tu: 19, den: 22, mota: "Âu + Mỹ overlap, dòng tiền lớn" },
];
/* Killzone ICT (giờ UTC) — London 07-10, New York 12-16 */
const KILLZONES_UTC = [
  { id: "london", ten: "London KZ", tu: 7,  den: 10 },
  { id: "ny",     ten: "New York KZ", tu: 12, den: 16 },
];

/* ---------- Quản trị rủi ro mặc định (mindmap Mr.Bit) ---------- */
const RISK_DEFAULTS = {
  vonBanDau: 10000,        // USDT ảo cho paper bot
  riskPct: 1,              // % vốn rủi ro mỗi lệnh (0.5–1%, cap 2%)
  riskPctMax: 2,
  minRR: 2,                // R:R tối thiểu 1:2
  preferRR: 3,             // R:R ưu tiên 1:3
  maxViThe: 3,             // số vị thế đồng thời tối đa
  loNgayMaxPct: 4,         // ngắt mạch khi lỗ 3–5%/ngày (mặc định 4)
  cooldownPhut: 60,        // nghỉ giữa 2 lệnh cùng coin
  donBay: 3,               // đòn bẩy tham chiếu 2–3x
};

/* ---------- Khung thời gian phân tích đa khung ---------- */
const TIMEFRAMES = {
  HTF: { tv: "240", binance: "4h",  ten: "4H",  swingL: 3, limit: 260 },
  MTF: { tv: "60",  binance: "1h",  ten: "1H",  swingL: 4, limit: 260 },
  LTF: { tv: "15",  binance: "15m", ten: "15m", swingL: 5, limit: 260 },
};

/* ---------- Endpoint dữ liệu (đã kiểm chứng CORS/khả dụng) ---------- */
const ENDPOINTS = {
  // REST nến/độ sâu — vision không geo-block, CORS *
  binanceRest: ["https://data-api.binance.vision", "https://api.binance.com"],
  binanceWs:   "wss://stream.binance.com:9443/stream",
  okxRest:     "https://www.okx.com",
  okxWs:       "wss://ws.okx.com:8443/ws/v5/public",
  mexcWs:      "wss://contract.mexc.com/edge",       // futures WS — JSON thuần
  fngApi:      "https://api.alternative.me/fng/?limit=1",
  teCalendar:  "https://tradingeconomics.com/calendar",
  // Chuỗi proxy CORS (best-effort cho chế độ parse dữ liệu TE)
  corsProxies: [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  ],
};

/* ---------- Trọng số checklist hợp lưu (playbook hợp nhất) ---------- */
const CHECKLIST_WEIGHTS = {
  htf_bias:         25,  // xu hướng khung lớn rõ ràng
  poi_context:      15,  // giá tại vùng POI chất lượng (OB/FVG) + discount/premium đúng phía
  liquidity_sweep:  20,  // đã quét thanh khoản (stop hunt)
  fvg_quality:      15,  // CHoCH thật (body close, có sweep trước, IDM)
  ltf_confirmation: 15,  // retest giữ vùng / xác nhận khung nhỏ
  risk_reward:      10,  // RR đạt tối thiểu 1:2
};
const KILLZONE_BONUS = 5;

/* ---------- Trọng số RAG Reasoner — NGUỒN SỰ THẬT DUY NHẤT ----------
 * Mọi UI/README/comment đều render từ đây, không hard-code số ở nơi khác.
 * 5 lớp chính tổng = 1.00; heatmap là LỚP ĐIỀU CHỈNH (±) ngoài hệ trọng số. */
const RAG_WEIGHTS = { smc: 0.35, whale: 0.15, flow: 0.20, macro: 0.10, momentum: 0.10, derivs: 0.10 }; // RAG 21/11: thêm Derivs (funding/OI) 10% — lấy 5 từ Whale (trùng Flow) + 5 từ Macro (thưa tin); tổng vẫn 1.00
const RAG_HEATMAP_ADJ = 0.06;
const RAG_NGUONG_VOTE = 0.18;

/* ---------- Ngưỡng verdict ---------- */
const VERDICT = { ALERT: 70, PREPARE: 50 };

/* ---------- Quy ước thanh lý (L-14 — contrarian) ----------
 * LIQ_CONTRARIAN = true: long bị thanh lý nhiều → CỘNG điểm (áp lực bán đã
 * xả xong, nghiêng tăng nhẹ), short bị thanh lý nhiều → TRỪ điểm, và ngược
 * lại. Cùng một quy ước dùng ở 3 nơi: datahub.js flowScore, flowdb.js
 * flowScore, datahub.js flowScore12h — cả 3 đọc cờ này (mặc định contrarian
 * khi cờ chưa được nạp, vd trong harness).
 * Phân biệt với cảnh báo "thanh lý mạnh — đang quét, chờ ổn định" ở
 * engine.js: đó là cảnh báo biến động NGẮN HẠN trong lúc quét đang diễn ra,
 * không phủ nhận quy ước contrarian cho điểm dòng tiền 30'/12h.
 * Backtest dấu nào đúng (contrarian vs momentum): xem file kiểm chứng audit. */
const LIQ_CONTRARIAN = true;

/* ---------- Đòn bẩy tối đa theo sàn (futures) ---------- */
const LEV_MAX = { BINANCE: 125, OKX: 125, MEXC: 500 };
const LEV_PRESETS = [3, 10, 20, 50, 75, 100, 125, 200, 500];

/* ---------- TradingView map ---------- */
const TV_SYMBOLS = (coin) => `BINANCE:${coin}USDT`;
const TV_INTERVALS = [
  { tv: "5",   ten: "5m" }, { tv: "15", ten: "15m" }, { tv: "60", ten: "1H" },
  { tv: "240", ten: "4H" }, { tv: "D",  ten: "1D" },
];

/* ---------- Cài đặt người dùng (localStorage) ---------- */
const SETTINGS_KEY = "siro_settings_v1";
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      watchlist: Array.isArray(s.watchlist) && s.watchlist.length ? s.watchlist : [...WATCHLIST_CORE],
      watchlistPhu: Array.isArray(s.watchlistPhu) ? s.watchlistPhu : [...WATCHLIST_PHU],
      // v2.11.0: coin user chọn để hiện trên màn hình Tín hiệu (mặc định = watchlist)
      tinHieuCoins: Array.isArray(s.tinHieuCoins) && s.tinHieuCoins.length ? [...new Set(s.tinHieuCoins)].slice(0, 12) : [...WATCHLIST_CORE],
      risk: { ...RISK_DEFAULTS, ...(s.risk || {}) },
      refreshTinHieuSec: s.refreshTinHieuSec || 180,
      theme: s.theme || "dark",
      // v2.14.0: feature flag NN (MRBIT_NEURAL_CODING_01 §4 P0) — 'shadow' (mặc định) | 'off'
      nnCheDo: s.nnCheDo === "off" ? "off" : "shadow",
      // v2.15.0: cầu nối trình duyệt → trạm 24/7 → WhatsApp (PAT do user nhập, lưu local)
      bridgeBat: !!s.bridgeBat,
      bridgePat: typeof s.bridgePat === "string" ? s.bridgePat : "",
    };
  } catch { return { watchlist: [...WATCHLIST_CORE], watchlistPhu: [...WATCHLIST_PHU], tinHieuCoins: [...WATCHLIST_CORE], risk: { ...RISK_DEFAULTS }, refreshTinHieuSec: 180, theme: "dark", nnCheDo: "shadow", bridgeBat: false, bridgePat: "" }; }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }

let SETTINGS = loadSettings();

/* ---------- Đăng nhập qua Telegram (v2.17.6) ----------
 * Hợp đồng link kèm mã (bot @trademrbit_bot cấp khi user bấm /start):
 *   https://trade.mrbitbet90.tech/?code=tg-<telegramUserId>-<suffix>
 *   vd: ?code=tg-5753439659-a1b2c3 (suffix: 6 ký tự a-z0-9 do bot sinh ngẫu nhiên)
 * Lưu ý trung thực: frontend tĩnh không giữ được secret nên KHÔNG xác thực
 * được mã bằng mật mã — mã chỉ là danh tính do bot cấp, app lưu lại để
 * nhận diện người dùng (hiển thị + ghi nhớ). Dashboard vốn công khai,
 * mã không mở thêm quyền gì. Khi có backend xác thực (vd /api/verify-code
 * đối chiếu Supabase) thì siết lại tại đây, không đổi định dạng link. */
const TG_LOGIN_KEY = "trade2026_tg_login_v1";
const TG_CODE_RE = /^tg-(\d{5,20})-([A-Za-z0-9]{4,32})$/;
function loadTgLogin() {
  try {
    const raw = localStorage.getItem(TG_LOGIN_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (o && TG_CODE_RE.test(o.code || "")) return o;
  } catch {}
  return null;
}
function saveTgLogin(o) { try { localStorage.setItem(TG_LOGIN_KEY, JSON.stringify(o)); } catch {} }
let TG_LOGIN = loadTgLogin();
try {
  const code = new URLSearchParams(location.search).get("code");
  if (code && TG_CODE_RE.test(code)) {
    const m = TG_CODE_RE.exec(code);
    TG_LOGIN = { code, tgId: m[1], at: Date.now() };
    saveTgLogin(TG_LOGIN);
    const u = new URL(location.href);
    u.searchParams.delete("code");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  }
} catch {}
function dangXuatTelegram() {
  try { localStorage.removeItem(TG_LOGIN_KEY); } catch {}
  TG_LOGIN = null;
  try { if (typeof veTgLogin === "function") veTgLogin(); } catch {}
}
