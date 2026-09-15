/* YouTube Buffer Guardian - pure Google Video request classification. MIT. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YTBufferNetworkCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MEDIA_QUERY_KEYS = Object.freeze([
    "sabr", "ump", "source", "itag", "mime", "range", "cpn", "expire", "lsig", "clen", "dur"
  ]);

  function parseUrl(raw) {
    try { return new URL(raw); } catch (_) { return null; }
  }

  function isGoogleVideoHost(hostname) {
    const h = String(hostname || "").toLowerCase();
    return h === "googlevideo.com" || h.endsWith(".googlevideo.com");
  }

  function classifyUrl(raw) {
    const url = parseUrl(raw);
    if (!url || !isGoogleVideoHost(url.hostname)) {
      return { isGoogleVideo: false, kind: "other", confidence: 0, evidence: [], cpn: null, origin: null };
    }

    const path = url.pathname.toLowerCase();
    const evidence = [];
    const pulse = path.includes("generate_204") && url.searchParams.has("ytbg");
    if (pulse) {
      return {
        isGoogleVideo: true,
        kind: "pulse",
        confidence: 1,
        evidence: ["ytbg-pulse"],
        cpn: null,
        origin: url.origin,
        url
      };
    }

    const videoPath = path === "/videoplayback" || path.startsWith("/videoplayback/") || path.includes("/videoplayback/");
    if (videoPath) evidence.push("videoplayback-path");
    for (const key of MEDIA_QUERY_KEYS) {
      if (url.searchParams.has(key)) evidence.push(`query:${key}`);
    }
    if (url.searchParams.get("source") === "youtube") evidence.push("source:youtube");
    if (url.searchParams.get("sabr") === "1") evidence.push("sabr:1");
    if (url.searchParams.get("ump") === "1") evidence.push("ump:1");

    // Mirrors the maintained LuanRT/googlevideo URL classifier conceptually:
    // videoplayback path + YouTube/SABR query evidence is a media request.
    let confidence = 0;
    if (videoPath) confidence = 0.90;
    if (videoPath && evidence.length >= 2) confidence = 0.98;
    if (!videoPath && (url.searchParams.has("sabr") || url.searchParams.has("ump"))) confidence = 0.72;

    return {
      isGoogleVideo: true,
      kind: confidence >= 0.85 ? "media" : (confidence >= 0.60 ? "media-candidate" : "unknown"),
      confidence,
      evidence,
      cpn: url.searchParams.get("cpn") || null,
      origin: url.origin,
      url
    };
  }

  function headerValue(headers, wantedName) {
    if (!Array.isArray(headers)) return null;
    const target = String(wantedName).toLowerCase();
    const item = headers.find((h) => String(h?.name || "").toLowerCase() === target);
    return item?.value == null ? null : String(item.value);
  }

  function classifyResponse(headers, urlClassification) {
    const contentType = (headerValue(headers, "content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType === "application/vnd.yt-ump") {
      return { kind: "media", mediaKind: "sabr-ump", confidence: 1, contentType, evidence: ["content-type:yt-ump"] };
    }
    if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
      return { kind: "media", mediaKind: "classic-media", confidence: 1, contentType, evidence: [`content-type:${contentType}`] };
    }
    if (urlClassification?.kind === "media") {
      return {
        kind: "media",
        mediaKind: urlClassification.evidence?.includes("sabr:1") || urlClassification.evidence?.includes("ump:1") ? "sabr" : "videoplayback",
        confidence: urlClassification.confidence,
        contentType,
        evidence: ["url-confirmed"]
      };
    }
    if (contentType === "application/octet-stream" && urlClassification?.kind === "media-candidate") {
      return { kind: "media", mediaKind: "binary-media", confidence: 0.85, contentType, evidence: ["binary+candidate"] };
    }
    return { kind: urlClassification?.kind || "unknown", mediaKind: null, confidence: urlClassification?.confidence || 0, contentType, evidence: [] };
  }


  function responsePayloadBytes(headers) {
    const contentLength = Number(headerValue(headers, "content-length"));
    if (Number.isFinite(contentLength) && contentLength > 0) return contentLength;
    const contentRange = headerValue(headers, "content-range");
    if (contentRange) {
      const m = /bytes\s+(\d+)-(\d+)\/(?:\d+|\*)/i.exec(contentRange);
      if (m) {
        const start = Number(m[1]);
        const end = Number(m[2]);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return (end - start) + 1;
      }
    }
    return 0;
  }

  function ewmaSample(previous, sample, weightSeconds, halfLifeSeconds) {
    const value = Number(sample);
    const weight = Math.max(0.001, Number(weightSeconds) || 0.001);
    const halfLife = Math.max(0.1, Number(halfLifeSeconds) || 1);
    if (!Number.isFinite(value) || value <= 0) return Number(previous) || 0;
    if (!Number.isFinite(previous) || previous <= 0) return value;
    const alpha = 1 - Math.exp(Math.log(0.5) * weight / halfLife);
    return previous + alpha * (value - previous);
  }

  function updateBandwidthEstimate(state = {}, sampleBps, durationMs, config = {}) {
    const bps = Number(sampleBps);
    const duration = Math.max(50, Number(durationMs) || 0);
    if (!Number.isFinite(bps) || bps <= 0 || duration <= 0) return { ...state };
    const weightSeconds = duration / 1000;
    const fastHalfLifeSeconds = Math.max(0.1, Number(config.fastHalfLifeSeconds) || 3);
    const slowHalfLifeSeconds = Math.max(fastHalfLifeSeconds, Number(config.slowHalfLifeSeconds) || 9);
    const fast = ewmaSample(state.bandwidthFastBps, bps, weightSeconds, fastHalfLifeSeconds);
    const slow = ewmaSample(state.bandwidthSlowBps, bps, weightSeconds, slowHalfLifeSeconds);
    const estimate = Math.min(fast, slow);
    const sampleCount = Math.max(0, Number(state.bandwidthSampleCount) || 0) + 1;
    const instability = slow > 0 ? Math.min(5, Math.abs(fast - slow) / slow) : 0;
    return {
      ...state,
      bandwidthFastBps: fast,
      bandwidthSlowBps: slow,
      bandwidthEstimateBps: estimate,
      bandwidthSampleCount: sampleCount,
      bandwidthLastSampleBps: bps,
      bandwidthLastSampleBytes: Math.max(0, Number(config.sampleBytes) || 0),
      bandwidthLastSampleDurationMs: duration,
      bandwidthInstability: instability
    };
  }

  function youtubeVideoId(raw) {
    const url = parseUrl(raw);
    if (!url || !/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    if (url.pathname === "/watch") return url.searchParams.get("v") || null;
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] || null;
    if (url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2] || null;
    return null;
  }

  function resolveOwner(details, requestClass, sessionList) {
    const sessions = Array.isArray(sessionList) ? sessionList : [];
    const direct = sessions.find((s) => s.tabId === details?.tabId);
    if (direct) return { tabId: direct.tabId, method: "tab-id", confidence: 1 };

    const cpn = requestClass?.cpn;
    if (cpn) {
      const matches = sessions.filter((s) => s.playback?.cpn && s.playback.cpn === cpn);
      if (matches.length === 1) return { tabId: matches[0].tabId, method: "cpn", confidence: 0.98 };
    }

    const refVideoId = youtubeVideoId(details?.documentUrl) || youtubeVideoId(details?.originUrl);
    if (refVideoId) {
      const matches = sessions.filter((s) => s.playback?.videoId === refVideoId);
      if (matches.length === 1) return { tabId: matches[0].tabId, method: "video-id", confidence: 0.92 };
    }

    const playing = sessions.filter((s) => s.playback?.playing && !s.playback?.paused && !s.playback?.ended);
    if (playing.length === 1 && requestClass?.confidence >= 0.85) {
      return { tabId: playing[0].tabId, method: "single-playing-session", confidence: 0.65 };
    }

    if (sessions.length === 1 && requestClass?.confidence >= 0.95) {
      return { tabId: sessions[0].tabId, method: "single-session", confidence: 0.55 };
    }

    return { tabId: null, method: "unattributed", confidence: 0 };
  }

  function transportHealth(input = {}, settings = {}) {
    const inflightMedia = Number(input.inflightMedia || 0);
    const mediaAgeMs = Number.isFinite(input.mediaAgeMs) ? input.mediaAgeMs : Infinity;
    const deliveryAgeMs = Number.isFinite(input.deliveryAgeMs) ? input.deliveryAgeMs : Infinity;
    const pulseAgeMs = Number.isFinite(input.pulseAgeMs) ? input.pulseAgeMs : Infinity;
    const pulseRttMs = Number.isFinite(input.pulseRttMs) ? input.pulseRttMs : null;
    const recentWindow = Math.max(Number(settings.mediaActiveWindowMs) || 1400, 2000);
    const warmWindow = Math.max((Number(settings.keepaliveIntervalMs) || 3000) * 2.2, 7000);

    const streamFreshWindow = Math.max(recentWindow * 3, 6000);
    if (inflightMedia > 0 && Math.min(mediaAgeMs, deliveryAgeMs) <= streamFreshWindow) return "media-streaming";
    if (inflightMedia > 0) return "media-request-stale";
    if (mediaAgeMs <= recentWindow || deliveryAgeMs <= recentWindow) return "media-active";
    if (pulseAgeMs <= warmWindow && pulseRttMs != null) return pulseRttMs <= 800 ? "warm" : "slow";
    return input.hasOrigin ? "idle" : "undiscovered";
  }

  function mediaHealth(input = {}, settings = {}) {
    const inflightMedia = Number(input.inflightMedia || 0);
    const mediaAgeMs = Number.isFinite(input.mediaAgeMs) ? input.mediaAgeMs : Infinity;
    const deliveryAgeMs = Number.isFinite(input.deliveryAgeMs) ? input.deliveryAgeMs : Infinity;
    const bufferAhead = Math.max(0, Number(input.bufferAhead || 0));
    const recentWindow = Math.max(Number(settings.mediaActiveWindowMs) || 1400, 2000);
    const streamFreshWindow = Math.max(recentWindow * 3, 6000);
    if (inflightMedia > 0 && Math.min(mediaAgeMs, deliveryAgeMs) <= streamFreshWindow) return "streaming";
    if (inflightMedia > 0) return "stalled-request";
    if (deliveryAgeMs <= recentWindow) return "delivering";
    if (mediaAgeMs <= recentWindow) return "request-active";
    if (Number.isFinite(input.lastMediaEpochMs)) return "idle";
    if (bufferAhead > 0.75) return "buffer-observed";
    return "unseen";
  }

  return {
    MEDIA_QUERY_KEYS,
    parseUrl,
    isGoogleVideoHost,
    classifyUrl,
    classifyResponse,
    headerValue,
    responsePayloadBytes,
    ewmaSample,
    updateBandwidthEstimate,
    youtubeVideoId,
    resolveOwner,
    transportHealth,
    mediaHealth
  };
});
