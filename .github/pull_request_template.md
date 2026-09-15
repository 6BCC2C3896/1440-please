## What changed?


## What playback failure or maintenance problem does this address?


## Validation

- [ ] `node tools/test-all.mjs`
- [ ] `node tools/release-check.mjs`
- [ ] `python3 tools/build-release.py`
- [ ] No forbidden playback actuator was introduced
- [ ] UI changes remain focused on stable 1440p

### Manual Firefox validation (controller changes)

- [ ] Native startup remains stable
- [ ] Lower-quality buffer is preserved during ramp-up
- [ ] 1440p promotion does not immediately flip-flop
- [ ] Failed 1440p path falls back and respects retry backoff
- [ ] Long 1440p cruise checked
- [ ] Shorts remain untouched

Firefox version:

Ramp profile:

Observed buffer/quality/stage behavior:
