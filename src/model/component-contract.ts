// Owns the authored component contract shared by feature renderers and the
// registry: renderer inputs, scoped-child policies, and attribute validation.

import type { Element, ElementContent, Root } from "hast";
import type { DiagnosticCollector } from "./diagnostics.js";

type NodePosition = Root["position"];

export type ComponentAttributeValue = string | boolean;

export type ComponentAttributeSchemaEntry =
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

export type ComponentAttributeSchema = Readonly<
  Record<string, ComponentAttributeSchemaEntry>
>;

type ValidatedAttributeValue<Entry extends ComponentAttributeSchemaEntry> =
  Entry extends {
    readonly kind: "enum";
    readonly values: ReadonlyArray<infer Value extends string>;
  }
    ? Value | undefined
    : Entry extends { readonly kind: "string" }
      ? string | undefined
      : true | undefined;

export type ValidatedComponentAttributes<
  Schema extends ComponentAttributeSchema,
> = {
  readonly [Name in keyof Schema]: ValidatedAttributeValue<Schema[Name]>;
};

export type ScopedChild = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children: ReadonlyArray<ElementContent>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
  readonly position: NodePosition;
};

export type ComponentIdAllocator = {
  readonly allocate: (input: {
    readonly prefix: string;
    readonly label: string;
    readonly fallbackId: string;
  }) => string;
};

/** Creates one authored-order id namespace for a rendered document. */
export const createComponentIdAllocator = ({
  reservedIds = [],
}: {
  readonly reservedIds?: ReadonlyArray<string>;
} = {}): ComponentIdAllocator => {
  const used = new Set(reservedIds);
  const nextSuffixes = new Map<string, number>();
  return {
    allocate: ({ prefix, label, fallbackId }) => {
      const slug = label
        .trim()
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
        .replace(/\s+/gu, "-")
        .replace(/-+/gu, "-")
        .replace(/^-|-$/gu, "");
      const preferredId = slug === "" ? fallbackId : `${prefix}-${slug}`;
      let id = preferredId;
      let nextSuffix = nextSuffixes.get(preferredId) ?? 2;
      while (used.has(id)) {
        id = `${preferredId}-${nextSuffix}`;
        nextSuffix += 1;
      }
      used.add(id);
      nextSuffixes.set(preferredId, nextSuffix);
      return id;
    },
  };
};

export type ComponentRenderer = (input: {
  readonly attributes: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children: ReadonlyArray<ElementContent>;
  readonly scopedChildren: ReadonlyArray<ScopedChild>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
  readonly ids?: ComponentIdAllocator;
}) => Element;

export type MarkdownBodyNodeKind =
  | "heading"
  | "footnoteReference"
  | "footnoteDefinition"
  | "registeredComponent";

export type MarkdownBodyPolicy = {
  readonly prohibited: Readonly<Partial<Record<MarkdownBodyNodeKind, string>>>;
};

export type ScopedChildDefinition = {
  readonly kind: "scoped-child";
  readonly markdownBody?: MarkdownBodyPolicy;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
};

/** Compiles one authored component into its plan model without rendering. */
export type ComponentModelCompiler = (
  input: Parameters<ComponentRenderer>[0],
) => unknown;

/** Renders one component instance to a static HTML string. */
export type ComponentStaticRenderer = (
  input: Parameters<ComponentRenderer>[0],
) => string;

export type ComponentDefinition = {
  // Optional so isolated registries can remain render-only; rendering never
  // requires model exposure.
  readonly compile?: ComponentModelCompiler;
  readonly renderStatic: ComponentStaticRenderer;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
};

// Validates shared static attribute shapes in schema order, then reports every
// attribute outside that schema in authored order.
export function validateComponentAttributes<
  const Schema extends ComponentAttributeSchema,
>(input: {
  readonly component: string;
  readonly attributes: Readonly<Record<string, ComponentAttributeValue>>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
  readonly schema: Schema;
}): ValidatedComponentAttributes<Schema>;
export function validateComponentAttributes({
  component,
  attributes,
  position,
  diagnostics,
  schema,
}: {
  readonly component: string;
  readonly attributes: Readonly<Record<string, ComponentAttributeValue>>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
  readonly schema: ComponentAttributeSchema;
}): Readonly<Record<string, ComponentAttributeValue | undefined>> {
  const validated: Array<
    readonly [string, ComponentAttributeValue | undefined]
  > = [];
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
        message: `Unknown attribute "${name}" on ${component}`,
        position,
      });
    }
  }
  return Object.fromEntries(validated);
}
