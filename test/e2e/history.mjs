// Real Paseo UI navigation; no agent prompts or changes to workspace files.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { authenticate, ORIGIN, paseoArgs } from "./browser.mjs";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await authenticate(context);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const pause = () => page.waitForTimeout(450);
const current = () =>
  page.evaluate(() => {
    const m = location.pathname.match(/^\/h\/([^/]+)\/workspace\/([^/?#]+)/);
    const scope =
      m &&
      document.querySelector(
        `[data-testid="workspace-deck-entry-${decodeURIComponent(m[1])}:${decodeURIComponent(m[2])}"]`,
      );
    return {
      path: location.pathname,
      tab:
        scope?.querySelector('[data-testid^="workspace-tab-"][aria-selected="true"]')?.dataset
          .testid ?? null,
    };
  });
const back = async () => {
  await page.getByTestId("pws-history-back").click();
  await pause();
};
const forward = async () => {
  await page.getByTestId("pws-history-forward").click();
  await pause();
};
const same = async (expected, label) => {
  assert.deepEqual(await current(), expected, label);
  console.log(`PASS ${label}`);
};
async function command(text) {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(250);
  await page.keyboard.type(text);
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await pause();
}
async function mouseSide(button) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button,
    x: 800,
    y: 100,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button,
    x: 800,
    y: 100,
    clickCount: 1,
  });
  await pause();
}
async function browserKey(key, windowsVirtualKeyCode) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: key,
    windowsVirtualKeyCode,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: key,
    windowsVirtualKeyCode,
  });
  await pause();
}

try {
  mkdirSync("test/artifacts", { recursive: true });
  await page.goto(ORIGIN);
  await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]');
  await page.waitForSelector('[data-testid="pws-history"]');
  await pause();
  assert.equal(await page.getByTestId("pws-history-back").isDisabled(), true);
  console.log("PASS history starts empty");
  const rows = await page
    .locator('[data-testid^="sidebar-workspace-row-"]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.testid));
  assert.ok(rows.length > 1);
  let tabs, a;
  for (const row of rows.slice(0, 6)) {
    await page.getByTestId(row).click();
    await pause();
    a = await current();
    const match = a.path.match(/\/h\/([^/]+)\/workspace\/([^/]+)/);
    const scope = page.getByTestId(
      `workspace-deck-entry-${decodeURIComponent(match[1])}:${decodeURIComponent(match[2])}`,
    );
    tabs = await scope
      .locator('[data-testid^="workspace-tab-"][aria-selected]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.testid));
    if (tabs.length >= 2) break;
  }
  if (tabs.length < 2) {
    // Supply a read-only second tab instead of depending on the user's current session layout.
    await page.getByTestId("workspace-new-tab-button").filter({ visible: true }).first().click();
    await page.getByRole("menuitem").filter({ hasText: /^Diff/ }).first().click();
    await pause();
    tabs = await page
      .locator('[data-testid^="workspace-tab-"][aria-selected]:visible')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.testid));
  }
  assert.ok(tabs.length >= 2, "Need an agent tab and a second workspace tab");
  const second = tabs.find((id) => id !== a.tab);
  const firstTab = page.getByTestId(second).filter({ visible: true }).first();
  await firstTab.click();
  await pause();
  const b = await current();
  await page.getByTestId("pws-history-back").hover();
  await page.mouse.down();
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll(`[data-testid="${CSS.escape(id)}"]`)].some(
        (node) => node.checkVisibility() && node.getAttribute("aria-selected") === "true",
      ),
    a.tab,
  );
  console.log("PASS arrows navigate on press before mouse release");
  await page.mouse.up();
  await pause();
  await same(a, "Back restores the previous session tab");
  await forward();
  await same(b, "Forward restores the next session tab");

  await command("Workspace Switcher: settings");
  assert.ok((await current()).path.includes("/plugins/paseo-switcher/"));
  assert.equal(
    await page.getByTestId("pws-history").evaluate((node) => node.parentElement === document.body),
    true,
  );
  const settingsBack = page.getByTestId("settings-back-to-workspace");
  const headerBefore = await settingsBack.boundingBox();
  // Model the extra native title-bar clearance on macOS. Arrows must follow the Settings header.
  await settingsBack.evaluate((node) => {
    node.parentElement.style.transform = "translateY(40px)";
  });
  await pause();
  const headerAfter = await settingsBack.boundingBox();
  const toolbarAfter = await page.getByTestId("pws-history").boundingBox();
  assert.ok(headerAfter.y >= headerBefore.y + 39.9);
  assert.ok(toolbarAfter.y >= headerAfter.y && toolbarAfter.y < headerAfter.y + headerAfter.height);
  await settingsBack.evaluate((node) => {
    node.parentElement.style.transform = "";
  });
  await pause();
  await page.screenshot({ path: "test/artifacts/history-settings-fixed.png" });
  console.log("PASS Settings arrows follow the header below native window controls");
  const settings = await current();
  await back();
  await same(b, "Back from plugin settings restores the exact session");
  await forward();
  await same(settings, "Forward returns to plugin settings");
  await back();

  const beforeLoading = await page.getByTestId("pws-history").boundingBox();
  await page.getByTestId("sidebar-global-new-workspace").evaluate((node) => {
    const anchor = node.parentElement;
    window.__pwsLoadingAnchor = { anchor, display: anchor.style.display };
    anchor.style.display = "none";
  });
  await page.waitForTimeout(600);
  assert.equal(await page.getByTestId("pws-history").isVisible(), true);
  assert.deepEqual(await page.getByTestId("pws-history").boundingBox(), beforeLoading);
  await page.evaluate(() => {
    const { anchor, display } = window.__pwsLoadingAnchor;
    anchor.style.display = display;
    delete window.__pwsLoadingAnchor;
  });
  await pause();
  console.log("PASS toolbar stays visible and stationary while its sidebar anchor is unavailable");

  await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="pws-history"]');
    window.__pwsToolbarRemovals = 0;
    window.__pwsToolbarContinuity = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.removedNodes)
          if (node === toolbar || node.contains?.(toolbar)) window.__pwsToolbarRemovals++;
    });
    window.__pwsToolbarContinuity.observe(document.body, { childList: true, subtree: true });
  });
  const other = rows.find((id) => !id.endsWith(a.path.split("/").at(-1)));
  await page.getByTestId(other).click();
  await pause();
  const c = await current();
  assert.equal(await page.getByTestId("pws-history-forward").isDisabled(), true);
  console.log("PASS a new visit clears forward history");
  await back();
  await same(b, "Back across workspaces restores the selected tab");
  assert.equal(await page.evaluate(() => window.__pwsToolbarRemovals), 0);
  await page.evaluate(() => window.__pwsToolbarContinuity.disconnect());
  console.log("PASS workspace navigation never removes or reparents the toolbar");
  await page.keyboard.press("Alt+ArrowRight");
  await pause();
  await same(c, "Alt+Right navigates forward");
  await page.keyboard.press("Alt+ArrowLeft");
  await pause();
  await same(b, "Alt+Left navigates back");
  await mouseSide("forward");
  await same(c, "Mouse forward uses application history");
  await mouseSide("back");
  await same(b, "Mouse back uses application history");
  await browserKey("BrowserForward", 167);
  await same(c, "Mouse drivers emitting BrowserForward use application history");
  await browserKey("BrowserBack", 166);
  await same(b, "Mouse drivers emitting BrowserBack use application history");

  // A rapid burst should move through the trail without recording intermediate replay states.
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowRight");
  await pause();
  await same(b, "Rapid Back/Forward keeps the cursor stable");
  await command("Go forward");
  await same(c, "Command Center Go forward uses the same history");

  // Closing a tab changes only this test browser's layout, and never archives the agent.
  if (b.tab.startsWith("workspace-tab-agent_")) {
    const workspaceRow = rows.find((id) => id.endsWith(a.path.split("/").at(-1)));
    await page.getByTestId(workspaceRow).click();
    await pause();
    await page.getByTestId(b.tab).filter({ visible: true }).first().click();
    await pause();
    await page.getByTestId(b.tab).filter({ visible: true }).first().hover();
    const id = b.tab.slice("workspace-tab-agent_".length);
    await page.getByTestId(`workspace-agent-close-${id}`).filter({ visible: true }).first().click();
    await pause();
    assert.notEqual((await current()).tab, b.tab);
    await back();
    await same(c, "Back skips a closed session tab");
    assert.equal(await page.getByTestId(b.tab).count(), 0);
    console.log("PASS history does not reopen a closed session");
  }

  await command("Workspace Switcher: settings");
  const shortcuts = page.locator('[aria-label^="Back / forward shortcuts:"]').first();
  await shortcuts.click();
  await page.getByRole("menuitem", { name: "Cmd+[ / Cmd+]", exact: true }).click();
  await pause();
  await page.keyboard.press("Meta+[");
  await pause();
  await same(c, "Configurable Cmd+[ navigates back without the host's workspace shortcut");
  await page.keyboard.press("Meta+]");
  await pause();
  assert.ok((await current()).path.includes("/plugins/paseo-switcher/"));
  console.log("PASS configurable Cmd+] navigates forward");
  await shortcuts.click();
  await page.getByRole("menuitem", { name: "Alt+Left / Alt+Right", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Arrows in the sidebar", exact: true });
  await toggle.click();
  await pause();
  assert.equal(await page.getByTestId("pws-history").count(), 0);
  await toggle.click();
  await pause();
  assert.equal(await page.getByTestId("pws-history").count(), 1);
  console.log("PASS toolbar visibility setting works");
  await back();
  await same(c, "History still works after changing settings");

  // Screenshots and layout checks, together in both themes and a narrow viewport.
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await pause();
    await page.screenshot({ path: `test/artifacts/history-${theme}.png` });
  }
  const toolbar = await page.getByTestId("pws-history").boundingBox();
  const newRow = await page.getByTestId("sidebar-global-new-workspace").boundingBox();
  assert.ok(toolbar.y < newRow.y, "Arrows sit above the sidebar rows");
  console.log("PASS toolbar placement above sidebar navigation");
  await page.setViewportSize({ width: 440, height: 844 });
  await pause();
  await page.screenshot({ path: "test/artifacts/history-440.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log("PASS compact viewport has no horizontal overflow");
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.reload();
  await page.waitForSelector('[data-testid="pws-history"]');
  await pause();
  assert.equal(await page.getByTestId("pws-history-back").isDisabled(), true);
  assert.equal(await page.getByTestId("pws-history-forward").isDisabled(), true);
  console.log("PASS reload resets chronological history");

  // The master switch turns the whole feature off, and the choice survives a reload.
  const commandText = async (text) => {
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(250);
    await page.keyboard.type(text);
    await page.waitForTimeout(400);
    // Settings hints mention the commands too; read only the Command Center's results.
    const found = await page
      .getByTestId("command-center-panel")
      .evaluate((panel, t) => panel.innerText.includes(t), text);
    await page.keyboard.press("Escape");
    await pause();
    return found;
  };
  assert.equal(await commandText("Go forward"), true);
  await command("Workspace Switcher: settings");
  const master = page.getByRole("switch", { name: "Back and forward", exact: true });
  await master.click();
  await pause();
  assert.equal(await page.getByTestId("pws-history").count(), 0);
  assert.equal(
    await page.getByRole("switch", { name: "Arrows in the sidebar", exact: true }).count(),
    0,
  );
  assert.equal(await page.locator('[aria-label^="Back / forward shortcuts:"]').count(), 0);
  await page.screenshot({ path: "test/artifacts/history-disabled-settings.png" });
  const offPath = (await current()).path;
  const seen = await page.evaluate(() => {
    window.__pwsSeen = [];
    const record = (e) =>
      window.__pwsSeen.push(`${e.type}:${e.key ?? e.button}:${e.defaultPrevented}`);
    window.addEventListener("keydown", record);
    window.__pwsRecord = record;
    return true;
  });
  assert.ok(seen);
  await page.keyboard.press("Alt+ArrowLeft");
  await browserKey("BrowserBack", 166);
  await pause();
  assert.equal((await current()).path, offPath, "no history navigation while off");
  const events = await page.evaluate(() => {
    window.removeEventListener("keydown", window.__pwsRecord);
    return window.__pwsSeen;
  });
  assert.ok(events.includes("keydown:ArrowLeft:false"), `Alt+Left reaches Paseo: ${events}`);
  assert.ok(events.includes("keydown:BrowserBack:false"), `BrowserBack reaches Paseo: ${events}`);
  assert.equal(await commandText("Go forward"), false);
  console.log("PASS turning back and forward off removes arrows, commands and key handling");
  await page.reload();
  // The switcher's host element proves the plugin loaded before checking the arrows are absent.
  await page.waitForSelector(".pws-host", { state: "attached" });
  await page.waitForTimeout(1200);
  assert.equal(await page.getByTestId("pws-history").count(), 0);
  console.log("PASS the off setting survives a reload");
  // The reload kept us on this plugin's settings page.
  assert.ok((await current()).path.includes("/plugins/paseo-switcher/"));
  await page.getByRole("switch", { name: "Back and forward", exact: true }).click();
  await pause();
  assert.equal(await page.getByTestId("pws-history").count(), 1);
  assert.equal(await page.getByTestId("pws-history-back").isDisabled(), true);
  // Straight after a reload on Settings, Paseo lists no plugin commands; check from a workspace.
  await page.getByTestId("settings-back-to-workspace").click();
  await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]');
  await pause();
  assert.equal(await commandText("Go forward"), true);
  console.log("PASS turning it back on restores arrows and commands with a fresh trail");

  if (process.argv.includes("--reload")) {
    execFileSync("paseo", paseoArgs("plugin", "reload", "paseo-switcher"), { stdio: "pipe" });
    await page.waitForTimeout(2000);
    assert.equal(await page.locator('[data-testid="pws-history"]').count(), 1);
    assert.equal(await page.locator("style[data-pws-history]").count(), 1);
    assert.equal(await page.locator(".pws-host").count(), 1);
    console.log("PASS plugin reload leaves one toolbar and one switcher");
  }
  assert.deepEqual(errors, []);
  console.log("PASS no browser errors");
} catch (error) {
  await page.screenshot({ path: "test/artifacts/history-failure.png" });
  console.log("FAILURE STATE", await current());
  throw error;
} finally {
  await browser.close();
}
