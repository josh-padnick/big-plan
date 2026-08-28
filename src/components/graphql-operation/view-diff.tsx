// Presents changed GraphqlOperation fields through the shared diff view.

import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledGraphqlOperation } from "./compile.js";
import type { CompiledGraphqlOperationDiff } from "./compile-diff.js";
import { GraphqlOperation } from "./view.js";

const project = (
  model: CompiledGraphqlOperation,
  fields: ReadonlySet<string>,
): CompiledGraphqlOperation => ({
  ...model,
  description: fields.has("Description") ? model.description : [],
  args: model.args.filter((field) => fields.has(`Argument: ${field.name}`)),
  inputFields: model.inputFields.filter((field) =>
    fields.has(`Input field: ${field.name}`),
  ),
  payloadFields: model.payloadFields.filter((field) =>
    fields.has(`Payload field: ${field.name}`),
  ),
  ...(model.returns !== undefined &&
  fields.has(`Returns: ${model.returns.returnType}`)
    ? {}
    : { returns: undefined }),
  ...(fields.has("Example")
    ? {}
    : { operation: undefined, variables: undefined }),
  responses: fields.has("Example") ? model.responses : [],
});
export const GraphqlOperationDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledGraphqlOperationDiff;
  readonly controlId: string;
}) => (
  <NamedFieldDiffView
    model={model}
    controlId={controlId}
    view={GraphqlOperation}
    project={project}
  />
);
