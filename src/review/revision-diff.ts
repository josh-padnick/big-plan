// Owns revision-to-revision block alignment and plain-text word diffs for the
// live review runtime. It is intentionally DOM- and filesystem-free so the
// attribution contract and browser route share one deterministic answer.

export type RevisionContentNode =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: Exclude<string, "text">;
      readonly children: ReadonlyArray<RevisionContentNode>;
      readonly href?: string;
      readonly ordered?: boolean;
      readonly header?: boolean;
    };

export type RevisionBlock = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly section: string;
  readonly text: string;
  readonly markedText: string;
  readonly authoredText?: string;
  readonly content?: RevisionContentNode;
  readonly parentBlockId?: string;
};

export type DiffRun = {
  readonly op: "same" | "del" | "ins";
  readonly text: string;
};

export type RevisionDiffLocation = {
  readonly status: "changed" | "added" | "removed" | "moved";
  readonly oldBlockId?: string;
  readonly newBlockId?: string;
  readonly kind: string;
  readonly label: string;
  readonly section: string;
  readonly oldText: string;
  readonly newText: string;
  readonly oldContent?: RevisionContentNode;
  readonly newContent?: RevisionContentNode;
  readonly runs: ReadonlyArray<DiffRun>;
  readonly beforeBlockId?: string;
  readonly afterBlockId?: string;
  readonly parentBlockId?: string;
};

export const INLINE_CODE_SENTINEL = "\u0011";

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

const normalized = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

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

const meaningfulTokens = (value: string): ReadonlySet<string> =>
  new Set(
    normalized(value)
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((token) => token.length > 1),
  );

const textSimilarity = (left: string, right: string): number => {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return (2 * overlap) / Math.max(1, leftTokens.size + rightTokens.size);
};

const pairScore = ({
  oldBlock,
  newBlock,
  oldIndex,
  newIndex,
}: {
  readonly oldBlock: RevisionBlock;
  readonly newBlock: RevisionBlock;
  readonly oldIndex: number;
  readonly newIndex: number;
}): number => {
  if (oldBlock.kind !== newBlock.kind) return -1;
  const oldAuthored = oldBlock.authoredText ?? oldBlock.text;
  const newAuthored = newBlock.authoredText ?? newBlock.text;
  const sameIdentity = oldBlock.id === newBlock.id ? 0.55 : 0;
  const sameText =
    normalized(oldAuthored) === normalized(newAuthored) ? 0.7 : 0;
  const sameLabel =
    normalized(oldBlock.label) === normalized(newBlock.label) ? 0.2 : 0;
  const sameSection =
    normalized(oldBlock.section) === normalized(newBlock.section) ? 0.12 : 0;
  const proximity = 0.08 / (1 + Math.abs(oldIndex - newIndex));
  return (
    sameIdentity +
    sameText +
    sameLabel +
    sameSection +
    proximity +
    textSimilarity(oldAuthored, newAuthored) * 0.45
  );
};

const neighboringAnchor = ({
  after,
  newIndex,
  direction,
}: {
  readonly after: ReadonlyArray<RevisionBlock>;
  readonly newIndex: number;
  readonly direction: -1 | 1;
}): string | undefined => {
  const neighbor = after.at(newIndex + direction);
  return neighbor?.id;
};

/**
 * Aligns authored blocks by stable identity, exact authored content, and then
 * deterministic semantic similarity. Unmatched blocks remain explicit:
 * insertion never consumes the identity of the content beside it.
 */
export const diffRevisions = ({
  before,
  after,
}: {
  readonly before: ReadonlyArray<RevisionBlock>;
  readonly after: ReadonlyArray<RevisionBlock>;
}): ReadonlyArray<RevisionDiffLocation> => {
  const pairs: Array<readonly [number, number]> = [];
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const candidates = before.flatMap((oldBlock, oldIndex) =>
    after.map((newBlock, newIndex) => ({
      oldIndex,
      newIndex,
      score: pairScore({ oldBlock, newBlock, oldIndex, newIndex }),
    })),
  );
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.oldIndex - right.oldIndex ||
      left.newIndex - right.newIndex,
  );
  for (const candidate of candidates) {
    if (
      candidate.score < 0.52 ||
      usedOld.has(candidate.oldIndex) ||
      usedNew.has(candidate.newIndex)
    ) {
      continue;
    }
    usedOld.add(candidate.oldIndex);
    usedNew.add(candidate.newIndex);
    pairs.push([candidate.oldIndex, candidate.newIndex]);
  }

  const locations: Array<RevisionDiffLocation> = [];
  for (const [oldIndex, newIndex] of pairs.sort(
    (left, right) => left[1] - right[1],
  )) {
    const oldBlock = before.at(oldIndex);
    const newBlock = after.at(newIndex);
    if (oldBlock === undefined || newBlock === undefined) continue;
    const textChanged =
      normalized(oldBlock.authoredText ?? oldBlock.text) !==
      normalized(newBlock.authoredText ?? newBlock.text);
    if (!textChanged) continue;
    locations.push({
      status: "changed",
      oldBlockId: oldBlock.id,
      newBlockId: newBlock.id,
      kind: newBlock.kind,
      label: newBlock.label,
      section: newBlock.section,
      oldText: oldBlock.markedText,
      newText: newBlock.markedText,
      ...(oldBlock.content === undefined
        ? {}
        : { oldContent: oldBlock.content }),
      ...(newBlock.content === undefined
        ? {}
        : { newContent: newBlock.content }),
      ...(newBlock.parentBlockId === undefined &&
      oldBlock.parentBlockId === undefined
        ? {}
        : { parentBlockId: newBlock.parentBlockId ?? oldBlock.parentBlockId }),
      runs: diffWords({
        before: oldBlock.markedText,
        after: newBlock.markedText,
      }),
    });
  }
  for (const [oldIndex, oldBlock] of before.entries()) {
    if (usedOld.has(oldIndex)) continue;
    const sameScopePairs = pairs.filter(
      ([candidateOld]) =>
        before.at(candidateOld)?.section === oldBlock.section,
    );
    const previousPair = [...sameScopePairs]
      .filter(([candidateOld]) => candidateOld < oldIndex)
      .sort((left, right) => right[0] - left[0])[0];
    const nextPair = [...sameScopePairs]
      .filter(([candidateOld]) => candidateOld > oldIndex)
      .sort((left, right) => left[0] - right[0])[0];
    const afterBlockId =
      previousPair === undefined ? undefined : after.at(previousPair[1])?.id;
    const fallbackNext = after.at((previousPair?.[1] ?? -1) + 1);
    const beforeBlockId =
      nextPair === undefined
        ? fallbackNext?.section === oldBlock.section
          ? fallbackNext.id
          : undefined
        : after.at(nextPair[1])?.id;
    locations.push({
      status: "removed",
      oldBlockId: oldBlock.id,
      kind: oldBlock.kind,
      label: oldBlock.label,
      section: oldBlock.section,
      oldText: oldBlock.markedText,
      newText: "",
      ...(oldBlock.content === undefined
        ? {}
        : { oldContent: oldBlock.content }),
      ...(oldBlock.parentBlockId === undefined
        ? {}
        : { parentBlockId: oldBlock.parentBlockId }),
      runs: [{ op: "del", text: oldBlock.markedText }],
      ...(afterBlockId === undefined ? {} : { afterBlockId }),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    });
  }
  for (const [newIndex, newBlock] of after.entries()) {
    if (usedNew.has(newIndex)) continue;
    locations.push({
      status: "added",
      newBlockId: newBlock.id,
      kind: newBlock.kind,
      label: newBlock.label,
      section: newBlock.section,
      oldText: "",
      newText: newBlock.markedText,
      ...(newBlock.content === undefined
        ? {}
        : { newContent: newBlock.content }),
      ...(newBlock.parentBlockId === undefined
        ? {}
        : { parentBlockId: newBlock.parentBlockId }),
      runs: [{ op: "ins", text: newBlock.markedText }],
      ...(neighboringAnchor({ after, newIndex, direction: -1 }) === undefined
        ? {}
        : {
            afterBlockId: neighboringAnchor({
              after,
              newIndex,
              direction: -1,
            }),
          }),
      ...(neighboringAnchor({ after, newIndex, direction: 1 }) === undefined
        ? {}
        : {
            beforeBlockId: neighboringAnchor({
              after,
              newIndex,
              direction: 1,
            }),
          }),
    });
  }
  return locations.sort((left, right) => {
    const leftId = left.newBlockId ?? left.beforeBlockId ?? left.afterBlockId;
    const rightId =
      right.newBlockId ?? right.beforeBlockId ?? right.afterBlockId;
    const leftIndex = after.findIndex((block) => block.id === leftId);
    const rightIndex = after.findIndex((block) => block.id === rightId);
    return (
      (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    );
  });
};
