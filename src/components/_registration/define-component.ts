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
import type {
  ComponentDiffInput,
  ComponentDiffModel,
  DefaultComponentDiffModel,
} from "../_model/component-diff/contract.js";
import { DefaultComponentDiffView } from "../_shared/component-diff/default-component-diff-view.js";

/**
 * What the deck transform needs to place one component instance in the
 * document outline. A part starts a new act; any marked instance is a slide
 * boundary. The instance's markup stays with its view.
 */
export type OutlineMarker =
  | { readonly kind: "part"; readonly title: string; readonly id?: string }
  | { readonly kind: "boundary" }
  | {
      readonly kind: "slide";
      readonly type: SlideTypeId;
      readonly name?: string;
      readonly toc?: string;
    };

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

export type CompiledComponentDiff = {
  readonly model: ComponentDiffModel;
  readonly presentation: (instanceKey: string) => ReactNode;
};

export type ComponentDefinition = {
  readonly compile: (input: ComponentCompilerInput) => CompiledComponent;
  readonly compileDiff: (
    input: ComponentDiffInput<unknown>,
  ) => CompiledComponentDiff;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
  // Present when the component is authorable only as a direct child of the
  // document root. The string is the author-facing diagnostic every command
  // reports for an instance authored below the root, because the pre-HAST
  // authoring pass - not delivery - owns the check.
  readonly topLevelOnly?: string;
};

type ComponentDiffOptions<Model, DiffModel> =
  | {
      readonly diff?: undefined;
      readonly diffView?: undefined;
    }
  | {
      readonly diff: (input: ComponentDiffInput<Model>) => DiffModel;
      readonly diffView: ComponentType<{ readonly model: DiffModel }>;
    };

type ComponentOptions<Model, DiffModel> = ComponentDiffOptions<
  Model,
  DiffModel
> & {
  readonly compile: ComponentModelCompiler<Model>;
  readonly view: ComponentType<{ readonly model: Model }>;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
  readonly topLevelOnly?: string;
};

/** Pairs one concrete model compiler with the React view that consumes it. */
export const defineComponent = <
  Model,
  DiffModel = DefaultComponentDiffModel<Model>,
>({
  compile,
  view,
  diff,
  diffView,
  scopedChildren,
  topLevelOnly,
}: ComponentOptions<Model, DiffModel>): ComponentDefinition => ({
  compile: (input) => {
    const model = compile(input);
    return {
      model,
      presentation: () => createElement(view, { model }),
    };
  },
  compileDiff: (input) => {
    const typedInput = input as ComponentDiffInput<Model>;
    const model = diff === undefined ? typedInput : diff(typedInput);
    return {
      model,
      presentation: (instanceKey) =>
        diffView === undefined
          ? createElement(DefaultComponentDiffView<Model>, {
              model: typedInput,
              view,
              controlId: `component-diff-${instanceKey}`,
            })
          : createElement(diffView, { model: model as DiffModel }),
    };
  },
  ...(scopedChildren === undefined ? {} : { scopedChildren }),
  ...(topLevelOnly === undefined ? {} : { topLevelOnly }),
});

/**
 * Pairs one model compiler with a view that also consumes the completed
 * document outline. Where no completed outline exists (model
 * materialization, direct presentation), the view renders against the empty
 * outline and its outline-fed slots stay blank.
 */
export const defineOutlineComponent = <
  Model,
  DiffModel = DefaultComponentDiffModel<Model>,
>({
  compile,
  view,
  diff,
  diffView,
  marker,
  scopedChildren,
  topLevelOnly,
}: ComponentDiffOptions<Model, DiffModel> & {
  readonly compile: ComponentModelCompiler<Model>;
  readonly view: ComponentType<{
    readonly model: Model;
    readonly outline: DocumentOutline;
  }>;
  readonly marker: (model: Model) => OutlineMarker;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
  readonly topLevelOnly?: string;
}): ComponentDefinition => {
  const OutlineView = ({ model }: { readonly model: Model }) =>
    createElement(view, {
      model,
      outline: EMPTY_DOCUMENT_OUTLINE,
    });
  return {
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
    compileDiff: (input) => {
      const typedInput = input as ComponentDiffInput<Model>;
      const model = diff === undefined ? typedInput : diff(typedInput);
      return {
        model,
        presentation: (instanceKey) =>
          diffView === undefined
            ? createElement(DefaultComponentDiffView<Model>, {
                model: typedInput,
                view: OutlineView,
                controlId: `component-diff-${instanceKey}`,
              })
            : createElement(diffView, { model: model as DiffModel }),
      };
    },
    ...(scopedChildren === undefined ? {} : { scopedChildren }),
    ...(topLevelOnly === undefined ? {} : { topLevelOnly }),
  };
};
