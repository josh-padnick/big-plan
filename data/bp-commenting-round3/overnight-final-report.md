# Overnight commenting and persistence verification

Branch: `fm/bp-commenting-round3`  
Draft PR: <https://github.com/josh-padnick/big-plan/pull/54>  
Stage: fresh-state preview; no validation pipeline

## Preview and recovery

- Fresh-state review: <http://127.0.0.1:52281/>
- Plan: `/tmp/fm-bp-commenting-final-preview.Qi2hTZ/plan.mdx`
- Durable state: `/tmp/fm-bp-commenting-final-preview.Qi2hTZ/.big-plan/`
- State assertion: zero drafts, zero sent comments, and zero resolved comment IDs.
- Matching agent command:

  ```sh
  node '/Users/personal/.treehouse/big-plan-918a82/8/big-plan/bin/big-plan.mjs' agent '/tmp/fm-bp-commenting-final-preview.Qi2hTZ/plan.mdx'
  ```

To start a completely fresh review:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
preview_dir="$(mktemp -d /tmp/fm-bp-commenting-final-preview.XXXXXX)"
cp /tmp/fm-bp-commenting-final-preview.Qi2hTZ/plan.mdx "$preview_dir/plan.mdx"
node "$PWD/bin/big-plan.mjs" review "$preview_dir/plan.mdx"
```

Keep that terminal running. In a second terminal, paste the agent command printed
by the review server. For this exact running session, use the matching command
above.

## Delivered sequence

### Round 24

All eight captain items remain delivered. The detailed item table and its
browser evidence live in
[`round24-report.md`](./round24-report.md).

### Persistence hardening, phases 3–6

- Feedback commits recover deterministically at every durable checkpoint;
  retries are idempotent, requests are not duplicated, and orphan immutable
  package or revision records are harmless.
- Reviewer writes use optimistic concurrency. Stale tabs receive current state
  without losing conflicting text, and a fresh second runtime is refused while
  stale or stopped runtimes remain replaceable.
- Browser workflow ownership moved behind pure state actions without changing
  the visible queuing, reply, chat, cancellation, or resolution journeys.
- Durable ownership, recovery, conflict, and corruption procedures are
  documented in the review reference.

### Component-owned revision lenses

- Every one of the 18 registered components now owns a typed revision adapter
  with a semantic fingerprint, authored semantic text, and a server-rendered,
  inert old/new view.
- A discriminated `BlockSnapshot` dispatches the shared lens by snapshot type.
  The build fails if the component registry and adapter registry diverge.
- Model-only changes with identical visible text are included instead of being
  silently omitted. Flow diagrams and other structured components retain their
  presentation instead of flattening into prose.
- The browser matrix covers all 18 real component examples, both themes,
  narrow and wide viewports, exact registry completeness, inertness, and the
  blocking-to-activating diagram reproduction.
- Full hierarchical correspondence remains intentionally out of scope, as the
  captain directed.

## Screenshot findings and root causes

| Finding | Result | Root cause and prevention |
| --- | --- | --- |
| Opening “Comment on this slide” shifted the document | Fixed | A transient composer had inherited the persistent floating-thread reservation class. That class adds body-side space and reflows the reading column. Transient composition now uses the anchored overlay without setting `data-review-floating`; only saved floating threads reserve space. The browser test asserts identical title, article, slide, scroll, and body-padding measurements before and after opening. |
| The composer extended too far | Fixed | The floating composer now uses the bounded right-side surface and does not participate in document flow. It remains beside the slide without widening the page in both themes. |
| Sub-slide comment icons looked detached and did not work | Fixed | The selector and collapse chevron occupied nearly the same hit box, so the selector intercepted the collapse target. The selector now sits immediately left of the kicker, with a separate hit box and no overlap. |
| Highlighted sub-slide text did not offer Comment | Fixed | Nested sub-slide blocks are addressable selection owners. The real selection gesture now surfaces the affordance and opens the composer. |
| Reconnect commands had heavy code-block chrome | Fixed | Recovery commands use quiet, copyable code wells with contained wrapping in both themes. |

Measured nested geometry after the fix:

- selector: `463.59–481.98px`
- collapse toggle: `442–463.59px`
- kicker begins: `483.59px`
- overlap: `false`

The nested selector's hover, focus-visible, and active states were exercised in
both light and dark themes. The full selection, compose, cancel, save, and
collapse gestures were replayed with state assertions.

## Picky-review pass

### Composer surface

1. It could overpower the document: bounded width and quiet chrome keep it
   subordinate.
2. It could move the reading column: transient composition no longer activates
   persistent-thread reservation.
3. It could cover the selected content or escape the viewport: the existing
   anchored-placement constraints keep it beside the slide and within the
   viewport.

### Nested slide controls

1. The icon could collide with the chevron: the measured hit boxes are now
   disjoint.
2. The icon could look disconnected from `2.1` or `2.2`: it is placed directly
   before the kicker with a 1.6px visual gap.
3. The icon could work while text selection remained broken: the same browser
   journey verifies both entry paths.

### Revision views

1. Structured changes could flatten into prose: component-owned renderers keep
   semantic structure.
2. Model-only changes could disappear: semantic fingerprints own membership.
3. Old/new views could accidentally become interactive: the shared contract
   rejects behavior attributes, IDs, tab stops, and proposal controls.

## Verification

- `bun run test` — 91 files, 1,061 tests passed.
- Style-contract history — 20 tests passed.
- `bun run lint` — passed.
- `bun run build` — passed; all 18 revision adapters registered.
- `bun run test:e2e` — 91 Playwright journeys passed.
- Focused long reload/send journey — passed in 40.5 seconds.
- Nested selector hover/focus/active replay in both themes — passed.
- Chrome measurement — title, article, slide left/top, scroll position, and
  body padding remained identical when opening the composer.
- Screenshot evidence:
  [`shots/20260805-015508/`](./shots/20260805-015508/).
