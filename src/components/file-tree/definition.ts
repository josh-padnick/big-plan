// Declares FileTree's component integration contract; rendering lives in the
// React component library.

import { compileFileTree } from "./compile.js";
import { FileTree } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { fileTreeMarkdown } from "./markdown.js";

/** Declares FileTree's complete component integration contract. */
export const FILE_TREE_COMPONENT_DEFINITION = defineComponent({
  compile: compileFileTree,
  view: FileTree,
  markdown: fileTreeMarkdown,
});
