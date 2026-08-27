// Renders GrpcMethod's transport shape, fields, errors, and exact examples.

import {
  markdownFromHast,
  markdownHeading,
  markdownInlineCode,
  markdownInlineText,
  markdownTable,
  markdownTableProse,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledGrpcMethod } from "./compile.js";

const grpcFields = (
  title: string,
  fields: CompiledGrpcMethod["requestFields"],
): ReadonlyArray<string> => {
  if (fields.length === 0) return [];
  const rows = fields.map((field) => ({
    field,
    prose: markdownTableProse(field.children),
  }));
  return [
    title,
    markdownTable({
      headers: ["Name", "Type", "Description"],
      rows: rows.map(({ field, prose }) => [
        markdownInlineText(field.name),
        markdownInlineText(field.fieldType ?? ""),
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

export const grpcMethodMarkdown: ComponentMarkdownRenderer<
  CompiledGrpcMethod
> = (model, { headingOffset }) => {
  const description = markdownFromHast(model.description);
  const errors = model.errors.map((error) => ({
    error,
    prose: markdownTableProse(error.children),
  }));
  return [
    markdownHeading({
      level: 3,
      offset: headingOffset,
      text: markdownInlineText(`${model.service}/${model.name}`),
    }),
    `**Transport:** ${model.kind} · Request ${markdownInlineCode(model.request)} · Response ${markdownInlineCode(model.response)}`,
    ...(model.deprecated ? ["**Deprecated:** Yes"] : []),
    ...(description === "" ? [] : [description]),
    ...grpcFields(
      markdownHeading({
        level: 4,
        offset: headingOffset,
        text: "Request fields",
      }),
      model.requestFields,
    ),
    ...grpcFields(
      markdownHeading({
        level: 4,
        offset: headingOffset,
        text: "Response fields",
      }),
      model.responseFields,
    ),
    ...(errors.length === 0
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: "Errors",
          }),
          markdownTable({
            headers: ["Code", "Meaning"],
            rows: errors.map(({ error, prose }) => [
              markdownInlineText(error.code),
              prose.cell,
            ]),
          }),
          ...errors.flatMap(({ error, prose }) =>
            prose.blocks === undefined
              ? []
              : [`**${markdownInlineText(error.code)}**\n\n${prose.blocks}`],
          ),
        ]),
    ...model.examples.flatMap((example, index) => [
      markdownHeading({
        level: 4,
        offset: headingOffset,
        text: `Example${example.label === undefined ? ` ${index + 1}` : ` — ${markdownInlineText(example.label)}`}`,
      }),
      markdownFromHast(example.children),
    ]),
    ...(model.proto === undefined
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: "Proto",
          }),
          markdownFromHast(model.proto),
        ]),
  ].join("\n\n");
};
