// Owns the React-aware component definition seam that keeps each model
// compiler paired type-safely with the React view presenting that model.

import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import type {
  ComponentCompilerInput,
  ComponentModelCompiler,
  ScopedChildDefinition,
} from "../_authoring/contract.js";

export type CompiledComponent = {
  readonly model: unknown;
  readonly presentation: () => ReactNode;
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
