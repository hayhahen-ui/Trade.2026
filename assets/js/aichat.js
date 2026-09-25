/* ============================================================
 * Trade.2026 — AI Hỏi đáp (RAG): chat với LLM bằng key của user
 * ------------------------------------------------------------
 * · Hỗ trợ 3 provider: Google Gemini · OpenAI · Anthropic Claude
 * · Key API CHỈ lưu trong localStorage của trình duyệt user —
 *   không gửi đi đâu khác ngoài API chính thức của provider đã chọn,
 *   không đưa vào repo/log.
 * · RAG: mỗi câu hỏi được "nạp ngữ cảnh" từ dữ liệu THẬT của app
 *   (tín hiệu SMC, dòng tiền FlowDB, funding/OI, sức khỏe nguồn,
 *   lịch kinh tế) kèm nguồn + thời điểm — chống bịa dữ liệu.
 * Lưu ý CORS: Anthropic chặn gọi trực tiếp từ trình duyệt ở một số
 * môi trường — nếu lỗi mạng, hãy dùng Gemini/OpenAI hoặc proxy riêng.
 * ============================================================ */
"use strict";

/* ---------- Provider adapters ---------- */
const AI_PROVIDERS = {
  gemini: {
    ten: "Google Gemini",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    modelMacDinh: "gemini-2.5-flash",
    endpoint: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: (key) => ({ "Content-Type": "application/json", "x-goog-api-key": key }),
    body: (model, system, msgs) => ({
      system_instruction: { parts: [{ text: system }] },
      contents: msgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
    parse: (j) => (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim(),
    loi: (st) => st === 400 ? "Key sai hoặc model không tồn tại." : st === 429 ? "Hết quota — thử lại sau." : `Lỗi HTTP ${st}.`,
  },
  openai: {
    ten: "OpenAI",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    modelMacDinh: "gpt-4o-mini",
    endpoint: () => "https://api.openai.com/v1/chat/completions",
    headers: (key) => ({ "Content-Type": "application/json", "Authorization": "Bearer " + key }),
    body: (model, system, msgs) => ({
      model,
      messages: [{ role: "system", content: system }, ...msgs.map(m => ({ role: m.role, content: m.content }))],
      temperature: 0.4, max_tokens: 2048,
    }),
    parse: (j) => (j?.choices?.[0]?.message?.content || "").trim(),
    loi: (st) => st === 401 ? "Key sai hoặc hết hạn." : st === 429 ? "Hết quota — thử lại sau." : `Lỗi HTTP ${st}.`,
  },
  anthropic: {
    ten: "Anthropic Claude",
    models: ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001", "claude-opus-4-1-20250805"],
    modelMacDinh: "claude-sonnet-4-5-20250929",
    endpoint: () => "https://api.anthropic.com/v1/messages",
    headers: (key) => ({
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    }),
    body: (model, system, msgs) => ({
      model, max_tokens: 2048, system,
      messages: msgs.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      temperature: 0.4,
    }),
    parse: (j) => (j?.content || []).filter(b => b.type === "text").map(b => b.text || "").join("").trim(),
    loi: (st) => st === 401 ? "Key sai hoặc hết hạn." : st === 429 ? "Hết quota — thử lại sau." : `Lỗi HTTP ${st}.`,
    corsNote: "Anthropic có thể chặn gọi trực tiếp từ trình duyệt (CORS) — nếu báo lỗi mạng, hãy dùng Gemini/OpenAI.",
  },
  apmix: {
    ten: "APMIX.AI (free)",
    models: ["deepseek-v4-flash-free"],
    modelMacDinh: "deepseek-v4-flash-free",
    endpoint: () => "https://api.apmix.ai/v1/chat/completions",
    headers: (key) => ({
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key,
    }),
    body: (model, system, msgs) => ({
      model,
      messages: [{ role: "system", content: system }, ...msgs.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))],
      temperature: 0.3,
      max_tokens: 2048,
    }),
    parse: (j) => j?.choices?.[0]?.message?.content?.trim() || "",
    loi: (st) => st === 401 ? "Key APMIX sai hoặc hết hạn." : st === 429 ? "Hết quota — thử lại sau." : `Lỗi HTTP ${st}.`,
  },
};

/* ---------- Key vault: localStorage của user, không rời trình duyệt ---------- */
const AI_KEYS = {
  _k: "trade2026_ai_keys",
  _doc() { try { return JSON.parse(localStorage.getItem(this._k) || "{}"); } catch (e) { return {}; } },
  get(p) { return this._doc()[p] || ""; },
  set(p, v) { const d = this._doc(); if (v) d[p] = v; else delete d[p]; try { localStorage.setItem(this._k, JSON.stringify(d)); } catch (e) {} },
  del(p) { this.set(p, ""); },
  co(p) { return !!this.get(p); },
};
const AI_CFG = {
  _k: "trade2026_ai_cfg",
  _doc() { try { return JSON.parse(localStorage.getItem(this._k) || "{}"); } catch (e) { return {}; } },
  get() { const d = this._doc(); return { provider: d.provider || "gemini", model: d.model || "" }; },
  set(patch) { try { localStorage.setItem(this._k, JSON.stringify({ ...this._doc(), ...patch })); } catch (e) {} },
};

/* ---------- System prompt ---------- */
function systemPromptRAG() {
  return `Bạn là trợ lý phân tích crypto của app Trade.2026, trả lời TIẾNG VIỆT, ngắn gọn, đi thẳng vào việc.

NGUYÊN TẮC BẮT BUỘC:
1. Chỉ dùng số liệu trong phần NGỮ CẢNH DỮ LIỆU dưới đây. Mỗi nhận định phải ghi nguồn + thời điểm (vd "theo FlowDB lúc 21:30").
2. Không bịa giá/tín hiệu. Dữ liệu nào ghi "không có/chưa tải" thì nói rõ là chưa có, không suy diễn.
3. Điểm hợp lưu ≥ ngưỡng cảnh báo mới là tín hiệu vào lệnh; ngoài ra chỉ là "chuẩn bị/chờ xác nhận".
4. Không đảm bảo lợi nhuận, không hứa "win rate cao". Luôn nhắc quản trị rủi ro: risk 1–2%/lệnh, R:R ≥ 1:2, SL bắt buộc.
5. Nếu câu hỏi ngoài phạm vi dữ liệu (vd tin tức chưa có trong lịch), nói rõ giới hạn và gợi ý user kiểm chứng thêm.`;
}

/* ---------- RAG context builder: gom dữ liệu THẬT của app ---------- */
function fmtTime(ts) {
  try { return new Date(ts).toLocaleString("vi-VN", { hour12: false }); } catch (e) { return "?"; }
}

async function xayDungNgucanhRAG() {
  const lines = [];
  const now = Date.now();
  lines.push(`THỜI ĐIỂM NGỮ CẢNH: ${fmtTime(now)} (giờ VN)`);
  const push = (tieuDe, noiDung) => lines.push(`\n### ${tieuDe}\n${noiDung || "— không có dữ liệu —"}`);

  // 1. Sức khỏe nguồn
  try {
    const srcs = window.DataHub?.sources?.() || [];
    const on = srcs.filter(s => s.status === "on").length;
    push("SỨC KHỎE NGUỒN DỮ LIỆU", `${on}/${srcs.length} nguồn đang chạy. ` +
      srcs.map(s => `${s.ten || s.id}: ${s.status}${s.note ? ` (${s.note})` : ""}`).join(" · "));
  } catch (e) { push("SỨC KHỎE NGUỒN DỮ LIỆU", null); }

  // 2. Fear & Greed + stablecoin
  try {
    const fng = window.DataHub?.macro?.()?.fng;
    let t = fng ? `Fear & Greed ${fng.value} (${fng.nhan}) lúc ${fmtTime(fng.ts)}` : "Fear & Greed: chưa tải";
    try {
      const sc = await taiStablecoinPulse();
      if (sc.ok) t += ` · Stablecoin ${sc.doi30d != null ? `${sc.doi30d >= 0 ? "+" : ""}${sc.doi30d.toFixed(1)}%/30d (${sc.nhan})` : `tổng ${fmtUsdSafe(sc.tong)}`}`;
    } catch (e) {}
    push("TÂM LÝ & DÒNG TIỀN VĨ MÔ", t);
  } catch (e) { push("TÂM LÝ & DÒNG TIỀN VĨ MÔ", null); }

  // 3. Tín hiệu SMC các coin
  try {
    const rows = [];
    if (typeof SIGNAL_CACHE !== "undefined") {
      for (const [coin, kq] of SIGNAL_CACHE) {
        const plan = kq.plan ? ` entry ${kq.plan.entry} · SL ${kq.plan.sl} · TP1 ${kq.plan.tp1} · TP2 ${kq.plan.tp2}` : "";
        const ps = kq.phaiSinh ? ` · phái sinh: ${kq.phaiSinh.tomTat}` : "";
        rows.push(`${coin}: ${verdictLabel(kq.verdict)} · điểm ${kq.score}/100 · ${kq.phaseLabel} · bias 4H ${biasLabel(kq.htf.bias)}${plan}${ps} (phân tích lúc ${fmtTime(kq.time)})`);
      }
    }
    push("TÍN HIỆU SMC (engine đa khung)", rows.length ? rows.join("\n") : "Chưa quét tín hiệu — user cần mở màn hình Tín hiệu.");
  } catch (e) { push("TÍN HIỆU SMC (engine đa khung)", null); }

  // 4. Dòng tiền cá voi + thanh lý 24h (FlowDB)
  try {
    if (window.FlowDB?.recentWhales) {
      const since = now - 24 * 3600e3;
      const [ws, ls] = await Promise.all([
        window.FlowDB.recentWhales({ since, limit: 2000 }).catch(() => []),
        window.FlowDB.recentLiqs({ since, limit: 2000 }).catch(() => []),
      ]);
      const gop = (arr, keyFn) => { const m = {}; for (const x of arr) { const k = x.coin; m[k] = m[k] || { n: 0, usd: 0 }; m[k].n++; m[k].usd += +x.usd || 0; } return m; };
      const w = gop(ws), l = gop(ls);
      const coins = [...new Set([...Object.keys(w), ...Object.keys(l)])].slice(0, 10);
      const t = coins.map(c => {
        let s = `${c}: `;
        if (w[c]) s += `whale ${w[c].n} lệnh ${fmtUsdSafe(w[c].usd)}`;
        if (l[c]) s += `${w[c] ? " · " : ""}thanh lý ${l[c].n} lệnh ${fmtUsdSafe(l[c].usd)}`;
        return s;
      }).join("\n");
      push("DÒNG TIỀN 24H (FlowDB — thu thập liên tục khi tab mở)", t || "Chưa ghi nhận sự kiện nào trong 24h.");
    } else push("DÒNG TIỀN 24H (FlowDB)", "FlowDB chưa sẵn sàng.");
  } catch (e) { push("DÒNG TIỀN 24H (FlowDB)", null); }

  // 5. Funding extremes
  try {
    const fm = window.DataHub?.funding?.() || {};
    const rows = [];
    for (const [coin, f] of Object.entries(fm)) {
      if (!isFinite(+f?.rate)) continue;
      const rg = fundingRegime(+f.rate);
      rows.push(`${coin}: ${f.rate > 0 ? "+" : ""}${(+f.rate).toFixed(4)}%/8h (≈${rg.annualized >= 0 ? "+" : ""}${rg.annualized.toFixed(1)}%/năm) — ${rg.nhan}`);
    }
    push("FUNDING RATE (Binance Futures)", rows.length ? rows.join("\n") : "Chưa có dữ liệu funding.");
  } catch (e) { push("FUNDING RATE", null); }

  // 6. Lịch kinh tế sắp tới
  try {
    if (typeof CAL !== "undefined" && CAL.rows?.length && typeof suKienSapToi === "function") {
      const s = suKienSapToi(CAL.rows, now, 72);
      let t = "";
      if (s.vungTin) t += `🚨 ĐANG trong vùng tin ★★★: ${s.vungTin.suKien} (${s.vungTin.iso}). `;
      const big = (s.danhSach || []).filter(e => e.sao >= 3).slice(0, 5);
      t += big.length ? "Tin ★★★ 72h tới:\n" + big.map(e => `· ${e.iso} — ${e.suKien} (${e.quocGia || ""})`).join("\n") : "Không có tin ★★★ trong 72h tới.";
      push("LỊCH KINH TẾ", t);
    } else push("LỊCH KINH TẾ", "Chưa tải lịch.");
  } catch (e) { push("LỊCH KINH TẾ", null); }

  // 7. Cảnh báo phái sinh toàn cảnh
  try {
    if (typeof canhBaoPhaiSinhToanCanh === "function" && typeof SETTINGS !== "undefined") {
      const cbs = await canhBaoPhaiSinhToanCanh(SETTINGS.watchlist || []);
      push("CẢNH BÁO PHÁI SINH", cbs.length ? cbs.map(c => `· ${c.text}`).join("\n") : "Không có cảnh báo phái sinh nào.");
    }
  } catch (e) {}

  return lines.join("\n");
}

/* ---------- Gọi LLM ---------- */
async function hoiAI(providerId, model, messages, opts = {}) {
  const P = AI_PROVIDERS[providerId];
  if (!P) throw new Error("Provider không hỗ trợ.");
  const key = AI_KEYS.get(providerId);
  if (!key) throw new Error(`Chưa nhập API key cho ${P.ten}.`);
  const mdl = model || P.modelMacDinh;

  const ngucanh = opts.boNgucanh ? "" : await xayDungNgucanhRAG().catch(() => "");
  const system = systemPromptRAG() + (ngucanh ? `\n\n===== NGỮ CẢNH DỮ LIỆU (nguồn: app Trade.2026) =====\n${ngucanh}` : "");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 90000);
  let res;
  try {
    res = await fetch(P.endpoint(mdl), {
      method: "POST", headers: P.headers(key),
      body: JSON.stringify(P.body(mdl, system, messages)),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const cors = P.corsNote ? " " + P.corsNote : "";
    throw new Error("Không kết nối được tới API (mạng/CORS)." + cors);
  }
  clearTimeout(timer);
  if (!res.ok) {
    let msg = P.loi(res.status);
    try { const j = await res.json(); const em = j?.error?.message || j?.message; if (em) msg += " " + String(em).slice(0, 200); } catch (e) {}
    throw new Error(msg);
  }
  const j = await res.json();
  const text = P.parse(j);
  if (!text) throw new Error("API trả về rỗng — thử lại hoặc đổi model.");
  return text;
}

/* Ping kiểm tra key */
async function kiemTraKetNoiAI(providerId, model) {
  return hoiAI(providerId, model, [{ role: "user", content: "Trả lời đúng 2 từ: Kết nối OK" }], { boNgucanh: true, timeoutMs: 30000 });
}

/* Lịch sử chat trong RAM (không lưu localStorage để tránh lộ nội dung) */
const AI_CHAT = { lichSu: [], dangHoi: false };
function resetLichSuAI() { AI_CHAT.lichSu = []; }
