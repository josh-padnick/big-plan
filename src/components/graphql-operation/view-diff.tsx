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
    fields.has(`${field.side}: ${field.name}`),
  ),
  payloadFields: model.payloadFields.filter((field) =>
    fields.has(`${field.side}: ${field.name}`),
  ),
  ...(fields.has("Returns") ? {} : { returns: undefined }),
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
