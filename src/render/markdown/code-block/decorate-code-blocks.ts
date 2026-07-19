// Owns the rendered markup contract shared by fenced Markdown code blocks and
// future code-snippet renderers, including copy controls and status feedback.

import type { Element, Root, RootContent } from "hast";
import { renderLucideIcon } from "../../icons/lucide-icon.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";

// This data contract is shared with the browser copy behavior so a future
// CodeSnippet component can opt in without depending on Markdown conversion.
export const CODE_BLOCK_SELECTOR = "data-code-block";

const COPY_BUTTON_CLASSES =
  "absolute top-2 right-2 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:bg-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_[data-lucide=check]]:text-accent";

// The overlaid controls need room; the trailing padding keeps long code lines
// from running beneath the copy button.
const WRAPPED_PRE_CLASSES = "m-0 pr-12";

const COPY_MESSAGE_CLASSES =
  "absolute top-2 right-10 flex h-6 items-center text-[0.6875rem] leading-tight font-medium whitespace-nowrap text-muted";

const isElement = (node: RootContent): node is Element =>
  node.type === "element";

// Adds framework-free shadcn Button markup to rendered code blocks. The
// source remains in the sibling <code> element so copy behavior can read the
// exact text after syntax highlighting has split it into token spans.
const decorateCodeBlocks = (node: Root | Element): void => {
  node.children = node.children.map((child) => {
    if (!isElement(child)) {
      return child;
    }
    decorateCodeBlocks(child);
    const hasCodeChild =
      child.tagName === "pre" &&
      child.children.some(
        (codeChild) => isElement(codeChild) && codeChild.tagName === "code",
      );
    if (!hasCodeChild) {
      return child;
    }
    const existingPreClasses = Array.isArray(child.properties.className)
      ? child.properties.className
      : [];
    const wrappedPre: Element = {
      ...child,
      properties: {
        ...child.properties,
        className: [...existingPreClasses, ...WRAPPED_PRE_CLASSES.split(" ")],
      },
    };
    const copyButton: Element = {
      type: "element",
      tagName: "button",
      properties: {
        type: "button",
        className: COPY_BUTTON_CLASSES.split(" "),
        ariaLabel: "Copy code",
        ariaLive: "polite",
        "data-copy-code": "",
        "data-size": "xs",
        "data-slot": "button",
        "data-variant": "ghost",
      },
      children: [
        renderLucideIcon({ icon: COPY_ICON, hidden: false }),
        renderLucideIcon({ icon: CHECK_ICON, hidden: true }),
      ],
    };
    const wrapper: Element = {
      type: "element",
      tagName: "div",
      properties: {
        className: ["relative", "mb-[1.25em]"],
        [CODE_BLOCK_SELECTOR]: "",
      },
      children: [
        wrappedPre,
        {
          type: "element",
          tagName: "span",
          properties: {
            className: COPY_MESSAGE_CLASSES.split(" "),
            ariaHidden: "true",
            "data-copy-message": "",
            hidden: true,
          },
          children: [{ type: "text", value: "Copied!" }],
        },
        copyButton,
      ],
    };
    return wrapper;
  });
};

/** Decorates every rendered code block with the shared interaction contract. */
export const rehypeDecorateCodeBlocks = () => (tree: Root) => {
  decorateCodeBlocks(tree);
};
