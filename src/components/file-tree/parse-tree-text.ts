// Owns the shared FileTree and FileTreeDiff two-space-indented text grammar,
// including change metadata, renames, hierarchy, and line diagnostics.

export type TreeBadge = "added" | "modified" | "removed" | "renamed";

export type TreeEntry = {
  readonly name: string;
  readonly oldName?: string;
  readonly kind: "directory" | "file";
  readonly badge?: TreeBadge;
  readonly note?: string;
  readonly children: ReadonlyArray<TreeEntry>;
};

export type TreeParseDiagnostic = {
  readonly line: number;
  readonly message: string;
};

export type ParseTreeTextResult = {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly diagnostics: ReadonlyArray<TreeParseDiagnostic>;
};

type MutableTreeEntry = {
  readonly name: string;
  readonly oldName?: string;
  readonly kind: "directory" | "file";
  readonly badge?: TreeBadge;
  readonly note?: string;
  readonly children: Array<MutableTreeEntry>;
};

const VALID_BADGES: ReadonlyArray<TreeBadge> = [
  "added",
  "modified",
  "removed",
  "renamed",
];

const isTreeBadge = (value: string): value is TreeBadge =>
  VALID_BADGES.some((badge) => badge === value);

const sourceLines = (source: string): ReadonlyArray<string> => {
  const lines = source.split(/\r?\n/u);
  if (lines.at(-1) === "") {
    return lines.slice(0, -1);
  }
  return lines;
};

// Parses suffix metadata before hierarchy assembly so malformed badges can be
// reported without discarding an otherwise useful entry name.
const parseEntry = ({
  value,
  line,
  mode,
  diagnostics,
}: {
  readonly value: string;
  readonly line: number;
  readonly mode: "plain" | "diff";
  readonly diagnostics: Array<TreeParseDiagnostic>;
}): MutableTreeEntry | undefined => {
  const noteSeparator = value.indexOf(" - ");
  const entryValue = (
    noteSeparator === -1 ? value : value.slice(0, noteSeparator)
  ).trimEnd();
  const noteValue =
    noteSeparator === -1
      ? undefined
      : value.slice(noteSeparator + " - ".length).trimEnd();
  const badgeMatch = /^(.*) \[([^\]]*)\]$/u.exec(entryValue);
  const nameValue = (badgeMatch?.[1] ?? entryValue).trimEnd();
  const badgeValue = badgeMatch?.[2];
  const renameParts = nameValue.split(" -> ");
  const hasRename = renameParts.length > 1;
  const oldName = renameParts[0]?.trimEnd() ?? "";
  const name =
    renameParts.length === 2 ? (renameParts[1]?.trimStart() ?? "") : nameValue;

  if (name === "" || (hasRename && oldName === "")) {
    diagnostics.push({ line, message: "Expected a non-empty tree entry name" });
    return undefined;
  }
  if (noteValue !== undefined && noteValue === "") {
    diagnostics.push({ line, message: 'Expected note text after " - "' });
  }
  if (mode === "plain" && badgeValue !== undefined) {
    diagnostics.push({
      line,
      message:
        "Change badges are not supported in FileTree; use FileTreeDiff instead",
    });
  } else if (badgeValue !== undefined && !isTreeBadge(badgeValue)) {
    diagnostics.push({
      line,
      message: `Unknown badge "${badgeValue}"; expected one of: ${VALID_BADGES.join(", ")}`,
    });
  }
  if (mode === "plain" && hasRename) {
    diagnostics.push({
      line,
      message:
        "Rename arrows are not supported in FileTree; use FileTreeDiff instead",
    });
  } else if (mode === "diff" && hasRename && renameParts.length !== 2) {
    diagnostics.push({
      line,
      message: "Rename arrows must contain one old and one new name",
    });
  } else if (mode === "diff" && hasRename && badgeValue !== "renamed") {
    diagnostics.push({
      line,
      message:
        badgeValue === undefined
          ? "Rename arrows require the [renamed] badge"
          : "Rename arrows may only use the [renamed] badge",
    });
  } else if (
    mode === "diff" &&
    hasRename &&
    oldName.endsWith("/") !== name.endsWith("/")
  ) {
    diagnostics.push({
      line,
      message:
        "A rename must keep the entry as a file or keep it as a directory",
    });
  }

  return {
    name,
    ...(mode === "diff" && hasRename && renameParts.length === 2
      ? { oldName }
      : {}),
    kind: name.endsWith("/") ? "directory" : "file",
    ...(mode === "diff" && badgeValue !== undefined && isTreeBadge(badgeValue)
      ? { badge: badgeValue }
      : {}),
    ...(noteValue === undefined || noteValue === "" ? {} : { note: noteValue }),
    children: [],
  };
};

/** Parses one plain or change-bearing tree fence into nested entries. */
export const parseTreeText = ({
  source,
  mode,
}: {
  readonly source: string;
  readonly mode: "plain" | "diff";
}): ParseTreeTextResult => {
  const entries: Array<MutableTreeEntry> = [];
  const diagnostics: Array<TreeParseDiagnostic> = [];
  const ancestors: Array<MutableTreeEntry> = [];
  let previousDepth: number | undefined;

  for (const [index, value] of sourceLines(source).entries()) {
    if (/^\s*$/u.test(value)) {
      continue;
    }
    const line = index + 1;
    // The grammar promises two-space indentation, so tabs are a hard error
    // rather than silently parsing as a top-level entry named with the tab.
    if (/^ *\t/u.test(value)) {
      diagnostics.push({
        line,
        message: "Indentation must use spaces; tabs are not supported",
      });
      continue;
    }
    const indentation = /^ */u.exec(value)?.[0].length ?? 0;
    if (indentation % 2 !== 0) {
      diagnostics.push({
        line,
        message: "Indentation must use multiples of two spaces",
      });
    }
    const requestedDepth = Math.floor(indentation / 2);
    if (previousDepth !== undefined && requestedDepth > previousDepth + 1) {
      diagnostics.push({
        line,
        message: "Indentation cannot jump more than one level deeper",
      });
    }
    const depth = Math.min(requestedDepth, ancestors.length);
    const entry = parseEntry({
      value: value.slice(indentation),
      line,
      mode,
      diagnostics,
    });
    if (entry === undefined) {
      previousDepth = requestedDepth;
      continue;
    }

    const parent = depth === 0 ? undefined : ancestors[depth - 1];
    if (parent === undefined) {
      entries.push(entry);
    } else {
      if (parent.kind === "file") {
        diagnostics.push({
          line,
          message: `File "${parent.name}" cannot have children`,
        });
      }
      parent.children.push(entry);
    }
    ancestors.splice(depth, ancestors.length - depth, entry);
    previousDepth = requestedDepth;
  }

  if (entries.length === 0) {
    diagnostics.push({
      line: 1,
      message: `${mode === "plain" ? "FileTree" : "FileTreeDiff"} must contain at least one entry`,
    });
  }

  return { entries, diagnostics };
};
