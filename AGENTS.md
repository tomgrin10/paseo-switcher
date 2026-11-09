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

- Run `npm ci`, `npm run verify`, and `npm pack --dry-run` after changes. Run `npm run e2e -- --reload` against a local daemon before a release (see `TESTING.md`).
- Do not restart the Paseo daemon. Use `paseo plugin reload paseo-switcher` for an installed development copy.
- Publish only from a clean `main`, after confirming the packed file list and auditing it for secrets.
- Tag the exact release commit as `vX.Y.Z` and push the tag. `.github/workflows/publish-npm.yml` verifies that the tag matches `package.json`, reruns the release checks, inspects the package, and publishes through npm Trusted Publishing. Do not run `npm publish` manually except to bootstrap the package or recover from a diagnosed workflow failure.
- Wait for the publish workflow and npm registry propagation before creating the GitHub release and updating an installed copy. Never move a published tag.
