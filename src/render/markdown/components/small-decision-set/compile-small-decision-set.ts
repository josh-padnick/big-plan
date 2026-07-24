// Compiles SmallDecisionSet's authored question list into a render-ready
// model while collecting every contract diagnostic at its owning node.

import type { ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
  type ScopedChild,
} from "../component-contract.js";
import type { DiagnosticCollector } from "../diagnostics.js";

export type CompiledSmallDecisionOption = {
  readonly id: string;
  readonly title: string;
  readonly recommended: boolean;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledSmallDecision = {
  readonly id: string;
  readonly question: string;
  readonly context: ReadonlyArray<ElementContent>;
  readonly options: ReadonlyArray<CompiledSmallDecisionOption>;
};

export type CompiledSmallDecisionSet = {
  readonly title?: string;
  readonly intro: ReadonlyArray<ElementContent>;
  readonly decisions: ReadonlyArray<CompiledSmallDecision>;
};

const SMALL_DECISION_SET_SCHEMA = {
  title: { kind: "string" },
} satisfies ComponentAttributeSchema;

const SMALL_DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

const OPTION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  recommended: { kind: "booleanShorthand" },
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

const compileOption = ({
  child,
  diagnostics,
  idCounts,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly idCounts: Map<string, number>;
}): CompiledSmallDecisionOption => {
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
    recommended: validated.recommended === true,
    detail: contentOf(child.children),
  };
};

// Reports uniqueness invariants only after every option schema is checked,
// avoiding misleading duplicate-title errors for invalid titles.
const validateDecisionOptions = ({
  child,
  entries,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly entries: ReadonlyArray<{
    readonly child: ScopedChild;
    readonly option: CompiledSmallDecisionOption;
  }>;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (entries.length < 2) {
    diagnostics.add({
      message: "SmallDecision must contain at least two Options",
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
        message: `Duplicate Option title "${authoredTitle}" in SmallDecision`,
        position: entry.child.position,
      });
    }
    titles.add(authoredTitle);
  }

  const recommended = entries.filter(({ option }) => option.recommended);
  for (const duplicate of recommended.slice(1)) {
    diagnostics.add({
      message: "SmallDecision cannot contain more than one recommended Option",
      position: duplicate.child.position,
    });
  }
};

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
}): CompiledSmallDecision => {
  const validated = validateComponentAttributes({
    component: "SmallDecision",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: SMALL_DECISION_SCHEMA,
  });
  const question = validated.question ?? "";
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
  validateDecisionOptions({ child, entries: optionEntries, diagnostics });
  return {
    id: allocateId({
      prefix: "question",
      label: question,
      fallback: "question",
      counts: decisionIdCounts,
    }),
    question,
    context: contentOf(child.children),
    options: optionEntries.map(({ option }) => option),
  };
};

/** Compiles one SmallDecisionSet into the model consumed by rendering. */
export const compileSmallDecisionSetComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: Parameters<ComponentRenderer>[0]): CompiledSmallDecisionSet => {
  const validated = validateComponentAttributes({
    component: "SmallDecisionSet",
    attributes,
    position,
    diagnostics,
    schema: SMALL_DECISION_SET_SCHEMA,
  });
  const decisionChildren = scopedChildren.filter(
    (child) => child.name === "SmallDecision",
  );
  if (decisionChildren.length === 0) {
    diagnostics.add({
      message: "SmallDecisionSet must contain at least one SmallDecision",
      position,
    });
  }
  const decisionIdCounts = new Map<string, number>();
  const optionIdCounts = new Map<string, number>();
  return {
    ...(validated.title === undefined ? {} : { title: validated.title }),
    intro: contentOf(children),
    decisions: decisionChildren.map((child) =>
      compileDecision({
        child,
        diagnostics,
        decisionIdCounts,
        optionIdCounts,
      }),
    ),
  };
};
