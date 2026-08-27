// Renders GraphqlOperation's typed fields and exact portable examples.

import {
  markdownFromHast,
  markdownInlineCode,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledGraphqlOperation } from "./compile.js";

const fieldTable = (
  title: string,
  fields: CompiledGraphqlOperation["inputFields"],
): ReadonlyArray<string> =>
  fields.length === 0
    ? []
    : [
        title,
        markdownTable({
          headers: ["Name", "Type", "Default", "Description"],
          rows: fields.map((field) => [
            markdownInlineText(field.name),
            markdownInlineText(field.fieldType),
            markdownInlineText(field.defaultValue ?? ""),
            markdownFromHast(field.children),
          ]),
        }),
      ];

export const graphqlOperationMarkdown: ComponentMarkdownRenderer<
  CompiledGraphqlOperation
> = (model) => {
  const description = markdownFromHast(model.description);
  return [
    `### ${model.kind} ${markdownInlineText(model.name)}`,
    ...(model.access === undefined
      ? []
      : [`**Access:** ${markdownInlineText(model.access)}`]),
    ...(model.deprecated
      ? [
          `**Deprecated:** Yes${model.deprecationReason === undefined ? "" : ` — ${markdownInlineText(model.deprecationReason)}`}`,
        ]
      : []),
    ...(description === "" ? [] : [description]),
    ...(model.args.length === 0
      ? []
      : [
          "#### Arguments",
          markdownTable({
            headers: ["Name", "Type", "Description"],
            rows: model.args.map((argument) => [
              markdownInlineText(argument.name),
              markdownInlineText(argument.argumentType),
              markdownFromHast(argument.children),
            ]),
          }),
        ]),
    ...fieldTable("#### Input fields", model.inputFields),
    ...fieldTable("#### Payload fields", model.payloadFields),
    ...(model.returns === undefined
      ? []
      : [
          `**Returns:** ${markdownInlineCode(model.returns.returnType)}`,
          markdownFromHast(model.returns.children),
        ]),
    ...(model.operation === undefined
      ? []
      : ["#### Operation", markdownFromHast(model.operation.children)]),
    ...(model.variables === undefined
      ? []
      : ["#### Variables", markdownFromHast(model.variables.children)]),
    ...model.responses.flatMap((response, index) => [
      `#### Response${response.label === undefined ? ` ${index + 1}` : ` — ${markdownInlineText(response.label)}`}`,
      markdownFromHast(response.children),
    ]),
  ]
    .filter((entry) => entry !== "")
    .join("\n\n");
};
