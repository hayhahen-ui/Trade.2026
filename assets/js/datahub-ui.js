/* ============================================================
 * Trade.2026 DataHub — MÀN HÌNH "🌊 Dòng tiền"
 * Nạp SAU datahub.js. Không phụ thuộc utils.js của Siro.
 * ============================================================ */
(function (global) {
  "use strict";
  const DH = global.DataHub;
  if (!DH) { console.error("[DataHub UI] thiếu datahub.js"); return; }
  const CFG = DH.config;

  /* ---------- helper DOM ---------- */
  function e(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  }
  const fmtUsd = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return v.toFixed(0);
  };
  const fmtNum = (v, d) => Number(v).toLocaleString("vi-VN", { maximumFractionDigits: d == null ? 2 : d });
  const gio = (ts) => new Date(ts).toLocaleTimeString("vi-VN", { hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

  /* ---------- trạng thái màn hình ---------- */
  let root = null, dirty = false, timer = null;

  /* ---------- FlowDB: lịch sử dòng tiền (mở màn hình là có ngay) ---------- */
  const FDB = () => global.FlowDB || null;
  let HIST = { whales: [], liqs: [], alerts: [], ok: false, db: false };

  const _keyEv = (t) => [t.ts, t.coin, t.usd, t.san, t.side || t.huong].join("|");
  function _napLichSu(dst, item, max) {
    if (!item) return;
    const k = _keyEv(item);
    if (dst.some((x) => _keyEv(x) === k)) return;
    dst.unshift(item);
    if (dst.length > max) dst.length = max;
  }

  /* Merge dữ liệu Trạm 24/7 (server thu OKX+Hyperliquid liên tục) vào FlowDB.
   * Chạy mỗi khi mở màn hình Dòng tiền: mở web là có ngay master data,
   * không cần chờ tab gom từ đầu. Lỗi mạng → bỏ qua lặng lẽ. */
  const TRAM_FLOW_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/flow-247.json";
  const TRAM_JOURNAL_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/journal-247.json";
  let tramInfo = null;
  async function mergeTram247() {
    const db = FDB();
    if (!db) return null;
    try {
      const r = await fetch(TRAM_FLOW_URL + "?t=" + Date.now());
      if (!r.ok) return null;
      const txt = await r.text();
      const d = JSON.parse(txt);
      if (!d || d.tram !== "flow-247") return null;
      await db.init();
      const kq = await db.mergeTram(d);
      tramInfo = {
        them: kq.whales + kq.liqs, capNhat: kq.capNhat, nguon: kq.nguon, bytes: txt.length,
        hetBoNho: !!(d.meta && d.meta.hetBoNho), lyDo: d.meta && d.meta.lyDo,
      };
      return tramInfo;
    } catch (err) { return null; }
  }

  /* ---------- Dung lượng: cảnh báo chiếm dụng ----------
   * 3 nơi lưu: IndexedDB trình duyệt (quota qua storage.estimate),
   * localStorage (~5MB), file trạm trên server (meta.bytes trong payload). */
  const LS_GIOI_HAN = 5 * 1024 * 1024;
  function fmtKB(b) {
    if (b == null || isNaN(b)) return "—";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function doLocalStorage() {
    let bytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        bytes += (k.length + (localStorage.getItem(k) || "").length) * 2;
      }
    } catch (e) {}
    return bytes;
  }
  async function doDungLuong() {
    const kq = { idb: null, quota: null, ls: doLocalStorage(), journalBytes: null, flowBytes: tramInfo ? tramInfo.bytes : null, tramDay: tramInfo ? !!tramInfo.hetBoNho : false, tramLyDo: tramInfo ? tramInfo.lyDo : "" };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const es = await navigator.storage.estimate();
        kq.idb = es.usage; kq.quota = es.quota;
      }
    } catch (e) {}
    try {
      const r = await fetch(TRAM_JOURNAL_URL + "?t=" + Date.now(), { method: "HEAD" });
      const len = r.headers.get("content-length");
      if (len) kq.journalBytes = +len;
    } catch (e) {}
    return kq;
  }
  async function layTrangThaiKho() {
    const db = FDB();
    if (!db) return null;
    try { await db.init(); return db.trangThaiKho(); } catch (e) { return null; }
  }
  function veDungLuong(dl, kho) {
    if (!dl) return null;
    const canhBao = [];
    let idbTxt = "không đo được";
    if (dl.idb != null && dl.quota) {
      const pct = Math.round((dl.idb / dl.quota) * 100);
      idbTxt = `${fmtKB(dl.idb)} / ${fmtKB(dl.quota)} (${pct}%)`;
      if (pct >= 80) canhBao.push(`IndexedDB đã dùng ${pct}% quota`);
    }
    const lsPct = Math.round((dl.ls / LS_GIOI_HAN) * 100);
    if (lsPct >= 80) canhBao.push(`localStorage đã dùng ${lsPct}% (~5MB)`);
    let tramTxt = "";
    if (dl.flowBytes != null || dl.journalBytes != null)
      tramTxt = ` · trạm server: flow ${fmtKB(dl.flowBytes)} + journal ${fmtKB(dl.journalBytes)}`;
    if (dl.tramDay) canhBao.push(`trạm server ⏸ đã dừng ghi (${dl.tramLyDo || "kho đầy"})`);
    const kids = [
      `💾 Dung lượng: trình duyệt ${idbTxt} · localStorage ${fmtKB(dl.ls)} / ~5MB (${lsPct}%)${tramTxt}.`,
    ];
    if (kho && kho.dungGhi) {
      canhBao.push(`database dòng tiền ⏸ đã dừng ghi (${kho.lyDo})`);
      kids.push(e("div", { style: "margin-top:4px" },
        e("button", {
          class: "dh-btn", onclick: async () => {
            if (!confirm("Xóa sự kiện dòng tiền cũ hơn 7 ngày để giải phóng bộ nhớ? (Chỉ xóa khi bạn đồng ý)")) return;
            const db = FDB();
            if (db) { await db.init(); await db.donDep(7); }
            ve();
          },
        }, "🗑 Dọn dữ liệu cũ hơn 7 ngày")));
    }
    if (canhBao.length) kids.push(e("div", { style: "margin-top:4px" }, `⚠️ ${canhBao.join(" · ")} — tôi không tự xóa, bạn dọn xong hệ thống sẽ ghi tiếp.`));
    const cls = canhBao.length ? "dh-dbchip dh-warn" : "dh-dbchip";
    return e("div", { class: cls }, ...kids);
  }

  /* Nạp 1 lần khi mở màn hình: lệnh lớn / thanh lý / cảnh báo gần nhất từ DB */
  async function napLichSu() {
    const db = FDB();
    if (!db || HIST.ok) return;
    try {
      await db.init();
      const [w, l, a] = await Promise.all([
        db.recentWhales({ limit: 150 }),
        db.recentLiqs({ limit: 80 }),
        db.alerts({ limit: 12 }),
      ]);
      HIST.whales = w; HIST.liqs = l; HIST.alerts = a; HIST.ok = true; HIST.db = true;
      db.onAlert((al) => { _napLichSu(HIST.alerts, al, 30); markDirty(); });
    } catch (err) { /* fallback: dùng RAM của DataHub */ }
  }

  /* Chuẩn hóa stats: ưu tiên FlowDB (đủ 60' lịch sử), fallback DH.stats() */
  async function layStats() {
    const db = FDB();
    if (db) {
      try {
        await db.init();
        const fw = await db.flowWindow(CFG.whale.windowMin);
        const scores = {};
        for (const coin of Object.keys(fw.perCoin)) scores[coin] = await db.flowScore(coin);
        return {
          tuDB: true, windowMin: CFG.whale.windowMin,
          whale: {
            netFlow: fw.net, totalVolume: fw.volume, tradeCount: fw.count,
            momentum: fw.volume ? fw.buy / fw.volume : 0.5,
          },
          liquidation: {
            totalVolume: fw.liqLong + fw.liqShort, longVolume: fw.liqLong,
            shortVolume: fw.liqShort, count: fw.liqCount,
          },
          coinStats: fw.perCoin, distribution: fw.dist, scores,
        };
      } catch (err) { /* fallback bên dưới */ }
    }
    return { tuDB: false, ...DH.stats(), scores: {} };
  }

  async function demDB() {
    const db = FDB();
    if (!db) return null;
    try { await db.init(); return await db.stats(); } catch (err) { return null; }
  }

  function markDirty() {
    if (!root || !root.isConnected) return;
    dirty = true;
  }

  function veHealth() {
    return e("div", { class: "dh-chips" },
      DH.sources().map((s) =>
        e("span", { class: `dh-chip dh-${s.status}`, title: `${s.note || ""} · ${s.msgs || 0} gói` },
          e("i", { class: "dh-dot" }), s.ten, s.msgs ? e("b", {}, " " + (s.msgs > 9999 ? "9k+" : s.msgs)) : null)));
  }

  function veKpi(st) {
    const w = st.whale, l = st.liquidation;
    const netCls = w.netFlow >= 0 ? "dh-up" : "dh-down";
    const mom = Math.round(w.momentum * 100);
    return e("div", { class: "dh-kpis" },
      e("div", { class: "dh-kpi" }, e("div", { class: "dh-kpi-lb" }, `Net flow ${st.windowMin}′`),
        e("div", { class: `dh-kpi-v ${netCls}` }, (w.netFlow >= 0 ? "+$" : "−$") + fmtUsd(Math.abs(w.netFlow)))),
      e("div", { class: "dh-kpi" }, e("div", { class: "dh-kpi-lb" }, "Khối lượng cá mập"),
        e("div", { class: "dh-kpi-v" }, "$" + fmtUsd(w.totalVolume)),
        e("div", { class: "dh-kpi-sub" }, `${fmtNum(w.tradeCount, 0)} lệnh ≥ $${fmtUsd(CFG.whale.minUsd)}`)),
      e("div", { class: "dh-kpi" }, e("div", { class: "dh-kpi-lb" }, "Áp lực mua/bán"),
        e("div", { class: "dh-bar" }, e("i", { style: `width:${mom}%` })),
        e("div", { class: "dh-kpi-sub" }, `Mua ${mom}% · Bán ${100 - mom}%`)),
      e("div", { class: "dh-kpi" }, e("div", { class: "dh-kpi-lb" }, "Thanh lý"),
        e("div", { class: "dh-kpi-v" }, "$" + fmtUsd(l.totalVolume)),
        e("div", { class: "dh-kpi-sub" },
          e("span", { class: "dh-down" }, "Long $" + fmtUsd(l.longVolume)), " · ",
          e("span", { class: "dh-up" }, "Short $" + fmtUsd(l.shortVolume)))));
  }

  function veDist(st) {
    const rows = Object.entries(st.distribution).map(([ten, d]) =>
      e("div", { class: "dh-dist-row" },
        e("span", { class: "dh-dist-lb" }, ten),
        e("div", { class: "dh-bar dh-bar-sm" }, e("i", { style: `width:${d.long}%` })),
        e("span", { class: "dh-dist-v" }, `${d.long}/${d.short} · ${fmtNum(d.count, 0)} lệnh · $${fmtUsd(d.volume)}`)));
    return e("div", { class: "dh-card" }, e("h3", {}, "📐 Phân bổ theo cỡ lệnh"), ...rows);
  }

  function veWhaleTable() {
    // Ưu tiên lịch sử DB (có sẵn nhiều giờ) — live event đã được nạp vào HIST
    const rows = (HIST.ok && HIST.whales.length ? HIST.whales : DH.whales(CFG.ui.rows))
      .slice(0, CFG.ui.rows).map((t) =>
      e("tr", { class: t.side === "BUY" ? "dh-r-up" : "dh-r-down" },
        e("td", {}, gio(t.ts)), e("td", {}, e("b", {}, t.coin)),
        e("td", { class: t.side === "BUY" ? "dh-up" : "dh-down" }, t.side === "BUY" ? "MUA" : "BÁN"),
        e("td", {}, fmtNum(t.price, t.price < 1 ? 5 : 2)),
        e("td", {}, fmtNum(t.qty, 3)),
        e("td", { class: "dh-strong" }, "$" + fmtUsd(t.usd)),
        e("td", { class: "dh-dim" }, t.san)));
    return e("div", { class: "dh-card" },
      e("h3", {}, `🐋 Lệnh lớn real-time — ngưỡng $${fmtUsd(CFG.whale.minUsd)}`),
      e("div", { class: "dh-scroll" }, e("table", { class: "dh-table" },
        e("thead", {}, e("tr", {}, ["Giờ", "Coin", "Chiều", "Giá", "KL", "Giá trị", "Sàn"].map((h) => e("th", {}, h)))),
        e("tbody", {}, rows.length ? rows : e("tr", {}, e("td", { colspan: "7", class: "dh-dim" }, "đang chờ dữ liệu…"))))));
  }

  function veLiqTable() {
    const rows = (HIST.ok && HIST.liqs.length ? HIST.liqs : DH.liqs(20))
      .slice(0, 20).map((t) =>
      e("tr", {},
        e("td", {}, gio(t.ts)), e("td", {}, e("b", {}, t.coin)),
        e("td", { class: t.huong === "LONG" ? "dh-down" : "dh-up" }, t.huong),
        e("td", {}, fmtNum(t.price, t.price < 1 ? 5 : 2)),
        e("td", { class: "dh-strong" }, "$" + fmtUsd(t.usd)),
        e("td", { class: "dh-dim" }, t.san)));
    return e("div", { class: "dh-card" }, e("h3", {}, "💥 Thanh lý"),
      e("div", { class: "dh-scroll" }, e("table", { class: "dh-table" },
        e("thead", {}, e("tr", {}, ["Giờ", "Coin", "Vị thế", "Giá", "Giá trị", "Sàn"].map((h) => e("th", {}, h)))),
        e("tbody", {}, rows.length ? rows : e("tr", {}, e("td", { colspan: "6", class: "dh-dim" }, "chưa có…"))))));
  }

  function vePoly() {
    const rows = DH.polys(15).map((p) =>
      e("tr", {},
        e("td", {}, gio(p.ts)),
        e("td", { class: "dh-title", title: p.title }, p.title),
        e("td", {}, p.outcome || "—"),
        e("td", { class: p.side === "BUY" ? "dh-up" : "dh-down" }, p.side),
        e("td", {}, (p.price * 100).toFixed(1) + "¢"),
        e("td", { class: "dh-strong" }, "$" + fmtUsd(p.usd))));
    return e("div", { class: "dh-card" }, e("h3", {}, "🎲 Polymarket — dòng lệnh dự đoán"),
      e("div", { class: "dh-scroll" }, e("table", { class: "dh-table" },
        e("thead", {}, e("tr", {}, ["Giờ", "Thị trường", "Kết quả", "Chiều", "Giá", "Giá trị"].map((h) => e("th", {}, h)))),
        e("tbody", {}, rows.length ? rows : e("tr", {}, e("td", { colspan: "6", class: "dh-dim" }, "đang chờ…"))))));
  }

  function veCoinFlow(st) {
    const rows = Object.entries(st.coinStats).sort((a, b) => b[1].volume - a[1].volume).map(([c, d]) => {
      const net = d.buy - d.sell;
      const sc = (st.scores && st.scores[c] != null) ? st.scores[c] : DH.flowScore(c);
      return e("tr", {},
        e("td", {}, e("b", {}, c)),
        e("td", {}, "$" + fmtUsd(d.volume)),
        e("td", { class: net >= 0 ? "dh-up" : "dh-down" }, (net >= 0 ? "+$" : "−$") + fmtUsd(Math.abs(net))),
        e("td", {}, fmtNum(d.count, 0)),
        e("td", { class: sc >= 0 ? "dh-up" : "dh-down" }, (sc > 0 ? "+" : "") + sc));
    });
    return e("div", { class: "dh-card" }, e("h3", {}, "🧭 Dòng tiền theo coin (điểm −100…+100 cho engine)"),
      e("table", { class: "dh-table" },
        e("thead", {}, e("tr", {}, ["Coin", "Khối lượng", "Net", "Lệnh", "Điểm"].map((h) => e("th", {}, h)))),
        e("tbody", {}, rows.length ? rows : e("tr", {}, e("td", { colspan: "5", class: "dh-dim" }, "đang gom…")))));
  }

  function veMacro() {
    const m = DH.macro(), etf = DH.etf(), fund = DH.funding(), oi = DH.oi();
    const kids = [];
    if (m.fng) kids.push(e("div", { class: "dh-mini" }, e("span", { class: "dh-kpi-lb" }, "Fear & Greed"),
      e("b", {}, `${m.fng.value} · ${m.fng.nhan}`)));
    for (const [c, f] of Object.entries(fund || {})) {
      const o = (oi || {})[c];
      kids.push(e("div", { class: "dh-mini" },
        e("span", { class: "dh-kpi-lb" }, `${c} · funding`),
        e("b", { class: f.rate >= 0 ? "dh-up" : "dh-down" },
          `${f.rate >= 0 ? "+" : ""}${f.rate.toFixed(4)}%${o ? ` · OI ${fmtNum(o.oi, 0)}` : ""}`)));
    }
    if (etf) kids.push(e("div", { class: "dh-mini" }, e("span", { class: "dh-kpi-lb" }, "ETF flow"),
      e("b", {}, typeof etf.total === "number" ? "$" + fmtUsd(etf.total) : "đã nạp")));
    return kids.length ? e("div", { class: "dh-card dh-macro" }, e("h3", {}, "🌐 Bối cảnh vĩ mô"), ...kids) : null;
  }

  /* ---------- render chính ---------- */
  function veAlerts() {
    if (!HIST.alerts.length) return null;
    return e("div", { class: "dh-card dh-alerts" },
      e("h3", {}, "🔔 Cảnh báo dòng tiền"),
      e("div", { class: "dh-alert-list" },
        HIST.alerts.slice(0, 6).map((a) =>
          e("div", { class: "dh-alert" },
            e("span", { class: "dh-dim" }, gio(a.ts)), " ",
            a.coin ? e("b", {}, a.coin + " ") : null,
            e("span", {}, a.text)))));
  }

  function veDbChip(n) {
    if (!n) return null;
    const tong = n.whales + n.liqs;
    let tram = "";
    if (tramInfo) {
      const cn = tramInfo.capNhat ? new Date(tramInfo.capNhat) : null;
      const gio = cn ? cn.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "—";
      tram = ` · 🛰️ Trạm 24/7: +${fmtNum(tramInfo.them, 0)} sự kiện từ ${(tramInfo.nguon || []).join("+")} (cập nhật ${gio})`;
    }
    return e("p", { class: "dh-dbchip" },
      `💾 Database: ${fmtNum(tong, 0)} sự kiện đã lưu (7 ngày)${tram} · thu thập liên tục — mở màn hình là có sẵn master data.`);
  }

  async function renderDongTien(container) {
    root = container;
    root.innerHTML = "";
    if (!DH.isRunning()) DH.start();
    await napLichSu();
    await mergeTram247(); // trạm 24/7 trước, để stats tính trên master data đầy đủ
    const dl = await doDungLuong();
    const kho = await layTrangThaiKho();
    const st = await layStats();
    const n = await demDB();

    root.append(
      e("div", { class: "dh-wrap" },
        e("div", { class: "dh-head" },
          e("div", {},
            e("h2", {}, "🌊 Dòng tiền Real-time"),
            e("p", { class: "dh-dim" }, "Gom trực tiếp từ Binance · OKX · Bybit · Hyperliquid · Polymarket — không qua server trung gian."),
            veDbChip(n),
            veDungLuong(dl, kho)),
          e("div", { class: "dh-tools" },
            e("label", {}, "Ngưỡng lệnh lớn ",
              e("select", { onchange: (ev) => { DH.setFilter({ minUsd: +ev.target.value }); ve(); } },
                [50e3, 100e3, 250e3, 500e3, 1e6].map((v) =>
                  e("option", { value: v, selected: v === CFG.whale.minUsd ? "selected" : null }, "$" + fmtUsd(v))))),
            e("button", { class: "dh-btn", onclick: () => {
              const blob = new Blob([JSON.stringify(DH.snapshot(), null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob); a.download = `siro-datahub-${Date.now()}.json`; a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            } }, "⬇︎ Xuất snapshot"))),
        veHealth(), veAlerts(), veKpi(st),
        e("div", { class: "dh-grid" }, veWhaleTable(), e("div", { class: "dh-col" }, veLiqTable(), veCoinFlow(st))),
        e("div", { class: "dh-grid" }, vePoly(), e("div", { class: "dh-col" }, veDist(st), veMacro()))));
  }

  function ve() { if (root && root.isConnected) renderDongTien(root); }

  /* Cập nhật tiết chế — chỉ vẽ lại khi màn hình đang mở.
   * Live event đồng thời được nạp vào HIST (lịch sử DB) để bảng luôn đầy. */
  DH.on("whale", (t) => { _napLichSu(HIST.whales, t, 300); markDirty(); });
  DH.on("liq",   (l) => { _napLichSu(HIST.liqs, l, 200); markDirty(); });
  DH.on("poly", markDirty);
  DH.on("stats", markDirty); DH.on("source", markDirty); DH.on("macro", markDirty);
  clearInterval(timer);
  timer = setInterval(() => { if (dirty) { dirty = false; ve(); } }, CFG.ui.rerenderMs);

  global.renderDongTien = renderDongTien;
  global.DataHubUI = { render: renderDongTien, refresh: ve };
})(window);
