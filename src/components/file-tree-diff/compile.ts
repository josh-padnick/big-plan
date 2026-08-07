// Compiles FileTreeDiff's authored HAST into its render-ready model:
// validates the title and hideDiff schema, extracts and parses the diff tree
// grammar through the model-tier tree-text home, and requires at least one
// change badge.

import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
} from "../_authoring/contract.js";
import { compileTreeSource } from "../_model/tree-text/compile-tree-source.js";
import { hasTreeChanges } from "../_model/tree-text/derive-tree-view.js";
import type { TreeEntry } from "../_model/tree-text/parse-tree-text.js";

export type CompiledFileTreeDiff = {
  readonly title?: string;
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly hideDiff: boolean;
};

// hideDiff selects the static planned-state pane variant; the viewer's only
// interactive tree control is the combined/side-by-side view switch.
const FILE_TREE_DIFF_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
  hideDiff: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

/** Compiles one FileTreeDiff component, requiring at least one change badge. */
export const compileFileTreeDiff = (
  input: ComponentCompilerInput,
): CompiledFileTreeDiff => {
  const validated = validateComponentAttributes({
    component: "FileTreeDiff",
    attributes: input.attributes,
    position: input.position,
    diagnostics: input.diagnostics,
    schema: FILE_TREE_DIFF_SCHEMA,
  });
  const model = compileTreeSource({
    ...input,
    title: validated.title,
    component: "FileTreeDiff",
    mode: "diff",
  });
  if (model.hasSource && !hasTreeChanges({ entries: model.entries })) {
    input.diagnostics.add({
      message:
        "FileTreeDiff requires at least one change badge; use FileTree for a plain hierarchy",
      position: input.position,
    });
  }
  return {
    ...(model.title === undefined ? {} : { title: model.title }),
    entries: model.entries,
    hideDiff: validated.hideDiff === true,
  };
};
