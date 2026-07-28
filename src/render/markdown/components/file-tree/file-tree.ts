// Declares FileTree's component integration contract; rendering lives in the
// React component library.

import { type ComponentDefinition } from "../../../../model/component-contract.js";
import { compileFileTree } from "../../../../model/compile-file-tree.js";
import { renderFileTreeStatic } from "../../../../react/file-tree/file-tree.js";

/** Declares FileTree's complete component integration contract. */
export const FILE_TREE_COMPONENT_DEFINITION = {
  compile: compileFileTree,
  renderStatic: (input) => renderFileTreeStatic(compileFileTree(input)),
} satisfies ComponentDefinition;
