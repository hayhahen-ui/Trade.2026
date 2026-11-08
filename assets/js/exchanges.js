/* ============================================================
 * Trade.2026 — Kết nối dữ liệu sàn
 * Nến: Binance (vision → api) → fallback OKX
 * Real-time: WebSocket Binance + OKX + MEXC Futures (đã kiểm chứng)
 * ============================================================ */
"use strict";

/* ---------- Nến (klines) với chuỗi fallback ---------- */
const OKX_BAR = { "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

async function fetchKlines(coin, interval, limit = 260) {
  const sym = `${coin}USDT`;
  // 1) Binance vision → api.binance.com
  for (const base of ENDPOINTS.binanceRest) {
    try {
      const raw = await fetchJson(`${base}/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
      ConnState.set("klines", "on", base.includes("vision") ? "Binance Vision" : "Binance");
      return normalizeKlines(raw);
    } catch (e) { /* thử endpoint kế */ }
  }
  // 2) OKX candles (đảo ngược thứ tự, [ts,o,h,l,c,vol,...])
  try {
    const bar = OKX_BAR[interval] || interval;
    const j = await fetchJson(`${ENDPOINTS.okxRest}/api/v5/market/candles?instId=${coin}-USDT&bar=${bar}&limit=${Math.min(limit, 300)}`);
    if (j.code === "0" && Array.isArray(j.data)) {
      ConnState.set("klines", "on", "OKX (fallback)");
      return j.data.reverse().map(k => ({
        openTime: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4],
        volume: +k[5], closeTime: +k[0] + 1,
      }));
    }
    throw new Error("OKX code " + j.code);
  } catch (e) {
    ConnState.set("klines", "err", String(e.message || e));
    throw new Error(`Không tải được nến ${sym}: ${e.message || e}`);
  }
}

/* ---------- Nến theo thời gian bắt đầu (L-08) ----------
 * fetchKlines(coin, tf, 400) chỉ trả 400 nến GẦN NHẤT — bản ghi journal cũ hơn
 * ~6,6h sẽ bị chấm sai (lấy nến đầu mảng làm "nến entry", lệch hàng giờ).
 * fetchKlinesTu tải nến TỪ startTime trở đi để chấm đúng bản ghi cũ. */
async function fetchKlinesTu(coin, interval, startTime, limit = 400) {
  const sym = `${coin}USDT`;
  for (const base of ENDPOINTS.binanceRest) {
    try {
      const raw = await fetchJson(`${base}/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}&startTime=${startTime}`);
      ConnState.set("klines", "on", base.includes("vision") ? "Binance Vision" : "Binance");
      return normalizeKlines(raw);
    } catch (e) { /* thử endpoint kế */ }
  }
  try {
    const bar = OKX_BAR[interval] || interval;
    const j = await fetchJson(`${ENDPOINTS.okxRest}/api/v5/market/candles?instId=${coin}-USDT&bar=${bar}&limit=${Math.min(limit, 300)}&after=${startTime}`);
    if (j.code === "0" && Array.isArray(j.data)) {
      ConnState.set("klines", "on", "OKX (fallback)");
      return j.data.reverse().map(k => ({
        openTime: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4],
        volume: +k[5], closeTime: +k[0] + 1,
      }));
    }
    throw new Error("OKX code " + j.code);
  } catch (e) {
    ConnState.set("klines", "err", String(e.message || e));
    throw new Error(`Không tải được nến ${sym}: ${e.message || e}`);
  }
}

/* ---------- Toàn bộ coin USDT trên Binance (v2.10.0) ----------
 * Kéo danh sách cặp giao dịch từ Binance exchangeInfo để màn hình Biểu đồ
 * cho phép chọn BẤT KỲ coin nào — chọn xong engine chạy full phân tích
 * (cấu trúc, POI/OB, nến, dòng tiền, phái sinh, killzone) và gom cảnh báo
 * theo đúng kiến thức/quy luật của hệ thống.
 * Cache localStorage 24h để không gọi exchangeInfo mỗi lần mở trang. */
let CACHE_ALL_COINS = null;
async function layTatCaCoinBinance() {
  if (CACHE_ALL_COINS) return CACHE_ALL_COINS;
  try {
    const raw = localStorage.getItem("tde_all_coins");
    if (raw) {
      const j = JSON.parse(raw);
      if (j && Date.now() - j.ts < 24 * 3600 * 1000 && Array.isArray(j.coins) && j.coins.length > 50) {
        CACHE_ALL_COINS = j.coins;
        return j.coins;
      }
    }
  } catch {}
  // Cùng universe với klines + widget TradingView: spot USDT
  for (const base of ENDPOINTS.binanceRest) {
    try {
      const j = await fetchJson(`${base}/api/v3/exchangeInfo`);
      if (!j || !Array.isArray(j.symbols)) continue;
      const coins = j.symbols
        .filter(s => s.status === "TRADING" && s.quoteAsset === "USDT")
        .map(s => s.baseAsset)
        .filter(b => b && !/^(UP|DOWN|BULL|BEAR)/.test(b) && !/(UP|DOWN|BULL|BEAR)$/.test(b)) // loại token đòn bẩy
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();
      if (coins.length > 50) {
        CACHE_ALL_COINS = coins;
        try { localStorage.setItem("tde_all_coins", JSON.stringify({ ts: Date.now(), coins })); } catch {}
        return coins;
      }
    } catch { /* thử endpoint kế */ }
  }
  return null; // tải thất bại → UI dùng watchlist cố định
}

/* ---------- Dropdown coin dùng chung (v2.11.0) ----------
 * Nạp: watchlist ghim ⭐ đầu danh sách + toàn bộ coin Binance.
 * UI tự thêm ô tìm kiếm riêng để lọc option (option.hidden). */
async function napDropdownCoinBinance(sel, coinHienTai) {
  sel.innerHTML = "";
  const tam = document.createElement("option");
  tam.textContent = "⏳ Đang tải toàn bộ coin Binance…";
  sel.appendChild(tam);
  const all = await layTatCaCoinBinance().catch(() => null);
  if (!document.body.contains(sel)) return; // user đã chuyển màn hình
  sel.innerHTML = "";
  const pin = [...(SETTINGS.watchlist || []), ...(SETTINGS.watchlistPhu || [])];
  const daThem = new Set();
  const them = (c, nhan) => {
    if (!c || daThem.has(c)) return;
    daThem.add(c);
    const o = document.createElement("option");
    o.value = c; o.textContent = nhan;
    if (c === coinHienTai) o.selected = true;
    sel.appendChild(o);
  };
  for (const c of pin) them(c, `⭐ ${c}/USDT`);
  for (const c of (all || [])) them(c, `${c}/USDT`);
  if (coinHienTai && !daThem.has(coinHienTai)) them(coinHienTai, `${coinHienTai}/USDT`);
}

/* ---------- Sổ lệnh spot (cho radar cá mập) ---------- */
async function fetchDepth(coin, limit = 50) {
  for (const base of ENDPOINTS.binanceRest) {
    try { return await fetchJson(`${base}/api/v3/depth?symbol=${coin}USDT&limit=${limit}`); } catch {}
  }
  const j = await fetchJson(`${ENDPOINTS.okxRest}/api/v5/market/books?instId=${coin}-USDT&sz=${limit}`);
  if (j.code === "0" && j.data?.[0]) return { bids: j.data[0].bids, asks: j.data[0].asks };
  throw new Error("Không tải được sổ lệnh");
}

/* ---------- Fear & Greed ---------- */
async function fetchFearGreed() {
  try {
    const j = await fetchJson(ENDPOINTS.fngApi);
    const d = j?.data?.[0];
    if (!d) return null;
    const v = +d.value;
    if (!isFinite(v)) return null; // FIX v2.0: thiếu value → null, không gán nhãn "Sợ hãi cực độ" giả
    const nhan = v >= 75 ? "Tham lam cực độ" : v >= 55 ? "Tham lam" : v >= 45 ? "Trung tính" : v >= 25 ? "Sợ hãi" : "Sợ hãi cực độ";
    return { value: v, nhan };
  } catch { return null; }
}

/* ============================================================
 * PriceHub — trung tâm giá real-time qua WebSocket
 * prices: { BINANCE: {BTC:{gia, pct24h, ts}}, OKX: {...}, MEXC_PERP: {...},
 *           BINANCE_PERP: {...}, BYBIT_PERP: {...}, HYPERLIQUID: {...}, DH_KHAC: {...} }
 * L-06: slot PERP tách riêng, ghi rõ nguồn — KHÔNG bao giờ nhét giá
 * perp/sàn khác vào slot spot Binance (sai provenance, sai basis).
 * MEXC trong app là MEXC Futures → slot MEXC_PERP; "BINANCE-F" (DataHub)
 * → slot BINANCE_PERP. Tên sàn (MEXC, BINANCE-F) vẫn dùng ở phiếu lệnh/vị
 * thế; map sang slot bằng slotGiaTheoSan() bên dưới.
 * ============================================================ */
/* L-06: map tên sàn → slot giá PriceHub (dùng chung bot + cầu nối DataHub). */
function slotGiaTheoSan(san) {
  const s = String(san || "").toUpperCase();
  if (s === "MEXC") return "MEXC_PERP";
  if (s === "BINANCE-F" || s === "BINANCE_F") return "BINANCE_PERP";
  if (s === "BYBIT") return "BYBIT_PERP";
  if (s === "HYPERLIQUID") return "HYPERLIQUID";
  if (s === "BINANCE" || s === "OKX") return s;
  return "DH_KHAC";
}
class PriceHub {
  constructor(coins) {
    this.coins = coins;
    this.prices = { BINANCE: {}, OKX: {}, MEXC_PERP: {}, BINANCE_PERP: {}, BYBIT_PERP: {}, HYPERLIQUID: {}, DH_KHAC: {} };
    this.ws = {};
    this.timers = {};
    this.retry = { BINANCE: 0, OKX: 0, MEXC: 0 };
    this.listeners = new Set();
    this._daDung = false; // v2.17.1 (A21): cờ dừng — chặn reconnect sau stop()
  }
  onTick(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /* P-02: đăng ký thêm coin ngoài watchlist (vd khi mở vị thế tay/lệnh chờ) —
   * gửi SUBSCRIBE lên WS đang mở của từng sàn, không cần reconnect. Nếu WS
   * đang reconnect thì coin đã nằm trong this.coins nên lần connect sau sẽ
   * tự bao gồm nó. */
  subscribe(coin) {
    coin = String(coin || "").toUpperCase();
    if (!coin || this.coins.includes(coin)) return false;
    this.coins.push(coin);
    try { const ws = this.ws.BINANCE; if (ws && ws.readyState === 1) ws.send(JSON.stringify({ method: "SUBSCRIBE", params: [`${coin.toLowerCase()}usdt@miniTicker`], id: Date.now() })); } catch {}
    try { const ws = this.ws.OKX; if (ws && ws.readyState === 1) ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "tickers", instId: `${coin}-USDT` }] })); } catch {}
    try { const ws = this.ws.MEXC; if (ws && ws.readyState === 1) ws.send(JSON.stringify({ method: "sub.ticker", param: { symbol: `${coin}_USDT` } })); } catch {}
    return true;
  }
  emit(san, coin) {
    const info = this.prices[san][coin];
    for (const fn of this.listeners) { try { fn(san, coin, info); } catch {} }
    document.dispatchEvent(new CustomEvent("siro:tick", { detail: { san, coin, ...info } }));
  }
  gia(coin, opts = {}) {
    // Ưu tiên spot: Binance → OKX (L-06: MEXC Futures KHÔNG còn là spot)
    const g = this.prices.BINANCE[coin]?.gia ?? this.prices.OKX[coin]?.gia ?? null;
    // perpOk=true: cho phép dùng giá perp khi mọi spot đều chết — chỉ cho quản lý
    // vị thế khẩn cấp, KHÔNG dùng tính tín hiệu (basis perp/spot có thể lệch).
    if (g != null || !opts.perpOk) return g;
    return this.prices.MEXC_PERP[coin]?.gia ?? this.prices.BINANCE_PERP[coin]?.gia ?? this.prices.BYBIT_PERP[coin]?.gia ?? this.prices.HYPERLIQUID[coin]?.gia ?? this.prices.DH_KHAC[coin]?.gia ?? null;
  }
  /* Giá kèm nguồn — để bot/UI biết đang dùng giá gì */
  giaKemNguon(coin) {
    for (const san of ["BINANCE", "OKX"])
      if (this.prices[san][coin]?.gia != null) return { ...this.prices[san][coin], san, laPerp: false };
    for (const san of ["MEXC_PERP", "BINANCE_PERP", "BYBIT_PERP", "HYPERLIQUID", "DH_KHAC"])
      if (this.prices[san][coin]?.gia != null) return { ...this.prices[san][coin], san, laPerp: san !== "DH_KHAC" };
    return null;
  }
  /* Giá TƯƠI NHẤT trên mọi slot (kèm nguồn) — cho fallback khẩn cấp khi feed
   * của sàn vị thế chết: thà dùng giá perp tươi có ghi rõ nguồn còn hơn giá spot đã cũ. */
  giaTuoiNhat(coin) {
    let best = null;
    for (const san of Object.keys(this.prices)) {
      const p = this.prices[san][coin];
      if (p?.gia != null && p.ts && (!best || p.ts > best.ts))
        best = { ...p, san, laPerp: san === "MEXC_PERP" || san === "BINANCE_PERP" || san === "BYBIT_PERP" || san === "HYPERLIQUID" };
    }
    return best;
  }
  start() { this._daDung = false; this.connectBinance(); this.connectOKX(); this.connectMEXC(); }
  stop() {
    this._daDung = true; // v2.17.1 (A21): chặn mọi reconnect đã lên lịch/chờ
    for (const k of Object.keys(this.ws)) { try { this.ws[k]?.close(); } catch {} }
    for (const t of Object.values(this.timers)) clearInterval(t);
  }

  reconnect(san, fn) {
    if (this._daDung) return; // đã stop() → không lên lịch kết nối lại
    const delay = Math.min(30000, 2000 * Math.pow(2, this.retry[san]++));
    ConnState.set(san, "retry", `Kết nối lại sau ${Math.round(delay / 1000)}s`);
    setTimeout(() => { if (!this._daDung) fn(); }, delay);
  }

  /* --- Binance: combined miniTicker stream --- */
  connectBinance() {
    try {
      const streams = this.coins.map(c => `${c.toLowerCase()}usdt@miniTicker`).join("/");
      const ws = new WebSocket(`${ENDPOINTS.binanceWs}?streams=${streams}`);
      // P-01: đóng socket cũ trước khi thay (tránh 2 socket cùng chạy, dữ liệu trùng)
      try { if (this.ws.BINANCE && this.ws.BINANCE !== ws) this.ws.BINANCE.close(); } catch {}
      this.ws.BINANCE = ws;
      ws.onopen = () => { this.retry.BINANCE = 0; ConnState.set("BINANCE", "on", "WebSocket"); };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          const d = m.data;
          if (!d || d.e !== "24hrMiniTicker") return;
          const coin = d.s.replace("USDT", "");
          const open = +d.o, close = +d.c;
          this.prices.BINANCE[coin] = { gia: close, pct24h: open ? (close - open) / open * 100 : null, ts: d.E };
          this.emit("BINANCE", coin);
        } catch {}
      };
      ws.onclose = () => { if (ws !== this.ws.BINANCE) return; ConnState.set("BINANCE", "off"); this.reconnect("BINANCE", () => this.connectBinance()); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch { this.reconnect("BINANCE", () => this.connectBinance()); }
  }

  /* --- OKX: tickers channel --- */
  connectOKX() {
    try {
      const ws = new WebSocket(ENDPOINTS.okxWs);
      // P-01: đóng socket cũ trước khi thay (tránh 2 socket cùng chạy, dữ liệu trùng)
      try { if (this.ws.OKX && this.ws.OKX !== ws) this.ws.OKX.close(); } catch {}
      this.ws.OKX = ws;
      ws.onopen = () => {
        this.retry.OKX = 0;
        ConnState.set("OKX", "on", "WebSocket");
        ws.send(JSON.stringify({ op: "subscribe", args: this.coins.map(c => ({ channel: "tickers", instId: `${c}-USDT` })) }));
        this.timers.OKX = setInterval(() => { try { ws.send("ping"); } catch {} }, 25000);
      };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          const m = JSON.parse(e.data);
          if (m.arg?.channel !== "tickers" || !m.data?.[0]) return;
          const d = m.data[0];
          const coin = d.instId.replace("-USDT", "");
          const last = +d.last, open = +d.open24h;
          this.prices.OKX[coin] = { gia: last, pct24h: open ? (last - open) / open * 100 : null, ts: +d.ts };
          this.emit("OKX", coin);
        } catch {}
      };
      ws.onclose = () => { if (ws !== this.ws.OKX) return; clearInterval(this.timers.OKX); ConnState.set("OKX", "off"); this.reconnect("OKX", () => this.connectOKX()); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch { this.reconnect("OKX", () => this.connectOKX()); }
  }

  /* --- MEXC Futures: sub.ticker (JSON) --- */
  connectMEXC() {
    try {
      const ws = new WebSocket(ENDPOINTS.mexcWs);
      // P-01: đóng socket cũ trước khi thay (tránh 2 socket cùng chạy, dữ liệu trùng)
      try { if (this.ws.MEXC && this.ws.MEXC !== ws) this.ws.MEXC.close(); } catch {}
      this.ws.MEXC = ws;
      ws.onopen = () => {
        this.retry.MEXC = 0;
        ConnState.set("MEXC", "on", "WebSocket Futures");
        for (const c of this.coins) ws.send(JSON.stringify({ method: "sub.ticker", param: { symbol: `${c}_USDT` } }));
        this.timers.MEXC = setInterval(() => { try { ws.send(JSON.stringify({ method: "ping" })); } catch {} }, 20000);
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.channel === "push.ticker" && m.data) {
            const coin = String(m.data.symbol || "").replace("_USDT", "");
            this.prices.MEXC_PERP[coin] = { gia: +m.data.lastPrice, pct24h: (+m.data.riseFallRate) * 100, ts: m.data.timestamp };
            this.emit("MEXC_PERP", coin);
          } else if (m.symbol && m.data?.lastPrice) {
            const coin = String(m.symbol).replace("_USDT", "");
            this.prices.MEXC_PERP[coin] = { gia: +m.data.lastPrice, pct24h: (+m.data.riseFallRate) * 100, ts: m.data.timestamp };
            this.emit("MEXC_PERP", coin);
          }
        } catch {}
      };
      ws.onclose = () => {
        // P-01: socket cũ đã bị thay thế → bỏ qua, không lên lịch reconnect
        if (ws !== this.ws.MEXC) return;
        clearInterval(this.timers.MEXC); ConnState.set("MEXC", "off"); this.reconnect("MEXC", () => this.connectMEXC());
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch { this.reconnect("MEXC", () => this.connectMEXC()); }
  }
}

let PRICE_HUB = null;
