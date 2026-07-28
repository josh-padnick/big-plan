# Working with plan components

Start with the root [agent guide](../../AGENTS.md) for Big Plan's overall architecture.
This page answers the narrower question: where should component code go?

## What counts as a component?

An **authorable component** is something a plan author can write directly in MDX, such as `<Callout>` or `<FileTree>`.
Its folder owns the whole concept: what authors may write, the validated data Big Plan derives from it, and what readers see.

Code that coordinates an entire document belongs in the [renderer](../render/README.md), not here.

## Adding or changing an authorable component

Give each authorable concept a plainly named folder, such as `callout/` or `file-tree/`.
Keep the parts of that concept together:

| Responsibility                       | Typical home                                | What it owns                                                                                                                      |
| ------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Interpret authored MDX               | `compile.ts`                                | Validates attributes and children, reports authoring errors, and produces a framework-neutral model. It must not depend on React. |
| Present the model                    | `view.tsx`                                  | Turns the validated model into the React view used for HTML delivery. It does not re-parse authored MDX.                          |
| Connect compilation and presentation | `definition.ts`                             | Pairs the compiler with its view and declares any allowed nested components.                                                      |
| Style the view                       | `styles.css`                                | Owns styles specific to this component.                                                                                           |
| Prove behavior                       | Colocated `*.test.ts` or `*.test.tsx` files | Tests the rule or view beside the code that owns it.                                                                              |

The exact set of files can vary with the component.
The important boundary is that authoring rules stay framework-neutral, presentation consumes the resulting model, and component-specific behavior remains in the component's folder.

## When code is shared

Folders beginning with `_` are internal support code.
Plan authors cannot use their names as MDX components.

- Use `_authoring/` for parsing, validation, diagnostics, or authored-body behavior that genuinely belongs to multiple component compilers and does not depend on React.
- Use `_registration/` for the registry that maps allowed MDX names to component definitions and for the small adapter that pairs a compiler with its React view.
- Use `_shared/` for reusable visual building blocks, such as an internal badge or annotation card, that authors must never write directly in a plan.

Do not move code into an underscore folder merely because it might become reusable.
Keep it with the component that owns it until another real consumer demonstrates that the behavior is shared.

## A quick placement test

- Can a plan author write this concept in MDX? Give it an authorable component folder.
- Is it component-specific parsing, rendering, styling, or testing? Keep it in that component folder.
- Is it framework-neutral authoring behavior used by multiple components? Put it in `_authoring/`.
- Does it connect component definitions to the closed registry? Put it in `_registration/`.
- Is it reusable React UI that is never valid MDX? Put it in `_shared/`.
- Does it operate on the document as a whole? Put it in `src/render/`.
