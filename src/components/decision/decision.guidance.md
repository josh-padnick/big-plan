# Using Decision well

The default decision card: one question, a stack of option cards a reviewer picks between, and the same short comparison attributes on every option.

- Reach for it for most tradeoffs; escalate to ComplexDecision only when options need weighted side-by-side scoring, and drop to SimpleDecisionSet for quick calls.
- Give every option the same `Consideration` titles in the same order - that is what makes the verdicts line up into columns a reviewer can scan down. Big Plan rejects a Decision whose options compare different things.
- Write each `verdict` as a normalized value, not a sentence: `Yes`, `No`, `Strong`, `Moderate`, `Low`. Keep the set for one consideration on one scale so the column reads as a comparison.
- Put the reasoning in the `Consideration` body. It collapses behind **View details**, so it costs the scanning reader nothing and is there for the reader who wants it.
- Mark your recommendation. It renders as a neutral chip that never looks like a selection, so the reviewer can choose against it without confusion.
- Never announce that an open decision is open - being asked is what makes it open. Set `status="decided"` with a `chosen` Option once the call is made, or `status="deferred"` when it is parked.
- Every open decision also offers "Propose another approach" for free; do not author an escape-hatch option yourself.
- A reviewer's confirmed answer is held in the rendered document and announced on it. Delivering answers back to the agent arrives with review commenting, so ask for the answer in conversation until then.
