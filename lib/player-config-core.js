/* YouTube Buffer Guardian - pure native player read-ahead policy. MIT. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YTBufferPlayerConfigCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_POLICY = Object.freeze({
    enabled: true,
    minReadAheadMediaTimeMs: 15000,
    maxReadAheadMediaTimeMs: 160000,
    readAheadGrowthRateMs: 300
  });

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object";
  }

  function isLivePlayerResponse(response) {
    if (!isObject(response)) return false;
    if (response.videoDetails?.isLiveContent === true) return true;
    if (response.playabilityStatus?.liveStreamability) return true;
    if (response.streamingData?.hlsManifestUrl) return true;
    return false;
  }

  function normalizePolicy(input) {
    const value = { ...DEFAULT_POLICY, ...(input || {}) };
    const min = Math.max(5000, finite(value.minReadAheadMediaTimeMs, DEFAULT_POLICY.minReadAheadMediaTimeMs));
    const max = Math.max(min, finite(value.maxReadAheadMediaTimeMs, DEFAULT_POLICY.maxReadAheadMediaTimeMs));
    const growth = Math.max(100, finite(value.readAheadGrowthRateMs, DEFAULT_POLICY.readAheadGrowthRateMs));
    return { enabled: value.enabled !== false, minReadAheadMediaTimeMs: min, maxReadAheadMediaTimeMs: max, readAheadGrowthRateMs: growth };
  }

  function patchDynamicConfig(dynamicConfig, policyInput) {
    if (!isObject(dynamicConfig)) return { changed: false, before: null, after: null };
    const policy = normalizePolicy(policyInput);
    const before = {
      minReadAheadMediaTimeMs: finite(dynamicConfig.minReadAheadMediaTimeMs, 0),
      maxReadAheadMediaTimeMs: finite(dynamicConfig.maxReadAheadMediaTimeMs, 0),
      readAheadGrowthRateMs: finite(dynamicConfig.readAheadGrowthRateMs, 0)
    };
    const after = {
      minReadAheadMediaTimeMs: Math.max(before.minReadAheadMediaTimeMs, policy.minReadAheadMediaTimeMs),
      maxReadAheadMediaTimeMs: Math.max(before.maxReadAheadMediaTimeMs, policy.maxReadAheadMediaTimeMs),
      readAheadGrowthRateMs: Math.max(before.readAheadGrowthRateMs, policy.readAheadGrowthRateMs)
    };
    if (after.maxReadAheadMediaTimeMs < after.minReadAheadMediaTimeMs) after.maxReadAheadMediaTimeMs = after.minReadAheadMediaTimeMs;
    const changed = before.minReadAheadMediaTimeMs !== after.minReadAheadMediaTimeMs
      || before.maxReadAheadMediaTimeMs !== after.maxReadAheadMediaTimeMs
      || before.readAheadGrowthRateMs !== after.readAheadGrowthRateMs;
    if (changed) {
      dynamicConfig.minReadAheadMediaTimeMs = after.minReadAheadMediaTimeMs;
      dynamicConfig.maxReadAheadMediaTimeMs = after.maxReadAheadMediaTimeMs;
      dynamicConfig.readAheadGrowthRateMs = after.readAheadGrowthRateMs;
    }
    return { changed, before, after };
  }

  function ensureMediaCommonConfig(playerConfig) {
    if (!isObject(playerConfig)) return null;
    if (!isObject(playerConfig.mediaCommonConfig)) playerConfig.mediaCommonConfig = {};
    if (!isObject(playerConfig.mediaCommonConfig.dynamicReadaheadConfig)) {
      playerConfig.mediaCommonConfig.dynamicReadaheadConfig = {};
    }
    return playerConfig.mediaCommonConfig.dynamicReadaheadConfig;
  }

  function patchPlayerResponse(response, policyInput) {
    const policy = normalizePolicy(policyInput);
    if (!policy.enabled) return { ok: true, changed: false, reason: "disabled", patched: 0, response };
    if (!isObject(response)) return { ok: false, changed: false, reason: "invalid-response", patched: 0, response };
    if (isLivePlayerResponse(response)) return { ok: true, changed: false, reason: "live", patched: 0, response };

    try {
      if (!isObject(response.playerConfig)) response.playerConfig = {};
      const configs = [];
      const primary = ensureMediaCommonConfig(response.playerConfig);
      if (primary) configs.push({ path: "playerConfig.mediaCommonConfig.dynamicReadaheadConfig", value: primary });

      // Some current YouTube clients expose a second mediaCommonConfig under webPlayerConfig.
      const webPlayer = response.playerConfig?.webPlayerConfig;
      if (isObject(webPlayer?.mediaCommonConfig?.dynamicReadaheadConfig)) {
        configs.push({ path: "playerConfig.webPlayerConfig.mediaCommonConfig.dynamicReadaheadConfig", value: webPlayer.mediaCommonConfig.dynamicReadaheadConfig });
      }

      const results = configs.map((entry) => ({ path: entry.path, ...patchDynamicConfig(entry.value, policy) }));
      return {
        ok: true,
        changed: results.some((x) => x.changed),
        reason: results.some((x) => x.changed) ? "patched" : "already-sufficient",
        patched: results.filter((x) => x.changed).length,
        results,
        response
      };
    } catch (error) {
      return { ok: false, changed: false, reason: "patch-failed", error: String(error), patched: 0, response };
    }
  }

  function codecFamily(mimeType) {
    const text = String(mimeType || "").toLowerCase();
    if (text.includes("av01")) return "av1";
    if (text.includes("vp09") || text.includes("vp9")) return "vp9";
    if (text.includes("avc1") || text.includes("h264")) return "h264";
    return "other";
  }

  function extractVideoBitrateProfile(response) {
    const formats = Array.isArray(response?.streamingData?.adaptiveFormats)
      ? response.streamingData.adaptiveFormats
      : [];
    const byItag = {};
    const byHeight = {};
    for (const fmt of formats) {
      const mimeType = String(fmt?.mimeType || "");
      const height = Math.max(0, finite(fmt?.height, 0));
      const bitrate = Math.max(0, finite(fmt?.bitrate ?? fmt?.averageBitrate, 0));
      const itag = fmt?.itag == null ? null : String(fmt.itag);
      if (!itag || height <= 0 || bitrate <= 0 || !mimeType.toLowerCase().startsWith("video/")) continue;
      const entry = {
        itag,
        height,
        bitrate,
        fps: Math.max(0, finite(fmt?.fps, 0)),
        mimeType,
        codecFamily: codecFamily(mimeType)
      };
      byItag[itag] = entry;
      (byHeight[height] ||= []).push(entry);
    }
    for (const entries of Object.values(byHeight)) entries.sort((a, b) => a.bitrate - b.bitrate);
    return { byItag, byHeight };
  }

  function estimateTargetBitrate(profile, currentItag, targetHeight) {
    const current = profile?.byItag?.[String(currentItag ?? "")] || null;
    const candidates = Array.isArray(profile?.byHeight?.[Number(targetHeight)])
      ? [...profile.byHeight[Number(targetHeight)]]
      : [];
    if (!candidates.length) return { currentBitrate: current?.bitrate || 0, targetBitrate: 0, currentFormat: current, targetFormat: null };
    let pool = candidates;
    if (current?.codecFamily && current.codecFamily !== "other") {
      const sameCodec = candidates.filter((x) => x.codecFamily === current.codecFamily);
      if (sameCodec.length) pool = sameCodec;
    }
    if (current?.fps > 0) {
      pool.sort((a, b) => Math.abs(a.fps - current.fps) - Math.abs(b.fps - current.fps) || a.bitrate - b.bitrate);
    }
    const target = pool[0] || candidates[0];
    return { currentBitrate: current?.bitrate || 0, targetBitrate: target?.bitrate || 0, currentFormat: current, targetFormat: target || null };
  }

  return {
    DEFAULT_POLICY,
    normalizePolicy,
    isLivePlayerResponse,
    patchDynamicConfig,
    patchPlayerResponse,
    codecFamily,
    extractVideoBitrateProfile,
    estimateTargetBitrate
  };
});
