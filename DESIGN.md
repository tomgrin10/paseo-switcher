---
name: Workspace Switcher (Paseo Ctrl+Tab overlay)
description: Land in the intended workspace in one gesture; when it is not among the recent ones, type a few letters.
colors:
  scrim: "rgba(24, 24, 27, 0.34)"
  panel: "rgba(246, 246, 247, 0.96)"
  solid: "#f6f6f7"
  ink: "#18181b"
  muted: "#63636b"
  border: "rgba(0, 0, 0, 0.1)"
  tile: "rgba(0, 0, 0, 0.07)"
  selected: "rgba(0, 0, 0, 0.07)"
  ring: "rgba(0, 0, 0, 0.16)"
  faint: "rgba(0, 0, 0, 0.05)"
  thumb-border: "rgba(0, 0, 0, 0.08)"
  key: "rgba(255, 255, 255, 0.95)"
  mark: "rgba(24, 24, 27, 0.12)"
  running-blue: "#2563eb"
  waiting-amber: "#b45309"
  waiting-amber-dot: "#f59e0b"
  failed-red: "#dc2626"
  finished-green: "#16a34a"
  merged-purple: "#7c3aed"
  diff-add: "#15803d"
  diff-del: "#dc2626"
  scrim-dark: "rgba(0, 0, 0, 0.5)"
  panel-dark: "rgba(30, 30, 33, 0.95)"
  solid-dark: "#1e1e21"
  ink-dark: "#f4f4f5"
  muted-dark: "#a1a1aa"
  border-dark: "rgba(255, 255, 255, 0.09)"
  tile-dark: "rgba(255, 255, 255, 0.1)"
  selected-dark: "rgba(255, 255, 255, 0.08)"
  ring-dark: "rgba(255, 255, 255, 0.17)"
  faint-dark: "rgba(255, 255, 255, 0.05)"
  thumb-border-dark: "rgba(255, 255, 255, 0.07)"
  key-dark: "rgba(255, 255, 255, 0.07)"
  mark-dark: "rgba(255, 255, 255, 0.16)"
  running-blue-dark: "#60a5fa"
  waiting-amber-dark: "#fbbf24"
  failed-red-dark: "#f87171"
  finished-green-dark: "#4ade80"
  merged-purple-dark: "#a78bfa"
typography:
  query:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  name:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
    letterSpacing: "-0.01em"
  empty-title:
    fontSize: "14px"
    fontWeight: 600
  status:
    fontSize: "12px"
    fontWeight: 550
    lineHeight: "20px"
  meta:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "17px"
    fontFeature: "tnum"
  hint:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
  empty-text:
    fontSize: "12.5px"
    fontWeight: 400
  branch:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
  keycap:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16px"
    fontFeature: "tnum"
  tile-letter:
    fontSize: "12px"
    fontWeight: 650
  placeholder-letter:
    fontSize: "17px"
    fontWeight: 650
rounded:
  chrome-button: "6px"
  mark: "3px"
  key: "5px"
  tile: "7px"
  thumb: "9px"
  placeholder-tile: "10px"
  row: "12px"
  card: "15px"
  sheet-list: "18px"
  sheet-strip: "22px"
  pill: "999px"
spacing:
  row-gap: "2px"
  card-gap: "6px"
  list-inset: "6px"
  sheet-hint-gap: "10px"
  strip-inset: "10px"
  row-y: "10px"
  row-x: "12px"
  row-column-gap: "12px"
  phone-column-gap: "10px"
  phone-edge: "16px"
  query-x: "18px"
  strip-edge: "48px"
  top: "max(48px, 16vh)"
components:
  sheet-list:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.sheet-list}"
    width: "min(680px, calc(100vw - 32px))"
  sheet-strip:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.sheet-strip}"
    padding: "10px"
  row:
    rounded: "{rounded.row}"
    padding: "10px 12px"
    typography: "{typography.name}"
  row-selected:
    backgroundColor: "{colors.selected}"
    rounded: "{rounded.row}"
  row-phone:
    rounded: "{rounded.row}"
    padding: "10px"
  card:
    rounded: "{rounded.card}"
    padding: "8px 8px 10px"
    width: "176px to 240px"
  card-selected:
    backgroundColor: "{colors.selected}"
    rounded: "{rounded.card}"
  thumbnail:
    rounded: "{rounded.thumb}"
  project-tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.muted}"
    rounded: "{rounded.tile}"
    size: "22px"
    typography: "{typography.tile-letter}"
  placeholder-tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.muted}"
    rounded: "{rounded.placeholder-tile}"
    size: "36px"
    typography: "{typography.placeholder-letter}"
  keycap:
    backgroundColor: "{colors.key}"
    textColor: "{colors.muted}"
    rounded: "{rounded.key}"
    height: "18px"
    padding: "0 5px"
    typography: "{typography.keycap}"
  query-bar:
    backgroundColor: "{colors.solid}"
    textColor: "{colors.ink}"
    height: "48px"
    padding: "0 18px"
    typography: "{typography.query}"
  hint-bar:
    backgroundColor: "{colors.solid}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
    typography: "{typography.hint}"
  status-dot:
    rounded: "{rounded.pill}"
    size: "8px"
  status-ring:
    textColor: "{colors.running-blue}"
    rounded: "{rounded.pill}"
    size: "9px"
  name-mark:
    backgroundColor: "{colors.mark}"
    rounded: "{rounded.mark}"
  empty-state:
    padding: "26px 32px"
    typography: "{typography.empty-title}"
---

# Design System: Workspace Switcher

## Overview

**Creative North Star: "The Cmd+Tab Sheet"**

The switcher is a macOS-grade switcher sheet drawn over Paseo. The app dims, and one translucent panel of workspaces appears near the top of the window, the way Spotlight does. Rows run in recency order, the selected one is lifted by a neutral ring, and a keycap legend sits under the sheet. When you type, a search field becomes the sheet's header without leaving the gesture. This is the signature move: the panel stays where it is, and the rows below the query never move.

It is an overlay, not a Paseo screen. It draws itself with plain DOM outside React, so it owns a small palette of zinc neutrals in two themes. The theme comes from the luminance of the workspace surface the sheet opens over, not from host tokens. Its only colours are Paseo's status hues, so a status reads exactly as it does in the sidebar. Selection never uses a hue. The settings screen is the exception: it is entirely the host's own `SettingsSection`, `SettingsCard` and `SettingsSelect`, with no styling of its own.

The density is that of a launcher. Names are 14px, everything else is 11–12px, and the query is the largest text on screen at 15px. Each row answers "which one is it" (number, project, name, branch, pull request, checks, diff, unpushed commits) and "what is its agent doing" (the status column) in two lines.

**Key Characteristics:**

- One translucent sheet over a dimmed app; the hint pill is a separate solid object beneath it.
- Recency order always; the order never reshuffles by status.
- Neutral selection: a 7–8% fill plus a 1px inset ring, never a hue.
- Paseo's status language: blue turning ring for running, amber for needs input, red for failed, green for finished, and purple for merged pull requests.
- Lucide icons for PR state, checks, unpushed commits and search; keycaps for keys.
- Built for speed: plain DOM, under 200 elements, nothing on a navigation path.

## Colors

Zinc neutrals in two themes, with Paseo's status hues as the only colour. Each hue has a light value and a brighter dark value.

### Status

- **Running Blue** (`running-blue` / `running-blue-dark`): the turning ring of a running agent, in the status column and on thumbnail titles. The "Running" label stays in ink, because the ring already carries the hue.
- **Waiting Amber** (`waiting-amber`, dot `waiting-amber-dot` / `waiting-amber-dark`): needs input. The dot uses the brighter amber and the label uses the darker one so the text stays legible on light grounds. Pending checks also use this amber.
- **Failed Red** (`failed-red` / `failed-red-dark`): a failed agent (dot and label), failing checks, "Changes requested", and the icon of a closed pull request.
- **Finished Green** (`finished-green` / `finished-green-dark`): an agent that finished and hasn't been looked at yet (Paseo's "attention", labelled "Finished"), passing checks, "Approved", and the icon of an open pull request.
- **Merged Purple** (`merged-purple` / `merged-purple-dark`): a merged pull request, icon and label together.
- **Diff** (`diff-add`, `diff-del`): `+N` and `−N` line counts. In dark they share the finished green and failed red.

### Neutral

- **Scrim** (`scrim` / `scrim-dark`): dims the whole app enough that page text never competes with the sheet and the hint.
- **Panel** (`panel` / `panel-dark`): the sheet, at 95–96% opacity over a 28px blur saturated 1.4×.
- **Solid** (`solid` / `solid-dark`): opaque surfaces that sit on the sheet or the scrim: the query header and the hint pill.
- **Ink** (`ink` / `ink-dark`): names, query text, PR numbers, the status label for running, and keycaps in the hint.
- **Muted** (`muted` / `muted-dark`): the meta line, times, counts, keycaps on rows, the search icon, tile letters and the "Type to filter" hint.
- **Border** (`border` / `border-dark`): the sheet edge, the query header's bottom rule, the hint pill edge, and the keycap edge and bottom lip.
- **Tile** (`tile` / `tile-dark`): the project tile and the placeholder letter tile.
- **Selected and Ring** (`selected`, `ring` and their dark values): the selected row or card fill and its 1px inset ring. The ring colour is also the strip's scrollbar thumb.
- **Mark** (`mark` / `mark-dark`): the highlight behind the matched letters of a filtered name.
- **Faint, Thumb border and Key**: the placeholder thumbnail ground, the thumbnail hairline, and the keycap face.

### Named Rules

**The Neutral Selection Rule.** The selected item is lifted by a neutral fill and a 1px inset ring, never by an accent or status hue. Hue always means agent or pull request state.

**The Say What Paseo Says Rule.** Status words and hues match the sidebar: "Running" with a blue turning ring, "Needs input" amber, "Failed" red, "Finished" green. A workspace with no live status ("done") gets no mark at all, only its age.

**The Checks Are Not Agents Rule.** A pending check reads "pending" in amber, never "running" in blue, so a check can never be mistaken for the agent's own status.

## Typography

**Body Font:** system sans (`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`)
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` at 11.5px, for branch names only

**Character:** One system face in a narrow range. Hierarchy comes from weight (400 / 500 / 550 / 600 / 650) and ink versus muted. Every changing number (keycap numbers, diff counts, times, match counts, PR numbers) is tabular.

### Hierarchy

- **Query** (500, 15px): the typed filter in the query header, followed by a 1.5 × 19px blinking caret.
- **Name** (600, 14px, 20px, −0.01em): the workspace name. In the list it wraps in full and is never truncated. On thumbnail cards it is clamped to two lines at a 19px line height.
- **Empty title** (600, 14px): "No workspace matches “…”", "No workspaces yet", and "Loading workspaces" (500, muted, with a spinner).
- **Status** (550, 12px, 20px): the status label in the side column.
- **Meta** (400, 12px, 17px, muted): project, PR, checks, review, diff and unpushed count, separated by a 12px gap rather than dots; times use the same size, right-aligned.
- **Hint** (400, 12px, 18px): keycap labels in ink at 85% opacity.
- **Empty text** (400, 12.5px, muted): the line under an empty title.
- **Branch** (mono 11.5px): the branch, shown only when it differs from the name.
- **Keycap** (600, 11px, 16px, tabular): keys and row numbers.

### Named Rules

**The Mono Is For Branches Rule.** Mono marks a git branch. Names, projects and PR numbers stay in the sans.

**The Full Name Rule.** In the list, names and branches wrap rather than ellipsize, so two similar names can always be told apart.

## Layout

- **Placement:** the overlay fills the window and pins its content to the top, at `max(48px, 16vh)`, centred. So the sheet grows downward and never jumps while you type. The sheet and the hint stack with a 10px gap.
- **List (default):** the sheet is `min(680px, 100vw − 32px)` wide. Rows stack 2px apart inside a 6px inset. Each row is a grid of number keycap | 22px project tile | name and meta | status column, with 12px column gaps and 10 × 12px padding. The list scrolls inside a height of `100vh − top − 150px`. It scrolls the selection into view only when it overflows, because scrolling forces a layout.
- **Thumbnails:** cards from 176px to 240px wide (aspect 0.66) are sized to fit every card in the window less 48px a side. They sit 6px apart inside a 10px inset. A strip that still overflows scrolls sideways and fades 28px at each edge rather than cutting a card. Cards align to the top, so a two-line name never stretches its neighbours.
- **Phone rule (under 600px):** the thumbnail layout falls back to the list. The project tile drops and the grid tightens to 10px gaps with 10px padding. The meta line wraps, and the hint becomes the sentence "Tap a workspace to switch". A coarse pointer gets that sentence at any width.
- **Status column:** right-aligned and unwrapped. The status line sits on the name's 20px baseline, and the time sits under it.

## Elevation & Depth

There are three layers: the scrim, the blurred translucent sheet, and opaque solids on top (the query header and the hint pill). The sheet is the only element that casts a shadow. Everything inside it is flat, and selection is an inset ring, not a lift.

### Shadow Vocabulary

- **Sheet** (`box-shadow: 0 24px 64px rgba(0, 0, 0, 0.26), 0 2px 8px rgba(0, 0, 0, 0.1)`): the floating sheet, both themes.
- **Selection ring** (`box-shadow: inset 0 0 0 1px var(--pws-ring)`): the selected row or card.
- **Keycap lip** (`box-shadow: 0 1px 0 var(--pws-border)`): the 1px bottom edge that makes a keycap read as a key.
- **Match halo** (`box-shadow: 0 0 0 1px var(--pws-mark)`): extends the match highlight past the glyph edges.

### Named Rules

**The One Floating Sheet Rule.** One object floats and casts a shadow. Rows, cards and the query header are flat, and the hint is a solid pill with no shadow or blur, so it stays readable over any page.

## Shapes

Nested rounded rectangles. Each radius is smaller than the one around it: sheet 22px (strip) or 18px (list), card 15px, row 12px, placeholder tile 10px, thumbnail 9px, project tile 7px, keycap 5px, match 3px. The hint is a pill. Status dots and the running ring are circles (8px and 9px). The ring has a 1.75px stroke with its top quarter open.

## Components

### Sheet

The one floating panel: `panel` over a 28px blur, a 1px `border` edge, the sheet shadow, and `listbox` role labelled "Switch workspace". It holds the optional query header and the rows or cards, and clips them to its corners.

### List row (signature)

- **Number keycap:** 1–9 for the first nine rows (empty beyond), 1px below the top.
- **Project tile:** 22px `tile` square with 7px corners, holding the project's first letter in muted 650 (or "?"). It is a neutral tile, never coloured per project.
- **Main:** the full name (marked letters when filtering) and a wrapping meta line: project, branch (mono, only when not the name), PR chip (Lucide icon + `#N` and "Draft", "Merged" or "Closed"), checks (icon + passed/failed/pending), "Approved" or "Changes requested", `+N −N`, and the unpushed count with an up arrow and a "N commits not pushed" tooltip. Checks and review show only while the PR is open or draft.
- **Status column:** the status mark and label, then "for 8m"; with no live status, just "2h ago" or "just now".
- **States:** hover moves the selection (no separate hover style), a click commits, and selection changes the background and ring over 90ms.

### Thumbnail card

A 15px-cornered card with a thumbnail framed by a 1px hairline at 9px corners. The thumbnail ground is the workspace's own surface colour. The number keycap sits 6px in from the top-right corner. Below come the title (status mark + name, two lines at most) and a meta line (project · branch, then the diff). Before a raster exists, or when it was taken in the other theme, a placeholder shows a 36px letter tile and "No preview yet".

### Status marks

- **Running:** a 9px ring in `running-blue`, turning once per 0.9s. Under reduced motion it stands still with a dotted stroke.
- **Needs input, Failed, Finished:** 8px dots in `waiting-amber-dot`, `failed-red` and `finished-green`.
- **Done:** no mark.

### Query header

It appears only once there is a query: a 48px `solid` bar with a bottom rule, a 16px muted search icon, the query in 500 15px, a blinking caret, and a right-aligned tabular count ("1 match", "2 matches", "5 of 12"; empty when nothing matches). Matched letters in names take the `mark` highlight.

### Hint keycaps

A `solid` pill under the sheet that lists only the keys that work right now:

- Holding: Ctrl "release to switch", Shift Tab "back", Esc "cancel", then muted "Type to filter".
- Opened from the Command Center: Enter "switch", arrows "move", Esc "close", "Type to filter".
- Filtering: Enter "switch", arrows "move", Esc "clear".
- No match: Backspace "edit", Esc "clear".

Arrows are ↑↓ in the list and ←→ in the strip. Keycaps are 18px tall, at least 18px wide, with 5px corners, a `key` face, a `border` edge and a 1px lip. In the hint they use ink; on rows and cards they use muted.

### States

- **Loading:** a muted spinner and "Loading workspaces", with no hint pill. When the list arrives, the selection starts on the previous workspace, as on a fresh open.
- **Empty:** "No workspaces yet" / "Create one with New workspace in the sidebar."
- **No match:** "No workspace matches “sea”" / "Names, projects, branches and pull request numbers are searched.", with the edit/clear hint.
- **Single workspace:** a muted note under the only row: "Open another workspace, then Ctrl+Tab flips between the two." On touch screens it reads "Open another workspace to switch between them here."

### Settings

The host's Settings section "Switcher" with one card holding two `SettingsSelect` rows: Layout (List / Thumbnails) and Workspaces shown, each with a one-sentence hint. A second section, "Navigation history", holds the Back and forward master switch. While it is on, the same card also shows the Arrows in the sidebar switch and the Back / forward shortcuts selector; off hides both rows. No custom styling.

### Navigation history

Two 16px Lucide-style arrows sit at the right of the sidebar's title bar, above the navigation rows. On plain web, a 36px row supplies that space. Each button has a 28px hit target, a 6px radius matching the host chrome, a neutral hover fill, a visible keyboard focus outline and a tooltip naming its action and shortcut. Disabled arrows fade to 30% opacity. A coarse pointer gets 44px targets.

The toolbar stays mounted at document level and aligns with the sidebar title bar or Settings Back header, below native window controls. A plain-web sidebar spacer and padding on the Settings Back label reserve its space. While routed sidebar elements are unavailable during workspace loading, it keeps the last valid position. Resizing realigns it; compact screens hide it when the sidebar is closed. Colors follow the host sidebar label, including custom themes. Pointer activation happens on press, while keyboard and assistive activation use click. History has no entrance animation.

### Motion

- The scrim fades in over 140ms ease-out.
- The sheet settles in over 180ms (`cubic-bezier(0.16, 1, 0.3, 1)`), from 6px below at 98.5% scale and transparent.
- The hint fades in over 220ms.
- Re-renders while the overlay is open never replay these.
- A quick tap (released within 110ms) switches without drawing anything.
- Under reduced motion none of this runs: no settle-in, no fade, no selection transition, a steady caret and a still dotted ring.

## Do's and Don'ts

### Do:

- **Do** keep recency order; status never reorders rows.
- **Do** mark selection with the neutral fill and 1px inset ring only.
- **Do** use Paseo's status words and hues: blue running ring, amber needs input, red failed, green finished, purple merged.
- **Do** use Lucide stroke icons (24-unit box, 2px stroke, drawn at 13px in meta and 16px in the query) for PR state, checks, unpushed commits and search, and keycaps for keys.
- **Do** keep the query header inside the same sheet, so typing never moves the panel.
- **Do** show only the keys that work in the current state.
- **Do** fall back to the list, drop the project tile and switch to "Tap a workspace to switch" below 600px or on a coarse pointer.
- **Do** keep the overlay to plain DOM under 200 elements, and leave the navigation path untouched: thumbnails rasterize only in idle time.
- **Do** honour reduced motion in every animation, including the sheet's settle-in.

### Don't:

- **Don't** colour the selection or use an accent anywhere in the overlay.
- **Don't** sort, group or badge rows by status.
- **Don't** nest cards inside cards; rows and thumbnail cards sit directly on the sheet.
- **Don't** use glyph or emoji icons; arrows appear only as keycap labels.
- **Don't** truncate names or branches in the list; wrap them.
- **Don't** give a project its own hue; the project tile is neutral.
- **Don't** add blur or a shadow to the hint pill; it is solid.
