# Repository instructions

## Project

- This is the Paseo plugin `paseo-switcher`, an Arc-style Ctrl+Tab workspace switcher.
- Keep `paseo-plugin.json`, `package.json`, the README compatibility badge, and install commands aligned.
- Read the current plugin docs at <https://paseo.sh/docs/plugins> and <https://paseo.sh/docs/plugins/reference> before changing runtime code.

## Code boundaries

- `index.client.tsx` wires the settings screen and Command Center entries, and installs the switcher on web and desktop only.
- `client/model.ts` is pure ordering logic with unit tests. `client/switcher.ts` is the DOM adapter: keyboard handling, the strip, and thumbnails. `client/history.ts` owns chronological history independently of MRU; `client/web.ts` observes and restores routes and focused tabs and mounts the arrows. `client/settings.tsx` is the settings screen.
- `client/switcher.ts` reads Paseo's page structure, which is not a public plugin API. Every selector and route it relies on is listed at the top of that file. The plugin is pinned to one Paseo minor version for that reason.
- Navigation observation only schedules work; never snapshot thumbnails or measure layouts on a navigation path. Thumbnail work happens only in idle time, outside the quiet period after a switch. See the performance checks in `TESTING.md`.
- Paseo supplies the SDK, React, React Native, TanStack Query, and Zod at runtime. Keep those packages in `devDependencies`.
- Never commit credentials, daemon state, logs, test artifacts, or local paths.

## Verification and release

- Releases need Tom's manual permission. Features and fixes ship as betas by default. A stable version, npm `latest`, or a hotfix needs Tom's explicit OK for that exact version before it is tagged; never infer it from a plan. For this directory-installed plugin, installing merged main on Tom's VM counts as a beta.
- **Betas.** Tag `vX.Y.Z-beta.N` after bumping `package.json` and its lockfile to that version. `publish-npm.yml` publishes any version containing `-` with `--tag beta` (`scripts/check-dist-tag.mjs`), then verifies after publishing, on the retry path too, that the expected dist-tag points at the version and that a prerelease is never `latest`. Mark the GitHub release as a prerelease (`gh release create vX.Y.Z-beta.N --prerelease --latest=false`). `test/release-channel.test.ts` guards the publish command and the post-publish check.
- Pull requests and `main` run `npm run verify` and `npm pack --dry-run` in CI (`.github/workflows/verify.yml`). Check them with `gh pr checks`.
- Run `npm ci`, `npm run verify`, and `npm pack --dry-run` after changes. Run `npm run e2e -- --reload` against a throwaway daemon before a release (see `TESTING.md`). The browser suites refuse to run against your own daemon.
- Do not restart the Paseo daemon. Use `paseo plugin reload paseo-switcher` for an installed development copy.
- Publish only from a clean `main`, after confirming the packed file list and auditing it for secrets.
- Tag the exact release commit as `vX.Y.Z` (or `vX.Y.Z-beta.N`) and push the tag. `.github/workflows/publish-npm.yml` verifies that the tag matches `package.json`, reruns the release checks, inspects the package, and publishes through npm Trusted Publishing. Do not run `npm publish` manually except to bootstrap the package or recover from a diagnosed workflow failure.
- Wait for the publish workflow and npm registry propagation before creating the GitHub release and updating an installed copy. Never move a published tag.
