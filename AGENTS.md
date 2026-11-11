# Repository instructions

## Project

- This is the Paseo plugin `paseo-switcher`, an Arc-style Ctrl+Tab workspace switcher.
- Keep `paseo-plugin.json`, `package.json`, the README compatibility badge, and install commands aligned.
- Read the current plugin docs at <https://paseo.sh/docs/plugins> and <https://paseo.sh/docs/plugins/reference> before changing runtime code.

## Code boundaries

- `index.client.tsx` wires the settings screen and Command Center entries, and installs the switcher on web and desktop only.
- `client/model.ts` is pure ordering logic with unit tests. `client/switcher.ts` is the DOM adapter: keyboard handling, the strip, and thumbnails. `client/history.ts` owns chronological history independently of MRU; `client/web.ts` observes and restores routes and focused tabs and mounts the arrows. `client/settings.tsx` is the settings screen.
- `client/switcher.ts` reads Paseo's page structure, which is not a public plugin API. Every selector and route it relies on is listed at the top of that file. The plugin is pinned to one Paseo minor version for that reason.
- Workspace data comes from Paseo's public SDK, never the page: `paseo.workspaces.list({ subscribe: {} })` once at install, then pushed `workspace_update`s (`client/model.ts`: `workspaceMap`, `applyWorkspaceUpdate`). If the host refuses the subscription, opening the switcher falls back to a fresh `list()` when the data is over 5 s old. The same path runs on 0.15 and 0.16.
- A workspace's status is the host's own bucket (`toWorkspaceInfo`), never derived from agents, rows or timeline items; `test/workspaces.test.ts` holds the invariant. When the switcher and Paseo's sidebar disagree, check the server's `status` first: a "Finished" for an errored agent means the server never raised `attentionReason: "error"` (2026-11-11: a demo agent's invalid timeline item did exactly that, and the sidebar showed the same green dot).
- Known difference from Paseo's sidebar: the sidebar shows a "done" workspace as running while a create from that window is still pending, or while that client sees live agent activity the server hasn't reported yet. The SDK descriptor doesn't carry that; Paseo 0.16 exposes it only to React surfaces as `PluginWorkspaceSnapshot.indicator`. `toWorkspaceInfo` prefers `indicator` when a source supplies it, but switcher data must never depend on a mounted surface.
- Layout, count, history and the recent-workspace order stay in this plugin's own `localStorage` keys. Paseo 0.16's `defineSettings({ scope: "device" })` was considered and skipped (2026-11-11): on web it stores in the same `localStorage` (AsyncStorage, under Paseo's private `@paseo:plugin-device-settings:` key), and only the `useSettings` hook in a mounted surface can read it. The switcher reads these values on Ctrl+Tab with no surface mounted, so adopting it would mean reading Paseo's private key or keeping two copies of each value on the same device, with no gain for the user. Revisit if Paseo adds an imperative client settings read.
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

## Release notes

Every GitHub release, betas included, shows real notes in one shape across Tom's plugins. `scripts/release-notes.mjs`
(identical in each repo; keep the copies in sync) builds the body and the publish workflow creates the release with it:

```
<summary or "## What's new in X.Y.Z-beta.N">

### New        what a user can now do
### Improved   what got better
### Fixed      what stopped going wrong

## Install     the command for that channel, the Paseo minimum
```

- **Betas** are generated: the titles of the PRs merged since the previous tag, grouped by their prefix (`feat` is New,
  `fix` is Fixed, anything else user-visible is Improved). `docs`, `chore`, `ci`, `test`, `refactor` and `build`
  PRs, bots, merge lines and raw commit text never appear. So write PR titles as a sentence a user can read:
  `fix: remember which Follow-up plugin id answered`. No PR numbers, no em dashes.
- **Stable and rc** are curated: add `release-notes/<version>.md` (an rc uses its final version's file) before tagging. One
  summary sentence, then `### New`, `### Improved`, `### Fixed` with plain-words bullets for the person using the plugin,
  grouped by what they get and merged across every beta since the last stable. Omit empty groups. The publish workflow
  runs `node scripts/release-notes.mjs --check <tag>` first and fails a stable or rc tag that has no file, before anything
  is published.
- Releases that already exist: edit the body with `gh release edit <tag> --notes-file <file>`. Never touch the tag, assets
  or the prerelease/latest flags. In-app What's new popups stay major-only; this is GitHub only.
- `node --test scripts/release-notes.test.mjs` covers the generator and runs in `verify`.
