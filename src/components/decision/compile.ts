// Compiles Decision's authored form into its plan model: one question, a
// small set of options a reviewer picks between, explicit criteria, and one
// short explained value per option and criterion.

import type { Element, ElementContent } from "hast";
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

export type DecisionStatus = "open" | "decided" | "deferred";

export type DecisionTone = "good" | "bad" | "mixed" | "neutral";

export type DecisionScoring = "qualitative" | "weighted";

// The captain approved all three reading depths. The default matrix uses the
// keyed chooser rail; rows and brief remain the lighter presentations.
export type DecisionLayout = "matrix" | "rows" | "brief";

const DECISION_LAYOUTS: ReadonlyArray<DecisionLayout> = [
  "matrix",
  "rows",
  "brief",
];

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

const DECISION_SCORING: ReadonlyArray<DecisionScoring> = [
  "qualitative",
  "weighted",
];

// A verdict is a value to compare, not a sentence to read. The cap forces the
// normalized-word shape ("Yes", "Strong", "Somewhat"); the one-sentence reason
// belongs in the Consideration body.
const VERDICT_MAX_LENGTH = 24;

export type CompiledDecisionCriterion = {
  readonly id: string;
  readonly title: string;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly impact?: number;
};

export type CompiledDecisionConsideration = {
  readonly verdict: string;
  readonly tone: DecisionTone;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly score?: number;
};

export type CompiledDecisionOption = {
  readonly id: string;
  readonly titleId: string;
  readonly title: string;
  readonly recommended: boolean;
  readonly chosen: boolean;
  readonly summary?: string;
  // Aligned with the decision's criteria order; a hole is an authoring error
  // that has already been diagnosed.
  readonly considerations: ReadonlyArray<
    CompiledDecisionConsideration | undefined
  >;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledDecision = {
  readonly id: string;
  readonly questionId: string;
  readonly question: string;
  readonly status: DecisionStatus;
  readonly layout: DecisionLayout;
  readonly scoring: DecisionScoring;
  readonly context: ReadonlyArray<ElementContent>;
  readonly criteria: ReadonlyArray<CompiledDecisionCriterion>;
  readonly options: ReadonlyArray<CompiledDecisionOption>;
  readonly chosenOption?: CompiledDecisionOption;
  // Criterion positions where the options actually differ. A criterion every
  // option scores the same cannot inform a choice, so it is weight the reader
  // carries for nothing.
  readonly discriminating: ReadonlyArray<number>;
};

const DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
  status: { kind: "enum", values: DECISION_STATUSES },
  layout: { kind: "enum", values: DECISION_LAYOUTS },
  scoring: { kind: "enum", values: DECISION_SCORING },
} satisfies ComponentAttributeSchema;

const CRITERION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  impact: { kind: "string" },
} satisfies ComponentAttributeSchema;

const OPTION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  recommended: { kind: "booleanShorthand" },
  chosen: { kind: "booleanShorthand" },
  summary: { kind: "string" },
} satisfies ComponentAttributeSchema;

const CONSIDERATION_SCHEMA = {
  criterion: { kind: "string", required: true, nonEmpty: true },
  verdict: { kind: "string", required: true, nonEmpty: true },
  tone: { kind: "enum", values: DECISION_TONES },
  score: { kind: "string" },
} satisfies ComponentAttributeSchema;

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

const textOf = (nodes: ReadonlyArray<ElementContent>): string =>
  nodes
    .map((node) => {
      if (node.type === "text") return node.value;
      if (isElement(node)) return textOf(node.children);
      return "";
    })
    .join("");

// Definition popovers stay useful only while they answer one question in one
// breath. Requiring one prose paragraph also prevents a list or code block
// from turning a small hover surface into a second document.
const validateOneSentenceBody = ({
  child,
  kind,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly kind: "Criterion" | "Consideration";
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<ElementContent> => {
  const detail = meaningfulChildren(child.children);
  const paragraph = detail[0];
  const text = textOf(detail).replace(/\s+/gu, " ").trim();
  if (
    detail.length !== 1 ||
    paragraph === undefined ||
    !isElement(paragraph) ||
    paragraph.tagName !== "p" ||
    text === ""
  ) {
    diagnostics.add({
      message:
        kind === "Criterion"
          ? "A Decision Criterion needs one prose sentence explaining what it means"
          : "A Decision Consideration needs one prose sentence explaining why its verdict holds",
      position: child.position,
    });
    return detail;
  }
  const sentenceBreaks =
    text.match(/[.!?](?:["')\]]*)?\s+(?=[A-Z0-9])/gu)?.length ?? 0;
  if (sentenceBreaks > 0) {
    diagnostics.add({
      message: `A Decision ${kind} explanation must be one sentence at most`,
      position: child.position,
    });
  }
  return detail;
};

const parseFivePointValue = ({
  value,
  label,
  position,
  diagnostics,
}: {
  readonly value: string | undefined;
  readonly label: "impact" | "score";
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): number | undefined => {
  if (value === undefined) return undefined;
  if (!/^[1-5]$/u.test(value)) {
    diagnostics.add({
      message: `Decision ${label} must be an integer from 1 to 5`,
      position,
    });
    return undefined;
  }
  return Number(value);
};

const compileCriterion = ({
  child,
  diagnostics,
  idPrefix,
  ids,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly idPrefix: string;
  readonly ids: ComponentIdAllocator;
}): CompiledDecisionCriterion => {
  const validated = validateComponentAttributes({
    component: "Criterion",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: CRITERION_SCHEMA,
  });
  const title = validated.title ?? "";
  return {
    id: ids.allocate({
      prefix: `${idPrefix}-criterion`,
      label: title,
      fallbackId: `${idPrefix}-criterion`,
    }),
    title,
    detail: validateOneSentenceBody({
      child,
      kind: "Criterion",
      diagnostics,
    }),
    ...(parseFivePointValue({
      value: validated.impact,
      label: "impact",
      position: child.position,
      diagnostics,
    }) === undefined
      ? {}
      : {
          impact: Number(validated.impact),
        }),
  };
};

type ConsiderationEntry = {
  readonly child: ScopedChild;
  readonly criterion: string;
  readonly consideration: CompiledDecisionConsideration;
};

const compileConsideration = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): ConsiderationEntry => {
  const validated = validateComponentAttributes({
    component: "Consideration",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: CONSIDERATION_SCHEMA,
  });
  const verdict = validated.verdict ?? "";
  if (verdict.length > VERDICT_MAX_LENGTH) {
    diagnostics.add({
      message: `A Consideration verdict must be at most ${VERDICT_MAX_LENGTH} characters so options stay scannable; move the reasoning into the Consideration body`,
      position: child.position,
    });
  }
  return {
    child,
    criterion: validated.criterion ?? "",
    consideration: {
      verdict,
      tone: validated.tone ?? "neutral",
      detail: validateOneSentenceBody({
        child,
        kind: "Consideration",
        diagnostics,
      }),
      ...(parseFivePointValue({
        value: validated.score,
        label: "score",
        position: child.position,
        diagnostics,
      }) === undefined
        ? {}
        : {
            score: Number(validated.score),
          }),
    },
  };
};

const alignConsiderations = ({
  child,
  optionTitle,
  entries,
  criteria,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly optionTitle: string;
  readonly entries: ReadonlyArray<ConsiderationEntry>;
  readonly criteria: ReadonlyArray<CompiledDecisionCriterion>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<CompiledDecisionConsideration | undefined> => {
  const titles = new Set(criteria.map(({ title }) => title));
  const byCriterion = new Map<string, CompiledDecisionConsideration>();
  for (const entry of entries) {
    if (entry.criterion === "") continue;
    if (!titles.has(entry.criterion)) {
      diagnostics.add({
        message: `Consideration references unknown criterion "${entry.criterion}"`,
        position: entry.child.position,
      });
      continue;
    }
    if (byCriterion.has(entry.criterion)) {
      diagnostics.add({
        message: `Duplicate Consideration for criterion "${entry.criterion}" in Option "${optionTitle}"`,
        position: entry.child.position,
      });
      continue;
    }
    byCriterion.set(entry.criterion, entry.consideration);
  }
  for (const criterion of criteria) {
    if (!byCriterion.has(criterion.title)) {
      diagnostics.add({
        message: `Option "${optionTitle}" needs a Consideration for criterion "${criterion.title}"`,
        position: child.position,
      });
    }
  }
  return criteria.map(({ title }) => byCriterion.get(title));
};

const compileOption = ({
  child,
  diagnostics,
  idPrefix,
  ids,
  criteria,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly idPrefix: string;
  readonly ids: ComponentIdAllocator;
  readonly criteria: ReadonlyArray<CompiledDecisionCriterion>;
}): CompiledDecisionOption => {
  const validated = validateComponentAttributes({
    component: "Option",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: OPTION_SCHEMA,
  });
  const title = validated.title ?? "";
  const id = ids.allocate({
    prefix: `${idPrefix}-option`,
    label: title,
    fallbackId: `${idPrefix}-option`,
  });
  const entries = (child.scopedChildren ?? [])
    .filter((nested) => nested.name === "Consideration")
    .map((nested) => compileConsideration({ child: nested, diagnostics }));
  return {
    id,
    titleId: `${id}-title`,
    title,
    recommended: validated.recommended === true,
    chosen: validated.chosen === true,
    ...(validated.summary === undefined ? {} : { summary: validated.summary }),
    considerations: alignConsiderations({
      child,
      optionTitle: title,
      entries,
      criteria,
      diagnostics,
    }),
    detail: meaningfulChildren(child.children),
  };
};

const validateUniqueTitles = ({
  entries,
  kind,
  diagnostics,
}: {
  readonly entries: ReadonlyArray<ScopedChild>;
  readonly kind: "Criterion" | "Option";
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const titles = new Set<string>();
  for (const entry of entries) {
    const authoredTitle = entry.attributes["title"];
    if (typeof authoredTitle !== "string") continue;
    const title = authoredTitle.trim();
    if (title === "") continue;
    if (titles.has(title)) {
      diagnostics.add({
        message: `Duplicate ${kind} title "${title}" in Decision`,
        position: entry.position,
      });
    }
    titles.add(title);
  }
};

// Recommendation, selection, and status are three separate states, and only
// some combinations are honest: a chosen option means the decision is settled.
const validateSelection = ({
  options,
  status,
  position,
  diagnostics,
}: {
  readonly options: ReadonlyArray<CompiledDecisionOption>;
  readonly status: DecisionStatus;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (options.filter((option) => option.recommended).length > 1) {
    diagnostics.add({
      message: "Decision cannot contain more than one recommended Option",
      position,
    });
  }
  const chosen = options.filter((option) => option.chosen);
  if (chosen.length > 1) {
    diagnostics.add({
      message: "Decision cannot contain more than one chosen Option",
      position,
    });
  }
  if (chosen.length === 1 && status !== "decided") {
    diagnostics.add({
      message: 'A Decision with a chosen Option must set status="decided"',
      position,
    });
  }
  if (chosen.length === 0 && status === "decided") {
    diagnostics.add({
      message: 'A Decision with status="decided" must mark one Option chosen',
      position,
    });
  }
};

const validateWeightedScoring = ({
  scoring,
  layout,
  criteria,
  options,
  position,
  diagnostics,
}: {
  readonly scoring: DecisionScoring;
  readonly layout: DecisionLayout;
  readonly criteria: ReadonlyArray<CompiledDecisionCriterion>;
  readonly options: ReadonlyArray<CompiledDecisionOption>;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (scoring !== "weighted") return;
  if (layout !== "matrix") {
    diagnostics.add({
      message: 'A weighted Decision must use layout="matrix"',
      position,
    });
  }
  for (const criterion of criteria) {
    if (criterion.impact === undefined) {
      diagnostics.add({
        message: `Weighted Decision Criterion "${criterion.title}" needs impact="1" through impact="5"`,
        position,
      });
    }
  }
  for (const option of options) {
    criteria.forEach((criterion, row) => {
      if (option.considerations[row]?.score === undefined) {
        diagnostics.add({
          message: `Weighted Decision Option "${option.title}" needs a 1–5 score for criterion "${criterion.title}"`,
          position,
        });
      }
    });
  }
};

/** Compiles one Decision component into the model consumed by rendering. */
export const compileDecisionComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
  ids = createComponentIdAllocator(),
}: ComponentCompilerInput): CompiledDecision => {
  const validated = validateComponentAttributes({
    component: "Decision",
    attributes,
    position,
    diagnostics,
    schema: DECISION_SCHEMA,
  });
  const question = validated.question ?? "";
  const status = validated.status ?? "open";
  const layout = validated.layout ?? "matrix";
  const scoring = validated.scoring ?? "qualitative";
  const id = ids.allocate({
    prefix: "decision",
    label: question,
    fallbackId: "decision",
  });
  const criterionChildren = scopedChildren.filter(
    (child) => child.name === "Criterion",
  );
  const criteria = criterionChildren.map((child) =>
    compileCriterion({ child, diagnostics, idPrefix: id, ids }),
  );
  if (criteria.length === 0) {
    diagnostics.add({
      message: "Decision must contain at least one Criterion",
      position,
    });
  }
  validateUniqueTitles({
    entries: criterionChildren,
    kind: "Criterion",
    diagnostics,
  });
  const optionChildren = scopedChildren.filter(
    (child) => child.name === "Option",
  );
  const options = optionChildren.map((child) =>
    compileOption({ child, diagnostics, idPrefix: id, ids, criteria }),
  );
  if (options.length < 2) {
    diagnostics.add({
      message: "Decision must contain at least two Options",
      position,
    });
  }
  validateUniqueTitles({
    entries: optionChildren,
    kind: "Option",
    diagnostics,
  });
  validateSelection({ options, status, position, diagnostics });
  validateWeightedScoring({
    scoring,
    layout,
    criteria,
    options,
    position,
    diagnostics,
  });
  const chosenOption = options.find((option) => option.chosen);
  const discriminating = Array.from(
    { length: criteria.length },
    (_, row) => row,
  ).filter(
    (row) =>
      new Set(options.map((option) => option.considerations[row]?.verdict))
        .size > 1,
  );
  return {
    id,
    questionId: `${id}-question`,
    question,
    status,
    layout,
    scoring,
    context: meaningfulChildren(children),
    criteria,
    options,
    ...(chosenOption === undefined ? {} : { chosenOption }),
    discriminating,
  };
};
