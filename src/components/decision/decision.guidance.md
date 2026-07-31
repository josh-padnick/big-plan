# Using Decision well

**Purpose: ask the reviewer one question and end with their confirmed answer.**

The default decision card: one question, options as columns, criteria as rows, and one rationale panel beneath that explains whichever option the reader is looking at. Comparison comes first, explanation second.

- Reach for it for most tradeoffs; escalate to ComplexDecision only when the call needs weighted scoring or a reversibility record, and drop to SimpleDecisionSet for quick calls.
- Give every option the same `Consideration` titles in the same order. That is what makes a matrix possible at all, and Big Plan rejects a Decision whose options compare different things.
- Name each criterion as **the thing being compared**, not as a verdict: `Build effort`, not `Complexity`; `Context preserved`, not `Loses context`. Read the row labels together - they should sound like one consistent set of questions.
- Write each `verdict` as a normalized value on one scale per row: `Yes / No / Possible`, `Strong / Moderate / Weak`, `Low / Medium / High`. A row whose values are not on one scale cannot be compared at a glance.
- Frame the question around the behavior you want, not the mechanism that delivers it. Ask "What should a maximized figure cover?", not a question that tests knowledge of overlay internals.
- Name options by their outcome for the reader - "Keep feedback tray visible" - rather than by their implementation.
- Put the reasoning in the `Consideration` body. It lands in the rationale panel under the matrix, so it costs the scanning reader nothing and is there for the reader who wants it.
- Keep the option count to what a matrix can carry. Three or four columns compare well; beyond that the reader is scanning a spreadsheet.
- Mark your recommendation. It renders as a neutral chip that never looks like a selection, and it is what the rationale panel explains before the reader chooses.
- Never announce that an open decision is open - being asked is what makes it open. Set `status="decided"` with a `chosen` Option once the call is made, or `status="deferred"` when it is parked.
- Every open decision offers a "Propose another approach" link for free; do not author an escape-hatch option yourself.
- A reviewer's confirmed answer is held in the rendered document and announced on it. Delivering answers back to the agent arrives with review commenting, so ask for the answer in conversation until then.

Choosing between them: `Decision` asks, `ComplexDecision` records, `SimpleDecisionSet` gathers. Decision and ComplexDecision present the same shape - options across, criteria down - on purpose, so a reader who learns one can read the other.
