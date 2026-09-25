/* ============================================================
 * Trade.2026 DataHub — CẤU HÌNH NGUỒN DỮ LIỆU REAL-TIME
 * Nạp TRƯỚC datahub.js. Sửa file này là đủ để bật/tắt nguồn.
 * ============================================================ */
"use strict";

/* Coin theo dõi — tự lấy watchlist của Siro (SETTINGS trong config.js) nếu có */
const DH_COINS = (function () {
  try {
    if (typeof SETTINGS !== "undefined" && Array.isArray(SETTINGS.watchlist) && SETTINGS.watchlist.length)
      return SETTINGS.watchlist.slice(0, 8).map((c) => String(c).toUpperCase());
  } catch (e) {}
  return ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
})();

const DH_CONFIG = {
  /* Coin theo dõi (khớp watchlist Siro) */
  coins: DH_COINS,

  /* Ngưỡng lọc + dung lượng bộ đệm */
  whale: { minUsd: 100000, keep: 600, windowMin: 60 },
  liq:   { minUsd: 5000,   keep: 400 },
  poly:  { minUsd: 500,    keep: 200, pollMs: 5000 },
  news:  { keep: 80 },

  /* Bật/tắt từng nguồn */
  sources: {
    binance:     true,   // aggTrade + forceOrder (thanh lý) + ticker
    okx:         true,   // trades spot + liquidation-orders
    bybit:       true,   // publicTrade + allLiquidation
    hyperliquid: true,   // trades (DEX perp)
    polymarket:  true,   // dòng lệnh cá cược real-time (REST poll)
    macro:       true,   // Fear&Greed + funding + open interest
    etf:         false,  // cần proxy (xem tools/proxy)
    newsFeed:    false,  // cần proxy RSS
    tradermap:   false,  // backend bên thứ 3 — chỉ bật khi bạn có quyền + proxy
  },

  endpoints: {
    binanceFutWs:  "wss://fstream.binance.com/stream?streams=",
    binanceSpotWs: "wss://stream.binance.com:9443/stream?streams=",
    binanceFutRest:"https://fapi.binance.com",
    okxWs:         "wss://ws.okx.com:8443/ws/v5/public",
    okxRest:       "https://www.okx.com",
    bybitWs:       "wss://stream.bybit.com/v5/public/linear",
    hyperliquidWs: "wss://api.hyperliquid.xyz/ws",
    polymarketRest:"https://data-api.polymarket.com/trades",
    fng:           "https://api.alternative.me/fng/?limit=1",

    /* Proxy CORS của bạn (Cloudflare Worker trong tools/proxy).
       Ví dụ: "https://siro-proxy.tenban.workers.dev/?url=" */
    proxy:         "",
    etfFlowsUrl:   "",            // URL JSON dòng tiền ETF (qua proxy)
    newsRssUrl:    "",            // URL RSS tin tức (qua proxy)

    /* Nguồn tradermap.io — tắt mặc định.
       API này là backend riêng của bên thứ ba: không có CORS cho origin
       github.io và không có giấy phép công khai. Chỉ bật khi bạn được phép
       dùng, và trỏ qua proxy của chính bạn. */
    tmRest:        "https://api.tradermap.io",
    tmWsPoly:      "wss://api.tradermap.io/polymarket",
    tmWsNews:      "wss://api.tradermap.io/news",
    tmUserId:      "",
  },

  /* Giá trị 1 hợp đồng OKX SWAP (dự phòng khi không tải được /instruments) */
  okxCtVal: { BTC: 0.01, ETH: 0.1, SOL: 1, BNB: 0.01, DOGE: 1000, XRP: 100 },

  ws: { retryBaseMs: 1000, retryMaxMs: 30000, staleMs: 45000 },
  ui: { rerenderMs: 700, rows: 35 },
};

if (typeof window !== "undefined") window.DH_CONFIG = DH_CONFIG;
