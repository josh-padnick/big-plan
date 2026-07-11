// Validates Callout's static attribute schema and renders its semantic HAST
// panel while preserving already-converted Markdown children unchanged.

import type { Element } from "hast";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import type { IconNode } from "../../../icons/lucide-icon.js";
import type { BlockRenderer } from "../registry.js";
import {
  INFO_ICON,
  LIGHTBULB_ICON,
  OCTAGON_ALERT_ICON,
  TRIANGLE_ALERT_ICON,
} from "./callout-icons.js";

type CalloutType = "note" | "tip" | "warning" | "danger";

type CalloutConfig = {
  readonly type: CalloutType;
  readonly defaultTitle: string;
  readonly icon: IconNode;
  readonly iconName: string;
};

const ALLOWED_TYPES = "note, tip, warning, danger";

const configForType = (value: string | boolean | undefined): CalloutConfig | undefined => {
  switch (value) {
    case "note":
      return { type: "note", defaultTitle: "Note", icon: INFO_ICON, iconName: "info" };
    case "tip":
      return { type: "tip", defaultTitle: "Tip", icon: LIGHTBULB_ICON, iconName: "lightbulb" };
    case "warning":
      return {
        type: "warning",
        defaultTitle: "Warning",
        icon: TRIANGLE_ALERT_ICON,
        iconName: "triangle-alert",
      };
    case "danger":
      return {
        type: "danger",
        defaultTitle: "Danger",
        icon: OCTAGON_ALERT_ICON,
        iconName: "octagon-alert",
      };
    default:
      return undefined;
  }
};

const CALLOUT_CLASSES =
  "callout mb-5 rounded-md border border-edge border-l-4 px-4 py-3";
const HEADER_CLASSES =
  "callout-header mb-2 flex items-center gap-2 font-semibold";
const TITLE_CLASSES = "callout-title text-sm leading-5";
const BODY_CLASSES = "callout-body text-ink";

/** Validates and renders one Callout typed block. */
export const renderCallout: BlockRenderer = ({
  attributes,
  children,
  position,
  diagnostics,
}): Element => {
  const configured = configForType(attributes["type"]);
  if (configured === undefined) {
    diagnostics.add({
      message: attributes["type"] === undefined
        ? `Missing required attribute "type"; expected one of: ${ALLOWED_TYPES}`
        : `Invalid value for attribute "type"; expected one of: ${ALLOWED_TYPES}`,
      position,
    });
  }

  const titleValue = attributes["title"];
  if (titleValue !== undefined && typeof titleValue !== "string") {
    diagnostics.add({
      message: 'Attribute "title" must be a string',
      position,
    });
  }

  for (const name of Object.keys(attributes)) {
    if (name !== "type" && name !== "title") {
      diagnostics.add({
        message: `Unknown attribute "${name}" on Callout`,
        position,
      });
    }
  }

  const config = configured ?? configForType("note");
  if (config === undefined) {
    throw new Error("Callout note configuration is missing");
  }
  const title = typeof titleValue === "string" ? titleValue : config.defaultTitle;

  return {
    type: "element",
    tagName: "aside",
    properties: {
      "data-callout": config.type,
      className: CALLOUT_CLASSES.split(" "),
    },
    children: [
      {
        type: "element",
        tagName: "header",
        properties: { className: HEADER_CLASSES.split(" ") },
        children: [
          renderLucideIcon({
            icon: config.icon,
            name: config.iconName,
            hidden: false,
          }),
          {
            type: "element",
            tagName: "span",
            properties: { className: TITLE_CLASSES.split(" ") },
            children: [{ type: "text", value: title }],
          },
        ],
      },
      {
        type: "element",
        tagName: "div",
        properties: { className: BODY_CLASSES.split(" ") },
        children: [...children],
      },
    ],
  };
};
