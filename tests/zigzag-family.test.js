"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/core.js");

function cycleSamples({ trough = 3, peak = 7, periodMs = 4800, cycles = 4 } = {}) {
  const out = [];
  const half = periodMs / 2;
  let at = 0;
  for (let i = 0; i < cycles; i += 1) {
    out.push({ at, bufferAhead: peak });
    out.push({ at: at + half, bufferAhead: trough });
    out.push({ at: at + periodMs, bufferAhead: peak });
    at += periodMs;
  }
  return out.sort((a,b) => a.at-b.at);
}

test("zigzag estimator recognizes the observed 3-7 second refill rhythm", () => {
  const z = Core.zigzagMetrics(cycleSamples());
  assert.ok(z.cycles >= 2, JSON.stringify(z));
  assert.ok(z.periodMs >= 4500 && z.periodMs <= 5100, JSON.stringify(z));
  assert.ok(z.trough >= 2.8 && z.trough <= 3.2, JSON.stringify(z));
  assert.ok(z.peak >= 6.8 && z.peak <= 7.2, JSON.stringify(z));
  assert.ok(z.amplitude >= 3.5, JSON.stringify(z));
  assert.equal(Core.zigzagHealth({ zigzag: z }, Core.DEFAULTS).regular, true);
});

test("regular zigzag suppresses pessimistic capacity fallback after settle", () => {
  const z = Core.zigzagMetrics(cycleSamples());
  const result = Core.twoStageQualityDecision({
    nowMs: 90000, currentHeight: 1440, mode: "preferred", preferredSinceMs: 20000,
    effectiveBuffer: 3.2, bufferTrend: -0.7, capacityTrend: -0.35,
    currentBitrate: 6_000_000, preferredBitrate: 6_000_000,
    bandwidthEstimateBps: 5_000_000, bandwidthSampleCount: 5,
    bandwidthInstability: 0.25, playing: true, riskEvent: false,
    availableHeights: [1080,1440], zigzag: z, lastAdjustmentMs: 0
  });
  assert.equal(result.action, "hold");
});

test("missed refill plus real starvation can escape to 1080p", () => {
  const z = {
    cycles: 3, periodMs: 4500, periodJitterRatio: 0.05,
    trough: 2.7, peak: 6.8, amplitude: 4.1, refillSlope: 2.0,
    lastRefillAgeMs: 7000
  };
  const result = Core.twoStageQualityDecision({
    nowMs: 90000, currentHeight: 1440, mode: "preferred", preferredSinceMs: 20000,
    effectiveBuffer: 1.0, bufferTrend: -1.2, capacityTrend: -0.8,
    currentBitrate: 6_000_000, preferredBitrate: 6_000_000,
    playing: true, riskEvent: true, availableHeights: [1080,1440],
    zigzag: z, lastAdjustmentMs: 0
  });
  assert.equal(result.action, "switch-fallback");
});

test("fallback rebuilds and respects long retry backoff before another soft 1440p trial", () => {
  const blocked = Core.twoStageQualityDecision({
    nowMs: 120000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000,
    retryBlockedUntilMs: 125000, effectiveBuffer: 20, bufferTrend: 0.08, capacityTrend: 0.08,
    currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
    playing: true, availableHeights: [1080,1440], lastAdjustmentMs: 50000
  });
  assert.equal(blocked.action, "hold");
  assert.equal(blocked.reason, "fallback-retry-backoff");

  const first = Core.twoStageQualityDecision({
    nowMs: 126000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000,
    retryBlockedUntilMs: 125000, effectiveBuffer: 20, bufferTrend: 0.08, capacityTrend: 0.08,
    currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
    playing: true, availableHeights: [1080,1440], lastAdjustmentMs: 50000
  });
  assert.equal(first.action, "hold");
  const second = Core.twoStageQualityDecision({
    nowMs: 135000, currentHeight: 1080, mode: "fallback", fallbackSinceMs: 50000,
    retryBlockedUntilMs: 125000, effectiveBuffer: 21, bufferTrend: 0.08, capacityTrend: 0.08,
    currentBitrate: 3_000_000, preferredBitrate: 6_000_000,
    playing: true, availableHeights: [1080,1440], lastAdjustmentMs: 50000,
    capacityStableSinceMs: first.capacityStableSinceMs
  });
  assert.equal(second.action, "open-preferred-range");
  assert.equal(second.mode, "range-preferred");
});

test("family retains broad native read-ahead envelope", () => {
  assert.equal(Core.DEFAULTS.nativeReadaheadFloorSeconds, 15);
  assert.equal(Core.DEFAULTS.nativeReadaheadGoalSeconds, 30);
  assert.equal(Core.DEFAULTS.nativeReadaheadCeilingSeconds, 160);
  assert.equal(Core.DEFAULTS.nativeReadaheadGrowthRateMs, 300);
});
