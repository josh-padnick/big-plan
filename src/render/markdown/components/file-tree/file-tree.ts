// Declares FileTree's component integration contract; rendering lives in the
// React component library.

import { compileFileTree } from "../../../../model/compile-file-tree.js";
import { FileTree } from "../../../../ui/file-tree/file-tree.js";
import { defineComponent } from "../define-component.js";

/** Declares FileTree's complete component integration contract. */
export const FILE_TREE_COMPONENT_DEFINITION = defineComponent({
  compile: compileFileTree,
  view: FileTree,
});
