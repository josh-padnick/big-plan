// Applies the deck reading paradigm to a compiled review document: numbers
// Part dividers in document order and wraps each top-level h2 section in a
// slide frame with a numbered kicker. It runs after component delivery, so
// the markers it consumes are the data attributes the Part view emits.

import type { Element, ElementContent, Root, RootContent } from "hast";

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
// never joins the last slide.
const isFootnotesSection = (node: RootContent): boolean =>
  isElement(node) &&
  node.tagName === "section" &&
  Array.isArray(node.properties.className) &&
  node.properties.className.includes("footnotes");

// Tailwind utilities remain private styling implementation; the data
// attributes are the stable behavior-bearing interfaces used by tests.
const SLIDE_CLASSES = [
  "plan-slide",
  "mb-6",
  "rounded-xl",
  "border",
  "border-edge",
  "px-5",
  "py-5",
  "wide:px-[2.1rem]",
  "wide:py-[1.9rem]",
] as const;

const KICKER_CLASSES = [
  "plan-slide-kicker",
  "mb-[0.45rem]",
  "text-[0.6875rem]",
  "font-semibold",
  "uppercase",
  "tracking-[0.14em]",
  "text-accent",
] as const;

type NumberedPart = {
  readonly number: number;
  readonly title: string;
};

// Numbers every Part divider in document order, filling the view's empty
// [data-part-number] slot, recording the divider anchors for navigation, and
// mapping each divider so the top-level slide walk can group sections under
// it.
const numberParts = ({
  node,
  assigned,
  partIds,
}: {
  readonly node: Root | Element;
  readonly assigned: Map<Element, NumberedPart>;
  readonly partIds?: Array<string>;
}): void => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    if (child.properties["data-part"] !== undefined) {
      const title = child.properties["data-part-title"];
      const part: NumberedPart = {
        number: assigned.size + 1,
        title: typeof title === "string" ? title : "",
      };
      assigned.set(child, part);
      fillPartNumber(child, part.number);
      const id = child.properties.id;
      partIds?.push(typeof id === "string" ? id : "");
    }
    numberParts({ node: child, assigned, partIds });
  }
};

const fillPartNumber = (divider: Element, number: number): void => {
  for (const child of divider.children) {
    if (
      isElement(child) &&
      child.properties["data-part-number"] !== undefined
    ) {
      child.children = [{ type: "text", value: `Part ${number}` }];
      return;
    }
  }
};

type SlideSection = {
  readonly id: string | undefined;
  readonly label: string;
  readonly part: NumberedPart | undefined;
};

// Wraps each top-level h2 plus its following siblings - up to the next h2,
// Part divider, Glance, or footnotes appendix - in a slide frame headed by a
// numbered kicker. Returns the slide sections in document order so the
// Glance completion can link to them.
const wrapSlides = (
  tree: Root,
  parts: Map<Element, NumberedPart>,
): ReadonlyArray<SlideSection> => {
  const sections: Array<SlideSection> = [];
  const rewritten: Array<RootContent> = [];
  let currentPart: NumberedPart | undefined;
  let indexInPart = 0;
  let index = 0;
  while (index < tree.children.length) {
    const child = tree.children[index];
    if (child === undefined) {
      index += 1;
      continue;
    }
    if (isElement(child) && parts.has(child)) {
      currentPart = parts.get(child);
      indexInPart = 0;
      rewritten.push(child);
      index += 1;
      continue;
    }
    if (!isElement(child) || child.tagName !== "h2") {
      rewritten.push(child);
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
        (isElement(sibling) && parts.has(sibling)) ||
        hasProperty(sibling, "data-glance") ||
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
    const kicker: Element = {
      type: "element",
      tagName: "p",
      properties: {
        "data-slide-kicker": "",
        className: [...KICKER_CLASSES],
      },
      children: [{ type: "text", value: `${label} / ${title}` }],
    };
    const id = child.properties.id;
    sections.push({
      id: typeof id === "string" ? id : undefined,
      label,
      part: currentPart,
    });
    const slide: Element = {
      type: "element",
      tagName: "section",
      properties: {
        "data-slide": "",
        className: [...SLIDE_CLASSES],
      },
      children: [kicker, ...body],
    };
    rewritten.push(slide);
    index = end;
  }
  tree.children = rewritten;
  return sections;
};

/** Creates the rehype transform that applies the deck reading paradigm. */
export const rehypeDeckTransform =
  ({ partIds }: { readonly partIds?: Array<string> } = {}) =>
  (tree: Root) => {
    const parts = new Map<Element, NumberedPart>();
    numberParts({ node: tree, assigned: parts, partIds });
    wrapSlides(tree, parts);
  };
