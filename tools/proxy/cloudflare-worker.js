/* ============================================================
 * SIRO — Proxy CORS (Cloudflare Worker, gói Free là đủ)
 *
 * Dùng cho các nguồn KHÔNG mở CORS cho origin github.io
 * (dòng tiền ETF, RSS tin tức, hoặc backend riêng bạn có quyền dùng).
 *
 * Triển khai:
 *   1. dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Dán file này vào, Deploy
 *   3. Trong assets/js/datahub.config.js:
 *        proxy: "https://<ten-worker>.<tai-khoan>.workers.dev/?url="
 *
 * Chỉ những host trong ALLOW mới đi qua — tránh biến worker thành open proxy.
 * ============================================================ */

const ALLOW = [
  "farside.co.uk",
  "api.alternative.me",
  "www.coindesk.com",
  "cointelegraph.com",
  // "api.tradermap.io",   // chỉ mở khi bạn được phép truy cập API này
];

const ORIGINS = [
  "https://mrbit4578.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

function cors(origin) {
  const allowed = ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "public, max-age=20",
  };
}

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    const target = new URL(req.url).searchParams.get("url");
    if (!target) return new Response("thiếu ?url=", { status: 400, headers: cors(origin) });

    let u;
    try { u = new URL(target); } catch { return new Response("url không hợp lệ", { status: 400, headers: cors(origin) }); }
    if (u.protocol !== "https:" || !ALLOW.includes(u.hostname))
      return new Response("host không nằm trong danh sách cho phép", { status: 403, headers: cors(origin) });

    const upstream = await fetch(u.toString(), {
      headers: { "User-Agent": "SiroDataHub/1.0", "Accept": "application/json,text/xml,text/html;q=0.9" },
      cf: { cacheTtl: 20, cacheEverything: true },
    });

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...cors(origin),
        "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
      },
    });
  },
};
