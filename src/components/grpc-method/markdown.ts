// Renders GrpcMethod's transport shape, fields, errors, and exact examples.

import {
  markdownFromHast,
  markdownInlineCode,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledGrpcMethod } from "./compile.js";

const grpcFields = (
  title: string,
  fields: CompiledGrpcMethod["requestFields"],
): ReadonlyArray<string> =>
  fields.length === 0
    ? []
    : [
        title,
        markdownTable({
          headers: ["Name", "Type", "Description"],
          rows: fields.map((field) => [
            markdownInlineText(field.name),
            markdownInlineText(field.fieldType ?? ""),
            markdownFromHast(field.children),
          ]),
        }),
      ];

export const grpcMethodMarkdown: ComponentMarkdownRenderer<
  CompiledGrpcMethod
> = (model) => {
  const description = markdownFromHast(model.description);
  return [
    `### ${markdownInlineText(`${model.service}/${model.name}`)}`,
    `**Transport:** ${model.kind} · Request ${markdownInlineCode(model.request)} · Response ${markdownInlineCode(model.response)}`,
    ...(model.deprecated ? ["**Deprecated:** Yes"] : []),
    ...(description === "" ? [] : [description]),
    ...grpcFields("#### Request fields", model.requestFields),
    ...grpcFields("#### Response fields", model.responseFields),
    ...(model.errors.length === 0
      ? []
      : [
          "#### Errors",
          markdownTable({
            headers: ["Code", "Meaning"],
            rows: model.errors.map((error) => [
              markdownInlineText(error.code),
              markdownFromHast(error.children),
            ]),
          }),
        ]),
    ...model.examples.flatMap((example, index) => [
      `#### Example${example.label === undefined ? ` ${index + 1}` : ` — ${markdownInlineText(example.label)}`}`,
      markdownFromHast(example.children),
    ]),
    ...(model.proto === undefined
      ? []
      : ["#### Proto", markdownFromHast(model.proto)]),
  ].join("\n\n");
};
