// Renders the labeled card-section grammar shared by the protocol review
// cards: the uppercase section label, the top-bordered section wrapper, and
// the stacked definition entry pairing one identity row with its markdown
// body. Modules in shared/ are never authorable from MDX; they are
// presentation building blocks the registered component directories beside
// shared/ compose.

import type { Element, ElementContent, Text } from "hast";

const SECTION_LABEL_CLASSES =
  "text-[0.6875rem] leading-4 font-bold tracking-[0.08em] uppercase text-muted";

const text = (value: string): Text => ({ type: "text", value });

/** Renders the uppercase muted label naming one card section. */
export const renderSectionLabel = (label: string): Element => ({
  type: "element",
  tagName: "div",
  properties: { className: SECTION_LABEL_CLASSES.split(" ") },
  children: [text(label)],
});

/** Renders one top-bordered card section holding a labeled region. */
export const renderCardSection = ({
  children,
  properties = {},
}: {
  readonly children: ReadonlyArray<ElementContent>;
  readonly properties?: Readonly<Record<string, string>>;
}): Element => ({
  type: "element",
  tagName: "section",
  properties: {
    className: ["border-t", "border-edge", "px-4", "py-4"],
    ...properties,
  },
  children: [...children],
});

// One definition entry: the dt row carries the identity spans, the dd the
// markdown body, and the div wrapper is valid dl grouping content that lets
// the border sit around the pair.
export const renderDefinitionEntry = ({
  term,
  body,
  properties = {},
}: {
  readonly term: ReadonlyArray<ElementContent>;
  readonly body: ReadonlyArray<ElementContent>;
  readonly properties?: Readonly<Record<string, string>>;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["border-b", "border-edge", "py-3", "last:border-b-0"],
    ...properties,
  },
  children: [
    {
      type: "element",
      tagName: "dt",
      properties: {
        className: ["flex", "flex-wrap", "items-baseline", "gap-2"],
      },
      children: [...term],
    },
    {
      type: "element",
      tagName: "dd",
      properties: {
        className: ["mt-1.5", "text-sm", "text-muted", "[&>:last-child]:mb-0"],
      },
      children: [...body],
    },
  ],
});

/** Renders the definition list wrapper for stacked entries. */
export const renderDefinitionList = ({
  entries,
}: {
  readonly entries: ReadonlyArray<ElementContent>;
}): Element => ({
  type: "element",
  tagName: "dl",
  properties: { className: ["mt-1"] },
  children: [...entries],
});
