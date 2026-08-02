# Decision taxonomy reconciliation review

This note records the stage-1 review of the new reconciliation artifact. The approved Decision plan and its final preview were not edited.

## Picky-review findings fixed before presentation

### Recommendation and strawman

1. Presentation names could still read as the recommendation. Fixed by leading with the three reader jobs and explicitly rejecting `DecisionMatrix` and `DecisionBrief` as public roots.
2. The round-2 conflict could be buried. Fixed by naming the direct weighted chooser as the capability this recommendation gives up and describing the discriminated universal component as the honest alternative.
3. Four-column comparison and contract tables required horizontal scrolling. Fixed by keeping one compact three-column mapping and converting longer judgments and prop contracts to wrapping lists.

### Decision

1. The approved rows could imply a globally aligned matrix. Fixed by making considerations optional and option-local, with no global criteria, completeness, tone, or alignment contract.
2. That compromise with the taxonomy report could look accidental. Fixed by stating that the report proposed deleting considerations and explaining why the approved row treatment justifies the narrower form.
3. The live example could be mistaken for target syntax. Fixed by labeling today's `layout="rows"` renderer as a visual proxy and listing the target props separately.

### DecisionAnalysis

1. `useComplexMode` could appear to be a harmless styling shortcut. Fixed by listing the grammar, lifecycle, and interaction differences it would hide.
2. The approved matrix could still be read as a direct chooser. Fixed by defining the target as an audit surface with no confirm or proposal flow and calling out the disabled current renderer as a proxy.
3. Criterion and value explanations could look ornamental. Fixed by making their one-sentence meanings and reasons part of the public contract and verifying both definition gestures separately.

### QuickDecisionSet

1. One brief per slide could sound equivalent without corpus evidence. Fixed by citing the six sets and 25 questions, plus the navigation and chrome multiplication.
2. Keeping the set could preserve heavy questions by inertia. Fixed by requiring compact strings and explicitly promoting the twelve observed heavier questions.
3. The current `SimpleDecisionSet` example could imply that the old name and inert markers are the target. Fixed by labeling it an implementation-free proxy and specifying one future batch confirmation boundary.

## Browser evidence

- Light and dark: recommendation, `Decision`, `DecisionAnalysis`, and `QuickDecisionSet`.
- `Decision`: selected an option; opened, focused, and filled the proposal; canceled and confirmed restoration; confirmed an answer; reopened it with Change.
- `DecisionAnalysis`: tapped a criterion and a value independently and asserted the matching one-sentence explanation opened.
- Navigation: used document links to reach each example and asserted the target hash and expected rendered model.
- Layout: all authored tables and the document fit the desktop viewport without horizontal overflow.
- Console: no messages.
