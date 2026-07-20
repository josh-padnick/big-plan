// Owns the annotation card identity shared by every component that anchors
// reviewer notes to lines: one aside with the message-square comment glyph, a
// line-range badge, and a markdown body, all carrying the annotation tint.
// Components keep their own anchoring, placement, and disclosure behavior and
// pass their hook classes and data attributes through.

import type { Element, ElementContent, Properties, Text } from "hast";
import { MESSAGE_SQUARE_ICON } from "../../../../icons/lucide/message-square.js";
import { renderLucideIcon } from "../../../../icons/lucide-icon.js";

const CARD_CLASSES =
  "annotation-card flex min-w-0 gap-2 px-3 py-2 font-sans text-sm leading-normal whitespace-normal [&>svg]:size-4 [&>svg]:shrink-0";

const text = (value: string): Text => ({ type: "text", value });

export const renderAnnotationCard = ({
  label,
  children,
  className = [],
  properties = {},
}: {
  readonly label: string;
  readonly children: ReadonlyArray<ElementContent>;
  readonly className?: ReadonlyArray<string>;
  readonly properties?: Properties;
}): Element => ({
  type: "element",
  tagName: "aside",
  properties: {
    className: [...CARD_CLASSES.split(" "), ...className],
    role: "note",
    ariaLabel: label,
    ...properties,
  },
  children: [
    renderLucideIcon({ icon: MESSAGE_SQUARE_ICON, hidden: false }),
    {
      type: "element",
      tagName: "div",
      properties: { className: ["annotation-card-content", "min-w-0"] },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "annotation-card-badge",
              "mb-1",
              "inline-flex",
              "rounded-sm",
              "px-1.5",
              "py-0.5",
              "text-xs",
              "font-semibold",
            ],
          },
          children: [text(label)],
        },
        {
          type: "element",
          tagName: "div",
          properties: { className: ["annotation-card-body"] },
          children: [...children],
        },
      ],
    },
  ],
});
