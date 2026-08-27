// Renders GraphqlOperation's typed fields and exact portable examples.

import {
  markdownFromHast,
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
            field.name,
            field.fieldType,
            field.defaultValue ?? "",
            markdownFromHast(field.children),
          ]),
        }),
      ];

export const graphqlOperationMarkdown: ComponentMarkdownRenderer<
  CompiledGraphqlOperation
> = (model) => {
  const description = markdownFromHast(model.description);
  return [
    `### ${model.kind} ${model.name}`,
    ...(model.access === undefined ? [] : [`**Access:** ${model.access}`]),
    ...(model.deprecated
      ? [
          `**Deprecated:** Yes${model.deprecationReason === undefined ? "" : ` — ${model.deprecationReason}`}`,
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
              argument.name,
              argument.argumentType,
              markdownFromHast(argument.children),
            ]),
          }),
        ]),
    ...fieldTable("#### Input fields", model.inputFields),
    ...fieldTable("#### Payload fields", model.payloadFields),
    ...(model.returns === undefined
      ? []
      : [
          `**Returns:** \`${model.returns.returnType}\``,
          markdownFromHast(model.returns.children),
        ]),
    ...(model.operation === undefined
      ? []
      : ["#### Operation", markdownFromHast(model.operation.children)]),
    ...(model.variables === undefined
      ? []
      : ["#### Variables", markdownFromHast(model.variables.children)]),
    ...model.responses.flatMap((response, index) => [
      `#### Response${response.label === undefined ? ` ${index + 1}` : ` — ${response.label}`}`,
      markdownFromHast(response.children),
    ]),
  ]
    .filter((entry) => entry !== "")
    .join("\n\n");
};
