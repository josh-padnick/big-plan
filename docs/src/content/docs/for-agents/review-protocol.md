---
title: Answer a live review request
description: Connect an agent and submit a valid response without reading Big Plan source.
---

Run the `agent connect` command shown by the review. Keep it in the foreground:
it waits for work and returns a connection summary and the next request together.
Identity environment variables are optional; skip any you do not know.

For a request, edit only the returned `candidate_plan` and `response_file`.
Copy the returned `response_template` into `response_file`, replace its placeholder
values, then run the returned `respond_command` exactly once.

Thread outcomes are `answered`, `changed`, `warning`, `needs-input`, or `declined`.
Use `changed` only when you made a real revision to `candidate_plan`; it requires
`changeTargets` naming every rendered block actually changed, in presentation
order. A block id begins with a lowercase letter or digit, contains only lowercase
letters, digits, `/`, `_`, `.`, or `-`, and is at most 300 characters. Other
outcomes do not carry `changeTargets`. A warning also requires an 80-character
`summary` naming the boundary it would cross.

If submission is rejected, follow the error's requested correction and run the
same returned `respond_command` again. After success, run the returned `next`
command in the foreground to wait for another request.
