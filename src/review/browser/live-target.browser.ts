// Owns every "which live element is this semantic target?" question the review
// island asks of plan DOM. A block id or diagram anchor is a name, not a node:
// the same name can sit on the hidden theme variant of a diagram or on a block
// whose content drifted since the id was minted. Resolving those names in one
// place keeps the discipline mandatory - scoped to the live article, visible
// copy preferred - and makes a miss say why it missed instead of degrading to
// a plausible default. Every rendering of a change is the plan itself: a
// component renders its own diff in place of its root, and the one side that
// is not the plan carries no plan identity at all, because the side-isolation
// module kept it out before the markup reached the browser. Where a lens
// belongs relative to the blocks it finds stays pure in diff-anchor.ts; this
// module is the DOM half of that decision, which is why it carries the
// browser-only suffix.

import type { DiffLocation } from "../shared/review-wire.js";
import {
  candidateMatchesLiveText,
  lensAnchorCandidates,
  type LensAnchorCandidate,
  type LensPlacement,
} from "./diff-anchor.js";

/** Why a semantic target could not be resolved to a live element. */
export type LiveTargetMissReason =
  // Nothing in the live article carries the name: the block was removed, or an
  // id minted for an older revision no longer exists.
  | "unknown-id"
  // A name resolved but the block no longer holds the content the diff
  // recorded, so a structural path now points at different words.
  | "drifted-content"
  // The reading surface itself is absent. Purely defensive: a document without
  // an article has nothing to resolve against.
  | "no-article"
  // The element exists and is the right one, but the browser gave it no box:
  // a block inside a collapsed slide is the honest answer to "which element is
  // this?" and no answer at all to "where on screen is it?". Only a caller
  // that must paint something asks for this distinction.
  | "unlaid-out"
  // A qualified baseline address has no retained baseline rendering.
  | "snapshot-not-retained";

export type LiveTargetResult =
  { readonly found: HTMLElement } | { readonly missing: LiveTargetMissReason };

export type LensAnchorResult =
  | { readonly found: HTMLElement; readonly placement: LensPlacement }
  | { readonly missing: LiveTargetMissReason };

/** One match for a name, described for the pure choice between matches. */
export type LiveCandidate<TElement> = {
  readonly element: TElement;
  readonly isVisible: boolean;
};

/**
 * Chooses the element a name refers to. A displayed match wins over a hidden
 * one because a diagram ships one copy per theme variant with only one shown.
 * Hidden is still an answer when it is the only one: a block inside a
 * collapsed slide is the right element for containment, labelling, and
 * existence questions.
 */
export const pickLiveCandidate = <TElement>(
  candidates: ReadonlyArray<LiveCandidate<TElement>>,
): { readonly found: TElement } | { readonly missing: "unknown-id" } => {
  const preferred =
    candidates.find((candidate) => candidate.isVisible) ?? candidates.at(0);
  return preferred === undefined
    ? { missing: "unknown-id" }
    : { found: preferred.element };
};

/**
 * Reduces one lens anchor's per-candidate misses to the reason worth telling.
 * Drift outranks a plain absence because it is the only evidence that an id
 * resolved against content it no longer names, while "unknown-id" says only
 * that nothing is there.
 */
export const lensMissReason = (
  reasons: ReadonlyArray<LiveTargetMissReason>,
): LiveTargetMissReason =>
  reasons.includes("drifted-content") ? "drifted-content" : "unknown-id";

export const liveArticle = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("article");

/**
 * Describes each match for the pure choice. Measuring client rects forces
 * layout, so a single match skips a measurement whose answer it could not act
 * on: with nothing to prefer it over, a lone match is the answer either way.
 */
const describeMatches = (
  matches: ReadonlyArray<HTMLElement>,
): ReadonlyArray<LiveCandidate<HTMLElement>> =>
  matches.map((element) => ({
    element,
    isVisible: matches.length === 1 || element.getClientRects().length > 0,
  }));

const resolveWithin = (
  article: HTMLElement,
  selector: string,
): LiveTargetResult =>
  pickLiveCandidate(
    describeMatches(
      Array.from(article.querySelectorAll<HTMLElement>(selector)),
    ),
  );

const blockSelector = (blockId: string): string =>
  `[data-block-id="${CSS.escape(blockId)}"]`;

const baselineBlockSelector = (blockId: string, snapshot: string): string =>
  `[data-baseline-block-id="${CSS.escape(blockId)}"][data-baseline-snapshot="${CSS.escape(snapshot)}"]`;

const baselineSnapshotSelector = (snapshot: string): string =>
  `[data-baseline-snapshot="${CSS.escape(snapshot)}"]`;

export const baselineMissReason = ({
  result,
  snapshotPresent,
}: {
  readonly result: LiveTargetResult;
  readonly snapshotPresent: boolean;
}): LiveTargetResult =>
  "missing" in result && result.missing === "unknown-id" && !snapshotPresent
    ? { missing: "snapshot-not-retained" }
    : result;

/**
 * Lists the pictures the reader is reading. A replayed picture is rendered
 * without plan identity, so it carries no block kind for this lookup to find.
 */
export const livePictures = (): ReadonlyArray<HTMLElement> => {
  const article = liveArticle();
  if (article === null) return [];
  return Array.from(
    article.querySelectorAll<HTMLElement>('[data-block-kind="image"]'),
  );
};

/** Resolves a block id to the block the reader is reading. */
export const liveBlock = (blockId: string): LiveTargetResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  return resolveWithin(article, blockSelector(blockId));
};

/**
 * Resolves a block address minted by a retained baseline snapshot.
 *
 * This stays separate from liveBlock because it can distinguish a snapshot
 * absent from the page from an id absent within a snapshot that is present.
 */
export const liveBaselineBlock = (
  blockId: string,
  snapshot: string,
): LiveTargetResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  const snapshotSelector = baselineSnapshotSelector(snapshot);
  const snapshotPresent =
    article.matches(snapshotSelector) ||
    article.querySelector(snapshotSelector) !== null;
  const result = resolveWithin(
    article,
    baselineBlockSelector(blockId, snapshot),
  );
  return baselineMissReason({ result, snapshotPresent });
};

/**
 * Resolves a block id to a block the reader can see right now.
 *
 * Identity is not geometry, and every other caller here rightly wants identity:
 * a block inside a collapsed slide is the correct element for containment,
 * labelling, and existence. A caller that is about to paint on the block wants
 * the narrower question, and asking it here keeps the widened answer beside
 * the resolution it narrows instead of turning into a raw rect measurement at
 * the call site, where "no box" and "at the document origin" look identical.
 */
export const liveVisibleBlock = (blockId: string): LiveTargetResult => {
  const resolved = liveBlock(blockId);
  if ("missing" in resolved) return resolved;
  return resolved.found.getClientRects().length > 0
    ? resolved
    : { missing: "unlaid-out" };
};

/**
 * Resolves a diagram flow anchor to the element the reader can actually see.
 * A diagram ships one copy per theme variant with only one shown, so the
 * visible-copy preference is load-bearing here rather than defensive.
 */
export const liveFlowAnchor = (anchor: string): LiveTargetResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  return resolveWithin(article, `[data-flow-anchor="${CSS.escape(anchor)}"]`);
};

type LivePictureIdentity = {
  readonly source: string | null;
  readonly alt: string | null;
};

const livePictureIdentity = (
  element: HTMLElement,
): LivePictureIdentity | undefined => {
  const picture = element.matches("img")
    ? element
    : element.querySelector<HTMLElement>("img");
  return picture === null
    ? undefined
    : {
        source: picture.getAttribute("src"),
        alt: picture.getAttribute("alt"),
      };
};

/** Whether a live block presents the picture identity its candidate records. */
export const candidateMatchesLivePicture = ({
  candidate,
  livePicture,
}: {
  readonly candidate: LensAnchorCandidate;
  readonly livePicture: LivePictureIdentity | undefined;
}): boolean =>
  candidate.expectedPicture === undefined ||
  (livePicture !== undefined &&
    candidate.expectedPicture.source === livePicture.source &&
    candidate.expectedPicture.alt === livePicture.alt);

/** Resolves a decision id to its live card. */
export const liveDecisionFigure = (decisionId: string): LiveTargetResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  return resolveWithin(article, `#${CSS.escape(decisionId)}[data-decision]`);
};

/**
 * The first decision the reader can be sent to when a control says "those
 * decisions" without naming one. Same live-article rule as a named lookup, so
 * a jump from the approval stamp resolves against the plan the reader reads.
 */
export const liveFirstDecision = (): LiveTargetResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  return resolveWithin(article, "[data-decision]");
};

/**
 * Reads the text a live block presents to the reader, mirroring what
 * compile-time extraction recorded: screen-reader-only scaffolding and markup
 * shipped with the hidden attribute never enter a snapshot's text, and review
 * chrome injected after load did not exist at compile time, so all are
 * stripped before this text is compared with a snapshot's record of the block.
 */
const liveBlockText = (element: HTMLElement): string => {
  const clone = element.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return element.textContent ?? "";
  for (const injected of clone.querySelectorAll(
    ".sr-only, [hidden], [data-review-anchor-host], [data-review-toolbar-host], [data-review-slide-host], [data-flow-comment-marker]",
  )) {
    injected.remove();
  }
  return clone.textContent ?? "";
};

/**
 * Resolves where a What-changed lens belongs for one diff location, walking
 * the candidates in the order the diff prefers. A candidate whose id resolved
 * across a snapshot boundary must still hold the content the diff recorded;
 * one that does not is treated as missing, so the change falls back to the
 * honest historical archive instead of rendering beside the wrong block.
 */
export const liveLensAnchor = (
  location: DiffLocation,
  { isSuperseded }: { readonly isSuperseded: boolean },
): LensAnchorResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  const misses: Array<LiveTargetMissReason> = [];
  for (const candidate of lensAnchorCandidates(location, { isSuperseded })) {
    const resolved = resolveWithin(article, blockSelector(candidate.blockId));
    if ("missing" in resolved) {
      misses.push(resolved.missing);
      continue;
    }
    if (
      !candidateMatchesLiveText({
        candidate,
        liveText: liveBlockText(resolved.found),
      }) ||
      !candidateMatchesLivePicture({
        candidate,
        livePicture: livePictureIdentity(resolved.found),
      })
    ) {
      misses.push("drifted-content");
      continue;
    }
    return { found: resolved.found, placement: candidate.placement };
  }
  return { missing: lensMissReason(misses) };
};

/** The component-owned diff root currently carrying a compiled block. */
export const liveComponentDiff = (
  location: DiffLocation,
): HTMLElement | null => {
  const article = liveArticle();
  if (article === null) return null;
  for (const candidate of lensAnchorCandidates(location, {
    isSuperseded: false,
  })) {
    const resolved = resolveWithin(article, blockSelector(candidate.blockId));
    if ("missing" in resolved) continue;
    const root = resolved.found.closest<HTMLElement>("[data-component-diff]");
    if (root !== null) return root;
  }
  return null;
};

/**
 * The explicit opt-out for decoration and geometry callers, where a target
 * that is not on screen is a legitimate no-op rather than a state to render.
 * Every such caller reads as one, so the ones that owe the reader an
 * explanation stay greppable.
 */
export const foundElement = (result: LiveTargetResult): HTMLElement | null =>
  "found" in result ? result.found : null;
