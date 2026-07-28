// Compiles BigDecision's criteria-matrix grammar into a render-ready model
// while collecting every decision-contract diagnostic at its owning node.

import type { ElementContent } from "hast";
import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  createComponentIdAllocator,
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentIdAllocator,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";

export type BigDecisionStatus = "open" | "decided" | "deferred";
export type BigDecisionTone = "good" | "bad" | "mixed" | "neutral";
export type BigDecisionReversibilityRating = "easy" | "somewhat-hard" | "hard";

const BIG_DECISION_STATUSES: ReadonlyArray<BigDecisionStatus> = [
  "open",
  "decided",
  "deferred",
];

const BIG_DECISION_TONES: ReadonlyArray<BigDecisionTone> = [
  "good",
  "bad",
  "mixed",
  "neutral",
];

const REVERSIBILITY_RATINGS: ReadonlyArray<BigDecisionReversibilityRating> = [
  "easy",
  "somewhat-hard",
  "hard",
];

// The matrix stays scannable only while cells stay terse; the cap forces the
// verdict-plus-short-qualifier shape instead of sentences.
const VERDICT_MAX_LENGTH = 32;

export type CompiledBigDecisionCriterion = {
  readonly id: string;
  readonly title: string;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledBigDecisionScore = {
  readonly verdict: string;
  readonly tone: BigDecisionTone;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledBigDecisionOption = {
  readonly id: string;
  readonly titleId: string;
  readonly title: string;
  readonly summaryId?: string;
  readonly summary?: string;
  readonly recommended: boolean;
  readonly chosen: boolean;
  readonly detailId?: string;
  readonly detail: ReadonlyArray<ElementContent>;
  // Aligned with the decision's criteria order; a hole is an authoring error
  // that has already been diagnosed.
  readonly scores: ReadonlyArray<CompiledBigDecisionScore | undefined>;
};

export type CompiledBigDecisionReversibility = {
  readonly rating: BigDecisionReversibilityRating;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledBigDecision = {
  readonly id: string;
  readonly question: string;
  readonly status: BigDecisionStatus;
  readonly context: ReadonlyArray<ElementContent>;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly reversibility?: CompiledBigDecisionReversibility;
  readonly criteria: ReadonlyArray<CompiledBigDecisionCriterion>;
  readonly options: ReadonlyArray<CompiledBigDecisionOption>;
  readonly chosenOption?: CompiledBigDecisionOption;
};

const BIG_DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
  status: { kind: "enum", values: BIG_DECISION_STATUSES },
} satisfies ComponentAttributeSchema;

const REVERSIBILITY_SCHEMA = {
  rating: { kind: "enum", values: REVERSIBILITY_RATINGS, required: true },
} satisfies ComponentAttributeSchema;

const DETAILS_SCHEMA = {} satisfies ComponentAttributeSchema;

const CRITERION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

const OPTION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  summary: { kind: "string" },
  recommended: { kind: "booleanShorthand" },
  chosen: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const SCORE_SCHEMA = {
  criterion: { kind: "string", required: true, nonEmpty: true },
  verdict: { kind: "string", required: true, nonEmpty: true },
  tone: { kind: "enum", values: BIG_DECISION_TONES },
} satisfies ComponentAttributeSchema;

const contentOf = (
  children: ReadonlyArray<ElementContent>,
): ReadonlyArray<ElementContent> => meaningfulChildren(children);

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
}): CompiledBigDecisionCriterion => {
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
    detail: contentOf(child.children),
  };
};

type ScoreEntry = {
  readonly child: ScopedChild;
  readonly criterion: string;
  readonly score: CompiledBigDecisionScore;
};

const compileScore = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): ScoreEntry => {
  const validated = validateComponentAttributes({
    component: "Score",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: SCORE_SCHEMA,
  });
  const verdict = validated.verdict ?? "";
  if (verdict.length > VERDICT_MAX_LENGTH) {
    diagnostics.add({
      message: `Score verdict must stay within ${VERDICT_MAX_LENGTH} characters; move longer reasoning into the Score body`,
      position: child.position,
    });
  }
  return {
    child,
    criterion: validated.criterion ?? "",
    score: {
      verdict,
      tone: validated.tone ?? "neutral",
      detail: contentOf(child.children),
    },
  };
};

// Aligns one option's authored scores with the decision's criteria order,
// reporting unknown, duplicate, and missing criteria at their owning nodes.
const alignScores = ({
  child,
  optionTitle,
  entries,
  criteria,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly optionTitle: string;
  readonly entries: ReadonlyArray<ScoreEntry>;
  readonly criteria: ReadonlyArray<CompiledBigDecisionCriterion>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<CompiledBigDecisionScore | undefined> => {
  const titles = new Set(criteria.map(({ title }) => title));
  const byCriterion = new Map<string, CompiledBigDecisionScore>();
  for (const entry of entries) {
    if (entry.criterion === "") {
      continue;
    }
    if (!titles.has(entry.criterion)) {
      diagnostics.add({
        message: `Score references unknown criterion "${entry.criterion}"`,
        position: entry.child.position,
      });
      continue;
    }
    if (byCriterion.has(entry.criterion)) {
      diagnostics.add({
        message: `Duplicate Score for criterion "${entry.criterion}" in Option "${optionTitle}"`,
        position: entry.child.position,
      });
      continue;
    }
    byCriterion.set(entry.criterion, entry.score);
  }
  for (const criterion of criteria) {
    if (criterion.title !== "" && !byCriterion.has(criterion.title)) {
      diagnostics.add({
        message: `Option "${optionTitle}" is missing a Score for criterion "${criterion.title}"`,
        position: child.position,
      });
    }
  }
  return criteria.map(({ title }) => byCriterion.get(title));
};

const compileOption = ({
  child,
  criteria,
  diagnostics,
  idPrefix,
  ids,
}: {
  readonly child: ScopedChild;
  readonly criteria: ReadonlyArray<CompiledBigDecisionCriterion>;
  readonly diagnostics: DiagnosticCollector;
  readonly idPrefix: string;
  readonly ids: ComponentIdAllocator;
}): CompiledBigDecisionOption => {
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
  const titleId = ids.allocate({
    prefix: id,
    label: "title",
    fallbackId: `${id}-title`,
  });
  const summaryId =
    validated.summary === undefined
      ? undefined
      : ids.allocate({
          prefix: id,
          label: "summary",
          fallbackId: `${id}-summary`,
        });
  const detail = contentOf(child.children);
  const detailId =
    detail.length === 0
      ? undefined
      : ids.allocate({
          prefix: id,
          label: "details",
          fallbackId: `${id}-details`,
        });
  const scoreEntries = (child.scopedChildren ?? [])
    .filter((nested) => nested.name === "Score")
    .map((nested) => compileScore({ child: nested, diagnostics }));
  return {
    id,
    titleId,
    title,
    ...(validated.summary === undefined || summaryId === undefined
      ? {}
      : { summaryId, summary: validated.summary }),
    recommended: validated.recommended === true,
    chosen: validated.chosen === true,
    ...(detailId === undefined ? {} : { detailId }),
    detail,
    scores: alignScores({
      child,
      optionTitle: title,
      entries: scoreEntries,
      criteria,
      diagnostics,
    }),
  };
};

// Reports uniqueness and outcome invariants only after every option schema is
// checked, avoiding misleading duplicate-title errors for invalid titles.
const validateDecisionOptions = ({
  position,
  status,
  entries,
  diagnostics,
}: {
  readonly position: ComponentCompilerInput["position"];
  readonly status: BigDecisionStatus;
  readonly entries: ReadonlyArray<{
    readonly child: ScopedChild;
    readonly option: CompiledBigDecisionOption;
  }>;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (entries.length < 2) {
    diagnostics.add({
      message: "BigDecision must contain at least two Options",
      position,
    });
  }

  const titles = new Set<string>();
  for (const entry of entries) {
    const authoredTitle = entry.child.attributes["title"];
    if (typeof authoredTitle !== "string") {
      continue;
    }
    const title = authoredTitle.trim();
    if (title === "") {
      continue;
    }
    if (titles.has(title)) {
      diagnostics.add({
        message: `Duplicate Option title "${title}" in BigDecision`,
        position: entry.child.position,
      });
    }
    titles.add(title);
  }

  const recommended = entries.filter(({ option }) => option.recommended);
  for (const duplicate of recommended.slice(1)) {
    diagnostics.add({
      message: "BigDecision cannot contain more than one recommended Option",
      position: duplicate.child.position,
    });
  }

  const chosen = entries.filter(({ option }) => option.chosen);
  for (const duplicate of chosen.slice(1)) {
    diagnostics.add({
      message: "BigDecision cannot contain more than one chosen Option",
      position: duplicate.child.position,
    });
  }
  if (status !== "decided") {
    for (const entry of chosen) {
      diagnostics.add({
        message:
          'A chosen Option requires its BigDecision to have status "decided"',
        position: entry.child.position,
      });
    }
  } else if (chosen.length === 0) {
    diagnostics.add({
      message:
        'A BigDecision with status "decided" must contain exactly one chosen Option',
      position,
    });
  }
};

// Question-level long-form collects behind one Details drawer; a second
// Details element is an authoring error, not a merge.
const compileDetails = ({
  children,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<ElementContent> => {
  for (const duplicate of children.slice(1)) {
    diagnostics.add({
      message: "BigDecision cannot contain more than one Details",
      position: duplicate.position,
    });
  }
  const child = children[0];
  if (child === undefined) {
    return [];
  }
  validateComponentAttributes({
    component: "Details",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: DETAILS_SCHEMA,
  });
  return contentOf(child.children);
};

// The rating vocabulary is fixed so every decision answers the same question
// the same way; the body carries the decision-specific rationale.
const compileReversibility = ({
  children,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly diagnostics: DiagnosticCollector;
}): CompiledBigDecisionReversibility | undefined => {
  for (const duplicate of children.slice(1)) {
    diagnostics.add({
      message: "BigDecision cannot contain more than one Reversibility",
      position: duplicate.position,
    });
  }
  const child = children[0];
  if (child === undefined) {
    return undefined;
  }
  const validated = validateComponentAttributes({
    component: "Reversibility",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: REVERSIBILITY_SCHEMA,
  });
  if (validated.rating === undefined) {
    return undefined;
  }
  return { rating: validated.rating, detail: contentOf(child.children) };
};

const validateCriteria = ({
  children,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const titles = new Set<string>();
  for (const child of children) {
    const authoredTitle = child.attributes["title"];
    if (typeof authoredTitle !== "string") {
      continue;
    }
    const title = authoredTitle.trim();
    if (title === "") {
      continue;
    }
    if (titles.has(title)) {
      diagnostics.add({
        message: `Duplicate Criterion title "${title}" in BigDecision`,
        position: child.position,
      });
    }
    titles.add(title);
  }
};

/** Compiles one BigDecision component into the model consumed by rendering. */
export const compileBigDecisionComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
  ids = createComponentIdAllocator(),
}: ComponentCompilerInput): CompiledBigDecision => {
  const validated = validateComponentAttributes({
    component: "BigDecision",
    attributes,
    position,
    diagnostics,
    schema: BIG_DECISION_SCHEMA,
  });
  const question = validated.question ?? "";
  const status = validated.status ?? "open";
  const id = ids.allocate({
    prefix: "decision",
    label: question,
    fallbackId: "decision",
  });
  const criterionChildren = scopedChildren.filter(
    (child) => child.name === "Criterion",
  );
  const reversibility = compileReversibility({
    children: scopedChildren.filter((child) => child.name === "Reversibility"),
    diagnostics,
  });
  const detail = compileDetails({
    children: scopedChildren.filter((child) => child.name === "Details"),
    diagnostics,
  });
  validateCriteria({ children: criterionChildren, diagnostics });
  const criteria = criterionChildren.map((child) =>
    compileCriterion({ child, diagnostics, idPrefix: id, ids }),
  );
  const optionEntries = scopedChildren
    .filter((child) => child.name === "Option")
    .map((child) => ({
      child,
      option: compileOption({
        child,
        criteria,
        diagnostics,
        idPrefix: id,
        ids,
      }),
    }));
  validateDecisionOptions({
    position,
    status,
    entries: optionEntries,
    diagnostics,
  });
  const chosenOption = optionEntries.find(
    ({ option }) => option.chosen,
  )?.option;
  return {
    id,
    question,
    status,
    context: contentOf(children),
    detail,
    ...(reversibility === undefined ? {} : { reversibility }),
    criteria,
    options: optionEntries.map(({ option }) => option),
    ...(chosenOption === undefined ? {} : { chosenOption }),
  };
};
