(() => {
  "use strict";

  const STATUS_EVENT = "ytbg-quality-status-v17";
  const PROBE_EVENT = "ytbg-quality-probe-v17";
  const APPLY_EVENT = "ytbg-quality-apply-v17";
  const NETWORK_HINT_EVENT = "ytbg-network-hint-v17";
  const DEMAND_SETTINGS_EVENT = "ytbg-demand-settings-v17";
  const DEMAND_STATUS_EVENT = "ytbg-demand-status-v17";
  const READAHEAD_STATUS_EVENT = "ytbg-readahead-status-v17";
  const PlayerConfigCore = globalThis.YTBufferPlayerConfigCore;
  const READAHEAD_POLICY = Object.freeze({ enabled: true, minReadAheadMediaTimeMs: 15000, maxReadAheadMediaTimeMs: 160000, readAheadGrowthRateMs: 300 });
  let observedPlayer = null;
  let qualityListener = null;
  let requestedHeight = 0;
  let requestedLevel = null;
  let requestedRange = null;
  let bitrateProfile = { byItag: {}, byHeight: {} };

  const HEIGHTS = {
    highres: 4320,
    hd4320: 4320,
    hd2880: 2880,
    hd2160: 2160,
    hd1800: 1800,
    hd1440: 1440,
    hd1080: 1080,
    hd900: 900,
    hd720: 720,
    hd576: 576,
    hd540: 540,
    hd480: 480,
    large: 480,
    hd432: 432,
    medium: 360,
    small: 240,
    tiny: 144,
    auto: 0
  };

  function player() { return document.querySelector("#movie_player"); }
  function safeCall(obj, name, fallback) {
    try {
      const fn = obj?.[name];
      return typeof fn === "function" ? fn.call(obj) : fallback;
    } catch (_) { return fallback; }
  }

  // v0.17 invariant: native YouTube owns fetch/XHR/SABR. Quality is a separate,
  // deliberately slow two-stage control plane: exact 1440p preferred, exact 1080p
  // temporary fallback. A soft [1080p,1440p] range is used to warm native ABR before
  // an exact 1440p trial. Quality changes happen only on explicit state transitions.
  let demandSettings = { enabled: false, mode: "off", armed: false };

  function emitDemand(detail) {
    try {
      document.dispatchEvent(new CustomEvent(DEMAND_STATUS_EVENT, { detail: JSON.stringify({ at: Date.now(), ...detail }) }));
    } catch (_) {}
  }

  function encodeDetail(value) {
    try { return JSON.stringify(value ?? null); } catch (_) { return "null"; }
  }

  function decodeDetail(detail) {
    // Firefox content/page worlds exchange strings only; no live extension objects.
    if (typeof detail !== "string") return null;
    try { return JSON.parse(detail); } catch (_) { return null; }
  }

  document.addEventListener(DEMAND_SETTINGS_EVENT, (event) => {
    const requested = decodeDetail(event.detail);
    if (!requested) return;
    demandSettings = { enabled: false, mode: "off", armed: requested.armed === true };
    emitDemand({
      type: "settings",
      settings: demandSettings,
      requested: { enabled: requested.enabled !== false, mode: requested.mode || "off" },
      safeMode: "native-network"
    });
  });

  function emitReadahead(detail) {
    try {
      document.dispatchEvent(new CustomEvent(READAHEAD_STATUS_EVENT, { detail: encodeDetail({ at: Date.now(), ...detail }) }));
    } catch (_) {}
  }

  function patchPlayerResponse(value, reason = "unknown") {
    if (!PlayerConfigCore || !value || typeof value !== "object") return value;
    const result = PlayerConfigCore.patchPlayerResponse(value, READAHEAD_POLICY);
    try {
      const profile = PlayerConfigCore.extractVideoBitrateProfile?.(value);
      if (profile && Object.keys(profile.byItag || {}).length) bitrateProfile = profile;
    } catch (_) {}
    emitReadahead({ type: "player-readahead", reason, ok: result.ok, changed: result.changed, outcome: result.reason, patched: result.patched || 0, bitrateFormats: Object.keys(bitrateProfile.byItag || {}).length });
    return value;
  }

  function installInitialPlayerResponseHook(reason = "bootstrap") {
    if (!PlayerConfigCore) return false;
    const key = "ytInitialPlayerResponse";
    try {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      if (descriptor && !descriptor.configurable) {
        if ("value" in descriptor) patchPlayerResponse(descriptor.value, `${reason}:nonconfigurable`);
        else patchPlayerResponse(globalThis[key], `${reason}:nonconfigurable-accessor`);
        return false;
      }
      if (descriptor && (descriptor.get || descriptor.set)) {
        patchPlayerResponse(globalThis[key], `${reason}:existing-accessor`);
        return false;
      }
      let stored = descriptor ? descriptor.value : globalThis[key];
      if (stored !== undefined) stored = patchPlayerResponse(stored, `${reason}:existing`);
      Object.defineProperty(globalThis, key, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return stored; },
        set(value) { stored = patchPlayerResponse(value, "assignment"); }
      });
      emitReadahead({ type: "player-readahead-hook", reason, ok: true, hooked: true });
      return true;
    } catch (error) {
      emitReadahead({ type: "player-readahead-hook", reason, ok: false, hooked: false, error: String(error) });
      try { patchPlayerResponse(globalThis.ytInitialPlayerResponse, `${reason}:fallback`); } catch (_) {}
      return false;
    }
  }

  function refreshPlayerResponsePolicy(reason) {
    try { patchPlayerResponse(globalThis.ytInitialPlayerResponse, reason); } catch (_) {}
  }

  const seenNetworkHints = new Set();

  function playerSession(p = player()) {
    const stats = safeCall(p, "getVideoStats", {}) || {};
    const data = safeCall(p, "getVideoData", {}) || {};
    let videoId = data.video_id || data.videoId || null;
    if (!videoId) {
      try {
        const u = new URL(location.href);
        videoId = u.pathname === "/watch" ? u.searchParams.get("v") : (u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : null);
      } catch (_) {}
    }
    return {
      cpn: stats.cpn || stats.clientPlaybackNonce || null,
      videoId,
      fmt: stats.fmt || null,
      afmt: stats.afmt || null
    };
  }

  function isGoogleVideoUrl(raw) {
    try {
      const u = new URL(raw);
      return u.hostname === "googlevideo.com" || u.hostname.endsWith(".googlevideo.com");
    } catch (_) { return false; }
  }

  function emitNetworkHint(raw, source = "performance") {
    if (!raw || !isGoogleVideoUrl(raw)) return;
    const key = `${source}:${raw}`;
    if (seenNetworkHints.has(key)) return;
    seenNetworkHints.add(key);
    if (seenNetworkHints.size > 200) seenNetworkHints.delete(seenNetworkHints.values().next().value);
    document.dispatchEvent(new CustomEvent(NETWORK_HINT_EVENT, {
      detail: encodeDetail({ url: raw, source, at: Date.now(), session: playerSession() })
    }));
  }

  function installNetworkBootstrap() {
    try {
      for (const entry of performance.getEntriesByType("resource")) emitNetworkHint(entry.name, "performance-scan");
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) emitNetworkHint(entry.name, "performance-observer");
      });
      observer.observe({ type: "resource", buffered: true });
    } catch (_) {
      // Secondary bootstrap only; background webRequest remains authoritative.
    }
  }
  function emit(detail) {
    document.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: encodeDetail(detail) }));
  }

  function levelHeight(level) { return HEIGHTS[level] || 0; }
  function snapshotQuality(reason = "probe", requestId = null, probe = true) {
    const p = player();
    ensureQualityObserver();
    if (!p) {
      emit({ ok: false, requestId, transient: true, error: "player-unavailable", reason });
      return;
    }
    const current = safeCall(p, "getPlaybackQuality", "unknown");
    const available = safeCall(p, "getAvailableQualityLevels", []);
    const session = playerSession(p);
    const preferredEstimate = PlayerConfigCore?.estimateTargetBitrate
      ? PlayerConfigCore.estimateTargetBitrate(bitrateProfile, session.fmt, 1440)
      : { currentBitrate: 0, targetBitrate: 0 };
    emit({
      ok: true,
      requestId,
      probe,
      reason,
      current,
      currentHeight: levelHeight(current),
      selected: current,
      selectedHeight: levelHeight(current),
      requested: requestedLevel,
      requestedHeight,
      requestedRange,
      available,
      availableHeights: Array.isArray(available)
        ? [...new Set(available.map(levelHeight).filter((h) => h > 0))].sort((a, b) => a - b)
        : [],
      currentBitrate: Number(preferredEstimate.currentBitrate || 0),
      preferredBitrate: Number(preferredEstimate.targetBitrate || 0),
      session
    });
  }

  function availableLevels(p) {
    const levels = safeCall(p, "getAvailableQualityLevels", []);
    return Array.isArray(levels) ? levels.filter((level) => levelHeight(level) > 0) : [];
  }

  function chooseLevelForHeight(p, targetHeight) {
    const target = Number(targetHeight) || 0;
    const levels = availableLevels(p);
    if (!levels.length || target <= 0) return null;
    const exact = levels.find((level) => levelHeight(level) === target);
    if (exact) return exact;
    const lower = levels.filter((level) => levelHeight(level) <= target)
      .sort((a, b) => levelHeight(b) - levelHeight(a));
    return lower[0] || levels.slice().sort((a, b) => levelHeight(b) - levelHeight(a))[0] || null;
  }

  function applyQualityRequest(detail) {
    const p = player();
    const requestId = detail?.requestId || null;
    const targetHeight = Number(detail?.targetHeight) || 0;
    const rangeMinHeight = Number(detail?.rangeMinHeight) || 0;
    const rangeMaxHeight = Number(detail?.rangeMaxHeight) || 0;
    if (!p) {
      emit({ ok: false, requestId, transient: true, error: "player-unavailable", reason: detail?.reason || "apply" });
      return;
    }

    // Soft upgrade range: preserve the currently healthy lower representation while
    // allowing native YouTube ABR to select 1440p when its representation path is ready.
    if (rangeMinHeight > 0 && rangeMaxHeight >= rangeMinHeight && typeof p.setPlaybackQualityRange === "function") {
      const minLevel = chooseLevelForHeight(p, rangeMinHeight);
      const maxLevel = chooseLevelForHeight(p, rangeMaxHeight);
      if (!minLevel || !maxLevel) {
        emit({ ok: false, requestId, transient: true, error: "quality-range-unavailable", requestedHeight: targetHeight, reason: detail?.reason || "apply" });
        return;
      }
      const key = `${minLevel}:${maxLevel}`;
      try {
        if (requestedRange !== key) p.setPlaybackQualityRange(minLevel, maxLevel);
        requestedRange = key;
        requestedLevel = maxLevel;
        requestedHeight = levelHeight(maxLevel);
        queueMicrotask(() => snapshotQuality(`${detail?.reason || "apply"}:range`, requestId, false));
      } catch (error) {
        emit({ ok: false, requestId, transient: true, error: String(error), requestedHeight: targetHeight, reason: detail?.reason || "apply" });
      }
      return;
    }

    const level = chooseLevelForHeight(p, targetHeight);
    if (!level) {
      emit({ ok: false, requestId, transient: true, error: "quality-unavailable", requestedHeight: targetHeight, reason: detail?.reason || "apply" });
      return;
    }
    try {
      const currentLevel = safeCall(p, "getPlaybackQuality", "unknown");
      const exactKey = `${level}:${level}`;
      if (currentLevel === level && requestedRange === exactKey) {
        requestedLevel = level;
        requestedHeight = levelHeight(level);
        queueMicrotask(() => snapshotQuality(`${detail?.reason || "apply"}:already-target`, requestId, false));
        return;
      }
      // One range call per explicit phase transition. If the player is already on the
      // desired representation but the previous policy was a broad range, we still close
      // the range to [target,target] without calling the legacy direct setter.
      if (typeof p.setPlaybackQualityRange === "function") p.setPlaybackQualityRange(level, level);
      else if (currentLevel !== level && typeof p.setPlaybackQuality === "function") p.setPlaybackQuality(level);
      requestedRange = exactKey;
      requestedLevel = level;
      requestedHeight = levelHeight(level);
      queueMicrotask(() => snapshotQuality(detail?.reason || "apply", requestId, false));
    } catch (error) {
      emit({ ok: false, requestId, transient: true, error: String(error), requestedHeight: targetHeight, reason: detail?.reason || "apply" });
    }
  }

  function ensureQualityObserver() {
    const p = player();
    if (!p || p === observedPlayer) return;
    if (observedPlayer && qualityListener && typeof observedPlayer.removeEventListener === "function") {
      try { observedPlayer.removeEventListener("onPlaybackQualityChange", qualityListener); } catch (_) {}
    }
    observedPlayer = p;
    qualityListener = () => queueMicrotask(() => snapshotQuality("player-quality-change"));
    if (typeof p.addEventListener === "function") {
      try { p.addEventListener("onPlaybackQualityChange", qualityListener); } catch (_) {}
    }
  }

  document.addEventListener(PROBE_EVENT, (event) => {
    const detail = decodeDetail(event.detail);
    if (!detail) return;
    ensureQualityObserver();
    snapshotQuality(detail.reason || "probe", detail.requestId || null);
  });
  document.addEventListener(APPLY_EVENT, (event) => {
    const detail = decodeDetail(event.detail);
    if (!detail) return;
    ensureQualityObserver();
    applyQualityRequest(detail);
  });
  document.addEventListener("yt-navigate-finish", () => {
    observedPlayer = null;
    installInitialPlayerResponseHook("navigate-finish");
    refreshPlayerResponsePolicy("navigate-finish");
    ensureQualityObserver();
    queueMicrotask(() => snapshotQuality("navigate"));
  }, true);
  document.addEventListener("yt-page-data-updated", () => refreshPlayerResponsePolicy("page-data-updated"), true);
  installInitialPlayerResponseHook("document-start");
  installNetworkBootstrap();
  ensureQualityObserver();
})();
