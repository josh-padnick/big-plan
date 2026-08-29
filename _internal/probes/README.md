# Behavioral probes

A probe is not a test. A test asserts what Big Plan's code does; a probe measures
what a coding agent _decides_ when it reads what Big Plan wrote. Prompt text has
no other failure detector: it compiles, it ships, and the only symptom of a
badly framed instruction is an agent that quietly does the wrong thing in
someone's live review.

Probes live here rather than in `test/` because they call real agent harnesses,
cost real tokens, and answer a distribution rather than a boolean. Nothing in CI
runs them. Run one when you change text an agent acts on, and record its numbers
in the pull request.

Read [../../AGENTS.md](../../AGENTS.md) first; the gold-standard plan-quality
workflow it owns is the sibling procedure for judging authored plans, and this
directory is the same idea pointed at the prompts Big Plan hands to agents.

## The push-mode probe

`push-mode-probe.mjs` measures one behavior: when an operator asks a connected
coding agent to change the plan, does the agent reach for `agent push`
unprompted?

It exists because it once did not. In a live connector session a coding agent
told its operator that a change "needs to come from the UI" and that it could
not submit one, when `agent push` was available to it the whole time.

Method:

1. Capture the real connector prompt. `capture-connector-prompt.mjs` starts a
   live review over a throwaway plan and runs the real `big-plan agent <plan>`
   command, so the probe measures the shipped text rather than a copy of it.
   It produces three arms: `after` is the working tree's prompt; `before`
   reconstructs the prompt as it stood before the change under test, by reading
   the committed prompt block from `git` and restoring its former position; and
   `control` removes the push guidance entirely.
   The control arm is what makes the other two readable. A probe on which every
   arm passes has not shown that the prompt works, only that the question was
   easy, so one arm has to describe a prompt that never taught the mode - and
   the probe has to catch it.
2. Put distance between the prompt and the question. Each arm appends a short
   account of a session already in progress, ending with the agent blocked on
   `agent next --wait` - the situation the original failure happened in. A probe
   that asks its question one line under the prompt measures reading, not
   recall.
3. Deliver a plain operator instruction that names no mechanism, and ask only
   what the agent does next. Naming `push` in the question would measure
   instruction-following instead of whether the prompt taught the mode. Two
   wordings are asked, because the failure had two halves: `direct` is an
   ordinary instruction, and `doubted` adds the operator wondering aloud whether
   the change has to come from the UI - the wording the original wrong answer
   came back to.
4. Ask every harness the same thing under both arms, several trials each, and
   score each reply: `push` when it names the push command, `deferred` when it
   defers to the reviewer or the UI, `other` otherwise.

```sh
node _internal/probes/push-mode-probe.mjs --trials 3 --transcripts <dir>
node _internal/probes/push-mode-probe.mjs --trials 5 --harness claude --arm after
node _internal/probes/push-mode-probe.mjs --arm control --question doubted
```

The summary is a count per arm, question, and harness, not a pass or fail. Read
it as a distribution: the change is good when `deferred` and `other` go to zero
on the `after` arm across every harness and both wordings, and stay there - and
it is only evidence at all when the `control` arm shows some of them.

`--baseline` only works while the prior prompt is still what `HEAD` carries, so
run the before arm before committing the change under test, or point the probe
at the pre-change commit.
