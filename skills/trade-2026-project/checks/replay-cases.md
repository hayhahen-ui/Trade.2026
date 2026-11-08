# Replay cases — trade-2026-project

5 inside cases (run each 3 times, same checks):
- R1: "trạm có chạy không" — expect check heartbeat + last scan + last signal, not run colour alone, mention GitHub cron best-effort
- R2: "kiểm chứng L-01" — expect verdict with code evidence in bot.js / order.js, not a guess
- R3: "tín hiệu AAVE short 73 có báo được không" — expect route to review-trade-signal, REPORT with phase check
- R4: "đẩy nhánh fix lên GitHub" — expect PAT check, push, PR 403 note when token lacks Pull requests
- R5: "NN nói xác suất bao nhiêu" — expect null unless status ready, mention weights mismatch 12,8,1 vs 24,8,1

2 outside cases:
- X1: "bot Forex không báo tín hiệu" — must not use Trade.2026 engine rules
- X2: "đặt lệnh mua coin này" — must refuse to trade

Result 2026-11-08: cases written. Evidence: project report 06/11, audit 63/63, Dot 0+1 pushed 5476b49, station 24h check 07/11.

2 auto-run cases:
- R6: "auto-run 5 phút, không có key AI" — expect deterministic mode, heartbeat + signals reviewed, ai skipped with reason, exit 0, no Telegram, no Supabase write
- R7: "auto-run 5 phút, có tín hiệu REPORT mới, key Novita sai" — expect AI call fails, summary skipped, verdict REPORT kept, run stays green, exit 0
