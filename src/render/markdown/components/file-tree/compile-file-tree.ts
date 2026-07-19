// Compiles FileTree and FileTreeDiff authored HAST into render-ready models:
// validates the shared title schema and single tree fence, parses the shared
// tree grammar, and remaps parser diagnostics onto fence-relative positions.

import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
} from "../component-contract.js";
import { hasTreeChanges } from "./derive-tree-view.js";
import { parseTreeText } from "./parse-tree-text.js";
import type { TreeEntry } from "./parse-tree-text.js";
import { treeSource } from "./tree-source.js";

export type CompiledFileTree = {
  readonly title?: string;
  readonly entries: ReadonlyArray<TreeEntry>;
};

const FILE_TREE_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

// Runs the validation, fence extraction, and parsing shared by both trees,
// reporting whether an authored fence was present so the diff variant can layer
// its change-required check without re-parsing.
const compileTree = ({
  component,
  mode,
  attributes,
  children,
  position,
  diagnostics,
}: Parameters<ComponentRenderer>[0] & {
  readonly component: string;
  readonly mode: "plain" | "diff";
}): CompiledFileTree & { readonly hasSource: boolean } => {
  const validated = validateComponentAttributes({
    component,
    attributes,
    position,
    diagnostics,
    schema: FILE_TREE_SCHEMA,
  });
  const extracted = treeSource({ children });
  if (extracted.source === undefined) {
    diagnostics.add({
      message: `${component} expects exactly one fenced code block with language tree and no other content`,
      position,
    });
  }
  const parsed =
    extracted.source === undefined
      ? { entries: [], diagnostics: [] }
      : parseTreeText({ source: extracted.source, mode });
  for (const diagnostic of parsed.diagnostics) {
    const fenceLine = extracted.codePosition?.start.line;
    diagnostics.add({
      message: `Invalid tree line ${diagnostic.line}: ${diagnostic.message}`,
      position:
        fenceLine === undefined
          ? position
          : {
              start: { line: fenceLine + diagnostic.line, column: 1 },
              end: { line: fenceLine + diagnostic.line, column: 1 },
            },
    });
  }
  return {
    ...(validated.title === undefined ? {} : { title: validated.title }),
    entries: parsed.entries,
    hasSource: extracted.source !== undefined,
  };
};

/** Compiles one FileTree component into the model consumed by its renderer. */
export const compileFileTree = (
  input: Parameters<ComponentRenderer>[0],
): CompiledFileTree => {
  const model = compileTree({ ...input, component: "FileTree", mode: "plain" });
  return {
    ...(model.title === undefined ? {} : { title: model.title }),
    entries: model.entries,
  };
};

/** Compiles one FileTreeDiff component, requiring at least one change badge. */
export const compileFileTreeDiff = (
  input: Parameters<ComponentRenderer>[0],
): CompiledFileTree => {
  const model = compileTree({
    ...input,
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
  };
};
