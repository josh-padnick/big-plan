# BIG-139 corrected PR narrative

This is the accurate record of what the caption re-land actually ships, to carry into the pull request description.
It supersedes the earlier narrative, which described a workspace-viewport feature that was later dropped in full.

## What this change delivers

- A below-frame `<figure>`/`<figcaption>` caption on every wireframe screen, including a lone screen, which previously printed no name at all.
- The caption and card pinned to the width the frame paints at, placed in the shared `src/components/wireframe/wireframe-fit.ts` rather than in the viewer script, so the Was/Now review diff lens gets the same behavior.
- Caption typography expressed with design-system tokens (`text-sm`, `text-xs`, `mt-1`, `mt-3`) instead of PR #90's arbitrary `leading-[1.45]`, which the repository's design-system check would now reject.
- Removal of the screen figure's `aria-label`, so the `<figcaption>` supplies the figure's accessible name instead of being suppressed by a label that repeated the screen name.
- A `.toString()` self-containment fix in `wireframe-fit.ts`, with a colocated test that re-evaluates the stringified source and drives a maximized fit.
- Browser coverage for the caption contract at desktop and phone widths, plus a caption-to-frame alignment assertion in the existing maximized left-screen-rail journey.

## Feature-by-feature judgment of PR #90's lost pieces

| Lost piece                                                 | Verdict                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Below-frame `<figure>`/`<figcaption>`, every screen named  | Re-landed. This is the authorised item.                                                                            |
| Caption typography (14px name over 12px muted metadata)    | Re-landed through design-system tokens.                                                                            |
| Caption and card pinned to the frame's painted width       | Re-landed, and moved into `wireframe-fit.ts` so the diff lens gets it too.                                         |
| Vertical-scrollbar treatment (no scrollbar when maximized) | Already on main from PR #133. Verified, not re-implemented. The only missing part was the caption width pin above. |
| Workspace-`Row` viewport detection and its CSS             | Evaluated, initially taken as a judgment call, then dropped in full by supervisor decision.                        |
| `model.ts` device-preset note                              | Not part of this change. PR #156 restored it on main and the rebase resolved that file to main's version.          |
| PR #90's guidance sentence                                 | Not needed. PR #133 already corrected it. Only the caption fact was added.                                         |
| PR #90's mermaid poll hardening                            | Not needed. Already on main.                                                                                       |

## The dropped workspace-Row viewport piece

The workspace-`Row` viewport detection and its CSS were initially taken as an explicit judgment call and flagged for review.
They were then dropped in full on the supervisor's decision, because the brief authorized a pure caption re-land and the captain separately decided workspace-row detection stays dropped.

The delivered change therefore keeps main's `AppShell`-only workspace test, emits no `data-wireframe-workspace` attribute on the artboard, and leaves `examples/wireframe-patterns.mdx` rendering exactly as it does on main.
Nothing in `docs/src/content/docs/components/wireframe.mdx` needed a rule change as a result.

## Tailwind best-practices pass

The captain accepted a Tailwind best-practices check as part of code validation, after approving the rendered look.
What it actually delivers:

- The frame card's box (block, shrink-to-fit, centred) moved from the stylesheet to utilities on the markup.
- `min-w-0` dropped from three block children of a block parent.
- `tracking-normal` and `text-ink` dropped from the caption, all measured to only restate an inherited value.
- The `.wireframe-header` margin tweak dropped, as spacing above the frame that no caption beneath it needs.

Two claims from the earlier narrative are no longer true and belonged to the dropped workspace piece: replacing `:has()` selector lists with a `data-wireframe-workspace` attribute, and deliberately keeping `contain: size` on the rail.
Both are gone.

Still true and still relevant: `src/components/wireframe/styles.css` is a declared drawing system in the style-contract allowlist, so class-only rules are permitted there, and that exemption was deliberately not relied on for the caption, which is review chrome about the drawing rather than part of it.
`scripts/style-contract/allowlist.mjs` is byte-identical to main, so this change buys no CSS budget at all.

## Docs

`docs/src/content/docs/components/wireframe.mdx` was never reverted by the bad merge and has been documenting a below-frame figcaption that main did not implement.
This change makes those existing docs true, so no docs edit was needed or wanted.

## Known pre-existing issues left out of scope

Two load-sensitive flakes in `src/review/`, both pre-existing and unrelated to this change:

- `progress-log.test.ts` "should not reparse the whole history to append one event", 500 sequential filesystem appends against the default 5000ms vitest timeout.
- `commenting.spec.ts:805` "should preserve a text selection while its compact composer is open".

They pass locally on this branch and on the main baseline, and were reported rather than repaired inside a caption PR.

## Verification note

The Playwright suite requires the built CLI at `dist/cli/main.js`, so run `bun run build` before `bunx playwright test`.
Cite the counts the pipeline's own test step reports; do not carry forward counts from the earlier narrative, which described a larger change.
