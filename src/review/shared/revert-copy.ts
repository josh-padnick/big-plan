// Owns what a revert dialog says the reviewer is about to lose. A revert takes
// content the agent wrote back out of the plan, and it is not recoverable from
// the review, so the copy names that content by kind - "a generated image", "2
// paragraphs of generated text" - wherever the diff can say it. The
// kind-generic fallback is deliberately last: it is the honest answer when no
// kind survives, and a useless one when a kind was available.

import { attributeDiffPlaces } from "./change-attribution.js";
import type { DiffLocation, DiffPlace, SnapshotDiff } from "./review-wire.js";

/** What a revert removes when the diff names no kind Big Plan recognizes. */
export const REVERT_CONTENT_KIND_GENERIC =
  "content the agent wrote into the plan";

/** Singular and plural names for the block kinds a plan can lose. */
const CONTENT_KIND_NAMES: ReadonlyMap<string, readonly [string, string]> =
  new Map([
    [
      "paragraph",
      ["paragraph of generated text", "paragraphs of generated text"],
    ],
    ["heading", ["generated heading", "generated headings"]],
    ["list", ["generated list", "generated lists"]],
    ["quote", ["generated quote", "generated quotes"]],
    ["code", ["generated code block", "generated code blocks"]],
    ["image", ["generated image", "generated images"]],
    ["table-row", ["generated table row", "generated table rows"]],
    ["table-column", ["generated table column", "generated table columns"]],
    ["table-cell", ["generated table cell", "generated table cells"]],
  ]);

/** How many distinct kinds the sentence names before it would stop scanning. */
const NAMED_KIND_LIMIT = 3;

const COMPONENT_PREFIX = "component:";

/** The concrete kind one changed location is, or nothing when it has no name. */
const contentKindOf = (location: DiffLocation): string | undefined => {
  // A picture answers by presentation rather than by kind, because the block
  // carrying it is still a paragraph as far as the document model is
  // concerned, and "a paragraph" is the one thing it is not to a reader.
  if (
    location.newPresentation?.aspect === "image" ||
    location.oldPresentation?.aspect === "image"
  ) {
    return "image";
  }
  if (location.isComponentRoot || location.ownerId !== undefined) {
    return `${COMPONENT_PREFIX}${location.kind}`;
  }
  return CONTENT_KIND_NAMES.has(location.kind) ? location.kind : undefined;
};

/**
 * Names a counted kind, including the component kinds with no fixed name.
 *
 * One of a thing is "a paragraph", never "1 paragraph": a dialog read in a
 * hurry should read as a sentence, and a digit in front of every noun makes
 * the count the subject when the content is.
 */
const contentKindPhrase = (kind: string, count: number): string => {
  if (kind.startsWith(COMPONENT_PREFIX)) {
    const component = kind.slice(COMPONENT_PREFIX.length).split("-").join(" ");
    return count === 1
      ? `a generated ${component} block`
      : `${count} generated ${component} blocks`;
  }
  const names = CONTENT_KIND_NAMES.get(kind);
  if (names === undefined) return REVERT_CONTENT_KIND_GENERIC;
  return count === 1 ? `a ${names[0]}` : `${count} ${names[1]}`;
};

/** Joins named kinds the way a person would read them aloud. */
const joinKindPhrases = (phrases: ReadonlyArray<string>): string =>
  phrases.length <= 1
    ? (phrases[0] ?? "")
    : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;

/** Starts a sentence with a phrase written to sit mid-sentence. */
export const startSentence = (phrase: string): string =>
  `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;

export type RevertLoss = {
  /** Every place in the plan the revert takes content back out of. */
  readonly places: ReadonlyArray<DiffPlace>;
  /** What the reviewer loses, named by kind whenever a kind is known. */
  readonly lost: string;
  /** Whether the name above is concrete rather than the generic fallback. */
  readonly isConcrete: boolean;
};

/**
 * What one response's revert removes, named for the reviewer.
 *
 * The outcome's change targets narrow the whole-snapshot diff to the blocks
 * this response actually wrote. Attribution that matches nothing is a
 * projection gap rather than an empty response, so the whole diff stands in:
 * naming every place overstates nothing the revert will not in fact remove,
 * while claiming the response wrote nothing would.
 */
export const projectRevertLoss = ({
  diff,
  changeTargets,
}: {
  readonly diff: SnapshotDiff;
  readonly changeTargets?: ReadonlyArray<string>;
}): RevertLoss => {
  const owned =
    changeTargets === undefined
      ? undefined
      : new Set(attributeDiffPlaces({ diff, changeTargets }).placeIds);
  const places =
    owned === undefined || owned.size === 0
      ? diff.places
      : diff.places.filter((place) => owned.has(place.placeId));
  const counts = new Map<string, number>();
  for (const place of places) {
    for (const index of place.locationIndexes) {
      const location = diff.locations.at(index);
      if (location === undefined) continue;
      const kind = contentKindOf(location);
      if (kind === undefined) continue;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  const phrases = [...counts.entries()]
    .sort(([, first], [, second]) => second - first)
    .slice(0, NAMED_KIND_LIMIT)
    .map(([kind, count]) => contentKindPhrase(kind, count));
  return {
    places,
    lost:
      phrases.length === 0
        ? REVERT_CONTENT_KIND_GENERIC
        : joinKindPhrases(phrases),
    isConcrete: phrases.length > 0,
  };
};
