// Owns revision-to-revision block alignment and plain-text word diffs for the
// live review runtime. It is intentionally DOM- and filesystem-free so the
// attribution contract and browser route share one deterministic answer.

type RevisionBlock = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly section: string;
  readonly text: string;
  readonly markedText: string;
  readonly parentBlockId?: string;
};

export type DiffRun = {
  readonly op: "same" | "del" | "ins";
  readonly text: string;
};

export type RevisionDiffLocation = {
  readonly status: "changed" | "added" | "removed";
  readonly oldBlockId?: string;
  readonly newBlockId?: string;
  readonly kind: string;
  readonly label: string;
  readonly section: string;
  readonly oldText: string;
  readonly newText: string;
  readonly runs: ReadonlyArray<DiffRun>;
  readonly beforeBlockId?: string;
  readonly afterBlockId?: string;
  readonly parentBlockId?: string;
};

export const INLINE_CODE_SENTINEL = "\u0011";

/** Translates a plain comment offset into sentinel-marked diff coordinates. */
export const markedOffsetForPlainOffset = ({
  markedText,
  plainOffset,
}: {
  readonly markedText: string;
  readonly plainOffset: number;
}): number => {
  let plainCursor = 0;
  for (
    let markedCursor = 0;
    markedCursor < markedText.length;
    markedCursor += 1
  ) {
    if (plainCursor === plainOffset) return markedCursor;
    if (markedText[markedCursor] !== INLINE_CODE_SENTINEL) plainCursor += 1;
  }
  return markedText.length;
};

/** Formats one diff band without leaking table cell newlines into the lens. */
export const bandText = ({
  location,
  side,
}: {
  readonly location: Pick<RevisionDiffLocation, "kind" | "oldText" | "newText">;
  readonly side: "old" | "new";
}): string => {
  const value = side === "old" ? location.oldText : location.newText;
  if (location.kind !== "table" && location.kind !== "table-row") {
    return value;
  }
  return value
    .replaceAll(INLINE_CODE_SENTINEL, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" · ");
};

/** Keeps inline comment attribution only where it clarifies prose diffs. */
export const diffKindShowsComment = (kind: string): boolean =>
  kind !== "table" &&
  kind !== "table-row" &&
  kind !== "code" &&
  !kind.includes("diff");

/** Includes a precise child location when an outcome attributes its container. */
export const diffLocationMatchesTarget = ({
  location,
  target,
}: {
  readonly location: Pick<
    RevisionDiffLocation,
    "oldBlockId" | "newBlockId" | "parentBlockId"
  >;
  readonly target: string;
}): boolean =>
  location.newBlockId === target ||
  location.oldBlockId === target ||
  location.parentBlockId === target;

/** Measures how much text survives a diff, independent of insert/delete size. */
export const diffRunSimilarity = (runs: ReadonlyArray<DiffRun>): number => {
  const meaningfulLength = (value: string): number =>
    value.replace(/\s/g, "").length;
  let same = 0;
  let before = 0;
  let after = 0;
  for (const run of runs) {
    const length = meaningfulLength(run.text);
    if (run.op === "same") {
      same += length;
      before += length;
      after += length;
    } else if (run.op === "del") {
      before += length;
    } else {
      after += length;
    }
  }
  const length = Math.max(before, after);
  return length === 0 ? 1 : same / length;
};

/** Chooses bands when word interleaving would make a substantial rewrite hard to read. */
export const diffPresentationMode = (
  runs: ReadonlyArray<DiffRun>,
): "inline" | "bands" => {
  const changedRuns = runs.filter((run) => run.op !== "same").length;
  const sameCharacters = runs
    .filter((run) => run.op === "same")
    .reduce(
      (total, run) =>
        total + run.text.replaceAll(INLINE_CODE_SENTINEL, "").length,
      0,
    );
  return diffRunSimilarity(runs) < 0.32 ||
    changedRuns > Math.max(6, sameCharacters / 24)
    ? "bands"
    : "inline";
};

const normalized = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

const scopeOf = (block: RevisionBlock): string => {
  const slash = block.id.lastIndexOf("/");
  return slash < 0 ? block.section : block.id.slice(0, slash);
};

const lcsPairs = ({
  left,
  right,
  equals,
}: {
  readonly left: ReadonlyArray<number>;
  readonly right: ReadonlyArray<number>;
  readonly equals: (leftIndex: number, rightIndex: number) => boolean;
}): ReadonlyArray<readonly [number, number]> => {
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  const cell = (row: number, column: number): number =>
    lengths.at(row)?.at(column) ?? 0;
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const leftValue = left.at(leftIndex);
      const rightValue = right.at(rightIndex);
      const row = lengths.at(leftIndex);
      if (
        leftValue === undefined ||
        rightValue === undefined ||
        row === undefined
      ) {
        continue;
      }
      row[rightIndex] = equals(leftValue, rightValue)
        ? 1 + cell(leftIndex + 1, rightIndex + 1)
        : Math.max(
            cell(leftIndex + 1, rightIndex),
            cell(leftIndex, rightIndex + 1),
          );
    }
  }
  const pairs: Array<readonly [number, number]> = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = left.at(leftIndex);
    const rightValue = right.at(rightIndex);
    if (leftValue === undefined || rightValue === undefined) break;
    if (equals(leftValue, rightValue)) {
      pairs.push([leftValue, rightValue]);
      leftIndex += 1;
      rightIndex += 1;
    } else if (
      cell(leftIndex + 1, rightIndex) >= cell(leftIndex, rightIndex + 1)
    ) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return pairs;
};

const tokens = (value: string): ReadonlyArray<string> =>
  value.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

/** Produces compact same/delete/insert runs without importing a UI library. */
export const diffWords = ({
  before,
  after,
}: {
  readonly before: string;
  readonly after: string;
}): ReadonlyArray<DiffRun> => {
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  const oldIndexes = oldTokens.map((_, index) => index);
  const newIndexes = newTokens.map((_, index) => index);
  const pairs = lcsPairs({
    left: oldIndexes,
    right: newIndexes,
    equals: (leftIndex, rightIndex) =>
      oldTokens[leftIndex] === newTokens[rightIndex],
  });
  const runs: Array<DiffRun> = [];
  const append = (op: DiffRun["op"], text: string): void => {
    if (text === "") return;
    const previous = runs.at(-1);
    if (previous?.op === op) {
      runs[runs.length - 1] = { op, text: previous.text + text };
    } else {
      runs.push({ op, text });
    }
  };
  let oldCursor = 0;
  let newCursor = 0;
  for (const [oldIndex, newIndex] of [
    ...pairs,
    [oldTokens.length, newTokens.length] as const,
  ]) {
    append("del", oldTokens.slice(oldCursor, oldIndex).join(""));
    append("ins", newTokens.slice(newCursor, newIndex).join(""));
    if (oldIndex < oldTokens.length && newIndex < newTokens.length) {
      append("same", oldTokens.at(oldIndex) ?? "");
    }
    oldCursor = oldIndex + 1;
    newCursor = newIndex + 1;
  }
  return runs;
};

const compatible = (before: RevisionBlock, after: RevisionBlock): boolean =>
  before.kind === after.kind ||
  (before.kind !== "table-row" && after.kind !== "table-row");

/**
 * Aligns exact blocks by normalized text within structural scopes, then pairs
 * compatible unmatched positions as rewrites. Insertions therefore cannot
 * make later structural ids masquerade as changed content.
 */
export const diffRevisions = ({
  before,
  after,
}: {
  readonly before: ReadonlyArray<RevisionBlock>;
  readonly after: ReadonlyArray<RevisionBlock>;
}): ReadonlyArray<RevisionDiffLocation> => {
  const scopes: Array<string> = [];
  for (const block of [...before, ...after]) {
    const scope = scopeOf(block);
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  const locations: Array<RevisionDiffLocation> = [];
  for (const scope of scopes) {
    const oldIndexes = before
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => scopeOf(block) === scope)
      .map(({ index }) => index);
    const newIndexes = after
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => scopeOf(block) === scope)
      .map(({ index }) => index);
    const anchors = lcsPairs({
      left: oldIndexes,
      right: newIndexes,
      equals: (oldIndex, newIndex) => {
        const oldBlock = before.at(oldIndex);
        const newBlock = after.at(newIndex);
        return (
          oldBlock !== undefined &&
          newBlock !== undefined &&
          oldBlock.kind === newBlock.kind &&
          normalized(oldBlock.text) === normalized(newBlock.text)
        );
      },
    });
    let oldStart = 0;
    let newStart = 0;
    const scopedPairs = [
      ...anchors.map(
        ([oldIndex, newIndex]) =>
          [oldIndexes.indexOf(oldIndex), newIndexes.indexOf(newIndex)] as const,
      ),
      [oldIndexes.length, newIndexes.length] as const,
    ];
    for (const [oldEnd, newEnd] of scopedPairs) {
      const oldGap = oldIndexes.slice(oldStart, oldEnd);
      const newGap = newIndexes.slice(newStart, newEnd);
      const maximumPairs = Math.min(oldGap.length, newGap.length);
      let paired = 0;
      for (let index = 0; index < maximumPairs; index += 1) {
        const oldIndex = oldGap.at(index);
        const newIndex = newGap.at(index);
        const oldBlock =
          oldIndex === undefined ? undefined : before.at(oldIndex);
        const newBlock =
          newIndex === undefined ? undefined : after.at(newIndex);
        if (oldBlock === undefined || newBlock === undefined) break;
        if (!compatible(oldBlock, newBlock)) break;
        locations.push({
          status: "changed",
          oldBlockId: oldBlock.id,
          newBlockId: newBlock.id,
          kind: newBlock.kind,
          label: newBlock.label,
          section: newBlock.section,
          oldText: oldBlock.markedText,
          newText: newBlock.markedText,
          ...(newBlock.parentBlockId === undefined &&
          oldBlock.parentBlockId === undefined
            ? {}
            : {
                parentBlockId: newBlock.parentBlockId ?? oldBlock.parentBlockId,
              }),
          runs: diffWords({
            before: oldBlock.markedText,
            after: newBlock.markedText,
          }),
        });
        paired += 1;
      }
      for (const oldIndex of oldGap.slice(paired)) {
        const oldBlock = before.at(oldIndex);
        if (oldBlock === undefined) continue;
        const beforeIndex = newGap.at(paired) ?? newIndexes.at(newEnd);
        const afterIndex = newGap.at(paired - 1) ?? newIndexes.at(newStart - 1);
        const afterBlock =
          afterIndex === undefined ? undefined : after.at(afterIndex);
        const beforeBlock =
          beforeIndex === undefined ? undefined : after.at(beforeIndex);
        locations.push({
          status: "removed",
          oldBlockId: oldBlock.id,
          kind: oldBlock.kind,
          label: oldBlock.label,
          section: oldBlock.section,
          oldText: oldBlock.markedText,
          newText: "",
          ...(oldBlock.parentBlockId === undefined
            ? {}
            : { parentBlockId: oldBlock.parentBlockId }),
          runs: [{ op: "del", text: oldBlock.markedText }],
          ...(afterBlock === undefined ? {} : { afterBlockId: afterBlock.id }),
          ...(beforeBlock === undefined
            ? {}
            : { beforeBlockId: beforeBlock.id }),
        });
      }
      for (const newIndex of newGap.slice(paired)) {
        const newBlock = after.at(newIndex);
        if (newBlock === undefined) continue;
        locations.push({
          status: "added",
          newBlockId: newBlock.id,
          kind: newBlock.kind,
          label: newBlock.label,
          section: newBlock.section,
          oldText: "",
          newText: newBlock.markedText,
          ...(newBlock.parentBlockId === undefined
            ? {}
            : { parentBlockId: newBlock.parentBlockId }),
          runs: [{ op: "ins", text: newBlock.markedText }],
        });
      }
      oldStart = oldEnd + 1;
      newStart = newEnd + 1;
    }
  }
  return locations;
};
