// Renders HttpEndpoint's full portable request and response contract.

import {
  markdownFromHast,
  markdownHeading,
  markdownInlineText,
  markdownTable,
  markdownTableProse,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledHttpEndpoint } from "./compile.js";

export const httpEndpointMarkdown: ComponentMarkdownRenderer<
  CompiledHttpEndpoint
> = (model, { headingOffset }) => {
  const description = markdownFromHast(model.description);
  const params = model.params.map((param) => ({
    param,
    prose: markdownTableProse(param.children),
  }));
  return [
    markdownHeading({
      level: 3,
      offset: headingOffset,
      text: `${model.method} ${markdownInlineText(model.path)}`,
    }),
    ...(model.summary === undefined ? [] : [markdownInlineText(model.summary)]),
    ...(model.auth === undefined
      ? []
      : [`**Authentication:** ${markdownInlineText(model.auth)}`]),
    ...(model.deprecated ? ["**Deprecated:** Yes"] : []),
    ...(description === "" ? [] : [description]),
    ...(params.length === 0
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: "Parameters",
          }),
          markdownTable({
            headers: [
              "Name",
              "Location",
              "Type",
              "Required",
              "Default",
              "Description",
            ],
            rows: params.map(({ param, prose }) => [
              markdownInlineText(param.name),
              markdownInlineText(param.location),
              markdownInlineText(param.dataType ?? ""),
              param.required ? "Yes" : "No",
              markdownInlineText(param.defaultValue ?? ""),
              prose.cell,
            ]),
          }),
          ...params.flatMap(({ param, prose }) =>
            prose.blocks === undefined
              ? []
              : [`**${markdownInlineText(param.name)}**\n\n${prose.blocks}`],
          ),
        ]),
    ...(model.request === undefined
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: `Request${model.request.contentType === undefined ? "" : ` — ${markdownInlineText(model.request.contentType)}`}`,
          }),
          markdownFromHast(model.request.children),
        ]),
    ...model.responses.flatMap((response) => [
      markdownHeading({
        level: 4,
        offset: headingOffset,
        text: `Response ${response.status}${response.label === undefined ? "" : ` — ${markdownInlineText(response.label)}`}`,
      }),
      markdownFromHast(response.children),
    ]),
  ].join("\n\n");
};
