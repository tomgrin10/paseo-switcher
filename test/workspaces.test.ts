import assert from "node:assert/strict";
import { test } from "node:test";
import { applyWorkspaceUpdate, toWorkspaceInfo, workspaceMap, type WorkspaceDescriptor } from "../client/model.ts";

const BUCKETS = ["needs_input", "failed", "running", "attention", "done"] as const;

const descriptor = (over: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor => ({
  id: "w1",
  name: "Checkout redesign",
  projectDisplayName: "app",
  status: "done",
  ...over,
});

// Invariant: a workspace's status is the host's own bucket, the one Paseo's sidebar draws. The
// switcher never derives it from agents, rows or timeline items, so it can't disagree with the host.
test("status is the host's bucket, verbatim, for every bucket", () => {
  for (const status of BUCKETS) assert.equal(toWorkspaceInfo(descriptor({ status }))?.status, status);
});

test("the host's effective indicator wins over the raw daemon status when present", () => {
  assert.equal(toWorkspaceInfo(descriptor({ status: "done", indicator: "running" }))?.status, "running");
});

test("an unknown bucket from a newer host reads as done, never as another known status", () => {
  assert.equal(toWorkspaceInfo(descriptor({ status: "sleeping" as never }))?.status, "done");
});

test("archiving and background workspaces are not switchable", () => {
  assert.equal(toWorkspaceInfo(descriptor({ archivingAt: "2026-11-11T10:00:00Z" })), null);
  assert.equal(toWorkspaceInfo(descriptor({ background: true })), null);
});

test("pull request, branch, diff and activity map through", () => {
  const info = toWorkspaceInfo(
    descriptor({
      gitRuntime: { currentBranch: "feat/x", aheadOfOrigin: 2 },
      diffStat: { additions: 3, deletions: 1 },
      activityAt: null,
      lastUserMessageAt: "2026-11-11T10:00:00Z",
      statusEnteredAt: "2026-11-11T09:00:00Z",
      githubRuntime: { pullRequest: { number: 12, state: "OPEN", isDraft: true, isMerged: false, checksStatus: "failure", reviewDecision: null } },
    }),
  );
  assert.deepEqual(info, {
    id: "w1",
    name: "Checkout redesign",
    project: "app",
    branch: "feat/x",
    status: "done",
    additions: 3,
    deletions: 1,
    activityAt: Date.parse("2026-11-11T10:00:00Z"),
    statusAt: Date.parse("2026-11-11T09:00:00Z"),
    ahead: 2,
    pr: { number: 12, state: "draft", checks: "failure", review: null },
  });
});

test("a pushed upsert replaces the workspace and its status", () => {
  const before = workspaceMap([descriptor({ status: "attention" })]);
  const after = applyWorkspaceUpdate(before, { kind: "upsert", workspace: descriptor({ status: "failed" }) });
  assert.equal(after.get("w1")?.status, "failed");
  assert.equal(before.get("w1")?.status, "attention", "updates never mutate the previous map");
});

test("a remove, or an upsert into archiving, drops the workspace", () => {
  const before = workspaceMap([descriptor(), descriptor({ id: "w2" })]);
  assert.deepEqual([...applyWorkspaceUpdate(before, { kind: "remove", id: "w1" }).keys()], ["w2"]);
  const archiving = applyWorkspaceUpdate(before, { kind: "upsert", workspace: descriptor({ id: "w2", archivingAt: "2026-11-11T10:00:00Z" }) });
  assert.deepEqual([...archiving.keys()], ["w1"]);
});
