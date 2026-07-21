// Renders the uppercase tinted pill shared by the protocol review cards:
// method, status, operation-kind, streaming-kind, and deprecation badges
// behind one { label, classNames, properties } interface. Modules in shared/
// are never authorable from MDX; they are presentation building blocks the
// registered component directories beside shared/ compose.

import type { Element, Text } from "hast";

const PILL_CLASSES =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] leading-4 font-bold uppercase";

const text = (value: string): Text => ({ type: "text", value });

/** Renders one uppercase pill carrying the caller's palette classes. */
export const renderBadgePill = ({
  label,
  classNames = [],
  properties = {},
}: {
  readonly label: string;
  readonly classNames?: ReadonlyArray<string>;
  readonly properties?: Readonly<Record<string, string>>;
}): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [...PILL_CLASSES.split(" "), ...classNames],
    ...properties,
  },
  children: [text(label)],
});
