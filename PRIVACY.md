# Privacy

**1440, Please does not collect or transmit analytics or personal data to the project developer.**

## What the extension reads locally

To stabilize playback, the extension can inspect information associated with the active YouTube tab, including:

- the current video's playback state and buffered ranges;
- current playback quality reported by YouTube's page player;
- timing and metadata for YouTube/Googlevideo media requests;
- local controller state such as buffer trend, recent stalls, quality transitions, and a local resume checkpoint.

## Network access

The extension has host permissions for YouTube, Googlevideo media hosts, and YouTube's watch-time host because those are part of normal YouTube playback and are used for local controller/diagnostic decisions.

The extension may send lightweight keep-warm requests to Googlevideo as part of its playback strategy. These requests stay within YouTube/Googlevideo infrastructure.

## What is not collected

The extension does not intentionally send the following to the developer or an analytics provider:

- browsing history;
- YouTube account identity;
- video history;
- cookies or passwords;
- personal profile information;
- controller telemetry;
- crash analytics;
- advertising identifiers.

There is no project telemetry server and no third-party analytics SDK.

## Local storage

Firefox extension storage is used for the small user preference surface and local playback/controller state. Current user-facing preferences are:

- Enabled
- Ramp speed (Defensive or Aggressive)

Shorts are always left untouched and are not configurable.

## Changes

If the data model changes in a future release, this document should be updated in the same pull request before release.
