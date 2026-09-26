/* ============================================================
 * Trade.2026 — Engine tín hiệu đa khung thời gian (4H → 1H → 15m)
 * Quy trình 5 bước của Mr.Bit:
 *   1. Chờ giá về vùng quan trọng trên khung lớn (POI: OB/FVG)
 *   2. Quan sát cú QUÉT THANH KHOẢN (stop hunt / spring)
 *   3. Xuống khung nhỏ chờ CHoCH thật (body close, có sweep trước, IDM)
 *   4. Vào lệnh tại retest POI / vùng Fibo OTE — SL sau wick sweep — TP theo RR
 *   5. Quản lý lệnh: dời SL về hòa vốn khi +1R
 * Máy trạng thái: wait_bias → wait_sweep → wait_choch → wait_retest
 *                → retest_in_progress → alert_ready | invalidated
 * ============================================================ */
"use strict";

const SIGNAL_CACHE = new Map(); // coin → kết quả phân tích mới nhất

const PHASE_LABELS = {
  wait_bias: "Chờ xu hướng rõ",
  wait_sweep: "Chờ quét thanh khoản",
  wait_choch: "Chờ CHoCH xác nhận",
  wait_retest: "Chờ hồi về POI",
  retest_in_progress: "Đang retest POI",
  alert_ready: "SẴN SÀNG VÀO LỆNH",
  invalidated: "Setup bị vô hiệu",
};

async function phanTichCoin(coin) {
  // 1) Tải nến 3 khung song song
  const [c4h, c1h, c15] = await Promise.all([
    fetchKlines(coin, TIMEFRAMES.HTF.binance, TIMEFRAMES.HTF.limit),
    fetchKlines(coin, TIMEFRAMES.MTF.binance, TIMEFRAMES.MTF.limit),
    fetchKlines(coin, TIMEFRAMES.LTF.binance, TIMEFRAMES.LTF.limit),
  ]);
  if (!c15.length || !c1h.length || !c4h.length) throw new Error("Thiếu dữ liệu nến");

  const gia = c15[c15.length - 1].close;
  const canhBao = [];

  /* ---------- KHUNG 4H: bias ---------- */
  const ct4h = phanTichCauTruc(c4h, TIMEFRAMES.HTF.swingL);
  const closes4h = c4h.map(c => c.close);
  const ema200_4h = emaLast(closes4h, 200);
  const ema50_4h = emaLast(closes4h, 50);
  let htfBias = "range";
  const ctBias = ct4h.bias;
  const emaBias = ema200_4h ? (gia > ema200_4h ? "bullish" : "bearish") : null;
  if (ctBias.startsWith("bullish") && emaBias === "bullish") htfBias = "bullish";
  else if (ctBias.startsWith("bearish") && emaBias === "bearish") htfBias = "bearish";
  else if (ctBias.startsWith("bullish") || (ctBias === "range" && emaBias === "bullish" && ema50_4h > ema200_4h)) htfBias = "bullish-yếu";
  else if (ctBias.startsWith("bearish") || (ctBias === "range" && emaBias === "bearish" && ema50_4h < ema200_4h)) htfBias = "bearish-yếu";

  const side = htfBias.startsWith("bullish") ? "long" : htfBias.startsWith("bearish") ? "short" : null;

  /* ---------- KHUNG 1H: bối cảnh POI + volume ---------- */
  const ct1h = phanTichCauTruc(c1h, TIMEFRAMES.MTF.swingL);
  const ob1h = timOrderBlocks(c1h);
  const fvg1h = timFVG(c1h);
  const vp = volumeProfile(c1h.slice(-120));
  const range1h = dealingRange(ct1h, gia);
  const eq1h = timEqualLevels(ct1h);

  /* ---------- KHUNG 15m: trigger ---------- */
  const ct15 = phanTichCauTruc(c15, TIMEFRAMES.LTF.swingL);
  const ob15 = timOrderBlocks(c15);
  const fvg15 = timFVG(c15);
  const sweep = timSweepGanNhat(c15, ct15);
  const sweepDungPhia = sweep && side && sweep.phia === side ? sweep : null;
  const choch = timChoCh(c15, ct15, sweepDungPhia, TIMEFRAMES.LTF.swingL);
  const idm = choch ? kiemTraIDM(c15, choch, sweepDungPhia) : false;
  const rsi15 = rsiReversal(c15.map(c => c.close), c15.map(c => c.high), c15.map(c => c.low));

  /* ---------- POI ---------- */
  const poi = side ? chonPOI({
    phia: side, chochLTF: choch, obLTF: ob15, obMTF: ob1h,
    fvgLTF: fvg15, fvgMTF: fvg1h, sweep: sweepDungPhia,
  }) : null;

  /* ---------- Máy trạng thái ---------- */
  const atr15 = atrLast(c15, 14) || gia * 0.002;
  let phase = "wait_bias";
  let retest = null;
  if (side) {
    phase = "wait_sweep";
    if (sweepDungPhia) phase = "wait_choch";
    if (choch) {
      phase = "wait_retest";
      if (poi) {
        const [zLo, zHi] = poi.zone;
        const tol = (zHi - zLo) * 0.15 + atr15 * 0.1;
        const trongVung = gia >= zLo - tol && gia <= zHi + tol;
        // kiểm tra các nến ĐÃ ĐÓNG sau CHoCH đã chạm vùng chưa (FIX v2.0: bỏ nến forming, chống repaint)
        let chamVung = false, giuVung = false, xuyenThung = false;
        for (let i = choch.index + 1; i < c15.length - 1; i++) {
          const c = c15[i];
          if (side === "long") {
            if (c.low <= zHi + tol) chamVung = true;
            if (chamVung && c.close > zHi) giuVung = true;
            if (c.close < zLo - atr15 * 0.5) { xuyenThung = true; break; }
          } else {
            if (c.high >= zLo - tol) chamVung = true;
            if (chamVung && c.close < zLo) giuVung = true;
            if (c.close > zHi + atr15 * 0.5) { xuyenThung = true; break; }
          }
        }
        if (xuyenThung) phase = "invalidated";
        else if (giuVung) { phase = "alert_ready"; retest = "held"; }
        else if (chamVung || trongVung) { phase = "retest_in_progress"; retest = "testing"; }
      }
    }
  }

  /* ---------- Kế hoạch giao dịch ---------- */
  let plan = null;
  if (side && poi && sweepDungPhia) {
    const [zLo, zHi] = poi.zone;
    const entry = side === "long" ? zHi : zLo;            // mép vùng POI
    const entrySau = (zLo + zHi) / 2;                     // giữa vùng (limit 2)
    const buffer = atr15 * 0.25;
    const sl = side === "long"
      ? Math.min(sweepDungPhia.wick, zLo) - buffer
      : Math.max(sweepDungPhia.wick, zHi) + buffer;
    const risk = Math.abs(entry - sl);
    if (risk > 0) {
      const tp1 = side === "long" ? entry + risk * SETTINGS.risk.minRR : entry - risk * SETTINGS.risk.minRR;
      const tp2 = side === "long" ? entry + risk * SETTINGS.risk.preferRR : entry - risk * SETTINGS.risk.preferRR;
      // TP thanh khoản: EQH/EQL hoặc đỉnh/đáy 1H đối diện
      let tpLiq = null;
      if (side === "long") {
        const ung = [...eq1h.eqh.map(e => e.gia), ct1h.dinhCuoi?.price].filter(v => v && v > entry);
        tpLiq = ung.length ? Math.min(...ung) : null;
      } else {
        const ung = [...eq1h.eql.map(e => e.gia), ct1h.dayCuoi?.price].filter(v => v && v < entry);
        tpLiq = ung.length ? Math.max(...ung) : null;
      }
      // Fibo OTE trên chân sweep→đỉnh CHoCH
      const ote = choch ? fiboOTE(sweepDungPhia.wick, choch.mucPhaVo, side) : null;
      const rr1 = SETTINGS.risk.minRR;
      const rrLiq = tpLiq ? Math.abs(tpLiq - entry) / risk : null;
      // Sizing theo vốn paper
      const von = (typeof PAPER_BOT !== "undefined" && PAPER_BOT?.state?.balance) || SETTINGS.risk.vonBanDau;
      const riskUsdt = von * SETTINGS.risk.riskPct / 100;
      const qty = riskUsdt / risk;
      plan = {
        side, entry: lamTron(entry), entrySau: lamTron(entrySau), sl: lamTron(sl),
        tp1: lamTron(tp1), tp2: lamTron(tp2), tpLiq: tpLiq ? lamTron(tpLiq) : null,
        rr1, rr2: SETTINGS.risk.preferRR, rrLiq: rrLiq ? +rrLiq.toFixed(2) : null,
        risk: lamTron(risk), ote,
        sizing: { riskUsdt: +riskUsdt.toFixed(2), qty: +qty.toFixed(6), giaTri: +(qty * entry).toFixed(2) },
      };
    }
  }

  /* ---------- Checklist chấm điểm ---------- */
  const kz = dangKillzone();
  const checklist = [];
  const push = (id, ten, dat, diem, max, ghiChu) => checklist.push({ id, ten, dat, diem, max, ghiChu });

  // 1. HTF bias (25)
  let dHtf = 0;
  if (htfBias === "bullish" || htfBias === "bearish") dHtf = CHECKLIST_WEIGHTS.htf_bias;
  else if (htfBias.endsWith("yếu")) dHtf = 15;
  push("htf_bias", "Xu hướng 4H rõ ràng", dHtf > 0, dHtf, CHECKLIST_WEIGHTS.htf_bias,
    `Cấu trúc: ${ctBias} · EMA200: ${emaBias || "—"}${ema200_4h ? ` (${fmtGia(ema200_4h)})` : ""}`);

  // 2. POI + discount/premium đúng phía (15)
  let dPoi = 0, ghiPoi = "Chưa có POI";
  if (poi) {
    dPoi = 8; ghiPoi = `${poi.nguon} [${fmtGia(poi.zone[0])} – ${fmtGia(poi.zone[1])}]`;
    if (range1h) {
      const dungVung = (side === "long" && range1h.vung === "discount") || (side === "short" && range1h.vung === "premium");
      if (dungVung) { dPoi = CHECKLIST_WEIGHTS.poi_context; ghiPoi += ` · Giá ở ${range1h.vung} ✓`; }
      else ghiPoi += ` · Giá ở ${range1h.vung} (${range1h.viTriPct}%)`;
    }
  }
  push("poi_context", "POI chất lượng + đúng vùng giá", dPoi >= 8, dPoi, CHECKLIST_WEIGHTS.poi_context, ghiPoi);

  // 3. Quét thanh khoản (20)
  push("liquidity_sweep", "Đã quét thanh khoản (stop hunt)", !!sweepDungPhia,
    sweepDungPhia ? CHECKLIST_WEIGHTS.liquidity_sweep : 0, CHECKLIST_WEIGHTS.liquidity_sweep,
    sweepDungPhia ? `Sweep ${sweepDungPhia.phia === "long" ? "đáy" : "đỉnh"} ${fmtGia(sweepDungPhia.mucQuet)} · wick ${fmtGia(sweepDungPhia.wick)}` : "Chưa có cú quét đúng hướng");

  // 4. CHoCH thật (15)
  let dChoch = 0, ghiChoch = "Chưa có CHoCH";
  if (choch) {
    dChoch = 5;
    ghiChoch = `CHoCH ${choch.phia} tại ${fmtGia(choch.mucPhaVo)}`;
    if (choch.bodyClose) { dChoch += 5; ghiChoch += " · body close ✓"; } else ghiChoch += " · chỉ wick ⚠";
    if (idm) { dChoch += 5; ghiChoch += " · IDM ✓"; }
  }
  push("fvg_quality", "CHoCH thật (lọc CHoCH giả)", dChoch >= 10, dChoch, CHECKLIST_WEIGHTS.fvg_quality, ghiChoch);

  // 5. Xác nhận khung nhỏ / retest (15)
  let dLtf = 0;
  if (retest === "held") dLtf = CHECKLIST_WEIGHTS.ltf_confirmation;
  else if (retest === "testing") dLtf = 7;
  push("ltf_confirmation", "Retest giữ vùng POI", dLtf >= 15, dLtf, CHECKLIST_WEIGHTS.ltf_confirmation,
    retest === "held" ? "Đã chạm POI và bật lại đúng hướng" : retest === "testing" ? "Giá đang trong vùng POI" : "Chưa hồi về POI");

  // 6. Risk/Reward (10)
  const rrOk = plan && plan.rr1 >= SETTINGS.risk.minRR;
  push("risk_reward", `R:R ≥ 1:${SETTINGS.risk.minRR}`, !!rrOk, rrOk ? CHECKLIST_WEIGHTS.risk_reward : 0,
    CHECKLIST_WEIGHTS.risk_reward, plan ? `RR kế hoạch 1:${plan.rr1}${plan.rrLiq ? ` · tới thanh khoản 1:${plan.rrLiq}` : ""}` : "Chưa dựng được kế hoạch");

  let score = checklist.reduce((a, c) => a + c.diem, 0);
  if (kz.active && side) { score += KILLZONE_BONUS; }
  score = clamp(score, 0, 100);

  /* ---------- Cảnh báo bổ sung ---------- */
  if (side === "long" && rsi15.rsi >= 70) canhBao.push(`RSI 15m ${fmtSo(rsi15.rsi, 0)} — quá mua, cẩn trọng đu đỉnh`);
  if (side === "short" && rsi15.rsi <= 30) canhBao.push(`RSI 15m ${fmtSo(rsi15.rsi, 0)} — quá bán, cẩn trọng bán đáy`);
  if (rsi15.reversal === "positive" && side === "short") canhBao.push("RSI có đảo chiều dương (thiên tăng) — ngược hướng SHORT");
  if (rsi15.reversal === "negative" && side === "long") canhBao.push("RSI có đảo chiều âm (thiên giảm) — ngược hướng LONG");
  if (range1h && side === "long" && range1h.vung === "premium") canhBao.push(`Giá ở PREMIUM (${range1h.viTriPct}%) — LONG kém tối ưu, chờ hồi về discount`);
  if (range1h && side === "short" && range1h.vung === "discount") canhBao.push(`Giá ở DISCOUNT (${range1h.viTriPct}%) — SHORT kém tối ưu, chờ hồi lên premium`);
  if (!kz.active) canhBao.push("Ngoài killzone/giờ vàng — thanh khoản thấp, tín hiệu dễ nhiễu");
  if (vp && Math.abs(gia - vp.poc) / gia < 0.004) canhBao.push(`Giá sát POC ${fmtGia(vp.poc)} — vùng tranh chấp, chờ thoát khỏi POC`);
  // Lịch kinh tế: né tin ★★★ (quy tắc ±30 phút)
  if (typeof CAL !== "undefined" && CAL.rows?.length) {
    const sap = suKienSapToi(CAL.rows, Date.now(), 6);
    if (sap.vungTin) canhBao.push(`🚨 ĐANG trong vùng tin ★★★ (${sap.vungTin.iso} · ${sap.vungTin.suKien}) — không vào lệnh mới ±30 phút`);
    else if (sap.nextBig && sap.nextBig.ts - Date.now() < 60 * 60e3) canhBao.push(`⏰ Tin ★★★ ${sap.nextBig.iso} · ${sap.nextBig.suKien} sau ${fmtDemNguoc(sap.nextBig.ts - Date.now())} — tránh mở lệnh sát giờ tin`);
  }

  /* ---------- Dòng tiền real-time (DataHub) — mapping vào trường phân tích ---------- */
  let dongTien = null;
  try {
    if (window.DataHub && DataHub.isRunning()) {
      const fs = DataHub.flowScore(coin);
      const st = DataHub.stats();
      const cs = st?.coinStats?.[coin] || null;
      const tl = window.DataHubBridge ? DataHubBridge.thanhLyGanDay(coin, 15) : null;
      const dhGia = DataHub.prices()?.[coin]?.gia ?? null;
      dongTien = {
        score: fs,
        huong: fs >= 15 ? "mua" : fs <= -15 ? "bán" : "trung lập",
        lenhLon: cs ? { count: cs.count, buy: cs.buy, sell: cs.sell, net: cs.buy - cs.sell } : null,
        thanhLy15p: tl,
        giaDataHub: dhGia,
        dongThuan: side ? ((side === "long" && fs >= 15) || (side === "short" && fs <= -15)) : null,
        nguoc: side ? ((side === "long" && fs <= -15) || (side === "short" && fs >= 15)) : null,
      };
      if (dongTien.nguoc) canhBao.push(`🌊 Dòng tiền real-time NGƯỢC hướng (điểm ${fs > 0 ? "+" : ""}${fs}${cs ? `, lệnh lớn mua ${fmtUsd(cs.buy)} / bán ${fmtUsd(cs.sell)}` : ""})`);
      if (tl && tl.tong > 20e6) canhBao.push(`💥 Thanh lý mạnh 15 phút qua ${fmtUsd(tl.tong)} (long ${fmtUsd(tl.long)} / short ${fmtUsd(tl.short)}) — đang quét thanh khoản, chờ ổn định`);
      if (dhGia && gia && Math.abs(dhGia - gia) / gia > 0.004) canhBao.push(`Giá lệch giữa các sàn ${fmtPct((dhGia - gia) / gia * 100)} — kiểm tra lại trước khi vào`);
    }
  } catch (e) {}

  /* ---------- Liquidation Heatmap — nam châm giá (mapping vào phân tích) ---------- */
  let heatmap = null;
  try {
    if (typeof heatmapChoEngine === "function") {
      heatmap = await heatmapChoEngine(coin);
      if (heatmap?.namCham) {
        const nc = heatmap.namCham;
        if (nc.huong === "len" && nc.cumGanNhatTren)
          canhBao.push(`🧲 Nam châm thanh lý PHÍA TRÊN tại ${fmtGia(nc.cumGanNhatTren.mid)} (${fmtUsd(nc.cumGanNhatTren.usd)}) — giá dễ bị hút lên quét cụm này`);
        else if (nc.huong === "xuong" && nc.cumGanNhatDuoi)
          canhBao.push(`🧲 Nam châm thanh lý PHÍA DƯỚI tại ${fmtGia(nc.cumGanNhatDuoi.mid)} (${fmtUsd(nc.cumGanNhatDuoi.usd)}) — giá dễ bị hút xuống quét cụm này`);
        if (side === "long" && nc.huong === "xuong") canhBao.push("Heatmap nghiêng HÚT XUỐNG — LONG dễ bị quét, ưu tiên chờ quét cụm dưới xong mới vào");
        if (side === "short" && nc.huong === "len") canhBao.push("Heatmap nghiêng HÚT LÊN — SHORT dễ bị quét, ưu tiên chờ quét cụm trên xong mới vào");
      }
    }
  } catch (e) {}

  /* TP nam châm: cụm thanh lý lớn gần nhất theo hướng lệnh làm mục tiêu bổ sung */
  if (plan && heatmap?.namCham) {
    const nc = heatmap.namCham;
    const cum = plan.side === "long" ? nc.cumGanNhatTren : nc.cumGanNhatDuoi;
    if (cum) {
      const rrNC = plan.risk > 0 ? Math.abs(cum.mid - plan.entry) / plan.risk : null;
      plan.tpNamCham = lamTron(cum.mid);
      plan.rrNamCham = rrNC ? +rrNC.toFixed(2) : null;
      plan.usdNamCham = cum.usd;
    }
  }

  /* Dòng tiền đồng thuận/ngược → tinh chỉnh điểm hợp lưu (±5) TRƯỚC khi chấm verdict */
  if (dongTien) {
    if (dongTien.dongThuan) score = clamp(score + 5, 0, 100);
    else if (dongTien.nguoc) score = clamp(score - 5, 0, 100);
  }

  /* ---------- Phái sinh: funding / OI / thanh lý / volatility (v2.1.0) ----------
   * Logic từ skills Vibe-Trading: perp-funding-basis, liquidation-heatmap,
   * volatility. Funding quá nóng ngược hướng lệnh → trừ điểm, contrarian → cộng. */
  let phaiSinh = null;
  try {
    if (typeof phanTichPhaiSinh === "function") {
      phaiSinh = await phanTichPhaiSinh(coin, { side, dongCua1h: c1h.map(c => c.close) });
      if (phaiSinh) {
        for (const cb of phaiSinh.canhBao) canhBao.push(cb);
        if (side && phaiSinh.dieuChinh) score = clamp(score + phaiSinh.dieuChinh, 0, 100);
      }
    }
  } catch (e) {}

  /* ---------- Verdict ---------- */
  let verdict = "NO_TRADE";
  if (!side) verdict = "NO_TRADE";
  else if (phase === "invalidated") verdict = "NO_TRADE";
  else if (score >= VERDICT.ALERT && (phase === "alert_ready" || phase === "retest_in_progress")) verdict = side === "long" ? "LONG" : "SHORT";
  else if (score >= VERDICT.PREPARE) verdict = "PREPARE";
  else if (side && !choch) verdict = "WAIT_CONFIRM";

  const ketQua = {
    coin, gia, time: Date.now(), dongTien, heatmap, phaiSinh,
    htf: { bias: htfBias, ctBias, ema200: ema200_4h, ema50: ema50_4h, dinh: ct4h.dinhCuoi?.price, day: ct4h.dayCuoi?.price },
    mtf: { obCount: ob1h.filter(o => !o.mitigated).length, poc: vp?.poc, hvn: vp?.hvn || [], range: range1h, eq: eq1h },
    ltf: { sweep: sweepDungPhia, choch, idm, rsi: rsi15, atr: atr15 },
    side, phase, phaseLabel: PHASE_LABELS[phase], retest,
    score, checklist, verdict, killzone: kz, canhBao,
    poi, plan,
    candles15: c15.slice(-90),
    ob15: ob15.filter(o => !o.mitigated).slice(-4),
    fvg15: fvg15.filter(g => !g.filled).slice(-4),
  };
  SIGNAL_CACHE.set(coin, ketQua);
  /* v2.2.0: tự ghi nhận tín hiệu LONG/SHORT vào Nhật ký để chấm điểm & học Kaizen */
  try { if (typeof JOURNAL !== "undefined" && JOURNAL.ghiNhan) JOURNAL.ghiNhan(ketQua); } catch (e) {}
  document.dispatchEvent(new CustomEvent("siro:signal", { detail: ketQua }));
  return ketQua;
}

/* Nhãn verdict tiếng Việt */
function verdictLabel(v) {
  return v === "LONG" ? "🟢 LONG" : v === "SHORT" ? "🔴 SHORT"
    : v === "PREPARE" ? "🟡 CHUẨN BỊ" : v === "WAIT_CONFIRM" ? "⏳ CHỜ XÁC NHẬN" : "⚪ ĐỨNG NGOÀI";
}
