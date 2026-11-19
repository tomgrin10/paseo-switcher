import assert from "node:assert/strict";
import { test } from "node:test";
import { findSidebarHeader } from "../client/sidebar-header.ts";

// A minimal element tree: testid, layout height and children, with the few DOM calls the
// lookup makes. Heights follow Paseo's sidebar: a 36px chrome row, an 8px drag strip.
interface Node {
  testid?: string;
  height: number;
  children: Node[];
  parentElement: Node | null;
  previousElementSibling: Node | null;
  nextElementSibling: Node | null;
  getBoundingClientRect(): { height: number };
  querySelector(selector: string): Node | null;
  closest(selector: string): Node | null;
  insertBefore(node: Node, before: Node): void;
}

const ids = (selector: string) =>
  [...selector.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);

function el(
  testid: string | undefined,
  height: number,
  children: Node[] = [],
): Node {
  const node: Node = {
    testid,
    height,
    children,
    parentElement: null,
    get previousElementSibling() {
      const list = this.parentElement?.children ?? [];
      return list[list.indexOf(this) - 1] ?? null;
    },
    get nextElementSibling() {
      const list = this.parentElement?.children ?? [];
      const i = list.indexOf(this);
      return i < 0 ? null : (list[i + 1] ?? null);
    },
    getBoundingClientRect: () => ({ height }),
    querySelector(selector) {
      const want = ids(selector);
      const walk = (n: Node): Node | null => {
        for (const child of n.children) {
          if (child.testid && want.includes(child.testid)) return child;
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    },
    closest(selector) {
      const want = ids(selector);
      for (let n: Node | null = this; n; n = n.parentElement)
        if (n.testid && want.includes(n.testid)) return n;
      return null;
    },
    insertBefore(child, before) {
      child.parentElement?.children.splice(
        child.parentElement.children.indexOf(child),
        1,
      );
      this.children.splice(this.children.indexOf(before), 0, child);
      child.parentElement = this;
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function navGroup() {
  const row = el("sidebar-global-new-workspace", 32);
  const group = el(undefined, 120, [
    el(undefined, 32, [row]),
    el("sidebar-sessions", 32),
  ]);
  return { row, group };
}

// 0.15/0.16 desktop (macOS): drag area = [chrome row, nav group].
test("0.16 desktop: the arrows sit in the window-chrome row", () => {
  const { row, group } = navGroup();
  const chrome = el(undefined, 36);
  el(undefined, 600, [el(undefined, 156, [chrome, group])]);
  assert.equal(findSidebarHeader(row, el(undefined, 36))?.chrome, chrome);
});

// 0.15/0.16 plain web: the drag region renders nothing, so the group is first.
test("0.16 plain web: no chrome row, the spacer goes before the nav group", () => {
  const { row, group } = navGroup();
  const dragArea = el(undefined, 120, [group]);
  el(undefined, 600, [dragArea]);
  const header = findSidebarHeader(row, el(undefined, 36));
  assert.equal(header?.chrome, null);
  assert.equal(header?.parent, dragArea);
  assert.equal(header?.before, group);
});

// 0.17 desktop (macOS): sidebar = [drag area [chrome row], nav scroll [content [group]], separator].
test("0.17 desktop: the arrows sit in the window-chrome row above the scrolling nav", () => {
  const { row, group } = navGroup();
  const chrome = el(undefined, 36);
  const dragArea = el(undefined, 36, [chrome]);
  const scroll = el("sidebar-nav-scroll", 120, [el(undefined, 120, [group])]);
  el(undefined, 600, [dragArea, scroll, el("sidebar-nav-separator", 1)]);
  const header = findSidebarHeader(row, el(undefined, 36));
  assert.ok(
    header?.chrome === dragArea || header?.chrome === chrome,
    "found the chrome row",
  );
});

// 0.17 plain web and Windows/Linux: the drag area holds only an 8px drag strip.
test("0.17 plain web: an 8px drag strip is not a header; the spacer stays outside the scroller", () => {
  const { row, group } = navGroup();
  const dragArea = el(undefined, 8, [el("sidebar-nav-drag-strip", 8)]);
  const scroll = el("sidebar-nav-scroll", 120, [el(undefined, 120, [group])]);
  const sidebar = el(undefined, 600, [dragArea, scroll]);
  const spacer = el(undefined, 36);
  const header = findSidebarHeader(row, spacer);
  assert.equal(header?.chrome, null);
  assert.equal(header?.parent, sidebar);
  assert.equal(header?.before, scroll);
  // Once inserted, the spacer is skipped, never mistaken for a chrome row.
  sidebar.insertBefore(spacer, scroll);
  const again = findSidebarHeader(row, spacer);
  assert.equal(again?.chrome, null);
  assert.equal(again?.before, scroll);
});

test("0.16: an inserted spacer is never taken for the chrome row", () => {
  const { row, group } = navGroup();
  const spacer = el(undefined, 36);
  const dragArea = el(undefined, 156, [spacer, group]);
  el(undefined, 600, [dragArea]);
  assert.equal(findSidebarHeader(row, spacer)?.chrome, null);
});
