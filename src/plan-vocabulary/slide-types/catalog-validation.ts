// Validates the authored catalog's mechanical completeness without judging
// whether a proposed type belongs in the product.

import type { SlideTypeDefinition } from "./types.js";

export type SlideTypeCatalogFinding = {
  readonly id: string;
  readonly message: string;
};

const isSentenceCaseName = (name: string): boolean =>
  /^[A-Z][a-z0-9-]*(?: [a-z0-9-]+)*$/u.test(name);

/** Reports catalog-shape violations that would make a type unsafe to ship. */
export const validateSlideTypeCatalog = ({
  types,
  componentNames,
}: {
  readonly types: ReadonlyArray<SlideTypeDefinition>;
  readonly componentNames: ReadonlySet<string>;
}): ReadonlyArray<SlideTypeCatalogFinding> => {
  const findings: Array<SlideTypeCatalogFinding> = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const type of types) {
    if (seenIds.has(type.id)) {
      findings.push({
        id: type.id,
        message: `Duplicate slide type id "${type.id}"`,
      });
    }
    seenIds.add(type.id);
    if (seenNames.has(type.name)) {
      findings.push({
        id: type.id,
        message: `Duplicate slide type name "${type.name}"`,
      });
    }
    seenNames.add(type.name);
    if (!isSentenceCaseName(type.name)) {
      findings.push({
        id: type.id,
        message: `Slide type name "${type.name}" must use sentence case`,
      });
    }
    if (
      type.match.when.trim() === "" ||
      type.match.notWhen.trim() === "" ||
      type.guidance.length === 0 ||
      type.guidance.some((line) => line.trim() === "")
    ) {
      findings.push({
        id: type.id,
        message: `Slide type "${type.id}" needs matching boundaries and non-empty authoring guidance`,
      });
    }
    if (type.components.length === 0) {
      findings.push({
        id: type.id,
        message: `Slide type "${type.id}" needs component-pairing guidance`,
      });
    }
    for (const component of type.components) {
      if (
        !componentNames.has(component.name) ||
        component.guidance.trim() === ""
      ) {
        findings.push({
          id: type.id,
          message: `Slide type "${type.id}" has invalid component guidance for "${component.name}"`,
        });
      }
    }
  }
  return findings;
};
