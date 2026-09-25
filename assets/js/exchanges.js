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
 * prices: { BINANCE: {BTC:{gia, pct24h, ts}}, OKX: {...}, MEXC: {...},
 *           BYBIT_PERP: {...}, HYPERLIQUID: {...}, DH_KHAC: {...} }
 * FIX v2.0: slot PERP tách riêng, ghi rõ nguồn — KHÔNG bao giờ nhét giá
 * perp/sàn khác vào slot spot Binance (sai provenance, sai basis).
 * ============================================================ */
class PriceHub {
  constructor(coins) {
    this.coins = coins;
    this.prices = { BINANCE: {}, OKX: {}, MEXC: {}, BYBIT_PERP: {}, HYPERLIQUID: {}, DH_KHAC: {} };
    this.ws = {};
    this.timers = {};
    this.retry = { BINANCE: 0, OKX: 0, MEXC: 0 };
    this.listeners = new Set();
  }
  onTick(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(san, coin) {
    const info = this.prices[san][coin];
    for (const fn of this.listeners) { try { fn(san, coin, info); } catch {} }
    document.dispatchEvent(new CustomEvent("siro:tick", { detail: { san, coin, ...info } }));
  }
  gia(coin, opts = {}) {
    // Ưu tiên spot: Binance → OKX → MEXC
    const g = this.prices.BINANCE[coin]?.gia ?? this.prices.OKX[coin]?.gia ?? this.prices.MEXC[coin]?.gia ?? null;
    // perpOk=true: cho phép dùng giá perp khi mọi spot đều chết — chỉ cho quản lý
    // vị thế khẩn cấp, KHÔNG dùng tính tín hiệu (basis perp/spot có thể lệch).
    if (g != null || !opts.perpOk) return g;
    return this.prices.BYBIT_PERP[coin]?.gia ?? this.prices.HYPERLIQUID[coin]?.gia ?? this.prices.DH_KHAC[coin]?.gia ?? null;
  }
  /* Giá kèm nguồn — để bot/UI biết đang dùng giá gì */
  giaKemNguon(coin) {
    for (const san of ["BINANCE", "OKX", "MEXC"])
      if (this.prices[san][coin]?.gia != null) return { ...this.prices[san][coin], san, laPerp: false };
    for (const san of ["BYBIT_PERP", "HYPERLIQUID", "DH_KHAC"])
      if (this.prices[san][coin]?.gia != null) return { ...this.prices[san][coin], san, laPerp: true };
    return null;
  }
  /* Giá TƯƠI NHẤT trên mọi slot (kèm nguồn) — cho fallback khẩn cấp khi feed
   * của sàn vị thế chết: thà dùng giá perp tươi có ghi rõ nguồn còn hơn giá spot đã cũ. */
  giaTuoiNhat(coin) {
    let best = null;
    for (const san of Object.keys(this.prices)) {
      const p = this.prices[san][coin];
      if (p?.gia != null && p.ts && (!best || p.ts > best.ts))
        best = { ...p, san, laPerp: san === "BYBIT_PERP" || san === "HYPERLIQUID" };
    }
    return best;
  }
  start() { this.connectBinance(); this.connectOKX(); this.connectMEXC(); }
  stop() { for (const k of Object.keys(this.ws)) { try { this.ws[k]?.close(); } catch {} } for (const t of Object.values(this.timers)) clearInterval(t); }

  reconnect(san, fn) {
    const delay = Math.min(30000, 2000 * Math.pow(2, this.retry[san]++));
    ConnState.set(san, "retry", `Kết nối lại sau ${Math.round(delay / 1000)}s`);
    setTimeout(fn, delay);
  }

  /* --- Binance: combined miniTicker stream --- */
  connectBinance() {
    try {
      const streams = this.coins.map(c => `${c.toLowerCase()}usdt@miniTicker`).join("/");
      const ws = new WebSocket(`${ENDPOINTS.binanceWs}?streams=${streams}`);
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
      ws.onclose = () => { ConnState.set("BINANCE", "off"); this.reconnect("BINANCE", () => this.connectBinance()); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch { this.reconnect("BINANCE", () => this.connectBinance()); }
  }

  /* --- OKX: tickers channel --- */
  connectOKX() {
    try {
      const ws = new WebSocket(ENDPOINTS.okxWs);
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
      ws.onclose = () => { clearInterval(this.timers.OKX); ConnState.set("OKX", "off"); this.reconnect("OKX", () => this.connectOKX()); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch { this.reconnect("OKX", () => this.connectOKX()); }
  }

  /* --- MEXC Futures: sub.ticker (JSON) --- */
  connectMEXC() {
    try {
      const ws = new WebSocket(ENDPOINTS.mexcWs);
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
            this.prices.MEXC[coin] = { gia: +m.data.lastPrice, pct24h: (+m.data.riseFallRate) * 100, ts: m.data.timestamp };
            this.emit("MEXC", coin);
          } else if (m.symbol && m.data?.lastPrice) {
            const coin = String(m.symbol).replace("_USDT", "");
            this.prices.MEXC[coin] = { gia: +m.data.lastPrice, pct24h: (+m.data.riseFallRate) * 100, ts: m.data.timestamp };
            this.emit("MEXC", coin);
          }
        } catch {}
      };
      ws.onclose = () => { clearInterval(this.timers.MEXC); ConnState.set("MEXC", "off"); this.reconnect("MEXC", () => this.connectMEXC()); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch { this.reconnect("MEXC", () => this.connectMEXC()); }
  }
}

let PRICE_HUB = null;
