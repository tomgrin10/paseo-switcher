// Pure ordering logic, kept free of DOM and React so it is easy to test.

export interface WorkspaceInfo {
  id: string;
  name: string;
  project: string;
  branch: string | null;
  status: "needs_input" | "failed" | "running" | "attention" | "done";
  additions: number;
  deletions: number;
  activityAt: number;
  /** When the workspace entered its current status, for "Running · 4m". */
  statusAt?: number;
  pr?: PullRequestInfo | null;
  /** Commits not yet pushed to origin. */
  ahead?: number;
}

export interface PullRequestInfo {
  number: number | null;
  state: "open" | "draft" | "merged" | "closed";
  checks: "none" | "pending" | "success" | "failure";
  review: "approved" | "changes_requested" | "pending" | null;
}

export type Layout = "strip" | "list";
export const DEFAULT_LAYOUT: Layout = "list";

export function parseLayout(value: unknown): Layout {
  return value === "strip" ? "strip" : DEFAULT_LAYOUT;
}

/** What a status reads as. `attention` is Paseo's "finished, not looked at yet". */
export const STATUS_LABEL: Record<Exclude<WorkspaceInfo["status"], "done">, string> = {
  running: "Running",
  needs_input: "Needs input",
  attention: "Finished",
  failed: "Failed",
};

/** Compact age: "now", "4m", "3h", "2d". */
export function ago(at: number | undefined, now: number): string | null {
  if (!at) return null;
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export interface Card {
  /** `${serverId}:${workspaceId}`, the same key Paseo uses in sidebar test IDs. */
  key: string;
  serverId: string;
  workspaceId: string;
  info: WorkspaceInfo | null;
}

export const MIN_LIMIT = 2;
/** One card per number key. */
export const MAX_LIMIT = 9;
export const DEFAULT_LIMIT = 5;
const MAX_MRU = 40;

export function clampLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(n)));
}

export function workspaceKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

export function splitKey(key: string): { serverId: string; workspaceId: string } {
  const at = key.lastIndexOf(":");
  return { serverId: key.slice(0, at), workspaceId: key.slice(at + 1) };
}

/** Moves `key` to the front of the most-recently-used list. */
export function touch(mru: readonly string[], key: string): string[] {
  if (mru[0] === key) return mru as string[];
  return [key, ...mru.filter((k) => k !== key)].slice(0, MAX_MRU);
}

/**
 * The `limit` most recently visited workspaces. Visited workspaces that no longer exist are
 * dropped once the workspace list has loaded. Until enough have been visited, the rest of the
 * selected host's workspaces fill in by latest activity.
 */
export function buildCards(
  mru: readonly string[],
  serverId: string | null,
  workspaces: ReadonlyMap<string, WorkspaceInfo> | null,
  limit: number,
): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const key of mru) {
    if (cards.length >= limit) return cards;
    const parts = splitKey(key);
    const sameHost = parts.serverId === serverId;
    const info = sameHost ? workspaces?.get(parts.workspaceId) ?? null : null;
    if (workspaces && sameHost && !info) continue;
    cards.push({ key, ...parts, info });
    seen.add(key);
  }
  if (serverId && workspaces && cards.length < limit) {
    const rest = [...workspaces.values()]
      .filter((w) => !seen.has(workspaceKey(serverId, w.id)))
      .sort((a, b) => b.activityAt - a.activityAt);
    for (const info of rest) {
      if (cards.length >= limit) break;
      cards.push({ key: workspaceKey(serverId, info.id), serverId, workspaceId: info.id, info });
    }
  }
  return cards;
}

/** Arc starts on the previous tab, so a single Ctrl+Tab flips back. */
export function initialIndex(cards: readonly Card[], currentKey: string | null): number {
  if (cards.length < 2) return 0;
  return cards[0]?.key === currentKey ? 1 : 0;
}

export function wrap(index: number, length: number): number {
  return length === 0 ? 0 : ((index % length) + length) % length;
}

/**
 * The quick-tap target: the most recent workspace that is not the current one. Computed from the
 * MRU list alone so the tap path needs no workspace data, DOM reads, or rendering.
 */
export function previousKey(mru: readonly string[], currentKey: string | null): string | null {
  for (const key of mru) if (key !== currentKey) return key;
  return null;
}

// ---- type to filter ---------------------------------------------------------------------------

/** Lowercased words of a query; empty when there is nothing to filter by. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(info: WorkspaceInfo): string {
  const pr = info.pr?.number ? ` #${info.pr.number} ${info.pr.number}` : "";
  return `${info.name} ${info.project} ${info.branch ?? ""}${pr}`.toLowerCase();
}

function startsWord(text: string, at: number): boolean {
  return at === 0 || /[^a-z0-9]/i.test(text[at - 1]);
}

/**
 * Every workspace whose name, project, branch or pull request number contains all the query's
 * words. Names that match at the start of a word come first; ties keep recency (visit order, then
 * latest activity), so the workspace you were just in stays near the top.
 */
export function filterCards(
  query: string,
  mru: readonly string[],
  serverId: string | null,
  workspaces: ReadonlyMap<string, WorkspaceInfo> | null,
  max = MAX_LIMIT,
): Card[] {
  const words = queryWords(query);
  if (!words.length || !serverId || !workspaces) return [];
  const recent = new Map(mru.map((key, i) => [key, i]));
  const scored: Array<{ card: Card; rank: number; recency: number; activity: number }> = [];
  for (const info of workspaces.values()) {
    const text = haystack(info);
    if (!words.every((w) => text.includes(w))) continue;
    const name = info.name.toLowerCase();
    const named = words.every((w) => {
      for (let at = name.indexOf(w); at !== -1; at = name.indexOf(w, at + 1)) if (startsWord(name, at)) return true;
      return false;
    });
    const key = workspaceKey(serverId, info.id);
    scored.push({ card: { key, serverId, workspaceId: info.id, info }, rank: named ? 0 : 1, recency: recent.get(key) ?? Infinity, activity: info.activityAt });
  }
  scored.sort((a, b) => a.rank - b.rank || a.recency - b.recency || b.activity - a.activity);
  return scored.slice(0, max).map((s) => s.card);
}

/** [start, end) ranges of `text` that match the query's words, merged and sorted, for highlighting. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const w of queryWords(query)) {
    for (let at = lower.indexOf(w); at !== -1; at = lower.indexOf(w, at + w.length)) ranges.push([at, at + w.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

// ---- workspace data ---------------------------------------------------------------------------

type Bucket = WorkspaceInfo["status"];
const BUCKETS: ReadonlySet<string> = new Set<Bucket>(["needs_input", "failed", "running", "attention", "done"]);

/** The fields of Paseo's workspace descriptor (`paseo.workspaces.list`) the switcher reads. */
export interface WorkspaceDescriptor {
  id: string;
  name: string;
  projectDisplayName: string;
  /** The daemon's aggregated bucket across the workspace's agents and terminals. */
  status: Bucket;
  /**
   * Paseo's sidebar indicator, when a source provides it (0.16 client state). It is `status`
   * except that a "done" workspace reads "running" while a create is pending in that client.
   */
  indicator?: Bucket | null;
  archivingAt?: string | null;
  background?: boolean | null;
  activityAt?: string | null;
  lastUserMessageAt?: string | null;
  statusEnteredAt?: string | null;
  createdAt?: string | null;
  diffStat?: { additions: number; deletions: number } | null;
  gitRuntime?: { currentBranch?: string | null; aheadOfOrigin?: number | null } | null;
  githubRuntime?: {
    pullRequest?: {
      number?: number | null;
      state: string;
      isDraft?: boolean | null;
      isMerged?: boolean | null;
      checksStatus?: PullRequestInfo["checks"] | null;
      reviewDecision?: PullRequestInfo["review"] | null;
    } | null;
  } | null;
}

export type WorkspaceUpdate =
  | { kind: "upsert"; workspace: WorkspaceDescriptor }
  | { kind: "remove"; id: string };

/** The latest of several ISO times, in ms; 0 when none is set. */
export function latest(...times: Array<string | null | undefined>): number {
  let best = 0;
  for (const time of times) {
    const at = time ? Date.parse(time) : 0;
    if (at > best) best = at;
  }
  return best;
}

/**
 * One workspace as the switcher shows it, or null when it can't be switched to. The status is the
 * host's own bucket, never derived here, so the switcher and Paseo's sidebar can't disagree.
 */
export function toWorkspaceInfo(w: WorkspaceDescriptor): WorkspaceInfo | null {
  if (w.archivingAt || w.background) return null;
  const pr = w.githubRuntime?.pullRequest;
  const bucket = w.indicator ?? w.status;
  return {
    id: w.id,
    name: w.name,
    project: w.projectDisplayName,
    branch: w.gitRuntime?.currentBranch ?? null,
    status: BUCKETS.has(bucket) ? bucket : "done",
    additions: w.diffStat?.additions ?? 0,
    deletions: w.diffStat?.deletions ?? 0,
    // The sidebar's own time; idle workspaces may have none, so fall back to the latest one known.
    activityAt: latest(w.activityAt) || latest(w.lastUserMessageAt, w.statusEnteredAt, w.createdAt),
    statusAt: latest(w.statusEnteredAt),
    ahead: w.gitRuntime?.aheadOfOrigin ?? 0,
    pr: pr
      ? {
          number: pr.number ?? null,
          state: pr.isMerged ? "merged" : pr.isDraft ? "draft" : pr.state.toLowerCase() === "open" ? "open" : "closed",
          checks: pr.checksStatus ?? "none",
          review: pr.reviewDecision ?? null,
        }
      : null,
  };
}

export function workspaceMap(entries: readonly WorkspaceDescriptor[]): Map<string, WorkspaceInfo> {
  const map = new Map<string, WorkspaceInfo>();
  for (const w of entries) {
    const info = toWorkspaceInfo(w);
    if (info) map.set(info.id, info);
  }
  return map;
}

/** A pushed workspace update applied to a copy of the map. */
export function applyWorkspaceUpdate(map: ReadonlyMap<string, WorkspaceInfo>, update: WorkspaceUpdate): Map<string, WorkspaceInfo> {
  const next = new Map(map);
  const id = update.kind === "upsert" ? update.workspace.id : update.id;
  const info = update.kind === "upsert" ? toWorkspaceInfo(update.workspace) : null;
  if (info) next.set(id, info);
  else next.delete(id);
  return next;
}
