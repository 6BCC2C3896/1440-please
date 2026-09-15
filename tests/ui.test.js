"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const popupHtml = fs.readFileSync(path.join(root, "popup/popup.html"), "utf8");
const popupCss = fs.readFileSync(path.join(root, "popup/popup.css"), "utf8");
const popupJs = fs.readFileSync(path.join(root, "popup/popup.js"), "utf8");
const optionsHtml = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
const optionsCss = fs.readFileSync(path.join(root, "options/options.css"), "utf8");
const optionsJs = fs.readFileSync(path.join(root, "options/options.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content/content.js"), "utf8");

 test("popup is a 500 ms live ticker with only essential playback information", () => {
  assert.match(popupJs, /REFRESH_MS\s*=\s*500/);
  assert.match(popupJs, /setInterval\(/);
  assert.match(popupHtml, /id="effective"/);
  assert.match(popupHtml, /id="quality"/);
  assert.match(popupHtml, /id="stage"/);
  assert.match(popupHtml, /id="liveState"/);
  assert.doesNotMatch(popupHtml, /Quality ramp|Native start.*1080|Starts cautiously|rangeNote|modeHint/i);
  assert.doesNotMatch(popupHtml, />Delivery</i);
  assert.doesNotMatch(popupHtml, /recovering|fresh|emergency recovery/i);
});

test("popup folds network telemetry into one simple activity state", () => {
  assert.match(popupJs, /function activityFor/);
  assert.match(popupJs, /mediaHealth/);
  assert.match(popupJs, /Streaming/);
  assert.match(popupJs, /Stalled/);
  assert.doesNotMatch(popupHtml, /Mbps|Bandwidth|Connection speed/i);
});

test("popup exposes exactly the two ramp profiles as its only inline control", () => {
  assert.match(popupHtml, /data-ramp="defensive"/);
  assert.match(popupHtml, /data-ramp="aggressive"/);
  assert.equal((popupHtml.match(/data-ramp=/g) || []).length, 2);
  assert.equal((popupHtml.match(/<button/g) || []).length, 3); // two profiles + Settings
});



test("1440, Please branding and one-line promise replace Buffer Guardian in the user-facing UI", () => {
  assert.match(popupHtml, />1440, Please</);
  assert.match(popupHtml, /Keeps YouTube stable at 1440p\./);
  assert.match(optionsHtml, />1440, Please</);
  assert.match(optionsHtml, /Keeps YouTube stable at 1440p\./);
  assert.doesNotMatch(popupHtml + optionsHtml, /Buffer Guardian/i);
});

test("popup uses a fixed activity slot so live labels cannot shift the header", () => {
  assert.match(popupCss, /\.activity[\s\S]*width:\s*71px[\s\S]*flex:\s*0 0 71px/);
  assert.match(popupCss, /\.activity span[\s\S]*width:\s*58px/);
});

test("user-facing styles do not inherit Firefox blue AccentColor", () => {
  assert.doesNotMatch(popupCss + optionsCss, /AccentColor/);
  assert.match(popupCss + optionsCss, /--accent:\s*#c2410c/);
});

test("options expose only Enabled and Ramp speed", () => {
  assert.match(optionsHtml, /id="enabled"/);
  assert.doesNotMatch(optionsHtml, /skipShorts|Ignore Shorts/i);
  assert.match(optionsHtml, /Ramp speed/);
  assert.match(optionsHtml, /data-ramp="defensive"/);
  assert.match(optionsHtml, /data-ramp="aggressive"/);
  assert.doesNotMatch(optionsHtml, /Soft range|Preferred|Native \/ cautious|Reset|id="save"/i);
});

test("options auto-save instead of requiring save/reset actions", () => {
  assert.match(optionsJs, /addEventListener\("change"/);
  assert.match(optionsJs, /browser\.storage\.local\.set/);
  assert.match(optionsJs, /Changes save automatically/);
  assert.doesNotMatch(optionsJs, /getElementById\("save"\)/);
  assert.doesNotMatch(optionsJs, /getElementById\("standard"\)/);
});

test("rounded controls use one clipped rounded surface without inset backing borders", () => {
  assert.match(popupCss, /\.statusCard, \.controlCard[\s\S]*border-radius:\s*14px;[\s\S]*overflow:\s*clip/);
  assert.match(popupCss, /\.segmented[\s\S]*border-radius:\s*10px;[\s\S]*overflow:\s*clip/);
  assert.match(optionsCss, /\.settingsCard[\s\S]*border-radius:\s*16px;[\s\S]*overflow:\s*clip/);
  assert.match(optionsCss, /\.segmented[\s\S]*border-radius:\s*11px;[\s\S]*overflow:\s*clip/);
  assert.doesNotMatch(popupCss, /button\.active[^}]*box-shadow:\s*0\s+0\s+0\s+1px/);
});

test("changing only ramp profile does not reset the quality state machine", () => {
  assert.match(content, /const rampProfileChanged = previous\.rampProfile !== next\.rampProfile/);
  assert.match(content, /if \(rampProfileChanged\)/);
  assert.match(content, /qualityControl\.stableSinceMs = null/);
  assert.match(content, /maybeAdjustQuality\("ramp-profile"\)/);
});
