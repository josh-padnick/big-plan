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

1. Vertically stacking weights and totals hid the score result below the fold. Fixed by placing impact controls and composite scores in two desktop columns while retaining a single-column narrow layout.
2. A percentage alone could make the weighting feel opaque. Fixed by printing every multiplication, numerator, denominator, and normalized percentage for each option.
3. Custom weight controls could regress the already-approved focus treatment. Fixed by using native range inputs with one idiomatic focus halo and an always-visible exact `n / 5` output.

### QuickDecision

1. A single brief concealed the repetition cost of real plan use. Fixed by rendering three complete calls consecutively so recommendation framing, proposal, confirmation, and Change are visible at batch scale.
2. A brief with no discriminating criterion could still expose an empty “Compare all three” row. Fixed in the shared brief layout by omitting comparison when `discriminating.length === 0`, and asserted the omission independently for all three calls.
3. Repeated calls could accidentally share answer state. Verified each call independently: selection and confirmation affected only its own brief, and Change reopened the same choice with focus returned.

## Browser evidence

- Light and dark: inspected all four DecisionAnalysis variations and all three consecutive QuickDecision briefs.
- DecisionAnalysis audit: tapped a dashed criterion definition in both themes; the matching one-sentence explanation opened, all option controls remained disabled, and the decided status remained intact.
- DecisionAnalysis interactive: selected “Cover the entire app,” confirmed it, and used Change to reopen it in both themes; the same radio remained selected and regained focus.
- Seven-criterion analysis: selected an option, confirmed it, and used Change in both themes; all seven criteria remained present and the same option regained focus.
- Weighted analysis: changed Build simplicity with a real click and arrow-key gesture in both themes, asserted all three formulas and normalized scores changed, then selected, confirmed, and changed an answer.
- QuickDecision: completed an independent select–confirm–Change cycle on each of the three briefs in both themes.
- QuickDecision structure: asserted three authored options, one proposal choice, and no `.decision-brief-compare` element on every call.
- Layout: the document width equaled the 1440 px viewport in both themes; no visible element crossed either horizontal edge.
- Console: no messages in either theme.
