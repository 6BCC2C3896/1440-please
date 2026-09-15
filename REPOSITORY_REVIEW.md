# GitHub repository review

This review scores what makes **1440, Please** usable as a public Firefox extension repository rather than merely a source dump.

## 11 criteria

| # | Criterion | Weight | Definition |
|---:|---|---:|---|
| 1 | First-screen product clarity | 14% | A visitor understands the problem and 1440p outcome immediately. |
| 2 | Safe install clarity | 12% | Firefox-only support, temporary install, XPI, and Mozilla signing are not confused. |
| 3 | Reproducible validation | 12% | Contributors and CI can run the same complete test stack. |
| 4 | Reproducible packaging | 10% | XPI/source/checksums are generated deterministically from the repo. |
| 5 | Firefox compatibility truthfulness | 9% | The repo clearly states what is and is not tested/supported. |
| 6 | Privacy/security transparency | 9% | Permissions, local telemetry, data handling, and risky mechanisms are documented. |
| 7 | Contribution ergonomics | 8% | Bugs/PRs arrive with useful playback evidence and regression tests. |
| 8 | Release ergonomics | 8% | Tags can produce verified GitHub release artifacts with minimal manual work. |
| 9 | Repository hygiene | 7% | Ignore rules, editor settings, source/runtime separation, and version consistency are enforced. |
| 10 | Technical depth without front-page clutter | 6% | Architecture/history remain available without overwhelming normal users. |
| 11 | Future AMO readiness | 5% | Permissions, signing, privacy, and listing material are already organized. |

## 28 ranked ideas

| Rank | Idea | Score | Status | Why |
|---:|---|---:|---|---|
| 1 | Rewrite root README around the single 1440p job | 99 | Implemented | Converts the repo from development notes into a product page. |
| 2 | Explicit Firefox-only support statement | 99 | Implemented | Prevents unsupported Chrome/Edge expectations. |
| 3 | Explain unsigned vs Mozilla-signed XPI | 99 | Implemented | Essential for honest installation instructions. |
| 4 | One-command complete test runner | 98 | Implemented | Makes local/CI validation identical. |
| 5 | Reproducible XPI + source build script | 98 | Implemented | Makes releases auditable and repeatable. |
| 6 | GitHub CI on push/PR | 97 | Implemented | Prevents regressions before merge. |
| 7 | Tag-driven GitHub Release workflow | 97 | Implemented | Makes releases nearly mechanical. |
| 8 | SHA-256 checksum generation | 96 | Implemented | Lets users verify downloaded artifacts. |
| 9 | Privacy policy matching real permissions | 96 | Implemented | Important for trust and AMO review. |
| 10 | Security policy + private-report guidance | 94 | Implemented | Gives vulnerability reports a safe route. |
| 11 | Playback-specific bug template | 94 | Implemented | Captures Firefox/profile/buffer/stage evidence. |
| 12 | Focused contributing guide | 93 | Implemented | Protects the project's narrow architecture. |
| 13 | Release consistency checker | 93 | Implemented | Prevents mismatched manifest/internal versions. |
| 14 | AMO submission checklist / permission rationale | 92 | Implemented | Reduces future signing/listing work. |
| 15 | Preserve deep controller docs outside the README | 91 | Implemented | Keeps technical history without front-page noise. |
| 16 | PR template with test/live-validation checklist | 90 | Implemented | Improves review quality. |
| 17 | Feature-request template with scope guard | 89 | Implemented | Discourages turning it into a general YouTube suite. |
| 18 | `.gitignore`, `.editorconfig`, `.gitattributes` | 88 | Implemented | Basic public-repo hygiene. |
| 19 | `package.json` scripts despite zero dependencies | 87 | Implemented | Standard discoverable commands without dependency bloat. |
| 20 | Dedicated compatibility document | 86 | Implemented | Separates tested fact from possible compatibility. |
| 21 | GitHub CODEOWNERS | 75 | Deferred | Useful only after maintainers/paths are finalized. |
| 22 | Automated AMO signing from GitHub Actions | 74 | Deferred | Valuable later, but requires protected Mozilla credentials and channel decision. |
| 23 | Public AMO listing metadata/screenshots | 72 | Deferred | Needs final store assets and actual AMO submission. |
| 24 | CI browser E2E against live YouTube | 65 | Deferred | Live YouTube is nondeterministic and account/network sensitive; better as optional/manual evidence first. |
| 25 | Chromium compatibility workflow | 38 | Rejected for now | Conflicts with Firefox-only tested scope. |
| 26 | Expose advanced controller knobs in settings | 24 | Rejected | Undermines the intentionally narrow product surface. |
| 27 | Add third-party analytics to understand users | 10 | Rejected | Adds privacy cost to a tiny local utility. |
| 28 | Publish unsigned XPI as if it were normal Firefox installable | 0 | Rejected | Misleading; Firefox Release/Beta requires Mozilla signing. |

## Result

The repository is considered GitHub-ready when all implemented items above pass `node tools/test-all.mjs`, `node tools/release-check.mjs`, and `python3 tools/build-release.py` from a clean checkout.
