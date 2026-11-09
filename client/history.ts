/** Session-local chronological history; deliberately independent of Ctrl+Tab's MRU list. */
export interface Visit {
  route: string;
  workspaceKey: string | null;
  tabId: string | null;
  paneId: string | null;
}

export type HistoryShortcut = "alt-arrows" | "ctrl-minus" | "cmd-brackets" | "none";

export function parseShortcut(value: unknown, mac: boolean): HistoryShortcut {
  return value === "alt-arrows" ||
    value === "ctrl-minus" ||
    value === "cmd-brackets" ||
    value === "none"
    ? value
    : mac
      ? "ctrl-minus"
      : "alt-arrows";
}

/** Redirects are waypoints, not places the user visited. Workspace open/pop hints are one-shot. */
export function historyRoute(pathname: string, search = "", hash = ""): string | null {
  if (pathname === "/" || /^\/h\/[^/]+\/?$/.test(pathname) || /^\/h\/[^/]+\/agent\//.test(pathname))
    return null;
  if (!/^\/h\/[^/]+\/workspace\//.test(pathname)) return pathname + search + hash;
  const params = search
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => part && !/^(open|pop)=/.test(part));
  return pathname.replace(/\/$/, "") + (params.length ? `?${params.join("&")}` : "") + hash;
}

export function sameVisit(a: Visit | undefined, b: Visit): boolean {
  return !!a && a.route === b.route && a.tabId === b.tabId && a.paneId === b.paneId;
}

export class VisitHistory {
  readonly entries: Visit[] = [];
  cursor = -1;

  record(visit: Visit): boolean {
    const current = this.entries[this.cursor];
    if (sameVisit(current, visit)) return false;
    if (current?.tabId && current.route === visit.route && !visit.tabId) return false;
    // Loading a workspace before its tab rail mounts must not create a second visit.
    if (current?.workspaceKey && current.route === visit.route && !current.tabId) {
      this.entries[this.cursor] = visit;
      return true;
    }
    this.entries.splice(this.cursor + 1);
    this.entries.push(visit);
    if (this.entries.length > 200) this.entries.shift();
    this.cursor = this.entries.length - 1;
    return true;
  }

  find(direction: -1 | 1, available: (visit: Visit) => boolean): number {
    const current = this.entries[this.cursor];
    for (let i = this.cursor + direction; i >= 0 && i < this.entries.length; i += direction) {
      const entry = this.entries[i];
      if (!sameVisit(current, entry) && available(entry)) return i;
    }
    return -1;
  }
}
