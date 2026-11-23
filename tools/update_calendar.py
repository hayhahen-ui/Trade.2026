#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Trade.2026 — Cập nhật lịch kinh tế Trading Economics (không cần Chrome)
Xuất data/economic_calendar_data.json ĐÚNG SCHEMA của economic_agent.py
(tương thích 100% — app đọc được cả file do economic_agent.py tạo ra).

Cách dùng:
    python3 tools/update_calendar.py            # ghi vào data/economic_calendar_data.json
    python3 tools/update_calendar.py --out x.json

v2.0: retry exponential backoff (3 lần) · ghi file ATOMIC (temp + os.replace)
      · fetch lỗi thì GIỮ NGUYÊN file cũ và exit 1 (không ghi đè bằng dữ liệu rỗng).

v3.0 (23/11/2026): TE đổi trang lịch sang render bằng JavaScript từ 12/11/2026 —
      HTML tĩnh không còn dòng sự kiện nào (parse ra 0 dòng, workflow lỗi 25/25).
      API guest cũng đã bị TE khai tử (HTTP 410). Nay fetch bằng Chrome headless
      qua Playwright: mở trang thật, chờ `tr[data-id]` render rồi lấy HTML đã
      render; logic parse/sheets/schema giữ nguyên 100%. urllib giữ lại làm
      fallback khi không có Playwright/Chrome. Chạy local trong VM này cần
      proxy nội bộ: HTTP_PROXY/HTTPS_PROXY trỏ tới forward proxy (Chrome tự
      đọc biến môi trường); trên GitHub Actions chạy trực tiếp, không cần proxy.

Lưu ý: trang TE ẩn danh trả giờ UTC → file ghi timezone "UTC";
app tự quy đổi sang giờ Việt Nam (UTC+7) khi hiển thị/phân tích.
"""
from __future__ import annotations

import argparse
import json
from html import unescape
import os
import re
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SOURCE_URL = "https://tradingeconomics.com/calendar"
OUT_JSON = BASE_DIR / "data" / "economic_calendar_data.json"
STAR = "★"
VN_TZ = timezone(timedelta(hours=7))

SHEETS = [
    "Recent", "Today", "Tomorrow", "This Week", "Next Week",
    "This Month", "Next Month", "Yesterday", "Previous Week", "Previous Month",
]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def _proxy_config() -> dict | None:
    """Proxy cho Chrome, đọc từ biến môi trường (HTTPS_PROXY/https_proxy...).
    Không có proxy thì trả None → Chrome đi thẳng (trường hợp GitHub Actions).
    Truyền tường minh qua launch() thay vì trông chờ Chrome tự đọc env,
    để hành vi nhất quán mọi môi trường."""
    raw = (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
           or os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy"))
    if not raw:
        return None
    from urllib.parse import urlparse  # noqa: PLC0415
    u = urlparse(raw)
    cfg: dict = {"server": f"{u.scheme or 'http'}://{u.hostname}:{u.port or 8080}"}
    if u.username:
        cfg["username"] = u.username
    if u.password:
        cfg["password"] = u.password
    return cfg


def fetch_html_chrome(url: str = SOURCE_URL, timeout_ms: int = 90000) -> str:
    """Mở trang bằng Chrome headless (Playwright), chờ bảng lịch render rồi
    trả HTML đã render. TE render lịch bằng JS nên HTML tĩnh không có dòng nào.
    Ném lỗi khi: không có Playwright, Chrome lỗi, hoặc hết timeout không thấy
    dòng sự kiện nào (caller sẽ fallback sang urllib rồi mới exit 1)."""
    from playwright.sync_api import sync_playwright  # noqa: PLC0415 — import lười: chỉ cần khi chạy Chrome

    with sync_playwright() as p:
        launch_args = ["--no-sandbox", "--disable-dev-shm-usage",
                       # Giảm dấu vết tự động hoá: TE chặn headless shell và có
                       # thể chặn cả Chrome bị gắn cờ webdriver (kiểm chứng
                       # trên runner sau lần #186 timeout 60s không thấy dòng).
                       "--disable-blink-features=AutomationControlled"]
        if os.environ.get("TE_IGNORE_CERT_ERRORS") == "1":
            # Chỉ dùng khi chạy sau proxy MITM tự ký (vd VM dev): proxy thay
            # chứng chỉ bằng CA riêng nên Chrome không tin. Trên Actions để
            # mặc định tắt để giữ xác thực TLS đầy đủ.
            launch_args.append("--ignore-certificate-errors")
        # channel="chromium": dùng bản Chrome đầy đủ thay vì headless shell.
        # TE trả 403 "Access denied" cho headless shell nhưng cho Chrome đầy
        # đủ chạy headless qua (kiểm chứng 23/11: shell → 403, full → 547 dòng).
        browser = p.chromium.launch(headless=True, channel="chromium",
                                    args=launch_args, proxy=_proxy_config())
        try:
            page = browser.new_page(user_agent=UA, viewport={"width": 1280, "height": 900})
            resp = page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            http_status = resp.status if resp else None
            try:
                page.wait_for_selector("tr[data-id]", timeout=60000)
            except Exception:
                # Chẩn đoán để biết runner thấy gì: 403/captcha hay chỉ chậm.
                title = page.title()
                try:
                    body = page.inner_text("body")[:300].replace("\n", " | ")
                except Exception:
                    body = "<không đọc được body>"
                raise RuntimeError(
                    f"Chrome chờ dòng sự kiện timeout 60s "
                    f"(HTTP {http_status}, title={title!r}, body={body!r})")
            page.wait_for_timeout(3000)  # chờ các dòng tải muộn render xong
            html = page.content()
            if html.count("data-id=") < 20:
                raise RuntimeError(f"Chrome render xong nhưng chỉ thấy {html.count('data-id=')} data-id")
            return html
        finally:
            browser.close()


def fetch_html_urllib(url: str = SOURCE_URL, tries: int = 3) -> str:
    """Fetch có retry + exponential backoff. Hết tries thì ném lỗi (caller giữ file cũ)."""
    last_err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="ignore")
        except Exception as e:  # noqa: BLE001 — mạng có đủ loại lỗi, retry hết
            last_err = e
            if i < tries - 1:
                time.sleep(2 ** i * 5)  # 5s, 10s
    raise RuntimeError(f"Không tải được {url} sau {tries} lần thử: {last_err}")


def fetch_html(url: str = SOURCE_URL, use_chrome: bool = True) -> str:
    """Chrome trước, urllib sau. Chrome lỗi (không có Playwright/Chrome, timeout,
    render không ra dòng) thì thử urllib; cả hai lỗi thì ném RuntimeError
    (caller giữ file cũ, exit 1)."""
    last_err = None
    if use_chrome:
        try:
            return fetch_html_chrome(url)
        except Exception as e:  # noqa: BLE001 — mọi lỗi Chrome đều fallback urllib
            last_err = e
            print(f"CẢNH BÁO: Chrome fetch lỗi ({e}) — thử lại bằng urllib.", file=sys.stderr)
    try:
        return fetch_html_urllib(url)
    except Exception as e:  # noqa: BLE001
        last_err = e
    raise RuntimeError(f"Không tải được {url}: {last_err}")


def clean(s: str) -> str:
    # unescape: page.content() serialize lại DOM nên '&' thành '&amp;'
    # (file cũ từ HTML tĩnh không có entity này — giữ dữ liệu sạch như cũ)
    return unescape(re.sub(r"\s+", " ", s or "").strip())


def field(chunk: str, fid: str) -> str:
    m = re.search(r"id=['\"]" + fid + r"['\"][^>]*>([^<]*)<", chunk)
    return clean(m.group(1)) if m else ""


def split_row_chunks(html: str) -> list[str]:
    """Tách từng dòng sự kiện. KHÔNG dùng .*?</tr> vì TE lồng <table> con
    trong ô quốc gia (thẻ </tr> con sẽ cắt cụt dòng trước cột Actual).
    → cắt theo vị trí thẻ <tr data-id> kế tiếp."""
    starts = [m.start() for m in re.finditer(r"<tr[^>]*data-id", html)]
    chunks = []
    for i, s in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else min(len(html), s + 20000)
        chunks.append(html[s:end])
    return chunks


def parse_rows(html: str) -> list[dict]:
    rows: list[dict] = []
    for chunk in split_row_chunks(html):
        attr = lambda name: (re.search(name + r"=['\"]([^'\"]*)['\"]", chunk) or [None, ""])[1]
        date_m = re.search(r"class=['\"][^'\"]*\b(\d{4}-\d{2}-\d{2})\b", chunk)
        imp_m = re.search(r"calendar-date-(\d)[^>]*>\s*([^<]*)", chunk)
        iso_m = re.search(r"calendar-iso[^>]*>\s*([A-Za-z]{2,3})\s*<", chunk)
        country_m = re.search(r"title=\"([^\"]+)\"\s+class=['\"]flag", chunk) or \
                    re.search(r"<div\s+title=\"([^\"]+)\"", chunk)
        event_m = re.search(r"calendar-event[^>]*>([^<]+)<", chunk)
        importance = int(imp_m.group(1)) if imp_m else 0
        if importance < 1:
            continue
        data_url = attr("data-url")
        rows.append({
            "Sheet": "Recent",
            "Date": date_m.group(1) if date_m else "",
            "Time": clean(imp_m.group(2)) if imp_m else "",
            "Country": clean(country_m.group(1)) if country_m else "",
            "CountryCode": clean(iso_m.group(1)).upper() if iso_m else "",
            "Event": clean(event_m.group(1)) if event_m else clean(attr("data-event")).title(),
            "Actual": field(chunk, "actual"),
            "Previous": field(chunk, "previous"),
            "Consensus": field(chunk, "consensus"),
            "Forecast": field(chunk, "forecast"),
            "Impact": STAR * importance,
            "EventKey": unescape(attr("data-event")),
            "DetailURL": ("https://tradingeconomics.com" + data_url) if data_url.startswith("/") else data_url,
            "Timezone": "UTC",
        })
    return rows


def row_dt(row: dict) -> datetime | None:
    if not row["Date"]:
        return None
    try:
        t = datetime.strptime(row["Time"], "%I:%M %p").time() if row["Time"] else datetime.min.time()
    except ValueError:
        t = datetime.min.time()
    d = datetime.strptime(row["Date"], "%Y-%m-%d")
    return datetime.combine(d.date(), t, tzinfo=timezone.utc)


def build_sheets(rows: list[dict]) -> dict[str, list[dict]]:
    now_vn = datetime.now(VN_TZ)
    today = now_vn.date()
    tuan_dau = today - timedelta(days=today.weekday())  # thứ 2 tuần này
    sheets: dict[str, list[dict]] = {name: [] for name in SHEETS}
    for row in rows:
        dt = row_dt(row)
        if dt is None:
            continue
        d = dt.astimezone(VN_TZ).date()
        sheets["Recent"].append(row)
        if d == today: sheets["Today"].append(dict(row, Sheet="Today"))
        if d == today + timedelta(days=1): sheets["Tomorrow"].append(dict(row, Sheet="Tomorrow"))
        if d == today - timedelta(days=1): sheets["Yesterday"].append(dict(row, Sheet="Yesterday"))
        if tuan_dau <= d < tuan_dau + timedelta(days=7): sheets["This Week"].append(dict(row, Sheet="This Week"))
        if tuan_dau + timedelta(days=7) <= d < tuan_dau + timedelta(days=14): sheets["Next Week"].append(dict(row, Sheet="Next Week"))
        if tuan_dau - timedelta(days=7) <= d < tuan_dau: sheets["Previous Week"].append(dict(row, Sheet="Previous Week"))
        if d.month == today.month and d.year == today.year: sheets["This Month"].append(dict(row, Sheet="This Month"))
        # FIX v2.0: điền Next/Previous Month (trước đây sheet tồn tại nhưng luôn rỗng)
        thang_truoc = (today.replace(day=1) - timedelta(days=1))
        thang_sau = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        if d.year == thang_sau.year and d.month == thang_sau.month: sheets["Next Month"].append(dict(row, Sheet="Next Month"))
        if d.year == thang_truoc.year and d.month == thang_truoc.month: sheets["Previous Month"].append(dict(row, Sheet="Previous Month"))
    return sheets


def ghi_atomic(out: Path, text: str) -> None:
    """Ghi file nguyên tử: viết temp rồi os.replace (không bao giờ để file nửa vời)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(out.parent), prefix=out.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, out)
    except BaseException:
        try: os.unlink(tmp)
        except OSError: pass
        raise


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_JSON))
    ap.add_argument("--no-chrome", action="store_true",
                    help="Bỏ qua Chrome headless, chỉ dùng urllib (đường cũ, TE giờ trả 0 dòng)")
    args = ap.parse_args()
    try:
        html = fetch_html(use_chrome=not args.no_chrome)
    except RuntimeError as e:
        print(f"LỖI: {e} — giữ nguyên file cũ, không ghi đè.", file=sys.stderr)
        return 1
    rows = parse_rows(html)
    if len(rows) < 20:
        print(f"CẢNH BÁO: chỉ parse được {len(rows)} dòng — TE có thể đã đổi cấu trúc hoặc chặn IP.", file=sys.stderr)
        if not rows:
            return 1
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source": SOURCE_URL,
        "timezone": "UTC",
        "impact": "1, 2, and 3 stars",
        "sheets": build_sheets(rows),
    }
    out = Path(args.out)
    ghi_atomic(out, json.dumps(payload, ensure_ascii=False, indent=1))
    imp = {1: 0, 2: 0, 3: 0}
    for r in rows: imp[len(r["Impact"])] += 1
    print(json.dumps({
        "output": str(out), "rows": len(rows),
        "impact": {"★": imp[1], "★★": imp[2], "★★★": imp[3]},
        "dateRange": [min(r["Date"] for r in rows if r["Date"]), max(r["Date"] for r in rows if r["Date"])],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
