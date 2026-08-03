// Compiles the lightweight option-and-consideration Decision contract.

import type { ElementContent } from "hast";
import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  createComponentIdAllocator,
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ComponentIdAllocator,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import type {
  CompiledDecisionCard,
  CompiledDecisionCardConsideration,
  CompiledDecisionCardCriterion,
  CompiledDecisionCardOption,
  DecisionCardTone,
} from "../_model/decision-card.js";
import {
  decisionConsiderationAnchor,
  decisionCriterionAnchor,
  decisionFigureAnchor,
  decisionOptionAnchor,
  decisionRecommendationAnchor,
  duplicateExplicitDecisionIds,
  resolveDecisionElementIds,
} from "../_model/decision-card-anchors.js";

const TONES: ReadonlyArray<DecisionCardTone> = [
  "good",
  "bad",
  "mixed",
  "neutral",
];
const DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;
const OPTION_SCHEMA = {
  id: { kind: "string", nonEmpty: true },
  title: { kind: "string", required: true, nonEmpty: true },
  recommended: { kind: "booleanShorthand" },
  summary: { kind: "string" },
} satisfies ComponentAttributeSchema;
const CONSIDERATION_SCHEMA = {
  id: { kind: "string", nonEmpty: true },
  label: { kind: "string", required: true, nonEmpty: true },
  verdict: { kind: "string", required: true, nonEmpty: true },
  tone: { kind: "enum", values: TONES },
} satisfies ComponentAttributeSchema;

type ConsiderationEntry = {
  readonly child: ScopedChild;
  readonly label: string;
  readonly value: CompiledDecisionCardConsideration;
};

const compileEntry = ({
  child,
  diagnostics,
  anchor,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly anchor: string;
}): ConsiderationEntry => {
  const validated = validateComponentAttributes({
    component: "Consideration",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: CONSIDERATION_SCHEMA,
  });
  return {
    child,
    label: validated.label ?? "",
    value: {
      anchor,
      verdict: validated.verdict ?? "",
      tone: validated.tone ?? "neutral",
      detail: meaningfulChildren(child.children),
    },
  };
};

const uniqueTitles = ({
  children,
  kind,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly kind: "Option" | "Consideration";
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const seen = new Set<string>();
  for (const child of children) {
    const raw =
      kind === "Option" ? child.attributes["title"] : child.attributes["label"];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    if (seen.has(raw.trim())) {
      diagnostics.add({
        message: `Duplicate ${kind} ${kind === "Option" ? "title" : "label"} "${raw.trim()}" in Decision`,
        position: child.position,
      });
    }
    seen.add(raw.trim());
  }
};

const diagnoseDuplicateIds = ({
  children,
  kind,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly kind: "Option" | "Consideration";
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const entries = children.map((child) => ({
    ...(typeof child.attributes["id"] === "string"
      ? { id: child.attributes["id"] }
      : {}),
  }));
  for (const duplicate of duplicateExplicitDecisionIds(entries)) {
    diagnostics.add({
      message: `Duplicate explicit ${kind} id "${duplicate.id}" in Decision`,
      position: children[duplicate.index]?.position,
    });
  }
};

const compileOption = ({
  child,
  criteria,
  diagnostics,
  ids,
  idPrefix,
  anchor,
}: {
  readonly child: ScopedChild;
  readonly criteria: ReadonlyArray<CompiledDecisionCardCriterion>;
  readonly diagnostics: DiagnosticCollector;
  readonly ids: ComponentIdAllocator;
  readonly idPrefix: string;
  readonly anchor: string;
}): CompiledDecisionCardOption => {
  const validated = validateComponentAttributes({
    component: "Option",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: OPTION_SCHEMA,
  });
  const title = validated.title ?? "";
  if (meaningfulChildren(child.children).length > 0) {
    diagnostics.add({
      message: "Decision Option bodies are not supported; use summary",
      position: child.position,
    });
  }
  const id = ids.allocate({
    prefix: `${idPrefix}-option`,
    label: title,
    fallbackId: `${idPrefix}-option`,
  });
  const children = (child.scopedChildren ?? []).filter(
    (entry) => entry.name === "Consideration",
  );
  uniqueTitles({ children, kind: "Consideration", diagnostics });
  diagnoseDuplicateIds({ children, kind: "Consideration", diagnostics });
  const considerationIds = resolveDecisionElementIds(
    children.map((entry) => ({
      ...(typeof entry.attributes["id"] === "string"
        ? { id: entry.attributes["id"] }
        : {}),
      label:
        typeof entry.attributes["label"] === "string"
          ? entry.attributes["label"]
          : "",
      fallback: "consideration",
    })),
  );
  const entries = children.map((entry, index) =>
    compileEntry({
      child: entry,
      diagnostics,
      anchor: decisionConsiderationAnchor({
        option: anchor,
        considerationId:
          considerationIds[index] ?? `consideration-${index + 1}`,
      }),
    }),
  );
  const byLabel = new Map(entries.map((entry) => [entry.label, entry.value]));
  return {
    id,
    anchor,
    titleId: `${id}-title`,
    title,
    recommended: validated.recommended === true,
    chosen: false,
    ...(validated.summary === undefined ? {} : { summary: validated.summary }),
    considerations: criteria.map((criterion) => byLabel.get(criterion.title)),
    detail: [],
  };
};

/** Compiles one Decision into the shared rows presentation model. */
export const compileDecisionComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
  ids = createComponentIdAllocator(),
  ordinal,
}: ComponentCompilerInput): CompiledDecisionCard => {
  const validated = validateComponentAttributes({
    component: "Decision",
    attributes,
    position,
    diagnostics,
    schema: DECISION_SCHEMA,
  });
  const question = validated.question ?? "";
  const anchor = decisionFigureAnchor({
    component: "Decision",
    ordinal: ordinal ?? ids.nextOrdinal({ component: "Decision" }),
  });
  const id = ids.allocate({
    prefix: "decision",
    label: question,
    fallbackId: "decision",
  });
  const optionChildren = scopedChildren.filter(
    (child) => child.name === "Option",
  );
  if (optionChildren.length < 2) {
    diagnostics.add({
      message: "Decision must contain at least two Options",
      position,
    });
  }
  uniqueTitles({ children: optionChildren, kind: "Option", diagnostics });
  diagnoseDuplicateIds({
    children: optionChildren,
    kind: "Option",
    diagnostics,
  });
  const optionAnchorIds = resolveDecisionElementIds(
    optionChildren.map((child) => ({
      ...(typeof child.attributes["id"] === "string"
        ? { id: child.attributes["id"] }
        : {}),
      label:
        typeof child.attributes["title"] === "string"
          ? child.attributes["title"]
          : "",
      fallback: "option",
    })),
  );
  const recommended = optionChildren.filter(
    (child) => child.attributes["recommended"] === true,
  );
  for (const duplicate of recommended.slice(1)) {
    diagnostics.add({
      message: "Decision cannot contain more than one recommended Option",
      position: duplicate.position,
    });
  }
  const labels: Array<string> = [];
  const labelDetails = new Map<string, ReadonlyArray<ElementContent>>();
  for (const option of optionChildren) {
    for (const child of option.scopedChildren ?? []) {
      if (child.name !== "Consideration") continue;
      const label = child.attributes["label"];
      if (typeof label !== "string" || labels.includes(label)) continue;
      labels.push(label);
      labelDetails.set(label, meaningfulChildren(child.children));
    }
  }
  const criterionAnchorIds = resolveDecisionElementIds(
    labels.map((title) => ({ label: title, fallback: "criterion" })),
  );
  const criteria = labels.map((title, index) => ({
    id: ids.allocate({
      prefix: `${id}-criterion`,
      label: title,
      fallbackId: `${id}-criterion`,
    }),
    anchor: decisionCriterionAnchor({
      figure: anchor,
      criterionId: criterionAnchorIds[index] ?? `criterion-${index + 1}`,
    }),
    title,
    detail: labelDetails.get(title) ?? [],
  }));
  const options = optionChildren.map((child, index) =>
    compileOption({
      child,
      criteria,
      diagnostics,
      ids,
      idPrefix: id,
      anchor: decisionOptionAnchor({
        figure: anchor,
        optionId: optionAnchorIds[index] ?? `option-${index + 1}`,
      }),
    }),
  );
  return {
    component: "Decision",
    id,
    anchor,
    recommendationAnchor: decisionRecommendationAnchor({ figure: anchor }),
    questionId: `${id}-question`,
    question,
    status: "open",
    layout: "rows",
    scoring: "qualitative",
    interaction: "choose",
    context: meaningfulChildren(children),
    detail: [],
    criteria,
    options,
    discriminating: criteria.map((_, index) => index),
  };
};
