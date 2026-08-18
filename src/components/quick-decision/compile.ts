// Compiles one brief, independently answerable QuickDecision.

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
  CompiledDecisionCardOption,
} from "../_model/decision-card.js";

const QUICK_DECISION_SCHEMA = {
  question: { kind: "string", required: true, nonEmpty: true },
  context: { kind: "string" },
  critical: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;
const OPTION_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  recommended: { kind: "booleanShorthand" },
  summary: { kind: "string" },
} satisfies ComponentAttributeSchema;

const paragraph = (value: string): ElementContent => ({
  type: "element",
  tagName: "p",
  properties: {},
  children: [{ type: "text", value }],
});

const compileOption = ({
  child,
  diagnostics,
  ids,
  idPrefix,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly ids: ComponentIdAllocator;
  readonly idPrefix: string;
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
      message: "QuickDecision Option bodies are not supported; use summary",
      position: child.position,
    });
  }
  const id = ids.allocate({
    prefix: `${idPrefix}-option`,
    label: title,
    fallbackId: `${idPrefix}-option`,
  });
  return {
    id,
    titleId: `${id}-title`,
    title,
    recommended: validated.recommended === true,
    chosen: false,
    ...(validated.summary === undefined ? {} : { summary: validated.summary }),
    considerations: [],
    detail: [],
  };
};

/** Compiles a QuickDecision into the shared brief presentation model. */
export const compileQuickDecisionComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
  ids = createComponentIdAllocator(),
}: ComponentCompilerInput): CompiledDecisionCard => {
  const validated = validateComponentAttributes({
    component: "QuickDecision",
    attributes,
    position,
    diagnostics,
    schema: QUICK_DECISION_SCHEMA,
  });
  if (
    children.some((child) => child.type !== "text" || child.value.trim() !== "")
  ) {
    diagnostics.add({
      message: "QuickDecision does not accept body content; use context",
      position,
    });
  }
  const question = validated.question ?? "";
  const id = ids.allocate({
    prefix: "quick-decision",
    label: question,
    fallbackId: "quick-decision",
  });
  const optionChildren = scopedChildren.filter(
    (child) => child.name === "Option",
  );
  if (optionChildren.length < 2) {
    diagnostics.add({
      message: "QuickDecision must contain at least two Options",
      position,
    });
  }
  const seen = new Set<string>();
  for (const child of optionChildren) {
    const title = child.attributes["title"];
    if (typeof title !== "string" || title.trim() === "") continue;
    if (seen.has(title.trim())) {
      diagnostics.add({
        message: `Duplicate Option title "${title.trim()}" in QuickDecision`,
        position: child.position,
      });
    }
    seen.add(title.trim());
  }
  const recommended = optionChildren.filter(
    (child) => child.attributes["recommended"] === true,
  );
  for (const duplicate of recommended.slice(1)) {
    diagnostics.add({
      message: "QuickDecision cannot contain more than one recommended Option",
      position: duplicate.position,
    });
  }
  const options = optionChildren.map((child) =>
    compileOption({ child, diagnostics, ids, idPrefix: id }),
  );
  return {
    id,
    questionId: `${id}-question`,
    question,
    status: "open",
    layout: "brief",
    scoring: "qualitative",
    interaction: "choose",
    isCritical: validated.critical === true,
    context:
      validated.context === undefined ? [] : [paragraph(validated.context)],
    detail: [],
    criteria: [],
    options,
    discriminating: [],
  };
};
