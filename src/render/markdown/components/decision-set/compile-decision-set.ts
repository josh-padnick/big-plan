// Compiles DecisionSet's nested authored grammar into a render-ready model
// while collecting every decision-contract diagnostic at its owning node.

import type { ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
  type ScopedChild,
} from "../component-contract.js";
import type { DiagnosticCollector } from "../diagnostics.js";

export type DecisionStatus = "open" | "decided" | "deferred";
export type DecisionTradeoffKind = "pro" | "con";

const DECISION_STATUSES: ReadonlyArray<DecisionStatus> = [
  "open",
  "decided",
  "deferred",
];

export type CompiledDecisionTradeoff = {
  readonly kind: DecisionTradeoffKind;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledDecisionOption = {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly recommended: boolean;
  readonly chosen: boolean;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly tradeoffs: ReadonlyArray<CompiledDecisionTradeoff>;
};

export type CompiledDecision = {
  readonly id: string;
  readonly question: string;
  readonly status: DecisionStatus;
  readonly context: ReadonlyArray<ElementContent>;
  readonly options: ReadonlyArray<CompiledDecisionOption>;
  readonly chosenOption?: CompiledDecisionOption;
};

export type CompiledDecisionSet = {
  readonly title?: string;
  readonly intro: ReadonlyArray<ElementContent>;
  readonly decisions: ReadonlyArray<CompiledDecision>;
  readonly openCount: number;
};

const DECISION_SET_SCHEMA = {
  title: { kind: "string" },
} satisfies ComponentAttributeSchema;

const DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
  status: { kind: "enum", values: DECISION_STATUSES },
} satisfies ComponentAttributeSchema;

const OPTION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  summary: { kind: "string" },
  recommended: { kind: "booleanShorthand" },
  chosen: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const EMPTY_SCHEMA = {} satisfies ComponentAttributeSchema;

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
// duplicate document ids, including while invalid input is being diagnosed.
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

// Pro and Con share an empty attribute contract; their scoped name alone
// supplies the signed presentation kind.
const compileTradeoff = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledDecisionTradeoff => {
  validateComponentAttributes({
    component: child.name,
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: EMPTY_SCHEMA,
  });
  return {
    kind: child.name === "Pro" ? "pro" : "con",
    children: contentOf(child.children),
  };
};

// Preserves the always-visible tradeoffs separately from free-form option
// detail so the renderer can disclose only the genuinely deeper layer.
const compileOption = ({
  child,
  diagnostics,
  idCounts,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly idCounts: Map<string, number>;
}): CompiledDecisionOption => {
  const validated = validateComponentAttributes({
    component: "Option",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: OPTION_SCHEMA,
  });
  const title = validated.title ?? "";
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
    tradeoffs: (child.scopedChildren ?? [])
      .filter((nested) => nested.name === "Pro" || nested.name === "Con")
      .map((nested) => compileTradeoff({ child: nested, diagnostics })),
  };
};

// Reports uniqueness and outcome invariants only after every option schema is
// checked, avoiding misleading duplicate-title errors for invalid titles.
const validateDecisionOptions = ({
  child,
  status,
  entries,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly status: DecisionStatus;
  readonly entries: ReadonlyArray<{
    readonly child: ScopedChild;
    readonly option: CompiledDecisionOption;
  }>;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (entries.length < 2) {
    diagnostics.add({
      message: "Decision must contain at least two Options",
      position: child.position,
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
        message: `Duplicate Option title "${authoredTitle}" in Decision`,
        position: entry.child.position,
      });
    }
    titles.add(authoredTitle);
  }

  const recommended = entries.filter(({ option }) => option.recommended);
  for (const duplicate of recommended.slice(1)) {
    diagnostics.add({
      message: "Decision cannot contain more than one recommended Option",
      position: duplicate.child.position,
    });
  }

  const chosen = entries.filter(({ option }) => option.chosen);
  for (const duplicate of chosen.slice(1)) {
    diagnostics.add({
      message: "Decision cannot contain more than one chosen Option",
      position: duplicate.child.position,
    });
  }
  if (status !== "decided") {
    for (const entry of chosen) {
      diagnostics.add({
        message:
          'A chosen Option requires its Decision to have status "decided"',
        position: entry.child.position,
      });
    }
  } else if (chosen.length === 0) {
    diagnostics.add({
      message:
        'A Decision with status "decided" must contain exactly one chosen Option',
      position: child.position,
    });
  }
};

// Compiles one decision after its nested Options have been separated from the
// context body by the registry's recursive scoped-child collection.
const compileDecision = ({
  child,
  diagnostics,
  decisionIdCounts,
  optionIdCounts,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly decisionIdCounts: Map<string, number>;
  readonly optionIdCounts: Map<string, number>;
}): CompiledDecision => {
  const validated = validateComponentAttributes({
    component: "Decision",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: DECISION_SCHEMA,
  });
  const question = validated.question ?? "";
  const status = validated.status ?? "open";
  const optionEntries = (child.scopedChildren ?? [])
    .filter((nested) => nested.name === "Option")
    .map((nested) => ({
      child: nested,
      option: compileOption({
        child: nested,
        diagnostics,
        idCounts: optionIdCounts,
      }),
    }));
  validateDecisionOptions({
    child,
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
      counts: decisionIdCounts,
    }),
    question,
    status,
    context: contentOf(child.children),
    options: optionEntries.map(({ option }) => option),
    ...(chosenOption === undefined ? {} : { chosenOption }),
  };
};

/** Compiles one DecisionSet component into the model consumed by rendering. */
export const compileDecisionSetComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: Parameters<ComponentRenderer>[0]): CompiledDecisionSet => {
  const validated = validateComponentAttributes({
    component: "DecisionSet",
    attributes,
    position,
    diagnostics,
    schema: DECISION_SET_SCHEMA,
  });
  const decisionChildren = scopedChildren.filter(
    (child) => child.name === "Decision",
  );
  if (decisionChildren.length === 0) {
    diagnostics.add({
      message: "DecisionSet must contain at least one Decision",
      position,
    });
  }
  const decisionIdCounts = new Map<string, number>();
  const optionIdCounts = new Map<string, number>();
  const decisions = decisionChildren.map((child) =>
    compileDecision({
      child,
      diagnostics,
      decisionIdCounts,
      optionIdCounts,
    }),
  );
  return {
    ...(validated.title === undefined ? {} : { title: validated.title }),
    intro: contentOf(children),
    decisions,
    openCount: decisions.filter((decision) => decision.status === "open")
      .length,
  };
};
