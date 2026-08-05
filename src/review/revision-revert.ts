// Owns deterministic reversal of one immutable agent revision pair while
// preserving unrelated source edits that landed after the pair.

import { diffWords } from "./revision-diff.js";

export class RevisionRevertConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevisionRevertConflict";
  }
}

type InverseHunk = {
  readonly restored: string;
  readonly replaced: string;
  readonly beforeContext: string;
  readonly afterContext: string;
};

type InverseLineHunk = {
  readonly restored: string;
  readonly replaced: string;
  readonly beforeAnchor: string;
  readonly afterAnchor: string;
  readonly replacementLineCount: number;
};

const inverseHunks = ({
  before,
  after,
}: {
  readonly before: string;
  readonly after: string;
}): ReadonlyArray<InverseHunk> => {
  const runs = diffWords({ before, after });
  const hunks: Array<InverseHunk> = [];
  let previousSame = "";
  let index = 0;
  while (index < runs.length) {
    const run = runs.at(index);
    if (run?.op === "same") {
      previousSame = run.text;
      index += 1;
      continue;
    }
    let restored = "";
    let replaced = "";
    while (index < runs.length && runs.at(index)?.op !== "same") {
      const changed = runs.at(index);
      if (changed?.op === "del") restored += changed.text;
      if (changed?.op === "ins") replaced += changed.text;
      index += 1;
    }
    const nextSame = runs.at(index)?.text ?? "";
    if (restored.trim() !== "" || replaced.trim() !== "") {
      hunks.push({
        restored,
        replaced,
        beforeContext: previousSame.slice(-120),
        afterContext: nextSame.slice(0, 120),
      });
    }
  }
  return hunks;
};

const occurrences = ({
  value,
  search,
}: {
  readonly value: string;
  readonly search: string;
}): ReadonlyArray<number> => {
  if (search === "") {
    return Array.from({ length: value.length + 1 }, (_, index) => index);
  }
  const indexes: Array<number> = [];
  let cursor = 0;
  while (cursor <= value.length - search.length) {
    const found = value.indexOf(search, cursor);
    if (found < 0) break;
    indexes.push(found);
    cursor = found + Math.max(1, search.length);
  }
  return indexes;
};

const locateHunk = ({
  current,
  hunk,
}: {
  readonly current: string;
  readonly hunk: InverseHunk;
}): number => {
  const candidates = occurrences({ value: current, search: hunk.replaced });
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates.at(0) ?? 0;
  const contextual = candidates.filter((index) => {
    const before = current.slice(
      Math.max(0, index - hunk.beforeContext.length),
      index,
    );
    const after = current.slice(
      index + hunk.replaced.length,
      index + hunk.replaced.length + hunk.afterContext.length,
    );
    return (
      before.endsWith(hunk.beforeContext) && after.startsWith(hunk.afterContext)
    );
  });
  if (contextual.length === 1) return contextual.at(0) ?? 0;
  const suffixScore = (left: string, right: string): number => {
    let score = 0;
    while (
      score < left.length &&
      score < right.length &&
      left[left.length - 1 - score] === right[right.length - 1 - score]
    ) {
      score += 1;
    }
    return score;
  };
  const prefixScore = (left: string, right: string): number => {
    let score = 0;
    while (
      score < left.length &&
      score < right.length &&
      left[score] === right[score]
    ) {
      score += 1;
    }
    return score;
  };
  return (
    [...candidates]
      .map((index) => ({
        index,
        score:
          suffixScore(current.slice(0, index), hunk.beforeContext) +
          prefixScore(
            current.slice(index + hunk.replaced.length),
            hunk.afterContext,
          ),
      }))
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      )
      .at(0)?.index ?? -1
  );
};

const lines = (value: string): ReadonlyArray<string> =>
  value.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const inverseLineHunks = ({
  before,
  after,
}: {
  readonly before: string;
  readonly after: string;
}): ReadonlyArray<InverseLineHunk> => {
  const oldLines = lines(before);
  const newLines = lines(after);
  const lengths = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(newLines.length + 1).fill(0),
  );
  const cell = (oldIndex: number, newIndex: number): number =>
    lengths.at(oldIndex)?.at(newIndex) ?? 0;
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const row = lengths.at(oldIndex);
      if (row === undefined) continue;
      row[newIndex] =
        oldLines.at(oldIndex) === newLines.at(newIndex)
          ? 1 + cell(oldIndex + 1, newIndex + 1)
          : Math.max(
              cell(oldIndex + 1, newIndex),
              cell(oldIndex, newIndex + 1),
            );
    }
  }
  const pairs: Array<readonly [number, number]> = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines.at(oldIndex) === newLines.at(newIndex)) {
      pairs.push([oldIndex, newIndex]);
      oldIndex += 1;
      newIndex += 1;
    } else if (cell(oldIndex + 1, newIndex) >= cell(oldIndex, newIndex + 1)) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  const hunks: Array<InverseLineHunk> = [];
  let oldCursor = 0;
  let newCursor = 0;
  for (const [sameOldIndex, sameNewIndex] of [
    ...pairs,
    [oldLines.length, newLines.length] as const,
  ]) {
    const restoredLines = oldLines.slice(oldCursor, sameOldIndex);
    const replacedLines = newLines.slice(newCursor, sameNewIndex);
    if (restoredLines.length > 0 || replacedLines.length > 0) {
      hunks.push({
        restored: restoredLines.join(""),
        replaced: replacedLines.join(""),
        beforeAnchor: newLines.at(newCursor - 1) ?? "",
        afterAnchor: newLines.at(sameNewIndex) ?? "",
        replacementLineCount: replacedLines.length,
      });
    }
    oldCursor = sameOldIndex + 1;
    newCursor = sameNewIndex + 1;
  }
  return hunks;
};

const replaceLineHunk = ({
  current,
  hunk,
}: {
  readonly current: string;
  readonly hunk: InverseLineHunk;
}): string => {
  const exactIndex = hunk.replaced === "" ? -1 : current.indexOf(hunk.replaced);
  if (exactIndex >= 0) {
    return (
      current.slice(0, exactIndex) +
      hunk.restored +
      current.slice(exactIndex + hunk.replaced.length)
    );
  }
  if (hunk.beforeAnchor === "" || hunk.replacementLineCount === 0) {
    return current;
  }
  const anchorIndex = current.indexOf(hunk.beforeAnchor);
  if (
    anchorIndex < 0 ||
    current.indexOf(hunk.beforeAnchor, anchorIndex + 1) >= 0
  ) {
    return current;
  }
  const start = anchorIndex + hunk.beforeAnchor.length;
  const afterLines = lines(current.slice(start));
  const replacementLength = afterLines
    .slice(0, hunk.replacementLineCount)
    .join("").length;
  if (replacementLength === 0) return current;
  const end = start + replacementLength;
  if (
    hunk.afterAnchor !== "" &&
    current.startsWith(hunk.afterAnchor, end) === false &&
    hunk.replacementLineCount !== 1
  ) {
    return current;
  }
  return current.slice(0, start) + hunk.restored + current.slice(end);
};

/** Applies the after-to-before inverse of one pair to the current source. */
export const revertRevisionPair = ({
  before,
  after,
  current,
}: {
  readonly before: string;
  readonly after: string;
  readonly current: string;
}): string => {
  const located = inverseHunks({ before, after }).map((hunk) => ({
    hunk,
    index: locateHunk({ current, hunk }),
  }));
  let reverted = current;
  for (const { hunk, index } of located.sort(
    (left, right) => right.index - left.index,
  )) {
    if (index < 0) continue;
    reverted =
      reverted.slice(0, index) +
      hunk.restored +
      reverted.slice(index + hunk.replaced.length);
  }
  if (located.some(({ index }) => index < 0)) {
    for (const hunk of inverseLineHunks({ before, after })) {
      reverted = replaceLineHunk({ current: reverted, hunk });
    }
  }
  return reverted;
};
