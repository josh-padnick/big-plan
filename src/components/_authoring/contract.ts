// Owns the framework-free authored component contract: compiler inputs,
// scoped-child policies, id allocation, and attribute validation.

import type { ElementContent, Root } from "hast";
import type { DiagnosticCollector } from "./diagnostics.js";

type NodePosition = Root["position"];

export type ComponentAttributeValue = string | boolean;

export type ValidatedAttributeResult = ComponentAttributeValue | number;

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
  | {
      readonly kind: "number";
      // A bounded range is mandatory: an unbounded number is an arbitrary
      // value, and the point of an attribute schema is that it is not.
      readonly min: number;
      readonly max: number;
      readonly integer?: boolean;
      readonly required?: boolean;
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
      : Entry extends { readonly kind: "number" }
        ? number | undefined
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

export type ComponentCompilerInput = {
  readonly attributes: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children: ReadonlyArray<ElementContent>;
  readonly scopedChildren: ReadonlyArray<ScopedChild>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
  readonly ids?: ComponentIdAllocator;
};

/** Compiles one authored component into a framework-free plan model. */
export type ComponentModelCompiler<Model = unknown> = (
  input: ComponentCompilerInput,
) => Model;

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

// Reads a bounded number written as an attribute string. A value outside the
// declared range is reported rather than clamped, so an author never silently
// gets a drawing they did not ask for.
const validateNumberAttribute = ({
  name,
  value,
  entry,
  position,
  diagnostics,
}: {
  readonly name: string;
  readonly value: ComponentAttributeValue | undefined;
  readonly entry: Extract<ComponentAttributeSchemaEntry, { kind: "number" }>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
}): number | undefined => {
  const expectation = `a ${entry.integer === true ? "whole " : ""}number between ${entry.min} and ${entry.max}`;
  if (value === undefined) {
    if (entry.required) {
      diagnostics.add({
        message: `Missing required attribute "${name}"; expected ${expectation}`,
        position,
      });
    }
    return undefined;
  }
  const parsed = typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (
    !Number.isFinite(parsed) ||
    parsed < entry.min ||
    parsed > entry.max ||
    (entry.integer === true && !Number.isInteger(parsed))
  ) {
    diagnostics.add({
      message: `Attribute "${name}" must be ${expectation}`,
      position,
    });
    return undefined;
  }
  return parsed;
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
}): Readonly<Record<string, ValidatedAttributeResult | undefined>> {
  const validated: Array<
    readonly [string, ValidatedAttributeResult | undefined]
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
    if (entry.kind === "number") {
      validated.push([
        name,
        validateNumberAttribute({
          name,
          value,
          entry,
          position,
          diagnostics,
        }),
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
