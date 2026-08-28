// Renders a compiled Wireframe as vocabulary-neutral reconstruction notes:
// screen geometry, hierarchy, grouping, state, copy, and navigation remain
// explicit without requiring a reader to know the authoring component names.

import {
  markdownHeading,
  markdownInlineCode,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import {
  WIREFRAME_DEVICE_PRESETS,
  type CompiledWireframe,
  type WireframeAlign,
  type WireframeDevice,
  type WireframeEmphasis,
  type WireframeMeasure,
  type WireframeNode,
  type WireframePattern,
  type WireframeScreen,
  type WireframeSpace,
  type WireframeStatus,
  type WireframeSurface,
  type WireframeTextRole,
  type WireframeTone,
} from "./model.js";
import { flattenNodes, holdsRecordCollection, ROW_PANES } from "./nodes.js";

const SPACING_WORDS = {
  none: "no added spacing",
  xs: "very tight spacing",
  sm: "tight spacing",
  md: "moderate spacing",
  lg: "generous spacing",
  xl: "very generous spacing",
} satisfies Readonly<Record<WireframeSpace, string>>;

const SURFACE_DESCRIPTIONS = {
  plain:
    "Unboxed content section grouped by its heading and surrounding whitespace",
  filled: "Softly tinted, padded content pane",
  outlined:
    "Bordered card with a paper background, generous inner padding, and a subtly hand-drawn double edge",
} satisfies Readonly<Record<WireframeSurface, string>>;

const EMPHASIS_DESCRIPTIONS = {
  primary: "Primary filled button",
  secondary: "Secondary outlined button",
  tertiary: "Low-emphasis text-like button",
  destructive: "Destructive warning-colored button",
} satisfies Readonly<Record<WireframeEmphasis, string>>;

const TEXT_ROLE_DESCRIPTIONS = {
  body: "Body copy",
  helper: "Smaller supporting text",
  muted: "Quiet secondary text",
  section: "Emphasized section label",
} satisfies Readonly<Record<WireframeTextRole, string>>;

const TONE_DESCRIPTIONS = {
  neutral: "neutral treatment",
  info: "informational treatment",
  success: "success treatment",
  warning: "warning treatment",
  danger: "danger treatment",
} satisfies Readonly<Record<WireframeTone, string>>;

const STATUS_DESCRIPTIONS = {
  done: "completed, with a distinct success mark",
  attention: "needs attention, with a prominent attention mark",
  waiting: "waiting, with a distinct waiting mark",
  blocked: "blocked, with a distinct danger mark",
} satisfies Readonly<Record<WireframeStatus, string>>;

const PATTERN_DESCRIPTIONS = {
  "list-detail":
    "A record collection and the selected record's detail stay visible side by side.",
  triage:
    "A queue-driven workspace makes status scanning quick while a larger detail area holds the active work.",
  create:
    "A focused creation flow groups data entry around one clear completion action.",
  settings:
    "Related settings are grouped into labelled sections with their controls close beside them.",
} satisfies Readonly<Record<WireframePattern, string>>;

const safeText = (value: string): string => markdownInlineText(value);

const navigation = (screen: string | undefined): string | undefined =>
  screen === undefined ? undefined : `opens screen ${safeText(screen)}`;

const details = (values: ReadonlyArray<string | undefined>): string => {
  const present = values.filter(
    (value): value is string => value !== undefined && value !== "",
  );
  return present.length === 0 ? "" : ` (${present.join("; ")})`;
};

const horizontalAlignment = (alignment: WireframeAlign): string => {
  switch (alignment) {
    case "start":
      return "their upper edges aligned";
    case "center":
      return "their vertical centers aligned";
    case "end":
      return "their lower edges aligned";
    case "stretch":
      return "their heights stretched to match";
  }
};

const verticalAlignment = (alignment: WireframeAlign): string => {
  switch (alignment) {
    case "start":
      return "their left edges aligned";
    case "center":
      return "their horizontal centers aligned";
    case "end":
      return "their right edges aligned";
    case "stretch":
      return "each child stretched to the available width";
  }
};

const distribution = (
  justify: "start" | "center" | "end" | "between",
): string => {
  switch (justify) {
    case "start":
      return "clustered at the left";
    case "center":
      return "centered across the available width";
    case "end":
      return "clustered at the right";
    case "between":
      return "spread so the first and last groups anchor opposite edges";
  }
};

const measureDescription = (measure: WireframeMeasure): string => {
  switch (measure) {
    case "narrow":
      return "a narrow column suited to one focused card or short form";
    case "prose":
      return "a readable prose-width column rather than the full screen";
    case "wide":
      return "a wide column that uses most of the available content area";
  }
};

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
      : `empty, showing placeholder ${safeText(placeholder)}`
    : `current value: ${safeText(value)}`;

const hasApplicationFrame = (screen: WireframeScreen): boolean =>
  screen.children.some((node) => node.element === "AppShell");

/** Describes the actual device envelope a recreation should target. */
const deviceFrame = (screen: WireframeScreen): string => {
  const preset = WIREFRAME_DEVICE_PRESETS[screen.device];
  if (screen.device === "desktop" && hasApplicationFrame(screen)) {
    return `${preset.label} application viewport, ${preset.width} × ${preset.height} pixels; persistent chrome stays fixed while workspace panes manage their own overflow.`;
  }
  if (preset.heightPolicy === "fixed") {
    return `${preset.label} frame, ${preset.width} × ${preset.height} pixels; content must fit inside this fixed frame without internal page scrolling.`;
  }
  return `${preset.label} page frame, ${preset.width} pixels wide and at least ${preset.height} pixels tall; the height may grow when the content needs more room.`;
};

/** Summarizes the dominant silhouette before the detailed reading-order list. */
const overallComposition = (screen: WireframeScreen): string => {
  const nodes = flattenNodes(screen.children);
  const hasSidebar = nodes.some((node) => node.element === "Sidebar");
  const hasBottomNavigation = nodes.some(
    (node) => node.element === "BottomBar",
  );
  const hasChoices = nodes.some((node) => node.element === "ChoiceGroup");
  if (hasApplicationFrame(screen) && hasSidebar) {
    return "A desktop application layout with a fixed-width left navigation sidebar and a wider, visually dominant main content column.";
  }
  if (hasApplicationFrame(screen)) {
    return "An application layout with a full-width top region above one visually dominant main content column.";
  }
  if (screen.device === "phone" && hasBottomNavigation) {
    return "A tall, single-column phone layout with persistent primary navigation across the bottom edge.";
  }
  if (hasChoices) {
    return "A focused decision screen in which large selectable options occupy the dominant central area.";
  }
  return "A single-column page read from top to bottom, with content constrained to the device width.";
};

/** States hierarchy and state cues without repeating authored labels or values. */
const visualHierarchy = (screen: WireframeScreen): string => {
  const nodes = flattenNodes(screen.children);
  const sentences: Array<string> = [];
  if (nodes.some((node) => node.element === "PageHeader")) {
    sentences.push("The full-width page heading reads first.");
  } else if (
    nodes.some(
      (node) =>
        (node.element === "TopBar" && node.title !== undefined) ||
        node.element === "Heading",
    )
  ) {
    sentences.push("The topmost title establishes the screen context first.");
  }
  if (
    nodes.some(
      (node) => node.element === "Button" && node.emphasis === "primary",
    )
  ) {
    sentences.push("A filled primary button is the strongest action.");
  }
  if (
    nodes.some(
      (node) => node.element === "Button" && node.emphasis === "destructive",
    )
  ) {
    sentences.push(
      "A danger-colored destructive button is visually separated from ordinary actions.",
    );
  }
  if (
    nodes.some(
      (node) =>
        (node.element === "NavItem" && node.active) ||
        (node.element === "ListItem" && node.selected) ||
        (node.element === "ChoiceCard" && node.selected),
    )
  ) {
    sentences.push(
      "Highlighted selection treatment establishes the current location or chosen item.",
    );
  }
  if (
    nodes.some(
      (node) =>
        (node.element === "Badge" && node.tone !== "neutral") ||
        (node.element === "Panel" && node.status !== undefined) ||
        (node.element === "ListItem" && node.status !== undefined),
    )
  ) {
    sentences.push(
      "Written status labels and matching tone treatments make state scannable without relying on color alone.",
    );
  }
  return sentences.length === 0
    ? "Reading order and spacing provide the hierarchy; no control is given dominant emphasis."
    : sentences.join(" ");
};

const workspaceDescription = ({
  node,
  device,
}: {
  readonly node: Extract<WireframeNode, { readonly element: "Row" }>;
  readonly device: WireframeDevice;
}): string | undefined => {
  const panes = node.children.filter((child) => ROW_PANES.has(child.element));
  const collectionIndex = panes.findIndex(holdsRecordCollection);
  const supportingSidebarIndex = panes.findIndex(
    (child) => child.element === "Rail",
  );
  const overflow =
    device === "desktop"
      ? " The panes meet edge to edge inside the fixed viewport and scroll independently when needed."
      : ` The panes use ${SPACING_WORDS[node.gap]} and keep ${horizontalAlignment(node.align)}.`;

  if (
    panes.length === 2 &&
    collectionIndex === 0 &&
    supportingSidebarIndex === 1
  ) {
    return `Two-pane workspace: a broad record collection on the left is the dominant working surface, while a narrower supporting sidebar on the right holds detail for the selected record.${overflow}`;
  }
  if (
    panes.length >= 3 &&
    collectionIndex >= 0 &&
    supportingSidebarIndex >= 0
  ) {
    return `Three-pane workspace: a bounded record collection leads on the left, the middle pane expands into the visually dominant working surface, and the narrowest supporting sidebar sits on the right.${overflow}`;
  }
  if (panes.length === 2 && collectionIndex === 0) {
    return `Two-pane list-and-detail workspace: the narrower record collection sits on the left and the wider detail surface on the right is visually dominant.${overflow}`;
  }
  if (supportingSidebarIndex >= 0) {
    return `Horizontal workspace: the main pane expands to dominate the available width, while a narrow supporting sidebar stays secondary beside it.${overflow}`;
  }
  return undefined;
};

const nested = ({
  label,
  children,
  depth,
  device,
}: {
  readonly label: string;
  readonly children: ReadonlyArray<WireframeNode>;
  readonly depth: number;
  readonly device: WireframeDevice;
}): ReadonlyArray<string> => [
  `${"  ".repeat(depth)}- ${label}`,
  ...nodeLines(children, depth + 1, device),
];

/** Recursively turns validated UI nodes into visual reconstruction notes. */
const nodeLines = (
  nodes: ReadonlyArray<WireframeNode>,
  depth: number,
  device: WireframeDevice,
): ReadonlyArray<string> =>
  nodes.flatMap((node): ReadonlyArray<string> => {
    const prefix = `${"  ".repeat(depth)}- `;
    switch (node.element) {
      case "Stack":
        return nested({
          label: `Vertical section; children read from top to bottom with ${SPACING_WORDS[node.gap]} and ${verticalAlignment(node.align)}.`,
          children: node.children,
          depth,
          device,
        });
      case "Row":
        return nested({
          label:
            workspaceDescription({ node, device }) ??
            `Horizontal arrangement of ${node.children.length} items with ${SPACING_WORDS[node.gap]}, ${horizontalAlignment(node.align)}, and items ${distribution(node.justify)}.`,
          children: node.children,
          depth,
          device,
        });
      case "Group":
        return nested({
          label: `Compact horizontal cluster; its controls stay together as one unit, with ${SPACING_WORDS[node.gap]} and ${horizontalAlignment(node.align)}.`,
          children: node.children,
          depth,
          device,
        });
      case "Panel":
        return nested({
          label: `${SURFACE_DESCRIPTIONS[node.surface]}${details([
            node.eyebrow === undefined
              ? undefined
              : `small uppercase eyebrow: ${safeText(node.eyebrow)}`,
            node.title === undefined
              ? undefined
              : `title: ${safeText(node.title)}`,
            node.status === undefined
              ? undefined
              : `overall state: ${STATUS_DESCRIPTIONS[node.status]}`,
          ])}.`,
          children: node.children,
          depth,
          device,
        });
      case "SegmentedControl":
        return nested({
          label:
            "Joined horizontal mode selector; its adjacent options read as mutually exclusive views rather than separate actions.",
          children: node.children,
          depth,
          device,
        });
      case "AppShell":
        return nested({
          label:
            "Full-height application frame; persistent navigation and primary work areas remain visually separate.",
          children: node.children,
          depth,
          device,
        });
      case "AppContent":
        return nested({
          label:
            "Wide main content column; it fills the remaining horizontal space and carries the screen's dominant work.",
          children: node.children,
          depth,
          device,
        });
      case "BottomBar":
        return nested({
          label:
            "Persistent bottom navigation bar spanning the phone width; primary destinations are evenly distributed for thumb reach.",
          children: node.children,
          depth,
          device,
        });
      case "List":
        return nested({
          label:
            "Vertical record list; full-width rows are stacked closely for scanning.",
          children: node.children,
          depth,
          device,
        });
      case "ChoiceGroup":
        return nested({
          label:
            device === "phone"
              ? "Dominant vertical set of large, full-width selectable cards with equal visual weight."
              : "Dominant grid of large selectable cards with equal visual weight and clear space between options.",
          children: node.children,
          depth,
          device,
        });
      case "Stepper":
        return nested({
          label:
            "Ordered progress sequence; completed, current, and upcoming steps are visually distinct.",
          children: node.children,
          depth,
          device,
        });
      case "Rail":
        return nested({
          label:
            "Narrow supporting sidebar beside the main workspace; it holds inspector or contextual detail with deliberately less visual weight.",
          children: node.children,
          depth,
          device,
        });
      case "Breadcrumbs":
        return nested({
          label:
            "Horizontal breadcrumb trail showing the path from broader sections to the current view.",
          children: node.children,
          depth,
          device,
        });
      case "Overlay": {
        const title =
          node.title === undefined ? "" : ` titled ${safeText(node.title)}`;
        const overlay =
          node.kind === "alert"
            ? `Centered blocking alert dialog${title}`
            : `Centered modal task dialog${title}`;
        const backdrop =
          node.backdrop === "dim"
            ? `the page behind it is dimmed and unavailable until the ${node.kind === "alert" ? "alert is answered" : "dialog closes"}`
            : "the page remains clearly visible and usable around it";
        return nested({
          label: `${overlay}; ${backdrop}.`,
          children: node.children,
          depth,
          device,
        });
      }
      case "Sidebar":
        return nested({
          label: `Fixed-width left navigation sidebar running the full application height and separated from the main area by a vertical divider${details(
            [
              node.brand === undefined
                ? undefined
                : `brand: ${safeText(node.brand)}`,
              node.mode === undefined
                ? undefined
                : `small uppercase context label: ${safeText(node.mode)}`,
            ],
          )}.`,
          children: node.children,
          depth,
          device,
        });
      case "TopBar":
        return nested({
          label: `Horizontal top toolbar separated from content by a bottom rule${details(
            [
              node.title === undefined
                ? undefined
                : `screen identity on the left: ${safeText(node.title)}`,
              "actions align to the right",
            ],
          )}.`,
          children: node.children,
          depth,
          device,
        });
      case "PageHeader":
        return nested({
          label: `Full-width page heading area; the title ${safeText(node.title)}${
            node.badge === undefined
              ? ""
              : ` sits beside a compact badge reading ${safeText(node.badge)}`
          } reads on the left${
            node.description === undefined
              ? ""
              : ` above smaller supporting copy: ${safeText(node.description)}`
          }, while actions align on the right.`,
          children: node.children,
          depth,
          device,
        });
      case "Nav":
        return nested({
          label: `Vertical navigation list${details([
            node.label === undefined
              ? undefined
              : `accessible label: ${safeText(node.label)}`,
          ])}.`,
          children: node.children,
          depth,
          device,
        });
      case "Center":
        return nested({
          label: `Horizontally centered content constrained to ${measureDescription(node.measure)}.`,
          children: node.children,
          depth,
          device,
        });
      case "Heading": {
        const size =
          node.level === "1"
            ? "Large section heading"
            : node.level === "2"
              ? "Medium subsection heading"
              : "Small group heading";
        return [`${prefix}${size}: ${safeText(node.text)}`];
      }
      case "Text":
        return [
          `${prefix}${TEXT_ROLE_DESCRIPTIONS[node.role]}: ${safeText(node.text)}`,
        ];
      case "Button":
        return [
          `${prefix}${EMPHASIS_DESCRIPTIONS[node.emphasis]}: ${safeText(node.label)}${details(
            [
              node.icon === undefined
                ? undefined
                : `leading symbol meaning ${safeText(node.icon)}`,
              node.iconOnly
                ? "words hidden visually; label remains the accessible name and tooltip"
                : undefined,
              navigation(node.navigateTo),
            ],
          )}`,
        ];
      case "NavItem":
        return [
          `${prefix}Navigation link: ${safeText(node.label)}${details([
            node.active
              ? "visually selected as the current location"
              : "not selected",
            navigation(node.navigateTo),
          ])}`,
        ];
      case "Metric":
        return [
          `${prefix}Prominent metric; a small label ${safeText(node.label)} sits above the larger value ${safeText(node.value)}${details(
            [
              node.note === undefined
                ? undefined
                : `supporting note: ${safeText(node.note)}`,
            ],
          )}`,
        ];
      case "Progress":
        return [
          `${prefix}Horizontal progress indicator${
            node.label === undefined ? "" : ` labelled ${safeText(node.label)}`
          }; its bar is filled to ${node.value}% and reads ${
            node.valueLabel === undefined
              ? `${node.value}%`
              : safeText(node.valueLabel)
          }${details([
            node.detail === undefined
              ? undefined
              : `supporting detail: ${safeText(node.detail)}`,
          ])}`,
        ];
      case "Badge":
        return [
          `${prefix}Compact status badge: ${safeText(node.label)} (${TONE_DESCRIPTIONS[node.tone]})`,
        ];
      case "Reference":
        return [
          `${prefix}Bordered copyable reference: ${markdownInlineCode(node.text)}${details(
            [
              node.icon === undefined
                ? undefined
                : `leading ${safeText(node.icon)} symbol`,
              node.copyLabel === undefined
                ? undefined
                : `copy button labelled ${safeText(node.copyLabel)}`,
            ],
          )}`,
        ];
      case "Icon": {
        const size =
          node.size === "sm"
            ? "Small"
            : node.size === "md"
              ? "Medium"
              : "Large";
        return [
          `${prefix}${size} standalone symbol meaning ${safeText(node.label)} (${node.labelled ? "visible text label" : "meaning available to assistive technology only"})`,
        ];
      }
      case "Divider":
        return [
          `${prefix}Thin horizontal divider${
            node.label === undefined
              ? ""
              : ` with centered label ${safeText(node.label)}`
          }`,
        ];
      case "ImagePlaceholder": {
        const shape =
          node.shape === "wide"
            ? "wide landscape"
            : node.shape === "tall"
              ? "tall portrait"
              : "square";
        return [
          `${prefix}${shape} media placeholder labelled ${safeText(node.label)}`,
        ];
      }
      case "ChoiceCard":
        return [
          `${prefix}Large selectable card: ${safeText(node.title)} — ${safeText(node.description)}${details(
            [
              node.emoji === undefined
                ? undefined
                : `art: ${safeText(node.emoji)}`,
              node.selected
                ? "visibly selected with the strongest outline and selection mark"
                : "not selected",
              navigation(node.navigateTo),
            ],
          )}`,
        ];
      case "ListItem":
        return [
          `${prefix}Full-width record row: ${safeText(node.label)}${details([
            node.meta === undefined
              ? undefined
              : `secondary metadata: ${safeText(node.meta)}`,
            node.value === undefined
              ? undefined
              : `trailing value: ${safeText(node.value)}`,
            node.status === undefined
              ? undefined
              : `state: ${STATUS_DESCRIPTIONS[node.status]}`,
            node.selected
              ? "highlighted as the selected record"
              : "not selected",
            navigation(node.navigateTo),
          ])}`,
        ];
      case "Message": {
        const kind =
          node.kind === "customer"
            ? "Customer message bubble"
            : node.kind === "agent"
              ? "Agent message bubble"
              : "Quiet internal note";
        return [
          `${prefix}${kind} from ${safeText(node.author)} at ${safeText(node.time)}: ${safeText(node.text)}`,
        ];
      }
      case "TextField":
        return [
          `${prefix}${node.disabled ? "Disabled" : "Enabled"} ${node.kind} input labelled ${safeText(node.label)}${details(
            [
              controlValue(node),
              node.hint === undefined
                ? undefined
                : `supporting hint: ${safeText(node.hint)}`,
            ],
          )}`,
        ];
      case "TextArea":
        return [
          `${prefix}${node.disabled ? "Disabled" : "Enabled"} multi-line text box labelled ${safeText(node.label)}${details(
            [
              controlValue(node),
              node.hint === undefined
                ? undefined
                : `supporting hint: ${safeText(node.hint)}`,
            ],
          )}`,
        ];
      case "Select":
        return [
          `${prefix}${node.disabled ? "Disabled" : "Enabled"} dropdown labelled ${safeText(node.label)} (selected value: ${safeText(node.value)}${
            node.hint === undefined
              ? ""
              : `; supporting hint: ${safeText(node.hint)}`
          })`,
        ];
      case "Checkbox":
        return [
          `${prefix}Square checkbox labelled ${safeText(node.label)}${details([
            node.checked ? "checked" : "unchecked",
            node.hint === undefined
              ? undefined
              : `supporting hint: ${safeText(node.hint)}`,
          ])}`,
        ];
      case "Switch":
        return [
          `${prefix}Sliding on/off switch labelled ${safeText(node.label)}${details(
            [
              node.on ? "on" : "off",
              node.hint === undefined
                ? undefined
                : `supporting hint: ${safeText(node.hint)}`,
            ],
          )}`,
        ];
      case "Step": {
        const state =
          node.state === "done"
            ? "completed with a finished mark"
            : node.state === "current"
              ? "current and visually emphasized"
              : "upcoming and visually quiet";
        return [`${prefix}Progress step: ${safeText(node.label)} (${state})`];
      }
      case "Connector":
        return [
          `${prefix}${node.direction === "right" ? "Right-pointing" : "Downward-pointing"} arrow connector${
            node.label === undefined ? "" : ` labelled ${safeText(node.label)}`
          }`,
        ];
      case "Crumb":
        return [
          `${prefix}Breadcrumb link: ${safeText(node.label)}${details([
            navigation(node.navigateTo),
          ])}`,
        ];
      case "Table": {
        const headers = [
          ...(node.selected === undefined ? [] : ["Selected"]),
          ...node.headers.map(safeText),
        ];
        const rows = node.rows.map((row, index) => [
          ...(node.selected === undefined
            ? []
            : [node.selected === index + 1 ? "Yes" : "No"]),
          ...row.map((cell) =>
            safeText(
              cell.tone === undefined
                ? cell.text
                : `${cell.text} — ${TONE_DESCRIPTIONS[cell.tone]}`,
            ),
          ),
        ]);
        return [
          `${prefix}Full-width data grid; columns stay in authored order and numeric values align on the right:`,
          ...markdownTable({
            headers,
            rows,
            alignments: [
              ...(node.selected === undefined ? [] : (["center"] as const)),
              ...node.numeric.map((isNumeric) =>
                isNumeric ? ("right" as const) : ("left" as const),
              ),
            ],
          })
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
      text: `Interface design${model.title === undefined ? "" : `: ${safeText(model.title)}`}`,
    }),
    ...model.screens.map((screen) =>
      [
        markdownHeading({
          level: 4,
          offset: headingOffset,
          text: `Screen: ${safeText(screen.name)}${screen.id === model.initialScreenId ? " — Initial" : ""}`,
        }),
        "**Look and feel**",
        `- Device frame: ${deviceFrame(screen)}`,
        ...(screen.url === undefined
          ? []
          : [`- Address shown: ${safeText(screen.url)}`]),
        `- Overall composition: ${overallComposition(screen)}`,
        `- Visual hierarchy: ${visualHierarchy(screen)}`,
        ...(screen.pattern === undefined
          ? []
          : [`- Interaction layout: ${PATTERN_DESCRIPTIONS[screen.pattern]}`]),
        "",
        "**Screen structure, from top to bottom and left to right**",
        ...nodeLines(screen.children, 0, screen.device),
      ].join("\n"),
    ),
  ].join("\n\n");
