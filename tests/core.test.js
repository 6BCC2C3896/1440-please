"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/core.js");
function timeRanges(list) { return { length: list.length, start(i) { return list[i][0]; }, end(i) { return list[i][1]; } }; }

test("contiguous buffer ignores disconnected future ranges", () => {
  const snap = Core.contiguousBuffer(timeRanges([[0, 10], [20, 50]]), 4);
  assert.equal(snap.ahead, 6);
  assert.equal(snap.end, 10);
});

test("playhead in a gap has zero usable buffer", () => {
  assert.equal(Core.bufferAhead(timeRanges([[0, 10], [20, 50]]), 15), 0);
});

test("tolerance only snaps into a range ahead, not an expired range behind", () => {
  assert.equal(Core.bufferAhead([{ start: 10, end: 20 }], 9.95, 0.1), 10.05);
  assert.equal(Core.bufferAhead([{ start: 0, end: 10 }], 10.05, 0.1), 0);
});

test("effective buffer accounts for playback speed", () => {
  assert.equal(Core.effectiveBufferSeconds(30, 2, false), 15);
  assert.equal(Core.effectiveBufferSeconds(30, 1.5, false), 20);
  assert.equal(Core.effectiveBufferSeconds(30, 2, true), 30);
});

test("trend is measured in effective seconds per wall second", () => {
  assert.equal(Core.trend([{ at: 0, bufferAhead: 30 }, { at: 2000, bufferAhead: 26 }]), -2);
});

test("network health distinguishes media-active, warm CDN, and idle", () => {
  assert.equal(Core.networkHealth({ mediaAgeMs: 500, cdnAgeMs: 500 }), "active");
  assert.equal(Core.networkHealth({ mediaAgeMs: 6000, cdnAgeMs: 1000 }), "warm");
  assert.equal(Core.networkHealth({ mediaAgeMs: 6000, cdnAgeMs: 20000 }), "idle");
});

test("keepalive waits while real media traffic is active", () => {
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 400, keepaliveAgeMs: 10000, effectiveBuffer: 2 }), false);
});

test("keepalive fires when media is idle and buffer is below target", () => {
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 5000, keepaliveAgeMs: 5000, effectiveBuffer: 15 }), true);
});

test("adaptive mode uses slower keepalive cadence once the configured target is satisfied", () => {
  const settings = { networkKeepWarmMode: "adaptive" };
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 5000, keepaliveAgeMs: 5000, effectiveBuffer: 95 }, settings), false);
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 7000, keepaliveAgeMs: 7000, effectiveBuffer: 95 }, settings), true);
});

test("buffer below the 3-second critical mark is explicitly critical", () => {
  const state = Core.derivePlaybackState({ paused: false, effectiveBuffer: 2, bufferTrend: -1, mediaAgeMs: 5000, cdnAgeMs: 500 }, {});
  assert.equal(state, "critical");
});

test("active delivery inside the 15–30 operating band reports target-fetch", () => {
  const state = Core.derivePlaybackState({ paused: false, effectiveBuffer: 22, bufferTrend: -0.5, mediaAgeMs: 300, cdnAgeMs: 300 }, {});
  assert.equal(state, "recovering-fetch");
});

test("paused prime only operates while already paused", () => {
  assert.equal(Core.decidePausedPrime({ paused: true, mediaBufferAhead: 5 }, {}), true);
  assert.equal(Core.decidePausedPrime({ paused: false, mediaBufferAhead: 5 }, {}), false);
});

test("resolution list contains exactly 14 practical presets and defaults to 1440p", () => {
  assert.equal(Core.RESOLUTION_PRESETS.length, 14);
  assert.equal(Core.DEFAULTS.preferredResolution, 1440);
  assert.ok(Core.RESOLUTION_PRESETS.some((p) => p.height === 1440));
});

test("invalid stored resolution is repaired to default", () => {
  assert.equal(Core.mergeSettings({ preferredResolution: 1234 }).preferredResolution, 1440);
});

test("continuous keep-warm uses the same pulse interval even with a healthy buffer", () => {
  const settings = { networkKeepWarmMode: "continuous", keepaliveIntervalMs: 3000, keepaliveHealthyIntervalMs: 9000 };
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 5000, keepaliveAgeMs: 3500, effectiveBuffer: 50 }, settings), true);
});

test("adaptive keep-warm slows pulses only after target is reached", () => {
  const settings = { networkKeepWarmMode: "adaptive", keepaliveIntervalMs: 3000, keepaliveHealthyIntervalMs: 9000 };
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 5000, keepaliveAgeMs: 3500, effectiveBuffer: 95 }, settings), false);
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 10000, keepaliveAgeMs: 9500, effectiveBuffer: 95 }, settings), true);
});

test("hidden active page remains eligible for keep-warm", () => {
  assert.equal(Core.shouldSendKeepalive({
    playing: true,
    online: true,
    pageState: "active",
    hasCdnOrigin: true,
    mediaAgeMs: 5000,
    keepaliveAgeMs: 5000,
    effectiveBuffer: 10
  }, {}), true);
});

test("paused priming is rejected when page is hidden", () => {
  assert.equal(Core.decidePausedPrime({ paused: true, visible: false, mediaBufferAhead: 5 }, {}), false);
});


test("legacy multi-tier quality controller is disabled under two-stage policy", () => {
  const low = Core.qualityDecision({ nowMs: 10000, currentHeight: 1440, effectiveBuffer: 1, bufferTrend: -3, riskEvent: true, playing: true });
  const high = Core.qualityDecision({ nowMs: 30000, currentHeight: 720, effectiveBuffer: 95, bufferTrend: 2, playing: true });
  assert.equal(low.action, "hold");
  assert.equal(low.reason, "superseded-two-stage");
  assert.equal(high.action, "hold");
  assert.equal(high.reason, "superseded-two-stage");
});

test("resolution ladder helpers remain pure utilities only", () => {
  assert.equal(Core.nextHigherResolution(1080, [720,1080,1440,2160], 1440, 720), 1440);
  assert.equal(Core.nextLowerResolution(720, [360,480,720,1080], 1440, 720), 720);
});

test("bootstrap protection refuses initial paused or undecoded media", () => {
  assert.equal(Core.canArmProtection({
    enabled: true, hasPlayedOnce: false, playing: false, readyState: 4,
    videoWidth: 1920, videoHeight: 1080, mediaBufferAhead: 20,
    playbackAdvanceSeconds: 5, playingWallMs: 5000
  }), false);
  assert.equal(Core.canArmProtection({
    enabled: true, hasPlayedOnce: true, playing: true, readyState: 2,
    videoWidth: 0, videoHeight: 0, mediaBufferAhead: 20,
    playbackAdvanceSeconds: 5, playingWallMs: 5000
  }), false);
});

test("bootstrap protection arms only after real decoded playback and buffer", () => {
  assert.equal(Core.canArmProtection({
    enabled: true, hasPlayedOnce: true, playing: true, readyState: 3,
    videoWidth: 2560, videoHeight: 1440, mediaBufferAhead: 6,
    playbackAdvanceSeconds: 2.5, playingWallMs: 2000
  }), true);
});

test("bootstrap protection requires both wall-time and playback progress", () => {
  const base = {
    enabled: true, hasPlayedOnce: true, playing: true, readyState: 4,
    videoWidth: 1920, videoHeight: 1080, mediaBufferAhead: 10
  };
  assert.equal(Core.canArmProtection({ ...base, playbackAdvanceSeconds: 0.5, playingWallMs: 5000 }), false);
  assert.equal(Core.canArmProtection({ ...base, playbackAdvanceSeconds: 3, playingWallMs: 500 }), false);
});
test("ZigZag family fixes a 30-second operating target and 15-second warm band", () => {
  assert.equal(Core.DEFAULTS.policyVersion, 23);
  assert.equal(Core.DEFAULTS.policyProfile, "zigzag-1440-soft-warmup-v5");
  assert.equal(Core.DEFAULTS.targetBufferSeconds, 30);
  assert.equal(Core.DEFAULTS.warmLowWatermarkSeconds, 15);
  assert.equal(Core.DEFAULTS.pausedTargetSeconds, 30);
  assert.equal(Core.DEFAULTS.mediaDemandStartBufferSeconds, 90);
  assert.equal(Core.DEFAULTS.mediaDemandKickBufferSeconds, 90);
  assert.equal(Core.DEFAULTS.mediaDemandEnabled, false);
  assert.equal(Core.DEFAULTS.mediaDemandMode, "off");
  assert.equal(Core.DEFAULTS.mediaDemandRbufZero, false);
  assert.equal(Core.DEFAULTS.adaptiveQuality, true);
  assert.equal(Core.DEFAULTS.twoStageQualityEnabled, true);
  assert.equal(Core.DEFAULTS.fallbackResolution, 1080);
  assert.equal(Core.DEFAULTS.coldStartGuardEnabled, false);
  assert.equal(Core.DEFAULTS.startupRampEnabled, false);
});

test("standard policy migration discards old tuning but preserves user preferences", () => {
  const migrated = Core.applyStandardPolicy({
    policyVersion: 6,
    targetBufferSeconds: 30,
    mediaDemandStartBufferSeconds: 50,
    networkKeepWarm: false,
    preferredResolution: 2160
  });
  assert.equal(migrated.targetBufferSeconds, 30);
  assert.equal(migrated.mediaDemandStartBufferSeconds, 90);
  assert.equal(migrated.networkKeepWarm, true);
  assert.equal(migrated.preferredResolution, Core.DEFAULTS.preferredResolution);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "hudEnabled"), false);
});

test("buffer band is target at 30, recovery at 15–30, emergency below 15", () => {
  assert.equal(Core.bufferBand(35), "target");
  assert.equal(Core.bufferBand(30), "target");
  assert.equal(Core.bufferBand(22), "recovery");
  assert.equal(Core.bufferBand(15), "recovery");
  assert.equal(Core.bufferBand(8), "emergency");
  assert.equal(Core.bufferBand(2), "critical");
});

test("aggressive mode pulses faster below 15 than inside the recovery band", () => {
  const s = { networkKeepWarmMode: "aggressive", keepaliveIntervalMs: 1500, keepaliveEmergencyIntervalMs: 750, keepaliveHealthyIntervalMs: 6000 };
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 2000, keepaliveAgeMs: 1000, effectiveBuffer: 22 }, s), false);
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 2000, keepaliveAgeMs: 1600, effectiveBuffer: 22 }, s), true);
  assert.equal(Core.shouldSendKeepalive({ playing: true, hasCdnOrigin: true, mediaAgeMs: 2000, keepaliveAgeMs: 800, effectiveBuffer: 8 }, s), true);
});


test("ramp profile is a preserved user preference with defensive as the default", () => {
  assert.equal(Core.DEFAULTS.rampProfile, "defensive");
  assert.ok(Core.USER_PREFERENCE_KEYS.includes("rampProfile"));
  assert.equal(Core.applyStandardPolicy({ rampProfile: "aggressive" }).rampProfile, "aggressive");
  assert.equal(Core.applyStandardPolicy({ rampProfile: "unknown" }).rampProfile, "defensive");
});

test("aggressive ramp shortens upward gates but keeps preferred transition safety intact", () => {
  const defensive = Core.applyStandardPolicy({ rampProfile: "defensive" });
  const aggressive = Core.applyStandardPolicy({ rampProfile: "aggressive" });
  assert.ok(aggressive.twoStageBootstrapMinPlaybackMs < defensive.twoStageBootstrapMinPlaybackMs);
  assert.ok(aggressive.twoStageBootstrapStableMs < defensive.twoStageBootstrapStableMs);
  assert.ok(aggressive.twoStageBootstrapBufferSeconds < defensive.twoStageBootstrapBufferSeconds);
  assert.ok(aggressive.twoStagePreferredRangeWarmupMs < defensive.twoStagePreferredRangeWarmupMs);
  assert.ok(aggressive.twoStageRecoveryStableMs < defensive.twoStageRecoveryStableMs);
  assert.equal(aggressive.twoStagePreferredTransitionGraceMs, defensive.twoStagePreferredTransitionGraceMs);
  assert.equal(aggressive.twoStagePreferredEmergencyBufferSeconds, defensive.twoStagePreferredEmergencyBufferSeconds);
  assert.equal(aggressive.twoStagePreferredEmergencyDwellMs, defensive.twoStagePreferredEmergencyDwellMs);
  assert.equal(aggressive.twoStagePreferredTransitionDeliverySilenceMs, defensive.twoStagePreferredTransitionDeliverySilenceMs);
  assert.equal(aggressive.twoStagePreferredRetryBackoffMs, defensive.twoStagePreferredRetryBackoffMs);
});

test("aggressive ramp can open the soft 1080-1440 range earlier than defensive", () => {
  const input = {
    nowMs: 16000,
    currentHeight: 720,
    mode: "bootstrap",
    effectiveBuffer: 13,
    bufferTrend: 0.2,
    capacityTrend: 0.2,
    playbackAgeMs: 16000,
    playing: true,
    isLive: false,
    isAd: false,
    availableHeights: [720, 1080, 1440],
    stableSinceMs: 11000,
    lastAdjustmentMs: 0
  };
  const defensive = Core.twoStageQualityDecision(input, Core.applyStandardPolicy({ rampProfile: "defensive" }));
  const aggressive = Core.twoStageQualityDecision(input, Core.applyStandardPolicy({ rampProfile: "aggressive" }));
  assert.equal(defensive.action, "hold");
  assert.equal(aggressive.action, "open-preferred-range");
  assert.equal(aggressive.rangeMinHeight, 1080);
  assert.equal(aggressive.rangeMaxHeight, 1440);
});

test("standard-policy validation accepts normalized aggressive settings and rejects stale tuning", () => {
  const normalized = Core.applyStandardPolicy({ enabled: true, rampProfile: "aggressive" });
  assert.equal(Core.settingsUseStandardPolicy(normalized), true);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "skipShorts"), false);
  const migrated = Core.applyStandardPolicy({ enabled: true, skipShorts: false, rampProfile: "defensive" });
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "skipShorts"), false);
  assert.equal(Core.settingsUseStandardPolicy({ ...normalized, twoStageBootstrapMinPlaybackMs: 99999 }), false);
});

test("Shorts are always outside the intervention surface without a user setting", () => {
  const settings = Core.applyStandardPolicy({ enabled: true, rampProfile: "defensive" });
  assert.equal(Core.derivePlaybackState({ enabled: true, isShorts: true }, settings), "shorts");
  assert.equal(Core.shouldSendKeepalive({ enabled: true, playing: true, protectionArmed: true, online: true, isShorts: true, hasCdnOrigin: true, mediaAgeMs: 99999, keepaliveAgeMs: 99999 }, settings), false);
  assert.equal(Core.decidePausedPrime({ enabled: true, paused: true, mediaBufferAhead: 0, isShorts: true, visible: true }, settings), false);
});
