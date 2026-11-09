# Workspace Switcher

<!-- impeccable:product-schema 1 -->

> Written during the November 2026 UI polish pass without a live interview. Facts come from the
> README, AGENTS.md, TESTING.md, the code and the owner's written brief; lines marked _(inferred)_
> are assumptions to confirm.

## Platform

web

## Users

Developers who keep many Paseo workspaces open at once, one per branch or task, with agents running
in several of them, and who move between them by keyboard all day. _(inferred)_ They switch dozens
of times an hour and notice any delay.

## Product Purpose

Get to the workspace you want without looking for it: Ctrl+Tab goes back to the last one, holding
Ctrl steps through the recent ones, and typing finds any of them. Each row says enough (name,
branch, pull request, checks, agent status) to pick the right one at a glance. Success is a switch
that feels instant and never lands in the wrong place.

## Positioning

Arc's Ctrl+Tab for Paseo: most-recent order, a quick tap that flips back without drawing, and a
held key that browses. Unlike Paseo's sidebar, it ranks by your own visits and shows status for the
few workspaces you are juggling. _(inferred)_

## Operating Context

- Entry points: Ctrl+Tab / Ctrl+Shift+Tab anywhere in the desktop app or web UI, and **Switch
  workspace (Ctrl+Tab)** in the Command Center for browser tabs and phone browsers.
- An overlay drawn with plain DOM above the app, outside React, because it must open in a few
  milliseconds; it reads Paseo's page structure (route, sidebar rows, workspace panes), pinned to
  Paseo 0.15.
- Light and dark follow the workspace surface it opens over.

## Capabilities and Constraints

- Speed is the product: navigation observation only schedules work, and never snapshots thumbnails; budgets are enforced by the end-to-end
  suite (quick tap < 5 ms, opening < 30 ms, moving < 5 ms, typing a filter < 30 ms, strip gone
  < 60 ms after release, sidebar switching no slower with the plugin).
- Thumbnails are rasterized only in idle time and kept in memory; the default list layout does no
  background work.
- Settings and recent-workspace order live in the browser's localStorage per device. Chronological
  back/forward history stays in window memory and resets on document reload.
- Does nothing on iOS and Android.

## Brand Commitments

Part of Tom Gringauz's Paseo plugin family (Follow-up, Defer, Smart Session, Transcript Search,
Transfer, Vitals): native to Paseo, plain short copy, the shared slate icon tile. This plugin draws
its own overlay, so it mirrors Paseo's status language (blue running ring, amber needs input, red
failed, green finished) rather than host theme tokens.

## Evidence on Hand

An isolated harness daemon with nine sample workspaces and demo agents; injected sample pull
request data; the end-to-end suite's timings. Registry installs: 2 at the time of this pass.

## Product Principles

1. Never slower than not having it.
2. Recency first: the order never reshuffles by status, so muscle memory holds.
3. Say what Paseo says: the same status words and colours as the sidebar.
4. Keys are the interface; the mouse and touch work but are never required.
