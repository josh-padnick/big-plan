import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledGrpcMethod } from "./compile.js";
import type { CompiledGrpcMethodDiff } from "./compile-diff.js";
import { GrpcMethod } from "./view.js";

const project = (
  model: CompiledGrpcMethod,
  fields: ReadonlySet<string>,
): CompiledGrpcMethod => ({
  ...model,
  description: fields.has("Description") ? model.description : [],
  requestFields: model.requestFields.filter((field) =>
    fields.has(`Request field: ${field.name}`),
  ),
  responseFields: model.responseFields.filter((field) =>
    fields.has(`Response field: ${field.name}`),
  ),
  errors: model.errors.filter((error) =>
    fields.has(`Status code: ${error.code}`),
  ),
  examples: fields.has("Example") ? model.examples : [],
  ...(fields.has("Proto") ? {} : { proto: undefined }),
});
export const GrpcMethodDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledGrpcMethodDiff;
  readonly controlId: string;
}) => (
  <NamedFieldDiffView
    model={model}
    controlId={controlId}
    view={GrpcMethod}
    project={project}
  />
);
