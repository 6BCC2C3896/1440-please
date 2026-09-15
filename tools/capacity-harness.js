#!/usr/bin/env node
"use strict";
const Core = require("../lib/core.js");
const base = {
  playing: true, isLive: false, isAd: false, riskEvent: false,
  availableHeights: [720,1080,1440,2160], lowSinceMs: null, stableSinceMs: null,
  driftSinceMs: null, capacityStableSinceMs: null, capacityDeficitSinceMs: null,
  lastAdjustmentMs: 0, transitionUntilMs: 0, fallbackSinceMs: 0
};
function q(v){ return Core.twoStageQualityDecision({ ...base, ...v }); }
let failed = false;

const stable = q({ nowMs: 30000, currentHeight: 1440, mode: "preferred", effectiveBuffer: 14,
  bufferTrend: 0.01, capacityTrend: -0.01, currentBitrate: 6_000_000, preferredBitrate: 6_000_000,
  bandwidthEstimateBps: 6_250_000, bandwidthSampleCount: 6, bandwidthInstability: 0.08 });
console.log(JSON.stringify({scenario:"stable-low-1440-is-success", result:stable}));
if (stable.action !== "hold" || stable.capacityDeficitSinceMs != null) failed = true;

const liminal = q({ nowMs: 60000, currentHeight: 1440, mode: "preferred", effectiveBuffer: 4.5,
  bufferTrend: -0.12, capacityTrend: -0.12, currentBitrate: 6_000_000, preferredBitrate: 6_000_000,
  bandwidthEstimateBps: 5_200_000, bandwidthSampleCount: 5, bandwidthInstability: 0.12 });
console.log(JSON.stringify({scenario:"liminal-1440-is-not-preemptively-killed", result:liminal}));
if (liminal.action !== "hold") failed = true;

const f1 = q({ nowMs: 90000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 85000,
  effectiveBuffer: 3.0, bufferTrend: 0.01, capacityTrend: 0.01, currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
  bandwidthEstimateBps: 5_900_000, bandwidthSampleCount: 8, bandwidthInstability: 0.10 });
console.log(JSON.stringify({scenario:"1080-too-small-for-preferred-retry", result:f1}));
if (f1.action !== "hold") failed = true;

const u1 = q({ nowMs: 120000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000,
  effectiveBuffer: 30, bufferTrend: 0.5, capacityTrend: 0.5, currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
  bandwidthEstimateBps: 7_800_000, bandwidthSampleCount: 10, bandwidthInstability: 0.12 });
const u2 = q({ nowMs: 131000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000,
  effectiveBuffer: 34, bufferTrend: 0.5, capacityTrend: 0.5, currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
  bandwidthEstimateBps: 7_700_000, bandwidthSampleCount: 12, bandwidthInstability: 0.10,
  capacityStableSinceMs: u1.capacityStableSinceMs });
console.log(JSON.stringify({scenario:"measured-headroom-proves-1440", first:u1, second:u2}));
if (u2.action !== "open-preferred-range") failed = true;

if (failed) process.exitCode = 1;
