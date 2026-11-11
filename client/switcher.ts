import type { PluginClientContext } from "@getpaseo/plugin/client";
import { installHistory, type HistoryControls } from "./web";
import {
  ago,
  buildCards,
  clampLimit,
  DEFAULT_LAYOUT,
  filterCards,
  matchRanges,
  MAX_LIMIT,
  STATUS_LABEL,
  DEFAULT_LIMIT,
  initialIndex,
  parseLayout,
  previousKey,
  splitKey,
  touch,
  workspaceKey,
  wrap,
  applyWorkspaceUpdate,
  keepOrder,
  workspaceMap,
  type Card,
  type Layout,
  type WorkspaceDescriptor,
  type WorkspaceInfo,
  type WorkspaceUpdate,
} from "./model";

/* Desktop/web adapter for Paseo 0.15. Host DOM is not a public plugin API, so every selector and
 * route this plugin depends on lives in this block. Native clients never run this file.
 * - route: /h/<serverId>/workspace/<workspaceId>
 * - row:   the sidebar workspace row; clicking it is how a person switches
 * - pane:  the workspace deck entry; snapshotted for thumbnails
 * Outside a workspace (the home screen) with no history yet, the host is found by matching a loaded
 * workspace to its sidebar row, or, with the sidebar hidden, from the app's saved host list when it
 * has a single host (localStorage `@paseo:daemon-registry`).
 */
const ROUTE = /^\/h\/([^/]+)\/workspace\/([^/?#]+)/;
const ROW_PREFIX = "sidebar-workspace-row-";
const rowSelector = (key: string) => `[data-testid="${ROW_PREFIX}${key}"]`;
const paneSelector = (key: string) => `[data-testid="workspace-deck-entry-${key}"]`;

const MRU_KEY = "paseo-switcher:mru";
const LIMIT_KEY = "paseo-switcher:limit";
const LAYOUT_KEY = "paseo-switcher:layout";
const HOSTS_KEY = "@paseo:daemon-registry";
/** A tap shorter than this switches without ever drawing the strip. */
const SHOW_DELAY_MS = 110;
const POLL_ROUTE_MS = 300;
/** How often a changed workspace view is re-snapshotted while you stay in it. */
const REFRESH_MS = 2000;
/**
 * Background work waits this long after any workspace change so it never competes with Paseo
 * rendering the workspace you just opened. It also lets that workspace finish loading.
 */
const QUIET_AFTER_SWITCH_MS = 2000;
const WORKSPACES_STALE_MS = 5000;
const MAX_THUMBS = 12;

const CARD_MAX = 240;
const CARD_MIN = 176;
const ASPECT = 0.66;
/** Estimated list row height, so the list knows it overflows without measuring. */
const ROW_H = 64;
/** Thumbnails zoom past the pane's side margins toward the conversation column. */
const ZOOM = 1.35;
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const LIVE_TAGS = new Set(["IFRAME", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED", "WEBVIEW"]);

type Paseo = PluginClientContext["paseo"];
type Mode = "hold" | "sticky";
/* The plugin typechecks without the DOM library; this adapter works with loosely typed nodes. */
type Node = any;
const g = globalThis as any;

/** A cheap, detached copy of a workspace view, rasterized later when the browser is idle. */
interface Snapshot {
  key: string;
  clone: Node;
  width: number;
  height: number;
  surface: string;
}

export interface Switcher {
  history: HistoryControls;
  open(): void;
  getLimit(): number;
  setLimit(limit: number): void;
  getLayout(): Layout;
  setLayout(layout: Layout): void;
  dispose(): void;
}

export function installSwitcher(paseo: Paseo): Switcher {
  const doc = g.document;
  const win = g.window;
  if (!doc || !win) return {
    history: installHistory(() => {}),
    open() {},
    getLimit: () => DEFAULT_LIMIT,
    setLimit() {},
    getLayout: () => DEFAULT_LAYOUT,
    setLayout() {},
    dispose() {},
  };

  // Each connected host installs the plugin; only one switcher may own the keyboard.
  g.__paseoSwitcher?.dispose();
  // While the switcher is open it owns the keyboard, so typing to filter never fires a Paseo shortcut.
  let history: HistoryControls | undefined;
  const keys = claimKeys(() => open, (event, key) => history?.matchesKey(event, key) ?? false);

  let mru: string[] = readJson(MRU_KEY, []).filter((v: unknown) => typeof v === "string");
  let limit = clampLimit(readJson(LIMIT_KEY, DEFAULT_LIMIT));
  /** The list layout has no thumbnails, so it skips all background snapshot work. */
  let layout = parseLayout(readJson(LAYOUT_KEY, DEFAULT_LAYOUT));
  let workspaces: Map<string, WorkspaceInfo> | null = null;
  let workspacesAt = 0;
  /** Rasterized thumbnails by workspace key, oldest first. Each canvas records its theme. */
  const thumbs = new Map<string, Node>();

  // Switcher state. `open` is true from the first Ctrl+Tab; `root` exists only once drawn.
  let open = false;
  let mode: Mode = "hold";
  let cards: Card[] = [];
  let index = 0;
  let showTimer: any = null;
  let root: Node = null;
  let lastKey: string | null = null;
  let overflowing = false;
  let dark = false;
  /** Typed while the switcher is open; filters every workspace, not only recent ones. */
  let query = "";
  /** Every match for the query; only the first MAX_LIMIT are listed. */
  let matches = 0;
  /** The host of the loaded workspace list, for when neither the route nor the history names one. */
  let homeServer: string | null = null;
  const coarse = Boolean(win.matchMedia?.("(hover: none) and (pointer: coarse)").matches);

  const style = doc.createElement("style");
  style.setAttribute("data-paseo-switcher", "");
  style.textContent = CSS;
  doc.head.appendChild(style);
  // A permanent, empty host keeps opening from changing the page's top-level children, which
  // would make the browser restyle the whole app.
  const host = doc.createElement("div");
  host.setAttribute("data-paseo-switcher", "");
  host.className = "pws-host";
  doc.body.appendChild(host);
  history = installHistory(navigate);

  // ---- storage --------------------------------------------------------------------------------

  function readJson(key: string, fallback: any): any {
    try {
      const raw = win.localStorage?.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key: string, value: unknown) {
    try {
      win.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable; the switcher still works for this session.
    }
  }

  // ---- route and most-recently-used order ------------------------------------------------------

  function currentKey(): string | null {
    const match = ROUTE.exec(win.location.pathname);
    return match ? workspaceKey(decodeURIComponent(match[1]), decodeURIComponent(match[2])) : null;
  }

  function serverId(): string | null {
    const key = currentKey() ?? mru[0];
    return key ? splitKey(key).serverId : homeServer;
  }

  function syncRoute() {
    const key = currentKey();
    if (!key || key === lastKey) return;
    lastKey = key;
    const next = touch(mru, key);
    if (next !== mru) {
      mru = next;
      writeJson(MRU_KEY, mru);
    }
    watchPane();
  }

  // ---- workspace data -------------------------------------------------------------------------

  // A live subscription keeps statuses current while the switcher is closed, so opening it never
  // waits on or shows a stale list. If the host refuses it, opening falls back to a fresh list.
  const LIST = { page: { limit: 200 }, sort: [{ key: "activity_at" as const, direction: "desc" as const }] };
  let live = false;
  let disposed = false;
  let releaseFeed: (() => void) | null = null;

  /** `full` is a whole list (first load, reconnect); a pushed update changes one workspace. */
  function setWorkspaces(next: Map<string, WorkspaceInfo>, full: boolean) {
    workspaces = next;
    workspacesAt = Date.now();
    if (full && !homeServer) homeServer = findHost(next);
    rerender();
  }

  function watchWorkspaces() {
    paseo.workspaces
      .list({ ...LIST, subscribe: {} })
      .then(({ entries, subscription }) => {
        if (disposed) return void subscription.release();
        setWorkspaces(workspaceMap(entries as WorkspaceDescriptor[]), true);
        live = true;
        const stop = subscription.subscribe({
          // Also after a reconnect: the whole list again.
          snapshot: (snap) => setWorkspaces(workspaceMap(snap.entries as WorkspaceDescriptor[]), true),
          update: (message) => {
            if (message.type !== "workspace_update" || !workspaces) return;
            setWorkspaces(applyWorkspaceUpdate(workspaces, message.payload as WorkspaceUpdate), false);
          },
          error: () => {
            live = false;
          },
        });
        releaseFeed = () => {
          stop();
          void subscription.release().catch(() => {});
        };
      })
      .catch(() => {
        live = false;
        void loadWorkspaces();
      });
  }

  let loading: Promise<void> | null = null;
  function loadWorkspaces(): Promise<void> {
    loading ??= paseo.workspaces
      .list(LIST)
      .then((result) => setWorkspaces(workspaceMap(result.entries as WorkspaceDescriptor[]), true))
      .catch(() => {
        // Keep the previous list; cards fall back to sidebar labels.
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  function findHost(list: Map<string, WorkspaceInfo>): string | null {
    for (const id of list.keys()) {
      const row = doc.querySelector(`[data-testid^="${ROW_PREFIX}"][data-testid$=":${id}"]`);
      if (row) return splitKey(row.getAttribute("data-testid").slice(ROW_PREFIX.length)).serverId;
    }
    const saved = readJson(HOSTS_KEY, null);
    const hosts = Array.isArray(saved) ? saved : saved?.hosts;
    return Array.isArray(hosts) && hosts.length === 1 && typeof hosts[0]?.serverId === "string" ? hosts[0].serverId : null;
  }

  // ---- thumbnails -------------------------------------------------------------------------------
  //
  // Live DOM copies made the strip slow: the browser restyled every copied element on each open.
  // Instead, a snapshot is a detached clone (about 1 ms), and rasterizing it into a small canvas
  // happens in idle time. Opening the strip then only places a few canvases.

  let watched: Node = null;
  let dirty = true;
  let quietUntil = 0;
  const observer = new g.MutationObserver(() => {
    dirty = true;
  });

  function currentPane(): Node {
    const key = currentKey();
    return key ? doc.querySelector(paneSelector(key)) : null;
  }

  function watchPane() {
    const pane = currentPane();
    if (pane === watched) return;
    observer.disconnect();
    watched = pane;
    dirty = true;
    if (pane) observer.observe(pane, { childList: true, subtree: true, characterData: true });
    quietUntil = Date.now() + QUIET_AFTER_SWITCH_MS;
  }

  /** Runs `work` only when the browser is idle and nothing is switching. */
  function whenIdle(work: () => void) {
    const run = (deadline?: any) => {
      // Each step is a few milliseconds, so a busy page (streaming agent, spinners) that never has a
      // long idle period still gets its turn once the idle timeout passes.
      const tooBusy = deadline && !deadline.didTimeout && deadline.timeRemaining() < 4;
      if (open || Date.now() < quietUntil || tooBusy) {
        setTimeout(() => whenIdle(work), Math.max(100, quietUntil - Date.now()));
        return;
      }
      work();
    };
    if (g.requestIdleCallback) g.requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 50);
  }

  function onScroll(e: any) {
    if (watched && e.target?.nodeType === 1 && watched.contains(e.target)) dirty = true;
  }

  function snapshotIfDirty() {
    if (!dirty || open || doc.hidden || Date.now() < quietUntil) return;
    const key = currentKey();
    const pane = currentPane();
    if (!key || !pane) return;
    if (pane !== watched) watchPane();
    const started = now();
    const snap = snapshot(key, pane);
    measure("snapshot", started);
    if (!snap) return;
    dirty = false;
    queueRaster(snap);
  }

  function snapshot(key: string, pane: Node): Snapshot | null {
    const width = pane.offsetWidth;
    const height = pane.offsetHeight;
    if (width < 200 || height < 150) return null;
    const box = pane.getBoundingClientRect();
    // Only the thumbnail's crop of the pane is ever drawn; everything outside it is emptied.
    const crop = cropOf(width, height);
    const left = box.left + crop.x;
    const top = box.top + crop.y;
    const right = left + crop.width;
    const bottom = top + crop.height;
    const clone = pane.cloneNode(true);
    const emptied: Array<[Node, number, number]> = [];

    const walk = (from: Node, to: Node) => {
      for (let i = 0; i < from.children.length; i++) {
        const a = from.children[i];
        const b = to.children[i];
        if (!b) continue;
        const r = a.getBoundingClientRect();
        // Zero-size boxes (display: contents wrappers, absolute anchors) can still paint children
        // anywhere, so only real boxes that lie fully outside the crop are emptied.
        const sized = r.width > 0 && r.height > 0;
        if (sized && (r.bottom < top || r.top > bottom || r.right < left || r.left > right)) {
          // Off the thumbnail: keep the box so later siblings stay in place, drop its contents.
          emptied.push([b, r.width, r.height]);
          continue;
        }
        if (LIVE_TAGS.has(a.tagName)) {
          // Live surfaces do not clone and cannot render inside an image.
          const stand = doc.createElement("div");
          stand.setAttribute("class", b.getAttribute("class") ?? "");
          stand.setAttribute("style", b.getAttribute("style") ?? "");
          b.replaceWith(stand);
          continue;
        }
        if (a.tagName === "IMG" && !String(a.getAttribute("src") ?? "").startsWith("data:")) {
          // An image inside an SVG image cannot load URLs; keep its box, drop its pixels.
          b.setAttribute("src", BLANK_IMAGE);
          b.removeAttribute("srcset");
        }
        if (a.scrollTop || a.scrollLeft) {
          // Clones lose scroll offsets; bake them in as transforms on the scrolled content.
          b.style.overflow = "hidden";
          for (let c = 0; c < a.children.length; c++) {
            const base = win.getComputedStyle(a.children[c]).transform;
            b.children[c].style.transform =
              `translate(${-a.scrollLeft}px, ${-a.scrollTop}px)` + (base && base !== "none" ? ` ${base}` : "");
          }
        }
        walk(a, b);
      }
    };
    walk(pane, clone);
    for (const [el, w, h] of emptied) {
      el.replaceChildren();
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.boxSizing = "border-box";
      el.style.visibility = "hidden";
    }
    return { key, clone, width, height, surface: surfaceOf(pane) };
  }

  function cropOf(width: number, height: number) {
    const w = width / ZOOM;
    const h = Math.min(height, w * ASPECT);
    // Anchored top-left: the tab row names the agent, a short conversation starts at the top, and
    // the conversation column sits left of centre when a side panel is open.
    return { x: 0, y: 0, width: w, height: h };
  }

  const pending = new Map<string, Snapshot>();
  let rastering = false;

  function queueRaster(snap: Snapshot) {
    pending.delete(snap.key);
    pending.set(snap.key, snap);
    if (!rastering) scheduleRaster();
  }

  function scheduleRaster() {
    rastering = true;
    whenIdle(() => void rasterNext());
  }

  async function rasterNext() {
    const next = pending.entries().next().value as [string, Snapshot] | undefined;
    if (!next) {
      rastering = false;
      return;
    }
    pending.delete(next[0]);
    try {
      const canvas = await rasterize(next[1]);
      if (canvas) {
        thumbs.delete(next[0]);
        thumbs.set(next[0], canvas);
        while (thumbs.size > MAX_THUMBS) thumbs.delete(thumbs.keys().next().value as string);
        if (root) swapThumb(next[0], canvas);
      }
    } catch {
      // A failed raster keeps the previous thumbnail.
    }
    if (pending.size) scheduleRaster();
    else rastering = false;
  }

  /**
   * Document CSS rules with the class names their selectors mention. Reading a selector is cheap;
   * serializing a whole rule is not, so rule text is produced only for rules a snapshot uses.
   */
  let cssCache: { signature: string; rules: Array<{ rule: Node; classes: string[] | null }> } = { signature: "", rules: [] };
  const ruleText = new WeakMap<object, string>();
  function documentRules() {
    let count = 0;
    const sheets = doc.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      try {
        count += sheets[i].cssRules.length;
      } catch {
        // Cross-origin sheets are not readable and are skipped.
      }
    }
    const signature = `${sheets.length}:${count}`;
    if (signature !== cssCache.signature) {
      const rules: Array<{ rule: Node; classes: string[] | null }> = [];
      for (let i = 0; i < sheets.length; i++) {
        if (sheets[i].ownerNode?.hasAttribute?.("data-paseo-switcher")) continue;
        try {
          const list = sheets[i].cssRules;
          for (let r = 0; r < list.length; r++) {
            const rule = list[r];
            const selector: string | undefined = rule.selectorText;
            // Non-style rules (@media, @keyframes, @font-face) are few and always kept.
            rules.push({ rule, classes: selector == null ? null : classNames(selector) });
          }
        } catch {
          // Skipped as above.
        }
      }
      cssCache = { signature, rules };
    }
    return cssCache.rules;
  }

  function classNames(selector: string): string[] {
    const out: string[] = [];
    for (let i = selector.indexOf("."); i !== -1; i = selector.indexOf(".", i + 1)) {
      let j = i + 1;
      while (j < selector.length && /[\w-]/.test(selector[j])) j++;
      if (j > i + 1) out.push(selector.slice(i + 1, j));
    }
    return out;
  }

  /** Only the rules a snapshot can use: those without classes, or naming a class it contains. */
  function cssFor(clone: Node): string {
    const used = new Set<string>();
    for (const el of [clone, ...clone.querySelectorAll("[class]")]) {
      const list = el.classList;
      if (list) for (let i = 0; i < list.length; i++) used.add(list[i]);
    }
    const parts: string[] = [];
    for (const { rule, classes } of documentRules()) {
      if (classes && classes.length && !classes.some((c) => used.has(c))) continue;
      let text = ruleText.get(rule);
      if (text === undefined) {
        text = String(rule.cssText);
        ruleText.set(rule, text);
      }
      parts.push(text);
    }
    return parts.join("\n").replaceAll("]]>", "]]&gt;");
  }

  async function rasterize(snap: Snapshot): Promise<Node> {
    const { width: w, height: h } = snap;
    const started = now();
    const ratio = Math.min(2, win.devicePixelRatio || 1);
    const outW = Math.round(CARD_MAX * ratio);
    const outH = Math.round(CARD_MAX * ASPECT * ratio);
    const crop = cropOf(w, h);
    const html = new g.XMLSerializer().serializeToString(snap.clone);
    measure("xml", started);
    const cssStarted = now();
    const css = cssFor(snap.clone);
    measure("css", cssStarted);
    // The SVG renders straight at thumbnail size, cropped by its viewBox.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}">` +
      `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;display:flex;background:${snap.surface};font-family:system-ui,-apple-system,sans-serif">` +
      `<style><![CDATA[${css}]]></style>${html}</div></foreignObject></svg>`;
    const url = g.URL.createObjectURL(new g.Blob([svg], { type: "image/svg+xml" }));
    measure("serialize", started);
    try {
      const img = new g.Image();
      img.src = url;
      await img.decode();
      await new Promise<void>((resolve) => whenIdle(resolve));
      const drawStarted = now();
      const canvas = doc.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      canvas.className = "pws-canvas";
      canvas.dataset.dark = String(isDark(snap.surface));
      canvas.getContext("2d").drawImage(img, 0, 0, outW, outH);
      measure("draw", drawStarted);
      return canvas;
    } finally {
      g.URL.revokeObjectURL(url);
    }
  }

  function surfaceOf(el: Node): string {
    for (let node = el; node; node = node.parentElement) {
      const color = win.getComputedStyle(node).backgroundColor;
      if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
    }
    return "rgb(255, 255, 255)";
  }

  // ---- open, move, commit ------------------------------------------------------------------------

  function begin(nextMode: Mode, direction: 1 | -1) {
    syncRoute();
    mode = nextMode;
    open = true;
    query = "";
    cards = buildCards(mru, serverId(), workspaces, limit);
    index = direction === 1 ? initialIndex(cards, currentKey()) : wrap(-1, cards.length);
    clearTimeout(showTimer);
    // A quick tap flips to the previous workspace without drawing anything.
    showTimer = setTimeout(show, nextMode === "hold" ? SHOW_DELAY_MS : 0);
  }

  function show() {
    if (!open) return;
    render();
    if (!live && Date.now() - workspacesAt > WORKSPACES_STALE_MS) void loadWorkspaces();
  }

  /** New workspace data while the switcher is drawn: same cards, same selection where possible. */
  function rerender() {
    if (!root) return;
    const selected = cards[index]?.key;
    const before = cards.length;
    const shown = cards;
    refreshCards();
    if (!query && before) cards = keepOrder(shown, cards);
    const kept = cards.findIndex((c) => c.key === selected);
    // A list that was empty while loading starts like a fresh open: on the previous workspace.
    index = kept >= 0 ? kept : before === 0 && !query ? initialIndex(cards, currentKey()) : Math.max(0, Math.min(index, cards.length - 1));
    render();
  }

  function refreshCards() {
    if (!query) {
      cards = buildCards(mru, serverId(), workspaces, limit);
      return;
    }
    const all = filterCards(query, mru, serverId(), workspaces, Infinity);
    matches = all.length;
    cards = all.slice(0, MAX_LIMIT);
  }

  /** Typing filters; it also turns a held switcher into one that waits for Enter or a click. */
  function setQuery(next: string) {
    if (next === query) return;
    query = next;
    mode = "sticky";
    refreshCards();
    index = query ? 0 : initialIndex(cards, currentKey());
    clearTimeout(showTimer);
    if (root) render();
    else show();
  }

  function move(delta: number) {
    if (!cards.length) return;
    index = wrap(index + delta, cards.length);
    if (root) select();
  }

  function close() {
    open = false;
    query = "";
    clearTimeout(showTimer);
    if (root) {
      // Canvases are reused by the next open; detach them before dropping the overlay.
      for (const canvas of thumbs.values()) canvas.remove();
      root.remove();
      root = null;
    }
  }

  function commit(at = index) {
    // With a filter, only a match can be the target; nothing matched means nothing to switch to.
    if (query && !cards[at]) return;
    const target = cards[at]?.key ?? previousKey(mru, currentKey());
    const drawn = Boolean(root);
    close();
    if (!target || target === currentKey()) return;
    if (!drawn) {
      navigate(target);
      return;
    }
    // Paseo renders the next workspace synchronously inside the click. Let the browser paint the
    // closed strip first, or it stays frozen on screen for the whole render.
    win.requestAnimationFrame(() => setTimeout(() => navigate(target), 0));
  }

  function navigate(key: string) {
    const row = doc.querySelector(rowSelector(key));
    if (row) {
      row.click();
      return;
    }
    // Collapsed project group or a stale sidebar: drive the router the way back/forward does.
    const { serverId: server, workspaceId } = splitKey(key);
    const path = `/h/${encodeURIComponent(server)}/workspace/${encodeURIComponent(workspaceId)}`;
    win.history.pushState(win.history.state, "", path);
    win.dispatchEvent(new g.PopStateEvent("popstate", { state: win.history.state }));
  }

  // ---- rendering ---------------------------------------------------------------------------------

  function render() {
    if (!open) return;
    const fresh = !root;
    if (fresh) {
      root = doc.createElement("div");
      root.setAttribute("data-paseo-switcher", "");
      root.className = "pws-root";
      root.addEventListener("mousedown", (e: any) => {
        if (e.target === root) close();
      });
    } else {
      for (const canvas of thumbs.values()) canvas.remove();
    }
    const surface = surfaceOf(currentPane() ?? doc.body);
    dark = isDark(surface);
    // A phone has room for one column; thumbnails would be cut off at the edges.
    const list = layout === "list" || narrow();
    root.classList.toggle("pws-dark", dark);
    root.classList.toggle("pws-list", list);
    root.classList.toggle("pws-entered", !fresh);
    root.style.setProperty("--pws-surface", surface);
    if (list) {
      // Rows plus panel padding, against the panel's max height (see .pws-list .pws-panel).
      overflowing = cards.length * ROW_H + 12 > win.innerHeight - Math.max(48, win.innerHeight * 0.16) - 150;
    } else {
      // Fit every card in the window when possible, within readable thumbnail sizes.
      const fit = Math.floor((win.innerWidth - 96 - 20 - (cards.length - 1) * 6) / Math.max(cards.length, 1)) - 16;
      const cardW = Math.max(CARD_MIN, Math.min(CARD_MAX, fit));
      // Card width + padding + gap, plus panel padding, against the panel's max width.
      overflowing = cards.length * (cardW + 16 + 6) + 14 > win.innerWidth - 96;
      root.classList.toggle("pws-overflow", overflowing);
      root.style.setProperty("--pws-w", `${cardW}px`);
      root.style.setProperty("--pws-h", `${Math.round(cardW * ASPECT)}px`);
    }

    const panel = el("div", "pws-panel");
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-label", "Switch workspace");
    const at = Date.now();
    if (cards.length) cards.forEach((card, i) => panel.appendChild(list ? renderRow(card, i, at) : renderCard(card, i)));
    else panel.appendChild(emptyState());
    if (!query && cards.length === 1 && cards[0].key === currentKey()) {
      const note = touchScreen() ? "Open another workspace to switch between them here." : "Open another workspace, then Ctrl+Tab flips between the two.";
      panel.appendChild(el("div", "pws-note", note));
    }
    // One sheet: the query, when there is one, is its header, so typing never moves the rows.
    const sheet = el("div", "pws-sheet");
    if (query) sheet.appendChild(queryBar());
    sheet.appendChild(panel);
    const parts: Node[] = [sheet];
    if (cards.length || query) parts.push(hintBar());
    root.replaceChildren(...parts);
    if (fresh) host.appendChild(root);
    select();
  }

  function narrow(): boolean {
    return win.innerWidth < 600;
  }

  function touchScreen(): boolean {
    return coarse || narrow();
  }

  /** The typed filter, shown above the results like a search field. */
  function queryBar(): Node {
    const bar = el("div", "pws-query");
    bar.appendChild(icon("search", "pws-query-icon"));
    const text = el("span", "pws-query-text", query);
    bar.appendChild(text);
    bar.appendChild(el("span", "pws-caret"));
    const count = matches > cards.length ? `${cards.length} of ${matches}` : matches === 1 ? "1 match" : `${matches} matches`;
    bar.appendChild(el("span", "pws-query-count", matches ? count : ""));
    return bar;
  }

  function emptyState(): Node {
    const box = el("div", "pws-empty");
    if (query) {
      box.appendChild(el("div", "pws-empty-title", `No workspace matches “${query}”`));
      box.appendChild(el("div", "pws-empty-text", "Names, projects, branches and pull request numbers are searched."));
    } else if (!workspaces) {
      const title = el("div", "pws-empty-title pws-loading");
      title.appendChild(el("span", "pws-spin"));
      title.appendChild(el("span", "", "Loading workspaces"));
      box.appendChild(title);
    } else {
      box.appendChild(el("div", "pws-empty-title", "No workspaces yet"));
      box.appendChild(el("div", "pws-empty-text", "Create one with New workspace in the sidebar."));
    }
    return box;
  }

  /** Keys that work right now, as keycaps. Touch screens get one plain sentence instead. */
  function hintBar(): Node {
    const bar = el("div", "pws-hint");
    if (touchScreen()) {
      bar.textContent = "Tap a workspace to switch";
      return bar;
    }
    const keys = (caps: string[], label: string) => {
      const item = el("span", "pws-hint-item");
      for (const cap of caps) item.appendChild(el("kbd", "pws-kbd", cap));
      item.appendChild(el("span", "", label));
      bar.appendChild(item);
    };
    const arrows = layout === "list" ? ["↑", "↓"] : ["←", "→"];
    if (query && !cards.length) {
      keys(["Backspace"], "edit");
      keys(["Esc"], "clear");
    } else if (query) {
      keys(["Enter"], "switch");
      keys(arrows, "move");
      keys(["Esc"], "clear");
    } else if (mode === "hold") {
      keys(["Ctrl"], "release to switch");
      keys(["Shift", "Tab"], "back");
      keys(["Esc"], "cancel");
      bar.appendChild(el("span", "pws-hint-item pws-hint-type", "Type to filter"));
    } else {
      keys(["Enter"], "switch");
      keys(arrows, "move");
      keys(["Esc"], "close");
      bar.appendChild(el("span", "pws-hint-item pws-hint-type", "Type to filter"));
    }
    return bar;
  }

  /** The workspace name, with the typed filter marked. */
  function nameNode(className: string, name: string): Node {
    const node = el("div", className);
    if (!query) {
      node.textContent = name;
      return node;
    }
    let from = 0;
    for (const [start, end] of matchRanges(name, query)) {
      if (start > from) node.appendChild(doc.createTextNode(name.slice(from, start)));
      node.appendChild(el("mark", "pws-mark", name.slice(start, end)));
      from = end;
    }
    if (from < name.length) node.appendChild(doc.createTextNode(name.slice(from)));
    return node;
  }

  function option(card: Card, i: number, className: string, name: string): Node {
    const node = el("div", className);
    node.setAttribute("role", "option");
    node.setAttribute("data-key", card.key);
    node.setAttribute("aria-label", name);
    node.addEventListener("mousemove", () => {
      if (index !== i) {
        index = i;
        select();
      }
    });
    node.addEventListener("click", () => commit(i));
    return node;
  }

  /** A dot for waiting/failed/finished, a turning ring for a running agent, like Paseo's sidebar. */
  function statusMark(status: WorkspaceInfo["status"]): Node {
    return el("span", status === "running" ? "pws-spin pws-running" : `pws-dot pws-${status}`);
  }

  function renderCard(card: Card, i: number): Node {
    const info = card.info;
    const name = info?.name ?? rowLabel(card.key) ?? "Workspace";
    const node = option(card, i, "pws-card", name);

    const frame = el("div", "pws-thumb");
    const canvas = thumbs.get(card.key);
    // A thumbnail from the other theme would flash; the placeholder reads better until it refreshes.
    if (canvas && canvas.dataset.dark === String(dark)) frame.appendChild(canvas);
    else frame.appendChild(placeholder(info?.project ?? null, card.key));
    if (i < 9) frame.appendChild(el("kbd", "pws-number", String(i + 1)));
    node.appendChild(frame);

    const title = el("div", "pws-title");
    if (info && info.status !== "done") title.appendChild(statusMark(info.status));
    title.appendChild(nameNode("pws-name", name));
    node.appendChild(title);

    const meta = el("div", "pws-meta");
    meta.appendChild(el("span", "pws-where", [info?.project, info?.branch].filter(Boolean).join(" · ")));
    if (info && (info.additions || info.deletions)) meta.appendChild(diffNode(info));
    node.appendChild(meta);
    return node;
  }

  function diffNode(info: WorkspaceInfo): Node {
    const diff = el("span", "pws-part pws-diff");
    diff.appendChild(el("span", "pws-add", `+${info.additions}`));
    diff.appendChild(el("span", "pws-del", `−${info.deletions}`));
    return diff;
  }

  /** A list row: the full name, where it lives, its pull request, and what its agent is doing. */
  function renderRow(card: Card, i: number, at: number): Node {
    const info = card.info;
    const name = info?.name ?? rowLabel(card.key) ?? "Workspace";
    const node = option(card, i, "pws-card pws-row", name);

    node.appendChild(el("kbd", "pws-number", i < 9 ? String(i + 1) : ""));
    const project = info?.project ?? null;
    node.appendChild(el("div", "pws-badge", (project ?? "?").slice(0, 1).toUpperCase()));

    const main = el("div", "pws-main");
    main.appendChild(nameNode("pws-name", name));
    const meta = el("div", "pws-meta");
    const part = (className: string, text: string, title?: string) => {
      const span = el("span", className, text);
      if (title) span.title = title;
      meta.appendChild(span);
      return span;
    };
    if (project) part("pws-part", project);
    // The name is often the branch; only show the branch when it adds something.
    if (info?.branch && info.branch !== name) part("pws-part pws-branch", info.branch);
    const pr = info?.pr;
    if (pr) {
      const chip = el("span", `pws-part pws-pr pws-pr-${pr.state}`);
      chip.title = "Pull request";
      chip.appendChild(icon(PR_ICON[pr.state], "pws-icon"));
      const state = pr.state === "open" ? "" : ` ${pr.state[0].toUpperCase()}${pr.state.slice(1)}`;
      chip.appendChild(el("span", "", `${pr.number ? `#${pr.number}` : "PR"}${state}`));
      meta.appendChild(chip);
      if (pr.state === "open" || pr.state === "draft") {
        if (pr.checks !== "none") {
          const checks = el("span", `pws-part pws-checks pws-checks-${pr.checks}`);
          checks.title = "Checks";
          checks.appendChild(icon(CHECK_ICON[pr.checks], "pws-icon"));
          checks.appendChild(el("span", "", CHECK_LABEL[pr.checks]));
          meta.appendChild(checks);
        }
        if (pr.review === "approved") part("pws-part pws-approved", "Approved");
        else if (pr.review === "changes_requested") part("pws-part pws-changes", "Changes requested");
      }
    }
    if (info && (info.additions || info.deletions)) meta.appendChild(diffNode(info));
    if (info?.ahead) {
      const ahead = el("span", "pws-part pws-ahead");
      ahead.title = `${info.ahead} ${info.ahead === 1 ? "commit" : "commits"} not pushed`;
      ahead.appendChild(icon("arrowUp", "pws-icon"));
      ahead.appendChild(el("span", "", String(info.ahead)));
      meta.appendChild(ahead);
    }
    if (meta.childNodes.length) main.appendChild(meta);
    node.appendChild(main);

    const side = el("div", "pws-side");
    if (info && info.status !== "done") {
      const status = el("div", `pws-status pws-status-${info.status}`);
      status.appendChild(statusMark(info.status));
      status.appendChild(el("span", "", STATUS_LABEL[info.status]));
      side.appendChild(status);
      const since = ago(info.statusAt || info.activityAt, at);
      if (since) side.appendChild(el("div", "pws-time", since === "now" ? "just now" : `for ${since}`));
    } else {
      const since = ago(info?.activityAt, at);
      if (since) side.appendChild(el("div", "pws-time", since === "now" ? "just now" : `${since} ago`));
    }
    node.appendChild(side);
    return node;
  }

  function placeholder(project: string | null, key: string): Node {
    const box = el("div", "pws-placeholder");
    box.appendChild(el("div", "pws-initial", (project ?? "?").slice(0, 1).toUpperCase()));
    box.appendChild(el("div", "pws-placeholder-text", "No preview yet"));
    return box;
  }

  function swapThumb(key: string, canvas: Node) {
    if (canvas.dataset.dark !== String(dark)) return;
    const frame = root?.querySelector(`.pws-card[data-key="${key}"] .pws-thumb`);
    if (!frame) return;
    const old = frame.querySelector(".pws-canvas, .pws-placeholder");
    if (old) old.replaceWith(canvas);
    else frame.prepend(canvas);
  }

  /** Lucide icons, parsed once and cloned per use. */
  const iconCache = new Map<string, Node>();
  function icon(name: keyof typeof ICONS, className: string): Node {
    let template = iconCache.get(name);
    if (!template) {
      const holder = doc.createElement("div");
      holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
      template = holder.firstChild as Node;
      iconCache.set(name, template);
    }
    const node = template.cloneNode(true);
    node.setAttribute("class", className);
    return node;
  }

  function select() {
    if (!root) return;
    const nodes = root.querySelectorAll(".pws-card");
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle("pws-selected", i === index);
      nodes[i].setAttribute("aria-selected", String(i === index));
    }
    // Scrolling forces a layout; only an overflowing panel (small windows, many cards) needs it.
    if (overflowing) nodes[index]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function rowLabel(key: string): string | null {
    return doc.querySelector(rowSelector(key))?.getAttribute("aria-label") ?? null;
  }

  function isDark(surface: string): boolean {
    const match = /(\d+),\s*(\d+),\s*(\d+)/.exec(surface);
    if (!match) return false;
    const [r, gr, b] = match.slice(1).map(Number);
    return 0.2126 * r + 0.7152 * gr + 0.0722 * b < 128;
  }

  function el(tag: string, className: string, text?: string): Node {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---- input -------------------------------------------------------------------------------------

  function stop(e: any) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }

  function onKeyDown(e: any) {
    if (!open && history?.handleKey(e, keys.realKey(e))) return;
    if (e.isComposing) return;
    const key = keys.realKey(e);
    if (key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
      stop(e);
      if (open) move(e.shiftKey ? -1 : 1);
      else begin("hold", e.shiftKey ? -1 : 1);
      return;
    }
    if (!open) return;
    if (key === "Control" || key === "Shift") return;
    stop(e);
    if (key === "Escape") {
      if (query) setQuery("");
      else close();
    } else if (key === "Enter") commit();
    else if (key === "ArrowRight" || key === "ArrowDown") move(1);
    else if (key === "ArrowLeft" || key === "ArrowUp") move(-1);
    else if (key === "Backspace") setQuery(e.ctrlKey || e.altKey ? "" : query.slice(0, -1));
    // Number keys jump to a card until a filter is typed; then they search pull request numbers too.
    else if (!query && /^[1-9]$/.test(key)) {
      if (Number(key) <= cards.length) commit(Number(key) - 1);
    } else if (key.length === 1 && !e.metaKey && (query || key !== " ")) setQuery(query + key);
  }

  function onKeyUp(e: any) {
    if (open && mode === "hold" && keys.realKey(e) === "Control") {
      stop(e);
      commit();
    }
  }

  function onBlur() {
    if (open) close();
  }

  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("keyup", onKeyUp, true);
  win.addEventListener("blur", onBlur);
  win.addEventListener("popstate", syncRoute);
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  const routeTimer = setInterval(syncRoute, POLL_ROUTE_MS);
  // Nothing here runs on a navigation path: snapshots happen in idle time while you stay put,
  // right after a frame paints so measuring the pane never forces Paseo's pending layout early.
  const refreshTimer = setInterval(() => {
    if (currentPane() !== watched) watchPane();
    if (layout === "strip" && dirty && !doc.hidden && Date.now() >= quietUntil) {
      whenIdle(() => win.requestAnimationFrame(() => setTimeout(snapshotIfDirty, 0)));
    }
  }, REFRESH_MS);
  syncRoute();
  watchWorkspaces();

  const api: Switcher = {
    history,
    open: () => begin("sticky", 1),
    getLimit: () => limit,
    setLimit(next) {
      limit = clampLimit(next);
      writeJson(LIMIT_KEY, limit);
    },
    getLayout: () => layout,
    setLayout(next) {
      layout = parseLayout(next);
      writeJson(LAYOUT_KEY, layout);
    },
    dispose() {
      close();
      disposed = true;
      releaseFeed?.();
      history?.dispose();
      clearInterval(routeTimer);
      clearInterval(refreshTimer);
      observer.disconnect();
      win.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("keyup", onKeyUp, true);
      keys.release();
      win.removeEventListener("blur", onBlur);
      win.removeEventListener("popstate", syncRoute);
      doc.removeEventListener("scroll", onScroll, { capture: true });
      style.remove();
      host.remove();
      thumbs.clear();
      pending.clear();
      if (g.__paseoSwitcher === api) g.__paseoSwitcher = undefined;
    },
  };
  g.__paseoSwitcher = api;
  return api;
}

/**
 * Paseo's shortcut engine listens on the window before any plugin loads, so a Paseo shortcut bound
 * to Ctrl+Tab or Ctrl+Shift+Tab (Next tab, say) would act on the same press as the switcher. The
 * switcher owns those keys, and every key while it is open (typing "k" with Ctrl held would
 * otherwise open the Command Center): everyone else reads them as an unidentified key with no
 * code, which matches no shortcut, while the switcher reads the real key through `realKey`.
 */
function claimKeys(isOpen: () => boolean, extra: (event: any, key: string) => boolean): { realKey(e: any): string; release(): void } {
  const proto = g.KeyboardEvent?.prototype;
  const get = (name: string) => (proto ? Object.getOwnPropertyDescriptor(proto, name) : undefined);
  const key = get("key");
  const code = get("code");
  const [keyOf, codeOf, ctrlOf, metaOf, altOf] = [key, code, get("ctrlKey"), get("metaKey"), get("altKey")].map((d) => d?.get);
  if (!keyOf || !codeOf || !ctrlOf || !metaOf || !altOf || !key?.configurable || !code?.configurable) {
    return { realKey: (e) => e.key, release() {} };
  }
  // Modifier presses stay visible, so anything tracking held modifiers never gets stuck.
  const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta"]);
  const claimed = (e: any) => {
    const k = keyOf.call(e);
    if (isOpen()) return !MODIFIERS.has(k);
    if (extra(e, k)) return true;
    return k === "Tab" && ctrlOf.call(e) && !metaOf.call(e) && !altOf.call(e);
  };
  const hiddenKey = function (this: any) {
    return claimed(this) ? "Unidentified" : keyOf.call(this);
  };
  const hiddenCode = function (this: any) {
    return claimed(this) ? "" : codeOf.call(this);
  };
  Object.defineProperty(proto, "key", { ...key, get: hiddenKey });
  Object.defineProperty(proto, "code", { ...code, get: hiddenCode });
  return {
    realKey: (e) => keyOf.call(e),
    release() {
      // Restore only our own getters, in case something else wrapped them since.
      if (get("key")?.get === hiddenKey) Object.defineProperty(proto, "key", key);
      if (get("code")?.get === hiddenCode) Object.defineProperty(proto, "code", code);
    },
  };
}

function now(): number {
  return g.performance?.now?.() ?? Date.now();
}

/** User Timing entries (`pws:*`) let the end-to-end tests check the plugin never blocks the app. */
function measure(name: string, start: number) {
  try {
    g.performance?.measure?.(`pws:${name}`, { start, end: now() });
  } catch {
    // Older runtimes without the options form simply skip the entry.
  }
}


const PR_ICON = { open: "pr", draft: "prDraft", merged: "merge", closed: "prClosed" } as const;
const CHECK_ICON = { success: "circleCheck", failure: "circleX", pending: "circle" } as const;
/** "pending", not Paseo's "running", so checks never read like the agent's own status. */
const CHECK_LABEL = { success: "passed", failure: "failed", pending: "pending" } as const;

/** Lucide (ISC) paths, drawn at 24×24 with a 2px stroke. */
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>',
  prDraft: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6V5"/><path d="M18 11v-1"/><path d="M6 9v12"/>',
  prClosed: '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="m21 3-6 6"/><path d="m21 9-6-6"/><path d="M18 11.5V15"/><circle cx="18" cy="18" r="3"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  circleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
};

const CSS = `
.pws-host { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483000; }
.pws-root {
  --pws-panel: rgba(246, 246, 247, 0.96);
  --pws-solid: #f6f6f7;
  --pws-tile: rgba(0, 0, 0, 0.07);
  --pws-border: rgba(0, 0, 0, 0.1);
  --pws-selected: rgba(0, 0, 0, 0.07);
  --pws-ring: rgba(0, 0, 0, 0.16);
  --pws-fg: #18181b;
  --pws-muted: #63636b;
  --pws-faint: rgba(0, 0, 0, 0.05);
  --pws-thumb-border: rgba(0, 0, 0, 0.08);
  --pws-key: rgba(255, 255, 255, 0.95);
  --pws-mark: rgba(24, 24, 27, 0.12);
  --pws-add: #15803d;
  --pws-del: #dc2626;
  --pws-ok: #16a34a;
  --pws-bad: #dc2626;
  --pws-wait: #b45309;
  --pws-wait-dot: #f59e0b;
  --pws-run: #2563eb;
  --pws-merged: #7c3aed;
  position: fixed; inset: 0; z-index: 2147483000; contain: strict;
  /* Pinned near the top like Spotlight, so the sheet grows downward and never jumps while you type. */
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 10px;
  padding-top: max(48px, 16vh); box-sizing: border-box;
  /* Dim enough that page text never competes with the sheet and hint resting on it. */
  background: rgba(24, 24, 27, 0.34);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none;
  animation: pws-fade 140ms ease-out;
}
.pws-root.pws-dark {
  --pws-panel: rgba(30, 30, 33, 0.95);
  --pws-solid: #1e1e21;
  --pws-tile: rgba(255, 255, 255, 0.1);
  --pws-border: rgba(255, 255, 255, 0.09);
  --pws-selected: rgba(255, 255, 255, 0.08);
  --pws-ring: rgba(255, 255, 255, 0.17);
  --pws-fg: #f4f4f5;
  --pws-muted: #a1a1aa;
  --pws-faint: rgba(255, 255, 255, 0.05);
  --pws-thumb-border: rgba(255, 255, 255, 0.07);
  --pws-key: rgba(255, 255, 255, 0.07);
  --pws-mark: rgba(255, 255, 255, 0.16);
  --pws-add: #4ade80;
  --pws-del: #f87171;
  --pws-ok: #4ade80;
  --pws-bad: #f87171;
  --pws-wait: #fbbf24;
  --pws-wait-dot: #fbbf24;
  --pws-run: #60a5fa;
  --pws-merged: #a78bfa;
  background: rgba(0, 0, 0, 0.5);
}
/* One authored moment: the panel settles in from just below. Re-renders while open never replay it. */
.pws-sheet { animation: pws-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
.pws-hint { animation: pws-fade 220ms ease-out; }
.pws-entered .pws-sheet, .pws-entered .pws-hint { animation: none; }
.pws-sheet {
  display: flex; flex-direction: column; max-width: calc(100vw - 96px); box-sizing: border-box; overflow: hidden;
  background: var(--pws-panel); border: 1px solid var(--pws-border); border-radius: 22px;
  backdrop-filter: blur(28px) saturate(1.4); -webkit-backdrop-filter: blur(28px) saturate(1.4);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.26), 0 2px 8px rgba(0, 0, 0, 0.1);
}
.pws-panel {
  /* Each card keeps its own height, so a two-line name never stretches the selection ring. */
  display: flex; align-items: flex-start; gap: 6px; padding: 10px; box-sizing: border-box; overflow-x: auto;
  scrollbar-width: thin; scrollbar-color: var(--pws-ring) transparent;
}
/* An overflowing strip fades at its edges instead of cutting a card mid-word. */
.pws-overflow .pws-panel {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
  mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
}
.pws-card {
  flex: 0 0 auto; width: var(--pws-w); padding: 8px 8px 10px; border-radius: 15px; cursor: default;
  transition: background-color 90ms ease, box-shadow 90ms ease;
}
.pws-card.pws-selected { background: var(--pws-selected); box-shadow: inset 0 0 0 1px var(--pws-ring); }
.pws-thumb {
  position: relative; width: var(--pws-w); height: var(--pws-h); overflow: hidden; border-radius: 9px;
  border: 1px solid var(--pws-thumb-border); box-sizing: border-box; background: var(--pws-surface);
}
.pws-canvas { display: block; width: 100%; height: 100%; }
.pws-placeholder {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: var(--pws-faint);
}
.pws-initial {
  width: 36px; height: 36px; border-radius: 10px; background: var(--pws-tile); color: var(--pws-muted); font-size: 17px; font-weight: 650;
  display: flex; align-items: center; justify-content: center;
}
.pws-placeholder-text { color: var(--pws-muted); font-size: 12px; }
.pws-number, .pws-kbd {
  display: inline-block; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
  border-radius: 5px; background: var(--pws-key); color: var(--pws-muted); border: 1px solid var(--pws-border);
  box-shadow: 0 1px 0 var(--pws-border);
  font: 600 11px/16px system-ui, -apple-system, sans-serif; text-align: center; font-variant-numeric: tabular-nums;
}
.pws-thumb .pws-number { position: absolute; top: 6px; right: 6px; }
.pws-title { display: flex; align-items: center; gap: 7px; margin: 10px 2px 0; min-width: 0; }
.pws-card:not(.pws-row) .pws-name {
  white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; line-height: 19px;
}
.pws-name {
  color: var(--pws-fg); font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pws-mark { background: var(--pws-mark); color: inherit; border-radius: 3px; box-shadow: 0 0 0 1px var(--pws-mark); }
.pws-meta { display: flex; align-items: baseline; gap: 8px; margin: 3px 2px 0; font-size: 12px; min-width: 0; color: var(--pws-muted); }
.pws-where { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pws-diff { display: inline-flex; gap: 4px; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.pws-add { color: var(--pws-add); }
.pws-del { color: var(--pws-del); }
.pws-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
.pws-needs_input { background: var(--pws-wait-dot); }
.pws-attention { background: var(--pws-ok); }
.pws-failed { background: var(--pws-bad); }
.pws-spin {
  flex: 0 0 auto; width: 9px; height: 9px; box-sizing: border-box; border-radius: 50%;
  border: 1.75px solid currentColor; border-top-color: transparent; color: var(--pws-muted);
  animation: pws-turn 0.9s linear infinite;
}
.pws-spin.pws-running { color: var(--pws-run); }
.pws-hint {
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px 14px;
  max-width: calc(100vw - 32px); box-sizing: border-box;
  color: var(--pws-fg); font-size: 12px; line-height: 18px; padding: 5px 12px; border-radius: 999px;
  background: var(--pws-solid); border: 1px solid var(--pws-border);
}
.pws-hint-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.pws-hint-item > span { margin-left: 2px; opacity: 0.85; }
.pws-hint-type { color: var(--pws-muted); }
.pws-hint .pws-kbd { color: var(--pws-fg); }
.pws-query {
  display: flex; align-items: center; gap: 10px; box-sizing: border-box; flex: 0 0 auto;
  height: 48px; padding: 0 18px; min-width: 0;
  background: var(--pws-solid); border-bottom: 1px solid var(--pws-border);
  color: var(--pws-fg); font-size: 15px;
}
.pws-query-icon { width: 16px; height: 16px; color: var(--pws-muted); flex: 0 0 auto; }
.pws-query-text { white-space: pre; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-weight: 500; }
.pws-caret { flex: 0 0 auto; width: 1.5px; height: 19px; margin-left: -9px; background: var(--pws-fg); animation: pws-blink 1s steps(1) infinite; }
.pws-query-count { margin-left: auto; flex: 0 0 auto; color: var(--pws-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.pws-empty { padding: 26px 32px; text-align: center; min-width: 280px; box-sizing: border-box; flex: 1; }
.pws-empty-title { color: var(--pws-fg); font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.pws-empty-text { color: var(--pws-muted); font-size: 12.5px; margin-top: 4px; }
.pws-loading { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; color: var(--pws-muted); }
.pws-note { color: var(--pws-muted); font-size: 12px; padding: 6px 12px 6px 48px; }
.pws-list .pws-sheet { width: min(680px, calc(100vw - 32px)); max-width: none; border-radius: 18px; }
.pws-list .pws-panel {
  flex-direction: column; align-items: stretch; gap: 2px; padding: 6px;
  max-height: calc(100vh - max(48px, 16vh) - 150px); overflow-x: hidden; overflow-y: auto;
}
.pws-row {
  display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: start; column-gap: 12px;
  width: auto; padding: 10px 12px; border-radius: 12px;
}
.pws-list .pws-number { margin-top: 1px; }
.pws-badge {
  width: 22px; height: 22px; border-radius: 7px; background: var(--pws-tile); color: var(--pws-muted); font-size: 12px; font-weight: 650;
  display: flex; align-items: center; justify-content: center;
}
.pws-main { min-width: 0; }
.pws-list .pws-name {
  display: block; font-size: 14px; line-height: 20px; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere;
}
.pws-list .pws-meta { flex-wrap: wrap; align-items: center; gap: 2px 12px; margin: 3px 0 0; line-height: 17px; }
.pws-part { white-space: nowrap; }
.pws-branch { white-space: normal; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.pws-icon { width: 13px; height: 13px; flex: 0 0 auto; }
.pws-pr, .pws-checks, .pws-ahead { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
.pws-pr { color: var(--pws-fg); }
.pws-pr-open .pws-icon { color: var(--pws-ok); }
.pws-pr-draft .pws-icon, .pws-pr-closed { color: var(--pws-muted); }
.pws-pr-closed .pws-icon { color: var(--pws-bad); }
.pws-pr-merged { color: var(--pws-merged); }
.pws-checks-success, .pws-approved { color: var(--pws-ok); }
.pws-checks-failure, .pws-changes { color: var(--pws-bad); }
.pws-checks-pending { color: var(--pws-wait); }
.pws-side { text-align: right; font-size: 12px; line-height: 20px; white-space: nowrap; }
.pws-status { display: flex; align-items: center; justify-content: flex-end; gap: 6px; font-weight: 550; color: var(--pws-fg); }
.pws-status-needs_input { color: var(--pws-wait); }
.pws-status-failed { color: var(--pws-bad); }
.pws-time { color: var(--pws-muted); font-variant-numeric: tabular-nums; line-height: 17px; margin-top: 3px; }
.pws-status + .pws-time { margin-top: 0; }
@media (max-width: 599px) {
  .pws-row { grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 10px; padding: 10px; }
  .pws-badge { display: none; }
  .pws-note { padding-left: 12px; }
}
@keyframes pws-fade { from { opacity: 0; } }
@keyframes pws-in { from { opacity: 0; transform: translateY(6px) scale(0.985); } }
@keyframes pws-turn { to { transform: rotate(360deg); } }
@keyframes pws-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .pws-root, .pws-sheet, .pws-hint, .pws-caret { animation: none; }
  .pws-card { transition: none; }
  /* A still ring reads as "in progress" without turning. */
  .pws-spin { animation: none; border-style: dotted; border-top-color: currentColor; }
}
`;
