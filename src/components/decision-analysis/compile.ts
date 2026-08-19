// Compiles DecisionAnalysis's authored form into its plan model: one question, a
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
import type {
  CompiledDecisionCard,
  CompiledDecisionCardConsideration,
  CompiledDecisionCardCriterion,
  CompiledDecisionCardOption,
  CompiledDecisionCardReversibility,
  DecisionCardScoring,
  DecisionCardStatus,
  DecisionCardTone,
} from "../_model/decision-card.js";

export type DecisionAnalysisState = "proposed" | "decided" | "deferred";
export type DecisionAnalysisInteraction = "audit" | "choose";

const DECISION_STATUSES: ReadonlyArray<DecisionAnalysisState> = [
  "proposed",
  "decided",
  "deferred",
];
const DECISION_INTERACTIONS: ReadonlyArray<DecisionAnalysisInteraction> = [
  "audit",
  "choose",
];

const DECISION_TONES: ReadonlyArray<DecisionCardTone> = [
  "good",
  "bad",
  "mixed",
  "neutral",
];

const DECISION_SCORING: ReadonlyArray<DecisionCardScoring> = [
  "qualitative",
  "weighted",
];

// A verdict is a value to compare, not a sentence to read. The cap forces the
// normalized-word shape ("Yes", "Strong", "Somewhat"); the one-sentence reason
// belongs in the Score body.
const VERDICT_MAX_LENGTH = 24;

const DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
  state: { kind: "enum", values: DECISION_STATUSES, required: true },
  interaction: { kind: "enum", values: DECISION_INTERACTIONS, required: true },
  scoring: { kind: "enum", values: DECISION_SCORING },
  critical: { kind: "booleanShorthand" },
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

const SCORE_SCHEMA = {
  criterion: { kind: "string", required: true, nonEmpty: true },
  verdict: { kind: "string", required: true, nonEmpty: true },
  tone: { kind: "enum", values: DECISION_TONES },
  score: { kind: "string" },
} satisfies ComponentAttributeSchema;
const REVERSIBILITY_RATINGS = ["easy", "somewhat-hard", "hard"] as const;
const REVERSIBILITY_SCHEMA = {
  rating: {
    kind: "enum",
    values: REVERSIBILITY_RATINGS,
    required: true,
  },
} satisfies ComponentAttributeSchema;
const DETAILS_SCHEMA = {} satisfies ComponentAttributeSchema;

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
  readonly kind: "Criterion" | "Score";
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
          ? "A DecisionAnalysis Criterion needs one prose sentence explaining what it means"
          : "A DecisionAnalysis Score needs one prose sentence explaining why its verdict holds",
      position: child.position,
    });
    return detail;
  }
  const sentenceBreaks =
    text.match(/[.!?](?:["')\]]*)?\s+(?=[A-Z0-9])/gu)?.length ?? 0;
  if (sentenceBreaks > 0) {
    diagnostics.add({
      message: `A DecisionAnalysis ${kind} explanation must be one sentence at most`,
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
}): CompiledDecisionCardCriterion => {
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

type ScoreEntry = {
  readonly child: ScopedChild;
  readonly criterion: string;
  readonly scoreEntry: CompiledDecisionCardConsideration;
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
      message: `A Score verdict must be at most ${VERDICT_MAX_LENGTH} characters so options stay scannable; move the reasoning into the Score body`,
      position: child.position,
    });
  }
  return {
    child,
    criterion: validated.criterion ?? "",
    scoreEntry: {
      verdict,
      tone: validated.tone ?? "neutral",
      detail: validateOneSentenceBody({
        child,
        kind: "Score",
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
  readonly criteria: ReadonlyArray<CompiledDecisionCardCriterion>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<CompiledDecisionCardConsideration | undefined> => {
  const titles = new Set(criteria.map(({ title }) => title));
  const byCriterion = new Map<string, CompiledDecisionCardConsideration>();
  for (const entry of entries) {
    if (entry.criterion === "") continue;
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
    byCriterion.set(entry.criterion, entry.scoreEntry);
  }
  for (const criterion of criteria) {
    if (!byCriterion.has(criterion.title)) {
      diagnostics.add({
        message: `Option "${optionTitle}" needs a Score for criterion "${criterion.title}"`,
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
  readonly criteria: ReadonlyArray<CompiledDecisionCardCriterion>;
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
      message:
        "DecisionAnalysis Option bodies are not supported; use summary or Details",
      position: child.position,
    });
  }
  const id = ids.allocate({
    prefix: `${idPrefix}-option`,
    label: title,
    fallbackId: `${idPrefix}-option`,
  });
  const entries = (child.scopedChildren ?? [])
    .filter((nested) => nested.name === "Score")
    .map((nested) => compileScore({ child: nested, diagnostics }));
  return {
    id,
    titleId: `${id}-title`,
    title,
    recommended: validated.recommended === true,
    chosen: validated.chosen === true,
    ...(validated.summary === undefined ? {} : { summary: validated.summary }),
    considerations: alignScores({
      child,
      optionTitle: title,
      entries,
      criteria,
      diagnostics,
    }),
    detail: [],
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
        message: `Duplicate ${kind} title "${title}" in DecisionAnalysis`,
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
  readonly options: ReadonlyArray<CompiledDecisionCardOption>;
  readonly status: DecisionCardStatus;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (options.filter((option) => option.recommended).length > 1) {
    diagnostics.add({
      message:
        "DecisionAnalysis cannot contain more than one recommended Option",
      position,
    });
  }
  const chosen = options.filter((option) => option.chosen);
  if (chosen.length > 1) {
    diagnostics.add({
      message: "DecisionAnalysis cannot contain more than one chosen Option",
      position,
    });
  }
  if (chosen.length === 1 && status !== "decided") {
    diagnostics.add({
      message:
        'A DecisionAnalysis with a chosen Option must set state="decided"',
      position,
    });
  }
  if (chosen.length === 0 && status === "decided") {
    diagnostics.add({
      message:
        'A DecisionAnalysis with state="decided" must mark one Option chosen',
      position,
    });
  }
};

const validateWeightedScoring = ({
  scoring,
  criteria,
  options,
  position,
  diagnostics,
}: {
  readonly scoring: DecisionCardScoring;
  readonly criteria: ReadonlyArray<CompiledDecisionCardCriterion>;
  readonly options: ReadonlyArray<CompiledDecisionCardOption>;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (scoring !== "weighted") {
    for (const criterion of criteria) {
      if (criterion.impact !== undefined) {
        diagnostics.add({
          message:
            'A qualitative DecisionAnalysis Criterion cannot set "impact"',
          position,
        });
      }
    }
    for (const option of options) {
      for (const consideration of option.considerations) {
        if (consideration?.score !== undefined) {
          diagnostics.add({
            message: 'A qualitative DecisionAnalysis Score cannot set "score"',
            position,
          });
        }
      }
    }
    return;
  }
  for (const criterion of criteria) {
    if (criterion.impact === undefined) {
      diagnostics.add({
        message: `Weighted DecisionAnalysis Criterion "${criterion.title}" needs impact="1" through impact="5"`,
        position,
      });
    }
  }
  for (const option of options) {
    criteria.forEach((criterion, row) => {
      if (option.considerations[row]?.score === undefined) {
        diagnostics.add({
          message: `Weighted DecisionAnalysis Option "${option.title}" needs a 1–5 score for criterion "${criterion.title}"`,
          position,
        });
      }
    });
  }
};

const compileDetails = ({
  children,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<ElementContent> => {
  for (const duplicate of children.slice(1)) {
    diagnostics.add({
      message: "DecisionAnalysis cannot contain more than one Details",
      position: duplicate.position,
    });
  }
  const child = children[0];
  if (child === undefined) return [];
  validateComponentAttributes({
    component: "Details",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: DETAILS_SCHEMA,
  });
  return meaningfulChildren(child.children);
};

const compileReversibility = ({
  children,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly diagnostics: DiagnosticCollector;
}): CompiledDecisionCardReversibility | undefined => {
  if (children.length !== 1) {
    diagnostics.add({
      message: "DecisionAnalysis needs exactly one Reversibility",
      position: children[0]?.position,
    });
  }
  const child = children[0];
  if (child === undefined) return undefined;
  const validated = validateComponentAttributes({
    component: "Reversibility",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: REVERSIBILITY_SCHEMA,
  });
  if (validated.rating === undefined) return undefined;
  return {
    rating: validated.rating,
    detail: meaningfulChildren(child.children),
  };
};

/** Compiles one DecisionAnalysis into the model consumed by rendering. */
export const compileDecisionAnalysisComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
  ids = createComponentIdAllocator(),
}: ComponentCompilerInput): CompiledDecisionCard => {
  const validated = validateComponentAttributes({
    component: "DecisionAnalysis",
    attributes,
    position,
    diagnostics,
    schema: DECISION_SCHEMA,
  });
  const question = validated.question ?? "";
  const state = validated.state ?? "proposed";
  const interaction = validated.interaction ?? "audit";
  const status = state === "proposed" ? "open" : state;
  const scoring = validated.scoring ?? "qualitative";
  // Criticality is an obligation to answer, so it is only meaningful on a
  // question the reader can answer. Saying so here rather than dropping the
  // attribute quietly is what stops a settled record from being authored as a
  // blocker the approval surface would then have to explain away.
  if (
    validated.critical === true &&
    !(status === "open" && interaction === "choose")
  ) {
    diagnostics.add({
      message:
        'DecisionAnalysis marks "critical" only with state="proposed" and interaction="choose"',
      position,
    });
  }
  const id = ids.allocate({
    prefix: "decision-analysis",
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
      message: "DecisionAnalysis must contain at least one Criterion",
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
  const detail = compileDetails({
    children: scopedChildren.filter((child) => child.name === "Details"),
    diagnostics,
  });
  const reversibility = compileReversibility({
    children: scopedChildren.filter((child) => child.name === "Reversibility"),
    diagnostics,
  });
  if (options.length < 2) {
    diagnostics.add({
      message: "DecisionAnalysis must contain at least two Options",
      position,
    });
  }
  validateUniqueTitles({
    entries: optionChildren,
    kind: "Option",
    diagnostics,
  });
  validateSelection({ options, status, position, diagnostics });
  if (interaction === "choose" && state !== "proposed") {
    diagnostics.add({
      message:
        'DecisionAnalysis interaction="choose" is only valid while state="proposed"',
      position,
    });
  }
  validateWeightedScoring({
    scoring,
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
    layout: "matrix",
    scoring,
    interaction,
    isCritical: validated.critical === true,
    context: meaningfulChildren(children),
    detail,
    criteria,
    options,
    ...(chosenOption === undefined ? {} : { chosenOption }),
    discriminating,
    ...(reversibility === undefined ? {} : { reversibility }),
  };
};
