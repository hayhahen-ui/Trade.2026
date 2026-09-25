/* ============================================================
 * Trade.2026 v2.0.0 — Cấu hình trung tâm
 * ============================================================ */
"use strict";

const APP_VERSION = "2.0.2";
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
const RAG_WEIGHTS = { smc: 0.35, whale: 0.20, flow: 0.20, macro: 0.15, momentum: 0.10 };
const RAG_HEATMAP_ADJ = 0.06;
const RAG_NGUONG_VOTE = 0.18;

/* ---------- Ngưỡng verdict ---------- */
const VERDICT = { ALERT: 70, PREPARE: 50 };

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
      risk: { ...RISK_DEFAULTS, ...(s.risk || {}) },
      refreshTinHieuSec: s.refreshTinHieuSec || 180,
      theme: s.theme || "dark",
    };
  } catch { return { watchlist: [...WATCHLIST_CORE], watchlistPhu: [...WATCHLIST_PHU], risk: { ...RISK_DEFAULTS }, refreshTinHieuSec: 180, theme: "dark" }; }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }

let SETTINGS = loadSettings();
