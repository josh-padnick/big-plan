# Commenting UX round 3 — Stage 1 report

Base: `origin/fm/bp-commenting-build@b866ec2d95b292203a556f6e22e078f37548915e`

Preview: [plan-review-v3.html](plan-review-v3.html)

## Alignment

Chrome ran at the declared 1440×1000 viewport. The title and first section
card both measured `469.109px` from the viewport left edge, for a `0px` delta.
An overlay using separate title and card guide lines confirms the edges
coincide. The expanded live audit reports every document frame on the outer
edge and every in-card text element on the `34px` text inset, with no
violations.

The generated-structure/style comparison and regression cause are recorded in
[root-cause.md](root-cause.md).

## Round-3 corrections

1. Restored the product shell's native top-level alignment and expanded the
   guard to cover title, subtitle, quick summary, and overview.
2. Removed the redundant tray header; Comments and Chat are now the top row.
   Renamed the toolbar entry point to **Comments**.
3. Made each tray comment location a control that scrolls its plan anchor into
   view.
4. Selecting a pending comment from its tray card or existing-comment marker
   opens its editor. Existing comments now use a distinct 16px circular
   conversation glyph; the leave-comment affordance keeps the square glyph.
5. Replaced the selection pill's translucent hover wash with an opaque,
   theme-derived fill. Added the Chrome interaction-state verification rule
   to `CONTRIBUTING.md`.
6. Disabled scroll anchoring inside the fixed tray and removed document
   following while the simulated agent works.
7. Moved the inline editor into a real document-flow slot immediately after
   its anchor, so it pushes later content instead of covering it.
8. Removed the reply's nested left border; the changed card keeps the single
   outcome border and the reply nests through spacing and typography.

## Real-gesture assertions

- **Tray toggle:** click changed `aria-pressed` to `true`; the first visible
  tray row contained Comments and Chat, and no tray header existed.
- **Tabs:** clicking Chat changed `aria-selected` to `true` and rendered the
  chat conversation surface; clicking Comments restored the anchored list.
- **Block comment:** a pointer hover over the Local architecture heading
  revealed the margin control; clicking it created an inline dialog whose
  overlap count against plan blocks was `0`.
- **Selection comment:** the real selection remained present while the pill
  was hovered. Its computed hover background was opaque in both themes.
  Clicking opened a quoted inline editor with `0` overlapping plan blocks.
- **Existing marker:** clicking the circular marker opened exactly one
  pending-comment editor in the tray.
- **Tray comment:** after navigating away, clicking the comment scrolled Local
  architecture back into view (`63.57px` from exact viewport center after
  sticky-header allowance) and opened its editor. Saving replaced the body
  with the edited text.
- **Submit:** from a settled top-of-document position, Send changed the agent
  badge from Waiting to active work while `scrollY` remained `0` immediately
  after click and through completion, in light and dark themes. No plan block
  received an active-work focus attribute.
- **Reply nesting:** the changed card retained a `2px` left border and its
  nested agent turn computed to `0px`.

Hover, keyboard-focus, and activated-result screenshots cover the toolbar,
tabs, leave-comment marker, existing-comment marker, selection pill, inline
Add to feedback action, tray comment, and Send action in both themes. All 59
captures were first written and verified under
`/tmp/fm-bp-commenting-round3/shots/`, then copied and byte-verified in
`.agent-runs/bp-commenting-round3/evidence-shots-20260731-222802/`.

## Picky design-review pass

### Document surface

1. **Flag:** the title appeared arbitrarily inset from every card.
   **Fixed:** native outer-edge alignment restored.
2. **Flag:** the alignment check could be green while the document header was
   wrong. **Fixed:** document-level rows added to the guard.
3. **Flag:** existing comments looked like tiny leave-comment marks.
   **Fixed:** larger, distinct existing-comment glyph.

### Inline composer

1. **Flag:** selected text bled through the pill's hover fill.
   **Fixed:** opaque theme-derived hover background.
2. **Flag:** the editor clipped text and left its marker detached.
   **Fixed:** editor now occupies document flow beside its anchor.
3. **Flag:** a cramped viewport could still force the overlay across content.
   **Fixed:** placement no longer depends on available overlay space.

### Tray and response surface

1. **Flag:** the tray repeated its own title and count above the tabs.
   **Fixed:** tabs lead the surface.
2. **Flag:** the comment location read as metadata rather than an action, and
   its browser-default focus ring broke the control system.
   **Fixed:** it now jumps, edits, and uses the shared focus-visible ring.
3. **Flag:** submitting and response rendering felt jittery and over-accented.
   **Fixed:** tray scroll anchoring is disabled, the document stays put, and
   nested replies use no second border.

No validation pipeline, push, or PR action was run in Stage 1.
