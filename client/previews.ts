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

/** The newest previews that fit both caps, oldest first. */
export function trimPreviews(all: StoredPreview[], max: number, maxBytes: number): StoredPreview[] {
  const kept: StoredPreview[] = [];
  let bytes = 0;
  for (const entry of [...all].sort((a, b) => b.at - a.at)) {
    if (kept.length >= max) break;
    if (bytes + entry.svg.length > maxBytes) continue;
    bytes += entry.svg.length;
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
  return {
    async load() {
      const d = await open();
      if (!d) return [];
      try {
        const request = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
        return await new Promise<StoredPreview[]>((resolve) => {
          request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
          request.onerror = () => resolve([]);
        });
      } catch {
        return [];
      }
    },
    async save(entries, max) {
      const d = await open();
      if (!d) return;
      try {
        const existing = await this.load();
        const merged = new Map(existing.map((e) => [e.key, e]));
        for (const e of entries) merged.set(e.key, e);
        const keep = trimPreviews([...merged.values()], max, MAX_PREVIEW_BYTES);
        const keys = new Set(keep.map((e) => e.key));
        const tx = d.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const key of merged.keys()) if (!keys.has(key)) store.delete(key);
        for (const e of entries) if (keys.has(e.key)) store.put(e);
        await done(tx);
      } catch {
        // Storage full or unavailable: thumbnails just start empty after the next reload.
      }
    },
  };
}
