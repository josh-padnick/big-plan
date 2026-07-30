// Compiles the authored tree-fence source shared by FileTree and
// FileTreeDiff: extracts the single fenced code block with language tree,
// parses the shared tree grammar, and remaps parser diagnostics onto
// fence-relative positions. Attribute validation stays with each public
// compiler so every component reports its own schema once.

import { singleAuthoredFence } from "../../_authoring/authored-body.js";
import type { ComponentCompilerInput } from "../../_authoring/contract.js";
import { parseTreeText } from "./parse-tree-text.js";
import type { TreeEntry } from "./parse-tree-text.js";

export type CompiledTreeSource = {
  readonly title?: string;
  readonly entries: ReadonlyArray<TreeEntry>;
  // Whether an authored fence was present, so the diff variant can layer its
  // change-required check without re-parsing.
  readonly hasSource: boolean;
};

/** Extracts and parses one tree component's single authored tree fence. */
export const compileTreeSource = ({
  title,
  mode,
  component,
  children,
  position,
  diagnostics,
}: Pick<ComponentCompilerInput, "children" | "position" | "diagnostics"> & {
  readonly title: string | undefined;
  readonly component: string;
  readonly mode: "plain" | "diff";
}): CompiledTreeSource => {
  const extracted = singleAuthoredFence({ children, language: "tree" });
  if (extracted === undefined) {
    diagnostics.add({
      message: `${component} expects exactly one fenced code block with language tree and no other content`,
      position,
    });
  }
  const parsed =
    extracted === undefined
      ? { entries: [], diagnostics: [] }
      : parseTreeText({ source: extracted.source, mode });
  for (const diagnostic of parsed.diagnostics) {
    const fenceLine = extracted?.codePosition?.start.line;
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
    hasSource: extracted !== undefined,
  };
};
