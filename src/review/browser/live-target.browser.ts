// Owns every "which live element is this semantic target?" question the review
// island asks of plan DOM. A block id or diagram anchor is a name, not a node:
// the same name can sit on a snapshot copy inside a What-changed lens, on the
// hidden theme variant of a diagram, or on a block whose content drifted since
// the id was minted. Resolving those names in one place keeps the discipline
// mandatory - scoped to the live article, never a lens copy, visible copy
// preferred - and makes a miss say why it missed instead of degrading to a
// plausible default. Where a lens belongs relative to the blocks it finds
// stays pure in diff-anchor.ts; this module is the DOM half of that decision,
// which is why it carries the browser-only suffix.

import type { DiffLocation } from "../shared/review-wire.js";
import {
  candidateMatchesLiveText,
  lensAnchorCandidates,
  type LensPlacement,
} from "./diff-anchor.js";

/** Why a semantic target could not be resolved to a live element. */
export type LiveTargetMissReason =
  // Nothing in the live article carries the name: the block was removed, or an
  // id minted for an older revision no longer exists.
  | "unknown-id"
  // The only matches sit inside a lens snapshot, which is a copy of the plan
  // rather than the plan. Anchoring there would nest a lens inside a lens or
  // attach a comment to a snapshot, and an identity attribute surviving into a
  // clone is an internal defect rather than something the author changed.
  | "clone-only"
  // A name resolved but the block no longer holds the content the diff
  // recorded, so a structural path now points at different words.
  | "drifted-content"
  // The reading surface itself is absent. Purely defensive: a document without
  // an article has nothing to resolve against.
  | "no-article";

export type LiveTargetResult =
  { readonly found: HTMLElement } | { readonly missing: LiveTargetMissReason };

export type LensAnchorResult =
  | { readonly found: HTMLElement; readonly placement: LensPlacement }
  | { readonly missing: LiveTargetMissReason };

/** One match for a name, described for the pure choice between matches. */
export type LiveCandidate<TElement> = {
  readonly element: TElement;
  readonly isLensCopy: boolean;
  readonly isVisible: boolean;
};

/**
 * Chooses the element a name refers to. A lens copy is never the answer, and a
 * displayed copy wins over a hidden one because a diagram ships one copy per
 * theme variant with only one shown. Hidden is still an answer when it is the
 * only one: a block inside a collapsed slide is the right element for
 * containment, labelling, and existence questions.
 */
export const pickLiveCandidate = <TElement>(
  candidates: ReadonlyArray<LiveCandidate<TElement>>,
):
  | { readonly found: TElement }
  | { readonly missing: "unknown-id" | "clone-only" } => {
  const live = candidates.filter((candidate) => !candidate.isLensCopy);
  const preferred = live.find((candidate) => candidate.isVisible) ?? live.at(0);
  if (preferred !== undefined) return { found: preferred.element };
  return { missing: candidates.length === 0 ? "unknown-id" : "clone-only" };
};

/**
 * Reduces one lens anchor's per-candidate misses to the reason worth telling.
 * Drift outranks the rest because it is the only evidence that an id resolved
 * against content it no longer names, and an identity attribute that survived
 * into a clone outranks a plain absence for the same reason: both say
 * something happened, while "unknown-id" says only that nothing is there.
 */
export const lensMissReason = (
  reasons: ReadonlyArray<LiveTargetMissReason>,
): LiveTargetMissReason => {
  if (reasons.includes("drifted-content")) return "drifted-content";
  if (reasons.includes("clone-only")) return "clone-only";
  return "unknown-id";
};

// A lens renders a scrubbed copy of plan content. Both the host the island
// creates and the lens itself are marked, so either marker proves a copy.
const LENS_COPY_SELECTOR =
  "[data-review-diff-lens], [data-review-diff-lens-host]";

/** True when the element is a snapshot copy inside a What-changed lens. */
export const isLensCopy = (element: Element): boolean =>
  element.closest(LENS_COPY_SELECTOR) !== null;

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
    isLensCopy: isLensCopy(element),
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

/**
 * Names the block ids a lens is currently showing in place of. The lens sets
 * it when it hides those blocks, because only the lens knows which ones it
 * replaced; nothing about the hidden block itself records that it was.
 */
export const LENS_STAND_IN_ATTRIBUTE = "data-review-diff-lens-for";

/**
 * The element a reader can actually be sent to for a target, when the target
 * itself is off screen because a What-changed lens replaced it. Scrolling to
 * an element with no box does nothing at all, which reads as a control that
 * jumps somewhere random; the lens holds the reader's content, so it is where
 * the jump belongs. Returns null whenever the target can be scrolled to on its
 * own, which includes a block merely inside a collapsed slide.
 */
export const displayedStandIn = (element: HTMLElement): HTMLElement | null => {
  if (element.getClientRects().length > 0) return null;
  const blockId =
    element.dataset.blockId ??
    element.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
  if (blockId === undefined || blockId === "") return null;
  const lenses = document.querySelectorAll<HTMLElement>(
    `[${LENS_STAND_IN_ATTRIBUTE}]`,
  );
  for (const lens of lenses) {
    const names = (lens.getAttribute(LENS_STAND_IN_ATTRIBUTE) ?? "").split(" ");
    if (names.includes(blockId) && lens.getClientRects().length > 0) {
      return lens;
    }
  }
  return null;
};

/** Resolves a block id to the block the reader is reading. */
export const liveBlock = (blockId: string): LiveTargetResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  return resolveWithin(article, blockSelector(blockId));
};

/**
 * Resolves a diagram flow anchor to the element the reader can actually see.
 * Snapshot scrubbing removes block ids from a lens copy but keeps its flow
 * anchors, so the clone exclusion is load-bearing here rather than defensive.
 */
export const liveFlowAnchor = (anchor: string): LiveTargetResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  return resolveWithin(article, `[data-flow-anchor="${CSS.escape(anchor)}"]`);
};

/** Resolves a decision id to its card in the live article, never a lens copy. */
export const liveDecisionFigure = (decisionId: string): LiveTargetResult => {
  const article = liveArticle();
  if (article === null) return { missing: "no-article" };
  return resolveWithin(article, `#${CSS.escape(decisionId)}[data-decision]`);
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
      })
    ) {
      misses.push("drifted-content");
      continue;
    }
    return { found: resolved.found, placement: candidate.placement };
  }
  return { missing: lensMissReason(misses) };
};

/**
 * The explicit opt-out for decoration and geometry callers, where a target
 * that is not on screen is a legitimate no-op rather than a state to render.
 * Every such caller reads as one, so the ones that owe the reader an
 * explanation stay greppable.
 */
export const foundElement = (result: LiveTargetResult): HTMLElement | null =>
  "found" in result ? result.found : null;
