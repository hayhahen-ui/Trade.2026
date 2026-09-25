/* ============================================================
 * Trade.2026 — RAG AUTO (Agentic RAG + Corrective RAG / CRAG)
 * Mô hình theo "Top 5 RAG Architectures 2026":
 *
 *   Query(coin) → 🧭 Planner → [5 Tool Agents CHẠY SONG SONG]
 *        📡 Market & Structure (nến 3 khung + SMC engine)
 *        🐋 Whale Flow (OKX rubik)
 *        🌊 Dòng tiền đa sàn (DataHub real-time)
 *        📰 Macro News (lịch kinh tế TE)
 *        📚 Knowledge Retriever (truy xuất playbook SMC)
 *   → ⚖️ Evaluator/Grader (CRAG): CORRECT / AMBIGUOUS / INCORRECT
 *        AMBIGUOUS → truy xuất lại (tối đa 2 vòng)
 *        INCORRECT → NO_TRADE (không tin dữ liệu xấu)
 *   → 🧠 Reasoner (hợp nhất trọng số — xem RAG_WEIGHTS trong config.js:
 *        SMC .35 · Whale .20 · Dòng tiền .20 · Macro .15 · Momentum .10,
 *        cộng điều chỉnh 🧲 heatmap ±.06) + disagreement index
 *   → 🛡️ Risk Manager → Final Answer: gợi ý LONG / SHORT / ĐỨNG NGOÀI + độ tin cậy
 * ============================================================ */
"use strict";

const RAG = { runs: new Map(), coinDangChon: "BTC", seq: 0, lastDrawn: {} };

/* ---------- Truy xuất kiến thức (mini-RAG trên playbook KIEN_THUC) ---------- */
function truyXuatKienThuc(kq) {
  const chunks = [];
  const push = (ten, trich, viSao) => chunks.push({ ten, trich, viSao });
  if (!kq) return chunks;
  if (kq.ltf.sweep && !kq.ltf.choch)
    push("B3 — Xác nhận (Confirm)", KIEN_THUC.quyTrinh5Buoc[2].mota, "Đã có sweep, đang thiếu CHoCH");
  if (!kq.ltf.sweep && kq.side)
    push("B2 — Quan sát (Watch)", KIEN_THUC.quyTrinh5Buoc[1].mota, "Setup đang chờ cú quét thanh khoản");
  if (kq.mtf.range && ((kq.side === "long" && kq.mtf.range.vung === "premium") || (kq.side === "short" && kq.mtf.range.vung === "discount")))
    push("Premium / Discount", KIEN_THUC.congCu.find(c => c.ten.includes("Premium")).mota, `Giá đang ở ${kq.mtf.range.vung} (${kq.mtf.range.viTriPct}%) — ngược vùng tối ưu`);
  if (kq.phase === "alert_ready")
    push("B4+B5 — Vào lệnh & Quên đi", KIEN_THUC.quyTrinh5Buoc[3].mota + " " + KIEN_THUC.quyTrinh5Buoc[4].mota, "Setup đã sẵn sàng — kỷ luật thực thi");
  if (kq.ltf.rsi?.zone === "quá mua" || kq.ltf.rsi?.zone === "quá bán")
    push("RSI Cardwell", KIEN_THUC.congCu.find(c => c.ten.includes("RSI")).mota, `RSI 15m đang ${kq.ltf.rsi.zone}`);
  if (!kq.killzone?.active)
    push("Phiên & thời điểm", KIEN_THUC.phien[3].dacDiem + " (GIỜ VÀNG 19–22h VN)", "Đang ngoài killzone — thanh khoản mỏng");
  push("Quản trị rủi ro", "Rủi ro tối đa 1–2% mỗi lệnh · R:R tối thiểu 1:2 · ngắt mạch khi lỗ 3–5%/ngày", "Luôn áp dụng");
  return chunks.slice(0, 5);
}

/* ---------- Pipeline chính ---------- */
async function ragPipeline(coin, opts = {}) {
  const run = { coin, batDau: Date.now(), buoc: [], loop: 0, ketLuan: null, trangThai: "running", ms: 0, seq: ++RAG.seq };
  RAG.runs.set(coin, run);
  const phat = () => document.dispatchEvent(new CustomEvent("siro:rag", { detail: run }));
  // FIX v2.0 (M4): pipeline cũ bị pipeline mới hơn thay thế → dừng sớm, đỡ tốn API
  const conHieuLuc = () => RAG.runs.get(coin)?.seq === run.seq;

  async function chay(agent, emoji, nhom, fn) {
    const b = { agent, emoji, nhom, trangThai: "running", tomTat: "…", ms: 0, batDau: Date.now() };
    run.buoc.push(b); phat();
    try {
      const out = await fn(b);
      b.trangThai = "ok"; b.ms = Date.now() - b.batDau; phat();
      return out;
    } catch (e) {
      b.trangThai = "err"; b.tomTat = "⚠ " + (e.message || e); b.ms = Date.now() - b.batDau; phat();
      return null;
    }
  }

  /* 1 — PLANNER */
  await chay("Planner", "🧭", "plan", (b) => {
    b.tomTat = `Truy vấn: ${coin}/USDT · kế hoạch truy xuất: nến 4H/1H/15m + giá đa sàn → SMC engine · whale OKX · dòng tiền DataHub · lịch macro · playbook SMC. Chấm CRAG trước khi tin.`;
  });

  let kq = null, whale = null, macro = null, chunks = [], grade = null, flow = null;

  /* Vòng lặp CRAG: agent loops until confident (tối đa 2 vòng) */
  for (let loop = 1; loop <= 2; loop++) {
    run.loop = loop;

    kq = await chay("Market & Structure", "📡", "tool", async (b) => {
      const cache = SIGNAL_CACHE.get(coin);
      const r = (!opts.force && cache && Date.now() - cache.time < 5 * 60e3) ? cache : await phanTichCoin(coin);
      b.tomTat = `Giá ${fmtGia(PRICE_HUB?.gia(coin) ?? r.gia)} · bias 4H ${biasLabel(r.htf.bias)} · ${r.phaseLabel} · điểm SMC ${r.score}/100 · ${verdictLabel(r.verdict)}`;
      return r;
    }) || kq;
    if (!conHieuLuc()) return null;

    /* FIX v2.0 (M1): 4 agent độc lập chạy SONG SONG — giảm latency ~60-70% */
    const [rw, rf, rm, rc] = await Promise.allSettled([
      chay("Whale Flow", "🐋", "tool", async (b) => {
        const cache = WHALE_CACHE.get(coin);
        const w = (cache && Date.now() - cache.at < 5 * 60e3) ? cache : await tinhWhaleScore(coin);
        WHALE_CACHE.set(coin, w);
        b.tomTat = `Whale Score ${w.score > 0 ? "+" : ""}${w.score} — ${w.nhan.replace("🐋 ", "")}`;
        return w;
      }),
      chay("Dòng tiền đa sàn (DataHub)", "🌊", "tool", (b) => {
        if (!window.DataHub || !DataHub.isRunning()) throw new Error("DataHub chưa chạy");
        const fs = DataHub.flowScore(coin);
        const st = DataHub.stats();
        const cs = st?.coinStats?.[coin] || null;
        const tl = window.DataHubBridge ? DataHubBridge.thanhLyGanDay(coin, 15) : null;
        const nguon = DataHub.sources().filter((s) => s.status === "on").length;
        let hmNote = "", hmNC = null;
        try {
          hmNC = SIGNAL_CACHE.get(coin)?.heatmap?.namCham || null;
          if (hmNC && hmNC.huong !== "can_bang")
            hmNote = ` · 🧲 heatmap ${hmNC.huong === "len" ? "hút lên" : "hút xuống"} (lệch ${Math.abs(hmNC.lechPct)}%)`;
        } catch (e) {}
        b.tomTat = `Điểm dòng tiền ${fs > 0 ? "+" : ""}${fs} · ${cs ? `${cs.count} lệnh lớn, mua ${fmtUsd(cs.buy)} / bán ${fmtUsd(cs.sell)}` : "chưa có lệnh lớn"}${tl && tl.tong ? ` · thanh lý 15ph ${fmtUsd(tl.tong)}` : ""}${hmNote} · ${nguon} nguồn đang chạy`;
        return { score: fs, coinStats: cs, thanhLy: tl, nguon, heatmapNC: hmNC };
      }),
      chay("Macro News", "📰", "tool", async (b) => {
        await taiLichKinhTe();
        if (!CAL.rows.length) throw new Error("Chưa có dữ liệu lịch kinh tế");
        const p = tinhMacroPulse(CAL.rows);
        const s = suKienSapToi(CAL.rows);
        b.tomTat = `Macro Pulse ${p.score > 0 ? "+" : ""}${p.score} (${p.nhan.replace(/🌊|⛈️/g, "").trim()}) · ${s.vungTin ? "🚨 ĐANG trong vùng tin ★★★" : s.nextBig ? `tin ★★★ kế tiếp sau ${fmtDemNguoc(s.nextBig.ts - Date.now())}` : "không có tin ★★★ trong 72h"}`;
        return { p, s };
      }),
      chay("Knowledge Retriever", "📚", "tool", (b) => {
        const c = truyXuatKienThuc(kq);
        b.tomTat = c.length ? `Trích ${c.length} quy tắc khớp bối cảnh: ${c.map(x => x.ten).join(" · ")}` : "Không có quy tắc đặc thù";
        return c;
      }),
    ]);
    whale = (rw.status === "fulfilled" ? rw.value : null) || whale;
    flow = (rf.status === "fulfilled" ? rf.value : null) || flow;
    macro = (rm.status === "fulfilled" ? rm.value : null) || macro;
    chunks = (rc.status === "fulfilled" ? rc.value : null) || chunks;
    if (!conHieuLuc()) return null;

    /* EVALUATOR / GRADER (CRAG) — FIX v2.0 (M2): chấm đủ 5 lớp, thiếu lớp nào cũng AMBIGUOUS */
    grade = await chay("Evaluator (CRAG)", "⚖️", "grade", (b) => {
      const thieu = [];
      if (!whale) thieu.push("Whale");
      if (!flow) thieu.push("Dòng tiền");
      if (!macro) thieu.push("Macro");
      if (!chunks || !chunks.length) thieu.push("Knowledge");
      const cu = kq && Date.now() - kq.time > 10 * 60e3;
      if (cu) thieu.push("SMC (dữ liệu cũ)");
      let g;
      if (!kq) g = "INCORRECT";
      else if (thieu.length) g = "AMBIGUOUS";
      else g = "CORRECT";
      b.tomTat = g === "CORRECT"
        ? "✅ CORRECT — đủ 5 lớp dữ liệu và tươi, tin cậy cao → sang Reasoner"
        : g === "AMBIGUOUS"
          ? `🟡 AMBIGUOUS — thiếu ${thieu.join(", ")} → ${loop < 2 ? "truy xuất lại (loop " + (loop + 1) + ")" : "hết vòng lặp, hạ độ tin cậy"}`
          : "🔴 INCORRECT — thiếu dữ liệu cấu trúc cốt lõi → ĐỨNG NGOÀI (không tin dữ liệu xấu)";
      return g;
    });
    if (grade !== "AMBIGUOUS") break;
  }
  if (!conHieuLuc()) return null;

  /* REASONER — hợp nhất trọng số (xem RAG_WEIGHTS trong config.js) */
  const ketLuan = (await chay("Reasoner", "🧠", "reason", (b) => {
    if (!kq || grade === "INCORRECT") {
      b.tomTat = "Không đủ dữ liệu tin cậy → ĐỨNG NGOÀI. Bảo toàn vốn cũng là một vị thế.";
      return { goiY: "DUNG_NGOAI", conf: 0, vote: 0, grade, thanhPhan: [] };
    }
    const smcDir = kq.side === "long" ? 1 : kq.side === "short" ? -1 : 0;
    const thanhPhan = [];
    let vote = 0;
    const add = (ten, giaTri, trongSo, ghiChu) => {
      const d = giaTri * trongSo;
      vote += d;
      thanhPhan.push({ ten, diem: +d.toFixed(3), ghiChu });
    };
    add("SMC (cấu trúc)", smcDir * (kq.score / 100), RAG_WEIGHTS.smc, `${kq.side || "trung lập"} · ${kq.score}/100`);
    if (whale) add("Whale Flow (OKX)", whale.score / 100, RAG_WEIGHTS.whale, `score ${whale.score}`);
    if (flow) add("Dòng tiền đa sàn", flow.score / 100, RAG_WEIGHTS.flow,
      `điểm ${flow.score > 0 ? "+" : ""}${flow.score}${flow.coinStats ? ` · net ${fmtUsd(flow.coinStats.buy - flow.coinStats.sell)}` : ""}`);
    if (flow?.heatmapNC && flow.heatmapNC.huong !== "can_bang")
      add("🧲 Heatmap thanh lý (±điều chỉnh)", flow.heatmapNC.huong === "len" ? 0.6 : -0.6, RAG_HEATMAP_ADJ,
        `nam châm ${flow.heatmapNC.huong === "len" ? "hút lên" : "hút xuống"} · lệch ${Math.abs(flow.heatmapNC.lechPct)}%`);
    if (macro) add("Macro Pulse", macro.p.score / 100, RAG_WEIGHTS.macro, `pulse ${macro.p.score}`);
    const rsi = kq.ltf.rsi;
    let mom = 0, momGhi = "trung tính";
    if (rsi?.reversal === "positive") { mom = 0.6; momGhi = "đảo chiều dương"; }
    else if (rsi?.reversal === "negative") { mom = -0.6; momGhi = "đảo chiều âm"; }
    else if (rsi?.zone === "vùng tăng") { mom = 0.3; momGhi = "RSI vùng tăng"; }
    else if (rsi?.zone === "vùng giảm") { mom = -0.3; momGhi = "RSI vùng giảm"; }
    add("Momentum (RSI)", mom, RAG_WEIGHTS.momentum, momGhi);

    let goiY = "DUNG_NGOAI";
    const lyDo = [];
    if (vote >= RAG_NGUONG_VOTE && smcDir >= 0) goiY = "LONG";
    else if (vote <= -RAG_NGUONG_VOTE && smcDir <= 0) goiY = "SHORT";
    else if (Math.abs(vote) >= RAG_NGUONG_VOTE) lyDo.push("Các lớp mâu thuẫn với cấu trúc SMC → đứng ngoài (không trade ngược cấu trúc)");
    if (lichConTuoi() && macro?.s?.vungTin && goiY !== "DUNG_NGOAI") { goiY = "DUNG_NGOAI"; lyDo.push("Đang trong vùng tin ★★★ ±30ph — kỷ luật né tin"); }
    if (flow?.thanhLy && flow.thanhLy.tong > 20e6 && goiY !== "DUNG_NGOAI") {
      goiY = "DUNG_NGOAI";
      lyDo.push(`Thanh lý 15 phút qua ${fmtUsd(flow.thanhLy.tong)} — thị trường đang quét thanh khoản, chờ ổn định`);
    }
    let conf = Math.round(Math.min(1, Math.abs(vote) / 0.5) * 100);
    if (grade === "AMBIGUOUS") conf = Math.round(conf * 0.7);
    /* FIX v2.0 — disagreement index: các lớp lớn mâu thuẫn nhau thì hạ tin cậy,
       không để vote triệt tiêu lẫn nhau một cách mù */
    const dongGopLon = thanhPhan.filter(t => Math.abs(t.diem) > 0.08);
    if (dongGopLon.some(t => t.diem > 0) && dongGopLon.some(t => t.diem < 0)) {
      lyDo.push("Các lớp phân tích lớn đang mâu thuẫn nhau — độ tin cậy bị hạ một nửa, cân nhắc đứng ngoài");
      conf = Math.round(conf * 0.5);
    }
    b.tomTat = `Vote ${vote >= 0 ? "+" : ""}${vote.toFixed(3)} → ${goiY === "LONG" ? "🟢 LONG" : goiY === "SHORT" ? "🔴 SHORT" : "⚪ ĐỨNG NGOÀI"} · tin cậy ${conf}%${lyDo.length ? " · " + lyDo[0] : ""}`;
    return { goiY, conf, vote: +vote.toFixed(3), grade, thanhPhan, lyDo };
  })) || { goiY: "DUNG_NGOAI", conf: 0, vote: 0, grade, thanhPhan: [], lyDo: ["Reasoner gặp lỗi — đứng ngoài an toàn"] };
  // FIX v2.0 (m4): Reasoner throw thì không để UI in "tin cậy undefined%"

  /* RISK MANAGER */
  await chay("Risk Manager", "🛡️", "risk", (b) => {
    if (!ketLuan || ketLuan.goiY === "DUNG_NGOAI") { b.tomTat = "Đứng ngoài — không cần sizing. Chờ setup đạt chuẩn."; return; }
    const p = kq?.plan;
    const gate = typeof PAPER_BOT !== "undefined" && PAPER_BOT ? PAPER_BOT.kiemTraKyLuat(kq) : [];
    b.tomTat = p
      ? `Kế hoạch: E ${fmtGia(p.entry)} · SL ${fmtGia(p.sl)} · TP1 ${fmtGia(p.tp1)} (RR 1:${p.rr1}) · risk ${SETTINGS.risk.riskPct}% = ${fmtUsd(p.sizing.riskUsdt)} · KL ${p.sizing.qty} ${coin}${gate.length ? " · ⚠ Bot gate: " + gate[0] : " · kỷ luật OK"}`
      : "Chưa dựng được kế hoạch entry/SL/TP — chỉ theo dõi, chưa vào lệnh";
  });

  run.ketLuan = { ...ketLuan, plan: kq?.plan || null, score: kq?.score ?? 0, chunks, kq };
  run.trangThai = "done";
  run.ms = Date.now() - run.batDau;
  phat();
  return run;
}

function ragGoiYLabel(g) {
  return g === "LONG" ? "🟢 GỢI Ý LONG" : g === "SHORT" ? "🔴 GỢI Ý SHORT" : "⚪ ĐỨNG NGOÀI";
}

/* ================= MÀN HÌNH RAG AUTO ================= */
function renderRagAuto(root, params = {}) {
  if (params.coin) RAG.coinDangChon = params.coin;
  root.innerHTML = "";
  root.appendChild(el("div", { class: "note-box" },
    "🧬 Kiến trúc ", el("b", {}, "Agentic RAG + Corrective RAG (CRAG)"), " — Planner lập kế hoạch truy xuất, các Tool Agent thu thập song song, ",
    el("b", {}, "Evaluator chấm CORRECT / AMBIGUOUS / INCORRECT"), " (lặp tới khi đủ tin cậy, không tin dữ liệu xấu), Reasoner hợp nhất trọng số → gợi ý cuối cùng kèm Risk Manager."));

  const bar = el("div", { class: "toolbar" });
  const sel = el("select", { class: "input", onchange: (e) => { RAG.coinDangChon = e.target.value; renderRagAuto(root); } });
  for (const c of SETTINGS.watchlist) sel.appendChild(el("option", { value: c, ...(c === RAG.coinDangChon ? { selected: "" } : {}) }, `${c}/USDT`));
  bar.appendChild(el("label", { class: "muted small" }, "Coin: "));
  bar.appendChild(sel);
  bar.appendChild(el("button", {
    class: "btn primary", onclick: (e) => {
      e.target.disabled = true;
      ragPipeline(RAG.coinDangChon, { force: true }).finally(() => { e.target.disabled = false; });
    },
  }, "▶ Chạy pipeline"));
  bar.appendChild(el("span", { class: "muted small" },
    // FIX v2.0 (C2): trọng số render từ RAG_WEIGHTS (nguồn sự thật duy nhất), không hard-code
    "Trọng số: " + Object.entries(RAG_WEIGHTS).map(([k, v]) => `${k.toUpperCase()} ${Math.round(v * 100)}%`).join(" · ")
    + ` (+🧲 heatmap ±${Math.round(RAG_HEATMAP_ADJ * 100)}%)`));
  root.appendChild(bar);

  root.appendChild(el("div", { id: "rag-flow" }));
  root.appendChild(el("div", { id: "rag-ketluan" }));
  veRagRun(RAG.runs.get(RAG.coinDangChon) || null);
  if (!RAG.runs.get(RAG.coinDangChon)) ragPipeline(RAG.coinDangChon);
}

function veRagRun(run) {
  const flow = $("#rag-flow");
  const kl = $("#rag-ketluan");
  if (!flow || !kl) return;
  flow.innerHTML = ""; kl.innerHTML = "";
  if (!run) { flow.appendChild(el("p", { class: "muted" }, "Chưa có phiên chạy — bấm ▶ Chạy pipeline.")); return; }
  // FIX v2.0 (M4): chỉ vẽ run mới nhất của coin — run cũ đến trễ thì bỏ qua
  if ((RAG.lastDrawn[run.coin] || 0) > run.seq) return;
  RAG.lastDrawn[run.coin] = run.seq;

  const card = el("div", { class: "card" });
  card.appendChild(el("div", { class: "card-title" },
    `🧬 Pipeline ${run.coin}/USDT · vòng lặp CRAG: ${run.loop} · ${run.trangThai === "done" ? "hoàn tất " + (run.ms / 1000).toFixed(1) + "s" : "đang chạy…"}`));
  const flowBox = el("div", { class: "rag-flow" });
  for (const b of run.buoc) {
    flowBox.appendChild(el("div", { class: `rag-step ${b.nhom} ${b.trangThai}` },
      el("div", { class: "rag-step-head" },
        el("span", { class: "rag-emoji" }, b.emoji),
        el("b", {}, b.agent),
        el("span", { class: "rag-status " + b.trangThai }, b.trangThai === "running" ? "⏳" : b.trangThai === "ok" ? "✓ " + b.ms + "ms" : "✗")),
      el("div", { class: "small rag-tomtat" }, b.tomTat)));
    flowBox.appendChild(el("div", { class: "rag-arrow" }, "→"));
  }
  if (flowBox.lastChild?.className === "rag-arrow") flowBox.removeChild(flowBox.lastChild);
  card.appendChild(flowBox);
  flow.appendChild(card);

  const k = run.ketLuan;
  if (!k) return;
  const cls = k.goiY === "LONG" ? "long" : k.goiY === "SHORT" ? "short" : "neutral";
  const c2 = el("div", { class: `card rag-final v-${cls}` });
  c2.appendChild(el("div", { class: "card-title" }, "🎯 Final Answer — Gợi ý của RAG Auto"));
  c2.appendChild(el("div", { class: `verdict ${cls}` }, `${ragGoiYLabel(k.goiY)} · tin cậy ${k.conf}% · CRAG: ${k.grade || "—"}`));
  if (k.thanhPhan?.length) {
    const tbl = el("table", { class: "mini-table" });
    tbl.appendChild(el("tr", {}, el("th", { class: "left" }, "Lớp phân tích"), el("th", {}, "Đóng góp vote"), el("th", { class: "left" }, "Chi tiết")));
    for (const t of k.thanhPhan) {
      tbl.appendChild(el("tr", {},
        el("td", { class: "left" }, t.ten),
        el("td", { class: "mono " + (t.diem > 0 ? "up" : t.diem < 0 ? "down" : "muted") }, (t.diem > 0 ? "+" : "") + t.diem),
        el("td", { class: "left small muted" }, t.ghiChu)));
    }
    c2.appendChild(tbl);
  }
  if (k.plan && k.goiY !== "DUNG_NGOAI") {
    c2.appendChild(el("div", { class: "plan-mini " + k.plan.side },
      el("span", {}, `E ${fmtGia(k.plan.entry)}`),
      el("span", { class: "down" }, `SL ${fmtGia(k.plan.sl)}`),
      el("span", { class: "up" }, `TP1 ${fmtGia(k.plan.tp1)}`),
      el("span", { class: "up" }, `TP2 ${fmtGia(k.plan.tp2)}`),
      el("span", { class: "muted" }, `RR 1:${k.plan.rr1}`)));
    c2.appendChild(el("div", { class: "row-gap" },
      el("button", { class: "btn primary", onclick: () => moDatLenh({ coin: run.coin, side: k.goiY.toLowerCase(), tuGoiY: true }) }, "🛒 Đặt lệnh (kiểm tra an toàn 2 bước)"),
      el("button", { class: "btn", onclick: () => { location.hash = `#/bieudo?coin=${run.coin}`; } }, "Xem chart")));
  }
  if (k.lyDo?.length) c2.appendChild(el("div", { class: "warn-box" }, ...k.lyDo.map(x => el("div", {}, "⚠ " + x))));
  if (k.chunks?.length) {
    const kb = el("details", { open: "" }, el("summary", {}, `📚 Kiến thức đã truy xuất (${k.chunks.length})`));
    for (const c of k.chunks) {
      kb.appendChild(el("div", { class: "impact-row" },
        el("b", { class: "small" }, c.ten + " — " + c.viSao),
        el("div", { class: "muted small" }, c.trich)));
    }
    c2.appendChild(kb);
  }
  c2.appendChild(el("p", { class: "muted tiny" }, "RAG Auto là lớp tư vấn — quyết định cuối cùng và nút xác nhận đặt lệnh luôn thuộc về bạn (requiresUserDecision)."));
  kl.appendChild(c2);
}
