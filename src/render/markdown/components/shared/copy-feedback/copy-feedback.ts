// Renders the transient inline copy-feedback slot shared by figure-component
// headers. Typography is pinned here so the message reads the same in every
// figure instead of inheriting whichever body font scale the figure sets;
// only the font family follows the surrounding header chrome.

import type { Element } from "hast";

// The trailing margin keeps the message clear of the actions button beside
// it, on top of the header controls' own tight gap.
const COPY_FEEDBACK_CLASSES =
  "code-copy-message static mr-1.5 flex h-6 items-center text-[0.6875rem] leading-tight font-medium whitespace-nowrap text-muted";

/** Renders one hidden feedback slot keyed by its component data attribute. */
export const renderCopyFeedback = ({
  dataAttribute,
}: {
  readonly dataAttribute: string;
}): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: COPY_FEEDBACK_CLASSES.split(" "),
    ariaHidden: "true",
    [dataAttribute]: "",
    hidden: true,
  },
  children: [{ type: "text", value: "Copied!" }],
});
