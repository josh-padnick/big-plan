// Compiles FileTree's authored HAST into its render-ready model: validates
// the title schema, then extracts and parses the plain tree grammar through
// the model-tier tree-text home.

import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
} from "../_authoring/contract.js";
import { compileTreeSource } from "../_model/tree-text/compile-tree-source.js";
import type { TreeEntry } from "../_model/tree-text/parse-tree-text.js";

export type CompiledFileTree = {
  readonly title?: string;
  readonly entries: ReadonlyArray<TreeEntry>;
};

const FILE_TREE_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

/** Compiles one FileTree component into the model consumed by its renderer. */
export const compileFileTree = (
  input: ComponentCompilerInput,
): CompiledFileTree => {
  const validated = validateComponentAttributes({
    component: "FileTree",
    attributes: input.attributes,
    position: input.position,
    diagnostics: input.diagnostics,
    schema: FILE_TREE_SCHEMA,
  });
  const model = compileTreeSource({
    ...input,
    title: validated.title,
    component: "FileTree",
    mode: "plain",
  });
  return {
    ...(model.title === undefined ? {} : { title: model.title }),
    entries: model.entries,
  };
};
