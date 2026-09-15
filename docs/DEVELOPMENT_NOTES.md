# Review — 0.17.8 — 1440, Please

## User problem

The extension solves one narrow problem: make long-form YouTube playback reliably converge toward stable 1440p. The UI had begun exposing the implementation history instead of the product outcome.

0.17.4 simultaneously showed:

- Buffer;
- Quality;
- Stage;
- a live indicator;
- a static quality-ramp diagram;
- explanatory ramp prose;
- a ramp-speed hint;
- the ramp-speed control.

The static ramp card repeated information already contained by Quality + Stage and increased cognitive load.

## Decisions

### Keep

- 500 ms live refresh;
- Buffer seconds;
- Quality;
- Stage;
- Defensive/Aggressive;
- Settings entry point.

### Compress

Media-network telemetry becomes one small activity label in the header. This retains diagnostic value without adding a separate card or raw bandwidth number.

### Remove

- static `Native start → 1080–1440 → 1440p` diagram;
- quality-ramp explanatory copy;
- ramp-profile hint prose in the popup;
- settings-page quality-path summary;
- Save and Reset buttons.

### Do not add

- buffer percentile;
- generic browser connection speed;
- raw Mbps in the primary popup.

Both can look authoritative while being semantically weaker than the existing live signals.

## Settings UX

Settings auto-save. The only preferences visible are Enabled and Ramp speed. Ignore Shorts was audited and found to be implemented, but it is now removed from the preference surface; Shorts are always left untouched internally.

## Visual fix

The old segmented active state used a Canvas foreground plus a one-pixel shadow inside a darker rounded parent. In Firefox dark mode this could read as two misaligned shapes. 0.17.8 removes that shadow, clips the parent, and uses a dedicated warm-orange accent for one continuous active pill.
