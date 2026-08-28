// Derives HttpEndpoint diffs from stable endpoint-field identities.

import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedField,
  type NamedFieldDiff,
  unionNamedFields,
} from "../_model/component-diff/named-fields.js";
import type { CompiledHttpEndpoint } from "./compile.js";

const PARAM_LABELS = {
  path: "Path parameter",
  query: "Query parameter",
  header: "Header",
  body: "Body field",
} as const;

export type CompiledHttpEndpointDiff = NamedFieldDiff<CompiledHttpEndpoint>;
const fieldsFor = (
  model: CompiledHttpEndpoint,
): ReadonlyArray<NamedField<CompiledHttpEndpoint>> => [
  {
    name: `${model.method} ${model.path}`,
    value: (value) => ({
      method: value.method,
      path: value.path,
      summary: value.summary,
      auth: value.auth,
      deprecated: value.deprecated,
    }),
  },
  { name: "Description", value: (value) => value.description },
  ...model.params.map((param) => ({
    name: `${PARAM_LABELS[param.location]}: ${param.name}`,
    value: (value: CompiledHttpEndpoint) =>
      value.params.find(
        (candidate) =>
          candidate.location === param.location &&
          candidate.name === param.name,
      ),
  })),
  { name: "Request body", value: (value) => value.request },
  ...model.responses.map((response) => ({
    name: `Response: ${response.status}${response.label === undefined ? "" : ` ${response.label}`}`,
    value: (value: CompiledHttpEndpoint) =>
      value.responses.find((candidate) => candidate.status === response.status),
  })),
];
export const compileHttpEndpointDiff = (
  input: ComponentDiffInput<CompiledHttpEndpoint>,
): CompiledHttpEndpointDiff => {
  const sample = input.status === "removed" ? input.baseline : input.proposed;
  const fields =
    input.status === "changed"
      ? unionNamedFields(fieldsFor(input.baseline), fieldsFor(input.proposed))
      : fieldsFor(sample);
  return compileNamedFieldDiff(input, fields);
};
