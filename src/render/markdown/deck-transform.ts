// Applies the deck reading paradigm to a compiled review document: numbers
// Part dividers in document order, wraps each top-level h2 section in a
// slide frame with a numbered kicker (splitting a section with h3 headings
// into a parent header block over numbered sub-slides), restyles a slide's
// leading emphasized paragraph into its context-builder line, and completes
// the Glance overview with section links, slide numbers, and part group
// headers. It runs after component delivery, so the markers it consumes are
// the data attributes the Part and Glance views emit.

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

// The parent header block a sectioned-into-sub-slides section keeps: its
// kicker and h2 stand above the numbered sub-slide frames.
const SUBPART_CLASSES = ["plan-subpart", "mt-12", "mb-4"] as const;

// A sub-slide's kicker is its heading: the h3 keeps its anchor and outline
// role while rendering as the numbered small-caps line.
const SUBSLIDE_KICKER_CLASSES = ["mt-0", ...KICKER_CLASSES] as const;

// The context builder: one muted line telling the reader what they are
// looking at, restyled from the slide's leading emphasized paragraph.
const CONTEXT_CLASSES = [
  "plan-slide-context",
  "-mt-[0.2rem]",
  "mb-[0.9rem]",
  "text-[0.9375rem]",
  "text-muted",
] as const;

const GLANCE_GROUP_CLASSES = [
  "glance-group",
  "mt-2.5",
  "mb-0.5",
  "text-xs",
  "font-semibold",
  "uppercase",
  "tracking-[0.1em]",
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

// Splits a section body that contains h3 headings into the parent header
// block plus one numbered sub-slide frame per h3 run, so a long section
// reads as its own small deck. The h3 becomes the sub-slide's kicker,
// keeping its anchor and outline role.
const buildSubSlides = ({
  heading,
  body,
  label,
  kicker,
}: {
  readonly heading: Element;
  readonly body: ReadonlyArray<ElementContent>;
  readonly label: string;
  readonly kicker: Element;
}): ReadonlyArray<ElementContent> => {
  const firstH3 = body.findIndex(
    (node) => isElement(node) && node.tagName === "h3",
  );
  const parent: Element = {
    type: "element",
    tagName: "div",
    properties: {
      "data-subpart": "",
      className: [...SUBPART_CLASSES],
    },
    children: [kicker, heading, ...body.slice(0, firstH3)],
  };
  const result: Array<ElementContent> = [parent];
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
    const subKicker: Element = {
      type: "element",
      tagName: "h3",
      properties: {
        ...(typeof h3.properties.id === "string"
          ? { id: h3.properties.id }
          : {}),
        "data-slide-kicker": "",
        className: [...SUBSLIDE_KICKER_CLASSES],
      },
      children: [{ type: "text", value: `${subLabel} / ${textOf(h3)}` }],
    };
    applyContextBuilder(run);
    result.push({
      type: "element",
      tagName: "section",
      properties: {
        "data-slide": "",
        "data-subslide": "",
        className: [...SLIDE_CLASSES],
      },
      children: [subKicker, ...run],
    });
    index = end;
  }
  return result;
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
    const sectionBody = body.slice(1);
    const hasSubSlides = sectionBody.some(
      (node) => isElement(node) && node.tagName === "h3",
    );
    if (hasSubSlides) {
      rewritten.push(
        ...buildSubSlides({
          heading: child,
          body: sectionBody,
          label,
          kicker,
        }),
      );
      index = end;
      continue;
    }
    applyContextBuilder(sectionBody);
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

const findGlance = (node: Root | Element): Element | undefined => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    if (child.properties["data-glance"] !== undefined) {
      return child;
    }
    const nested = findGlance(child);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
};

const fillGlanceNumber = (row: Element, label: string): void => {
  for (const child of row.children) {
    if (isElement(child) && child.properties["data-glance-num"] !== undefined) {
      child.children = [{ type: "text", value: label }];
      return;
    }
  }
};

// Completes the Glance the view rendered as placeholders: each row links to
// its slide's section and shows its slide number, and a part group header
// precedes the first row of every part. Rows map to slides by document
// order; the glance-matches-sections lint rule owns reporting mismatches, so
// a row without a slide keeps its placeholder instead of failing delivery.
const completeGlance = (
  tree: Root,
  sections: ReadonlyArray<SlideSection>,
): void => {
  const glance = findGlance(tree);
  if (glance === undefined) {
    return;
  }
  const rewritten: Array<ElementContent> = [];
  let rowIndex = 0;
  let headedPart: number | undefined;
  for (const child of glance.children) {
    if (
      !isElement(child) ||
      child.properties["data-glance-row"] === undefined
    ) {
      rewritten.push(child);
      continue;
    }
    const section = sections[rowIndex];
    rowIndex += 1;
    if (section === undefined) {
      rewritten.push(child);
      continue;
    }
    if (section.part !== undefined && section.part.number !== headedPart) {
      headedPart = section.part.number;
      rewritten.push({
        type: "element",
        tagName: "p",
        properties: {
          "data-glance-group": "",
          className: [...GLANCE_GROUP_CLASSES],
        },
        children: [
          {
            type: "text",
            value: `[${section.part.number}] ${section.part.title}`,
          },
        ],
      });
    }
    if (section.id !== undefined) {
      child.properties.href = `#${section.id}`;
    }
    fillGlanceNumber(child, section.label);
    rewritten.push(child);
  }
  glance.children = rewritten;
};

/** Creates the rehype transform that applies the deck reading paradigm. */
export const rehypeDeckTransform =
  ({ partIds }: { readonly partIds?: Array<string> } = {}) =>
  (tree: Root) => {
    const parts = new Map<Element, NumberedPart>();
    numberParts({ node: tree, assigned: parts, partIds });
    const sections = wrapSlides(tree, parts);
    completeGlance(tree, sections);
  };
