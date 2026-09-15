import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
process.chdir(root);

function run(label, command, args) {
  console.log(`== ${label} ==`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if ([".git", "dist", "node_modules"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const jsFiles = walk(root).filter((file) => file.endsWith(".js") || file.endsWith(".mjs"));
console.log("== syntax ==");
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", relative(root, file)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node + VM integration tests", process.execPath, ["--test", ...readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.js")).sort().map((f) => `tests/${f}`)]);
run("stability traces", process.execPath, ["tools/stability-harness.js"]);
run("recovery controller traces", process.execPath, ["tools/recovery-harness.js"]);
run("capacity governor traces", process.execPath, ["tools/capacity-harness.js"]);
run("hybrid ABR + resume traces", process.execPath, ["tools/hybrid-abr-harness.js"]);
run("phased ZigZag family traces", process.execPath, ["tools/zigzag-family-harness.js"]);
run("soft 1440 warmup traces", process.execPath, ["tools/soft-warmup-harness.js"]);
run("forbidden capabilities", process.execPath, ["tools/forbidden-capability-scan.js"]);
run("release consistency", process.execPath, ["tools/release-check.mjs"]);
console.log("ALL REQUIRED TEST LAYERS PASS");
