import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_MAX, CARD_MIN, PEEK, stripFit } from "../client/strip.ts";
import { trimPreviews, type StoredPreview } from "../client/previews.ts";

/** The strip's visible width: the sheet's max width minus the panel's padding (see .pws-sheet, .pws-panel). */
const visible = (width: number) => width - 96 - 20;
/** Card outer width (8px padding each side) plus the 6px gap. */
const slot = (cardW: number) => cardW + 16 + 6;

test("cards that fit are shown whole, without overflow", () => {
  const fit = stripFit(1440, 5);
  assert.equal(fit.overflowing, false);
  assert.ok(fit.cardW >= CARD_MIN && fit.cardW <= CARD_MAX);
  assert.ok(5 * slot(fit.cardW) - 6 <= visible(1440));
});

for (const [width, count] of [[1440, 9], [900, 9], [1200, 7], [1024, 6], [700, 4]] as const) {
  test(`an overflowing strip shows whole cards plus a deliberate peek (${width}px, ${count} cards)`, () => {
    const fit = stripFit(width, count);
    assert.equal(fit.overflowing, true);
    assert.ok(fit.cardW >= CARD_MIN && fit.cardW <= CARD_MAX, `card width ${fit.cardW}`);
    // The part of the next card that shows: never a sliver cut mid-word, never hidden entirely.
    const shown = (visible(width) + 6) % slot(fit.cardW);
    assert.ok(shown >= PEEK - 1 && shown < PEEK + slot(fit.cardW) / 3, `peek ${shown}px`);
  });
}

test("previews keep the newest entries within the count and size caps", () => {
  const p = (key: string, at: number, size: number): StoredPreview => ({ key, at, svg: "x".repeat(size), dark: false, width: 1, height: 1 });
  const all = [p("a", 1, 10), p("b", 2, 10), p("c", 3, 10), p("d", 4, 10)];
  assert.deepEqual(trimPreviews(all, 3, 1000).map((e) => e.key), ["b", "c", "d"]);
  assert.deepEqual(trimPreviews(all, 9, 25).map((e) => e.key), ["c", "d"]);
  assert.deepEqual(trimPreviews([p("huge", 5, 99)], 9, 25), [], "one preview over the byte cap is dropped");
});
