// Owns the authored typed-block contract shared by feature renderers and the
// registry: renderer inputs, scoped-child policies, and attribute validation.

import type { Element, ElementContent, Root } from "hast";
import type { DiagnosticCollector } from "./diagnostics.js";

type NodePosition = Root["position"];

export type BlockAttributeValue = string | boolean;

export type BlockAttributeSchemaEntry =
  | {
      readonly kind: "enum";
      readonly values: ReadonlyArray<string>;
      readonly required?: boolean;
    }
  | {
      readonly kind: "string";
      readonly required?: boolean;
      readonly nonEmpty?: boolean;
    }
  | { readonly kind: "booleanShorthand" };

export type BlockAttributeSchema = Readonly<
  Record<string, BlockAttributeSchemaEntry>
>;

type ValidatedAttributeValue<Entry extends BlockAttributeSchemaEntry> =
  Entry extends {
    readonly kind: "enum";
    readonly values: ReadonlyArray<infer Value extends string>;
  }
    ? Value | undefined
    : Entry extends { readonly kind: "string" }
      ? string | undefined
      : true | undefined;

export type ValidatedBlockAttributes<Schema extends BlockAttributeSchema> = {
  readonly [Name in keyof Schema]: ValidatedAttributeValue<Schema[Name]>;
};

export type ScopedChild = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, BlockAttributeValue>>;
  readonly children: ReadonlyArray<ElementContent>;
  readonly position: NodePosition;
};

export type BlockRenderer = (input: {
  readonly attributes: Readonly<Record<string, BlockAttributeValue>>;
  readonly children: ReadonlyArray<ElementContent>;
  readonly scopedChildren: ReadonlyArray<ScopedChild>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
}) => Element;

export type MarkdownBodyNodeKind =
  "heading" | "footnoteReference" | "footnoteDefinition" | "registeredBlock";

export type MarkdownBodyPolicy = {
  readonly prohibited: Readonly<Partial<Record<MarkdownBodyNodeKind, string>>>;
};

export type ScopedChildDefinition = {
  readonly kind: "scoped-child";
  readonly markdownBody?: MarkdownBodyPolicy;
};

export type BlockDefinition = {
  readonly render: BlockRenderer;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
};

// Validates shared static attribute shapes in schema order, then reports every
// attribute outside that schema in authored order.
export function validateBlockAttributes<
  const Schema extends BlockAttributeSchema,
>(input: {
  readonly block: string;
  readonly attributes: Readonly<Record<string, BlockAttributeValue>>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
  readonly schema: Schema;
}): ValidatedBlockAttributes<Schema>;
export function validateBlockAttributes({
  block,
  attributes,
  position,
  diagnostics,
  schema,
}: {
  readonly block: string;
  readonly attributes: Readonly<Record<string, BlockAttributeValue>>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
  readonly schema: BlockAttributeSchema;
}): Readonly<Record<string, BlockAttributeValue | undefined>> {
  const validated: Array<readonly [string, BlockAttributeValue | undefined]> =
    [];
  for (const [name, entry] of Object.entries(schema)) {
    const value = attributes[name];
    if (entry.kind === "enum") {
      const validValue =
        typeof value === "string" && entry.values.includes(value)
          ? value
          : undefined;
      if (validValue === undefined && (value !== undefined || entry.required)) {
        diagnostics.add({
          message: `${value === undefined ? "Missing required" : "Invalid value for"} attribute "${name}"; expected one of: ${entry.values.join(", ")}`,
          position,
        });
      }
      validated.push([name, validValue]);
      continue;
    }
    if (entry.kind === "string") {
      const validValue = typeof value === "string" ? value : undefined;
      if (value === undefined && entry.required) {
        diagnostics.add({
          message: `Missing required attribute "${name}"; expected a string`,
          position,
        });
      } else if (value !== undefined && validValue === undefined) {
        diagnostics.add({
          message: `Attribute "${name}" must be a string`,
          position,
        });
      } else if (entry.nonEmpty && validValue?.trim() === "") {
        diagnostics.add({
          message: `Attribute "${name}" must be a non-empty string`,
          position,
        });
      }
      validated.push([
        name,
        entry.nonEmpty && validValue?.trim() === "" ? undefined : validValue,
      ]);
      continue;
    }
    const validValue = value === true ? true : undefined;
    if (value !== undefined && validValue === undefined) {
      diagnostics.add({
        message: `Attribute "${name}" is a shorthand boolean; use the bare form`,
        position,
      });
    }
    validated.push([name, validValue]);
  }
  for (const name of Object.keys(attributes)) {
    if (!Object.hasOwn(schema, name)) {
      diagnostics.add({
        message: `Unknown attribute "${name}" on ${block}`,
        position,
      });
    }
  }
  return Object.fromEntries(validated);
}
