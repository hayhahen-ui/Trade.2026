/* Đẩy dữ liệu trạm 24/7 lên nhánh `data` (mỗi giờ 1 lần).
 * Chạy sau các collector trong cùng cron. Không động vào main → Vercel không rebuild. */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STAMP = path.join(ROOT, "data", ".journal-247-push.txt");
const FILES = ["data/journal-247.json", "data/flow-247.json"];

function main() {
  const co = FILES.filter((f) => fs.existsSync(path.join(ROOT, f)));
  if (!co.length) { console.log("[push-247] chưa có dữ liệu, bỏ qua"); return; }
  let last = 0;
  try { last = +fs.readFileSync(STAMP, "utf8") || 0; } catch {}
  if (Date.now() - last < 60 * 60 * 1000) { console.log("[push-247] chưa đến giờ đẩy"); return; }
  console.log("[push-247] đẩy lên nhánh data:", co.join(", "));
  execFileSync("python3",
    [path.join(process.env.HOME, "workspace/skills/github-push/bin/gh_push.py"),
     "--repo", "hayhahen-ui/Trade.2026", "--branch", "data",
     "--message", "trạm 24/7: cập nhật journal + flow",
     "--base-dir", ROOT, "--files", ...co],
    { stdio: "inherit", timeout: 120000 });
  fs.writeFileSync(STAMP, String(Date.now()));
  console.log("[push-247] xong");
}
main();
