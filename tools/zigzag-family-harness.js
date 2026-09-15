"use strict";
const assert = require("node:assert/strict");
const Core = require("../lib/core.js");

const AVAILABLE = [1080, 1440];
const BASE = {
  playing: true,
  riskEvent: false,
  currentBitrate: 6_000_000,
  preferredBitrate: 6_000_000,
  availableHeights: AVAILABLE,
  bandwidthSampleCount: 4,
  bandwidthInstability: 0.10,
  mediaAgeMs: 1000,
  deliveryAgeMs: 1000,
  lowSinceMs: null,
  stableSinceMs: null,
  driftSinceMs: null,
  cruiseStableSinceMs: null,
  capacityDeficitSinceMs: null,
  capacityStableSinceMs: null,
  retryBlockedUntilMs: 0,
};
function decide(overrides = {}) {
  return Core.twoStageQualityDecision({ ...BASE, ...overrides });
}

// Phase 1: a strong native 1080p startup is deliberately matured before 1440 is even eligible.
const bootAge = decide({
  nowMs: 20_000, playbackAgeMs: 20_000, mode: "bootstrap", currentHeight: 1080,
  effectiveBuffer: 20, bufferTrend: 0.20, capacityTrend: 0.20,
  lastAdjustmentMs: 0, fallbackSinceMs: 0, preferredSinceMs: 0,
});
assert.equal(bootAge.action, "hold");
assert.equal(bootAge.reason, "bootstrap-transport-age");
const boot1 = decide({
  nowMs: 31_000, playbackAgeMs: 31_000, mode: "bootstrap", currentHeight: 1080,
  effectiveBuffer: 20, bufferTrend: 0.15, capacityTrend: 0.15,
  lastAdjustmentMs: 0, fallbackSinceMs: 0, preferredSinceMs: 0,
});
assert.equal(boot1.action, "hold");
assert.equal(boot1.reason, "bootstrap-stability-dwell");
const boot2 = decide({
  nowMs: 40_000, playbackAgeMs: 40_000, mode: "bootstrap", currentHeight: 1080,
  effectiveBuffer: 21, bufferTrend: 0.10, capacityTrend: 0.10,
  stableSinceMs: boot1.stableSinceMs, lastAdjustmentMs: 0,
  fallbackSinceMs: 0, preferredSinceMs: 0,
});
assert.equal(boot2.action, "open-preferred-range");
assert.equal(boot2.mode, "range-preferred");

// Phase 1b: the soft range preserves 1080 while the higher path warms.
const rangeHold = decide({
  nowMs: 55_000, playbackAgeMs: 55_000, mode: "range-preferred", currentHeight: 1080,
  effectiveBuffer: 20, bufferTrend: 0.05, capacityTrend: 0.05,
  transitionUntilMs: boot2.transitionUntilMs, lastAdjustmentMs: 0,
});
assert.equal(rangeHold.action, "hold");
assert.equal(rangeHold.reason, "preferred-range-warmup");

// If native ABR has not selected 1440 by the end of the soft warmup, allow exactly one exact trial.
const exact = decide({
  nowMs: boot2.transitionUntilMs + 1, playbackAgeMs: boot2.transitionUntilMs + 1,
  mode: "range-preferred", currentHeight: 1080, effectiveBuffer: 20,
  bufferTrend: 0.05, capacityTrend: 0.05, transitionUntilMs: boot2.transitionUntilMs,
  lastAdjustmentMs: 0,
});
assert.equal(exact.action, "switch-preferred");
assert.equal(exact.mode, "transition-preferred");

// Phase 2: representation reset / first hill must not create rapid flip-flop.
const reset = decide({
  nowMs: exact.preferredSinceMs + 12_000, playbackAgeMs: 90_000,
  mode: "transition-preferred", currentHeight: 1440,
  transitionUntilMs: exact.transitionUntilMs, preferredSinceMs: exact.preferredSinceMs,
  effectiveBuffer: 0.20, bufferTrend: -10, capacityTrend: -10,
  riskEvent: true, deliveryAgeMs: 1000, lastAdjustmentMs: exact.preferredSinceMs,
});
assert.equal(reset.action, "hold");
assert.equal(reset.reason, "preferred-transition-delivery-active");

// The hill is allowed to build and decline while real 1440 media delivery remains active.
for (const [offset, buffer, trend] of [
  [16_000, 3, +0.8], [20_000, 7, +0.5], [24_000, 10, +0.1],
  [28_000, 8, -0.25], [32_000, 5, -0.35], [36_000, 1.2, -0.5],
]) {
  const d = decide({
    nowMs: exact.preferredSinceMs + offset, playbackAgeMs: 100_000 + offset,
    mode: "transition-preferred", currentHeight: 1440,
    transitionUntilMs: exact.transitionUntilMs, preferredSinceMs: exact.preferredSinceMs,
    effectiveBuffer: buffer, bufferTrend: trend, capacityTrend: trend,
    riskEvent: false, deliveryAgeMs: 1200, lastAdjustmentMs: exact.preferredSinceMs,
  });
  assert.equal(d.action, "hold", `${offset}/${buffer}/${trend}: ${JSON.stringify(d)}`);
}

// Commit the trial after the long transition lease.
const committed = decide({
  nowMs: exact.transitionUntilMs + 1, playbackAgeMs: exact.transitionUntilMs + 1,
  mode: "transition-preferred", currentHeight: 1440,
  transitionUntilMs: exact.transitionUntilMs, preferredSinceMs: exact.preferredSinceMs,
  effectiveBuffer: 4.5, bufferTrend: 0.5, capacityTrend: 0.5,
  deliveryAgeMs: 1000, lastAdjustmentMs: exact.preferredSinceMs,
});
assert.equal(committed.action, "commit-preferred");
assert.equal(committed.mode, "preferred");

// Phase 3: convergence climbs into the observed 20-27 s late-game state.
const cruiseDwell = decide({
  nowMs: 130_000, mode: "preferred", currentHeight: 1440,
  preferredSinceMs: exact.preferredSinceMs, effectiveBuffer: 21, bufferTrend: 0.10,
  capacityTrend: 0.10, lastAdjustmentMs: exact.preferredSinceMs,
});
assert.equal(cruiseDwell.action, "hold");
const cruise = decide({
  nowMs: 136_000, mode: "preferred", currentHeight: 1440,
  preferredSinceMs: exact.preferredSinceMs, effectiveBuffer: 25, bufferTrend: 0.00,
  capacityTrend: 0.00, cruiseStableSinceMs: cruiseDwell.cruiseStableSinceMs,
  lastAdjustmentMs: exact.preferredSinceMs,
});
assert.equal(cruise.action, "enter-cruise");
assert.equal(cruise.mode, "cruise");

// Normal late-game zigzag is protected even at a low trough.
const cycleSamples = [];
for (let c = 0; c < 4; c += 1) {
  const b = c * 4800;
  cycleSamples.push({ at: b, bufferAhead: 7.0 });
  cycleSamples.push({ at: b + 2400, bufferAhead: 3.0 });
  cycleSamples.push({ at: b + 4800, bufferAhead: 7.0 });
}
const z = Core.zigzagMetrics(cycleSamples);
const health = Core.zigzagHealth({ zigzag: z }, Core.DEFAULTS);
assert.equal(health.regular, true, JSON.stringify({ z, health }));
const protectedCycle = decide({
  nowMs: 140_000, mode: "cruise", currentHeight: 1440,
  effectiveBuffer: 3.4, bufferTrend: -0.7, capacityTrend: -0.35,
  deliveryAgeMs: 3500, zigzag: z, lastAdjustmentMs: exact.preferredSinceMs,
});
assert.equal(protectedCycle.action, "hold");
assert.equal(protectedCycle.reason, "cruise-zigzag-protected");

// Late-game 25 -> 0 signature: stale delivery + falling reservoir + missed refill.
// First observation starts a dwell; a persistent collapse causes exactly one fallback.
const collapse1 = decide({
  nowMs: 170_000, mode: "cruise", currentHeight: 1440,
  effectiveBuffer: 7.0, bufferTrend: -0.55, capacityTrend: -0.55,
  deliveryAgeMs: 9000, zigzag: null, lastAdjustmentMs: 150_000,
});
assert.equal(collapse1.action, "hold");
assert.equal(collapse1.reason, "cruise-collapse-dwell");
const collapse2 = decide({
  nowMs: 172_000, mode: "cruise", currentHeight: 1440,
  effectiveBuffer: 5.5, bufferTrend: -0.55, capacityTrend: -0.55,
  deliveryAgeMs: 11000, zigzag: null, lowSinceMs: collapse1.lowSinceMs,
  lastAdjustmentMs: 150_000,
});
assert.equal(collapse2.action, "switch-fallback");
assert.equal(collapse2.reason, "cruise-missed-refill-fallback");
assert.ok(collapse2.retryBlockedUntilMs > collapse2.transitionUntilMs);

console.log(JSON.stringify({
  family: "0.17.x-zigzag",
  release: "0.17.8",
  phases: {
    bootstrap: "native reservoir before first 1440 trial",
    transition: "soft 1080–1440 warmup plus 45 s exact preferred lease prevents cold-path flip-flop",
    convergence: "0→10→0 hill tolerated unless true emergency persists",
    cruise: "20–27 s proven state is latched; missed refill is a distinct failure"
  },
  cycle: {
    trough: z.trough,
    peak: z.peak,
    amplitude: z.amplitude,
    periodMs: z.periodMs,
    jitter: z.periodJitterRatio,
    classification: health.regular ? "stable-periodic-delivery" : "unstable"
  },
  lateCollapse: collapse2.reason
}, null, 2));
