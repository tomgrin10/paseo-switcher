import { Platform } from "react-native";
import {
  historyRoute,
  parseShortcut,
  sameVisit,
  VisitHistory,
  type HistoryShortcut,
  type Visit,
} from "./history";

// Paseo 0.15 DOM contracts, alongside switcher.ts's workspace-row/deck contracts:
// - sidebar-global-new-workspace and sidebar-sessions/search share the nav group
// - workspace-tab-<deterministic ID>, aria-selected; workspace-pane-<pane ID>
// - settings-sidebar and settings-back-to-workspace: the Settings header below window controls
// All DOM access stays in this web-only adapter; native installs are a no-op.
const g = globalThis as any;
type Element = any;
const WORKSPACE = /^\/h\/([^/]+)\/workspace\/([^/?#]+)/;
const TAB = '[data-testid^="workspace-tab-"][aria-selected]';
const SHORTCUT_KEY = "paseo-switcher:history-shortcut";
const BUTTONS_KEY = "paseo-switcher:history-buttons";
const ENABLED_KEY = "paseo-switcher:history-enabled";

export interface HistoryControls {
  back(): void;
  forward(): void;
  matchesKey(event: any, key: string): boolean;
  handleKey(event: any, key: string): boolean;
  getShortcut(): HistoryShortcut;
  setShortcut(value: HistoryShortcut): void;
  getButtons(): boolean;
  setButtons(value: boolean): void;
  /** Off removes the arrows, stops tracking and leaves every key and mouse button to Paseo. */
  getEnabled(): boolean;
  setEnabled(value: boolean): void;
  onEnabledChange(listener: (enabled: boolean) => void): () => void;
  dispose(): void;
}

export function installHistory(navigateWorkspace: (key: string) => void): HistoryControls {
  const noop: HistoryControls = {
    back() {},
    forward() {},
    matchesKey: () => false,
    handleKey: () => false,
    getShortcut: () => "none",
    setShortcut() {},
    getButtons: () => false,
    setButtons() {},
    getEnabled: () => false,
    setEnabled() {},
    onEnabledChange: () => () => {},
    dispose() {},
  };
  if (Platform.OS !== "web" || !g.window || !g.document) return noop;
  const win = g.window,
    doc = g.document;
  const mac = /Mac|iPhone|iPad/.test(win.navigator?.platform ?? "");
  const coarsePointer = Boolean(win.matchMedia?.("(pointer:coarse)").matches);
  const toolbarWidth = coarsePointer ? 110 : 78;
  // Expo can remount client contributions when restoring an app-wide route. Keep the trail on
  // the window, just like the switcher singleton; a document reload still starts a fresh session.
  const history: VisitHistory = (g.__pwsVisitHistory ??= new VisitHistory());
  const focusedPanes = new Map<string, string>();
  let shortcut = parseShortcut(read(SHORTCUT_KEY), mac);
  let showButtons = read(BUTTONS_KEY) !== false;
  let enabled = read(ENABLED_KEY) !== false;
  const enabledListeners = new Set<(enabled: boolean) => void>();
  let disposed = false,
    captureTimer: any = null,
    restoreTimer: any = null;
  let observedDeck: Element = null;
  let settingsAnchor: Element = null;
  let settingsBackButton: Element = null;
  let pending: { visit: Visit; direction: -1 | 1; started: number } | null = null;
  const invalid = new Set<Visit>();

  function read(key: string): unknown {
    try {
      return JSON.parse(win.localStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  }
  function save(key: string, value: unknown) {
    try {
      win.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Session settings still work. */
    }
  }
  function byId(id: string, root: Element = doc): Element {
    return root.querySelector(`[data-testid="${g.CSS.escape(id)}"]`);
  }
  function deck(key: string): Element {
    return byId(`workspace-deck-entry-${key}`);
  }
  function currentWorkspace(): string | null {
    const match = WORKSPACE.exec(win.location.pathname);
    if (!match) return null;
    try {
      return `${decodeURIComponent(match[1])}:${decodeURIComponent(match[2])}`;
    } catch {
      return null;
    }
  }
  function selectedTab(scope: Element, paneId: string | null): Element {
    const pane = paneId && byId(paneId, scope);
    return (pane || scope)?.querySelector(`${TAB}[aria-selected="true"]`);
  }
  function snapshot(): Visit | null {
    const route = historyRoute(win.location.pathname, win.location.search, win.location.hash);
    if (!route) return null;
    const workspaceKey = currentWorkspace();
    const scope = workspaceKey && deck(workspaceKey);
    const activePane = doc.activeElement?.closest?.('[data-testid^="workspace-pane-"]');
    const pane = scope?.contains(activePane)
      ? activePane.dataset.testid
      : workspaceKey && focusedPanes.get(workspaceKey);
    const tab = scope && selectedTab(scope, pane || null);
    return {
      route,
      workspaceKey,
      tabId: tab?.dataset.testid ?? null,
      paneId: tab?.closest('[data-testid^="workspace-pane-"]')?.dataset.testid ?? null,
    };
  }

  // Only selection attributes are observed: streamed chat mutations do not schedule history work.
  const selectionObserver = new g.MutationObserver(schedule);
  function observeDeck() {
    const key = currentWorkspace(),
      next = key && deck(key);
    if (next === observedDeck) return;
    selectionObserver.disconnect();
    observedDeck = next;
    if (next)
      selectionObserver.observe(next, {
        attributes: true,
        subtree: true,
        attributeFilter: ["aria-selected"],
      });
  }
  function capture() {
    captureTimer = null;
    if (disposed || !enabled) return;
    observeDeck();
    // Chrome must update even while a workspace/tab is still loading.
    mount();
    if (pending) {
      clearTimeout(restoreTimer);
      restore();
      return;
    }
    const visit = snapshot();
    if (visit) history.record(visit);
    updateButtons();
  }
  function schedule() {
    if (!disposed && enabled && captureTimer === null) captureTimer = setTimeout(capture, 0);
  }

  // App navigation often replaces browser entries. Observe it without changing its semantics.
  const originals = { pushState: win.history.pushState, replaceState: win.history.replaceState };
  const wrappers = {} as Record<keyof typeof originals, any>;
  for (const method of ["pushState", "replaceState"] as const) {
    wrappers[method] = function (this: any, ...args: any[]) {
      const result = originals[method].apply(this, args);
      schedule();
      return result;
    };
    win.history[method] = wrappers[method];
  }

  function available(visit: Visit): boolean {
    if (invalid.has(visit)) return false;
    if (!visit.workspaceKey || !visit.tabId) return true;
    const scope = deck(visit.workspaceKey);
    // Unmounted workspaces are checked after navigation; retained decks expose closed tabs now.
    return !scope || !!byId(visit.tabId, scope);
  }
  function stop(event: any) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function move(direction: -1 | 1) {
    if (!enabled) return;
    // Read the destination without mounting chrome or forcing layout on the input path.
    if (!pending) {
      const visit = snapshot();
      if (visit) history.record(visit);
    }
    const next = history.find(direction, available);
    if (next < 0) return;
    const visit = history.entries[next];
    history.cursor = next;
    pending = { visit, direction, started: Date.now() };
    clearTimeout(restoreTimer);
    if (visit.workspaceKey) {
      if (currentWorkspace() !== visit.workspaceKey) navigateWorkspace(visit.workspaceKey);
    } else if (snapshot()?.route !== visit.route) {
      win.history.pushState(win.history.state, "", visit.route);
      win.dispatchEvent(new g.PopStateEvent("popstate", { state: win.history.state }));
    }
    updateButtons();
    // Retained workspace tabs already exist. Focus them now instead of waiting for a timer.
    restore();
  }
  function restore() {
    restoreTimer = null;
    if (!pending || disposed) return;
    const { visit } = pending;
    const here = snapshot();
    if (here?.route === visit.route) {
      if (!visit.tabId) {
        pending = null;
        capture();
        return;
      }
      const scope = visit.workspaceKey && deck(visit.workspaceKey);
      const tab = scope && byId(visit.tabId, (visit.paneId && byId(visit.paneId, scope)) || scope);
      if (tab) {
        if (visit.workspaceKey && visit.paneId) focusedPanes.set(visit.workspaceKey, visit.paneId);
        if (!sameVisit(here, visit)) {
          tab.click();
        } else {
          pending = null;
          capture();
          return;
        }
      }
    }
    if (Date.now() - pending.started > 3000) {
      // A closed tab or removed workspace must not trap the history cursor or reopen anything.
      const direction = pending.direction;
      invalid.add(visit);
      pending = null;
      const next = history.find(direction, available);
      if (next >= 0) {
        pending = { visit, direction, started: 0 };
        move(direction);
      } else {
        capture();
      }
      return;
    }
    restoreTimer = setTimeout(restore, 40);
  }

  function keyDirection(event: any, key: string): -1 | 1 | null {
    if (!enabled || event.isComposing) return null;
    // Some mouse drivers emit these keys instead of DOM mouse buttons. They are independent
    // of the user's selected keyboard shortcut pair (including "None").
    if (key === "BrowserBack" || key === "GoBack") return -1;
    if (key === "BrowserForward" || key === "GoForward") return 1;
    if (
      shortcut === "alt-arrows" &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    )
      return key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : null;
    if (
      shortcut === "ctrl-minus" &&
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (key === "-" || key === "_")
    )
      return event.shiftKey ? 1 : -1;
    if (
      shortcut === "cmd-brackets" &&
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    )
      return key === "[" ? -1 : key === "]" ? 1 : null;
    return null;
  }
  function pointer(event: any) {
    if (event.button === 3 || event.button === 4) {
      // Cancelling pointer down would suppress the compatible mouse down event we handle.
      return;
    }
    const key = currentWorkspace();
    const pane = event.target?.closest?.('[data-testid^="workspace-pane-"]');
    if (key && pane && deck(key)?.contains(pane)) focusedPanes.set(key, pane.dataset.testid);
    schedule();
  }
  function sideMouse(event: any) {
    if (!enabled || (event.button !== 3 && event.button !== 4)) return;
    stop(event);
    // Mouse down fires for every button press, even while another button is held. Pointer down
    // only fires when the pointer changes from no buttons to at least one button pressed.
    if (event.type === "mousedown") move(event.button === 3 ? -1 : 1);
  }
  function clicked() {
    schedule();
  }

  const style = doc.createElement("style");
  style.setAttribute("data-pws-history", "");
  style.textContent = CSS;
  doc.head.appendChild(style);
  const toolbar = doc.createElement("div");
  toolbar.className = "pws-history";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Navigation history");
  toolbar.setAttribute("data-testid", "pws-history");
  // Paseo owns and replaces the routed sidebar. Keep the actual controls outside that tree.
  // Only a non-interactive spacer lives inside the plain-web sidebar to reserve its header row.
  const spacer = doc.createElement("div");
  spacer.className = "pws-history-spacer";
  spacer.setAttribute("aria-hidden", "true");
  let positionAnchor: Element = null;
  let positioned = false;
  const resizeObserver = g.ResizeObserver ? new g.ResizeObserver(schedule) : null;
  function position(anchor: Element) {
    if (!anchor?.isConnected) return;
    if (positionAnchor !== anchor) {
      resizeObserver?.disconnect();
      resizeObserver?.observe(anchor);
      positionAnchor = anchor;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const styles: Record<string, string> = {
      left: `${Math.max(rect.left, rect.right - toolbarWidth)}px`,
      top: `${rect.top}px`,
      height: `${Math.max(rect.height, coarsePointer ? 48 : 28)}px`,
      visibility: "visible",
    };
    for (const [name, value] of Object.entries(styles))
      if (toolbar.style[name] !== value) toolbar.style[name] = value;
    positioned = true;
  }
  const buttons = ([-1, 1] as const).map((direction) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", direction === -1 ? "Go back" : "Go forward");
    button.setAttribute(
      "data-testid",
      direction === -1 ? "pws-history-back" : "pws-history-forward",
    );
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction === -1 ? "m12 19-7-7 7-7m-7 7h14" : "m12 5 7 7-7 7m7-7H5"}"/></svg>`;
    button.addEventListener("pointerdown", (event: any) => {
      if (event.button !== 0) return;
      stop(event);
      move(direction);
    });
    button.addEventListener("click", (event: any) => {
      stop(event);
      // Keyboard and assistive activation dispatch click without pointer down (detail === 0).
      if (event.detail === 0) move(direction);
    });
    toolbar.appendChild(button);
    return button;
  });
  function updateButtons() {
    const hint =
      shortcut === "alt-arrows"
        ? ["Alt+Left", "Alt+Right"]
        : shortcut === "ctrl-minus"
          ? ["Ctrl+-", "Ctrl+Shift+-"]
          : shortcut === "cmd-brackets"
            ? ["Cmd+[", "Cmd+]"]
            : ["", ""];
    buttons.forEach((button, i) => {
      button.disabled = history.find(i === 0 ? -1 : 1, available) < 0;
      button.title = `${i === 0 ? "Go back" : "Go forward"}${hint[i] ? ` (${hint[i]})` : ""}`;
    });
  }
  function mount() {
    if (!enabled || !showButtons) {
      toolbar.remove();
      spacer.remove();
      clearSettingsAnchor();
      return;
    }
    if (!toolbar.isConnected) doc.body.appendChild(toolbar);
    const settingsSidebar = byId("settings-sidebar");
    const back =
      settingsSidebar?.checkVisibility() && byId("settings-back-to-workspace", settingsSidebar);
    if (back) {
      const anchor = back.parentElement;
      if (settingsAnchor !== anchor) {
        clearSettingsAnchor();
        settingsAnchor = anchor;
        settingsBackButton = back;
        anchor.classList.add("pws-history-settings-anchor");
        back.classList.add("pws-history-settings-back");
      }
      toolbar.className = "pws-history pws-history-settings";
      spacer.remove();
      position(anchor);
      const label = back.querySelector('[dir="auto"]');
      if (label) toolbar.style.color = win.getComputedStyle(label).color;
      return;
    }
    clearSettingsAnchor();
    const candidate = byId("sidebar-global-new-workspace");
    const row = candidate?.checkVisibility() ? candidate : null;
    let group = row?.parentElement;
    while (
      group &&
      !group.querySelector('[data-testid="sidebar-sessions"], [data-testid="sidebar-search"]')
    )
      group = group.parentElement;
    // All other built-in rows may be hidden in Settings > Sidebar.
    group ||= row?.parentElement?.parentElement?.parentElement;
    const dragArea = group?.parentElement;
    if (dragArea) {
      const previous = group.previousElementSibling;
      const chrome =
        previous && previous !== spacer && previous.getBoundingClientRect().height >= 28
          ? previous
          : null;
      toolbar.className = chrome ? "pws-history pws-history-chrome" : "pws-history";
      if (chrome) spacer.remove();
      else if (spacer.parentElement !== dragArea) dragArea.insertBefore(spacer, group);
      position(chrome || spacer);
      // Match the host's sidebar label in both themes, including custom themes.
      const label = row.querySelector('[dir="auto"]');
      if (label) toolbar.style.color = win.getComputedStyle(label).color;
    } else {
      // Missing anchors are normal during routed workspace loading. Keep the last good position
      // instead of removing/reparenting the buttons or jumping under the native traffic lights.
      if (win.innerWidth < 720) toolbar.style.visibility = "hidden";
      else if (positioned) toolbar.style.visibility = "visible";
      else {
        toolbar.className = "pws-history pws-history-floating";
        toolbar.style.visibility = "visible";
      }
    }
  }
  function clearSettingsAnchor() {
    settingsAnchor?.classList.remove("pws-history-settings-anchor");
    settingsBackButton?.classList.remove("pws-history-settings-back");
    settingsAnchor = null;
    settingsBackButton = null;
  }

  win.addEventListener("popstate", schedule);
  win.addEventListener("resize", schedule);
  doc.addEventListener("pointerdown", pointer, true);
  doc.addEventListener("click", clicked, true);
  doc.addEventListener("focusin", clicked, true);
  for (const name of ["mousedown", "mouseup", "auxclick"])
    win.addEventListener(name, sideMouse, true);
  // Handles rails/sidebar mounting after a route and host theme/layout changes; no chat observer.
  let timer: any = null;
  function start() {
    timer ??= setInterval(capture, 300);
    capture();
  }
  function stopTracking() {
    clearInterval(timer);
    timer = null;
    clearTimeout(captureTimer);
    captureTimer = null;
    clearTimeout(restoreTimer);
    restoreTimer = null;
    selectionObserver.disconnect();
    observedDeck = null;
    resizeObserver?.disconnect();
    positionAnchor = null;
    positioned = false;
    pending = null;
    // Turning history back on starts a fresh trail rather than replaying stale places.
    history.entries.length = 0;
    history.cursor = -1;
    invalid.clear();
    focusedPanes.clear();
    mount();
  }
  if (enabled) start();
  return {
    back: () => move(-1),
    forward: () => move(1),
    matchesKey: (event, key) => keyDirection(event, key) !== null,
    handleKey(event, key) {
      const direction = keyDirection(event, key);
      if (direction === null) return false;
      stop(event);
      move(direction);
      return true;
    },
    getShortcut: () => shortcut,
    setShortcut(value) {
      shortcut = parseShortcut(value, mac);
      save(SHORTCUT_KEY, shortcut);
      updateButtons();
    },
    getButtons: () => showButtons,
    setButtons(value) {
      showButtons = value;
      save(BUTTONS_KEY, value);
      mount();
    },
    getEnabled: () => enabled,
    setEnabled(value) {
      if (value === enabled) return;
      enabled = value;
      save(ENABLED_KEY, value);
      if (value) start();
      else stopTracking();
      for (const listener of enabledListeners) listener(value);
    },
    onEnabledChange(listener) {
      enabledListeners.add(listener);
      return () => enabledListeners.delete(listener);
    },
    dispose() {
      disposed = true;
      enabledListeners.clear();
      clearInterval(timer);
      clearTimeout(captureTimer);
      clearTimeout(restoreTimer);
      selectionObserver.disconnect();
      resizeObserver?.disconnect();
      toolbar.remove();
      spacer.remove();
      clearSettingsAnchor();
      style.remove();
      win.removeEventListener("popstate", schedule);
      win.removeEventListener("resize", schedule);
      doc.removeEventListener("pointerdown", pointer, true);
      doc.removeEventListener("click", clicked, true);
      doc.removeEventListener("focusin", clicked, true);
      for (const name of ["mousedown", "mouseup", "auxclick"])
        win.removeEventListener(name, sideMouse, true);
      for (const method of ["pushState", "replaceState"] as const)
        if (win.history[method] === wrappers[method]) win.history[method] = originals[method];
    },
  };
}

const CSS = `
.pws-history { position:fixed; z-index:100; box-sizing:border-box; width:78px; display:flex; align-items:center; justify-content:flex-end; gap:2px; height:36px; padding:0 10px; flex-shrink:0; -webkit-app-region:no-drag; }
.pws-history-spacer { height:36px; flex-shrink:0; pointer-events:none; }
.pws-history-settings-anchor { position:relative; }
.pws-history-settings-back { padding-right:78px !important; }
.pws-history-floating { left:140px; top:4px; color:CanvasText; }
.pws-history button { appearance:none; border:0; background:transparent; color:inherit; width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center; padding:0; cursor:pointer; -webkit-app-region:no-drag; }
.pws-history button:hover:enabled { background:color-mix(in srgb, currentColor 10%, transparent); }
.pws-history button:active:enabled { background:color-mix(in srgb, currentColor 16%, transparent); }
.pws-history button:disabled { opacity:.3; cursor:default; }
.pws-history button:focus-visible { outline:2px solid currentColor; outline-offset:1px; }
@media(max-width:719px) { .pws-history-floating { display:none; } }
@media(pointer:coarse) { .pws-history { width:110px; } .pws-history button { width:44px; height:44px; } .pws-history-spacer { height:48px; } .pws-history-settings-back { padding-right:110px !important; } }
`;
