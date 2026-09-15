/* YouTube Buffer Guardian - pure background scheduler policy. MIT. */
(function (root, factory) {
  const core = root.YTBufferCore || (typeof require === "function" ? require("./core.js") : null);
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YTBufferSchedulerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  function age(nowEpochMs, stampEpochMs) {
    if (!Number.isFinite(stampEpochMs)) return Infinity;
    return Math.max(0, nowEpochMs - stampEpochMs);
  }

  function isYoutubeWatchUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname === "www.youtube.com" && (u.pathname === "/watch" || u.pathname.startsWith("/shorts/"));
    } catch (_) {
      return false;
    }
  }

  function shouldPulseSession(session, settingsInput, nowEpochMs = Date.now()) {
    const settings = Core.mergeSettings(settingsInput);
    if (!session || !isYoutubeWatchUrl(session.url)) return false;

    const playback = session.playback || {};
    const lifecycle = session.lifecycle || {};
    const network = session.network || {};
    const playing = playback.playing === true && playback.paused !== true && playback.ended !== true;
    if (playback.protectionArmed !== true) return false;
    const armedAgeMs = Number.isFinite(playback.protectionArmedEpochMs)
      ? Math.max(0, nowEpochMs - playback.protectionArmedEpochMs)
      : Infinity;
    if (armedAgeMs < settings.startupArmPostGraceMs) return false;

    return Core.shouldSendKeepalive({
      enabled: settings.enabled,
      playing,
      online: lifecycle.online !== false,
      pageState: lifecycle.pageState || "active",
      isLive: playback.isLive === true,
      isAd: playback.isAd === true,
      isShorts: playback.isShorts === true,
      hasCdnOrigin: Boolean(network.cdnOrigin),
      mediaAgeMs: age(nowEpochMs, network.lastMediaActivityEpochMs ?? network.lastMediaEpochMs),
      keepaliveAgeMs: age(nowEpochMs, network.lastPulseDispatchEpochMs),
      effectiveBuffer: Number(playback.effectiveBufferAhead) || 0,
      protectionArmed: true,
      mediaStreaming: Number(network.inflightMedia || 0) > 0
        && age(nowEpochMs, network.lastMediaActivityEpochMs ?? network.lastMediaEpochMs) <= Math.max(settings.mediaActiveWindowMs * 3, 6000)
    }, settings);
  }

  function shouldDemandKickSession(_session, _settingsInput, _nowEpochMs = Date.now()) {
    // v0.17: a playing stream is never synthetically seek-kicked. Paused prebuffering
    // is owned by the content controller and only runs after a deliberate pause.
    return false;
  }

  function planTick(sessions, settingsInput, nowEpochMs = Date.now()) {
    const actions = [];
    const iterable = Array.isArray(sessions) ? sessions : Object.values(sessions || {});
    for (const session of iterable) {
      if (!session || !Number.isInteger(session.tabId)) continue;
      if (shouldPulseSession(session, settingsInput, nowEpochMs)) {
        const effective = Number(session.playback?.effectiveBufferAhead) || 0;
        const settings = Core.mergeSettings(settingsInput);
        actions.push({
          type: "pulse",
          tabId: session.tabId,
          generation: session.generation || 0,
          reason: effective < settings.warmLowWatermarkSeconds ? "low-buffer" : "idle-media"
        });
      }
    }
    return actions;
  }

  return { age, isYoutubeWatchUrl, shouldPulseSession, shouldDemandKickSession, planTick };
});
