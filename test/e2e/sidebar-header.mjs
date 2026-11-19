// Arrow placement on each Paseo sidebar header shape, in a real browser, with no daemon.
// Paseo's web build never draws the desktop window-chrome row, so these fixtures rebuild the
// sidebar top of each version (left-sidebar.tsx DesktopSidebar) and run the real client/web.ts:
//   0.16 desktop  drag area [chrome row 36px, nav group]
//   0.16 web      drag area [nav group]
//   0.17 desktop  drag area [chrome row 36px], sidebar-nav-scroll [nav group], separator
//   0.17 web      drag area [drag strip 8px], sidebar-nav-scroll [nav group], separator
// Usage: node test/e2e/sidebar-header.mjs [--client <dir>] [--out <dir>]
// --client points at another checkout's client/ (to render "before"); --out writes PNGs.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import ts from "typescript";

const { values } = parseArgs({
  options: {
    client: { type: "string", default: "client" },
    out: { type: "string" },
  },
});
const clientDir = resolve(values.client);
const ORIGIN = "http://fixture.test";

function moduleSource(name) {
  if (name === "rn") return 'export const Platform = { OS: "web" };';
  const source = readFileSync(join(clientDir, `${name}.ts`), "utf8");
  return ts
    .transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(/from "react-native"/g, 'from "./rn.js"')
    .replace(/from "\.\/([\w-]+)"/g, 'from "./$1.js"');
}

const rows = ["acme/app", "acme/billing-api", "example/docs", "example/site"]
  .map((name) => `<div class="ws"><div dir="auto">${name}</div></div>`)
  .join("");
const navGroup = `<div class="group">
  <div class="row" data-testid="sidebar-global-new-workspace"><span class="icon">+</span><div dir="auto">New workspace</div></div>
  <div class="row" data-testid="sidebar-sessions"><span class="icon">◷</span><div dir="auto">Sessions</div></div>
</div>`;
const chromeRow = `<div class="chrome" data-fixture="chrome">
  <span class="light" style="background:#ff5f57"></span><span class="light" style="background:#febc2e"></span><span class="light" style="background:#28c840"></span>
  <button class="collapse" data-fixture="collapse" aria-label="Collapse sidebar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></button>
</div>`;
const scroll = (inner) =>
  `<div data-testid="sidebar-nav-scroll" class="navscroll"><div>${inner}</div></div><div data-testid="sidebar-nav-separator" class="sep"></div>`;
const SHAPES = {
  "0.16-desktop": {
    chrome: true,
    html: `<div class="drag">${chromeRow}${navGroup}</div><div class="sep"></div>`,
  },
  "0.16-web": {
    chrome: false,
    html: `<div class="drag">${navGroup}</div><div class="sep"></div>`,
  },
  "0.17-desktop": {
    chrome: true,
    html: `<div class="drag">${chromeRow}</div>${scroll(navGroup)}`,
  },
  "0.17-web": {
    chrome: false,
    html: `<div class="drag"><div class="strip" data-testid="sidebar-nav-drag-strip"></div></div>${scroll(navGroup)}`,
  },
};

const page = (html) => `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --bg:#f7f7f8; --fg:#3a3a40; --muted:#6b6b73; --line:#e3e3e7; --main:#ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg:#18181b; --fg:#d4d4d8; --muted:#a1a1aa; --line:#2c2c31; --main:#0f0f11; } }
body { margin:0; font:13px/1.2 -apple-system, "Segoe UI", sans-serif; background:var(--main); color:var(--fg); }
.sidebar { position:fixed; inset:0 auto 0 0; width:280px; background:var(--bg); border-right:1px solid var(--line); display:flex; flex-direction:column; }
.drag { position:relative; }
.chrome { position:relative; height:36px; display:flex; align-items:center; gap:8px; padding:0 12px; }
.light { width:12px; height:12px; border-radius:50%; }
.collapse { margin-left:14px; appearance:none; border:0; background:none; color:var(--muted); width:28px; height:28px; display:flex; align-items:center; justify-content:center; padding:0; }
.strip { height:8px; }
.navscroll { flex-grow:0; flex-shrink:1; max-height:50%; overflow:auto; }
.group { gap:2px; padding-bottom:6px; display:flex; flex-direction:column; }
.row, .ws { height:32px; display:flex; align-items:center; gap:8px; padding:0 12px; }
.row [dir], .ws [dir] { color:var(--muted); }
.icon { width:16px; text-align:center; color:var(--muted); }
.sep { height:1px; background:var(--line); }
.section { padding:12px 12px 4px; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
</style></head><body><div class="sidebar">${html}<div class="section">Workspaces</div>${rows}</div></body></html>`;

const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const [shape, { chrome, html }] of Object.entries(SHAPES)) {
    for (const colorScheme of values.out ? ["light", "dark"] : ["light"]) {
      const context = await browser.newContext({
        viewport: { width: 640, height: 360 },
        deviceScaleFactor: 2,
        colorScheme,
      });
      const tab = await context.newPage();
      await tab.route(`${ORIGIN}/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/")
          return route.fulfill({ contentType: "text/html", body: page(html) });
        const name = path.slice(1).replace(/\.js$/, "");
        return route.fulfill({
          contentType: "text/javascript",
          body: moduleSource(name),
        });
      });
      await tab.goto(`${ORIGIN}/`);
      const rowBefore = await tab
        .getByTestId("sidebar-global-new-workspace")
        .boundingBox();
      await tab.evaluate(async () => {
        const { installHistory } = await import("/web.js");
        installHistory(() => {});
      });
      await tab.waitForTimeout(400);
      const box = (selector) => tab.locator(selector).first().boundingBox();
      const toolbar = await tab.getByTestId("pws-history").boundingBox();
      const row = await tab
        .getByTestId("sidebar-global-new-workspace")
        .boundingBox();
      const sidebar = await box(".sidebar");
      const checks = [];
      if (chrome) {
        const chromeBox = await box('[data-fixture="chrome"]');
        const collapse = await box('[data-fixture="collapse"]');
        checks.push(
          [
            "arrows sit in the window-chrome row",
            Math.abs(toolbar.y - chromeBox.y) < 1,
          ],
          [
            "no extra row: the nav rows did not move",
            Math.abs(row.y - rowBefore.y) < 1,
          ],
          [
            "no spacer in the sidebar",
            (await tab.locator(".pws-history-spacer").count()) === 0,
          ],
          [
            "arrows clear the sidebar button",
            toolbar.x >= collapse.x + collapse.width,
          ],
        );
      } else {
        const spacer = tab.locator(".pws-history-spacer");
        checks.push(
          ["one spacer row reserves the arrows", (await spacer.count()) === 1],
          [
            "the spacer stays outside the scrolling nav",
            await spacer.evaluate(
              (node) => !node.closest('[data-testid="sidebar-nav-scroll"]'),
            ),
          ],
          [
            "arrows sit above the nav rows",
            toolbar.y + toolbar.height <= row.y + 0.5,
          ],
        );
      }
      checks.push([
        "arrows are right-aligned in the sidebar",
        Math.abs(toolbar.x + toolbar.width - (sidebar.x + sidebar.width - 1)) <
          2,
      ]);
      for (const [name, ok] of checks) {
        if (colorScheme !== "light") break;
        console.log(`${ok ? "PASS" : "FAIL"} ${shape}: ${name}`);
        if (!ok) failures++;
      }
      if (values.out) {
        mkdirSync(values.out, { recursive: true });
        await tab.screenshot({
          path: join(values.out, `sidebar-${shape}-${colorScheme}.png`),
          clip: { x: 0, y: 0, width: 300, height: 220 },
        });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
assert.equal(failures, 0, `${failures} check(s) failed`);
