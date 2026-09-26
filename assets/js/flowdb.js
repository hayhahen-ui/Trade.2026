/* ============================================================
 * Trade.2026 — FlowDB: DATABASE DÒNG TIỀN (thu thập liên tục)
 *
 * Vấn đề: trước đây dữ liệu dòng tiền chỉ nằm trong RAM và chỉ bắt
 * đầu gom KỂ TỪ LÚC mở màn hình "Dòng tiền" — tắt tab là mất.
 *
 * Giải pháp: mọi sự kiện whale / thanh lý từ DataHub được ghi LIÊN
 * TỤC vào IndexedDB ngay trong trình duyệt (không cần server):
 *  · Mở màn hình là có sẵn nhiều giờ dữ liệu lịch sử, không "quét lại".
 *  · KPI / điểm coin / phân bổ tính từ database (cửa sổ 60 phút đầy đủ).
 *  · Bucket theo phút từng coin → phân tích & cảnh báo đọc trực tiếp.
 *  · Giữ 7 ngày, tự dọn dữ liệu cũ.
 *
 * Lưu ý trung thực: thu thập chạy khi tab còn mở (giống DataHub).
 * Muốn 24/7 kể cả khi tắt máy cần một collector chạy trên server riêng.
 * ============================================================ */
(function (global) {
  "use strict";

  var DB_NAME = "trade2026-flow";
  var DB_VER = 1;
  var RETENTION_MS = 7 * 24 * 3600e3;   // giữ 7 ngày
  var FLUSH_MS = 2000;                   // gom ghi mỗi 2 giây
  var BUCKET_MS = 60e3;                  // bucket theo phút

  /* ---------- Tập id đã thấy — khử trùng với Trạm 24/7 ----------
   * Web (live) và trạm server có thể ghi CÙNG 1 sự kiện (vd lệnh OKX).
   * Cả hai dùng chung format id (okx-<tradeId>, hl-..., okxl-...),
   * nên giữ tập id trong localStorage để merge không đếm trùng. */
  var FDB_IDS = (function () {
    var KEY = "fdb_ids_v1", MAX = 12000, set = null;
    function store() { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; } }
    function load() {
      if (set) return set;
      set = new Set();
      try {
        var raw = store() && store().getItem(KEY);
        var arr = raw ? JSON.parse(raw) : [];
        for (var i = 0; i < arr.length; i++) set.add(arr[i]);
      } catch (e) {}
      return set;
    }
    return {
      has: function (id) { return id != null && load().has(id); },
      add: function (id) {
        if (id == null) return;
        var s = load(); s.add(id);
        if (s.size > MAX) {
          var it = s.values(), drop = s.size - MAX;
          for (var i = 0; i < drop; i++) { var v = it.next(); if (!v.done) s.delete(v.value); }
        }
      },
      save: function () {
        try { var st = store(); if (st) st.setItem(KEY, JSON.stringify(Array.from(load()))); } catch (e) {}
      },
      _reset: function () { set = null; },
    };
  })();

  var ALERT = {
    burstUsd: 1e6, burstN: 3, burstMin: 5,   // ≥3 lệnh cùng chiều, tổng ≥$1M / 5'
    flipUsd: 3e5, flipMin: 15,                // net 15' đảo dấu, biên ≥$300K
    liqUsd: 5e5, liqMin: 5,                   // thanh lý ≥$500K / 5'
    checkMs: 30e3, cooldownMs: 15 * 60e3, maxKeep: 100,
  };

  /* ================= backend IndexedDB ================= */
  function idbBackend() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
      var db;
      try { db = null; } catch (e) { return reject(e); }
      var rq;
      try { rq = indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { return reject(e); }
      rq.onupgradeneeded = function (ev) {
        var d = ev.target.result;
        function mk(name, opts, idx) {
          if (d.objectStoreNames.contains(name)) return;
          var st = d.createObjectStore(name, opts);
          if (idx) st.createIndex(idx, idx, { unique: false });
        }
        mk("whales", { keyPath: "_id", autoIncrement: true }, "ts");
        mk("liqs",   { keyPath: "_id", autoIncrement: true }, "ts");
        mk("buckets",{ keyPath: "k" }, "t");
        mk("alerts", { keyPath: "_id", autoIncrement: true }, "ts");
      };
      rq.onsuccess = function (ev) {
        var d = ev.target.result;
        resolve({
          put: function (store, obj) {
            return new Promise(function (res, rej) {
              try {
                var tx = d.transaction(store, "readwrite");
                var q2 = tx.objectStore(store).put(obj);
                q2.onsuccess = function () { res(true); };
                q2.onerror = function () { rej(q2.error); };
              } catch (e) { rej(e); }
            });
          },
          del: function (store, key) {
            return new Promise(function (res, rej) {
              try {
                var tx = d.transaction(store, "readwrite");
                var q2 = tx.objectStore(store).delete(key);
                q2.onsuccess = function () { res(true); };
                q2.onerror = function () { rej(q2.error); };
              } catch (e) { rej(e); }
            });
          },
          query: function (store, o) {
            o = o || {};
            return new Promise(function (res, rej) {
              try {
                var tx = d.transaction(store, "readonly");
                var st = tx.objectStore(store);
                var src = o.index ? st.index(o.index) : st;
                var range = null;
                if (o.from != null || o.to != null) {
                  var lo = o.from != null ? o.from : -Infinity;
                  var hi = o.to != null ? o.to : Infinity;
                  range = IDBKeyRange.bound(lo, hi, false, false);
                }
                var q2 = src.openCursor(range, o.desc ? "prev" : "next");
                var out = [];
                q2.onsuccess = function (ev2) {
                  var cur = ev2.target.result;
                  if (cur && (o.limit == null || out.length < o.limit)) {
                    out.push(cur.value); cur.continue();
                  } else res(out);
                };
                q2.onerror = function () { rej(q2.error); };
              } catch (e) { rej(e); }
            });
          },
          count: function (store) {
            return new Promise(function (res, rej) {
              try {
                var tx = d.transaction(store, "readonly");
                var q2 = tx.objectStore(store).count();
                q2.onsuccess = function () { res(q2.result); };
                q2.onerror = function () { rej(q2.error); };
              } catch (e) { rej(e); }
            });
          },
          delOld: function (store, index, beforeTs) {
            return new Promise(function (res, rej) {
              try {
                var tx = d.transaction(store, "readwrite");
                var idx = tx.objectStore(store).index(index);
                var q2 = idx.openCursor(IDBKeyRange.upperBound(beforeTs, true));
                var n = 0;
                q2.onsuccess = function (ev2) {
                  var cur = ev2.target.result;
                  if (cur) { cur.delete(); n++; cur.continue(); }
                  else res(n);
                };
                q2.onerror = function () { rej(q2.error); };
              } catch (e) { rej(e); }
            });
          },
        });
      };
      rq.onerror = function () { reject(rq.error || new Error("idb open failed")); };
      rq.onblocked = function () { reject(new Error("idb blocked")); };
    });
  }

  /* ================= backend RAM (fallback + cho test) ================= */
  function memBackend() {
    var S = { whales: [], liqs: [], buckets: [], alerts: [] };
    var seq = 1;
    function keyOf(store) { return store === "buckets" ? "k" : "_id"; }
    function tsOf(store) { return store === "buckets" ? "t" : "ts"; }
    return {
      put: function (store, obj) {
        var k = keyOf(store);
        if (obj[k] == null) obj[k] = store === "buckets" ? obj.k : seq++;
        var i = S[store].findIndex(function (x) { return x[k] === obj[k]; });
        if (i >= 0) S[store][i] = Object.assign({}, obj);
        else S[store].push(Object.assign({}, obj));
        return Promise.resolve(true);
      },
      del: function (store, key) {
        var k = keyOf(store);
        S[store] = S[store].filter(function (x) { return x[k] !== key; });
        return Promise.resolve(true);
      },
      query: function (store, o) {
        o = o || {};
        var t = tsOf(store), idx = o.index || t;
        var r = S[store].filter(function (x) {
          return (o.from == null || x[idx] >= o.from) && (o.to == null || x[idx] <= o.to);
        });
        r.sort(function (a, b) { return o.desc ? b[idx] - a[idx] : a[idx] - b[idx]; });
        return Promise.resolve(o.limit == null ? r : r.slice(0, o.limit));
      },
      count: function (store) { return Promise.resolve(S[store].length); },
      delOld: function (store, index, beforeTs) {
        var t = index || tsOf(store);
        var before = S[store].length;
        S[store] = S[store].filter(function (x) { return x[t] >= beforeTs; });
        return Promise.resolve(before - S[store].length);
      },
    };
  }

  var SIZE_BUCKETS = [
    ["10K-100K", 10e3, 100e3], ["100K-500K", 100e3, 500e3], ["500K-1M", 500e3, 1e6],
    ["1M-10M", 1e6, 10e6], ["10M+", 10e6, Infinity],
  ];

  /* ================= FlowDB ================= */
  var FlowDB = {
    _be: null, _readyP: null,
    _bufW: [], _bufL: [],
    _bk: new Map(),          // bucket-phút đang gom trong RAM
    _lastAlert: {},          // chống spam cảnh báo
    _lastFlipSign: {},
    _onAlert: [],
    _timers: [],

    /* Dùng backend khác (chủ yếu cho test). */
    _useBackend: function (be) {
      this._be = be;
      this._readyP = Promise.resolve(true);
      return this._readyP;
    },
    _memBackend: memBackend, // factory backend RAM cho test

    init: function () {
      var self = this;
      if (self._readyP) return self._readyP;
      self._readyP = idbBackend().then(function (be) {
        self._be = be;
      }).catch(function (err) {
        console.warn("[FlowDB] IndexedDB không dùng được, dùng RAM tạm:", err && err.message);
        self._be = memBackend();
      }).then(function () {
        self._startTimers();
        self.prune().catch(function () {});
        return true;
      });
      return self._readyP;
    },

    _startTimers: function () {
      var self = this;
      if (self._timers.length) return;
      self._timers.push(setInterval(function () { self._flushBuf().catch(function () {}); }, FLUSH_MS));
      self._timers.push(setInterval(function () { self._flushBuckets().catch(function () {}); }, BUCKET_MS));
      self._timers.push(setInterval(function () { self._checkAlerts().catch(function () {}); }, ALERT.checkMs));
      self._timers.push(setInterval(function () { self.prune().catch(function () {}); }, 24 * 3600e3));
    },

    /* ---------- ghi ---------- */
    _chuanHoa: function (t, isLiq) {
      if (!t || !t.usd) return null;
      return {
        id: t.id != null ? String(t.id) : undefined,
        coin: String(t.coin || "").toUpperCase(),
        side: isLiq ? undefined : (t.side === "SELL" ? "SELL" : "BUY"),
        huong: isLiq ? (t.huong === "SHORT" ? "SHORT" : "LONG") : undefined,
        price: +t.price || 0, qty: +t.qty || 0, usd: +t.usd,
        san: String(t.san || ""), ts: +t.ts || Date.now(),
      };
    },

    trackWhale: function (t) {
      var o = this._chuanHoa(t, false);
      if (!o || !o.coin) return;
      if (o.id) FDB_IDS.add(o.id);
      this._bufW.push(o);
      // gom bucket phút
      var m = Math.floor(o.ts / BUCKET_MS) * BUCKET_MS;
      var k = o.coin + "|" + m;
      var b = this._bk.get(k) || { k: k, coin: o.coin, t: m, buy: 0, sell: 0, n: 0 };
      if (o.side === "BUY") b.buy += o.usd; else b.sell += o.usd;
      b.n++;
      this._bk.set(k, b);
    },

    trackLiq: function (l) {
      var o = this._chuanHoa(l, true);
      if (!o || !o.coin) return;
      if (o.id) FDB_IDS.add(o.id);
      this._bufL.push(o);
    },

    /* ---------- Merge dữ liệu Trạm 24/7 (server) vào database ----------
     * Trạm thu OKX + Hyperliquid liên tục kể cả khi tab tắt.
     * Khử trùng bằng id (đã thấy qua live hoặc lần merge trước thì bỏ). */
    mergeTram: function (d) {
      var self = this, tw = 0, tl = 0, jobs = [];
      var ws = Array.isArray(d && d.whales) ? d.whales : [];
      var ls = Array.isArray(d && d.liqs) ? d.liqs : [];
      ws.forEach(function (t) {
        var o = self._chuanHoa(t, false);
        if (!o || !o.id || FDB_IDS.has(o.id)) return;
        FDB_IDS.add(o.id); tw++;
        jobs.push(self._be.put("whales", o));
      });
      ls.forEach(function (l) {
        var o = self._chuanHoa(l, true);
        if (!o || !o.id || FDB_IDS.has(o.id)) return;
        FDB_IDS.add(o.id); tl++;
        jobs.push(self._be.put("liqs", o));
      });
      FDB_IDS.save();
      return Promise.all(jobs).then(function () {
        return { whales: tw, liqs: tl, capNhat: d && d.capNhat, nguon: d && d.nguon };
      });
    },

    _flushBuf: function () {
      var self = this;
      var ws = self._bufW.splice(0), ls = self._bufL.splice(0);
      if (!ws.length && !ls.length) return Promise.resolve();
      var jobs = [];
      ws.forEach(function (o) { jobs.push(self._be.put("whales", o)); });
      ls.forEach(function (o) { jobs.push(self._be.put("liqs", o)); });
      return Promise.all(jobs).then(function () { return true; });
    },

    _flushBuckets: function () {
      var self = this;
      var nowMin = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
      var jobs = [];
      // ghi mọi bucket của phút đã qua (giữ lại phút hiện tại trong RAM)
      Array.from(self._bk.keys()).forEach(function (k) {
        var b = self._bk.get(k);
        if (b.t < nowMin) { jobs.push(self._be.put("buckets", b)); self._bk.delete(k); }
      });
      return Promise.all(jobs).then(function () { return true; });
    },

    /* ---------- đọc ---------- */
    recentWhales: function (o) {
      o = o || {};
      return this._be.query("whales", { index: "ts", from: o.since, limit: o.limit || 100, desc: true })
        .then(function (r) {
          return o.coin ? r.filter(function (x) { return x.coin === String(o.coin).toUpperCase(); }) : r;
        });
    },

    recentLiqs: function (o) {
      o = o || {};
      return this._be.query("liqs", { index: "ts", from: o.since, limit: o.limit || 100, desc: true })
        .then(function (r) {
          return o.coin ? r.filter(function (x) { return x.coin === String(o.coin).toUpperCase(); }) : r;
        });
    },

    buckets: function (coin, minutes) {
      var t0 = Math.floor((Date.now() - (minutes || 120) * 60e3) / BUCKET_MS) * BUCKET_MS;
      var c = String(coin || "").toUpperCase();
      return this._be.query("buckets", { index: "t", from: t0, limit: 5000 })
        .then(function (r) { return c ? r.filter(function (b) { return b.coin === c; }) : r; });
    },

    /* Cửa sổ dòng tiền N phút — nguồn cho KPI / coin table / phân bổ / cảnh báo */
    flowWindow: function (minutes) {
      var t0 = Date.now() - (minutes || 60) * 60e3;
      var self = this;
      return Promise.all([
        self._be.query("whales", { index: "ts", from: t0, limit: 8000, desc: true }),
        self._be.query("liqs", { index: "ts", from: t0, limit: 8000, desc: true }),
      ]).then(function (pair) {
        var w = pair[0], l = pair[1];
        var perCoin = {}, liqPerCoin = {}, buy = 0, sell = 0;
        for (var i = 0; i < w.length; i++) {
          var t = w[i];
          var c = (perCoin[t.coin] = perCoin[t.coin] || { volume: 0, count: 0, buy: 0, sell: 0 });
          c.volume += t.usd; c.count++;
          if (t.side === "BUY") { c.buy += t.usd; buy += t.usd; }
          else { c.sell += t.usd; sell += t.usd; }
        }
        var dist = {};
        SIZE_BUCKETS.forEach(function (bk) {
          var ten = bk[0], lo = bk[1], hi = bk[2];
          var g = w.filter(function (t) { return t.usd >= lo && t.usd < hi; });
          var b = g.reduce(function (s, t) { return s + (t.side === "BUY" ? t.usd : 0); }, 0);
          var v = g.reduce(function (s, t) { return s + t.usd; }, 0);
          dist[ten] = { count: g.length, volume: v, long: v ? Math.round((b / v) * 100) : 50, short: v ? 100 - Math.round((b / v) * 100) : 50 };
        });
        var liqLong = 0, liqShort = 0;
        for (var j = 0; j < l.length; j++) {
          var x = l[j];
          var lc = (liqPerCoin[x.coin] = liqPerCoin[x.coin] || { long: 0, short: 0 });
          if (x.huong === "LONG") { liqLong += x.usd; lc.long += x.usd; }
          else { liqShort += x.usd; lc.short += x.usd; }
        }
        return {
          t0: t0, minutes: minutes || 60,
          buy: buy, sell: sell, volume: buy + sell, count: w.length, net: buy - sell,
          perCoin: perCoin, liqPerCoin: liqPerCoin, dist: dist,
          liqLong: liqLong, liqShort: liqShort, liqCount: l.length,
        };
      });
    },

    /* Điểm dòng tiền −100..+100 — cùng công thức DataHub (30'): 70% flow + 30% liq */
    flowScore: function (coin) {
      coin = String(coin || "").toUpperCase();
      var self = this;
      return self.flowWindow(30).then(function (fw) {
        var c = fw.perCoin[coin];
        if (!c) return 0;
        var flow = (c.buy + c.sell) ? ((c.buy - c.sell) / (c.buy + c.sell)) * 70 : 0;
        var lc = fw.liqPerCoin[coin];
        var liq = 0;
        if (lc && (lc.long + lc.short)) liq = ((lc.long - lc.short) / (lc.long + lc.short)) * 30;
        return Math.max(-100, Math.min(100, Math.round(flow + liq)));
      });
    },

    /* ---------- cảnh báo ---------- */
    onAlert: function (cb) { if (typeof cb === "function") this._onAlert.push(cb); },

    alerts: function (o) {
      o = o || {};
      return this._be.query("alerts", { index: "ts", limit: o.limit || 20, desc: true });
    },

    _spam: function (key) {
      var last = this._lastAlert[key] || 0;
      if (Date.now() - last < ALERT.cooldownMs) return true;
      this._lastAlert[key] = Date.now();
      return false;
    },

    _pushAlert: function (loai, coin, text) {
      var self = this;
      var key = loai + "|" + (coin || "") + "|" + (text || "").slice(0, 24);
      if (self._spam(key)) return Promise.resolve(null);
      var a = { ts: Date.now(), loai: loai, coin: coin || "", text: text };
      return self._be.put("alerts", a).then(function () {
        return self._be.count("alerts");
      }).then(function (n) {
        if (n > ALERT.maxKeep) {
          return self._be.query("alerts", { index: "ts", limit: n - ALERT.maxKeep }).then(function (old) {
            return Promise.all(old.map(function (o) { return self._be.del("alerts", o._id); }));
          });
        }
      }).then(function () {
        self._onAlert.forEach(function (cb) { try { cb(a); } catch (e) {} });
        return a;
      });
    },

    _checkAlerts: function () {
      var self = this;
      var now = Date.now();
      return self.flowWindow(ALERT.flipMin).then(function (fw) {
        var jobs = [];
        var coins = Object.keys(fw.perCoin);
        // 1. whale burst: ≥N lệnh cùng chiều, tổng ≥ ngưỡng, trong burstMin phút
        var tBurst = now - ALERT.burstMin * 60e3;
        jobs.push(self._be.query("whales", { index: "ts", from: tBurst, limit: 3000, desc: true }).then(function (w) {
          var inner = [];
          coins.forEach(function (coin) {
            ["BUY", "SELL"].forEach(function (side) {
              var g = w.filter(function (t) { return t.coin === coin && t.side === side; });
              var usd = g.reduce(function (s, t) { return s + t.usd; }, 0);
              if (g.length >= ALERT.burstN && usd >= ALERT.burstUsd) {
                var chieu = side === "BUY" ? "MUA" : "BÁN";
                inner.push(self._pushAlert("burst", coin,
                  "🐋 " + coin + ": " + g.length + " lệnh " + chieu + " tổng $" + fmtK(usd) + " trong " + ALERT.burstMin + "′"));
              }
            });
          });
          return Promise.all(inner);
        }));
        // 2. net flip 15'
        coins.forEach(function (coin) {
          var c = fw.perCoin[coin];
          var net = c.buy - c.sell;
          var sign = net > 0 ? 1 : net < 0 ? -1 : 0;
          var prev = self._lastFlipSign[coin];
          if (prev != null && sign !== 0 && prev !== 0 && sign !== prev && Math.abs(net) >= ALERT.flipUsd) {
            jobs.push(self._pushAlert("flip", coin,
              "🔄 " + coin + " đảo chiều dòng tiền " + ALERT.flipMin + "′: net $" + fmtK(net)));
          }
          if (sign !== 0) self._lastFlipSign[coin] = sign;
        });
        // 3. liq cascade
        var tLiq = now - ALERT.liqMin * 60e3;
        jobs.push(self._be.query("liqs", { index: "ts", from: tLiq, limit: 3000, desc: true }).then(function (l) {
          var inner = [];
          var byCoin = {};
          l.forEach(function (x) { (byCoin[x.coin] = byCoin[x.coin] || []).push(x); });
          Object.keys(byCoin).forEach(function (coin) {
            var usd = byCoin[coin].reduce(function (s, x) { return s + x.usd; }, 0);
            if (usd >= ALERT.liqUsd) {
              inner.push(self._pushAlert("liq", coin,
                "💥 " + coin + ": thanh lý $" + fmtK(usd) + " trong " + ALERT.liqMin + "′ (" + byCoin[coin].length + " lệnh)"));
            }
          });
          return Promise.all(inner);
        }));
        return Promise.all(jobs);
      });
    },

    /* ---------- bảo trì ---------- */
    prune: function (days) {
      var self = this;
      var before = Date.now() - (days || 7) * 24 * 3600e3;
      return Promise.all([
        self._be.delOld("whales", "ts", before),
        self._be.delOld("liqs", "ts", before),
        self._be.delOld("buckets", "t", before),
        self._be.delOld("alerts", "ts", before),
      ]);
    },

    stats: function () {
      var self = this;
      return Promise.all([
        self._be.count("whales"), self._be.count("liqs"),
        self._be.count("buckets"), self._be.count("alerts"),
      ]).then(function (n) {
        return { whales: n[0], liqs: n[1], buckets: n[2], alerts: n[3] };
      });
    },
  };

  function fmtK(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return String(Math.round(v));
  }

  global.FlowDB = FlowDB;
  global.__FDB_IDS__ = FDB_IDS; // cho test khử trùng
})(typeof window !== "undefined" ? window : globalThis);
