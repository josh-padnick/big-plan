// Owns deterministic snapshot alignment, word runs, and change-place grouping
// for every causal diff surface. It stays DOM- and filesystem-free so the
// server, attribution validator, and browser share one answer.

import { createHash } from "node:crypto";

export type SnapshotBlock = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly section: string;
  readonly text: string;
};

export type DiffRun = {
  readonly op: "same" | "del" | "ins";
  readonly text: string;
};

export type SnapshotDiffLocation = {
  readonly status: "changed" | "added" | "removed";
  readonly scope: string;
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
};

export type SnapshotDiffPlace = {
  readonly placeId: string;
  readonly status: "changed" | "added" | "removed";
  readonly label: string;
  readonly section: string;
  readonly note: "reworded" | "rewritten" | "added" | "removed";
  readonly locationIndexes: ReadonlyArray<number>;
};

export type SnapshotDiff = {
  readonly from: string;
  readonly to: string;
  readonly locations: ReadonlyArray<SnapshotDiffLocation>;
  readonly places: ReadonlyArray<SnapshotDiffPlace>;
};

const ALIGNMENT_ACCEPTANCE = 0.52;
const REWRITTEN_SURVIVAL = 0.2;
const PLACE_LABEL_LIMIT = 90;
const DERIVED_BLOCK_KINDS = new Set(["table-of-contents"]);

const normalized = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

const scopeOf = (block: SnapshotBlock): string => {
  const slash = block.id.lastIndexOf("/");
  return slash < 0 ? block.section : block.id.slice(0, slash);
};

const tokens = (value: string): ReadonlyArray<string> =>
  value.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

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

/** Produces compact same/delete/insert runs without a presentation dependency. */
export const diffWords = ({
  before,
  after,
}: {
  readonly before: string;
  readonly after: string;
}): ReadonlyArray<DiffRun> => {
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  const pairs = lcsPairs({
    left: oldTokens.map((_, index) => index),
    right: newTokens.map((_, index) => index),
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

/** Measures how much text survives a rewrite, ignoring whitespace. */
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
  readonly oldBlock: SnapshotBlock;
  readonly newBlock: SnapshotBlock;
  readonly oldIndex: number;
  readonly newIndex: number;
}): number => {
  if (oldBlock.kind !== newBlock.kind) return -1;
  const sameIdentity = oldBlock.id === newBlock.id ? 0.55 : 0;
  const sameText =
    normalized(oldBlock.text) === normalized(newBlock.text) ? 0.7 : 0;
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
    textSimilarity(oldBlock.text, newBlock.text) * 0.45
  );
};

const locationAnchor = (location: SnapshotDiffLocation): string | undefined =>
  location.newBlockId ?? location.beforeBlockId ?? location.afterBlockId;

/** Aligns blocks by stable identity, exact content, then guarded similarity. */
export const diffSnapshots = ({
  before: rawBefore,
  after: rawAfter,
}: {
  readonly before: ReadonlyArray<SnapshotBlock>;
  readonly after: ReadonlyArray<SnapshotBlock>;
}): ReadonlyArray<SnapshotDiffLocation> => {
  const before = rawBefore.filter(
    (block) => !DERIVED_BLOCK_KINDS.has(block.kind),
  );
  const after = rawAfter.filter(
    (block) => !DERIVED_BLOCK_KINDS.has(block.kind),
  );
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
      candidate.score < ALIGNMENT_ACCEPTANCE ||
      usedOld.has(candidate.oldIndex) ||
      usedNew.has(candidate.newIndex)
    ) {
      continue;
    }
    usedOld.add(candidate.oldIndex);
    usedNew.add(candidate.newIndex);
    pairs.push([candidate.oldIndex, candidate.newIndex]);
  }

  const locations: Array<SnapshotDiffLocation> = [];
  for (const [oldIndex, newIndex] of pairs.sort(
    (left, right) => left[1] - right[1],
  )) {
    const oldBlock = before.at(oldIndex);
    const newBlock = after.at(newIndex);
    if (oldBlock === undefined || newBlock === undefined) continue;
    if (normalized(oldBlock.text) === normalized(newBlock.text)) continue;
    locations.push({
      status: "changed",
      scope: scopeOf(newBlock),
      oldBlockId: oldBlock.id,
      newBlockId: newBlock.id,
      kind: newBlock.kind,
      label: newBlock.label,
      section: newBlock.section,
      oldText: oldBlock.text,
      newText: newBlock.text,
      runs: diffWords({ before: oldBlock.text, after: newBlock.text }),
    });
  }
  for (const [oldIndex, oldBlock] of before.entries()) {
    if (usedOld.has(oldIndex)) continue;
    const sameSectionPairs = pairs.filter(
      ([candidateOld]) => before.at(candidateOld)?.section === oldBlock.section,
    );
    const previousPair = [...sameSectionPairs]
      .filter(([candidateOld]) => candidateOld < oldIndex)
      .sort((left, right) => right[0] - left[0])[0];
    const nextPair = [...sameSectionPairs]
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
      scope: scopeOf(oldBlock),
      oldBlockId: oldBlock.id,
      kind: oldBlock.kind,
      label: oldBlock.label,
      section: oldBlock.section,
      oldText: oldBlock.text,
      newText: "",
      runs: [{ op: "del", text: oldBlock.text }],
      ...(afterBlockId === undefined ? {} : { afterBlockId }),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    });
  }
  for (const [newIndex, newBlock] of after.entries()) {
    if (usedNew.has(newIndex)) continue;
    const previous = after.at(newIndex - 1);
    const next = after.at(newIndex + 1);
    locations.push({
      status: "added",
      scope: scopeOf(newBlock),
      newBlockId: newBlock.id,
      kind: newBlock.kind,
      label: newBlock.label,
      section: newBlock.section,
      oldText: "",
      newText: newBlock.text,
      runs: [{ op: "ins", text: newBlock.text }],
      ...(previous === undefined ? {} : { afterBlockId: previous.id }),
      ...(next === undefined ? {} : { beforeBlockId: next.id }),
    });
  }
  return locations.sort((left, right) => {
    const leftIndex = after.findIndex(
      (block) => block.id === locationAnchor(left),
    );
    const rightIndex = after.findIndex(
      (block) => block.id === locationAnchor(right),
    );
    return (
      (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    );
  });
};

const placeNote = (
  locations: ReadonlyArray<SnapshotDiffLocation>,
): SnapshotDiffPlace["note"] => {
  if (locations.every((location) => location.status === "added"))
    return "added";
  if (locations.every((location) => location.status === "removed"))
    return "removed";
  const oldLength = locations.reduce(
    (total, location) => total + location.oldText.replace(/\s/g, "").length,
    0,
  );
  const sameLength = locations
    .flatMap((location) => location.runs)
    .filter((run) => run.op === "same")
    .reduce((total, run) => total + run.text.replace(/\s/g, "").length, 0);
  return oldLength > 0 && sameLength / oldLength < REWRITTEN_SURVIVAL
    ? "rewritten"
    : "reworded";
};

const placeLabel = (locations: ReadonlyArray<SnapshotDiffLocation>): string => {
  if (locations.length > 1) return "Whole section";
  const label = locations[0]?.label ?? "Change";
  return label.length <= PLACE_LABEL_LIMIT
    ? label
    : `${label.slice(0, PLACE_LABEL_LIMIT - 1).trimEnd()}…`;
};

const placeId = ({
  from,
  to,
  locations,
}: {
  readonly from: string;
  readonly to: string;
  readonly locations: ReadonlyArray<SnapshotDiffLocation>;
}): string =>
  createHash("sha256")
    .update(
      [
        from,
        to,
        ...locations.flatMap((location) => [
          location.status,
          location.oldBlockId ?? "",
          location.newBlockId ?? "",
        ]),
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 16);

const tableOwnerFor = ({
  location,
  before,
  after,
}: {
  readonly location: SnapshotDiffLocation;
  readonly before: ReadonlyArray<SnapshotBlock>;
  readonly after: ReadonlyArray<SnapshotBlock>;
}): string | undefined => {
  if (location.kind !== "table" && !location.kind.startsWith("table-")) {
    return undefined;
  }
  const blocks = location.newBlockId === undefined ? before : after;
  const blockId = location.newBlockId ?? location.oldBlockId;
  const position = blocks.findIndex((block) => block.id === blockId);
  if (position < 0) return undefined;
  for (let index = position; index >= 0; index -= 1) {
    const candidate = blocks.at(index);
    if (candidate === undefined || candidate.section !== location.section) {
      continue;
    }
    if (candidate.kind === "table") return candidate.id;
  }
  return undefined;
};

/** Groups adjacent changed blocks within a section into calm review stops. */
export const buildSnapshotDiff = ({
  from,
  to,
  before,
  after,
}: {
  readonly from: string;
  readonly to: string;
  readonly before: ReadonlyArray<SnapshotBlock>;
  readonly after: ReadonlyArray<SnapshotBlock>;
}): SnapshotDiff => {
  const locations = diffSnapshots({ before, after });
  const groups: Array<Array<number>> = [];
  for (const [index, location] of locations.entries()) {
    const group = groups.at(-1);
    const previousIndex = group?.at(-1);
    const previous =
      previousIndex === undefined ? undefined : locations.at(previousIndex);
    const currentPosition = after.findIndex(
      (block) => block.id === locationAnchor(location),
    );
    const previousPosition =
      previous === undefined
        ? -2
        : after.findIndex((block) => block.id === locationAnchor(previous));
    const currentTableOwner = tableOwnerFor({ location, before, after });
    const previousTableOwner =
      previous === undefined
        ? undefined
        : tableOwnerFor({ location: previous, before, after });
    if (
      group !== undefined &&
      previous !== undefined &&
      previous.section === location.section &&
      ((currentTableOwner !== undefined &&
        currentTableOwner === previousTableOwner) ||
        currentPosition - previousPosition <= 1)
    ) {
      group.push(index);
    } else {
      groups.push([index]);
    }
  }
  return {
    from,
    to,
    locations,
    places: groups.map((locationIndexes) => {
      const groupedLocations = locationIndexes.flatMap((index) => {
        const location = locations.at(index);
        return location === undefined ? [] : [location];
      });
      const first = groupedLocations[0];
      if (first === undefined) throw new Error("A diff place cannot be empty");
      const statuses = new Set(
        groupedLocations.map((location) => location.status),
      );
      return {
        placeId: placeId({ from, to, locations: groupedLocations }),
        status: statuses.size === 1 ? first.status : "changed",
        label: placeLabel(groupedLocations),
        section: first.section,
        note: placeNote(groupedLocations),
        locationIndexes,
      };
    }),
  };
};
