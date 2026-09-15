"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/core.js");
const Scheduler = require("../lib/scheduler-core.js");

function session(overrides = {}) {
  return {
    tabId: 7,
    generation: 3,
    url: "https://www.youtube.com/watch?v=test",
    playback: {
      playing: true,
      paused: false,
      ended: false,
      isLive: false,
      isAd: false,
      isShorts: false,
      effectiveBufferAhead: 45,
      protectionArmed: true,
      protectionArmedEpochMs: 1000,
      ...(overrides.playback || {})
    },
    lifecycle: {
      pageState: "active",
      visibility: "visible",
      online: true,
      ...(overrides.lifecycle || {})
    },
    network: {
      cdnOrigin: "https://rr1---sn-test.googlevideo.com",
      lastMediaEpochMs: 1000,
      lastPulseDispatchEpochMs: 1000,
      ...(overrides.network || {})
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => !["playback", "lifecycle", "network"].includes(k)))
  };
}

test("hidden/minimized page still gets a keep-warm pulse", () => {
  const s = session({ playback: { effectiveBufferAhead: 10 }, lifecycle: { visibility: "hidden", pageState: "active", online: true } });
  assert.equal(Scheduler.shouldPulseSession(s, Core.DEFAULTS, 6000), true);
});

test("unloaded page never gets an injected pulse", () => {
  const s = session({ lifecycle: { visibility: "hidden", pageState: "unloaded", online: true } });
  assert.equal(Scheduler.shouldPulseSession(s, Core.DEFAULTS, 6000), false);
});


test("bfcache page is suspended and never gets a pulse", () => {
  const s = session({ lifecycle: { visibility: "hidden", pageState: "bfcache", online: true } });
  assert.equal(Scheduler.shouldPulseSession(s, Core.DEFAULTS, 6000), false);
});

test("offline page never gets a pulse", () => {
  const s = session({ lifecycle: { visibility: "visible", pageState: "active", online: false } });
  assert.equal(Scheduler.shouldPulseSession(s, Core.DEFAULTS, 6000), false);
});

test("real media traffic suppresses keep-warm", () => {
  const s = session({ network: { lastMediaEpochMs: 5500, lastPulseDispatchEpochMs: 1000 } });
  assert.equal(Scheduler.shouldPulseSession(s, Core.DEFAULTS, 6000), false);
});


test("bootstrap session never gets keep-warm or demand-kick actions", () => {
  const s = session({
    playback: { protectionArmed: false, effectiveBufferAhead: 5, trend: -1 },
    network: { lastMediaEpochMs: 1000, lastMediaActivityEpochMs: 1000, lastMediaDeliveryEpochMs: 1000, inflightMedia: 0 }
  });
  const actions = Scheduler.planTick([s], Core.DEFAULTS, 10000);
  assert.deepEqual(actions, []);
});

test("newly armed session observes post-arm grace before interventions", () => {
  const s = session({
    playback: { protectionArmed: true, protectionArmedEpochMs: 9000, effectiveBufferAhead: 30, trend: -1 },
    network: { lastMediaEpochMs: 1000, lastMediaActivityEpochMs: 1000, lastMediaDeliveryEpochMs: 1000, inflightMedia: 0 }
  });
  const actions = Scheduler.planTick([s], Core.DEFAULTS, 10000);
  assert.deepEqual(actions, []);
});
test("paused playback suppresses keep-warm", () => {
  const s = session({ playback: { playing: false, paused: true } });
  assert.equal(Scheduler.shouldPulseSession(s, Core.DEFAULTS, 6000), false);
});

test("continuous policy ignores healthy buffer for cadence", () => {
  const s = session({ playback: { effectiveBufferAhead: 90 } });
  assert.equal(Scheduler.shouldPulseSession(s, { ...Core.DEFAULTS, networkKeepWarmMode: "continuous" }, 6000), true);
});

test("adaptive policy slows pulse while healthy", () => {
  const s = session({ playback: { effectiveBufferAhead: 90 }, network: { lastMediaEpochMs: 1000, lastPulseDispatchEpochMs: 2500 } });
  const settings = { ...Core.DEFAULTS, networkKeepWarmMode: "adaptive", keepaliveHealthyIntervalMs: 6500 };
  assert.equal(Scheduler.shouldPulseSession(s, settings, 6000), false);
  assert.equal(Scheduler.shouldPulseSession(s, settings, 9500), true);
});

test("planTick preserves generation for stale-action rejection", () => {
  const s = session({ playback: { effectiveBufferAhead: 95 }, network: { lastMediaEpochMs: 1000, lastPulseDispatchEpochMs: 1000 } });
  const actions = Scheduler.planTick([s], Core.DEFAULTS, 8000);
  assert.deepEqual(actions, [{ type: "pulse", tabId: 7, generation: 3, reason: "idle-media" }]);
});


test("v0.17 never schedules a playing-stream demand kick", () => {
  const s = session({
    playback: { effectiveBufferAhead: 5, trend: -2 },
    network: { lastMediaEpochMs: 1000, lastMediaActivityEpochMs: 1000, lastMediaDeliveryEpochMs: 1000, inflightMedia: 0 }
  });
  const actions = Scheduler.planTick([s], Core.DEFAULTS, 6000);
  assert.equal(actions.some((a) => a.type === "demand-kick"), false);
  assert.equal(Scheduler.shouldDemandKickSession(s, { ...Core.DEFAULTS, mediaDemandEnabled: true, mediaDemandMode: "hybrid" }, 6000), false);
});

test("recent real delivery suppresses media-demand kick even if request activity is otherwise idle", () => {
  const s = session({
    playback: { effectiveBufferAhead: 25, trend: -0.5 },
    network: {
      lastMediaEpochMs: 1000,
      lastMediaActivityEpochMs: 1000,
      lastMediaDeliveryEpochMs: 5500,
      lastPulseDispatchEpochMs: 5000,
      inflightMedia: 0
    }
  });
  assert.equal(Scheduler.shouldDemandKickSession(s, Core.DEFAULTS, 6000), false);
});

test("hidden active playback also cannot receive a background demand kick", () => {
  const s = session({
    playback: { effectiveBufferAhead: 20, trend: -1 },
    lifecycle: { visibility: "hidden", pageState: "active", online: true },
    network: { lastMediaEpochMs: 1000, lastMediaActivityEpochMs: 1000, lastMediaDeliveryEpochMs: 1000, inflightMedia: 0 }
  });
  assert.equal(Scheduler.shouldDemandKickSession(s, Core.DEFAULTS, 6000), false);
});


test("standard policy keeps transport observation/warmth but no media-demand kick in the 15–30 band", () => {
  const s = session({
    playback: { effectiveBufferAhead: 22, trend: -0.4 },
    network: { lastMediaEpochMs: 1000, lastMediaActivityEpochMs: 1000, lastMediaDeliveryEpochMs: 1000, lastPulseDispatchEpochMs: 1000, inflightMedia: 0 }
  });
  const actions = Scheduler.planTick([s], Core.DEFAULTS, 5000);
  assert.equal(actions.some((a) => a.type === "pulse"), true);
  assert.equal(actions.some((a) => a.type === "demand-kick"), false);
});
