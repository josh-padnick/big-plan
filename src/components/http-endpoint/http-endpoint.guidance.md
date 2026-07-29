# Using HttpEndpoint well

One HTTP endpoint's contract: parameters, request body, and status-coded responses.

- Reach for it when a plan adds or changes an endpoint; the reviewer approves the contract, not a paraphrase of it.
- Cover the failure statuses, not just the happy path; error shapes are where API reviews earn their keep.
- One component per endpoint, and only the endpoints this plan touches.
