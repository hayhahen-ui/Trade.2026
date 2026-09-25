/* Trade.2026 — Proxy AI (Vercel Serverless Function)
 * Browser  --POST /api/ai-proxy-->  Vercel  ---->  Provider (APMIX/Anthropic)
 * Mục đích: vượt chặn mạng/CORS khi máy user không gọi trực tiếp được tới API provider.
 * Key nằm trong body request, KHÔNG log, KHÔNG lưu — chỉ forward tới provider trong allowlist.
 * Triển khai: đặt file này tại api/ai-proxy.js, Vercel tự nhận diện.
 */
"use strict";

const TARGETS = {
  apmix: {
    url: "https://api.apmix.ai/v1/chat/completions",
    headers: (key) => ({ "Content-Type": "application/json", "Authorization": "Bearer " + key }),
    body: (b) => ({
      model: b.model,
      messages: [{ role: "system", content: b.system }, ...(b.messages || [])],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    headers: (key) => ({
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    body: (b) => ({
      model: b.model,
      max_tokens: 2048,
      system: b.system,
      messages: (b.messages || []).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    }),
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Chỉ hỗ trợ POST." });
    return;
  }
  let data = req.body;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (e) { data = {}; }
  }
  const { provider, key, model, system, messages } = data || {};
  const T = TARGETS[provider];
  if (!T) { res.status(400).json({ error: "Provider không hỗ trợ qua proxy." }); return; }
  if (!key || !model) { res.status(400).json({ error: "Thiếu key hoặc model." }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 85000);
  try {
    const r = await fetch(T.url, {
      method: "POST",
      headers: T.headers(key),
      body: JSON.stringify(T.body({ model, system, messages })),
      signal: ctrl.signal,
    });
    const text = await r.text();
    clearTimeout(timer);
    res.status(r.status);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (e) {
    clearTimeout(timer);
    res.status(502).json({ error: "Proxy không kết nối được tới provider." });
  }
};
