---
title: Answer reviewer feedback
description: The exact command loop a coding agent runs to receive, work, and publish one answer.
---

**Goal.** Every reviewer request answered, each with a validated plan revision published under
the claim it was taken out on.

## Before you start

- A live review is running on the plan, started by the human with `big-plan review`.
- You were launched by one of the pasteable commands `big-plan agent <plan.mdx>` returns.
- Optionally, export the identity variables before your first command so the reviewer's
  **Agent Status** can name you. See
  [Configuration and state](/reference/configuration/#declared-by-a-connecting-coding-agent).

## The loop

1. **Take the next request.**

   ```sh
   npx -y big-plan@latest agent next plan.mdx --wait
   ```

   It hands back the oldest pending feedback, thread reply, or plan-wide chat question, its
   prior conversation, a validated response template, `candidate_plan` — this claim's own copy
   of the plan, and the only repository file you edit — and ready-to-run `note_command`,
   `respond_command`, and `next_command` strings.

   **Run the returned command strings unchanged.** They carry the `--agent` and `--connection`
   tokens back, which is what lets the reviewer see one agent across a whole conversation
   instead of a new one at every command.

2. **Report that you have started.** The returned `note_command` already carries the progress
   text `Working on the request`, so running it unchanged records that update and renews the
   claim:

   ```sh
   npx -y big-plan@latest agent note plan.mdx "Working on the request" --agent <token> --connection <token>
   ```

   For each later meaningful step, use a short, specific progress line. A turn can run longer
   than you report progress for, and after 75 seconds of silence the reviewer's thread reads
   **No progress for \_N_m**.

3. **Edit `candidate_plan`, never the plan path.** The plan path stays read-only identity, so
   relative asset paths and repository context still resolve against it. Big Plan writes the
   real plan only when a response publishes.

4. **Validate the candidate** until it renders and passes lint.

5. **Write your response JSON** to the returned `response_file`. A `changed` outcome is
   accepted only when the result snapshot differs and every named target belongs to the
   computed snapshot diff. The other outcomes are `answered`, `warning`, `needs-input`, and
   `declined`. A `warning` makes no edit, must carry a short scannable `summary` of the
   boundary it would cross, and waits for explicit reviewer confirmation.

6. **Publish.**

   ```sh
   npx -y big-plan@latest agent respond plan.mdx <response.json> --agent <token> --connection <token>
   ```

   It publishes under one plan-mutation lock: it re-proves the claim, requires the plan to still
   carry the revision the candidate started from, and swaps the candidate in with one atomic
   rename.

7. **Take the next request with the command `respond` returned.** It returns `next`: an
   `agent next ... --wait --agent <token>` command carrying the token you just answered under.
   Run it as given — it reclaims the same registration at once, which is what keeps you one
   agent to the reviewer across the several short-lived processes a turn takes. A bare
   `agent next` after publishing mints a new identity and attaches as an observer of the turn
   you just finished.

## Opening a thread yourself

`agent push` relays something to the reviewer without waiting to be asked, and claims a private
candidate immediately rather than queueing:

```sh
npx -y big-plan@latest agent push plan.mdx --prompt "<the reviewer's own words>" --agent <token>
npx -y big-plan@latest agent push plan.mdx --about "<your words>" --agent <token>
```

Exactly one of `--prompt` or `--about` is required, because the stored origin decides whose
words the review presents. Pass the returned thread id back with `--thread <id>` to continue a
pushed thread. A resolved or unknown thread is refused, and any live claim or other
non-terminal push on the plan must be answered or canceled first.

## Keep the connector in the foreground

The connector runs in the foreground, hands its work item back on stdout, and ends when the
process that started it ends. Backgrounding or detaching it breaks that handoff. A waiting
`agent next` also ends when the process that started it does, rather than claiming work whose
output nothing would read.

## Verify

- `agent respond` returns without an error code, and returns a `next` command.
- The reviewer's thread moves from **Working** to showing your answer and its change set.

## If it goes wrong

| Code or result            | What it means                                                                    | What to do                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SOURCE_MOVED`            | The plan changed underneath your candidate                                       | Take the work again from the current plan with `agent next`                                    |
| `NOT_PRIMARY`             | The reviewer made another agent the primary                                      | Stop claiming; see [Handle a handoff or disconnect](/for-agents/handoff/)                      |
| `AGENT_DISCONNECTED`      | The reviewer disconnected you                                                    | Terminal; end the session                                                                      |
| `role: "observer"`        | Another agent answers this review                                                | Not an error. Without `--wait` it is final; with `--wait` keep asking                          |
| No work available         | Another claim is live                                                            | Pass `--wait`                                                                                  |
| Your claim was taken back | You reported nothing for far longer than a turn takes and no agent was connected | Pick up current work with `agent next`; a returning `respond` is refused rather than published |

## Next

[Handle a handoff or disconnect](/for-agents/handoff/) — what to do when the reviewer moves the
primary seat.
