# Big Plan design principles

Owns how Big Plan looks and why.
[AGENTS.md](../AGENTS.md) owns the product model and source placement.
[ENGINEERING_PRACTICES.md](ENGINEERING_PRACTICES.md) owns how to write the styling code.
`src/render/global.css` owns the token values; this document owns the rules for choosing among them.

Big Plan renders one thing: a plan a human must understand.
Every rule below serves the two plan-quality standards in AGENTS.md.
The document is pleasant to read, and the plan is easy to understand.

## The one rule above the others

**The plan content is the star. Everything Big Plan adds is chrome.**

Chrome includes the branding bar, the table of contents, section kickers, part bands, component headers, and every control.
When chrome competes with content, quiet the chrome.
Do not make the content louder.

## Limit your choices

A design decision picks a step from a scale.
It does not invent a value.

There are five scales: spacing, type, colour, elevation, and radius.
Each is closed.
If a design needs a value that is not on a scale, the design is wrong, or the scale is wrong.
Change the scale in `src/render/global.css` and say why; do not add a one-off value.

Colour and type are enforced by the theme itself.
The palette steps are plain custom properties, so no utility can name one; only a role can be painted.
Every stock Tailwind colour, size, and tracking step is dropped, so a utility can only name a step this product declared.
Spacing cannot close the same way, because Tailwind derives every numeric spacing utility from one base unit, so `scripts/design-system/check.mjs` closes spacing, radius, and elevation instead.
That check owns the exact allowed steps; the tables below say what each step is for.

## One utility per property per variant scope

A class list names each CSS property at most once within any one variant scope.

Two utilities of the same variant scope - base against base, or `hover:` against `hover:` - do not resolve in the order they are written.
They carry equal specificity, so the generated stylesheet's own emission order decides, and it emits an arbitrary-value utility before a named one.
A base `bg-paper` therefore beats a base `bg-[var(--diff-add-c)]` written after it, whatever the author intended.
Write the property once per scope, inside the branch that chooses its value, and never as a base a later class of the same scope is expected to override.

Utilities in different variant scopes are not this hazard.
A variant compiles to a selector carrying an extra pseudo-class or attribute, so it outranks a bare base utility on specificity and wins regardless of emission order.
`bg-transparent hover:bg-surface` is correct and stays correct.

The same care applies to a variant that reaches into children.
`[&>*]:` cannot know what kinds of children a container will grow, so a geometric utility applied through it - a size, a height, a width - eventually lands on a child that is not text and silently deforms it.
Name the children it is for, or exclude the ones it is not.

Both halves of this rule are here because both have failed silently in this product, and neither is visible in a diff (BIG-176).

## Spacing

One scale, base 16px, nonlinear.
Adjacent steps differ by a ratio a reader can see.

| Step  | Size  | Use                                     |
| ----- | ----- | --------------------------------------- |
| `0.5` | 2px   | Space inside a chip or a badge          |
| `1`   | 4px   | Space between an icon and its own label |
| `1.5` | 6px   | Space inside a small control            |
| `2`   | 8px   | Space between tight related lines       |
| `3`   | 12px  | Space inside a compact panel            |
| `4`   | 16px  | The base step, and the default answer   |
| `6`   | 24px  | Space inside a card                     |
| `8`   | 32px  | Space between blocks in a section       |
| `12`  | 48px  | Space between sections                  |
| `16`  | 64px  | Space between parts                     |
| `24`  | 96px  | Page margins on a wide screen           |
| `32`  | 128px | Reserved for the largest page break     |

Rules:

1. **Start with too much space, then remove.**
   A cramped surface that gets padding added never recovers.
2. **Space must make grouping unambiguous.**
   An element sits closer to what it belongs to than to what it does not.
   If a label could belong to the block above or the block below, the spacing is wrong.
3. **Do not fill the screen.**
   Prose holds `--measure`.
   A card holds `--card-measure`.
   Only a table or a drawing takes the full column.
4. **Fixed widths beat grid fractions where a width has one correct value.**
   The table of contents is one example.
5. **Padding does not scale with the element.**
   A large card on a phone loses more padding than a small one.

## Type

One scale, hand-picked, in rem.
No step between two steps exists.

| Step        | Size | Line height | Use                                 |
| ----------- | ---- | ----------- | ----------------------------------- |
| `text-3xs`  | 10px | 1.4         | Copied payload, never read prose    |
| `text-2xs`  | 11px | 1.45        | All-caps kicker, micro label        |
| `text-xs`   | 12px | 1.5         | Dense control text, code chrome     |
| `text-sm`   | 14px | 1.55        | Table cell, caption, secondary line |
| `text-base` | 16px | 1.65        | Body prose, the reading size        |
| `text-lg`   | 18px | 1.55        | Lead paragraph                      |
| `text-xl`   | 20px | 1.4         | Sub-slide title                     |
| `text-2xl`  | 24px | 1.3         | Slide title                         |
| `text-3xl`  | 30px | 1.2         | Part title                          |
| `text-4xl`  | 36px | 1.15        | Document title                      |
| `text-5xl`  | 48px | 1.05        | Reserved                            |

`text-3xs` is the floor and the one step with a rule of its own: it is for a payload copied far more often than it is read, where fitting the value on one line beats comfortable reading.
Nothing meant to be read may take it.

Line height is a property of the step, not a call-site decision.
It peaks at the reading size and tightens in both directions.
A heading is one optical block; a single-line label has no second line to clear.

Rules:

1. **Size is the last tool for hierarchy, not the first.**
   Try weight, then colour, then size.
   Two headings that differ only in colour and weight read as a hierarchy.
   Six sizes read as noise.
2. **Prose holds a measure.**
   `--measure` caps a passage at roughly 45 to 75 characters.
   A wide column is for tables and drawings.
3. **Tighten large type; open all-caps.**
   Use `tracking-tight` from `text-2xl` up.
   Use `tracking-caps` on every all-caps label.
   Nothing else changes tracking.
4. **Align by baseline, not by centre, when sizes differ on one line.**
5. **Left-align prose. Right-align numbers in a table column.**
6. **Not every link needs a colour.**
   In a link-dense surface, use weight or darkness, and reveal an underline on hover.
   Reserve the accent colour for links inside prose.

## Colour

A palette is eight ramps: `grey`, `neutral`, `primary`, `success`, `warning`, `danger`, `info`, and `note`.
The product's own ramps were built in HSL from each middle shade outward.
Its greys are warm through their whole range, which is what makes the page read as paper.

Markup never names a ramp step.
Markup names a **role**.

| Role          | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `paper`       | The page                                                         |
| `raised`      | A card, lifted off the page                                      |
| `surface`     | A quiet separated area: a hover state, a chip, a table head      |
| `well`        | A recessed area inside a card: a code body, a diff body          |
| `header`      | A chrome band inside a card                                      |
| `ink`         | Primary text, the thing being read                               |
| `muted`       | Secondary text, supporting the primary                           |
| `subtle`      | Tertiary text, a label the reader consults rather than reads     |
| `edge`        | A hairline, when a border is genuinely the answer                |
| `edge-strong` | The edge of a control that must read as an input                 |
| `accent`      | The theme's emphasis colour, for the one thing that matters most |
| `accent-soft` | A tinted ground for accent content                               |
| `accent-ink`  | Text on an accent-filled surface                                 |

Rules:

1. **Three text colours, and no more.**
   Primary reads, secondary supports, tertiary labels.
   A fourth level of grey is a hierarchy that failed and got patched.
2. **Never grey text on a coloured ground.**
   Use a step from the ground's own ramp.
   `--callout-warning-c` on `--callout-warning-bg` is the pattern; grey on amber is not.
3. **A band carries primary or secondary text, never tertiary.**
   Stacking a quiet surface under quiet text drops below WCAG AA.
4. **Colour is never the only signal.**
   Anywhere colour carries meaning - a diff side, a status, a recommendation - an icon, a word, or a weight carries it too.
   A reader who cannot see the difference still gets the plan.
5. **Every pairing meets WCAG AA.**
   Every colour theme in both light and dark appearances, every change.
   When white on a colour fails, flip to dark text on a light tint of that colour.
6. **Accent is scarce.**
   One accent per surface.
   If two things are both the most important, neither is.

### Colour themes

A reviewer can swap the ramps without swapping the roles.
`data-theme` picks light or dark; `data-palette` picks whose shades fill both halves.
A colour theme is therefore a set of ramps behind a shared role mapping, so a role added here is themed everywhere at once.
Three role categories are excepted: `--ink-c`, whose light half cannot share a ramp position with the dark hunk band; the comment-surface roles, which the product palette buys as approved local colours; and the `--syntax-*` token hues, which come from a palette's accents rather than a ramp position.
Brutalist also restates the shape scales under rule 5 below.

Rules:

1. **The role mapping is declared once.**
   Every role is `light-dark(light, dark)` in `src/render/global.css`.
   A palette that needs to restate a role has found a missing ramp step; add the step instead.
   `--edge-strong-c` has its own two steps for exactly that reason: a strong edge and a secondary text colour want the same lightness in the warm greys and nothing like it anywhere else.
   `--ink-c` is the first exception: a guest palette's light primary text is its own mid-dark colour, which cannot also serve as the dark hunk band on `--grey-925`.
   The comment-surface roles are the second: the product palette paints the thread band with approved local colours, so a guest palette restates them from its own greys or the commenting chrome stays warm paper inside a themed document.
   The `--syntax-*` token hues are the third, restated in `src/render/markdown/syntax-highlighting.css`: a token hue is a distinction between kinds of code, so it takes the palette's own accents rather than a ramp position these ramps hold.
2. **A theme is an adaptation, not a port.**
   A terminal palette names a foreground, a background, and eight accents.
   Take its anchors, interpolate the steps between them, and derive a family it does not ship rather than reusing one it does.
3. **The product's own look is what absence means.**
   No attribute and the `default` id are the same document, pixel for pixel.
4. **Every theme meets the bar every theme meets.**
   Rule 5 above is not relaxed for a guest palette; move a shade along its own hue until it passes.
   `scripts/design-system/palettes.mjs` owns the enforced pairings.
5. **A theme may restate a closed scale.**
   Some characters are a shape as much as a colour: Brutalist squares cards and controls, drops the soft light source for a hard offset slab, and sets one step heavier; pill-shaped badges stay round.
   A theme may therefore also restate the closed radius, weight, tracking, and elevation scales, because those are scales this document already owns and a check can already close.
   A palette block may therefore declare ramp steps, syntax tokens, comment-surface tokens, the closed radius, weight, tracking, and elevation scales, and `--ink-c`, and nothing else.
   It may not restate another role beyond the three exceptions in rule 1, because that is how a theme stops sharing the vocabulary every other theme is read in.

## Elevation

One light source, above.
A raised thing casts a shadow downward.
The smaller the shadow, the closer the thing.

| Step                   | Use                                                           |
| ---------------------- | ------------------------------------------------------------- |
| `shadow-raised`        | A card at rest                                                |
| `shadow-lifted`        | The same card on hover, or a control the reader has picked up |
| `shadow-floating`      | A popover, a drawer, a maximized figure                       |
| `inset-shadow-pressed` | A control being pressed                                       |
| `inset-shadow-well`    | A recessed panel                                              |
| `shadow-focus`         | The halo on a control holding the keyboard                    |

The two larger steps are a tight direct shadow plus a wide ambient one.
That is how a real shadow behaves, and a single blur never reads as convincingly.
Focus is not elevation, but it belongs to the same vocabulary: one halo, one width, on every control that can take the keyboard.

Rules:

1. **Use fewer borders.**
   This is the standing rule, not a preference.
   When the goal is to separate two things, reach for a different background, then for space, then for a shadow.
   A border is the last answer, and it needs a reason.
2. **Depth comes from colour first.**
   On the light page, a raised thing is lighter and a well is darker.
   On the dark page it inverts: raised is lighter, and the shadow only deepens it.
3. **An interactive thing moves through elevation.**
   Hover raises it. Active presses it.
   Nothing important changes state without changing depth.
4. **Overlap deliberately, and rarely.**
   An element that crosses a boundary creates a layer.
   Two that do it on one screen create confusion.

## Radius

Four steps and a pill.
`rounded-sm` for a chip, `rounded-md` for a control or a figure, `rounded-lg` for a panel inside a card, `rounded-xl` for a card, and `rounded-full` for a pill or a dot.
A corner is never softened by an amount between two steps.

## Finishing

1. **Design the empty state.**
   A surface with nothing in it is the first thing a reader sees, not an edge case.
   An empty state says what belongs there and how it gets there.
   "Nothing selected yet." is a status line, not an empty state.
2. **Supercharge the defaults.**
   A list marker, a quote, a checkbox, and a link are all places the product can speak.
3. **Use an accent edge for personality.**
   A left edge on a callout, or a top edge on a card, gives a surface identity without a redesign.
4. **Shift the background between sections, gently.**
   Two sections on the same flat ground read as one long section.
5. **Ask whether the shape is right.**
   Not everything that holds content is a card.
   A band, a rule, or plain space is often the better container.

## Where this system yields

Two rules override the book.

1. **The captain's stated preference wins.**
   Where an explicit product decision conflicts with a principle here, the decision wins.
   Record the conflict and the resolution rather than deciding silently.
2. **Established product identity wins over a generic best practice.**
   The warm paper palette and the quiet, printed-page character are the product's identity.
   A change that would make Big Plan look like a generic dashboard is wrong even when a principle points at it.

## Maintaining this file

Keep this file for rules that apply to more than one surface.
A fact about one component belongs with that component.
A mechanically enforced fact belongs in its check and that check's error message.
Prefer rewriting an existing rule over adding a new one.
