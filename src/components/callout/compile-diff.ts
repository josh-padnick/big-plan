// Derives the Callout diff model from component-owned text and type fields.

import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedFieldDiff,
} from "../_model/component-diff/named-fields.js";
import type { CompiledCallout } from "./compile.js";

export type CompiledCalloutDiff = NamedFieldDiff<CompiledCallout>;
export const compileCalloutDiff = (
  input: ComponentDiffInput<CompiledCallout>,
): CompiledCalloutDiff =>
  compileNamedFieldDiff(input, [
    { name: "Type", value: (model) => model.type },
    { name: "Title", value: (model) => model.title },
    { name: "Body", value: (model) => model.body },
  ]);
