// Owns the authored byte spans of one plan source: the smallest whole MDX
// units a decision about a change can be applied to without re-authoring the
// file.
//
// A reviewer's decision is made over the rendered document, but a decision that
// puts content back has to land on bytes. Splicing arbitrary byte ranges out of
// MDX produces a source that no longer parses - half a component, an opened tag
// with no close - so the unit is never a range: it is one authored node, taken
// whole, with the bytes that separate it from its neighbours left alone. Two
// sources segmented this way can be recombined node for node, and every
// recombination is still a document.
//
// Containers recurse because a deck puts a whole slide behind one node. Without
// the recursion the smallest replaceable unit inside a slide would be the slide
// itself, and putting one paragraph back would take every other paragraph in
// that slide with it.

import type { Root as MarkdownRoot, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** How deep container recursion goes before a nested node is taken whole. */
const MAX_SEGMENT_DEPTH = 6;

/**
 * One authored node, addressed by the bytes it occupies in its own source.
 *
 * `children` is empty for every node taken whole. When it is not, the segment
 * is a container: the bytes before its first child and after its last child are
 * its own - the opening tag, its attributes, the close - and are compared as
 * one unit, so an attribute change is a change to the container rather than to
 * nothing at all.
 */
export type PlanSourceSegment = {
  readonly start: number;
  readonly end: number;
  /** The mdast node type, or `jsx:<Name>` for an authored component. */
  readonly kind: string;
  readonly children: ReadonlyArray<PlanSourceSegment>;
};

const planParser = () =>
  unified().use(remarkParse).use(remarkGfm).use(remarkMdx);

const kindOf = (node: RootContent): string =>
  node.type === "mdxJsxFlowElement"
    ? `jsx:${node.name ?? ""}`
    : (node.type as string);

// A node the parser gave no offsets to cannot be addressed in bytes at all, and
// a child that reaches outside its parent would let one splice overwrite
// another. Both are dropped rather than trusted: the caller's own check that a
// recombined source still renders is what catches the loss.
const spanOf = (
  node: RootContent,
): { readonly start: number; readonly end: number } | undefined => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined || end <= start
    ? undefined
    : { start, end };
};

const segmentsOf = ({
  nodes,
  depth,
  bounds,
}: {
  readonly nodes: ReadonlyArray<RootContent>;
  readonly depth: number;
  readonly bounds: { readonly start: number; readonly end: number };
}): ReadonlyArray<PlanSourceSegment> => {
  const segments: Array<PlanSourceSegment> = [];
  let cursor = bounds.start;
  for (const node of nodes) {
    const span = spanOf(node);
    if (span === undefined || span.start < cursor || span.end > bounds.end) {
      continue;
    }
    cursor = span.end;
    const children =
      depth < MAX_SEGMENT_DEPTH && node.type === "mdxJsxFlowElement"
        ? segmentsOf({
            nodes: node.children,
            depth: depth + 1,
            bounds: span,
          })
        : [];
    segments.push({ ...span, kind: kindOf(node), children });
  }
  return segments;
};

/**
 * The authored segments of one plan source, in document order.
 *
 * The source is parsed with the plan parser and nothing else: this answers
 * where the authored bytes are, not whether they compile. Callers that need
 * that answer already have it, because the source they hold is a stored plan
 * revision the renderer accepted.
 */
export const planSourceSegments = (
  markdown: string,
): ReadonlyArray<PlanSourceSegment> => {
  const parsed: MarkdownRoot = planParser().parse(markdown);
  return segmentsOf({
    nodes: parsed.children,
    depth: 0,
    bounds: { start: 0, end: markdown.length },
  });
};
