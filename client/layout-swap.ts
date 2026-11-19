// Copied from tomgrin10/paseo-follow-up shared/layout-swap.ts (feat/search-wrong-layout).
/** Standard Israeli SI-1452 key positions, not phonetic transliteration. Other scripts use physical capture. */
const EN = "qwertyuiopasdfghjkl;'zxcvbnm,./";
const HE = "/'קראטוןםפשדגכעיחלךף,זסבהנמצתץ.";
export function swapLayout(text: string, target: "english" | "hebrew"): string {
  const from = target === "english" ? HE : EN, to = target === "english" ? EN : HE;
  return [...text].map(c => { const i = from.indexOf(c.toLowerCase()); return target === "english" && c === "׳" ? "w" : i < 0 ? c : to[i]; }).join("");
}
/** Only offer script-appropriate variants. Mixed-script text keeps the already-correct words. */
export function layoutQueries(query: string, physical?: string | null): string[] {
  const variants: string[] = [];
  if (physical && physical !== query) return [physical];
  if (/[\u0590-\u05ff]/u.test(query)) {
    variants.push(swapLayout(query, "english"));
    // Android Hebrew puts apostrophe and hyphen on Q/W; punctuation otherwise lives in its own row.
    variants.push([...query].map(c => c === "'" ? "q" : c === "-" ? "w" : swapLayout(c, "english")).join(""));
  }
  else if (/[a-z]/i.test(query)) {
    variants.push(swapLayout(query, "hebrew"));
    variants.push([...query].map(c => c.toLowerCase() === "q" ? "'" : c.toLowerCase() === "w" ? "-" : swapLayout(c, "hebrew")).join(""));
  }
  const en = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./", ru = "ёйцукенгшщзхъфывапролджэячсмитьбю.";
  const russian = /[а-яё]/i.test(query);
  if (russian || /[a-z]/i.test(query)) variants.push([...query].map(c => {
    const from = russian ? ru : en, to = russian ? en : ru;
    const i = from.indexOf(c.toLowerCase()); return i < 0 ? c : to[i];
  }).join(""));
  return [...new Set(variants)].filter(q => q !== query && q.trim());
}

export type LayoutKey = { key: string; code: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean };
const PUNCT: Record<string, string> = { Space: " ", Minus: "-_", Equal: "=+", BracketLeft: "[{", BracketRight: "]}", Backslash: "\\|", Semicolon: ";:", Quote: "'\"", Comma: ",<", Period: ".>", Slash: "/?", Backquote: "`~" };
export function usKey(e: LayoutKey): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.shiftKey ? e.code.slice(3) : e.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(e.code)) return e.shiftKey ? ")!@#$%^&*("[Number(e.code.slice(5))] : e.code.slice(5);
  const pair = PUNCT[e.code];
  return pair ? pair[e.shiftKey && pair.length > 1 ? 1 : 0] : null;
}
/** Append-only reconstruction. Anything the key event cannot explain invalidates it until the field is empty. */
export class LayoutCapture {
  private value = "";
  private rebuilt: string | null = "";
  private pending: { value: string; rebuilt: string } | null = null;
  reset() { this.rebuilt = null; this.pending = null; }
  key(e: LayoutKey, value: string, start: number | null, end: number | null) {
    this.pending = null;
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) { this.reset(); return; }
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
    if (!value) { this.value = ""; this.rebuilt = ""; }
    if (value !== this.value || start !== value.length || end !== start) { this.reset(); return; }
    if (e.key === "Backspace" && this.rebuilt !== null) {
      this.pending = { value: value.slice(0, -1), rebuilt: this.rebuilt.slice(0, -1) }; return;
    }
    if (e.key.length !== 1) { if (!["Enter", "Escape", "Tab"].includes(e.key)) this.reset(); return; }
    const key = usKey(e);
    if (!key || this.rebuilt === null) { this.reset(); return; }
    this.pending = { value: value + e.key, rebuilt: this.rebuilt + key };
  }
  change(value: string): string | null {
    this.rebuilt = !value ? "" : this.pending?.value === value ? this.pending.rebuilt : null;
    this.value = value; this.pending = null;
    return this.rebuilt && this.rebuilt !== value ? this.rebuilt : null;
  }
}
