/** Thumbnail strip sizing. Pure, so the fit is unit tested (test/strip.test.ts). */

export const CARD_MAX = 240;
export const CARD_MIN = 176;
/** How much of the next card shows when the strip overflows: enough to read as "more this way". */
export const PEEK = 56;
/** The sheet's side margins (`max-width: calc(100vw - 96px)`) plus the panel's 10px padding. */
const CHROME = 96 + 20;
/** A card's 8px side padding plus the 6px gap after it. */
const SLOT_EXTRA = 16 + 6;
const GAP = 6;

export interface StripFit {
  cardW: number;
  overflowing: boolean;
}

/**
 * Every card at a readable size when they fit. When they don't, whole cards plus a fixed peek of
 * the next one, so the edge never cuts a card mid-word and a narrow window still shows there is more.
 */
export function stripFit(windowWidth: number, count: number): StripFit {
  const room = windowWidth - CHROME + GAP;
  const n = Math.max(count, 1);
  const all = Math.floor(room / n) - SLOT_EXTRA;
  if (all >= CARD_MIN) return { cardW: Math.min(CARD_MAX, all), overflowing: false };
  const whole = Math.max(1, Math.floor((room - PEEK) / (CARD_MIN + SLOT_EXTRA)));
  const cardW = Math.max(CARD_MIN, Math.min(CARD_MAX, Math.floor((room - PEEK) / whole) - SLOT_EXTRA));
  return { cardW, overflowing: true };
}
