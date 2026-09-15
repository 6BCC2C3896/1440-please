import { readFileSync, existsSync } from "node:fs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = manifest.version;

const required = [
  "README.md", "LICENSE", "PRIVACY.md", "SECURITY.md", "CONTRIBUTING.md", "SUPPORT.md", "GITHUB_PUBLISH.md",
  "docs/INSTALL.md", "docs/RELEASING.md", "docs/COMPATIBILITY.md", "docs/AMO.md",
  ".github/workflows/ci.yml", ".github/workflows/release.yml"
];
for (const path of required) {
  if (!existsSync(path)) throw new Error(`required repository file missing: ${path}`);
}

if (manifest.name !== "1440, Please") throw new Error(`unexpected manifest name: ${manifest.name}`);
if (pkg.version !== version) throw new Error(`package.json ${pkg.version} != manifest ${version}`);

for (const [path, pattern] of [
  ["content/content.js", new RegExp(`VERSION = [\"']${version.replaceAll(".", "\\.")}[\"']`)],
  ["background/background.js", new RegExp(`VERSION = [\"']${version.replaceAll(".", "\\.")}[\"']`)],
  ["tools/zigzag-family-harness.js", new RegExp(`release: [\"']${version.replaceAll(".", "\\.")}[\"']`)]
]) {
  const text = readFileSync(path, "utf8");
  if (!pattern.test(text)) throw new Error(`version mismatch in ${path}`);
}

const publicText = ["README.md", "PRIVACY.md", "docs/INSTALL.md", "docs/COMPATIBILITY.md"]
  .map((p) => readFileSync(p, "utf8")).join("\n");
if (/14:40/.test(publicText)) throw new Error("old 14:40 typo remains in public docs");
if (/Chrome\/Chromium supported/i.test(publicText)) throw new Error("unsupported Chromium compatibility claim found");

console.log(`RELEASE CHECK PASS: 1440, Please ${version}`);
