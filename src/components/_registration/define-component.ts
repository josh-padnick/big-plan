// Owns the React-aware component definition seam that keeps each model
// compiler paired type-safely with the React view presenting that model,
// including the outline-aware variant whose view also consumes the completed
// document outline.

import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import type {
  ComponentCompilerInput,
  ComponentModelCompiler,
  ScopedChildDefinition,
} from "../_authoring/contract.js";
import type { DocumentOutline } from "../_model/document-outline/document-outline.js";
import { EMPTY_DOCUMENT_OUTLINE } from "../_model/document-outline/document-outline.js";
import type {
  ComponentRevisionAdapter,
  JsonValue,
} from "./revision-adapter.js";

/**
 * What the deck transform needs to place one component instance in the
 * document outline. A part starts a new act; any marked instance is a slide
 * boundary. The instance's markup stays with its view.
 */
export type OutlineMarker =
  | { readonly kind: "part"; readonly title: string; readonly id?: string }
  | { readonly kind: "boundary" };

export type ComponentRevisionMaterial = {
  readonly semantic: JsonValue;
  readonly text: string;
  readonly presentation: ReactNode;
};

export type CompiledComponentRuntime = {
  readonly model: unknown;
  readonly presentation: () => ReactNode;
  readonly materializeRevision: (
    outline: DocumentOutline,
  ) => ComponentRevisionMaterial;
  // Present only on outline-aware components: how the instance joins the
  // document outline, and the presentation consuming the completed outline.
  readonly outline?: {
    readonly marker: OutlineMarker;
    readonly present: (outline: DocumentOutline) => ReactNode;
  };
};

export type CompiledComponent<Model> = Omit<
  CompiledComponentRuntime,
  "model"
> & {
  readonly model: Model;
};

export type ComponentDefinitionRuntime = {
  readonly compile: (input: ComponentCompilerInput) => CompiledComponentRuntime;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
};

export type ComponentDefinition<Model> = {
  readonly compile: (input: ComponentCompilerInput) => CompiledComponent<Model>;
  readonly revision: ComponentRevisionAdapter<Model>;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
};

/** Pairs one concrete model compiler with the React view that consumes it. */
export const defineComponent = <Model>({
  compile,
  view,
  revision,
  scopedChildren,
}: {
  readonly compile: ComponentModelCompiler<Model>;
  readonly view: ComponentType<{ readonly model: Model }>;
  readonly revision: ComponentRevisionAdapter<Model>;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
}): ComponentDefinition<Model> => ({
  revision,
  compile: (input) => {
    const model = compile(input);
    return {
      model,
      presentation: () => createElement(view, { model }),
      materializeRevision: (outline) => ({
        semantic: revision.semantic(model, { outline }),
        text: revision.text(model, { outline }),
        presentation: createElement(revision.view, { model, outline }),
      }),
    };
  },
  ...(scopedChildren === undefined ? {} : { scopedChildren }),
});

/**
 * Pairs one model compiler with a view that also consumes the completed
 * document outline. Where no completed outline exists (model
 * materialization, direct presentation), the view renders against the empty
 * outline and its outline-fed slots stay blank.
 */
export const defineOutlineComponent = <Model>({
  compile,
  view,
  revision,
  marker,
  scopedChildren,
}: {
  readonly compile: ComponentModelCompiler<Model>;
  readonly view: ComponentType<{
    readonly model: Model;
    readonly outline: DocumentOutline;
  }>;
  readonly revision: ComponentRevisionAdapter<Model>;
  readonly marker: (model: Model) => OutlineMarker;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
}): ComponentDefinition<Model> => ({
  revision,
  compile: (input) => {
    const model = compile(input);
    return {
      model,
      presentation: () =>
        createElement(view, { model, outline: EMPTY_DOCUMENT_OUTLINE }),
      materializeRevision: (outline) => ({
        semantic: revision.semantic(model, { outline }),
        text: revision.text(model, { outline }),
        presentation: createElement(revision.view, { model, outline }),
      }),
      outline: {
        marker: marker(model),
        present: (outline) => createElement(view, { model, outline }),
      },
    };
  },
  ...(scopedChildren === undefined ? {} : { scopedChildren }),
});
