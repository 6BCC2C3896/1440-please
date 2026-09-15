# Installing 1440, Please

## Supported browser

**Firefox desktop only.** The project is developed and tested for Firefox and does not claim Chrome, Chromium, Edge, Safari, or Android support.

The manifest currently requires Firefox 142 or newer.

## Temporary development install

This is the fastest way to run the source tree:

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select `manifest.json` in the repository root.
5. Open a normal YouTube video.

This temporary install disappears when Firefox restarts.

## Packaged XPI

Build an unsigned XPI with:

```bash
python3 tools/build-release.py
```

The result is written to `dist/`.

An XPI is simply the packaged extension. **Packaging is not the same as Mozilla signing.**

Firefox Release and Beta require Mozilla-signed extensions. Mozilla's signing process is handled through addons.mozilla.org (AMO), whether the extension is publicly listed or self-distributed.

## Public installation

For normal users, publish one of these:

1. a listed AMO release; or
2. a Mozilla-signed self-distributed XPI attached to a GitHub Release.

Once a signed XPI exists, Firefox users can use **Add-ons and themes → gear menu → Install Add-on From File…** or install it from a suitable web download.

## Developer Edition / Nightly / ESR

Mozilla permits unsigned extension testing in Developer Edition, Nightly, and ESR when signature enforcement is disabled. That is a development path, not the recommended public distribution method.

## Why the repository's GitHub Release XPI may be unsigned

The included GitHub workflow builds reproducible release artifacts, but it does not contain AMO credentials and therefore does not sign them. Signing can be added later as a separate protected workflow using Mozilla credentials/secrets.
