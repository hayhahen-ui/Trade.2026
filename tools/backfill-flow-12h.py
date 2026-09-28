#!/usr/bin/env python3
"""Trade.2026 — Backfill lịch sử dòng tiền 12h từ 01/01/2026.

Mỗi ngày ghi 2 khung (00:00 và 12:00 giờ VN, GMT+7), đúng yêu cầu user 28/09/2026.

Nguồn (miễn phí, không cần key):
  - Whale flow (lệnh ≥$100K) + taker mua/bán: Binance aggTrades
    (data.binance.vision — monthly 2026-01..08 + daily 2026-09-01..27).
  - Thanh lý: CoinEx GET /v2/futures/liquidation-history (public, phân trang
    ngược về 01/01/2026). Ghi rõ nguồn "CoinEx" từng bản ghi.

Output: data/flow-history-12h.json (đẩy lên nhánh `data`, web đọc từ
raw.githubusercontent.com/.../data/data/flow-history-12h.json).

Chạy: python3 tools/backfill-flow-12h.py  (có checkpoint, chạy lại an toàn)
"""
import csv, datetime, io, json, os, sys, time, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
OUT_PATH = os.path.join(DATA_DIR, "flow-history-12h.json")
TMP = os.path.join(ROOT, ".backfill-tmp")  # workspace: 7.5GB, /tmp chỉ 512MB tmpfs
os.makedirs(TMP, exist_ok=True)

COINS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "DYDX"]
W12H = 12 * 3600 * 1000
OFF7 = 7 * 3600 * 1000
NGUONG = 100_000  # $100K như trạm/web

UTC7 = datetime.timezone(datetime.timedelta(hours=7))
def ms(y, mo, d, h=0, mi=0):
    return int(datetime.datetime(y, mo, d, h, mi, tzinfo=UTC7).timestamp() * 1000)

CUTOFF_START = ms(2026, 1, 1)                       # từ 01/01/2026 00:00 +07
now_ms = int(time.time() * 1000)
LAST_DONE = ((now_ms + OFF7) // W12H) * W12H - OFF7  # biên 12h hoàn chỉnh gần nhất
print(f"[backfill] cutoff: w >= {CUTOFF_START}, w_end <= {LAST_DONE}", flush=True)

def wstart(ts):
    return ((ts + OFF7) // W12H) * W12H - OFF7

def fmtw(w):
    return datetime.datetime.fromtimestamp(w / 1000, UTC7).strftime("%d/%m %H:%M")

# buckets[(coin, w)] = dict(takerMua, takerBan, whaleMua, whaleBan, nWM, nWB,
#                           liqLong, liqShort, nLL, nLS)
buckets = {}
def B(coin, w):
    k = (coin, w)
    b = buckets.get(k)
    if b is None:
        b = buckets[k] = {"takerMua": 0.0, "takerBan": 0.0, "whaleMua": 0.0,
                          "whaleBan": 0.0, "nWM": 0, "nWB": 0,
                          "liqLong": 0.0, "liqShort": 0.0, "nLL": 0, "nLS": 0}
    return b

BK_PATH = os.path.join(TMP, "buckets.json")
def bk_save():
    tmp = BK_PATH + ".tmp"
    json.dump([[c, w, b] for (c, w), b in buckets.items()], open(tmp, "w"))
    os.replace(tmp, BK_PATH)
def bk_load():
    if os.path.exists(BK_PATH):
        for c, w, b in json.load(open(BK_PATH)):
            buckets[(c, w)] = b
        wlog(f"nạp {len(buckets)} buckets từ lần chạy trước")

def wlog(m):
    print(f"[backfill] {m}", flush=True)

# ---------- Phase 1: Binance aggTrades ----------
def dl(url, path):
    """Tải file. Trả về True / "404" / False (lỗi tạm thời)."""
    if os.path.exists(path):
        return True
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "trade2026-backfill"})
            with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
                while True:
                    ch = r.read(1 << 20)
                    if not ch:
                        break
                    f.write(ch)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "404"
            wlog(f"download thử {attempt+1}: HTTP {e.code} {url}")
        except Exception as e:
            wlog(f"download thử {attempt+1} lỗi {url}: {e}")
        try: os.remove(path)
        except OSError: pass
        time.sleep(5)
    return False

def proc_zip(coin, path):
    n = 0
    with zipfile.ZipFile(path) as z:
        with z.open(z.namelist()[0]) as f:
            first = True
            for line in f:
                if first:
                    first = False
                    continue  # header
                p = line.split(b",")
                try:
                    price = float(p[1]); qty = float(p[2]); ts = int(p[5])
                except (ValueError, IndexError):
                    continue
                if ts < CUTOFF_START or ts >= LAST_DONE:
                    continue
                w = wstart(ts)
                if w < CUTOFF_START or w >= LAST_DONE:
                    continue
                maker = p[6][0] == 84  # 'T': buyer là maker -> taker SELL
                usd = price * qty
                b = B(coin, w)
                if maker:
                    b["takerBan"] += usd
                else:
                    b["takerMua"] += usd
                if usd >= NGUONG:
                    if maker:
                        b["nWB"] += 1; b["whaleBan"] += usd
                    else:
                        b["nWM"] += 1; b["whaleMua"] += usd
                n += 1
    return n

def phase_binance():
    # dọn file zip dở từ lần chạy trước (checkpoint chỉ đánh dấu file xử lý xong)
    for f in os.listdir(TMP):
        if f.endswith(".zip"):
            try: os.remove(os.path.join(TMP, f)); wlog(f"xóa zip dở: {f}")
            except OSError: pass
    ck = os.path.join(TMP, "ck-binance.json")
    done = set(json.load(open(ck))) if os.path.exists(ck) else set()
    jobs = []
    for coin in COINS:
        for m in range(1, 9):
            jobs.append((coin, f"monthly/aggTrades/{coin}USDT/{coin}USDT-aggTrades-2026-{m:02d}.zip"))
        for d in range(1, 28):
            jobs.append((coin, f"daily/aggTrades/{coin}USDT/{coin}USDT-aggTrades-2026-09-{d:02d}.zip"))
    for coin, rel in jobs:
        key = f"{coin}|{rel}"
        if key in done:
            continue
        path = os.path.join(TMP, os.path.basename(rel))
        st = dl("https://data.binance.vision/data/futures/um/" + rel, path)
        if st == "404":
            wlog(f"bỏ qua (404): {rel}")
            done.add(key); json.dump(sorted(done), open(ck, "w")); continue
        if not st:
            wlog(f"TẠM BỎ {rel} (lỗi mạng sau 4 lần thử) — lần chạy sau sẽ thử lại")
            continue  # KHÔNG đánh dấu done: lỗi tạm thời phải thử lại
        t0 = time.time()
        try:
            n = proc_zip(coin, path)
        except Exception as e:
            wlog(f"LỖI xử lý {os.path.basename(rel)}: {e} — bỏ qua, lần sau thử lại")
            try: os.remove(path)
            except OSError: pass
            continue  # KHÔNG đánh dấu done
        wlog(f"{coin} {os.path.basename(rel)}: {n/1e6:.1f}M dòng, {time.time()-t0:.0f}s")
        os.remove(path)
        done.add(key); json.dump(sorted(done), open(ck, "w"))
        bk_save()

# ---------- Phase 2: CoinEx liquidation history ----------
def cx_get(market, page, limit=100):
    u = (f"https://api.coinex.com/v2/futures/liquidation-history?market={market}"
         f"&limit={limit}&page={page}")
    req = urllib.request.Request(u, headers={"User-Agent": "trade2026-backfill"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def phase_coinex():
    seen_global = set()
    for coin in COINS:
        market = f"{coin}USDT"
        n_rec, page = 0, 1
        oldest = None
        while True:
            try:
                d = cx_get(market, page)
            except Exception as e:
                wlog(f"CoinEx {market} page {page} lỗi: {e}; nghỉ 5s thử lại 1 lần")
                time.sleep(5)
                try:
                    d = cx_get(market, page)
                except Exception as e2:
                    wlog(f"CoinEx {market} bỏ qua từ page {page}: {e2}")
                    break
            rows = d.get("data") or []
            if not rows:
                wlog(f"CoinEx {market}: hết dữ liệu ở page {page}")
                break
            stop = False
            for r in rows:
                try:
                    ts = int(r["created_at"])
                    usd = float(r["liq_amount"]) * float(r["liq_price"])
                    side = r.get("side")
                except (KeyError, ValueError, TypeError):
                    continue
                dk = (market, ts, r.get("liq_amount"), side)
                if dk in seen_global:
                    continue
                seen_global.add(dk)
                if ts < CUTOFF_START:
                    stop = True
                    continue
                w = wstart(ts)
                if w < CUTOFF_START or w >= LAST_DONE:
                    continue
                b = B(coin, w)
                if side == "long":
                    b["liqLong"] += usd; b["nLL"] += 1
                elif side == "short":
                    b["liqShort"] += usd; b["nLS"] += 1
                n_rec += 1
                oldest = ts if oldest is None else min(oldest, ts)
            has_next = (d.get("pagination") or {}).get("has_next")
            wlog(f"CoinEx {market} page {page}: +{n_rec} mới, cũ nhất {fmtw(oldest) if oldest else '?'}, has_next={has_next}")
            if stop or not has_next or page >= 2000:
                break
            page += 1
            time.sleep(0.4)
        wlog(f"CoinEx {market}: xong, {n_rec} bản ghi trong khoảng")
        bk_save()

# ---------- Phase 3: merge & ghi ----------
def phase_write():
    recs = []
    for (coin, w), b in sorted(buckets.items()):
        if w < CUTOFF_START or w >= LAST_DONE:
            continue
        recs.append({
            "w": w, "coin": coin,
            "takerMua": round(b["takerMua"]), "takerBan": round(b["takerBan"]),
            "whaleMua": round(b["whaleMua"]), "whaleBan": round(b["whaleBan"]),
            "nWhaleMua": b["nWM"], "nWhaleBan": b["nWB"],
            "liqLong": round(b["liqLong"]), "liqShort": round(b["liqShort"]),
            "nLiqLong": b["nLL"], "nLiqShort": b["nLS"],
            "srcW": "Binance", "srcL": "CoinEx",
        })
    # merge với file cũ (nếu có): giữ bản ghi cũ của cửa sổ chưa có
    old = []
    if os.path.exists(OUT_PATH):
        try:
            old = json.load(open(OUT_PATH)).get("data", [])
        except Exception:
            old = []
    have = {(r["coin"], r["w"]) for r in recs}
    for r in old:
        if (r.get("coin"), r.get("w")) not in have:
            recs.append(r)
    recs.sort(key=lambda r: (r["w"], r["coin"]))
    payload = {"meta": {
        "from": "01/01/2026", "window": "12h", "tz": "GMT+7",
        "nguongWhale": NGUONG,
        "moTa": "Mỗi ngày 2 khung (00:00 & 12:00 giờ VN). Whale/taker: Binance. Thanh lý: CoinEx. Từ 28/09/2026: trạm 24/7 (OKX+Hyperliquid).",
        "capNhat": datetime.datetime.now(UTC7).strftime("%d/%m/%Y %H:%M"),
        "banGhi": len(recs),
    }, "data": recs}
    tmp = OUT_PATH + ".tmp"
    json.dump(payload, open(tmp, "w"), separators=(",", ":"))
    os.replace(tmp, OUT_PATH)
    wlog(f"ghi {OUT_PATH}: {len(recs)} bản ghi, {os.path.getsize(OUT_PATH)/1024:.0f} KB")
    if recs:
        wlog(f"cửa sổ đầu: {fmtw(recs[0]['w'])} {recs[0]['coin']} | cuối: {fmtw(recs[-1]['w'])} {recs[-1]['coin']}")

if __name__ == "__main__":
    t0 = time.time()
    bk_load()
    phase_binance()
    bk_save()
    phase_coinex()
    phase_write()
    wlog(f"HOÀN TẤT sau {time.time()-t0:.0f}s")
