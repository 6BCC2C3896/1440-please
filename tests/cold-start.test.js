"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/core.js");

const base = {
  nowMs: 10000, elapsedMs: 500, currentHeight: 2160, targetHeight: 2160,
  effectiveBuffer: 1, bufferTrend: -1, playing: true, isLive: false, isAd: false,
  riskEvent: true, lastAdjustmentMs: 0, availableHeights: [720,1080,1440,2160]
};

test("production cold-start quality actuator is disabled", () => {
  const d = Core.coldStartQualityDecision(base);
  assert.equal(d.action, "hold");
  assert.equal(d.reason, "inactive");
});

test("even a 4K pre-arm stall does not make Guardian force a quality switch", () => {
  const d = Core.coldStartQualityDecision({ ...base, currentHeight: 2160, effectiveBuffer: 0.2, riskEvent: true });
  assert.equal(d.action, "hold");
});

test("standard policy uses two-stage 1440p/1080p ownership", () => {
  const s = Core.applyStandardPolicy({ preferredResolution: 2160 });
  assert.equal(s.adaptiveQuality, true);
  assert.equal(s.twoStageQualityEnabled, true);
  assert.equal(s.preferredResolution, 1440);
  assert.equal(s.fallbackResolution, 1080);
  assert.equal(s.coldStartGuardEnabled, false);
  assert.equal(s.preferredResolution, Core.DEFAULTS.preferredResolution);
});
