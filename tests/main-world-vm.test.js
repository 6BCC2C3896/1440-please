"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((x) => x !== fn));
  }
  dispatchEvent(event) {
    for (const fn of this.listeners.get(event.type) || []) fn.call(this, event);
    return true;
  }
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

function createHarness() {
  const document = new FakeEventTarget();
  document.visibilityState = "visible";
  document.hidden = false;
  let quality = "hd1440";
  const rangeCalls = [];
  let directCalls = 0;
  const available = ["hd1440", "hd1080", "hd720"];
  const player = {
    getPlaybackQuality: () => quality,
    getAvailableQualityLevels: () => available.slice(),
    setPlaybackQualityRange(minLevel, maxLevel = minLevel) {
      rangeCalls.push([minLevel, maxLevel]);
      const h = { hd1440: 1440, hd1080: 1080, hd720: 720 };
      if ((h[quality] || 0) < (h[minLevel] || 0) || (h[quality] || 0) > (h[maxLevel] || 99999)) quality = minLevel;
    },
    setPlaybackQuality(level) { directCalls += 1; quality = level; },
    getVideoStats: () => ({ cpn: "vm-cpn", fmt: "271", afmt: "251" }),
    getVideoData: () => ({ video_id: "vm-video" }),
    addEventListener() {},
    removeEventListener() {}
  };
  document.querySelector = (selector) => selector === "#movie_player" ? player : null;

  function nativeFetch() {}
  class XMLHttpRequest {}
  XMLHttpRequest.prototype.send = function nativeSend() {};
  const nativeSend = XMLHttpRequest.prototype.send;

  const context = {
    console,
    document,
    location: { href: "https://www.youtube.com/watch?v=vm", pathname: "/watch" },
    URL,
    CustomEvent: FakeCustomEvent,
    performance: { getEntriesByType: () => [] },
    PerformanceObserver: class { observe() {} },
    queueMicrotask,
    fetch: nativeFetch,
    XMLHttpRequest,
    Image: class {},
    Map,
    Set,
    Date,
    JSON,
    Math,
    globalThis: null
  };
  context.globalThis = context;
  return { context, document, player, nativeFetch, nativeSend, getQuality: () => quality, getRangeCalls: () => rangeCalls.slice(), getDirectCalls: () => directCalls };
}

test("MAIN-world bridge applies an exact two-stage quality lock without touching network APIs", async () => {
  const h = createHarness();
  const configSource = fs.readFileSync(path.join(__dirname, "../lib/player-config-core.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../content/content-main.js"), "utf8");
  vm.runInNewContext(configSource, h.context, { filename: "player-config-core.js" });
  const statuses = [];
  h.document.addEventListener("ytbg-quality-status-v17", (event) => statuses.push(JSON.parse(event.detail)));
  vm.runInNewContext(source, h.context, { filename: "content-main.js" });

  h.document.dispatchEvent(new FakeCustomEvent("ytbg-quality-probe-v17", {
    detail: JSON.stringify({ requestId: "probe", reason: "vm" })
  }));
  h.document.dispatchEvent(new FakeCustomEvent("ytbg-quality-apply-v17", {
    detail: JSON.stringify({ requestId: "apply", enabled: true, targetHeight: 1080, reason: "fallback" })
  }));
  await new Promise((resolve) => queueMicrotask(resolve));

  assert.equal(h.context.fetch, h.nativeFetch);
  assert.equal(h.context.XMLHttpRequest.prototype.send, h.nativeSend);
  assert.equal(h.getQuality(), "hd1080");
  assert.ok(statuses.some((s) => s.requestId === "probe" && s.ok === true && s.currentHeight === 1440));
  assert.ok(statuses.some((s) => s.requestId === "apply" && s.probe === false && s.requestedHeight === 1080));
});


test("MAIN-world bridge treats an exact same-quality request as a strict no-op", async () => {
  const h = createHarness();
  const configSource = fs.readFileSync(path.join(__dirname, "../lib/player-config-core.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../content/content-main.js"), "utf8");
  vm.runInNewContext(configSource, h.context, { filename: "player-config-core.js" });
  const statuses = [];
  h.document.addEventListener("ytbg-quality-status-v17", (event) => statuses.push(JSON.parse(event.detail)));
  vm.runInNewContext(source, h.context, { filename: "content-main.js" });
  h.document.dispatchEvent(new FakeCustomEvent("ytbg-quality-apply-v17", {
    detail: JSON.stringify({ requestId: "same-1440", enabled: true, targetHeight: 1440, reason: "cruise-repair" })
  }));
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(h.getQuality(), "hd1440");
  assert.deepEqual(h.getRangeCalls(), [["hd1440", "hd1440"]]);
  assert.equal(h.getDirectCalls(), 0);
  assert.ok(statuses.some((s) => s.requestId === "same-1440" && s.ok === true));
});

test("MAIN-world bridge makes a repeated exact lock a no-op after the range is already exact", async () => {
  const h = createHarness();
  const configSource = fs.readFileSync(path.join(__dirname, "../lib/player-config-core.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../content/content-main.js"), "utf8");
  vm.runInNewContext(configSource, h.context, { filename: "player-config-core.js" });
  vm.runInNewContext(source, h.context, { filename: "content-main.js" });
  const detail = JSON.stringify({ requestId: "lock", enabled: true, targetHeight: 1440, reason: "lock" });
  h.document.dispatchEvent(new FakeCustomEvent("ytbg-quality-apply-v17", { detail }));
  h.document.dispatchEvent(new FakeCustomEvent("ytbg-quality-apply-v17", { detail }));
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.deepEqual(h.getRangeCalls(), [["hd1440", "hd1440"]]);
});

test("MAIN-world bridge opens a soft 1080p-1440p range without forcing an immediate upshift", async () => {
  const h = createHarness();
  const configSource = fs.readFileSync(path.join(__dirname, "../lib/player-config-core.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../content/content-main.js"), "utf8");
  vm.runInNewContext(configSource, h.context, { filename: "player-config-core.js" });
  vm.runInNewContext(source, h.context, { filename: "content-main.js" });
  // First lock 1080 to model the bootstrap/fallback state.
  h.document.dispatchEvent(new FakeCustomEvent("ytbg-quality-apply-v17", {
    detail: JSON.stringify({ requestId: "fallback", enabled: true, targetHeight: 1080, reason: "fallback" })
  }));
  // Then widen to 1080..1440. The fake native ABR intentionally remains at 1080.
  h.document.dispatchEvent(new FakeCustomEvent("ytbg-quality-apply-v17", {
    detail: JSON.stringify({ requestId: "range", enabled: true, targetHeight: 1440, rangeMinHeight: 1080, rangeMaxHeight: 1440, reason: "warm" })
  }));
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(h.getQuality(), "hd1080");
  assert.deepEqual(h.getRangeCalls(), [["hd1080", "hd1080"], ["hd1080", "hd1440"]]);
  assert.equal(h.getDirectCalls(), 0);
});

test("MAIN-world bridge never enables legacy demand mutation even when requested", () => {
  const h = createHarness();
  const configSource = fs.readFileSync(path.join(__dirname, "../lib/player-config-core.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../content/content-main.js"), "utf8");
  vm.runInNewContext(configSource, h.context, { filename: "player-config-core.js" });
  const statuses = [];
  h.document.addEventListener("ytbg-demand-status-v17", (event) => statuses.push(JSON.parse(event.detail)));
  vm.runInNewContext(source, h.context, { filename: "content-main.js" });
  h.document.dispatchEvent(new FakeCustomEvent("ytbg-demand-settings-v17", {
    detail: JSON.stringify({ enabled: true, mode: "hybrid", armed: true })
  }));
  const status = statuses.at(-1);
  assert.equal(status.safeMode, "native-network");
  assert.equal(status.settings.enabled, false);
  assert.equal(status.settings.mode, "off");
  assert.equal(h.context.fetch, h.nativeFetch);
  assert.equal(h.context.XMLHttpRequest.prototype.send, h.nativeSend);
});


test("MAIN-world document-start hook raises native read-ahead while preserving fetch/XHR identity", () => {
  const h = createHarness();
  const configSource = fs.readFileSync(path.join(__dirname, "../lib/player-config-core.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../content/content-main.js"), "utf8");
  const statuses = [];
  h.document.addEventListener("ytbg-readahead-status-v17", (event) => statuses.push(JSON.parse(event.detail)));
  vm.runInNewContext(configSource, h.context, { filename: "player-config-core.js" });
  vm.runInNewContext(source, h.context, { filename: "content-main.js" });
  h.context.ytInitialPlayerResponse = {
    videoDetails: { isLiveContent: false },
    playerConfig: { mediaCommonConfig: { dynamicReadaheadConfig: {
      minReadAheadMediaTimeMs: 15000, maxReadAheadMediaTimeMs: 35000, readAheadGrowthRateMs: 300
    } } }
  };
  const cfg = h.context.ytInitialPlayerResponse.playerConfig.mediaCommonConfig.dynamicReadaheadConfig;
  assert.equal(cfg.minReadAheadMediaTimeMs, 15000);
  assert.equal(cfg.maxReadAheadMediaTimeMs, 160000);
  assert.equal(cfg.readAheadGrowthRateMs, 300);
  assert.equal(h.context.fetch, h.nativeFetch);
  assert.equal(h.context.XMLHttpRequest.prototype.send, h.nativeSend);
  assert.ok(statuses.some((x) => x.type === "player-readahead" && x.changed === true));
});


test("page-style var declaration is intercepted at document-start and receives read-ahead policy", () => {
  const h = createHarness();
  const configSource = fs.readFileSync(path.join(__dirname, "../lib/player-config-core.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../content/content-main.js"), "utf8");
  vm.runInNewContext(configSource, h.context, { filename: "player-config-core.js" });
  vm.runInNewContext(source, h.context, { filename: "content-main.js" });
  vm.runInNewContext(`var ytInitialPlayerResponse = {
    videoDetails: { isLiveContent: false },
    playerConfig: { mediaCommonConfig: { dynamicReadaheadConfig: {
      minReadAheadMediaTimeMs: 15000, maxReadAheadMediaTimeMs: 35000, readAheadGrowthRateMs: 300
    } } }
  };`, h.context);
  const cfg = h.context.ytInitialPlayerResponse.playerConfig.mediaCommonConfig.dynamicReadaheadConfig;
  assert.equal(cfg.minReadAheadMediaTimeMs, 15000);
  assert.equal(cfg.maxReadAheadMediaTimeMs, 160000);
});
