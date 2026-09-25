/* ============================================================
 * Trade.2026 DataHub — CẦU NỐI VÀO APP TRADE.2026
 * Nạp SAU app.js (và sau datahub-ui.js).
 *  · Thêm màn hình "🌊 Dòng tiền" vào router/sidebar
 *  · Bơm giá + điểm dòng tiền cho engine/bot
 *  · Phát sự kiện DOM "siro:datahub" cho các module khác
 * ============================================================ */
(function (global) {
  "use strict";
  const DH = global.DataHub;
  if (!DH) { console.error("[DataHub bridge] thiếu datahub.js"); return; }

  const OPT = {
    screenId: "dongtien",
    screenTen: "Dòng tiền",
    screenEmoji: "🌊",
    mirrorConnState: false,   // bật nếu muốn đẩy trạng thái nguồn vào chip header của Siro
    feedPriceHub: true,       // dùng giá DataHub làm giá dự phòng khi WS của Siro rớt
  };

  /* ---------- 1. Đăng ký màn hình vào router ---------- */
  function dangKyManHinh() {
    try {
      if (typeof SCREENS === "object" && SCREENS && !SCREENS[OPT.screenId]) {
        SCREENS[OPT.screenId] = {
          ten: OPT.screenTen, emoji: OPT.screenEmoji,
          render: (root) => global.renderDongTien(root),
        };
      }
    } catch (err) { /* app.js chưa nạp — dùng fallback bên dưới */ }
  }
  dangKyManHinh();

  function themNavItem() {
    const nav = document.querySelector("#nav-list");
    if (!nav || nav.querySelector(`[data-screen="${OPT.screenId}"]`)) return;
    const item = document.createElement("div");
    item.className = "nav-item";
    item.dataset.screen = OPT.screenId;
    item.innerHTML = `<span class="nav-emoji">${OPT.screenEmoji}</span><span class="nav-text">${OPT.screenTen}</span>`;
    item.addEventListener("click", () => { location.hash = `#/${OPT.screenId}`; });
    // chèn ngay sau "Radar Cá Mập" nếu có
    const camap = nav.querySelector('[data-screen="camap"]');
    camap ? camap.after(item) : nav.appendChild(item);
  }

  /* ---------- 2. Phát sự kiện DOM cho phần còn lại của app ---------- */
  function phat(loai, chiTiet) {
    document.dispatchEvent(new CustomEvent("siro:datahub", { detail: { loai, ...chiTiet } }));
  }
  DH.on("whale", (t) => phat("whale", { trade: t }));
  DH.on("liq",   (l) => phat("liq", { liq: l }));
  DH.on("stats", (s) => phat("stats", { stats: s }));

  /* ---------- 3. Giá dự phòng + trạng thái nguồn ---------- */
  // FIX v2.0: ghi giá DataHub vào đúng slot theo NGUỒN (p.san) — giá perp Bybit/
  // Hyperliquid KHÔNG được nhét vào slot spot BINANCE (sai provenance, sai basis).
  const SLOT_THEO_SAN = { BINANCE: "BINANCE", "BINANCE-F": "BINANCE", OKX: "OKX", MEXC: "MEXC", BYBIT: "BYBIT_PERP", HYPERLIQUID: "HYPERLIQUID" };
  DH.on("price", (p) => {
    if (!OPT.feedPriceHub) return;
    try {
      if (typeof PRICE_HUB !== "undefined" && PRICE_HUB && PRICE_HUB.prices) {
        const slot = SLOT_THEO_SAN[String(p.san || "").toUpperCase()] || "DH_KHAC";
        const kho = PRICE_HUB.prices[slot] || (PRICE_HUB.prices[slot] = {});
        const cu = kho[p.coin];
        // chỉ đắp vào khi giá của app cũ hơn 10 giây (WS sàn đang rớt)
        if (!cu || !cu.ts || Date.now() - cu.ts > 10000) {
          kho[p.coin] = { gia: p.gia, pct24h: p.pct24h, ts: p.ts };
          if (typeof PRICE_HUB.emit === "function") PRICE_HUB.emit(slot, p.coin);
        }
      }
    } catch (err) {}
  });

  DH.on("source", (s) => {
    if (!OPT.mirrorConnState) return;
    try {
      if (typeof ConnState !== "undefined" && ConnState.set)
        ConnState.set(`DH-${s.id}`, s.status === "on" ? "on" : s.status === "retry" ? "retry" : "off", s.note);
    } catch (err) {}
  });

  /* ---------- 4. Tiện ích cho engine tín hiệu / bot ---------- */
  const Bridge = {
    opt: OPT,
    /* Điểm dòng tiền −100..+100 (dùng cộng vào Whale Score) */
    diemDongTien: (coin, opts) => DH.flowScore(coin, opts),
    /* Cộng dòng tiền real-time vào whale score sẵn có, giới hạn ±20 điểm.
     * FIX v2.0 (M6): loại OKX khỏi dòng này vì OKX taker flow đã tính ở layer 2
     * (rubik) của Whale Score — đếm 2 lần sẽ thổi phồng điểm. */
    congVaoWhaleScore(coin, scoreCu) {
      const d = DH.flowScore(coin, { loaiTruSan: ["OKX"] });
      const them = Math.max(-20, Math.min(20, Math.round(d * 0.2)));
      return Math.max(-100, Math.min(100, (scoreCu || 0) + them));
    },
    /* Cảnh báo quét thanh khoản: tổng thanh lý 5 phút gần nhất của 1 coin */
    thanhLyGanDay(coin, phut) {
      const t0 = Date.now() - (phut || 5) * 60e3;
      const l = DH.liqs(400).filter((x) => x.coin === String(coin).toUpperCase() && x.ts >= t0);
      const long = l.reduce((s, x) => s + (x.huong === "LONG" ? x.usd : 0), 0);
      const short = l.reduce((s, x) => s + (x.huong === "SHORT" ? x.usd : 0), 0);
      return { long, short, tong: long + short, count: l.length };
    },
    /* Có cá mập vào lệnh cùng chiều trong N phút không? */
    xacNhanCaMap(coin, huong, phut) {
      const t0 = Date.now() - (phut || 15) * 60e3;
      const w = DH.whales(600).filter((x) => x.coin === String(coin).toUpperCase() && x.ts >= t0);
      const buy = w.reduce((s, x) => s + (x.side === "BUY" ? x.usd : 0), 0);
      const sell = w.reduce((s, x) => s + (x.side === "SELL" ? x.usd : 0), 0);
      return String(huong).toUpperCase() === "LONG" ? buy > sell * 1.2 : sell > buy * 1.2;
    },
  };
  global.DataHubBridge = Bridge;

  /* ---------- 4b. FlowDB — thu thập dòng tiền LIÊN TỤC vào database ----------
   * Mọi sự kiện whale/thanh lý được ghi vào IndexedDB ngay khi xảy ra,
   * kể cả khi user chưa mở màn hình "Dòng tiền" → mở là có sẵn lịch sử. */
  function khoiDongFlowDB() {
    try {
      const FDB = global.FlowDB;
      if (!FDB) return;
      FDB.init().then(() => {
        DH.on("whale", (t) => { try { FDB.trackWhale(t); } catch (e) {} });
        DH.on("liq",   (l) => { try { FDB.trackLiq(l); } catch (e) {} });
        Bridge.flowDB = FDB;
      }).catch(() => {});
    } catch (err) {}
  }

  /* ---------- 5. Khởi động ---------- */
  function boot() {
    dangKyManHinh();
    themNavItem();
    if (!DH.isRunning()) DH.start();
    khoiDongFlowDB();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
  else setTimeout(boot, 0);

  /* Tiết kiệm tài nguyên: ngắt nguồn khi tab ẩn > 5 phút, nối lại khi quay lại */
  let idleTimer = null;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) idleTimer = setTimeout(() => DH.stop(), 5 * 60e3);
    else { clearTimeout(idleTimer); if (!DH.isRunning()) DH.start(); }
  });
})(window);
