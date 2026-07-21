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

export type CompiledFileTreeDiff = CompiledFileTree & {
  readonly hideDiff: boolean;
};

const FILE_TREE_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

// The After pane's Show diff switch defaults on; hideDiff is the authored
// opt-out for a tree whose final state matters more than its change set.
const FILE_TREE_DIFF_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
  hideDiff: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

// Runs the fence extraction and parsing shared by both trees, reporting
// whether an authored fence was present so the diff variant can layer its
// change-required check without re-parsing. Attribute validation stays with
// each public compiler so every component reports its own schema once.
const compileTree = ({
  title,
  mode,
  component,
  children,
  position,
  diagnostics,
}: Pick<
  Parameters<ComponentRenderer>[0],
  "children" | "position" | "diagnostics"
> & {
  readonly title: string | undefined;
  readonly component: string;
  readonly mode: "plain" | "diff";
}): CompiledFileTree & { readonly hasSource: boolean } => {
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
    ...(title === undefined ? {} : { title }),
    entries: parsed.entries,
    hasSource: extracted.source !== undefined,
  };
};

/** Compiles one FileTree component into the model consumed by its renderer. */
export const compileFileTree = (
  input: Parameters<ComponentRenderer>[0],
): CompiledFileTree => {
  const validated = validateComponentAttributes({
    component: "FileTree",
    attributes: input.attributes,
    position: input.position,
    diagnostics: input.diagnostics,
    schema: FILE_TREE_SCHEMA,
  });
  const model = compileTree({
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

/** Compiles one FileTreeDiff component, requiring at least one change badge. */
export const compileFileTreeDiff = (
  input: Parameters<ComponentRenderer>[0],
): CompiledFileTreeDiff => {
  const validated = validateComponentAttributes({
    component: "FileTreeDiff",
    attributes: input.attributes,
    position: input.position,
    diagnostics: input.diagnostics,
    schema: FILE_TREE_DIFF_SCHEMA,
  });
  const model = compileTree({
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
