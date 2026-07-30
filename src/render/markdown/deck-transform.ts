// Applies the deck reading paradigm to a compiled review document: wraps
// each top-level h2 section in a slide frame with a numbered kicker
// (splitting a section with h3 headings into a parent header block over
// numbered sub-slides) and restyles a slide's leading emphasized paragraph
// into its context-builder line. It runs after component delivery, reading
// the attribute-marked outline placeholders that delivery leaves for
// outline-aware components, and computes the document outline - parts and
// sections numbered in document order - that those components' views consume
// once the placeholders are presented. It knows no component's markup.
// Collapse chrome (toggle + header) and body wrappers let the viewer script
// tuck away parts, slides, and sub-slides without removing content from HTML.

import type { Element, ElementContent, Root, RootContent } from "hast";
import type {
  DocumentOutlinePart,
  DocumentOutlineSection,
} from "../../components/_model/document-outline/document-outline.js";
import {
  OUTLINE_PART_TITLE_ATTRIBUTE,
  OUTLINE_PLACEHOLDER_ATTRIBUTE,
} from "./component-pipeline/outline-placeholder.js";

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
const SUBSLIDE_KICKER_CLASSES = [
  "mt-0",
  "min-w-0",
  "flex-1",
  ...KICKER_CLASSES,
] as const;

// The context builder: one muted line telling the reader what they are
// looking at, restyled from the slide's leading emphasized paragraph.
const CONTEXT_CLASSES = [
  "plan-slide-context",
  "-mt-[0.2rem]",
  "mb-[0.9rem]",
  "text-[0.9375rem]",
  "text-muted",
] as const;

// Collapse chrome sits beside the kicker or part band; the button itself is
// styled in deck.css so a CSS chevron can rotate with aria-expanded.
const TOGGLE_CLASSES = [
  "plan-collapse-toggle",
  "mt-0.5",
  "inline-flex",
  "size-6",
  "shrink-0",
  "cursor-pointer",
  "items-center",
  "justify-center",
  "rounded-md",
  "border-0",
  "bg-transparent",
  "p-0",
  "text-muted",
  "hover:bg-surface",
  "hover:text-ink",
  "focus-visible:outline-2",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-accent",
] as const;

const CHROME_CLASSES = [
  "plan-collapse-chrome",
  "flex",
  "items-start",
  "gap-2",
] as const;

const CHROME_HEADING_CLASSES = ["min-w-0", "flex-1"] as const;

/** The outline holder the transform fills in document order. */
export type MutableDocumentOutline = {
  readonly parts: Array<DocumentOutlinePart>;
  readonly sections: Array<DocumentOutlineSection>;
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

// Builds the inert collapse control; the viewer script wires behavior and
// keeps content fully readable when scripts are disabled.
const createCollapseToggle = (): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    "data-collapse-toggle": "",
    "aria-expanded": "true",
    "aria-label": "Collapse",
    className: [...TOGGLE_CLASSES],
  },
  children: [],
});

// Groups the toggle with the visible header so a collapsed block still shows
// its kicker and title while the body is tucked away.
const createCollapseChrome = (
  headingChildren: ReadonlyArray<ElementContent>,
): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    "data-collapse-chrome": "",
    className: [...CHROME_CLASSES],
  },
  children: [
    createCollapseToggle(),
    {
      type: "element",
      tagName: "div",
      properties: {
        className: [...CHROME_HEADING_CLASSES],
      },
      children: [...headingChildren],
    },
  ],
});

const createCollapseBody = (
  children: ReadonlyArray<ElementContent>,
): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    "data-collapse-body": "",
  },
  children: [...children],
});

// Splits a section body that contains h3 headings into one collapsible slide
// group: the parent header stays visible when collapsed, and each h3 run is
// its own nested collapsible sub-slide.
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
}): Element => {
  const firstH3 = body.findIndex(
    (node) => isElement(node) && node.tagName === "h3",
  );
  const intro = body.slice(0, firstH3);
  const collapseId =
    typeof heading.properties.id === "string" ? heading.properties.id : label;
  const chrome: Element = {
    type: "element",
    tagName: "div",
    properties: {
      "data-subpart": "",
      "data-collapse-chrome": "",
      className: [...SUBPART_CLASSES, ...CHROME_CLASSES],
    },
    children: [
      createCollapseToggle(),
      {
        type: "element",
        tagName: "div",
        properties: {
          className: [...CHROME_HEADING_CLASSES],
        },
        children: [kicker, heading],
      },
    ],
  };
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
    groupBody.push({
      type: "element",
      tagName: "section",
      properties: {
        "data-slide": "",
        "data-subslide": "",
        "data-collapsible": "subslide",
        "data-collapse-id": subId,
        className: [...SLIDE_CLASSES],
      },
      children: [
        {
          type: "element",
          tagName: "div",
          properties: {
            "data-collapse-chrome": "",
            className: [...CHROME_CLASSES],
          },
          children: [createCollapseToggle(), subKicker],
        },
        createCollapseBody(run),
      ],
    });
    index = end;
  }
  return {
    type: "element",
    tagName: "div",
    properties: {
      "data-collapsible": "slide",
      "data-collapse-id": collapseId,
      className: ["plan-slide-group"],
    },
    children: [chrome, createCollapseBody(groupBody)],
  };
};

// Wraps each top-level h2 plus its following siblings - up to the next h2,
// outline placeholder (a Part divider or overview), or footnotes appendix -
// in a collapsible slide frame headed by a numbered kicker. Groups each Part
// divider with the slides that follow it so an act can collapse as a unit.
// Returns the slide sections in document order so the outline can carry them.
const wrapSlides = (
  tree: Root,
  parts: Map<Element, DocumentOutlinePart>,
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
    const [partChrome] = openPartGroup.children;
    if (partChrome === undefined) {
      openPartGroup = undefined;
      openPartBody = [];
      return;
    }
    openPartGroup.children = [partChrome, createCollapseBody(openPartBody)];
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

  let index = 0;
  while (index < tree.children.length) {
    const child = tree.children[index];
    if (child === undefined) {
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
      openPartGroup = {
        type: "element",
        tagName: "div",
        properties: {
          "data-collapsible": "part",
          "data-collapse-id": partId,
          className: ["plan-part-group"],
        },
        children: [child],
      };
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
      number: label,
      title,
      ...(typeof id === "string" ? { id } : {}),
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
        }),
      );
      index = end;
      continue;
    }
    applyContextBuilder(sectionBody);
    const collapseId = typeof id === "string" ? id : label;
    const slide: Element = {
      type: "element",
      tagName: "section",
      properties: {
        "data-slide": "",
        "data-collapsible": "slide",
        "data-collapse-id": collapseId,
        className: [...SLIDE_CLASSES],
      },
      children: [
        createCollapseChrome([kicker, child]),
        createCollapseBody(sectionBody),
      ],
    };
    pushNode(slide);
    index = end;
  }
  flushPartGroup();
  tree.children = rewritten;
  return sections;
};

/** Creates the rehype transform that applies the deck reading paradigm. */
export const rehypeDeckTransform =
  ({ outline }: { readonly outline?: MutableDocumentOutline } = {}) =>
  (tree: Root) => {
    const parts = new Map<Element, DocumentOutlinePart>();
    collectParts({ node: tree, assigned: parts });
    const sections = wrapSlides(tree, parts);
    outline?.parts.push(...parts.values());
    outline?.sections.push(...sections);
  };
