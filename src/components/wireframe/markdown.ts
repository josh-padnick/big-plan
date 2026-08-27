// Renders Wireframe as a recursive semantic UI outline: every screen, group,
// label, value, state, status, and navigation target remains plain text.

import {
  markdownHeading,
  markdownInlineCode,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledWireframe, WireframeNode } from "./model.js";

// Authored labels, values, and hints are ordinary prose in the outline, so
// they carry the same escaping the outline's tables already apply.
const text = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : markdownInlineText(value);

const navigation = (screen: string | undefined): string | undefined =>
  screen === undefined
    ? undefined
    : `navigates to screen ${markdownInlineText(screen)}`;

const suffix = (values: ReadonlyArray<string | undefined>): string => {
  const present = values.filter(
    (value): value is string => value !== undefined && value !== "",
  );
  return present.length === 0 ? "" : ` (${present.join("; ")})`;
};

const nested = (
  label: string,
  children: ReadonlyArray<WireframeNode>,
  depth: number,
): ReadonlyArray<string> => [
  `${"  ".repeat(depth)}- ${label}`,
  ...nodeLines(children, depth + 1),
];

const controlValue = ({
  value,
  placeholder,
}: {
  readonly value?: string;
  readonly placeholder?: string;
}): string | undefined =>
  value === undefined
    ? placeholder === undefined
      ? undefined
      : `placeholder: ${text(placeholder)}`
    : `value: ${text(value)}`;

/** Recursively turns validated UI nodes into one correctly nested outline. */
const nodeLines = (
  nodes: ReadonlyArray<WireframeNode>,
  depth: number,
): ReadonlyArray<string> =>
  nodes.flatMap((node): ReadonlyArray<string> => {
    const prefix = `${"  ".repeat(depth)}- `;
    switch (node.element) {
      case "Stack":
        return nested(
          `Stack${suffix([`gap: ${node.gap}`, `align: ${node.align}`])}`,
          node.children,
          depth,
        );
      case "Row":
        return nested(
          `Row${suffix([`gap: ${node.gap}`, `align: ${node.align}`, `justify: ${node.justify}`])}`,
          node.children,
          depth,
        );
      case "Group":
        return nested(
          `Group${suffix([`gap: ${node.gap}`, `align: ${node.align}`])}`,
          node.children,
          depth,
        );
      case "Panel":
        return nested(
          `Panel${suffix([text(node.eyebrow), text(node.title), `surface: ${node.surface}`, node.status === undefined ? undefined : `status: ${text(node.status)}`])}`,
          node.children,
          depth,
        );
      case "SegmentedControl":
      case "AppShell":
      case "AppContent":
      case "BottomBar":
      case "List":
      case "ChoiceGroup":
      case "Stepper":
      case "Rail":
      case "Breadcrumbs":
        return nested(node.element, node.children, depth);
      case "Overlay":
        return nested(
          `Overlay${suffix([node.title === undefined ? undefined : `title: ${text(node.title)}`, `kind: ${node.kind}`, `backdrop: ${node.backdrop}`])}`,
          node.children,
          depth,
        );
      case "Sidebar":
        return nested(
          `Sidebar${suffix([node.brand === undefined ? undefined : `brand: ${text(node.brand)}`, node.mode === undefined ? undefined : `mode: ${node.mode}`])}`,
          node.children,
          depth,
        );
      case "TopBar":
        return nested(
          `Top bar${suffix([text(node.title)])}`,
          node.children,
          depth,
        );
      case "PageHeader":
        return nested(
          `Page header: ${text(node.title)}${suffix([text(node.description), node.badge === undefined ? undefined : `badge: ${text(node.badge)}`])}`,
          node.children,
          depth,
        );
      case "Nav":
        return nested(
          `Navigation${suffix([text(node.label)])}`,
          node.children,
          depth,
        );
      case "Center":
        return nested(
          `Centered content${suffix([`measure: ${node.measure}`])}`,
          node.children,
          depth,
        );
      case "Heading":
        return [`${prefix}Heading level ${node.level}: ${text(node.text)}`];
      case "Text":
        return [`${prefix}${node.role} text: ${text(node.text)}`];
      case "Button":
        return [
          `${prefix}Button: ${text(node.label)}${suffix([`emphasis: ${node.emphasis}`, navigation(node.navigateTo)])}`,
        ];
      case "NavItem":
        return [
          `${prefix}Navigation item: ${text(node.label)}${suffix([node.active ? "active" : "inactive", navigation(node.navigateTo)])}`,
        ];
      case "Metric":
        return [
          `${prefix}Metric: ${text(node.label)} = ${text(node.value)}${suffix([text(node.note)])}`,
        ];
      case "Progress":
        return [
          `${prefix}Progress${node.label === undefined ? "" : `: ${text(node.label)}`} — ${node.valueLabel === undefined ? `${node.value}%` : text(node.valueLabel)}${suffix([text(node.detail)])}`,
        ];
      case "Badge":
        return [`${prefix}Badge: ${text(node.label)} (tone: ${node.tone})`];
      case "Reference":
        return [
          `${prefix}Reference: ${markdownInlineCode(node.text)}${suffix([node.icon === undefined ? undefined : `icon: ${text(node.icon)}`, node.copyLabel === undefined ? undefined : `copy action: ${text(node.copyLabel)}`])}`,
        ];
      case "Icon":
        return [
          `${prefix}Icon: ${text(node.label)}${suffix([`name: ${text(node.name)}`, `size: ${node.size}`, node.labelled ? "label shown" : "label accessible only"])}`,
        ];
      case "Divider":
        return [
          `${prefix}Divider${node.label === undefined ? "" : `: ${text(node.label)}`}`,
        ];
      case "ImagePlaceholder":
        return [
          `${prefix}Image placeholder: ${text(node.label)} (shape: ${node.shape})`,
        ];
      case "ChoiceCard":
        return [
          `${prefix}Choice: ${text(node.title)} — ${text(node.description)}${suffix([node.emoji === undefined ? undefined : `emoji: ${text(node.emoji)}`, node.selected ? "selected" : "not selected", navigation(node.navigateTo)])}`,
        ];
      case "ListItem":
        return [
          `${prefix}List item: ${text(node.label)}${suffix([text(node.meta), text(node.value), node.status === undefined ? undefined : `status: ${text(node.status)}`, node.selected ? "selected" : undefined, navigation(node.navigateTo)])}`,
        ];
      case "Message":
        return [
          `${prefix}${node.kind} message from ${text(node.author)} at ${text(node.time)}: ${text(node.text)}`,
        ];
      case "TextField":
        return [
          `${prefix}${node.kind} field: ${text(node.label)}${suffix([controlValue(node), text(node.hint), node.disabled ? "disabled" : "enabled"])}`,
        ];
      case "TextArea":
        return [
          `${prefix}Text area: ${text(node.label)}${suffix([controlValue(node), text(node.hint), node.disabled ? "disabled" : "enabled"])}`,
        ];
      case "Select":
        return [
          `${prefix}Select: ${text(node.label)}${suffix([`value: ${text(node.value)}`, text(node.hint), node.disabled ? "disabled" : "enabled"])}`,
        ];
      case "Checkbox":
        return [
          `${prefix}Checkbox: ${text(node.label)}${suffix([node.checked ? "checked" : "unchecked", text(node.hint)])}`,
        ];
      case "Switch":
        return [
          `${prefix}Switch: ${text(node.label)}${suffix([node.on ? "on" : "off", text(node.hint)])}`,
        ];
      case "Step":
        return [`${prefix}Step: ${text(node.label)} (state: ${node.state})`];
      case "Connector":
        return [
          `${prefix}Connector: ${node.direction}${node.label === undefined ? "" : ` — ${text(node.label)}`}`,
        ];
      case "Crumb":
        return [
          `${prefix}Breadcrumb: ${text(node.label)}${suffix([navigation(node.navigateTo)])}`,
        ];
      case "Table": {
        const headers = [
          ...(node.selected === undefined ? [] : ["Selected"]),
          ...node.headers.map((header) => markdownInlineText(header)),
        ];
        const rows = node.rows.map((row, index) => [
          ...(node.selected === undefined
            ? []
            : [node.selected === index + 1 ? "Yes" : "No"]),
          ...row.map((cell) =>
            markdownInlineText(
              cell.tone === undefined
                ? cell.text
                : `${cell.text} (${cell.tone})`,
            ),
          ),
        ]);
        return [
          `${prefix}Table:`,
          ...markdownTable({ headers, rows })
            .split("\n")
            .map((line) => `${"  ".repeat(depth + 1)}${line}`),
        ];
      }
    }
  });

export const wireframeMarkdown: ComponentMarkdownRenderer<CompiledWireframe> = (
  model,
  { headingOffset },
) =>
  [
    markdownHeading({
      level: 3,
      offset: headingOffset,
      text: `Wireframe${model.title === undefined ? "" : `: ${markdownInlineText(model.title)}`}`,
    }),
    ...model.screens.map((screen) =>
      [
        markdownHeading({
          level: 4,
          offset: headingOffset,
          text: `Screen: ${markdownInlineText(screen.name)}${screen.id === model.initialScreenId ? " — Initial" : ""}`,
        }),
        `- Device: ${screen.device}`,
        ...(screen.url === undefined
          ? []
          : [`- URL: ${markdownInlineText(screen.url)}`]),
        ...(screen.pattern === undefined
          ? []
          : [`- Pattern: ${markdownInlineText(screen.pattern)}`]),
        "- UI outline:",
        ...nodeLines(screen.children, 1),
      ].join("\n"),
    ),
  ].join("\n\n");
