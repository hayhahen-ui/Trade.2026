/* ============================================================
 * Trade.2026 — Panel Skill Auto Run trên màn hình Tổng quan (v2.17.4)
 * Hiện kết quả chạy của skill trade-2026-project (mỗi 5 phút) để người
 * dùng thấy được trên web, không cần mở GitHub Actions.
 *
 * Nguồn dữ liệu — toàn bộ công khai, không cần key, không cần đăng nhập:
 *  - Nhật ký trạm (nhánh data): data/journal-247.json — tín hiệu + capNhat.
 *  - GitHub Actions API công khai: lần chạy gần nhất của workflow
 *    station-skill-5m.yml (trạng thái + kết quả + link).
 * Panel CHỈ ĐỌC, không gửi lệnh, không đặt lệnh, không ghi gì cả.
 * Review tín hiệu dùng đúng luật review-trade-signal, giống hệt
 * tools/skill-autorun-5m.js (nguồn sự thật cho luật review là runner đó).
 * ============================================================ */
"use strict";

const AR_JOURNAL_URL = "https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/data/data/journal-247.json";
const AR_GH_RUNS_URL = "https://api.github.com/repos/hayhahen-ui/Trade.2026/actions/workflows/station-skill-5m.yml/runs?per_page=1";
const AR_GH_ACTIONS_URL = "https://github.com/hayhahen-ui/Trade.2026/actions/workflows/station-skill-5m.yml";
const AR_GH_FOLDER_URL = "https://github.com/hayhahen-ui/Trade.2026/tree/main/.github/workflows";
const AR_CACHE_MS = 30000;      // nhật ký trạm: tối đa 30 giây/lần
const AR_GH_CACHE_MS = 300000;  // GitHub API không xác thực: tối đa 5 phút/lần (giới hạn 60 req/giờ)

/* ---------- Hàm thuần: review 1 tín hiệu (giống runner) ---------- */
function arTuoiPhut(tsVao, nowMs) {
  const t = Date.parse(tsVao);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 60000));
}

function arSlTpOk(r) {
  if (r.sl == null || r.tp == null || r.giaVao == null) return true;
  if (r.side === "long") return r.sl < r.giaVao && r.tp > r.giaVao;
  if (r.side === "short") return r.sl > r.giaVao && r.tp < r.giaVao;
  return true;
}

function arReviewTinHieu(r, nowMs, seen) {
  const tuoi = arTuoiPhut(r.tsVao, nowMs);
  const base = { id: r.id, coin: r.coin, side: r.side, diem: r.diem, phase: r.phase || null, tuoiPhut: tuoi };
  if (tuoi == null || tuoi > 10) return Object.assign({}, base, { verdict: "REJECT", lyDo: "cũ hơn 10 phút" });
  if (!r.phase) return Object.assign({}, base, { verdict: "REJECT", lyDo: "thiếu phase, NOT VERIFIED" });
  const key = r.coin + "-" + r.side;
  const truoc = seen.get(key);
  if (truoc != null && tuoi - truoc < 60) return Object.assign({}, base, { verdict: "REJECT", lyDo: "trùng trong 60 phút/coin" });
  seen.set(key, tuoi);
  if (!arSlTpOk(r)) return Object.assign({}, base, { verdict: "REJECT", lyDo: "SL/TP sai phía" });
  if (r.diem >= 70 && (r.phase === "alert_ready" || r.phase === "retest_in_progress"))
    return Object.assign({}, base, { verdict: "REPORT", lyDo: "điểm từ 70 và phase alert_ready/retest" });
  if (r.diem >= 50) return Object.assign({}, base, { verdict: "PREPARE", lyDo: "điểm 50-69, chỉ chuẩn bị" });
  return Object.assign({}, base, { verdict: "REJECT", lyDo: "điểm dưới 50" });
}

function arFmtTuoi(ms) {
  if (ms == null) return "chưa có";
  if (ms < 1500) return "vừa xong";
  if (ms < 60e3) return ((ms / 1000).toFixed(ms < 10e3 ? 1 : 0)) + "s trước";
  return Math.round(ms / 60e3) + "ph trước";
}

function arFmtGio(ms) {
  try {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  } catch (e) { return "—"; }
}

/* ---------- Vẽ panel ---------- */
function arBadgeClass(verdict) {
  if (verdict === "REPORT") return "ok";
  if (verdict === "PREPARE") return "warn";
  return "neutral";
}

function vePanelAutoRun() {
  const wrap = el("div", { class: "card", id: "card-autorun" });
  wrap.appendChild(el("div", { class: "card-title" }, "🤖 Skill Auto Run — 5 phút/lần ",
    el("span", { class: "tiny muted" }, "chạy trên GitHub Actions · chỉ đọc, không gửi lệnh")));
  wrap.appendChild(el("div", { id: "ar-body" }, el("p", { class: "muted small" }, "Đang tải dữ liệu auto run…")));
  wrap.appendChild(el("p", { class: "muted small", style: "margin:8px 0 0" },
    "Nguồn: nhật ký trạm (nhánh data) + GitHub Actions API công khai. Tín hiệu chỉ để tham khảo, không phải lời khuyên đầu tư. Tóm tắt AI chỉ có trong run record trên Actions."));
  return wrap;
}

let _arCacheJournal = null, _arCacheJournalAt = 0;
let _arCacheGh = null, _arCacheGhAt = 0;

/* ---------- Hàm thuần: trạng thái workflow từ dữ liệu GitHub API ----------
 * 404 = file workflow chưa có trên main: TRẠNG THÁI CHỜ, không phải lỗi.
 * Lỗi này từng hiện thành "không tải được lần chạy (HTTP 404)" vì arFetchJson
 * ném lỗi trước khi đọc body — đã sửa: giữ lại status để phân biệt. */
function arTrangThaiWorkflow(gh) {
  if (!gh || gh.status === 404 || gh.message === "Not Found")
    return { ten: "Workflow", giaTri: "chưa có file station-skill-5m.yml — thêm file vào main thì auto run mới chạy", cls: "neutral", link: AR_GH_FOLDER_URL };
  if (gh._loi)
    return { ten: "Workflow", giaTri: "không tải được lần chạy (" + gh._loi + ")", cls: "warn", link: AR_GH_ACTIONS_URL };
  const runs = Array.isArray(gh.workflow_runs) ? gh.workflow_runs : [];
  if (!runs.length)
    return { ten: "Workflow", giaTri: "đã có workflow, chưa chạy lần nào", cls: "neutral", link: AR_GH_ACTIONS_URL };
  const r0 = runs[0];
  const kq = r0.status === "completed" ? (r0.conclusion === "success" ? "thành công" : "thất bại (" + (r0.conclusion || "?") + ")") : "đang chạy";
  return { ten: "Workflow", giaTri: "lần chạy " + arFmtGio(Date.parse(r0.created_at)) + " · " + kq, cls: r0.conclusion === "success" ? "ok" : "warn", link: r0.html_url || AR_GH_ACTIONS_URL };
}

async function arFetchJson(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const resp = await fetch(url, { signal: ctl.signal });
    if (!resp.ok) { const err = new Error("HTTP " + resp.status); err.status = resp.status; throw err; }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function capNhatPanelAutoRun() {
  const body = (typeof $ === "function" ? $("#ar-body") : null);
  if (!body || !body.isConnected) return;
  const nowMs = Date.now();
  try {
    if (!_arCacheJournal || nowMs - _arCacheJournalAt > AR_CACHE_MS) {
      _arCacheJournal = await arFetchJson(AR_JOURNAL_URL + "?t=" + nowMs, 15000);
      _arCacheJournalAt = nowMs;
    }
    if (!_arCacheGh || nowMs - _arCacheGhAt > AR_GH_CACHE_MS) {
      try {
        _arCacheGh = await arFetchJson(AR_GH_RUNS_URL, 15000);
        _arCacheGhAt = nowMs;
      } catch (e) { _arCacheGh = { _loi: String(e && e.message || e), status: (e && e.status) || null }; }
    }
    const d = _arCacheJournal || {};
    const rows = [];
    // 1. Lần chạy workflow gần nhất (GitHub Actions API công khai)
    rows.push(arTrangThaiWorkflow(_arCacheGh));
    // 2. Trạm 24/7 theo capNhat của nhật ký
    const tuoiTram = d.capNhat ? nowMs - Date.parse(d.capNhat) : null;
    if (tuoiTram == null) rows.push({ ten: "Trạm 24/7", giaTri: "không rõ heartbeat", cls: "neutral" });
    else if (tuoiTram < 20 * 60e3) rows.push({ ten: "Trạm 24/7", giaTri: "OK — heartbeat " + arFmtTuoi(tuoiTram), cls: "ok" });
    else rows.push({ ten: "Trạm 24/7", giaTri: "STALE — heartbeat " + arFmtTuoi(tuoiTram) + " (cron GitHub có thể trễ/rớt, chưa chắc trạm đã dừng)", cls: "warn" });
    // 3. Tín hiệu mới 10 phút qua, review theo đúng luật runner
    const tinHieu = Array.isArray(d.tinHieu) ? d.tinHieu.filter(r => r.loai !== "giay") : [];
    const moi = tinHieu
      .filter(r => arTuoiPhut(r.tsVao, nowMs) != null && arTuoiPhut(r.tsVao, nowMs) <= 10)
      .sort((a, b) => Date.parse(b.tsVao) - Date.parse(a.tsVao));
    const seen = new Map();
    const verdicts = moi.map(r => arReviewTinHieu(r, nowMs, seen));
    body.innerHTML = "";
    for (const r of rows) {
      const line = el("div", { class: "sk-row" },
        el("span", { class: "sk-ten" }, r.ten),
        el("span", { class: "badge " + r.cls + " sk-tra" }, r.giaTri));
      if (r.link) line.appendChild(el("a", { class: "tiny", href: r.link, target: "_blank", rel: "noopener" }, "Xem"));
      body.appendChild(line);
    }
    if (!verdicts.length) {
      body.appendChild(el("p", { class: "muted small", style: "margin:8px 0 0" }, "Không có tín hiệu mới trong 10 phút qua."));
    } else {
      const tbl = el("table", { class: "mini-table", style: "margin-top:8px" });
      tbl.appendChild(el("tr", {},
        el("th", { class: "left" }, "Coin"), el("th", {}, "Hướng"),
        el("th", {}, "Điểm"), el("th", {}, "Phase"), el("th", {}, "Kết luận"), el("th", { class: "left" }, "Lý do")));
      for (const v of verdicts.slice(0, 5)) {
        tbl.appendChild(el("tr", {},
          el("td", { class: "left strong" }, v.coin),
          el("td", {}, v.side === "long" ? "Long" : "Short"),
          el("td", { class: "mono" }, String(v.diem == null ? "—" : v.diem)),
          el("td", { class: "mono" }, v.phase || "?"),
          el("td", {}, el("span", { class: "badge " + arBadgeClass(v.verdict) }, v.verdict)),
          el("td", { class: "left tiny muted" }, v.lyDo)));
      }
      body.appendChild(tbl);
    }
  } catch (err) {
    body.innerHTML = "";
    body.appendChild(el("p", { class: "muted small" }, "Không tải được dữ liệu auto run (" + String(err && err.message || err) + ") — panel sẽ thử lại sau 30 giây."));
  }
}

function ganPanelAutoRun(root) {
  root.appendChild(vePanelAutoRun());
  capNhatPanelAutoRun();
  clearInterval(window._arTimer);
  window._arTimer = setInterval(() => {
    if (typeof SCREEN_HIENTAI !== "undefined" && SCREEN_HIENTAI === "tongquan") capNhatPanelAutoRun();
    else clearInterval(window._arTimer);
  }, 30000);
}
