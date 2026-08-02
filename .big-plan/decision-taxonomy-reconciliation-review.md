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

### QuickDecision

1. A brief with no discriminating criterion could still expose an empty “Compare all three” row. Fixed in the shared brief layout by omitting comparison when `discriminating.length === 0`, with a focused component test.
2. The compatibility criterion required by today's proxy compiler could be mistaken for target authoring syntax. Fixed by disclosing it immediately above the example and stating that `QuickDecision` has no criteria or comparison contract.
3. The compact flow could strand a reviewer after proposing or confirming. Verified and preserved the approved behavior: Cancel restores the prior radio choice and clears proposal text, Confirm records the answer, and Change reopens the same choice with focus returned.

## Browser evidence

- Light and dark: inspected the complete audit-only and interactive DecisionAnalysis variations, plus the QuickDecision brief and proposal states.
- DecisionAnalysis audit: tapped a dashed criterion definition in both themes; the matching one-sentence explanation opened, all option controls remained disabled, and the decided status remained intact.
- DecisionAnalysis interactive: selected “Cover the entire app,” confirmed it, and used Change to reopen it in both themes; the same radio remained selected and regained focus.
- QuickDecision: selected a radio option, opened and filled the proposal, canceled and asserted restoration, confirmed the option, and used Change to reopen it in both themes.
- QuickDecision structure: asserted three authored options, one proposal choice, and no `.decision-brief-compare` element.
- Layout: the document width equaled the 1440 px viewport in both themes; no visible element crossed either horizontal edge.
- Console: no messages in either theme.
