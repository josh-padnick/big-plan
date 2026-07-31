// Implements the objective typed-slide structure rule: singleton types may
// not repeat, the outcome pair is mutually exclusive, and Acceptance
// criteria is the last typed slide. It deliberately judges no slide content.

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

  const acceptanceIndex = typed.findIndex(
    ({ type }) => type === "acceptance-criteria",
  );
  if (acceptanceIndex !== -1 && acceptanceIndex < typed.length - 1) {
    const acceptance = typed[acceptanceIndex];
    if (acceptance !== undefined) {
      findings.push({
        ...positionOf(acceptance),
        message: `${slideTypeFor("acceptance-criteria").name} must be the last typed slide in the plan`,
      });
    }
  }

  return findings;
};

export const slideTypeStructureRule: PlanLintRule = {
  id: "slide-type-structure",
  check: checkSlideTypeStructure,
};
