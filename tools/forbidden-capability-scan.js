#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const files = ["content/content-main.js", "content/content.js", "background/background.js", "lib/scheduler-core.js", "lib/player-config-core.js"];
const forbidden = [
  [/installDemandInterceptors/, "SABR/fetch interceptor installer"],
  [/function\s+pageDemandKick/, "playing-stream demand kick"],
  [/dispatchDemandKick/, "demand-kick dispatcher"],
  [/type:\s*["']demand-kick["']/, "scheduled demand-kick action"],
  [/\.currentTime\s*=\s*before/, "same-position currentTime kick"],
  [/seekTo\(before\s*,\s*true\)/, "same-position player.seekTo kick"],
  [/playerTimeMs/, "SABR player-time mutation"]
];
let failed = false;
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  for (const [pattern, label] of forbidden) {
    if (pattern.test(text)) {
      console.error(`FORBIDDEN ${label}: ${rel}`);
      failed = true;
    }
  }
}
if (fs.existsSync(path.join(root, "lib/demand-core.js"))) {
  console.error("FORBIDDEN legacy demand-core.js still exists");
  failed = true;
}
if (!failed) console.log("PASS forbidden-capability scan");
process.exitCode = failed ? 1 : 0;
