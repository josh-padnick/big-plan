# Using Decision well

**Purpose: ask the reviewer one question and end with their confirmed answer.**

Decision has three reading depths over one authored model. The default `matrix` separates a full-title chooser rail from a compact letter-keyed comparison; `rows` repeats the comparison under each option; `brief` leads with the recommendation and keeps comparison collapsed.

- Reach for Decision for most tradeoffs; use ComplexDecision when the call needs weighted scoring or a reversibility record, and SimpleDecisionSet for quick calls.
- Define each `Criterion` once. Name the thing being compared (`Build effort`, not `Complex`) and use its body for a one-sentence-maximum explanation of what it means.
- Give every Option one `Consideration` per Criterion, linked by the criterion title.
- Write each `verdict` as a short normalized value on one scale per criterion: `Yes / No / Possible`, `Strong / Moderate / Weak`, or `Low / Medium / High`.
- Use the Consideration body for a one-sentence-maximum explanation of why that value holds.
- The default matrix reveals criterion meanings and value reasons from their dashed underlines on hover, focus, or tap; do not repeat those explanations in option prose.
- Frame the question around desired behavior and name options by their outcome for the reader rather than their implementation.
- Keep the option count small. Three or four compare well; beyond that the reader is scanning a spreadsheet.
- Mark your recommendation. It renders as a neutral chip that never looks like a selection.
- Never announce that an open decision is open. Set `status="decided"` with a `chosen` Option once the call is made, or `status="deferred"` when it is parked.
- Every open decision provides **Propose another approach** and Cancel; do not author an escape-hatch option yourself.

Choosing between them: `Decision` asks, `ComplexDecision` records, and `SimpleDecisionSet` gathers. Decision and ComplexDecision remain separate components with different jobs while sharing the internal `ComparisonMatrix` presentation primitive.
