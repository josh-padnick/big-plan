// Compiles BigDecision's criteria-matrix grammar into a render-ready model
// while collecting every decision-contract diagnostic at its owning node.

import type { ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
  type ScopedChild,
} from "../component-contract.js";
import type { DiagnosticCollector } from "../diagnostics.js";

export type BigDecisionStatus = "open" | "decided" | "deferred";
export type BigDecisionTone = "good" | "bad" | "mixed" | "neutral";

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
  readonly title: string;
  readonly summary?: string;
  readonly recommended: boolean;
  readonly chosen: boolean;
  readonly detail: ReadonlyArray<ElementContent>;
  // Aligned with the decision's criteria order; a hole is an authoring error
  // that has already been diagnosed.
  readonly scores: ReadonlyArray<CompiledBigDecisionScore | undefined>;
};

export type CompiledBigDecision = {
  readonly id: string;
  readonly question: string;
  readonly status: BigDecisionStatus;
  readonly context: ReadonlyArray<ElementContent>;
  readonly reversibility?: string;
  readonly criteria: ReadonlyArray<CompiledBigDecisionCriterion>;
  readonly options: ReadonlyArray<CompiledBigDecisionOption>;
  readonly chosenOption?: CompiledBigDecisionOption;
};

const BIG_DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
  status: { kind: "enum", values: BIG_DECISION_STATUSES },
  reversibility: { kind: "string" },
} satisfies ComponentAttributeSchema;

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

const isWhitespace = (node: ElementContent): boolean =>
  node.type === "text" && /^\s*$/u.test(node.value);

const contentOf = (
  children: ReadonlyArray<ElementContent>,
): ReadonlyArray<ElementContent> =>
  children.filter((node) => !isWhitespace(node));

// Matches the familiar heading-slug shape while keeping this component's id
// allocation independent from the document-wide heading transform.
const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");

// Allocates suffixes from authored order so repeated labels never create
// duplicate ids inside one decision, including while invalid input is being
// diagnosed.
const allocateId = ({
  prefix,
  label,
  fallback,
  counts,
}: {
  readonly prefix: string;
  readonly label: string;
  readonly fallback: string;
  readonly counts: Map<string, number>;
}): string => {
  const slug = slugify(label) || fallback;
  const base = `${prefix}-${slug}`;
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
};

const compileCriterion = ({
  child,
  diagnostics,
  idCounts,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly idCounts: Map<string, number>;
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
    id: allocateId({
      prefix: "criterion",
      label: title,
      fallback: "criterion",
      counts: idCounts,
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
  idCounts,
}: {
  readonly child: ScopedChild;
  readonly criteria: ReadonlyArray<CompiledBigDecisionCriterion>;
  readonly diagnostics: DiagnosticCollector;
  readonly idCounts: Map<string, number>;
}): CompiledBigDecisionOption => {
  const validated = validateComponentAttributes({
    component: "Option",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: OPTION_SCHEMA,
  });
  const title = validated.title ?? "";
  const scoreEntries = (child.scopedChildren ?? [])
    .filter((nested) => nested.name === "Score")
    .map((nested) => compileScore({ child: nested, diagnostics }));
  return {
    id: allocateId({
      prefix: "option",
      label: title,
      fallback: "option",
      counts: idCounts,
    }),
    title,
    ...(validated.summary === undefined ? {} : { summary: validated.summary }),
    recommended: validated.recommended === true,
    chosen: validated.chosen === true,
    detail: contentOf(child.children),
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
  readonly position: Parameters<ComponentRenderer>[0]["position"];
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
    if (typeof authoredTitle !== "string" || authoredTitle.trim() === "") {
      continue;
    }
    if (titles.has(authoredTitle)) {
      diagnostics.add({
        message: `Duplicate Option title "${authoredTitle}" in BigDecision`,
        position: entry.child.position,
      });
    }
    titles.add(authoredTitle);
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

const validateCriteria = ({
  children,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const titles = new Set<string>();
  for (const child of children) {
    const title = child.attributes["title"];
    if (typeof title !== "string" || title.trim() === "") {
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
}: Parameters<ComponentRenderer>[0]): CompiledBigDecision => {
  const validated = validateComponentAttributes({
    component: "BigDecision",
    attributes,
    position,
    diagnostics,
    schema: BIG_DECISION_SCHEMA,
  });
  const question = validated.question ?? "";
  const status = validated.status ?? "open";
  const criterionChildren = scopedChildren.filter(
    (child) => child.name === "Criterion",
  );
  validateCriteria({ children: criterionChildren, diagnostics });
  const criterionIdCounts = new Map<string, number>();
  const criteria = criterionChildren.map((child) =>
    compileCriterion({ child, diagnostics, idCounts: criterionIdCounts }),
  );
  const optionIdCounts = new Map<string, number>();
  const optionEntries = scopedChildren
    .filter((child) => child.name === "Option")
    .map((child) => ({
      child,
      option: compileOption({
        child,
        criteria,
        diagnostics,
        idCounts: optionIdCounts,
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
    id: allocateId({
      prefix: "decision",
      label: question,
      fallback: "decision",
      counts: new Map<string, number>(),
    }),
    question,
    status,
    context: contentOf(children),
    ...(validated.reversibility === undefined
      ? {}
      : { reversibility: validated.reversibility }),
    criteria,
    options: optionEntries.map(({ option }) => option),
    ...(chosenOption === undefined ? {} : { chosenOption }),
  };
};
