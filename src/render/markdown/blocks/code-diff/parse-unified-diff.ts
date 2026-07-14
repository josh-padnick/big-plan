// Owns the small unified-diff model used by CodeDiff, including numbered
// hunk parsing, declared-count validation, and deterministic side-by-side
// row pairing.

export type DiffLineKind = "context" | "remove" | "add";

export type DiffLine = {
  readonly kind: DiffLineKind;
  readonly text: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
};

export type DiffHunk = {
  readonly header?: string;
  readonly lines: ReadonlyArray<DiffLine>;
};

export type UnifiedDiff = {
  readonly hunks: ReadonlyArray<DiffHunk>;
  readonly hasHunkHeaders: boolean;
};

export type DiffParseDiagnostic = {
  readonly line: number;
  readonly message: string;
};

export type SplitDiffRow = {
  readonly left?: DiffLine;
  readonly right?: DiffLine;
};

export type ParseUnifiedDiffResult = {
  readonly diff: UnifiedDiff;
  readonly diagnostics: ReadonlyArray<DiffParseDiagnostic>;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;
const MAX_SAFE_HUNK_VALUE = BigInt(Number.MAX_SAFE_INTEGER);

type HunkCoordinates = {
  readonly oldStart: number;
  readonly newStart: number;
  readonly oldCount: number;
  readonly newCount: number;
};

// Parses hunk coordinates only when every declared line number remains exact.
const hunkCoordinates = (match: RegExpExecArray): HunkCoordinates | undefined => {
  const oldStartValue = match[1];
  const newStartValue = match[3];
  if (oldStartValue === undefined || newStartValue === undefined) {
    return undefined;
  }
  const oldStart = BigInt(oldStartValue);
  const newStart = BigInt(newStartValue);
  const oldCount = BigInt(match[2] ?? "1");
  const newCount = BigInt(match[4] ?? "1");
  const oldEnd = oldCount === 0n ? oldStart : oldStart + oldCount - 1n;
  const newEnd = newCount === 0n ? newStart : newStart + newCount - 1n;
  if ([oldStart, newStart, oldCount, newCount, oldEnd, newEnd].some(
    (value) => value > MAX_SAFE_HUNK_VALUE,
  )) {
    return undefined;
  }
  return {
    oldStart: Number(oldStart),
    newStart: Number(newStart),
    oldCount: Number(oldCount),
    newCount: Number(newCount),
  };
};

const incrementLineNumber = (value: number): number | undefined =>
  value === Number.MAX_SAFE_INTEGER ? undefined : value + 1;

// git diff emits these file-header lines before the first hunk; accepting
// them lets authors paste git output verbatim. After a hunk starts, `---`
// and `+++` become ambiguous with content, so the allowance ends there.
const GIT_PREAMBLE = [
  /^diff /u,
  /^index /u,
  /^--- /u,
  /^\+\+\+ /u,
  /^(?:old|new) mode /u,
  /^(?:new|deleted) file mode /u,
  /^(?:similarity|dissimilarity) index /u,
  /^(?:rename|copy) (?:from|to) /u,
  /^Binary files /u,
] as const;

const isGitPreamble = (value: string): boolean =>
  GIT_PREAMBLE.some((pattern) => pattern.test(value));

const sourceLines = (source: string): ReadonlyArray<string> => {
  const lines = source.split("\n");
  if (source.endsWith("\n")) {
    lines.pop();
  }
  return source === "" ? [] : lines;
};

// Parses a content line and advances exactly the counters that the line
// consumes. Counter absence is how headerless diffs avoid invented numbers.
const parseContentLine = ({
  value,
  oldLineNumber,
  newLineNumber,
}: {
  readonly value: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}): {
  readonly line?: DiffLine;
  readonly nextOldLineNumber?: number;
  readonly nextNewLineNumber?: number;
} => {
  // Editors routinely strip trailing whitespace, turning a context line for
  // an empty source line (a lone space) into an empty string; git tooling
  // tolerates that, so this parser does too.
  if (value === "") {
    return {
      line: { kind: "context", text: "", oldLineNumber, newLineNumber },
      ...(oldLineNumber === undefined
        ? {}
        : { nextOldLineNumber: incrementLineNumber(oldLineNumber) }),
      ...(newLineNumber === undefined
        ? {}
        : { nextNewLineNumber: incrementLineNumber(newLineNumber) }),
    };
  }
  const marker = value[0];
  const text = value.slice(1);
  if (marker === " ") {
    return {
      line: { kind: "context", text, oldLineNumber, newLineNumber },
      ...(oldLineNumber === undefined
        ? {}
        : { nextOldLineNumber: incrementLineNumber(oldLineNumber) }),
      ...(newLineNumber === undefined
        ? {}
        : { nextNewLineNumber: incrementLineNumber(newLineNumber) }),
    };
  }
  if (marker === "-") {
    return {
      line: { kind: "remove", text, oldLineNumber },
      ...(oldLineNumber === undefined
        ? {}
        : { nextOldLineNumber: incrementLineNumber(oldLineNumber) }),
      ...(newLineNumber === undefined ? {} : { nextNewLineNumber: newLineNumber }),
    };
  }
  if (marker === "+") {
    return {
      line: { kind: "add", text, newLineNumber },
      ...(oldLineNumber === undefined ? {} : { nextOldLineNumber: oldLineNumber }),
      ...(newLineNumber === undefined
        ? {}
        : { nextNewLineNumber: incrementLineNumber(newLineNumber) }),
    };
  }
  return {};
};

/** Parses and validates the supported unified-diff subset without reconstructing it. */
export const parseUnifiedDiff = ({
  source,
}: {
  readonly source: string;
}): ParseUnifiedDiffResult => {
  const values = sourceLines(source);
  const hasHunkHeaders = values.some((value) => HUNK_HEADER.test(value));
  const diagnostics: Array<DiffParseDiagnostic> = [];
  const hunks: Array<DiffHunk> = [];
  let header: string | undefined;
  let lines: Array<DiffLine> = [];
  let oldLineNumber: number | undefined;
  let newLineNumber: number | undefined;
  let declaredOldCount: number | undefined;
  let declaredNewCount: number | undefined;
  let headerLine: number | undefined;

  const finishHunk = (): void => {
    if (header !== undefined || lines.length > 0 || (!hasHunkHeaders && hunks.length === 0)) {
      hunks.push({ ...(header === undefined ? {} : { header }), lines });
    }
    if (
      declaredOldCount === undefined ||
      declaredNewCount === undefined ||
      headerLine === undefined
    ) {
      return;
    }
    const actualOldCount = lines.filter((line) => line.kind !== "add").length;
    const actualNewCount = lines.filter((line) => line.kind !== "remove").length;
    if (actualOldCount !== declaredOldCount || actualNewCount !== declaredNewCount) {
      diagnostics.push({
        line: headerLine,
        message:
          `Hunk declares ${declaredOldCount} old and ${declaredNewCount} new lines ` +
          `but contains ${actualOldCount} old and ${actualNewCount} new lines`,
      });
    }
  };

  for (const [index, value] of values.entries()) {
    const match = HUNK_HEADER.exec(value);
    if (match !== null) {
      finishHunk();
      header = value;
      lines = [];
      headerLine = index + 1;
      const coordinates = hunkCoordinates(match);
      oldLineNumber = coordinates?.oldStart;
      newLineNumber = coordinates?.newStart;
      declaredOldCount = coordinates?.oldCount;
      declaredNewCount = coordinates?.newCount;
      if (coordinates === undefined) {
        diagnostics.push({
          line: headerLine,
          message:
            `Hunk values and line-number ranges must not exceed ${Number.MAX_SAFE_INTEGER}`,
        });
      }
      continue;
    }
    if (value === "\\ No newline at end of file") {
      continue;
    }
    if (hasHunkHeaders && header === undefined) {
      if (isGitPreamble(value)) {
        continue;
      }
      diagnostics.push({
        line: index + 1,
        message: "Expected a hunk header before diff content",
      });
      continue;
    }
    const parsed = parseContentLine({ value, oldLineNumber, newLineNumber });
    if (parsed.line === undefined) {
      diagnostics.push({
        line: index + 1,
        message: "Expected a diff line beginning with space, +, or -",
      });
      continue;
    }
    lines.push(parsed.line);
    oldLineNumber = parsed.nextOldLineNumber;
    newLineNumber = parsed.nextNewLineNumber;
  }
  finishHunk();

  return { diff: { hunks, hasHunkHeaders }, diagnostics };
};

/** Pairs remove-then-add runs and mirrors context into both split panes. */
export const pairDiffLines = ({
  lines,
}: {
  readonly lines: ReadonlyArray<DiffLine>;
}): ReadonlyArray<SplitDiffRow> => {
  const rows: Array<SplitDiffRow> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) {
      index += 1;
      continue;
    }
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    if (line.kind === "add") {
      rows.push({ right: line });
      index += 1;
      continue;
    }

    const removals: Array<DiffLine> = [];
    while (lines[index]?.kind === "remove") {
      const removal = lines[index];
      if (removal !== undefined) {
        removals.push(removal);
      }
      index += 1;
    }
    const additions: Array<DiffLine> = [];
    while (lines[index]?.kind === "add") {
      const addition = lines[index];
      if (addition !== undefined) {
        additions.push(addition);
      }
      index += 1;
    }
    const rowCount = Math.max(removals.length, additions.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const left = removals[rowIndex];
      const right = additions[rowIndex];
      rows.push({
        ...(left === undefined ? {} : { left }),
        ...(right === undefined ? {} : { right }),
      });
    }
  }
  return rows;
};
