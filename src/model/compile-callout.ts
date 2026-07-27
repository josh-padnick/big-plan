// Compiles Callout's authored form into its plan model: the semantic type,
// the optional authored title, and the markdown body.

import type { ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
} from "./component-contract.js";

export type CalloutType = "note" | "tip" | "warning" | "danger";

export const CALLOUT_TYPES: ReadonlyArray<CalloutType> = [
  "note",
  "tip",
  "warning",
  "danger",
];

export type CompiledCallout = {
  readonly type: CalloutType;
  readonly title?: string;
  readonly body: ReadonlyArray<ElementContent>;
};

const CALLOUT_SCHEMA = {
  type: { kind: "enum", values: CALLOUT_TYPES, required: true },
  title: { kind: "string" },
} satisfies ComponentAttributeSchema;

/** Compiles one Callout component into the model consumed by rendering. */
export const compileCalloutComponent = ({
  attributes,
  children,
  position,
  diagnostics,
}: Parameters<ComponentRenderer>[0]): CompiledCallout => {
  const validated = validateComponentAttributes({
    component: "Callout",
    attributes,
    position,
    diagnostics,
    schema: CALLOUT_SCHEMA,
  });
  return {
    type: validated.type ?? "note",
    ...(validated.title === undefined ? {} : { title: validated.title }),
    body: children,
  };
};
