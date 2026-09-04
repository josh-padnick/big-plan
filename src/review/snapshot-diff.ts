// Owns deterministic snapshot alignment, word runs, and change-place grouping
// for every causal diff surface. It stays DOM- and filesystem-free so the
// server, attribution validator, and browser share one answer.

import { createHash } from "node:crypto";
import type { BlockDescriptor } from "../render/render-document.js";
import { normalizedAlignmentText } from "./shared/normalized-text.js";
import type {
  DiffLocation,
  DiffPlace,
  DiffRun,
  SnapshotDiff,
} from "./shared/review-wire.js";
export type {
  BlockPresentation,
  DiffPlace,
  DiffRun,
  SnapshotDiff,
} from "./shared/review-wire.js";

// The renderer owns the block shape and this layer adds no snapshot-only
// fields, so preserve the old name as a type-only alias for its public callers.
export type SnapshotBlock = BlockDescriptor;

// The review builder records component-root ownership before handing locations
// to the wire contract, so keep that stronger internal intersection here.
export type SnapshotDiffLocation = DiffLocation & {
  readonly isComponentRoot: boolean;
};

// Keep the historical internal name for callers while the wire owns the place
// vocabulary shared with browser delivery.
export type SnapshotDiffPlace = DiffPlace;

export const blockEvidence = (block: SnapshotBlock | undefined): string =>
  block === undefined
    ? ""
    : JSON.stringify({
        kind: block.kind,
        text: block.text,
        model: block.model ?? null,
        presentation: block.presentation ?? null,
        tableHeaders: block.tableHeaders ?? null,
        isTableHeader: block.isTableHeader ?? false,
      });

type BuiltSnapshotDiff = Omit<SnapshotDiff, "locations"> & {
  readonly locations: ReadonlyArray<SnapshotDiffLocation>;
};

const ALIGNMENT_ACCEPTANCE = 0.52;
const ALIGNMENT_INDEX_WINDOW = 80;
const MAX_LCS_CELLS = 40_000;
const REWRITTEN_SURVIVAL = 0.2;
const PLACE_LABEL_LIMIT = 90;
const DERIVED_BLOCK_KINDS = new Set(["table-of-contents"]);

// Every component root owns its diff through the component contract. An
// authored picture is the one non-component block whose compiled markup is
// still the evidence: its extracted text is only the alt words, so a text-only
// lens would say the picture changed while showing none of it.
const RENDERED_SNAPSHOT_KINDS: ReadonlySet<string> = new Set(["image"]);

const runsFor = ({
  kind,
  isComponentRoot,
  before,
  after,
}: {
  readonly kind: string;
  readonly isComponentRoot: boolean;
  readonly before: string;
  readonly after: string;
}): ReadonlyArray<DiffRun> =>
  isComponentRoot || RENDERED_SNAPSHOT_KINDS.has(kind)
    ? [
        ...(before === "" ? [] : [{ op: "del" as const, text: before }]),
        ...(after === "" ? [] : [{ op: "ins" as const, text: after }]),
      ]
    : diffWords({ before, after });

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
  if (oldTokens.length * newTokens.length > MAX_LCS_CELLS) {
    return [
      ...(before === "" ? [] : [{ op: "del" as const, text: before }]),
      ...(after === "" ? [] : [{ op: "ins" as const, text: after }]),
    ];
  }
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
    normalizedAlignmentText(value)
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

const samePresentation = (
  left: SnapshotBlock["presentation"],
  right: SnapshotBlock["presentation"],
): boolean => {
  if (left === undefined || right === undefined) return left === right;
  if (left.aspect !== right.aspect) return false;
  if (left.aspect === "list" && right.aspect === "list") {
    return left.isOrdered === right.isOrdered;
  }
  if (left.aspect === "image" && right.aspect === "image") {
    return left.source === right.source && left.alt === right.alt;
  }
  return false;
};

// Compiler source positions are diagnostic provenance, not plan meaning. A
// revision above a component can move every HAST position in its model without
// changing anything the component presents.
const sameComponentModel = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left, (key, value: unknown) =>
    key === "position" ? undefined : value,
  ) ===
  JSON.stringify(right, (key, value: unknown) =>
    key === "position" ? undefined : value,
  );

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
    normalizedAlignmentText(oldBlock.text) ===
    normalizedAlignmentText(newBlock.text)
      ? 0.7
      : 0;
  const sameLabel =
    normalizedAlignmentText(oldBlock.label) ===
    normalizedAlignmentText(newBlock.label)
      ? 0.2
      : 0;
  const sameSection =
    normalizedAlignmentText(oldBlock.section) ===
    normalizedAlignmentText(newBlock.section)
      ? 0.12
      : 0;
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

/** Groups globally exact counterparts before bounded fuzzy scoring. */
const exactAlignmentKey = (block: SnapshotBlock): string => {
  const presentation = block.presentation;
  return JSON.stringify([
    block.kind,
    normalizedAlignmentText(block.text),
    ...(presentation?.aspect === "image"
      ? [presentation.source, presentation.alt]
      : []),
  ]);
};

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
  const exactNewIndexes = new Map<string, ReadonlyArray<number>>();
  for (const [newIndex, newBlock] of after.entries()) {
    const key = exactAlignmentKey(newBlock);
    exactNewIndexes.set(key, [...(exactNewIndexes.get(key) ?? []), newIndex]);
  }
  const exactCursors = new Map<string, number>();
  for (const [oldIndex, oldBlock] of before.entries()) {
    const key = exactAlignmentKey(oldBlock);
    const cursor = exactCursors.get(key) ?? 0;
    const newIndex = exactNewIndexes.get(key)?.at(cursor);
    if (newIndex === undefined) continue;
    exactCursors.set(key, cursor + 1);
    usedOld.add(oldIndex);
    usedNew.add(newIndex);
    pairs.push([oldIndex, newIndex]);
  }
  const candidates: Array<{
    readonly oldIndex: number;
    readonly newIndex: number;
    readonly score: number;
  }> = [];
  for (const [oldIndex, oldBlock] of before.entries()) {
    if (usedOld.has(oldIndex)) continue;
    const firstNewIndex = Math.max(0, oldIndex - ALIGNMENT_INDEX_WINDOW);
    const lastNewIndex = Math.min(
      after.length - 1,
      oldIndex + ALIGNMENT_INDEX_WINDOW,
    );
    for (
      let newIndex = firstNewIndex;
      newIndex <= lastNewIndex;
      newIndex += 1
    ) {
      if (usedNew.has(newIndex)) continue;
      const newBlock = after.at(newIndex);
      if (newBlock === undefined || oldBlock.kind !== newBlock.kind) continue;
      candidates.push({
        oldIndex,
        newIndex,
        score: pairScore({ oldBlock, newBlock, oldIndex, newIndex }),
      });
    }
  }
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
    if (
      oldBlock.text === newBlock.text &&
      samePresentation(oldBlock.presentation, newBlock.presentation) &&
      (!newBlock.isComponentRoot ||
        sameComponentModel(oldBlock.model, newBlock.model))
    )
      continue;
    locations.push({
      status: "changed",
      scope: scopeOf(newBlock),
      oldBlockId: oldBlock.id,
      newBlockId: newBlock.id,
      kind: newBlock.kind,
      isComponentRoot: newBlock.isComponentRoot,
      ...(newBlock.ownerId === undefined ? {} : { ownerId: newBlock.ownerId }),
      label: newBlock.label,
      section: newBlock.section,
      oldText: oldBlock.text,
      newText: newBlock.text,
      oldEvidence: blockEvidence(oldBlock),
      newEvidence: blockEvidence(newBlock),
      ...(oldBlock.presentation === undefined
        ? {}
        : { oldPresentation: oldBlock.presentation }),
      ...(newBlock.presentation === undefined
        ? {}
        : { newPresentation: newBlock.presentation }),
      ...(oldBlock.tableHeaders === undefined
        ? {}
        : { oldTableHeaders: oldBlock.tableHeaders }),
      ...(newBlock.tableHeaders === undefined
        ? {}
        : { newTableHeaders: newBlock.tableHeaders }),
      ...(newBlock.isTableHeader ? { isTableHeader: true } : {}),
      runs: runsFor({
        kind: newBlock.kind,
        isComponentRoot: newBlock.isComponentRoot,
        before: oldBlock.text,
        after: newBlock.text,
      }),
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
      isComponentRoot: oldBlock.isComponentRoot,
      ...(oldBlock.ownerId === undefined ? {} : { ownerId: oldBlock.ownerId }),
      label: oldBlock.label,
      section: oldBlock.section,
      oldText: oldBlock.text,
      newText: "",
      oldEvidence: blockEvidence(oldBlock),
      ...(oldBlock.presentation === undefined
        ? {}
        : { oldPresentation: oldBlock.presentation }),
      ...(oldBlock.tableHeaders === undefined
        ? {}
        : { oldTableHeaders: oldBlock.tableHeaders }),
      ...(oldBlock.isTableHeader ? { isTableHeader: true } : {}),
      runs: [{ op: "del", text: oldBlock.text }],
      ...(afterBlockId === undefined ? {} : { afterBlockId }),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    });
  }
  for (const [newIndex, newBlock] of after.entries()) {
    if (usedNew.has(newIndex)) continue;
    const previous = newIndex === 0 ? undefined : after.at(newIndex - 1);
    const next = after.at(newIndex + 1);
    locations.push({
      status: "added",
      scope: scopeOf(newBlock),
      newBlockId: newBlock.id,
      kind: newBlock.kind,
      isComponentRoot: newBlock.isComponentRoot,
      ...(newBlock.ownerId === undefined ? {} : { ownerId: newBlock.ownerId }),
      label: newBlock.label,
      section: newBlock.section,
      oldText: "",
      newText: newBlock.text,
      newEvidence: blockEvidence(newBlock),
      ...(newBlock.presentation === undefined
        ? {}
        : { newPresentation: newBlock.presentation }),
      ...(newBlock.tableHeaders === undefined
        ? {}
        : { newTableHeaders: newBlock.tableHeaders }),
      ...(newBlock.isTableHeader ? { isTableHeader: true } : {}),
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
  const declaredOwners = new Set(
    locations.flatMap((location) =>
      location.ownerId === undefined ? [] : [location.ownerId],
    ),
  );
  const measured = locations.filter(
    (location) =>
      ![location.oldBlockId, location.newBlockId].some(
        (id) => id !== undefined && declaredOwners.has(id),
      ),
  );
  // A picture carries no words, so the word-survival measure below would call
  // every swap a rewording. Say what actually happened instead.
  if (
    measured.length > 0 &&
    measured.every((location) => RENDERED_SNAPSHOT_KINDS.has(location.kind))
  ) {
    return "replaced";
  }
  const oldLength = measured.reduce(
    (total, location) => total + location.oldText.replace(/\s/g, "").length,
    0,
  );
  const sameLength = measured
    .flatMap((location) => location.runs)
    .filter((run) => run.op === "same")
    .reduce((total, run) => total + run.text.replace(/\s/g, "").length, 0);
  return oldLength > 0 && sameLength / oldLength < REWRITTEN_SURVIVAL
    ? "rewritten"
    : "reworded";
};

const truncatedLabel = (label: string): string =>
  label.length <= PLACE_LABEL_LIMIT
    ? label
    : `${label.slice(0, PLACE_LABEL_LIMIT - 1).trimEnd()}…`;

const placeLabel = (locations: ReadonlyArray<SnapshotDiffLocation>): string => {
  if (locations.length > 1) {
    // A component root grouped with its declared sub-targets is one revision
    // of that component, so the place carries the component's own name rather
    // than the anonymous multi-block fallback.
    const componentRoots = locations.filter(
      (location) => location.isComponentRoot,
    );
    const owner = componentRoots.length === 1 ? componentRoots[0] : undefined;
    return owner === undefined ? "Whole section" : truncatedLabel(owner.label);
  }
  return truncatedLabel(locations[0]?.label ?? "Change");
};

/**
 * A digest of what one place actually shows, independent of the bounds it was
 * minted under.
 *
 * A place id is deliberately bound to its revision, so it renames whenever the
 * change set's span advances; that is what makes it a safe address and what
 * makes it useless for asking "is this still the same change". This answers
 * that question instead. It reads the words on both sides rather than the
 * block ids, because a round that leaves a change alone leaves both sides of
 * it identical while renaming everything around it.
 */
const contentDigest = (
  locations: ReadonlyArray<SnapshotDiffLocation>,
): string =>
  createHash("sha256")
    .update(
      locations
        .flatMap((location) => [
          location.status,
          location.kind,
          location.oldText,
          location.newText,
          location.oldEvidence ?? "",
          location.newEvidence ?? "",
        ])
        .join("\u0000"),
    )
    .digest("hex")
    .slice(0, 16);

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

// The grouping key that keeps one block's revision together: a declared
// sub-target answers with the block that owns it, and every other block
// answers with itself, so a table or component root and its own rows or
// facets share a key even when the changed sub-targets are not adjacent.
// Structural ids are stable across sides, so an old-side owner matches its
// new-side counterpart.
const ownerKeyFor = ({
  location,
  before,
  after,
}: {
  readonly location: SnapshotDiffLocation;
  readonly before: ReadonlyArray<SnapshotBlock>;
  readonly after: ReadonlyArray<SnapshotBlock>;
}): string | undefined => {
  const blocks = location.newBlockId === undefined ? before : after;
  const blockId = location.newBlockId ?? location.oldBlockId;
  const block = blocks.find((candidate) => candidate.id === blockId);
  if (block === undefined) return undefined;
  return block.ownerId ?? block.id;
};

// The component a location belongs to, when it belongs to one: a component
// root answers with itself, and a declared sub-target answers with its owning
// root. Two different components must never share a review stop - adjacency
// can bridge a component boundary when one card's last field sits right beside
// the next card's root, and a merged stop would hide which component owns
// which change.
const componentKeyFor = ({
  location,
  before,
  after,
}: {
  readonly location: SnapshotDiffLocation;
  readonly before: ReadonlyArray<SnapshotBlock>;
  readonly after: ReadonlyArray<SnapshotBlock>;
}): string | undefined => {
  const blocks = location.newBlockId === undefined ? before : after;
  const blockId = location.newBlockId ?? location.oldBlockId;
  const block = blocks.find((candidate) => candidate.id === blockId);
  if (block === undefined) return undefined;
  if (block.isComponentRoot) return block.id;
  if (block.ownerId === undefined) return undefined;
  const owner = blocks.find((candidate) => candidate.id === block.ownerId);
  return owner?.isComponentRoot === true ? owner.id : undefined;
};

/**
 * Which change set declared each changed block, as the party that knows the
 * committed revisions hands it in.
 *
 * It is data passed in rather than something this module derives, because the
 * revision log and the agent exchange are review-runtime facts and grouping is
 * a pure rule over blocks. The map is deliberately partial: a block no change
 * set declared has no owner here, and grouping treats that as unknown rather
 * than as an owner of its own.
 */
export type ChangeOwnership = ReadonlyMap<string, string>;

// The change set a location belongs to, when the partition names one. Both
// sides are asked because a declared target names the block as the revision
// that changed it left it, while a deleted block only exists on the old side.
const ownerChangeSetFor = ({
  location,
  ownership,
}: {
  readonly location: SnapshotDiffLocation;
  readonly ownership: ChangeOwnership | undefined;
}): string | undefined => {
  if (ownership === undefined) return undefined;
  const newOwner =
    location.newBlockId === undefined
      ? undefined
      : ownership.get(location.newBlockId);
  if (newOwner !== undefined) return newOwner;
  return location.oldBlockId === undefined
    ? undefined
    : ownership.get(location.oldBlockId);
};

/**
 * Groups adjacent changed blocks within a section into calm review stops.
 *
 * Adjacency is geometric, and ownership is not, so grouping asks both. Two
 * changed blocks that sit side by side but belong to different change sets are
 * two review stops rather than one: merging them mints a single place id that
 * both threads then attribute, and a place both threads attribute is a place
 * either one's acceptance silently closes for the other.
 */
export const buildSnapshotDiff = ({
  from,
  to,
  before,
  after,
  ownership,
}: {
  readonly from: string;
  readonly to: string;
  readonly before: ReadonlyArray<SnapshotBlock>;
  readonly after: ReadonlyArray<SnapshotBlock>;
  readonly ownership?: ChangeOwnership;
}): BuiltSnapshotDiff => {
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
    const currentOwnerKey = ownerKeyFor({ location, before, after });
    const previousOwnerKey =
      previous === undefined
        ? undefined
        : ownerKeyFor({ location: previous, before, after });
    const currentComponentKey = componentKeyFor({ location, before, after });
    const previousComponentKey =
      previous === undefined
        ? undefined
        : componentKeyFor({ location: previous, before, after });
    const currentChangeSet = ownerChangeSetFor({ location, ownership });
    const groupChangeSets = new Set(
      (group ?? []).flatMap((locationIndex) => {
        const groupedLocation = locations.at(locationIndex);
        if (groupedLocation === undefined) return [];
        const owner = ownerChangeSetFor({
          location: groupedLocation,
          ownership,
        });
        return owner === undefined ? [] : [owner];
      }),
    );
    const sameChangeSet =
      currentChangeSet === undefined ||
      groupChangeSets.size === 0 ||
      groupChangeSets.has(currentChangeSet);
    const renderedEvidence =
      location.isComponentRoot || RENDERED_SNAPSHOT_KINDS.has(location.kind);
    const previousRenderedEvidence =
      previous !== undefined &&
      (previous.isComponentRoot || RENDERED_SNAPSHOT_KINDS.has(previous.kind));
    const sameOwner =
      currentOwnerKey !== undefined && currentOwnerKey === previousOwnerKey;
    if (
      group !== undefined &&
      previous !== undefined &&
      previous.section === location.section &&
      sameChangeSet &&
      (currentComponentKey === undefined ||
        previousComponentKey === undefined ||
        currentComponentKey === previousComponentKey) &&
      (sameOwner ||
        (!renderedEvidence &&
          !previousRenderedEvidence &&
          currentPosition - previousPosition <= 1))
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
      const ownerChangeSetIds = [
        ...new Set(
          groupedLocations.flatMap((location) => {
            const owner = ownerChangeSetFor({ location, ownership });
            return owner === undefined ? [] : [owner];
          }),
        ),
      ];
      return {
        placeId: placeId({ from, to, locations: groupedLocations }),
        contentDigest: contentDigest(groupedLocations),
        status: statuses.size === 1 ? first.status : "changed",
        label: placeLabel(groupedLocations),
        section: first.section,
        note: placeNote(groupedLocations),
        locationIndexes,
        ...(ownerChangeSetIds.length === 0 ? {} : { ownerChangeSetIds }),
      };
    }),
  };
};
