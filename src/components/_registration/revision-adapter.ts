// Owns the component-side revision adapter helpers: canonical semantic state,
// authored semantic text, and a typed read-only presentation input.

import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import type { DocumentOutline } from "../_model/document-outline/document-outline.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export type ComponentRevisionContext = {
  readonly outline: DocumentOutline;
};

export type ComponentRevisionAdapter<Model> = {
  readonly semantic: (
    model: Model,
    context: ComponentRevisionContext,
  ) => JsonValue;
  readonly text: (model: Model, context: ComponentRevisionContext) => string;
  readonly view: ComponentType<{
    readonly model: Model;
    readonly outline: DocumentOutline;
  }>;
};

const isRevisionLocalKey = (key: string): boolean =>
  key === "position" || key === "anchor" || /Anchor$/.test(key);

/** Removes source-position and generated-anchor state from one JSON-safe model. */
export const canonicalRevisionValue = (value: unknown, key = ""): JsonValue => {
  if (isRevisionLocalKey(key)) return null;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalRevisionValue(entry));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => !isRevisionLocalKey(entryKey))
        .map(([entryKey, entryValue]) => [
          entryKey,
          canonicalRevisionValue(entryValue, entryKey),
        ]),
    );
  }
  return null;
};

const isPresentationMetadataKey = (key: string): boolean =>
  key === "id" ||
  /Id$/.test(key) ||
  key === "type" ||
  key === "tagName" ||
  key === "tone" ||
  /Tone$/.test(key) ||
  key === "status" ||
  key === "layout" ||
  key === "scoring" ||
  key === "interaction";

const semanticStrings = (value: unknown, key = ""): ReadonlyArray<string> => {
  if (isRevisionLocalKey(key) || isPresentationMetadataKey(key)) return [];
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => semanticStrings(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([entryKey, entryValue]) =>
      semanticStrings(entryValue, entryKey),
    );
  }
  return [];
};

/** Supplies the common semantic contract while preserving the component's view. */
export const defineRevisionAdapter = <Model>({
  view,
}: {
  readonly view: ComponentType<{ readonly model: Model }>;
}): ComponentRevisionAdapter<Model> => {
  const RevisionView = ({
    model,
  }: {
    readonly model: Model;
    readonly outline: DocumentOutline;
  }): ReactNode => createElement(view, { model });
  return {
    semantic: (model) => canonicalRevisionValue(model),
    text: (model) => semanticStrings(model).join("\n"),
    view: RevisionView,
  };
};

/** Supplies the same semantic contract to an outline-aware component view. */
export const defineOutlineRevisionAdapter = <Model>({
  view,
}: {
  readonly view: ComponentType<{
    readonly model: Model;
    readonly outline: DocumentOutline;
  }>;
}): ComponentRevisionAdapter<Model> => ({
  semantic: (model) => canonicalRevisionValue(model),
  text: (model) => semanticStrings(model).join("\n"),
  view,
});
