# Testing

Two layers:

| Command | What it covers | Needs |
| --- | --- | --- |
| `npm run verify` | Typecheck and unit tests for the ordering logic (`test/model.test.ts`) | Nothing |
| `npm run e2e` | Behavior and performance in Paseo's real web UI, against your local daemon (`test/e2e/run.mjs`) | A running daemon with this plugin installed |
| `npm run e2e:history -- --reload` | Back/forward through session tabs, workspaces and plugin settings; mouse, shortcuts, history branching, the off switch and cleanup | A running daemon and a workspace with two open tabs |

Run `npm run e2e -- --reload` before a release. It also reloads the plugin with `paseo plugin reload paseo-switcher` and checks that it cleans up after itself. Add `--headed` to watch the browser if you have a display.

The history suite sends trusted browser Back/Forward mouse events through Chromium's input protocol, plus BrowserBack/BrowserForward key events. It checks that Settings arrows follow their header when native window-control clearance moves it, remain visible at their last position when a sidebar anchor disappears, and never detach or reparent during workspace navigation. These cover browser behavior; physical Logitech hardware and native macOS command delivery need a manual pass on the user's Mac.

## End-to-end setup

The suite serves the web UI bundled with your installed Paseo CLI on `http://127.0.0.1:8787` and drives it with headless Chromium through `playwright-core`.

1. **The daemon must allow that origin.** `http://127.0.0.1:8787` must be in `daemon.cors.allowedOrigins` in `~/.paseo/config.json`. To check, run the following; `101` means it's allowed and `403` means it isn't:

   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' -m 3 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
     -H 'Origin: http://127.0.0.1:8787' http://127.0.0.1:6767/ws
   ```

2. **The daemon must be running locally.** No password is needed. The suite logs in the way the desktop app does, with the token the daemon writes to `~/.paseo/local-credential` at startup (or `$PASEO_HOME/local-credential`). It adds that token to the web UI's hello message from inside the page, so nothing is saved to disk and nothing slows the performance checks.

3. **Port 8787 must be free.** Stop any other server on it first.

4. **You need at least 7 workspaces** in the sidebar. The suite opens some of them and switches between them. It never sends messages, edits drafts, or changes workspaces. It does reset this plugin's own history and limit in the test browser, which is separate from your desktop app.

### Against an isolated daemon

To keep your own daemon and workspaces out of it, run a throwaway daemon with the web UI enabled (`paseo daemon run --home <dir>`, with `features.webUi.enabled` and plugins on in its `config.json`), install this checkout into it with `paseo --home <dir> plugin install .`, create at least 7 workspaces, and point the suite at it:

```sh
E2E_ORIGIN=http://127.0.0.1:<its port> PASEO_HOME=<dir> npm run e2e -- --reload
```

`E2E_ORIGIN` makes the suite use the web UI that daemon serves instead of serving one on 8787, and `PASEO_HOME` makes `--reload` reload the plugin there. A daemon without a password needs no credential.

A Chromium build matching `playwright-core` must be in `~/.cache/ms-playwright`. If it's missing, install it with `npx playwright-core install chromium-headless-shell`.

The run takes about four minutes. It prints a PASS/FAIL line per check, writes `test/artifacts/results.json`, saves screenshots to `test/artifacts/`, and exits non-zero if any check fails.

## What the checks mean

**Behavior (B)**

| ID | Check |
| --- | --- |
| B1 | Visiting workspaces records them most recent first |
| B2 | Holding Ctrl+Tab shows the 5 most recent workspaces, in that order |
| B3 | The previous workspace is preselected, so a single Ctrl+Tab goes back |
| B4, B4b | Thumbnails are rendered images with real content, not blank |
| B5–B7 | Tab wraps around; Shift+Tab and the arrow keys move |
| B8 | Releasing Ctrl switches to the selected workspace |
| B9, B10 | A quick tap flips to the previous workspace and never draws the strip |
| B11 | Repeated taps toggle between the last two workspaces |
| B12 | A fast double tap goes two back, still without drawing |
| B13 | Esc cancels, and releasing Ctrl afterwards does nothing |
| B14 | Number keys 1–9 jump straight to a card |
| B15 | Ctrl+Shift+Tab starts at the oldest card |
| B16 | Losing window focus cancels |
| B17–B21 | Command Center entry: Enter or a click switches; hover selects; clicking the backdrop closes |
| B22 | Ctrl+Tab in the message box switches and types nothing into it |
| B23 | Switching works with the sidebar collapsed |

**Type to filter (F)**

| ID | Check |
| --- | --- |
| F1 | Typing while the switcher is open filters it |
| F2 | After typing, releasing Ctrl keeps the switcher open |
| F3 | Enter switches to the top match |
| F4 | With no match, an empty state shows and Enter does nothing |
| F5 | Esc clears the filter first, then closes |
| F6 | Filtering a keystroke takes under 30 ms |
| F7 | While open, typed keys never reach Paseo's shortcuts (Ctrl+K stays closed) |

**Settings (S):** the limit defaults to 5, the settings screen saves a new value, the strip honors it, and it survives a reload.

**List layout (L)**

| ID | Check |
| --- | --- |
| L1, L2 | The settings screen shows Layout, default List, and choosing Thumbnails, then List, saves each |
| L3 | The list shows the 5 most recent workspaces as rows, previous one selected, no thumbnails |
| L4 | No workspace name is cut off at 900px or 440px, and the list stays inside the window |
| L5 | Holding Ctrl, two Tabs and release switches to the third most recent |
| L6 | Opening the list takes under 30 ms with under 200 elements; moving takes under 5 ms |
| L7 | In the list layout, no thumbnail snapshots run in the background |
| L8 | Screenshots: `list-light.png`, `list-dark.png`, `list-900.png`, `list-440.png` |

**Visual (V):** the strip fits a 900px window. Screenshots in light, dark, narrow, and limit-3 layouts land in `test/artifacts/` for a human look.

**Performance (P).** Thresholds are set for a slow cloud VM; a laptop is usually several times faster.

| ID | Check | Threshold |
| --- | --- | --- |
| P1 | Plugin work for a quick tap, including the click it sends | < 5 ms |
| P2 | Time until Paseo paints the next workspace (Paseo's own render) | informational |
| P3 | Building the strip | < 30 ms |
| P4 | Elements in the strip (thumbnails are canvases, not copies of the app) | < 120 |
| P5 | Style recalculation when opening (the original version took about 500 ms) | < 80 ms |
| P6 | Moving the selection, worst of 60 | < 5 ms |
| P7 | Holding: strip on screen after the 110 ms tap guard | < 170 ms |
| P8 | Releasing: strip gone from the screen before Paseo renders the next workspace | < 60 ms |
| P9 | While an agent streams, thumbnails keep refreshing | ≥ 4 in 15 s |
| P10 | While an agent streams, no single plugin task blocks the app | < 50 ms |
| P11 | While an agent streams, total plugin work | < 3% of the time |
| P12 | Normal sidebar switching with the plugin vs. without it (real mouse clicks) | median within 20% + 40 ms |

P10 and P11 read the `pws:snapshot`, `pws:serialize` (with its `pws:xml` and `pws:css` parts) and `pws:draw` User Timing entries the plugin records. Any browser profiler shows the same entries.

**Paseo shortcuts (K).** The suite binds Paseo's Next tab and Previous tab to Ctrl+Tab and Ctrl+Shift+Tab, as a user can in Settings → Keyboard shortcuts, and then removes those bindings again.

| ID | Check |
| --- | --- |
| K1 | Ctrl+Tab and Ctrl+Shift+Tab still move the switcher's selection |
| K2 | Paseo's tab shortcuts bound to those keys do not fire. This needs a workspace with two tabs among the first 10; otherwise it is skipped. |
| K3 | Other listeners see only those two combos as an unidentified key: Shift+Tab, Cmd+Ctrl+Tab and Ctrl+A are unchanged |
| K4 | Disposing the plugin gives the keys back |

**Lifecycle (R, E):** after a plugin reload there is exactly one switcher, which still claims Ctrl+Tab (`--reload` only). The plugin raised no page errors.

## When a check fails

- **B or S checks:** Paseo's markup may have changed. Every selector and route the plugin relies on is listed at the top of `client/switcher.ts`; the test's own selectors are in `test/e2e/run.mjs`.
- **P10 or P11:** look at which `pws:*` entry grew. Snapshots get slower with very large conversations.
- **P12:** rerun first, because this VM is noisy. If it holds, something in the plugin is running on a navigation path, which it must never do.

## README media

`npm run media` records `docs/media/switcher.gif` (list layout: browse, release, quick tap back, type to filter), `switcher-thumbnails.gif`, and stills of the list in dark and light, a filter, and the phone layout, from the real plugin.

Run it against a throwaway daemon (see [Against an isolated daemon](#against-an-isolated-daemon)) whose workspaces are named as in `SAMPLES` in `test/e2e/media.mjs`. The script adds each sample's pull request, checks, review, diff stat and status to the daemon's messages inside the page, replaces the machine's host name, and refuses to write anything if a row or card shows a name that is not a sample. It encodes GIFs with ffmpeg (`PATH` or `FFMPEG`), or with sharp when `SHARP` names a directory that can require it.
