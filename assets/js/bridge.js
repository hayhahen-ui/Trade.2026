/* ============================================================
 * Trade.2026 — Cầu nối trình duyệt → trạm 24/7 → WhatsApp (v2.15.0)
 * Khi trình duyệt ghi nhận tín hiệu (thật/giấy) và cầu nối được bật trong
 * Cài đặt, bản ghi được đẩy lên nhánh `data` của GitHub
 * (data/browser-signals.json) qua GitHub Contents API.
 * Trạm (tools/bridge-browser.js, cron 2 phút) kéo về, trộn vào journal trạm —
 * cron WhatsApp (1 phút) thấy id mới là gửi tin về máy user.
 * PAT: fine-grained, chỉ repo này, quyền Contents read+write; lưu trong
 * localStorage của trình duyệt user, không gửi đi đâu khác ngoài api.github.com.
 * ============================================================ */
"use strict";

const BRIDGE = {
  REPO: "hayhahen-ui/Trade.2026",
  BRANCH: "data",
  PATH: "data/browser-signals.json",
  MAX_HANG_DOI: 1000, // đầy → dừng đẩy, báo user (KHÔNG tự xóa)

  _xong: false,
  _loiCuoi: null,

  bat() {
    try { return !!(SETTINGS.bridgeBat && (SETTINGS.bridgePat || "").trim()); } catch (e) { return false; }
  },
  trangThai() {
    try {
      if (!SETTINGS.bridgeBat) return "đang tắt.";
      if (!(SETTINGS.bridgePat || "").trim()) return "chưa nhập GitHub PAT.";
    } catch (e) { return "đang tắt."; }
    return this._loiCuoi ? ("lỗi lần cuối: " + this._loiCuoi)
      : "đang bật — tín hiệu mới trên máy này sẽ đẩy lên trạm.";
  },

  /* Bọc JOURNAL.ghiNhan/ghiNhanGiay: có bản ghi mới → đẩy lên trạm (fire-and-forget).
   * Gọi 1 lần lúc boot, sau khi journal.js đã nạp. */
  khoiDong() {
    if (this._xong) return;
    if (typeof JOURNAL === "undefined") return;
    this._xong = true;
    for (const ten of ["ghiNhan", "ghiNhanGiay"]) {
      const goc = JOURNAL[ten];
      if (typeof goc !== "function") continue;
      const self = this;
      JOURNAL[ten] = function (...args) {
        const rec = goc.apply(JOURNAL, args);
        if (rec && self.bat()) self.dayLen(rec);
        return rec;
      };
    }
  },

  /* Trích trường cần thiết để trạm kiểm chứng + soạn tin WhatsApp.
   * Pure — test được. */
  banGhiGon(rec) {
    const r = rec || {};
    return {
      id: String(r.id || ""),
      coin: String(r.coin || "").toUpperCase(),
      side: r.side,
      loai: r.loai === "giay" ? "giay" : "that",
      tsVao: +r.tsVao || Date.now(),
      giaVao: +r.giaVao || 0, sl: +r.sl || 0, tp: +r.tp || 0,
      rr: +r.rr || 0, diem: +r.diem || 0,
      phien: r.phien || "—", bias4h: r.bias4h || "—",
      trangThai: r.trangThai || "dang_theo_doi",
      ketQua: r.ketQua || null, daDanhGiaDen: +r.daDanhGiaDen || 0,
      nn: r.nn != null ? +r.nn : null,
      ngay: r.ngay || null,
      cauTruc: r.cauTruc || null, ob: r.ob || null, nen: r.nen || null, // để tin WhatsApp đủ dòng
      nguon: "browser",
    };
  },

  apiUrl() { return `https://api.github.com/repos/${this.REPO}/contents/${this.PATH}`; },
  maHoa(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); },
  giaiMa(b64) { return JSON.parse(decodeURIComponent(escape(atob(String(b64).replace(/\n/g, ""))))); },

  async dayLen(rec) {
    const gon = this.banGhiGon(rec);
    if (!gon.id || !gon.coin || (gon.side !== "long" && gon.side !== "short")) return;
    let pat = "";
    try { pat = (SETTINGS.bridgePat || "").trim(); } catch (e) {}
    if (!pat) return;
    const headers = { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + pat };
    const nap = async () => {
      const r1 = await fetch(`${this.apiUrl()}?ref=${this.BRANCH}`, { headers });
      if (r1.status === 404) return { sha: null, ds: [] };
      if (!r1.ok) throw new Error("đọc GitHub: HTTP " + r1.status);
      const j1 = await r1.json();
      let ds = [];
      try { const o = this.giaiMa(j1.content || ""); ds = Array.isArray(o.tinHieu) ? o.tinHieu : []; } catch (e) {}
      return { sha: j1.sha || null, ds };
    };
    const ghi = async (sha, ds) => {
      const body = {
        message: `bridge: tín hiệu ${gon.coin} ${gon.side} (${gon.loai}) từ trình duyệt`,
        branch: this.BRANCH,
        content: this.maHoa({ capNhat: new Date().toISOString(), tinHieu: ds }),
      };
      if (sha) body.sha = sha;
      const r2 = await fetch(this.apiUrl(), {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return r2;
    };
    try {
      for (let lan = 0; lan < 2; lan++) { // thử lại 1 lần nếu race sha (409/422)
        const { sha, ds } = await nap();
        if (ds.some(x => x && x.id === gon.id)) { this._loiCuoi = null; return; } // đã có
        if (ds.length >= this.MAX_HANG_DOI) {
          this._loiCuoi = `hàng đợi trạm đầy (${this.MAX_HANG_DOI}) — dừng đẩy, không xóa dữ liệu cũ`;
          return;
        }
        ds.unshift(gon);
        const r2 = await ghi(sha, ds);
        if (r2.status === 409 || r2.status === 422) continue; // race: nạp lại sha mới
        if (!r2.ok) throw new Error("ghi GitHub: HTTP " + r2.status);
        this._loiCuoi = null;
        return;
      }
      this._loiCuoi = "trùng phiên bản GitHub sau 2 lần thử — sẽ đẩy lại ở tín hiệu sau";
    } catch (e) { this._loiCuoi = String((e && e.message) || e).slice(0, 120); }
  },
};
