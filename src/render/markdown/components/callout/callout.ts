// Validates Callout's static attribute schema and renders its semantic HAST
// panel while preserving already-converted Markdown children unchanged.

import type { Element } from "hast";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";
import {
  type ComponentDefinition,
  type ComponentRenderer,
} from "../../../../model/component-contract.js";
import {
  compileCalloutComponent,
  type CalloutType,
} from "../../../../model/compile-callout.js";
import { renderCalloutStatic } from "../../../../react/callout/callout.js";
import { INFO_ICON } from "../../../icons/lucide/info.js";
import { LIGHTBULB_ICON } from "../../../icons/lucide/lightbulb.js";
import { OCTAGON_ALERT_ICON } from "../../../icons/lucide/octagon-alert.js";
import { TRIANGLE_ALERT_ICON } from "../../../icons/lucide/triangle-alert.js";

type CalloutConfig = {
  readonly defaultTitle: string;
  readonly icon: LucideIcon;
};

const CALLOUT_CONFIGS = {
  note: {
    defaultTitle: "Note",
    icon: INFO_ICON,
  },
  tip: {
    defaultTitle: "Tip",
    icon: LIGHTBULB_ICON,
  },
  warning: {
    defaultTitle: "Warning",
    icon: TRIANGLE_ALERT_ICON,
  },
  danger: {
    defaultTitle: "Danger",
    icon: OCTAGON_ALERT_ICON,
  },
} satisfies Readonly<Record<CalloutType, CalloutConfig>>;

const CALLOUT_CLASSES =
  // Border colors come from the stylesheet's [data-callout] rules; a
  // border-edge utility here would win the cascade and flatten the accent.
  "callout mb-5 rounded-md border border-l-4 px-4 py-3";
const HEADER_CLASSES =
  "callout-header mb-2 flex items-center gap-2 font-semibold [&_svg]:size-4 [&_svg]:shrink-0";
const TITLE_CLASSES = "callout-title text-sm leading-5";
const BODY_CLASSES = "callout-body text-ink";

// Validates and renders one Callout behind its feature-owned definition.
const renderCallout: ComponentRenderer = (input): Element => {
  const model = compileCalloutComponent(input);
  const config = CALLOUT_CONFIGS[model.type];
  const title = model.title ?? config.defaultTitle;
  const children = model.body;

  return {
    type: "element",
    tagName: "aside",
    properties: {
      "data-callout": model.type,
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

/** Declares Callout's complete component integration contract. */
export const CALLOUT_COMPONENT_DEFINITION = {
  render: renderCallout,
  compile: compileCalloutComponent,
  renderStatic: (input) => renderCalloutStatic(compileCalloutComponent(input)),
} satisfies ComponentDefinition;
