# Behavioral probes

A probe is not a test. A test asserts what Big Plan's code does; a probe measures
what a coding agent _decides_ when it reads what Big Plan wrote. Prompt text has
no other failure detector: it compiles, it ships, and the only symptom of a
badly framed instruction is an agent that quietly does the wrong thing in
someone's live review.

Probes live here rather than in `test/` because they call real agent harnesses,
cost real tokens, and answer a distribution rather than a boolean. Nothing in CI
runs them. Run one when you change text an agent acts on, preserve its numbers in
a focused evidence file here, and link that record from the pull request.

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
   It produces two default arms: `after` is the working tree's prompt, and
   `control` removes the push guidance entirely. The earlier prompt scored
   identically to `after` and carried no evidential weight, while making the
   default probe depend on a pre-feature revision after merge. Control versus
   after is what makes the numbers readable: the probe has to catch the arm
   that never taught the mode.
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
   require its reply to end with this exact shape:

   ```text
   NEXT_COMMAND: <the exact command you would run next, or NONE>
   ```

   Score only the last such line: `push` when it names the push command,
   `other` for `NONE` or another command, and `harness_error` when the reply
   omits the field. Parsing free English proved unreliable across three review
   rounds; the final line is a deterministic contract the harness can be asked
   to honor.

```sh
node _internal/probes/push-mode-probe.mjs --trials 3 --transcripts <dir>
node _internal/probes/push-mode-probe.mjs --arm control,before,after --baseline-rev <pre-change-rev> --trials 3 --transcripts <dir>
node _internal/probes/push-mode-probe.mjs --trials 5 --harness claude --arm after
node _internal/probes/push-mode-probe.mjs --arm control --question doubted
```

One recorded run of this probe, for the connector prompt change that introduced it, is kept in [big-258-push-mode-evidence.md](big-258-push-mode-evidence.md).

The summary is a count per arm, question, and harness, not a pass or fail. Read
it as a distribution: the change is good when `other` and `harness_error` go to
zero on the `after` arm across every harness and both wordings, and stay there -
and it is only evidence at all when the `control` arm stays non-push.

Record the command, revision, per-arm totals, harnesses, wordings, and trial
count in the evidence file. End that evidence with one plain status line so the
result remains scannable, for example:

```text
Push-mode probe: after 18/18 push; control 0/18 push (Claude, Codex, Grok; direct + doubted; 3 trials each).
```

For ad-hoc baseline work, `capture-connector-prompt.mjs --baseline
--baseline-rev <rev>` reconstructs an earlier prompt. It refuses revisions that
already contain the new two-mode prompt.
