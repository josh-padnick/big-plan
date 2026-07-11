// Owns the rendered markup contract shared by fenced Markdown code blocks and
// future code-snippet renderers, including copy controls and status feedback.

import type { Element, Root, RootContent } from "hast";
import { renderLucideIcon } from "../../icons/lucide-icon.js";
import { CHECK_ICON, COPY_ICON } from "./code-block-icons.js";

// This data contract is shared with the browser copy behavior so a future
// CodeSnippet component can opt in without depending on Markdown conversion.
export const CODE_BLOCK_SELECTOR = "data-code-block";

const COPY_BUTTON_CLASSES =
  "code-copy-button inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
    const hasCodeChild = child.tagName === "pre" &&
      child.children.some(
        (codeChild) => isElement(codeChild) && codeChild.tagName === "code",
      );
    if (!hasCodeChild) {
      return child;
    }
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
        renderLucideIcon({ icon: COPY_ICON, name: "copy", hidden: false }),
        renderLucideIcon({ icon: CHECK_ICON, name: "check", hidden: true }),
      ],
    };
    const wrapper: Element = {
      type: "element",
      tagName: "div",
      properties: {
        className: ["code-block"],
        [CODE_BLOCK_SELECTOR]: "",
      },
      children: [
        child,
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["code-copy-message"],
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
