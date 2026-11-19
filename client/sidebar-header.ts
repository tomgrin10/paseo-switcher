// Where the history arrows go in Paseo's sidebar. Page structure, not a public plugin API:
// - sidebar-global-new-workspace shares the nav group with sidebar-sessions/search.
// - 0.15/0.16: the nav group sits inside the sidebar's drag area, right after the desktop
//   window-chrome row (traffic lights, sidebar button; 36px) when there is one.
// - 0.17: the nav group scrolls inside sidebar-nav-scroll, a sibling after the drag area,
//   which holds the window-chrome row on macOS, or an 8px drag strip on plain web and
//   Windows/Linux.
// So the header is whatever sits right before the nav block (the group, or its scroll
// viewport), and it holds the arrows only when it is at least one row high.

type Element = any;

/** Shorter than this, the space above the nav rows is a drag strip, not a header row. */
export const MIN_HEADER_HEIGHT = 28;
const NAV_GROUP =
  '[data-testid="sidebar-sessions"], [data-testid="sidebar-search"]';
const NAV_SCROLL = '[data-testid="sidebar-nav-scroll"]';

export interface SidebarHeader {
  /** The window-chrome row to right-align the arrows in, or null when there is none. */
  chrome: Element | null;
  /** Without a chrome row, the spacer goes into `parent`, right before `before`. */
  parent: Element;
  before: Element;
}

export function findSidebarHeader(
  newWorkspaceRow: Element,
  spacer: Element,
): SidebarHeader | null {
  let group = newWorkspaceRow.parentElement;
  while (group && !group.querySelector(NAV_GROUP)) group = group.parentElement;
  // All other built-in rows may be hidden in Settings > Sidebar.
  group ||= newWorkspaceRow.parentElement?.parentElement?.parentElement;
  if (!group) return null;
  const block = group.closest(NAV_SCROLL) || group;
  const parent = block.parentElement;
  if (!parent) return null;
  let previous = block.previousElementSibling;
  if (previous === spacer) previous = previous.previousElementSibling;
  const chrome =
    previous && previous.getBoundingClientRect().height >= MIN_HEADER_HEIGHT
      ? previous
      : null;
  return { chrome, parent, before: block };
}
