/* ============================================================
 * Trade.2026 — Liq Feed cho trạm 24/7 (hướng F, 20/11/2026)
 * Cấp DataHub / DataHubBridge cho engine khi chạy trên trạm
 * (tools/collector-247.js), nơi không có tab trình duyệt và
 * không nạp datahub.js / datahub-bridge.js — nên trước đây
 * engine luôn thấy dongTien = null trên trạm.
 *
 * Nguồn dữ liệu: kho dòng tiền data/.flow-247-store.json do
 * tools/flow-collector.js thu (OKX + Hyperliquid: lệnh lớn +
 * thanh lý). Host (collector) cung cấp __docKhoFlow() — hàm
 * đọc lại file kho từ đĩa MỖI LẦN GỌI.
 *
 * Ngữ nghĩa SAO Y từ code trình duyệt (không tự bịa công thức):
 *  - flowScore(coin): datahub.js:528-541 — cửa sổ 30 phút;
 *    whale (buy-sell)/(buy+sell)*70 + thanh lý
 *    (long-short)/(long+short)*30. Long bị thanh lý nhiều
 *    => điểm DƯƠNG (áp lực bán đã xả xong — quy ước sẵn có).
 *  - stats(): datahub.js:490-525 — cửa sổ windowMin = 60 phút
 *    (DH_CONFIG.whale.windowMin trong datahub.config.js:21).
 *    Engine trên trạm chỉ dùng coinStats {count, buy, sell}.
 *  - thanhLyGanDay(coin, phut): datahub-bridge.js:97-104 —
 *    tổng long/short/tong/count trong cửa sổ, lọc theo coin + ts.
 *    KHÁC BIỆT DUY NHẤT (ghi rõ): bridge trình duyệt chỉ quét
 *    DH.liqs(400) — 400 bản ghi mới nhất MỌI coin (tối ưu RAM
 *    cho tab web). Bản trạm quét TOÀN BỘ kho để không bỏ sót
 *    thanh lý của coin đang xét khi 400 bản ghi mới nhất toàn
 *    là coin khác.
 *  - Cửa sổ thời gian: bản trình duyệt chỉ lọc ts >= t0 (ngầm giả định
 *    kho chỉ chứa dữ liệu quá khứ — đúng khi chạy live, vì feed append
 *    theo thời gian thực). Bản trạm lọc thêm ts <= now: nếu không, khi
 *    replay/backtest/khôi phục kho, các bản ghi TƯƠNG LAI so với mốc
 *    đang xét sẽ rò vào cửa sổ (test T4 đã bắt đúng lỗi này: cửa sổ
 *    15 phút tại 22:07 tính ra 440 lệnh / $321M thay vì 39 lệnh / ~$22M
 *    vì fixture chứa cả dữ liệu đến 23:30). Khi chạy live hai bản cho
 *    cùng kết quả, vì kho live không có bản ghi tương lai.
 *  - Lịch sử 12h: KHÔNG cấp taiLichSu12h/flowScore12h — engine
 *    kiểm tra typeof rồi bỏ qua (phần ±3 điểm 12h không áp
 *    trên trạm ở hướng F này).
 *
 * TƯƠI (real-time): napLiqFeed() đọc lại file kho khi bắt đầu
 * mỗi vòng quét và cache cho cả vòng (độ hạt tươi = 1 vòng trạm,
 * 15 phút). Gọi lại napLiqFeed() là đọc lại file mới — test T3
 * trong tools/test-liq-feed.js chứng minh không cache xuyên vòng.
 *
 * AN TOÀN: kho thiếu/hỏng/rỗng => isRunning() false => engine
 * bỏ qua dongTien y như trước khi có feed (không crash vòng quét,
 * không đổi tín hiệu). Mọi lỗi đọc kho đều nuốt trong try/catch.
 * ============================================================ */
(function (global) {
  "use strict";
  const up = (s) => String(s || "").toUpperCase();
  const num = (v) => { const n = +v; return Number.isFinite(n) ? n : 0; };
  const WINDOW_FLOW_MIN = 30; // datahub.js flowScore
  const WINDOW_STATS_MIN = 60; // DH_CONFIG.whale.windowMin

  let snap = { whales: [], liqs: [] };
  let perCoin = {}; // coin -> {whales:[], liqs:[]} (index 1 lần mỗi vòng)
  let statsCache = null;
  let snapAt = 0;
  let snapOk = false;

  function buildPerCoin() {
    perCoin = {};
    for (const t of snap.whales) {
      const c = up(t.coin);
      (perCoin[c] = perCoin[c] || { whales: [], liqs: [] }).whales.push(t);
    }
    for (const x of snap.liqs) {
      const c = up(x.coin);
      (perCoin[c] = perCoin[c] || { whales: [], liqs: [] }).liqs.push(x);
    }
  }

  function buildStats() {
    const nowMs = Date.now();
    const t0 = nowMs - WINDOW_STATS_MIN * 60e3;
    const w = snap.whales.filter((x) => num(x.ts) >= t0 && num(x.ts) <= nowMs);
    const l = snap.liqs.filter((x) => num(x.ts) >= t0 && num(x.ts) <= nowMs);
    let buy = 0, sell = 0, vol = 0;
    const coinStats = {};
    for (const t of w) {
      const usd = num(t.usd);
      vol += usd;
      if (t.side === "BUY") buy += usd; else sell += usd;
      const c = (coinStats[up(t.coin)] = coinStats[up(t.coin)] || { volume: 0, count: 0, buy: 0, sell: 0 });
      c.volume += usd; c.count++;
      if (t.side === "BUY") c.buy += usd; else c.sell += usd;
    }
    let liqLong = 0, liqShort = 0;
    for (const x of l) (x.huong === "LONG" ? (liqLong += num(x.usd)) : (liqShort += num(x.usd)));
    return {
      ts: nowMs, windowMin: WINDOW_STATS_MIN,
      whale: { totalVolume: vol, buyVolume: buy, sellVolume: sell, tradeCount: w.length,
               netFlow: buy - sell, momentum: vol ? buy / vol : 0.5 },
      liquidation: { totalVolume: liqLong + liqShort, longVolume: liqLong, shortVolume: liqShort, count: l.length },
      coinStats,
      top: { whales: [...w].sort((a, b) => num(b.usd) - num(a.usd)).slice(0, 3),
             liqs: [...l].sort((a, b) => num(b.usd) - num(a.usd)).slice(0, 3) },
    };
  }

  /* Đọc lại kho từ đĩa (qua host __docKhoFlow) + index theo coin. */
  function napLiqFeed() {
    snap = { whales: [], liqs: [] };
    perCoin = {}; statsCache = null; snapOk = false;
    try {
      const raw = (typeof __docKhoFlow === "function") ? __docKhoFlow() : null;
      if (raw && Array.isArray(raw.liqs)) {
        snap = { whales: Array.isArray(raw.whales) ? raw.whales : [], liqs: raw.liqs };
        snapOk = true;
      }
    } catch (e) { snapOk = false; }
    snapAt = Date.now();
    if (snapOk) { buildPerCoin(); statsCache = buildStats(); }
    return snapOk;
  }

  function liqFeedInfo() {
    return { ok: snapOk, docLuc: snapAt, soLiq: snap.liqs.length, soWhale: snap.whales.length };
  }

  /* Điểm dòng tiền −100..+100 — công thức y hệt datahub.js flowScore. */
  function flowScore(coin, opts) {
    coin = up(coin);
    if (!snapOk) return 0;
    const loai = new Set((((opts || {}).loaiTruSan) || []).map(up));
    const nowMs = Date.now();
    const t0 = nowMs - WINDOW_FLOW_MIN * 60e3;
    const pc = perCoin[coin] || { whales: [], liqs: [] };
    const w = pc.whales.filter((x) => num(x.ts) >= t0 && num(x.ts) <= nowMs && !loai.has(up(x.san)));
    const l = pc.liqs.filter((x) => num(x.ts) >= t0 && num(x.ts) <= nowMs && !loai.has(up(x.san)));
    if (!w.length && !l.length) return 0;
    const buy = w.reduce((s, x) => s + (x.side === "BUY" ? num(x.usd) : 0), 0);
    const sell = w.reduce((s, x) => s + (x.side === "SELL" ? num(x.usd) : 0), 0);
    const flow = buy + sell ? ((buy - sell) / (buy + sell)) * 70 : 0;
    const lg = l.reduce((s, x) => s + (x.huong === "LONG" ? num(x.usd) : 0), 0);
    const ls = l.reduce((s, x) => s + (x.huong === "SHORT" ? num(x.usd) : 0), 0);
    const liq = lg + ls ? ((lg - ls) / (lg + ls)) * 30 : 0;
    return Math.max(-100, Math.min(100, Math.round(flow + liq)));
  }

  const DataHub = {
    isRunning: () => snapOk,
    flowScore,
    stats: () => (snapOk && statsCache ? statsCache : { coinStats: {} }),
    prices: () => ({}),
  };

  const DataHubBridge = {
    /* Tổng thanh lý trong N phút gần nhất — ngữ nghĩa y hệt
     * datahub-bridge.js thanhLyGanDay, trừ việc quét toàn bộ kho
     * thay vì chỉ 400 bản ghi mới nhất (xem đầu file). */
    thanhLyGanDay(coin, phut) {
      const nowMs = Date.now();
      const t0 = nowMs - (phut || 5) * 60e3;
      const pc = snapOk ? (perCoin[up(coin)] || { liqs: [] }) : { liqs: [] };
      const l = pc.liqs.filter((x) => num(x.ts) >= t0 && num(x.ts) <= nowMs);
      const long = l.reduce((s, x) => s + (x.huong === "LONG" ? num(x.usd) : 0), 0);
      const short = l.reduce((s, x) => s + (x.huong === "SHORT" ? num(x.usd) : 0), 0);
      return { long, short, tong: long + short, count: l.length };
    },
  };

  global.DataHub = DataHub;
  global.DataHubBridge = DataHubBridge;
  if (global.window) {
    global.window.DataHub = DataHub;
    global.window.DataHubBridge = DataHubBridge;
  }
  global.napLiqFeed = napLiqFeed;
  global.liqFeedInfo = liqFeedInfo;
})(globalThis);
