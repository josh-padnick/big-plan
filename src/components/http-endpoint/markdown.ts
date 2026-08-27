// Renders HttpEndpoint's full portable request and response contract.

import {
  markdownFromHast,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledHttpEndpoint } from "./compile.js";

export const httpEndpointMarkdown: ComponentMarkdownRenderer<
  CompiledHttpEndpoint
> = (model) => {
  const description = markdownFromHast(model.description);
  return [
    `### ${model.method} ${markdownInlineText(model.path)}`,
    ...(model.summary === undefined ? [] : [markdownInlineText(model.summary)]),
    ...(model.auth === undefined
      ? []
      : [`**Authentication:** ${markdownInlineText(model.auth)}`]),
    ...(model.deprecated ? ["**Deprecated:** Yes"] : []),
    ...(description === "" ? [] : [description]),
    ...(model.params.length === 0
      ? []
      : [
          "#### Parameters",
          markdownTable({
            headers: [
              "Name",
              "Location",
              "Type",
              "Required",
              "Default",
              "Description",
            ],
            rows: model.params.map((param) => [
              markdownInlineText(param.name),
              markdownInlineText(param.location),
              markdownInlineText(param.dataType ?? ""),
              param.required ? "Yes" : "No",
              markdownInlineText(param.defaultValue ?? ""),
              markdownFromHast(param.children),
            ]),
          }),
        ]),
    ...(model.request === undefined
      ? []
      : [
          `#### Request${model.request.contentType === undefined ? "" : ` — ${markdownInlineText(model.request.contentType)}`}`,
          markdownFromHast(model.request.children),
        ]),
    ...model.responses.flatMap((response) => [
      `#### Response ${response.status}${response.label === undefined ? "" : ` — ${markdownInlineText(response.label)}`}`,
      markdownFromHast(response.children),
    ]),
  ].join("\n\n");
};
