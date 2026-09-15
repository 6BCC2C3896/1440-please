# Release process

## 1. Update the version

Change the version in `manifest.json` and all internal version constants/harness expectations.

Verify consistency:

```bash
node tools/release-check.mjs
```

## 2. Run the full suite

```bash
node tools/test-all.mjs
```

## 3. Build locally

```bash
python3 tools/build-release.py
```

Inspect `dist/` and test the unpacked source in Firefox.

## 4. Commit and tag

```bash
git add .
git commit -m "Release v0.17.8"
git tag v0.17.8
git push origin main --tags
```

The GitHub `release.yml` workflow validates that the tag version matches `manifest.json`, reruns tests, builds the XPI/source archive/checksums, and creates the GitHub Release.

## 5. Mozilla signing

A GitHub-built XPI is unsigned. Firefox Release/Beta requires Mozilla signing.

Two reasonable distribution models are:

- **AMO listed:** Mozilla hosts the public listing and handles normal extension updates.
- **AMO unlisted/self-distributed:** Mozilla signs the extension, and you distribute the signed XPI yourself (for example through GitHub Releases).

Do not label an unsigned CI artifact as a normal-install release.

## 6. Post-release smoke test

On the intended Firefox version:

- install the signed build;
- confirm popup/settings load;
- confirm Enabled and Ramp speed persist;
- test a normal YouTube video from startup through 1440p cruise;
- confirm Shorts are untouched;
- confirm no unexpected console errors.
