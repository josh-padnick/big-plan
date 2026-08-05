# Commenting round 3: working review runtime

## What is real

`big-plan review <plan.mdx>` now serves the rendered plan and its commenting
surface together on loopback. Draft comments, the active whole-plan note, and
submitted comments are stored under the plan's stable identity. **Send to
agent** writes both JSON and Markdown feedback packages and reports their exact
paths in the tray.

The Chat tab's response examples remain a product preview because a live agent
round-trip does not exist yet. The UI labels that region **Response preview**
and **Simulated**, and separates it from the real package-delivery status.

Try the current worktree with:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/bp-commenting-round3/try-state" node bin/big-plan.mjs guidance >/dev/null
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/bp-commenting-round3/try-state" node bin/big-plan.mjs review examples/sample.mdx
```

## Adversarial findings closed

1. **Reload persistence before first paint.** The server validates and embeds
   persisted drafts, submitted comments, and the active whole-plan note in the
   initial document. The browser consumes that bootstrap synchronously before
   constructing the tray; local storage is only a same-browser mirror.
2. **Reachable tray below 1280px.** The desktop tray becomes an explicit modal
   drawer with a backdrop at narrow widths. Opening and closing it captures and
   restores the document's reading position.
3. **Concrete block labels.** Tray cards show section, block label, and kind.
   Plain Markdown table rows receive stable nested identities and labels from
   their first cell rather than collapsing into one generic table target.
4. **Textarea focus-visible.** Keyboard focus has the same thin, high-contrast
   ring contract as the other controls.
5. **Ctrl+Enter validation.** Pointer save and the shortcut use one normalized,
   non-empty-body guard. Empty whitespace cannot enter the store through either
   path.
6. **Outcome-state colors.** Exact descendant selectors now bind each semantic
   state label and border to the same theme-aware token.

Regression coverage exercises all six behaviors through unit tests and the
real loopback runtime. The critical browser story observes the first-created
tray state after reload, covers draft and submitted persistence, checks
sub-1280 drawer geometry and scroll restoration, verifies concrete adjacent
table-row labels, asserts textarea keyboard focus, rejects an empty Ctrl+Enter
save, compares outcome label and border colors in both themes, and reads the
real JSON and Markdown package written by Send.

The final Chrome pass used the actual CLI runtime at 1440×1000 and 1024×900.
The narrow drawer occupied `top: 44px` through `bottom: 900px`; closing it
returned to the captured `scrollY: 3903`. Sending at `scrollY: 3850` left the
reading position at `3850` and wrote a one-comment JSON/Markdown package whose
target was `section/failure-classification/table-row-2`, label `timeout`, and
section `Failure classification`. The rebuilt script showed one active marker
for that target and hid all inactive markers.

Chrome screenshots were first verified under
`/tmp/fm-bp-commenting-round3/shots/`, then copied to the fresh worktree
evidence directory
`.agent-runs/bp-commenting-round3/shots/20260731-235103/`.

## Picky-review pass

### Rendered plan and comment gutter

1. Inactive markers briefly appeared against every block when a stale embedded
   script was served. The generated delivery script was rebuilt, and marker
   visibility is now guarded by the active target set.
2. Table-row comments initially targeted the whole table. Rows now carry
   nested stable identities and concrete first-cell labels.
3. The rebuilt commenting shell could have reintroduced the prior alignment
   inset. It does not add a content offset; the round-3 measured-edge guard
   remains the source of truth.

### Comments tray and narrow drawer

1. A fixed desktop tray was unreachable below 1280px. It now becomes a
   backdrop-backed drawer that preserves reading position.
2. “Feedback” repeated at several hierarchy levels. The toolbar and top-level
   tab now consistently use **Comments**, with no redundant tray heading.
3. Simulated agent outcomes looked indistinguishable from delivery. The real
   package status is separate, while the unconnected response surface is
   explicitly labeled as a simulation.

### Editors and outcome states

1. The textarea lost visible keyboard focus. A shared focus-visible ring now
   covers every touched control.
2. Ctrl+Enter could bypass the button's disabled state. Both inputs now call
   the same validation function.
3. Outcome selectors styled the container but missed the nested state label.
   Each state now has a matching semantic label and border in light and dark
   themes.

## Alignment root cause

The detailed structure/style comparison and measured-edge prevention is in
[`root-cause.md`](./root-cause.md). In short, the v2 simulation added a second
left inset to direct commentable blocks after extracting the real article,
while cards and bands retained the native shell column. The fix removes that
parallel layout rule and measures every declared outer/text-column row,
including the title, instead of auditing only cards and bands.
