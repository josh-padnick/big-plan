// Validates Callout's static attribute schema and renders its semantic HAST
// panel while preserving already-converted Markdown children unchanged.

import type { Element } from "hast";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import type { IconNode } from "../../../icons/lucide-icon.js";
import {
  validateBlockAttributes,
  type BlockAttributeSchema,
  type BlockRenderer,
} from "../registry.js";
import {
  INFO_ICON,
  LIGHTBULB_ICON,
  OCTAGON_ALERT_ICON,
  TRIANGLE_ALERT_ICON,
} from "./callout-icons.js";

type CalloutConfig = {
  readonly defaultTitle: string;
  readonly icon: IconNode;
  readonly iconName: string;
};

const CALLOUT_CONFIGS = {
  note: {
    defaultTitle: "Note",
    icon: INFO_ICON,
    iconName: "info",
  },
  tip: {
    defaultTitle: "Tip",
    icon: LIGHTBULB_ICON,
    iconName: "lightbulb",
  },
  warning: {
    defaultTitle: "Warning",
    icon: TRIANGLE_ALERT_ICON,
    iconName: "triangle-alert",
  },
  danger: {
    defaultTitle: "Danger",
    icon: OCTAGON_ALERT_ICON,
    iconName: "octagon-alert",
  },
} satisfies Readonly<Record<string, CalloutConfig>>;

type CalloutType = keyof typeof CALLOUT_CONFIGS;

function objectKeys<const Value extends object>(
  value: Value,
): ReadonlyArray<Extract<keyof Value, string>>;
function objectKeys(value: object): ReadonlyArray<string> {
  return Object.keys(value);
}

const CALLOUT_TYPES = objectKeys(CALLOUT_CONFIGS);
const CALLOUT_SCHEMA = {
  type: { kind: "enum", values: CALLOUT_TYPES, required: true },
  title: { kind: "string" },
} satisfies BlockAttributeSchema;

const configForType = (value: CalloutType): CalloutConfig | undefined =>
  Object.hasOwn(CALLOUT_CONFIGS, value) ? CALLOUT_CONFIGS[value] : undefined;

const CALLOUT_CLASSES =
  // Border colors come from the stylesheet's [data-callout] rules; a
  // border-edge utility here would win the cascade and flatten the accent.
  "callout mb-5 rounded-md border border-l-4 px-4 py-3";
const HEADER_CLASSES =
  "callout-header mb-2 flex items-center gap-2 font-semibold [&_svg]:size-4 [&_svg]:shrink-0";
const TITLE_CLASSES = "callout-title text-sm leading-5";
const BODY_CLASSES = "callout-body text-ink";

/** Validates and renders one Callout typed block. */
export const renderCallout: BlockRenderer = ({
  attributes,
  children,
  position,
  diagnostics,
}): Element => {
  const validated = validateBlockAttributes({
    block: "Callout",
    attributes,
    position,
    diagnostics,
    schema: CALLOUT_SCHEMA,
  });
  const type = validated.type ?? "note";
  const config = configForType(type);
  if (config === undefined) {
    throw new Error(`Callout ${type} configuration is missing`);
  }
  const title = validated.title ?? config.defaultTitle;

  return {
    type: "element",
    tagName: "aside",
    properties: {
      "data-callout": type,
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
