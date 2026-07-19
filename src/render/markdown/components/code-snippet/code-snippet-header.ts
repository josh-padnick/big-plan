// Renders CodeSnippet's caption: the file identity (or a plain snippet label
// when no file is associated), the transient copy-feedback slot, and the
// progressively enhanced actions menu with copy-path and copy-code controls.

import type { Element, Text } from "hast";
import { COPY_ICON } from "../../../icons/lucide/copy.js";
import { ELLIPSIS_ICON } from "../../../icons/lucide/ellipsis.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import { renderFileIdentity } from "../shared/file-identity.js";

const HEADER_CLASSES =
  "code-snippet-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.55rem] py-[0.3rem]";
const BUTTON_CLASSES =
  "code-snippet-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const MENU_LIST_CLASSES =
  "code-snippet-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-[0.375rem] border border-edge p-1";
const MENU_ITEM_CLASSES =
  "code-snippet-menu-item flex w-full cursor-pointer items-center gap-[0.45rem] whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left text-xs text-ink [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";

const text = (value: string): Text => ({ type: "text", value });

const snippetLabel = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: ["code-snippet-label", "text-xs", "font-semibold", "text-muted"],
  },
  children: [text("Code snippet")],
});

const menuItemButton = ({
  action,
  label,
}: {
  readonly action: "copy-path" | "copy-code";
  readonly label: string;
}): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: MENU_ITEM_CLASSES.split(" "),
    role: "menuitem",
    tabIndex: -1,
    [`data-snippet-${action}`]: "",
  },
  children: [renderLucideIcon({ icon: COPY_ICON, hidden: false }), text(label)],
});

// Actions remain unavailable without JavaScript, while the complete code and
// every annotation stay readable in the server-rendered figure.
const actionsMenu = ({
  filePath,
}: {
  readonly filePath?: string;
}): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: ["code-snippet-menu", "relative", "inline-flex"],
    "data-snippet-menu": "",
  },
  children: [
    {
      type: "element",
      tagName: "button",
      properties: {
        type: "button",
        className: BUTTON_CLASSES.split(" "),
        ariaLabel: "More actions",
        ariaHasPopup: "menu",
        ariaExpanded: "false",
        title: "More actions",
        hidden: true,
        "data-snippet-menu-button": "",
        "data-size": "xs",
        "data-slot": "button",
        "data-variant": "ghost",
      },
      children: [renderLucideIcon({ icon: ELLIPSIS_ICON, hidden: false })],
    },
    {
      type: "element",
      tagName: "div",
      properties: {
        className: MENU_LIST_CLASSES.split(" "),
        role: "menu",
        ariaLabel: "Code snippet actions",
        hidden: true,
        "data-snippet-menu-list": "",
      },
      children: [
        ...(filePath === undefined
          ? []
          : [menuItemButton({ action: "copy-path", label: "Copy path" })]),
        menuItemButton({ action: "copy-code", label: "Copy code" }),
      ],
    },
  ],
});

/** Renders the complete CodeSnippet caption and its progressive controls. */
export const renderCodeSnippetHeader = ({
  filePath,
}: {
  readonly filePath?: string;
}): Element => ({
  type: "element",
  tagName: "figcaption",
  properties: { className: HEADER_CLASSES.split(" ") },
  children: [
    filePath === undefined ? snippetLabel() : renderFileIdentity({ filePath }),
    {
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "code-snippet-controls",
          "flex",
          "shrink-0",
          "items-center",
          "gap-1",
        ],
      },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["code-copy-message", "static", "h-6"],
            ariaHidden: "true",
            "data-snippet-copy-message": "",
            hidden: true,
          },
          children: [text("Copied!")],
        },
        actionsMenu({ ...(filePath === undefined ? {} : { filePath }) }),
      ],
    },
  ],
});
