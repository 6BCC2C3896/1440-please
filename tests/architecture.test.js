"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content/content.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background/background.js"), "utf8");
const main = fs.readFileSync(path.join(root, "content/content-main.js"), "utf8");
const networkCore = fs.readFileSync(path.join(root, "lib/network-core.js"), "utf8");
const core = fs.readFileSync(path.join(root, "lib/core.js"), "utf8");
const playerConfigCore = fs.readFileSync(path.join(root, "lib/player-config-core.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("content script no longer owns a permanent scheduler interval", () => {
  assert.equal(/setInterval\s*\(/.test(content), false);
});

test("page ResourceTiming is bootstrap-only and not isolated controller truth", () => {
  assert.equal(content.includes("PerformanceObserver"), false);
  assert.equal(main.includes("PerformanceObserver"), true);
  assert.equal(main.includes("ytbg-network-hint-v17"), true);
});

test("background keeps browser-level webRequest telemetry", () => {
  assert.equal(background.includes("browser.webRequest.onBeforeRequest"), true);
  assert.equal(background.includes("browser.webRequest.onResponseStarted"), true);
  assert.equal(manifest.permissions.includes("webRequest"), true);
  assert.equal(manifest.host_permissions.includes("https://*.googlevideo.com/*"), true);
});

test("quality uses the phased 1440p/1080p ZigZag controller", () => {
  assert.match(core, /adaptiveQuality: true/);
  assert.match(core, /twoStageQualityEnabled: true/);
  assert.match(core, /fallbackResolution: 1080/);
  assert.match(core, /preferredResolution: 1440/);
  assert.match(main, /setPlaybackQualityRange/);
  assert.match(main, /setPlaybackQuality/);
  assert.match(main, /ytbg-quality-apply-v17/);
  assert.match(content, /Core\.twoStageQualityDecision/);
  assert.match(content, /capacityTrend/);
  assert.match(core, /preferredCapacityDeficit/);
  assert.match(core, /preferredUpgradeCapacity/);
  assert.match(content, /mode: "bootstrap"/);
  assert.match(core, /mode === "cruise"/);
  assert.match(core, /preferred-transition-lease/);
});

test("quality bridge probes actual YouTube quality and exposes a serialized apply channel", () => {
  assert.match(content, /QUALITY_PROBE_EVENT[\s\S]*JSON\.stringify/);
  assert.match(main, /getPlaybackQuality/);
  assert.match(main, /getAvailableQualityLevels/);
  assert.match(main, /detail: encodeDetail\(detail\)/);
});

test("v0.17 leaves native fetch XHR and SABR untouched; quality is the only active page API", () => {
  for (const needle of ["window.fetch =", "XMLHttpRequest.prototype.open =", "XMLHttpRequest.prototype.send =", "playerTimeMs"]) {
    assert.equal(main.includes(needle), false, needle);
  }
  assert.match(main, /setPlaybackQualityRange/);
  assert.match(main, /setPlaybackQuality/);
  const mainWorld = (manifest.content_scripts || []).find((entry) => entry.world === "MAIN");
  assert.equal(mainWorld.js.includes("lib/demand-core.js"), false);
});

test("background has no stale dependency on the removed demand core", () => {
  assert.equal(background.includes("YTBufferDemandCore"), false);
  assert.equal(background.includes("Demand.transportValue"), false);
  assert.match(background, /Network\.transportHealth/);
});

test("native player read-ahead remains the production buffer actuator", () => {
  const mainWorld = (manifest.content_scripts || []).find((entry) => entry.world === "MAIN");
  assert.deepEqual(mainWorld.js.slice(0, 2), ["lib/player-config-core.js", "content/content-main.js"]);
  assert.match(main, /ytInitialPlayerResponse/);
  assert.match(playerConfigCore, /minReadAheadMediaTimeMs/);
  assert.match(playerConfigCore, /maxReadAheadMediaTimeMs/);
  assert.match(playerConfigCore, /readAheadGrowthRateMs/);
});

test("quality acts only after real playback and through the pure two-stage decision", () => {
  assert.match(content, /function maybeArmProtection/);
  assert.match(content, /Core\.canArmProtection/);
  assert.match(content, /function runTwoStageQuality/);
  assert.match(content, /if \(!startup\.hasPlayedOnce\) return false;/);
  assert.match(main, /safeMode: "native-network"/);
});

test("initial pause cannot trigger priming before first successful playback", () => {
  assert.match(content, /function onPause\(\)[\s\S]*if \(!startup\.armed\) return;/);
  assert.match(content, /function requestPausedPrime[\s\S]*if \(!startup\.armed/);
});

test("background scheduler cannot execute a playing-stream demand kick", () => {
  const scheduler = fs.readFileSync(path.join(root, "lib/scheduler-core.js"), "utf8");
  assert.match(scheduler, /function shouldDemandKickSession[\s\S]*return false;/);
  assert.equal(scheduler.includes('type: "demand-kick"'), false);
  assert.equal(background.includes("function pageDemandKick"), false);
  assert.equal(background.includes("dispatchDemandKick"), false);
});

test("network classifier still understands SABR UMP and CPN attribution", () => {
  assert.match(networkCore, /application\/vnd\.yt-ump/);
  assert.match(networkCore, /method: "cpn"/);
  assert.match(background, /negativeTabIdRequests/);
});

test("YouTube page receives zero visual DOM or CSS", () => {
  assert.equal(fs.existsSync(path.join(root, "content/content.css")), false);
  assert.equal((manifest.content_scripts || []).some((entry) => Array.isArray(entry.css) && entry.css.length), false);
  assert.equal(content.includes("document.createElement"), false);
  assert.equal(content.includes("appendChild("), false);
});

test("all declared and worker-imported extension modules exist", () => {
  for (const rel of manifest.background?.scripts || []) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
  for (const entry of manifest.content_scripts || []) {
    for (const rel of entry.js || []) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
  }
  const worker = fs.readFileSync(path.join(root, "background/scheduler-worker.js"), "utf8");
  for (const match of worker.matchAll(/importScripts\(([^)]*)\)/g)) {
    for (const ref of match[1].matchAll(/["']([^"']+)["']/g)) {
      assert.equal(fs.existsSync(path.resolve(root, "background", ref[1])), true, ref[1]);
    }
  }
});

test("v0.17 observes YouTube watch-time checkpoints without modifying them", () => {
  assert.equal(manifest.host_permissions.includes("https://s.youtube.com/*"), true);
  assert.match(background, /TRACKING_FILTER/);
  assert.match(background, /lastWatchtimeEpochMs/);
  assert.doesNotMatch(background, /cancel\s*:\s*true/);
  assert.doesNotMatch(background, /redirectUrl\s*:/);
});

test("v0.17 stores a local shadow checkpoint and only restores after recent failure", () => {
  assert.match(content, /ytbg-resume-checkpoint-v17/);
  assert.match(content, /shouldRestoreCheckpoint/);
  assert.match(content, /saveLocalCheckpoint\("waiting", true\)/);
  assert.match(content, /saveLocalCheckpoint\("stalled", true\)/);
  assert.match(content, /saveLocalCheckpoint\("emptied", true\)/);
});
