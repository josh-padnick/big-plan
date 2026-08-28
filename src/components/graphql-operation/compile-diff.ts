// Derives GraphqlOperation diffs from stable operation-field identities.

import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedField,
  type NamedFieldDiff,
  unionNamedFields,
} from "../_model/component-diff/named-fields.js";
import type { CompiledGraphqlOperation } from "./compile.js";

const FIELD_LABELS = {
  input: "Input field",
  payload: "Payload field",
} as const;

export type CompiledGraphqlOperationDiff =
  NamedFieldDiff<CompiledGraphqlOperation>;
const fieldsFor = (
  model: CompiledGraphqlOperation,
): ReadonlyArray<NamedField<CompiledGraphqlOperation>> => [
  {
    name: `${model.kind} ${model.name}`,
    value: (value) => ({
      kind: value.kind,
      name: value.name,
      access: value.access,
      deprecated: value.deprecated,
      deprecationReason: value.deprecationReason,
    }),
  },
  { name: "Description", value: (value) => value.description },
  ...model.args.map((field) => ({
    name: `Argument: ${field.name}`,
    value: (value: CompiledGraphqlOperation) =>
      value.args.find((candidate) => candidate.name === field.name),
  })),
  ...[...model.inputFields, ...model.payloadFields].map((field) => ({
    name: `${FIELD_LABELS[field.side]}: ${field.name}`,
    value: (value: CompiledGraphqlOperation) =>
      [...value.inputFields, ...value.payloadFields].find(
        (candidate) =>
          candidate.side === field.side && candidate.name === field.name,
      ),
  })),
  ...(model.returns === undefined
    ? []
    : [
        {
          name: `Returns: ${model.returns.returnType}`,
          value: (value: CompiledGraphqlOperation) => value.returns,
        },
      ]),
  {
    name: "Example",
    value: (value) => ({
      operation: value.operation,
      variables: value.variables,
      responses: value.responses,
    }),
  },
];
export const compileGraphqlOperationDiff = (
  input: ComponentDiffInput<CompiledGraphqlOperation>,
): CompiledGraphqlOperationDiff => {
  const sample = input.status === "removed" ? input.baseline : input.proposed;
  const fields =
    input.status === "changed"
      ? unionNamedFields(fieldsFor(input.baseline), fieldsFor(input.proposed))
      : fieldsFor(sample);
  return compileNamedFieldDiff(input, fields);
};
