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
    const rows = DH.whales(CFG.ui.rows).map((t) =>
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
    const rows = DH.liqs(20).map((t) =>
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
      const net = d.buy - d.sell, sc = DH.flowScore(c);
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
  function renderDongTien(container) {
    root = container;
    root.innerHTML = "";
    if (!DH.isRunning()) DH.start();
    const st = DH.stats();

    root.append(
      e("div", { class: "dh-wrap" },
        e("div", { class: "dh-head" },
          e("div", {},
            e("h2", {}, "🌊 Dòng tiền Real-time"),
            e("p", { class: "dh-dim" }, "Gom trực tiếp từ Binance · OKX · Bybit · Hyperliquid · Polymarket — không qua server trung gian.")),
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
        veHealth(), veKpi(st),
        e("div", { class: "dh-grid" }, veWhaleTable(), e("div", { class: "dh-col" }, veLiqTable(), veCoinFlow(st))),
        e("div", { class: "dh-grid" }, vePoly(), e("div", { class: "dh-col" }, veDist(st), veMacro()))));
  }

  function ve() { if (root && root.isConnected) renderDongTien(root); }

  /* Cập nhật tiết chế — chỉ vẽ lại khi màn hình đang mở */
  DH.on("whale", markDirty); DH.on("liq", markDirty); DH.on("poly", markDirty);
  DH.on("stats", markDirty); DH.on("source", markDirty); DH.on("macro", markDirty);
  clearInterval(timer);
  timer = setInterval(() => { if (dirty) { dirty = false; ve(); } }, CFG.ui.rerenderMs);

  global.renderDongTien = renderDongTien;
  global.DataHubUI = { render: renderDongTien, refresh: ve };
})(window);
