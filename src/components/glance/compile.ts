// Compiles Glance's authored form into its plan model: one overview entry
// per Item, each naming a section and its one-line gist. Section links,
// slide numbers, and part group headers are document-order knowledge the
// renderer's deck transform completes.

import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";

export type CompiledGlanceItem = {
  readonly section: string;
  readonly gist: string;
};

export type CompiledGlance = {
  readonly items: ReadonlyArray<CompiledGlanceItem>;
};

const ITEM_SCHEMA = {
  section: { kind: "string", required: true, nonEmpty: true },
  gist: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

// Validates one Item into an overview entry; every violation reports at the
// item's own position.
const compileItem = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledGlanceItem | undefined => {
  const validated = validateComponentAttributes({
    component: "Item",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: ITEM_SCHEMA,
  });
  if (meaningfulChildren(child.children).length > 0) {
    diagnostics.add({
      message:
        'Item is self-closing; write <Item section="..." gist="..." /> with no body content',
      position: child.position,
    });
  }
  if (validated.section === undefined || validated.gist === undefined) {
    return undefined;
  }
  return { section: validated.section, gist: validated.gist };
};

/** Compiles one Glance component into the model consumed by rendering. */
export const compileGlanceComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: ComponentCompilerInput): CompiledGlance => {
  validateComponentAttributes({
    component: "Glance",
    attributes,
    position,
    diagnostics,
    schema: {},
  });
  if (meaningfulChildren(children).length > 0) {
    diagnostics.add({
      message:
        "Glance holds only Item entries; move loose content into the plan body",
      position,
    });
  }
  if (scopedChildren.length === 0) {
    diagnostics.add({
      message: "Glance needs at least one Item naming a section and its gist",
      position,
    });
  }
  return {
    items: scopedChildren.flatMap((child) => {
      const item = compileItem({ child, diagnostics });
      return item === undefined ? [] : [item];
    }),
  };
};
