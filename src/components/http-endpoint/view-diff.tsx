// Presents changed HttpEndpoint fields without duplicating whole cards.

import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledHttpEndpoint } from "./compile.js";
import type { CompiledHttpEndpointDiff } from "./compile-diff.js";
import { HttpEndpoint } from "./view.js";

const project = (
  model: CompiledHttpEndpoint,
  fields: ReadonlySet<string>,
): CompiledHttpEndpoint => ({
  ...model,
  description: fields.has("Description") ? model.description : [],
  params: model.params.filter((param) =>
    fields.has(
      `${
        (
          {
            path: "Path parameter",
            query: "Query parameter",
            header: "Header",
            body: "Body field",
          } as const
        )[param.location]
      }: ${param.name}`,
    ),
  ),
  ...(model.request === undefined ||
  (!fields.has("Request body") && !fields.has("Request example"))
    ? { request: undefined }
    : {
        request: {
          ...(fields.has("Request body") &&
          model.request.contentType !== undefined
            ? { contentType: model.request.contentType }
            : {}),
          children: fields.has("Request example") ? model.request.children : [],
        },
      }),
  responses: model.responses.filter((response) =>
    fields.has(
      `Response: ${response.status}${response.label === undefined ? "" : ` ${response.label}`}`,
    ),
  ),
});
export const HttpEndpointDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledHttpEndpointDiff;
  readonly controlId: string;
}) => (
  <NamedFieldDiffView
    model={model}
    controlId={controlId}
    view={HttpEndpoint}
    project={project}
  />
);
