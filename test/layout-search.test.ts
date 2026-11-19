import assert from "node:assert/strict";
import { test } from "node:test";
import { filterCards, type WorkspaceInfo } from "../client/model.ts";

const item = (id: string, name: string, branch: string | null = null): WorkspaceInfo => ({
  id, name, branch, project: "acme", status: "done", additions: 0, deletions: 0, activityAt: 0,
});
const find = (query: string, items: WorkspaceInfo[], physical?: string | null) =>
  filterCards(query, [], "dev-box", new Map(items.map(i => [i.id, i])), Infinity, physical).map(c => c.workspaceId);
const smart = item("smart", "Smart Session");
test("Hebrew table finds Smart Session", () => {
  assert.deepEqual(find("דצשרא דקדדןםמ", [smart]), ["smart"]);
});
test("Russian table finds Smart Session", () => {
  assert.deepEqual(find("ыьфке ыуыышщт", [smart]), ["smart"]);
});
test("physical reconstruction accepts an untabled language", () => {
  assert.deepEqual(find("سمرات", [smart], "smart"), ["smart"]);
});
test("direct branch match beats converted name match", () => {
  assert.deepEqual(find("דצשרא דקדדןםמ", [smart, item("direct", "Invoice exports", "דצשרא דקדדןםמ")]), ["direct", "smart"]);
});
test("empty query has no search results", () => {
  assert.deepEqual(find("", [smart], "smart"), []);
});

test("physical Hebrew keystrokes find Smart Session; paste and IME invalidate capture", async () => {
  const { LayoutCapture } = await import("../client/layout-swap.ts");
  for (const text of ["דצשרא דקדדןםמ", "ыьфке ыуыышщт", "سمرات سيسسيون"]) {
    const capture = new LayoutCapture();
    let value = "", physical: string | null = null;
    for (const [i, key] of [...text].entries()) {
      const letter = "smart session"[i];
      capture.key({ key, code: letter === " " ? "Space" : `Key${letter.toUpperCase()}` }, value, value.length, value.length);
      value += key;
      physical = capture.change(value);
    }
    assert.deepEqual(find(value, [smart], physical), ["smart"]);
    assert.equal(capture.change("pasted"), null);
    capture.key({ key: "ד", code: "KeyS" }, "pasted", 6, 6);
    assert.equal(capture.change("pastedד"), null);
    capture.change("");
    capture.key({ key: "ד", code: "KeyS", isComposing: true }, "", 0, 0);
    assert.equal(capture.change("ד"), null);
    capture.change("");
    capture.key({ key: "ד", code: "KeyS" }, "", 0, 0);
    assert.equal(capture.change("ד"), "s");
    capture.key({ key: "Backspace", code: "Backspace" }, "ד", 1, 1);
    assert.equal(capture.change(""), null);
  }
});
