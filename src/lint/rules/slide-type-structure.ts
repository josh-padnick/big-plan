// Implements the objective typed-slide structure rule: singleton types may
// not repeat, the outcome pair is mutually exclusive, and a last-typed type
// ends the typed slides. It deliberately judges no slide content.

import {
  SLIDE_TYPES,
  slideTypeFor,
} from "../../plan-vocabulary/slide-types/index.js";
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
    const definition = slideTypeFor(section.type);
    for (const component of definition.components) {
      if (
        component.required === true &&
        !section.components.includes(component.name)
      ) {
        findings.push({
          ...positionOf(section),
          message: `${definition.name} slide "${section.name}" must contain a ${component.name} with actual UI mockups`,
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

  for (const definition of SLIDE_TYPES) {
    if (definition.placement !== "last-typed") {
      continue;
    }
    typed.forEach((section, index) => {
      if (section.type === definition.id && index < typed.length - 1) {
        findings.push({
          ...positionOf(section),
          message: `${definition.name} must be the last typed slide in the plan`,
        });
      }
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
