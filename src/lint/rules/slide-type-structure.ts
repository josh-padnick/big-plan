// Implements the objective typed-slide structure rule: singleton types may
// not repeat, the outcome pair is mutually exclusive, and every user journey
// nests under its container. It deliberately judges no slide content.

import { SLIDE_TYPES } from "../../plan-vocabulary/slide-types/index.js";
import {
  collectAuthoredSections,
  type AuthoredSection,
} from "../authored-sections.js";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

// Recognizes the container heading or Part title that owns a run of journeys.
// The catalog name is "User journeys", and a plan that splits journeys by
// audience ("Reviewer journeys") still names the same container role.
const namesJourneyContainer = (title: string): boolean =>
  /\bjourneys$/u.test(
    title
      .trim()
      .replace(/[.:!?]+$/u, "")
      .toLowerCase(),
  );

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
  const sections = collectAuthoredSections(tree);
  const typed = sections.filter((section) => section.type !== undefined);
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

  // A journey belongs inside its container, never beside it. A Part titled
  // "User journeys" is the container that holds typed journey slides; an
  // untyped container slide can only hold h3 sub-slides, so typed journeys
  // authored next to one render as its siblings instead of its children.
  const containerSlides = new Set<AuthoredSection>();
  let container: AuthoredSection | undefined;
  for (const section of sections) {
    if (section.type === undefined) {
      if (namesJourneyContainer(section.title)) {
        container = section;
      }
      continue;
    }
    if (
      section.type !== "user-journey" ||
      (section.partTitle !== undefined &&
        namesJourneyContainer(section.partTitle))
    ) {
      continue;
    }
    if (container !== undefined && container.partTitle === section.partTitle) {
      containerSlides.add(container);
      continue;
    }
    findings.push({
      ...positionOf(section),
      message: `Put User journeys slide "${section.name}" inside a Part titled "User journeys" so every journey nests under its container`,
    });
  }
  for (const slide of containerSlides) {
    findings.push({
      line: slide.line,
      column: slide.column,
      message: `Nest the journeys under "${slide.title}" instead of beside it: replace that slide with <Part title="${slide.title}" /> so each journey is a slide inside it, or make each journey an h3 sub-slide of it`,
    });
  }

  return findings;
};

export const slideTypeStructureRule: PlanLintRule = {
  id: "slide-type-structure",
  check: checkSlideTypeStructure,
};
