// Renders DatabaseTableSchema's caption: the table identity with its muted
// schema prefix, table note, transient feedback, and progressively enhanced
// columns, actions, and full-screen controls.

import type { Element, Text } from "hast";
import { CHECK_ICON } from "../../../icons/lucide/check.js";
import { COLUMNS_3_COG_ICON } from "../../../icons/lucide/columns-3-cog.js";
import { COPY_ICON } from "../../../icons/lucide/copy.js";
import { DATABASE_ICON } from "../../../icons/lucide/database.js";
import { ELLIPSIS_ICON } from "../../../icons/lucide/ellipsis.js";
import { MAXIMIZE_2_ICON } from "../../../icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../../icons/lucide/minimize-2.js";
import { ROTATE_CCW_ICON } from "../../../icons/lucide/rotate-ccw.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";
import { renderCopyFeedback } from "../shared/copy-feedback/copy-feedback.js";

const HEADER_CLASSES =
  "table-schema-header min-w-0 border-b border-edge px-[0.55rem] py-[0.3rem]";
const HEADER_ROW_CLASSES =
  "table-schema-header-row flex min-w-0 items-center justify-between gap-3";
const IDENTITY_CLASSES =
  "table-schema-identity flex min-w-0 items-center gap-[0.45rem] [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted";
// A transparent resting state keeps the overflow control quieter than the
// schema it acts on; hover and focus still reveal the full affordance.
const BUTTON_CLASSES =
  "table-schema-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const MENU_LIST_CLASSES =
  "table-schema-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-[0.375rem] border border-edge p-1";
const MENU_ITEM_CLASSES =
  "table-schema-menu-item flex w-full cursor-pointer items-center gap-[0.45rem] whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left text-xs text-ink [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";

const text = (value: string): Text => ({ type: "text", value });

// The explicit label keeps the accessible name the full qualified table name,
// independent of the styled schema/table split below.
const tableIdentity = ({
  tableName,
  schemaName,
}: {
  readonly tableName: string;
  readonly schemaName?: string;
}): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: IDENTITY_CLASSES.split(" "),
    ariaLabel: `${schemaName ?? ""}${tableName}`,
  },
  children: [
    renderLucideIcon({ icon: DATABASE_ICON, hidden: false }),
    {
      type: "element",
      tagName: "span",
      properties: {
        className: ["table-schema-name", "min-w-0", "truncate"],
      },
      children: [
        ...(schemaName === undefined
          ? []
          : [
              {
                type: "element" as const,
                tagName: "span",
                properties: {
                  className: ["table-schema-name-schema", "text-muted"],
                },
                children: [text(schemaName)],
              },
            ]),
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["table-schema-name-table", "font-semibold", "text-ink"],
          },
          children: [text(tableName)],
        },
      ],
    },
  ],
});

const menuItemButton = ({
  action,
  label,
  icon = COPY_ICON,
}: {
  readonly action: "copy-name" | "copy-source" | "reset-columns";
  readonly label: string;
  readonly icon?: LucideIcon;
}): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: MENU_ITEM_CLASSES.split(" "),
    role: "menuitem",
    tabIndex: -1,
    [`data-schema-${action}`]: "",
  },
  children: [renderLucideIcon({ icon, hidden: false }), text(label)],
});

// Actions remain unavailable without JavaScript, while the complete grid and
// every section stay readable in the server-rendered figure.
const actionsMenu = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: ["table-schema-menu", "relative", "inline-flex"],
    "data-schema-menu": "",
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
        "data-schema-menu-button": "",
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
        ariaLabel: "Table schema actions",
        hidden: true,
        "data-schema-menu-list": "",
      },
      children: [
        menuItemButton({ action: "copy-name", label: "Copy table name" }),
        menuItemButton({ action: "copy-source", label: "Copy source" }),
        menuItemButton({
          action: "reset-columns",
          label: "Reset column layout",
          icon: ROTATE_CCW_ICON,
        }),
      ],
    },
  ],
});

// The toggleable grid columns: the name column stays out because hiding the
// row identity would make every remaining cell unreadable.
const TOGGLEABLE_COLUMNS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
}> = [
  { key: "type", label: "Type" },
  { key: "constraints", label: "Constraints" },
  { key: "default", label: "Default" },
  { key: "comment", label: "Comment" },
];

// Checkbox items ship checked server-side; the script owns the live state and
// keeps the menu open across toggles so several columns flip in one visit.
const columnsMenu = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: ["table-schema-menu", "relative", "inline-flex"],
    "data-schema-menu": "",
  },
  children: [
    {
      type: "element",
      tagName: "button",
      properties: {
        type: "button",
        className: BUTTON_CLASSES.split(" "),
        ariaLabel: "Choose columns",
        ariaHasPopup: "menu",
        ariaExpanded: "false",
        title: "Choose columns",
        hidden: true,
        "data-schema-columns-button": "",
        "data-size": "xs",
        "data-slot": "button",
        "data-variant": "ghost",
      },
      children: [renderLucideIcon({ icon: COLUMNS_3_COG_ICON, hidden: false })],
    },
    {
      type: "element",
      tagName: "div",
      properties: {
        className: MENU_LIST_CLASSES.split(" "),
        role: "menu",
        ariaLabel: "Visible columns",
        hidden: true,
        "data-schema-columns-list": "",
      },
      children: TOGGLEABLE_COLUMNS.map(({ key, label }) => ({
        type: "element" as const,
        tagName: "button",
        properties: {
          type: "button",
          className: MENU_ITEM_CLASSES.split(" "),
          role: "menuitemcheckbox",
          ariaChecked: "true",
          tabIndex: -1,
          "data-schema-column-toggle": key,
        },
        children: [
          renderLucideIcon({ icon: CHECK_ICON, hidden: false }),
          text(label),
        ],
      })),
    },
  ],
});

// Progressive full-screen control; both icons ship server-side so the
// browser script only toggles visibility.
const expandButton = (): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: BUTTON_CLASSES.split(" "),
    ariaLabel: "View table schema full screen",
    title: "View table schema full screen",
    hidden: true,
    "data-schema-expand": "",
    "data-size": "xs",
    "data-slot": "button",
    "data-variant": "ghost",
  },
  children: [
    renderLucideIcon({ icon: MAXIMIZE_2_ICON, hidden: false }),
    renderLucideIcon({ icon: MINIMIZE_2_ICON, hidden: true }),
  ],
});

/** Renders the caption: identity and controls, plus the table note beneath
 * them in the same band so the header stays one bordered region. */
export const renderTableSchemaHeader = ({
  tableName,
  schemaName,
  note,
}: {
  readonly tableName: string;
  readonly schemaName?: string;
  readonly note?: string;
}): Element => ({
  type: "element",
  tagName: "figcaption",
  properties: { className: HEADER_CLASSES.split(" ") },
  children: [
    {
      type: "element",
      tagName: "span",
      properties: { className: HEADER_ROW_CLASSES.split(" ") },
      children: [
        tableIdentity({
          tableName,
          ...(schemaName === undefined ? {} : { schemaName }),
        }),
        {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "table-schema-controls",
              "flex",
              "shrink-0",
              "items-center",
              "gap-1",
            ],
          },
          children: [
            renderCopyFeedback({ dataAttribute: "data-schema-copy-message" }),
            columnsMenu(),
            actionsMenu(),
            expandButton(),
          ],
        },
      ],
    },
    ...(note === undefined
      ? []
      : [
          {
            type: "element" as const,
            tagName: "span",
            properties: {
              className: [
                "table-schema-note",
                "block",
                "pb-[0.15rem]",
                "text-xs",
                "text-muted",
              ],
              "data-schema-table-note": "",
            },
            children: [text(note)],
          },
        ]),
  ],
});
