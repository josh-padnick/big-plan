---
title: Start a review
description: Serve one plan on your machine and get the address worth saving.
---

**Goal.** A live review of your plan, running on your own machine, at an address you can save
and reopen.

## Before you start

- Node.js 22 or newer. Check with `node --version`.
- A plan file that passes `npx -y big-plan@latest validate <plan.mdx>`.
  Review applies the same linting rules before it opens a port, so a plan that fails lint
  never reaches a reviewer.
- `npx -y big-plan@latest guidance` read in this working directory within the last 24 hours.
  Until it has been, `review` fails with `GUIDANCE_REQUIRED`.

## Steps

1. Start the review from a directory that can reach the plan path.

   ```sh
   npx -y big-plan@latest review plans/checkout-retry.mdx
   ```

2. Read the two addresses it prints.

   ```text
   review: "http://127.0.0.1:8790/plan/61ba8e0b1849b290"
   direct: "http://127.0.0.1:58348/"
   plan: /Users/you/repo/plans/checkout-retry.mdx
   session: 64d304d8d900fa04
   feedback: /Users/you/repo/.big-plan/feedback
   custody: activated
   ```

   `review` is the address to open and to save. `direct` is the session's own ephemeral port
   and is reported as a debugging line only.

3. Open the `review` address in your browser and leave the command running.
   Stop the runtime with `Ctrl+C` when you are finished.

4. Save the address the command printed rather than one you assemble from the default port.

The printed address is derived from the plan file's path, so it is the same for
every review of that plan and keeps answering through runtime restarts. Save or
share the address the command printed rather than one assembled from the default
port: `BIG_PLAN_PORT` moves the service, and every link with it. The command also
prints the session's ephemeral address as a debugging line.

The service keeps the review on that stable address by default.
`BIG_PLAN_PROXY=0` restores the redirect to the session port. The switch is read
once when the service starts, so changing it requires
`big-plan service restart`, or `big-plan service stop` before the next command,
to take effect. Each review still runs on its own unique session port so its
process, custody, and write fences remain isolated; the service only supplies
the hop.

If a runtime stops answering without recording an ending, opening the stable
address shows that the review is restarting. API requests receive `503` with
`Retry-After`, which lets an open page record runtime unavailability without a
network failure. A live runtime's bare `503` remains its own refusal while a
write is stalled.

Opening it while a review is running serves that session without changing the
address. A deliberate stop gives a page saying why it ended. An unexpected stop
holds the address for the replacement runtime and includes the command that
starts the review again there.

The address is answered by a small local process described in
[`big-plan service`](/reference/commands/service/); `big-plan service status`
reports on it and `big-plan service stop` stops it. When it cannot run, the
command explains why and falls back to the direct session address.

Only one review runtime holds custody of a plan at a time.
The one holding it is the only session that can save comments, and the only one a coding agent can answer through.

Running `big-plan review` on a plan a live runtime is already serving therefore takes nothing away.
It starts no second runtime, reports `custody: held`, and prints that runtime's address so you can open it.
The live session, its open page, and its connected agent keep working.
A runtime counts as live while its session heartbeat is current, which is the same liveness the coding agent relies on; a session that has stopped, expired, or crashed leaves the plan free and the next `big-plan review` takes custody normally.
Two `big-plan review` commands started at the same instant resolve the same way: exactly one takes custody, and the other prints that one's address.

Pass `--takeover` to replace a live session deliberately, for example when its terminal is gone but the process is still running:

```sh
npx -y big-plan@latest review plans/checkout-retry.mdx --takeover
```

The replaced runtime keeps listening but loses write custody.
Its open page and its connected agent become read-only until each reloads, so prefer opening the printed address over taking custody.
The command reports `custody: seized` together with the session it displaced.

## Verify

- The command printed `custody: activated`, meaning this runtime took a free plan and is now
  serving it.
- The page opens with the plan's title in the branding bar, alongside **Approve plan**,
  **Feedback**, and **Agent Status**.
- The command is still running in your terminal. By default the review stays up until you
  stop it; set `--idle-timeout <minutes>` to close an abandoned session instead.

## If it goes wrong

| What you see                           | What it means                                                     | What to do                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custody: held`                        | A live runtime already serves this plan, so no second one started | Open the address it printed; that session, its page, and its agent keep working                                                                      |
| `custody: seized`                      | `--takeover` replaced a live runtime                              | Expected only when you passed `--takeover`; the replaced page and its agent go read-only until each reloads                                          |
| `GUIDANCE_REQUIRED`                    | Guidance has not been read in this directory in the last 24 hours | Run `npx -y big-plan@latest guidance`, then start the review again                                                                                   |
| `Plan failed authoring lint`           | Lint runs before the port opens                                   | Fix each `line:column [rule-id] message` entry, then start the review again                                                                          |
| The default port is already held       | Something else holds `8790`                                       | The command says so, names the holder where the platform can report one, and keeps working with the session's direct address; or set `BIG_PLAN_PORT` |
| The page says the review is restarting | A runtime stopped without recording an ending                     | The address is held for the replacement runtime, and the page carries the command that starts the review again                                       |

More failure modes, including a session that stops accepting changes, are in
[When a review goes wrong](/review/troubleshooting/).

## Next

[Comment on a plan](/review/comment-on-a-plan/) — attach a note to a slide, a component, or a
piece of selected text.
