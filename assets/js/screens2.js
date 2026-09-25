/* ============================================================
 * Trade.2026 — Màn hình 4-7: Radar Cá Mập · Bot · Lịch kinh tế · Kiến thức + Cài đặt
 * ============================================================ */
"use strict";

/* ================= RADAR CÁ MẬP ================= */
let WHALE_COIN = "BTC";
function renderCaMap(root) {
  root.innerHTML = "";
  const bar = el("div", { class: "toolbar" });
  const sel = el("select", { class: "input", onchange: (e) => { WHALE_COIN = e.target.value; renderCaMap(root); } });
  for (const c of SETTINGS.watchlist) sel.appendChild(el("option", { value: c, ...(c === WHALE_COIN ? { selected: "" } : {}) }, `${c}-USDT-SWAP`));
  bar.appendChild(el("label", { class: "muted small" }, "Hợp đồng: "));
  bar.appendChild(sel);
  bar.appendChild(el("button", { class: "btn", onclick: () => capNhatWhale(true) }, "🔄 Quét radar"));
  root.appendChild(bar);

  const grid = el("div", { class: "whale-grid" });
  grid.appendChild(el("div", { class: "card", id: "whale-score-card" },
    el("div", { class: "card-title" }, `🐋 Whale Score — ${WHALE_COIN}`),
    el("p", { class: "muted" }, "Đang quét dòng tiền cá mập trên OKX…")));
  grid.appendChild(el("div", { class: "card", id: "whale-trades-card" },
    el("div", { class: "card-title" }, "💥 Lệnh lớn gần nhất (≥ $100K)"),
    el("p", { class: "muted" }, "Đang tải…")));
  root.appendChild(grid);
  root.appendChild(el("p", { class: "muted small" },
    "Nguồn: OKX Rubik (top trader, taker, OI, funding, thanh lý) + sổ lệnh Binance. Cơ chế trong mindmap: Futures điều khiển Spot qua thanh lý — radar soi dấu chân trước khi giá chạy. Score ≥ +10 thiên MUA, ≤ −10 thiên BÁN."));
  capNhatWhale();
}

async function capNhatWhale(force = false) {
  const cardScore = $("#whale-score-card");
  if (!cardScore) return;
  const cu = WHALE_CACHE.get(WHALE_COIN);
  if (!force && cu && Date.now() - cu.at < 120e3) { veWhale(cu); veLenhLon(); return; }
  try {
    const w = await tinhWhaleScore(WHALE_COIN);
    WHALE_CACHE.set(WHALE_COIN, w);
    veWhale(w);
  } catch (e) {
    cardScore.appendChild(el("p", { class: "down" }, "Lỗi radar: " + (e.message || e)));
  }
  veLenhLon();
}

function veWhale(w) {
  const card = $("#whale-score-card");
  if (!card || w.coin !== WHALE_COIN) return;
  card.innerHTML = "";
  card.appendChild(el("div", { class: "card-title" }, `🐋 Whale Score — ${w.coin} · ${fmtGio(w.at)}`));
  const cls = w.score >= 10 ? "long" : w.score <= -10 ? "short" : "neutral";
  card.appendChild(el("div", { class: `whale-score ${cls}` }, String(w.score > 0 ? "+" + w.score : w.score)));
  card.appendChild(el("div", { class: `verdict ${cls}` }, w.nhan));
  // thanh gauge
  const g = el("div", { class: "gauge" }, el("div", { class: "gauge-pin", style: `left:${(w.score + 100) / 2}%` }));
  card.appendChild(g);
  card.appendChild(el("div", { class: "gauge-labels" }, el("span", { class: "down" }, "-100 BÁN"), el("span", {}, "0"), el("span", { class: "up" }, "+100 MUA")));
  const tbl = el("table", { class: "mini-table" });
  tbl.appendChild(el("tr", {}, el("th", { class: "left" }, "Thành phần"), el("th", {}, "Điểm"), el("th", { class: "left" }, "Chi tiết")));
  for (const p of w.parts) {
    tbl.appendChild(el("tr", {},
      el("td", { class: "left" }, p.ten),
      el("td", { class: "mono " + (p.diem > 0 ? "up" : p.diem < 0 ? "down" : "muted") }, `${p.diem > 0 ? "+" : ""}${p.diem}/${p.max}`),
      el("td", { class: "left small muted" }, p.ghiChu || "")));
  }
  card.appendChild(tbl);
}

async function veLenhLon() {
  const card = $("#whale-trades-card");
  if (!card) return;
  const trades = await fetchLenhLon(WHALE_COIN);
  card.innerHTML = "";
  card.appendChild(el("div", { class: "card-title" }, `💥 Lệnh lớn ${WHALE_COIN} (≥ $100K, OKX Swap)`));
  if (!trades.length) { card.appendChild(el("p", { class: "muted" }, "Chưa ghi nhận lệnh ≥ $100K trong 200 giao dịch gần nhất.")); return; }
  const tbl = el("table", { class: "mini-table" });
  tbl.appendChild(el("tr", {}, el("th", {}, "Giờ"), el("th", {}, "Phía"), el("th", {}, "Giá"), el("th", {}, "Giá trị")));
  for (const t of trades) {
    tbl.appendChild(el("tr", {},
      el("td", { class: "mono" }, fmtGio(t.ts)),
      el("td", { class: t.side === "buy" ? "up" : "down" }, t.side === "buy" ? "MUA" : "BÁN"),
      el("td", { class: "mono" }, fmtGia(t.gia)),
      el("td", { class: "mono strong" }, fmtUsd(t.usd))));
  }
  card.appendChild(tbl);
}

/* ================= BOT ================= */
function renderBot(root) {
  root.innerHTML = "";
  const bot = PAPER_BOT;
  const tk = bot.thongKe();

  root.appendChild(el("div", { class: "note-box" },
    "🤖 Bot chạy chế độ ", el("b", {}, "PAPER TRADING"), " — dữ liệu & tín hiệu THẬT, lệnh ẢO để kiểm chứng hệ thống an toàn. ",
    "Đặt lệnh thật trên sàn từ trang tĩnh bị chặn CORS/bảo mật — đúng nguyên tắc của Mr.Bit: mọi lệnh thật do chính bạn xác nhận trên sàn theo kế hoạch bot đề xuất."));

  // Thẻ thống kê
  const stats = el("div", { class: "stat-row" },
    theStat("Vốn ảo", fmtUsd(tk.balance)),
    theStat("Equity", fmtUsd(tk.equity), tk.equity >= tk.balance ? "up" : "down"),
    theStat("PnL mở", fmtUsd(tk.pnlMo), tk.pnlMo >= 0 ? "up" : "down"),
    theStat("Số lệnh", `${tk.soLenh} (${tk.thang}W/${tk.thua}L)`),
    theStat("Win rate", tk.winRate + "%", tk.winRate >= 50 ? "up" : "down"),
    theStat("R trung bình", (tk.avgR >= 0 ? "+" : "") + tk.avgR + "R", tk.avgR >= 0 ? "up" : "down"),
  );
  root.appendChild(stats);

  // Điều khiển
  const dk = el("div", { class: "toolbar" },
    el("button", { class: "btn " + (bot.config.enabled ? "danger" : "primary"), onclick: () => { bot.config.enabled ? bot.stop() : bot.start(); renderBot(root); } },
      bot.config.enabled ? "⏹ Dừng bot" : "▶ Chạy bot"),
    el("button", { class: "btn", onclick: () => { bot.tick(); } }, "⚡ Quét ngay"),
    el("button", { class: "btn", onclick: () => { bot.dongTatCa(); renderBot(root); } }, "Đóng tất cả vị thế"),
    el("button", { class: "btn", onclick: () => bot.xuatCSV() }, "⬇ Xuất CSV"),
    el("button", { class: "btn danger-line", onclick: () => { if (confirm("Reset vốn ảo và lịch sử?")) { bot.resetVon(); renderBot(root); } } }, "♻ Reset vốn"),
  );
  root.appendChild(dk);
  if (bot.state.circuitTripped) root.appendChild(el("div", { class: "warn-box" }, `⛔ NGẮT MẠCH đang bật — lỗ ngày vượt ${bot.config.loNgayMaxPct}%. Bot nghỉ tới hết ngày (đúng kỷ luật: dừng khi lỗ 3–5%/ngày).`));

  const grid = el("div", { class: "bot-grid" });

  // Cấu hình kỷ luật
  const cfg = el("div", { class: "card" }, el("div", { class: "card-title" }, "⚙️ Kỷ luật giao dịch"));
  const f = (nhan, key, min, max, step, donVi = "") => el("div", { class: "kv" },
    el("span", {}, nhan),
    el("span", {},
      el("input", {
        class: "input num", type: "number", value: String(bot.config[key]), min: String(min), max: String(max), step: String(step),
        onchange: (e) => { bot.config[key] = clamp(+e.target.value, min, max); bot._save(); },
      }), donVi));
  cfg.appendChild(f("Risk mỗi lệnh (%)", "riskPct", 0.1, SETTINGS.risk.riskPctMax, 0.1));
  cfg.appendChild(f("Điểm tối thiểu vào lệnh", "minScore", 50, 100, 5, "đ"));
  cfg.appendChild(f("R:R tối thiểu", "minRR", 1, 5, 0.5));
  cfg.appendChild(f("Vị thế đồng thời tối đa", "maxViThe", 1, 10, 1));
  cfg.appendChild(f("Ngắt mạch lỗ ngày (%)", "loNgayMaxPct", 1, 10, 0.5));
  cfg.appendChild(f("Cooldown mỗi coin (phút)", "cooldownPhut", 0, 240, 5));
  const chk = (nhan, key) => el("label", { class: "chk-line" },
    el("input", { type: "checkbox", ...(bot.config[key] ? { checked: "" } : {}), onchange: (e) => { bot.config[key] = e.target.checked; bot._save(); } }),
    " " + nhan);
  cfg.appendChild(chk("Cho phép LONG", "allowLong"));
  cfg.appendChild(chk("Cho phép SHORT", "allowShort"));
  cfg.appendChild(chk("Chỉ trade trong killzone / giờ vàng", "chiKillzone"));
  cfg.appendChild(chk("Né tin ★★★ ±30 phút (lịch kinh tế)", "neTin3Sao"));
  cfg.appendChild(chk("Dòng tiền đa sàn phải không ngược (DataHub)", "xacNhanDongTien"));
  cfg.appendChild(chk("Yêu cầu Radar Cá Mập đồng thuận", "whaleXacNhan"));
  cfg.appendChild(chk("Dời SL về hòa vốn khi +1R", "doiSLveBE"));
  grid.appendChild(cfg);

  // Vị thế + equity
  const posCard = el("div", { class: "card" }, el("div", { class: "card-title" }, "📌 Vị thế đang mở"), el("div", { id: "bot-positions" }));
  posCard.appendChild(el("div", { class: "card-title", style: "margin-top:14px" }, "📈 Đường vốn (equity)"));
  posCard.appendChild(el("canvas", { id: "equity-canvas", width: "560", height: "150" }));
  grid.appendChild(posCard);
  root.appendChild(grid);

  // Log + lịch sử
  const grid2 = el("div", { class: "bot-grid" });
  grid2.appendChild(el("div", { class: "card" }, el("div", { class: "card-title" }, "🧾 Nhật ký bot"), el("div", { class: "log-box", id: "bot-logs" })));
  grid2.appendChild(el("div", { class: "card" }, el("div", { class: "card-title" }, "📚 Lịch sử lệnh"), el("div", { id: "bot-history" })));
  root.appendChild(grid2);

  veBotPositions(); veBotLogs(); veBotHistory(); veEquity();
}
function theStat(nhan, giaTri, cls = "") {
  return el("div", { class: "card stat" }, el("div", { class: "stat-label" }, nhan), el("div", { class: "stat-value " + cls }, giaTri));
}
function veBotPositions() {
  const box = $("#bot-positions");
  if (!box) return;
  box.innerHTML = "";
  const ps = PAPER_BOT.state.positions;
  if (!ps.length) { box.appendChild(el("p", { class: "muted" }, "Không có vị thế mở. Bot chờ setup đạt chuẩn (điểm ≥ " + PAPER_BOT.config.minScore + ").")); return; }
  const tbl = el("table", { class: "mini-table" });
  tbl.appendChild(el("tr", {}, el("th", {}, "Coin"), el("th", {}, "Phía"), el("th", {}, "Sàn"), el("th", {}, "Entry"), el("th", {}, "Giá"), el("th", {}, "SL"), el("th", {}, "TP"), el("th", {}, "PnL"), el("th", {}, "")));
  for (const p of ps) {
    const gia = PRICE_HUB?.prices?.[p.san || "BINANCE"]?.[p.coin]?.gia ?? PRICE_HUB?.gia(p.coin) ?? p.entry;
    const pnl = (p.side === "long" ? gia - p.entry : p.entry - gia) * p.qty;
    tbl.appendChild(el("tr", {},
      el("td", { class: "strong" }, `${p.nguon === "tay" ? "🖐" : "🤖"} ${p.coin}`),
      el("td", { class: p.side === "long" ? "up" : "down" }, p.side.toUpperCase() + (p.lev ? ` x${p.lev}` : "")),
      el("td", { class: "small" }, (p.san || "BINANCE").slice(0, 3) + (p.mode ? `·${p.mode === "isolated" ? "iso" : "cross"}` : "")),
      el("td", { class: "mono" }, fmtGia(p.entry)),
      el("td", { class: "mono" }, fmtGia(gia)),
      el("td", { class: "mono" }, fmtGia(p.sl) + (p.beDaDoi ? " (BE)" : "")),
      el("td", { class: "mono" }, fmtGia(p.tp)),
      el("td", { class: "mono " + (pnl >= 0 ? "up" : "down") }, fmtUsd(pnl)),
      el("td", {}, el("button", { class: "btn small", onclick: () => { PAPER_BOT.dongLenh(p, gia, "Đóng tay"); } }, "Đóng")),
    ));
  }
  box.appendChild(tbl);
}
function veBotLogs() {
  const box = $("#bot-logs");
  if (!box) return;
  box.innerHTML = "";
  for (const l of PAPER_BOT.state.logs.slice(0, 60)) {
    box.appendChild(el("div", { class: "log-line " + l.loai }, el("span", { class: "mono muted" }, fmtGio(l.t) + " "), l.msg));
  }
  if (!PAPER_BOT.state.logs.length) box.appendChild(el("p", { class: "muted" }, "Chưa có hoạt động."));
}
function veBotHistory() {
  const box = $("#bot-history");
  if (!box) return;
  box.innerHTML = "";
  const h = PAPER_BOT.state.history.slice(0, 30);
  if (!h.length) { box.appendChild(el("p", { class: "muted" }, "Chưa có lệnh đóng.")); return; }
  const tbl = el("table", { class: "mini-table" });
  tbl.appendChild(el("tr", {}, el("th", {}, "Coin"), el("th", {}, "Phía"), el("th", {}, "Entry→Thoát"), el("th", {}, "PnL"), el("th", {}, "R"), el("th", {}, "Lý do")));
  for (const x of h) {
    tbl.appendChild(el("tr", {},
      el("td", { class: "strong" }, x.coin),
      el("td", { class: x.side === "long" ? "up" : "down" }, x.side.toUpperCase()),
      el("td", { class: "mono small" }, `${fmtGia(x.entry)}→${fmtGia(x.giaThoat)}`),
      el("td", { class: "mono " + (x.pnl >= 0 ? "up" : "down") }, fmtUsd(x.pnl)),
      el("td", { class: "mono " + (x.rQuy >= 0 ? "up" : "down") }, (x.rQuy >= 0 ? "+" : "") + x.rQuy + "R"),
      el("td", { class: "small" }, x.lyDo)));
  }
  box.appendChild(tbl);
}
function veEquity() {
  const cv = $("#equity-canvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const data = PAPER_BOT.state.equityCurve;
  if (data.length < 2) { ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.font = "12px sans-serif"; ctx.fillText("Chưa đủ dữ liệu — chạy bot để vẽ đường vốn", 14, H / 2); return; }
  let lo = Math.min(...data.map(d => d.v)), hi = Math.max(...data.map(d => d.v));
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  ctx.strokeStyle = "#f5b301"; ctx.lineWidth = 2; ctx.beginPath();
  data.forEach((d, i) => {
    const x = i / (data.length - 1) * (W - 10) + 5;
    const y = H - 10 - (d.v - lo) / (hi - lo) * (H - 20);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "10px JetBrains Mono, monospace";
  ctx.fillText(fmtUsd(hi - pad), 6, 12); ctx.fillText(fmtUsd(lo + pad), 6, H - 4);
}

/* ================= LỊCH KINH TẾ ================= */
let CAL_TAB = "phantich";
let CAL_MIN_IMP = 2;
function renderLich(root) {
  root.innerHTML = "";
  const tabs = el("div", { class: "tabs" },
    tabBtn("phantich", "🧠 Phân tích tác động"),
    tabBtn("bang", "📋 Bảng dữ liệu"),
    tabBtn("iframe", "📅 Lịch TE trực tiếp"),
    tabBtn("widget", "🛟 Widget dự phòng"),
  );
  root.appendChild(tabs);
  root.appendChild(el("div", { id: "cal-nguon" }));
  const body = el("div", { id: "cal-body" });
  root.appendChild(body);
  veCalTab(body);

  function tabBtn(id, nhan) {
    return el("button", { class: "tab " + (CAL_TAB === id ? "active" : ""), onclick: () => { CAL_TAB = id; renderLich(root); } }, nhan);
  }
}

/* Thanh trạng thái nguồn + nút nạp/làm mới */
function veCalNguonBar() {
  const bar = $("#cal-nguon");
  if (!bar) return;
  bar.innerHTML = "";
  const inp = el("input", { type: "file", accept: ".json,application/json", style: "display:none" });
  inp.addEventListener("change", () => {
    const f = inp.files?.[0];
    if (!f) return;
    napFileJson(f, (err) => {
      if (err) { alert("Lỗi nạp file: " + err.message); return; }
      taiLichKinhTe(true).then(() => renderLich($("#screen-root")));
    });
  });
  const items = [];
  if (CAL.rows.length) {
    const tuoiMs = Date.now() - (CAL.generatedAt || Date.now());
    const tuoi = tuoiMs > 3600e3 ? Math.round(tuoiMs / 3600e3) + " giờ trước" : Math.max(1, Math.round(tuoiMs / 60e3)) + " phút trước";
    items.push(el("span", { class: "small" }, `Nguồn: ${CAL.nguon} · ${CAL.rows.length} sự kiện · cập nhật ${tuoi}`));
    // FIX v2.0: lịch quá cũ → cảnh báo rõ + ghi chú bot/cố vấn đã TẮT chặn tin tự động
    if (!lichConTuoi()) items.push(el("span", { class: "small down" }, " ⚠ Lịch đã cũ — Bot/Cố vấn/RAG tạm KHÔNG chặn tin ★★★ tự động. Chạy tools/update_calendar.py rồi push, hoặc nạp JSON mới."));
  } else if (CAL.loi) {
    items.push(el("span", { class: "small down" }, "⚠ " + CAL.loi));
  } else {
    items.push(el("span", { class: "small muted" }, "Đang tải dữ liệu lịch…"));
  }
  bar.appendChild(el("div", { class: "note-box", style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
    ...items,
    el("span", { style: "margin-left:auto" }),
    el("button", { class: "btn small", onclick: () => taiLichKinhTe(true).then(() => renderLich($("#screen-root"))) }, "🔄 Làm mới"),
    el("button", { class: "btn small", onclick: () => inp.click() }, "📥 Nạp JSON agent"),
    inp,
  ));
}

async function veCalTab(body) {
  body.innerHTML = "";
  if (CAL_TAB === "iframe") { veCalNguonBar(); renderTEIframe(body); return; }
  if (CAL_TAB === "widget") { veCalNguonBar(); renderTVEvents(body); return; }

  const loading = el("p", { class: "muted" }, "Đang tải dữ liệu lịch kinh tế…");
  body.appendChild(loading);
  await taiLichKinhTe();
  veCalNguonBar();
  loading.remove();

  if (!CAL.rows.length) {
    body.appendChild(el("div", { class: "warn-box" },
      "Chưa có dữ liệu. 2 cách nạp: ",
      el("div", {}, "1️⃣ Chạy ", el("b", {}, "python3 tools/update_calendar.py"), " trong repo rồi push (app tự đọc data/economic_calendar_data.json)"),
      el("div", {}, "2️⃣ Bấm 🔄 Làm mới để thử proxy CORS trực tiếp")));
    const fb = el("div", {});
    body.appendChild(fb);
    renderTVEvents(fb);
    return;
  }
  if (CAL_TAB === "bang") { veCalBang(body); return; }
  veCalPhanTich(body);
}

/* ---------- TAB PHÂN TÍCH ---------- */
function veCalPhanTich(body) {
  const now = Date.now();
  const pulse = tinhMacroPulse(CAL.rows, now);
  const sap = suKienSapToi(CAL.rows, now);
  const ketQua = ketQuaGanNhat(CAL.rows, now);

  // Cảnh báo vùng tin ★★★
  if (sap.vungTin) {
    body.appendChild(el("div", { class: "warn-box", style: "font-size:14px" },
      `🚨 ĐANG TRONG VÙNG TIN ★★★: ${sap.vungTin.iso} · ${sap.vungTin.suKien} (${fmtGioVN(sap.vungTin.ts)}) — `,
      el("b", {}, "KHÔNG vào lệnh mới ±30 phút quanh tin"), ". Spread giãn, quét 2 đầu rất mạnh."));
  }

  const grid = el("div", { class: "whale-grid" });

  // Card Macro Pulse
  const c1 = el("div", { class: "card" });
  c1.appendChild(el("div", { class: "card-title" }, "🌡️ Macro Pulse 48h — tác động tới crypto"));
  const cls = pulse.score >= 8 ? "long" : pulse.score <= -8 ? "short" : "neutral";
  c1.appendChild(el("div", { class: `whale-score ${cls}` }, String(pulse.score > 0 ? "+" + pulse.score : pulse.score)));
  c1.appendChild(el("div", { class: `verdict ${cls}` }, pulse.nhan));
  c1.appendChild(el("div", { class: "gauge" }, el("div", { class: "gauge-pin", style: `left:${(pulse.score + 100) / 2}%` })));
  c1.appendChild(el("div", { class: "gauge-labels" }, el("span", { class: "down" }, "-100 RISK-OFF"), el("span", {}, "0"), el("span", { class: "up" }, "+100 RISK-ON")));
  if (pulse.dongGop.length) {
    const tbl = el("table", { class: "mini-table" });
    tbl.appendChild(el("tr", {}, el("th", { class: "left" }, "Sự kiện đóng góp"), el("th", {}, "Kết quả"), el("th", {}, "Điểm")));
    for (const { r, dg } of pulse.dongGop) {
      tbl.appendChild(el("tr", {},
        el("td", { class: "left small" }, `${r.iso} · ${r.suKien} ${"★".repeat(r.imp)}`),
        el("td", { class: "small " + (dg.tacDong === "up" ? "up" : dg.tacDong === "down" ? "down" : "muted") }, `${r.actual} (${dg.nhan})`),
        el("td", { class: "mono " + (dg.diem > 0 ? "up" : "down") }, (dg.diem > 0 ? "+" : "") + dg.diem.toFixed(1))));
    }
    c1.appendChild(tbl);
  } else {
    c1.appendChild(el("p", { class: "muted small" }, "48h qua chưa có dữ liệu ★★+ nào công bố kèm dự báo để chấm điểm."));
  }
  grid.appendChild(c1);

  // Card sự kiện sắp tới
  const c2 = el("div", { class: "card" });
  c2.appendChild(el("div", { class: "card-title" }, "⏰ Sự kiện sắp tới (72h · ★★+) — giờ VN"));
  if (sap.nextBig) {
    c2.appendChild(el("div", { class: "plan-box", style: "border-color:hsla(38,92%,50%,.5)" },
      el("div", { class: "plan-title" }, `🔴 Tin ★★★ kế tiếp: còn ${fmtDemNguoc(sap.nextBig.ts - now)}`),
      el("div", { class: "kv" }, el("span", {}, "Sự kiện"), el("b", {}, `${sap.nextBig.iso} · ${sap.nextBig.suKien}`)),
      el("div", { class: "kv" }, el("span", {}, "Thời điểm"), el("b", {}, `${fmtNgayVN(sap.nextBig.ts)} · ${fmtGioVN(sap.nextBig.ts)}`)),
      sap.nextBig.forecast || sap.nextBig.consensus ? el("div", { class: "kv" }, el("span", {}, "Dự báo / Kỳ trước"), el("b", { class: "mono" }, `${sap.nextBig.consensus || sap.nextBig.forecast} / ${sap.nextBig.previous || "—"}`)) : null,
      el("div", { class: "small muted" }, "⛔ Quy tắc: đóng/không mở lệnh mới 30 phút trước và sau giờ tin.")));
  }
  if (sap.list.length) {
    const tbl = el("table", { class: "mini-table" });
    tbl.appendChild(el("tr", {}, el("th", {}, "Khi nào"), el("th", {}, "QG"), el("th", { class: "left" }, "Sự kiện"), el("th", {}, "Dự báo"), el("th", {}, "Kỳ trước"), el("th", {}, "Mức")));
    for (const r of sap.list) {
      tbl.appendChild(el("tr", { class: r.imp === 3 ? "imp-3" : "" },
        el("td", { class: "mono small" }, `${fmtGioVN(r.ts)} · ${fmtDemNguoc(r.ts - now)}`),
        el("td", {}, r.iso),
        el("td", { class: "left small" }, r.suKien),
        el("td", { class: "mono small" }, r.consensus || r.forecast || "—"),
        el("td", { class: "mono small" }, r.previous || "—"),
        el("td", {}, "★".repeat(r.imp))));
    }
    c2.appendChild(tbl);
  } else c2.appendChild(el("p", { class: "muted" }, "72h tới không có sự kiện ★★+ nào trong dữ liệu."));
  grid.appendChild(c2);
  body.appendChild(grid);

  // Kết quả vừa công bố
  const c3 = el("div", { class: "card" });
  c3.appendChild(el("div", { class: "card-title" }, "📢 Vừa công bố (36h · ★★+) — surprise & tác động crypto"));
  if (ketQua.length) {
    const tbl = el("table", { class: "mini-table" });
    tbl.appendChild(el("tr", {}, el("th", {}, "Giờ VN"), el("th", {}, "QG"), el("th", { class: "left" }, "Sự kiện"), el("th", {}, "Thực tế"), el("th", {}, "Dự báo"), el("th", { class: "left" }, "Đánh giá"), el("th", {}, "Crypto")));
    for (const { r, dg } of ketQua) {
      tbl.appendChild(el("tr", {},
        el("td", { class: "mono small" }, `${fmtNgayVN(r.ts).split(",")[0]} ${fmtGioVN(r.ts)}`),
        el("td", {}, r.iso),
        el("td", { class: "left small" }, `${r.suKien} ${"★".repeat(r.imp)}`),
        el("td", { class: "mono strong" }, r.actual),
        el("td", { class: "mono small" }, r.consensus || r.forecast || "—"),
        el("td", { class: "left small " + (dg ? (dg.khop ? "muted" : dg.lech > 0 ? "up" : "down") : "muted") }, dg ? dg.nhan : "không so sánh được"),
        el("td", { class: dg?.tacDong === "up" ? "up" : dg?.tacDong === "down" ? "down" : "muted" }, dg?.tacDong === "up" ? "▲ hỗ trợ" : dg?.tacDong === "down" ? "▼ áp lực" : "—")));
    }
    c3.appendChild(tbl);
  } else c3.appendChild(el("p", { class: "muted" }, "36h qua chưa có công bố ★★+ nào."));
  body.appendChild(c3);

  body.appendChild(el("p", { class: "muted small" },
    "Cách chấm: surprise (Thực tế vs Đồng thuận/Dự báo) × loại chỉ số (lạm phát/lãi suất/việc làm nóng hơn → risk-off; thất nghiệp cao hơn, GDP/PMI khỏe → risk-on) × mức sao × trọng số quốc gia (US×3, EU/CN×2). Macro Pulse chỉ là bối cảnh — quyết định vào lệnh vẫn theo cấu trúc SMC."));
}

/* ---------- TAB BẢNG DỮ LIỆU ---------- */
function veCalBang(body) {
  const bar = el("div", { class: "toolbar" },
    el("label", { class: "muted small" }, "Mức tác động tối thiểu: "));
  for (const n of [1, 2, 3]) {
    bar.appendChild(el("button", { class: "btn small " + (CAL_MIN_IMP === n ? "primary" : ""), onclick: () => { CAL_MIN_IMP = n; renderLich($("#screen-root")); } }, "★".repeat(n) + "+"));
  }
  body.appendChild(bar);
  const rows = CAL.rows.filter(r => r.imp >= CAL_MIN_IMP);
  if (!rows.length) { body.appendChild(el("p", { class: "muted" }, "Không có sự kiện đạt mức lọc.")); return; }
  const card = el("div", { class: "card" });
  const tbl = el("table", { class: "cal-table" });
  tbl.appendChild(el("tr", {},
    el("th", {}, "Giờ VN"), el("th", {}, "QG"), el("th", { class: "left" }, "Sự kiện"),
    el("th", {}, "Thực tế"), el("th", {}, "Kỳ trước"), el("th", {}, "Đồng thuận"), el("th", {}, "Dự báo"), el("th", {}, "Mức")));
  let ngay = "";
  const now = Date.now();
  for (const r of rows) {
    const nhanNgay = fmtNgayVN(r.ts);
    if (nhanNgay !== ngay) {
      ngay = nhanNgay;
      tbl.appendChild(el("tr", { class: "cal-day" }, el("td", { colspan: "8" }, nhanNgay)));
    }
    tbl.appendChild(el("tr", { class: `imp-${r.imp}` + (Math.abs(r.ts - now) <= 30 * 60e3 && r.imp === 3 ? " cal-hot" : "") },
      el("td", { class: "mono" }, r.coGio ? fmtGioVN(r.ts) : "—"),
      el("td", { title: r.quocGia }, r.iso),
      el("td", { class: "left" }, `${r.suKien}`),
      el("td", { class: "mono strong" }, r.actual || "—"),
      el("td", { class: "mono" }, r.previous || "—"),
      el("td", { class: "mono" }, r.consensus || "—"),
      el("td", { class: "mono" }, r.forecast || "—"),
      el("td", {}, "★".repeat(r.imp))));
  }
  card.appendChild(tbl);
  body.appendChild(card);
}

/* ================= KIẾN THỨC ================= */
function renderKienThuc(root) {
  root.innerHTML = "";
  root.appendChild(el("div", { class: "note-box" },
    "📚 Bản phân tích hệ thống hóa của Mr.Bit — engine tín hiệu của app này được lập trình đúng theo tài liệu này. Cột \"Trong app\" cho biết tri thức đã được tự động hóa ở đâu."));

  // 3 chủ đề cốt lõi
  const g1 = el("div", { class: "knowledge-grid" });
  for (const c of KIEN_THUC.chuDeCotLoi) {
    g1.appendChild(el("div", { class: "card" },
      el("div", { class: "card-title" }, `${c.emoji} ${c.ten}`),
      el("ul", {}, ...c.noiDung.map(x => el("li", {}, x))),
      el("div", { class: "in-app" }, "⚙️ Trong app: " + c.trongApp)));
  }
  root.appendChild(g1);

  // Cộng hưởng
  const c2 = el("div", { class: "card" }, el("div", { class: "card-title" }, "🔗 Sự bổ sung hoàn hảo giữa các nguồn"));
  for (const x of KIEN_THUC.congHuong) c2.appendChild(el("div", { class: "impact-row" }, el("b", {}, x.cap), el("div", { class: "muted small" }, x.y)));
  root.appendChild(c2);

  // Quy trình 5 bước
  const c3 = el("div", { class: "card" }, el("div", { class: "card-title" }, "🎬 Quy trình vào lệnh 5 bước (Wait → Watch → Confirm → Execute → Forget)"));
  const steps = el("div", { class: "step-cards" });
  for (const [i, s] of KIEN_THUC.quyTrinh5Buoc.entries()) {
    steps.appendChild(el("div", { class: "step-card" },
      el("div", { class: "step-num" }, String(i + 1)),
      el("b", {}, `${s.buoc} (${s.en})`),
      el("p", { class: "small" }, s.mota),
      el("div", { class: "in-app small" }, "⚙️ " + s.may)));
  }
  c3.appendChild(steps);
  root.appendChild(c3);

  // Quản trị + công cụ + phiên
  const g2 = el("div", { class: "knowledge-grid" });
  const cQt = el("div", { class: "card" }, el("div", { class: "card-title" }, "🛡️ Tư duy & Quản trị (nền móng)"));
  for (const q of KIEN_THUC.quanTri) {
    cQt.appendChild(el("b", { class: "small" }, q.ten));
    cQt.appendChild(el("ul", {}, ...q.items.map(x => el("li", { class: "small" }, x))));
  }
  g2.appendChild(cQt);
  const cCc = el("div", { class: "card" }, el("div", { class: "card-title" }, "🗡️ Vũ khí (công cụ & tín hiệu)"));
  for (const t of KIEN_THUC.congCu) cCc.appendChild(el("div", { class: "impact-row" }, el("b", { class: "small" }, t.ten), el("div", { class: "muted small" }, t.mota)));
  g2.appendChild(cCc);
  const cPh = el("div", { class: "card" }, el("div", { class: "card-title" }, "🕐 Phiên & thời điểm (Time & Price)"));
  for (const p of KIEN_THUC.phien) cPh.appendChild(el("div", { class: "impact-row" }, el("b", { class: "small" }, `${p.ten} · ${p.gio}`), el("div", { class: "muted small" }, p.dacDiem)));
  g2.appendChild(cPh);
  root.appendChild(g2);

  // Mindmap
  const c4 = el("div", { class: "card" }, el("div", { class: "card-title" }, "🧭 Sơ đồ tư duy hệ thống hóa"),
    el("pre", { class: "mindmap" }, KIEN_THUC.mindmapText));
  root.appendChild(c4);
}

/* ================= CÀI ĐẶT (modal) ================= */
function moCaiDat() {
  const old = $("#settings-modal");
  if (old) old.remove();
  const modal = el("div", { class: "modal", id: "settings-modal", onclick: (e) => { if (e.target.id === "settings-modal") modal.remove(); } });
  const box = el("div", { class: "modal-box card" });
  box.appendChild(el("div", { class: "card-title" }, "⚙️ Cài đặt Trade.2026"));
  box.appendChild(el("label", { class: "small muted" }, "Watchlist (cách nhau bằng dấu phẩy):"));
  const inpWl = el("input", { class: "input wide", value: SETTINGS.watchlist.join(", ") });
  box.appendChild(inpWl);
  box.appendChild(el("label", { class: "small muted" }, "Risk mỗi lệnh (% vốn):"));
  const inpRisk = el("input", { class: "input num", type: "number", value: String(SETTINGS.risk.riskPct), min: "0.1", max: "2", step: "0.1" });
  box.appendChild(inpRisk);
  box.appendChild(el("label", { class: "small muted" }, "Vốn ảo ban đầu (USDT):"));
  const inpVon = el("input", { class: "input num", type: "number", value: String(SETTINGS.risk.vonBanDau), min: "100", step: "100" });
  box.appendChild(inpVon);
  box.appendChild(el("label", { class: "small muted" }, "Chu kỳ quét tín hiệu (giây):"));
  const inpRef = el("input", { class: "input num", type: "number", value: String(SETTINGS.refreshTinHieuSec), min: "60", max: "900", step: "30" });
  box.appendChild(inpRef);
  box.appendChild(el("div", { class: "row-gap", style: "margin-top:14px" },
    el("button", {
      class: "btn primary", onclick: () => {
        SETTINGS.watchlist = inpWl.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 12);
        SETTINGS.risk.riskPct = clamp(+inpRisk.value || 1, 0.1, SETTINGS.risk.riskPctMax);
        SETTINGS.risk.vonBanDau = Math.max(100, +inpVon.value || 10000);
        SETTINGS.refreshTinHieuSec = clamp(+inpRef.value || 180, 60, 900);
        saveSettings(SETTINGS);
        modal.remove();
        location.reload();
      },
    }, "💾 Lưu & tải lại"),
    el("button", { class: "btn", onclick: () => modal.remove() }, "Hủy"),
  ));
  modal.appendChild(box);
  document.body.appendChild(modal);
}

/* ============================================================
 * Trade.2026 — Màn hình AI Hỏi đáp (RAG) — v2.1.0
 * Chat với LLM (Gemini/OpenAI/Claude) bằng key của user.
 * Key chỉ lưu trong localStorage trình duyệt user.
 * ============================================================ */
"use strict";

function dinhDangAI(text) {
  const esc = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^### (.*)$/gm, "<b>$1</b>")
    .replace(/^## (.*)$/gm, "<b>$1</b>")
    .replace(/^[-•] (.*)$/gm, "• $1")
    .replace(/\n/g, "<br>");
}

function renderHoiDap(root) {
  root.innerHTML = "";
  const cfg = AI_CFG.get();
  let providerId = AI_PROVIDERS[cfg.provider] ? cfg.provider : "gemini";

  const wrap = el("div", { class: "ai-wrap" });

  /* --- Thanh chọn provider --- */
  const bar = el("div", { class: "toolbar" });
  const selP = el("select", { class: "input" });
  for (const [id, p] of Object.entries(AI_PROVIDERS)) {
    const o = el("option", { value: id }, p.ten);
    if (id === providerId) o.selected = true;
    selP.appendChild(o);
  }
  const selM = el("select", { class: "input", style: "min-width:220px" });
  const napModel = () => {
    selM.innerHTML = "";
    const P = AI_PROVIDERS[providerId];
    const cur = AI_CFG.get().model || P.modelMacDinh;
    for (const m of P.models) {
      const o = el("option", { value: m }, m);
      if (m === cur) o.selected = true;
      selM.appendChild(o);
    }
    const oCus = el("option", { value: "__custom" }, "✏️ Model khác…");
    selM.appendChild(oCus);
  };
  napModel();
  const badgeKey = el("span", { class: "badge" });
  const capNhatBadge = () => {
    const co = AI_KEYS.co(providerId);
    badgeKey.textContent = co ? "🔑 Đã lưu key" : "⚠ Chưa có key";
    badgeKey.className = "badge " + (co ? "ok" : "warn");
  };
  capNhatBadge();
  selP.onchange = () => { providerId = selP.value; AI_CFG.set({ provider: providerId, model: "" }); napModel(); capNhatBadge(); };
  selM.onchange = () => {
    if (selM.value === "__custom") {
      const m = prompt("Nhập tên model:", "");
      if (m) { AI_CFG.set({ model: m.trim() }); napModel(); selM.value = m.trim(); }
      else napModel();
    } else AI_CFG.set({ model: selM.value });
  };
  const btnKey = el("button", { class: "btn", onclick: () => panelKey.style.display = panelKey.style.display === "none" ? "" : "none" }, "🔑 Key API");
  const btnXoaLichSu = el("button", { class: "btn", onclick: () => { resetLichSuAI(); veLai(); } }, "🗑 Xóa hội thoại");
  bar.append(selP, selM, badgeKey, btnKey, btnXoaLichSu);
  wrap.appendChild(bar);

  /* --- Panel cài đặt key (gập/mở) --- */
  const panelKey = el("div", { class: "card", style: "display:none;margin-bottom:12px" });
  panelKey.appendChild(el("div", { class: "card-title" }, "🔑 Kết nối API key"));
  panelKey.appendChild(el("p", { class: "muted small" },
    "Key do bạn nhập, chỉ lưu trong trình duyệt này (localStorage) — không gửi đi đâu ngoài API chính thức của provider bạn chọn. Không nhập key trên máy lạ/chung."));
  for (const [id, P] of Object.entries(AI_PROVIDERS)) {
    const inp = el("input", { class: "input", type: "password", placeholder: `API key ${P.ten}…`, value: AI_KEYS.co(id) ? "••••••••" : "", style: "flex:1" });
    const hang = el("div", { class: "row-gap", style: "margin:8px 0" },
      el("b", { style: "min-width:150px" }, P.ten),
      inp,
      el("button", { class: "btn primary", onclick: async () => {
        const v = inp.value.trim();
        if (!v || v === "••••••••") { alert("Hãy dán key thật vào ô (không phải dấu •)."); return; }
        AI_KEYS.set(id, v); inp.value = "••••••••"; capNhatBadge(); alert(`Đã lưu key ${P.ten} vào trình duyệt này.`);
      } }, "💾 Lưu"),
      el("button", { class: "btn", onclick: async () => {
        const v = inp.value.trim();
        const keyTest = (v && v !== "••••••••") ? v : AI_KEYS.get(id);
        if (!keyTest) { alert("Chưa có key để kiểm tra."); return; }
        if (v && v !== "••••••••") AI_KEYS.set(id, v);
        try {
          const r = await kiemTraKetNoiAI(id, AI_CFG.get().provider === id ? (AI_CFG.get().model || undefined) : undefined);
          alert(`✅ ${P.ten}: ${r}`);
        } catch (e) { alert(`❌ ${P.ten}: ${e.message}`); }
        inp.value = AI_KEYS.co(id) ? "••••••••" : ""; capNhatBadge();
      } }, "📡 Kiểm tra"),
      el("button", { class: "btn danger", onclick: () => { if (confirm(`Xóa key ${P.ten} khỏi trình duyệt?`)) { AI_KEYS.del(id); inp.value = ""; capNhatBadge(); } } }, "Xóa"),
    );
    panelKey.appendChild(hang);
    if (P.corsNote) panelKey.appendChild(el("p", { class: "muted small", style: "margin:-4px 0 8px 158px" }, "⚠ " + P.corsNote));
  }
  wrap.appendChild(panelKey);

  /* --- Gợi ý nhanh --- */
  const goiY = [
    "BTC hiện tại có tín hiệu vào lệnh không?",
    "Dòng tiền cá mập 24h qua thế nào?",
    "Funding rate đang cảnh báo gì?",
    "Tin kinh tế nào cần né trong 24h tới?",
    "Giải thích điểm hợp lưu của ETH cho tôi",
  ];
  const chips = el("div", { class: "row-gap", style: "margin-bottom:10px;flex-wrap:wrap" });
  for (const g of goiY) chips.appendChild(el("button", { class: "btn small", onclick: () => { inpChat.value = g; gui(); } }, g));
  wrap.appendChild(chips);

  /* --- Khung chat --- */
  const log = el("div", { class: "ai-log", id: "ai-log" });
  wrap.appendChild(log);

  const inpChat = el("input", { class: "input", placeholder: "Hỏi về thị trường, tín hiệu, dòng tiền… (Enter để gửi)", style: "flex:1" });
  const btnGui = el("button", { class: "btn primary", style: "min-width:90px" }, "Gửi ➤");
  const form = el("div", { class: "row-gap", style: "margin-top:10px" }, inpChat, btnGui);
  wrap.appendChild(form);
  wrap.appendChild(el("p", { class: "muted small", style: "margin-top:8px" },
    "🤖 AI trả lời dựa trên dữ liệu thật của app (kèm nguồn + thời điểm). Đây là công cụ phân tích, không phải lời khuyên đầu tư — luôn tự quản trị rủi ro."));

  async function gui() {
    const text = inpChat.value.trim();
    if (!text || AI_CHAT.dangHoi) return;
    if (!AI_KEYS.co(providerId)) { alert(`Chưa có API key cho ${AI_PROVIDERS[providerId].ten} — bấm "🔑 Key API" để nhập.`); panelKey.style.display = ""; return; }
    AI_CHAT.dangHoi = true;
    inpChat.value = "";
    AI_CHAT.lichSu.push({ role: "user", content: text });
    veLai();
    const dangGo = el("div", { class: "ai-msg ai" }, el("span", { class: "muted" }, "🤖 đang phân tích dữ liệu…"));
    log.appendChild(dangGo); log.scrollTop = log.scrollHeight;
    try {
      const model = AI_CFG.get().model || AI_PROVIDERS[providerId].modelMacDinh;
      const traLoi = await hoiAI(providerId, model, AI_CHAT.lichSu.slice(-10));
      AI_CHAT.lichSu.push({ role: "assistant", content: traLoi });
    } catch (e) {
      AI_CHAT.lichSu.push({ role: "assistant", content: "❌ " + e.message, loi: true });
    }
    AI_CHAT.dangHoi = false;
    veLai();
  }
  btnGui.onclick = gui;
  inpChat.onkeydown = (e) => { if (e.key === "Enter") gui(); };

  function veLai() {
    log.innerHTML = "";
    if (!AI_CHAT.lichSu.length) {
      log.appendChild(el("div", { class: "ai-msg ai" },
        el("div", {}, "👋 Chào! Tôi là trợ lý AI của Trade.2026."),
        el("div", { class: "muted small" }, "Tôi đọc được dữ liệu thật của app: tín hiệu SMC, dòng tiền cá voi/thanh lý (FlowDB), funding/OI, lịch kinh tế. Hãy hỏi tôi — ví dụ bấm một gợi ý ở trên.")));
    }
    for (const m of AI_CHAT.lichSu) {
      const div = el("div", { class: "ai-msg " + (m.role === "user" ? "user" : "ai") + (m.loi ? " loi" : "") });
      div.innerHTML = m.role === "user" ? dinhDangAI(m.content) : dinhDangAI(m.content);
      if (m.role === "user") div.style.textAlign = "right";
      log.appendChild(div);
    }
    log.scrollTop = log.scrollHeight;
  }
  veLai();
  root.appendChild(wrap);
}
