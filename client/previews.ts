/**
 * Thumbnails survive a reload. A rasterized canvas cannot be read back (the SVG taints it), so the
 * SVG source is kept instead, in this origin's IndexedDB, and redrawn in idle time after a reload.
 * Capped by count and size; every call is best effort and never throws.
 */

export interface StoredPreview {
  key: string;
  svg: string;
  dark: boolean;
  width: number;
  height: number;
  /** When it was taken, ms. */
  at: number;
}

export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

/** What trimming needs to know about a stored preview: no SVG text. */
export interface PreviewMeta {
  key: string;
  at: number;
  bytes: number;
}

/** The newest previews that fit both caps, oldest first. */
export function trimPreviews<T extends PreviewMeta>(all: T[], max: number, maxBytes: number): T[] {
  const kept: T[] = [];
  let bytes = 0;
  for (const entry of [...all].sort((a, b) => b.at - a.at)) {
    if (kept.length >= max) break;
    if (bytes + entry.bytes > maxBytes) continue;
    bytes += entry.bytes;
    kept.push(entry);
  }
  return kept.reverse();
}

const DB = "paseo-switcher";
const STORE = "previews";

export interface PreviewStore {
  load(): Promise<StoredPreview[]>;
  save(entries: StoredPreview[], max: number): Promise<void>;
}

export function previewStore(g: any): PreviewStore {
  let db: Promise<any> | null = null;
  /**
   * What is stored, without the SVG text: saving trims from this index, so a save writes only the
   * changed entries and never reads megabytes of stored SVG back on the main thread.
   */
  let index: Map<string, PreviewMeta> | null = null;
  const open = (): Promise<any> => {
    db ??= new Promise((resolve) => {
      try {
        const request = g.indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return db;
  };
  const done = (tx: any) =>
    new Promise<void>((resolve) => {
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  const meta = (e: StoredPreview): PreviewMeta => ({ key: e.key, at: e.at, bytes: e.svg.length });
  async function load(): Promise<StoredPreview[]> {
    const d = await open();
    if (!d) return [];
    try {
      const request = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
      const all = await new Promise<StoredPreview[]>((resolve) => {
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => resolve([]);
      });
      index = new Map(all.map((e) => [e.key, meta(e)]));
      return all;
    } catch {
      return [];
    }
  }
  return {
    load,
    async save(entries, max) {
      const d = await open();
      if (!d) return;
      try {
        if (!index) await load();
        const merged = new Map(index);
        for (const e of entries) merged.set(e.key, meta(e));
        const keep = trimPreviews([...merged.values()], max, MAX_PREVIEW_BYTES);
        const keys = new Set(keep.map((e) => e.key));
        const tx = d.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const key of merged.keys()) if (!keys.has(key)) store.delete(key);
        for (const e of entries) if (keys.has(e.key)) store.put(e);
        await done(tx);
        index = new Map([...merged].filter(([key]) => keys.has(key)));
      } catch {
        // Storage full or unavailable: thumbnails just start empty after the next reload.
      }
    },
  };
}
