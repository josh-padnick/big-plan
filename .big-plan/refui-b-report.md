# Phase B report: the Refactoring UI design pass

What changed across the whole product surface, why, and what did not change.
The review gallery is `examples/all-components.html`, rendered after `bun run build`.
The per-area before and after captures are in `.big-plan/refui-b-shots/`, both themes.

[DESIGN_PRINCIPLES.md](../DESIGN_PRINCIPLES.md) is the durable output of this work.
This report is the record of one pass; that document is what the next agent reads.

## 1. The system

Four scales. Each is closed. A design decision picks a step; it does not invent a value.

### Colour

Seven ramps, authored in HSL from the middle shade outward, then the extremes, then the fill.
Saturation rises toward both ends of a ramp so pale and deep steps keep their perceived colour instead of washing out.
Hue rotates toward the more luminous neighbour as a ramp lightens.

| Ramp      | Steps                   | Character                                                               |
| --------- | ----------------------- | ----------------------------------------------------------------------- |
| `grey`    | 25 to 950, twelve steps | Warm through the whole range; this is what makes the page read as paper |
| `primary` | 50 to 900               | The brand green. Step 700 is the accent the product already used        |
| `success` | 50 to 900               | Olive, so confirmation never competes with the brand green              |
| `warning` | 50 to 900               | Amber                                                                   |
| `danger`  | 50 to 900               | Warm red                                                                |
| `info`    | 50 to 900               | Slate blue                                                              |
| `note`    | 50 to 900               | Indigo, for a reader's own annotations                                  |

A ramp step is a plain custom property and never becomes a utility.
Markup can only paint a **role**: `paper`, `raised`, `surface`, `well`, `header`, `ink`, `muted`, `subtle`, `edge`, `edge-strong`, `accent`, `accent-soft`, `accent-ink`.
Every stock Tailwind colour is dropped, so no utility can reach a shade the product did not declare.

Text runs three deep and no deeper.
Every text-on-surface pairing the product can produce clears WCAG AA in both themes.
One rule holds it: a chrome band carries primary or secondary text, never tertiary.

### Spacing

One nonlinear scale, base 16px: 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128 pixels.
Adjacent steps alternate a 1.5 and a 1.33 ratio, so no two steps look the same.

### Type

Ten hand-picked steps in rem: 11, 12, 14, 16, 18, 20, 24, 30, 36, 48 pixels.
Line height belongs to the step, not to the call site.
It peaks at the reading size (1.65) and tightens in both directions, to 1.05 at the largest heading and 1.45 at the smallest label.
Two tracking values exist: `tight` for type from 24 pixels up, and `caps` for all-caps labels.

### Elevation

One light source, above. Five steps: `raised`, `lifted`, `floating`, `pressed`, `well`, plus one `focus` halo.
The two largest are a tight direct shadow plus a wide ambient one.
The shadow colour is the deepest grey rather than black, so it stays inside the warm palette.

## 2. What each area changed

| Area      | Before                                                                   | After                                                                                    |
| --------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Hierarchy | Six labels painted in the brand green; two greys plus two ad-hoc washes  | Labels are tertiary grey; accent marks three things only; three text roles and no washes |
| Spacing   | 132 off-scale utilities, plus prose margins in em                        | Every distance is a scale step; the page gutter stops being proportional                 |
| Text      | 23 sizes, five tracking values, line height chosen per call site         | Ten steps, two tracking values, line height owned by the step                            |
| Colour    | Call-site colour mixes; grey body text on four kinds of tint             | Palette roles only; each tint carries its own ink at 10.35 to 1 or better                |
| Depth     | 67 border utilities; four nested outlines before a sentence              | 28 borders; separation is surface colour plus one shadow step                            |
| Images    | An authored image had no treatment                                       | An image takes its own line, the full column, and a raised ground                        |
| Finishing | An empty filter said "no rows"; default list, quote, and link treatments | Designed empty states; accent list markers; a quotation on its own ground                |
| System    | Nothing stopped the next off-scale value                                 | A check closes spacing, radius, and elevation, and runs in lint                          |

Four real defects surfaced during the pass and were fixed:

1. Three all-caps labels read `tracking-capsr` after an earlier rewrite, so they carried no tracking at all.
2. Fifteen focus halos restated the same ring by hand at two different opacities.
3. Six radii sat between two steps.
4. Two Playwright specs asserted hard-coded shades and a legacy padding value; they now resolve the expected value from the live theme, so they assert the role rather than the hex.

## 3. Conflicts between the book and the captain's stated preferences

The captain's preference wins. Each conflict and its resolution:

1. **Saturated accents versus the printed-page palette.**
   The book pushes toward brighter, more saturated accents than Big Plan uses.
   The established identity is a warm, quiet, printed page.
   **Resolved for the captain.** Every ramp is built inside that character: the success ramp stays olive rather than becoming a bright green, and no ramp gains chroma beyond what the paper aesthetic carries.

2. **"Use fewer borders" versus a data table's row rules.**
   The book makes borders the exception.
   A table without row separation is harder to scan, and the product's own group-band separation test depends on one.
   **Resolved for the captain's readability standard.** Table row rules stay, and are named as a documented exception rather than an oversight.

3. **Accent colour on chrome.**
   The book's "emphasize by de-emphasizing" says to quiet chrome.
   The product had used the brand green on kickers, part tags, and section labels, which reads as deliberate branding.
   **Resolved for the book at first, then split by the captain's review of PR 74.**
   The captain kept the quiet treatment on slide kickers and part tags, and overruled it on two surfaces he had already approved: the quick summary's Why, What, and How labels, and the table-of-contents part labels. Both are back in the brand colour.
   The distinction that survives: a label naming the product's own structure is tertiary; a label naming the reader's question, or the part they are looking for, keeps the accent.

4. **Font family.**
   The book has tests a typeface can fail.
   The directive says a font change needs the captain.
   **Not changed.** No new font, icon set, or dependency was added.

## 4. What was deliberately not changed, and why

- **The wireframe's internal sketch metrics.**
  A wireframe draws somebody else's interface. Its stroke widths, sketch radii, and device silhouettes are a drawing language, not a Big Plan reading surface, and a rendered geometry fence in `test/wireframe-quality.spec.ts` protects them. The wireframe is exempt from the scale check for the same reason. Its chrome and its labels do follow the palette.

- **Syntax highlighting colours.**
  Code token colours are a syntax theme derived from an external, widely-recognised palette. Repainting them from the product ramps would make code less familiar to read for no gain. They were checked against the new code-body grounds and remain legible in both themes.

- **The radio rim and the text-input edge.**
  Both are controls that must read as controls. `edge-strong` exists as a role for exactly this, and the design document names it as the border exception.

- **The active navigation entry's colour signal.**
  It changes both text colour and rail colour, and the rail moves from a pale grey to a deep accent, which is a large luminance step rather than a hue-only one. Weight is not used because the existing comment records that a weight change re-wraps the label.

- **Font family, icon set, and dependencies.**
  Unchanged, per the rules of engagement.

## 4b. The captain's parity review of PR 74

The captain reviewed the pass and asked for three surfaces to be brought back toward the look he had approved before Phase B: the quick summary, the plan title and lede, and the table of contents.
That work is in `design(parity)`, and the before and after pairs are at `data/bp-refui-b/parity-three.html`.

What it changed, and what it taught the system:

- **The quick summary inverts the depth model on purpose.**
  Phase B had made it a near-white card holding recessed blocks. The approved shape is a tinted tray with lighter blocks raised on it.
  The system gained a `tray` role for that, so the shape is named rather than special-cased.
- **A scale step should hold the approved value.**
  The title is 40 pixels because that is what was approved, so `--text-4xl` is 2.5rem. The call site did not gain an exception.
- **Tracking on prose headings was a step too far.**
  The book says to tighten large type. The approved title reads better upright, so the blanket tracking is gone.

Every value still names a scale step or a role. Remaining differences from the approved render are one or two pixels and single palette rounding steps.

## 4c. The rest of the components

The captain signed off the three surfaces and cleared the rest. That pass did
three things.

**It rebased onto main.** The branch now carries PR 73, which makes a slide
title open a collapsed slide without ever closing an open one, keeps the kicker
and the chevron as full toggles, and switches the title cursor between pointer
and text. That behaviour is a hard constraint on this work and is proved by
`test/deck.spec.ts`. It also carries PR 75 and PR 76.

**It extended the audit from ten surfaces to thirty-nine.** Most of what the
audit reports on the other components is the design pass itself: an outline
traded for a different ground plus one step of elevation. That is the change
already reviewed, and it stays. The audit lists it so the pass stays
accountable, not so it can be reverted.

**It fixed three regressions the wider audit exposed**, each the same class of
drift the captain rejected on the signed surfaces:

1. The branding bar had traded its hairline for a resting shadow. A bar that
   never leaves the screen reads heavier that way. Its comment control gets its
   outline back too.
2. The slide context line had gone one shade darker and one size smaller than
   the document lede it echoes.
3. The dark quiet surface sat one step too light, so a disabled control and
   every chrome band on the dark page read lighter than approved. Fixing it also
   collapsed the tray role onto the quiet surface in both themes, because the
   approved values turned out to be the same shade.

The three signed surfaces stayed byte-identical through all of it.

## 5. A coverage gap this pass found

The style-history contract captures two fixture documents: `examples/mdx-components.mdx` and `examples/deck.mdx`.
Neither exercises a database schema, a keyed decision, or an authored image.
So the images commit changed real styling files and moved no configured capture, and its contract is `[visual:empty]` rather than `[visual:approved]`.
That is the honest declaration, and it is also the evidence that the capture matrix does not cover the whole component surface.

The fix is to add `examples/all-components.mdx` to the capture configuration as a new document with new capture keys, which the contract permits.
It is not done here: extending coverage re-captures every commit in the range, and this pass is already a large review surface.
It is the first thing worth doing after this PR lands.

## 6. Verification

- `bun run lint`, `bun run build`: pass.
- `bun run test`: 940 unit tests pass.
- `bun run test:e2e`: 63 browser tests pass.
- Browser proof of the affordances this pass changed: the table filter empty state appears with the failing query in it, the comment button raises on hover, and the draft field carries its placeholder.
- WCAG AA verified for every text-on-surface and text-on-tint pairing in both themes.
