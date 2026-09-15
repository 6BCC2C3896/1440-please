#!/usr/bin/env node
"use strict";
const Core = require("../lib/core.js");

function run(name, input, expectedAction) {
  const result = Core.twoStageQualityDecision({
    nowMs: 30000, playing: true, isLive: false, isAd: false,
    currentHeight: 1440, mode: "preferred", effectiveBuffer: 30,
    bufferTrend: 0, capacityTrend: 0,
    currentBitrate: 6_000_000, preferredBitrate: 6_000_000,
    availableHeights: [720,1080,1440,2160], lowSinceMs: null, stableSinceMs: null,
    driftSinceMs: null, capacityDeficitSinceMs: null, capacityStableSinceMs: null,
    lastAdjustmentMs: 0, transitionUntilMs: 0, fallbackSinceMs: 0,
    ...input
  });
  console.log(JSON.stringify({ scenario: name, result }));
  return result.action === expectedAction;
}

let ok = true;
ok = run("midband-single-sample-does-not-switch", { effectiveBuffer: 25, bufferTrend: -2, capacityTrend: -0.2 }, "hold") && ok;
ok = run("real-starvation-enters-1080", {
  nowMs: 70000, preferredSinceMs: 10000,
  effectiveBuffer: 1.0, bufferTrend: -3, capacityTrend: -0.5, riskEvent: true,
  lowSinceMs: 68000, lastAdjustmentMs: 50000
}, "switch-fallback") && ok;
ok = run("upshift-buffer-reset-is-grace", { mode: "transition-preferred", transitionUntilMs: 40000, effectiveBuffer: 0.2, bufferTrend: -20, capacityTrend: -20, riskEvent: true }, "hold") && ok;
ok = run("fallback-small-reservoir-starts-recovery-dwell", { nowMs: 60000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000, lastAdjustmentMs: 50000, effectiveBuffer: 6, bufferTrend: 0.05, capacityTrend: 0.05, currentBitrate: 3_000_000, preferredBitrate: 6_000_000 }, "hold") && ok;
if (!ok) process.exitCode = 1;
