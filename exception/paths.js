/* Shared root + path resolution for the exception branch.
 * Config paths are repo-relative; absolute paths pass through (tests use tmp dirs). */
"use strict";
const path = require("path");

const ROOT = path.join(__dirname, "..");

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

module.exports = { ROOT, resolvePath };
