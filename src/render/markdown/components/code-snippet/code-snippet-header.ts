// Renders CodeSnippet's caption: the file identity (or a plain snippet label
// when no file is associated), the transient copy-feedback slot, and the
// progressively enhanced actions menu with copy-path and copy-code controls.

import type { Element, Text } from "hast";
import { COPY_ICON } from "../../../icons/lucide/copy.js";
import { ELLIPSIS_ICON } from "../../../icons/lucide/ellipsis.js";
import { FILE_ICON } from "../../../icons/lucide/file.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";

const HEADER_CLASSES =
  "code-snippet-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.55rem] py-[0.3rem]";
const BUTTON_CLASSES =
  "code-snippet-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const MENU_LIST_CLASSES =
  "code-snippet-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-[0.375rem] border border-edge p-1";
const MENU_ITEM_CLASSES =
  "code-snippet-menu-item flex w-full cursor-pointer items-center gap-[0.45rem] whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left text-xs text-ink [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";
const FILE_CLASSES =
  "code-snippet-file flex min-w-0 items-center gap-[0.45rem] [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted";

const text = (value: string): Text => ({ type: "text", value });

// The stable file caption: an icon, a muted directory, an emphasized name, and
// an accessible name pinned to the exact path independent of the visual split.
const fileIdentity = (filePath: string): Element => {
  const lastSlashIndex = filePath.lastIndexOf("/");
  const fileDir =
    lastSlashIndex === -1 ? "" : filePath.slice(0, lastSlashIndex + 1);
  const fileName =
    lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: FILE_CLASSES.split(" "),
      ariaLabel: filePath,
    },
    children: [
      renderLucideIcon({ icon: FILE_ICON, hidden: false }),
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["code-snippet-file-path", "min-w-0", "truncate"],
        },
        children: [
          ...(fileDir === ""
            ? []
            : [
                {
                  type: "element" as const,
                  tagName: "span",
                  properties: {
                    className: ["code-snippet-file-dir", "text-muted"],
                  },
                  children: [text(fileDir)],
                },
              ]),
          {
            type: "element",
            tagName: "span",
            properties: {
              className: [
                "code-snippet-file-name",
                "font-semibold",
                "text-ink",
              ],
            },
            children: [text(fileName)],
          },
        ],
      },
    ],
  };
};

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
    filePath === undefined ? snippetLabel() : fileIdentity(filePath),
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
