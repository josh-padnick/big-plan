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
    // those controls keep, and the two notices the review island reveals - a
    // superseded answer and a read-only review.
    declarations: 394,
  },
  "src/components/_shared/figure-controls/figure-controls.css": {
    declarations: 58,
  },
  "src/components/code-diff/styles.css": { declarations: 44 },
  "src/components/data-table/styles.css": { declarations: 81 },
  "src/components/database-table-schema/styles.css": { declarations: 47 },
  "src/components/flow-diagram/styles.css": { declarations: 467 },
  "src/components/mermaid-diagram/styles.css": { declarations: 208 },
  "src/components/wireframe/styles.css": { declarations: 1012 },
  "src/render/global.css": {
    // Bought for the toolbar band: its own ground, the lift a control on it,
    // and the general edges its controls take. BIG-214 adds dedicated subtle
    // Agent Status and Feedback edge roles plus two light chrome-neutral steps
    // per palette. Dark mode reuses the general edge instead of adding shades.
    // The shared tooltip adds four semantic theme tokens and their four utility
    // aliases so dialog-owned tooltips can use one light-and-dark treatment.
    declarations: 551,
  },
  "src/render/markdown/deck.css": { declarations: 48 },
  "src/render/markdown/prose.css": { declarations: 122 },
  "src/render/markdown/syntax-highlighting.css": { declarations: 71 },
  "src/review/browser/review.css": { declarations: 520 },
};
