import assert from "node:assert/strict";
import { test } from "node:test";
import { historyRoute, parseShortcut, VisitHistory, type Visit } from "../client/history.ts";

const page = (route: string): Visit => ({ route, workspaceKey: null, tabId: null, paneId: null });
const tab = (id: string | null, paneId = "pane-1"): Visit => ({
  route: "/h/s/workspace/w",
  workspaceKey: "s:w",
  tabId: id,
  paneId: id ? paneId : null,
});
const all = () => true;

test("chronological visits retain repetitions and focused tabs", () => {
  const h = new VisitHistory();
  for (const visit of [tab("a"), tab("b"), page("/settings"), tab("a")]) h.record(visit);
  assert.equal(h.entries.length, 4);
  h.cursor = h.find(-1, all);
  assert.equal(h.entries[h.cursor].route, "/settings");
  h.cursor = h.find(-1, all);
  assert.equal(h.entries[h.cursor].tabId, "b");
  h.cursor = h.find(1, all);
  assert.equal(h.entries[h.cursor].route, "/settings");
});

test("a new visit after Back discards the forward branch; a duplicate does not", () => {
  const h = new VisitHistory();
  h.record(tab("a"));
  h.record(tab("b"));
  h.record(page("/settings"));
  h.cursor = 1;
  assert.equal(h.record(tab("b")), false);
  assert.equal(h.find(1, all), 2);
  h.record(page("/history"));
  assert.deepEqual(
    h.entries.map((v) => v.route),
    [tab("a").route, tab("b").route, "/history"],
  );
  assert.equal(h.find(1, all), -1);
});

test("workspace loading enriches a visit without adding a blank tab or truncating history", () => {
  const h = new VisitHistory();
  h.record(tab(null));
  h.record(tab("a"));
  h.record(tab(null));
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].tabId, "a");
});

test("closed entries and duplicate destinations are skipped with bounded traversal", () => {
  const h = new VisitHistory();
  h.record(tab("a"));
  h.record(tab("b"));
  h.record(tab("a"));
  h.record(tab("c"));
  h.cursor = 0;
  assert.equal(h.find(-1, all), -1);
  assert.equal(
    h.find(1, (v) => v.tabId !== "b"),
    3,
  );
  h.cursor = 3;
  assert.equal(h.find(1, all), -1);
  assert.equal(
    h.find(-1, () => false),
    -1,
  );
});

test("two panes showing the same tab remain separate destinations", () => {
  const h = new VisitHistory();
  h.record(tab("a", "pane-1"));
  h.record(tab("a", "pane-2"));
  assert.equal(h.entries.length, 2);
  assert.equal(h.find(-1, all), 0);
});

test("history is bounded and starts fresh per instance", () => {
  const h = new VisitHistory();
  for (let i = 0; i < 220; i++) h.record(page(`/settings/${i}`));
  assert.equal(h.entries.length, 200);
  assert.equal(h.entries[0].route, "/settings/20");
  assert.equal(h.cursor, 199);
  assert.equal(new VisitHistory().cursor, -1);
});

test("redirects and one-shot workspace parameters do not pollute history", () => {
  for (const route of ["/", "/h/server", "/h/server/", "/h/server/agent/agent-id"])
    assert.equal(historyRoute(route), null);
  assert.equal(
    historyRoute("/h/s/workspace/w/", "?open=agent_a&pop=true&keep=yes"),
    "/h/s/workspace/w?keep=yes",
  );
  assert.equal(
    historyRoute("/settings/hosts/s/plugins/example/page", "?filter=a%20b", "#section"),
    "/settings/hosts/s/plugins/example/page?filter=a%20b#section",
  );
  assert.equal(
    historyRoute("/h/s/plugin/id/page", "?open=example"),
    "/h/s/plugin/id/page?open=example",
  );
});

test("shortcut settings use platform defaults and reject corrupt settings", () => {
  assert.equal(parseShortcut(null, true), "ctrl-minus");
  assert.equal(parseShortcut("invalid", false), "alt-arrows");
  assert.equal(parseShortcut("cmd-brackets", false), "cmd-brackets");
  assert.equal(parseShortcut("none", true), "none");
});
