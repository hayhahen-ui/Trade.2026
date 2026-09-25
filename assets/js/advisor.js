/* ============================================================
 * Trade.2026 — Cố vấn lệnh (Trade Advisor)
 * Đầu vào: gõ text · dán · import ảnh thẻ lệnh (OCR Tesseract)
 * Bóc tách: coin · hướng · đòn bẩy · giá vào · giá hiện tại · SL · TP · PnL%
 * Đối chiếu SMC + RAG + Whale + Macro live → % TỐI ƯU + khuyến cáo +
 * khuyến nghị + "giao dịch tốt hơn". Đủ chuẩn → AUTO-BOOKING (xác nhận
 * 2 bước, ghi nhận, đấu nối Bot Trade). Áp dụng kiến thức đã tự học.
 * ============================================================ */
"use strict";

let ADVISOR = { trade: null, kq: null, ketQua: null, dangChay: false };

/* ---------- Bóc tách lệnh từ text ---------- */
function parseTradeInput(text) {
  const t = " " + String(text || "").replace(/\s+/g, " ").trim() + " ";
  if (!t.trim()) return null;
  const num = (s) => (typeof parseNumTE === "function" ? parseNumTE(s) : parseFloat(String(s).replace(/[,\s%]/g, "")));

  // coin
  let coin = null;
  let m = t.match(/\b([A-Z0-9]{2,12})\s*[\/\-]?\s*USDT\b/i);
  if (m) coin = m[1].toUpperCase();
  if (!coin) {
    const dsBiet = [...(SETTINGS.watchlist || []), ...(SETTINGS.watchlistPhu || []), "ERA", "PEPE", "XRP", "ADA", "LINK", "AVAX", "TON", "TRX", "NEAR"];
    const found = dsBiet.find((c) => new RegExp(`\\b${c}\\b`, "i").test(t));
    if (found) coin = found.toUpperCase();
  }
  if (coin) coin = coin.replace(/USDT$/i, "");

  // hướng (short ưu tiên kiểm trước)
  let side = null;
  if (/\b(short|sell|bán|bán)\b/i.test(t)) side = "short";
  else if (/\b(long|buy|mua)\b/i.test(t)) side = "long";

  // đòn bẩy
  let lev = null;
  m = t.match(/(\d{1,3})\s*[xX]\b/) || t.match(/[xX]\s*(\d{1,3})\b/) || t.match(/(?:đòn bẩy|leverage|lev)[^\d]*(\d{1,3})/i);
  if (m) lev = clamp(+m[1], 1, 125);

  const layGia = (patterns) => {
    for (const p of patterns) { const mm = t.match(p); if (mm) { const v = num(mm[1]); if (isFinite(v) && v > 0) return v; } }
    return null;
  };
  const entry = layGia([/(?:giá vào lệnh|giá vào lệnh|giá vào|entry|entry price)[^\d\-]*([\d.,]+)/i]);
  const current = layGia([/(?:giá cuối|giá cuối|giá hiện tại|giá đánh dấu|mark price|last price|current|last)[^\d\-]*([\d.,]+)/i]);
  const sl = layGia([/(?:\bsl\b|stop\s*loss|stoploss|cắt lỗ|dừng lỗ|cắt lỗ|dừng lỗ)[^\d\-]*([\d.,]+)/i]);
  const tp = layGia([/(?:\btp\b|take\s*profit|takeprofit|chốt lời|chốt lời|mục tiêu)[^\d\-]*([\d.,]+)/i]);
  let pnlPct = null;
  m = t.match(/([+\-]?\d+(?:[.,]\d+)?)\s*%/);
  if (m) pnlPct = parseFloat(m[1].replace(",", "."));

  if (!coin && !side && entry == null) return null;
  return { coin, side, lev, entry, current, sl, tp, pnlPct, raw: text };
}

/* ---------- OCR ảnh (lazy-load Tesseract từ CDN) ---------- */
function napScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("load fail"));
    document.head.appendChild(s);
  });
}
async function ocrAnh(file, onProgress) {
  if (!window.Tesseract) {
    try { await napScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"); } catch {}
  }
  if (!window.Tesseract) throw new Error("Không tải được bộ OCR (cần internet). Hãy gõ tay thông tin lệnh.");
  const { data } = await window.Tesseract.recognize(file, "eng", {
    logger: (mmm) => { if (mmm.status === "recognizing text" && onProgress) onProgress(mmm.progress); },
  });
  return data.text || "";
}

/* ---------- Phân tích lệnh người dùng ---------- */
async function phanTichLenhNguoiDung(trade) {
  const coin = trade.coin;
  let kq = null, whale = null, macro = null, rag = null, coData = true;
  if (coin) {
    try {
      const cache = SIGNAL_CACHE.get(coin);
      kq = (cache && Date.now() - cache.time < 5 * 60e3) ? cache : await phanTichCoin(coin);
    } catch { coData = false; }
    try { const w = WHALE_CACHE.get(coin); whale = (w && Date.now() - w.at < 5 * 60e3) ? w : await tinhWhaleScore(coin); WHALE_CACHE.set(coin, whale); } catch {}
    rag = (typeof RAG !== "undefined" && RAG.runs.get(coin)?.ketLuan) || null;
  }
  if (typeof CAL !== "undefined" && CAL.rows?.length) {
    macro = { pulse: tinhMacroPulse(CAL.rows), sap: suKienSapToi(CAL.rows) };
  }

  const giaLive = coin ? (PRICE_HUB?.gia(coin) ?? trade.current ?? trade.entry) : (trade.current ?? trade.entry);
  const side = trade.side || kq?.side || "long";
  const entry = trade.entry ?? giaLive;
  const aligned = kq?.side && side === kq.side;
  const opposed = kq?.side && side !== kq.side;

  let score = 50;
  const khuyenCao = [], khuyenNghi = [];

  /* 1. Đối chiếu tín hiệu SMC */
  if (!coin) khuyenCao.push({ m: "Không nhận ra coin trong lệnh — hãy nêu rõ mã (vd BTC, ERA).", loai: "warn" });
  else if (!coData) khuyenCao.push({ m: `Chưa lấy được dữ liệu nến ${coin} (coin lạ hoặc sàn không hỗ trợ) — phân tích giới hạn ở đòn bẩy/RR/quản lý vị thế.`, loai: "warn" });
  else if (aligned) { score += 12 + (kq.score / 100) * 13; khuyenNghi.push({ m: `Thuận tín hiệu hệ thống (${verdictLabel(kq.verdict)} · ${kq.score}đ · ${kq.phaseLabel}).`, loai: "ok" }); }
  else if (opposed) { score -= 12 + (kq.score / 100) * 13; khuyenCao.push({ m: `NGƯỢC tín hiệu: hệ thống thiên ${kq.side.toUpperCase()} (điểm ${kq.score}) nhưng bạn ${side.toUpperCase()}. Trade ngược cấu trúc rủi ro cao.`, loai: "bad" }); }
  else if (kq) khuyenNghi.push({ m: `Khung 4H ${biasLabel(kq.htf.bias)}, chưa có setup rõ (${kq.phaseLabel}) — vào lúc này là đón đầu.`, loai: "warn" });

  /* 2. RAG Auto */
  if (rag) {
    if (rag.goiY.toLowerCase() === side) { score += 15 * (rag.conf / 100); khuyenNghi.push({ m: `RAG Auto đồng thuận ${ragGoiYLabel(rag.goiY)} (tin cậy ${rag.conf}%).`, loai: "ok" }); }
    else if (rag.goiY !== "DUNG_NGOAI") { score -= 15 * (rag.conf / 100); khuyenCao.push({ m: `RAG Auto khuyên ${ragGoiYLabel(rag.goiY)} — ngược hướng lệnh của bạn.`, loai: "bad" }); }
  }

  /* 3. Vùng giá premium/discount */
  if (kq?.mtf?.range && entry) {
    const r = kq.mtf.range;
    const tot = (side === "long" && r.vung === "discount") || (side === "short" && r.vung === "premium");
    const xau = (side === "long" && r.vung === "premium") || (side === "short" && r.vung === "discount");
    if (tot) { score += 8; khuyenNghi.push({ m: `Vào ở vùng ${r.vung.toUpperCase()} (${r.viTriPct}%) — tối ưu cho ${side.toUpperCase()}.`, loai: "ok" }); }
    else if (xau) { score -= 8; khuyenCao.push({ m: `Giá đang ${r.vung.toUpperCase()} (${r.viTriPct}%) — ${side === "long" ? "mua đỉnh" : "bán đáy"} kém tối ưu, nên chờ hồi.`, loai: "warn" }); }
  }

  /* 4. Đòn bẩy */
  const lev = trade.lev || SETTINGS.risk.donBay;
  if (lev <= 3) score += 5;
  else if (lev <= 5) { khuyenNghi.push({ m: `Đòn bẩy x${lev} hơi cao so với hồ sơ 2–3x — cân nhắc giảm.`, loai: "warn" }); }
  else { score -= 10; khuyenCao.push({ m: `Đòn bẩy x${lev} QUÁ CAO — rủi ro thanh lý lớn, nên hạ về 2–3x.`, loai: "bad" }); }

  /* 5. R:R */
  let rr = null;
  if (trade.sl && trade.tp && entry) {
    const risk = Math.abs(entry - trade.sl);
    rr = risk > 0 ? Math.abs(trade.tp - entry) / risk : null;
    if (rr >= SETTINGS.risk.minRR) { score += 10; khuyenNghi.push({ m: `R:R 1:${rr.toFixed(2)} đạt chuẩn an toàn.`, loai: "ok" }); }
    else if (rr >= 1.5) { score += 2; khuyenNghi.push({ m: `R:R 1:${rr.toFixed(2)} dưới chuẩn 1:2 — nới TP hoặc siết SL.`, loai: "warn" }); }
    else { score -= 8; khuyenCao.push({ m: `R:R 1:${rr.toFixed(2)} quá thấp — không đáng để mạo hiểm.`, loai: "bad" }); }
  } else if (!trade.sl) {
    score -= 12; khuyenCao.push({ m: "Lệnh CHƯA có Stoploss — đây là lỗi kỷ luật nghiêm trọng nhất. Luôn đặt SL trước khi vào.", loai: "bad" });
  }

  /* 6. Whale */
  if (whale) {
    const dong = side === "long" ? whale.score >= 10 : whale.score <= -10;
    const nguoc = side === "long" ? whale.score <= -10 : whale.score >= 10;
    if (dong) { score += 8; khuyenNghi.push({ m: `Radar Cá Mập đồng thuận (Whale ${whale.score > 0 ? "+" : ""}${whale.score}).`, loai: "ok" }); }
    else if (nguoc) { score -= 8; khuyenCao.push({ m: `Dòng tiền cá mập NGƯỢC hướng (Whale ${whale.score > 0 ? "+" : ""}${whale.score}).`, loai: "warn" }); }
  }

  /* 6b. Dòng tiền đa sàn real-time (DataHub) */
  if (window.DataHub && DataHub.isRunning() && coin) {
    const fs = DataHub.flowScore(coin);
    const tl = window.DataHubBridge ? DataHubBridge.thanhLyGanDay(coin, 15) : null;
    const cs = DataHub.stats()?.coinStats?.[coin];
    const dong = side === "long" ? fs >= 15 : fs <= -15;
    const nguoc = side === "long" ? fs <= -15 : fs >= 15;
    if (dong) { score += 10; khuyenNghi.push({ m: `Dòng tiền đa sàn đồng thuận (điểm ${fs > 0 ? "+" : ""}${fs}${cs ? `, ${cs.count} lệnh lớn net ${fmtUsd(cs.buy - cs.sell)}` : ""}).`, loai: "ok" }); }
    else if (nguoc) { score -= 10; khuyenCao.push({ m: `Dòng tiền đa sàn NGƯỢC hướng (điểm ${fs > 0 ? "+" : ""}${fs}) — cá mập đang đi chiều khác.`, loai: "bad" }); }
    if (tl && tl.tong > 20e6) { score -= 6; khuyenCao.push({ m: `Thanh lý 15ph qua ${fmtUsd(tl.tong)} (long ${fmtUsd(tl.long)} / short ${fmtUsd(tl.short)}) — đang quét thanh khoản, dễ bị đá SL.`, loai: "warn" }); }
  }

  /* 6c. Liquidation Heatmap — nam châm giá */
  if (kq?.heatmap?.namCham) {
    const nc = kq.heatmap.namCham;
    const dong = (side === "long" && nc.huong === "len") || (side === "short" && nc.huong === "xuong");
    const nguoc = (side === "long" && nc.huong === "xuong") || (side === "short" && nc.huong === "len");
    if (dong) { score += 6; khuyenNghi.push({ m: `Heatmap thanh lý đồng thuận — nam châm ${nc.huong === "len" ? "hút lên" : "hút xuống"} (lệch ${Math.abs(nc.lechPct)}%).`, loai: "ok" }); }
    else if (nguoc) {
      score -= 6;
      const cum = side === "long" ? nc.cumGanNhatDuoi : nc.cumGanNhatTren;
      khuyenCao.push({ m: `Heatmap NGƯỢC hướng: thanh khoản lớn ${side === "long" ? "phía dưới" : "phía trên"}${cum ? ` tại ${fmtGia(cum.mid)} (${fmtUsd(cum.usd)})` : ""} — giá dễ quét vùng đó trước, cân nhắc chờ quét xong mới vào.`, loai: "warn" });
    }
  }

  /* 7. Macro / tin ★★★ / killzone — FIX v2.0: lịch cũ thì không trừ điểm/quyết định bằng tin cũ */
  const tinDangTin = lichConTuoi();
  if (!tinDangTin && CAL.rows?.length) khuyenNghi.push({ m: "Lịch kinh tế đã cũ — cảnh báo tin ★★★ tạm tắt, hãy cập nhật lịch.", loai: "warn" });
  if (tinDangTin && macro?.sap?.vungTin) { score -= 12; khuyenCao.push({ m: `🚨 Đang trong vùng tin ★★★ (${macro.sap.vungTin.iso} ${macro.sap.vungTin.suKien}) — né ±30 phút.`, loai: "bad" }); }
  else if (tinDangTin && macro?.sap?.nextBig && macro.sap.nextBig.ts - Date.now() < 60 * 60e3) khuyenNghi.push({ m: `Tin ★★★ sau ${fmtDemNguoc(macro.sap.nextBig.ts - Date.now())} — thận trọng.`, loai: "warn" });
  const kz = dangKillzone();
  if (kz.active) { score += 4; } else khuyenNghi.push({ m: "Ngoài killzone/giờ vàng — thanh khoản mỏng, tín hiệu dễ nhiễu.", loai: "warn" });

  /* 8. Áp dụng KIẾN THỨC đã tự học */
  let hoc = null;
  if (typeof dieuChinhKienThuc === "function") {
    hoc = dieuChinhKienThuc({ side, theoTinHieu: aligned ? true : opposed ? false : null, killzone: kz.active, lev, coin, score: kq?.score ?? null });
    if (hoc) {
      score += hoc.delta;
      for (const c of hoc.canhBao) khuyenCao.push({ m: "📚 Kinh nghiệm: " + c, loai: hoc.delta < 0 ? "warn" : "ok" });
    }
  }

  score = Math.round(clamp(score, 0, 100));
  const mucDo = score >= 70 ? "TOI_UU" : score >= 50 ? "KHA" : "RUI_RO";

  /* ---------- Quản lý vị thế đang mở (nếu có PnL/giá hiện tại) ---------- */
  const quanLy = [];
  const laViTheMo = trade.pnlPct != null || (trade.current && trade.entry);
  let pnlTinh = trade.pnlPct;
  if (pnlTinh == null && trade.current && trade.entry) {
    pnlTinh = (side === "long" ? trade.current - trade.entry : trade.entry - trade.current) / trade.entry * 100 * lev;
  }
  if (laViTheMo) {
    if (pnlTinh > 0) {
      if (!trade.sl) quanLy.push(`Đang lãi ${fmtPct(pnlTinh)} nhưng CHƯA có SL — đặt SL bảo vệ ngay (tối thiểu về hòa vốn ${fmtGia(entry)}).`);
      quanLy.push("Cân nhắc dời SL về hòa vốn và chốt một phần khi đạt +1R — 'đặt xong thì quên đi'.");
      if (opposed) quanLy.push("Đang lãi nhưng NGƯỢC hệ thống — nên chốt sớm, đừng tham gồng ngược xu hướng.");
    } else if (pnlTinh < 0) {
      quanLy.push("Đang lỗ — tuyệt đối KHÔNG trung bình giá xuống nếu kịch bản đã sai.");
      if (opposed) quanLy.push("Lỗ + ngược hệ thống — tôn trọng SL, cắt theo kế hoạch, không revenge trade.");
      else quanLy.push("Nếu cấu trúc chưa gãy, giữ theo SL ban đầu; gãy cấu trúc thì thoát sớm.");
    }
    if (lev > 5) quanLy.push(`Đòn bẩy x${lev} với vị thế đang mở — theo dõi sát giá thanh lý.`);
  }

  /* ---------- Giao dịch TỐT HƠN ---------- */
  const planSide = aligned ? side : (kq?.side || side);
  let better = null;
  if (kq?.plan && kq.plan.side === planSide) {
    better = { ...kq.plan, lev: Math.min(3, lev || 3), riskPct: Math.min(SETTINGS.risk.riskPct, 1), nguon: "Theo kế hoạch SMC của hệ thống" };
  } else if (coin) {
    const atr = kq?.ltf?.atr || giaLive * 0.01;
    const e = giaLive;
    const sl = planSide === "long" ? e - atr * 1.5 : e + atr * 1.5;
    const risk = Math.abs(e - sl);
    better = {
      side: planSide, entry: lamTron(e), entrySau: lamTron(e), sl: lamTron(sl),
      tp1: lamTron(planSide === "long" ? e + risk * 2 : e - risk * 2),
      tp2: lamTron(planSide === "long" ? e + risk * 3 : e - risk * 3),
      rr1: 2, rr2: 3, lev: Math.min(3, lev || 3), riskPct: Math.min(SETTINGS.risk.riskPct, 1),
      nguon: aligned ? "Chuẩn hóa lệnh của bạn theo kỷ luật" : "Đề xuất theo hướng hệ thống (" + (kq?.side ? kq.side.toUpperCase() : "—") + ")",
    };
  }

  const autoBook = mucDo === "TOI_UU" && aligned && !(tinDangTin && macro?.sap?.vungTin) && !!better;

  return {
    trade, coin, side, kq, whale, macro, rag, giaLive, entry, lev,
    score, mucDo, aligned, opposed, rr, pnlTinh, laViTheMo,
    khuyenCao, khuyenNghi, quanLy, better, autoBook,
  };
}

/* ================= UI trên Tổng quan ================= */
function veAdvisorPanel() {
  const box = $("#advisor-panel");
  if (!box) return;
  box.innerHTML = "";
  const card = el("div", { class: "card advisor-card" });
  card.appendChild(el("div", { class: "card-title" }, "🧠 Cố vấn lệnh — dán / gõ / import ảnh thẻ lệnh"));
  card.appendChild(el("p", { class: "muted small", style: "margin:0 0 8px" },
    "Dán ảnh P&L từ Binance/BingX/MEXC/OKX, gõ mô tả (vd “ERAUSDT Short 6X giá vào 0.09498 giá cuối 0.09376”), hoặc kéo-thả ảnh vào đây. Hệ thống quét SMC + RAG + Cá mập + Macro → chấm % tối ưu, khuyến cáo và gợi ý giao dịch tốt hơn."));

  const ta = el("textarea", { class: "input wide advisor-input", id: "advisor-text", rows: "3", placeholder: "VD: ERAUSDT Short 6X · giá vào lệnh 0.09498 · giá cuối 0.09376 · +7.70%\nHoặc: BTC long x3 entry 65000 sl 64200 tp 67000" });
  card.appendChild(ta);

  const inpFile = el("input", { type: "file", accept: "image/*", style: "display:none", id: "advisor-file" });
  inpFile.addEventListener("change", () => { if (inpFile.files?.[0]) xuLyAnh(inpFile.files[0]); });

  const bar = el("div", { class: "row-gap" },
    el("button", { class: "btn primary", id: "advisor-run", onclick: () => chayAdvisor(ta.value) }, "🔍 Phân tích lệnh"),
    el("button", { class: "btn", onclick: () => inpFile.click() }, "🖼️ Import ảnh (OCR)"),
    el("button", { class: "btn", onclick: () => { ta.value = ""; $("#advisor-result").innerHTML = ""; ADVISOR.ketQua = null; } }, "Xóa"),
    inpFile);
  card.appendChild(bar);
  card.appendChild(el("div", { class: "advisor-drop", id: "advisor-drop", html: "Kéo-thả hoặc dán (Ctrl+V) ảnh thẻ lệnh vào đây" }));
  card.appendChild(el("div", { id: "advisor-result" }));
  box.appendChild(card);

  // kéo-thả + dán ảnh
  const drop = $("#advisor-drop");
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) xuLyAnh(f); });
  ta.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) { e.preventDefault(); xuLyAnh(item.getAsFile()); }
  });
  if (ADVISOR.ketQua) veAdvisorKetQua(ADVISOR.ketQua);
}

async function xuLyAnh(file) {
  const res = $("#advisor-result");
  res.innerHTML = "";
  const st = el("div", { class: "note-box", id: "ocr-status" }, "🖼️ Đang đọc ảnh bằng OCR… 0%");
  res.appendChild(st);
  try {
    const text = await ocrAnh(file, (p) => { st.textContent = `🖼️ Đang đọc ảnh bằng OCR… ${Math.round(p * 100)}%`; });
    const parsed = parseTradeInput(text);
    st.remove();
    const ta = $("#advisor-text");
    if (parsed) {
      ta.value = [
        parsed.coin ? parsed.coin + "USDT" : "", parsed.side || "", parsed.lev ? "x" + parsed.lev : "",
        parsed.entry != null ? "giá vào " + parsed.entry : "", parsed.current != null ? "giá cuối " + parsed.current : "",
        parsed.sl != null ? "SL " + parsed.sl : "", parsed.tp != null ? "TP " + parsed.tp : "",
        parsed.pnlPct != null ? (parsed.pnlPct > 0 ? "+" : "") + parsed.pnlPct + "%" : "",
      ].filter(Boolean).join(" · ");
      res.appendChild(el("div", { class: "note-box" }, "✅ Đã đọc ảnh. Kiểm tra/sửa lại thông tin trong ô rồi bấm 🔍 Phân tích lệnh."));
      chayAdvisor(ta.value);
    } else {
      res.appendChild(el("div", { class: "warn-box" }, "Không nhận diện được thông tin lệnh từ ảnh. Hãy gõ tay giúp (mã coin, hướng, đòn bẩy, giá vào)."));
    }
  } catch (e) {
    st.className = "warn-box"; st.textContent = "⚠ " + (e.message || e);
  }
}

async function chayAdvisor(text) {
  if (ADVISOR.dangChay) return;
  const trade = parseTradeInput(text);
  const res = $("#advisor-result");
  if (!trade) { res.innerHTML = ""; res.appendChild(el("div", { class: "warn-box" }, "Chưa đủ thông tin. Nêu tối thiểu: mã coin + hướng (long/short). Ví dụ: “BTC long x3 entry 65000 sl 64200 tp 67000”.")); return; }
  ADVISOR.dangChay = true;
  const btn = $("#advisor-run"); if (btn) btn.disabled = true;
  res.innerHTML = "";
  res.appendChild(el("div", { class: "note-box", id: "advisor-loading" }, `⏳ Đang quét ${trade.coin || "lệnh"}: SMC đa khung + Whale + Macro…`));
  try {
    const kq = await phanTichLenhNguoiDung(trade);
    ADVISOR.ketQua = kq;
    veAdvisorKetQua(kq);
  } catch (e) {
    res.innerHTML = "";
    res.appendChild(el("div", { class: "warn-box" }, "Lỗi phân tích: " + (e.message || e)));
  } finally {
    ADVISOR.dangChay = false;
    if (btn) btn.disabled = false;
  }
}

function veAdvisorKetQua(kq) {
  const res = $("#advisor-result");
  if (!res) return;
  res.innerHTML = "";
  const cls = kq.mucDo === "TOI_UU" ? "long" : kq.mucDo === "RUI_RO" ? "short" : "prepare";
  const nhan = kq.mucDo === "TOI_UU" ? "🟢 LỆNH TỐI ƯU" : kq.mucDo === "RUI_RO" ? "🔴 RỦI RO CAO" : "🟡 CHẤP NHẬN ĐƯỢC — cần cải thiện";

  // Echo lệnh đã hiểu
  const t = kq.trade;
  res.appendChild(el("div", { class: "advisor-echo" },
    el("b", {}, `${kq.coin || "?"}/USDT · ${(kq.side || "?").toUpperCase()}${t.lev ? " x" + t.lev : ""}`),
    el("span", { class: "muted small" },
      (t.entry != null ? ` · vào ${fmtGia(t.entry)}` : "") +
      (t.current != null ? ` · hiện tại ${fmtGia(t.current)}` : "") +
      (t.sl != null ? ` · SL ${fmtGia(t.sl)}` : "") +
      (t.tp != null ? ` · TP ${fmtGia(t.tp)}` : "") +
      (kq.pnlTinh != null ? ` · PnL ${fmtPct(kq.pnlTinh)}` : ""))));

  // Gauge % tối ưu
  const g = el("div", { class: "advisor-score-wrap" },
    el("div", { class: `advisor-score ${cls}` }, kq.score + "%"),
    el("div", {},
      el("div", { class: `verdict ${cls}`, style: "margin:0" }, nhan),
      el("div", { class: "score-bar", style: "margin-top:8px;width:220px" },
        el("div", { class: "score-fill " + (kq.score >= 70 ? "hot" : kq.score >= 50 ? "warm" : ""), style: `width:${kq.score}%` })),
      el("div", { class: "muted small", style: "margin-top:4px" }, "% tối ưu = mức độ lệnh khớp với hệ thống SMC + RAG + Cá mập + Macro + kinh nghiệm đã học")));
  res.appendChild(g);

  // Khuyến cáo
  if (kq.khuyenCao.length) {
    const c = el("div", { class: "card sub" }, el("div", { class: "card-title" }, "⚠️ Khuyến cáo"));
    for (const k of kq.khuyenCao) c.appendChild(el("div", { class: "safety-item " + (k.loai === "bad" ? "bad" : "warn") }, el("span", {}, k.loai === "bad" ? "🔴" : "⚠️"), el("span", {}, k.m)));
    res.appendChild(c);
  }
  // Khuyến nghị
  if (kq.khuyenNghi.length) {
    const c = el("div", { class: "card sub" }, el("div", { class: "card-title" }, "💡 Khuyến nghị"));
    for (const k of kq.khuyenNghi) c.appendChild(el("div", { class: "safety-item " + (k.loai === "ok" ? "ok" : "warn") }, el("span", {}, k.loai === "ok" ? "✅" : "•"), el("span", {}, k.m)));
    res.appendChild(c);
  }
  // Quản lý vị thế đang mở
  if (kq.quanLy.length) {
    const c = el("div", { class: "card sub" }, el("div", { class: "card-title" }, "📌 Quản lý vị thế đang mở"));
    for (const q of kq.quanLy) c.appendChild(el("div", { class: "safety-item" }, el("span", {}, "→"), el("span", {}, q)));
    res.appendChild(c);
  }
  // Giao dịch tốt hơn
  if (kq.better) {
    const b = kq.better;
    const c = el("div", { class: "card sub plan-box " + b.side }, el("div", { class: "plan-title" }, `✨ Giao dịch tốt hơn — ${b.side.toUpperCase()} (${b.nguon})`),
      el("div", { class: "kv" }, el("span", {}, "Entry"), el("b", { class: "mono" }, fmtGia(b.entry))),
      el("div", { class: "kv" }, el("span", {}, "Stoploss"), el("b", { class: "mono down" }, fmtGia(b.sl))),
      el("div", { class: "kv" }, el("span", {}, `TP1 / TP2`), el("b", { class: "mono up" }, `${fmtGia(b.tp1)} / ${fmtGia(b.tp2)}`)),
      el("div", { class: "kv" }, el("span", {}, "Đòn bẩy · R:R · Risk"), el("b", { class: "mono" }, `x${b.lev} · 1:${b.rr1} · ${b.riskPct}%`)));
    res.appendChild(c);
  }

  // Auto-booking
  const act = el("div", { class: "row-gap" });
  if (kq.autoBook) {
    res.appendChild(el("div", { class: "note-box", style: "border-color:hsla(160,60%,45%,.5)" },
      "🤖 Lệnh THỎA yêu cầu hệ thống → sẵn sàng ", el("b", {}, "auto-booking"), ". Bấm để mở phiếu (đã điền theo kế hoạch tối ưu) — bạn xác nhận 2 bước rồi mới ghi nhận vào Bot."));
    act.appendChild(el("button", {
      class: "btn primary", onclick: () => moDatLenh({
        coin: kq.coin, side: kq.better.side,
        prefill: { entry: kq.better.entry, sl: kq.better.sl, tp: kq.better.tp1, lev: kq.better.lev, mode: "isolated", entryMode: "limit", riskPct: kq.better.riskPct },
      }),
    }, "🤖 Auto-booking → xác nhận đặt lệnh"));
  } else if (kq.better) {
    act.appendChild(el("button", {
      class: "btn", onclick: () => moDatLenh({
        coin: kq.coin, side: kq.better.side,
        prefill: { entry: kq.better.entry, sl: kq.better.sl, tp: kq.better.tp1, lev: kq.better.lev, mode: "isolated", entryMode: "limit", riskPct: kq.better.riskPct },
      }),
    }, "🛒 Mở phiếu lệnh theo gợi ý tốt hơn"));
    res.appendChild(el("div", { class: "muted small" }, kq.mucDo === "RUI_RO"
      ? "Lệnh hiện chưa đạt chuẩn auto-booking. Nếu vẫn muốn vào, hãy dùng phiếu lệnh với kế hoạch tốt hơn ở trên (qua kiểm tra an toàn 2 bước)."
      : "Chưa đủ chuẩn auto-booking — cải thiện theo khuyến nghị rồi phân tích lại, hoặc mở phiếu thủ công."));
  }
  if (kq.coin) act.appendChild(el("button", { class: "btn", onclick: () => { location.hash = `#/bieudo?coin=${kq.coin}`; } }, "Xem chart"));
  if (kq.coin) act.appendChild(el("button", { class: "btn", onclick: () => { location.hash = `#/ragauto?coin=${kq.coin}`; } }, "🧬 RAG Auto"));
  res.appendChild(act);
}
