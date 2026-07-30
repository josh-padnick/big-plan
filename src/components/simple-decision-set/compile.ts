// Compiles SimpleDecisionSet's authored question list into a render-ready
// model while collecting every contract diagnostic at its owning node.

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

export type CompiledSimpleDecisionOption = {
  readonly id: string;
  readonly titleId: string;
  readonly title: string;
  readonly recommended: boolean;
  readonly detailId?: string;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledSimpleDecision = {
  readonly id: string;
  readonly question: string;
  readonly context: ReadonlyArray<ElementContent>;
  readonly options: ReadonlyArray<CompiledSimpleDecisionOption>;
};

export type CompiledSimpleDecisionSet = {
  readonly id: string;
  readonly title?: string;
  readonly intro: ReadonlyArray<ElementContent>;
  readonly decisions: ReadonlyArray<CompiledSimpleDecision>;
};

const SIMPLE_DECISION_SET_SCHEMA = {
  title: { kind: "string" },
} satisfies ComponentAttributeSchema;

const SIMPLE_DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

const OPTION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  recommended: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const contentOf = (
  children: ReadonlyArray<ElementContent>,
): ReadonlyArray<ElementContent> => meaningfulChildren(children);

const compileOption = ({
  child,
  diagnostics,
  idPrefix,
  ids,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly idPrefix: string;
  readonly ids: ComponentIdAllocator;
}): CompiledSimpleDecisionOption => {
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
  const detail = contentOf(child.children);
  const detailId =
    detail.length === 0
      ? undefined
      : ids.allocate({
          prefix: id,
          label: "details",
          fallbackId: `${id}-details`,
        });
  return {
    id,
    titleId: ids.allocate({
      prefix: id,
      label: "title",
      fallbackId: `${id}-title`,
    }),
    title,
    recommended: validated.recommended === true,
    ...(detailId === undefined ? {} : { detailId }),
    detail,
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
    readonly option: CompiledSimpleDecisionOption;
  }>;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (entries.length < 2) {
    diagnostics.add({
      message: "SimpleDecision must contain at least two Options",
      position: child.position,
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
        message: `Duplicate Option title "${title}" in SimpleDecision`,
        position: entry.child.position,
      });
    }
    titles.add(title);
  }

  const recommended = entries.filter(({ option }) => option.recommended);
  for (const duplicate of recommended.slice(1)) {
    diagnostics.add({
      message: "SimpleDecision cannot contain more than one recommended Option",
      position: duplicate.child.position,
    });
  }
};

const compileDecision = ({
  child,
  diagnostics,
  idPrefix,
  ids,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly idPrefix: string;
  readonly ids: ComponentIdAllocator;
}): CompiledSimpleDecision => {
  const validated = validateComponentAttributes({
    component: "SimpleDecision",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: SIMPLE_DECISION_SCHEMA,
  });
  const question = validated.question ?? "";
  const id = ids.allocate({
    prefix: `${idPrefix}-question`,
    label: question,
    fallbackId: `${idPrefix}-question`,
  });
  const optionEntries = (child.scopedChildren ?? [])
    .filter((nested) => nested.name === "Option")
    .map((nested) => ({
      child: nested,
      option: compileOption({
        child: nested,
        diagnostics,
        idPrefix: id,
        ids,
      }),
    }));
  validateDecisionOptions({ child, entries: optionEntries, diagnostics });
  return {
    id,
    question,
    context: contentOf(child.children),
    options: optionEntries.map(({ option }) => option),
  };
};

/** Compiles one SimpleDecisionSet into the model consumed by rendering. */
export const compileSimpleDecisionSetComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
  ids = createComponentIdAllocator(),
}: ComponentCompilerInput): CompiledSimpleDecisionSet => {
  const validated = validateComponentAttributes({
    component: "SimpleDecisionSet",
    attributes,
    position,
    diagnostics,
    schema: SIMPLE_DECISION_SET_SCHEMA,
  });
  const decisionChildren = scopedChildren.filter(
    (child) => child.name === "SimpleDecision",
  );
  if (decisionChildren.length === 0) {
    diagnostics.add({
      message: "SimpleDecisionSet must contain at least one SimpleDecision",
      position,
    });
  }
  const id = ids.allocate({
    prefix: "simple-decision-set",
    label: validated.title ?? "",
    fallbackId: "simple-decision-set",
  });
  return {
    id,
    ...(validated.title === undefined ? {} : { title: validated.title }),
    intro: contentOf(children),
    decisions: decisionChildren.map((child) =>
      compileDecision({
        child,
        diagnostics,
        idPrefix: id,
        ids,
      }),
    ),
  };
};
