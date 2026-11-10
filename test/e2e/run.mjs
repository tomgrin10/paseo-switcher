#!/usr/bin/env node
// End-to-end behavior and performance tests for paseo-switcher, run against the local daemon
// through Paseo's own web UI in headless Chromium. See TESTING.md for setup and what each check means.
//
//   npm run e2e                 # all suites
//   npm run e2e -- --reload     # also reload the plugin and check it cleans up after itself
//   npm run e2e -- --headed     # watch it

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { authenticate, ORIGIN, paseoArgs } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = resolve(HERE, "../artifacts");
const ARGS = new Set(process.argv.slice(2));
const SHOW_DELAY_MS = 110;
/** Custom bindings like a user might set in Settings -> Keyboard shortcuts. */
const TAB_OVERRIDES = {
  "workspace-tab-navigate-relative-alt-shift-right": "Ctrl+Tab",
  "workspace-tab-navigate-relative-alt-shift-left": "Ctrl+Shift+Tab",
};

// ---- results ---------------------------------------------------------------------------------

const results = [];
function check(id, name, pass, detail) {
  results.push({ id, name, status: pass ? "PASS" : "FAIL", detail: detail ?? null });
  const mark = pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${mark}  ${id.padEnd(4)} ${name}${pass || detail == null ? "" : `  ${JSON.stringify(detail)}`}`);
}
function info(id, name, detail) {
  results.push({ id, name, status: "INFO", detail });
  console.log(`\x1b[36mINFO\x1b[0m  ${id.padEnd(4)} ${name}  ${JSON.stringify(detail)}`);
}
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

// ---- in-page helpers -----------------------------------------------------------------------------

const cur = (page) =>
  page.evaluate(() => {
    const m = location.pathname.match(/\/h\/([^/]+)\/workspace\/([^/?#]+)/);
    return m ? `${decodeURIComponent(m[1])}:${decodeURIComponent(m[2])}` : null;
  });
const mru = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("paseo-switcher:mru") || "[]"));
const strip = (page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll(".pws-card")];
    return {
      open: Boolean(document.querySelector(".pws-root")),
      cards: cards.map((c) => c.dataset.key),
      selected: cards.findIndex((c) => c.classList.contains("pws-selected")),
      canvases: document.querySelectorAll(".pws-root canvas").length,
    };
  });
const rows = (page) =>
  page.$$eval('[data-testid^="sidebar-workspace-row-"]', (els) =>
    els.map((e) => e.dataset.testid.replace("sidebar-workspace-row-", "")),
  );
/** The current workspace's tabs, and which one is selected. */
const workspaceTabs = (page) =>
  page.evaluate(() => {
    const key = location.pathname.match(/workspace\/([^/?#]+)/)?.[1];
    const pane = key && document.querySelector('[data-testid^="workspace-deck-entry-"][data-testid$=":' + key + '"]');
    const tabs = pane ? [...pane.querySelectorAll('[data-testid^="workspace-tab-agent_"]')] : [];
    return { count: tabs.length, selected: tabs.findIndex((t) => t.getAttribute("aria-selected") === "true") };
  });
const shownCount = (page) => page.evaluate(() => window.__pwsShown ?? 0);

async function boot(page) {
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector(".pws-host", { state: "attached", timeout: 30000 }).catch(() => {
    throw new Error("The plugin did not load. Is paseo-switcher installed, enabled, and is the daemon reachable?");
  });
  await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]', { state: "attached", timeout: 30000 });
  await page.waitForTimeout(1500);
  // Counts every time the strip is drawn, so tests can assert a quick tap never draws it.
  await page.evaluate(() => {
    window.__pwsShown = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.classList?.contains("pws-root")) window.__pwsShown++;
    }).observe(document.querySelector(".pws-host"), { childList: true });
  });
}

async function tap(page, presses = 1) {
  await page.keyboard.down("Control");
  for (let i = 0; i < presses; i++) await page.keyboard.press("Tab");
  await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
}

async function holdOpen(page, presses = 1) {
  await page.keyboard.down("Control");
  for (let i = 0; i < presses; i++) await page.keyboard.press("Tab");
  await page.waitForTimeout(SHOW_DELAY_MS + 250);
}

async function clickRow(page, key) {
  await page.locator(`[data-testid="sidebar-workspace-row-${key}"]`).click({ force: true });
}

/** Resolves once the workspace route changed and its pane painted; returns ms since `t0`. */
const WAIT_PANE = `(before, t0) => new Promise((done) => {
  const tick = () => {
    const k = location.pathname.match(/workspace\\/([^/?#]+)/)?.[1];
    const pane = k && document.querySelector('[data-testid^="workspace-deck-entry-"][data-testid$=":' + k + '"]');
    if (pane && location.pathname !== before) requestAnimationFrame(() => done(Math.round(performance.now() - t0)));
    else requestAnimationFrame(tick);
  };
  tick();
})`;

// ---- suites ----------------------------------------------------------------------------------------

async function warmUp(page, keys) {
  // Visit workspaces oldest-first so the MRU order is known, staying long enough for idle thumbnails.
  for (const key of keys) {
    await clickRow(page, key);
    await page.waitForTimeout(4500);
  }
}

async function behavior(page, visited) {
  const m0 = await mru(page);
  check("B1", "MRU lists visited workspaces newest first", JSON.stringify(m0.slice(0, visited.length)) === JSON.stringify([...visited].reverse()), m0.slice(0, 3));

  await holdOpen(page);
  let s = await strip(page);
  check("B2", "Holding Ctrl+Tab shows the 5 most recent workspaces", s.open && JSON.stringify(s.cards) === JSON.stringify(m0.slice(0, 5)), s);
  check("B3", "The previous workspace is preselected", s.selected === 1, s.selected);
  check("B4", "Thumbnails are rasterized canvases", s.canvases >= 4, s.canvases);
  // Canvases cannot be read back (the SVG taints them), so screenshot each one and decode the PNG
  // in the page. Not blank means some pixels differ from the background, the most common colour.
  // A byte-size threshold failed on nearly empty pages, whose real thumbnails compress small.
  const thumbs = [];
  for (const canvas of await page.locator(".pws-root canvas").all()) thumbs.push(await inkOf(page, await canvas.screenshot()));
  check("B4b", "Thumbnails show content, not a blank image", thumbs.length >= 4 && thumbs.every((t) => t.decoded && t.ink >= MIN_INK), thumbs);
  await page.screenshot({ path: join(ARTIFACTS, "strip-light.png") });

  for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
  s = await strip(page);
  check("B5", "Tab wraps around the strip", s.selected === 1, s.selected);
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  s = await strip(page);
  check("B6", "Shift+Tab moves back", s.selected === 0, s.selected);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  s = await strip(page);
  check("B7", "Arrow keys move the selection", s.selected === 1, s.selected);
  await page.keyboard.press("Tab");
  const third = s.cards[2];
  await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
  check("B8", "Releasing Ctrl switches to the selected workspace", (await cur(page)) === third && !(await strip(page)).open, { now: await cur(page), want: third });

  let m = await mru(page);
  let shown = await shownCount(page);
  await tap(page);
  check("B9", "A quick tap flips to the previous workspace", (await cur(page)) === m[1], { now: await cur(page), want: m[1] });
  check("B10", "A quick tap never draws the strip", (await shownCount(page)) === shown);

  const a = await cur(page);
  await tap(page);
  const b = await cur(page);
  await tap(page);
  check("B11", "Repeated taps toggle between the last two", (await cur(page)) === a && a !== b, { a, b });

  m = await mru(page);
  shown = await shownCount(page);
  await tap(page, 2);
  check("B12", "A fast double tap goes two back without drawing", (await cur(page)) === m[2] && (await shownCount(page)) === shown, { now: await cur(page), want: m[2] });

  const before = await cur(page);
  await holdOpen(page);
  await page.keyboard.press("Escape");
  const closed = !(await strip(page)).open;
  await page.keyboard.up("Control");
  await page.waitForTimeout(800);
  check("B13", "Esc cancels, and releasing Ctrl afterwards does nothing", closed && (await cur(page)) === before);

  m = await mru(page);
  await holdOpen(page);
  await page.keyboard.press("4");
  const closedByDigit = !(await strip(page)).open;
  await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
  check("B14", "A number key jumps straight to that card", closedByDigit && (await cur(page)) === m[3], { now: await cur(page), want: m[3] });

  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(SHOW_DELAY_MS + 250);
  s = await strip(page);
  check("B15", "Ctrl+Shift+Tab starts at the oldest card", s.selected === s.cards.length - 1, s);
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");

  await holdOpen(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  s = await strip(page);
  await page.keyboard.up("Control");
  check("B16", "Losing window focus cancels", !s.open);
}

async function typeToFilter(page) {
  const start = await cur(page);
  await holdOpen(page);
  const names = await page.$$eval(".pws-card", (els) => els.map((e) => e.getAttribute("aria-label")));
  const target = names[3];
  const fragment = target.toLowerCase().split(/\s+/).find((w) => w.length >= 4) ?? target.slice(0, 4).toLowerCase();
  await page.keyboard.type(fragment, { delay: 30 });
  await page.waitForTimeout(150);
  let s = await strip(page);
  const query = await page.locator(".pws-query-text").textContent().catch(() => null);
  const labels = await page.$$eval(".pws-card", (els) => els.map((e) => e.getAttribute("aria-label")));
  check("F1", "Typing while the switcher is open filters it", query === fragment && labels.includes(target), { query, labels });
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
  const stillOpen = (await strip(page)).open;
  const where = await cur(page);
  check("F2", "After typing, releasing Ctrl keeps the switcher open", stillOpen && where === start, { stillOpen, where, start });
  const top = (await strip(page)).cards[0];
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  check("F3", "Enter switches to the top match", (await cur(page)) === top && !(await strip(page)).open, { now: await cur(page), want: top });

  await page.evaluate(() => window.__paseoSwitcher.open());
  await page.waitForTimeout(400);
  await page.keyboard.type("zzqxv");
  await page.waitForTimeout(150);
  s = await strip(page);
  const empty = await page.locator(".pws-empty-title").textContent().catch(() => null);
  const here = await cur(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check("F4", "No match: an empty state, and Enter does nothing", s.cards.length === 0 && /No workspace matches/.test(empty ?? "") && (await cur(page)) === here && (await strip(page)).open, { empty });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const cleared = { strip: await strip(page), query: await page.locator(".pws-query").count() };
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("F5", "Esc clears the filter first, then closes", cleared.strip.open && cleared.query === 0 && cleared.strip.cards.length === 5 && !(await strip(page)).open, cleared);

  // Each keystroke re-filters every workspace and redraws the results.
  await page.evaluate(() => window.__paseoSwitcher.open());
  await page.waitForTimeout(400);
  const times = await page.evaluate(() => {
    const out = [];
    for (const key of "workspace") {
      const t = performance.now();
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      out.push(performance.now() - t);
    }
    return out;
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  check("F6", "Filtering a keystroke takes under 30 ms", Math.max(...times) < 30, { maxMs: +Math.max(...times).toFixed(1) });

  // Holding Ctrl and typing "k" must filter, not open Paseo's Command Center (Ctrl+K).
  const at = await cur(page);
  await holdOpen(page);
  await page.keyboard.type("kl");
  await page.waitForTimeout(400);
  const palette = await page.locator('input[placeholder^="Search commands"]').count();
  const typed = await page.locator(".pws-query-text").textContent().catch(() => null);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
  check("F7", "While open, typed keys never reach Paseo's shortcuts", palette === 0 && typed === "kl" && (await cur(page)) === at && !(await strip(page)).open, { palette, typed });
}

async function commandCenterAndMouse(page) {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(700);
  await page.keyboard.type("Switch workspace");
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const s = await strip(page);
  const hint = await page.locator(".pws-hint").textContent().catch(() => null);
  check("B17", "Command Center opens the strip in click/Enter mode", s.open && /^Enter\s*switch/.test(hint ?? ""), { s, hint });

  const card = page.locator(".pws-card").nth(3);
  await card.hover();
  await page.mouse.move(10, 10, { steps: 1 });
  await card.hover({ position: { x: 40, y: 40 } });
  const hovered = (await strip(page)).selected;
  check("B18", "Hovering a card selects it", hovered === 3, hovered);
  const want = (await strip(page)).cards[3];
  await card.click();
  await page.waitForTimeout(1500);
  check("B19", "Clicking a card switches to it", (await cur(page)) === want && !(await strip(page)).open, { now: await cur(page), want });

  await page.keyboard.press("Control+k");
  await page.waitForTimeout(700);
  await page.keyboard.type("Switch workspace");
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const selected = (await strip(page)).cards[1];
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  check("B20", "Enter switches in click/Enter mode", (await cur(page)) === selected, { now: await cur(page), want: selected });

  const sticky = await page.evaluate(() => {
    window.__paseoSwitcher.open();
    return new Promise((r) => setTimeout(() => r(Boolean(document.querySelector(".pws-root"))), 50));
  });
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  check("B21", "Clicking the backdrop closes the strip", sticky && !(await strip(page)).open);
}

async function composer(page) {
  const box = page.locator('textarea[placeholder^="Message the agent"]:visible').first();
  if (!(await box.count())) return info("B22", "Ctrl+Tab from the composer", "skipped: no composer in this workspace");
  await box.click();
  await page.evaluate(() => {
    window.__inputs = 0;
    document.addEventListener("beforeinput", () => window.__inputs++, true);
  });
  const m = await mru(page);
  await tap(page);
  const inputs = await page.evaluate(() => window.__inputs);
  check("B22", "Ctrl+Tab in the composer switches and types nothing into it", (await cur(page)) === m[1] && inputs === 0, { now: await cur(page), want: m[1], inputs });
}

async function collapsedSidebar(page) {
  const toggle = page.locator('[data-testid="menu-button"][aria-expanded="true"]:visible').first();
  if (!(await toggle.count())) return info("B23", "Collapsed sidebar", "skipped: no sidebar toggle");
  await toggle.click();
  await page.waitForTimeout(800);
  const visibleRows = await page.locator('[data-testid^="sidebar-workspace-row-"]:visible').count();
  const m = await mru(page);
  await holdOpen(page, 2);
  await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
  check("B23", "Switching works with the sidebar collapsed", visibleRows === 0 && (await cur(page)) === m[2], { visibleRows, now: await cur(page), want: m[2] });
  await page.locator('[data-testid="menu-button"][aria-expanded="false"]:visible').first().click();
  await page.waitForTimeout(600);
}

async function settings(page) {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(700);
  await page.keyboard.type("Workspace Switcher: settings");
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const picker = page.locator('[aria-label^="Workspaces shown:"]').first();
  const label = await picker.getAttribute("aria-label").catch(() => null);
  check("S1", "Settings screen shows the limit, default 5", label === "Workspaces shown: 5", label);
  await picker.click();
  await page.waitForTimeout(500);
  await page.locator('[role="menuitem"]', { hasText: /^3$/ }).first().click();
  await page.waitForTimeout(500);
  const stored = await page.evaluate(() => localStorage.getItem("paseo-switcher:limit"));
  check("S2", "Choosing 3 saves it", stored === "3", stored);

  await boot(page);
  await holdOpen(page);
  let s = await strip(page);
  check("S3", "The strip then shows 3 cards, and the limit survives a reload", s.cards.length === 3, s.cards.length);
  await page.screenshot({ path: join(ARTIFACTS, "strip-limit-3.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");

  await page.evaluate(() => localStorage.setItem("paseo-switcher:limit", "5"));
  await boot(page);
  await holdOpen(page);
  s = await strip(page);
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  check("S4", "Restoring 5 shows 5 cards", s.cards.length === 5, s.cards.length);
}

/** The list layout: full names and details instead of thumbnails, and no background snapshots. */
async function listLayout(page) {
  await page.evaluate(() => localStorage.removeItem("paseo-switcher:layout"));
  await boot(page);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(700);
  await page.keyboard.type("Workspace Switcher: settings");
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const picker = page.locator('[aria-label^="Layout:"]').first();
  const label = await picker.getAttribute("aria-label").catch(() => null);
  check("L1", "Settings screen shows the layout, default List", label === "Layout: List", label);
  const choose = async (option) => {
    await page.locator('[aria-label^="Layout:"]').first().click();
    await page.waitForTimeout(500);
    await page.locator('[role="menuitem"]', { hasText: new RegExp(`^${option}$`) }).first().click();
    await page.waitForTimeout(500);
    return page.evaluate(() => localStorage.getItem("paseo-switcher:layout"));
  };
  const thumbnails = await choose("Thumbnails");
  const list = await choose("List");
  check("L2", "Choosing Thumbnails, then List, saves each", thumbnails === '"strip"' && list === '"list"', { thumbnails, list });

  await boot(page);
  await holdOpen(page);
  const s = await strip(page);
  const rowsShown = await page.locator(".pws-row").count();
  const recent = (await mru(page)).slice(0, 5);
  check(
    "L3",
    "The list shows the 5 most recent workspaces as rows, previous one selected, no thumbnails",
    rowsShown === 5 && s.canvases === 0 && s.selected === 1 && JSON.stringify(s.cards) === JSON.stringify(recent),
    { rowsShown, canvases: s.canvases, selected: s.selected },
  );
  await page.screenshot({ path: join(ARTIFACTS, "list-light.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");

  const fits = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await holdOpen(page);
    const r = await page.evaluate(() => {
      const names = [...document.querySelectorAll(".pws-row .pws-name")];
      const panel = document.querySelector(".pws-panel");
      const box = panel.getBoundingClientRect();
      return {
        names: names.length,
        clipped: names.filter((n) => n.scrollWidth > n.clientWidth + 1 || getComputedStyle(n).textOverflow === "ellipsis").length,
        inside: box.left >= 0 && box.right <= innerWidth,
        sideScroll: panel.scrollWidth > panel.clientWidth,
      };
    });
    await page.screenshot({ path: join(ARTIFACTS, `list-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.keyboard.up("Control");
    return r;
  };
  const wide = await fits(900, 700);
  const narrow = await fits(440, 720);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  check(
    "L4",
    "Full workspace names: none cut off at 900px or 440px, and the list stays inside the window",
    [wide, narrow].every((r) => r.names > 0 && r.clipped === 0 && r.inside && !r.sideScroll),
    { wide, narrow },
  );

  const before = await mru(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(SHOW_DELAY_MS + 250);
  await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
  check("L5", "Holding Ctrl, two Tabs and release switches to the third most recent", (await cur(page)) === before[2], {
    expected: before[2],
    got: await cur(page),
  });

  const opens = [];
  for (let i = 0; i < 6; i++) {
    opens.push(
      await page.evaluate(async () => {
        const t0 = performance.now();
        window.__paseoSwitcher.open();
        await new Promise((r) => setTimeout(r, 0));
        const render = performance.now() - t0;
        const nodes = document.querySelector(".pws-root").querySelectorAll("*").length;
        const moves = [];
        for (let k = 0; k < 10; k++) {
          const t = performance.now();
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
          moves.push(performance.now() - t);
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        return { render, nodes, move: Math.max(...moves) };
      }),
    );
    await page.waitForTimeout(300);
  }
  const render = median(opens.map((o) => o.render));
  const move = Math.max(...opens.map((o) => o.move));
  check("L6", "List: opening under 30 ms, under 200 elements, moving under 5 ms", render < 30 && opens[0].nodes < 200 && move < 5, {
    renderMs: +render.toFixed(1),
    nodes: opens[0].nodes,
    worstMoveMs: +move.toFixed(2),
  });

  // In the strip layout, a switch is followed by a snapshot within a few seconds.
  const snapshots = () => page.evaluate(() => performance.getEntriesByName("pws:snapshot").length);
  const n0 = await snapshots();
  await clickRow(page, (await mru(page))[3]);
  await page.waitForTimeout(8000);
  const n1 = await snapshots();
  check("L7", "List: no thumbnail work in the background", n1 === n0, { snapshotsDuring8s: n1 - n0 });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(800);
  await holdOpen(page);
  await page.screenshot({ path: join(ARTIFACTS, "list-dark.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  await page.emulateMedia({ colorScheme: "light" });
  info("L8", "List screenshots for review", ["list-light.png", "list-dark.png", "list-900.png", "list-440.png"].map((f) => `test/artifacts/${f}`));

  await page.evaluate(() => localStorage.setItem("paseo-switcher:layout", '"strip"'));
  await boot(page);
}

async function visuals(page) {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(800);
  await holdOpen(page, 2);
  await page.screenshot({ path: join(ARTIFACTS, "strip-dark.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(600);
  await holdOpen(page);
  const panel = await page.locator(".pws-panel").boundingBox();
  await page.screenshot({ path: join(ARTIFACTS, "strip-narrow.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  check("V1", "At 900px the strip stays inside the window", panel && panel.x >= 0 && panel.x + panel.width <= 900, panel);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  info("V2", "Screenshots for review", ["strip-light.png", "strip-dark.png", "strip-narrow.png", "strip-limit-3.png"].map((f) => `test/artifacts/${f}`));
}

async function perf(page, context) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

  // P1: what a quick tap costs the plugin, and the time until the next workspace is on screen.
  const taps = [];
  for (let i = 0; i < 6; i++) {
    taps.push(
      await page.evaluate(async (waitSrc) => {
        const waitPane = eval(waitSrc);
        const before = location.pathname;
        const t0 = performance.now();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true, cancelable: true }));
        const handler = performance.now() - t0;
        return { handler, toWorkspace: await waitPane(before, t0) };
      }, WAIT_PANE),
    );
    await page.waitForTimeout(1200);
  }
  const tapHandler = median(taps.map((t) => t.handler));
  check("P1", "Quick tap: plugin work under 5 ms (includes the click it sends)", tapHandler < 5, { medianMs: +tapHandler.toFixed(2) });
  info("P2", "Quick tap: until the next workspace is painted (Paseo's render)", { medianMs: median(taps.map((t) => t.toWorkspace)), samples: taps.map((t) => t.toWorkspace) });

  // P3: drawing the strip.
  const opens = [];
  for (let i = 0; i < 6; i++) {
    const m0 = await metrics();
    const r = await page.evaluate(async () => {
      const t0 = performance.now();
      window.__paseoSwitcher.open();
      await new Promise((r) => setTimeout(r, 0));
      const render = performance.now() - t0;
      const nodes = document.querySelector(".pws-root").querySelectorAll("*").length;
      const moves = [];
      for (let k = 0; k < 10; k++) {
        const t = performance.now();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
        moves.push(performance.now() - t);
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return { render, nodes, move: Math.max(...moves) };
    });
    const m1 = await metrics();
    opens.push({ ...r, style: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000 });
    await page.waitForTimeout(300);
  }
  check("P3", "Opening: building the strip under 30 ms", median(opens.map((o) => o.render)) < 30, { medianMs: +median(opens.map((o) => o.render)).toFixed(1) });
  check("P4", "Opening: fewer than 120 elements (no live DOM copies)", Math.max(...opens.map((o) => o.nodes)) < 120, { nodes: opens[0].nodes });
  check("P5", "Opening: style recalculation under 80 ms (was ~500 ms)", median(opens.map((o) => o.style)) < 80, { medianMs: Math.round(median(opens.map((o) => o.style))) });
  check("P6", "Moving the selection under 5 ms (worst of 60)", Math.max(...opens.map((o) => o.move)) < 5, { maxMs: +Math.max(...opens.map((o) => o.move)).toFixed(2) });

  // P7: holding Ctrl: the strip appears right after the tap guard.
  const holds = [];
  for (let i = 0; i < 4; i++) {
    holds.push(
      await page.evaluate(
        () =>
          new Promise((done) => {
            const t0 = performance.now();
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true }));
            const tick = () =>
              document.querySelector(".pws-root")
                ? requestAnimationFrame(() => {
                    const ms = performance.now() - t0;
                    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                    done(ms);
                  })
                : setTimeout(tick, 2);
            tick();
          }),
      ),
    );
    await page.waitForTimeout(300);
  }
  check("P7", `Holding: strip on screen within ${SHOW_DELAY_MS} ms tap guard + 60 ms`, median(holds) < SHOW_DELAY_MS + 60, { medianMs: Math.round(median(holds)) });

  // P8: releasing: the strip leaves the screen before Paseo renders the next workspace.
  const releases = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      window.__rel = {};
      const host = document.querySelector(".pws-host");
      const mo = new MutationObserver((records) => {
        for (const r of records)
          for (const n of r.removedNodes)
            if (n.classList?.contains("pws-root")) {
              mo.disconnect();
              requestAnimationFrame(() => (window.__rel.gone = performance.now()));
            }
      });
      mo.observe(host, { childList: true });
    });
    await holdOpen(page);
    const t0 = await page.evaluate(() => performance.now());
    await page.keyboard.up("Control");
    await page.waitForTimeout(1500);
    releases.push(await page.evaluate((t0) => window.__rel.gone - t0, t0));
  }
  check("P8", "Releasing: strip gone from the screen within 60 ms", median(releases) < 60, { medianMs: Math.round(median(releases)), samples: releases.map(Math.round) });

  // P9: background work never blocks: every plugin task stays short while an agent streams.
  await page.evaluate(() => performance.clearMeasures());
  await page.evaluate(() => {
    // Paseo keeps recently visited workspaces mounted but hidden; stream into the current one.
    window.__stream = setInterval(() => {
      const k = location.pathname.match(/workspace\/([^/?#]+)/)?.[1];
      const pane = k && document.querySelector('[data-testid^="workspace-deck-entry-"][data-testid$=":' + k + '"]');
      const n = document.createElement("span");
      pane?.appendChild(n);
      n.remove();
    }, 150);
  });
  await page.waitForTimeout(15000);
  const work = await page.evaluate(() => {
    clearInterval(window.__stream);
    return performance.getEntriesByType("measure").filter((m) => m.name.startsWith("pws:")).map((m) => ({ name: m.name, ms: m.duration }));
  });
  // "serialize" contains its "xml" and "css" parts; count each task once.
  const tasks = work.filter((w) => ["pws:snapshot", "pws:serialize", "pws:draw"].includes(w.name));
  const longest = tasks.length ? Math.max(...tasks.map((w) => w.ms)) : 0;
  const total = tasks.reduce((sum, w) => sum + w.ms, 0);
  check("P9", "Streaming for 15 s: thumbnails keep refreshing (at least 4 snapshots)", tasks.filter((w) => w.name === "pws:snapshot").length >= 4, { snapshots: tasks.filter((w) => w.name === "pws:snapshot").length });
  check("P10", "Streaming for 15 s: no plugin task over 50 ms", longest < 50, { longestMs: Math.round(longest) });
  check("P11", "Streaming for 15 s: plugin work under 3% of the time", total < 450, { totalMs: Math.round(total) });

  // P12: normal Paseo switching (real sidebar clicks) is not slower with the plugin installed.
  const keys = (await mru(page)).slice(0, 2);
  const clicks = async () => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const target = (await cur(page)) === keys[0] ? keys[1] : keys[0];
      const before = await page.evaluate(() => location.pathname);
      await page.evaluate(() => document.addEventListener("pointerdown", () => (window.__pd = performance.now()), { once: true, capture: true }));
      await page.locator(`[data-testid="sidebar-workspace-row-${target}"]`).click({ force: true, noWaitAfter: true });
      out.push(await page.evaluate(async ([waitSrc, before]) => eval(waitSrc)(before, window.__pd), [WAIT_PANE, before]));
      await page.waitForTimeout(1800);
    }
    return out;
  };
  const withPlugin = await clicks();
  await page.evaluate(() => window.__paseoSwitcher.dispose());
  const without = await clicks();
  const on = median(withPlugin);
  const off = median(without);
  check("P12", "Normal sidebar switching is not slower with the plugin (median within 20% + 40 ms)", on <= off * 1.2 + 40, { withPluginMs: on, withoutMs: off });
}

/** Paseo shortcuts on Ctrl+Tab or Ctrl+Shift+Tab, such as a user's Next tab / Previous tab, must not fire. */
async function paseoShortcuts(page) {
  await page.evaluate((o) => localStorage.setItem("@paseo:keyboard-shortcut-overrides", o), JSON.stringify(TAB_OVERRIDES));
  await boot(page);
  const tabbed = await (async () => {
    for (const key of (await rows(page)).slice(0, 10)) {
      await clickRow(page, key);
      await page.waitForTimeout(1200);
      if ((await workspaceTabs(page)).count >= 2) return key;
    }
    return null;
  })();
  if (!tabbed) {
    info("K1", "Skipped: no workspace in the first 10 has two tabs", null);
  } else {
    const before = await workspaceTabs(page);
    await holdOpen(page);
    const afterTab = { strip: await strip(page), tabs: await workspaceTabs(page) };
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    await page.waitForTimeout(150);
    const afterShiftTab = { strip: await strip(page), tabs: await workspaceTabs(page) };
    await page.keyboard.press("Escape");
    await page.keyboard.up("Control");
    check("K1", "Ctrl+Tab and Ctrl+Shift+Tab move the switcher even with Paseo shortcuts on them", afterTab.strip.selected === 1 && afterShiftTab.strip.selected === 0, { afterTab: afterTab.strip.selected, afterShiftTab: afterShiftTab.strip.selected });
    check("K2", "Paseo's Next tab / Previous tab bound to them do not fire", afterTab.tabs.selected === before.selected && afterShiftTab.tabs.selected === before.selected, { before: before.selected, afterTab: afterTab.tabs.selected, afterShiftTab: afterShiftTab.tabs.selected });
  }
  const read = () =>
    page.evaluate(() => {
      const ev = (init) => new KeyboardEvent("keydown", { key: "Tab", code: "Tab", ...init });
      const k = (e) => `${e.key}/${e.code}`;
      return { ctrlTab: k(ev({ ctrlKey: true })), ctrlShiftTab: k(ev({ ctrlKey: true, shiftKey: true })), shiftTab: k(ev({ shiftKey: true })), cmdCtrlTab: k(ev({ ctrlKey: true, metaKey: true })), ctrlA: k(new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true })) };
    });
  const installed = await read();
  check("K3", "Only Ctrl+Tab and Ctrl+Shift+Tab are hidden from other listeners", installed.ctrlTab === "Unidentified/" && installed.ctrlShiftTab === "Unidentified/" && installed.shiftTab === "Tab/Tab" && installed.cmdCtrlTab === "Tab/Tab" && installed.ctrlA === "a/KeyA", installed);
  await page.evaluate(() => window.__paseoSwitcher.dispose());
  const disposed = await read();
  check("K4", "Disposing the plugin gives the keys back", disposed.ctrlTab === "Tab/Tab" && disposed.ctrlShiftTab === "Tab/Tab", disposed);
  await page.evaluate(() => localStorage.removeItem("@paseo:keyboard-shortcut-overrides"));
}

async function reloadCleanup(page) {
  await boot(page);
  execFileSync("paseo", paseoArgs("plugin", "reload", "paseo-switcher"), { stdio: "ignore" });
  await page.waitForTimeout(6000);
  const counts = await page.evaluate(() => ({
    hosts: document.querySelectorAll(".pws-host").length,
    styles: document.querySelectorAll("style[data-paseo-switcher]").length,
  }));
  await holdOpen(page);
  const roots = await page.evaluate(() => document.querySelectorAll(".pws-root").length);
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  check("R1", "After a plugin reload there is exactly one switcher", counts.hosts === 1 && counts.styles === 1 && roots === 1, { ...counts, roots });
  const key = await page.evaluate(() => new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true }).key);
  check("R2", "After a reload the switcher still claims Ctrl+Tab", key === "Unidentified", key);
}

// ---- thumbnail pixels ------------------------------------------------------------------------------

/** Share of pixels a thumbnail needs off its background colour: a few words of text on a 240px card. */
const MIN_INK = 0.002;

/** Decodes a PNG in the page: its size, and the share of pixels that differ from the most common colour. */
function inkOf(page, png) {
  return page.evaluate(async (base64) => {
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let bg = 0, best = -1;
      for (const [key, n] of counts) if (n > best) [bg, best] = [key, n];
      const [r, g, b] = [bg >> 16, (bg >> 8) & 255, bg & 255];
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.max(Math.abs(data[i] - r), Math.abs(data[i + 1] - g), Math.abs(data[i + 2] - b)) > 24) ink++;
      }
      const pixels = data.length / 4;
      return { decoded: pixels > 0, width: bitmap.width, height: bitmap.height, ink: pixels ? Number((ink / pixels).toFixed(4)) : 0 };
    } catch (e) {
      return { decoded: false, error: String(e) };
    }
  }, png.toString("base64"));
}

// ---- main ------------------------------------------------------------------------------------------

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await chromium.launch({ headless: !ARGS.has("--headed") });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await authenticate(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  try {
    await boot(page);
    // Start from a clean history and the default limit.
    await page.evaluate(() => {
      localStorage.removeItem("paseo-switcher:mru");
      localStorage.removeItem("paseo-switcher:limit");
      // Most suites cover the thumbnail strip; the list suite checks the default itself.
      localStorage.setItem("paseo-switcher:layout", '"strip"');
    });
    await boot(page);
    const all = await rows(page);
    if (all.length < 7) throw new Error(`Need at least 7 workspaces in the sidebar, found ${all.length}`);
    const visited = all.slice(0, 7).reverse();
    console.log(`Warming up: visiting ${visited.length} workspaces...`);
    await warmUp(page, visited);

    await behavior(page, visited);
    await typeToFilter(page);
    await commandCenterAndMouse(page);
    await composer(page);
    await collapsedSidebar(page);
    await settings(page);
    await listLayout(page);
    await visuals(page);
    await perf(page, context);
    await paseoShortcuts(page);
    if (ARGS.has("--reload")) await reloadCleanup(page);
    const ours = pageErrors.filter((e) => /pws|switcher/i.test(e));
    check("E1", "No page errors from the plugin", ours.length === 0, ours);
  } finally {
    await browser.close();
  }
  writeFileSync(join(ARTIFACTS, "results.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\n${results.filter((r) => r.status === "PASS").length} passed, ${failed.length} failed. Results: test/artifacts/results.json`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
