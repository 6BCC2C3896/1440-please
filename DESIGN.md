# Design — 0.17.8 — 1440, Please

## Scope

0.17.8 is deliberately a **presentation release**. The soft 1080→1440 warm-up controller introduced in 0.17.3 and the Defensive/Aggressive timing profiles introduced in 0.17.4 remain unchanged.

The design question is therefore not "what else can we show?" but:

> What is the smallest interface that tells the user whether Guardian is doing its job?

## Popup information hierarchy

### 1. Buffer

The largest value is the current effective playable buffer in seconds. It is direct, live, and understandable without interpretation.

### 2. Quality

The actual current representation (`720p`, `1080p`, `1440p`, etc.). This answers the user's primary outcome question.

### 3. Stage

Human-readable state derived from the controller:

- Starting
- Warming 1440p
- Testing 1440p
- Settling 1440p
- Stable 1440p
- Stepping down
- Holding lower

This replaces the static quality-ramp explainer because the stage itself tells the user where the ramp currently is.

### 4. Network activity

Network information is compressed into the small header state:

- Streaming
- Buffered
- Idle
- Stalled
- Disabled

This is derived from browser-level media telemetry. Raw Mbps is intentionally not shown because segmented YouTube traffic is bursty and the number can look more precise than it is.

## Configuration hierarchy

The popup and options surface only one tuning choice: Defensive or Aggressive.

The options page exposes exactly three settings:

- Enabled
- Ramp speed

All settings auto-save.

## Buffer percentile decision

Do not show one.

A percentile requires an arbitrary reference distribution or target. In this project the successful operating range can legitimately vary by video and representation, so a percentile can tell the user that a perfectly stable low reservoir is "bad." Seconds ahead plus controller Stage are less contradictory.

## Rounded geometry

Every visible card/segmented control has:

- one border;
- one border radius;
- `overflow: clip`;
- no extra active-state outline positioned behind the rounded foreground.

This removes the dark square/edgy backing artifact seen in Firefox dark mode.
