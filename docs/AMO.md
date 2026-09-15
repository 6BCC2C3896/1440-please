# Mozilla / AMO submission notes

This file is a checklist for preparing **1440, Please** for Mozilla signing or an AMO listing.

## Product summary

**Name:** 1440, Please

**One-line description:** Keeps YouTube stable at 1440p.

**Longer summary:** A focused Firefox extension that starts YouTube conservatively, preserves a healthy lower-resolution buffer, then ramps toward stable 1440p while avoiding repeated quality flip-flop.

## Permissions justification

- `storage` — stores Enabled/Ramp speed plus local controller/checkpoint state.
- `scripting` — supports extension/page integration required by the controller.
- `webRequest` — passively observes YouTube/Googlevideo request timing and response metadata for local playback decisions.
- `alarms` — drives background scheduling without a permanent content-script interval.
- YouTube/Googlevideo host permissions — required to observe/control the active YouTube media session and media delivery.

## Data collection

The manifest declares no required data collection. See `PRIVACY.md` for the project policy.

## Before submission

- verify all permissions are still required;
- run `node tools/test-all.mjs`;
- run `python3 tools/build-release.py`;
- load/test the exact packaged artifact;
- ensure version is higher than the last submitted version;
- ensure store screenshots/descriptions match the current minimal UI;
- decide listed vs unlisted/self-distributed channel.
