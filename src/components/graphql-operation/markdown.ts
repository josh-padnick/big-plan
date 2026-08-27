// Renders GraphqlOperation's typed fields and exact portable examples.

import {
  markdownFromHast,
  markdownHeading,
  markdownInlineCode,
  markdownInlineText,
  markdownTable,
  markdownTableProse,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledGraphqlOperation } from "./compile.js";

const fieldTable = (
  title: string,
  fields: CompiledGraphqlOperation["inputFields"],
): ReadonlyArray<string> => {
  if (fields.length === 0) return [];
  const rows = fields.map((field) => ({
    field,
    prose: markdownTableProse(field.children),
  }));
  return [
    title,
    markdownTable({
      headers: ["Name", "Type", "Default", "Description"],
      rows: rows.map(({ field, prose }) => [
        markdownInlineText(field.name),
        markdownInlineText(field.fieldType),
        markdownInlineText(field.defaultValue ?? ""),
        prose.cell,
      ]),
    }),
    ...rows.flatMap(({ field, prose }) =>
      prose.blocks === undefined
        ? []
        : [`**${markdownInlineText(field.name)}**\n\n${prose.blocks}`],
    ),
  ];
};

export const graphqlOperationMarkdown: ComponentMarkdownRenderer<
  CompiledGraphqlOperation
> = (model, { headingOffset }) => {
  const description = markdownFromHast(model.description);
  const args = model.args.map((argument) => ({
    argument,
    prose: markdownTableProse(argument.children),
  }));
  return [
    markdownHeading({
      level: 3,
      offset: headingOffset,
      text: `${model.kind} ${markdownInlineText(model.name)}`,
    }),
    ...(model.access === undefined
      ? []
      : [`**Access:** ${markdownInlineText(model.access)}`]),
    ...(model.deprecated
      ? [
          `**Deprecated:** Yes${model.deprecationReason === undefined ? "" : ` — ${markdownInlineText(model.deprecationReason)}`}`,
        ]
      : []),
    ...(description === "" ? [] : [description]),
    ...(args.length === 0
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: "Arguments",
          }),
          markdownTable({
            headers: ["Name", "Type", "Description"],
            rows: args.map(({ argument, prose }) => [
              markdownInlineText(argument.name),
              markdownInlineText(argument.argumentType),
              prose.cell,
            ]),
          }),
          ...args.flatMap(({ argument, prose }) =>
            prose.blocks === undefined
              ? []
              : [`**${markdownInlineText(argument.name)}**\n\n${prose.blocks}`],
          ),
        ]),
    ...fieldTable(
      markdownHeading({
        level: 4,
        offset: headingOffset,
        text: "Input fields",
      }),
      model.inputFields,
    ),
    ...fieldTable(
      markdownHeading({
        level: 4,
        offset: headingOffset,
        text: "Payload fields",
      }),
      model.payloadFields,
    ),
    ...(model.returns === undefined
      ? []
      : [
          `**Returns:** ${markdownInlineCode(model.returns.returnType)}`,
          markdownFromHast(model.returns.children),
        ]),
    ...(model.operation === undefined
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: "Operation",
          }),
          markdownFromHast(model.operation.children),
        ]),
    ...(model.variables === undefined
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: "Variables",
          }),
          markdownFromHast(model.variables.children),
        ]),
    ...model.responses.flatMap((response, index) => [
      markdownHeading({
        level: 4,
        offset: headingOffset,
        text: `Response${response.label === undefined ? ` ${index + 1}` : ` — ${markdownInlineText(response.label)}`}`,
      }),
      markdownFromHast(response.children),
    ]),
  ]
    .filter((entry) => entry !== "")
    .join("\n\n");
};
