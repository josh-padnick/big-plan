import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedField,
  type NamedFieldDiff,
  unionNamedFields,
} from "../_model/component-diff/named-fields.js";
import type { CompiledGrpcMethod } from "./compile.js";

const FIELD_LABELS = {
  request: "Request field",
  response: "Response field",
} as const;

export type CompiledGrpcMethodDiff = NamedFieldDiff<CompiledGrpcMethod>;
const fieldsFor = (
  model: CompiledGrpcMethod,
): ReadonlyArray<NamedField<CompiledGrpcMethod>> => [
  {
    name: `rpc ${model.name}`,
    value: (value) => ({
      service: value.service,
      name: value.name,
      request: value.request,
      response: value.response,
      kind: value.kind,
      deprecated: value.deprecated,
    }),
  },
  { name: "Description", value: (value) => value.description },
  ...[...model.requestFields, ...model.responseFields].map((field) => ({
    name: `${FIELD_LABELS[field.side]}: ${field.name}`,
    value: (value: CompiledGrpcMethod) =>
      [...value.requestFields, ...value.responseFields].find(
        (candidate) =>
          candidate.side === field.side && candidate.name === field.name,
      ),
  })),
  ...model.errors.map((error) => ({
    name: `Status code: ${error.code}`,
    value: (value: CompiledGrpcMethod) =>
      value.errors.find((candidate) => candidate.code === error.code),
  })),
  { name: "Example", value: (value) => value.examples },
  { name: "Proto", value: (value) => value.proto },
];
export const compileGrpcMethodDiff = (
  input: ComponentDiffInput<CompiledGrpcMethod>,
): CompiledGrpcMethodDiff => {
  const sample = input.status === "removed" ? input.baseline : input.proposed;
  const fields =
    input.status === "changed"
      ? unionNamedFields(fieldsFor(input.baseline), fieldsFor(input.proposed))
      : fieldsFor(sample);
  return compileNamedFieldDiff(input, fields);
};
