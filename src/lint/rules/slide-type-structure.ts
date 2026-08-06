// Implements the objective typed-slide structure rule: singleton types may
// not repeat, and the outcome pair is mutually exclusive. It deliberately
// judges no slide content.

import { SLIDE_TYPES } from "../../plan-vocabulary/slide-types/index.js";
import { collectAuthoredSections } from "../authored-sections.js";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const positionOf = ({
  markerLine,
  markerColumn,
  line,
  column,
}: ReturnType<typeof collectAuthoredSections>[number]): {
  readonly line: number;
  readonly column: number;
} => ({
  line: markerLine ?? line,
  column: markerColumn ?? column,
});

const checkSlideTypeStructure: PlanLintRule["check"] = ({ tree }) => {
  const typed = collectAuthoredSections(tree).filter(
    (section) => section.type !== undefined,
  );
  const findings: Array<PlanLintFinding> = [];

  for (const definition of SLIDE_TYPES) {
    if (definition.cardinality === "many") {
      continue;
    }
    const occurrences = typed.filter(
      (section) => section.type === definition.id,
    );
    for (const duplicate of occurrences.slice(1)) {
      findings.push({
        ...positionOf(duplicate),
        message: `Use at most one ${definition.name} slide in a plan`,
      });
    }
  }

  for (const section of typed) {
    if (section.type === undefined) {
      continue;
    }
    if (section.type === "user-journey") {
      const hasWireframe = section.components.includes("Wireframe");
      const hasReason = (section.wireframeReason?.trim() ?? "") !== "";
      if (!hasWireframe && !hasReason) {
        findings.push({
          ...positionOf(section),
          message: `User journeys slide "${section.name}" needs a Wireframe with actual UI mockups, or a non-empty wireframeReason explaining why no UI was created`,
        });
      }
      if (hasWireframe && hasReason) {
        findings.push({
          ...positionOf(section),
          message: `Remove wireframeReason from User journeys slide "${section.name}" because it contains a Wireframe`,
        });
      }
    }
  }

  const desiredExperience = typed.find(
    ({ type }) => type === "desired-experience",
  );
  const desiredOutcome = typed.find(({ type }) => type === "desired-outcome");
  if (desiredExperience !== undefined && desiredOutcome !== undefined) {
    const later =
      positionOf(desiredExperience).line > positionOf(desiredOutcome).line
        ? desiredExperience
        : desiredOutcome;
    findings.push({
      ...positionOf(later),
      message:
        "Use either Desired experience for a new feature or Desired outcome for other work, not both",
    });
  }

  const journeys = typed.filter(({ type }) => type === "user-journey");
  for (const field of ["name", "toc"] as const) {
    const seen = new Set<string>();
    for (const journey of journeys) {
      const value = journey[field];
      if (value === undefined) {
        continue;
      }
      if (seen.has(value)) {
        findings.push({
          ...positionOf(journey),
          message:
            field === "name"
              ? `Give every journey in User journeys a distinct name; "${value}" is repeated`
              : `Give every journey in User journeys a distinct table-of-contents form; "${value}" is repeated`,
        });
      }
      seen.add(value);
    }
  }

  return findings;
};

export const slideTypeStructureRule: PlanLintRule = {
  id: "slide-type-structure",
  check: checkSlideTypeStructure,
};
