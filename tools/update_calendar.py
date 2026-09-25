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

Lưu ý: trang TE ẩn danh trả giờ UTC → file ghi timezone "UTC";
app tự quy đổi sang giờ Việt Nam (UTC+7) khi hiển thị/phân tích.
Nếu IP của bạn bị TE chặn, hãy dùng economic_agent.py (Chrome) như cũ —
file JSON tạo ra dùng chung được.
"""
from __future__ import annotations

import argparse
import json
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


def fetch_html(url: str = SOURCE_URL, tries: int = 3) -> str:
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


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


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
            "EventKey": attr("data-event"),
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
    args = ap.parse_args()
    try:
        html = fetch_html()
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
