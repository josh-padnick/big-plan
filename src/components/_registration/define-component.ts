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
import type { SlideTypeId } from "../../plan-vocabulary/slide-types/index.js";

/**
 * What the deck transform needs to place one component instance in the
 * document outline. A part starts a new act; any marked instance is a slide
 * boundary. The instance's markup stays with its view.
 */
export type OutlineMarker =
  | { readonly kind: "part"; readonly title: string; readonly id?: string }
  | { readonly kind: "boundary" }
  | { readonly kind: "slide"; readonly type: SlideTypeId };

export type CompiledComponent = {
  readonly model: unknown;
  readonly presentation: () => ReactNode;
  // Present only on outline-aware components: how the instance joins the
  // document outline, and the presentation consuming the completed outline.
  readonly outline?: {
    readonly marker: OutlineMarker;
    readonly present: (outline: DocumentOutline) => ReactNode;
  };
};

export type ComponentDefinition = {
  readonly compile: (input: ComponentCompilerInput) => CompiledComponent;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
};

/** Pairs one concrete model compiler with the React view that consumes it. */
export const defineComponent = <Model>({
  compile,
  view,
  scopedChildren,
}: {
  readonly compile: ComponentModelCompiler<Model>;
  readonly view: ComponentType<{ readonly model: Model }>;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
}): ComponentDefinition => ({
  compile: (input) => {
    const model = compile(input);
    return {
      model,
      presentation: () => createElement(view, { model }),
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
  marker,
  scopedChildren,
}: {
  readonly compile: ComponentModelCompiler<Model>;
  readonly view: ComponentType<{
    readonly model: Model;
    readonly outline: DocumentOutline;
  }>;
  readonly marker: (model: Model) => OutlineMarker;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
}): ComponentDefinition => ({
  compile: (input) => {
    const model = compile(input);
    return {
      model,
      presentation: () =>
        createElement(view, { model, outline: EMPTY_DOCUMENT_OUTLINE }),
      outline: {
        marker: marker(model),
        present: (outline) => createElement(view, { model, outline }),
      },
    };
  },
  ...(scopedChildren === undefined ? {} : { scopedChildren }),
});
