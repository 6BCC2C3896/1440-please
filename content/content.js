(() => {
  "use strict";

  const Core = globalThis.YTBufferCore;
  if (!Core) return;

  const VERSION = "0.17.8";
  const STORAGE_KEY = "settings";
  const PORT_NAME = "ytbg-session-v17";
  const QUALITY_STATUS_EVENT = "ytbg-quality-status-v17";
  const QUALITY_PROBE_EVENT = "ytbg-quality-probe-v17";
  const QUALITY_APPLY_EVENT = "ytbg-quality-apply-v17";
  const NETWORK_HINT_EVENT = "ytbg-network-hint-v17";
  const DEMAND_SETTINGS_EVENT = "ytbg-demand-settings-v17";
  const DEMAND_STATUS_EVENT = "ytbg-demand-status-v17";
  const READAHEAD_STATUS_EVENT = "ytbg-readahead-status-v17";
  const CHECKPOINT_PREFIX = "ytbg-resume-checkpoint-v17:";
  const SAMPLE_WINDOW_MS = 6000;
  const REPLACEMENT_WINDOW_MS = 20000;
  const MAX_LOG = 100;

  let settings = Core.applyStandardPolicy ? Core.applyStandardPolicy() : Core.mergeSettings();
  let video = null;
  let boundVideo = null;
  let playerObserver = null;
  let discoveryObserver = null;
  let pauseTimer = null;
  let reconnectTimer = null;
  let qualityTimer = null;
  let port = null;
  let reconnectAttempt = 0;
  let portConnected = false;
  let generation = 0;
  let lifecycleRevision = 0;
  let lastUrl = location.href;
  let lastReportMono = -Infinity;
  let reconcileQueued = false;
  let internalActionDepth = 0;
  let interventionPromise = null;
  let circuitUntilEpochMs = 0;
  let failedPumps = 0;
  let samples = [];
  let capacitySamples = [];
  let replacementTimesEpochMs = [];
  let eventLog = [];
  let qualityRequestSeq = 0;
  let qualityTransientRetries = 0;
  let lastQualityProbeMono = -Infinity;
  let lastPlaybackRiskEpochMs = 0;
  let lastCheckpointSaveEpochMs = 0;
  let lastFailureEpochMs = 0;
  let checkpointRestoredGeneration = -1;
  let qualityControl = {
    targetHeight: 1080,
    mode: "bootstrap",
    lowSinceMs: null,
    stableSinceMs: null,
    driftSinceMs: null,
    lastAdjustmentMs: 0,
    lastAction: "init",
    lastReason: "init",
    transitionUntilMs: 0,
    fallbackSinceMs: 0,
    preferredSinceMs: 0,
    retryBlockedUntilMs: 0,
    cruiseStableSinceMs: null,
    capacityDeficitSinceMs: null,
    capacityStableSinceMs: null
  };
  let qualityStatus = {
    requestedHeight: 0,
    selected: "unknown",
    selectedHeight: 0,
    current: "unknown",
    currentHeight: 0,
    currentBitrate: 0,
    preferredBitrate: 0,
    available: [],
    availableHeights: []
  };
  let playerSession = { cpn: null, videoId: null, fmt: null, afmt: null };
  let startup = {
    armed: false,
    hasPlayedOnce: false,
    playingSinceMono: null,
    playStartCurrentTime: 0,
    armedEpochMs: 0,
    lastReason: "init"
  };
  let lifecycle = {
    visibility: document.visibilityState,
    pageState: "active",
    online: navigator.onLine,
    focused: document.hasFocus(),
    lastEvent: "init",
    lastEventEpochMs: Date.now()
  };
  let bgStatus = {
    state: "observing",
    network: { health: "idle", mediaAgeMs: null, cdnAgeMs: null, pulseRttEwmaMs: null },
    worker: { alive: false, lastReplyAgeMs: null }
  };

  const metrics = {
    startedAt: new Date().toISOString(),
    videoChanges: 0,
    playerReplacements: 0,
    pausedPrimes: 0,
    successfulPumps: 0,
    failedPumps: 0,
    backBufferEvictions: 0,
    waitingEvents: 0,
    stalledEvents: 0,
    emptiedEvents: 0,
    videoErrors: 0,
    lifecycleTransitions: 0,
    portConnects: 0,
    portDisconnects: 0,
    qualityApplications: 0,
    qualityDownshifts: 0,
    qualityUpshifts: 0,
    qualityRollbacks: 0,
    qualityProbes: 0,
    sabrPatchesObserved: 0,
    sabrPatchFailures: 0,
    sabrPatchSkipped: 0,
    lastDemandPatchEpochMs: 0,
    lastOutcome: "idle",
    checkpointSaves: 0,
    checkpointRestores: 0,
    checkpointRestoreSkips: 0
  };

  const monoNow = () => performance.now();
  const wallNow = () => Date.now();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


  function syncDemandSettings(reason = "settings") {
    const payload = {
      // v0.17 production invariant: no page-world media-demand mutation.
      enabled: false,
      mode: "off",
      startBufferSeconds: settings.mediaDemandStartBufferSeconds,
      edgeMarginSeconds: settings.mediaDemandEdgeMarginSeconds,
      rbufZero: settings.mediaDemandRbufZero === true,
      armed: startup.armed === true,
      reason
    };
    try {
      document.dispatchEvent(new CustomEvent(DEMAND_SETTINGS_EVENT, { detail: JSON.stringify(payload) }));
    } catch (_) {}
  }

  function debug(...args) {
    if (settings.debug) console.debug("[1440, Please]", ...args);
  }

  function log(type, detail = {}) {
    const entry = { at: new Date().toISOString(), epochMs: wallNow(), type, ...detail };
    eventLog.push(entry);
    if (eventLog.length > MAX_LOG) eventLog.splice(0, eventLog.length - MAX_LOG);
    debug(type, detail);
  }

  function currentVideoId() {
    if (playerSession.videoId) return String(playerSession.videoId);
    try {
      const u = new URL(location.href);
      if (u.pathname === "/watch") return u.searchParams.get("v") || null;
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
    } catch (_) {}
    return null;
  }

  function hasExplicitStart() {
    try {
      const u = new URL(location.href);
      return ["t", "start", "time_continue"].some((key) => u.searchParams.has(key));
    } catch (_) { return false; }
  }

  function checkpointKey(videoId) { return `${CHECKPOINT_PREFIX}${videoId}`; }

  async function saveLocalCheckpoint(reason = "sample", failure = false) {
    if (!settings.localResumeEnabled || !video || isLive() || isAdPlaying()) return false;
    const videoId = currentVideoId();
    if (!videoId) return false;
    const now = wallNow();
    if (reason === "timeupdate" && now - lastCheckpointSaveEpochMs < settings.checkpointSaveIntervalMs) return false;
    const currentTime = Math.max(0, Number(video.currentTime) || 0);
    const duration = Math.max(0, Number(video.duration) || 0);
    if (currentTime < 1) return false;
    if (failure) lastFailureEpochMs = now;
    const record = {
      videoId,
      currentTime,
      duration,
      updatedAt: now,
      failureAt: lastFailureEpochMs || 0,
      reason
    };
    try {
      await browser.storage.local.set({ [checkpointKey(videoId)]: record });
      lastCheckpointSaveEpochMs = now;
      metrics.checkpointSaves += 1;
      return true;
    } catch (error) {
      log("checkpoint-save-failed", { reason, message: String(error) });
      return false;
    }
  }

  async function maybeRestoreLocalCheckpoint(reason = "load") {
    if (!settings.localResumeEnabled || !video || checkpointRestoredGeneration === generation || isLive() || isAdPlaying()) return false;
    const videoId = currentVideoId();
    if (!videoId) return false;
    try {
      const key = checkpointKey(videoId);
      const stored = await browser.storage.local.get(key);
      const record = stored?.[key];
      if (!record || String(record.videoId || "") !== videoId) return false;
      const decision = Core.shouldRestoreCheckpoint({
        nowMs: wallNow(),
        savedAtMs: Number(record.updatedAt) || 0,
        failureAtMs: Number(record.failureAt) || 0,
        savedTime: Number(record.currentTime) || 0,
        currentTime: Number(video.currentTime) || 0,
        duration: Number(video.duration) || Number(record.duration) || 0,
        hasExplicitStart: hasExplicitStart()
      }, settings);
      if (!decision.restore) {
        metrics.checkpointRestoreSkips += 1;
        return false;
      }
      checkpointRestoredGeneration = generation;
      internalActionDepth += 1;
      try { video.currentTime = Number(decision.targetTime) || 0; }
      finally { internalActionDepth = Math.max(0, internalActionDepth - 1); }
      metrics.checkpointRestores += 1;
      lastFailureEpochMs = 0;
      log("local-checkpoint-restored", { reason, videoId, targetTime: decision.targetTime, lag: decision.lag });
      emitSnapshot("checkpoint-restored", true);
      return true;
    } catch (error) {
      log("checkpoint-restore-failed", { reason, message: String(error) });
      return false;
    }
  }

  function isShortsPage() { return location.pathname.startsWith("/shorts/"); }
  function isAdPlaying() { return Boolean(document.querySelector(".html5-video-player.ad-showing, #movie_player.ad-showing")); }
  function isLive(v = video) {
    if (!v) return false;
    if (!Number.isFinite(v.duration) || v.duration === Infinity) return true;
    const player = document.querySelector(".html5-video-player, #movie_player");
    return Boolean(player && player.classList.contains("ytp-live"));
  }

  function activeVideo() {
    const preferred = document.querySelector("video.html5-main-video");
    if (preferred instanceof HTMLVideoElement) return preferred;
    const root = document.querySelector("#movie_player, ytd-player, #player");
    const nested = root?.querySelector?.("video");
    if (nested instanceof HTMLVideoElement) return nested;
    return [...document.querySelectorAll("video")].find((item) => item instanceof HTMLVideoElement) || null;
  }

  function bufferSnapshot(v = video) {
    if (!v) return {
      mediaAhead: 0, effectiveAhead: 0, contiguousStart: 0,
      contiguousEnd: 0, furthestEnd: 0, ranges: []
    };
    const ranges = Core.rangesToArray(v.buffered);
    const contiguous = Core.contiguousBuffer(ranges, v.currentTime, settings.originalRangeGuardSeconds);
    return {
      mediaAhead: contiguous.ahead,
      effectiveAhead: Core.effectiveBufferSeconds(contiguous.ahead, v.playbackRate, v.paused),
      contiguousStart: contiguous.start,
      contiguousEnd: contiguous.end,
      furthestEnd: Core.furthestBufferedEnd(ranges),
      ranges
    };
  }

  function recordSample(snap) {
    const t = monoNow();
    const point = { at: t, bufferAhead: snap.effectiveAhead };
    samples.push(point);
    capacitySamples.push(point);
    const cutoff = t - SAMPLE_WINDOW_MS;
    while (samples.length && samples[0].at < cutoff) samples.shift();
    const capacityCutoff = t - Math.max(
      Number(settings.twoStageCapacityWindowMs || 20000),
      Number(settings.zigzagWindowMs || 24000),
    );
    while (capacitySamples.length && capacitySamples[0].at < capacityCutoff) capacitySamples.shift();
  }

  function playbackPayload(snap = bufferSnapshot()) {
    const paused = Boolean(video?.paused);
    const ended = Boolean(video?.ended);
    return {
      playing: Boolean(video && !paused && !ended),
      paused,
      ended,
      currentTime: Number(video?.currentTime) || 0,
      duration: Number(video?.duration) || 0,
      playbackRate: Number(video?.playbackRate) || 1,
      bufferAhead: snap.mediaAhead,
      effectiveBufferAhead: snap.effectiveAhead,
      contiguousBufferedEnd: snap.contiguousEnd,
      furthestBufferedEnd: snap.furthestEnd,
      trend: Core.trend(samples),
      capacityTrend: Core.trend(capacitySamples),
      zigzag: Core.zigzagMetrics(capacitySamples),
      isLive: isLive(),
      isAd: isAdPlaying(),
      isShorts: isShortsPage(),
      cpn: playerSession.cpn || null,
      videoId: playerSession.videoId || null,
      quality: { ...qualityStatus, controller: { ...qualityControl } },
      protectionArmed: startup.armed === true,
      protectionArmedEpochMs: startup.armedEpochMs || 0,
      state: startup.armed ? (interventionPromise ? "priming" : (paused ? "paused" : "playing")) : "bootstrap"
    };
  }

  function snapshotPayload(reason) {
    const snap = bufferSnapshot();
    recordSample(snap);
    return {
      generation,
      url: location.href,
      reason,
      playback: playbackPayload(snap),
      lifecycle: { ...lifecycle },
      localMetrics: { ...metrics }
    };
  }

  function sendPort(message) {
    if (!port || !portConnected) return false;
    try { port.postMessage(message); return true; }
    catch (_) { return false; }
  }

  function emitSnapshot(reason = "event", force = false) {
    const t = monoNow();
    if (!force && t - lastReportMono < settings.contentReportMinMs) return;
    lastReportMono = t;
    const payload = snapshotPayload(reason);
    sendPort({ type: "CONTENT_SNAPSHOT", payload });
  }

  function sendLifecycle(eventName, pageState = lifecycle.pageState) {
    lifecycle = {
      visibility: document.visibilityState,
      pageState,
      online: navigator.onLine,
      focused: document.hasFocus(),
      lastEvent: eventName,
      lastEventEpochMs: wallNow()
    };
    metrics.lifecycleTransitions += 1;
    lifecycleRevision += 1;
    sendPort({
      type: "CONTENT_LIFECYCLE",
      payload: {
        generation,
        url: location.href,
        reason: eventName,
        playback: playbackPayload(),
        lifecycle: { ...lifecycle }
      }
    });
  }

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (portConnected || reconnectTimer) return;
    const delay = Math.min(
      settings.portReconnectMaxMs,
      settings.portReconnectBaseMs * (2 ** Math.min(reconnectAttempt, 5))
    );
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectBackground();
    }, delay);
  }

  function connectBackground() {
    if (portConnected) return;
    clearReconnectTimer();
    try {
      port = browser.runtime.connect({ name: PORT_NAME });
      portConnected = true;
      reconnectAttempt = 0;
      metrics.portConnects += 1;
      port.onMessage.addListener(onBackgroundMessage);
      port.onDisconnect.addListener(() => {
        portConnected = false;
        port = null;
        metrics.portDisconnects += 1;
        scheduleReconnect();
      });
      sendPort({ type: "CONTENT_HELLO", payload: snapshotPayload("hello") });
    } catch (error) {
      portConnected = false;
      port = null;
      log("port-connect-failed", { message: String(error) });
      scheduleReconnect();
    }
  }

  function onBackgroundMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "BG_HELLO") {
      if (message.settings) settings = Core.applyStandardPolicy ? Core.applyStandardPolicy(message.settings) : Core.mergeSettings(message.settings);
      if (message.status?.network) bgStatus.network = message.status.network;
      if (message.status?.worker) bgStatus.worker = message.status.worker;
      if (startup.armed) maybeProbeQuality("background-hello");
      return;
    }
    if (message.type === "BG_SETTINGS") {
      const previous = settings;
      const next = Core.applyStandardPolicy ? Core.applyStandardPolicy(message.settings) : Core.mergeSettings(message.settings);
      const rampProfileChanged = previous.rampProfile !== next.rampProfile;
      const structuralChanged = previous.enabled !== next.enabled;
      settings = next;

      if (structuralChanged) {
        qualityStatus.requestedHeight = 0;
        resetQualityControl("background-settings");
        if (startup.armed) maybeProbeQuality("background-settings");
        return;
      }

      if (rampProfileChanged) {
        // Hot-swap only the future upward timing gates. Do not throw away the current
        // bootstrap/range/preferred stage or force a representation transition merely
        // because the user changed the ramp-speed preference.
        qualityControl.stableSinceMs = null;
        qualityControl.capacityStableSinceMs = null;
        if (qualityControl.mode === "range-preferred") {
          const candidateUntil = monoNow() + settings.twoStagePreferredRangeWarmupMs;
          if (settings.rampProfile === "aggressive") {
            qualityControl.transitionUntilMs = qualityControl.transitionUntilMs > 0
              ? Math.min(qualityControl.transitionUntilMs, candidateUntil) : candidateUntil;
          } else {
            qualityControl.transitionUntilMs = Math.max(qualityControl.transitionUntilMs || 0, candidateUntil);
          }
        }
        qualityControl.lastReason = `ramp-profile:${settings.rampProfile}`;
        if (startup.armed) {
          maybeProbeQuality("ramp-profile");
          maybeAdjustQuality("ramp-profile");
        }
        return;
      }

      if (startup.armed) maybeProbeQuality("background-settings");
      return;
    }
    if (message.type === "BG_NETWORK_STATUS") {
      bgStatus = {
        state: message.state || bgStatus.state,
        network: message.network || bgStatus.network,
        worker: message.worker || bgStatus.worker
      };
      maybeAdjustQuality("network-status");
    }
  }


  function clearPauseTimer() { if (pauseTimer) clearTimeout(pauseTimer); pauseTimer = null; }

  function circuitOpen() {
    if (circuitUntilEpochMs && wallNow() >= circuitUntilEpochMs) {
      circuitUntilEpochMs = 0;
      failedPumps = 0;
      log("circuit-close");
    }
    return circuitUntilEpochMs > wallNow();
  }

  function openCircuit(reason) {
    circuitUntilEpochMs = Math.max(circuitUntilEpochMs, wallNow() + settings.circuitBreakerMs);
    metrics.lastOutcome = `circuit:${reason}`;
    log("circuit-open", { reason, durationMs: settings.circuitBreakerMs });
  }

  function recentEpoch(array, windowMs) {
    const cutoff = wallNow() - windowMs;
    while (array.length && array[0] < cutoff) array.shift();
    return array;
  }

  function unbindVideo() {
    clearPauseTimer();
    if (!boundVideo) return;
    for (const [event, handler] of VIDEO_HANDLERS) boundVideo.removeEventListener(event, handler);
    boundVideo = null;
  }

  function resetStartup(reason = "reset") {
    startup = {
      armed: false,
      hasPlayedOnce: false,
      playingSinceMono: null,
      playStartCurrentTime: 0,
      armedEpochMs: 0,
      lastReason: reason
    };
    syncDemandSettings(`bootstrap:${reason}`);
  }

  function maybeArmProtection(reason = "sample") {
    if (startup.armed || !video) return startup.armed;
    const playing = !video.paused && !video.ended;
    if (playing && startup.playingSinceMono == null) {
      startup.hasPlayedOnce = true;
      startup.playingSinceMono = monoNow();
      startup.playStartCurrentTime = Number(video.currentTime) || 0;
    }
    const snap = bufferSnapshot();
    const canArm = Core.canArmProtection({
      enabled: settings.enabled,
      hasPlayedOnce: startup.hasPlayedOnce,
      playing,
      ended: Boolean(video.ended),
      seeking: Boolean(video.seeking),
      isLive: isLive(),
      isAd: isAdPlaying(),
      isShorts: isShortsPage(),
      readyState: Number(video.readyState) || 0,
      videoWidth: Number(video.videoWidth) || 0,
      videoHeight: Number(video.videoHeight) || 0,
      mediaBufferAhead: snap.mediaAhead,
      playbackAdvanceSeconds: Math.max(0, (Number(video.currentTime) || 0) - startup.playStartCurrentTime),
      playingWallMs: startup.playingSinceMono == null ? 0 : monoNow() - startup.playingSinceMono
    }, settings);
    if (!canArm) return false;

    startup.armed = true;
    startup.armedEpochMs = wallNow();
    startup.lastReason = reason;
    syncDemandSettings("protection-armed");
    log("protection-armed", {
      reason,
      currentTime: Number(video.currentTime) || 0,
      bufferAhead: snap.mediaAhead,
      readyState: Number(video.readyState) || 0
    });
    maybeProbeQuality("protection-armed");
    emitSnapshot("protection-armed", true);
    return true;
  }

  function onProgress() {
    maybeArmProtection("progress");
    if (startup.armed) { maybeProbeQuality("progress"); maybeAdjustQuality("progress"); }
    else { maybeProbeQuality("cold-start-progress", true); maybeColdStartQuality("progress"); }
    emitSnapshot("progress");
  }
  function onTimeUpdate() {
    void saveLocalCheckpoint("timeupdate");
    maybeArmProtection("timeupdate");
    if (startup.armed) { maybeProbeQuality("timeupdate"); maybeAdjustQuality("timeupdate"); }
    else { maybeProbeQuality("cold-start-timeupdate", true); maybeColdStartQuality("timeupdate"); }
    emitSnapshot("timeupdate");
  }
  function markPlaybackRisk(reason) {
    lastPlaybackRiskEpochMs = wallNow();
    if (startup.armed) maybeAdjustQuality(reason, true);
    else { maybeProbeQuality(`cold-start-${reason}`, true); maybeColdStartQuality(reason, true); }
  }
  function onWaiting() { metrics.waitingEvents += 1; void saveLocalCheckpoint("waiting", true); log("waiting", { effectiveAhead: bufferSnapshot().effectiveAhead, armed: startup.armed }); markPlaybackRisk("waiting"); emitSnapshot("waiting", true); }
  function onStalled() { metrics.stalledEvents += 1; void saveLocalCheckpoint("stalled", true); log("stalled", { effectiveAhead: bufferSnapshot().effectiveAhead, armed: startup.armed }); markPlaybackRisk("stalled"); emitSnapshot("stalled", true); }
  function onEmptied() { metrics.emptiedEvents += 1; void saveLocalCheckpoint("emptied", true); log("emptied", { armed: startup.armed }); markPlaybackRisk("emptied"); emitSnapshot("emptied", true); }
  function onError() { metrics.videoErrors += 1; void saveLocalCheckpoint("video-error", true); log("video-error", { code: video?.error?.code || 0 }); emitSnapshot("video-error", true); }
  function onLoadedMetadata() {
    qualityTransientRetries = 0;
    resetQualityControl("loadedmetadata");
    void maybeRestoreLocalCheckpoint("loadedmetadata");
    emitSnapshot("loadedmetadata", true);
  }
  function onLoadedData() { maybeArmProtection("loadeddata"); emitSnapshot("loadeddata", true); }
  function onCanPlay() { maybeArmProtection("canplay"); emitSnapshot("canplay"); }
  function onRateChange() { emitSnapshot("ratechange", true); }
  function onSeeking() { emitSnapshot("seeking", true); }
  function onSeeked() { void saveLocalCheckpoint("seeked"); maybeArmProtection("seeked"); emitSnapshot("seeked", true); }
  function onEnded() { void saveLocalCheckpoint("ended"); emitSnapshot("ended", true); }
  function onPlaying() {
    clearPauseTimer();
    if (startup.playingSinceMono == null) {
      startup.hasPlayedOnce = true;
      startup.playingSinceMono = monoNow();
      startup.playStartCurrentTime = Number(video?.currentTime) || 0;
    }
    maybeArmProtection("playing");
    if (!startup.armed) {
      maybeProbeQuality("cold-start-playing", true);
      maybeColdStartQuality("playing");
    }
    emitSnapshot("playing", true);
  }

  function onPause() {
    void saveLocalCheckpoint("pause");
    emitSnapshot("pause", true);
    if (!startup.armed) return;
    if (internalActionDepth > 0 || !settings.pausedPrebuffer || document.visibilityState !== "visible") return;
    clearPauseTimer();
    const expectedGeneration = generation;
    const expectedLifecycle = lifecycleRevision;
    pauseTimer = setTimeout(() => {
      pauseTimer = null;
      if (!video || !video.paused || internalActionDepth > 0) return;
      if (expectedGeneration !== generation || expectedLifecycle !== lifecycleRevision) return;
      if (document.visibilityState !== "visible") return;
      const snap = bufferSnapshot();
      if (Core.decidePausedPrime({
        enabled: settings.enabled,
        paused: video.paused,
        mediaBufferAhead: snap.mediaAhead,
        isLive: isLive(),
        isAd: isAdPlaying(),
        isShorts: isShortsPage(),
        visible: true
      }, settings)) requestPausedPrime(settings.pausedTargetSeconds, "pause");
    }, settings.pausePrimeDelayMs);
  }

  const VIDEO_HANDLERS = [
    ["progress", onProgress],
    ["timeupdate", onTimeUpdate],
    ["waiting", onWaiting],
    ["stalled", onStalled],
    ["emptied", onEmptied],
    ["error", onError],
    ["pause", onPause],
    ["playing", onPlaying],
    ["loadedmetadata", onLoadedMetadata],
    ["loadeddata", onLoadedData],
    ["canplay", onCanPlay],
    ["ratechange", onRateChange],
    ["seeking", onSeeking],
    ["seeked", onSeeked],
    ["ended", onEnded]
  ];

  function bindVideo(next) {
    if (!next || next === boundVideo) return;
    const replacing = Boolean(boundVideo && boundVideo !== next);
    unbindVideo();
    video = next;
    boundVideo = next;
    for (const [event, handler] of VIDEO_HANDLERS) video.addEventListener(event, handler, { passive: true });
    metrics.videoChanges += 1;
    qualityTransientRetries = 0;
    log("video-bind", { replacing, duration: video.duration, paused: video.paused });
    resetQualityControl("video-bind");
    resetStartup("video-bind");
    if (!video.paused && !video.ended) {
      startup.hasPlayedOnce = true;
      startup.playingSinceMono = monoNow();
      startup.playStartCurrentTime = Number(video.currentTime) || 0;
    }
    emitSnapshot("video-bind", true);
    queueMicrotask(() => { void maybeRestoreLocalCheckpoint("video-bind"); });

    if (replacing) {
      metrics.playerReplacements += 1;
      replacementTimesEpochMs.push(wallNow());
      recentEpoch(replacementTimesEpochMs, REPLACEMENT_WINDOW_MS);
      lifecycleRevision += 1;
      if (replacementTimesEpochMs.length > settings.maxPlayerReplacementsPer20Sec) openCircuit("player-replacements");
    }
    if (video.paused && settings.pausedPrebuffer && internalActionDepth === 0) onPause();
  }

  function nodeTouchesVideo(node) {
    if (!(node instanceof Element)) return false;
    if (node.tagName === "VIDEO") return true;
    return Boolean(node.querySelector?.("video"));
  }

  function mutationTouchesVideo(mutations) {
    return mutations.some((mutation) =>
      [...mutation.addedNodes].some(nodeTouchesVideo) || [...mutation.removedNodes].some(nodeTouchesVideo)
    );
  }

  function installPlayerObserver() {
    playerObserver?.disconnect();
    discoveryObserver?.disconnect();
    playerObserver = null;
    discoveryObserver = null;
    const root = document.querySelector("#movie_player, ytd-player, #player");
    if (root) {
      playerObserver = new MutationObserver((mutations) => {
        if (mutationTouchesVideo(mutations)) scheduleReconcile("player-mutation");
      });
      playerObserver.observe(root, { childList: true, subtree: true });
      return;
    }
    discoveryObserver = new MutationObserver(() => scheduleReconcile("player-discovery"));
    discoveryObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function resetForNavigation(reason) {
    generation += 1;
    lifecycleRevision += 1;
    samples = [];
    failedPumps = 0;
    replacementTimesEpochMs = [];
    circuitUntilEpochMs = 0;
    qualityTransientRetries = 0;
    metrics.lastOutcome = `navigation:${reason}`;
    qualityStatus = {
      requestedHeight: 0,
      selected: "unknown",
      selectedHeight: 0,
      current: "unknown",
      currentHeight: 0,
      available: [],
      availableHeights: []
    };
    resetQualityControl(`navigation:${reason}`);
    resetStartup(`navigation:${reason}`);
    clearPauseTimer();
    log("navigation", { url: location.href, generation, reason });
  }

  function reconcile(reason = "reconcile") {
    reconcileQueued = false;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      resetForNavigation(reason);
      installPlayerObserver();
    }
    const next = activeVideo();
    if (next && next !== boundVideo) bindVideo(next);
    emitSnapshot(reason, true);
  }

  function scheduleReconcile(reason = "event") {
    if (reconcileQueued) return;
    reconcileQueued = true;
    queueMicrotask(() => reconcile(reason));
  }

  function clearQualityTimer() {
    if (qualityTimer) clearTimeout(qualityTimer);
    qualityTimer = null;
  }

  function scheduleQualityApply(reason, delay = 0, targetHeight = 0, allowPreArm = false, rangeMinHeight = 0, rangeMaxHeight = 0) {
    const target = Number(targetHeight) || 0;
    if (!settings.qualityEnabled || !settings.adaptiveQuality || !target) return false;
    if (!startup.hasPlayedOnce) return false;
    if (!startup.armed && !allowPreArm) return false;
    clearQualityTimer();
    const expectedGeneration = generation;
    const requestId = `quality.${generation}.${++qualityRequestSeq}`;
    qualityStatus.requestedHeight = target;
    qualityTimer = setTimeout(() => {
      qualityTimer = null;
      if (expectedGeneration !== generation || !video || video.ended) return;
      document.dispatchEvent(new CustomEvent(QUALITY_APPLY_EVENT, {
        detail: JSON.stringify({ requestId, enabled: true, targetHeight: target, rangeMinHeight: Number(rangeMinHeight) || 0, rangeMaxHeight: Number(rangeMaxHeight) || 0, reason })
      }));
    }, Math.max(0, delay));
    return true;
  }

  function resetQualityControl(reason = "reset") {
    qualityControl = {
      targetHeight: settings.fallbackResolution,
      mode: "bootstrap",
      lowSinceMs: null,
      stableSinceMs: null,
      driftSinceMs: null,
      lastAdjustmentMs: 0,
      lastAction: "reset",
      lastReason: reason,
      transitionUntilMs: 0,
      fallbackSinceMs: 0,
      preferredSinceMs: 0,
      retryBlockedUntilMs: 0,
      cruiseStableSinceMs: null,
      capacityDeficitSinceMs: null,
      capacityStableSinceMs: null
    };
  }

  function maybeProbeQuality(reason = "probe", allowPreArm = false) {
    if (!settings.qualityEnabled || (!startup.armed && !allowPreArm)) return;
    const now = monoNow();
    if (now - lastQualityProbeMono < 1000) return;
    lastQualityProbeMono = now;
    metrics.qualityProbes += 1;
    document.dispatchEvent(new CustomEvent(QUALITY_PROBE_EVENT, {
      detail: JSON.stringify({ requestId: `probe.${generation}.${++qualityRequestSeq}`, reason })
    }));
  }

  function runTwoStageQuality(reason = "sample", riskEvent = false, allowPreArm = false) {
    if (!video || !startup.hasPlayedOnce || !settings.qualityEnabled || !settings.adaptiveQuality) return;
    if (!startup.armed && !allowPreArm) return;
    const snap = bufferSnapshot();
    const now = monoNow();
    const decision = Core.twoStageQualityDecision({
      nowMs: now,
      currentHeight: Number(qualityStatus.currentHeight || qualityStatus.selectedHeight || 0),
      mode: qualityControl.mode,
      targetHeight: qualityControl.targetHeight,
      effectiveBuffer: snap.effectiveAhead,
      bufferTrend: Core.trend(samples),
      capacityTrend: Core.trend(capacitySamples),
      currentBitrate: Number(qualityStatus.currentBitrate || 0),
      preferredBitrate: Number(qualityStatus.preferredBitrate || 0),
      playbackRate: Number(video.playbackRate) || 1,
      bandwidthEstimateBps: Number(bgStatus.network?.bandwidthEstimateBps || 0),
      bandwidthSampleCount: Number(bgStatus.network?.bandwidthSampleCount || 0),
      bandwidthInstability: Number(bgStatus.network?.bandwidthInstability || 0),
      mediaAgeMs: Number(bgStatus.network?.mediaAgeMs || 0),
      deliveryAgeMs: Number(bgStatus.network?.deliveryAgeMs || 0),
      playbackAgeMs: startup.playingSinceMono == null ? 0 : Math.max(0, now - startup.playingSinceMono),
      zigzag: Core.zigzagMetrics(capacitySamples),
      riskEvent,
      playing: !video.paused && !video.ended,
      isLive: isLive(),
      isAd: isAdPlaying(),
      availableHeights: qualityStatus.availableHeights,
      lowSinceMs: qualityControl.lowSinceMs,
      stableSinceMs: qualityControl.stableSinceMs,
      driftSinceMs: qualityControl.driftSinceMs,
      lastAdjustmentMs: qualityControl.lastAdjustmentMs,
      transitionUntilMs: qualityControl.transitionUntilMs,
      fallbackSinceMs: qualityControl.fallbackSinceMs,
      preferredSinceMs: qualityControl.preferredSinceMs,
      retryBlockedUntilMs: qualityControl.retryBlockedUntilMs,
      cruiseStableSinceMs: qualityControl.cruiseStableSinceMs,
      capacityDeficitSinceMs: qualityControl.capacityDeficitSinceMs,
      capacityStableSinceMs: qualityControl.capacityStableSinceMs
    }, settings);

    qualityControl.lowSinceMs = decision.lowSinceMs ?? null;
    qualityControl.stableSinceMs = decision.stableSinceMs ?? null;
    qualityControl.driftSinceMs = decision.driftSinceMs ?? null;
    qualityControl.transitionUntilMs = Number(decision.transitionUntilMs || 0);
    qualityControl.fallbackSinceMs = Number(decision.fallbackSinceMs || 0);
    qualityControl.preferredSinceMs = Number(decision.preferredSinceMs || 0);
    qualityControl.retryBlockedUntilMs = Number(decision.retryBlockedUntilMs || 0);
    qualityControl.cruiseStableSinceMs = decision.cruiseStableSinceMs ?? null;
    qualityControl.capacityDeficitSinceMs = decision.capacityDeficitSinceMs ?? null;
    qualityControl.capacityStableSinceMs = decision.capacityStableSinceMs ?? null;
    qualityControl.targetHeight = Number(decision.targetHeight || qualityControl.targetHeight || settings.preferredResolution);
    qualityControl.lastReason = `${reason}:${decision.reason}`;

    if (["commit-preferred", "commit-fallback", "adopt-preferred", "adopt-fallback", "enter-cruise"].includes(decision.action)) {
      qualityControl.mode = decision.mode;
      qualityControl.lastAction = decision.action;
      if (decision.action.startsWith("adopt-")) qualityControl.lastAdjustmentMs = now;
      return;
    }

    if (decision.action === "open-preferred-range") {
      qualityControl.mode = decision.mode;
      qualityControl.lastAdjustmentMs = now;
      qualityControl.lastAction = decision.action;
      scheduleQualityApply(`${reason}:${decision.reason}`, 0, decision.targetHeight, allowPreArm || !startup.armed, decision.rangeMinHeight, decision.rangeMaxHeight);
      log("quality-range", {
        reason: decision.reason, minHeight: decision.rangeMinHeight, maxHeight: decision.rangeMaxHeight,
        currentHeight: qualityStatus.currentHeight, bufferAhead: snap.effectiveAhead, mode: qualityControl.mode
      });
      return;
    }

    if (decision.action === "switch-preferred" || decision.action === "switch-fallback") {
      qualityControl.mode = decision.mode;
      qualityControl.lastAdjustmentMs = now;
      qualityControl.lastAction = decision.action;
      if (decision.action === "switch-preferred") metrics.qualityUpshifts += 1;
      else metrics.qualityDownshifts += 1;
      scheduleQualityApply(`${reason}:${decision.reason}`, 0, decision.targetHeight, allowPreArm || !startup.armed);
      log("quality-switch", {
        action: decision.action, reason: decision.reason, targetHeight: decision.targetHeight,
        currentHeight: qualityStatus.currentHeight, bufferAhead: snap.effectiveAhead,
        trend: Core.trend(samples), capacityTrend: Core.trend(capacitySamples),
        preferredHeadroom: decision.preferredHeadroom || 0, transitionUntilMs: qualityControl.transitionUntilMs,
        mode: qualityControl.mode, mediaAgeMs: decision.mediaAgeMs || 0, deliveryAgeMs: decision.deliveryAgeMs || 0
      });
      return;
    }
    qualityControl.lastAction = "hold";
  }

  function maybeColdStartQuality(reason = "cold-start", riskEvent = false) {
    runTwoStageQuality(reason, riskEvent, true);
  }

  function maybeAdjustQuality(reason = "sample", riskEvent = false) {
    runTwoStageQuality(reason, riskEvent, false);
  }

  document.addEventListener(NETWORK_HINT_EVENT, (event) => {
    let detail = null;
    try { detail = typeof event.detail === "string" ? JSON.parse(event.detail) : null; } catch (_) {}
    if (!detail || typeof detail !== "object" || !detail.url) return;
    if (detail.session && typeof detail.session === "object") playerSession = { ...playerSession, ...detail.session };
    sendPort({
      type: "CONTENT_NETWORK_HINT",
      payload: {
        generation,
        url: location.href,
        hint: { url: detail.url, source: detail.source || "performance", at: detail.at || wallNow() }
      }
    });
  });


  document.addEventListener(READAHEAD_STATUS_EVENT, (event) => {
    let detail = null;
    try { detail = typeof event.detail === "string" ? JSON.parse(event.detail) : null; } catch (_) {}
    if (!detail || typeof detail !== "object") return;
    sendPort({ type: "CONTENT_READAHEAD_STATUS", payload: { generation, url: location.href, detail } });
  });

  document.addEventListener(DEMAND_STATUS_EVENT, (event) => {
    let detail = null;
    try { detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail; } catch (_) {}
    if (!detail || typeof detail !== "object") return;
    if (detail.type === "sabr-patched") {
      metrics.sabrPatchesObserved += 1;
      metrics.lastDemandPatchEpochMs = Number(detail.at) || wallNow();
    } else if (detail.type === "sabr-patch-skipped") {
      metrics.sabrPatchSkipped += 1;
    } else if (detail.type === "sabr-patch-failed") {
      metrics.sabrPatchFailures += 1;
    }
    sendPort({
      type: "CONTENT_DEMAND_STATUS",
      payload: { generation, url: location.href, detail }
    });
  });

  document.addEventListener(QUALITY_STATUS_EVENT, (event) => {
    let detail = null;
    try { detail = typeof event.detail === "string" ? JSON.parse(event.detail) : null; } catch (_) {}
    if (!detail || typeof detail !== "object") return;
    if (detail.session && typeof detail.session === "object") {
      playerSession = { ...playerSession, ...detail.session };
    }
    const { session: _session, ...qualityDetail } = detail;
    qualityStatus = { ...qualityStatus, ...qualityDetail };
    if (!detail.probe) metrics.qualityApplications += 1;
    if (startup.armed && !detail.ok && detail.transient && qualityTransientRetries < 3 && document.visibilityState === "visible") {
      qualityTransientRetries += 1;
      scheduleQualityApply("transient-retry", 700 * qualityTransientRetries, qualityControl.targetHeight);
    } else if (detail.ok) {
      qualityTransientRetries = 0;
    }
    if (detail.ok) {
      if (startup.armed) maybeAdjustQuality(detail.probe ? "quality-probe" : "quality-status");
      else maybeColdStartQuality(detail.probe ? "quality-probe" : "quality-status");
    }
    emitSnapshot("quality-status", true);
  });

  async function waitForGrowth(sessionVideo, beforeEnd, originalTime, timeoutMs, expectedGeneration, expectedLifecycle) {
    const started = monoNow();
    while (monoNow() - started < timeoutMs) {
      await sleep(120);
      if (generation !== expectedGeneration || lifecycleRevision !== expectedLifecycle) return { grew: false, reason: "lifecycle-changed" };
      if (document.visibilityState !== "visible") return { grew: false, reason: "page-hidden" };
      if (video !== sessionVideo) return { grew: false, reason: "video-replaced" };
      if (!sessionVideo?.isConnected) return { grew: false, reason: "video-detached" };
      const ranges = Core.rangesToArray(sessionVideo.buffered);
      const snap = Core.contiguousBuffer(ranges, sessionVideo.currentTime, settings.originalRangeGuardSeconds);
      if (!Core.isBuffered(ranges, originalTime, settings.originalRangeGuardSeconds)) {
        return { grew: false, reason: "original-range-evicted", growth: snap.end - beforeEnd };
      }
      if (snap.end - beforeEnd >= settings.minBufferGrowthSeconds) {
        return { grew: true, reason: "growth", growth: snap.end - beforeEnd };
      }
    }
    const end = Core.contiguousBuffer(sessionVideo.buffered, sessionVideo.currentTime, settings.originalRangeGuardSeconds).end;
    return { grew: false, reason: "timeout", growth: end - beforeEnd };
  }

  async function pumpPausedBuffer({ targetSeconds, reason }) {
    if (!video || interventionPromise || !video.paused || document.visibilityState !== "visible") return false;
    if (isLive() || isAdPlaying() || isShortsPage() || circuitOpen()) return false;

    const started = monoNow();
    const sessionVideo = video;
    const originalTime = sessionVideo.currentTime;
    const expectedGeneration = generation;
    const expectedLifecycle = lifecycleRevision;
    let grewAtLeastOnce = false;
    let rounds = 0;
    let outcome = "no-growth";

    internalActionDepth += 1;
    log("prime-start", { reason, targetSeconds, originalTime, mediaAhead: bufferSnapshot().mediaAhead });

    try {
      while (sessionVideo.paused && rounds < settings.maxPumpRounds && monoNow() - started < settings.maxInterventionMs) {
        rounds += 1;
        if (generation !== expectedGeneration || lifecycleRevision !== expectedLifecycle) { outcome = "lifecycle-changed"; break; }
        if (document.visibilityState !== "visible") { outcome = "page-hidden"; break; }
        if (video !== sessionVideo || !sessionVideo.isConnected) { outcome = "video-replaced"; break; }
        const ranges = Core.rangesToArray(sessionVideo.buffered);
        const contiguous = Core.contiguousBuffer(ranges, sessionVideo.currentTime, settings.originalRangeGuardSeconds);
        if (contiguous.ahead >= targetSeconds) { outcome = "target-reached"; break; }
        if (!Core.isBuffered(ranges, originalTime, settings.originalRangeGuardSeconds)) {
          metrics.backBufferEvictions += 1;
          outcome = "original-range-evicted";
          break;
        }
        if (!contiguous.range) { outcome = "no-containing-range"; break; }

        const maxSeek = Number.isFinite(sessionVideo.duration) ? Math.max(0, sessionVideo.duration - 0.25) : contiguous.end;
        const seekTo = Core.clamp(contiguous.end + settings.edgeSeekEpsilonSeconds, 0, maxSeek);
        const beforeEnd = contiguous.end;
        sessionVideo.currentTime = seekTo;
        const result = await waitForGrowth(
          sessionVideo, beforeEnd, originalTime, settings.pumpWaitMs,
          expectedGeneration, expectedLifecycle
        );
        if (result.reason === "original-range-evicted") metrics.backBufferEvictions += 1;
        if (result.grew) {
          grewAtLeastOnce = true;
          log("prime-growth", { round: rounds, growth: result.growth });
        } else {
          outcome = result.reason;
          if (rounds >= 2 || result.reason !== "timeout") break;
        }
      }

      if (generation !== expectedGeneration || lifecycleRevision !== expectedLifecycle) return false;
      if (video !== sessionVideo || !sessionVideo.isConnected) { openCircuit("video-replaced-during-prime"); return false; }
      try { sessionVideo.currentTime = Core.clamp(originalTime, 0, Number.isFinite(sessionVideo.duration) ? sessionVideo.duration : originalTime); } catch (_) {}
      const finalAhead = bufferSnapshot(sessionVideo).mediaAhead;
      if (finalAhead >= targetSeconds) outcome = "target-reached";
      const success = grewAtLeastOnce || finalAhead >= settings.warmLowWatermarkSeconds;
      if (success) { failedPumps = 0; metrics.successfulPumps += 1; }
      else { failedPumps += 1; metrics.failedPumps += 1; }
      metrics.lastOutcome = outcome;
      log("prime-end", { outcome, rounds, finalAhead, grewAtLeastOnce });
      if (failedPumps >= settings.maxFailedPumpsBeforeCircuit) openCircuit("failed-paused-primes");
      return success;
    } finally {
      internalActionDepth = Math.max(0, internalActionDepth - 1);
      emitSnapshot("prime-end", true);
    }
  }

  function requestPausedPrime(targetSeconds, reason) {
    if (!startup.armed || interventionPromise || circuitOpen() || !video?.paused || document.visibilityState !== "visible") return interventionPromise;
    metrics.pausedPrimes += 1;
    interventionPromise = pumpPausedBuffer({ targetSeconds, reason })
      .catch((error) => {
        log("prime-exception", { message: String(error) });
        failedPumps += 1;
        if (failedPumps >= settings.maxFailedPumpsBeforeCircuit) openCircuit("prime-exceptions");
        return false;
      })
      .finally(() => { interventionPromise = null; });
    return interventionPromise;
  }

  function publicStatus() {
    const snap = bufferSnapshot();
    return {
      installed: true,
      version: VERSION,
      generation,
      url: location.href,
      state: bgStatus.state || (video?.paused ? "paused" : "observing"),
      bufferAhead: snap.mediaAhead,
      effectiveBufferAhead: snap.effectiveAhead,
      contiguousBufferedEnd: snap.contiguousEnd,
      furthestBufferedEnd: snap.furthestEnd,
      currentTime: Number(video?.currentTime) || 0,
      playbackRate: Number(video?.playbackRate) || 1,
      duration: Number(video?.duration) || 0,
      paused: Boolean(video?.paused),
      isLive: isLive(),
      isAd: isAdPlaying(),
      isShorts: isShortsPage(),
      trend: Core.trend(samples),
      lifecycle: { ...lifecycle },
      background: { ...bgStatus },
      quality: { ...qualityStatus, controller: { ...qualityControl } },
      circuitRemainingMs: Math.max(0, circuitUntilEpochMs - wallNow()),
      metrics: { ...metrics },
      settings: { ...settings },
      startup: { ...startup },
      events: eventLog.slice(-30)
    };
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return undefined;
    if (message.type === "YTBG_GET_STATUS") return Promise.resolve(publicStatus());
    if (message.type === "YTBG_PRIME") {
      if (!startup.armed || !video?.paused) {
        metrics.lastOutcome = "prime-skipped:video-playing";
        emitSnapshot("prime-skipped", true);
        return Promise.resolve(publicStatus());
      }
      return Promise.resolve(requestPausedPrime(settings.pausedTargetSeconds, "manual")).then(() => publicStatus());
    }
    if (message.type === "YTBG_APPLY_QUALITY") {
      scheduleQualityApply("manual-command", 0, settings.preferredResolution, true);
      return Promise.resolve(publicStatus());
    }
    if (message.type === "YTBG_RESET_CIRCUIT") {
      circuitUntilEpochMs = 0;
      failedPumps = 0;
      replacementTimesEpochMs = [];
      log("circuit-manual-reset");
      return Promise.resolve(publicStatus());
    }
    return undefined;
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    settings = Core.applyStandardPolicy ? Core.applyStandardPolicy(changes[STORAGE_KEY].newValue) : Core.mergeSettings(changes[STORAGE_KEY].newValue);
    syncDemandSettings("storage-change");
    qualityStatus.requestedHeight = 0;
    resetQualityControl("settings");
    if (startup.armed) maybeProbeQuality("settings");
    emitSnapshot("settings", true);
  });

  function handleVisibility() {
    if (document.visibilityState === "hidden") {
      clearPauseTimer();
    } else {
      connectBackground();
      scheduleReconcile("visible");
      maybeProbeQuality("visible");
    }
    sendLifecycle("visibilitychange", "active");
  }

  document.addEventListener("visibilitychange", handleVisibility, true);
  window.addEventListener("pageshow", (event) => {
    connectBackground();
    sendLifecycle(event.persisted ? "pageshow-bfcache" : "pageshow", "active");
    scheduleReconcile("pageshow");
  }, true);
  window.addEventListener("pagehide", (event) => {
    clearPauseTimer();
    void saveLocalCheckpoint(event.persisted ? "pagehide-bfcache" : "pagehide");
    sendLifecycle(event.persisted ? "pagehide-bfcache" : "pagehide", event.persisted ? "bfcache" : "unloaded");
  }, true);
  window.addEventListener("online", () => { connectBackground(); sendLifecycle("online", "active"); }, true);
  window.addEventListener("offline", () => sendLifecycle("offline", "active"), true);
  window.addEventListener("focus", () => { connectBackground(); sendLifecycle("focus", "active"); }, true);
  window.addEventListener("blur", () => sendLifecycle("blur", "active"), true);
  document.addEventListener("yt-navigate-finish", () => scheduleReconcile("yt-navigate-finish"), true);
  document.addEventListener("yt-page-data-updated", () => scheduleReconcile("yt-page-data-updated"), true);

  async function initialize() {
    try {
      const stored = await browser.storage.local.get(STORAGE_KEY);
      settings = Core.applyStandardPolicy ? Core.applyStandardPolicy(stored[STORAGE_KEY]) : Core.mergeSettings(stored[STORAGE_KEY]);
      syncDemandSettings("initialize");
      qualityStatus.requestedHeight = 0;
      resetQualityControl("initialize");
    } catch (error) {
      log("settings-load-failed", { message: String(error) });
    }
    connectBackground();
    installPlayerObserver();
    reconcile("initialize");
    log("guardian-ready", { version: VERSION });
  }

  void initialize();
})();
