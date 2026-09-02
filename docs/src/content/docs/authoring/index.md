---
title: Writing plans
description: What a Big Plan document is, what it may contain, and where each kind of authoring rule lives.
---

Big Plan documents are MDX files containing Markdown and built-in components.
The renderer never evaluates code from a plan: imports, exports, `{}` expressions, and inline JSX are rejected.
A plan is prose plus components, and the file on disk stays the greppable, diffable source of truth.

This page describes the system, not how to write well.
Everything a plan author has to judge - the title, the structure, the deck shape, terseness, when a component beats prose - is owned by `big-plan guidance` and stated there once.

This section describes the system. Everything a plan author has to _judge_ — the title, the
structure, the deck shape, terseness, when a component beats prose — is owned by
`big-plan guidance` and stated there once, so it stays current through package upgrades
rather than drifting on this site.

## Guidance is the canonical source

Run `big-plan guidance` before writing a plan.
It prints the principles for writing a plan a human loves to review, and it is the only place those principles live.
Reading it recently is required before gated authoring and human-review commands; the [`guidance` reference](/reference/commands/guidance/) owns the gated command list, acknowledgment lifetime, storage, and degraded behavior.

Run `big-plan guidance <Component>` for one component's usage guidance, which is authored beside that component rather than in the shared principles.
Run `big-plan guidance Slide` once before drafting to receive the complete guidance-bearing slide-type catalog; it is one digest for the whole authoring pass, not a per-slide command.

## What a plan may contain

Standard Markdown plus GFM tables, task lists, footnotes, and literal autolinks all work.
Fenced code blocks with a supported declared language receive syntax highlighting; unknown and undeclared languages stay plain.
Components are flow-level JSX elements from the built-in [component registry](/components/), plus scoped child components such as `Annotation`, `Column`, `Entry`, `Option`, and `Score` that are valid only in the hierarchy declared by their parent.
Component attributes are strings (`title="Rollout"`) or bare shorthand booleans (`showLineNumbers`) where a component's schema allows them.
A self-closing [`Slide`](/components/slide/) marker may appear directly above a top-level h2 to apply one registered slide type.
A `user-journey` marker may instead type an h3 sub-slide inside an h2 group; an untyped heading remains valid.

## What a plan may not contain

- `import` and `export` statements.
- `{expression}` syntax, in components or inline (including `{/* comments */}`).
- Inline (text-level) JSX; components must stand alone at flow level.
- Unknown component names, unknown attributes, spread attributes, expression-valued attributes, and duplicate attributes.
- Four-space indented code blocks; MDX treats indented text as paragraphs, so always use fenced code blocks.
- HTML comments and angle-bracket `<url>` autolinks.

Because `<` and `{` begin MDX syntax, write them in code spans or fences when you need them literally in prose.

## Section guide

| Read this                                                    | When                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| [Anatomy of a plan](/authoring/anatomy-of-a-plan/)           | You are starting a plan and want the shape it should take   |
| [Where each rule lives](/authoring/where-rules-live/)        | You are not sure which surface owns a rule you need         |
| [Choose the right component](/authoring/choose-a-component/) | Two components look interchangeable                         |
| [Slide types](/authoring/slide-types/)                       | You are about to mark a section with a `Slide` type         |
| [Fix a validation error](/authoring/fix-a-validation-error/) | `validate` told you no and you want the edit that clears it |
| [Components](/components/)                                   | You need one component's exact attributes and shapes        |

## Next

[Anatomy of a plan](/authoring/anatomy-of-a-plan/) — the shape every plan shares, annotated
once.
