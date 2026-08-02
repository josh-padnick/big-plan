# Final picky-review pass

## Keyed matrix surface

1. **The exploration could still leak into the product API.** Removed `matrix-wide`, `matrix-transposed`, and `matrix-keyed`; `matrix` now means the keyed chooser rail.
2. **A selected rail item could depend on the viewer script for its tint.** Added the native `:has(.decision-radio:checked)` state so selection remains visible without script.
3. **The review document repeated section numbers in its headings.** Removed authored `2.1`, `3.1`, and `4.1` prefixes and let Big Plan own numbering once.

## Definition affordances

1. **An icon-only hint would add a second vocabulary.** Attached one consistent dashed underline to the criterion or value text itself.
2. **Hover could mask a broken tap path.** Fixed the shared disclosure behavior so activation pins the popover after the native Details toggle, tapping another term transfers it, tapping outside dismisses it, and Escape closes it.
3. **A sentence could become a mini-document or run beyond the viewport.** The compiler now requires exactly one prose paragraph and at most one sentence; the shared edge-aware popover is capped and was checked at desktop and touch widths in both themes.

## Plan and authoring contract

1. **The plan could still imply three component types.** It now names `rows`, `matrix`, and `brief` as layouts of one `Decision`.
2. **Decision could be conflated with ComplexDecision.** The plan explicitly preserves two components with different jobs and names their shared internal `ComparisonMatrix` primitive.
3. **Definitions could look like preview-only copy.** `Criterion` meanings and `Consideration` value reasons are now required compiled data, documented in the component guidance, public docs, example, and tests.
