"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/core.js");

const levels = [720,1080,1440,2160];
function d(input) {
  return Core.twoStageQualityDecision({
    nowMs: 80000, currentHeight: 1440, mode: "preferred", effectiveBuffer: 25,
    bufferTrend: 0, capacityTrend: 0, playing: true, riskEvent: false,
    availableHeights: levels, lowSinceMs: null, stableSinceMs: null,
    driftSinceMs: null, lastAdjustmentMs: 0, transitionUntilMs: 0,
    fallbackSinceMs: 0, preferredSinceMs: 20000, retryBlockedUntilMs: 0,
    mediaAgeMs: 1000, deliveryAgeMs: 1000, ...input
  });
}

test("step-shaped buffer growth is not treated as a reason to leave 1440p", () => {
  for (const [i, buffer] of [3,12,25,31,29,42,39,58,52,75,68,84].entries()) {
    const prev = i ? [3,12,25,31,29,42,39,58,52,75,68,84][i-1] : buffer;
    const result = d({ nowMs: 80000+i*1000, effectiveBuffer: buffer, bufferTrend: buffer-prev });
    assert.equal(result.action, "hold");
  }
});

test("real near-empty starvation can use the single 1080p escape hatch", () => {
  const result = d({ effectiveBuffer: 1.0, bufferTrend: -2, riskEvent: true });
  assert.equal(result.action, "switch-fallback");
  assert.equal(result.targetHeight, 1080);
});

test("1440p transition reset is tolerated and does not instant-rollback", () => {
  const result = d({
    nowMs: 35000, mode: "transition-preferred", currentHeight: 1440,
    transitionUntilMs: 65000, lastAdjustmentMs: 30000,
    preferredSinceMs: 30000, effectiveBuffer: 0.1, bufferTrend: -30, riskEvent: true
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "preferred-transition-delivery-active");
});

test("after the long lease a recovered upshift commits to preferred", () => {
  const result = d({
    nowMs: 66000, mode: "transition-preferred", currentHeight: 1440,
    transitionUntilMs: 65000, lastAdjustmentMs: 30000,
    preferredSinceMs: 30000, effectiveBuffer: 12, bufferTrend: 2, riskEvent: false
  });
  assert.equal(result.action, "commit-preferred");
  assert.equal(result.mode, "preferred");
});
