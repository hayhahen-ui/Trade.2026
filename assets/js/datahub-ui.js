/* ============================================================
 * Trade.2026 DataHub — MÀN HÌNH "🌊 Dòng tiền" (v2.3.1)
 * Nạp SAU datahub.js. Không phụ thuộc utils.js của Siro.
 *
 * Kiến trúc chống giật lag:
 *  - GHI NGẦM: event live (whale/liq/poly/stats...) chỉ chạm dữ
 *    liệu (HIST RAM + FlowDB tự flush IDB theo buffer) — KHÔNG
 *    đụng DOM, KHÔNG trigger vẽ lại.
 *  - VẼ TIẾT CHẾ: khung vẽ ngay (không bao giờ trắng trang);
 *    tick nhẹ 2s chỉ vá bảng RAM (so key dòng đầu, có mới mới vẽ);
 *    tick vừa 12s refresh KPI/coin-flow từ FlowDB; tick chậm 60s
 *    refresh chip dung lượng/DB/trạm. Dữ liệu đắt (IDB/mạng) có
 *    cache + TTL, không bao giờ đọc trong tick nhẹ.
 *  - Mọi fetch có timeout, mọi bước bọc try/catch.
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
  /* Ngày + giờ VN — dữ liệu ghi có đủ ts, phải hiện cả ngày để không nhầm lẫn.
   * Dùng formatToParts để ra đúng DD/MM HH:MM:SS trên mọi trình duyệt/Node. */
  function _partsVN(ts) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(ts).reduce((o, x) => (o[x.type] = x.value, o), {});
  }
  function ngayGio(ts) {
    const p = _partsVN(ts);
    return `${p.day}/${p.month} ${p.hour}:${p.minute}:${p.second}`;
  }
  const gio = ngayGio; // giữ tên cũ cho các chỗ đang dùng
  const khoangNgay = (list) => {
    if (!list || !list.length) return "";
    const f = (ts) => { const p = _partsVN(ts); return `${p.day}/${p.month}`; };
    return ` · từ ${f(list[list.length - 1].ts)} → ${f(list[0].ts)}`;
  };

  /* ---------- fetch có timeout (chống treo → trắng trang) ---------- */
  async function fetchTimeout(url, ms, opts) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 12000);
    try {
      const r = await fetch(url, { ...(opts || {}), signal: ctl.signal });
      return r;
    } finally { clearTimeout(t); }
  }

  /* ============================================================
   * GHI NGẦM — chỉ chạm dữ liệu, không đụng DOM
   * ============================================================ */
  const FDB = () => global.FlowDB || null;
  const HIST = { alerts: [], ok: false };
  /* Lịch sử 12h: backfill từ 01/01/2026 (mỗi ngày 2 khung 00:00/12:00 giờ VN) */
  const HIST12 = { data: null, meta: null, coin: "BTC", full: false, dangTai: false };
  const TRAM_HIST_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/flow-history-12h.json";
  /* DS: nguồn duy nhất cho 2 bảng — gộp live + DB + "xem toàn bộ".
   * Live event unshift vào đầu; "xem toàn bộ" nối tiếp vào đuôi. */
  const DS = { whales: [], liqs: [] };
  const DS_MAX = 5000;
  const MAC_DINH = { whales: 35, liqs: 20 };
  const hienThi = { whales: MAC_DINH.whales, liqs: MAC_DINH.liqs }; // số dòng đang hiển thị
  const daTaiFull = { whales: false, liqs: false };

  const _keyEv = (t) => [t.ts, t.coin, t.usd, t.san, t.side || t.huong].join("|");
  const thayKey = new Set(); // khử trùng O(1) thay vì some() O(n)
  function _napLichSu(dst, item, max) {
    if (!item) return false;
    const k = _keyEv(item);
    if (thayKey.has(k)) return false;
    thayKey.add(k);
    dst.unshift(item);
    if (dst.length > max) thayKey.delete(_keyEv(dst.pop()));
    return true;
  }
  /* Nối sự kiện cũ vào đuôi (dùng khi "xem toàn bộ" tải dần từ DB) */
  function _themCuoi(dst, item) {
    if (!item || dst.length >= DS_MAX) return false;
    const k = _keyEv(item);
    if (thayKey.has(k)) return false;
    thayKey.add(k);
    dst.push(item);
    return true;
  }

  let dataMoi = false; // cờ: có dữ liệu mới chờ vẽ nhẹ
  function dangKyGhiNgam() {
    if (dangKyGhiNgam._xong) return;
    dangKyGhiNgam._xong = true;
    DH.on("whale", (t) => { if (_napLichSu(DS.whales, t, DS_MAX)) dataMoi = true; });
    DH.on("liq",   (l) => { if (_napLichSu(DS.liqs, l, DS_MAX)) dataMoi = true; });
    DH.on("poly", () => { dataMoi = true; });
    DH.on("stats", () => { dataMoi = true; });
    DH.on("source", () => { dataMoi = true; });
    DH.on("macro", () => { dataMoi = true; });
  }

  /* Merge dữ liệu Trạm 24/7 vào FlowDB — chạy nền, throttle 5'/lần */
  const TRAM_FLOW_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/flow-247.json";
  const TRAM_JOURNAL_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/journal-247.json";
  let tramInfo = null, lanMergeTram = 0;
  const MERGE_TRAM_CACH = 5 * 60e3;
  async function mergeTram247() {
    const db = FDB();
    if (!db) return null;
    if (tramInfo && Date.now() - lanMergeTram < MERGE_TRAM_CACH) return tramInfo;
    try {
      const r = await fetchTimeout(TRAM_FLOW_URL + "?t=" + Date.now(), 15000);
      if (!r.ok) return tramInfo;
      const txt = await r.text();
      const d = JSON.parse(txt);
      if (!d || d.tram !== "flow-247") return tramInfo;
      await db.init();
      const kq = await db.mergeTram(d);
      lanMergeTram = Date.now();
      tramInfo = {
        them: kq.whales + kq.liqs,
        tong: (Array.isArray(d.whales) ? d.whales.length : 0) + (Array.isArray(d.liqs) ? d.liqs.length : 0),
        capNhat: kq.capNhat, nguon: kq.nguon, bytes: txt.length,
        hetBoNho: !!(d.meta && d.meta.hetBoNho), lyDo: d.meta && d.meta.lyDo,
      };
      return tramInfo;
    } catch (err) { return tramInfo; }
  }

  /* Nạp 1 lần khi mở màn hình: lịch sử gần nhất từ DB */
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
      for (const t of w.reverse()) _napLichSu(DS.whales, t, DS_MAX);
      for (const t of l.reverse()) _napLichSu(DS.liqs, t, DS_MAX);
      for (const t of a.reverse()) _napLichSu(HIST.alerts, t, 30);
      HIST.ok = true;
      db.onAlert((al) => { if (_napLichSu(HIST.alerts, al, 30)) dataMoi = true; });
      dataMoi = true;
    } catch (err) { /* fallback: dùng RAM của DataHub */ }
  }

  /* ---------- 📚 Lịch sử 12h từ trạm (nhánh data) ---------- */
  async function napLichSu12h() {
    if (HIST12.data || HIST12.dangTai) return;
    HIST12.dangTai = true;
    try {
      const r = await fetch(TRAM_HIST_URL + "?v=" + Date.now(), { signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      HIST12.data = ((j && j.data) || []).slice().sort((a, b) => b.w - a.w);
      HIST12.meta = (j && j.meta) || {};
    } catch (err) { HIST12.data = []; }
    HIST12.dangTai = false;
    veLichSu12h();
  }

  function veLichSu12h() {
    if (!ui || !ui.tbHist) return;
    const data = HIST12.data || [];
    const coins = [...new Set(data.map((r) => r.coin))];
    if (!coins.includes(HIST12.coin)) HIST12.coin = coins[0] || "BTC";
    ui.histTabs.innerHTML = "";
    for (const c of coins.length ? coins : ["BTC"]) {
      const b = e("button", {
        class: "dh-btn",
        style: "margin:0 4px 4px 0" + (c === HIST12.coin ? ";border-color:#f0b90b;color:#f0b90b" : ""),
      }, c);
      b.onclick = () => { HIST12.coin = c; HIST12.full = false; veLichSu12h(); };
      ui.histTabs.append(b);
    }
    const list = data.filter((r) => r.coin === HIST12.coin);
    const hien = HIST12.full ? list : list.slice(0, 60);
    ui.tbHist.innerHTML = "";
    const frag = document.createDocumentFragment();
    const usd = (v) => (v == null ? "—" : "$" + fmtUsd(v));
    if (!hien.length)
      frag.append(e("tr", {}, e("td", { colspan: "9", class: "dh-dim" },
        HIST12.dangTai ? "đang tải…" : "chưa có dữ liệu (backfill đang chạy)")));
    for (const r of hien) {
      const netW = (r.whaleMua || 0) - (r.whaleBan || 0);
      const netL = (r.liqLong || 0) - (r.liqShort || 0);
      frag.append(e("tr", {},
        e("td", { class: "dh-dim" }, ngayGio(r.w)),
        e("td", { class: "dh-up" }, usd(r.takerMua)),
        e("td", { class: "dh-down" }, usd(r.takerBan)),
        e("td", { class: "dh-up" }, usd(r.whaleMua)),
        e("td", { class: "dh-down" }, usd(r.whaleBan)),
        e("td", { class: netW >= 0 ? "dh-up" : "dh-down" },
          (netW >= 0 ? "+$" : "−$") + fmtUsd(Math.abs(netW))),
        e("td", { class: "dh-up" }, usd(r.liqLong)),
        e("td", { class: "dh-down" }, usd(r.liqShort)),
        e("td", { class: netL >= 0 ? "dh-up" : "dh-down" },
          (netL >= 0 ? "+$" : "−$") + fmtUsd(Math.abs(netL)))));
    }
    ui.tbHist.append(frag);
    const srcTxt = HIST12.meta && HIST12.meta.moTa ? ` · ${HIST12.meta.moTa.split(".")[0]}.` : "";
    ui.capHist.textContent = `Hiện ${hien.length} / ${list.length} khung 12h · ${HIST12.coin}` +
      (HIST12.meta && HIST12.meta.capNhat ? ` · cập nhật ${HIST12.meta.capNhat}` : "") + srcTxt;
    ui.btnFullHist.textContent = HIST12.full ? "🔼 Thu gọn" : `📜 Xem toàn bộ (${list.length} khung)`;
  }

  /* ============================================================
   * CACHE dữ liệu đắt (IDB/mạng) — tick nhẹ không bao giờ đọc
   * ============================================================ */
  const TTL_VUA = 12e3, TTL_CHAM = 60e3;
  const cache = { stats: null, tsStats: 0, db: null, tsDb: 0, dl: null, tsDl: 0, kho: null, tsKho: 0 };

  async function layStats(force) {
    if (!force && cache.stats && Date.now() - cache.tsStats < TTL_VUA) return cache.stats;
    const db = FDB();
    let st = null;
    if (db) {
      try {
        await db.init();
        const fw = await db.flowWindow(CFG.whale.windowMin);
        const scores = {};
        for (const coin of Object.keys(fw.perCoin)) scores[coin] = await db.flowScore(coin);
        st = {
          tuDB: true, windowMin: CFG.whale.windowMin,
          whale: { netFlow: fw.net, totalVolume: fw.volume, tradeCount: fw.count, momentum: fw.volume ? fw.buy / fw.volume : 0.5 },
          liquidation: { totalVolume: fw.liqLong + fw.liqShort, longVolume: fw.liqLong, shortVolume: fw.liqShort, count: fw.liqCount },
          coinStats: fw.perCoin, distribution: fw.dist, scores,
        };
      } catch (err) { /* fallback */ }
    }
    if (!st) st = { tuDB: false, ...DH.stats(), scores: {} };
    cache.stats = st; cache.tsStats = Date.now();
    return st;
  }

  async function demDB(force) {
    if (!force && cache.db && Date.now() - cache.tsDb < TTL_CHAM) return cache.db;
    const db = FDB();
    try { if (db) { await db.init(); cache.db = await db.stats(); } } catch (err) {}
    cache.tsDb = Date.now();
    return cache.db;
  }

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
  async function doDungLuong(force) {
    if (!force && cache.dl && Date.now() - cache.tsDl < TTL_CHAM) return cache.dl;
    const kq = { idb: null, quota: null, ls: doLocalStorage(), journalBytes: null, flowBytes: tramInfo ? tramInfo.bytes : null, tramDay: tramInfo ? !!tramInfo.hetBoNho : false, tramLyDo: tramInfo ? tramInfo.lyDo : "" };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const es = await navigator.storage.estimate();
        kq.idb = es.usage; kq.quota = es.quota;
      }
    } catch (e) {}
    try {
      const r = await fetchTimeout(TRAM_JOURNAL_URL + "?t=" + Date.now(), 10000, { method: "HEAD" });
      const len = r.headers.get("content-length");
      if (len) kq.journalBytes = +len;
    } catch (e) {}
    cache.dl = kq; cache.tsDl = Date.now();
    return kq;
  }
  async function layTrangThaiKho(force) {
    if (!force && cache.kho && Date.now() - cache.tsKho < TTL_CHAM) return cache.kho;
    const db = FDB();
    try { if (db) { await db.init(); cache.kho = db.trangThaiKho(); } } catch (e) {}
    cache.tsKho = Date.now();
    return cache.kho;
  }

  /* ============================================================
   * VẼ KHUNG (đồng bộ, ngay lập tức) + VÁ TĂNG DẦN
   * ============================================================ */
  let root = null, ui = null;
  let timerNhe = null, timerVua = null, timerCham = null;

  function dongWhale(t) {
    return e("tr", { class: t.side === "BUY" ? "dh-r-up" : "dh-r-down" },
      e("td", {}, gio(t.ts)), e("td", {}, e("b", {}, t.coin)),
      e("td", { class: t.side === "BUY" ? "dh-up" : "dh-down" }, t.side === "BUY" ? "MUA" : "BÁN"),
      e("td", {}, fmtNum(t.price, t.price < 1 ? 5 : 2)),
      e("td", {}, fmtNum(t.qty, 3)),
      e("td", { class: "dh-strong" }, "$" + fmtUsd(t.usd)),
      e("td", { class: "dh-dim" }, t.san));
  }
  function dongLiq(t) {
    return e("tr", {},
      e("td", {}, gio(t.ts)), e("td", {}, e("b", {}, t.coin)),
      e("td", { class: t.huong === "LONG" ? "dh-down" : "dh-up" }, t.huong),
      e("td", {}, fmtNum(t.price, t.price < 1 ? 5 : 2)),
      e("td", { class: "dh-strong" }, "$" + fmtUsd(t.usd)),
      e("td", { class: "dh-dim" }, t.san));
  }
  function dongPoly(p) {
    return e("tr", {},
      e("td", {}, gio(p.ts)),
      e("td", { class: "dh-title", title: p.title }, p.title),
      e("td", {}, p.outcome || "—"),
      e("td", { class: p.side === "BUY" ? "dh-up" : "dh-down" }, p.side),
      e("td", {}, (p.price * 100).toFixed(1) + "¢"),
      e("td", { class: "dh-strong" }, "$" + fmtUsd(p.usd)));
  }

  /* Vá tbody tăng dần:
   *  - có dòng mới ở đầu → chỉ prepend bấy nhiêu dòng (không dựng lại);
   *  - user bấm "xem thêm"/"thu gọn" → thêm/bớt dòng ở đuôi cho khớp hienThi;
   *  - chỉ vẽ lại toàn bộ khi không nhận ra key cũ (hiếm). */
  function dongBoSoDong(tbody, list, veDong, maxRows) {
    const mucTieu = Math.min(maxRows, list.length);
    while (tbody.rows.length < mucTieu) {
      const it = list[tbody.rows.length];
      try { tbody.append(veDong(it)); } catch (err) { break; }
    }
    while (tbody.rows.length > mucTieu) tbody.deleteRow(-1);
  }
  function vaTbody(tbody, list, veDong, maxRows, dongTrong) {
    if (!list.length) {
      if (tbody._k !== "") {
        tbody._k = "";
        tbody.innerHTML = "";
        if (dongTrong) tbody.append(dongTrong);
      }
      return;
    }
    const keyMoi = _keyEv(list[0]);
    if (tbody._k === keyMoi) { dongBoSoDong(tbody, list, veDong, maxRows); return; }
    // đếm dòng mới ở đầu so với key cũ
    let moi = 0;
    if (tbody._k) {
      const gioiHan = Math.min(list.length, 200);
      while (moi < gioiHan && _keyEv(list[moi]) !== tbody._k) moi++;
      if (moi >= gioiHan && _keyEv(list[moi] || {}) !== tbody._k) moi = -1;
    }
    if (!tbody._k || moi === -1 || !tbody.rows.length) {
      tbody.innerHTML = "";
      const frag = document.createDocumentFragment();
      const rows = list.slice(0, maxRows);
      for (const it of rows) { try { frag.append(veDong(it)); } catch (err) {} }
      tbody.append(frag);
    } else {
      const frag = document.createDocumentFragment();
      for (let i = moi - 1; i >= 0; i--) { try { frag.append(veDong(list[i])); } catch (err) {} }
      tbody.prepend(frag);
      dongBoSoDong(tbody, list, veDong, maxRows);
    }
    tbody._k = keyMoi;
  }

  function thead(cols) {
    return e("thead", {}, e("tr", {}, cols.map((h) => e("th", {}, h))));
  }

  function veKhung() {
    root.innerHTML = "";
    ui = {};
    const wrap = e("div", { class: "dh-wrap" });

    /* header */
    const headLeft = e("div", {},
      e("h2", {}, "🌊 Dòng tiền Real-time"),
      e("p", { class: "dh-dim" }, "Gom trực tiếp từ Binance · OKX · Bybit · Hyperliquid · Polymarket — không qua server trung gian."),
      ui.chipDb = e("p", { class: "dh-dbchip" }, "💾 Database: đang tải…"),
      ui.chipDl = e("div", { class: "dh-dbchip" }, "💾 Dung lượng: đang đo…"));
    const headRight = e("div", { class: "dh-tools" },
      e("label", {}, "Ngưỡng lệnh lớn ",
        e("select", { onchange: (ev) => { try { DH.setFilter({ minUsd: +ev.target.value }); } catch (err) {} dataMoi = true; tickNhe(); } },
          [50e3, 100e3, 250e3, 500e3, 1e6].map((v) =>
            e("option", { value: v, selected: v === CFG.whale.minUsd ? "selected" : null }, "$" + fmtUsd(v))))),
      e("button", { class: "dh-btn", onclick: () => {
        try {
          const blob = new Blob([JSON.stringify(DH.snapshot(), null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob); a.download = `siro-datahub-${Date.now()}.json`; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        } catch (err) {}
      } }, "⬇︎ Xuất snapshot"));
    wrap.append(e("div", { class: "dh-head" }, headLeft, headRight));

    /* health + alerts */
    ui.health = e("div", { class: "dh-chips" });
    wrap.append(ui.health);
    ui.alerts = e("div", {});
    wrap.append(ui.alerts);

    /* KPI — giữ ref để vá text, không dựng lại */
    ui.kpiNet = e("div", { class: "dh-kpi-v" }, "…");
    ui.kpiNetLb = e("div", { class: "dh-kpi-lb" }, "Net flow …");
    ui.kpiVol = e("div", { class: "dh-kpi-v" }, "…");
    ui.kpiVolSub = e("div", { class: "dh-kpi-sub" }, "…");
    ui.kpiBar = e("i", { style: "width:50%" });
    ui.kpiBarSub = e("div", { class: "dh-kpi-sub" }, "…");
    ui.kpiLiq = e("div", { class: "dh-kpi-v" }, "…");
    ui.kpiLiqSub = e("div", { class: "dh-kpi-sub" }, "…");
    wrap.append(e("div", { class: "dh-kpis" },
      e("div", { class: "dh-kpi" }, ui.kpiNetLb, ui.kpiNet),
      e("div", { class: "dh-kpi" }, e("div", { class: "dh-kpi-lb" }, "Khối lượng cá mập"), ui.kpiVol, ui.kpiVolSub),
      e("div", { class: "dh-kpi" }, e("div", { class: "dh-kpi-lb" }, "Áp lực mua/bán"),
        e("div", { class: "dh-bar" }, ui.kpiBar), ui.kpiBarSub),
      e("div", { class: "dh-kpi" }, e("div", { class: "dh-kpi-lb" }, "Thanh lý"), ui.kpiLiq, ui.kpiLiqSub)));

    /* bảng lệnh lớn + thanh lý */
    ui.tbWhale = e("tbody", {});
    ui.capWhale = e("p", { class: "dh-dim", style: "margin:6px 2px 0;font-size:11px" }, "đang tải…");
    ui.btnFullWhale = e("button", { class: "dh-btn", style: "margin-top:6px", onclick: () => batTatFull("whales") }, "📜 Xem toàn bộ");
    ui.tbLiq = e("tbody", {});
    ui.capLiq = e("p", { class: "dh-dim", style: "margin:6px 2px 0;font-size:11px" }, "đang tải…");
    ui.btnFullLiq = e("button", { class: "dh-btn", style: "margin-top:6px", onclick: () => batTatFull("liqs") }, "📜 Xem toàn bộ");
    ui.tbCoin = e("tbody", {});
    const cardWhale = e("div", { class: "dh-card" },
      e("h3", {}, `🐋 Lệnh lớn real-time — ngưỡng $${fmtUsd(CFG.whale.minUsd)}`),
      e("div", { class: "dh-scroll" }, e("table", { class: "dh-table" },
        thead(["Ngày giờ", "Coin", "Chiều", "Giá", "KL", "Giá trị", "Sàn"]), ui.tbWhale)),
      ui.capWhale, ui.btnFullWhale);
    const cardLiq = e("div", { class: "dh-card" }, e("h3", {}, "💥 Thanh lý"),
      e("div", { class: "dh-scroll" }, e("table", { class: "dh-table" },
        thead(["Ngày giờ", "Coin", "Vị thế", "Giá", "Giá trị", "Sàn"]), ui.tbLiq)),
      ui.capLiq, ui.btnFullLiq);
    const cardCoin = e("div", { class: "dh-card" }, e("h3", {}, "🧭 Dòng tiền theo coin (điểm −100…+100 cho engine)"),
      e("table", { class: "dh-table" },
        thead(["Coin", "Khối lượng", "Net", "Lệnh", "Điểm"]), ui.tbCoin));
    wrap.append(e("div", { class: "dh-grid" }, cardWhale, e("div", { class: "dh-col" }, cardLiq, cardCoin)));

    /* poly + dist + macro */
    ui.tbPoly = e("tbody", {});
    ui.dist = e("div", { class: "dh-card" }, e("h3", {}, "📐 Phân bổ theo cỡ lệnh"));
    ui.macro = e("div", {});
    const cardPoly = e("div", { class: "dh-card" }, e("h3", {}, "🎲 Polymarket — dòng lệnh dự đoán"),
      e("div", { class: "dh-scroll" }, e("table", { class: "dh-table" },
        thead(["Ngày giờ", "Thị trường", "Kết quả", "Chiều", "Giá", "Giá trị"]), ui.tbPoly)));
    wrap.append(e("div", { class: "dh-grid" }, cardPoly, e("div", { class: "dh-col" }, ui.dist, ui.macro)));

    /* 📚 Lịch sử dòng tiền 12h — backfill từ 01/01/2026, mỗi ngày 2 khung */
    ui.histTabs = e("div", { style: "margin-bottom:6px" });
    ui.tbHist = e("tbody", {});
    ui.capHist = e("p", { class: "dh-dim", style: "margin:6px 2px 0;font-size:11px" }, "đang tải lịch sử…");
    ui.btnFullHist = e("button", { class: "dh-btn", style: "margin-top:6px" }, "📜 Xem toàn bộ");
    ui.btnFullHist.onclick = () => { HIST12.full = !HIST12.full; veLichSu12h(); };
    const cardHist = e("div", { class: "dh-card" },
      e("h3", {}, "📚 Lịch sử dòng tiền 12h — từ 01/01/2026"),
      e("p", { class: "dh-dim", style: "font-size:11px;margin:0 0 6px" },
        "Mỗi ngày 2 khung (khung bắt đầu 00:00 và 12:00 giờ VN). Taker/Whale: Binance · Thanh lý: chỉ sàn CoinEx (không phải toàn thị trường) · Từ 28/09/2026: trạm 24/7 (OKX+Hyperliquid, taker = —)."),
      ui.histTabs,
      e("div", { class: "dh-scroll" }, e("table", { class: "dh-table" },
        thead(["Khung bắt đầu", "Taker mua", "Taker bán", "Whale mua", "Whale bán", "Net whale", "TL Long", "TL Short", "Net TL"]), ui.tbHist)),
      ui.capHist, ui.btnFullHist);
    wrap.append(cardHist);

    root.append(wrap);
  }

  /* ---------- các hàm vá từng phần ---------- */
  function manHinhMo() { return root && root.isConnected && !document.hidden; }

  function capNhatChipDb() {
    if (!ui || !ui.chipDb) return;
    const n = cache.db;
    let txt = "💾 Database: ";
    if (n) txt += `${fmtNum(n.whales + n.liqs, 0)} sự kiện đã lưu (7 ngày)`;
    else txt += "đang tải…";
    if (tramInfo) {
      const cn = tramInfo.capNhat ? new Date(tramInfo.capNhat) : null;
      const g = cn ? cn.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "—";
      txt += ` · 🛰️ Trạm 24/7: đã bung ${fmtNum(tramInfo.tong || 0, 0)} sự kiện vào DB (+${fmtNum(tramInfo.them, 0)} mới) · nguồn ${(tramInfo.nguon || []).join("+")} · cập nhật ${g}`;
    }
    txt += " · thu thập liên tục — mở màn hình là có sẵn master data.";
    ui.chipDb.textContent = txt;
  }

  function capNhatDungLuong() {
    if (!ui || !ui.chipDl) return;
    const dl = cache.dl, kho = cache.kho;
    if (!dl) { ui.chipDl.textContent = "💾 Dung lượng: đang đo…"; return; }
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
    ui.chipDl.innerHTML = "";
    ui.chipDl.className = "dh-dbchip" + (canhBao.length || (kho && kho.dungGhi) ? " dh-warn" : "");
    ui.chipDl.append(`💾 Dung lượng: trình duyệt ${idbTxt} · localStorage ${fmtKB(dl.ls)} / ~5MB (${lsPct}%)${tramTxt}.`);
    if (kho && kho.dungGhi) {
      canhBao.push(`database dòng tiền ⏸ đã dừng ghi (${kho.lyDo})`);
      const btn = e("button", { class: "dh-btn", onclick: async () => {
        if (!confirm("Xóa sự kiện dòng tiền cũ hơn 7 ngày để giải phóng bộ nhớ? (Chỉ xóa khi bạn đồng ý)")) return;
        const db = FDB();
        if (db) { try { await db.init(); await db.donDep(7); } catch (err) {} }
        cache.tsDb = 0; dataMoi = true; lamMoiCham();
      } }, "🗑 Dọn dữ liệu cũ hơn 7 ngày");
      ui.chipDl.append(e("div", { style: "margin-top:4px" }, btn));
    }
    if (canhBao.length)
      ui.chipDl.append(e("div", { style: "margin-top:4px" }, `⚠️ ${canhBao.join(" · ")} — tôi không tự xóa, bạn dọn xong hệ thống sẽ ghi tiếp.`));
  }

  function capNhatHealth() {
    if (!ui || !ui.health) return;
    ui.health.innerHTML = "";
    try {
      for (const s of DH.sources()) {
        ui.health.append(e("span", { class: `dh-chip dh-${s.status}`, title: `${s.note || ""} · ${s.msgs || 0} gói` },
          e("i", { class: "dh-dot" }), s.ten, s.msgs ? e("b", {}, " " + (s.msgs > 9999 ? "9k+" : s.msgs)) : null));
      }
    } catch (err) {}
  }

  function capNhatAlerts() {
    if (!ui || !ui.alerts) return;
    ui.alerts.innerHTML = "";
    if (!HIST.alerts.length) return;
    const list = e("div", { class: "dh-alert-list" });
    for (const a of HIST.alerts.slice(0, 6)) {
      try {
        list.append(e("div", { class: "dh-alert" },
          e("span", { class: "dh-dim" }, gio(a.ts)), " ",
          a.coin ? e("b", {}, a.coin + " ") : null,
          e("span", {}, a.text)));
      } catch (err) {}
    }
    ui.alerts.append(e("div", { class: "dh-card dh-alerts" }, e("h3", {}, "🔔 Cảnh báo dòng tiền"), list));
  }

  function capNhatKpi(st) {
    if (!ui || !st) return;
    try {
      const w = st.whale, l = st.liquidation;
      ui.kpiNetLb.textContent = `Net flow ${st.windowMin || CFG.whale.windowMin}′`;
      ui.kpiNet.className = "dh-kpi-v " + (w.netFlow >= 0 ? "dh-up" : "dh-down");
      ui.kpiNet.textContent = (w.netFlow >= 0 ? "+$" : "−$") + fmtUsd(Math.abs(w.netFlow));
      ui.kpiVol.textContent = "$" + fmtUsd(w.totalVolume);
      ui.kpiVolSub.textContent = `${fmtNum(w.tradeCount, 0)} lệnh ≥ $${fmtUsd(CFG.whale.minUsd)}`;
      const mom = Math.round(w.momentum * 100);
      ui.kpiBar.style.width = mom + "%";
      ui.kpiBarSub.textContent = `Mua ${mom}% · Bán ${100 - mom}%`;
      ui.kpiLiq.textContent = "$" + fmtUsd(l.totalVolume);
      ui.kpiLiqSub.innerHTML = "";
      ui.kpiLiqSub.append(
        e("span", { class: "dh-down" }, "Long $" + fmtUsd(l.longVolume)), " · ",
        e("span", { class: "dh-up" }, "Short $" + fmtUsd(l.shortVolume)));
    } catch (err) {}
  }

  function capNhatBang() {
    if (!ui) return;
    const whales = DS.whales.length ? DS.whales : DH.whales(CFG.ui.rows);
    vaTbody(ui.tbWhale, whales, dongWhale, hienThi.whales,
      e("tr", {}, e("td", { colspan: "7", class: "dh-dim" }, "đang chờ dữ liệu…")));
    const liqs = DS.liqs.length ? DS.liqs : DH.liqs(20);
    vaTbody(ui.tbLiq, liqs, dongLiq, hienThi.liqs,
      e("tr", {}, e("td", { colspan: "6", class: "dh-dim" }, "chưa có…")));
    let polys = [];
    try { polys = DH.polys(15); } catch (err) {}
    vaTbody(ui.tbPoly, polys, dongPoly, 15,
      e("tr", {}, e("td", { colspan: "6", class: "dh-dim" }, "đang chờ…")));
    if (ui.capWhale) ui.capWhale.textContent =
      `Hiện ${fmtNum(Math.min(whales.length, hienThi.whales), 0)} / ${fmtNum(DS.whales.length, 0)} sự kiện${khoangNgay(DS.whales)} · đã bung master data trạm 24/7 vào bảng.`;
    if (ui.capLiq) ui.capLiq.textContent =
      `Hiện ${fmtNum(Math.min(liqs.length, hienThi.liqs), 0)} / ${fmtNum(DS.liqs.length, 0)} sự kiện${khoangNgay(DS.liqs)} · đã bung master data trạm 24/7 vào bảng.`;
  }

  /* ---------- Xem toàn bộ master data đã lưu ----------
   * Tải dần từ IndexedDB theo con trỏ ts (500/chunk, nhường UI giữa
   * các chunk), nối vào đuôi DS — bảng hiện dần, không giật. */
  function capNhatNutFull() {
    if (!ui) return;
    const n = cache.db;
    nutFull(ui.btnFullWhale, "whales", n ? n.whales : null, "lệnh lớn");
    nutFull(ui.btnFullLiq, "liqs", n ? n.liqs : null, "thanh lý");
  }
  function nutFull(btn, loai, tong, ten) {
    if (!btn) return;
    if (taiToanBo._dang === loai) { btn.disabled = true; btn.textContent = `⏳ Đang tải… (${fmtNum(DS[loai].length, 0)})`; return; }
    btn.disabled = false;
    btn.textContent = hienThi[loai] > MAC_DINH[loai] ? "🔼 Thu gọn"
      : `📜 Xem toàn bộ${tong != null ? ` (${fmtNum(tong, 0)} ${ten})` : ""}`;
  }
  async function batTatFull(loai) {
    if (taiToanBo._dang) return;
    if (daTaiFull[loai]) {
      // đã có full trong RAM — chỉ mở rộng / thu gọn hiển thị
      hienThi[loai] = hienThi[loai] > MAC_DINH[loai] ? MAC_DINH[loai] : DS[loai].length;
      capNhatNutFull(); dataMoi = true; tickNhe();
      return;
    }
    taiToanBo(loai);
  }
  async function taiToanBo(loai) {
    const db = FDB();
    if (!db || taiToanBo._dang) return;
    taiToanBo._dang = loai;
    capNhatNutFull();
    try {
      await db.init();
      const dst = DS[loai];
      const fn = loai === "whales" ? "recentWhales" : "recentLiqs";
      for (let vong = 0; vong < 40; vong++) {
        const cuNhat = dst.length ? dst[dst.length - 1].ts : Date.now();
        let chunk = [];
        try { chunk = await db[fn]({ limit: 500, to: cuNhat }); } catch (err) { break; }
        if (!chunk.length) break;
        for (const it of chunk) _themCuoi(dst, it);
        hienThi[loai] = dst.length;
        nutFull(loai === "whales" ? ui.btnFullWhale : ui.btnFullLiq, loai, null, "");
        dataMoi = true; tickNhe();
        if (chunk.length < 500) break;
        await new Promise((r) => setTimeout(r, 0)); // nhường UI giữa các chunk
      }
      daTaiFull[loai] = true;
    } finally {
      taiToanBo._dang = null;
      capNhatNutFull(); dataMoi = true; tickNhe();
    }
  }

  function capNhatCoinFlow(st) {
    if (!ui || !st) return;
    try {
      ui.tbCoin.innerHTML = "";
      const frag = document.createDocumentFragment();
      const rows = Object.entries(st.coinStats || {}).sort((a, b) => b[1].volume - a[1].volume);
      if (!rows.length) frag.append(e("tr", {}, e("td", { colspan: "5", class: "dh-dim" }, "đang gom…")));
      for (const [c, d] of rows) {
        const net = d.buy - d.sell;
        const sc = (st.scores && st.scores[c] != null) ? st.scores[c] : DH.flowScore(c);
        frag.append(e("tr", {},
          e("td", {}, e("b", {}, c)),
          e("td", {}, "$" + fmtUsd(d.volume)),
          e("td", { class: net >= 0 ? "dh-up" : "dh-down" }, (net >= 0 ? "+$" : "−$") + fmtUsd(Math.abs(net))),
          e("td", {}, fmtNum(d.count, 0)),
          e("td", { class: sc >= 0 ? "dh-up" : "dh-down" }, (sc > 0 ? "+" : "") + sc)));
      }
      ui.tbCoin.append(frag);
      /* phân bổ */
      ui.dist.innerHTML = "";
      ui.dist.append(e("h3", {}, "📐 Phân bổ theo cỡ lệnh"));
      for (const [ten, d] of Object.entries(st.distribution || {})) {
        ui.dist.append(e("div", { class: "dh-dist-row" },
          e("span", { class: "dh-dist-lb" }, ten),
          e("div", { class: "dh-bar dh-bar-sm" }, e("i", { style: `width:${d.long}%` })),
          e("span", { class: "dh-dist-v" }, `${d.long}/${d.short} · ${fmtNum(d.count, 0)} lệnh · $${fmtUsd(d.volume)}`)));
      }
    } catch (err) {}
  }

  function capNhatMacro() {
    if (!ui) return;
    try {
      const m = DH.macro(), etf = DH.etf(), fund = DH.funding(), oi = DH.oi();
      ui.macro.innerHTML = "";
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
      if (kids.length) ui.macro.append(e("div", { class: "dh-card dh-macro" }, e("h3", {}, "🌐 Bối cảnh vĩ mô"), ...kids));
    } catch (err) {}
  }

  /* ---------- 3 vòng tick ---------- */
  // Nhẹ 2s: RAM → vá bảng/health/alerts (rẻ, không IDB/mạng)
  function tickNhe() {
    if (!manHinhMo() || !ui) return;
    if (!dataMoi) return;
    dataMoi = false;
    try {
      capNhatBang();
      capNhatHealth();
      capNhatAlerts();
      if (cache.stats) capNhatKpi(cache.stats); // KPI từ lần đọc FlowDB gần nhất
    } catch (err) {}
  }
  // Vừa 12s: FlowDB → KPI/coin-flow/dist
  async function tickVua() {
    if (!manHinhMo() || !ui) return;
    try {
      const st = await layStats(true);
      if (!manHinhMo()) return;
      capNhatKpi(st);
      capNhatCoinFlow(st);
    } catch (err) {}
  }
  // Chậm 60s: chip DB/dung lượng/kho + merge trạm + macro
  async function lamMoiCham() {
    if (!ui) return;
    try { await mergeTram247(); } catch (err) {}
    try {
      await Promise.all([demDB(true), doDungLuong(true), layTrangThaiKho(true)]);
    } catch (err) {}
    if (!manHinhMo()) return;
    try { capNhatChipDb(); capNhatDungLuong(); capNhatMacro(); capNhatNutFull(); dataMoi = true; tickNhe(); } catch (err) {}
  }

  function khoiDongTimer() {
    clearInterval(timerNhe); clearInterval(timerVua); clearInterval(timerCham);
    timerNhe = setInterval(tickNhe, 2000);
    timerVua = setInterval(tickVua, 12000);
    timerCham = setInterval(lamMoiCham, 60000);
  }

  /* Nạp nền sau khi khung đã vẽ: không block, không trắng trang */
  async function napNen() {
    try { await mergeTram247(); } catch (err) {}
    try { await napLichSu(); } catch (err) {}
    napLichSu12h(); // không await — chạy nền, có dữ liệu thì tự vẽ
    dataMoi = true; tickNhe();
    lamMoiCham(); // không await — chạy nền
    tickVua();    // không await — chạy nền
  }

  /* ---------- render chính ---------- */
  async function renderDongTien(container) {
    try {
      root = container;
      clearInterval(timerNhe); clearInterval(timerVua); clearInterval(timerCham);
      if (!DH.isRunning()) DH.start();
      dangKyGhiNgam();
      veKhung();       // vẽ khung NGAY — không chờ mạng/DB
      khoiDongTimer();
      napNen();        // nạp dữ liệu nền
    } catch (err) {
      try {
        root.innerHTML = "";
        root.append(e("div", { class: "dh-card" }, e("h3", {}, "⚠️ Không tải được màn hình Dòng tiền"),
          e("p", { class: "dh-dim" }, String((err && err.message) || err))));
      } catch (e2) {}
    }
  }

  global.renderDongTien = renderDongTien;
  global.DataHubUI = {
    render: renderDongTien,
    refresh: () => { dataMoi = true; cache.tsStats = 0; cache.tsDb = 0; cache.tsDl = 0; tickNhe(); tickVua(); lamMoiCham(); },
  };
})(window);
