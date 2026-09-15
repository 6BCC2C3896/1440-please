"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/core.js");

const available = [720, 1080, 1440, 2160];
function decide(overrides = {}) {
  return Core.twoStageQualityDecision({
    nowMs: 60000,
    currentHeight: 1440,
    mode: "preferred",
    effectiveBuffer: 25,
    bufferTrend: 0,
    capacityTrend: 0,
    currentBitrate: 6_000_000,
    preferredBitrate: 6_000_000,
    playing: true,
    riskEvent: false,
    availableHeights: available,
    lowSinceMs: null,
    stableSinceMs: null,
    driftSinceMs: null,
    cruiseStableSinceMs: null,
    capacityDeficitSinceMs: null,
    capacityStableSinceMs: null,
    lastAdjustmentMs: 0,
    transitionUntilMs: 0,
    fallbackSinceMs: 0,
    preferredSinceMs: 10000,
    retryBlockedUntilMs: 0,
    mediaAgeMs: 1000,
    deliveryAgeMs: 1000,
    playbackAgeMs: 60000,
    ...overrides
  });
}

test("default two-stage heights remain exactly 1440 preferred and 1080 fallback", () => {
  assert.deepEqual(Core.twoStageHeights(available, Core.DEFAULTS), { preferred: 1440, fallback: 1080 });
});

test("stable 1440p from 10-30 seconds is accepted without watermark chasing", () => {
  for (const [buffer, trend] of [[10,0], [14,-0.02], [20,0.04], [28,-0.01]]) {
    const d = decide({ effectiveBuffer: buffer, bufferTrend: trend, capacityTrend: trend });
    assert.equal(d.action, "hold", `${buffer}/${trend}: ${d.reason}`);
  }
});

test("capacity pessimism alone cannot demote a surviving preferred stream", () => {
  const d = decide({
    effectiveBuffer: 7, bufferTrend: -0.08, capacityTrend: -0.13,
    bandwidthEstimateBps: 5_000_000, bandwidthSampleCount: 5,
    bandwidthInstability: 0.1
  });
  assert.equal(d.action, "hold");
});

test("a proven 3-7 second refill cycle protects the drain half of the cycle", () => {
  const d = decide({
    effectiveBuffer: 3.2, bufferTrend: -0.7, capacityTrend: -0.35,
    bandwidthEstimateBps: 5_000_000, bandwidthSampleCount: 5,
    zigzag: { cycles: 3, periodMs: 4800, periodJitterRatio: 0.08, trough: 2.8, peak: 7.1, amplitude: 4.3, refillSlope: 2.2, lastRefillAgeMs: 3200 }
  });
  assert.equal(d.action, "hold");
  assert.match(d.reason, /zigzag|converging|settle/);
});

test("bootstrap warms 1080p transport before opening a soft 1080-1440 range", () => {
  const tooEarly = decide({
    nowMs: 20000, playbackAgeMs: 20000, mode: "bootstrap", currentHeight: 1080,
    effectiveBuffer: 22, bufferTrend: 0.5, preferredSinceMs: 0
  });
  assert.equal(tooEarly.action, "hold");
  assert.equal(tooEarly.reason, "bootstrap-transport-age");

  const first = decide({
    nowMs: 32000, playbackAgeMs: 32000, mode: "bootstrap", currentHeight: 1080,
    effectiveBuffer: 20, bufferTrend: 0.1, preferredSinceMs: 0
  });
  assert.equal(first.action, "hold");
  assert.equal(first.reason, "bootstrap-stability-dwell");
  const second = decide({
    nowMs: 41000, playbackAgeMs: 41000, mode: "bootstrap", currentHeight: 1080,
    effectiveBuffer: 21, bufferTrend: 0.05, stableSinceMs: first.stableSinceMs,
    preferredSinceMs: 0
  });
  assert.equal(second.action, "open-preferred-range");
  assert.equal(second.mode, "range-preferred");
  assert.equal(second.rangeMinHeight, 1080);
  assert.equal(second.rangeMaxHeight, 1440);
});

test("soft preferred range preserves 1080 while the 1440 transport warms", () => {
  const d = decide({
    nowMs: 50000, mode: "range-preferred", currentHeight: 1080,
    effectiveBuffer: 20, bufferTrend: 0.2, transitionUntilMs: 70000
  });
  assert.equal(d.action, "hold");
  assert.equal(d.reason, "preferred-range-warmup");
});

test("native 1440 selected inside the soft range is adopted without another hard switch", () => {
  const first = decide({
    nowMs: 50000, mode: "range-preferred", currentHeight: 1440,
    effectiveBuffer: 6, bufferTrend: 0.1, transitionUntilMs: 70000
  });
  assert.equal(first.action, "hold");
  assert.equal(first.reason, "preferred-range-1440-dwell");
  const second = decide({
    nowMs: 56000, mode: "range-preferred", currentHeight: 1440,
    effectiveBuffer: 8, bufferTrend: 0.1, transitionUntilMs: 70000,
    stableSinceMs: first.stableSinceMs
  });
  assert.equal(second.action, "adopt-preferred");
  assert.equal(second.mode, "preferred");
});

test("soft range eventually permits exactly one 1440 trial after the transport warmup", () => {
  const d = decide({
    nowMs: 71000, mode: "range-preferred", currentHeight: 1080,
    effectiveBuffer: 20, bufferTrend: 0.1, transitionUntilMs: 70000, lastAdjustmentMs: 41000
  });
  assert.equal(d.action, "switch-preferred");
  assert.equal(d.reason, "preferred-range-exact-trial");
  assert.equal(d.mode, "transition-preferred");
});

test("preferred transition does not panic at zero while 1440 media is still arriving", () => {
  const d = decide({
    nowMs: 45000, currentHeight: 1440, mode: "transition-preferred",
    transitionUntilMs: 80000, effectiveBuffer: 0.1, bufferTrend: -20,
    capacityTrend: -20, riskEvent: true, lastAdjustmentMs: 30000,
    preferredSinceMs: 30000, deliveryAgeMs: 900
  });
  assert.equal(d.action, "hold");
  assert.equal(d.reason, "preferred-transition-delivery-active");
});

test("preferred transition cannot abort before its minimum warmup even when delivery is silent", () => {
  const d = decide({
    nowMs: 38000, currentHeight: 1440, mode: "transition-preferred",
    transitionUntilMs: 80000, effectiveBuffer: 0.1, bufferTrend: -20,
    capacityTrend: -20, riskEvent: true, lastAdjustmentMs: 30000,
    preferredSinceMs: 30000, deliveryAgeMs: 9000
  });
  assert.equal(d.action, "hold");
  assert.equal(d.reason, "preferred-transition-lease");
});

test("a truly dead 1440 transport aborts only after warmup, delivery silence, and emergency dwell", () => {
  const first = decide({
    nowMs: 43000, currentHeight: 1440, mode: "transition-preferred",
    transitionUntilMs: 80000, effectiveBuffer: 0.1, bufferTrend: -20,
    capacityTrend: -20, riskEvent: true, lastAdjustmentMs: 30000,
    preferredSinceMs: 30000, deliveryAgeMs: 9000
  });
  assert.equal(first.action, "hold");
  assert.equal(first.reason, "preferred-transition-emergency-dwell");
  const second = decide({
    nowMs: 46500, currentHeight: 1440, mode: "transition-preferred",
    transitionUntilMs: 80000, effectiveBuffer: 0.05, bufferTrend: -20,
    capacityTrend: -20, riskEvent: true, lastAdjustmentMs: 30000,
    preferredSinceMs: 30000, deliveryAgeMs: 12000, lowSinceMs: first.lowSinceMs
  });
  assert.equal(second.action, "switch-fallback");
  assert.equal(second.reason, "preferred-transition-emergency-abort");
  assert.ok(second.retryBlockedUntilMs >= 120000);
});

test("failed preferred trial creates fallback hold and retry backoff instead of flip-flop", () => {
  const d = decide({
    nowMs: 50000, currentHeight: 1080, mode: "fallback",
    fallbackSinceMs: 42000, retryBlockedUntilMs: 70000,
    effectiveBuffer: 20, bufferTrend: 1.0, capacityTrend: 1.0,
    currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
    bandwidthEstimateBps: 8_000_000, bandwidthSampleCount: 5
  });
  assert.equal(d.action, "hold");
  assert.equal(d.reason, "fallback-retry-backoff");
});

test("failed fallback retries through the soft range only after long backoff and rebuilt reservoir", () => {
  const first = decide({
    nowMs: 120000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000,
    retryBlockedUntilMs: 125000, effectiveBuffer: 20, bufferTrend: 0.1, capacityTrend: 0.1,
    currentBitrate: 3_000_000, preferredBitrate: 6_000_000, lastAdjustmentMs: 50000
  });
  assert.equal(first.action, "hold");
  assert.equal(first.reason, "fallback-retry-backoff");
  const ready1 = decide({
    nowMs: 126000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000,
    retryBlockedUntilMs: 125000, effectiveBuffer: 20, bufferTrend: 0.1, capacityTrend: 0.1,
    currentBitrate: 3_000_000, preferredBitrate: 6_000_000, lastAdjustmentMs: 50000
  });
  assert.equal(ready1.action, "hold");
  const ready2 = decide({
    nowMs: 135000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000,
    retryBlockedUntilMs: 125000, effectiveBuffer: 21, bufferTrend: 0.1, capacityTrend: 0.1,
    currentBitrate: 3_000_000, preferredBitrate: 6_000_000, lastAdjustmentMs: 50000,
    capacityStableSinceMs: ready1.capacityStableSinceMs
  });
  assert.equal(ready2.action, "open-preferred-range");
  assert.equal(ready2.mode, "range-preferred");
  assert.equal(ready2.rangeMinHeight, 1080);
  assert.equal(ready2.rangeMaxHeight, 1440);
});

test("native 1080 drift is not fought while preferred buffer is still liminal", () => {
  const first = decide({
    nowMs: 70000, currentHeight: 1080, effectiveBuffer: 6,
    bufferTrend: 0, capacityTrend: 0
  });
  const second = decide({
    nowMs: 78000, currentHeight: 1080, effectiveBuffer: 6,
    bufferTrend: 0, capacityTrend: 0, driftSinceMs: first.driftSinceMs
  });
  assert.equal(second.action, "hold");
});

test("native drift is only repaired after the larger warm reservoir is proven", () => {
  const liminal1 = decide({
    nowMs: 70000, currentHeight: 1080, effectiveBuffer: 14,
    bufferTrend: 0.1, capacityTrend: 0.1
  });
  const liminal2 = decide({
    nowMs: 78000, currentHeight: 1080, effectiveBuffer: 14,
    bufferTrend: 0.1, capacityTrend: 0.1, driftSinceMs: liminal1.driftSinceMs
  });
  assert.equal(liminal2.action, "hold");

  const warm1 = decide({
    nowMs: 90000, currentHeight: 1080, effectiveBuffer: 20,
    bufferTrend: 0.1, capacityTrend: 0.1
  });
  const warm2 = decide({
    nowMs: 98000, currentHeight: 1080, effectiveBuffer: 20,
    bufferTrend: 0.1, capacityTrend: 0.1, driftSinceMs: warm1.driftSinceMs
  });
  assert.equal(warm2.action, "switch-preferred");
});

test("preferred playback promotes to cruise after proving the late-game 20-27 second state", () => {
  const first = decide({
    nowMs: 100000, mode: "preferred", effectiveBuffer: 22,
    bufferTrend: 0.1, capacityTrend: 0.1
  });
  assert.equal(first.action, "hold");
  const second = decide({
    nowMs: 106000, mode: "preferred", effectiveBuffer: 25,
    bufferTrend: 0.0, capacityTrend: 0.0, cruiseStableSinceMs: first.cruiseStableSinceMs
  });
  assert.equal(second.action, "enter-cruise");
  assert.equal(second.mode, "cruise");
});

test("cruise ignores normal low zigzag but catches a missed-refill collapse", () => {
  const protectedCycle = decide({
    mode: "cruise", effectiveBuffer: 3.5, bufferTrend: -0.5,
    capacityTrend: -0.5, deliveryAgeMs: 5000,
    zigzag: { cycles: 3, periodMs: 4800, periodJitterRatio: 0.08, trough: 3, peak: 7, amplitude: 4, refillSlope: 2, lastRefillAgeMs: 3500 }
  });
  assert.equal(protectedCycle.action, "hold");
  assert.equal(protectedCycle.reason, "cruise-zigzag-protected");

  const first = decide({
    nowMs: 120000, mode: "cruise", effectiveBuffer: 6,
    bufferTrend: -0.5, capacityTrend: -0.5, deliveryAgeMs: 9000,
    zigzag: null
  });
  assert.equal(first.action, "hold");
  assert.equal(first.reason, "cruise-collapse-dwell");
  const second = decide({
    nowMs: 122000, mode: "cruise", effectiveBuffer: 5,
    bufferTrend: -0.5, capacityTrend: -0.5, deliveryAgeMs: 11000,
    lowSinceMs: first.lowSinceMs, zigzag: null
  });
  assert.equal(second.action, "switch-fallback");
  assert.equal(second.reason, "cruise-missed-refill-fallback");
});

test("manual external switch to 1440p is respected as a preferred trial", () => {
  const d = decide({
    nowMs: 90000, currentHeight: 1440, mode: "fallback", fallbackSinceMs: 60000,
    effectiveBuffer: 8, capacityTrend: 0, currentBitrate: 6_000_000,
    preferredBitrate: 6_000_000, lastAdjustmentMs: 60000
  });
  assert.equal(d.action, "adopt-preferred");
  assert.equal(d.mode, "transition-preferred");
});

test("deliveryHeadroom still prefers measured bandwidth and falls back to buffer slope", () => {
  const measured = Core.deliveryHeadroom({
    capacityTrend: 0.1, currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
    bandwidthEstimateBps: 7_800_000, bandwidthSampleCount: 4, minBandwidthSamples: 2
  });
  assert.equal(measured.hasMeasuredBandwidth, true);
  assert.equal(measured.estimatedBandwidth, 7_800_000);
  const slope = Core.deliveryHeadroom({ capacityTrend: 1.6, currentBitrate: 3_000_000, preferredBitrate: 6_000_000 });
  assert.equal(slope.estimatedBandwidth, 7_800_000);
});
