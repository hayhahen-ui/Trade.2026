/* ============================================================
 * Trade.2026 — Nhánh ngoai lé: log helpers (JSONL + atomic writes)
 * Writes ONLY under exception/logs/ (or caller-supplied absolute tmp paths in tests).
 * Nhánh chính (data/journal-247.json, verdict, outbox WhatsApp 57 tin) KAÔT touched.
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendJsonl(filePath, obj) {
  ensureDir(filePath);
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
}

/* Tolerant read: skips a torn last line. */
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const txt = fs.readFileSync(filePath, "utf8");
  const out = [];
  for (const line of txt.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* torn tail line */ }
  }
  return out;
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

/* Atomic write: tmp file in same dir + rename (audit finding N-2 pattern, fixed here). */
function atomicWriteJson(filePath, obj) {
  ensureDir(filePath);
  const tmp = filePath + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), "utf8");
  fs.renameSync(tmp, filePath);
}

module.exports = { ensureDir, appendJsonl, readJsonl, readJson, atomicWriteJson };
