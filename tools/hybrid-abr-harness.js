#!/usr/bin/env node
"use strict";
const Core = require("../lib/core.js");
let failed = false;

function checkpoint(v) {
  return Core.shouldRestoreCheckpoint(v, Core.DEFAULTS);
}

const stable = Core.preferredCapacityDeficit({
  effectiveBuffer: 12, capacityTrend: 0.0, currentBitrate: 6_000_000,
  preferredBitrate: 6_000_000, bandwidthEstimateBps: 6_300_000,
  bandwidthSampleCount: 6, bandwidthInstability: 0.08
}, Core.DEFAULTS);
console.log(JSON.stringify({scenario:"stable-low-reservoir-accepted", deficit:stable}));
if (stable !== false) failed = true;

const fade = Core.preferredCapacityDeficit({
  effectiveBuffer: 2, capacityTrend: -0.4, currentBitrate: 6_000_000,
  preferredBitrate: 6_000_000, bandwidthEstimateBps: 5_500_000,
  bandwidthSampleCount: 6, bandwidthInstability: 0.1
}, Core.DEFAULTS);
console.log(JSON.stringify({scenario:"fade-out-detected", deficit:fade, ttz:Core.predictedTimeToEmpty(2,-0.4)}));
if (fade !== true) failed = true;

const unstableUpgrade = Core.preferredUpgradeCapacity({
  capacityTrend: 0.8, currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
  bandwidthEstimateBps: 8_000_000, bandwidthSampleCount: 8, bandwidthInstability: 0.8
}, Core.DEFAULTS);
console.log(JSON.stringify({scenario:"volatile-bandwidth-does-not-upgrade", result:unstableUpgrade}));
if (unstableUpgrade.ready !== false) failed = true;

const restore = checkpoint({
  nowMs: 1_000_000, savedAtMs: 995_000, failureAtMs: 998_000,
  savedTime: 612, currentTime: 320, duration: 1800, hasExplicitStart: false
});
console.log(JSON.stringify({scenario:"stale-youtube-resume-after-failure", result:restore}));
if (!restore.restore || Math.abs(restore.targetTime - 609) > 0.01) failed = true;

const normalReload = checkpoint({
  nowMs: 1_000_000, savedAtMs: 995_000, failureAtMs: 0,
  savedTime: 612, currentTime: 320, duration: 1800, hasExplicitStart: false
});
console.log(JSON.stringify({scenario:"ordinary-navigation-never-forced", result:normalReload}));
if (normalReload.restore) failed = true;

if (failed) process.exitCode = 1;
