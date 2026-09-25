/* ============================================================
 * Trade.2026 — Đặt lệnh 2 bước (an toàn trước, xác nhận sau)
 *
 * Bước 1: cấu hình lệnh — sàn (Binance/MEXC/OKX, giá REAL-TIME từng sàn),
 *         Long/Short, Cross/Isolated, đòn bẩy, entry Market/Limit,
 *         SL/TP tự map từ kế hoạch tín hiệu, R:R chấm ngưỡng an toàn
 *         → bấm "🛡️ Kiểm tra an toàn" → bot chạy 10 lớp kiểm tra
 *         → kết quả 🟢 AN TOÀN / 🟡 TRUNG TÍNH / 🔴 RỦI RO + lý do
 * Bước 2: người dùng bấm "✅ Xác nhận đặt lệnh" → khớp lệnh PAPER
 *         (mô phỏng bằng giá thật của sàn đã chọn, bot giám sát SL/TP,
 *          dời BE +1R). Lệnh thật: tự đặt trên sàn theo đúng phiếu này.
 * ============================================================ */
"use strict";

let TICKET = null; // trạng thái phiếu lệnh đang mở

function giaSan(san, coin) {
  return PRICE_HUB?.prices?.[san]?.[coin]?.gia ?? PRICE_HUB?.gia(coin) ?? null;
}

/* ---------- Mở phiếu lệnh ---------- */
function moDatLenh({ coin, side = "long", san = "BINANCE", prefill = null } = {}) {
  dongDatLenh();
  const kq = SIGNAL_CACHE.get(coin) || null;
  const plan = kq?.plan || null;
  if (plan && !["long", "short"].includes(side)) side = plan.side;
  const gia = giaSan(san, coin) ?? kq?.gia ?? 0;
  const atr = kq?.ltf?.atr || gia * 0.004;

  if (prefill) {
    TICKET = {
      coin, side, san, mode: prefill.mode || "isolated", lev: prefill.lev || SETTINGS.risk.donBay || 3,
      entryMode: prefill.entryMode || "limit",
      entryLimit: prefill.entry ?? gia,
      sl: prefill.sl ?? (side === "long" ? gia - atr * 1.5 : gia + atr * 1.5),
      tp: prefill.tp ?? (side === "long" ? gia + atr * 3 : gia - atr * 3),
      riskPct: prefill.riskPct || SETTINGS.risk.riskPct,
      safety: null, kq, tuAdvisor: true,
    };
  } else {
    TICKET = {
      coin, side, san, mode: "isolated", lev: SETTINGS.risk.donBay || 3,
      entryMode: plan && plan.side === side ? "limit" : "market",
      entryLimit: plan && plan.side === side ? plan.entry : gia,
      sl: plan && plan.side === side ? plan.sl : (side === "long" ? gia - atr * 1.5 : gia + atr * 1.5),
      tp: plan && plan.side === side ? plan.tp1 : (side === "long" ? gia + atr * 3 : gia - atr * 3),
      riskPct: SETTINGS.risk.riskPct,
      safety: null, kq,
    };
  }
  // Sizing: mặc định theo Risk %; người dùng có thể nhập số lượng coin / giá trị lệnh
  TICKET.sizeMode = "risk";
  TICKET.qtyManual = null;
  TICKET.valueManual = null;
  const _lm = (typeof LEV_MAX !== "undefined" && LEV_MAX[TICKET.san]) || 125;
  TICKET.lev = clamp(TICKET.lev, 1, _lm);

  const modal = el("div", { class: "modal", id: "order-modal", onclick: (e) => { if (e.target.id === "order-modal") dongDatLenh(); } });
  modal.appendChild(el("div", { class: "modal-box card order-box", id: "order-box" }));
  document.body.appendChild(modal);
  veTicket();
}
function dongDatLenh() { $("#order-modal")?.remove(); TICKET = null; }

/* Giá trị dẫn xuất tính live — sizing theo Risk % / Số lượng / Giá trị lệnh */
function tinhTicket() {
  const t = TICKET;
  const levMax = (typeof LEV_MAX !== "undefined" && LEV_MAX[t.san]) || 125;
  const lev = clamp(t.lev || 1, 1, levMax);
  const giaLive = giaSan(t.san, t.coin);
  const entry = t.entryMode === "market" ? (giaLive ?? t.entryLimit) : t.entryLimit;
  const risk = Math.abs(entry - t.sl); // khoảng cách entry→SL (1 đơn vị coin)
  const rr = risk > 0 ? Math.abs(t.tp - entry) / risk : 0;
  const von = PAPER_BOT?.state?.balance ?? SETTINGS.risk.vonBanDau;

  let qty, giaTri, riskUsdt;
  if (t.sizeMode === "qty" && t.qtyManual > 0) {
    qty = t.qtyManual; giaTri = qty * entry; riskUsdt = qty * risk;
  } else if (t.sizeMode === "value" && t.valueManual > 0) {
    giaTri = t.valueManual; qty = entry > 0 ? giaTri / entry : 0; riskUsdt = qty * risk;
  } else { // risk %
    riskUsdt = von * t.riskPct / 100; qty = risk > 0 ? riskUsdt / risk : 0; giaTri = qty * entry;
  }
  const margin = lev > 0 ? giaTri / lev : giaTri;
  const effRiskPct = von > 0 ? riskUsdt / von * 100 : 0;
  // giá thanh lý ước tính (isolated ~ đệm bảo trì 5%)
  const liq = t.side === "long" ? entry * (1 - 0.95 / lev) : entry * (1 + 0.95 / lev);
  const slQuaLiq = t.side === "long" ? t.sl <= liq : t.sl >= liq;
  // Lãi/lỗ ước tính
  const pnlTP = (t.side === "long" ? t.tp - entry : entry - t.tp) * qty;
  const pnlSL = (t.side === "long" ? t.sl - entry : entry - t.sl) * qty;
  const roiTP = margin > 0 ? pnlTP / margin * 100 : 0;
  const roiSL = margin > 0 ? pnlSL / margin * 100 : 0;
  return { giaLive, entry, risk, rr, riskUsdt, qty, giaTri, margin, liq, slQuaLiq, von, lev, levMax, effRiskPct, pnlTP, pnlSL, roiTP, roiSL };
}

/* ---------- Render phiếu ---------- */
function veTicket() {
  const box = $("#order-box");
  if (!box || !TICKET) return;
  const t = TICKET;
  const d = tinhTicket();
  box.innerHTML = "";

  box.appendChild(el("div", { class: "card-title" }, `🛒 Phiếu lệnh ${t.coin}/USDT — 2 bước an toàn`));

  /* Sàn + giá real-time */
  const sanRow = el("div", { class: "order-san" });
  for (const s of ["BINANCE", "OKX", "MEXC"]) {
    const g = giaSan(s, t.coin);
    const lmax = (typeof LEV_MAX !== "undefined" && LEV_MAX[s]) || 125;
    sanRow.appendChild(el("button", {
      class: "san-btn " + (t.san === s ? "active" : ""),
      onclick: () => { t.san = s; t.lev = clamp(t.lev, 1, lmax); t.safety = null; veTicket(); },
    },
      el("div", { class: "san-ten" }, s === "MEXC" ? "MEXC (Fut)" : s.charAt(0) + s.slice(1).toLowerCase()),
      el("div", { class: "mono san-gia", id: `tk-gia-${s}` }, g ? fmtGia(g) : "—"),
      el("div", { class: "san-lev" }, `tối đa x${lmax}`)));
  }
  box.appendChild(sanRow);

  /* Side + margin mode + đòn bẩy */
  const hang1 = el("div", { class: "order-grid" });
  hang1.appendChild(el("div", {},
    el("label", { class: "small muted" }, "Hướng lệnh"),
    el("div", { class: "seg" },
      el("button", { class: "seg-btn long " + (t.side === "long" ? "active" : ""), onclick: () => { t.side = "long"; t.safety = null; capNhatSLTPMacDinh(); veTicket(); } }, "🟢 LONG"),
      el("button", { class: "seg-btn short " + (t.side === "short" ? "active" : ""), onclick: () => { t.side = "short"; t.safety = null; capNhatSLTPMacDinh(); veTicket(); } }, "🔴 SHORT"))));
  hang1.appendChild(el("div", {},
    el("label", { class: "small muted" }, "Ký quỹ"),
    el("div", { class: "seg" },
      el("button", { class: "seg-btn " + (t.mode === "cross" ? "active" : ""), onclick: () => { t.mode = "cross"; t.safety = null; veTicket(); } }, "Cross"),
      el("button", { class: "seg-btn " + (t.mode === "isolated" ? "active" : ""), onclick: () => { t.mode = "isolated"; t.safety = null; veTicket(); } }, "Isolated"))));
  const levNhan = t.lev <= 3 ? "✅ (hồ sơ 2–3x)" : t.lev <= 5 ? "⚠ hơi cao" : t.lev <= 20 ? "🔴 cao" : t.lev <= 75 ? "🔴 rất cao" : "☠️ cực kỳ rủi ro";
  const levBox = el("div", { class: "lev-box" },
    el("label", { class: "small muted" }, `Đòn bẩy: x${t.lev} · tối đa x${d.levMax} · ${levNhan}`));
  const slider = el("input", { type: "range", min: "1", max: String(d.levMax), step: "1", value: String(clamp(t.lev, 1, d.levMax)), class: "lev-slider" });
  slider.addEventListener("input", (e) => { t.lev = +e.target.value; t.safety = null; veTicket(); });
  levBox.appendChild(slider);
  const presets = el("div", { class: "lev-presets" });
  for (const L of (typeof LEV_PRESETS !== "undefined" ? LEV_PRESETS : [3, 10, 20, 50, 125]).filter((x) => x <= d.levMax)) {
    presets.appendChild(el("button", { class: "lev-preset " + (t.lev === L ? "active" : ""), onclick: () => { t.lev = L; t.safety = null; veTicket(); } }, "x" + L));
  }
  levBox.appendChild(presets);
  hang1.appendChild(levBox);
  box.appendChild(hang1);

  /* Entry mode */
  const entryBox = el("div", { class: "order-grid" });
  entryBox.appendChild(el("div", {},
    el("label", { class: "small muted" }, "Entry"),
    el("div", { class: "seg" },
      el("button", { class: "seg-btn " + (t.entryMode === "market" ? "active" : ""), onclick: () => { t.entryMode = "market"; t.safety = null; veTicket(); } }, `Market (live)`),
      el("button", { class: "seg-btn " + (t.entryMode === "limit" ? "active" : ""), onclick: () => { t.entryMode = "limit"; t.safety = null; veTicket(); } }, "Limit kế hoạch"))));
  const inp = (nhan, key, cls = "") => {
    const w = el("div", {}, el("label", { class: "small muted" }, nhan));
    const i = el("input", { class: "input num wide " + cls, type: "number", step: "any", value: String(lamTron(t[key])) });
    i.addEventListener("change", (e) => { t[key] = +e.target.value || t[key]; t.safety = null; veTicket(); });
    w.appendChild(i);
    return w;
  };
  if (t.entryMode === "limit") entryBox.appendChild(inp("Giá limit", "entryLimit"));
  entryBox.appendChild(inp("Stoploss", "sl", "sl-inp"));
  entryBox.appendChild(inp("Take Profit", "tp", "tp-inp"));
  box.appendChild(entryBox);

  /* Tính vị thế: Risk % ↔ Số lượng coin ↔ Giá trị lệnh (nhập cái nào → tính 2 cái kia) */
  box.appendChild(el("div", { class: "size-hint muted small" },
    `Tính vị thế theo: ${t.sizeMode === "qty" ? "Số lượng coin" : t.sizeMode === "value" ? "Giá trị lệnh" : "Risk % vốn"} — sửa ô bất kỳ để đổi cách tính.`));
  const sizeBox = el("div", { class: "order-grid" });
  // Risk %
  const riskW = el("div", { class: t.sizeMode === "risk" ? "size-active" : "" }, el("label", { class: "small muted" }, "Risk (% vốn)"));
  const riskI = el("input", { class: "input num wide", type: "number", min: "0.1", max: String(SETTINGS.risk.riskPctMax), step: "0.1", value: String(t.riskPct) });
  riskI.addEventListener("change", (e) => { t.riskPct = clamp(+e.target.value || 1, 0.1, SETTINGS.risk.riskPctMax); t.sizeMode = "risk"; t.safety = null; veTicket(); });
  riskW.appendChild(riskI);
  sizeBox.appendChild(riskW);
  // Số lượng coin
  const qtyW = el("div", { class: t.sizeMode === "qty" ? "size-active" : "" }, el("label", { class: "small muted" }, `Số lượng (${t.coin || "coin"})`));
  const qtyI = el("input", { class: "input num wide", type: "number", step: "any", value: String(+d.qty.toFixed(6)), id: "tk-qty-inp" });
  qtyI.addEventListener("change", (e) => { const v = +e.target.value; if (v > 0) { t.sizeMode = "qty"; t.qtyManual = v; t.safety = null; veTicket(); } });
  qtyW.appendChild(qtyI);
  sizeBox.appendChild(qtyW);
  // Giá trị lệnh (notional)
  const valW = el("div", { class: t.sizeMode === "value" ? "size-active" : "" }, el("label", { class: "small muted" }, "Giá trị lệnh (USDT)"));
  const valI = el("input", { class: "input num wide", type: "number", step: "any", value: String(+d.giaTri.toFixed(2)), id: "tk-val-inp" });
  valI.addEventListener("change", (e) => { const v = +e.target.value; if (v > 0) { t.sizeMode = "value"; t.valueManual = v; t.safety = null; veTicket(); } });
  valW.appendChild(valI);
  sizeBox.appendChild(valW);
  box.appendChild(sizeBox);

  /* Bảng dẫn xuất live */
  const rrCls = d.rr >= SETTINGS.risk.minRR ? "up" : d.rr >= 1.5 ? "" : "down";
  const rrNhan = d.rr >= SETTINGS.risk.minRR ? "✅ đạt ngưỡng an toàn" : d.rr >= 1.5 ? "⚠ dưới chuẩn 1:2" : "🔴 quá thấp";
  const riskCls = d.effRiskPct <= 1 ? "" : d.effRiskPct <= 2 ? "" : "down";
  const info = el("div", { class: "order-info" },
    kv("Entry" + (t.entryMode === "market" ? " (market live)" : ""), el("b", { class: "mono", id: "tk-entry" }, fmtGia(d.entry))),
    kv("R:R tới TP", el("b", { class: "mono " + rrCls, id: "tk-rr" }, `1:${d.rr.toFixed(2)} ${rrNhan}`)),
    kv("Rủi ro thực tế (nếu dính SL)", el("b", { class: "mono " + riskCls, id: "tk-risk" }, `${d.effRiskPct.toFixed(2)}% vốn = ${fmtUsd(d.riskUsdt)}`)),
    kv(`Ký quỹ cần (x${t.lev} ${t.mode})`, el("b", { class: "mono", id: "tk-margin" }, fmtUsd(d.margin))),
    kv("🟢 Lãi ước tính tại TP", el("b", { class: "mono up", id: "tk-pnltp" }, `+${fmtUsd(d.pnlTP)} (+${d.roiTP.toFixed(0)}% ROI ký quỹ)`)),
    kv("🔴 Lỗ ước tính tại SL", el("b", { class: "mono down", id: "tk-pnlsl" }, `${fmtUsd(d.pnlSL)} (${d.roiSL.toFixed(0)}% ROI ký quỹ)`)),
    kv("Giá thanh lý ước tính", el("b", { class: "mono " + (d.slQuaLiq ? "down" : ""), id: "tk-liq" }, `${fmtGia(d.liq)} ${d.slQuaLiq ? "🔴 SL NẰM NGOÀI thanh lý — vô nghĩa!" : "✓ SL an toàn trước thanh lý"}`)),
  );
  box.appendChild(info);
  function kv(nhan, val) { return el("div", { class: "kv" }, el("span", {}, nhan), val); }

  /* Bước 1: kiểm tra an toàn */
  box.appendChild(el("div", { class: "row-gap" },
    el("button", { class: "btn primary", onclick: () => { t.safety = kiemTraAnToanLenh(); veTicket(); } },
      t.safety ? "🛡️ Kiểm tra lại" : "🛡️ Bước 1 — Kiểm tra an toàn"),
    el("button", { class: "btn", onclick: dongDatLenh }, "Hủy")));

  /* Kết quả an toàn + Bước 2 */
  if (t.safety) {
    const s = t.safety;
    const cls = s.mucDo === "AN_TOAN" ? "long" : s.mucDo === "RUI_RO" ? "short" : "prepare";
    const nhan = s.mucDo === "AN_TOAN" ? "🟢 AN TOÀN — đủ điều kiện kỷ luật" : s.mucDo === "RUI_RO" ? "🔴 RỦI RO — nhiều điều kiện vi phạm" : "🟡 TRUNG TÍNH — có điểm cần cân nhắc";
    const sb = el("div", { class: "safety-box" });
    sb.appendChild(el("div", { class: `verdict ${cls}` }, nhan));
    for (const it of s.items) {
      sb.appendChild(el("div", { class: "safety-item " + it.trangThai },
        el("span", {}, it.trangThai === "ok" ? "✅" : it.trangThai === "warn" ? "⚠️" : "🔴"),
        el("span", {}, el("b", {}, it.muc + ": "), it.chiTiet)));
    }
    box.appendChild(sb);

    const canXacNhanRui = s.mucDo === "RUI_RO";
    let daHieu = false;
    if (canXacNhanRui) {
      const ck = el("label", { class: "chk-line down" },
        el("input", { type: "checkbox", onchange: (e) => { daHieu = e.target.checked; $("#btn-xacnhan").disabled = !daHieu; } }),
        " Tôi hiểu các rủi ro trên và vẫn muốn vào lệnh (không khuyến khích)");
      box.appendChild(ck);
    }
    box.appendChild(el("div", { class: "row-gap" },
      el("button", {
        class: "btn " + (s.mucDo === "RUI_RO" ? "danger" : "primary"), id: "btn-xacnhan",
        ...(canXacNhanRui ? { disabled: "" } : {}),
        onclick: () => xacNhanDatLenh(),
      }, "✅ Bước 2 — Xác nhận đặt lệnh (PAPER)")));
    box.appendChild(el("p", { class: "muted tiny" },
      "Lệnh khớp MÔ PHỎNG bằng giá thật của " + t.san + ", bot giám sát SL/TP + dời BE khi +1R. Lệnh thật: tự đặt trên sàn theo đúng phiếu này — nguyên tắc requiresUserDecision."));
  }
}

/* SL/TP mặc định lại khi đổi hướng */
function capNhatSLTPMacDinh() {
  const t = TICKET;
  const kq = SIGNAL_CACHE.get(t.coin);
  const gia = giaSan(t.san, t.coin) ?? kq?.gia ?? 0;
  const atr = kq?.ltf?.atr || gia * 0.004;
  const plan = kq?.plan;
  if (plan && plan.side === t.side) { t.entryLimit = plan.entry; t.sl = plan.sl; t.tp = plan.tp1; t.entryMode = "limit"; }
  else {
    t.entryMode = "market"; t.entryLimit = gia;
    t.sl = t.side === "long" ? gia - atr * 1.5 : gia + atr * 1.5;
    t.tp = t.side === "long" ? gia + atr * 3 : gia - atr * 3;
  }
}

/* ---------- 10 lớp kiểm tra an toàn ---------- */
function kiemTraAnToanLenh() {
  const t = TICKET;
  const d = tinhTicket();
  const kq = SIGNAL_CACHE.get(t.coin);
  const items = [];
  const add = (muc, trangThai, chiTiet) => items.push({ muc, trangThai, chiTiet });

  // 1. Tín hiệu SMC
  if (!kq) add("Tín hiệu SMC", "warn", "Chưa có phân tích cho coin này — đang trade 'chay'");
  else if ((kq.verdict === "LONG" && t.side === "long") || (kq.verdict === "SHORT" && t.side === "short"))
    add("Tín hiệu SMC", "ok", `${verdictLabel(kq.verdict)} · điểm ${kq.score}/100 · ${kq.phaseLabel}`);
  else if (kq.side && kq.side !== t.side)
    add("Tín hiệu SMC", "bad", `NGƯỢC tín hiệu (hệ thống thiên ${kq.side.toUpperCase()}, điểm ${kq.score})`);
  else add("Tín hiệu SMC", "warn", `Chưa đạt chuẩn (${verdictLabel(kq.verdict)} · ${kq.score}đ) — vào sớm là đánh cược`);

  // 2. RAG Auto (nếu đã chạy)
  const rag = RAG.runs.get(t.coin)?.ketLuan;
  if (rag) {
    const dong = (rag.goiY === "LONG" && t.side === "long") || (rag.goiY === "SHORT" && t.side === "short");
    add("RAG Auto", dong ? "ok" : rag.goiY === "DUNG_NGOAI" ? "warn" : "bad",
      `${ragGoiYLabel(rag.goiY)} · tin cậy ${rag.conf}%`);
  }

  // 3. R:R
  add("R:R", d.rr >= SETTINGS.risk.minRR ? "ok" : d.rr >= 1.5 ? "warn" : "bad",
    `1:${d.rr.toFixed(2)} (chuẩn tối thiểu 1:${SETTINGS.risk.minRR})`);

  // 4. Đòn bẩy
  add("Đòn bẩy", t.lev <= 3 ? "ok" : t.lev <= 5 ? "warn" : "bad", `x${t.lev} ${t.mode} (hồ sơ Mr.Bit 2–3x · sàn cho tối đa x${d.levMax})`);

  // 4b. Rủi ro thực tế theo sizing (số lượng/giá trị có thể vượt risk chuẩn)
  add("Rủi ro thực tế", d.effRiskPct <= 1 ? "ok" : d.effRiskPct <= 2 ? "warn" : "bad",
    `${d.effRiskPct.toFixed(2)}% vốn nếu dính SL (${fmtUsd(d.riskUsdt)}) · KL ${d.qty.toFixed(6)} ${t.coin} ≈ ${fmtUsd(d.giaTri)}`);

  // 5. Risk %
  add("Risk mỗi lệnh", t.riskPct <= 1 ? "ok" : t.riskPct <= 2 ? "warn" : "bad", `${t.riskPct}% vốn = ${fmtUsd(d.riskUsdt)}`);

  // 6. SL vs thanh lý
  add("SL trước thanh lý", d.slQuaLiq ? "bad" : "ok", d.slQuaLiq ? "SL nằm NGOÀI giá thanh lý — giảm đòn bẩy!" : `Liq ~${fmtGia(d.liq)}, SL ${fmtGia(t.sl)}`);

  // 7. Tin ★★★
  if (typeof CAL !== "undefined" && CAL.rows?.length) {
    const sap = suKienSapToi(CAL.rows, Date.now(), 3);
    if (sap.vungTin) add("Lịch kinh tế", "bad", `ĐANG trong vùng tin ★★★ (${sap.vungTin.iso} ${sap.vungTin.suKien}) — né tin ±30ph`);
    else if (sap.nextBig && sap.nextBig.ts - Date.now() < 60 * 60e3) add("Lịch kinh tế", "warn", `Tin ★★★ sau ${fmtDemNguoc(sap.nextBig.ts - Date.now())} (${sap.nextBig.iso} ${sap.nextBig.suKien})`);
    else add("Lịch kinh tế", "ok", "Không có tin ★★★ trong 1h tới");
  } else add("Lịch kinh tế", "warn", "Chưa có dữ liệu lịch — không kiểm tra được vùng tin");

  // 8. Whale
  const w = WHALE_CACHE.get(t.coin);
  if (w) {
    const dong = t.side === "long" ? w.score >= 10 : w.score <= -10;
    const nguoc = t.side === "long" ? w.score <= -10 : w.score >= 10;
    add("Radar Cá Mập", dong ? "ok" : nguoc ? "warn" : "warn", `Whale Score ${w.score > 0 ? "+" : ""}${w.score} ${dong ? "— đồng thuận" : nguoc ? "— NGƯỢC hướng" : "— trung lập"}`);
  }

  // 8b. Dòng tiền đa sàn + quét thanh khoản (DataHub)
  if (window.DataHub && DataHub.isRunning()) {
    const fs = DataHub.flowScore(t.coin);
    const tl = window.DataHubBridge ? DataHubBridge.thanhLyGanDay(t.coin, 5) : null;
    const dong = t.side === "long" ? fs >= 15 : fs <= -15;
    const nguoc = t.side === "long" ? fs <= -15 : fs >= 15;
    add("Dòng tiền đa sàn", dong ? "ok" : nguoc ? "bad" : "warn",
      `Điểm ${fs > 0 ? "+" : ""}${fs} ${dong ? "— cá mập cùng chiều" : nguoc ? "— NGƯỢC hướng lệnh" : "— trung lập"}`);
    if (tl && tl.tong > 20e6) add("Quét thanh khoản", "bad", `Thanh lý 5ph ${fmtUsd(tl.tong)} — thị trường đang giật mạnh`);
  }

  // 9. Premium/Discount
  if (kq?.mtf?.range) {
    const r = kq.mtf.range;
    const tot = (t.side === "long" && r.vung === "discount") || (t.side === "short" && r.vung === "premium");
    const xau = (t.side === "long" && r.vung === "premium") || (t.side === "short" && r.vung === "discount");
    add("Vùng giá 1H", tot ? "ok" : xau ? "warn" : "ok", `${r.vung.toUpperCase()} (${r.viTriPct}%) ${xau ? "— " + (t.side === "long" ? "mua đỉnh" : "bán đáy") + " kém tối ưu" : ""}`);
  }

  // 10. Trạng thái bot/kỷ luật chung
  if (PAPER_BOT) {
    if (PAPER_BOT.state.circuitTripped) add("Ngắt mạch ngày", "bad", `Đang lỗ quá ${PAPER_BOT.config.loNgayMaxPct}% hôm nay — kỷ luật: NGHỈ`);
    else add("Ngắt mạch ngày", "ok", "Chưa chạm ngưỡng lỗ ngày");
    if (PAPER_BOT.state.positions.some(p => p.coin === t.coin)) add("Vị thế trùng", "warn", `Đang có vị thế ${t.coin} mở`);
    if (PAPER_BOT.state.positions.length >= PAPER_BOT.config.maxViThe) add("Số vị thế", "warn", `Đã ${PAPER_BOT.state.positions.length}/${PAPER_BOT.config.maxViThe} vị thế`);
  }
  const kz = dangKillzone();
  add("Phiên giao dịch", kz.active ? "ok" : "warn", kz.active ? `Đang ${kz.ten}` : "Ngoài killzone/giờ vàng — thanh khoản mỏng");

  const soBad = items.filter(i => i.trangThai === "bad").length;
  const soWarn = items.filter(i => i.trangThai === "warn").length;
  const mucDo = soBad > 0 ? "RUI_RO" : soWarn >= 3 ? "TRUNG_TINH" : soWarn > 0 ? "TRUNG_TINH" : "AN_TOAN";
  return { mucDo, items, luc: Date.now() };
}

/* ---------- Bước 2: xác nhận ---------- */
function xacNhanDatLenh() {
  const t = TICKET;
  const d = tinhTicket();
  if (!PAPER_BOT) return;
  const pos = PAPER_BOT.moLenhTay({
    coin: t.coin, side: t.side, san: t.san, mode: t.mode, lev: t.lev,
    entry: d.entry, sl: t.sl, tp: t.tp, riskPct: t.riskPct, qty: d.qty,
  });
  if (!pos) { alert("Không mở được lệnh (kiểm tra SL/entry)"); return; }
  const box = $("#order-box");
  if (box) {
    box.innerHTML = "";
    box.appendChild(el("div", { class: "card-title" }, "🎉 Đặt lệnh thành công (PAPER)"));
    box.appendChild(el("div", { class: "verdict " + (t.side === "long" ? "long" : "short") },
      `${t.side.toUpperCase()} ${t.coin} @ ${fmtGia(d.entry)} · ${t.san} · x${t.lev} ${t.mode}`));
    box.appendChild(el("div", { class: "kv" }, el("span", {}, "SL / TP"), el("b", { class: "mono" }, `${fmtGia(t.sl)} / ${fmtGia(t.tp)}`)));
    box.appendChild(el("div", { class: "kv" }, el("span", {}, "Khối lượng · Giá trị"), el("b", { class: "mono" }, `${d.qty.toFixed(6)} ${t.coin} ≈ ${fmtUsd(d.giaTri)} (ký quỹ ${fmtUsd(d.margin)})`)));
    box.appendChild(el("div", { class: "kv" }, el("span", {}, "Lãi/Lỗ ước tính"), el("b", { class: "mono" }, `TP +${fmtUsd(d.pnlTP)} / SL ${fmtUsd(d.pnlSL)}`)));
    box.appendChild(el("p", { class: "muted small" }, "Bot đang giám sát real-time: chạm TP/SL tự đóng, +1R tự dời SL về hòa vốn. Xem tại màn hình 🤖 Bot Trade."));
    box.appendChild(el("div", { class: "row-gap" },
      el("button", { class: "btn primary", onclick: () => { dongDatLenh(); location.hash = "#/bot"; } }, "Xem Bot Trade"),
      el("button", { class: "btn", onclick: dongDatLenh }, "Đóng")));
  }
}

/* Cập nhật giá live trong phiếu (gọi từ app.js mỗi tick) */
function capNhatTicketGia(san, coin) {
  if (!TICKET || TICKET.coin !== coin) return;
  const cell = $(`#tk-gia-${san}`);
  if (cell) { const g = giaSan(san, TICKET.coin); if (g) cell.textContent = fmtGia(g); }
  if (TICKET.entryMode !== "market" || san !== TICKET.san) return;
  const d = tinhTicket();
  const set = (id, txt, cls) => { const e = $(id); if (e) { e.textContent = txt; if (cls !== undefined) e.className = cls; } };
  set("#tk-entry", fmtGia(d.entry));
  const rrCls = d.rr >= SETTINGS.risk.minRR ? "up" : d.rr >= 1.5 ? "" : "down";
  set("#tk-rr", `1:${d.rr.toFixed(2)} ${d.rr >= SETTINGS.risk.minRR ? "✅ đạt ngưỡng an toàn" : d.rr >= 1.5 ? "⚠ dưới chuẩn 1:2" : "🔴 quá thấp"}`, "mono " + rrCls);
  set("#tk-risk", `${d.effRiskPct.toFixed(2)}% vốn = ${fmtUsd(d.riskUsdt)}`, "mono " + (d.effRiskPct <= 2 ? "" : "down"));
  set("#tk-margin", fmtUsd(d.margin), "mono");
  set("#tk-pnltp", `+${fmtUsd(d.pnlTP)} (+${d.roiTP.toFixed(0)}% ROI ký quỹ)`, "mono up");
  set("#tk-pnlsl", `${fmtUsd(d.pnlSL)} (${d.roiSL.toFixed(0)}% ROI ký quỹ)`, "mono down");
  set("#tk-liq", `${fmtGia(d.liq)} ${d.slQuaLiq ? "🔴 SL NẰM NGOÀI thanh lý — vô nghĩa!" : "✓ SL an toàn trước thanh lý"}`, "mono " + (d.slQuaLiq ? "down" : ""));
  // đồng bộ ô số lượng/giá trị khi đang tính theo risk (giá đổi → khối lượng đổi), tránh ghi đè khi user đang gõ
  const qi = $("#tk-qty-inp"), vi = $("#tk-val-inp");
  if (qi && document.activeElement !== qi && TICKET.sizeMode === "risk") qi.value = String(+d.qty.toFixed(6));
  if (vi && document.activeElement !== vi && TICKET.sizeMode !== "value") vi.value = String(+d.giaTri.toFixed(2));
}
