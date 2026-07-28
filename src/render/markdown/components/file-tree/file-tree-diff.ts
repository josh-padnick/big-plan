// Declares FileTreeDiff's component integration contract; rendering lives in
// the React component library.

import { type ComponentDefinition } from "../../../../model/component-contract.js";
import { compileFileTreeDiff } from "../../../../model/compile-file-tree.js";
import { renderFileTreeDiffStatic } from "../../../../react/file-tree-diff/file-tree-diff.js";

/** Declares FileTreeDiff's complete component integration contract. */
export const FILE_TREE_DIFF_COMPONENT_DEFINITION = {
  compile: compileFileTreeDiff,
  renderStatic: (input) => renderFileTreeDiffStatic(compileFileTreeDiff(input)),
} satisfies ComponentDefinition;
