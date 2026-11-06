/* ============================================================
 * Trade.2026 — supabase-writer.js
 * Lớp ghi Supabase (PostgREST) cho trạm 24/7, KHÔNG dùng dependency ngoài
 * (dùng fetch có sẵn của Node 18+).
 *
 * Auth — Supabase REST cần CẢ 2 key trên mọi request:
 *   header `apikey`            = SUPABASE_ANON_KEY    (key publishable sb_publishable_...)
 *   header `Authorization`     = Bearer SUPABASE_SERVICE_KEY (key secret sb_secret_...)
 * Trên GitHub Actions cả 2 key lấy từ GitHub Secrets (xem HUONG_DAN.md).
 * CHÚ Ý: test từ sandbox chỉ dùng được 1 key/request (kênh bảo mật chặn
 * request mang 2 key khác nhau — lỗi 403 credential_ambiguity), nên đường
 * ghi bằng service key KHÔNG test được từ sandbox; máy chạy Actions gọi
 * trực tiếp nên không vướng giới hạn này.
 *
 * Quy tắc an toàn: KHÔNG BAO GIỜ in key/token ra log — chỉ log tên bảng,
 * số dòng và HTTP status.
 * ============================================================ */
"use strict";

const DEFAULT_TIMEOUT_MS = 30000;
const BATCH_SIZE = 100;

function env(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[supabase-writer] thiếu biến môi trường ${name} — kiểm tra GitHub Secrets của repo (xem HUONG_DAN.md mục 1)`
    );
  }
  return v;
}

function createFromEnv() {
  return create({
    url: env("SUPABASE_URL"),
    anonKey: env("SUPABASE_ANON_KEY"),
    serviceKey: env("SUPABASE_SERVICE_KEY"),
  });
}

function create({ url, anonKey, serviceKey }) {
  if (!url || !anonKey || !serviceKey) {
    throw new Error("[supabase-writer] cần đủ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY");
  }
  const base = String(url).replace(/\/+$/, "") + "/rest/v1";

  function headers(extra) {
    return {
      apikey: anonKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(extra || {}),
    };
  }

  async function request(method, path, { body, prefer } = {}) {
    const u = base + path;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const res = await fetch(u, {
          method,
          headers: headers(prefer ? { Prefer: prefer } : undefined),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl.signal,
        });
        const text = await res.text();
        if (res.status === 401) {
          throw new Error(
            `[supabase-writer] HTTP 401 khi gọi ${method} ${path.split("?")[0]} — key sai hoặc hết hạn, kiểm tra lại GitHub Secrets SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY`
          );
        }
        if (!res.ok) {
          throw new Error(
            `[supabase-writer] HTTP ${res.status} khi gọi ${method} ${path.split("?")[0]}: ${text.slice(0, 300)}`
          );
        }
        return text ? JSON.parse(text) : null;
      } catch (e) {
        clearTimeout(t);
        const retryable =
          e.name === "AbortError" ||
          e instanceof TypeError ||
          /HTTP 5\d\d/.test(e.message || "");
        if (retryable && attempt === 1) {
          lastErr = e;
          console.log(`[supabase-writer] ${method} ${path.split("?")[0]} lỗi (${e.message.slice(0, 80)}) — thử lại 1 lần sau 2s`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr;
  }

  async function upsert(table, rows, onConflict) {
    if (!rows.length) return { table, count: 0 };
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      await request("POST", `/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        body: chunk,
        prefer: "return=minimal,resolution=merge-duplicates",
      });
      done += chunk.length;
      console.log(`[supabase-writer] upsert ${table}: ${done}/${rows.length} dòng`);
    }
    return { table, count: done };
  }

  /* ---------- Đọc ---------- */
  async function readSignals(limit = 300) {
    return request("GET", `/signals?select=*&order=ts_vao.desc&limit=${limit}`);
  }
  async function readHeartbeat(tram) {
    const rows = await request(
      "GET",
      `/station_heartbeat?select=tram,cap_nhat,meta&tram=eq.${encodeURIComponent(tram)}`
    );
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  async function readLatest(table, limit = 800, orderCol = "ts") {
    return request("GET", `/${table}?select=*&order=${orderCol}.desc&limit=${limit}`);
  }
  async function queryEvents(table, fromISO, toISO, limit = 1000) {
    const rows = await request(
      "GET",
      `/${table}?select=*&ts=gte.${encodeURIComponent(fromISO)}&ts=lt.${encodeURIComponent(toISO)}&order=ts.asc&limit=${limit}`
    );
    if (Array.isArray(rows) && rows.length >= limit) {
      console.log(`[supabase-writer] ⚠ queryEvents ${table} chạm giới hạn ${limit} dòng — cửa sổ có thể còn sự kiện chưa lấy`);
    }
    return rows;
  }

  /* ---------- Ghi ---------- */
  async function writeSignals(records) {
    const rows = [];
    let skipped = 0;
    for (const r of records || []) {
      const m = mapSignal(r);
      if (!m) { skipped++; continue; }
      rows.push(m);
    }
    if (skipped) console.log(`[supabase-writer] bỏ qua ${skipped} bản ghi signals không hợp lệ (thiếu id/coin/side)`);
    return upsert("signals", rows, "id");
  }
  async function writeWhales(events) {
    const rows = (events || []).map(mapWhale).filter(Boolean);
    return upsert("whale_events", rows, "id");
  }
  async function writeLiquidations(events) {
    const rows = (events || []).map(mapLiquidation).filter(Boolean);
    return upsert("liquidations", rows, "id");
  }
  async function writeFlowBuckets(buckets) {
    const rows = (buckets || []).map(mapBucket).filter(Boolean);
    return upsert("flow_buckets_12h", rows, "w,coin");
  }
  async function writeHeartbeat(tram, meta) {
    return upsert(
      "station_heartbeat",
      [{ tram, cap_nhat: new Date().toISOString(), meta: meta || {} }],
      "tram"
    );
  }

  return {
    readSignals, readHeartbeat, readLatest, queryEvents,
    writeSignals, writeWhales, writeLiquidations, writeFlowBuckets, writeHeartbeat,
  };
}

/* ---------- Kiểu dữ liệu ---------- */
function numOrNull(v) {
  const n = +v;
  return Number.isFinite(n) ? n : null;
}
function isoOrNull(ms) {
  const n = +ms;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}
function jsonOrNull(v) {
  if (v === null || v === undefined) return null;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

/* ---------- Mapping: bản ghi journal (camelCase) -> bảng signals (snake_case) ----------
 * Bảng signals KHÔNG có các cột sau nên bị bỏ (vẫn còn trong file JSON nhánh data):
 * featureSnapshot, nnDanhGia, checklist, giaVaoKeHoach, daDanhGiaDen,
 * verdictGoc, lyDo, tsEntryMoPhong, nn (xác suất NN).
 * tp2 = null: journal chỉ lưu TP1 (rec.tp); TP2 của engine không được journal giữ. */
function mapSignal(r) {
  if (!r || typeof r !== "object") return null;
  const id = String(r.id || "").slice(0, 120);
  const coin = String(r.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const side = r.side === "long" || r.side === "short" ? r.side : null;
  if (!id || !coin || !side) return null;
  return {
    id,
    coin,
    side,
    loai: r.loai === "giay" ? "giay" : "that",
    diem: Number.isFinite(+r.diem) ? Math.trunc(+r.diem) : null,
    gia_vao: numOrNull(r.giaVao),
    sl: numOrNull(r.sl),
    tp1: numOrNull(r.tp),
    tp2: null,
    rr: numOrNull(r.rr),
    phase: typeof r.phase === "string" ? r.phase.slice(0, 40) : null,
    trang_thai: typeof r.trangThai === "string" ? r.trangThai.slice(0, 40) : null,
    ket_qua: jsonOrNull(r.ketQua),
    ts_vao: isoOrNull(r.tsVao),
    ts_dong: r.ketQua && r.ketQua.at ? isoOrNull(r.ketQua.at) : null,
    phien: typeof r.phien === "string" ? r.phien.slice(0, 40) : null,
    bias_4h: typeof r.bias4h === "string" ? r.bias4h.slice(0, 20) : null,
    cau_truc: jsonOrNull(r.cauTruc),
    ob: jsonOrNull(r.ob),
    nen: jsonOrNull(r.nen),
    nguon: r.nguon === "browser" ? "browser" : "tram",
  };
}

/* Lệnh lớn: flow-collector ghi {id, san, coin, price, qty, usd, side BUY/SELL, ts (ms)} */
function mapWhale(e) {
  if (!e || typeof e !== "object") return null;
  const id = String(e.id || "").slice(0, 120);
  const coin = String(e.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ts = isoOrNull(e.ts);
  if (!id || !coin || !ts) return null;
  return {
    id,
    san: String(e.san || "").slice(0, 20),
    coin,
    price: numOrNull(e.price),
    qty: numOrNull(e.qty),
    usd: numOrNull(e.usd),
    side: e.side === "BUY" || e.side === "SELL" ? e.side : null,
    ts,
  };
}

/* Thanh lý: flow-collector ghi {id, san, coin, price, qty, usd, huong LONG/SHORT, ts (ms)}.
 * Bảng liquidations dùng cột `side` (không có check) nên map huong -> side nguyên giá trị. */
function mapLiquidation(e) {
  if (!e || typeof e !== "object") return null;
  const id = String(e.id || "").slice(0, 120);
  const coin = String(e.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ts = isoOrNull(e.ts);
  if (!id || !coin || !ts) return null;
  return {
    id,
    san: String(e.san || "").slice(0, 20),
    coin,
    price: numOrNull(e.price),
    qty: numOrNull(e.qty),
    usd: numOrNull(e.usd),
    side: e.huong === "LONG" || e.huong === "SHORT" ? e.huong : null,
    ts,
  };
}

/* Bucket 12h: snapshot ghi {w (ms epoch), coin, takerMua, takerBan, whaleMua, whaleBan,
 * nWhaleMua, nWhaleBan, liqLong, liqShort, nLiqLong, nLiqShort, srcW, srcL}.
 * Trạm không tính taker nên takerMua/takerBan = null. */
function mapBucket(b) {
  if (!b || typeof b !== "object") return null;
  const w = isoOrNull(b.w);
  const coin = String(b.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!w || !coin) return null;
  const intOrNull = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : null);
  return {
    w,
    coin,
    taker_mua: numOrNull(b.takerMua),
    taker_ban: numOrNull(b.takerBan),
    whale_mua: numOrNull(b.whaleMua),
    whale_ban: numOrNull(b.whaleBan),
    n_whale_mua: intOrNull(b.nWhaleMua),
    n_whale_ban: intOrNull(b.nWhaleBan),
    liq_long: numOrNull(b.liqLong),
    liq_short: numOrNull(b.liqShort),
    n_liq_long: intOrNull(b.nLiqLong),
    n_liq_short: intOrNull(b.nLiqShort),
    src_w: typeof b.srcW === "string" ? b.srcW.slice(0, 60) : null,
    src_l: typeof b.srcL === "string" ? b.srcL.slice(0, 60) : null,
  };
}

module.exports = { create, createFromEnv, mapSignal, mapWhale, mapLiquidation, mapBucket };
