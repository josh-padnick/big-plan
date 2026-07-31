# Declarative hand-drawn wireframes: design note and vertical slice

This note answers the captain's pre-implementation questions for adding a `Wireframe` component to Big Plan.
It records the evidence inspected, the open-question recommendations, the smallest vertical slice, the file impact, and where the original prompt does not survive contact with this repository.

## 1. Evidence inspected

The captain spec describes a "GrandPlan" tree with `src/cli/render-command.ts`, a Markdown-only converter, and no React.
That evidence is stale.
What this repository actually contains:

| Concern                   | Actual owner in Big Plan                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Public commands           | `src/cli/<command>/`, with shared mechanics in `src/cli/_shared/` (`compile`, `guidance`, `render`, `validate`)                    |
| Plan-source parsing       | `src/render/markdown/compile-markdown.ts` (unified, `remark-parse` + `remark-gfm` + `remark-mdx` + `remark-rehype`)                |
| Authoring safety boundary | `src/render/markdown/component-pipeline/deliver.ts`                                                                                |
| Component registry        | `src/components/_registration/registry.ts`, closed record of authorable names                                                      |
| Component contract        | `src/components/_authoring/contract.ts` (attribute schemas, scoped children, id allocator)                                         |
| Presentation              | per-component `view.tsx`, crossed once at `component-pipeline/react-hast-adapter.ts`                                               |
| Layering                  | `eslint.config.mjs`: allow-list layer graph plus a completeness guard that fails lint if any `src/` file is unclaimed              |
| Styles                    | `src/render/global.css` imports each component's `styles.css`; `scripts/gen-css.mjs` compiles and embeds it                        |
| Browser behavior          | one script, `src/render/shell/viewer-script.ts`; plan content contributes none                                                     |
| Guidance                  | `src/components/*/*.guidance.md`, embedded by `scripts/gen-guidance.mjs`, parity-tested in `_registration/guidance-parity.test.ts` |
| Example health            | `src/render/example-documents.test.ts` renders every `examples/*.mdx` and requires zero diagnostics                                |

Three findings change the design materially:

1. **Expression-valued attributes are already rejected.**
   `normalizeAttributes` in `deliver.ts` reports `Expression-valued attribute "x" is not supported` for any `prop={...}`, and separately rejects ESM, flow/text expressions, spreads, and inline JSX.
   The spec's illustrative `items={[...]}` and `action={{ type: "navigate", to: "..." }}` syntax **cannot be authored in Big Plan**.
   The safety boundary the spec asks for is therefore already built and stricter than the spec assumed.
2. **Scoped children already provide recursive, registry-driven nesting.**
   `ScopedChildDefinition.scopedChildren` is applied recursively by both `validate-authoring.ts` and `deliver.ts`, and each scoped child arrives at its parent compiler with `name`, `attributes`, `children` (HAST body), `scopedChildren`, and `position`.
   That is exactly the wireframe node tree, with source positions for diagnostics, and it costs no new parser.
3. **Attribute schemas are string/enum/boolean only.**
   Numeric tokens (`columns`, `value`, `currentStep`) need either a new schema kind or string tokens.
   The slice avoids them; a `number` schema kind is the natural later addition and belongs in `_authoring/contract.ts` where every component gains it.

## 2. Recommendations on the nine open questions

I adopt the spec's defaults on all nine, with the adaptations below where Big Plan already decided the question.

| #   | Question                    | Recommendation                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Authoring safety boundary   | **Adopt, already satisfied.** Restricted MDX with no executable authored code is Big Plan's existing contract. Wireframes add no new escape hatch: every wireframe element is a scoped child with a validated attribute schema.                                                                                                                                                                              |
| 2   | Internal renderer           | **Adapt.** The spec suggests avoiding React. Big Plan already crosses React once at compile time and ships no React runtime. The wireframe **model** stays framework-free in `compile.ts`; only `view.tsx` sees React, matching every other component. Inventing a second rendering technique here would violate the existing architecture.                                                                  |
| 3   | First-release interactivity | **Adopt.** Screen navigation only in the slice. Tabs/steppers/overlays come later behind the same declarative action attribute. No state language.                                                                                                                                                                                                                                                           |
| 4   | Sketch engine               | **Adopt.** Big Plan-owned CSS only. No Rough.js, no runtime randomness, no measurement: strokes must be byte-identical across renders so plan diffs do not jitter.                                                                                                                                                                                                                                           |
| 5   | Catalog breadth             | **Adopt with a smaller first cut.** Ship the slice catalog, keep the catalog the single source of truth for names, schemas, child rules, and agent docs, and grow it. Do not publish `reserved` names that reject with "not implemented yet" until the shape they reserve is real.                                                                                                                           |
| 6   | Artboard responsiveness     | **Adapt, and this is the one real disagreement.** See §5. Fit-width with reflow, not down-scaling.                                                                                                                                                                                                                                                                                                           |
| 7   | Font and icon assets        | **Adopt fully, after review.** The slice shipped geometry-only and the captain judged a formal face on a sketched background awkward, which was the right call. Patrick Hand (SIL OFL 1.1, latin subset, 14KB) is now bundled and embedded as a data URI; `assets/fonts/README.md` is the manifest of name, license, source, and coverage the question asks for. Icons keep coming from `src/icons/lucide/`. |
| 8   | Public syntax stability     | **Adopt Big Plan's existing answer, which differs.** `AGENTS.md` states Big Plan has **no compatibility contract before an explicit milestone**. Adding `schemaVersion` to `Wireframe` now would contradict that and freeze a shape we have not yet proven. No version attribute.                                                                                                                            |
| 9   | Wireframe isolation         | **Adopt.** Inline under `[data-wireframe]`, never an iframe. `prose.css` styles `article h1..h6`, `article table`, `article ul`, and friends by element selector, so wireframe CSS explicitly neutralizes those inside the root, and a style-isolation test guards it.                                                                                                                                       |

## 3. Smallest vertical slice

Exactly what the captain named, plus the two elements a credible screen cannot do without:

- `<Wireframe id title? initialScreen?>` - root, one or more screens.
- `<Screen id name viewport?>` - one artboard.
- `<Stack gap? align?>` and `<Row gap? align? justify?>` - layout primitives.
- `<Panel title? eyebrow?>` - bounded surface.
- `<Heading>` and `<Text>` - copy, with `<Text>` carrying inline Markdown.
- `<Button emphasis? navigateTo?>` - the only interaction, navigating between screens.
- Hand-drawn chrome in CSS, deterministic, light and dark.
- Screen switching in the shell's existing viewer script, generic and content-free.

Deferred but unblocked: the rest of the ontology is additional catalog entries plus view cases.
Nothing in the slice needs replacing to add them.

### The action model, adapted

`action={{ type: "navigate", to: "x" }}` is unauthorable here.
The slice uses `navigateTo="screen-id"`, a plain string attribute validated against the wireframe's declared screen ids.
This keeps the action declarative, statically checkable, and source-locatable, and it costs one attribute instead of an expression parser.
If a second action type ever appears, `action="navigate"` plus `to="..."` is the compatible growth path.

### The no-JavaScript contract

The document renders **every** screen, in authored order, each labeled with its name.
With scripts disabled that is a readable, printable storyboard - strictly better than a blank second screen.
The viewer script marks the root interactive, which is what activates the "show only the current screen" rule, so JavaScript narrows the view rather than creating it.

## 4. Dependency and file impact

No new runtime dependencies. No MDX parser, no Rough.js, no font.

Added:

```text
src/components/wireframe/
  catalog.ts          element definitions: schema, children policy, agent docs
  compile.ts          scoped children -> validated WireframeNode tree
  model.ts            framework-free node union and design tokens
  view.tsx            node tree -> semantic React
  definition.ts       registry contract, recursive scoped-children graph
  styles.css          hand-drawn chrome, scoped to [data-wireframe]
  wireframe.guidance.md
  *.test.ts           catalog invariants, compile diagnostics, view output
examples/wireframe.mdx
test/wireframe.spec.ts
```

Modified:

- `src/components/_registration/registry.ts` - register `Wireframe`.
- `src/render/global.css` - import the component stylesheet.
- `src/render/shell/viewer-script.ts` - generic screen navigation.
- `eslint.config.mjs` - claim `catalog.ts` and `model.ts` for the `model` layer.
- `docs/` and `AGENTS.md` - only once the authoring contract is public.

## 5. Disagreement with the prompt

**Artboard down-scaling (open question 6).**
The spec wants wide artboards scaled to fit the reading surface.
I recommend against it for the first release, and the slice does not do it.

CSS cannot divide a container width by a logical width to produce a unitless `transform: scale()` factor, so honest scaling needs either measurement in JavaScript - which the architecture forbids for content - or breakpoint-stepped approximations that are neither deterministic nor accurate.
Worse, a 1024px tablet artboard scaled into a ~700px column renders its labels at roughly 9px.
A wireframe whose text a reviewer cannot read fails the plan-quality standards this repository holds itself to.

The slice instead defines a **fit-width, reflow** artboard contract: `viewport` declares the intended device and sets the widest the drawing will ever be, the block fills the available width, and content reflows.
Type stays at reading size at every width from 320px up.
If a genuinely fixed artboard is later required, it is an opt-in attribute on `Screen`, not the default.

Height follows the same reasoning and was settled by looking at it.
The first cut held each screen to its device proportions, which left a half-empty rectangle in the middle of the plan; a reviewer reads that emptiness as unfinished work rather than as room the design has left over.
The artboard now grows with the drawing.

**Three smaller points.**

- The spec's "avoid React" recommendation is stale advice for this repository; following it would mean two rendering techniques instead of one.
- The spec asks for `reserved` catalog names that reject with "not implemented yet". I recommend leaving unimplemented names simply unknown. `Unknown component "Combobox"` is a true, actionable diagnostic; a reserved name promises a shape we have not designed and creates a compatibility obligation the pre-milestone policy explicitly refuses.
- ~~The spec asks to bundle a hand-written font. Deferred.~~ Withdrawn after review: geometry alone did not carry the sketch, and the bundled face is what makes a wireframe read as one. The cost is real and worth stating - the embedded stylesheet grew by about 24KB, which every rendered plan carries whether or not it draws a wireframe.

## 6. What is built, and what needs a decision

Built and verified: the slice above plus the product-shell vocabulary - `AppShell`, `Sidebar`, `TopBar`, `AppContent`, `PageHeader`, `Nav`, `NavItem`, `Metric`, `Progress`, `Badge`, `Divider`, `ImagePlaceholder`, `List`, `ListItem`.
A three-screen Eddy's Wallet prototype walks between screens, unit tests cover placement and reference rules, and a browser journey covers the walk, the keyboard route, and a 320px phone.

Three UX questions are worth a decision before the catalog grows further.

### Width: should a wireframe break out of the reading column?

Big Plan's reading column is `74ch`, about 740px.
A `tablet-landscape` app shell inside it has roughly 490px left for content after the sidebar, so a three-region dashboard reflows to two.
The reflow is correct responsive behavior and it still reads well, but it is not the layout the author drew.

Measured on the showcase: the drawing gets about **420px** of content width after the sidebar, which is why a three-region dashboard lands as two-plus-one and the canvas is drawn two nodes to a row.
The screens still read, and the reflow is what a real product does at that width, but it is not the layout the author drew.

The alternative is a full-bleed artboard: a wireframe escapes the column and uses the window's width.
That is a shell change rather than a component one, and it cannot be faked from inside the component: the reading column is not centered in the viewport (a 15rem contents column sits to its left), so any `50%`-based escape centers on the wrong axis and overflows the page.
Big Plan has no full-bleed mechanism today, and adding one is a shell decision.

### The hand: settled, with two follow-on choices

Answered by the captain: bundle a hand-drawn face.
Patrick Hand ships embedded, and the sketch geometry dropped from 255px/15px ellipses to single-digit corner variation, so no edge is machine-true but no box visibly leans.

Two consequences are worth a look rather than a decision:

- The face has one weight, and synthetic bold thickens its strokes until they stop looking hand-drawn, worst where the type is largest. Emphasis now comes from size, case, and ink. Hierarchy inside a panel is therefore softer than it was.
- The font stops at the artboard's edge. The figure caption, the screen switcher, and the viewport note stay in the document's own face, on the reading that those are Big Plan speaking about the drawing rather than part of it.

### Breadth: how much more catalog before this ships?

Form controls shipped: `TextField`, `TextArea`, `Select`, `Checkbox`, and `Switch`, plus `Stepper`/`Step` for a create flow and `Connector` for a canvas arrow.
The eleven-screen workflow-builder showcase in `examples/workflow-engine-builder.mdx` exercises the whole vocabulary and is what the width question below is measured against.

`Table` and `Timeline` are what remain, and `Table` is the one carrying design risk: it needs an authoring shape the attribute model cannot express, most likely a fenced body the way `FileTree` already reads a plain-text body.
