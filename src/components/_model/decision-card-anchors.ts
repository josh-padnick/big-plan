// Owns every stable review address shared by Decision, QuickDecision, and
// DecisionAnalysis, including the rendered attribute vocabulary.

import { slugForComponentId } from "../_authoring/contract.js";

export const DECISION_ANCHOR_ATTRIBUTE = "data-decision-anchor";
export const DECISION_ELEMENT_ATTRIBUTE = "data-decision-element";
export const DECISION_NAME_ATTRIBUTE = "data-decision-name";

export type DecisionComponentName =
  "Decision" | "QuickDecision" | "DecisionAnalysis";

export type DecisionElementKind =
  | "figure"
  | "option"
  | "consideration"
  | "criterion"
  | "cell"
  | "recommendation"
  | "reversibility";

export const decisionFigureAnchor = ({
  component,
  ordinal,
}: {
  readonly component: DecisionComponentName;
  readonly ordinal: number;
}): string => `component/${component}#${ordinal}`;

const childAnchor = ({
  figure,
  kind,
  id,
}: {
  readonly figure: string;
  readonly kind: DecisionElementKind;
  readonly id: string;
}): string => `${figure}/${kind}/${encodeURIComponent(id)}`;

export const decisionOptionAnchor = ({
  figure,
  optionId,
}: {
  readonly figure: string;
  readonly optionId: string;
}): string => childAnchor({ figure, kind: "option", id: optionId });

export const decisionConsiderationAnchor = ({
  option,
  considerationId,
}: {
  readonly option: string;
  readonly considerationId: string;
}): string => `${option}/consideration/${encodeURIComponent(considerationId)}`;

export const decisionCriterionAnchor = ({
  figure,
  criterionId,
}: {
  readonly figure: string;
  readonly criterionId: string;
}): string => childAnchor({ figure, kind: "criterion", id: criterionId });

export const decisionCellAnchor = ({
  figure,
  optionId,
  criterionId,
}: {
  readonly figure: string;
  readonly optionId: string;
  readonly criterionId: string;
}): string =>
  `${figure}/cell/${encodeURIComponent(optionId)}/${encodeURIComponent(criterionId)}`;

export const decisionRecommendationAnchor = ({
  figure,
}: {
  readonly figure: string;
}): string => `${figure}/recommendation`;

export const decisionReversibilityAnchor = ({
  figure,
}: {
  readonly figure: string;
}): string => `${figure}/reversibility`;

/**
 * Resolves stable authored ids before allocating prose-derived slugs.
 *
 * Explicit ids reserve their complete namespace first, so an earlier label
 * can never steal a later authored address. Duplicate explicit ids remain
 * duplicated here so the compiler can diagnose them instead of disguising
 * the authoring error with a suffix.
 */
export const resolveDecisionElementIds = (
  entries: ReadonlyArray<{
    readonly id?: string;
    readonly label: string;
    readonly fallback: string;
  }>,
): ReadonlyArray<string> => {
  const authored = new Set(
    entries.flatMap((entry) => (entry.id === undefined ? [] : [entry.id])),
  );
  const used = new Set<string>();
  return entries.map((entry, index) => {
    if (entry.id !== undefined) {
      used.add(entry.id);
      return entry.id;
    }
    const preferred =
      slugForComponentId(entry.label) || `${entry.fallback}-${index + 1}`;
    if (!used.has(preferred) && !authored.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    let suffix = 2;
    while (
      used.has(`${preferred}-${suffix}`) ||
      authored.has(`${preferred}-${suffix}`)
    ) {
      suffix += 1;
    }
    const id = `${preferred}-${suffix}`;
    used.add(id);
    return id;
  });
};

/** Returns every later occurrence of an explicit id for compiler diagnostics. */
export const duplicateExplicitDecisionIds = (
  entries: ReadonlyArray<{ readonly id?: string }>,
): ReadonlyArray<{ readonly id: string; readonly index: number }> => {
  const seen = new Set<string>();
  return entries.flatMap((entry, index) => {
    if (entry.id === undefined) return [];
    if (seen.has(entry.id)) return [{ id: entry.id, index }];
    seen.add(entry.id);
    return [];
  });
};
