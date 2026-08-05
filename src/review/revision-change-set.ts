// Owns the immutable revision-pair result consumed by every change surface.
// Alignment, place grouping, and stable navigation identity stop here; browser
// renderers receive one already-decided contract instead of repairing it.

import { createHash } from "node:crypto";
import { diffRevisions } from "./revision-diff.js";
import type { RevisionBlock, RevisionDiffLocation } from "./revision-diff.js";

export type RevisionPair = {
  readonly fromRevision: string;
  readonly toRevision: string;
};

export type RevisionChangePlace = {
  readonly placeId: string;
  readonly status: "changed" | "added" | "removed" | "moved";
  readonly label: string;
  readonly section: string;
  readonly note: "reworded" | "rewritten" | "added" | "removed" | "moved";
  readonly locations: ReadonlyArray<RevisionDiffLocation>;
};

export type RevisionChangeSet = RevisionPair & {
  readonly version: 1;
  readonly places: ReadonlyArray<RevisionChangePlace>;
};

const stablePlaceId = ({
  pair,
  locations,
}: {
  readonly pair: RevisionPair;
  readonly locations: ReadonlyArray<RevisionDiffLocation>;
}): string =>
  createHash("sha256")
    .update(
      [
        pair.fromRevision,
        pair.toRevision,
        ...locations.flatMap((location) => [
          location.status,
          location.oldBlockId ?? "",
          location.newBlockId ?? "",
        ]),
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 16);

const noteFor = (
  locations: ReadonlyArray<RevisionDiffLocation>,
): RevisionChangePlace["note"] => {
  if (locations.every((location) => location.status === "added")) {
    return "added";
  }
  if (locations.every((location) => location.status === "removed")) {
    return "removed";
  }
  if (locations.every((location) => location.status === "moved")) {
    return "moved";
  }
  const oldLength = locations.reduce(
    (total, location) => total + location.oldText.trim().length,
    0,
  );
  const sameLength = locations
    .flatMap((location) => location.runs)
    .filter((run) => run.op === "same")
    .reduce((total, run) => total + run.text.trim().length, 0);
  return oldLength > 0 && sameLength / oldLength < 0.2
    ? "rewritten"
    : "reworded";
};

const locationPosition = ({
  location,
  after,
}: {
  readonly location: RevisionDiffLocation;
  readonly after: ReadonlyArray<RevisionBlock>;
}): number => {
  const id =
    location.newBlockId ?? location.beforeBlockId ?? location.afterBlockId;
  const index =
    id === undefined ? -1 : after.findIndex((block) => block.id === id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
};

const contiguous = ({
  previous,
  next,
  after,
}: {
  readonly previous: RevisionDiffLocation;
  readonly next: RevisionDiffLocation;
  readonly after: ReadonlyArray<RevisionBlock>;
}): boolean =>
  previous.section === next.section &&
  locationPosition({ location: next, after }) -
    locationPosition({ location: previous, after }) <=
    1;

/** Builds the sole source of truth for one owned before/after exchange. */
export const buildRevisionChangeSet = ({
  pair,
  before,
  after,
}: {
  readonly pair: RevisionPair;
  readonly before: ReadonlyArray<RevisionBlock>;
  readonly after: ReadonlyArray<RevisionBlock>;
}): RevisionChangeSet => {
  const locations = diffRevisions({ before, after });
  const groups: Array<Array<RevisionDiffLocation>> = [];
  for (const location of locations) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (
      group !== undefined &&
      previous !== undefined &&
      contiguous({ previous, next: location, after })
    ) {
      group.push(location);
    } else {
      groups.push([location]);
    }
  }
  return {
    version: 1,
    ...pair,
    places: groups.map((group) => {
      const first = group[0];
      if (first === undefined) {
        throw new Error("A revision place cannot be empty");
      }
      const statuses = new Set(group.map((location) => location.status));
      return {
        placeId: stablePlaceId({ pair, locations: group }),
        status: statuses.size === 1 ? first.status : "changed",
        label: group.length === 1 ? first.label : "Whole section",
        section: first.section,
        note: noteFor(group),
        locations: group,
      };
    }),
  };
};
