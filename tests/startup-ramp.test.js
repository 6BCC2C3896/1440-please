"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/core.js");

const base = {
  nowMs: 10000, armedEpochMs: 0, currentHeight: 1440, targetHeight: 1440,
  effectiveBuffer: 5, bufferTrend: -2, playing: true, riskEvent: true,
  lastAdjustmentMs: 0, stableSinceMs: null, availableHeights: [720,1080,1440]
};

test("production startup ramp cannot downshift quality", () => {
  const d = Core.startupRampDecision(base);
  assert.equal(d.action, "hold");
  assert.equal(d.phase, "inactive");
});

test("buffer growth and buffer collapse are both quality-neutral", () => {
  const healthy = Core.startupRampDecision({ ...base, effectiveBuffer: 80, bufferTrend: 2, riskEvent: false });
  const weak = Core.startupRampDecision({ ...base, effectiveBuffer: 1, bufferTrend: -3, riskEvent: true });
  assert.equal(healthy.action, "hold");
  assert.equal(weak.action, "hold");
});
