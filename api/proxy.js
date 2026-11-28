/* Trade.2026 — Proxy dữ liệu công khai (Vercel Serverless Function)
 * Browser  --GET /api/proxy?url=...-->  Vercel  ---->  Host công khai (RSS / JSON)
 * Mục đích: vượt chặn CORS khi trình duyệt không gọi trực tiếp được tới
 * nguồn công khai (vd RSS Cointelegraph không gửi CORS headers).
 * Cùng origin với app (trade.mrbitbet90.tech) nên trình duyệt gọi thẳng,
 * không cần thêm CORS headers.
 * Chỉ những host trong ALLOW mới đi qua — tránh biến proxy thành open proxy
 * (chống SSRF: chặn mọi host khác, chặn URL không phải http/https).
 * Không key, không log URL.
 * Triển khai: đặt file này tại api/proxy.js, Vercel tự nhận diện.
 */
"use strict";

const ALLOW = [
  "www.coindesk.com",       // RSS tin tức
  "cointelegraph.com",      // RSS tin tức
  "api.alternative.me",     // Fear & Greed (dự phòng)
  "farside.co.uk",          // Dòng tiền ETF (khi bật ETF)
  "data-api.polymarket.com",// Polymarket v2 (dự phòng; hiện app gọi trực tiếp)
  "api.tradermap.io",      // TraderMap REST (/api/prices, /api/stats) — bật 28/11
];

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Chỉ hỗ trợ GET." });
    return;
  }
  const raw = req.query && req.query.url;
  if (!raw || typeof raw !== "string") {
    res.status(400).json({ error: "Thiếu tham số url." });
    return;
  }
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    res.status(400).json({ error: "URL không hợp lệ." });
    return;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !ALLOW.includes(u.hostname)) {
    res.status(403).json({ error: "Host không được phép qua proxy." });
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: { "User-Agent": "Trade.2026-DataHub-Proxy/1.0" },
    });
    const text = await r.text();
    clearTimeout(timer);
    res.status(r.status);
    const ct = r.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.send(text);
  } catch (e) {
    clearTimeout(timer);
    res.status(502).json({ error: "Proxy không kết nối được tới nguồn." });
  }
};
