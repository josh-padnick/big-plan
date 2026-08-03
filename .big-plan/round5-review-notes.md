# Round 5 review notes

The fresh review uses `decision-component-variations-round5.html`, rendered
from `decision-component-variations.mdx`. The comparison layouts are temporary
`Decision` experiment values; they are not new public components.

## Picky-review audit

### Row hierarchy

1. A rule could appear under only the recommended option. Fixed: the shared
   `decision-row-head` primitive renders it for every option.
2. Criteria could still compete with the title. Fixed: criteria are 14px/20px
   while option titles remain 18px/28px.
3. The rule could interrupt the radio gutter or drift between rows. Fixed:
   every rule spans the full label column at the same offset.

### Proposal dismissal

1. Cancel could discard the reader's earlier choice. Fixed: the viewer retains
   the most recent real option and restores it on cancellation.
2. Cancel could leave stale proposal text behind. Fixed: cancellation clears
   the draft and returns the confirm action to the restored option.
3. The new button could reintroduce the captain's hard double focus ring.
   Fixed: it shares the local 3px translucent halo used by the textarea and
   other Decision controls in both themes.

### Matrix 1 - wide breakout

1. More width could overlap the contents rail. Found at 1000px and fixed:
   breakout activates only at 72rem and above.
2. More width could create document-level horizontal scrolling. Fixed:
   measured overflow is zero at 1000px, 1200px, and the 500px browser minimum.
3. The extra room could still leave word-tower headers. Fixed: at 1200px the
   three title boxes are 109-161px wide and no title exceeds two lines.

### Matrix 2 - options as rows

1. Transposing could lose matrix alignment. Fixed: each criterion remains a
   column and each option remains one aligned table row.
2. Selection could tint only the radio, losing the comparison cue. Fixed: the
   whole option row paints on selection and settlement.
3. Long names could merely move the scrunch elsewhere. Fixed: option headers
   receive 154-210px in the review scenario; only the longest uses two lines.

### Matrix 3 - keyed chooser rail

1. A/B/C could become an unexplained code. Fixed: every letter appears beside
   its full title in the chooser rail and directly above its value column.
2. Choosing in the rail could fail to identify the corresponding grid column.
   Fixed: the rail row and every keyed column cell paint together.
3. The recommendation badge could squeeze the title. Fixed: full titles own a
   flexible rail, the badge sits at the far edge, and all three remain one line.

### Brief disclosure

1. The label could still sit high in the collapsed row. Fixed: the summary is
   a 48px flex row inside a measured 49px disclosure band.
2. Centering could erase the native disclosure cue. Fixed: a Lucide chevron
   remains visible and rotates when open.
3. The focus halo could clip against the row edge. Fixed: the compact local
   halo stays inside the padded disclosure surface in both themes.

## Real gesture evidence

- Row option: hovered and clicked; the native radio became checked, focus
  remained on it, and the selection summary changed.
- Proposal: hovered and clicked its visible label; its radio became checked,
  the field appeared, and focus moved to the textarea.
- Textarea: hovered, clicked, filled, and then tabbed forward in both themes;
  its local focus halo appeared.
- Cancel: reached by Tab, then hovered and clicked in both themes; the field
  closed, its draft cleared, and the prior option returned.
- Wide matrix: hovered and clicked an option in both themes; its full column
  painted and its rationale became current.
- Transposed matrix: hovered and clicked an option in both themes; its full row
  painted and its rationale became current.
- Keyed matrix: hovered and clicked an option in both themes; its rail entry
  and A column painted together.
- Brief disclosure: hovered and clicked open, then hovered and clicked closed
  in both themes; `open` changed each time and focus remained on the summary.

The focused textarea, Cancel button, radios, and disclosure were captured in
both palettes. Every screenshot was first verified under
`/tmp/fm-bp-decision-round5/shots/20260801-224011/` before being copied into
`round5-shots/20260801-224011/`.

## Automated verification

- `bun run build`
- `bun run test` - 673 tests passed
- `bunx playwright test test/decision.spec.ts` - 4 tests passed
- `bun run lint`
- `big-plan validate` and `big-plan render`
