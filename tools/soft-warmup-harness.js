#!/usr/bin/env node
"use strict";

const Core = require("../lib/core.js");
const assert = require("node:assert/strict");

const base = {
  playing: true,
  isLive: false,
  isAd: false,
  riskEvent: false,
  availableHeights: [1080, 1440],
  currentHeight: 1080,
  mode: "bootstrap",
  effectiveBuffer: 20,
  bufferTrend: 0.3,
  capacityTrend: 0.3,
  playbackAgeMs: 0,
  mediaAgeMs: 1000,
  deliveryAgeMs: 1000,
  lowSinceMs: null,
  stableSinceMs: null,
  driftSinceMs: null,
  lastAdjustmentMs: 0,
  transitionUntilMs: 0,
  fallbackSinceMs: 0,
  preferredSinceMs: 0,
  retryBlockedUntilMs: 0,
  capacityStableSinceMs: null,
  capacityDeficitSinceMs: null,
  cruiseStableSinceMs: null,
};
function q(v) { return Core.twoStageQualityDecision({ ...base, ...v }); }
function emit(scenario, result) { console.log(JSON.stringify({ scenario, result })); }

const early = q({ nowMs: 20000, playbackAgeMs: 20000 });
emit("strong-1080-stays-put-before-transport-age", early);
assert.equal(early.action, "hold");
assert.equal(early.reason, "bootstrap-transport-age");

const warm1 = q({ nowMs: 31000, playbackAgeMs: 31000 });
assert.equal(warm1.action, "hold");
const warm2 = q({ nowMs: 40000, playbackAgeMs: 40000, stableSinceMs: warm1.stableSinceMs });
emit("warm-1080-opens-soft-range", warm2);
assert.equal(warm2.action, "open-preferred-range");
assert.equal(warm2.mode, "range-preferred");
assert.equal(warm2.rangeMinHeight, 1080);
assert.equal(warm2.rangeMaxHeight, 1440);

const rangeHold = q({
  nowMs: 50000,
  playbackAgeMs: 50000,
  mode: "range-preferred",
  currentHeight: 1080,
  transitionUntilMs: warm2.transitionUntilMs,
});
emit("range-preserves-warm-1080-during-1440-warmup", rangeHold);
assert.equal(rangeHold.action, "hold");
assert.equal(rangeHold.reason, "preferred-range-warmup");

const native1440a = q({
  nowMs: 51000,
  playbackAgeMs: 51000,
  mode: "range-preferred",
  currentHeight: 1440,
  effectiveBuffer: 5,
  bufferTrend: 0.2,
  transitionUntilMs: warm2.transitionUntilMs,
});
assert.equal(native1440a.action, "hold");
const native1440b = q({
  nowMs: 57000,
  playbackAgeMs: 57000,
  mode: "range-preferred",
  currentHeight: 1440,
  effectiveBuffer: 6,
  bufferTrend: 0.2,
  transitionUntilMs: warm2.transitionUntilMs,
  stableSinceMs: native1440a.stableSinceMs,
});
emit("native-1440-inside-range-is-adopted-without-exact-lock", native1440b);
assert.equal(native1440b.action, "adopt-preferred");
assert.equal(native1440b.mode, "preferred");

const exactTrial = q({
  nowMs: warm2.transitionUntilMs + 1000,
  playbackAgeMs: warm2.transitionUntilMs + 1000,
  mode: "range-preferred",
  currentHeight: 1080,
  effectiveBuffer: 20,
  bufferTrend: 0.1,
  transitionUntilMs: warm2.transitionUntilMs,
});
emit("soft-range-may-eventually-make-one-exact-1440-trial", exactTrial);
assert.equal(exactTrial.action, "switch-preferred");
assert.equal(exactTrial.mode, "transition-preferred");

const activeZero = q({
  nowMs: exactTrial.preferredSinceMs + 12000,
  playbackAgeMs: 90000,
  mode: "transition-preferred",
  currentHeight: 1440,
  effectiveBuffer: 0.1,
  bufferTrend: -1,
  capacityTrend: -1,
  riskEvent: true,
  preferredSinceMs: exactTrial.preferredSinceMs,
  transitionUntilMs: exactTrial.transitionUntilMs,
  deliveryAgeMs: 1200,
});
emit("near-zero-does-not-abort-while-1440-delivery-is-active", activeZero);
assert.equal(activeZero.action, "hold");
assert.equal(activeZero.reason, "preferred-transition-delivery-active");

const deadA = q({
  nowMs: exactTrial.preferredSinceMs + 14000,
  playbackAgeMs: 92000,
  mode: "transition-preferred",
  currentHeight: 1440,
  effectiveBuffer: 0.1,
  bufferTrend: -1,
  capacityTrend: -1,
  riskEvent: true,
  preferredSinceMs: exactTrial.preferredSinceMs,
  transitionUntilMs: exactTrial.transitionUntilMs,
  deliveryAgeMs: 8000,
});
assert.equal(deadA.action, "hold");
assert.equal(deadA.reason, "preferred-transition-emergency-dwell");
const deadB = q({
  nowMs: exactTrial.preferredSinceMs + 18000,
  playbackAgeMs: 96000,
  mode: "transition-preferred",
  currentHeight: 1440,
  effectiveBuffer: 0.05,
  bufferTrend: -1,
  capacityTrend: -1,
  riskEvent: true,
  preferredSinceMs: exactTrial.preferredSinceMs,
  transitionUntilMs: exactTrial.transitionUntilMs,
  deliveryAgeMs: 12000,
  lowSinceMs: deadA.lowSinceMs,
});
emit("truly-dead-1440-path-falls-back-after-silence-and-dwell", deadB);
assert.equal(deadB.action, "switch-fallback");
assert.ok(deadB.retryBlockedUntilMs - deadB.fallbackSinceMs >= 75000);

const blocked = q({
  nowMs: deadB.fallbackSinceMs + 30000,
  playbackAgeMs: 130000,
  mode: "fallback",
  currentHeight: 1080,
  effectiveBuffer: 25,
  bufferTrend: 0.5,
  fallbackSinceMs: deadB.fallbackSinceMs,
  retryBlockedUntilMs: deadB.retryBlockedUntilMs,
});
emit("failed-1440-trial-cannot-immediately-flip-flop", blocked);
assert.equal(blocked.action, "hold");
assert.equal(blocked.reason, "fallback-retry-backoff");

console.log("SOFT WARMUP HARNESS PASS");
