// Renders GrpcMethod's transport shape, fields, errors, and exact examples.

import {
  markdownFromHast,
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
            field.name,
            field.fieldType ?? "",
            markdownFromHast(field.children),
          ]),
        }),
      ];

export const grpcMethodMarkdown: ComponentMarkdownRenderer<
  CompiledGrpcMethod
> = (model) => {
  const description = markdownFromHast(model.description);
  return [
    `### ${model.service}/${model.name}`,
    `**Transport:** ${model.kind} · Request \`${model.request}\` · Response \`${model.response}\``,
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
              error.code,
              markdownFromHast(error.children),
            ]),
          }),
        ]),
    ...model.examples.flatMap((example, index) => [
      `#### Example${example.label === undefined ? ` ${index + 1}` : ` — ${example.label}`}`,
      markdownFromHast(example.children),
    ]),
    ...(model.proto === undefined
      ? []
      : ["#### Proto", markdownFromHast(model.proto)]),
  ].join("\n\n");
};
