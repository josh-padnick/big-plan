# BIG-258 push-mode probe evidence

Recorded verification for the connector prompt change that leads with the two
modes. Method, arms, and how to read a result are owned by [README.md](README.md);
this file records one run of it.

Command:

```sh
node _internal/probes/push-mode-probe.mjs --trials 3 --transcripts <dir>
```

Revision: `df17ac89821e1dd8477b7dcce9fa575d94e0bc21`.

Harnesses: `claude`, `codex`, `grok`. Arms: `control` (push guidance stripped
out) and `after` (the prompt this change ships). Wordings: `direct`, and
`doubted`, which adds "Or does a change like that have to come from the review
UI?". 2 arms x 2 wordings x 3 harnesses x 3 trials = 36 runs, scored on each
reply's structured final `NEXT_COMMAND:` line.

| arm     | wording | claude   | codex    | grok     |
| ------- | ------- | -------- | -------- | -------- |
| control | direct  | 0/3 push | 0/3 push | 0/3 push |
| control | doubted | 0/3 push | 0/3 push | 0/3 push |
| after   | direct  | 3/3 push | 3/3 push | 3/3 push |
| after   | doubted | 3/3 push | 3/3 push | 3/3 push |

No harness errors in any cell.

Under the shipped prompt every harness reaches for `agent push` unprompted, on
both wordings: 18 of 18. Every `after` run answered with a concrete
`... agent push <plan> --about ...` command.

The control arm is what makes those numbers mean something. With the push
guidance removed, every harness answered `NEXT_COMMAND: NONE` - 0 of 18 - and
the prose around that line reproduced the reported failure directly:

- Claude: "an instruction coming from you (the operator) rather than from the
  reviewer doesn't create a work item I can answer... the reviewer needs to
  raise it as a comment or chat request"
- Grok: "A two-phase rollout change has to come from the review UI as a
  reviewer request"

That is the answer this change exists to prevent, produced on demand by
deleting the guidance the change promotes.

## What this run does and does not establish

It establishes that the shipped prompt produces the intended decision across
three independent harnesses and two wordings, and that the probe detects the
failure when the guidance is absent.

It does not measure prominence on its own. An earlier run of this probe scored
the prior prompt - which carried the same guidance further down - at 18 of 18 as
well. A single-shot probe cannot recreate the length of the live session the
original failure happened in, so the ordering of the prompt is a judgment this
evidence supports rather than proves. The `before` arm was dropped from the
committed default for that reason and because it stopped working once this
change merged; `--baseline-rev` remains for ad-hoc comparison.

```text
Push-mode probe: after 18/18 push; control 0/18 push (Claude, Codex, Grok; direct + doubted; 3 trials each).
```
