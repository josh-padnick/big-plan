# Ship the payments retry queue

A durable retry queue replaces inline payment-capture retries, demonstrated here as a deck of `Part` acts with a `TableOfContents` overview.

<QuickSummary>

<Why>

- For checkout to stay fast and reliable, failed captures must retry without blocking requests or losing state on deploys.

</Why>

<What>

- Build a persistent retry queue with explicit state and an operator-visible audit trail.

</What>

<How>

- Move capture retries out of the API server and into a queue worker.
- Record every attempt in the audit trail.

</How>

</QuickSummary>

<TableOfContents>
<Entry section="Status quo" gist="Inline retries couple checkout latency to processor health" />
<Entry section="Success looks like" gist="A restart never loses a scheduled retry" />
<Entry section="The retry queue" gist="A queue worker with explicit state and bounded backoff" />
<Entry section="Sequencing" gist="Schema first, worker second, operator controls last" />
<Entry section="Acceptance criteria" gist="The checkable contract for done" />
</TableOfContents>

<Part title="Context" />

<Slide type="status-quo" />

## Inline retries delay checkout

- Inline retries couple checkout latency to processor health.
- Retry state lives in process memory, so every deploy loses it.
- Operators cannot see, pause, or force a retry.

## Success looks like

- A failed capture is retried on schedule even across API-server restarts.
- Operators watch every attempt in one audit trail.

<Part title="The proposal" />

## The retry queue

A queue worker owns retries end to end.

### The worker

*What the queue worker does on every attempt.*

- Claims due schedules with explicit state per attempt.
- Applies bounded backoff, so a stuck capture never retries forever.

### The audit trail

*Where every attempt becomes visible to operators.*

- Every state change lands in the audit trail as it happens.
- Operators pause, force, or cancel from the same view.

<Part title="Shipping & your review" />

## Sequencing

*We need to agree on the landing order before the schema ships.*

- Land the schema migration first, behind no user-facing change.
- Ship the queue worker second, shadowing inline retries.
- Cut over and add operator controls last.

<Slide type="acceptance-criteria" />

## Restarts preserve scheduled retries

- A failed capture is retried on schedule after an API-server restart.
- Operators can pause, force, and cancel retries per merchant.
