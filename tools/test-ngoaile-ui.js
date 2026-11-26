/* ============================================================
 * Trade.2026 — Test UI logic màn hình "Nhánh ngoại lệ" (#/ngoaile)
 * Pure helpers from assets/js/ngoaile.js (Node-safe UMD export).
 * Run: node tools/test-ngoaile-ui.js
 * ============================================================ */
"use strict";
const path = require("path");
const M = require(path.join(__dirname, "..", "assets", "js", "ngoaile.js"));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (extra ? " — " + extra : "")); }
}

console.log("U1 — parseJsonl / parseOutbox");
{
  const txt = '{"kind":"alert","tsMs":1795702200000,"direction":"UP","pct":1.97}\n\n{"kind":"forward"}\n{"broken line';
  const recs = M.parseJsonl(txt);
  ok(recs.length === 2 && recs[0].kind === "alert" && recs[1].kind === "forward", "JSONL: tolerant of blank + torn tail lines", recs.length);
  ok(M.parseJsonl("") .length === 0 && M.parseJsonl(null).length === 0, "JSONL: empty/null → []");
  ok(M.parseOutbox('[{"record":{"id":"A"}}]').length === 1 && M.parseOutbox("nope").length === 0 && M.parseOutbox(null).length === 0, "outbox: array or [] on bad/missing");
}

console.log("U2 — format giờ VN / số kiểu Việt");
{
  // 21:30 VN on 25/11/2026 = 14:30Z
  ok(M.fmtGioVN(Date.UTC(2026, 10, 25, 14, 30)).startsWith("21:30 25/11"), "fmtGioVN: 14:30Z → 21:30 25/11 VN", M.fmtGioVN(Date.UTC(2026, 10, 25, 14, 30)));
  ok(M.fmtGioVN(NaN) === "—", "fmtGioVN: bad input → —");
  ok(M.fmtPct(1.97) === "+1,97%" && M.fmtPct(-1.43) === "-1,43%" && M.fmtPct(0) === "0,00%", "fmtPct: dấu +/− và phẩy thập phân", M.fmtPct(1.97));
}

console.log("U3 — alertRow: tin HIGH tag, 'chưa rõ trigger' khi không tin");
{
  const r = M.alertRow({ tsMs: Date.UTC(2026, 10, 25, 14, 30), direction: "UP", pct: 1.97, coins: [{ coin: "BTC", chgPct: 1.49, volX: 5.3 }] });
  ok(r.gioVN.startsWith("21:30 25/11") && r.dir === "UP" && r.pct === "+1,97%", "alertRow: giờ/chiều/%");
  ok(r.coins.includes("BTC +1,49%") && r.coins.includes("×5,3"), "alertRow: coin + vol spike", r.coins);
  const noNews = M.alertRow({ tsMs: Date.UTC(2026, 10, 26, 17, 16), direction: "UP", pct: 0.67, coins: [] });
  ok(noNews.tin === "chưa rõ trigger", "alertRow: không tin → 'chưa rõ trigger' (không bịa nguyên nhân)", noNews.tin);
  const news = M.alertRow({ tsMs: 0, direction: "DOWN", pct: -1.43, coins: [], newsEvent: "Core PCE Price Index MoM" });
  ok(news.tin === "★★★ Core PCE Price Index MoM", "alertRow: tin HIGH có tên");
}

console.log("U4 — replaySummary");
{
  const fires = [
    { tsMs: 1, direction: "UP", pct: 1.0, spikeCount: 3 },
    { tsMs: 2, direction: "DOWN", pct: -1.4, spikeCount: 5, newsCount: 5, newsEvent: "PCE" },
    { tsMs: 3, direction: "DOWN", pct: -0.9, spikeCount: 4 },
  ];
  const s = M.replaySummary({ meta: { weeks: 8, source: "binance", startMs: 0, endMs: 1 }, fires });
  ok(s.fires === 3 && s.perWeek === "0,4" && s.up === 1 && s.down === 2 && s.newsHits === 1, "replaySummary: đếm đúng UP/DOWN/news và /tuần", JSON.stringify(s));
  ok(M.replaySummary(null).fires === 0, "replaySummary: null → an toàn");
}

console.log("U5 — tinhTrangThai");
{
  const st = M.tinhTrangThai({
    cfg: { EXCEPTION_ENABLED: false },
    state: { counters: { polls: 12, alerts: 2 } },
    outboxWa: '[{"x":1},{"x":2}]',
    outboxTw: "",
  });
  ok(st.bat === false && st.watcherChay === true && st.polls === 12, "tinhTrangThai: tắt + watcher đã chạy");
  ok(st.cho.whatsapp === 2 && st.cho.tradewatch === 0, "tinhTrangThai: đếm outbox WA/TW");
}

console.log("U6 — lần quét cuối / lần gửi cuối (từ watcher-state.json, không bịa giờ)");
{
  ok(M.fmtLastPoll({ lastPollAt: Date.UTC(2026, 10, 25, 14, 30) }).startsWith("21:30 25/11"), "fmtLastPoll: lastPollAt → giờ VN", M.fmtLastPoll({ lastPollAt: Date.UTC(2026, 10, 25, 14, 30) }));
  ok(M.fmtLastPoll({}) === "—" && M.fmtLastPoll({ lastPollAt: 0 }) === "—" && M.fmtLastPoll(null) === "—", "fmtLastPoll: thiếu file/trường hoặc 0 → —");
  const st = { channels: { telegram: { lastSentAt: Date.UTC(2026, 10, 25, 15, 0) }, whatsapp: { lastSentAt: 0 }, tradewatch: {} } };
  ok(M.fmtLastSent(st, "telegram").startsWith("22:00 25/11"), "fmtLastSent: telegram lastSentAt → giờ VN", M.fmtLastSent(st, "telegram"));
  ok(M.fmtLastSent(st, "whatsapp") === "—" && M.fmtLastSent(st, "tradewatch") === "—" && M.fmtLastSent(st, "khongco") === "—" && M.fmtLastSent(null, "telegram") === "—", "fmtLastSent: chưa từng gửi / kênh lạ / state null → —");
}

console.log("U7 — câu chữ trạng thái trống lịch sử heads-up theo bật/tắt");
{
  ok(M.headsUpEmptyText(false) === "Nhánh đang tắt — bật watcher để bắt đầu ghi nhận.", "tắt → câu tắt", M.headsUpEmptyText(false));
  ok(M.headsUpEmptyText(true) === "Chưa có heads-up nào — watcher chưa từng kích kể từ khi bật.", "bật → câu chưa từng kích", M.headsUpEmptyText(true));
  ok(M.headsUpEmptyText(false) !== M.headsUpEmptyText(true), "hai trạng thái khác câu chữ");
}

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
