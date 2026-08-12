// Applies the deck reading paradigm to a compiled review document: wraps
// each top-level h2 section in a slide frame with a numbered kicker
// (splitting a section with h3 headings into a parent header block over
// numbered sub-slides) and restyles a slide's leading emphasized paragraph
// into its context-builder line. It runs after component delivery, reading
// the attribute-marked outline placeholders that delivery leaves for
// outline-aware components, and computes the document outline - parts and
// sections numbered in document order - that those components' views consume
// once the placeholders are presented. It knows no component's markup.
//
// Every collapsible level is built through deck-collapse.ts so the header /
// body split obeys one contract; this file decides only which chrome is
// header and which content is body, never the collapse shape itself.

import type { Element, ElementContent, Root, RootContent } from "hast";
import type {
  DocumentOutlinePart,
  DocumentOutlineSection,
} from "../../components/_model/document-outline/document-outline.js";
import type { DiagnosticCollector } from "../../components/_authoring/diagnostics.js";
import {
  isSlideTypeId,
  slideTypeFor,
  type SlideTypeDefinition,
} from "../../plan-vocabulary/slide-types/index.js";
import {
  OUTLINE_PART_TITLE_ATTRIBUTE,
  OUTLINE_PLACEHOLDER_ATTRIBUTE,
  OUTLINE_SLIDE_NAME_ATTRIBUTE,
  OUTLINE_SLIDE_TOC_ATTRIBUTE,
  OUTLINE_SLIDE_TYPE_ATTRIBUTE,
} from "./component-pipeline/outline-placeholder.js";
import {
  appendCollapseBody,
  COLLAPSE_NAME_ATTRIBUTE,
  createCollapsible,
} from "./deck-collapse.js";

const isElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

const hasProperty = (node: RootContent, name: string): node is Element =>
  isElement(node) && node.properties[name] !== undefined;

// After component delivery a document holds only elements, text, and
// comments; anything else cannot live inside a slide frame and acts as a
// slide boundary instead.
const isSlideContent = (node: RootContent): node is ElementContent =>
  node.type === "element" || node.type === "text" || node.type === "comment";

// Flattens rendered heading content to the plain text a kicker repeats.
const textOf = (node: Element): string => {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (isElement(child)) {
      text += textOf(child);
    }
  }
  return text;
};

// The GFM footnotes block is an appendix, not an authored section, so it
// never joins the last slide or a Part collapse group.
const isFootnotesSection = (node: RootContent): boolean =>
  isElement(node) &&
  node.tagName === "section" &&
  Array.isArray(node.properties.className) &&
  node.properties.className.includes("footnotes");

// Document-level outline placeholders that are not Parts (for example the
// TableOfContents) must stay outside Part collapse bodies.
const isNonPartOutlinePlaceholder = (node: RootContent): boolean =>
  isElement(node) &&
  node.properties[OUTLINE_PLACEHOLDER_ATTRIBUTE] !== undefined &&
  node.properties[OUTLINE_PART_TITLE_ATTRIBUTE] === undefined;

const isIgnorableBetweenMarkerAndHeading = (
  node: RootContent | ElementContent,
): boolean =>
  node.type === "comment" || (node.type === "text" && node.value.trim() === "");

// Tailwind utilities remain private styling implementation; the data
// attributes are the stable behavior-bearing interfaces used by tests.
//
// Padding and every vertical gap deliberately stay in deck.css behind custom
// properties so one number drives the frame padding and the toggle's escape
// into the gutter at once. Renderer-owned card surfaces live here.
// Separation is depth, not a line. A slide is lifted off the page by being
// lighter than it and casting the smallest shadow in the scale; a sub-slide
// drops back to page level inside its parent, so the nesting reads as one
// raised thing containing recessed parts rather than as boxes inside boxes.
// The same two steps invert on the dark page, where lighter still means nearer.
const CARD_CLASSES = ["plan-card", "box-border", "rounded-xl"] as const;
const RAISED_CLASSES = ["bg-raised", "shadow-raised"] as const;
const RECESSED_CLASSES = ["bg-paper", "inset-shadow-well"] as const;
const SLIDE_CLASSES = [
  "plan-slide",
  ...CARD_CLASSES,
  ...RAISED_CLASSES,
] as const;

const SCROLL_CLASSES = [
  "scroll-mt-32",
  "max-[55.999rem]:scroll-mt-[10.75rem]",
] as const;
const SLIDE_TITLE_CLASSES = [
  "plan-slide-title",
  "m-0",
  "border-b-0",
  "pb-0",
  // approved-metric: the slide title size, upright. The overview title matches
  // it by contract, so the two move together or not at all.
  "text-[1.6rem]",
  ...SCROLL_CLASSES,
] as const;

const KICKER_CLASSES = [
  "plan-slide-kicker",
  "mb-2",
  "text-2xs",
  "font-semibold",
  "uppercase",
  "tracking-caps",
  "text-subtle",
  ...SCROLL_CLASSES,
] as const;

// A section split into sub-slides is the same slide-level card as any other;
// it differs only in what its body holds (context builder plus nested
// sub-slide cards), so it reuses the slide card and adds a marker class the
// stylesheet uses to space that nested list.
const SLIDE_GROUP_CLASSES = [
  "plan-slide",
  ...CARD_CLASSES,
  ...RAISED_CLASSES,
  "plan-slide-group",
] as const;

// A sub-slide's kicker is its heading: the h3 keeps its anchor and outline
// role while rendering as the numbered small-caps line.
const SUBSLIDE_KICKER_CLASSES = [
  "mt-0",
  "mb-0",
  "text-2xs",
  "font-semibold",
  "uppercase",
  "tracking-caps",
  "text-subtle",
  ...SCROLL_CLASSES,
] as const;

// The sub-slide card: one level tighter than a slide card (Contrast), and
// uniform among sub-slides because every one shares this constant.
const SUBSLIDE_FRAME_CLASSES = [
  "plan-slide",
  ...CARD_CLASSES,
  ...RECESSED_CLASSES,
  "plan-subslide-frame",
] as const;

// The context builder: one muted line telling the reader what they are
// looking at, restyled from the slide's leading emphasized paragraph.
// No top margin: --deck-gap-title-body is the sole owner of the distance to
// the title above, so the two cannot drift out of agreement.
// approved-metric: the context line's size. It sits directly under the slide
// title, so it reads as the slide's own lede and takes the same tone the
// document lede takes.
const CONTEXT_CLASSES = [
  "plan-slide-context",
  // approved-metric: the context line's size and its gap to the body
  "mb-[0.9rem]",
  "text-[0.9375rem]",
  "text-subtle",
] as const;

// A Part is a collapsible band rather than a card: no border or padding of
// its own, since the Part view already draws the band it wraps.
const PART_GROUP_CLASSES = ["plan-part-group"] as const;

/** The outline holder the transform fills in document order. */
export type MutableDocumentOutline = {
  readonly parts: Array<DocumentOutlinePart>;
  readonly sections: Array<DocumentOutlineSection>;
};

type AssignedSlideType = {
  readonly definition: SlideTypeDefinition;
  readonly name?: string;
  readonly toc?: string;
};

// Consumes every typed Slide placeholder before framing. A valid marker is a
// top-level sibling immediately before its h2 (blank text is ignorable); a
// top-level marker in any other position receives a positional structural
// diagnostic, and no marker ever emits HTML.
const collectSlideTypes = ({
  tree,
  diagnostics,
}: {
  readonly tree: Root;
  readonly diagnostics: DiagnosticCollector;
}): Map<Element, AssignedSlideType> => {
  const assigned = new Map<Element, AssignedSlideType>();

  const consume = (parent: Root | Element): void => {
    let index = 0;
    while (index < parent.children.length) {
      const child = parent.children[index];
      if (child === undefined || !isElement(child)) {
        index += 1;
        continue;
      }
      const authoredType = child.properties[OUTLINE_SLIDE_TYPE_ATTRIBUTE];
      if (authoredType === undefined) {
        consume(child);
        index += 1;
        continue;
      }
      let nextIndex = index + 1;
      while (nextIndex < parent.children.length) {
        const candidate = parent.children[nextIndex];
        if (
          candidate === undefined ||
          !isIgnorableBetweenMarkerAndHeading(candidate)
        ) {
          break;
        }
        nextIndex += 1;
      }
      const next = parent.children[nextIndex];
      // A marker below the document root is rejected by authoring validation,
      // which every command shares, so it is consumed here without a second
      // diagnostic.
      if (parent.type !== "root") {
        parent.children.splice(index, 1);
        continue;
      }
      if (next === undefined || !isElement(next) || next.tagName !== "h2") {
        diagnostics.add({
          message:
            "Slide must be a top-level self-closing marker immediately followed by the h2 it describes",
          position: child.position,
        });
      } else if (
        typeof authoredType === "string" &&
        isSlideTypeId(authoredType)
      ) {
        const authoredName = child.properties[OUTLINE_SLIDE_NAME_ATTRIBUTE];
        const authoredToc = child.properties[OUTLINE_SLIDE_TOC_ATTRIBUTE];
        assigned.set(next, {
          definition: slideTypeFor(authoredType),
          ...(typeof authoredName === "string" ? { name: authoredName } : {}),
          ...(typeof authoredToc === "string" ? { toc: authoredToc } : {}),
        });
      }
      parent.children.splice(index, 1);
    }
  };

  consume(tree);
  return assigned;
};

// Numbers every part placeholder in document order, reading the act title
// and anchor the placeholder attributes carry, and mapping each placeholder
// element so the top-level slide walk can group sections under it.
const collectParts = ({
  node,
  assigned,
}: {
  readonly node: Root | Element;
  readonly assigned: Map<Element, DocumentOutlinePart>;
}): void => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    if (child.properties[OUTLINE_PART_TITLE_ATTRIBUTE] !== undefined) {
      const title = child.properties[OUTLINE_PART_TITLE_ATTRIBUTE];
      const id = child.properties.id;
      assigned.set(child, {
        number: assigned.size + 1,
        title: typeof title === "string" ? title : "",
        ...(typeof id === "string" ? { id } : {}),
      });
    }
    collectParts({ node: child, assigned });
  }
};

// Restyles a slide's leading emphasized paragraph into the context builder:
// the muted line under the kicker (or heading) that tells the reader what
// they are looking at. The emphasis marks intent, so it unwraps; the line is
// muted, not italic.
const applyContextBuilder = (body: ReadonlyArray<ElementContent>): void => {
  const first = body.find(
    (node) => node.type !== "text" || node.value.trim() !== "",
  );
  if (first === undefined || !isElement(first) || first.tagName !== "p") {
    return;
  }
  const meaningful = first.children.filter(
    (node) => node.type !== "text" || node.value.trim() !== "",
  );
  const [only] = meaningful;
  if (
    meaningful.length !== 1 ||
    only === undefined ||
    !isElement(only) ||
    only.tagName !== "em"
  ) {
    return;
  }
  first.children = only.children;
  first.properties["data-slide-context"] = "";
  first.properties.className = [...CONTEXT_CLASSES];
};

// Splits a section body that contains h3 headings into one collapsible slide
// group: the parent header stays visible when collapsed, and each h3 run is
// its own nested collapsible sub-slide. Expanded layout keeps the original
// subpart + sub-slide structure without a flex title row.
const buildSubSlides = ({
  heading,
  body,
  label,
  kicker,
  slideType,
}: {
  readonly heading: Element;
  readonly body: ReadonlyArray<ElementContent>;
  readonly label: string;
  readonly kicker: Element;
  readonly slideType?: AssignedSlideType;
}): Element => {
  const firstH3 = body.findIndex(
    (node) => isElement(node) && node.tagName === "h3",
  );
  const intro = body.slice(0, firstH3);
  const collapseId =
    typeof heading.properties.id === "string" ? heading.properties.id : label;
  // A section split into sub-slides opens with a context builder just like
  // any other slide (Repetition); without this its leading emphasized line
  // stayed raw italic prose while every peer slide rendered a muted line.
  applyContextBuilder(intro);
  const groupBody: Array<ElementContent> = [...intro];
  let index = firstH3;
  let subIndex = 0;
  while (index < body.length) {
    const h3 = body[index];
    if (h3 === undefined || !isElement(h3) || h3.tagName !== "h3") {
      index += 1;
      continue;
    }
    const run: Array<ElementContent> = [];
    let end = index + 1;
    while (end < body.length) {
      const sibling = body[end];
      if (
        sibling === undefined ||
        (isElement(sibling) && sibling.tagName === "h3")
      ) {
        break;
      }
      run.push(sibling);
      end += 1;
    }
    subIndex += 1;
    const subLabel = `${label}.${subIndex}`;
    const subId =
      typeof h3.properties.id === "string" ? h3.properties.id : subLabel;
    // The kicker is a sub-slide's whole name, so it carries the name marker
    // that a slide puts on its separate title (deck-collapse invariant 4).
    const subKicker: Element = {
      type: "element",
      tagName: "h3",
      properties: {
        ...(typeof h3.properties.id === "string"
          ? { id: h3.properties.id }
          : {}),
        "data-slide-kicker": "",
        [COLLAPSE_NAME_ATTRIBUTE]: "",
        className: [...SUBSLIDE_KICKER_CLASSES],
      },
      children: [{ type: "text", value: `${subLabel} / ${textOf(h3)}` }],
    };
    applyContextBuilder(run);
    // Chrome is the kicker alone; the h3 run becomes the body.
    groupBody.push(
      createCollapsible({
        kind: "subslide",
        collapseId: subId,
        tagName: "section",
        properties: { "data-slide": "", "data-subslide": "" },
        className: SUBSLIDE_FRAME_CLASSES,
        chrome: [subKicker],
        body: run,
      }),
    );
    index = end;
  }
  // The group is a slide card whose body holds the context builder and the
  // nested sub-slide cards. Keeping them in the body - never in the header -
  // is what keeps a sub-slide click from toggling this group.
  return createCollapsible({
    kind: "slide",
    collapseId,
    tagName: "section",
    properties: {
      "data-slide": "",
      "data-subpart": "",
      ...(slideType === undefined
        ? {}
        : { "data-slide-type": slideType.definition.id }),
    },
    className: SLIDE_GROUP_CLASSES,
    chrome: [kicker, heading],
    body: groupBody,
  });
};

// Wraps each top-level h2 plus its following siblings - up to the next h2,
// outline placeholder (a Part divider or overview), or footnotes appendix -
// in a collapsible slide frame headed by a numbered kicker. Groups each Part
// divider with the slides that follow it so an act can collapse as a unit.
// Returns the slide sections in document order so the outline can carry them.
const wrapSlides = (
  tree: Root,
  parts: Map<Element, DocumentOutlinePart>,
  slideTypes: Map<Element, AssignedSlideType>,
): ReadonlyArray<DocumentOutlineSection> => {
  const sections: Array<DocumentOutlineSection> = [];
  const rewritten: Array<RootContent> = [];
  let currentPart: DocumentOutlinePart | undefined;
  let indexInPart = 0;
  let openPartGroup: Element | undefined;
  let openPartBody: Array<ElementContent> = [];

  const flushPartGroup = (): void => {
    if (openPartGroup === undefined) {
      return;
    }
    // The act's slides are known only now; append them as the body sibling.
    appendCollapseBody({ host: openPartGroup, children: openPartBody });
    rewritten.push(openPartGroup);
    openPartGroup = undefined;
    openPartBody = [];
  };

  const pushNode = (node: RootContent | ElementContent): void => {
    if (openPartGroup !== undefined) {
      openPartBody.push(node as ElementContent);
      return;
    }
    rewritten.push(node as RootContent);
  };

  // Global document boundaries leave the open act so collapsing a Part never
  // hides footnotes or overview placeholders that belong to the whole plan.
  const pushDocumentBoundary = (node: RootContent): void => {
    flushPartGroup();
    rewritten.push(node);
  };

  let index = 0;
  while (index < tree.children.length) {
    const child = tree.children[index];
    if (child === undefined) {
      index += 1;
      continue;
    }
    if (isFootnotesSection(child) || isNonPartOutlinePlaceholder(child)) {
      pushDocumentBoundary(child);
      index += 1;
      continue;
    }
    if (isElement(child) && parts.has(child)) {
      flushPartGroup();
      currentPart = parts.get(child);
      indexInPart = 0;
      const partId =
        typeof child.properties.id === "string"
          ? child.properties.id
          : `part-${currentPart?.number ?? indexInPart + 1}`;
      // Part placeholder is the header chrome; outline completion replaces it
      // in place. Body slides are appended on flush.
      openPartGroup = createCollapsible({
        kind: "part",
        collapseId: partId,
        tagName: "div",
        className: PART_GROUP_CLASSES,
        chrome: [child],
      });
      openPartBody = [];
      index += 1;
      continue;
    }
    if (!isElement(child) || child.tagName !== "h2") {
      pushNode(child);
      index += 1;
      continue;
    }
    const body: Array<ElementContent> = [child];
    let end = index + 1;
    while (end < tree.children.length) {
      const sibling = tree.children[end];
      if (
        sibling === undefined ||
        !isSlideContent(sibling) ||
        (isElement(sibling) && sibling.tagName === "h2") ||
        hasProperty(sibling, OUTLINE_PLACEHOLDER_ATTRIBUTE) ||
        isFootnotesSection(sibling)
      ) {
        break;
      }
      body.push(sibling);
      end += 1;
    }
    indexInPart += 1;
    const label =
      currentPart === undefined
        ? `${indexInPart}`
        : `${currentPart.number}.${indexInPart}`;
    const title = textOf(child);
    const slideType = slideTypes.get(child);
    const name = slideType?.name ?? slideType?.definition.name ?? title;
    const existingHeadingClasses = Array.isArray(child.properties.className)
      ? child.properties.className.map(String)
      : [];
    child.properties.className = [
      ...existingHeadingClasses,
      ...SLIDE_TITLE_CLASSES,
    ];
    // The h2 is the slide's name at both slide shapes below, so marking it
    // here covers a plain slide and a slide split into sub-slides.
    child.properties[COLLAPSE_NAME_ATTRIBUTE] = "";
    const kicker: Element = {
      type: "element",
      tagName: "p",
      properties: {
        "data-slide-kicker": "",
        className: [...KICKER_CLASSES],
      },
      children: [{ type: "text", value: `${label} / ${name}` }],
    };
    const id = child.properties.id;
    sections.push({
      number: label,
      name,
      title,
      id: typeof id === "string" ? id : label,
      ...(slideType?.toc === undefined ? {} : { toc: slideType.toc }),
      ...(slideType === undefined ? {} : { type: slideType.definition.id }),
      ...(currentPart === undefined ? {} : { part: currentPart }),
    });
    const sectionBody = body.slice(1);
    const hasSubSlides = sectionBody.some(
      (node) => isElement(node) && node.tagName === "h3",
    );
    if (hasSubSlides) {
      pushNode(
        buildSubSlides({
          heading: child,
          body: sectionBody,
          label,
          kicker,
          ...(slideType === undefined ? {} : { slideType }),
        }),
      );
      index = end;
      continue;
    }
    applyContextBuilder(sectionBody);
    const collapseId = typeof id === "string" ? id : label;
    // Kicker + h2 are the chrome; the section body is the collapse region.
    pushNode(
      createCollapsible({
        kind: "slide",
        collapseId,
        tagName: "section",
        properties: {
          "data-slide": "",
          ...(slideType === undefined
            ? {}
            : { "data-slide-type": slideType.definition.id }),
        },
        className: SLIDE_CLASSES,
        chrome: [kicker, child],
        body: sectionBody,
      }),
    );
    index = end;
  }
  flushPartGroup();
  tree.children = rewritten;
  return sections;
};

/** Creates the rehype transform that applies the deck reading paradigm. */
export const rehypeDeckTransform =
  ({
    outline,
    diagnostics,
  }: {
    readonly outline?: MutableDocumentOutline;
    readonly diagnostics: DiagnosticCollector;
  }) =>
  (tree: Root) => {
    const slideTypes = collectSlideTypes({ tree, diagnostics });
    const parts = new Map<Element, DocumentOutlinePart>();
    collectParts({ node: tree, assigned: parts });
    const sections = wrapSlides(tree, parts, slideTypes);
    outline?.parts.push(...parts.values());
    outline?.sections.push(...sections);
  };
