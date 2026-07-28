// Declares FileTree's component integration contract; rendering lives in the
// React component library.

import { compileFileTree } from "./compile.js";
import { FileTree } from "./file-tree-view.js";
import { defineComponent } from "../../render/markdown/component-pipeline/define-component.js";

/** Declares FileTree's complete component integration contract. */
export const FILE_TREE_COMPONENT_DEFINITION = defineComponent({
  compile: compileFileTree,
  view: FileTree,
});
