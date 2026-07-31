// Compiles TableOfContents's authored form into its plan model: one overview entry
// per Entry, each carrying a section's structural name and one-line gist. Section links,
// slide numbers, and part group headers are document-order knowledge the
// view reads from the document outline the renderer computes.

import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";

export type CompiledTableOfContentsEntry = {
  readonly section: string;
  readonly gist: string;
};

export type CompiledTableOfContents = {
  readonly entries: ReadonlyArray<CompiledTableOfContentsEntry>;
};

const ENTRY_SCHEMA = {
  section: { kind: "string", required: true, nonEmpty: true },
  gist: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

// Validates one Entry into an overview entry; every violation reports at the
// entry's own position.
const compileEntry = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledTableOfContentsEntry | undefined => {
  const validated = validateComponentAttributes({
    component: "Entry",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: ENTRY_SCHEMA,
  });
  if (meaningfulChildren(child.children).length > 0) {
    diagnostics.add({
      message:
        'Entry is self-closing; write <Entry section="..." gist="..." /> with no body content',
      position: child.position,
    });
  }
  if (validated.section === undefined || validated.gist === undefined) {
    return undefined;
  }
  return { section: validated.section, gist: validated.gist };
};

/** Compiles one TableOfContents component into the model consumed by rendering. */
export const compileTableOfContentsComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: ComponentCompilerInput): CompiledTableOfContents => {
  validateComponentAttributes({
    component: "TableOfContents",
    attributes,
    position,
    diagnostics,
    schema: {},
  });
  if (meaningfulChildren(children).length > 0) {
    diagnostics.add({
      message:
        "TableOfContents holds only Entry rows; move loose content into the plan body",
      position,
    });
  }
  if (scopedChildren.length === 0) {
    diagnostics.add({
      message:
        "TableOfContents needs at least one Entry naming a section and its gist",
      position,
    });
  }
  return {
    entries: scopedChildren.flatMap((child) => {
      const entry = compileEntry({ child, diagnostics });
      return entry === undefined ? [] : [entry];
    }),
  };
};
