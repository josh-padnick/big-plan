// Compiles Decision's authored form into its plan model: the middle weight of
// the decision family - each option carries its own considerations inline, so
// a reviewer reads one option in full instead of parsing a matrix.

import type { ElementContent } from "hast";
import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";

export type DecisionStatus = "open" | "decided" | "deferred";

export type DecisionTone = "good" | "bad" | "mixed" | "neutral";

const DECISION_STATUSES: ReadonlyArray<DecisionStatus> = [
  "open",
  "decided",
  "deferred",
];

const DECISION_TONES: ReadonlyArray<DecisionTone> = [
  "good",
  "bad",
  "mixed",
  "neutral",
];

export type CompiledDecisionConsideration = {
  readonly title: string;
  readonly verdict: string;
  readonly tone: DecisionTone;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledDecisionOption = {
  readonly title: string;
  readonly recommended: boolean;
  readonly summary?: string;
  readonly considerations: ReadonlyArray<CompiledDecisionConsideration>;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledDecision = {
  readonly question: string;
  readonly status: DecisionStatus;
  readonly context: ReadonlyArray<ElementContent>;
  readonly options: ReadonlyArray<CompiledDecisionOption>;
};

const DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
  status: { kind: "enum", values: DECISION_STATUSES },
} satisfies ComponentAttributeSchema;

const OPTION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  recommended: { kind: "booleanShorthand" },
  summary: { kind: "string" },
} satisfies ComponentAttributeSchema;

const CONSIDERATION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  verdict: { kind: "string", required: true, nonEmpty: true },
  tone: { kind: "enum", values: DECISION_TONES },
} satisfies ComponentAttributeSchema;

const compileConsideration = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledDecisionConsideration => {
  const validated = validateComponentAttributes({
    component: "Consideration",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: CONSIDERATION_SCHEMA,
  });
  return {
    title: validated.title ?? "",
    verdict: validated.verdict ?? "",
    tone: validated.tone ?? "neutral",
    detail: meaningfulChildren(child.children),
  };
};

const compileOption = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledDecisionOption => {
  const validated = validateComponentAttributes({
    component: "Option",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: OPTION_SCHEMA,
  });
  const considerations = (child.scopedChildren ?? [])
    .filter((nested) => nested.name === "Consideration")
    .map((nested) => compileConsideration({ child: nested, diagnostics }));
  if (considerations.length === 0) {
    diagnostics.add({
      message: "A Decision Option needs at least one Consideration",
      position: child.position,
    });
  }
  return {
    title: validated.title ?? "",
    recommended: validated.recommended === true,
    ...(validated.summary === undefined ? {} : { summary: validated.summary }),
    considerations,
    detail: meaningfulChildren(child.children),
  };
};

/** Compiles one Decision component into the model consumed by rendering. */
export const compileDecisionComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: ComponentCompilerInput): CompiledDecision => {
  const validated = validateComponentAttributes({
    component: "Decision",
    attributes,
    position,
    diagnostics,
    schema: DECISION_SCHEMA,
  });
  const options = scopedChildren
    .filter((child) => child.name === "Option")
    .map((child) => compileOption({ child, diagnostics }));
  if (options.length < 2) {
    diagnostics.add({
      message: "Decision must contain at least two Options",
      position,
    });
  }
  const recommended = options.filter((option) => option.recommended);
  if (recommended.length > 1) {
    diagnostics.add({
      message: "Decision cannot contain more than one recommended Option",
      position,
    });
  }
  return {
    question: validated.question ?? "",
    status: validated.status ?? "open",
    context: meaningfulChildren(children),
    options,
  };
};
