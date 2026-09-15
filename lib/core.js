/* 1440, Please - pure buffer / network policy. MIT. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YTBufferCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RESOLUTION_PRESETS = Object.freeze([
    { height: 4320, label: "4320p (8K)" },
    { height: 2880, label: "2880p (5K)" },
    { height: 2160, label: "2160p (4K)" },
    { height: 1440, label: "1440p (QHD)" },
    { height: 1080, label: "1080p (FHD)" },
    { height: 900, label: "900p" },
    { height: 720, label: "720p (HD)" },
    { height: 576, label: "576p" },
    { height: 540, label: "540p" },
    { height: 480, label: "480p" },
    { height: 432, label: "432p" },
    { height: 360, label: "360p" },
    { height: 240, label: "240p" },
    { height: 144, label: "144p" }
  ]);

  const POLICY_VERSION = 23;
  const POLICY_PROFILE = "zigzag-1440-soft-warmup-v5";
  const USER_PREFERENCE_KEYS = Object.freeze([
    "enabled", "rampProfile"
  ]);


  const RAMP_PROFILE_OVERRIDES = Object.freeze({
    defensive: Object.freeze({}),
    aggressive: Object.freeze({
      // Upward decisions only: keep the proven transition/emergency protections intact.
      twoStageBootstrapBufferSeconds: 12,
      twoStageBootstrapStableMs: 4000,
      twoStageBootstrapMinPlaybackMs: 12000,
      twoStagePreferredRangeWarmupMs: 12000,
      twoStagePreferredRangeStableMs: 3000,
      twoStageFallbackMinHoldMs: 15000,
      twoStageRecoveryBufferSeconds: 12,
      twoStageRecoveryStableMs: 4000,
      twoStageUpgradeCapacityStableMs: 2000,
      twoStageDriftRepairMs: 4000,
      twoStageSwitchCooldownMs: 6000,
      zigzagPreferredRecoveryBufferSeconds: 4.5,
      zigzagPreferredRecoveryStableMs: 1800
    })
  });

  const DEFAULTS = Object.freeze({
    policyVersion: POLICY_VERSION,
    policyProfile: POLICY_PROFILE,

    // User-facing preferences. Everything else below is standardized policy.
    enabled: true,
    preferredResolution: 1440,
    rampProfile: "defensive",
    debug: false, // internal-only; no visible debug control

    // Native-network-safe protection: observe native delivery; never rewrite SABR or kick a playing stream.
    // The only page-start mutation is YouTube's own static player read-ahead policy, before media requests begin.
    nativeReadaheadEnabled: true,
    nativeReadaheadFloorSeconds: 15,
    nativeReadaheadGoalSeconds: 30,
    nativeReadaheadCeilingSeconds: 160,
    nativeReadaheadGrowthRateMs: 300,

    pausedPrebuffer: true,
    networkKeepWarm: true,
    networkKeepWarmMode: "aggressive",
    mediaDemandEnabled: false,
    mediaDemandMode: "off",
    qualityEnabled: true,
    // v0.17: two-stage quality ownership. 1440p is the preferred locked tier;
    // 1080p is the only temporary fallback. Buffer health may trigger a fallback only
    // under hard starvation evidence, never ordinary 20-90 s sawtooth.
    adaptiveQuality: true,
    twoStageQualityEnabled: true,
    fallbackResolution: 1080,
    twoStageHardFallbackBufferSeconds: 0.60,
    twoStageRiskFallbackBufferSeconds: 1.25,
    twoStageHardFallbackDwellMs: 1200,
    twoStageFallbackMinHoldMs: 30000,
    twoStageRecoveryBufferSeconds: 18,
    twoStageRecoveryStableMs: 8000,
    twoStageRecoveryMinTrendPerSecond: -0.03,
    // v0.17.3 soft-warmup quality controller. Early playback and representation
    // transitions have different stability economics from late steady state.
    twoStageBootstrapBufferSeconds: 18,
    twoStageBootstrapStableMs: 8000,
    twoStageBootstrapMinTrendPerSecond: -0.03,
    twoStageBootstrapMinPlaybackMs: 30000,
    twoStagePreferredRangeWarmupMs: 30000,
    twoStagePreferredRangeStableMs: 5000,
    twoStagePreferredTransitionGraceMs: 45000,
    twoStageFallbackTransitionGraceMs: 8000,
    twoStagePreferredEmergencyBufferSeconds: 0.35,
    twoStagePreferredEmergencyDwellMs: 3000,
    twoStagePreferredTransitionAbortNotBeforeMs: 10000,
    twoStagePreferredTransitionDeliverySilenceMs: 5500,
    twoStagePreferredRetryBackoffMs: 75000,
    twoStagePreferredLeaseMs: 90000,
    twoStageCruiseEnterBufferSeconds: 15,
    twoStageCruiseEnterStableMs: 6000,
    twoStageCruiseCollapseBufferSeconds: 12,
    twoStageCruiseRiskBufferSeconds: 1.5,
    twoStageCruiseDeliverySilenceMs: 6500,
    twoStageCruiseCollapseDwellMs: 1500,
    // v0.17: sustainability governor. A preferred tier that cannot build
    // reservoir is downgraded before starvation; an upshift requires measured
    // delivery headroom rather than a blind timer.
    twoStageCapacityWindowMs: 20000,
    twoStagePreferredWatchBufferSeconds: 12,
    twoStagePreferredMinGrowthPerSecond: -0.03,
    twoStagePreferredCapacityDwellMs: 12000,
    twoStagePreferredMaxTargetEtaSeconds: 90,
    twoStageUpgradeHeadroomRatio: 1.08,
    twoStageUpgradeFallbackMinTrendPerSecond: 0.05,
    twoStageUpgradeCapacityStableMs: 2500,
    twoStageRecoveryForcedRetryMs: 180000, // retained only for storage compatibility; blind retry is disabled
    twoStageTransitionGraceMs: 12000, // legacy alias
    twoStageDriftRepairMs: 6000,
    twoStageSwitchCooldownMs: 8000,

    // v0.17 hybrid ABR: watermarks are reservoir preferences, never definitive quality judges.
    // Delivery capacity is estimated from completed media requests using a fast/slow EWMA
    // (hls.js/Shaka-style). Buffer slope and time-to-empty are independent safety signals.
    abrFastHalfLifeSeconds: 3,
    abrSlowHalfLifeSeconds: 9,
    abrMinBandwidthSamples: 2,
    abrMinSampleBytes: 65536,
    abrDowngradeHeadroomRatio: 0.90,
    abrUpgradeHeadroomRatio: 1.08,
    abrStableLowBufferMinSeconds: 2.25,
    abrPredictiveFallbackTtzSeconds: 5.5,
    abrDeficitDwellMs: 12000,
    abrUpgradeStableMs: 2500,
    abrMaxInstabilityRatio: 0.60,
    abrFallbackTrendPerSecond: -0.12,
    abrUpgradeFallbackTrendPerSecond: 0.05,

    // ZigZag family: empirical refill-cycle health can override pessimistic
    // instantaneous throughput / time-to-zero estimates.
    zigzagWindowMs: 24000,
    zigzagMinCycles: 2,
    zigzagMinTroughSeconds: 2.0,
    zigzagMaxPeriodMs: 6500,
    zigzagMaxPeriodJitterRatio: 0.45,
    zigzagMinAmplitudeSeconds: 1.5,
    zigzagRefillDeadlineMarginMs: 1200,
    zigzagPreferredRecoveryBufferSeconds: 5.5,
    zigzagPreferredRecoveryStableMs: 2500,

    // Local shadow checkpoint: independent of YouTube account/watch-history persistence.
    // It only auto-restores after a recent playback failure and a large stale-resume gap.
    localResumeEnabled: true,
    checkpointSaveIntervalMs: 10000,
    localResumeFailureWindowMs: 600000,
    localResumeMaxAgeMs: 43200000,
    localResumeMinLagSeconds: 30,
    localResumeRewindSeconds: 3,

    // ZigZag reservoir preferences: ~30 s is healthy and ~15 s is the warm band.
    // These are observability/read-ahead goals, never definitive quality gates.
    pausedTargetSeconds: 30,
    targetBufferSeconds: 30,
    warmLowWatermarkSeconds: 15,
    criticalWatermarkSeconds: 3,

    // Legacy demand knobs are retained for storage compatibility but production policy keeps them disabled.
    mediaDemandStartBufferSeconds: 90,
    mediaDemandIdleMs: 1000,
    mediaDemandEmergencyIdleMs: 600,
    mediaDemandKickBufferSeconds: 90,
    mediaDemandKickCooldownMs: 3000,
    mediaDemandEmergencyKickCooldownMs: 1500,
    mediaDemandEdgeMarginSeconds: 0.10,
    mediaDemandRbufZero: false,

    // Bidirectional quality ladder. Degradation protects the 60 s working floor;
    // recovery starts from usable headroom instead of waiting for an 82 s near-target
    // buffer that a degraded tier may never reach. Every upshift is a bounded trial.
    qualityFallback: "lower",
    minimumAdaptiveResolution: 720,
    qualityDownshiftBufferSeconds: 60,
    qualityDownshiftDwellMs: 1000,
    qualityRecoveryBufferSeconds: 68, // legacy alias for first recovery step
    qualityRecoveryFirstStepBufferSeconds: 68,
    qualityRecoveryFinalStepBufferSeconds: 76,
    qualityRecoveryStableMs: 6000,
    qualityRecoveryFinalStableMs: 7000,
    qualityRecoveryMinTrendPerSecond: -0.05,
    qualityStepCooldownMs: 4000,
    qualityTrialMinObserveMs: 2500,
    qualityTrialSettleMs: 8000,
    qualityTrialRollbackBufferSeconds: 58,
    qualityTrialRollbackDropSeconds: 8,
    qualityTrialRollbackTrendPerSecond: -0.25,
    qualityRecoveryRetryMs: 15000,

    // Cold-start guard: the old full-arm threshold intentionally waits for proven playback.
    // High-bitrate streams can starve before that threshold, so quality may now be capped
    // immediately AFTER the first real playing event (never before first playback).
    coldStartGuardEnabled: false,
    coldStartBootstrapCapResolution: 1080,
    coldStartEmergencyBufferSeconds: 3.5,
    coldStartExitBufferSeconds: 12,
    coldStartMaxMs: 15000,
    coldStartMinObserveMs: 350,
    coldStartEmergencyObserveMs: 900,
    coldStartStepCooldownMs: 1200,

    // Startup ramp: after native playback is proven, use quality headroom—not
    // network or seek mutation—to stop the first ~30 s buffer from draining.
    // Hand steady-state control over only after >=60 s is sustained.
    startupRampEnabled: false,
    startupRampMinObserveMs: 1500,
    startupRampMaxMs: 60000,
    startupRampSoftFloorSeconds: 42,
    startupRampEmergencySeconds: 8,
    startupRampExitBufferSeconds: 60,
    startupRampExitStableMs: 4000,
    startupRampMinGrowthPerSecond: 0.12,

    // Pre-play bootstrap remains strictly observational. After the first real `playing`
    // event but before full arm, only the bounded cold-start QUALITY guard may act.
    // No priming, request shaping, keep-warm pulses, or scheduler kicks are allowed.
    startupArmMinPlaybackSeconds: 2.0,
    startupArmMinBufferSeconds: 5.0,
    startupArmMinReadyState: 3,
    startupArmMinWallMs: 1500,
    startupArmPostGraceMs: 2000,

    // Aggressive transport cadence below target; relaxed only once >= 90 s.
    mediaActiveWindowMs: 1200,
    mediaIdleWarmMs: 750,
    keepaliveIntervalMs: 1500,
    keepaliveEmergencyIntervalMs: 750,
    keepaliveHealthyIntervalMs: 6000,
    pulseEffectWindowMs: 5000,
    demandEffectWindowMs: 6000,
    schedulerTickMs: 500,
    contentReportMinMs: 250,
    contentStaleMs: 12000,
    portReconnectBaseMs: 200,
    portReconnectMaxMs: 3000,

    // Paused edge priming follows the same ~30 s ZigZag reservoir target.
    pausePrimeDelayMs: 600,
    maxPumpRounds: 12,
    pumpWaitMs: 1200,
    maxInterventionMs: 20000,
    circuitBreakerMs: 60000,
    maxFailedPumpsBeforeCircuit: 4,
    maxPlayerReplacementsPer20Sec: 2,
    minBufferGrowthSeconds: 0.75,
    edgeSeekEpsilonSeconds: 0.08,
    originalRangeGuardSeconds: 0.12
  });

  function finiteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rangesToArray(ranges) {
    const out = [];
    if (!ranges || typeof ranges.length !== "number") return out;
    for (let i = 0; i < ranges.length; i += 1) {
      try {
        const start = finiteNumber(ranges.start(i), NaN);
        const end = finiteNumber(ranges.end(i), NaN);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) out.push({ start, end });
      } catch (_) {
        // TimeRanges can mutate while iterating.
      }
    }
    return out;
  }

  function findContainingRange(rangesOrTimeRanges, time, tolerance = 0.12) {
    const ranges = Array.isArray(rangesOrTimeRanges) ? rangesOrTimeRanges : rangesToArray(rangesOrTimeRanges);
    const t = finiteNumber(time, 0);
    const direct = ranges.find((r) => t >= r.start && t <= r.end);
    if (direct) return direct;
    return ranges.find((r) => t < r.start && r.start - t <= tolerance) || null;
  }

  function contiguousBuffer(rangesOrTimeRanges, currentTime, tolerance = 0.12) {
    const ranges = Array.isArray(rangesOrTimeRanges) ? rangesOrTimeRanges : rangesToArray(rangesOrTimeRanges);
    const t = finiteNumber(currentTime, 0);
    const range = findContainingRange(ranges, t, tolerance);
    if (!range) return { ahead: 0, start: 0, end: t, range: null };
    return {
      ahead: Math.max(0, range.end - t),
      start: range.start,
      end: range.end,
      range
    };
  }

  function bufferAhead(rangesOrTimeRanges, currentTime, tolerance = 0.12) {
    return contiguousBuffer(rangesOrTimeRanges, currentTime, tolerance).ahead;
  }

  function effectiveBufferSeconds(mediaSeconds, playbackRate = 1, paused = false) {
    const media = Math.max(0, finiteNumber(mediaSeconds, 0));
    if (paused) return media;
    const rate = Math.max(0.05, Math.abs(finiteNumber(playbackRate, 1)));
    return media / rate;
  }

  function furthestBufferedEnd(rangesOrTimeRanges) {
    const ranges = Array.isArray(rangesOrTimeRanges) ? rangesOrTimeRanges : rangesToArray(rangesOrTimeRanges);
    return ranges.reduce((max, range) => Math.max(max, range.end), 0);
  }

  function isBuffered(rangesOrTimeRanges, time, tolerance = 0.12) {
    return Boolean(findContainingRange(rangesOrTimeRanges, time, tolerance));
  }

  function trend(samples) {
    if (!Array.isArray(samples) || samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = (last.at - first.at) / 1000;
    if (!(dt > 0)) return 0;
    return (last.bufferAhead - first.bufferAhead) / dt;
  }

  function median(values) {
    const xs = (Array.isArray(values) ? values : []).filter(Number.isFinite).sort((a, b) => a - b);
    if (!xs.length) return 0;
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  }

  function zigzagMetrics(samplesInput) {
    const samples = (Array.isArray(samplesInput) ? samplesInput : [])
      .map((p) => ({ at: finiteNumber(p?.at, NaN), bufferAhead: Math.max(0, finiteNumber(p?.bufferAhead, NaN)) }))
      .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.bufferAhead))
      .sort((a, b) => a.at - b.at);
    if (samples.length < 5) return { cycles: 0, periodMs: 0, periodJitterRatio: Infinity, trough: 0, peak: 0, amplitude: 0, refillSlope: 0, lastRefillAgeMs: Infinity };
    const extrema = [];
    let direction = 0;
    const epsilon = 0.12;
    for (let i = 1; i < samples.length; i += 1) {
      const diff = samples[i].bufferAhead - samples[i - 1].bufferAhead;
      const nextDirection = diff > epsilon ? 1 : (diff < -epsilon ? -1 : 0);
      if (!nextDirection) continue;
      if (direction && nextDirection !== direction) {
        const pivot = samples[i - 1];
        extrema.push({ ...pivot, type: direction > 0 ? "peak" : "trough" });
      }
      direction = nextDirection;
    }
    const troughs = extrema.filter((x) => x.type === "trough");
    const peaks = extrema.filter((x) => x.type === "peak");
    const periods = [];
    for (let i = 1; i < troughs.length; i += 1) periods.push(troughs[i].at - troughs[i - 1].at);
    const amplitudes = [];
    const refillSlopes = [];
    for (const troughPoint of troughs) {
      const peakPoint = peaks.find((x) => x.at > troughPoint.at);
      if (!peakPoint) continue;
      const amp = peakPoint.bufferAhead - troughPoint.bufferAhead;
      const dt = (peakPoint.at - troughPoint.at) / 1000;
      if (amp > 0 && dt > 0) { amplitudes.push(amp); refillSlopes.push(amp / dt); }
    }
    const periodMs = median(periods);
    const deviations = periods.map((x) => Math.abs(x - periodMs));
    const lastAt = samples[samples.length - 1].at;
    const lastRefillPoint = [...peaks].reverse().find((x) => x.at <= lastAt) || [...troughs].reverse().find((x) => x.at <= lastAt) || samples[samples.length - 1];
    return {
      cycles: periods.length,
      periodMs,
      periodJitterRatio: periodMs > 0 ? median(deviations) / periodMs : Infinity,
      trough: median(troughs.map((x) => x.bufferAhead)),
      peak: median(peaks.map((x) => x.bufferAhead)),
      amplitude: median(amplitudes),
      refillSlope: median(refillSlopes),
      lastRefillAgeMs: Math.max(0, lastAt - lastRefillPoint.at),
      extremaCount: extrema.length
    };
  }

  function mergeSettings(value) {
    const merged = { ...DEFAULTS, ...(value || {}) };
    merged.rampProfile = merged.rampProfile === "aggressive" ? "aggressive" : "defensive";
    merged.preferredResolution = finiteNumber(merged.preferredResolution, DEFAULTS.preferredResolution);
    if (!RESOLUTION_PRESETS.some((p) => p.height === merged.preferredResolution)) {
      merged.preferredResolution = DEFAULTS.preferredResolution;
    }
    merged.fallbackResolution = finiteNumber(merged.fallbackResolution, DEFAULTS.fallbackResolution);
    if (!RESOLUTION_PRESETS.some((p) => p.height === merged.fallbackResolution)) merged.fallbackResolution = DEFAULTS.fallbackResolution;
    merged.fallbackResolution = Math.min(merged.preferredResolution, merged.fallbackResolution);
    merged.twoStageHardFallbackBufferSeconds = clamp(finiteNumber(merged.twoStageHardFallbackBufferSeconds, DEFAULTS.twoStageHardFallbackBufferSeconds), 0.5, 10);
    merged.twoStageRiskFallbackBufferSeconds = clamp(finiteNumber(merged.twoStageRiskFallbackBufferSeconds, DEFAULTS.twoStageRiskFallbackBufferSeconds), merged.twoStageHardFallbackBufferSeconds, 15);
    merged.twoStageHardFallbackDwellMs = clamp(finiteNumber(merged.twoStageHardFallbackDwellMs, DEFAULTS.twoStageHardFallbackDwellMs), 250, 10000);
    merged.twoStageFallbackMinHoldMs = clamp(finiteNumber(merged.twoStageFallbackMinHoldMs, DEFAULTS.twoStageFallbackMinHoldMs), 3000, 120000);
    merged.twoStageRecoveryBufferSeconds = clamp(finiteNumber(merged.twoStageRecoveryBufferSeconds, DEFAULTS.twoStageRecoveryBufferSeconds), 1, 120);
    merged.twoStageRecoveryStableMs = clamp(finiteNumber(merged.twoStageRecoveryStableMs, DEFAULTS.twoStageRecoveryStableMs), 1000, 30000);
    merged.twoStageRecoveryMinTrendPerSecond = clamp(finiteNumber(merged.twoStageRecoveryMinTrendPerSecond, DEFAULTS.twoStageRecoveryMinTrendPerSecond), -0.5, 2);
    merged.twoStageBootstrapBufferSeconds = clamp(finiteNumber(merged.twoStageBootstrapBufferSeconds, DEFAULTS.twoStageBootstrapBufferSeconds), 3, 40);
    merged.twoStageBootstrapStableMs = clamp(finiteNumber(merged.twoStageBootstrapStableMs, DEFAULTS.twoStageBootstrapStableMs), 1000, 30000);
    merged.twoStageBootstrapMinTrendPerSecond = clamp(finiteNumber(merged.twoStageBootstrapMinTrendPerSecond, DEFAULTS.twoStageBootstrapMinTrendPerSecond), -0.5, 1);
    merged.twoStageBootstrapMinPlaybackMs = clamp(finiteNumber(merged.twoStageBootstrapMinPlaybackMs, DEFAULTS.twoStageBootstrapMinPlaybackMs), 0, 120000);
    merged.twoStagePreferredRangeWarmupMs = clamp(finiteNumber(merged.twoStagePreferredRangeWarmupMs, DEFAULTS.twoStagePreferredRangeWarmupMs), 5000, 120000);
    merged.twoStagePreferredRangeStableMs = clamp(finiteNumber(merged.twoStagePreferredRangeStableMs, DEFAULTS.twoStagePreferredRangeStableMs), 1000, 30000);
    merged.twoStagePreferredTransitionGraceMs = clamp(finiteNumber(merged.twoStagePreferredTransitionGraceMs, DEFAULTS.twoStagePreferredTransitionGraceMs), 5000, 90000);
    merged.twoStageFallbackTransitionGraceMs = clamp(finiteNumber(merged.twoStageFallbackTransitionGraceMs, DEFAULTS.twoStageFallbackTransitionGraceMs), 2000, 30000);
    merged.twoStagePreferredEmergencyBufferSeconds = clamp(finiteNumber(merged.twoStagePreferredEmergencyBufferSeconds, DEFAULTS.twoStagePreferredEmergencyBufferSeconds), 0.1, 3);
    merged.twoStagePreferredEmergencyDwellMs = clamp(finiteNumber(merged.twoStagePreferredEmergencyDwellMs, DEFAULTS.twoStagePreferredEmergencyDwellMs), 250, 5000);
    merged.twoStagePreferredTransitionAbortNotBeforeMs = clamp(finiteNumber(merged.twoStagePreferredTransitionAbortNotBeforeMs, DEFAULTS.twoStagePreferredTransitionAbortNotBeforeMs), 0, 30000);
    merged.twoStagePreferredTransitionDeliverySilenceMs = clamp(finiteNumber(merged.twoStagePreferredTransitionDeliverySilenceMs, DEFAULTS.twoStagePreferredTransitionDeliverySilenceMs), 1000, 30000);
    merged.twoStagePreferredRetryBackoffMs = clamp(finiteNumber(merged.twoStagePreferredRetryBackoffMs, DEFAULTS.twoStagePreferredRetryBackoffMs), 5000, 180000);
    merged.twoStagePreferredLeaseMs = clamp(finiteNumber(merged.twoStagePreferredLeaseMs, DEFAULTS.twoStagePreferredLeaseMs), 10000, 180000);
    merged.twoStageCruiseEnterBufferSeconds = clamp(finiteNumber(merged.twoStageCruiseEnterBufferSeconds, DEFAULTS.twoStageCruiseEnterBufferSeconds), 8, 60);
    merged.twoStageCruiseEnterStableMs = clamp(finiteNumber(merged.twoStageCruiseEnterStableMs, DEFAULTS.twoStageCruiseEnterStableMs), 1000, 30000);
    merged.twoStageCruiseCollapseBufferSeconds = clamp(finiteNumber(merged.twoStageCruiseCollapseBufferSeconds, DEFAULTS.twoStageCruiseCollapseBufferSeconds), 3, 30);
    merged.twoStageCruiseRiskBufferSeconds = clamp(finiteNumber(merged.twoStageCruiseRiskBufferSeconds, DEFAULTS.twoStageCruiseRiskBufferSeconds), 0.5, merged.twoStageCruiseCollapseBufferSeconds);
    merged.twoStageCruiseDeliverySilenceMs = clamp(finiteNumber(merged.twoStageCruiseDeliverySilenceMs, DEFAULTS.twoStageCruiseDeliverySilenceMs), 2000, 30000);
    merged.twoStageCruiseCollapseDwellMs = clamp(finiteNumber(merged.twoStageCruiseCollapseDwellMs, DEFAULTS.twoStageCruiseCollapseDwellMs), 250, 10000);
    merged.twoStageCapacityWindowMs = clamp(finiteNumber(merged.twoStageCapacityWindowMs, DEFAULTS.twoStageCapacityWindowMs), 6000, 60000);
    merged.twoStagePreferredWatchBufferSeconds = clamp(finiteNumber(merged.twoStagePreferredWatchBufferSeconds, DEFAULTS.twoStagePreferredWatchBufferSeconds), 8, 60);
    merged.twoStagePreferredMinGrowthPerSecond = clamp(finiteNumber(merged.twoStagePreferredMinGrowthPerSecond, DEFAULTS.twoStagePreferredMinGrowthPerSecond), -0.2, 1.5);
    merged.twoStagePreferredCapacityDwellMs = clamp(finiteNumber(merged.twoStagePreferredCapacityDwellMs, DEFAULTS.twoStagePreferredCapacityDwellMs), 2000, 30000);
    merged.twoStagePreferredMaxTargetEtaSeconds = clamp(finiteNumber(merged.twoStagePreferredMaxTargetEtaSeconds, DEFAULTS.twoStagePreferredMaxTargetEtaSeconds), 30, 600);
    merged.twoStageUpgradeHeadroomRatio = clamp(finiteNumber(merged.twoStageUpgradeHeadroomRatio, DEFAULTS.twoStageUpgradeHeadroomRatio), 1.02, 2.5);
    merged.twoStageUpgradeFallbackMinTrendPerSecond = clamp(finiteNumber(merged.twoStageUpgradeFallbackMinTrendPerSecond, DEFAULTS.twoStageUpgradeFallbackMinTrendPerSecond), 0.01, 3);
    merged.twoStageUpgradeCapacityStableMs = clamp(finiteNumber(merged.twoStageUpgradeCapacityStableMs, DEFAULTS.twoStageUpgradeCapacityStableMs), 2000, 30000);
    merged.twoStageRecoveryForcedRetryMs = clamp(finiteNumber(merged.twoStageRecoveryForcedRetryMs, DEFAULTS.twoStageRecoveryForcedRetryMs), merged.twoStageFallbackMinHoldMs, 600000);
    merged.twoStageTransitionGraceMs = clamp(finiteNumber(merged.twoStageTransitionGraceMs, DEFAULTS.twoStageTransitionGraceMs), 2000, 30000);
    merged.twoStageDriftRepairMs = clamp(finiteNumber(merged.twoStageDriftRepairMs, DEFAULTS.twoStageDriftRepairMs), 1000, 30000);
    merged.twoStageSwitchCooldownMs = clamp(finiteNumber(merged.twoStageSwitchCooldownMs, DEFAULTS.twoStageSwitchCooldownMs), 1000, 30000);
    merged.abrFastHalfLifeSeconds = clamp(finiteNumber(merged.abrFastHalfLifeSeconds, DEFAULTS.abrFastHalfLifeSeconds), 0.5, 15);
    merged.abrSlowHalfLifeSeconds = clamp(finiteNumber(merged.abrSlowHalfLifeSeconds, DEFAULTS.abrSlowHalfLifeSeconds), merged.abrFastHalfLifeSeconds, 60);
    merged.abrMinBandwidthSamples = clamp(Math.round(finiteNumber(merged.abrMinBandwidthSamples, DEFAULTS.abrMinBandwidthSamples)), 1, 20);
    merged.abrMinSampleBytes = clamp(Math.round(finiteNumber(merged.abrMinSampleBytes, DEFAULTS.abrMinSampleBytes)), 16384, 1048576);
    merged.abrDowngradeHeadroomRatio = clamp(finiteNumber(merged.abrDowngradeHeadroomRatio, DEFAULTS.abrDowngradeHeadroomRatio), 0.8, 1.3);
    merged.abrUpgradeHeadroomRatio = clamp(finiteNumber(merged.abrUpgradeHeadroomRatio, DEFAULTS.abrUpgradeHeadroomRatio), 1.05, 2.5);
    merged.abrStableLowBufferMinSeconds = clamp(finiteNumber(merged.abrStableLowBufferMinSeconds, DEFAULTS.abrStableLowBufferMinSeconds), 2, 30);
    merged.abrPredictiveFallbackTtzSeconds = clamp(finiteNumber(merged.abrPredictiveFallbackTtzSeconds, DEFAULTS.abrPredictiveFallbackTtzSeconds), 5, 120);
    merged.abrDeficitDwellMs = clamp(finiteNumber(merged.abrDeficitDwellMs, DEFAULTS.abrDeficitDwellMs), 1000, 30000);
    merged.abrUpgradeStableMs = clamp(finiteNumber(merged.abrUpgradeStableMs, DEFAULTS.abrUpgradeStableMs), 2000, 60000);
    merged.abrMaxInstabilityRatio = clamp(finiteNumber(merged.abrMaxInstabilityRatio, DEFAULTS.abrMaxInstabilityRatio), 0.05, 2);
    merged.abrFallbackTrendPerSecond = clamp(finiteNumber(merged.abrFallbackTrendPerSecond, DEFAULTS.abrFallbackTrendPerSecond), -2, 0);
    merged.abrUpgradeFallbackTrendPerSecond = clamp(finiteNumber(merged.abrUpgradeFallbackTrendPerSecond, DEFAULTS.abrUpgradeFallbackTrendPerSecond), 0.05, 3);
    merged.zigzagWindowMs = clamp(finiteNumber(merged.zigzagWindowMs, DEFAULTS.zigzagWindowMs), 6000, 60000);
    merged.zigzagMinCycles = clamp(Math.round(finiteNumber(merged.zigzagMinCycles, DEFAULTS.zigzagMinCycles)), 1, 10);
    merged.zigzagMinTroughSeconds = clamp(finiteNumber(merged.zigzagMinTroughSeconds, DEFAULTS.zigzagMinTroughSeconds), 0.5, 15);
    merged.zigzagMaxPeriodMs = clamp(finiteNumber(merged.zigzagMaxPeriodMs, DEFAULTS.zigzagMaxPeriodMs), 1500, 20000);
    merged.zigzagMaxPeriodJitterRatio = clamp(finiteNumber(merged.zigzagMaxPeriodJitterRatio, DEFAULTS.zigzagMaxPeriodJitterRatio), 0.05, 2);
    merged.zigzagMinAmplitudeSeconds = clamp(finiteNumber(merged.zigzagMinAmplitudeSeconds, DEFAULTS.zigzagMinAmplitudeSeconds), 0.2, 30);
    merged.zigzagRefillDeadlineMarginMs = clamp(finiteNumber(merged.zigzagRefillDeadlineMarginMs, DEFAULTS.zigzagRefillDeadlineMarginMs), 0, 5000);
    merged.zigzagPreferredRecoveryBufferSeconds = clamp(finiteNumber(merged.zigzagPreferredRecoveryBufferSeconds, DEFAULTS.zigzagPreferredRecoveryBufferSeconds), 1, 30);
    merged.zigzagPreferredRecoveryStableMs = clamp(finiteNumber(merged.zigzagPreferredRecoveryStableMs, DEFAULTS.zigzagPreferredRecoveryStableMs), 500, 15000);
    merged.checkpointSaveIntervalMs = clamp(finiteNumber(merged.checkpointSaveIntervalMs, DEFAULTS.checkpointSaveIntervalMs), 2000, 60000);
    merged.localResumeFailureWindowMs = clamp(finiteNumber(merged.localResumeFailureWindowMs, DEFAULTS.localResumeFailureWindowMs), 30000, 3600000);
    merged.localResumeMaxAgeMs = clamp(finiteNumber(merged.localResumeMaxAgeMs, DEFAULTS.localResumeMaxAgeMs), merged.localResumeFailureWindowMs, 604800000);
    merged.localResumeMinLagSeconds = clamp(finiteNumber(merged.localResumeMinLagSeconds, DEFAULTS.localResumeMinLagSeconds), 10, 600);
    merged.localResumeRewindSeconds = clamp(finiteNumber(merged.localResumeRewindSeconds, DEFAULTS.localResumeRewindSeconds), 0, 15);
    if (!["lower", "higher"].includes(merged.qualityFallback)) merged.qualityFallback = "lower";
    merged.minimumAdaptiveResolution = finiteNumber(merged.minimumAdaptiveResolution, DEFAULTS.minimumAdaptiveResolution);
    if (!RESOLUTION_PRESETS.some((p) => p.height === merged.minimumAdaptiveResolution)) {
      merged.minimumAdaptiveResolution = DEFAULTS.minimumAdaptiveResolution;
    }
    if (merged.minimumAdaptiveResolution > merged.preferredResolution) {
      merged.minimumAdaptiveResolution = merged.preferredResolution;
    }
    merged.qualityDownshiftBufferSeconds = clamp(finiteNumber(merged.qualityDownshiftBufferSeconds, DEFAULTS.qualityDownshiftBufferSeconds), 2, 60);
    merged.qualityDownshiftDwellMs = clamp(finiteNumber(merged.qualityDownshiftDwellMs, DEFAULTS.qualityDownshiftDwellMs), 0, 15000);
    merged.qualityRecoveryBufferSeconds = clamp(finiteNumber(merged.qualityRecoveryBufferSeconds, DEFAULTS.qualityRecoveryBufferSeconds), 5, 180);
    merged.qualityRecoveryFirstStepBufferSeconds = clamp(finiteNumber(merged.qualityRecoveryFirstStepBufferSeconds, merged.qualityRecoveryBufferSeconds), 20, 120);
    merged.qualityRecoveryFinalStepBufferSeconds = clamp(finiteNumber(merged.qualityRecoveryFinalStepBufferSeconds, DEFAULTS.qualityRecoveryFinalStepBufferSeconds), merged.qualityRecoveryFirstStepBufferSeconds, 150);
    merged.qualityRecoveryStableMs = clamp(finiteNumber(merged.qualityRecoveryStableMs, DEFAULTS.qualityRecoveryStableMs), 1000, 120000);
    merged.qualityRecoveryFinalStableMs = clamp(finiteNumber(merged.qualityRecoveryFinalStableMs, DEFAULTS.qualityRecoveryFinalStableMs), 1000, 120000);
    merged.qualityRecoveryMinTrendPerSecond = clamp(finiteNumber(merged.qualityRecoveryMinTrendPerSecond, DEFAULTS.qualityRecoveryMinTrendPerSecond), -1, 2);
    merged.qualityStepCooldownMs = clamp(finiteNumber(merged.qualityStepCooldownMs, DEFAULTS.qualityStepCooldownMs), 1000, 60000);
    merged.qualityTrialMinObserveMs = clamp(finiteNumber(merged.qualityTrialMinObserveMs, DEFAULTS.qualityTrialMinObserveMs), 500, 15000);
    merged.qualityTrialSettleMs = clamp(finiteNumber(merged.qualityTrialSettleMs, DEFAULTS.qualityTrialSettleMs), merged.qualityTrialMinObserveMs, 30000);
    merged.qualityTrialRollbackBufferSeconds = clamp(finiteNumber(merged.qualityTrialRollbackBufferSeconds, DEFAULTS.qualityTrialRollbackBufferSeconds), 10, merged.qualityRecoveryFinalStepBufferSeconds);
    merged.qualityTrialRollbackDropSeconds = clamp(finiteNumber(merged.qualityTrialRollbackDropSeconds, DEFAULTS.qualityTrialRollbackDropSeconds), 1, 30);
    merged.qualityTrialRollbackTrendPerSecond = clamp(finiteNumber(merged.qualityTrialRollbackTrendPerSecond, DEFAULTS.qualityTrialRollbackTrendPerSecond), -3, 0);
    merged.qualityRecoveryRetryMs = clamp(finiteNumber(merged.qualityRecoveryRetryMs, DEFAULTS.qualityRecoveryRetryMs), 1000, 120000);
    merged.nativeReadaheadFloorSeconds = clamp(finiteNumber(merged.nativeReadaheadFloorSeconds, DEFAULTS.nativeReadaheadFloorSeconds), 5, 180);
    merged.nativeReadaheadGoalSeconds = clamp(finiteNumber(merged.nativeReadaheadGoalSeconds, DEFAULTS.nativeReadaheadGoalSeconds), merged.nativeReadaheadFloorSeconds, 240);
    merged.nativeReadaheadCeilingSeconds = clamp(finiteNumber(merged.nativeReadaheadCeilingSeconds, DEFAULTS.nativeReadaheadCeilingSeconds), merged.nativeReadaheadGoalSeconds, 600);
    merged.nativeReadaheadGrowthRateMs = clamp(finiteNumber(merged.nativeReadaheadGrowthRateMs, DEFAULTS.nativeReadaheadGrowthRateMs), 100, 5000);
    merged.coldStartBootstrapCapResolution = finiteNumber(merged.coldStartBootstrapCapResolution, DEFAULTS.coldStartBootstrapCapResolution);
    if (!RESOLUTION_PRESETS.some((p) => p.height === merged.coldStartBootstrapCapResolution)) merged.coldStartBootstrapCapResolution = DEFAULTS.coldStartBootstrapCapResolution;
    merged.coldStartBootstrapCapResolution = Math.max(merged.minimumAdaptiveResolution, Math.min(merged.preferredResolution, merged.coldStartBootstrapCapResolution));
    merged.coldStartEmergencyBufferSeconds = clamp(finiteNumber(merged.coldStartEmergencyBufferSeconds, DEFAULTS.coldStartEmergencyBufferSeconds), 1, 15);
    merged.coldStartExitBufferSeconds = clamp(finiteNumber(merged.coldStartExitBufferSeconds, DEFAULTS.coldStartExitBufferSeconds), merged.coldStartEmergencyBufferSeconds, 30);
    merged.coldStartMaxMs = clamp(finiteNumber(merged.coldStartMaxMs, DEFAULTS.coldStartMaxMs), 3000, 30000);
    merged.coldStartMinObserveMs = clamp(finiteNumber(merged.coldStartMinObserveMs, DEFAULTS.coldStartMinObserveMs), 0, 3000);
    merged.coldStartEmergencyObserveMs = clamp(finiteNumber(merged.coldStartEmergencyObserveMs, DEFAULTS.coldStartEmergencyObserveMs), merged.coldStartMinObserveMs, 5000);
    merged.coldStartStepCooldownMs = clamp(finiteNumber(merged.coldStartStepCooldownMs, DEFAULTS.coldStartStepCooldownMs), 250, 5000);
    merged.startupRampMinObserveMs = clamp(finiteNumber(merged.startupRampMinObserveMs, DEFAULTS.startupRampMinObserveMs), 500, 15000);
    merged.startupRampMaxMs = clamp(finiteNumber(merged.startupRampMaxMs, DEFAULTS.startupRampMaxMs), 10000, 180000);
    merged.startupRampSoftFloorSeconds = clamp(finiteNumber(merged.startupRampSoftFloorSeconds, DEFAULTS.startupRampSoftFloorSeconds), 10, 60);
    merged.startupRampEmergencySeconds = clamp(finiteNumber(merged.startupRampEmergencySeconds, DEFAULTS.startupRampEmergencySeconds), 3, 40);
    merged.startupRampExitBufferSeconds = clamp(finiteNumber(merged.startupRampExitBufferSeconds, DEFAULTS.startupRampExitBufferSeconds), 20, 90);
    merged.startupRampExitStableMs = clamp(finiteNumber(merged.startupRampExitStableMs, DEFAULTS.startupRampExitStableMs), 1000, 30000);
    merged.startupRampMinGrowthPerSecond = clamp(finiteNumber(merged.startupRampMinGrowthPerSecond, DEFAULTS.startupRampMinGrowthPerSecond), -1, 2);
    if (!["continuous", "adaptive", "aggressive"].includes(merged.networkKeepWarmMode)) merged.networkKeepWarmMode = "aggressive";
    if (!["off", "sabr", "hybrid"].includes(merged.mediaDemandMode)) merged.mediaDemandMode = "hybrid";
    merged.mediaDemandStartBufferSeconds = clamp(finiteNumber(merged.mediaDemandStartBufferSeconds, DEFAULTS.mediaDemandStartBufferSeconds), 10, 180);
    merged.mediaDemandIdleMs = clamp(finiteNumber(merged.mediaDemandIdleMs, DEFAULTS.mediaDemandIdleMs), 500, 30000);
    merged.mediaDemandEmergencyIdleMs = clamp(finiteNumber(merged.mediaDemandEmergencyIdleMs, DEFAULTS.mediaDemandEmergencyIdleMs), 250, 10000);
    merged.mediaDemandKickBufferSeconds = clamp(finiteNumber(merged.mediaDemandKickBufferSeconds, DEFAULTS.mediaDemandKickBufferSeconds), 3, 120);
    merged.mediaDemandKickCooldownMs = clamp(finiteNumber(merged.mediaDemandKickCooldownMs, DEFAULTS.mediaDemandKickCooldownMs), 1000, 60000);
    merged.mediaDemandEmergencyKickCooldownMs = clamp(finiteNumber(merged.mediaDemandEmergencyKickCooldownMs, DEFAULTS.mediaDemandEmergencyKickCooldownMs), 500, 30000);
    merged.mediaDemandEdgeMarginSeconds = clamp(finiteNumber(merged.mediaDemandEdgeMarginSeconds, DEFAULTS.mediaDemandEdgeMarginSeconds), 0, 2);
    merged.startupArmMinPlaybackSeconds = clamp(finiteNumber(merged.startupArmMinPlaybackSeconds, DEFAULTS.startupArmMinPlaybackSeconds), 0.5, 15);
    merged.startupArmMinBufferSeconds = clamp(finiteNumber(merged.startupArmMinBufferSeconds, DEFAULTS.startupArmMinBufferSeconds), 1, 30);
    merged.startupArmMinReadyState = clamp(Math.round(finiteNumber(merged.startupArmMinReadyState, DEFAULTS.startupArmMinReadyState)), 2, 4);
    merged.startupArmMinWallMs = clamp(finiteNumber(merged.startupArmMinWallMs, DEFAULTS.startupArmMinWallMs), 500, 15000);
    merged.startupArmPostGraceMs = clamp(finiteNumber(merged.startupArmPostGraceMs, DEFAULTS.startupArmPostGraceMs), 0, 15000);
    merged.mediaIdleWarmMs = clamp(finiteNumber(merged.mediaIdleWarmMs, DEFAULTS.mediaIdleWarmMs), 250, 30000);
    merged.keepaliveIntervalMs = clamp(finiteNumber(merged.keepaliveIntervalMs, DEFAULTS.keepaliveIntervalMs), 500, 30000);
    merged.keepaliveEmergencyIntervalMs = clamp(finiteNumber(merged.keepaliveEmergencyIntervalMs, DEFAULTS.keepaliveEmergencyIntervalMs), 250, 10000);
    merged.keepaliveHealthyIntervalMs = clamp(finiteNumber(merged.keepaliveHealthyIntervalMs, DEFAULTS.keepaliveHealthyIntervalMs), 1000, 60000);
    merged.schedulerTickMs = clamp(finiteNumber(merged.schedulerTickMs, DEFAULTS.schedulerTickMs), 500, 10000);
    merged.contentReportMinMs = clamp(finiteNumber(merged.contentReportMinMs, DEFAULTS.contentReportMinMs), 100, 5000);
    merged.contentStaleMs = clamp(finiteNumber(merged.contentStaleMs, DEFAULTS.contentStaleMs), 3000, 120000);
    merged.pulseEffectWindowMs = clamp(finiteNumber(merged.pulseEffectWindowMs, DEFAULTS.pulseEffectWindowMs), 2000, 30000);
    merged.demandEffectWindowMs = clamp(finiteNumber(merged.demandEffectWindowMs, DEFAULTS.demandEffectWindowMs), 2000, 30000);
    return merged;
  }

  function rampProfileOverrides(profile) {
    const key = profile === "aggressive" ? "aggressive" : "defensive";
    return RAMP_PROFILE_OVERRIDES[key];
  }

  function applyStandardPolicy(value) {
    const source = value || {};
    const user = {};
    for (const key of USER_PREFERENCE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(source, key)) user[key] = source[key];
    }
    user.rampProfile = user.rampProfile === "aggressive" ? "aggressive" : "defensive";
    return mergeSettings({
      ...DEFAULTS,
      ...rampProfileOverrides(user.rampProfile),
      ...user,
      policyVersion: POLICY_VERSION,
      policyProfile: POLICY_PROFILE
    });
  }

  function settingsUseStandardPolicy(value) {
    if (!value || value.policyVersion !== POLICY_VERSION || value.policyProfile !== POLICY_PROFILE) return false;
    const expected = applyStandardPolicy(value);
    const keys = new Set([...Object.keys(expected), ...Object.keys(value)]);
    for (const key of keys) {
      if (value[key] !== expected[key]) return false;
    }
    return true;
  }

  function bufferBand(effectiveBuffer, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const value = Math.max(0, finiteNumber(effectiveBuffer, 0));
    if (value >= settings.targetBufferSeconds) return "target";
    if (value >= settings.warmLowWatermarkSeconds) return "recovery";
    if (value <= settings.criticalWatermarkSeconds) return "critical";
    return "emergency";
  }

  function networkHealth({ mediaAgeMs = Infinity, cdnAgeMs = Infinity } = {}, settingsInput) {
    const settings = mergeSettings(settingsInput);
    if (mediaAgeMs <= settings.mediaActiveWindowMs) return "active";
    if (cdnAgeMs <= Math.max(settings.keepaliveIntervalMs * 1.8, settings.mediaIdleWarmMs)) return "warm";
    return "idle";
  }

  function derivePlaybackState(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const {
      enabled = true,
      paused = false,
      ended = false,
      isLive = false,
      isAd = false,
      isShorts = false,
      priming = false,
      effectiveBuffer = 0,
      bufferTrend = 0,
      mediaAgeMs = Infinity,
      cdnAgeMs = Infinity,
      online = true
    } = input || {};

    if (!enabled) return "disabled";
    if (!online) return "offline";
    if (ended) return "ended";
    if (isLive) return "live";
    if (isAd) return "ad";
    if (isShorts) return "shorts";
    if (priming) return "priming";
    if (paused) return "paused";
    const band = bufferBand(effectiveBuffer, settings);
    if (band === "critical") return "critical";
    if (band === "emergency") return mediaAgeMs <= settings.mediaActiveWindowMs ? "emergency-fetch" : "emergency-recovery";
    if (band === "recovery") return mediaAgeMs <= settings.mediaActiveWindowMs ? "recovering-fetch" : "aggressive-recovery";
    if (mediaAgeMs <= settings.mediaActiveWindowMs) return "target-fetch";
    if (settings.networkKeepWarm && mediaAgeMs >= settings.mediaIdleWarmMs) return "target-warm";
    return "healthy";
  }

  function shouldSendKeepalive(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const {
      enabled = true,
      playing = false,
      protectionArmed = true,
      online = true,
      pageState = "active",
      isLive = false,
      isAd = false,
      isShorts = false,
      hasCdnOrigin = false,
      mediaAgeMs = Infinity,
      keepaliveAgeMs = Infinity,
      effectiveBuffer = 0,
      mediaStreaming = false
    } = input || {};

    if (!enabled || !settings.networkKeepWarm || !playing || !protectionArmed || !online || isLive || isAd || !hasCdnOrigin) return false;
    if (["unloaded", "discarded", "bfcache"].includes(pageState)) return false;
    if (isShorts) return false;
    if (mediaStreaming || mediaAgeMs <= settings.mediaActiveWindowMs) return false;

    const belowTarget = effectiveBuffer < settings.targetBufferSeconds;
    const emergency = effectiveBuffer < settings.warmLowWatermarkSeconds;
    const recoveryInterval = emergency ? settings.keepaliveEmergencyIntervalMs : settings.keepaliveIntervalMs;
    const interval = settings.networkKeepWarmMode === "continuous"
      ? recoveryInterval
      : (belowTarget ? recoveryInterval : settings.keepaliveHealthyIntervalMs);
    return mediaAgeMs >= settings.mediaIdleWarmMs && keepaliveAgeMs >= interval;
  }

  function normalizedResolutionHeights(availableHeights, preferredHeight = Infinity, minimumHeight = 0) {
    const source = Array.isArray(availableHeights) && availableHeights.length
      ? availableHeights
      : RESOLUTION_PRESETS.map((p) => p.height);
    return [...new Set(source.map((v) => finiteNumber(v, 0)).filter((v) => v > 0 && v <= preferredHeight && v >= minimumHeight))]
      .sort((a, b) => a - b);
  }

  function nextLowerResolution(currentHeight, availableHeights, preferredHeight, minimumHeight) {
    const current = finiteNumber(currentHeight, preferredHeight);
    const levels = normalizedResolutionHeights(availableHeights, preferredHeight, minimumHeight);
    const lower = levels.filter((h) => h < current);
    return lower.length ? lower[lower.length - 1] : (levels[0] || current);
  }

  function nextHigherResolution(currentHeight, availableHeights, preferredHeight, minimumHeight) {
    const current = finiteNumber(currentHeight, minimumHeight);
    const levels = normalizedResolutionHeights(availableHeights, preferredHeight, minimumHeight);
    return levels.find((h) => h > current) || Math.min(preferredHeight, levels[levels.length - 1] || preferredHeight);
  }

  function coldStartQualityDecision(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const nowMs = finiteNumber(input?.nowMs, Date.now());
    const elapsedMs = Math.max(0, finiteNumber(input?.elapsedMs, 0));
    const currentHeight = finiteNumber(input?.currentHeight, 0);
    const targetHeight = finiteNumber(input?.targetHeight, settings.preferredResolution);
    const effectiveBuffer = Math.max(0, finiteNumber(input?.effectiveBuffer, 0));
    const riskEvent = Boolean(input?.riskEvent);
    const playing = input?.playing !== false;
    const isLive = Boolean(input?.isLive);
    const isAd = Boolean(input?.isAd);
    const lastAdjustmentMs = finiteNumber(input?.lastAdjustmentMs, 0);
    const availableHeights = input?.availableHeights || [];

    const hold = (reason, phase = "active") => ({ action: "hold", reason, phase, targetHeight });
    if (!settings.coldStartGuardEnabled || !settings.qualityEnabled || !settings.adaptiveQuality || !playing || isLive || isAd) {
      return hold("inactive", "inactive");
    }
    if (elapsedMs >= settings.coldStartMaxMs || effectiveBuffer >= settings.coldStartExitBufferSeconds) {
      return hold("cold-start-complete", "complete");
    }
    if (elapsedMs < settings.coldStartMinObserveMs && !riskEvent) return hold("cold-start-observe");

    const basis = currentHeight > 0 ? Math.min(currentHeight, targetHeight) : targetHeight;
    if (basis <= settings.minimumAdaptiveResolution) return hold("adaptive-floor");
    const cooldownReady = lastAdjustmentMs <= 0 || nowMs - lastAdjustmentMs >= settings.coldStartStepCooldownMs;
    if (!cooldownReady) return hold("cold-start-cooldown");

    // At high resolutions the first seconds can consume media faster than YouTube builds
    // the initial reservoir. Temporarily cap to 1080p (or user/floor if lower) immediately
    // after playback has genuinely begun; normal trial-based recovery restores preference.
    const cap = Math.max(settings.minimumAdaptiveResolution, Math.min(settings.preferredResolution, settings.coldStartBootstrapCapResolution));
    if (basis > cap) {
      const candidates = normalizedResolutionHeights(availableHeights, settings.preferredResolution, settings.minimumAdaptiveResolution);
      const capped = candidates.filter((h) => h <= cap).pop() || cap;
      if (capped < basis) return { action: "downshift", reason: "cold-start-high-bitrate-cap", phase: "active", targetHeight: capped };
    }

    // Lower resolutions usually survive natively; only step them down if we have real
    // evidence of starvation or the buffer is critically small after a brief observation.
    const emergency = effectiveBuffer <= settings.coldStartEmergencyBufferSeconds && elapsedMs >= settings.coldStartEmergencyObserveMs;
    if (riskEvent || emergency) {
      const next = nextLowerResolution(basis, availableHeights, settings.preferredResolution, settings.minimumAdaptiveResolution);
      if (next < basis) {
        return { action: "downshift", reason: riskEvent ? "cold-start-risk" : "cold-start-emergency", phase: "active", targetHeight: next };
      }
    }
    return hold("cold-start-building");
  }

  function startupRampDecision(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const nowMs = finiteNumber(input?.nowMs, Date.now());
    const armedEpochMs = finiteNumber(input?.armedEpochMs, nowMs);
    const armedAgeMs = Math.max(0, nowMs - armedEpochMs);
    const currentHeight = finiteNumber(input?.currentHeight, 0);
    const targetHeight = finiteNumber(input?.targetHeight, settings.preferredResolution);
    const effectiveBuffer = Math.max(0, finiteNumber(input?.effectiveBuffer, 0));
    const bufferTrend = finiteNumber(input?.bufferTrend, 0);
    const riskEvent = Boolean(input?.riskEvent);
    const playing = input?.playing !== false;
    const isLive = Boolean(input?.isLive);
    const isAd = Boolean(input?.isAd);
    const lastAdjustmentMs = finiteNumber(input?.lastAdjustmentMs, 0);
    let stableSinceMs = input?.stableSinceMs == null ? null : finiteNumber(input.stableSinceMs, nowMs);
    const availableHeights = input?.availableHeights || [];

    const hold = (reason, phase = "active") => ({ action: "hold", reason, phase, targetHeight, stableSinceMs });
    if (!settings.startupRampEnabled || !settings.qualityEnabled || !settings.adaptiveQuality || !playing || isLive || isAd) {
      return hold("inactive", "inactive");
    }
    if (armedAgeMs < settings.startupArmPostGraceMs) return hold("post-arm-grace");
    if (armedAgeMs >= settings.startupRampMaxMs) return hold("startup-timeout", "complete");

    if (effectiveBuffer >= settings.startupRampExitBufferSeconds && bufferTrend >= -0.05 && !riskEvent) {
      stableSinceMs = stableSinceMs ?? nowMs;
      if (nowMs - stableSinceMs >= settings.startupRampExitStableMs) return hold("handoff-ready", "complete");
      return hold("handoff-dwell");
    }
    stableSinceMs = null;
    if (armedAgeMs < settings.startupRampMinObserveMs) return hold("observe-native-start");

    const basis = currentHeight > 0 ? Math.min(currentHeight, targetHeight) : targetHeight;
    if (basis <= settings.minimumAdaptiveResolution) return hold("adaptive-floor");
    const cooldownReady = nowMs - lastAdjustmentMs >= settings.qualityStepCooldownMs;
    const weakGrowth = bufferTrend < settings.startupRampMinGrowthPerSecond;
    const softPressure = effectiveBuffer <= settings.startupRampSoftFloorSeconds && weakGrowth;
    const emergency = effectiveBuffer <= settings.startupRampEmergencySeconds;
    if ((riskEvent || emergency || softPressure) && cooldownReady) {
      const next = nextLowerResolution(basis, availableHeights, settings.preferredResolution, settings.minimumAdaptiveResolution);
      if (next < basis) {
        return {
          action: "downshift",
          reason: riskEvent ? "startup-risk" : (emergency ? "startup-emergency" : "startup-ramp"),
          phase: "active",
          targetHeight: next,
          stableSinceMs
        };
      }
    }
    return hold(softPressure ? "startup-cooldown" : "startup-building");
  }

  function recoveryThresholdForHeight(currentHeight, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const current = finiteNumber(currentHeight, settings.minimumAdaptiveResolution);
    return current <= settings.minimumAdaptiveResolution
      ? settings.qualityRecoveryFirstStepBufferSeconds
      : settings.qualityRecoveryFinalStepBufferSeconds;
  }

  function qualityTrialDecision(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const pending = input?.pendingTransition;
    if (!pending) return { action: "none", reason: "no-trial" };

    const nowMs = finiteNumber(input?.nowMs, Date.now());
    const startedAtMs = finiteNumber(pending.startedAtMs, nowMs);
    const elapsedMs = Math.max(0, nowMs - startedAtMs);
    const fromHeight = finiteNumber(pending.fromHeight, settings.minimumAdaptiveResolution);
    const targetHeight = finiteNumber(pending.targetHeight, fromHeight);
    const baselineBuffer = Math.max(0, finiteNumber(pending.baselineBuffer, 0));
    const effectiveBuffer = Math.max(0, finiteNumber(input?.effectiveBuffer, 0));
    const bufferTrend = finiteNumber(input?.bufferTrend, 0);
    const currentHeight = finiteNumber(input?.currentHeight, 0);
    const selectedHeight = finiteNumber(input?.selectedHeight, 0);
    const riskEvent = Boolean(input?.riskEvent);
    const acked = Boolean(pending.acked) || currentHeight >= targetHeight || selectedHeight >= targetHeight;
    const drop = Math.max(0, baselineBuffer - effectiveBuffer);

    if (elapsedMs < settings.qualityTrialMinObserveMs) {
      return { action: "hold", reason: "trial-observe", acked, fromHeight, targetHeight };
    }

    const rollback = riskEvent
      || effectiveBuffer <= settings.qualityTrialRollbackBufferSeconds
      || (drop >= settings.qualityTrialRollbackDropSeconds && bufferTrend <= settings.qualityTrialRollbackTrendPerSecond);
    if (rollback) {
      return {
        action: "rollback",
        reason: riskEvent ? "trial-risk" : (effectiveBuffer <= settings.qualityTrialRollbackBufferSeconds ? "trial-low-buffer" : "trial-buffer-collapse"),
        acked,
        fromHeight,
        targetHeight: fromHeight
      };
    }

    if (elapsedMs >= settings.qualityTrialSettleMs) {
      if (acked) return { action: "commit", reason: "trial-stable", acked, fromHeight, targetHeight };
      return { action: "cancel", reason: "trial-unacknowledged", acked, fromHeight, targetHeight: fromHeight };
    }

    return { action: "hold", reason: acked ? "trial-acked" : "trial-pending", acked, fromHeight, targetHeight };
  }

  function qualityDecision(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    // Legacy multi-tier controller is permanently superseded by v0.17 two-stage policy.
    if (settings.twoStageQualityEnabled) {
      return { action: "hold", reason: "superseded-two-stage", targetHeight: settings.preferredResolution, lowSinceMs: null, stableSinceMs: null };
    }
    const nowMs = finiteNumber(input?.nowMs, Date.now());
    const currentHeight = finiteNumber(input?.currentHeight, 0);
    const targetHeight = finiteNumber(input?.targetHeight, settings.preferredResolution);
    const effectiveBuffer = Math.max(0, finiteNumber(input?.effectiveBuffer, 0));
    const bufferTrend = finiteNumber(input?.bufferTrend, 0);
    const riskEvent = Boolean(input?.riskEvent);
    const playing = input?.playing !== false;
    const isLive = Boolean(input?.isLive);
    const isAd = Boolean(input?.isAd);
    const lastAdjustmentMs = finiteNumber(input?.lastAdjustmentMs, 0);
    const recoveryBlockedUntilMs = finiteNumber(input?.recoveryBlockedUntilMs, 0);
    const lowSinceMs = input?.lowSinceMs == null ? null : finiteNumber(input.lowSinceMs, nowMs);
    const stableSinceMs = input?.stableSinceMs == null ? null : finiteNumber(input.stableSinceMs, nowMs);
    const availableHeights = input?.availableHeights || [];

    if (!settings.qualityEnabled || !settings.adaptiveQuality || !playing || isLive || isAd) {
      return { action: "hold", reason: "inactive", targetHeight, lowSinceMs: null, stableSinceMs: null };
    }

    const cooldownReady = nowMs - lastAdjustmentMs >= settings.qualityStepCooldownMs;
    const endangered = riskEvent || (effectiveBuffer <= settings.qualityDownshiftBufferSeconds && bufferTrend < -0.05);
    let nextLowSince = endangered ? (lowSinceMs ?? nowMs) : null;
    let nextStableSince = null;

    const downshiftReady = riskEvent || (nextLowSince != null && nowMs - nextLowSince >= settings.qualityDownshiftDwellMs);
    if (endangered && downshiftReady && cooldownReady) {
      const basis = currentHeight > 0 ? Math.min(currentHeight, targetHeight) : targetHeight;
      const next = nextLowerResolution(basis, availableHeights, settings.preferredResolution, settings.minimumAdaptiveResolution);
      if (next < basis) {
        return { action: "downshift", reason: riskEvent ? "risk-event" : "low-buffer", targetHeight: next, lowSinceMs: nextLowSince, stableSinceMs: null };
      }
    }

    const actual = currentHeight > 0 ? currentHeight : targetHeight;
    const recoveryThreshold = recoveryThresholdForHeight(actual, settings);
    const stable = effectiveBuffer >= recoveryThreshold && bufferTrend >= settings.qualityRecoveryMinTrendPerSecond && !riskEvent;
    nextStableSince = stable ? (stableSinceMs ?? nowMs) : null;
    const dwellMs = actual <= settings.minimumAdaptiveResolution ? settings.qualityRecoveryStableMs : settings.qualityRecoveryFinalStableMs;
    const recoveryReady = nowMs >= recoveryBlockedUntilMs;
    if (actual < settings.preferredResolution && stable && cooldownReady && recoveryReady && nextStableSince != null && nowMs - nextStableSince >= dwellMs) {
      const next = nextHigherResolution(actual, availableHeights, settings.preferredResolution, settings.minimumAdaptiveResolution);
      if (next > actual) {
        return { action: "upshift", reason: "recovery-trial", targetHeight: next, lowSinceMs: null, stableSinceMs: nextStableSince, recoveryThreshold };
      }
    }

    return {
      action: "hold",
      reason: !recoveryReady ? "recovery-backoff" : (stable ? "recovery-dwell" : (endangered ? "degrading" : "observing")),
      targetHeight,
      lowSinceMs: nextLowSince,
      stableSinceMs: nextStableSince,
      recoveryThreshold
    };
  }

  function twoStageHeights(availableHeights, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const source = Array.isArray(availableHeights) && availableHeights.length
      ? [...new Set(availableHeights.map((v) => finiteNumber(v, 0)).filter((v) => v > 0))].sort((a, b) => a - b)
      : RESOLUTION_PRESETS.map((p) => p.height).sort((a, b) => a - b);
    const preferred = source.filter((h) => h <= settings.preferredResolution).pop() || source[source.length - 1] || settings.preferredResolution;
    const fallback = source.filter((h) => h <= settings.fallbackResolution).pop() || Math.min(preferred, settings.fallbackResolution);
    return { preferred, fallback: Math.min(preferred, fallback) };
  }

  function deliveryHeadroom(input = {}) {
    const capacityTrend = finiteNumber(input.capacityTrend, 0);
    const currentBitrate = Math.max(0, finiteNumber(input.currentBitrate, 0));
    const preferredBitrate = Math.max(0, finiteNumber(input.preferredBitrate, 0));
    const playbackRate = Math.max(0.05, finiteNumber(input.playbackRate, 1));
    const measuredBandwidth = Math.max(0, finiteNumber(input.bandwidthEstimateBps, 0));
    const sampleCount = Math.max(0, finiteNumber(input.bandwidthSampleCount, 0));
    const minSamples = Math.max(1, finiteNumber(input.minBandwidthSamples, 2));
    const hasMeasuredBandwidth = measuredBandwidth > 0 && sampleCount >= minSamples;
    const slopeDerivedBandwidth = currentBitrate > 0 ? currentBitrate * Math.max(0, 1 + capacityTrend) * playbackRate : 0;
    const estimatedBandwidth = hasMeasuredBandwidth ? measuredBandwidth : slopeDerivedBandwidth;
    const currentConsumption = currentBitrate > 0 ? currentBitrate * playbackRate : 0;
    const preferredConsumption = preferredBitrate > 0 ? preferredBitrate * playbackRate : 0;
    const currentHeadroom = estimatedBandwidth > 0 && currentConsumption > 0 ? estimatedBandwidth / currentConsumption : 0;
    const preferredHeadroom = estimatedBandwidth > 0 && preferredConsumption > 0 ? estimatedBandwidth / preferredConsumption : 0;
    const deliveryRatio = currentHeadroom;
    return {
      capacityTrend, currentBitrate, preferredBitrate, playbackRate, measuredBandwidth,
      sampleCount, hasMeasuredBandwidth, slopeDerivedBandwidth, estimatedBandwidth,
      currentConsumption, preferredConsumption, currentHeadroom, preferredHeadroom, deliveryRatio
    };
  }

  function predictedTimeToEmpty(effectiveBuffer, capacityTrend) {
    const buffer = Math.max(0, finiteNumber(effectiveBuffer, 0));
    const trendValue = finiteNumber(capacityTrend, 0);
    return trendValue < -0.01 ? buffer / Math.abs(trendValue) : Infinity;
  }

  function zigzagHealth(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const z = input?.zigzag || {};
    const cycles = Math.max(0, finiteNumber(z.cycles, 0));
    const periodMs = Math.max(0, finiteNumber(z.periodMs, 0));
    const jitter = Math.max(0, finiteNumber(z.periodJitterRatio, Infinity));
    const trough = Math.max(0, finiteNumber(z.trough, 0));
    const amplitude = Math.max(0, finiteNumber(z.amplitude, 0));
    const refillSlope = finiteNumber(z.refillSlope, 0);
    const lastRefillAgeMs = Math.max(0, finiteNumber(z.lastRefillAgeMs, Infinity));
    const regular = cycles >= settings.zigzagMinCycles
      && periodMs > 0 && periodMs <= settings.zigzagMaxPeriodMs
      && jitter <= settings.zigzagMaxPeriodJitterRatio
      && trough >= settings.zigzagMinTroughSeconds
      && amplitude >= settings.zigzagMinAmplitudeSeconds
      && refillSlope > 0;
    const refillOverdue = regular && lastRefillAgeMs > periodMs + settings.zigzagRefillDeadlineMarginMs;
    return { regular, refillOverdue, cycles, periodMs, jitter, trough, amplitude, refillSlope, lastRefillAgeMs };
  }

  function preferredCapacityDeficit(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const effectiveBuffer = Math.max(0, finiteNumber(input?.effectiveBuffer, 0));
    const capacityTrend = finiteNumber(input?.capacityTrend, 0);
    const headroom = deliveryHeadroom({ ...input, minBandwidthSamples: settings.abrMinBandwidthSamples });
    const ttz = predictedTimeToEmpty(effectiveBuffer, capacityTrend);
    const cycle = zigzagHealth(input, settings);
    if (cycle.regular && !cycle.refillOverdue) return false;

    // A low but stable reservoir is production success. Do not use the
    // aspirational 60/90 read-ahead marks as a quality gate.
    const stableLowReservoir = effectiveBuffer >= settings.abrStableLowBufferMinSeconds
      && capacityTrend >= -0.03
      && (!headroom.hasMeasuredBandwidth || headroom.currentHeadroom >= settings.abrDowngradeHeadroomRatio);
    if (stableLowReservoir) return false;

    const measuredDeficit = headroom.hasMeasuredBandwidth && headroom.currentHeadroom < settings.abrDowngradeHeadroomRatio;
    const slopeDeficit = capacityTrend <= settings.abrFallbackTrendPerSecond;
    const predictedStarvation = Number.isFinite(ttz) && ttz <= settings.abrPredictiveFallbackTtzSeconds;
    return measuredDeficit || (slopeDeficit && predictedStarvation);
  }

  function preferredUpgradeCapacity(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const h = deliveryHeadroom({ ...input, minBandwidthSamples: settings.abrMinBandwidthSamples });
    const instability = Math.max(0, finiteNumber(input?.bandwidthInstability, 0));
    const directReady = h.hasMeasuredBandwidth
      && h.preferredHeadroom >= settings.abrUpgradeHeadroomRatio
      && instability <= settings.abrMaxInstabilityRatio;
    const fallbackReady = !h.hasMeasuredBandwidth
      && h.capacityTrend >= settings.abrUpgradeFallbackTrendPerSecond;
    return { ...h, instability, ready: directReady || fallbackReady, hasBitrateEvidence: h.preferredBitrate > 0 };
  }

  function twoStageQualityDecision(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const nowMs = finiteNumber(input?.nowMs, Date.now());
    const playing = input?.playing !== false;
    const isLive = Boolean(input?.isLive);
    const isAd = Boolean(input?.isAd);
    const riskEvent = Boolean(input?.riskEvent);
    const effectiveBuffer = Math.max(0, finiteNumber(input?.effectiveBuffer, 0));
    const bufferTrend = finiteNumber(input?.bufferTrend, 0);
    const capacityTrend = finiteNumber(input?.capacityTrend, bufferTrend);
    const currentHeight = finiteNumber(input?.currentHeight, 0);
    const currentBitrate = Math.max(0, finiteNumber(input?.currentBitrate, 0));
    const preferredBitrate = Math.max(0, finiteNumber(input?.preferredBitrate, 0));
    const playbackRate = Math.max(0.05, finiteNumber(input?.playbackRate, 1));
    const bandwidthEstimateBps = Math.max(0, finiteNumber(input?.bandwidthEstimateBps, 0));
    const bandwidthSampleCount = Math.max(0, finiteNumber(input?.bandwidthSampleCount, 0));
    const bandwidthInstability = Math.max(0, finiteNumber(input?.bandwidthInstability, 0));
    const mediaAgeMs = Math.max(0, finiteNumber(input?.mediaAgeMs, 0));
    const deliveryAgeMs = Math.max(0, finiteNumber(input?.deliveryAgeMs, mediaAgeMs));
    const mode = String(input?.mode || "preferred");
    const lastAdjustmentMs = finiteNumber(input?.lastAdjustmentMs, 0);
    const transitionUntilMs = finiteNumber(input?.transitionUntilMs, 0);
    const fallbackSinceMs = finiteNumber(input?.fallbackSinceMs, 0);
    const preferredSinceMs = finiteNumber(input?.preferredSinceMs, 0);
    const retryBlockedUntilMs = finiteNumber(input?.retryBlockedUntilMs, 0);
    const playbackAgeMs = Math.max(0, finiteNumber(input?.playbackAgeMs, 0));
    const driftSinceMs = input?.driftSinceMs == null ? null : finiteNumber(input.driftSinceMs, nowMs);
    const lowSinceMs = input?.lowSinceMs == null ? null : finiteNumber(input.lowSinceMs, nowMs);
    const stableSinceMs = input?.stableSinceMs == null ? null : finiteNumber(input.stableSinceMs, nowMs);
    const cruiseStableSinceMs = input?.cruiseStableSinceMs == null ? null : finiteNumber(input.cruiseStableSinceMs, nowMs);
    const capacityDeficitSinceMs = input?.capacityDeficitSinceMs == null ? null : finiteNumber(input.capacityDeficitSinceMs, nowMs);
    const capacityStableSinceMs = input?.capacityStableSinceMs == null ? null : finiteNumber(input.capacityStableSinceMs, nowMs);
    const heights = twoStageHeights(input?.availableHeights || [], settings);
    const preferred = heights.preferred;
    const fallback = heights.fallback;
    const targetHeight = mode.includes("fallback") || mode === "bootstrap" ? fallback : preferred;
    const capacityInput = {
      capacityTrend, currentBitrate, preferredBitrate, playbackRate,
      bandwidthEstimateBps, bandwidthSampleCount, bandwidthInstability,
      zigzag: input?.zigzag || null
    };
    const capacity = preferredUpgradeCapacity(capacityInput, settings);
    const timeToEmptySeconds = predictedTimeToEmpty(effectiveBuffer, capacityTrend);
    const cycle = zigzagHealth(input, settings);
    const hold = (reason, extra = {}) => ({
      action: "hold", reason, mode, targetHeight,
      lowSinceMs, stableSinceMs, driftSinceMs, fallbackSinceMs, transitionUntilMs,
      preferredSinceMs, retryBlockedUntilMs, cruiseStableSinceMs,
      capacityDeficitSinceMs, capacityStableSinceMs,
      preferredHeight: preferred, fallbackHeight: fallback,
      capacityTrend, timeToEmptySeconds, mediaAgeMs, deliveryAgeMs, playbackAgeMs,
      estimatedBandwidth: capacity.estimatedBandwidth,
      currentHeadroom: capacity.currentHeadroom,
      preferredHeadroom: capacity.preferredHeadroom,
      bandwidthSampleCount, bandwidthInstability,
      ...extra
    });

    if (!settings.qualityEnabled || !settings.adaptiveQuality || !settings.twoStageQualityEnabled || !playing || isLive || isAd || preferred <= 0) {
      return hold("inactive");
    }
    if (fallback >= preferred) return hold("single-tier");

    const cooldownReady = lastAdjustmentMs <= 0 || nowMs - lastAdjustmentMs >= settings.twoStageSwitchCooldownMs;

    // Phase 1: warm the native 1080p transport before we even *permit* 1440p.
    // Live testing showed that 1080p can immediately build ~20 s while the 1440p
    // representation remains cold for tens of seconds. An early exact lock destroys
    // the good 1080p reservoir and causes ping-pong.
    if (mode === "bootstrap") {
      if (currentHeight >= preferred) {
        return {
          ...hold("bootstrap-native-preferred"), action: "adopt-preferred", mode: "transition-preferred",
          targetHeight: preferred, transitionUntilMs: nowMs + settings.twoStagePreferredTransitionGraceMs,
          preferredSinceMs: nowMs, stableSinceMs: null, lowSinceMs: null
        };
      }
      const wallReady = playbackAgeMs >= settings.twoStageBootstrapMinPlaybackMs;
      const bootstrapReady = wallReady && effectiveBuffer >= settings.twoStageBootstrapBufferSeconds
        && bufferTrend >= settings.twoStageBootstrapMinTrendPerSecond && !riskEvent;
      const nextStable = bootstrapReady ? (stableSinceMs ?? nowMs) : null;
      if (bootstrapReady && nextStable != null
          && nowMs - nextStable >= settings.twoStageBootstrapStableMs && cooldownReady) {
        return {
          ...hold("bootstrap-transport-warm"), action: "open-preferred-range", mode: "range-preferred",
          targetHeight: preferred, rangeMinHeight: fallback, rangeMaxHeight: preferred,
          transitionUntilMs: nowMs + settings.twoStagePreferredRangeWarmupMs,
          preferredSinceMs: 0, stableSinceMs: null, lowSinceMs: null, driftSinceMs: null
        };
      }
      return hold(!wallReady ? "bootstrap-transport-age" : (bootstrapReady ? "bootstrap-stability-dwell" : "bootstrap-native-build"), { stableSinceMs: nextStable });
    }

    // Phase 1b: open a soft 1080p..1440p range before forcing an exact 1440p lock.
    // This lets YouTube preserve its working 1080p path while warming / selecting the
    // higher representation under native ABR. If native ABR reaches 1440p and holds it,
    // we adopt it without issuing another representation-changing command.
    if (mode === "range-preferred") {
      const nativePreferred = currentHeight >= preferred && effectiveBuffer >= 2.5 && !riskEvent;
      const nextStable = nativePreferred ? (stableSinceMs ?? nowMs) : null;
      if (nextStable != null && nowMs - nextStable >= settings.twoStagePreferredRangeStableMs) {
        return {
          ...hold("preferred-range-native-1440"), action: "adopt-preferred", mode: "preferred",
          targetHeight: preferred, preferredSinceMs: nowMs, stableSinceMs: null, lowSinceMs: null,
          driftSinceMs: null, transitionUntilMs: 0
        };
      }
      if (nowMs < transitionUntilMs) {
        return hold(nativePreferred ? "preferred-range-1440-dwell" : "preferred-range-warmup", {
          targetHeight: preferred, rangeMinHeight: fallback, rangeMaxHeight: preferred, stableSinceMs: nextStable
        });
      }
      const exactTrialReady = effectiveBuffer >= Math.max(12, settings.twoStageBootstrapBufferSeconds - 4)
        && bufferTrend >= -0.05 && !riskEvent;
      if (exactTrialReady && cooldownReady) {
        return {
          ...hold("preferred-range-exact-trial"), action: "switch-preferred", mode: "transition-preferred",
          targetHeight: preferred, transitionUntilMs: nowMs + settings.twoStagePreferredTransitionGraceMs,
          preferredSinceMs: nowMs, stableSinceMs: null, lowSinceMs: null, driftSinceMs: null
        };
      }
      return hold("preferred-range-wait-safe-trial", { stableSinceMs: nextStable, targetHeight: preferred });
    }

    // Phase 2: a 1440p representation transition is allowed a long lease. The expected buffer
    // reset and the observed 0->10->0 "hill" are not by themselves evidence of failure.
    if (mode === "transition-preferred") {
      const trialAgeMs = preferredSinceMs > 0 ? nowMs - preferredSinceMs : 0;
      const deliverySilent = deliveryAgeMs >= settings.twoStagePreferredTransitionDeliverySilenceMs;
      const emergency = trialAgeMs >= settings.twoStagePreferredTransitionAbortNotBeforeMs
        && effectiveBuffer <= settings.twoStagePreferredEmergencyBufferSeconds
        && deliverySilent && (riskEvent || bufferTrend <= -0.20);
      const nextLow = emergency ? (lowSinceMs ?? nowMs) : null;
      const emergencyReady = nextLow != null
        && nowMs - nextLow >= settings.twoStagePreferredEmergencyDwellMs;
      if (emergencyReady && cooldownReady) {
        return {
          ...hold("preferred-transition-emergency-abort"), action: "switch-fallback", mode: "transition-fallback",
          targetHeight: fallback, transitionUntilMs: nowMs + settings.twoStageFallbackTransitionGraceMs,
          fallbackSinceMs: nowMs, retryBlockedUntilMs: nowMs + settings.twoStagePreferredRetryBackoffMs,
          lowSinceMs: nextLow, stableSinceMs: null, cruiseStableSinceMs: null
        };
      }
      if (nowMs < transitionUntilMs) {
        return hold(emergency ? "preferred-transition-emergency-dwell" : (effectiveBuffer <= settings.twoStagePreferredEmergencyBufferSeconds && !deliverySilent ? "preferred-transition-delivery-active" : "preferred-transition-lease"), {
          targetHeight: preferred, lowSinceMs: nextLow
        });
      }
      if (currentHeight > 0 && currentHeight < preferred) {
        return {
          ...hold("preferred-transition-not-acknowledged"), action: "adopt-fallback", mode: "fallback",
          targetHeight: fallback, fallbackSinceMs: nowMs, retryBlockedUntilMs: nowMs + settings.twoStagePreferredRetryBackoffMs,
          lowSinceMs: null, stableSinceMs: null, driftSinceMs: null, transitionUntilMs: 0,
          capacityDeficitSinceMs: null, capacityStableSinceMs: null, cruiseStableSinceMs: null
        };
      }
      return {
        ...hold("preferred-transition-commit"), action: "commit-preferred", mode: "preferred",
        targetHeight: preferred, preferredSinceMs: preferredSinceMs || nowMs,
        lowSinceMs: null, stableSinceMs: null, driftSinceMs: null,
        capacityDeficitSinceMs: null, capacityStableSinceMs: null, cruiseStableSinceMs: null
      };
    }

    if (mode === "transition-fallback") {
      if (nowMs < transitionUntilMs) return hold("fallback-transition-grace", { targetHeight: fallback });
      return {
        ...hold("fallback-transition-commit"), action: "commit-fallback", mode: "fallback",
        targetHeight: fallback, fallbackSinceMs: fallbackSinceMs || nowMs,
        lowSinceMs: null, stableSinceMs: null, driftSinceMs: null,
        capacityDeficitSinceMs: null, capacityStableSinceMs: null, cruiseStableSinceMs: null
      };
    }

    if (mode === "fallback") {
      const heldMs = fallbackSinceMs > 0 ? nowMs - fallbackSinceMs : 0;
      if (currentHeight >= preferred && cooldownReady) {
        return {
          ...hold("external-preferred-trial"), action: "adopt-preferred", mode: "transition-preferred",
          targetHeight: preferred, transitionUntilMs: nowMs + settings.twoStagePreferredTransitionGraceMs,
          preferredSinceMs: nowMs, stableSinceMs: null, capacityStableSinceMs: null
        };
      }

      const retryAllowed = nowMs >= retryBlockedUntilMs;
      const empiricalReady = effectiveBuffer >= settings.twoStageRecoveryBufferSeconds
        && bufferTrend >= settings.twoStageRecoveryMinTrendPerSecond && !riskEvent;
      const capacityReady = capacity.ready && effectiveBuffer >= settings.abrStableLowBufferMinSeconds && !riskEvent;
      const cycleReady = cycle.regular && !cycle.refillOverdue && cycle.trough >= settings.zigzagMinTroughSeconds;
      const recoveryReady = empiricalReady || (cycleReady && effectiveBuffer >= Math.max(8, settings.zigzagPreferredRecoveryBufferSeconds)) || capacityReady;
      const nextStable = recoveryReady ? (capacityStableSinceMs ?? nowMs) : null;
      const stableReady = nextStable != null && nowMs - nextStable >= settings.twoStageRecoveryStableMs;

      if (retryAllowed && heldMs >= settings.twoStageFallbackMinHoldMs && cooldownReady && stableReady) {
        return {
          ...hold(cycleReady ? "fallback-cycle-recovered" : (capacity.hasMeasuredBandwidth ? "fallback-capacity-recovered" : "fallback-reservoir-recovered")),
          action: "open-preferred-range", mode: "range-preferred", targetHeight: preferred,
          rangeMinHeight: fallback, rangeMaxHeight: preferred,
          transitionUntilMs: nowMs + settings.twoStagePreferredRangeWarmupMs,
          preferredSinceMs: 0, stableSinceMs: null, capacityStableSinceMs: nextStable,
          lowSinceMs: null, driftSinceMs: null
        };
      }
      if (currentHeight > 0 && currentHeight !== fallback && currentHeight < preferred && cooldownReady) {
        return {
          ...hold("fallback-lock-drift"), action: "switch-fallback", mode: "transition-fallback",
          targetHeight: fallback, transitionUntilMs: nowMs + settings.twoStageFallbackTransitionGraceMs
        };
      }
      return hold(!retryAllowed ? "fallback-retry-backoff" : (recoveryReady ? "fallback-recovery-dwell" : "fallback-build"), {
        stableSinceMs: null, capacityStableSinceMs: nextStable
      });
    }

    // Once we have demonstrated a ~20-25 s 1440p reservoir, preserve that proven state.
    // Capacity estimators can inform telemetry but do not demote cruise playback by themselves.
    if (mode === "cruise") {
      const riskLow = riskEvent && effectiveBuffer <= settings.twoStageCruiseRiskBufferSeconds;
      const refillProtected = cycle.regular && !cycle.refillOverdue;
      const staleDelivery = deliveryAgeMs >= settings.twoStageCruiseDeliverySilenceMs;
      const collapseCandidate = !refillProtected
        && effectiveBuffer <= settings.twoStageCruiseCollapseBufferSeconds
        && bufferTrend <= -0.15
        && staleDelivery
        && (timeToEmptySeconds <= 15 || effectiveBuffer <= 6);
      const endangered = riskLow || collapseCandidate;
      const nextLow = endangered ? (lowSinceMs ?? nowMs) : null;
      const collapseReady = riskLow || (nextLow != null && nowMs - nextLow >= settings.twoStageCruiseCollapseDwellMs);
      if (collapseReady && cooldownReady) {
        return {
          ...hold(riskLow ? "cruise-risk-fallback" : "cruise-missed-refill-fallback"),
          action: "switch-fallback", mode: "transition-fallback", targetHeight: fallback,
          transitionUntilMs: nowMs + settings.twoStageFallbackTransitionGraceMs,
          fallbackSinceMs: nowMs, retryBlockedUntilMs: nowMs + settings.twoStagePreferredRetryBackoffMs,
          lowSinceMs: nextLow, cruiseStableSinceMs: null
        };
      }
      const drift = currentHeight > 0 && currentHeight !== preferred;
      const nextDrift = drift ? (driftSinceMs ?? nowMs) : null;
      if (drift && !endangered && effectiveBuffer >= 8 && cooldownReady && nextDrift != null
          && nowMs - nextDrift >= settings.twoStageDriftRepairMs) {
        return {
          ...hold("cruise-preferred-repair"), action: "switch-preferred", mode: "transition-preferred",
          targetHeight: preferred, transitionUntilMs: nowMs + settings.twoStagePreferredTransitionGraceMs,
          preferredSinceMs: nowMs, driftSinceMs: nextDrift, lowSinceMs: null
        };
      }
      return hold(refillProtected ? "cruise-zigzag-protected" : (collapseCandidate ? "cruise-collapse-dwell" : "cruise-stable"), {
        lowSinceMs: nextLow, driftSinceMs: nextDrift
      });
    }

    // Phase 3: convergence at 1440p. The throughput estimator cannot cause a switch on its
    // own; it must agree with imminent starvation. This mirrors hls.js's emergency logic:
    // do not downswitch merely because the estimate is pessimistic while the buffer can survive.
    const preferredTenureMs = preferredSinceMs > 0 ? nowMs - preferredSinceMs : 0;
    const leaseActive = preferredTenureMs < settings.twoStagePreferredLeaseMs;
    const hardLow = effectiveBuffer <= settings.twoStageHardFallbackBufferSeconds && bufferTrend < -0.05;
    const riskLow = riskEvent && effectiveBuffer <= settings.twoStageRiskFallbackBufferSeconds;
    const capacityDeficit = preferredCapacityDeficit({ effectiveBuffer, ...capacityInput }, settings);
    const imminentStarvation = Number.isFinite(timeToEmptySeconds) && timeToEmptySeconds <= 4;
    const predictedDanger = !leaseActive && !cycle.regular && capacityDeficit
      && effectiveBuffer <= 5 && imminentStarvation;
    const endangered = hardLow || riskLow || predictedDanger;
    const nextLow = endangered ? (lowSinceMs ?? nowMs) : null;
    const hardFallbackReady = riskLow || (nextLow != null && nowMs - nextLow >= settings.twoStageHardFallbackDwellMs);

    if (hardFallbackReady && cooldownReady) {
      return {
        ...hold(riskLow ? "preferred-risk-fallback" : (predictedDanger ? "preferred-imminent-starvation" : "preferred-hard-low-fallback")),
        action: "switch-fallback", mode: "transition-fallback", targetHeight: fallback,
        transitionUntilMs: nowMs + settings.twoStageFallbackTransitionGraceMs,
        fallbackSinceMs: nowMs, retryBlockedUntilMs: nowMs + settings.twoStagePreferredRetryBackoffMs,
        lowSinceMs: nextLow, stableSinceMs: null, driftSinceMs: null,
        capacityDeficitSinceMs: null, capacityStableSinceMs: null, cruiseStableSinceMs: null
      };
    }

    const cruiseCandidate = effectiveBuffer >= settings.twoStageCruiseEnterBufferSeconds
      && bufferTrend >= -0.10 && !riskEvent;
    const nextCruiseStable = cruiseCandidate ? (cruiseStableSinceMs ?? nowMs) : null;
    if (nextCruiseStable != null && nowMs - nextCruiseStable >= settings.twoStageCruiseEnterStableMs) {
      return {
        ...hold("preferred-cruise-proven"), action: "enter-cruise", mode: "cruise",
        targetHeight: preferred, cruiseStableSinceMs: nextCruiseStable,
        lowSinceMs: null, driftSinceMs: null, capacityDeficitSinceMs: null
      };
    }

    const drift = currentHeight > 0 && currentHeight !== preferred;
    const nextDrift = drift ? (driftSinceMs ?? nowMs) : null;
    const repairSafe = effectiveBuffer >= settings.twoStageBootstrapBufferSeconds || cruiseCandidate;
    if (drift && repairSafe && !endangered && cooldownReady && nextDrift != null
        && nowMs - nextDrift >= settings.twoStageDriftRepairMs) {
      return {
        ...hold("preferred-sticky-repair"), action: "switch-preferred", mode: "transition-preferred",
        targetHeight: preferred, transitionUntilMs: nowMs + settings.twoStagePreferredTransitionGraceMs,
        preferredSinceMs: nowMs, lowSinceMs: nextLow, driftSinceMs: nextDrift,
        capacityDeficitSinceMs: null, capacityStableSinceMs: null
      };
    }

    return hold(leaseActive ? "preferred-settle-lease" : (cycle.regular && !cycle.refillOverdue ? "preferred-zigzag-protected" : (endangered ? "preferred-danger-dwell" : "preferred-converging")), {
      lowSinceMs: nextLow, stableSinceMs: null, driftSinceMs: nextDrift,
      cruiseStableSinceMs: nextCruiseStable, capacityDeficitSinceMs: null, capacityStableSinceMs: null
    });
  }

  function shouldRestoreCheckpoint(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    if (!settings.localResumeEnabled) return { restore: false, reason: "disabled" };
    const nowMs = finiteNumber(input?.nowMs, Date.now());
    const savedAtMs = finiteNumber(input?.savedAtMs, 0);
    const failureAtMs = finiteNumber(input?.failureAtMs, 0);
    const savedTime = Math.max(0, finiteNumber(input?.savedTime, 0));
    const currentTime = Math.max(0, finiteNumber(input?.currentTime, 0));
    const duration = Math.max(0, finiteNumber(input?.duration, 0));
    if (input?.hasExplicitStart === true) return { restore: false, reason: "explicit-start" };
    if (!(savedAtMs > 0) || nowMs - savedAtMs > settings.localResumeMaxAgeMs) return { restore: false, reason: "stale" };
    if (!(failureAtMs > 0) || nowMs - failureAtMs > settings.localResumeFailureWindowMs) return { restore: false, reason: "no-recent-failure" };
    if (savedTime < 15) return { restore: false, reason: "too-early" };
    if (duration > 0 && savedTime >= duration - 10) return { restore: false, reason: "near-end" };
    const lag = savedTime - currentTime;
    if (lag < settings.localResumeMinLagSeconds) return { restore: false, reason: "resume-close-enough", lag };
    return { restore: true, reason: "stale-youtube-resume", lag, targetTime: Math.max(0, savedTime - settings.localResumeRewindSeconds) };
  }

  function canArmProtection(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const {
      enabled = true,
      hasPlayedOnce = false,
      playing = false,
      ended = false,
      seeking = false,
      isLive = false,
      isAd = false,
      isShorts = false,
      readyState = 0,
      videoWidth = 0,
      videoHeight = 0,
      mediaBufferAhead = 0,
      playbackAdvanceSeconds = 0,
      playingWallMs = 0
    } = input || {};

    if (!enabled || !hasPlayedOnce || !playing || ended || seeking || isLive || isAd) return false;
    if (isShorts) return false;
    if (readyState < settings.startupArmMinReadyState) return false;
    if (videoWidth <= 0 || videoHeight <= 0) return false;
    if (mediaBufferAhead < settings.startupArmMinBufferSeconds) return false;
    if (playbackAdvanceSeconds < settings.startupArmMinPlaybackSeconds) return false;
    if (playingWallMs < settings.startupArmMinWallMs) return false;
    return true;
  }

  function decidePausedPrime(input, settingsInput) {
    const settings = mergeSettings(settingsInput);
    const { enabled = true, paused = false, mediaBufferAhead = 0, isLive = false, isAd = false, isShorts = false, visible = true } = input || {};
    if (!enabled || !settings.pausedPrebuffer || !paused || !visible || isLive || isAd) return false;
    if (isShorts) return false;
    return mediaBufferAhead < settings.pausedTargetSeconds;
  }

  return {
    POLICY_VERSION,
    POLICY_PROFILE,
    USER_PREFERENCE_KEYS,
    RAMP_PROFILE_OVERRIDES,
    DEFAULTS,
    RESOLUTION_PRESETS,
    finiteNumber,
    clamp,
    rangesToArray,
    findContainingRange,
    contiguousBuffer,
    bufferAhead,
    effectiveBufferSeconds,
    furthestBufferedEnd,
    isBuffered,
    trend,
    median,
    zigzagMetrics,
    mergeSettings,
    rampProfileOverrides,
    applyStandardPolicy,
    settingsUseStandardPolicy,
    bufferBand,
    networkHealth,
    derivePlaybackState,
    shouldSendKeepalive,
    normalizedResolutionHeights,
    nextLowerResolution,
    nextHigherResolution,
    coldStartQualityDecision,
    startupRampDecision,
    recoveryThresholdForHeight,
    qualityTrialDecision,
    qualityDecision,
    twoStageHeights,
    deliveryHeadroom,
    predictedTimeToEmpty,
    zigzagHealth,
    preferredCapacityDeficit,
    preferredUpgradeCapacity,
    twoStageQualityDecision,
    shouldRestoreCheckpoint,
    canArmProtection,
    decidePausedPrime
  };
});
