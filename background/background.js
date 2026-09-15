(() => {
  "use strict";

  const Core = globalThis.YTBufferCore;
  const Network = globalThis.YTBufferNetworkCore;
  const Scheduler = globalThis.YTBufferSchedulerCore;
  if (!Core || !Network || !Scheduler) throw new Error("1440, Please core modules missing");

  const VERSION = "0.17.8";
  const STORAGE_KEY = "settings";
  const PORT_NAME = "ytbg-session-v17";
  const SCHEDULER_ALARM = "ytbg-scheduler-v17";
  const GOOGLEVIDEO_FILTER = { urls: ["*://*.googlevideo.com/*", "*://googlevideo.com/*"] };
  // Register response-started on YouTube too. Apart from giving us response
  // headers for UMP/media classification, this avoids a Firefox webRequest
  // regression where early requests can otherwise surface with tabId=-1.
  const ATTRIBUTION_FILTER = { urls: [
    "https://www.youtube.com/*",
    "*://*.googlevideo.com/*",
    "*://googlevideo.com/*"
  ] };
  const TRACKING_FILTER = { urls: ["https://s.youtube.com/api/stats/*"] };

  let settings = Core.mergeSettings();
  let schedulerWorker = null;
  let workerRequestSeq = 0;
  let lastWorkerReplyEpochMs = 0;
  let lastWorkerStartEpochMs = 0;
  let lastPlanRequestEpochMs = 0;
  const sessions = new Map();
  const pulseRequests = new Map();
  const requestRecords = new Map();

  function now() { return Date.now(); }
  function age(stamp) { return Number.isFinite(stamp) ? Math.max(0, now() - stamp) : Infinity; }

  function debug(...args) {
    if (settings.debug) console.debug("[YTBG background]", ...args);
  }

  function standardizeSettings(value) {
    return Core.applyStandardPolicy ? Core.applyStandardPolicy(value) : Core.mergeSettings(value);
  }

  function settingsEqual(a, b) {
    try { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }
    catch (_) { return false; }
  }

  function emptyNetwork() {
    return {
      cdnOrigin: null,
      mediaOrigin: null,
      cpn: null,
      lastAnyGoogleVideoEpochMs: null,
      lastMediaEpochMs: null,
      lastMediaActivityEpochMs: null,
      lastMediaStartEpochMs: null,
      lastMediaResponseEpochMs: null,
      lastMediaEndEpochMs: null,
      lastMediaDeliveryEpochMs: null,
      lastMediaContentType: null,
      lastMediaKind: null,
      lastMediaMethod: null,
      lastMediaStatusCode: null,
      lastMediaDetectionSource: null,
      inflightMedia: 0,
      lastCdnEpochMs: null,
      lastPulseDispatchEpochMs: null,
      lastPulseObservedEpochMs: null,
      mediaIdleStartEpochMs: null,
      firstPulseInIdleEpochMs: null,
      lastPulseRttMs: null,
      pulseRttEwmaMs: null,
      pendingPulseEpochMs: null,
      lastDemandKickEpochMs: null,
      pendingDemandKickEpochMs: null,
      pendingDemandPatchEpochMs: null,
      lastDemandPatchEpochMs: null,
      lastDemandPatchPlayerTimeMs: null,
      lastDemandPatchBufferAhead: null,
      bandwidthFastBps: 0,
      bandwidthSlowBps: 0,
      bandwidthEstimateBps: 0,
      bandwidthSampleCount: 0,
      bandwidthLastSampleBps: 0,
      bandwidthLastSampleBytes: 0,
      bandwidthLastSampleDurationMs: 0,
      bandwidthInstability: 0,
      lastBandwidthSampleEpochMs: null,
      lastStatsEpochMs: null,
      lastWatchtimeEpochMs: null,
      lastWatchtimeCurrentTime: null,
      watchtimeRequests: 0,
      watchtimeCompletions: 0,
      watchtimeErrors: 0,
      demandState: "idle"
    };
  }

  function createSession(tabId) {
    const session = {
      tabId,
      generation: 0,
      url: "",
      port: null,
      portConnected: false,
      lastContentEpochMs: null,
      lastContentReason: "",
      playback: {
        playing: false,
        paused: true,
        ended: false,
        currentTime: 0,
        playbackRate: 1,
        bufferAhead: 0,
        effectiveBufferAhead: 0,
        trend: 0,
        isLive: false,
        isAd: false,
        isShorts: false,
        cpn: null,
        videoId: null,
        quality: null,
        state: "unknown"
      },
      lifecycle: {
        visibility: "unknown",
        pageState: "active",
        online: true,
        focused: false,
        lastEvent: "init",
        lastEventEpochMs: now()
      },
      network: emptyNetwork(),
      activeMediaRequestIds: new Set(),
      metrics: {
        mediaRequestsObserved: 0,
        mediaResponsesConfirmed: 0,
        mediaCompletions: 0,
        mediaErrors: 0,
        pageMediaHints: 0,
        bufferDeliveryEvents: 0,
        negativeTabIdRequests: 0,
        cpnAttributions: 0,
        videoIdAttributions: 0,
        fallbackAttributions: 0,
        unattributedGoogleVideo: 0,
        unknownGoogleVideoRequests: 0,
        cdnRequestsObserved: 0,
        pulseDispatches: 0,
        pulseInjectionSuccesses: 0,
        pulseInjectionFailures: 0,
        pulseRequestsObserved: 0,
        pulseCompletions: 0,
        pulseErrors: 0,
        pulseUsefulEvents: 0,
        emptyPulseEvents: 0,
        demandKicks: 0,
        demandKickSuccesses: 0,
        demandKickFailures: 0,
        demandKickUsefulEvents: 0,
        emptyDemandKicks: 0,
        lastDemandKickToMediaRefillMs: null,
        sabrPatchesObserved: 0,
        sabrPatchFailures: 0,
        sabrPatchSkipped: 0,
        sabrPatchUsefulEvents: 0,
        emptySabrPatches: 0,
        lastDemandPatchToDeliveryMs: null,
        mediaIdleEpisodes: 0,
        mediaRefillEvents: 0,
        lastMediaIdleDurationMs: null,
        longestMediaIdleDurationMs: 0,
        lastPulseToMediaRefillMs: null,
        workerPlans: 0,
        lifecycleTransitions: 0,
        portReconnects: 0,
        bandwidthSamples: 0,
        trackingRequests: 0,
        trackingErrors: 0
      },
      createdEpochMs: now(),
      lastUpdatedEpochMs: now()
    };
    sessions.set(tabId, session);
    return session;
  }

  function getSession(tabId, create = true) {
    if (!Number.isInteger(tabId) || tabId < 0) return null;
    return sessions.get(tabId) || (create ? createSession(tabId) : null);
  }

  function resetNetworkForGeneration(session, reason) {
    session.network = emptyNetwork();
    session.activeMediaRequestIds?.clear?.();
    session.metrics.lastMediaIdleDurationMs = null;
    session.metrics.lastPulseToMediaRefillMs = null;
    session.lastUpdatedEpochMs = now();
    debug("network generation reset", session.tabId, reason);
  }

  function serializeSessionForWorker(session) {
    return {
      tabId: session.tabId,
      generation: session.generation,
      url: session.url,
      playback: {
        playing: session.playback.playing,
        paused: session.playback.paused,
        ended: session.playback.ended,
        isLive: session.playback.isLive,
        isAd: session.playback.isAd,
        isShorts: session.playback.isShorts,
        effectiveBufferAhead: session.playback.effectiveBufferAhead,
        trend: session.playback.trend
      },
      lifecycle: {
        pageState: session.lifecycle.pageState,
        online: session.lifecycle.online,
        visibility: session.lifecycle.visibility
      },
      network: {
        cdnOrigin: session.network.cdnOrigin,
        lastMediaEpochMs: session.network.lastMediaActivityEpochMs ?? session.network.lastMediaEpochMs,
        lastMediaActivityEpochMs: session.network.lastMediaActivityEpochMs,
        inflightMedia: session.network.inflightMedia || 0,
        lastMediaDeliveryEpochMs: session.network.lastMediaDeliveryEpochMs,
        lastPulseDispatchEpochMs: session.network.lastPulseDispatchEpochMs,
        lastDemandKickEpochMs: session.network.lastDemandKickEpochMs
      }
    };
  }

  function networkHealth(session) {
    const base = {
      hasOrigin: Boolean(session.network.cdnOrigin),
      inflightMedia: session.network.inflightMedia || 0,
      mediaAgeMs: age(session.network.lastMediaActivityEpochMs ?? session.network.lastMediaEpochMs),
      deliveryAgeMs: age(session.network.lastMediaDeliveryEpochMs),
      pulseAgeMs: age(session.network.lastPulseObservedEpochMs ?? session.network.lastPulseDispatchEpochMs),
      pulseRttMs: session.network.pulseRttEwmaMs
    };
    return Network.transportHealth(base, settings);
  }

  function mediaHealth(session) {
    return Network.mediaHealth({
      inflightMedia: session.network.inflightMedia || 0,
      mediaAgeMs: age(session.network.lastMediaActivityEpochMs ?? session.network.lastMediaEpochMs),
      deliveryAgeMs: age(session.network.lastMediaDeliveryEpochMs),
      lastMediaEpochMs: session.network.lastMediaEpochMs,
      bufferAhead: session.playback.effectiveBufferAhead
    }, settings);
  }

  function deriveState(session) {
    return Core.derivePlaybackState({
      enabled: settings.enabled,
      paused: session.playback.paused,
      ended: session.playback.ended,
      isLive: session.playback.isLive,
      isAd: session.playback.isAd,
      isShorts: session.playback.isShorts,
      priming: session.playback.state === "priming",
      effectiveBuffer: session.playback.effectiveBufferAhead,
      bufferTrend: session.playback.trend,
      mediaAgeMs: age(session.network.lastMediaActivityEpochMs ?? session.network.lastMediaEpochMs),
      cdnAgeMs: age(session.network.lastCdnEpochMs),
      online: session.lifecycle.online
    }, settings);
  }

  function publicStatus(session) {
    if (!session) return { installed: true, version: VERSION, state: "no-session" };
    return {
      installed: true,
      version: VERSION,
      tabId: session.tabId,
      generation: session.generation,
      url: session.url,
      state: deriveState(session),
      playback: { ...session.playback },
      lifecycle: { ...session.lifecycle },
      network: {
        ...session.network,
        health: networkHealth(session),
        transportHealth: networkHealth(session),
        mediaHealth: mediaHealth(session),
        mediaAgeMs: Number.isFinite(session.network.lastMediaActivityEpochMs ?? session.network.lastMediaEpochMs)
          ? age(session.network.lastMediaActivityEpochMs ?? session.network.lastMediaEpochMs) : null,
        deliveryAgeMs: Number.isFinite(session.network.lastMediaDeliveryEpochMs) ? age(session.network.lastMediaDeliveryEpochMs) : null,
        cdnAgeMs: Number.isFinite(session.network.lastCdnEpochMs) ? age(session.network.lastCdnEpochMs) : null,
        pulseAgeMs: Number.isFinite(session.network.lastPulseDispatchEpochMs) ? age(session.network.lastPulseDispatchEpochMs) : null,
        demandKickAgeMs: Number.isFinite(session.network.lastDemandKickEpochMs) ? age(session.network.lastDemandKickEpochMs) : null,
        demandState: session.network.demandState || "idle"
      },
      worker: {
        alive: Boolean(schedulerWorker),
        lastReplyAgeMs: lastWorkerReplyEpochMs ? age(lastWorkerReplyEpochMs) : null,
        startedAt: lastWorkerStartEpochMs || null
      },
      content: {
        connected: session.portConnected,
        lastSeenAgeMs: session.lastContentEpochMs ? age(session.lastContentEpochMs) : null,
        lastReason: session.lastContentReason
      },
      metrics: { ...session.metrics },
      settings: { ...settings }
    };
  }

  function pushNetworkStatus(session) {
    if (!session?.port) return;
    try {
      session.port.postMessage({
        type: "BG_NETWORK_STATUS",
        version: VERSION,
        state: deriveState(session),
        network: publicStatus(session).network,
        worker: publicStatus(session).worker
      });
    } catch (_) {
      // Port disconnect handler owns lifecycle cleanup.
    }
  }

  function startWorker(reason = "startup") {
    try { schedulerWorker?.terminate(); } catch (_) {}
    schedulerWorker = null;
    try {
      schedulerWorker = new Worker(browser.runtime.getURL("background/scheduler-worker.js"));
      lastWorkerStartEpochMs = now();
      lastWorkerReplyEpochMs = now();
      schedulerWorker.onmessage = onWorkerMessage;
      schedulerWorker.onerror = (event) => {
        console.warn("[YTBG] scheduler worker error", event.message || event);
        schedulerWorker = null;
      };
      schedulerWorker.onmessageerror = () => { schedulerWorker = null; };
      debug("worker started", reason);
    } catch (error) {
      console.warn("[YTBG] Failed to start scheduler worker", error);
      schedulerWorker = null;
    }
  }

  function onWorkerMessage(event) {
    const message = event.data || {};
    lastWorkerReplyEpochMs = now();
    if (message.type === "worker-error") {
      console.warn("[YTBG] scheduler worker reported error", message.message);
      return;
    }
    if (message.type !== "plan") return;
    for (const action of message.actions || []) handleScheduledAction(action, "worker-plan");
  }

  function workerHealthy() {
    if (!schedulerWorker) return false;
    const tolerance = Math.max(settings.schedulerTickMs * 4, 8000);
    return age(lastWorkerReplyEpochMs) <= tolerance;
  }

  function evaluateScheduler(reason = "alarm") {
    const nowEpochMs = now();
    updateIdleEpisodeState(nowEpochMs);
    const list = [...sessions.values()].map(serializeSessionForWorker);
    lastPlanRequestEpochMs = nowEpochMs;

    if (!workerHealthy()) startWorker(`watchdog:${reason}`);
    const requestId = ++workerRequestSeq;
    if (schedulerWorker) {
      try {
        schedulerWorker.postMessage({ type: "tick", requestId, nowEpochMs, sessions: list, settings });
        return;
      } catch (_) {
        schedulerWorker = null;
      }
    }

    // Fail-open scheduling: if the worker is unavailable, the background page
    // still evaluates the same pure policy synchronously.
    for (const action of Scheduler.planTick(list, settings, nowEpochMs)) {
      handleScheduledAction(action, "fallback-plan");
    }
  }

  function ensureSchedulerAlarm() {
    browser.alarms.clear("ytbg-scheduler-v8").catch(() => {});
    browser.alarms.clear("ytbg-scheduler-v10").catch(() => {});
    browser.alarms.clear(SCHEDULER_ALARM).catch(() => {});
    if (sessions.size === 0) return;
    const periodInMinutes = Math.max(0.005, settings.schedulerTickMs / 60000);
    browser.alarms.create(SCHEDULER_ALARM, {
      delayInMinutes: periodInMinutes,
      periodInMinutes
    });
  }

  function updateIdleEpisodeState(nowEpochMs) {
    for (const session of sessions.values()) {
      const playing = session.playback.playing && !session.playback.paused && !session.playback.ended;
      const mediaStamp = session.network.lastMediaActivityEpochMs ?? session.network.lastMediaEpochMs;
      const mediaAge = Number.isFinite(mediaStamp)
        ? Math.max(0, nowEpochMs - mediaStamp)
        : Infinity;
      const activelyStreaming = Number(session.network.inflightMedia || 0) > 0;
      const recentDelivery = Number.isFinite(session.network.lastMediaDeliveryEpochMs)
        && Math.max(0, nowEpochMs - session.network.lastMediaDeliveryEpochMs) < settings.mediaIdleWarmMs;
      if (playing && !activelyStreaming && !recentDelivery && mediaAge >= settings.mediaIdleWarmMs && session.network.mediaIdleStartEpochMs == null) {
        session.network.mediaIdleStartEpochMs = nowEpochMs - Math.min(mediaAge, settings.mediaIdleWarmMs);
        session.network.firstPulseInIdleEpochMs = null;
        session.metrics.mediaIdleEpisodes += 1;
      } else if (!playing) {
        session.network.mediaIdleStartEpochMs = null;
        session.network.firstPulseInIdleEpochMs = null;
      }
    }
  }

  function pagePulse(origin, token) {
    try {
      const key = "__YTBG_KEEPALIVE_IMAGES_V4__";
      const bag = window[key] instanceof Map ? window[key] : new Map();
      window[key] = bag;
      while (bag.size >= 24) bag.delete(bag.keys().next().value);
      const img = new Image();
      const cleanup = () => bag.delete(token);
      img.onload = cleanup;
      img.onerror = cleanup;
      img.referrerPolicy = "origin";
      bag.set(token, img);
      img.src = `${origin}/generate_204?conn2&ytbg=${encodeURIComponent(token)}`;
      return { ok: true, visibility: document.visibilityState, hidden: document.hidden };
    } catch (error) {
      return { ok: false, error: String(error), visibility: document.visibilityState, hidden: document.hidden };
    }
  }

  async function dispatchPagePulse(session, reason = "scheduled") {
    if (!session?.network?.cdnOrigin) return false;
    const dispatchAt = now();
    if (Number.isFinite(session.network.pendingPulseEpochMs)
        && dispatchAt - session.network.pendingPulseEpochMs >= settings.pulseEffectWindowMs
        && (!Number.isFinite(session.network.lastMediaDeliveryEpochMs)
          || session.network.lastMediaDeliveryEpochMs < session.network.pendingPulseEpochMs)) {
      session.metrics.emptyPulseEvents += 1;
      session.network.pendingPulseEpochMs = null;
    }
    // Reserve the cadence slot before asynchronous injection. This prevents an
    // alarm/worker race from dispatching overlapping pulses. Keep the earliest
    // still-live causal window rather than resetting it every 3 seconds.
    session.network.lastPulseDispatchEpochMs = dispatchAt;
    if (!Number.isFinite(session.network.pendingPulseEpochMs)) {
      session.network.pendingPulseEpochMs = dispatchAt;
    }
    if (session.network.mediaIdleStartEpochMs != null && session.network.firstPulseInIdleEpochMs == null) {
      session.network.firstPulseInIdleEpochMs = dispatchAt;
    }
    session.metrics.pulseDispatches += 1;

    const token = `${session.tabId}.${session.generation}.${dispatchAt}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId: session.tabId, frameIds: [0] },
        world: "MAIN",
        injectImmediately: true,
        func: pagePulse,
        args: [session.network.cdnOrigin, token]
      });
      const result = results?.[0];
      if (result?.error || result?.result?.ok === false) {
        session.metrics.pulseInjectionFailures += 1;
        debug("pulse injection returned error", result?.error || result?.result?.error);
        return false;
      }
      session.metrics.pulseInjectionSuccesses += 1;
      session.lastUpdatedEpochMs = now();
      debug("pulse dispatched", session.tabId, reason, result?.result?.visibility);
      return true;
    } catch (error) {
      session.metrics.pulseInjectionFailures += 1;
      debug("pulse injection failed", session.tabId, reason, String(error));
      // A closed/navigated tab is cleaned up by tab listeners. Do not turn an
      // injection failure into a retry storm.
      return false;
    }
  }

  // Playing-stream demand kicks were removed in v0.15 rather than merely
  // disabled. This is a forbidden capability: no production path may seek a
  // playing video to manufacture media demand.

  function handleScheduledAction(action, source = "scheduler") {
    const session = getSession(action?.tabId, false);
    if (!session || session.generation !== action.generation) return;
    session.metrics.workerPlans += 1;
    if (action.type === "pulse") void dispatchPagePulse(session, action.reason || source);
    // v0.15 has no playing-stream demand-kick implementation at all.
  }

  function sessionsForAttribution() {
    return [...sessions.values()];
  }

  function resolveRequestSession(details, classification) {
    // A positive browser-provided tabId is authoritative even if the content
    // script has not connected yet. Create the session early so the very first
    // media request cannot race ahead of CONTENT_HELLO.
    if (Number.isInteger(details?.tabId) && details.tabId >= 0) {
      return {
        session: getSession(details.tabId, true),
        attribution: { tabId: details.tabId, method: "tab-id", confidence: 1 }
      };
    }
    const result = Network.resolveOwner(details, classification, sessionsForAttribution());
    if (!Number.isInteger(result.tabId)) return { session: null, attribution: result };
    const session = getSession(result.tabId, false) || getSession(result.tabId, true);
    if (!session) return { session: null, attribution: result };
    if (details.tabId < 0) session.metrics.negativeTabIdRequests += 1;
    if (result.method === "cpn") session.metrics.cpnAttributions += 1;
    else if (result.method === "video-id") session.metrics.videoIdAttributions += 1;
    else if (!["tab-id", "unattributed"].includes(result.method)) session.metrics.fallbackAttributions += 1;
    return { session, attribution: result };
  }

  function finishIdleEpisode(session, t) {
    if (session.network.mediaIdleStartEpochMs == null) return;
    const idleMs = Math.max(0, t - session.network.mediaIdleStartEpochMs);
    session.metrics.mediaRefillEvents += 1;
    session.metrics.lastMediaIdleDurationMs = Math.round(idleMs);
    session.metrics.longestMediaIdleDurationMs = Math.max(
      session.metrics.longestMediaIdleDurationMs,
      Math.round(idleMs)
    );
    if (session.network.firstPulseInIdleEpochMs != null) {
      session.metrics.lastPulseToMediaRefillMs = Math.round(
        Math.max(0, t - session.network.firstPulseInIdleEpochMs)
      );
    }
    session.network.mediaIdleStartEpochMs = null;
    session.network.firstPulseInIdleEpochMs = null;
  }

  function settleEffectWindow(session, key, usefulMetric, emptyMetric, latencyMetric, windowMs, t) {
    const started = session.network[key];
    if (!Number.isFinite(started) || t < started) return;
    const latency = t - started;
    if (latency <= windowMs) {
      session.metrics[usefulMetric] += 1;
      if (latencyMetric) session.metrics[latencyMetric] = Math.round(latency);
    } else {
      session.metrics[emptyMetric] += 1;
    }
    session.network[key] = null;
  }

  function markDeliveredMedia(session, at = now()) {
    if (!session) return;
    const t = Number(at) || now();
    session.network.lastMediaDeliveryEpochMs = t;
    session.network.lastMediaActivityEpochMs = t;
    session.metrics.bufferDeliveryEvents += 1;

    settleEffectWindow(
      session, "pendingPulseEpochMs",
      "pulseUsefulEvents", "emptyPulseEvents", "lastPulseToMediaRefillMs",
      settings.pulseEffectWindowMs, t
    );
    settleEffectWindow(
      session, "pendingDemandKickEpochMs",
      "demandKickUsefulEvents", "emptyDemandKicks", "lastDemandKickToMediaRefillMs",
      settings.demandEffectWindowMs, t
    );
    settleEffectWindow(
      session, "pendingDemandPatchEpochMs",
      "sabrPatchUsefulEvents", "emptySabrPatches", "lastDemandPatchToDeliveryMs",
      settings.demandEffectWindowMs, t
    );
    finishIdleEpisode(session, t);
    session.lastUpdatedEpochMs = t;
  }

  function markMedia(session, meta = {}) {
    if (!session) return;
    const t = Number(meta.at) || now();
    // IMPORTANT: request/response activity is not delivery.  Keep all
    // effectiveness accounting out of this function.  A keep-warm pulse,
    // demand kick, or SABR patch is only considered useful after the native
    // contiguous video buffer actually grows (markDeliveredMedia).
    if (meta.origin) {
      session.network.cdnOrigin = meta.origin;
      session.network.mediaOrigin = meta.origin;
    }
    if (meta.cpn) {
      session.network.cpn = meta.cpn;
      if (!session.playback.cpn) session.playback.cpn = meta.cpn;
    }
    session.network.lastMediaEpochMs = t;
    session.network.lastMediaActivityEpochMs = t;
    if (meta.phase === "start") session.network.lastMediaStartEpochMs = t;
    if (meta.phase === "response") session.network.lastMediaResponseEpochMs = t;
    if (meta.phase === "end") session.network.lastMediaEndEpochMs = t;
    if (meta.contentType) session.network.lastMediaContentType = meta.contentType;
    if (meta.mediaKind) session.network.lastMediaKind = meta.mediaKind;
    if (meta.method) session.network.lastMediaMethod = meta.method;
    if (Number.isFinite(meta.statusCode)) session.network.lastMediaStatusCode = meta.statusCode;
    if (meta.source) session.network.lastMediaDetectionSource = meta.source;
    session.network.lastCdnEpochMs = t;
    session.network.inflightMedia = session.activeMediaRequestIds.size;
    session.lastUpdatedEpochMs = t;
  }

  function attachMediaRequest(session, details, record, source, responseClass = null) {
    if (!session || !record) return;
    if (!record.countedMedia) {
      record.countedMedia = true;
      session.metrics.mediaRequestsObserved += 1;
    }
    record.tabId = session.tabId;
    record.media = true;
    record.generation = session.generation;
    session.activeMediaRequestIds.add(details.requestId);
    const cls = responseClass || record.classification;
    markMedia(session, {
      at: now(),
      phase: responseClass ? "response" : "start",
      origin: record.classification?.origin,
      cpn: record.classification?.cpn,
      method: details.method || record.method,
      statusCode: details.statusCode,
      contentType: responseClass?.contentType,
      mediaKind: responseClass?.mediaKind || (record.classification?.evidence?.includes("sabr:1") ? "sabr" : "videoplayback"),
      source
    });
    if (responseClass) session.metrics.mediaResponsesConfirmed += 1;
    pushNetworkStatus(session);
  }

  function pulseOwnerFromToken(token) {
    const first = String(token || "").split(".", 1)[0];
    const tabId = Number(first);
    return Number.isInteger(tabId) && tabId >= 0 ? getSession(tabId, false) : null;
  }

  function onBeforeRequest(details) {
    const classification = Network.classifyUrl(details.url);
    if (!classification.isGoogleVideo) return;
    const t = now();

    if (classification.kind === "pulse") {
      const token = classification.url.searchParams.get("ytbg");
      const session = getSession(details.tabId, false) || pulseOwnerFromToken(token);
      if (!session) return;
      session.metrics.cdnRequestsObserved += 1;
      session.metrics.pulseRequestsObserved += 1;
      session.network.lastCdnEpochMs = t;
      session.network.lastPulseObservedEpochMs = t;
      pulseRequests.set(details.requestId, { tabId: session.tabId, token, startedEpochMs: t });
      requestRecords.set(details.requestId, {
        tabId: session.tabId, generation: session.generation, classification,
        method: details.method, startedEpochMs: t, pulse: true
      });
      pushNetworkStatus(session);
      return;
    }

    const { session, attribution } = resolveRequestSession(details, classification);
    const record = {
      tabId: session?.tabId ?? null,
      generation: session?.generation ?? null,
      classification,
      attribution,
      method: details.method,
      startedEpochMs: t,
      media: false,
      countedMedia: false
    };
    requestRecords.set(details.requestId, record);

    if (!session) {
      for (const s of sessions.values()) {
        if (details.tabId < 0) s.metrics.negativeTabIdRequests += 1;
      }
      if (classification.kind === "media" || classification.kind === "media-candidate") {
        // Keep this global request around so a later CPN snapshot or response
        // header can resolve ownership. Do not lie about CDN/media health yet.
        debug("unattributed Googlevideo request", classification.kind, details.url);
      }
      return;
    }

    session.metrics.cdnRequestsObserved += 1;
    session.network.lastAnyGoogleVideoEpochMs = t;
    if (classification.kind === "media") {
      attachMediaRequest(session, details, record, `webRequest:url:${attribution.method}`);
    } else if (classification.kind === "unknown") {
      session.metrics.unknownGoogleVideoRequests += 1;
      // Unknown Googlevideo traffic is deliberately NOT CDN health.
    }
  }

  function onResponseStarted(details) {
    // This listener intentionally also receives youtube.com responses. Firefox
    // profiles have exhibited a webRequest race where merely registering a
    // response-started listener with responseHeaders restores correct tab IDs.
    const classification = Network.classifyUrl(details.url);
    if (!classification.isGoogleVideo) return;
    let record = requestRecords.get(details.requestId);
    if (!record) {
      record = {
        tabId: null, generation: null, classification,
        attribution: null, method: details.method, startedEpochMs: now(),
        media: false, countedMedia: false
      };
      requestRecords.set(details.requestId, record);
    }
    const responseClass = Network.classifyResponse(details.responseHeaders, classification);
    record.responseBytes = Network.responsePayloadBytes(details.responseHeaders);
    record.responseStartedEpochMs = now();
    if (classification.kind === "pulse") return;

    let session = record.tabId != null ? getSession(record.tabId, false) : null;
    let attribution = record.attribution;
    if (!session) {
      const resolved = resolveRequestSession(details, classification);
      session = resolved.session;
      attribution = resolved.attribution;
      record.attribution = attribution;
    }
    if (!session) return;

    session.metrics.cdnRequestsObserved += 1;
    session.network.lastAnyGoogleVideoEpochMs = now();
    if (responseClass.kind === "media") {
      attachMediaRequest(session, details, record, `webRequest:headers:${attribution?.method || "unknown"}`, responseClass);
    }
  }

  function onBeforeRedirect(details) {
    const record = requestRecords.get(details.requestId);
    if (!record || !details.redirectUrl) return;
    const redirected = Network.classifyUrl(details.redirectUrl);
    if (!redirected.isGoogleVideo) return;
    record.classification = redirected.kind === "unknown" ? record.classification : redirected;
    const session = record.tabId != null ? getSession(record.tabId, false) : null;
    if (session && record.media && redirected.origin) {
      session.network.cdnOrigin = redirected.origin;
      session.network.mediaOrigin = redirected.origin;
      session.network.lastCdnEpochMs = now();
      pushNetworkStatus(session);
    }
  }

  function settlePulseRequest(details, outcome) {
    const pending = pulseRequests.get(details.requestId);
    if (!pending) return false;
    pulseRequests.delete(details.requestId);
    requestRecords.delete(details.requestId);
    const session = getSession(pending.tabId, false);
    if (!session) return true;
    const t = now();
    const rtt = Math.max(0, t - pending.startedEpochMs);
    session.network.lastCdnEpochMs = t;
    session.network.lastPulseRttMs = Math.round(rtt);
    session.network.pulseRttEwmaMs = session.network.pulseRttEwmaMs == null
      ? Math.round(rtt)
      : Math.round((session.network.pulseRttEwmaMs * 0.8) + (rtt * 0.2));
    if (outcome === "completed") session.metrics.pulseCompletions += 1;
    else session.metrics.pulseErrors += 1;
    pushNetworkStatus(session);
    return true;
  }

  function settleMediaRequest(details, outcome) {
    if (settlePulseRequest(details, outcome)) return;
    const record = requestRecords.get(details.requestId);
    if (!record) return;
    requestRecords.delete(details.requestId);
    if (!record.media || record.tabId == null) return;
    const session = getSession(record.tabId, false);
    if (!session || (record.generation != null && record.generation !== session.generation)) return;
    session.activeMediaRequestIds.delete(details.requestId);
    session.network.inflightMedia = session.activeMediaRequestIds.size;
    const t = now();
    session.network.lastMediaEndEpochMs = t;
    session.network.lastMediaActivityEpochMs = t;
    session.network.lastMediaEpochMs = t;
    if (outcome === "completed") session.metrics.mediaCompletions += 1;
    else session.metrics.mediaErrors += 1;
    if (Number.isFinite(details.statusCode)) session.network.lastMediaStatusCode = details.statusCode;
    if (outcome === "completed" && Number(record.responseBytes) >= settings.abrMinSampleBytes && Number(record.startedEpochMs) > 0) {
      const durationMs = Math.max(1, t - Number(record.startedEpochMs));
      const sampleBps = (Number(record.responseBytes) * 8 * 1000) / durationMs;
      const next = Network.updateBandwidthEstimate(session.network, sampleBps, durationMs, {
        fastHalfLifeSeconds: settings.abrFastHalfLifeSeconds,
        slowHalfLifeSeconds: settings.abrSlowHalfLifeSeconds,
        sampleBytes: Number(record.responseBytes)
      });
      Object.assign(session.network, next, { lastBandwidthSampleEpochMs: t });
      session.metrics.bandwidthSamples += 1;
    }
    pushNetworkStatus(session);
  }

  function parseTrackingCurrentTime(raw) {
    try {
      const url = new URL(raw);
      for (const key of ["cmt", "et", "st"]) {
        const value = Number(url.searchParams.get(key));
        if (Number.isFinite(value) && value >= 0) return value;
      }
    } catch (_) {}
    return null;
  }

  function onTrackingBeforeRequest(details) {
    const session = getSession(details.tabId, false);
    if (!session) return;
    const t = now();
    session.network.lastStatsEpochMs = t;
    session.metrics.trackingRequests += 1;
    try {
      const url = new URL(details.url);
      if (url.pathname.endsWith("/watchtime")) {
        session.network.lastWatchtimeEpochMs = t;
        session.network.lastWatchtimeCurrentTime = parseTrackingCurrentTime(details.url);
        session.network.watchtimeRequests += 1;
      }
    } catch (_) {}
    pushNetworkStatus(session);
  }

  function onTrackingCompleted(details) {
    const session = getSession(details.tabId, false);
    if (!session) return;
    try {
      const url = new URL(details.url);
      if (url.pathname.endsWith("/watchtime")) session.network.watchtimeCompletions += 1;
    } catch (_) {}
    pushNetworkStatus(session);
  }

  function onTrackingError(details) {
    const session = getSession(details.tabId, false);
    if (!session) return;
    session.metrics.trackingErrors += 1;
    try {
      const url = new URL(details.url);
      if (url.pathname.endsWith("/watchtime")) session.network.watchtimeErrors += 1;
    } catch (_) {}
    pushNetworkStatus(session);
  }

  function handlePageNetworkHint(session, payload) {
    const hint = payload?.hint || payload || {};
    const classification = Network.classifyUrl(hint.url);
    if (!classification.isGoogleVideo || classification.kind === "pulse") return;
    session.metrics.pageMediaHints += 1;
    session.network.lastAnyGoogleVideoEpochMs = now();
    if (classification.kind === "media" || classification.kind === "media-candidate") {
      if (classification.origin) {
        session.network.cdnOrigin = classification.origin;
        session.network.mediaOrigin = classification.origin;
      }
      if (classification.cpn) {
        session.network.cpn = classification.cpn;
        if (!session.playback.cpn) session.playback.cpn = classification.cpn;
      }
      session.network.lastMediaEpochMs = now();
      session.network.lastMediaActivityEpochMs = now();
      session.network.lastMediaDetectionSource = `page-hint:${hint.source || "performance"}`;
      session.network.lastMediaKind = classification.evidence.includes("sabr:1") ? "sabr" : "videoplayback";
      session.network.lastCdnEpochMs = now();
      pushNetworkStatus(session);
    }
  }

  function handleDemandStatus(session, payload) {
    const detail = payload?.detail || payload || {};
    const t = Number(detail.at) || now();
    if (detail.type === "sabr-patched") {
      session.metrics.sabrPatchesObserved += 1;
      // If an older shaped request never produced actual native-buffer growth
      // inside the effectiveness window, classify it as empty before arming
      // the next causal window. Do not reset a still-live window on every SABR
      // request or we could hide a long run of ineffective patches forever.
      const pending = session.network.pendingDemandPatchEpochMs;
      if (Number.isFinite(pending)
          && t - pending >= settings.demandEffectWindowMs
          && (!Number.isFinite(session.network.lastMediaDeliveryEpochMs)
            || session.network.lastMediaDeliveryEpochMs < pending)) {
        session.metrics.emptySabrPatches += 1;
        session.network.pendingDemandPatchEpochMs = null;
      }
      if (!Number.isFinite(session.network.pendingDemandPatchEpochMs)) {
        session.network.pendingDemandPatchEpochMs = t;
      }
      session.network.lastDemandPatchEpochMs = t;
      session.network.lastDemandPatchPlayerTimeMs = Number(detail.newPlayerTimeMs) || null;
      session.network.lastDemandPatchBufferAhead = Number(detail.bufferAhead) || null;
      session.network.demandState = detail.foundPlayerTime === false ? "shape-skipped" : "sabr-shaped";
    } else if (detail.type === "sabr-patch-skipped") {
      session.metrics.sabrPatchSkipped += 1;
      session.network.demandState = "shape-skipped";
    } else if (detail.type === "sabr-patch-failed") {
      session.metrics.sabrPatchFailures += 1;
      session.network.demandState = "patch-failed";
    } else if (detail.type === "settings") {
      session.network.demandState = settings.mediaDemandMode === "off" ? "off" : "armed";
    }
    session.lastUpdatedEpochMs = t;
    pushNetworkStatus(session);
  }

  function reconcileUnattributedRequests(session) {
    if (!session?.playback?.cpn) return;
    for (const [requestId, record] of requestRecords) {
      if (record.tabId != null || record.classification?.cpn !== session.playback.cpn) continue;
      record.tabId = session.tabId;
      record.generation = session.generation;
      record.attribution = { tabId: session.tabId, method: "cpn-late", confidence: 0.98 };
      session.metrics.cpnAttributions += 1;
      if (record.classification.kind === "media") {
        attachMediaRequest(session, { requestId, method: record.method }, record, "webRequest:late-cpn");
      }
    }
  }

  function mergePlayback(session, payload) {
    const previousGeneration = session.generation;
    const previousBufferedEnd = Number(session.playback.contiguousBufferedEnd || 0);
    const incomingGeneration = Number.isInteger(payload.generation) ? payload.generation : session.generation;
    if (incomingGeneration !== session.generation) {
      session.generation = incomingGeneration;
      resetNetworkForGeneration(session, "content-generation");
    }
    if (typeof payload.url === "string") session.url = payload.url;
    if (payload.playback && typeof payload.playback === "object") {
      session.playback = { ...session.playback, ...payload.playback };
    }
    if (payload.lifecycle && typeof payload.lifecycle === "object") {
      const oldVisibility = session.lifecycle.visibility;
      const oldPageState = session.lifecycle.pageState;
      session.lifecycle = { ...session.lifecycle, ...payload.lifecycle };
      if (oldVisibility !== session.lifecycle.visibility || oldPageState !== session.lifecycle.pageState) {
        session.metrics.lifecycleTransitions += 1;
      }
    }

    // Buffer growth is direct evidence that media bytes arrived, even if a
    // worker-owned request was invisible to webRequest or began before the
    // extension attached. It is intentionally a separate signal from request
    // discovery and never invents a CDN origin.
    const nextBufferedEnd = Number(session.playback.contiguousBufferedEnd || 0);
    if (session.generation === previousGeneration
        && session.playback.playing
        && nextBufferedEnd > previousBufferedEnd + 0.20) {
      markDeliveredMedia(session, now());
    }

    if (session.playback.cpn) session.network.cpn = session.playback.cpn;
    session.lastContentEpochMs = now();
    session.lastContentReason = payload.reason || "snapshot";
    session.lastUpdatedEpochMs = now();
    reconcileUnattributedRequests(session);
  }

  function handlePort(port) {
    if (port.name !== PORT_NAME || !port.sender?.tab?.id) return;
    const tabId = port.sender.tab.id;
    const session = getSession(tabId, true);
    if (session.portConnected) session.metrics.portReconnects += 1;
    session.port = port;
    session.portConnected = true;
    session.url = port.sender.tab.url || session.url;
    session.lastContentEpochMs = now();

    ensureSchedulerAlarm();
    evaluateScheduler("port-connect");
    try { port.postMessage({ type: "BG_HELLO", version: VERSION, settings, status: publicStatus(session) }); } catch (_) {}

    port.onMessage.addListener((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "CONTENT_HELLO" || message.type === "CONTENT_SNAPSHOT" || message.type === "CONTENT_LIFECYCLE") {
        mergePlayback(session, message.payload || {});
        if (message.type === "CONTENT_LIFECYCLE") evaluateScheduler("lifecycle");
      } else if (message.type === "CONTENT_NETWORK_HINT") {
        handlePageNetworkHint(session, message.payload || {});
      } else if (message.type === "CONTENT_DEMAND_STATUS") {
        handleDemandStatus(session, message.payload || {});
      }
    });

    port.onDisconnect.addListener(() => {
      if (session.port === port) {
        session.port = null;
        session.portConnected = false;
        session.lastUpdatedEpochMs = now();
      }
    });
  }

  async function sendContentCommand(tabId, type) {
    const session = getSession(tabId, false);
    try { await browser.tabs.sendMessage(tabId, { type }); }
    catch (_) {}
    return publicStatus(session);
  }

  browser.runtime.onConnect.addListener(handlePort);

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return undefined;
    const tabId = Number(message.tabId);
    if (message.type === "YTBG_BG_GET_STATUS") return Promise.resolve(publicStatus(getSession(tabId, false)));
    if (message.type === "YTBG_BG_WARM_NETWORK") {
      const session = getSession(tabId, false);
      if (!session) return Promise.resolve(publicStatus(null));
      return dispatchPagePulse(session, "manual").then(() => publicStatus(session));
    }
    if (message.type === "YTBG_BG_PRIME") return sendContentCommand(tabId, "YTBG_PRIME");
    if (message.type === "YTBG_BG_APPLY_QUALITY") return sendContentCommand(tabId, "YTBG_APPLY_QUALITY");
    if (message.type === "YTBG_BG_RESET_CIRCUIT") return sendContentCommand(tabId, "YTBG_RESET_CIRCUIT");
    return undefined;
  });

  browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, GOOGLEVIDEO_FILTER);
  browser.webRequest.onResponseStarted.addListener(onResponseStarted, ATTRIBUTION_FILTER, ["responseHeaders"]);
  browser.webRequest.onBeforeRedirect.addListener(onBeforeRedirect, GOOGLEVIDEO_FILTER);
  browser.webRequest.onCompleted.addListener((details) => settleMediaRequest(details, "completed"), GOOGLEVIDEO_FILTER);
  browser.webRequest.onErrorOccurred.addListener((details) => settleMediaRequest(details, "error"), GOOGLEVIDEO_FILTER);
  browser.webRequest.onBeforeRequest.addListener(onTrackingBeforeRequest, TRACKING_FILTER);
  browser.webRequest.onCompleted.addListener(onTrackingCompleted, TRACKING_FILTER);
  browser.webRequest.onErrorOccurred.addListener(onTrackingError, TRACKING_FILTER);

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SCHEDULER_ALARM) evaluateScheduler("alarm");
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    sessions.delete(tabId);
    ensureSchedulerAlarm();
  });
  browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    sessions.delete(removedTabId);
    const session = getSession(addedTabId, true);
    resetNetworkForGeneration(session, "tab-replaced");
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;
    const session = getSession(tabId, false);
    if (!session) return;
    session.url = changeInfo.url;
    session.generation += 1;
    resetNetworkForGeneration(session, "tab-url-updated");
    if (!changeInfo.url.startsWith("https://www.youtube.com/")) {
      sessions.delete(tabId);
      ensureSchedulerAlarm();
    } else session.url = tab.url || changeInfo.url;
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    const incoming = changes[STORAGE_KEY].newValue || {};
    const normalized = standardizeSettings(incoming);
    settings = normalized;
    if (!settingsEqual(incoming, normalized)) {
      // Policy migration / repair: retain only the small user preference surface
      // and restore the canonical ZigZag operating contract plus preserved user preferences.
      void browser.storage.local.set({ [STORAGE_KEY]: normalized });
    }
    ensureSchedulerAlarm();
    for (const session of sessions.values()) {
      try { session.port?.postMessage({ type: "BG_SETTINGS", settings }); } catch (_) {}
    }
    evaluateScheduler("settings");
  });

  async function initialize() {
    try {
      const stored = await browser.storage.local.get(STORAGE_KEY);
      const incoming = stored[STORAGE_KEY] || {};
      settings = standardizeSettings(incoming);
      if (!settingsEqual(incoming, settings)) {
        await browser.storage.local.set({ [STORAGE_KEY]: settings });
      }
    } catch (_) {
      settings = standardizeSettings();
    }
    startWorker("initialize");
    ensureSchedulerAlarm();
    evaluateScheduler("initialize");
    debug("background ready", VERSION, settings.policyProfile, settings.policyVersion);
  }

  browser.runtime.onStartup.addListener(() => { void initialize(); });
  browser.runtime.onInstalled.addListener(() => { void initialize(); });
  void initialize();
})();
