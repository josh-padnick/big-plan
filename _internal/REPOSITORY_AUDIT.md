<!-- Records the scope, findings, and follow-ups of the 2026-09-08 organization audit; this is a review artifact, not contributor policy. -->

# Repository organization audit

The main source of complexity is concentrated review orchestration, not the top-level folder structure.
This cleanup separates cohesive responsibilities and removes duplicated knowledge while preserving product behavior.
The baseline is `888001eb` on `main`.

## Findings and changes

| Finding                                                                                                            | Change                                                                                   | Reason                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `store.ts` mixed filesystem custody, agent attachment policy, progress caching, and diagnostics.                   | Extract `agent-presence.ts`, `progress-log.ts`, `store-files.ts`, and `store-growth.ts`. | Each concept has a discoverable owner, and persistence primitives no longer own agent lifecycle policy. |
| The review controller hid comment-target construction and selection highlighting inside application orchestration. | Extract `browser/comment-target.browser.ts`.                                             | Target construction has one cohesive home while identity lookup stays with `live-target.browser.ts`.    |
| Thread-deletion evidence was embedded in the controller.                                                           | Extract `browser/plan-loss-evidence.browser.tsx`.                                        | The evidence presentation can be maintained without navigating controller state.                        |
| Clipboard platform behavior interrupted the dialog primitives in `ui.browser.tsx`.                                 | Extract `browser/use-copy-to-clipboard.browser.ts`.                                      | Clipboard behavior and visual primitives have distinct responsibilities.                                |
| Two shell files independently serialized the same Lucide catalog to SVG strings.                                   | Keep `lucide-icon-html.ts` and remove `lucide-icon-markup.ts`.                           | One serializer owns this representation; React and HAST retain their separate adapters.                 |
| The agent guide repeated detailed contracts already documented by their source owners.                             | Replace repeated explanations with explicit, conditional links to those owners.          | Contributors can find the relevant invariant without maintaining competing accounts.                    |
| The renderer map repeated the root compilation overview; engineering practices repeated the test ladder.           | Link to the owning guide and testing document.                                           | Keep local maps focused on placement and keep test selection in one place.                              |
| Prettier listed runtime-state exclusions twice.                                                                    | Remove duplicate entries.                                                                | Preserve the same matching behavior with less configuration.                                            |

The applied work spans Session Reliability, Commenting Surface, Element-Level Commenting, and Renderer Fidelity.
Contributor-documentation cleanup also reduces the context loaded for work across all seven subsystems.

## Resulting ownership

```text
src/review/
  store.ts                         review paths, custody, locks, review records
  store-files.ts                   atomic file publication and JSON reads
  agent-presence.ts                attachment, heartbeat, disconnect, primacy
  progress-log.ts                  progress validation, cache, sequence, compaction
  store-growth.ts                  retained-state diagnostics
  browser/
    review-controller.browser.tsx  interaction orchestration
    comment-target.browser.ts      comment targets, labels, selections, highlights
    plan-loss-evidence.browser.tsx  deletion evidence presentation
    use-copy-to-clipboard.browser.ts
    ui.browser.tsx                 visual primitives
```

The store no longer imports agent attachment policy or progress-log implementation.
Agent presence uses the store's existing lock interface and the extracted file primitives.
Progress reads keep one cache, and diagnostics read through that same cache.
There are no compatibility re-exports, parallel implementations, or changes to persisted record formats.
Existing consumers import the new owners directly.

The store shrank from 3,867 lines to approximately 1,900.
The review controller shrank from 9,864 lines to approximately 9,100.
These are ownership improvements, not equivalent reductions in total implementation size.
Most moved logic remains necessary.

## Architecture examined and retained

The top-level dependency direction remains CLI to review and rendering, then component compilation and framework-free vocabulary.
The existing ESLint layer model remains the architectural guard.

Component folders already group compilation, presentation, examples, and contracts by author-facing concept.
Moving them into generic compiler, model, and view folders would weaken co-location.
The renderer's small public entry points also serve an enforced dependency seam; their size alone does not justify deletion.

The audit traced agent work through the CLI, work loop, mailbox, attachment checks, persistence, and browser status projection.
That trace exposed agent attachment policy inside the general store.
It also traced comment selection through target construction, live identity resolution, highlighting, and the composer.
Those responsibilities now have named owners without changing the target contract.

Generated fonts, branding, styles, and the browser bundle account for apparent repository bulk.
They remain committed because the repository explicitly requires inspectable generated sources.
Removing them or changing packaging would be a separate distribution decision.

## Validation issues found on the baseline

- **Abandoned-claim browser test:** the thread-expansion helper checked for a button before asynchronous thread loading finished.
  The baseline full suite passed 269 of 270 journeys; the failed journey timed out with the comment collapsed.
  Waiting for the thread before checking its expand button fixed 20 parallel repetitions in an isolated baseline checkout.
  Product recovery behavior did not change.
- **Local lint scope:** ESLint traversed nested Claude worktrees and a vendored Copia runtime.
  Exclude those non-source directories, as the formatter already does.
  An executable ESLint contract test checks the exclusions while keeping the working repository's source in scope.
- **Concurrent verdict repair:** several reads could repair the same interrupted rejection, or overlap a reviewer write, and lose the source-digest check.
  Four concurrent route requests reproduced three 500 responses before the fix.
  Run the read-and-repair operation through the existing write gate, keeping the GET contract and source-digest guard unchanged.
- **Docs server ownership:** the browser suite reused port 4321 and opened an unrelated FM Linear site.
  Allocate a port per run, pass it to workers, and require the suite to start its own server.
  Four parallel install-prompt journeys passed while the unrelated site kept running.

## Contained follow-ups

1. **Controller state ownership.**
   `ReviewController` still coordinates thousands of lines of interdependent state, effects, polling, recovery, and write reconciliation.
   The next extraction should own a complete lifecycle, including cancellation and recovery, rather than expose a collection of setters.
   Protect it with the existing concurrent-tab, recovery, and pending-write browser journeys.
2. **Store custody and record families.**
   `store.ts` still contains image custody, path anchoring, lock generations, and several record families.
   Further extraction should preserve the single anchored-path construction and lock-generation rules.
   A folder move alone would not simplify those contracts.
3. **Review-stack dependency granularity.**
   ESLint enforces browser, shared, renderer, and server layers, but the server review layer permits relationships across several product subsystems.
   A stricter partition needs an import-graph audit of mailbox, mutation, and change-set ownership before adding restrictions.
4. **Remaining long explanatory comments.**
   Several comments combine invariants with incident history.
   Shorten them only where the invariant and its regression evidence remain discoverable at the owning interface.
   Blanket deletion would remove information needed to preserve concurrency behavior.

These follow-ups are deliberately contained instead of introducing new state models or storage contracts in a behavior-preserving cleanup.
