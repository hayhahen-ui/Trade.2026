/* ============================================================
 * Trade.2026 DataHub — LÕI GOM DỮ LIỆU REAL-TIME
 * Zero dependency · chạy tĩnh trên GitHub Pages
 *
 * Nguồn: Binance Futures · OKX · Bybit · Hyperliquid · Polymarket
 *        + macro (Fear&Greed, funding, open interest) + ETF/news (qua proxy)
 *
 * API công khai:
 *   DataHub.start() / .stop()
 *   DataHub.on("whale"|"liq"|"price"|"poly"|"news"|"stats"|"macro"|"etf"|"source", fn)
 *   DataHub.snapshot() · DataHub.flowScore(coin) · DataHub.setFilter({minUsd, coins})
 * ============================================================ */
(function (global) {
  "use strict";

  const CFG = global.DH_CONFIG;
  if (!CFG) { console.error("[DataHub] thiếu datahub.config.js"); return; }

  const now = () => Date.now();
  const up = (s) => String(s || "").toUpperCase();
  const num = (v) => { const n = +v; return Number.isFinite(n) ? n : 0; };
  const coins = () => CFG.coins.map(up);
  const isWatched = (c) => coins().includes(up(c));

  /* ---------------- Event bus ---------------- */
  const bus = Object.create(null);
  function on(ev, fn) { (bus[ev] || (bus[ev] = new Set())).add(fn); return () => off(ev, fn); }
  function off(ev, fn) { bus[ev] && bus[ev].delete(fn); }
  function emit(ev, data) {
    const set = bus[ev]; if (!set) return;
    for (const fn of set) { try { fn(data); } catch (e) { console.warn("[DataHub]", ev, e); } }
  }

  /* ---------------- Kho dữ liệu ---------------- */
  const store = {
    prices: {},                 // BTC: {gia, pct24h, san, ts}
    whales: [], liqs: [], polys: [], news: [],
    funding: {}, oi: {},
    macro: { fng: null },
    etf: null,
    stats: null,
    sources: {},                // id: {id, ten, status, note, msgs, ts}
    startedAt: 0,
  };

  const SOURCE_NAMES = {
    binance: "Binance Futures", okx: "OKX", bybit: "Bybit", hyperliquid: "Hyperliquid",
    polymarket: "Polymarket", macro: "Macro", etf: "ETF Flows", newsFeed: "News", tradermap: "TraderMap",
  };

  function setSource(id, status, note) {
    const s = store.sources[id] || (store.sources[id] = { id, ten: SOURCE_NAMES[id] || id, status: "off", note: "", msgs: 0, ts: 0 });
    s.status = status;                       // on | retry | off | degraded
    if (note !== undefined) s.note = note;
    s.ts = now();
    emit("source", s);
    return s;
  }
  function bump(id) { const s = store.sources[id]; if (s) { s.msgs++; s.lastMsg = now(); } }

  function cap(arr, n) { if (arr.length > n) arr.splice(n); }

  /* ---------------- Ghi nhận sự kiện ---------------- */
  function pushWhale(t) {
    if (!t || !t.usd || t.usd < CFG.whale.minUsd) return;
    if (!isWatched(t.coin)) return;
    store.whales.unshift(t); cap(store.whales, CFG.whale.keep);
    emit("whale", t);
  }
  function pushLiq(l) {
    if (!l || !l.usd || l.usd < CFG.liq.minUsd) return;
    if (!isWatched(l.coin)) return;
    store.liqs.unshift(l); cap(store.liqs, CFG.liq.keep);
    emit("liq", l);
  }
  function pushPrice(coin, gia, pct24h, san) {
    coin = up(coin); if (!gia) return;
    const p = { coin, gia, pct24h: pct24h == null ? store.prices[coin]?.pct24h ?? null : pct24h, san, ts: now() };
    store.prices[coin] = p;
    emit("price", p);
  }
  function pushPoly(p) { store.polys.unshift(p); cap(store.polys, CFG.poly.keep); emit("poly", p); }
  function pushNews(n) { store.news.unshift(n); cap(store.news, CFG.news.keep); emit("news", n); }

  /* ---------------- WebSocket tự hồi phục ---------------- */
  class Sock {
    constructor(id, url, opt) { this.id = id; this.url = url; this.o = opt || {}; this.retry = 0; }
    start() { this.stopped = false; this.open(); }
    stop() {
      this.stopped = true; clearInterval(this.hb); clearTimeout(this.rt);
      try { this.ws && this.ws.close(); } catch (e) {}
      setSource(this.id, "off", "đã tắt");
    }
    open() {
      setSource(this.id, "retry", this.retry ? `kết nối lại lần ${this.retry}` : "đang kết nối…");
      let ws;
      try { ws = new WebSocket(typeof this.url === "function" ? this.url() : this.url); }
      catch (e) { return this.schedule(); }
      this.ws = ws;

      ws.onopen = () => {
        this.retry = 0; this.last = now();
        setSource(this.id, "on", this.o.note || "WebSocket");
        try { this.o.onOpen && this.o.onOpen(ws); } catch (e) {}
        clearInterval(this.hb);
        this.hb = setInterval(() => {
          if (now() - this.last > CFG.ws.staleMs) { try { ws.close(); } catch (e) {} return; }
          if (this.o.ping) { try { ws.send(typeof this.o.ping === "function" ? this.o.ping() : this.o.ping); } catch (e) {} }
        }, this.o.pingMs || 20000);
      };
      ws.onmessage = (e) => {
        this.last = now(); bump(this.id);
        try { this.o.onMessage(e.data, ws); } catch (err) {}
      };
      ws.onclose = () => {
        clearInterval(this.hb);
        if (!this.stopped) { setSource(this.id, "off", "mất kết nối"); this.schedule(); }
      };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    }
    schedule() {
      if (this.stopped) return;
      this.retry++;
      const base = CFG.ws.retryBaseMs * Math.pow(1.8, Math.min(this.retry, 8));
      const delay = Math.min(base, CFG.ws.retryMaxMs) * (0.7 + Math.random() * 0.6);
      this.rt = setTimeout(() => this.open(), delay);
    }
  }

  /* ---------------- Fetch có timeout + proxy ---------------- */
  async function getJson(url, ms) {
    const u = CFG.endpoints.proxy && !url.startsWith(CFG.endpoints.proxy)
      && /polymarket|alternative\.me|binance|okx/.test(url) === false
      ? CFG.endpoints.proxy + encodeURIComponent(url) : url;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms || 12000);
    try {
      const r = await fetch(u, { signal: ac.signal, cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /* ============================================================
   * ADAPTER 1 — Binance Futures (lệnh lớn + thanh lý + giá)
   * ============================================================ */
  const A = {};
  A.binance = (function () {
    let sock = null, fallback = false;
    function streams() {
      const list = coins().map((c) => `${c.toLowerCase()}usdt@aggTrade`);
      coins().forEach((c) => list.push(`${c.toLowerCase()}usdt@ticker`));
      if (!fallback) list.push("!forceOrder@arr");
      return list.join("/");
    }
    function handle(raw) {
      const msg = JSON.parse(raw);
      const d = msg.data || msg;
      if (!d || !d.e) return;

      if (d.e === "aggTrade") {
        const coin = up(d.s).replace("USDT", "");
        const price = num(d.p), qty = num(d.q), usd = price * qty;
        pushWhale({ id: `bn-${d.a}`, san: fallback ? "BINANCE" : "BINANCE-F", coin, price, qty, usd,
                    side: d.m ? "SELL" : "BUY", ts: num(d.T) || now() });
      } else if (d.e === "24hrTicker") {
        const coin = up(d.s).replace("USDT", "");
        pushPrice(coin, num(d.c), num(d.P), "BINANCE");
      } else if (d.e === "forceOrder" && d.o) {
        const o = d.o, coin = up(o.s).replace("USDT", "");
        const price = num(o.ap) || num(o.p), qty = num(o.q), usd = price * qty;
        // Lệnh ép SELL = vị thế LONG bị thanh lý
        pushLiq({ id: `bnl-${o.T}-${o.s}`, san: "BINANCE-F", coin, price, qty, usd,
                  huong: up(o.S) === "SELL" ? "LONG" : "SHORT", ts: num(o.T) || now() });
      }
    }
    return {
      start() {
        sock = new Sock("binance", () => (fallback ? CFG.endpoints.binanceSpotWs : CFG.endpoints.binanceFutWs) + streams(),
          { note: fallback ? "Spot WS (dự phòng)" : "Futures WS", onMessage: handle });
        // Nếu futures bị chặn (geo-block) sau 4 lần thử → hạ cấp sang spot, mất kênh thanh lý
        const watch = setInterval(() => {
          if (!sock) return clearInterval(watch);
          if (!fallback && sock.retry >= 4) {
            fallback = true; sock.stop(); sock.retry = 0; sock.start();
            setSource("binance", "degraded", "Futures bị chặn → dùng Spot, không có thanh lý");
          }
        }, 5000);
        sock.start();
      },
      stop() { sock && sock.stop(); sock = null; },
    };
  })();

  /* ============================================================
   * ADAPTER 2 — OKX (trades spot + liquidation-orders SWAP)
   * ============================================================ */
  A.okx = (function () {
    let sock = null, ctVal = Object.assign({}, CFG.okxCtVal);
    async function loadCtVal() {
      try {
        const j = await getJson(`${CFG.endpoints.okxRest}/api/v5/public/instruments?instType=SWAP`, 15000);
        if (j && j.code === "0") for (const it of j.data || []) {
          const m = /^([A-Z0-9]+)-USDT-SWAP$/.exec(it.instId);
          if (m) ctVal[m[1]] = num(it.ctVal) || ctVal[m[1]];
        }
      } catch (e) {}
    }
    function handle(raw) {
      if (raw === "pong") return;
      const m = JSON.parse(raw);
      if (!m.arg || !m.data) return;
      const ch = m.arg.channel;

      if (ch === "trades") {
        for (const d of m.data) {
          const coin = up(d.instId).split("-")[0];
          const price = num(d.px), qty = num(d.sz);
          pushWhale({ id: `okx-${d.tradeId}`, san: "OKX", coin, price, qty, usd: price * qty,
                      side: up(d.side), ts: num(d.ts) || now() });
        }
      } else if (ch === "liquidation-orders") {
        for (const g of m.data) {
          const coin = up(g.instFamily || g.instId).split("-")[0];
          const cv = ctVal[coin] || 1;
          for (const d of g.details || []) {
            const price = num(d.bkPx), qty = num(d.sz) * cv;
            pushLiq({ id: `okxl-${d.ts}-${coin}-${d.sz}`, san: "OKX", coin, price, qty, usd: price * qty,
                      huong: up(d.side) === "SELL" ? "LONG" : "SHORT", ts: num(d.ts) || now() });
          }
        }
      }
    }
    return {
      start() {
        loadCtVal();
        sock = new Sock("okx", CFG.endpoints.okxWs, {
          note: "WS v5 public", ping: "ping", pingMs: 22000, onMessage: handle,
          onOpen: (ws) => {
            const args = coins().map((c) => ({ channel: "trades", instId: `${c}-USDT` }));
            args.push({ channel: "liquidation-orders", instType: "SWAP" });
            ws.send(JSON.stringify({ op: "subscribe", args }));
          },
        });
        sock.start();
      },
      stop() { sock && sock.stop(); sock = null; },
    };
  })();

  /* ============================================================
   * ADAPTER 3 — Bybit v5 linear (publicTrade + allLiquidation)
   * ============================================================ */
  A.bybit = (function () {
    let sock = null;
    function handle(raw) {
      const m = JSON.parse(raw);
      if (m.op === "pong" || !m.topic || !m.data) return;

      if (m.topic.startsWith("publicTrade")) {
        for (const d of [].concat(m.data)) {
          const coin = up(d.s).replace("USDT", "");
          const price = num(d.p), qty = num(d.v);
          pushWhale({ id: `by-${d.i}`, san: "BYBIT", coin, price, qty, usd: price * qty,
                      side: up(d.S), ts: num(d.T) || now() });
          // Giá dự phòng khi ticker Binance bị chặn theo vùng
          const cu = store.prices[coin];
          if (!cu || cu.san === "BYBIT" || cu.san === "HYPERLIQUID" || now() - cu.ts > 10000) pushPrice(coin, price, null, "BYBIT");
        }
      } else if (m.topic.startsWith("allLiquidation") || m.topic.startsWith("liquidation")) {
        for (const d of [].concat(m.data)) {
          const coin = up(d.s).replace("USDT", "");
          const price = num(d.p), qty = num(d.v);
          // S = phía của lệnh khớp thanh lý: Sell ⇒ vị thế LONG bị đóng
          pushLiq({ id: `byl-${d.T}-${coin}-${d.v}`, san: "BYBIT", coin, price, qty, usd: price * qty,
                    huong: up(d.S) === "SELL" ? "LONG" : "SHORT", ts: num(d.T) || now() });
        }
      }
    }
    return {
      start() {
        sock = new Sock("bybit", CFG.endpoints.bybitWs, {
          note: "WS v5 linear", ping: JSON.stringify({ op: "ping" }), pingMs: 18000, onMessage: handle,
          onOpen: (ws) => {
            const args = [];
            coins().forEach((c) => { args.push(`publicTrade.${c}USDT`); args.push(`allLiquidation.${c}USDT`); });
            ws.send(JSON.stringify({ op: "subscribe", args }));
          },
        });
        sock.start();
      },
      stop() { sock && sock.stop(); sock = null; },
    };
  })();

  /* ============================================================
   * ADAPTER 4 — Hyperliquid (DEX perp trades)
   * ============================================================ */
  A.hyperliquid = (function () {
    let sock = null;
    function handle(raw) {
      const m = JSON.parse(raw);
      if (m.channel !== "trades" || !Array.isArray(m.data)) return;
      for (const d of m.data) {
        const coin = up(d.coin), price = num(d.px), qty = num(d.sz);
        pushWhale({ id: `hl-${d.hash || d.tid || d.time}-${qty}`, san: "HYPERLIQUID", coin, price, qty,
                    usd: price * qty, side: d.side === "B" ? "BUY" : "SELL", ts: num(d.time) || now() });
        const cu = store.prices[coin];
        if (!cu || cu.san === "HYPERLIQUID" || now() - cu.ts > 15000) pushPrice(coin, price, null, "HYPERLIQUID");
      }
    }
    return {
      start() {
        sock = new Sock("hyperliquid", CFG.endpoints.hyperliquidWs, {
          note: "WS công khai", ping: JSON.stringify({ method: "ping" }), pingMs: 30000, onMessage: handle,
          onOpen: (ws) => coins().forEach((c) =>
            ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: c } }))),
        });
        sock.start();
      },
      stop() { sock && sock.stop(); sock = null; },
    };
  })();

  /* ============================================================
   * ADAPTER 5 — Polymarket (dòng lệnh cá cược, REST poll)
   * ============================================================ */
  A.polymarket = (function () {
    let timer = null, seen = new Set(), fails = 0;
    async function tick() {
      try {
        const rows = await getJson(`${CFG.endpoints.polymarketRest}?limit=100&takerOnly=true`, 12000);
        if (!Array.isArray(rows)) throw new Error("shape");
        fails = 0; setSource("polymarket", "on", "REST poll"); bump("polymarket");
        for (let i = rows.length - 1; i >= 0; i--) {
          const t = rows[i];
          const key = t.transactionHash || `${t.proxyWallet}-${t.timestamp}-${t.size}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const usd = num(t.size) * num(t.price);
          if (usd < CFG.poly.minUsd) continue;
          pushPoly({ id: key, ts: (num(t.timestamp) || 0) * 1000 || now(), title: t.title || t.slug || "—",
                     outcome: t.outcome, side: up(t.side), price: num(t.price), size: num(t.size), usd,
                     vi: t.proxyWallet, slug: t.slug });
        }
        if (seen.size > 4000) seen = new Set([...seen].slice(-1500));
      } catch (e) {
        fails++;
        setSource("polymarket", fails >= 3 ? "degraded" : "retry",
          fails >= 3 ? "bị chặn CORS hoặc lỗi mạng — cân nhắc dùng proxy" : "thử lại…");
      }
    }
    return {
      start() { tick(); timer = setInterval(tick, CFG.poly.pollMs); },
      stop() { clearInterval(timer); timer = null; setSource("polymarket", "off", "đã tắt"); },
    };
  })();

  /* ============================================================
   * ADAPTER 6 — Macro: Fear&Greed + funding + open interest
   * ============================================================ */
  A.macro = (function () {
    let t1 = null, t2 = null;
    async function fng() {
      try {
        const j = await getJson(CFG.endpoints.fng, 10000);
        const d = j && j.data && j.data[0];
        if (!d) return;
        store.macro.fng = { value: num(d.value), nhan: d.value_classification, ts: num(d.timestamp) * 1000 };
        emit("macro", store.macro);
        setSource("macro", "on", "Fear&Greed + funding/OI");
      } catch (e) { setSource("macro", "degraded", "không lấy được Fear&Greed"); }
    }
    async function derivs() {
      for (const c of coins().slice(0, 6)) {
        try {
          const p = await getJson(`${CFG.endpoints.binanceFutRest}/fapi/v1/premiumIndex?symbol=${c}USDT`, 10000);
          store.funding[c] = { rate: num(p.lastFundingRate) * 100, mark: num(p.markPrice), next: num(p.nextFundingTime) };
          const o = await getJson(`${CFG.endpoints.binanceFutRest}/fapi/v1/openInterest?symbol=${c}USDT`, 10000);
          store.oi[c] = { oi: num(o.openInterest), ts: num(o.time) || now() };
        } catch (e) { /* geo-block hoặc rate limit — bỏ qua vòng này */ }
      }
      emit("macro", store.macro);
    }
    return {
      start() { fng(); derivs(); t1 = setInterval(fng, 5 * 60e3); t2 = setInterval(derivs, 60e3); },
      stop() { clearInterval(t1); clearInterval(t2); setSource("macro", "off", "đã tắt"); },
    };
  })();

  /* ============================================================
   * ADAPTER 7 — Dòng tiền ETF (JSON qua proxy của bạn)
   * ============================================================ */
  A.etf = (function () {
    let timer = null;
    async function tick() {
      const url = CFG.endpoints.etfFlowsUrl;
      if (!url) return setSource("etf", "off", "chưa cấu hình endpoint");
      try {
        store.etf = await getJson(url, 15000);
        setSource("etf", "on", "cập nhật 10 phút/lần"); bump("etf");
        emit("etf", store.etf);
      } catch (e) { setSource("etf", "degraded", "không tải được"); }
    }
    return { start() { tick(); timer = setInterval(tick, 10 * 60e3); }, stop() { clearInterval(timer); } };
  })();

  /* ============================================================
   * ADAPTER 8 — Tin tức (RSS qua proxy, trả JSON hoặc XML)
   * ============================================================ */
  A.newsFeed = (function () {
    let timer = null;
    async function tick() {
      const url = CFG.endpoints.newsRssUrl;
      if (!url) return setSource("newsFeed", "off", "chưa cấu hình endpoint");
      try {
        const r = await fetch(url, { cache: "no-store" });
        const txt = await r.text();
        let items = [];
        try {
          const j = JSON.parse(txt);
          items = (j.items || j.articles || j).map((n) => ({ title: n.title, url: n.url || n.link, ts: +new Date(n.published_at || n.pubDate || n.ts || Date.now()) }));
        } catch (e) {
          const doc = new DOMParser().parseFromString(txt, "text/xml");
          items = [...doc.querySelectorAll("item")].map((it) => ({
            title: it.querySelector("title")?.textContent || "",
            url: it.querySelector("link")?.textContent || "",
            ts: +new Date(it.querySelector("pubDate")?.textContent || Date.now()),
          }));
        }
        const have = new Set(store.news.map((n) => n.url));
        items.reverse().forEach((n) => { if (n.title && !have.has(n.url)) pushNews(n); });
        setSource("newsFeed", "on", "RSS"); bump("newsFeed");
      } catch (e) { setSource("newsFeed", "degraded", "không tải được"); }
    }
    return { start() { tick(); timer = setInterval(tick, 3 * 60e3); }, stop() { clearInterval(timer); } };
  })();

  /* ============================================================
   * ADAPTER 9 — TraderMap (TẮT mặc định)
   * Backend riêng của bên thứ ba: cần được phép sử dụng và cần proxy
   * vì API không mở CORS cho origin github.io.
   * ============================================================ */
  A.tradermap = (function () {
    let timer = null, sock = null;
    const px = (u) => (CFG.endpoints.proxy ? CFG.endpoints.proxy + encodeURIComponent(u) : u);
    async function tick() {
      try {
        const [prices, stats] = await Promise.all([
          getJson(px(`${CFG.endpoints.tmRest}/api/prices`), 12000),
          getJson(px(`${CFG.endpoints.tmRest}/api/stats?hours=1`), 12000),
        ]);
        if (prices && prices.prices) for (const [c, p] of Object.entries(prices.prices))
          if (isWatched(c)) pushPrice(c, num(p.price), num(p.change24h), p.exchange || "TRADERMAP");
        if (stats && stats.success) { store.tmStats = stats; emit("stats", buildStats()); }
        setSource("tradermap", "on", "REST"); bump("tradermap");
      } catch (e) { setSource("tradermap", "degraded", "cần proxy / quyền truy cập"); }
    }
    return {
      start() {
        tick(); timer = setInterval(tick, 15000);
        if (CFG.endpoints.tmUserId) {
          sock = new Sock("tradermap", `${CFG.endpoints.tmWsPoly}?userId=${encodeURIComponent(CFG.endpoints.tmUserId)}`, {
            note: "WS polymarket",
            onOpen: (ws) => ws.send(JSON.stringify({ type: "subscribe", filters: { minSize: CFG.poly.minUsd } })),
            onMessage: (raw) => {
              const m = JSON.parse(raw);
              const arr = m.trades || (m.trade ? [m.trade] : []);
              arr.forEach((t) => pushPoly({ id: t.id || `${t.timestamp}-${t.size}`, ts: num(t.timestamp) || now(),
                title: t.title || t.market, outcome: t.outcome, side: up(t.side), price: num(t.price),
                size: num(t.size), usd: num(t.size) * num(t.price), vi: t.wallet }));
            },
          });
          sock.start();
        }
      },
      stop() { clearInterval(timer); sock && sock.stop(); setSource("tradermap", "off", "đã tắt"); },
    };
  })();

  /* ============================================================
   * TỔNG HỢP THỐNG KÊ (khung 1h trượt)
   * ============================================================ */
  const BUCKETS = [
    ["10K-100K", 10e3, 100e3], ["100K-500K", 100e3, 500e3], ["500K-1M", 500e3, 1e6],
    ["1M-10M", 1e6, 10e6], ["10M+", 10e6, Infinity],
  ];

  function buildStats() {
    const t0 = now() - CFG.whale.windowMin * 60e3;
    const w = store.whales.filter((x) => x.ts >= t0);
    const l = store.liqs.filter((x) => x.ts >= t0);

    let buy = 0, sell = 0, vol = 0;
    const perCoin = {};
    for (const t of w) {
      vol += t.usd;
      if (t.side === "BUY") buy += t.usd; else sell += t.usd;
      const c = (perCoin[t.coin] = perCoin[t.coin] || { volume: 0, count: 0, buy: 0, sell: 0 });
      c.volume += t.usd; c.count++;
      if (t.side === "BUY") c.buy += t.usd; else c.sell += t.usd;
    }
    const dist = {};
    for (const [ten, lo, hi] of BUCKETS) {
      const g = w.filter((t) => t.usd >= lo && t.usd < hi);
      const b = g.reduce((s, t) => s + (t.side === "BUY" ? t.usd : 0), 0);
      const v = g.reduce((s, t) => s + t.usd, 0);
      dist[ten] = { count: g.length, volume: v, long: v ? Math.round((b / v) * 100) : 50, short: v ? 100 - Math.round((b / v) * 100) : 50 };
    }
    let liqLong = 0, liqShort = 0;
    for (const x of l) (x.huong === "LONG" ? (liqLong += x.usd) : (liqShort += x.usd));

    const stats = {
      ts: now(), windowMin: CFG.whale.windowMin,
      whale: { totalVolume: vol, buyVolume: buy, sellVolume: sell, tradeCount: w.length,
               netFlow: buy - sell, momentum: vol ? buy / vol : 0.5 },
      liquidation: { totalVolume: liqLong + liqShort, longVolume: liqLong, shortVolume: liqShort, count: l.length },
      distribution: dist, coinStats: perCoin,
      top: { whales: [...w].sort((a, b) => b.usd - a.usd).slice(0, 3), liqs: [...l].sort((a, b) => b.usd - a.usd).slice(0, 3) },
    };
    store.stats = stats;
    return stats;
  }

  /* Điểm dòng tiền −100..+100 cho engine/bot của Trade.2026
   * opts.loaiTruSan: mảng tên sàn cần loại (vd ["OKX"]) — tránh đếm trùng khi
   * nguồn đó đã được tính ở nơi khác (OKX taker flow đã có ở Whale Score layer 2). */
  function flowScore(coin, opts = {}) {
    coin = up(coin);
    const loai = new Set((opts.loaiTruSan || []).map(up));
    const t0 = now() - 30 * 60e3;
    const w = store.whales.filter((x) => x.coin === coin && x.ts >= t0 && !loai.has(up(x.san)));
    const l = store.liqs.filter((x) => x.coin === coin && x.ts >= t0 && !loai.has(up(x.san)));
    if (!w.length && !l.length) return 0;
    const buy = w.reduce((s, x) => s + (x.side === "BUY" ? x.usd : 0), 0);
    const sell = w.reduce((s, x) => s + (x.side === "SELL" ? x.usd : 0), 0);
    const flow = buy + sell ? ((buy - sell) / (buy + sell)) * 70 : 0;
    const lg = l.reduce((s, x) => s + (x.huong === "LONG" ? x.usd : 0), 0);
    const ls = l.reduce((s, x) => s + (x.huong === "SHORT" ? x.usd : 0), 0);
    // Long bị thanh lý nhiều = áp lực bán đã xả xong ⇒ nghiêng tăng nhẹ
    const liq = lg + ls ? ((lg - ls) / (lg + ls)) * 30 : 0;
    return Math.max(-100, Math.min(100, Math.round(flow + liq)));
  }

  /* ---------------- Vòng đời ---------------- */
  let running = false, statTimer = null;

  function start() {
    if (running) return; running = true; store.startedAt = now();
    for (const [id, adapter] of Object.entries(A)) {
      if (!CFG.sources[id]) { setSource(id, "off", "đã tắt trong cấu hình"); continue; }
      try { adapter.start(); } catch (e) { setSource(id, "degraded", "lỗi khởi động"); }
    }
    statTimer = setInterval(() => emit("stats", buildStats()), 2000);
    emit("stats", buildStats());
    console.log("[DataHub] đã khởi động ·", Object.keys(CFG.sources).filter((k) => CFG.sources[k]).join(" · "));
  }
  function stop() {
    if (!running) return; running = false;
    clearInterval(statTimer);
    for (const [id, adapter] of Object.entries(A)) { if (CFG.sources[id]) { try { adapter.stop(); } catch (e) {} } }
  }
  function setFilter(f) {
    if (!f) return;
    if (f.minUsd) CFG.whale.minUsd = +f.minUsd;
    if (Array.isArray(f.coins) && f.coins.length) { CFG.coins = f.coins.map(up); stop(); start(); }
    emit("stats", buildStats());
  }

  global.DataHub = {
    VERSION: "1.0.0",
    config: CFG, on, off, start, stop, setFilter, flowScore,
    stats: () => store.stats || buildStats(),
    prices: () => store.prices,
    sources: () => Object.values(store.sources),
    whales: (n) => store.whales.slice(0, n || 50),
    liqs: (n) => store.liqs.slice(0, n || 50),
    polys: (n) => store.polys.slice(0, n || 50),
    newsList: (n) => store.news.slice(0, n || 20),
    macro: () => store.macro,
    funding: () => store.funding,
    oi: () => store.oi,
    etf: () => store.etf,
    snapshot: () => JSON.parse(JSON.stringify({
      ts: now(), prices: store.prices, stats: store.stats, macro: store.macro,
      sources: store.sources, whales: store.whales.slice(0, 100), liqs: store.liqs.slice(0, 100),
      polys: store.polys.slice(0, 50),
    })),
    isRunning: () => running,
  };
})(window);
