// Maps reader selections and rendered blocks to comment targets, labels,
// and highlights. Identity lookup remains owned by live-target.browser.ts.

import type { CommentTarget } from "../shared/comment.js";
import { boundQuote } from "../shared/comment.js";
import type { CommentTargetSide } from "../shared/comment-target-side.js";
import {
  isCommentTargetSide,
  sideQualifiedControlLabel,
} from "../shared/comment-target-side.js";
import {
  foundElement,
  liveBlock,
  liveBaselineBlock,
} from "./live-target.browser.js";

export type SelectionControlState = {
  readonly target: Extract<CommentTarget, { readonly type: "selection" }>;
  readonly top: number;
  readonly left: number;
};

export type SelectionTarget = Extract<
  CommentTarget,
  { readonly type: "selection" }
>;

const blockIdentity = (block: HTMLElement) => ({
  blockId: block.dataset.blockId ?? block.dataset.baselineBlockId ?? "",
  kind: block.dataset.blockKind ?? block.dataset.baselineBlockKind ?? "block",
  label:
    block.dataset.blockLabel ??
    block.dataset.baselineBlockLabel ??
    "This block",
  ...((block.dataset.blockSection ?? block.dataset.baselineBlockSection) ===
  undefined
    ? {}
    : {
        section:
          block.dataset.blockSection ?? block.dataset.baselineBlockSection,
      }),
  ...(block.dataset.baselineSnapshot === undefined
    ? {}
    : { snapshot: block.dataset.baselineSnapshot }),
});

export const blockKind = (block: HTMLElement): string =>
  block.dataset.blockKind ?? block.dataset.baselineBlockKind ?? "";

export const blockAddressId = (block: HTMLElement): string =>
  block.dataset.blockId ?? block.dataset.baselineBlockId ?? "";

/**
 * Which side of a component diff an element sits on, if any. The proposed
 * component root is addressed on the diff card itself rather than inside the
 * proposed side's wrapper, so an element under a card but under no side
 * wrapper is still the proposed side.
 */
export const diffSideOfElement = (
  element: HTMLElement,
): CommentTargetSide | undefined => {
  const sideHost = element.closest<HTMLElement>("[data-component-diff-side]");
  const side = sideHost?.dataset.componentDiffSide;
  if (isCommentTargetSide(side)) return side;
  return element.closest("[data-component-diff]") === null
    ? undefined
    : "proposed";
};

/**
 * The side a composer is bound to at the moment it opens, so what it says it
 * addresses cannot drift when the diff it was aimed at closes underneath it. A
 * qualified baseline address proves the side on its own; otherwise only the
 * element the reviewer aimed at can say, and a target outside every diff has no
 * side to name.
 */
export const boundTargetSide = (
  target: CommentTarget,
  origin?: HTMLElement,
): CommentTargetSide | undefined => {
  if (target.type !== "document" && target.snapshot !== undefined) {
    return "baseline";
  }
  return origin === undefined ? undefined : diffSideOfElement(origin);
};

export const targetForBlock = (
  block: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> => ({
  type: "block",
  ...blockIdentity(block),
});

const targetForSlide = (
  slide: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> | null => {
  const firstBlock = slide.querySelector<HTMLElement>(
    "[data-block-id], [data-baseline-block-id]",
  );
  if (firstBlock === null) {
    return null;
  }
  return {
    type: "block",
    ...blockIdentity(firstBlock),
    kind: "slide",
    label:
      firstBlock.dataset.blockSection ??
      firstBlock.dataset.blockLabel ??
      "Slide",
  };
};

export const targetForReviewContainer = (
  container: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> | null =>
  container.matches("[data-quick-summary]")
    ? targetForBlock(container)
    : targetForSlide(container);

export const targetLabel = (
  target: CommentTarget,
  includeSlideReference = false,
): string => {
  let label: string;
  if (target.type === "document") label = "Whole plan";
  else if (target.type === "selection")
    label = `Selected text${
      target.imageBlockIds === undefined || target.imageBlockIds.length === 0
        ? ""
        : " and image"
    } in ${target.label}`;
  else if (target.kind === "table" || target.kind === "data-table")
    label = [target.section, "Table"].filter(Boolean).join(" · ");
  else label = target.label;

  if (!includeSlideReference || target.type === "document") return label;
  const directContainer = targetElement(target)?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  const reviewContainer =
    directContainer ??
    (target.section === undefined
      ? null
      : (Array.from(
          document.querySelectorAll<HTMLElement>("[data-slide]"),
        ).find((slide) => {
          const heading = slide
            .querySelector<HTMLElement>(
              ":scope > [data-collapse-header] h2, :scope > [data-collapse-header] h3",
            )
            ?.textContent?.trim();
          return heading === target.section;
        }) ?? null));
  if (reviewContainer?.matches("[data-quick-summary]") === true) {
    return "Quick summary";
  }
  const kicker = reviewContainer
    ?.querySelector<HTMLElement>("[data-slide-kicker]")
    ?.textContent?.trim();
  const slideReference = kicker?.match(/^(\d+(?:\.\d+)*)\s*\//u)?.[1];
  const slideTitle = reviewContainer
    ?.querySelector<HTMLElement>(
      ":scope > [data-collapse-header] h2, :scope > [data-collapse-header] h3",
    )
    ?.textContent?.trim();
  if (slideTitle === undefined || slideTitle === "") return label;
  const combinedSubSlideTitle =
    slideReference === undefined
      ? undefined
      : slideTitle.match(/^(\d+(?:\.\d+)*)\s*\/\s*(.+)$/u);
  const combinedReference = combinedSubSlideTitle?.[1];
  const combinedTitle = combinedSubSlideTitle?.[2];
  if (combinedReference === slideReference && combinedTitle !== undefined) {
    return `${slideReference} · ${combinedTitle}`;
  }
  return slideReference === undefined
    ? slideTitle
    : `${slideReference} · ${slideTitle}`;
};

const parentElementFor = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement;

const SELECTION_BLOCK_SELECTOR =
  '[data-block-id]:not([data-block-kind="part"]), [data-baseline-block-id]';

const selectionBoundaryBlock = ({
  container,
  offset,
  edge,
}: {
  readonly container: Node;
  readonly offset: number;
  readonly edge: "start" | "end";
}): HTMLElement | null => {
  const direct = parentElementFor(container)?.closest<HTMLElement>(
    SELECTION_BLOCK_SELECTOR,
  );
  if (direct !== null && direct !== undefined) return direct;
  if (!(container instanceof Element) || container.childNodes.length === 0) {
    return null;
  }
  const childIndex =
    edge === "start"
      ? Math.min(offset, container.childNodes.length - 1)
      : Math.max(0, Math.min(offset - 1, container.childNodes.length - 1));
  const child = container.childNodes[childIndex];
  if (child === undefined) return null;
  const childElement = parentElementFor(child);
  if (childElement?.matches(SELECTION_BLOCK_SELECTOR) === true) {
    return childElement as HTMLElement;
  }
  const descendants = Array.from(
    childElement?.querySelectorAll<HTMLElement>(SELECTION_BLOCK_SELECTOR) ?? [],
  );
  return edge === "start"
    ? (descendants[0] ?? null)
    : (descendants.at(-1) ?? null);
};

const selectionOffsetWithin = ({
  block,
  container,
  offset,
  edge,
}: {
  readonly block: HTMLElement;
  readonly container: Node;
  readonly offset: number;
  readonly edge: "start" | "end";
}): number => {
  if (block !== container && !block.contains(container)) {
    return edge === "start" ? 0 : (block.textContent?.length ?? 0);
  }
  const before = document.createRange();
  before.selectNodeContents(block);
  if (edge === "start") before.setEnd(container, offset);
  else before.setEnd(container, offset);
  return before.toString().length;
};

const authoredImagesIntersecting = (range: Range): ReadonlyArray<HTMLElement> =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-block-kind="image"][data-authored-prose]',
    ),
  ).filter((image) => {
    try {
      return range.intersectsNode(image);
    } catch {
      return false;
    }
  });

const selectionRect = (
  range: Range,
  images: ReadonlyArray<HTMLElement>,
): DOMRect => {
  const rects = [
    range.getBoundingClientRect(),
    ...images.map((image) => image.getBoundingClientRect()),
  ];
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
};

export const selectionControlState = (): SelectionControlState | null => {
  const selection = window.getSelection();
  if (
    selection === null ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed
  ) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startBlock = selectionBoundaryBlock({
    container: range.startContainer,
    offset: range.startOffset,
    edge: "start",
  });
  const endBlock = selectionBoundaryBlock({
    container: range.endContainer,
    offset: range.endOffset,
    edge: "end",
  });
  const startReviewContainer = startBlock?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  const endReviewContainer = endBlock?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  if (
    startBlock == null ||
    endBlock == null ||
    (startBlock !== endBlock &&
      (startReviewContainer == null ||
        startReviewContainer !== endReviewContainer)) ||
    startBlock.closest("#big-plan-review-root") !== null
  ) {
    return null;
  }
  const images = authoredImagesIntersecting(range);
  const text = selection.toString();
  const imageEvidence = images
    .map((image) => `[Image: ${blockIdentity(image).label}]`)
    .join("\n");
  const selected = [text, imageEvidence]
    .filter((part) => part.trim() !== "")
    .join("\n");
  if (selected.trim() === "") return null;
  // Length never withdraws the affordance. The block and offsets below are the
  // address of the highlight; the quote is only the copy carried into the
  // agent's brief, so an outsized selection keeps its whole range and stores a
  // marked excerpt instead of being dropped without telling the reviewer.
  const { quote, isQuoteExcerpt } = boundQuote(selected);
  const start = selectionOffsetWithin({
    block: startBlock,
    container: range.startContainer,
    offset: range.startOffset,
    edge: "start",
  });
  const end = selectionOffsetWithin({
    block: endBlock,
    container: range.endContainer,
    offset: range.endOffset,
    edge: "end",
  });
  const rect = selectionRect(range, images);
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    target: {
      type: "selection",
      ...blockIdentity(startBlock),
      ...(startBlock === endBlock
        ? {}
        : { endBlockId: blockAddressId(endBlock) }),
      ...(images.length === 0
        ? {}
        : {
            imageBlockIds: images.map(blockAddressId).filter((id) => id !== ""),
          }),
      start,
      end,
      quote,
      isQuoteExcerpt,
    },
    top: Math.max(8, rect.top - 44),
    left: Math.max(8, Math.min(window.innerWidth - 132, rect.left)),
  };
};

export const blockCommentLabel = (block: HTMLElement): string =>
  sideQualifiedControlLabel({
    label:
      blockKind(block) === "code" || blockKind(block).startsWith("code-")
        ? "Comment on this code snippet"
        : `Comment on ${blockIdentity(block).label}`,
    side: diffSideOfElement(block),
  });

/**
 * What the composer says it points at. A selection's label is the text it was
 * taken from, and the compact composer deliberately never repeats the words
 * the highlight is already showing, so a selection names itself and stops
 * there.
 */
export const composerTargetLabel = (target: CommentTarget): string =>
  target.type === "selection"
    ? `Selected text${
        target.imageBlockIds === undefined || target.imageBlockIds.length === 0
          ? ""
          : " and image"
      }`
    : targetLabel(target);

export const selectionCommentLabel = (target: SelectionTarget): string =>
  `Comment on selected text${
    target.imageBlockIds === undefined || target.imageBlockIds.length === 0
      ? ""
      : " and image"
  }`;

// Decoration, geometry, and containment callers treat an absent target as a
// no-op, so this keeps the nullable shape while the resolver owns the query.
// The callers that owe the reader an explanation when a target is gone say so
// themselves; jumpTo is the one that does.
export const targetElement = (target: CommentTarget): HTMLElement | null => {
  if (target.type === "document") return document.querySelector("main");
  const block = foundElement(
    target.snapshot === undefined
      ? liveBlock(target.blockId)
      : liveBaselineBlock(target.blockId, target.snapshot),
  );
  return target.type === "block" && target.kind === "slide"
    ? (block?.closest<HTMLElement>("[data-slide]") ?? block)
    : block;
};

export const liveTargetBlock = (
  blockId: string,
  snapshot: string | undefined,
): HTMLElement | null =>
  foundElement(
    snapshot === undefined
      ? liveBlock(blockId)
      : liveBaselineBlock(blockId, snapshot),
  );

export const targetAssociationElements = (
  target: CommentTarget,
): ReadonlySet<HTMLElement> => {
  const element = targetElement(target);
  if (element === null) return new Set();
  const isImageTarget = target.type === "block" && target.kind === "image";
  if (
    target.type === "block" &&
    !isImageTarget &&
    element.matches("[data-authored-prose]")
  ) {
    return new Set();
  }
  const owningContainer = element.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  const elements = new Set<HTMLElement>();
  if (
    target.type !== "selection" &&
    !(
      element.matches("[data-authored-prose]") &&
      owningContainer !== null &&
      !isImageTarget
    )
  ) {
    elements.add(element);
  }
  if (target.type === "selection") {
    for (const imageId of target.imageBlockIds ?? []) {
      const image = liveTargetBlock(imageId, target.snapshot);
      if (image !== null) elements.add(image);
    }
  }
  if (owningContainer !== null) elements.add(owningContainer);
  return elements;
};

export const targetAddress = (target: CommentTarget): string => {
  if (target.type === "document") return "document";
  if (target.type === "selection") {
    return `selection:${target.snapshot ?? "proposed"}:${target.blockId}:${target.start}:${target.endBlockId ?? target.blockId}:${target.end}`;
  }
  return `block:${target.snapshot ?? "proposed"}:${target.blockId}`;
};

type HighlightRegistry = {
  set(name: string, value: unknown): void;
  delete(name: string): void;
};

export const selectionRange = (
  target: Extract<CommentTarget, { readonly type: "selection" }>,
): Range | null => {
  const startBlock = targetElement(target);
  const endBlock =
    target.endBlockId === undefined
      ? startBlock
      : liveTargetBlock(target.endBlockId, target.snapshot);
  if (startBlock === null || endBlock === null) return null;
  const textPoint = (
    block: HTMLElement,
    targetOffset: number,
  ): { readonly node: Text; readonly offset: number } | null => {
    if (targetOffset < 0) return null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let node = walker.nextNode();
    while (node !== null) {
      if (!(node instanceof Text)) {
        node = walker.nextNode();
        continue;
      }
      const length = node.data.length;
      if (targetOffset <= consumed + length) {
        return { node, offset: Math.max(0, targetOffset - consumed) };
      }
      consumed += length;
      node = walker.nextNode();
    }
    return null;
  };
  const start = textPoint(startBlock, target.start);
  const end = textPoint(endBlock, target.end);
  if (start === null || end === null) return null;
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
};

export const selectionTargetResolves = (target: SelectionTarget): boolean => {
  const range = selectionRange(target);
  if (range === null) return false;
  const images: Array<HTMLElement> = [];
  for (const imageId of target.imageBlockIds ?? []) {
    const image = liveTargetBlock(imageId, target.snapshot);
    if (
      image === null ||
      blockKind(image) !== "image" ||
      !range.intersectsNode(image)
    ) {
      return false;
    }
    images.push(image);
  }
  const imageEvidence = images
    .map((image) => `[Image: ${blockIdentity(image).label}]`)
    .join("\n");
  const selected = [range.toString(), imageEvidence]
    .filter((part) => part.trim() !== "")
    .join("\n");
  return target.isQuoteExcerpt
    ? selected.startsWith(target.quote)
    : selected === target.quote;
};

export const targetHighlightRange = (target: CommentTarget): Range | null => {
  if (target.type === "selection") return selectionRange(target);
  if (target.type !== "block") return null;
  const element = targetElement(target);
  if (element === null || !element.matches("[data-authored-prose]")) {
    return null;
  }
  const range = document.createRange();
  if (target.kind === "image") {
    range.selectNode(element);
  } else {
    range.selectNodeContents(element);
  }
  return range;
};

export const setSelectionHighlights = (
  targets: ReadonlyArray<SelectionTarget>,
  activeTarget: CommentTarget | null,
): void => {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  registry?.delete("big-plan-review-selection");
  registry?.delete("big-plan-review-selection-active");
  const HighlightClass = (
    window as unknown as {
      Highlight?: new (...ranges: ReadonlyArray<Range>) => unknown;
    }
  ).Highlight;
  if (registry === undefined || HighlightClass === undefined) return;
  const ranges = targets
    .map((target) => selectionRange(target))
    .filter((range): range is Range => range !== null);
  if (ranges.length > 0)
    registry.set("big-plan-review-selection", new HighlightClass(...ranges));
  const activeRange =
    activeTarget === null ? null : targetHighlightRange(activeTarget);
  if (activeRange !== null)
    registry.set(
      "big-plan-review-selection-active",
      new HighlightClass(activeRange),
    );
};
