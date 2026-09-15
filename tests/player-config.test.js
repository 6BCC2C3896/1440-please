"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Config = require("../lib/player-config-core.js");

test("native read-ahead policy uses a YouTube-like 15-160s dynamic readahead envelope", () => {
  const response = { videoDetails: { isLiveContent: false }, playerConfig: { mediaCommonConfig: { dynamicReadaheadConfig: {
    minReadAheadMediaTimeMs: 15000, maxReadAheadMediaTimeMs: 35000, readAheadGrowthRateMs: 300
  } } } };
  const result = Config.patchPlayerResponse(response);
  const cfg = response.playerConfig.mediaCommonConfig.dynamicReadaheadConfig;
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(cfg.minReadAheadMediaTimeMs, 15000);
  assert.equal(cfg.maxReadAheadMediaTimeMs, 160000);
  assert.equal(cfg.readAheadGrowthRateMs, 300);
});

test("read-ahead policy never reduces a stronger native config", () => {
  const response = { videoDetails: { isLiveContent: false }, playerConfig: { mediaCommonConfig: { dynamicReadaheadConfig: {
    minReadAheadMediaTimeMs: 90000, maxReadAheadMediaTimeMs: 160000, readAheadGrowthRateMs: 1500
  } } } };
  Config.patchPlayerResponse(response);
  const cfg = response.playerConfig.mediaCommonConfig.dynamicReadaheadConfig;
  assert.deepEqual(cfg, { minReadAheadMediaTimeMs: 90000, maxReadAheadMediaTimeMs: 160000, readAheadGrowthRateMs: 1500 });
});

test("read-ahead policy creates the standard dynamic config if absent", () => {
  const response = { videoDetails: { isLiveContent: false }, playerConfig: {} };
  const result = Config.patchPlayerResponse(response);
  assert.equal(result.changed, true);
  assert.equal(response.playerConfig.mediaCommonConfig.dynamicReadaheadConfig.minReadAheadMediaTimeMs, 15000);
  assert.equal(response.playerConfig.mediaCommonConfig.dynamicReadaheadConfig.maxReadAheadMediaTimeMs, 160000);
});

test("live streams are not modified", () => {
  const response = { videoDetails: { isLiveContent: true }, playerConfig: { mediaCommonConfig: { dynamicReadaheadConfig: { maxReadAheadMediaTimeMs: 15000 } } } };
  const before = JSON.stringify(response);
  const result = Config.patchPlayerResponse(response);
  assert.equal(result.reason, "live");
  assert.equal(JSON.stringify(response), before);
});

test("invalid/frozen response fails open instead of destabilizing playback", () => {
  const response = Object.freeze({ videoDetails: { isLiveContent: false } });
  const result = Config.patchPlayerResponse(response);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "patch-failed");
});


test("MAIN and isolated standardized read-ahead constants cannot drift", () => {
  const Core = require("../lib/core.js");
  assert.equal(Core.DEFAULTS.nativeReadaheadFloorSeconds * 1000, Config.DEFAULT_POLICY.minReadAheadMediaTimeMs);
  assert.equal(Core.DEFAULTS.nativeReadaheadCeilingSeconds * 1000, Config.DEFAULT_POLICY.maxReadAheadMediaTimeMs);
  assert.equal(Core.DEFAULTS.nativeReadaheadGrowthRateMs, Config.DEFAULT_POLICY.readAheadGrowthRateMs);
});

test("video bitrate profile maps itags and preserves codec/fps for capacity estimation", () => {
  const response = { streamingData: { adaptiveFormats: [
    { itag: 248, height: 1080, fps: 30, bitrate: 3_000_000, mimeType: 'video/webm; codecs="vp9"' },
    { itag: 271, height: 1440, fps: 30, bitrate: 6_000_000, mimeType: 'video/webm; codecs="vp9"' },
    { itag: 400, height: 1440, fps: 30, bitrate: 5_000_000, mimeType: 'video/mp4; codecs="av01.0.12M.08"' }
  ] } };
  const profile = Config.extractVideoBitrateProfile(response);
  assert.equal(profile.byItag['248'].height, 1080);
  assert.equal(profile.byItag['248'].codecFamily, 'vp9');
  const estimate = Config.estimateTargetBitrate(profile, 248, 1440);
  assert.equal(estimate.currentBitrate, 3_000_000);
  assert.equal(estimate.targetBitrate, 6_000_000);
  assert.equal(estimate.targetFormat.codecFamily, 'vp9');
});
