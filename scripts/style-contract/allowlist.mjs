// The style contract's explicit inventories. Every entry below is a standing
// exception or a recorded quantity of authored CSS, so each one is a line a
// reviewer must approve rather than a judgement the check has to infer.
//
// These live apart from check.mjs because they change for a different reason:
// check.mjs changes when the contract changes, and this file changes when the
// product's CSS surface changes.

/**
 * The only stylesheets `src/render/` may hold. The renderer owns document-wide
 * compilation, so a stylesheet here must serve the whole document; presentation
 * belonging to one slice lives in that slice.
 */
export const RENDER_STYLESHEETS = new Set([
  "src/render/fonts.generated.css",
  "src/render/global.css",
  "src/render/markdown/deck.css",
  "src/render/markdown/prose.css",
  "src/render/markdown/syntax-highlighting.css",
]);

/**
 * Components whose whole purpose is a hand-authored visual language, where a
 * class-per-part stylesheet is the design rather than a shortcut around
 * utilities. Adding a name here is a deliberate, reviewable claim that the
 * component draws something utilities cannot describe.
 */
export const DRAWING_SYSTEM_STYLESHEETS = new Set([
  "src/components/flow-diagram/styles.css",
  "src/components/mermaid-diagram/styles.css",
  "src/components/wireframe/styles.css",
]);

/**
 * Recorded size of each stylesheet that exceeds the budget a new stylesheet
 * gets for free, plus any class-only-selector debt still awaiting removal.
 *
 * `declarations` is a ceiling: a file may shrink freely, but growing past its
 * recorded number fails, so volume can only be bought deliberately.
 * `classOnlyRules` is exact: it counts rules that style markup their own view
 * renders, which the contract forbids outright, so the number exists only to
 * hold a known debt still and must fall to zero and then disappear.
 */
export const STYLESHEET_BUDGETS = {
  "src/components/_shared/decision-card/decision-card.css": {
    // Bought for the answer composer: its two modes and their controls, the
    // Clear answer exit from the change flow, the narrow-viewport touch floor
    // those controls keep, and the three notices the review island reveals - a
    // superseded answer, a read-only review, and an in-force approval.
    // The changed-Decision Confirm gate adds its hazard-marked explanation,
    // keyboard focus treatment, and narrow-viewport width at point of use.
    declarations: 429,
  },
  "src/components/_shared/figure-controls/figure-controls.css": {
    declarations: 58,
  },
  "src/components/code-diff/styles.css": { declarations: 44 },
  "src/components/data-table/styles.css": {
    // Bought so the last visible data row yields its lower edge to the
    // summary row's stronger divider, including an empty filtered result.
    declarations: 82,
  },
  "src/components/database-table-schema/styles.css": { declarations: 47 },
  "src/components/flow-diagram/styles.css": { declarations: 467 },
  "src/components/mermaid-diagram/styles.css": { declarations: 208 },
  "src/components/wireframe/styles.css": {
    // Raised for the icon vocabulary, the overlay, and row grouping: a glyph
    // sized on the artboard's own type ramp in three steps, the placeholder a
    // meaning outside the named set draws, icon-carrying and icon-only
    // controls with their touch floor, a surface drawn over the page with its
    // dim or clear backdrop and its alert variant, and the run of elements
    // that hugs its contents so a toolbar can anchor two ends. Raised again
    // to give a phone's push header its three equal slots - one of them drawn
    // for a bar that carries nothing trailing - so a back control leads while
    // the title stays centred in the bar rather than in what the controls left
    // over, and to keep the quiet link stroke off a control drawn as one mark.
    // Paid back down by dropping the bar's own trailing-edge margins, which
    // the trailing slot's utility already carries from a later layer. Raised
    // once more for the disclosure mark a list row draws when it names the
    // screen it pushes to: the mark itself, and the metadata step of the icon
    // ramp it is drawn at so it never competes with the value beside it.
    declarations: 1082,
  },
  "src/render/global.css": {
    // Bought for the toolbar band: its own ground, the lift a control on it,
    // and the general edges its controls take. BIG-214 adds dedicated subtle
    // Agent Status and Feedback edge roles plus two light chrome-neutral steps
    // per palette. Dark mode reuses the general edge instead of adding shades.
    // The shared tooltip adds four semantic theme tokens and their four utility
    // aliases so dialog-owned tooltips can use one light-and-dark treatment.
    // Approve adds three role tokens and one success-scale edge to each palette.
    declarations: 561,
  },
  "src/render/markdown/deck.css": { declarations: 48 },
  "src/render/markdown/prose.css": { declarations: 122 },
  "src/render/markdown/syntax-highlighting.css": { declarations: 71 },
  "src/review/browser/review.css": { declarations: 520 },
};
