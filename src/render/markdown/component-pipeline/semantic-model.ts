import type { Element } from "hast";

const nestedComponentModels = new WeakMap<object, unknown>();

export const attachNestedComponentModel = ({
  element,
  model,
}: {
  readonly element: Element;
  readonly model: unknown;
}): Element => {
  nestedComponentModels.set(element, model);
  return element;
};

export const semanticComponentModel = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(semanticComponentModel);
  if (value === null || typeof value !== "object") return value;
  const nested = nestedComponentModels.get(value);
  if (nested !== undefined) {
    return { nestedComponent: semanticComponentModel(nested) };
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "data-authored-prose")
      .map(([key, entry]) => [key, semanticComponentModel(entry)]),
  );
};
