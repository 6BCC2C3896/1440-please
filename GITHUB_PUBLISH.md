# First GitHub publish

This repository is ready to push as `1440-please`.

## 1. Create an empty GitHub repository

Recommended repository name:

```text
1440-please
```

Do not ask GitHub to generate a README, license, or `.gitignore`; this package already includes them.

## 2. Initialize locally

From the extracted repository root:

```bash
git init
git branch -M main
git add .
git commit -m "Initial public release of 1440, Please"
```

## 3. Attach the GitHub remote

Replace the example with the repository URL GitHub gives you:

```bash
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

## 4. Verify GitHub Actions

The `CI` workflow should run automatically on the first push. It executes the complete test stack and builds unsigned XPI/source artifacts.

## 5. Create the first GitHub Release

After CI is green:

```bash
git tag v0.17.8
git push origin v0.17.8
```

The release workflow will:

1. verify the tag matches `manifest.json`;
2. run all tests/harnesses;
3. build the XPI and source archive;
4. generate SHA-256 checksums;
5. create a GitHub Release and attach the artifacts.

## 6. Mozilla signing before calling it a normal-user install

The GitHub-generated XPI is unsigned. Submit it to Mozilla/AMO for signing before presenting it as a normal Firefox Release/Beta install.

After signing, replace or additionally attach the Mozilla-signed XPI to the GitHub Release and label it clearly as the signed installable build.

## 7. Optional repository settings

Recommended after the first push:

- enable **Issues**;
- enable **Private vulnerability reporting** under Security if available;
- protect `main` once the workflow is stable;
- require the CI workflow before merge;
- add a short repository description: `Keeps YouTube stable at 1440p in Firefox.`;
- add topics such as `firefox`, `youtube`, `webextension`, `1440p`, `buffering`, `video`.
