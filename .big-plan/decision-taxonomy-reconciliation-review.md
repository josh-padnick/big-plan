# Decision taxonomy reconciliation review

This note records the stage-1 review of the captain-verdict revision. The approved Decision plan and its final preview were not edited.

## Picky-review findings fixed before presentation

### Reconciliation narrative

1. The earlier recommendation still centered `QuickDecisionSet`. Fixed by making `QuickDecision` one public per-call component and updating the recommendation, verdict, contracts, boundaries, and migration together.
2. The remaining DecisionAnalysis choice could read like a presentation preference. Fixed by holding the matrix evidence constant and naming the actual choice: audit a decided recommendation, or select and confirm one in place.
3. The enabled analysis could quietly violate round 2. Fixed by stating that it deliberately reopens the ask-versus-record boundary and recommending audit-only as the taxonomy- and round-2-aligned default.

### DecisionAnalysis variations

1. Initial evidence captures clipped the variation labels and made the two states harder to compare. Fixed by retaking both themes with the full variation heading, state, matrix, and interaction visible.
2. Disabled radio circles in the audit proxy could look like unavailable controls. Fixed in the plan by specifying outcome markers for the target and labeling today's disabled `Decision` matrix as a visual proxy rather than the target contract.
3. The two variations could appear to change scoring as well as interaction. Fixed by using identical criteria, values, reasons, option order, and definitions in both; the comparison underneath names only the answer-behavior tradeoff.

### Seven-criterion DecisionAnalysis

1. Seven criteria could push the decision action out of a normal desktop view. Fixed by keeping the keyed option rail compact; the full matrix, rationale, proposal, and confirmation remain visible together at 1440 × 1100.
2. Repeated definitions could turn the matrix into a wall of prose. Fixed by preserving one-line dashed definition affordances and one-sentence reveal text instead of expanding explanations inline.
3. The selected option could become hard to track down a long matrix. Fixed by carrying its quiet green column tint from the keyed rail through all seven criterion rows.

### Weighted DecisionAnalysis

1. A separate weight panel forced the reader to cross-reference criteria, while five ordinary tab stops per row would make the replacement tedious by keyboard. Fixed by matching ComplexDecision's criterion-local priority squares directly below every criterion name and giving each group one roving tab stop.
2. Totals below the matrix felt like a detached calculator. Fixed by ending the matrix itself with a live Total score row aligned under option keys A, B, and C.
3. Always-visible arithmetic overwhelmed the comparison. Fixed by moving each exact formula, numerator, and denominator behind one “Show score calculation” disclosure immediately below the totals.

### QuickDecision

1. A single brief concealed the repetition cost of real plan use. Fixed by rendering three complete calls consecutively so recommendation framing, proposal, confirmation, and Change are visible at batch scale.
2. A brief with no discriminating criterion could still expose an empty “Compare all three” row. Fixed in the shared brief layout by omitting comparison when `discriminating.length === 0`, and asserted the omission independently for all three calls.
3. Repeated calls could accidentally share answer state. Verified each call independently: selection and confirmation affected only its own brief, and Change reopened the same choice with focus returned.

## Browser evidence

- Light and dark: inspected all four DecisionAnalysis variations and all three consecutive QuickDecision briefs.
- DecisionAnalysis audit: tapped a dashed criterion definition in both themes; the matching one-sentence explanation opened, all option controls remained disabled, and the decided status remained intact.
- DecisionAnalysis interactive: selected “Cover the entire app,” confirmed it, and used Change to reopen it in both themes; the same radio remained selected and regained focus.
- Seven-criterion analysis: selected an option, confirmed it, and used Change in both themes; all seven criteria remained present and the same option regained focus.
- Weighted analysis: changed a criterion-local impact with a real square click and arrow-key gesture in both themes, asserted all three matrix-foot totals changed, opened the score-calculation disclosure, and verified the formulas matched those totals.
- QuickDecision: completed an independent select–confirm–Change cycle on each of the three briefs in both themes.
- QuickDecision structure: asserted three authored options, one proposal choice, and no `.decision-brief-compare` element on every call.
- Layout: the document width equaled the 1440 px viewport in both themes; no visible element crossed either horizontal edge.
- Console: no messages in either theme.
