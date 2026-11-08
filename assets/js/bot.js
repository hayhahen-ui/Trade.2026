/* ============================================================
 * Trade.2026 — Paper Trading Bot (dữ liệu THẬT · lệnh ẢO · kỷ luật THẬT)
 * Cổng kỷ luật (mindmap Mr.Bit + bot server marketpulse):
 *   · Risk mỗi lệnh 0.5–2% vốn      · R:R tối thiểu 1:2
 *   · Tối đa N vị thế đồng thời      · Ngắt mạch lỗ ngày 3–5%
 *   · Cooldown theo coin             · Chỉ trade trong killzone (tùy chọn)
 *   · Dời SL về hòa vốn khi +1R      · Không revenge trade, không FOMO
 * Mọi quyết định lệnh THẬT vẫn thuộc về Mr.Bit (requiresUserDecision).
 * ============================================================ */
"use strict";

const BOT_KEY = "siro_paperbot_v1";

class PaperBot {
  constructor() {
    const saved = lsGet(BOT_KEY, null);
    this.config = saved?.config || {
      enabled: false,
      symbols: [...SETTINGS.watchlist],
      minScore: VERDICT.ALERT,          // chỉ vào lệnh khi điểm hợp lưu ≥ 70
      riskPct: SETTINGS.risk.riskPct,
      minRR: SETTINGS.risk.minRR,
      maxViThe: SETTINGS.risk.maxViThe,
      loNgayMaxPct: SETTINGS.risk.loNgayMaxPct,
      cooldownPhut: SETTINGS.risk.cooldownPhut,
      allowLong: true, allowShort: true,
      chiKillzone: false,
      neTin3Sao: true,                  // né vùng tin ★★★ ±30 phút (lịch kinh tế)
      xacNhanDongTien: true,            // yêu cầu dòng tiền đa sàn (DataHub) không ngược hướng
      whaleXacNhan: false,              // yêu cầu radar cá mập đồng thuận
      doiSLveBE: true,                  // dời SL về entry khi +1R
      donBay: SETTINGS.risk.donBay,
      phiPct: 0.05,                   // FIX v2.0: phí taker mỗi chiều (%) — trừ vào PnL paper cho thực tế
      // L-03 (Đợt 0): trần notional/vị thế (USDT) — mặc định = vốn × đòn bẩy,
      // KHÔNG còn 0 = không giới hạn (SL rất chặt từng biến thành đòn bẩy khổng lồ).
      notionalMax: SETTINGS.risk.vonBanDau * SETTINGS.risk.donBay,
    };
    // L-03: migrate config cũ (notionalMax 0 = không giới hạn) → vốn × đòn bẩy
    if (!this.config.notionalMax) {
      const vonCu = saved?.state?.balance || SETTINGS.risk.vonBanDau;
      this.config.notionalMax = vonCu * (this.config.donBay || SETTINGS.risk.donBay);
    }
    this.state = saved?.state || {
      balance: SETTINGS.risk.vonBanDau,
      equity: SETTINGS.risk.vonBanDau,
      positions: [],       // {id, coin, side, entry, sl, slGoc, tp, qty, riskUsdt, moLuc, beDaDoi}
      history: [],         // lệnh đã đóng
      logs: [],
      pendingOrders: [],   // L-05: lệnh Limit chờ khớp {id, coin, side, entryLimit, sl, tp, qty, datLuc, hetHan}
      dayKey: this._dayKey(),
      dayStartEquity: SETTINGS.risk.vonBanDau,
      lastEntryAt: {},
      equityCurve: [{ t: Date.now(), v: SETTINGS.risk.vonBanDau }],
      circuitTripped: false,
    };
    // L-02: migrate vị thế cũ — ID trùng nhau (cùng Date.now) thì cấp lại ID mới
    {
      const thay = new Set();
      for (const p of this.state.positions || []) {
        if (!p.id || thay.has(p.id)) p.id = this._idMoi("P");
        thay.add(p.id);
      }
    }
    if (!Array.isArray(this.state.pendingOrders)) this.state.pendingOrders = [];
    this._timer = null;
    this._feedTimer = null;
  }

  /* L-02: ID duy nhất cho vị thế/lệnh chờ — crypto.randomUUID() (fallback
   * timestamp + random khi chạy ngoài secure context). */
  _idMoi(tienTo = "P") {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return tienTo + "-" + crypto.randomUUID();
    return tienTo + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  _dayKey() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }); }
  _save() { lsSet(BOT_KEY, { config: this.config, state: this.state }); }
  log(msg, loai = "info") {
    this.state.logs.unshift({ t: Date.now(), msg, loai });
    if (this.state.logs.length > 400) this.state.logs.length = 400;
    document.dispatchEvent(new CustomEvent("siro:botlog"));
    this._save();
  }

  start() {
    if (this._timer) return;
    this.config.enabled = true;
    this.log("🤖 Bot khởi động — chế độ PAPER (lệnh ảo, dữ liệu thật). Quét mỗi 60s.", "ok");
    this._timer = setInterval(() => this.tick(), 60e3);
    // P-02: kiểm tra feed chết mỗi 15s — vị thế ngoài watchlist vẫn được canh SL/TP
    this._feedTimer = setInterval(() => this._kiemTraFeedChet(), 15e3);
    this.tick();
    this._save();
  }
  stop() {
    this.config.enabled = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._feedTimer) { clearInterval(this._feedTimer); this._feedTimer = null; }
    this.log("⏹ Bot đã dừng. Vị thế mở vẫn được giám sát SL/TP.", "warn");
    this._save();
  }

  /* P-02: vị thế nào quá 20s không có giá tươi (feed sàn chết / coin ngoài
   * watchlist) → lấy giá REST Binance rồi canh SL/TP qua onTick(..., "REST"). */
  _kiemTraFeedChet() {
    if (!this.config.enabled || !this.state.positions.length) return;
    for (const pos of [...this.state.positions]) {
      const slot = (typeof slotGiaTheoSan === "function") ? slotGiaTheoSan(pos.san || "BINANCE") : (pos.san || "BINANCE");
      const info = (typeof PRICE_HUB !== "undefined" && PRICE_HUB?.prices?.[slot]?.[pos.coin]) || null;
      if (info?.gia && Date.now() - (info.ts || 0) <= 20e3) continue;
      this._layGiaREST(pos.coin).then(g => { if (g) this.onTick(pos.coin, g, "REST"); }).catch(() => {});
    }
  }
  async _layGiaREST(coin) {
    try {
      const j = await fetchJson(`${ENDPOINTS.binanceRest[0]}/api/v3/ticker/price?symbol=${coin}USDT`);
      const g = +j?.price;
      return g > 0 ? g : null;
    } catch { return null; }
  }

  /* Reset ngày + ngắt mạch */
  _capNhatNgay() {
    const k = this._dayKey();
    if (k !== this.state.dayKey) {
      this.state.dayKey = k;
      this.state.dayStartEquity = this.state.equity;
      this.state.circuitTripped = false;
      this.log(`🌅 Ngày mới ${k} — reset ngắt mạch. Equity đầu ngày: ${fmtUsd(this.state.equity)}`);
    }
    const ddPct = (this.state.dayStartEquity - this.state.equity) / this.state.dayStartEquity * 100;
    if (!this.state.circuitTripped && ddPct >= this.config.loNgayMaxPct) {
      this.state.circuitTripped = true;
      this.log(`⛔ NGẮT MẠCH: lỗ ngày ${fmtSo(ddPct, 1)}% ≥ ${this.config.loNgayMaxPct}% — dừng vào lệnh mới tới hết ngày. Tắt máy, nghỉ ngơi — đừng trade trả thù!`, "err");
    }
  }

  /* Cổng kỷ luật — trả về danh sách lý do từ chối (rỗng = cho phép) */
  kiemTraKyLuat(kq) {
    const r = [];
    if (!kq || !kq.side) { r.push("Tín hiệu trung lập"); return r; }
    if (kq.verdict !== "LONG" && kq.verdict !== "SHORT") r.push(`Verdict ${kq.verdict} — chưa đạt chuẩn vào lệnh`);
    if (kq.score < this.config.minScore) r.push(`Điểm hợp lưu ${kq.score} < ${this.config.minScore}`);
    if (kq.side === "long" && !this.config.allowLong) r.push("LONG đang bị khóa");
    if (kq.side === "short" && !this.config.allowShort) r.push("SHORT đang bị khóa");
    if (!kq.plan) r.push("Chưa dựng được kế hoạch entry/SL/TP");
    if (kq.plan && kq.plan.rr1 < this.config.minRR) r.push(`RR ${kq.plan.rr1} < tối thiểu 1:${this.config.minRR}`);
    if (this.state.positions.length >= this.config.maxViThe) r.push(`Đã đủ ${this.config.maxViThe} vị thế đồng thời`);
    if (this.state.positions.some(p => p.coin === kq.coin)) r.push(`Đang có vị thế ${kq.coin}`);
    const last = this.state.lastEntryAt[kq.coin];
    if (last && Date.now() - last < this.config.cooldownPhut * 60e3) {
      const conLai = Math.ceil((this.config.cooldownPhut * 60e3 - (Date.now() - last)) / 60e3);
      r.push(`Cooldown ${kq.coin} còn ${conLai} phút`);
    }
    if (this.state.circuitTripped) r.push("Ngắt mạch lỗ ngày đang bật");
    if (this.config.chiKillzone && !dangKillzone().active) r.push("Ngoài killzone/giờ vàng");
    // Cổng DataHub: cá mập đa sàn phải cùng chiều + không đang quét thanh khoản
    if (this.config.xacNhanDongTien !== false && window.DataHub && DataHub.isRunning() && window.DataHubBridge) {
      const tl = DataHubBridge.thanhLyGanDay(kq.coin, 5);
      if (tl.tong > 20e6) r.push(`Thanh lý 5ph ${fmtUsd(tl.tong)} — đang quét thanh khoản mạnh`);
      const fs = DataHub.flowScore(kq.coin);
      if ((kq.side === "long" && fs <= -15) || (kq.side === "short" && fs >= 15))
        r.push(`Dòng tiền đa sàn ngược hướng (điểm ${fs > 0 ? "+" : ""}${fs})`);
    }
    if (this.config.neTin3Sao !== false && typeof CAL !== "undefined" && CAL.rows?.length) {
      // FIX v2.0: lịch cũ → KHÔNG chặn bot (chỉ cảnh báo 1 lần/phiên), tránh "chặn ma" vì dữ liệu cũ
      if (!lichConTuoi()) {
        if (!this._daCanhBaoLichCu) {
          this._daCanhBaoLichCu = true;
          this.log("⚠ Lịch kinh tế đã cũ (>48h) — tạm TẮT né tin ★★★ tự động. Hãy chạy tools/update_calendar.py để cập nhật.", "warn");
        }
      } else {
        this._daCanhBaoLichCu = false; // lịch đã tươi trở lại → cho phép cảnh báo lại lần sau
        const sap = suKienSapToi(CAL.rows, Date.now(), 2);
        if (sap.vungTin) r.push(`Vùng tin ★★★ (${sap.vungTin.iso} ${sap.vungTin.suKien}) — kỷ luật né tin ±30ph`);
      }
    }
    if (this.config.whaleXacNhan) {
      const w = WHALE_CACHE.get(kq.coin);
      if (!w) r.push("Chưa có dữ liệu radar cá mập");
      else if (kq.side === "long" && w.score < 10) r.push(`Cá mập chưa đồng thuận LONG (score ${w.score})`);
      else if (kq.side === "short" && w.score > -10) r.push(`Cá mập chưa đồng thuận SHORT (score ${w.score})`);
    }
    return r;
  }

  /* Vòng quét chính */
  tick() {
    this._capNhatNgay();
    if (!this.config.enabled) return;
    for (const coin of this.config.symbols) {
      const kq = SIGNAL_CACHE.get(coin);
      if (!kq || Date.now() - kq.time > 10 * 60e3) continue; // tín hiệu quá cũ
      const lyDo = this.kiemTraKyLuat(kq);
      if (lyDo.length) {
        if (kq.verdict === "LONG" || kq.verdict === "SHORT")
          this.log(`⏸ ${coin} ${kq.verdict} (điểm ${kq.score}) bị chặn: ${lyDo[0]}`, "warn");
        continue;
      }
      this.moLenh(kq);
    }
    // L-05: quét lệnh chờ khớp (dự phòng khi coin không có tick WS)
    if (Array.isArray(this.state.pendingOrders) && this.state.pendingOrders.length) {
      for (const lenh of [...this.state.pendingOrders]) {
        const g = (typeof PRICE_HUB !== "undefined" && PRICE_HUB?.gia) ? PRICE_HUB.gia(lenh.coin) : null;
        if (g) this._xuLyLenhCho(lenh.coin, g);
      }
    }
  }

  /* Context lúc mở lệnh — phục vụ tự học */
  _buildCtx(coin, side, lev) {
    const kq = SIGNAL_CACHE.get(coin);
    const kz = dangKillzone();
    const phien = (typeof phienHienTai === "function" ? phienHienTai().find((s) => s.active && s.id !== "golden") : null);
    return {
      bias4h: kq?.htf?.bias ?? null,
      killzone: kz.active,
      session: phien ? phien.id : "off",
      score: kq?.score ?? null,
      whale: (typeof WHALE_CACHE !== "undefined" && WHALE_CACHE.get(coin)?.score) ?? null,
      theoTinHieu: kq?.side ? side === kq.side : null,
      lev: lev || null,
      gio: new Date().toISOString(),
    };
  }

  moLenh(kq) {
    const p = kq.plan;
    const gia = PRICE_HUB?.gia(kq.coin) ?? kq.gia;
    const entry = gia; // paper: khớp giá thị trường hiện tại
    // L-01: SL/TP phải đúng phía — long: SL < entry < TP; short: TP < entry < SL.
    // RR tính CÓ DẤU (rrCoDau), không dùng Math.abs — abs làm lãi giả khi SL/TP ngược phía.
    if (!bracketHopLe(kq.side, entry, p.sl, p.tp1)) {
      this.log(`⛔ ${kq.coin}: kế hoạch SL/TP ngược phía (entry ${fmtGia(entry)}, SL ${fmtGia(p.sl)}, TP ${fmtGia(p.tp1)}) — TỪ CHỐI mở lệnh`, "err");
      return;
    }
    const risk = kq.side === "long" ? entry - p.sl : p.sl - entry;
    if (risk <= 0) return;
    const rrThucTe = rrCoDau(kq.side, entry, p.sl, p.tp1);
    if (rrThucTe < this.config.minRR * 0.8) {
      this.log(`⏸ ${kq.coin}: giá đã chạy xa entry kế hoạch, RR thực tế 1:${rrThucTe.toFixed(2)} — bỏ qua (không FOMO đuổi lệnh)`, "warn");
      return;
    }
    const riskUsdt = this.state.balance * this.config.riskPct / 100;
    let qty = riskUsdt / risk;
    // L-03: trần notional — mặc định = vốn × đòn bẩy (config.notionalMax, 0 đã bỏ);
    // SL rất chặt không được biến thành đòn bẩy khổng lồ.
    const capNotional = this.config.notionalMax > 0 ? this.config.notionalMax : this.state.balance * this.config.donBay;
    if (qty * entry > capNotional) {
      qty = capNotional / entry;
      this.log(`⚠ ${kq.coin}: KL bị trần notional ${fmtUsd(capNotional)} → ${qty.toFixed(4)}`, "warn");
    }
    const pos = {
      id: this._idMoi("P"),
      coin: kq.coin, side: kq.side,
      entry, sl: p.sl, slGoc: p.sl, tp: p.tp1, tp2: p.tp2,
      qty, riskUsdt, moLuc: Date.now(), beDaDoi: false,
      score: kq.score, lev: this.config.donBay, ctx: this._buildCtx(kq.coin, kq.side, this.config.donBay),
    };
    this.state.positions.push(pos);
    this.state.lastEntryAt[kq.coin] = Date.now();
    // P-02: đăng ký coin vào PriceHub để tick SL/TP về ngay cả khi ngoài watchlist
    if (typeof PRICE_HUB !== "undefined" && PRICE_HUB?.subscribe) PRICE_HUB.subscribe(kq.coin);
    this.log(`✅ MỞ ${pos.side.toUpperCase()} ${pos.coin} @ ${fmtGia(entry)} · SL ${fmtGia(pos.sl)} · TP ${fmtGia(pos.tp)} · KL ${pos.qty.toFixed(4)} · rủi ro ${fmtUsd(riskUsdt)} (${this.config.riskPct}%) · điểm ${kq.score}`, "ok");
    this._save();
    document.dispatchEvent(new CustomEvent("siro:botpos"));
  }

  /* Lệnh TAY từ phiếu đặt lệnh 2 bước (đã qua kiểm tra an toàn UI) */
  moLenhTay({ coin, side, san = "BINANCE", mode = "isolated", lev = 3, entry, sl, tp, riskPct, qty }) {
    // L-01: SL/TP ngược phía → từ chối (phiếu lệnh cũng kiểm tra ở bước 1, đây là lớp chặn cuối)
    if (!bracketHopLe(side, entry, sl, tp)) {
      this.log(`⛔ LỆNH TAY ${side.toUpperCase()} ${coin}: SL/TP ngược phía (entry ${fmtGia(entry)}, SL ${fmtGia(sl)}, TP ${fmtGia(tp)}) — TỪ CHỐI`, "err");
      return null;
    }
    const risk = side === "long" ? entry - sl : sl - entry;
    if (!(risk > 0) || !entry) return null;
    let q, riskUsdt;
    if (qty > 0) { q = qty; riskUsdt = qty * risk; } // số lượng do phiếu quyết định (nhập tay/theo giá trị)
    else { riskUsdt = this.state.balance * (riskPct || this.config.riskPct) / 100; q = riskUsdt / risk; }
    // L-03: trần notional (= vốn × đòn bẩy) + kiểm tra ký quỹ khả dụng
    // (ký quỹ = giá trị / đòn bẩy ≤ vốn) — cắt khối lượng thay vì cho vay vượt vốn.
    const capNotional = this.config.notionalMax > 0 ? this.config.notionalMax : this.state.balance * (lev || this.config.donBay);
    if (q * entry > capNotional) {
      q = capNotional / entry; riskUsdt = q * risk;
      this.log(`⚠ LỆNH TAY ${coin}: KL bị trần notional ${fmtUsd(capNotional)} → ${q.toFixed(4)}`, "warn");
    }
    const pos = {
      id: this._idMoi("M"),
      coin, side, san, mode, lev, nguon: "tay",
      entry, sl, slGoc: sl, tp, qty: q, riskUsdt,
      moLuc: Date.now(), beDaDoi: false, score: SIGNAL_CACHE.get(coin)?.score ?? null,
      ctx: this._buildCtx(coin, side, lev),
    };
    this.state.positions.push(pos);
    this.state.lastEntryAt[coin] = Date.now();
    // P-02: đăng ký coin vào PriceHub để tick SL/TP về ngay cả khi ngoài watchlist
    if (typeof PRICE_HUB !== "undefined" && PRICE_HUB?.subscribe) PRICE_HUB.subscribe(coin);
    this.log(`🖐 LỆNH TAY ${side.toUpperCase()} ${coin} @ ${fmtGia(entry)} · ${san} x${lev} ${mode} · SL ${fmtGia(sl)} · TP ${fmtGia(tp)} · KL ${q.toFixed(4)} ≈ ${fmtUsd(q * entry)} · rủi ro ${fmtUsd(riskUsdt)} (qua kiểm tra an toàn 2 bước)`, "ok");
    this._save();
    document.dispatchEvent(new CustomEvent("siro:botpos"));
    return pos;
  }

  /* L-05: lệnh Limit CHỜ KHỚP — không mở vị thế ngay khi giá chưa về limit.
   * Khớp khi: long && giá <= entryLimit (khớp TẠI entryLimit), short && giá >= entryLimit.
   * Hủy khi: giá chạm SL trước khi khớp, hoặc hết hạn 4h. */
  datLenhCho({ coin, side, san = "BINANCE", mode = "isolated", lev = 3, entryLimit, sl, tp, riskPct, qty }) {
    if (!bracketHopLe(side, entryLimit, sl, tp)) {
      this.log(`⛔ LỆNH CHỜ ${side.toUpperCase()} ${coin}: SL/TP ngược phía (limit ${fmtGia(entryLimit)}, SL ${fmtGia(sl)}, TP ${fmtGia(tp)}) — TỪ CHỐI`, "err");
      return null;
    }
    if (!(entryLimit > 0) || !(sl > 0) || !(tp > 0)) return null;
    const risk = side === "long" ? entryLimit - sl : sl - entryLimit;
    if (!(risk > 0)) return null;
    let q, riskUsdt;
    if (qty > 0) { q = qty; riskUsdt = qty * risk; }
    else { riskUsdt = this.state.balance * (riskPct || this.config.riskPct) / 100; q = riskUsdt / risk; }
    const capNotional = this.config.notionalMax > 0 ? this.config.notionalMax : this.state.balance * (lev || this.config.donBay);
    if (q * entryLimit > capNotional) {
      q = capNotional / entryLimit; riskUsdt = q * risk;
      this.log(`⚠ LỆNH CHỜ ${coin}: KL bị trần notional ${fmtUsd(capNotional)} → ${q.toFixed(4)}`, "warn");
    }
    const lenh = {
      id: this._idMoi("C"), coin, side, san, mode, lev, nguon: "tay",
      entryLimit, sl, tp, qty: q, riskUsdt,
      datLuc: Date.now(), hetHan: Date.now() + 4 * 3600e3,
      score: SIGNAL_CACHE.get(coin)?.score ?? null,
    };
    if (!Array.isArray(this.state.pendingOrders)) this.state.pendingOrders = [];
    this.state.pendingOrders.push(lenh);
    if (typeof PRICE_HUB !== "undefined" && PRICE_HUB?.subscribe) PRICE_HUB.subscribe(coin); // P-02
    this.log(`⏳ LỆNH CHỜ ${side.toUpperCase()} ${coin} @ limit ${fmtGia(entryLimit)} · SL ${fmtGia(sl)} · TP ${fmtGia(tp)} · KL ${q.toFixed(4)} · hết hạn sau 4h`, "info");
    this._save();
    document.dispatchEvent(new CustomEvent("siro:botpos"));
    return lenh;
  }
  huyLenhCho(id, lyDo = "Hủy tay") {
    const truoc = (this.state.pendingOrders || []).length;
    this.state.pendingOrders = (this.state.pendingOrders || []).filter(l => l.id !== id);
    if (this.state.pendingOrders.length === truoc) return false;
    this.log(`🗑 Lệnh chờ ${id} đã hủy (${lyDo})`, "warn");
    this._save();
    document.dispatchEvent(new CustomEvent("siro:botpos"));
    return true;
  }
  _xuLyLenhCho(coin, gia) {
    if (!gia || !Array.isArray(this.state.pendingOrders)) return;
    let doi = false;
    for (const lenh of [...this.state.pendingOrders]) {
      if (lenh.coin !== coin) continue;
      const { side } = lenh;
      // Giá chạm SL trước khi khớp → hủy (không vào lệnh đã sai hướng)
      if ((side === "long" && gia <= lenh.sl) || (side === "short" && gia >= lenh.sl)) {
        this.state.pendingOrders = this.state.pendingOrders.filter(l => l.id !== lenh.id);
        this.log(`🗑 Lệnh chờ ${side.toUpperCase()} ${coin} @ ${fmtGia(lenh.entryLimit)} bị HỦY — giá chạm SL ${fmtGia(lenh.sl)} trước khi khớp`, "warn");
        doi = true; continue;
      }
      if (Date.now() > lenh.hetHan) {
        this.state.pendingOrders = this.state.pendingOrders.filter(l => l.id !== lenh.id);
        this.log(`⌛ Lệnh chờ ${side.toUpperCase()} ${coin} @ ${fmtGia(lenh.entryLimit)} HẾT HẠN 4h chưa khớp — đã hủy`, "warn");
        doi = true; continue;
      }
      const khop = (side === "long" && gia <= lenh.entryLimit) || (side === "short" && gia >= lenh.entryLimit);
      if (!khop) continue;
      this.state.pendingOrders = this.state.pendingOrders.filter(l => l.id !== lenh.id);
      // Khớp tại giá limit (không khớp tại giá thị trường đã xuyên qua limit)
      const pos = this.moLenhTay({ coin: lenh.coin, side: lenh.side, san: lenh.san, mode: lenh.mode, lev: lenh.lev, entry: lenh.entryLimit, sl: lenh.sl, tp: lenh.tp, riskPct: null, qty: lenh.qty });
      if (pos) this.log(`✅ LỆNH CHỜ KHỚP ${side.toUpperCase()} ${coin} @ ${fmtGia(lenh.entryLimit)} (giá thị trường ${fmtGia(gia)})`, "ok");
      else this.log(`⛔ Lệnh chờ ${coin} tới limit nhưng không mở được vị thế (kiểm tra SL/entry)`, "err");
      doi = true;
    }
    if (doi) { this._save(); document.dispatchEvent(new CustomEvent("siro:botpos")); }
  }

  /* Giám sát tick giá — gọi từ PriceHub (mọi sàn; vị thế khớp theo sàn của nó) */
  onTick(coin, gia, san = "BINANCE") {
    if (!gia) return;
    // L-05: xử lý lệnh chờ khớp của coin này trước
    this._xuLyLenhCho(coin, gia);
    let thayDoi = false;
    const kiemSLTP = (pos, g, nguon) => {
      const { side } = pos;
      // Dời SL về hòa vốn khi +1R (bước 5 quy trình Mr.Bit)
      if (this.config.doiSLveBE && !pos.beDaDoi) {
        const r1 = side === "long" ? pos.entry + (pos.entry - pos.slGoc) : pos.entry - (pos.slGoc - pos.entry);
        if ((side === "long" && g >= r1) || (side === "short" && g <= r1)) {
          pos.sl = pos.entry; pos.beDaDoi = true; thayDoi = true;
          this.log(`🛡 ${pos.coin}: đạt +1R → dời SL về hòa vốn ${fmtGia(pos.entry)} (giá ${nguon}). "Đặt xong thì quên đi."`, "ok");
        }
      }
      // SL/TP — L-12: thoát theo GIÁ TICK kích hoạt (g), không phải giá SL/TP
      // danh nghĩa: giá nhảy qua SL/TP thì lỗ/lãi tính theo giá khớp thật.
      const dinhSL = side === "long" ? g <= pos.sl : g >= pos.sl;
      const dinhTP = side === "long" ? g >= pos.tp : g <= pos.tp;
      if (dinhSL || dinhTP) {
        this.dongLenh(pos, g, dinhTP ? "TP" : (pos.beDaDoi ? "BE" : "SL"), nguon);
        thayDoi = true;
      }
    };
    for (const pos of [...this.state.positions]) {
      if (pos.coin !== coin) continue;
      const sanPos = pos.san || "BINANCE";
      // L-06: so sánh theo SLOT giá (MEXC → MEXC_PERP, BINANCE-F → BINANCE_PERP);
      // "REST" là giá dự phòng từ _kiemTraFeedChet — luôn dùng để canh.
      const slotPos = (typeof slotGiaTheoSan === "function") ? slotGiaTheoSan(sanPos) : sanPos;
      if (san === "REST" || slotPos === san) { kiemSLTP(pos, gia, san); continue; }
      /* FIX v2.0 (C4): feed của sàn vị thế chết > 20s → dùng giá TƯƠI NHẤT chéo sàn
       * (kể cả perp, có ghi rõ nguồn) để canh SL/TP, thay vì bỏ mặc vị thế không ai canh. */
      const tsFeed = PRICE_HUB?.prices?.[slotPos]?.[coin]?.ts || 0;
      if (Date.now() - tsFeed > 20e3) {
        const tuoi = PRICE_HUB?.giaTuoiNhat?.(coin);
        if (tuoi?.gia) kiemSLTP(pos, tuoi.gia, `chéo sàn [${tuoi.san}]${tuoi.laPerp ? " (perp)" : ""}`);
      }
    }
    if (thayDoi) { this._save(); document.dispatchEvent(new CustomEvent("siro:botpos")); }
  }

  dongLenh(pos, giaThoat, lyDo, nguonGia) {
    const pnlGoc = (pos.side === "long" ? giaThoat - pos.entry : pos.entry - giaThoat) * pos.qty;
    // FIX v2.0: trừ phí taker 2 chiều — paper PnL trước đây "miễn phí" nên đẹp hơn thực tế
    const phi = pos.qty * (pos.entry + giaThoat) * (this.config.phiPct || 0) / 100;
    const pnl = pnlGoc - phi;
    const rQuy = pos.riskUsdt ? pnl / pos.riskUsdt : 0;
    this.state.balance += pnl;
    this.state.equity = this.state.balance + this._pnlMo();
    this.state.positions = this.state.positions.filter(p => p.id !== pos.id);
    this.state.history.unshift({ ...pos, giaThoat, pnl, pnlGoc: +pnlGoc.toFixed(2), phi: +phi.toFixed(2), rQuy: +rQuy.toFixed(2), dongLuc: Date.now(), lyDo });
    if (this.state.history.length > 300) this.state.history.length = 300;
    this.state.equityCurve.push({ t: Date.now(), v: this.state.equity });
    if (this.state.equityCurve.length > 500) this.state.equityCurve.shift();
    const icon = pnl >= 0 ? "🟢" : "🔴";
    this.log(`${icon} ĐÓNG ${pos.side.toUpperCase()} ${pos.coin} @ ${fmtGia(giaThoat)} (${lyDo}${nguonGia ? " · giá " + nguonGia : ""}) · PnL ${fmtUsd(pnl)} (phí ${fmtUsd(phi)}) (${rQuy >= 0 ? "+" : ""}${rQuy.toFixed(2)}R) · Vốn ${fmtUsd(this.state.balance)}`, pnl >= 0 ? "ok" : "err");
    this._capNhatNgay();
    this._save();
    // Vòng tự học: mỗi lệnh đóng → cập nhật kiến thức
    document.dispatchEvent(new CustomEvent("siro:tradeClose", { detail: { coin: pos.coin, pnl, rQuy } }));
    if (typeof hocTuLichSu === "function") { try { hocTuLichSu(); } catch {} }
  }

  dongTatCa() {
    for (const pos of [...this.state.positions]) {
      const gia = PRICE_HUB?.gia(pos.coin) ?? pos.entry;
      this.dongLenh(pos, gia, "Đóng tay");
    }
    document.dispatchEvent(new CustomEvent("siro:botpos"));
  }

  _pnlMo() {
    let s = 0;
    for (const p of this.state.positions) {
      // L-06: đọc giá theo SLOT (MEXC → MEXC_PERP), không đọc nhầm slot spot
      const slot = (typeof slotGiaTheoSan === "function") ? slotGiaTheoSan(p.san || "BINANCE") : (p.san || "BINANCE");
      const gia = PRICE_HUB?.prices?.[slot]?.[p.coin]?.gia ?? PRICE_HUB?.gia(p.coin);
      if (gia) s += (p.side === "long" ? gia - p.entry : p.entry - gia) * p.qty;
    }
    return s;
  }

  thongKe() {
    const h = this.state.history;
    const thang = h.filter(x => x.pnl > 0).length;
    const tongPnl = h.reduce((a, x) => a + x.pnl, 0);
    const avgR = h.length ? h.reduce((a, x) => a + x.rQuy, 0) / h.length : 0;
    this.state.equity = this.state.balance + this._pnlMo();
    return {
      soLenh: h.length, thang, thua: h.length - thang,
      winRate: h.length ? Math.round(thang / h.length * 100) : 0,
      tongPnl, avgR: +avgR.toFixed(2),
      balance: this.state.balance, equity: this.state.equity,
      pnlMo: this._pnlMo(),
      ddNgayPct: (this.state.dayStartEquity - this.state.equity) / this.state.dayStartEquity * 100,
    };
  }

  resetVon() {
    this.state = {
      balance: SETTINGS.risk.vonBanDau, equity: SETTINGS.risk.vonBanDau,
      positions: [], history: [], logs: this.state.logs.slice(0, 50), pendingOrders: [],
      dayKey: this._dayKey(), dayStartEquity: SETTINGS.risk.vonBanDau,
      lastEntryAt: {}, equityCurve: [{ t: Date.now(), v: SETTINGS.risk.vonBanDau }],
      circuitTripped: false,
    };
    this.log(`♻️ Reset vốn ảo về ${fmtUsd(SETTINGS.risk.vonBanDau)}`, "warn");
    this._save();
  }

  xuatCSV() {
    const rows = [["Coin", "Hướng", "Entry", "Thoát", "SL gốc", "TP", "KL", "PnL(USDT)", "R", "Lý do", "Mở lúc", "Đóng lúc"]];
    for (const h of this.state.history) {
      rows.push([h.coin, h.side, h.entry, h.giaThoat, h.slGoc, h.tp, h.qty, h.pnl.toFixed(2), h.rQuy, h.lyDo, new Date(h.moLuc).toISOString(), new Date(h.dongLuc).toISOString()]);
    }
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `siro-bot-nhatky-${this._dayKey()}.csv`;
    a.click();
  }
}

const WHALE_CACHE = new Map();
let PAPER_BOT = null;
