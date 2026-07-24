// Compiles BigDecision's nested authored grammar into a render-ready model
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
export type BigDecisionTradeoffKind = "pro" | "con";

const BIG_DECISION_STATUSES: ReadonlyArray<BigDecisionStatus> = [
  "open",
  "decided",
  "deferred",
];

export type CompiledBigDecisionTradeoff = {
  readonly kind: BigDecisionTradeoffKind;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledBigDecisionOption = {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly recommended: boolean;
  readonly chosen: boolean;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly tradeoffs: ReadonlyArray<CompiledBigDecisionTradeoff>;
};

export type CompiledBigDecision = {
  readonly id: string;
  readonly question: string;
  readonly status: BigDecisionStatus;
  readonly context: ReadonlyArray<ElementContent>;
  readonly options: ReadonlyArray<CompiledBigDecisionOption>;
  readonly chosenOption?: CompiledBigDecisionOption;
};

const BIG_DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
  status: { kind: "enum", values: BIG_DECISION_STATUSES },
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

// Pro and Con share an empty attribute contract; their scoped name alone
// supplies the signed presentation kind.
const compileTradeoff = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledBigDecisionTradeoff => {
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
}): CompiledBigDecisionOption => {
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
  const optionIdCounts = new Map<string, number>();
  const optionEntries = scopedChildren
    .filter((child) => child.name === "Option")
    .map((child) => ({
      child,
      option: compileOption({ child, diagnostics, idCounts: optionIdCounts }),
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
    options: optionEntries.map(({ option }) => option),
    ...(chosenOption === undefined ? {} : { chosenOption }),
  };
};
