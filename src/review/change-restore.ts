// Owns putting one change back: the bytes a plan source has once the reviewer
// has rejected some of the places in a thread's change set.
//
// The restored source is a pure function of three things - the thread's
// baseline, the revision the agent proposed, and which places were rejected -
// and never of the order the rejections arrived in. That is what makes reject
// and undo the same operation with a different set: undo re-derives the source
// with the place removed from the set, so the plan lands on exactly the bytes
// it would have had if that rejection had never happened, and a second reject
// never has to reason about the first one's write.
//
// Restoring is proposed and then proved. A candidate is assembled by putting
// authored nodes back (see ../render/plan-source-segments.js, which owns why
// the unit is a whole node), and it is accepted only when rendering it shows
// that the diff left is exactly the diff the agent proposed minus the rejected
// places. Anything else - a change the reviewer never rejected that moved, a
// place whose content cannot be separated from another's - is refused with the
// plan untouched, because bytes written on a guess are the one failure a
// reviewer has no way to see.

import { renderDocument } from "../render/render-document.js";
import type { BlockDescriptor } from "../render/render-document.js";
import { planSourceSegments } from "../render/plan-source-segments.js";
import type { PlanSourceSegment } from "../render/plan-source-segments.js";
import {
  buildSnapshotDiff,
  type ChangeOwnership,
  type DiffPlace,
} from "./snapshot-diff.js";

/**
 * How many authored edits one change set may hold before restoring a single
 * place stops being attributable at reasonable cost. Each edit costs one
 * rendering to attribute, and a change set this wide is a rewrite rather than
 * a set of changes a reviewer decides one at a time.
 */
const MAX_SOURCE_EDITS = 24;

/** The largest alignment this will attempt between two sources' nodes. */
const MAX_ALIGNMENT_CELLS = 250_000;

/** The refusal a reviewer reads when a change cannot be put back on its own. */
export class ChangeRestoreRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeRestoreRejected";
  }
}

export const changedPlaces = ({
  baselineSource,
  proposedSource,
  from,
  to,
  fallbackTitle,
  ownership,
}: {
  readonly baselineSource: string;
  readonly proposedSource: string;
  readonly from: string;
  readonly to: string;
  readonly fallbackTitle: string;
  /** The reader's ownership partition, so these are the reader's addresses. */
  readonly ownership?: ChangeOwnership;
}): ReadonlyArray<DiffPlace> => {
  const before = blocksOf({ markdown: baselineSource, fallbackTitle });
  const after = blocksOf({ markdown: proposedSource, fallbackTitle });
  return buildSnapshotDiff({
    from,
    to,
    before,
    after,
    ...(ownership === undefined ? {} : { ownership }),
  }).places;
};

export const changedPlaceIds = (
  input: Parameters<typeof changedPlaces>[0],
): ReadonlyArray<string> => changedPlaces(input).map((place) => place.placeId);

/** One splice: proposed bytes to remove, baseline bytes to put in their place. */
type SourceEdit = {
  readonly cutStart: number;
  readonly cutEnd: number;
  readonly replacement: string;
};

const lcsMatches = ({
  baseline,
  proposed,
}: {
  readonly baseline: ReadonlyArray<string>;
  readonly proposed: ReadonlyArray<string>;
}): ReadonlyArray<readonly [number, number]> => {
  if (baseline.length * proposed.length > MAX_ALIGNMENT_CELLS) {
    throw new ChangeRestoreRejected(
      "This plan revision is too large to restore one change from",
    );
  }
  const lengths = Array.from({ length: baseline.length + 1 }, () =>
    Array<number>(proposed.length + 1).fill(0),
  );
  const cell = (row: number, column: number): number =>
    lengths.at(row)?.at(column) ?? 0;
  for (let left = baseline.length - 1; left >= 0; left -= 1) {
    for (let right = proposed.length - 1; right >= 0; right -= 1) {
      const row = lengths.at(left);
      if (row === undefined) continue;
      row[right] =
        baseline.at(left) === proposed.at(right)
          ? 1 + cell(left + 1, right + 1)
          : Math.max(cell(left + 1, right), cell(left, right + 1));
    }
  }
  const matches: Array<readonly [number, number]> = [];
  let left = 0;
  let right = 0;
  while (left < baseline.length && right < proposed.length) {
    if (baseline.at(left) === proposed.at(right)) {
      matches.push([left, right]);
      left += 1;
      right += 1;
    } else if (cell(left + 1, right) >= cell(left, right + 1)) {
      left += 1;
    } else {
      right += 1;
    }
  }
  return matches;
};

// Two segments are the same authored construct when they are the same kind and
// both hold flow children. Only such a pair is worth descending into: a slide
// whose one paragraph changed is one changed node at this level, and taking it
// whole would put every other paragraph in that slide back too.
const isDescendablePair = ({
  baseline,
  proposed,
}: {
  readonly baseline: PlanSourceSegment;
  readonly proposed: PlanSourceSegment;
}): boolean =>
  baseline.kind === proposed.kind &&
  baseline.children.length > 0 &&
  proposed.children.length > 0;

const spanText = ({
  source,
  start,
  end,
}: {
  readonly source: string;
  readonly start: number;
  readonly end: number;
}): string => source.slice(start, end);

// A container's own bytes are everything outside its children: the opening tag
// and its attributes, and the close. They are compared as one unit each, so a
// changed attribute is a change to the container rather than to nothing at all.
const wrapperEdits = ({
  baselineSource,
  proposedSource,
  baseline,
  proposed,
}: {
  readonly baselineSource: string;
  readonly proposedSource: string;
  readonly baseline: PlanSourceSegment;
  readonly proposed: PlanSourceSegment;
}): ReadonlyArray<SourceEdit> => {
  const baselineFirst = baseline.children.at(0);
  const baselineLast = baseline.children.at(-1);
  const proposedFirst = proposed.children.at(0);
  const proposedLast = proposed.children.at(-1);
  if (
    baselineFirst === undefined ||
    baselineLast === undefined ||
    proposedFirst === undefined ||
    proposedLast === undefined
  ) {
    return [];
  }
  const sides = [
    {
      cutStart: proposed.start,
      cutEnd: proposedFirst.start,
      replacement: spanText({
        source: baselineSource,
        start: baseline.start,
        end: baselineFirst.start,
      }),
    },
    {
      cutStart: proposedLast.end,
      cutEnd: proposed.end,
      replacement: spanText({
        source: baselineSource,
        start: baselineLast.end,
        end: baseline.end,
      }),
    },
  ];
  return sides.filter(
    (side) =>
      side.replacement !==
      spanText({
        source: proposedSource,
        start: side.cutStart,
        end: side.cutEnd,
      }),
  );
};

// One unmatched run becomes one splice. The separator handling is what keeps
// the result a document rather than two paragraphs run together: bytes removed
// take an adjoining blank line with them, and bytes put back bring one.
const runEdit = ({
  baselineSource,
  baselineSegments,
  proposedSegments,
  baselineRun,
  proposedRun,
}: {
  readonly baselineSource: string;
  readonly baselineSegments: ReadonlyArray<PlanSourceSegment>;
  readonly proposedSegments: ReadonlyArray<PlanSourceSegment>;
  readonly baselineRun: readonly [number, number];
  readonly proposedRun: readonly [number, number];
}): SourceEdit => {
  const [baselineFrom, baselineTo] = baselineRun;
  const [proposedFrom, proposedTo] = proposedRun;
  const baselineStart = baselineSegments.at(baselineFrom)?.start;
  const baselineEnd = baselineSegments.at(baselineTo - 1)?.end;
  const restored =
    baselineTo <= baselineFrom ||
    baselineStart === undefined ||
    baselineEnd === undefined
      ? ""
      : spanText({
          source: baselineSource,
          start: baselineStart,
          end: baselineEnd,
        });
  if (proposedTo > proposedFrom) {
    const cutStart = proposedSegments.at(proposedFrom)?.start;
    const cutEnd = proposedSegments.at(proposedTo - 1)?.end;
    if (cutStart === undefined || cutEnd === undefined) {
      throw new ChangeRestoreRejected(
        "This change could not be located in the plan source",
      );
    }
    if (restored !== "") return { cutStart, cutEnd, replacement: restored };
    // Nothing goes back, so the blank line that separated the removed nodes
    // from a neighbour has to go with them.
    const precedingEnd = proposedSegments.at(proposedFrom - 1)?.end;
    const followingStart = proposedSegments.at(proposedTo)?.start;
    if (proposedFrom > 0 && precedingEnd !== undefined) {
      return { cutStart: precedingEnd, cutEnd, replacement: "" };
    }
    return { cutStart, cutEnd: followingStart ?? cutEnd, replacement: "" };
  }
  // Nothing was proposed here at all, so the baseline nodes go back beside the
  // neighbour they used to sit next to.
  const precedingEnd = proposedSegments.at(proposedFrom - 1)?.end;
  const followingStart = proposedSegments.at(proposedFrom)?.start;
  if (proposedFrom > 0 && precedingEnd !== undefined) {
    return {
      cutStart: precedingEnd,
      cutEnd: precedingEnd,
      replacement: `\n\n${restored}`,
    };
  }
  if (followingStart === undefined) {
    throw new ChangeRestoreRejected(
      "This change could not be located in the plan source",
    );
  }
  return {
    cutStart: followingStart,
    cutEnd: followingStart,
    replacement: `${restored}\n\n`,
  };
};

const collectEdits = ({
  baselineSource,
  proposedSource,
  baselineSegments,
  proposedSegments,
  edits,
}: {
  readonly baselineSource: string;
  readonly proposedSource: string;
  readonly baselineSegments: ReadonlyArray<PlanSourceSegment>;
  readonly proposedSegments: ReadonlyArray<PlanSourceSegment>;
  readonly edits: Array<SourceEdit>;
}): void => {
  const pairEdits = ({
    baselineIndex,
    proposedIndex,
  }: {
    readonly baselineIndex: number;
    readonly proposedIndex: number;
  }): void => {
    const baseline = baselineSegments.at(baselineIndex);
    const proposed = proposedSegments.at(proposedIndex);
    if (baseline === undefined || proposed === undefined) return;
    if (isDescendablePair({ baseline, proposed })) {
      edits.push(
        ...wrapperEdits({
          baselineSource,
          proposedSource,
          baseline,
          proposed,
        }),
      );
      collectEdits({
        baselineSource,
        proposedSource,
        baselineSegments: baseline.children,
        proposedSegments: proposed.children,
        edits,
      });
      return;
    }
    edits.push(
      runEdit({
        baselineSource,
        baselineSegments,
        proposedSegments,
        baselineRun: [baselineIndex, baselineIndex + 1],
        proposedRun: [proposedIndex, proposedIndex + 1],
      }),
    );
  };
  // A run of changed nodes is decided node by node wherever the two sides line
  // up, because two paragraphs that happen to be neighbours are still two
  // changes and the reviewer decides them apart. Only the part that does not
  // line up stays one splice: there is no pairing there to honour, and guessing
  // one would put back bytes from a node the reviewer never pointed at.
  const splitRun = ({
    baselineRun,
    proposedRun,
  }: {
    readonly baselineRun: readonly [number, number];
    readonly proposedRun: readonly [number, number];
  }): void => {
    let [baselineFrom, baselineTo] = baselineRun;
    let [proposedFrom, proposedTo] = proposedRun;
    const alike = (baselineIndex: number, proposedIndex: number): boolean =>
      baselineSegments.at(baselineIndex)?.kind ===
      proposedSegments.at(proposedIndex)?.kind;
    while (
      baselineFrom < baselineTo &&
      proposedFrom < proposedTo &&
      alike(baselineFrom, proposedFrom)
    ) {
      pairEdits({
        baselineIndex: baselineFrom,
        proposedIndex: proposedFrom,
      });
      baselineFrom += 1;
      proposedFrom += 1;
    }
    const tail: Array<{
      readonly baselineIndex: number;
      readonly proposedIndex: number;
    }> = [];
    while (
      baselineFrom < baselineTo &&
      proposedFrom < proposedTo &&
      alike(baselineTo - 1, proposedTo - 1)
    ) {
      baselineTo -= 1;
      proposedTo -= 1;
      tail.unshift({
        baselineIndex: baselineTo,
        proposedIndex: proposedTo,
      });
    }
    if (baselineFrom < baselineTo || proposedFrom < proposedTo) {
      edits.push(
        runEdit({
          baselineSource,
          baselineSegments,
          proposedSegments,
          baselineRun: [baselineFrom, baselineTo],
          proposedRun: [proposedFrom, proposedTo],
        }),
      );
    }
    for (const pair of tail) pairEdits(pair);
  };
  const matches = lcsMatches({
    baseline: baselineSegments.map((segment) =>
      spanText({ source: baselineSource, ...segment }),
    ),
    proposed: proposedSegments.map((segment) =>
      spanText({ source: proposedSource, ...segment }),
    ),
  });
  let baselineCursor = 0;
  let proposedCursor = 0;
  const boundaries = [
    ...matches,
    [baselineSegments.length, proposedSegments.length] as const,
  ];
  for (const [baselineIndex, proposedIndex] of boundaries) {
    const baselineRun = [baselineCursor, baselineIndex] as const;
    const proposedRun = [proposedCursor, proposedIndex] as const;
    baselineCursor = baselineIndex + 1;
    proposedCursor = proposedIndex + 1;
    if (
      baselineRun[0] === baselineRun[1] &&
      proposedRun[0] === proposedRun[1]
    ) {
      continue;
    }
    splitRun({ baselineRun, proposedRun });
  }
};

/** Every authored splice that turns the proposed source back into the baseline. */
const sourceEdits = ({
  baselineSource,
  proposedSource,
}: {
  readonly baselineSource: string;
  readonly proposedSource: string;
}): ReadonlyArray<SourceEdit> => {
  const edits: Array<SourceEdit> = [];
  collectEdits({
    baselineSource,
    proposedSource,
    baselineSegments: planSourceSegments(baselineSource),
    proposedSegments: planSourceSegments(proposedSource),
    edits,
  });
  return edits;
};

const applyEdits = ({
  source,
  edits,
}: {
  readonly source: string;
  readonly edits: ReadonlyArray<SourceEdit>;
}): string => {
  const ordered = [...edits].sort(
    (left, right) => right.cutStart - left.cutStart,
  );
  let result = source;
  for (const edit of ordered) {
    result =
      result.slice(0, edit.cutStart) +
      edit.replacement +
      result.slice(edit.cutEnd);
  }
  return result;
};

// A change is identified by what it says, not by where the renderer numbered
// the block that says it. Putting one place back renumbers every later block in
// its scope, so an address-based identity would report every surviving change
// as different and refuse every restore but the last one.
//
// What a block says includes what its component asserted. A component's diff
// is not always visible in its words - a callout that changed only its type
// reads identically - so the model is part of the identity too. Without it a
// restore that put such a change back would look like a change that had not
// moved, and the proof below would refuse a restore that had in fact worked.
const blockSignature = (block: BlockDescriptor | undefined): string =>
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

const changeSignatures = ({
  before,
  after,
}: {
  readonly before: ReadonlyArray<BlockDescriptor>;
  readonly after: ReadonlyArray<BlockDescriptor>;
}): ReadonlyArray<string> => {
  const beforeById = new Map(before.map((block) => [block.id, block]));
  const afterById = new Map(after.map((block) => [block.id, block]));
  return buildSnapshotDiff({ from: "", to: "", before, after }).locations.map(
    (location) =>
      [
        location.status,
        location.kind,
        blockSignature(
          location.oldBlockId === undefined
            ? undefined
            : beforeById.get(location.oldBlockId),
        ),
        blockSignature(
          location.newBlockId === undefined
            ? undefined
            : afterById.get(location.newBlockId),
        ),
      ].join(" | "),
  );
};

const blocksOf = ({
  markdown,
  fallbackTitle,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
}): ReadonlyArray<BlockDescriptor> =>
  renderDocument({ markdown, fallbackTitle, identity: {} }).blocks;

const asMultiset = (values: ReadonlyArray<string>): string =>
  [...values].sort().join("\n");

const withoutFirst = ({
  values,
  removed,
}: {
  readonly values: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}): ReadonlyArray<string> => {
  const remaining = [...values];
  for (const value of removed) {
    const index = remaining.indexOf(value);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
};

/**
 * The plan source that holds the agent's proposed revision with the named
 * places put back to the thread's baseline.
 *
 * `placeIds` is the whole rejected set for this revision rather than the one
 * place a gesture named, so the answer is the same however the reviewer got
 * here. An empty set is the proposed revision itself: nothing was rejected, so
 * nothing is restored.
 */
export const restoreRejectedPlaces = ({
  baselineSource,
  proposedSource,
  from,
  to,
  placeIds,
  fallbackTitle,
  ownership,
}: {
  readonly baselineSource: string;
  readonly proposedSource: string;
  readonly from: string;
  readonly to: string;
  readonly placeIds: ReadonlyArray<string>;
  readonly fallbackTitle: string;
  /**
   * The reader's ownership partition. A rejected place is named by the address
   * the reviewer saw, so the revision has to be grouped the way they saw it or
   * the place they rejected is not in this proposal at all.
   */
  readonly ownership?: ChangeOwnership;
}): string => {
  if (placeIds.length === 0) return proposedSource;
  const baselineBlocks = blocksOf({
    markdown: baselineSource,
    fallbackTitle,
  });
  const proposedBlocks = blocksOf({ markdown: proposedSource, fallbackTitle });
  const proposed = buildSnapshotDiff({
    from,
    to,
    before: baselineBlocks,
    after: proposedBlocks,
    ...(ownership === undefined ? {} : { ownership }),
  });
  const rejected = new Set(placeIds);
  const known = new Set(proposed.places.map((place) => place.placeId));
  for (const placeId of rejected) {
    if (!known.has(placeId)) {
      throw new ChangeRestoreRejected(
        "This change is no longer part of the agent's proposal",
      );
    }
  }
  const proposedSignatures = changeSignatures({
    before: baselineBlocks,
    after: proposedBlocks,
  });
  const target = proposed.places
    .filter((place) => rejected.has(place.placeId))
    .flatMap((place) =>
      place.locationIndexes.flatMap((index) => {
        const signature = proposedSignatures.at(index);
        return signature === undefined ? [] : [signature];
      }),
    );
  const edits = sourceEdits({ baselineSource, proposedSource });
  if (edits.length === 0) {
    throw new ChangeRestoreRejected(
      "This change has no authored source left to put back",
    );
  }
  if (edits.length > MAX_SOURCE_EDITS) {
    throw new ChangeRestoreRejected(
      "This proposal changes too much of the plan to reject one change from",
    );
  }
  const wanted = new Set(target);
  // One rendering per authored edit says which changes that edit alone
  // accounts for. Attribution is measured rather than inferred: the authored
  // nodes and the reader's places are two different groupings of the same
  // revision, and neither is derivable from the other.
  const selected = edits.filter((edit) => {
    let remaining: ReadonlyArray<string>;
    try {
      remaining = changeSignatures({
        before: baselineBlocks,
        after: blocksOf({
          markdown: applyEdits({ source: proposedSource, edits: [edit] }),
          fallbackTitle,
        }),
      });
    } catch {
      // An edit that does not stand on its own explains nothing by itself. The
      // proof below decides whether the restore still works without it.
      return false;
    }
    return withoutFirst({
      values: proposedSignatures,
      removed: remaining,
    }).some((signature) => wanted.has(signature));
  });
  const restored = applyEdits({ source: proposedSource, edits: selected });
  let remaining: ReadonlyArray<string>;
  try {
    remaining = changeSignatures({
      before: baselineBlocks,
      after: blocksOf({ markdown: restored, fallbackTitle }),
    });
  } catch {
    throw new ChangeRestoreRejected(
      "Putting this change back would leave a plan Big Plan cannot compile",
    );
  }
  const expected = withoutFirst({
    values: proposedSignatures,
    removed: target,
  });
  if (asMultiset(remaining) !== asMultiset(expected)) {
    throw new ChangeRestoreRejected(
      "This change cannot be put back without also changing work the reviewer kept",
    );
  }
  return restored;
};
