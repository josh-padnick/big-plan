// Declares FileTreeDiff's component integration contract; rendering lives in
// the React component library.

import { compileFileTreeDiff } from "../../../../model/compile-file-tree.js";
import { FileTreeDiff } from "../../../../ui/file-tree-diff/file-tree-diff.js";
import { defineComponent } from "../define-component.js";

/** Declares FileTreeDiff's complete component integration contract. */
export const FILE_TREE_DIFF_COMPONENT_DEFINITION = defineComponent({
  compile: compileFileTreeDiff,
  view: FileTreeDiff,
});
