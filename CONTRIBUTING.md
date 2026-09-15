# Contributing

Thanks for helping improve **1440, Please**.

This project is intentionally narrow: make ordinary YouTube playback reliably reach and remain at 1440p in Firefox without replacing YouTube's media stack.

## Before changing controller behavior

Please preserve these principles:

1. **Firefox first.** Do not weaken the Firefox implementation merely to claim cross-browser compatibility.
2. **Native startup first.** Let YouTube prove normal playback before intervention.
3. **Preserve working media.** Avoid quality actions that discard a healthy lower-resolution reservoir before 1440p is ready.
4. **Prefer evidence over timers.** Buffer, delivery activity, switch history, and missed-refill evidence matter more than one instantaneous number.
5. **Do not reintroduce dangerous actuators.** No playing-state seek kicks, SABR/player-time rewriting, synthetic parallel video fetches, or page fetch/XHR monkeypatching.
6. **Keep the UI small.** The product surface is Buffer, Quality, Stage, activity, Enabled, and Ramp speed.

## Setup

Requirements:

- Node.js 24 recommended
- Python 3 for packaging
- Firefox desktop for manual integration testing

Run the complete suite:

```bash
node tools/test-all.mjs
```

Build artifacts:

```bash
python3 tools/build-release.py
```

## Pull requests

A controller change should include:

- a concise description of the observed playback failure;
- a deterministic regression test or harness scenario;
- evidence that the fix does not reintroduce flip-flop or startup instability;
- confirmation that the forbidden-capability scan still passes;
- manual Firefox observations when the change depends on real YouTube behavior.

A UI-only change should not modify controller constants unless explicitly justified.

## Manual Firefox checks

For meaningful playback changes, test at least:

1. clean video startup;
2. quality ramp from a lower representation toward 1440p;
3. buffer preservation across quality changes;
4. 1440p near-zero transition with active delivery;
5. genuine failed 1440p transition and fallback;
6. retry backoff / absence of quality flip-flop;
7. longer 1440p cruise behavior;
8. video navigation/reload;
9. extension disable/enable;
10. Shorts remain untouched.

Record the Firefox version and whether Defensive or Aggressive was used.

## Versioning

Runtime version lives in `manifest.json`. Internal version constants and deterministic harness expectations must match it. Run `node tools/release-check.mjs` before tagging.

## Scope

Please open an issue before a large refactor. This is not intended to become a general YouTube enhancement suite.
