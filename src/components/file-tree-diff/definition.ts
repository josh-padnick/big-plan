// Declares FileTreeDiff's component integration contract; rendering lives in
// the React component library.

import { compileFileTreeDiff } from "./compile.js";
import { FileTreeDiff } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { defineRevisionAdapter } from "../_registration/revision-adapter.js";

/** Declares FileTreeDiff's complete component integration contract. */
export const FILE_TREE_DIFF_COMPONENT_DEFINITION = defineComponent({
  compile: compileFileTreeDiff,
  view: FileTreeDiff,
  revision: defineRevisionAdapter({ view: FileTreeDiff }),
});
