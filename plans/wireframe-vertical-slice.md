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

| #   | Question                    | Recommendation                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Authoring safety boundary   | **Adopt, already satisfied.** Restricted MDX with no executable authored code is Big Plan's existing contract. Wireframes add no new escape hatch: every wireframe element is a scoped child with a validated attribute schema.                                                                                                             |
| 2   | Internal renderer           | **Adapt.** The spec suggests avoiding React. Big Plan already crosses React once at compile time and ships no React runtime. The wireframe **model** stays framework-free in `compile.ts`; only `view.tsx` sees React, matching every other component. Inventing a second rendering technique here would violate the existing architecture. |
| 3   | First-release interactivity | **Adopt.** Screen navigation only in the slice. Tabs/steppers/overlays come later behind the same declarative action attribute. No state language.                                                                                                                                                                                          |
| 4   | Sketch engine               | **Adopt.** Big Plan-owned CSS only. No Rough.js, no runtime randomness, no measurement: strokes must be byte-identical across renders so plan diffs do not jitter.                                                                                                                                                                          |
| 5   | Catalog breadth             | **Adopt with a smaller first cut.** Ship the slice catalog, keep the catalog the single source of truth for names, schemas, child rules, and agent docs, and grow it. Do not publish `reserved` names that reject with "not implemented yet" until the shape they reserve is real.                                                          |
| 6   | Artboard responsiveness     | **Adapt, and this is the one real disagreement.** See §5. Fit-width with reflow, not down-scaling.                                                                                                                                                                                                                                          |
| 7   | Font and icon assets        | **Adopt.** No new font. Big Plan is self-contained and makes zero external requests; a bundled handwriting font is a licensing and payload decision that the slice does not need. The hand-drawn read comes from stroke geometry, not letterforms. Icons keep coming from `src/icons/lucide/`.                                              |
| 8   | Public syntax stability     | **Adopt Big Plan's existing answer, which differs.** `AGENTS.md` states Big Plan has **no compatibility contract before an explicit milestone**. Adding `schemaVersion` to `Wireframe` now would contradict that and freeze a shape we have not yet proven. No version attribute.                                                           |
| 9   | Wireframe isolation         | **Adopt.** Inline under `[data-wireframe]`, never an iframe. `prose.css` styles `article h1..h6`, `article table`, `article ul`, and friends by element selector, so wireframe CSS explicitly neutralizes those inside the root, and a style-isolation test guards it.                                                                      |

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

The slice instead defines a **fit-width, reflow** artboard contract: `viewport` declares the intended device and drives the frame's aspect and internal proportions, the block fills the available width, and content reflows.
Type stays at reading size at every width from 320px up.
If a genuinely fixed artboard is later required, it is an opt-in attribute on `Screen`, not the default.

**Three smaller points.**

- The spec's "avoid React" recommendation is stale advice for this repository; following it would mean two rendering techniques instead of one.
- The spec asks for `reserved` catalog names that reject with "not implemented yet". I recommend leaving unimplemented names simply unknown. `Unknown component "Combobox"` is a true, actionable diagnostic; a reserved name promises a shape we have not designed and creates a compatibility obligation the pre-milestone policy explicitly refuses.
- The spec asks to bundle a hand-written font. Deferred: it is a licensing review and a payload cost for an effect that stroke geometry already delivers.
