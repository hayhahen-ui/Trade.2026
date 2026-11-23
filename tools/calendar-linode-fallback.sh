#!/bin/bash
# calendar-linode-fallback.sh — chay tren tram Linode, 4 lan/ngay, lech 1h sau cron Muse.
# Chi cao + push khi file lich tren main da cu >= 7h (tuc cron Muse da lo >= 1 luot).
# Dung git worktree tam de khong dong den working copy cua tram (tram dang dung
# nhanh data cho journal/flow; file lich nam tren main).
#
# Dat lich (crontab cua user trade; tram chay gio UTC):
#   15 19,1,7,13 * * *  /opt/trade2026/Trade.2026/tools/calendar-linode-fallback.sh
#   = 02:15/08:15/14:15/20:15 gio VN, tuc 1h sau moi luot cron Muse (01:15/07:15/13:15/19:15 VN).
# Setup 1 lan truoc khi dat lich: python3 + pip + playwright + chromium
#   pip3 install --user playwright && python3 -m playwright install chromium --with-deps
#   (can quyen sudo cho --with-deps; neu khong co sudo thi bo --with-deps va cai
#   thu vien he thong theo loi bao cua playwright)
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG="${CAL_LOG:-$HOME/calendar-linode.log}"
RAW_URL="https://raw.githubusercontent.com/hayhahen-ui/Trade.2026/main/data/economic_calendar_data.json"
STALE_SECS="${CAL_STALE_SECS:-25200}"  # 7h; dat CAL_STALE_SECS=0 de bat buoc chay (test duong day len main)

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*" | tee -a "$LOG"; }

# 1. Kiem tra do tuoi file lich tren main
GEN_JSON=$(curl -sL --max-time 30 "$RAW_URL" 2>/dev/null)
GEN=$(printf '%s' "$GEN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('generatedAt',''))" 2>/dev/null)
if [ -z "$GEN" ]; then
  log "WARN: khong doc duoc generatedAt tren main — van cao thu"
else
  GEN_EPOCH=$(date -d "$GEN" +%s 2>/dev/null)
  NOW_EPOCH=$(date -u +%s)
  AGE=$((NOW_EPOCH - GEN_EPOCH))
  log "main generatedAt=$GEN age=${AGE}s"
  if [ "$AGE" -lt "$STALE_SECS" ]; then
    log "SKIP: file tren main con tuoi (< 7h), cron Muse van chay tot"
    exit 0
  fi
fi

# 2. Playwright + Chromium phai co san (cai 1 lan o buoc setup, khong cai trong cron)
if ! python3 -c "import playwright" 2>/dev/null; then
  log "FAIL: chua co playwright tren tram — chay buoc setup truoc"; exit 1
fi
CHROME=$(ls "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | head -1)
if [ -z "$CHROME" ]; then
  log "FAIL: chua co Chromium tren tram — chay buoc setup truoc"; exit 1
fi

# 3. Worktree tam tu origin/main (khong dong den working copy cua tram)
git -C "$REPO" fetch origin main --quiet || { log "FAIL: git fetch origin main"; exit 1; }
WT=$(mktemp -d /tmp/cal-wt.XXXXXX)
trap 'if [ -n "${WT:-}" ]; then git -C "$REPO" worktree remove --force "$WT" 2>/dev/null; rm -rf "$WT"; fi' EXIT
git -C "$REPO" worktree add --detach "$WT" origin/main >> "$LOG" 2>&1 || { log "FAIL: git worktree add"; exit 1; }

# 4. Cao (tren tram khong proxy, khong MITM — khong can TE_IGNORE_CERT_ERRORS)
OUT="$WT/data/economic_calendar_data.json"
if ! python3 "$WT/tools/update_calendar.py" --out "$OUT" >> "$LOG" 2>&1; then
  log "FAIL: update_calendar.py exit != 0 (khong push)"; exit 1
fi
ROWS=$(python3 -c "import json; d=json.load(open('$OUT')); print(sum(len(v) for v in d['sheets'].values()))")
NEW_GEN=$(python3 -c "import json; print(json.load(open('$OUT'))['generatedAt'])")
log "scraped rows=$ROWS generatedAt=$NEW_GEN"
if [ "$ROWS" -lt 50 ]; then log "FAIL: rows < 50"; exit 1; fi

# 5. Commit + push len main (dung PAT trong git credential store tren tram)
git -C "$WT" add data/economic_calendar_data.json
git -C "$WT" -c user.name="trade2026-calendar-linode" -c user.email="linode@trade2026.local" commit -m "auto(linode): cap nhat lich kinh te $NEW_GEN" --quiet || { log "FAIL: git commit"; exit 1; }
git -C "$WT" push origin HEAD:main --quiet || { log "FAIL: git push"; exit 1; }
log "OK: pushed linode fallback, generatedAt=$NEW_GEN"
