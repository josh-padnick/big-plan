// Renders Wireframe as a recursive semantic UI outline: every screen, group,
// label, value, state, status, and navigation target remains plain text.

import {
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledWireframe, WireframeNode } from "./model.js";

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
      : `placeholder: ${placeholder}`
    : `value: ${value}`;

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
      case "Panel":
        return nested(
          `Panel${suffix([node.eyebrow, node.title, `surface: ${node.surface}`, node.status === undefined ? undefined : `status: ${node.status}`])}`,
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
      case "Sidebar":
        return nested(
          `Sidebar${suffix([node.brand === undefined ? undefined : `brand: ${node.brand}`, node.mode === undefined ? undefined : `mode: ${node.mode}`])}`,
          node.children,
          depth,
        );
      case "TopBar":
        return nested(`Top bar${suffix([node.title])}`, node.children, depth);
      case "PageHeader":
        return nested(
          `Page header: ${node.title}${suffix([node.description, node.badge === undefined ? undefined : `badge: ${node.badge}`])}`,
          node.children,
          depth,
        );
      case "Nav":
        return nested(
          `Navigation${suffix([node.label])}`,
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
        return [`${prefix}Heading level ${node.level}: ${node.text}`];
      case "Text":
        return [`${prefix}${node.role} text: ${node.text}`];
      case "Button":
        return [
          `${prefix}Button: ${node.label}${suffix([`emphasis: ${node.emphasis}`, node.navigateTo === undefined ? undefined : `navigates to screen ${node.navigateTo}`])}`,
        ];
      case "NavItem":
        return [
          `${prefix}Navigation item: ${node.label}${suffix([node.active ? "active" : "inactive", node.navigateTo === undefined ? undefined : `navigates to screen ${node.navigateTo}`])}`,
        ];
      case "Metric":
        return [
          `${prefix}Metric: ${node.label} = ${node.value}${suffix([node.note])}`,
        ];
      case "Progress":
        return [
          `${prefix}Progress${node.label === undefined ? "" : `: ${node.label}`} — ${node.valueLabel ?? `${node.value}%`}${suffix([node.detail])}`,
        ];
      case "Badge":
        return [`${prefix}Badge: ${node.label} (tone: ${node.tone})`];
      case "Divider":
        return [
          `${prefix}Divider${node.label === undefined ? "" : `: ${node.label}`}`,
        ];
      case "ImagePlaceholder":
        return [
          `${prefix}Image placeholder: ${node.label} (shape: ${node.shape})`,
        ];
      case "ChoiceCard":
        return [
          `${prefix}Choice: ${node.title} — ${node.description}${suffix([`icon: ${node.icon}`, node.selected ? "selected" : "not selected", node.navigateTo === undefined ? undefined : `navigates to screen ${node.navigateTo}`])}`,
        ];
      case "ListItem":
        return [
          `${prefix}List item: ${node.label}${suffix([node.meta, node.value, node.status === undefined ? undefined : `status: ${node.status}`, node.selected ? "selected" : undefined, node.navigateTo === undefined ? undefined : `navigates to screen ${node.navigateTo}`])}`,
        ];
      case "Message":
        return [
          `${prefix}${node.kind} message from ${node.author} at ${node.time}: ${node.text}`,
        ];
      case "TextField":
        return [
          `${prefix}${node.kind} field: ${node.label}${suffix([controlValue(node), node.hint, node.disabled ? "disabled" : "enabled"])}`,
        ];
      case "TextArea":
        return [
          `${prefix}Text area: ${node.label}${suffix([controlValue(node), node.hint, node.disabled ? "disabled" : "enabled"])}`,
        ];
      case "Select":
        return [
          `${prefix}Select: ${node.label}${suffix([`value: ${node.value}`, node.hint, node.disabled ? "disabled" : "enabled"])}`,
        ];
      case "Checkbox":
        return [
          `${prefix}Checkbox: ${node.label}${suffix([node.checked ? "checked" : "unchecked", node.hint])}`,
        ];
      case "Switch":
        return [
          `${prefix}Switch: ${node.label}${suffix([node.on ? "on" : "off", node.hint])}`,
        ];
      case "Step":
        return [`${prefix}Step: ${node.label} (state: ${node.state})`];
      case "Connector":
        return [
          `${prefix}Connector: ${node.direction}${node.label === undefined ? "" : ` — ${node.label}`}`,
        ];
      case "Crumb":
        return [
          `${prefix}Breadcrumb: ${node.label}${suffix([node.navigateTo === undefined ? undefined : `navigates to screen ${node.navigateTo}`])}`,
        ];
      case "Table": {
        const headers = [
          ...(node.selected === undefined ? [] : ["Selected"]),
          ...node.headers,
        ];
        const rows = node.rows.map((row, index) => [
          ...(node.selected === undefined
            ? []
            : [node.selected === index + 1 ? "Yes" : "No"]),
          ...row.map((cell) =>
            cell.tone === undefined ? cell.text : `${cell.text} (${cell.tone})`,
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
) =>
  [
    `### Wireframe${model.title === undefined ? "" : `: ${model.title}`}`,
    ...model.screens.map((screen) =>
      [
        `#### Screen: ${screen.name}${screen.id === model.initialScreenId ? " — Initial" : ""}`,
        `- Device: ${screen.device}`,
        ...(screen.url === undefined ? [] : [`- URL: ${screen.url}`]),
        ...(screen.pattern === undefined
          ? []
          : [`- Pattern: ${screen.pattern}`]),
        "- UI outline:",
        ...nodeLines(screen.children, 1),
      ].join("\n"),
    ),
  ].join("\n\n");
