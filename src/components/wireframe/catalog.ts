// Owns the wireframe element catalog: the single source of truth for which
// elements a plan author may write inside a Wireframe, what each accepts, and
// how one authored element becomes a validated node. Authoring rules, child
// placement, and the agent-facing description of every element live here and
// nowhere else; the view consumes the nodes this catalog produces.

import type { Root } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentAttributeValue,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import {
  WIREFRAME_ALIGNMENTS,
  WIREFRAME_EMPHASES,
  WIREFRAME_HEADING_LEVELS,
  WIREFRAME_JUSTIFICATIONS,
  WIREFRAME_DIRECTIONS,
  WIREFRAME_FIELD_KINDS,
  WIREFRAME_MEDIA_SHAPES,
  WIREFRAME_SPACES,
  WIREFRAME_SPANS,
  WIREFRAME_STEP_STATES,
  WIREFRAME_TEXT_ROLES,
  type WireframeElementName,
  type WireframeNode,
} from "./model.js";

type NodePosition = Root["position"];

/**
 * Where an element may stand.
 *
 * - `layout` and `surface` elements hold other elements.
 * - `content` elements are leaves that carry copy or an action.
 *
 * A screen is not a category here: `Screen` is not a node, and the wireframe
 * compiler places it directly.
 */
export type WireframeCategory = "layout" | "surface" | "content";

export type WireframeElementCompilerInput = {
  readonly attributes: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children: ReadonlyArray<WireframeNode>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
};

export type WireframeElementDefinition = {
  readonly category: WireframeCategory;
  // Whether the element holds other wireframe elements. A leaf reports any
  // nested element rather than silently dropping it.
  readonly acceptsChildren: boolean;
  // The names this element holds, when it holds only some of them. Omitted
  // means any element that may stand inside a screen.
  readonly allowedChildren?: ReadonlyArray<string>;
  // The elements this one belongs to, when it belongs to only some of them.
  // A row of navigation items means nothing outside its navigation.
  readonly allowedParents?: ReadonlyArray<string>;
  // One line an agent can act on, and one authored line proving the shape.
  readonly summary: string;
  readonly example: string;
  readonly compile: (input: WireframeElementCompilerInput) => WireframeNode;
};

const STACK_SCHEMA = {
  gap: { kind: "enum", values: WIREFRAME_SPACES },
  align: { kind: "enum", values: WIREFRAME_ALIGNMENTS },
  // main dominates a Row; rail is a narrow secondary column (desktop density).
  span: { kind: "enum", values: WIREFRAME_SPANS },
} satisfies ComponentAttributeSchema;

const ROW_SCHEMA = {
  gap: { kind: "enum", values: WIREFRAME_SPACES },
  align: { kind: "enum", values: WIREFRAME_ALIGNMENTS },
  justify: { kind: "enum", values: WIREFRAME_JUSTIFICATIONS },
} satisfies ComponentAttributeSchema;

const PANEL_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
  eyebrow: { kind: "string", nonEmpty: true },
  // main dominates a Row; rail is a narrow secondary column (desktop density).
  span: { kind: "enum", values: WIREFRAME_SPANS },
} satisfies ComponentAttributeSchema;

const HEADING_SCHEMA = {
  text: { kind: "string", required: true, nonEmpty: true },
  level: { kind: "enum", values: WIREFRAME_HEADING_LEVELS },
} satisfies ComponentAttributeSchema;

const TEXT_SCHEMA = {
  text: { kind: "string", required: true, nonEmpty: true },
  role: { kind: "enum", values: WIREFRAME_TEXT_ROLES },
} satisfies ComponentAttributeSchema;

const BUTTON_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  emphasis: { kind: "enum", values: WIREFRAME_EMPHASES },
  navigateTo: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const EMPTY_SCHEMA = {} satisfies ComponentAttributeSchema;

const SIDEBAR_SCHEMA = {
  brand: { kind: "string", nonEmpty: true },
  mode: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const TOP_BAR_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const PAGE_HEADER_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
  description: { kind: "string", nonEmpty: true },
  badge: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const NAV_SCHEMA = {
  label: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const NAV_ITEM_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  active: { kind: "booleanShorthand" },
  navigateTo: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const METRIC_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  value: { kind: "string", required: true, nonEmpty: true },
  note: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const PROGRESS_SCHEMA = {
  label: { kind: "string", nonEmpty: true },
  value: { kind: "number", min: 0, max: 100, required: true },
  detail: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const BADGE_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

const DIVIDER_SCHEMA = {
  label: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const IMAGE_PLACEHOLDER_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  shape: { kind: "enum", values: WIREFRAME_MEDIA_SHAPES },
} satisfies ComponentAttributeSchema;

const LIST_ITEM_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  meta: { kind: "string", nonEmpty: true },
  value: { kind: "string", nonEmpty: true },
  selected: { kind: "booleanShorthand" },
  navigateTo: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const MESSAGE_KINDS = ["customer", "agent", "internal"] as const;

const MESSAGE_SCHEMA = {
  author: { kind: "string", required: true, nonEmpty: true },
  time: { kind: "string", required: true, nonEmpty: true },
  text: { kind: "string", required: true, nonEmpty: true },
  kind: { kind: "enum", values: MESSAGE_KINDS },
} satisfies ComponentAttributeSchema;

// A labelled control. The label is required on every one of them: a wireframe
// that draws an unlabelled box has not decided what the field is for, and the
// rendered control would reach a screen reader as nothing at all.
const TEXT_FIELD_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  kind: { kind: "enum", values: WIREFRAME_FIELD_KINDS },
  placeholder: { kind: "string", nonEmpty: true },
  value: { kind: "string", nonEmpty: true },
  hint: { kind: "string", nonEmpty: true },
  disabled: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const TEXT_AREA_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  placeholder: { kind: "string", nonEmpty: true },
  value: { kind: "string", nonEmpty: true },
  hint: { kind: "string", nonEmpty: true },
  disabled: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const SELECT_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  value: { kind: "string", required: true, nonEmpty: true },
  hint: { kind: "string", nonEmpty: true },
  disabled: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const CHECKBOX_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  checked: { kind: "booleanShorthand" },
  hint: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const SWITCH_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  on: { kind: "booleanShorthand" },
  hint: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const STEP_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  state: { kind: "enum", values: WIREFRAME_STEP_STATES },
} satisfies ComponentAttributeSchema;

const CONNECTOR_SCHEMA = {
  direction: { kind: "enum", values: WIREFRAME_DIRECTIONS },
  label: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

// Keyed exhaustively by the node union, so adding a node variant without
// giving authors a way to write it fails compilation here.
const CATALOG = {
  Stack: {
    category: "layout",
    acceptsChildren: true,
    summary:
      "Stacks its children vertically with one spacing token. In a Row, span=list|main|rail sets desktop workspace proportions.",
    example: '<Stack gap="md" span="main">...</Stack>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Stack",
        attributes,
        position,
        diagnostics,
        schema: STACK_SCHEMA,
      });
      return {
        element: "Stack",
        gap: validated.gap ?? "md",
        align: validated.align ?? "stretch",
        span: validated.span ?? "fill",
        children,
      };
    },
  },
  Row: {
    category: "layout",
    acceptsChildren: true,
    summary:
      "Lays its children out side by side, wrapping when space runs out.",
    example: '<Row gap="sm" justify="between">...</Row>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Row",
        attributes,
        position,
        diagnostics,
        schema: ROW_SCHEMA,
      });
      return {
        element: "Row",
        gap: validated.gap ?? "md",
        align: validated.align ?? "stretch",
        justify: validated.justify ?? "start",
        children,
      };
    },
  },
  Panel: {
    category: "surface",
    acceptsChildren: true,
    summary:
      "A bounded region of a screen, optionally titled. In a Row, span=list is a master queue, span=main the primary surface, span=rail secondary properties.",
    example: '<Panel title="Conversation" span="main">...</Panel>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Panel",
        attributes,
        position,
        diagnostics,
        schema: PANEL_SCHEMA,
      });
      return {
        element: "Panel",
        ...(validated.title === undefined ? {} : { title: validated.title }),
        ...(validated.eyebrow === undefined
          ? {}
          : { eyebrow: validated.eyebrow }),
        span: validated.span ?? "fill",
        children,
      };
    },
  },
  Heading: {
    category: "content",
    acceptsChildren: false,
    summary: "A heading inside the screen being drawn.",
    example: '<Heading text="Hi, Eddy!" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Heading",
        attributes,
        position,
        diagnostics,
        schema: HEADING_SCHEMA,
      });
      return {
        element: "Heading",
        text: validated.text ?? "",
        level: validated.level ?? "1",
      };
    },
  },
  Text: {
    category: "content",
    acceptsChildren: false,
    summary:
      "One line of screen copy: body, helper, muted, or a quiet uppercase section label.",
    example: '<Text text="You have four tasks left today." />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Text",
        attributes,
        position,
        diagnostics,
        schema: TEXT_SCHEMA,
      });
      return {
        element: "Text",
        text: validated.text ?? "",
        role: validated.role ?? "body",
      };
    },
  },
  Button: {
    category: "content",
    acceptsChildren: false,
    summary:
      "An action. Give it navigateTo to move the prototype to another screen.",
    example: '<Button label="Start lesson" navigateTo="loan-lesson" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Button",
        attributes,
        position,
        diagnostics,
        schema: BUTTON_SCHEMA,
      });
      return {
        element: "Button",
        label: validated.label ?? "",
        emphasis: validated.emphasis ?? "secondary",
        ...(validated.navigateTo === undefined
          ? {}
          : { navigateTo: validated.navigateTo }),
      };
    },
  },
  SegmentedControl: {
    category: "layout",
    acceptsChildren: true,
    allowedChildren: ["Button"],
    summary:
      "A compact set of mutually exclusive modes. Mark the selected Button primary and keep the alternatives secondary.",
    example:
      '<SegmentedControl><Button label="Reply" emphasis="primary" /><Button label="Internal note" /></SegmentedControl>',
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "SegmentedControl",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      return { element: "SegmentedControl", children };
    },
  },
  AppShell: {
    category: "layout",
    acceptsChildren: true,
    allowedChildren: ["Sidebar", "TopBar", "AppContent"],
    summary:
      "The product frame: a flush-left sidebar on desktop, optional top bar, and content region. Tablet viewports relax the gutters; phone screens should prefer TopBar and BottomBar instead.",
    example:
      "<AppShell><Sidebar>...</Sidebar><AppContent>...</AppContent></AppShell>",
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "AppShell",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      return { element: "AppShell", children };
    },
  },
  Sidebar: {
    category: "layout",
    acceptsChildren: true,
    allowedParents: ["AppShell"],
    summary: "The app shell's identity and navigation column.",
    example: '<Sidebar brand="Eddy\'s Wallet" mode="Child mode">...</Sidebar>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Sidebar",
        attributes,
        position,
        diagnostics,
        schema: SIDEBAR_SCHEMA,
      });
      return {
        element: "Sidebar",
        ...(validated.brand === undefined ? {} : { brand: validated.brand }),
        ...(validated.mode === undefined ? {} : { mode: validated.mode }),
        children,
      };
    },
  },
  AppContent: {
    category: "layout",
    acceptsChildren: true,
    allowedParents: ["AppShell"],
    summary: "The app shell's main region, where the screen's work happens.",
    example: "<AppContent>...</AppContent>",
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "AppContent",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      return { element: "AppContent", children };
    },
  },
  TopBar: {
    category: "layout",
    acceptsChildren: true,
    // A phone screen has a top bar without having a shell around it.
    // Stack is allowed so authors can group the bar with the page body.
    allowedParents: ["AppShell", "Screen", "Stack"],
    summary:
      "A strip across the top of a shell or a screen for the title and actions.",
    example: '<TopBar title="Dashboard">...</TopBar>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "TopBar",
        attributes,
        position,
        diagnostics,
        schema: TOP_BAR_SCHEMA,
      });
      return {
        element: "TopBar",
        ...(validated.title === undefined ? {} : { title: validated.title }),
        children,
      };
    },
  },
  BottomBar: {
    category: "layout",
    acceptsChildren: true,
    // Phone destinations live at the bottom. A desktop shell uses Sidebar.
    allowedParents: ["Screen", "Stack"],
    summary:
      "A phone tab strip across the bottom of the screen. Reach for it on mobile-portrait; keep desktop navigation in Sidebar.",
    example:
      '<BottomBar><Button label="Inbox" emphasis="primary" /><Button label="Settings" /></BottomBar>',
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "BottomBar",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      return { element: "BottomBar", children };
    },
  },
  PageHeader: {
    category: "surface",
    acceptsChildren: true,
    summary:
      "What this page is, said once at the top, with its actions beside it.",
    example: '<PageHeader title="Hi, Eddy!" badge="Read only">...</PageHeader>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "PageHeader",
        attributes,
        position,
        diagnostics,
        schema: PAGE_HEADER_SCHEMA,
      });
      return {
        element: "PageHeader",
        title: validated.title ?? "",
        ...(validated.description === undefined
          ? {}
          : { description: validated.description }),
        ...(validated.badge === undefined ? {} : { badge: validated.badge }),
        children,
      };
    },
  },
  Nav: {
    category: "layout",
    acceptsChildren: true,
    allowedChildren: ["NavItem"],
    summary: "A list of destinations, usually down the sidebar.",
    example: '<Nav label="Main"><NavItem label="Wallet" active /></Nav>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Nav",
        attributes,
        position,
        diagnostics,
        schema: NAV_SCHEMA,
      });
      return {
        element: "Nav",
        ...(validated.label === undefined ? {} : { label: validated.label }),
        children,
      };
    },
  },
  NavItem: {
    category: "content",
    acceptsChildren: false,
    allowedParents: ["Nav"],
    summary:
      "One destination. Mark the current one active; give it navigateTo to make it walk.",
    example: '<NavItem label="Activity" navigateTo="activity" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "NavItem",
        attributes,
        position,
        diagnostics,
        schema: NAV_ITEM_SCHEMA,
      });
      return {
        element: "NavItem",
        label: validated.label ?? "",
        active: validated.active === true,
        ...(validated.navigateTo === undefined
          ? {}
          : { navigateTo: validated.navigateTo }),
      };
    },
  },
  Metric: {
    category: "content",
    acceptsChildren: false,
    summary: "One number the screen exists to show, with its label.",
    example: '<Metric label="Your balance" value="$42.50" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Metric",
        attributes,
        position,
        diagnostics,
        schema: METRIC_SCHEMA,
      });
      return {
        element: "Metric",
        label: validated.label ?? "",
        value: validated.value ?? "",
        ...(validated.note === undefined ? {} : { note: validated.note }),
      };
    },
  },
  Progress: {
    category: "content",
    acceptsChildren: false,
    summary: "How far along something is, from 0 to 100.",
    example:
      '<Progress label="Headphones goal" value="61" detail="$42.50 of $70" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Progress",
        attributes,
        position,
        diagnostics,
        schema: PROGRESS_SCHEMA,
      });
      return {
        element: "Progress",
        ...(validated.label === undefined ? {} : { label: validated.label }),
        value: validated.value ?? 0,
        ...(validated.detail === undefined ? {} : { detail: validated.detail }),
      };
    },
  },
  Badge: {
    category: "content",
    acceptsChildren: false,
    summary: "A short status beside the thing it describes.",
    example: '<Badge label="Pending" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Badge",
        attributes,
        position,
        diagnostics,
        schema: BADGE_SCHEMA,
      });
      return { element: "Badge", label: validated.label ?? "" };
    },
  },
  Divider: {
    category: "content",
    acceptsChildren: false,
    summary: "A rule between two parts of a screen, optionally labeled.",
    example: '<Divider label="Earlier" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Divider",
        attributes,
        position,
        diagnostics,
        schema: DIVIDER_SCHEMA,
      });
      return {
        element: "Divider",
        ...(validated.label === undefined ? {} : { label: validated.label }),
      };
    },
  },
  ImagePlaceholder: {
    category: "content",
    acceptsChildren: false,
    summary: "A crossed box standing in for media, named by what it will show.",
    example: '<ImagePlaceholder label="Goal photo" shape="wide" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "ImagePlaceholder",
        attributes,
        position,
        diagnostics,
        schema: IMAGE_PLACEHOLDER_SCHEMA,
      });
      return {
        element: "ImagePlaceholder",
        label: validated.label ?? "",
        shape: validated.shape ?? "wide",
      };
    },
  },
  List: {
    category: "surface",
    acceptsChildren: true,
    allowedChildren: ["ListItem"],
    summary: "Repeated rows of the same kind of thing.",
    example: '<List><ListItem label="Book fair" value="-$8.50" /></List>',
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "List",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      return { element: "List", children };
    },
  },
  ListItem: {
    category: "content",
    acceptsChildren: false,
    allowedParents: ["List"],
    summary:
      "One row: identity, context, and a trailing value. Mark selected on the active queue row; navigateTo makes the whole row open a screen.",
    example:
      '<ListItem label="Checkout freeze" meta="Northwind · Priority" value="14m · #4821" navigateTo="ticket" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "ListItem",
        attributes,
        position,
        diagnostics,
        schema: LIST_ITEM_SCHEMA,
      });
      return {
        element: "ListItem",
        label: validated.label ?? "",
        ...(validated.meta === undefined ? {} : { meta: validated.meta }),
        ...(validated.value === undefined ? {} : { value: validated.value }),
        selected: validated.selected === true,
        ...(validated.navigateTo === undefined
          ? {}
          : { navigateTo: validated.navigateTo }),
      };
    },
  },
  Message: {
    category: "content",
    acceptsChildren: false,
    summary:
      "One conversation message in a timeline. kind is customer, agent, or internal.",
    example:
      '<Message author="Maya" time="14m" kind="customer" text="Form freezes" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Message",
        attributes,
        position,
        diagnostics,
        schema: MESSAGE_SCHEMA,
      });
      return {
        element: "Message",
        author: validated.author ?? "",
        time: validated.time ?? "",
        text: validated.text ?? "",
        kind: validated.kind ?? "customer",
      };
    },
  },
  TextField: {
    category: "content",
    acceptsChildren: false,
    summary: "A single-line input, drawn as the real control with its label.",
    example: '<TextField label="Workflow name" placeholder="Nightly digest" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "TextField",
        attributes,
        position,
        diagnostics,
        schema: TEXT_FIELD_SCHEMA,
      });
      return {
        element: "TextField",
        label: validated.label ?? "",
        kind: validated.kind ?? "text",
        ...(validated.placeholder === undefined
          ? {}
          : { placeholder: validated.placeholder }),
        ...(validated.value === undefined ? {} : { value: validated.value }),
        ...(validated.hint === undefined ? {} : { hint: validated.hint }),
        disabled: validated.disabled === true,
      };
    },
  },
  TextArea: {
    category: "content",
    acceptsChildren: false,
    summary: "A multi-line input for prose the user will write.",
    example: '<TextArea label="Prompt" placeholder="Summarize the run..." />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "TextArea",
        attributes,
        position,
        diagnostics,
        schema: TEXT_AREA_SCHEMA,
      });
      return {
        element: "TextArea",
        label: validated.label ?? "",
        ...(validated.placeholder === undefined
          ? {}
          : { placeholder: validated.placeholder }),
        ...(validated.value === undefined ? {} : { value: validated.value }),
        ...(validated.hint === undefined ? {} : { hint: validated.hint }),
        disabled: validated.disabled === true,
      };
    },
  },
  Select: {
    category: "content",
    acceptsChildren: false,
    summary: "A choice, showing the option currently selected.",
    example: '<Select label="Run as" value="Service account" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Select",
        attributes,
        position,
        diagnostics,
        schema: SELECT_SCHEMA,
      });
      return {
        element: "Select",
        label: validated.label ?? "",
        value: validated.value ?? "",
        ...(validated.hint === undefined ? {} : { hint: validated.hint }),
        disabled: validated.disabled === true,
      };
    },
  },
  Checkbox: {
    category: "content",
    acceptsChildren: false,
    summary: "One boolean the user ticks.",
    example: '<Checkbox label="Retry failed steps" checked />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Checkbox",
        attributes,
        position,
        diagnostics,
        schema: CHECKBOX_SCHEMA,
      });
      return {
        element: "Checkbox",
        label: validated.label ?? "",
        checked: validated.checked === true,
        ...(validated.hint === undefined ? {} : { hint: validated.hint }),
      };
    },
  },
  Switch: {
    category: "content",
    acceptsChildren: false,
    summary: "A setting that takes effect as soon as it is flipped.",
    example: '<Switch label="Pause this workflow" on />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Switch",
        attributes,
        position,
        diagnostics,
        schema: SWITCH_SCHEMA,
      });
      return {
        element: "Switch",
        label: validated.label ?? "",
        on: validated.on === true,
        ...(validated.hint === undefined ? {} : { hint: validated.hint }),
      };
    },
  },
  Stepper: {
    category: "layout",
    acceptsChildren: true,
    allowedChildren: ["Step"],
    summary: "Where the user is in a multi-step flow.",
    example: '<Stepper><Step label="Basics" state="done" /></Stepper>',
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "Stepper",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      return { element: "Stepper", children };
    },
  },
  Step: {
    category: "content",
    acceptsChildren: false,
    allowedParents: ["Stepper"],
    summary: "One step: done behind them, current, or still ahead.",
    example: '<Step label="Trigger" state="current" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Step",
        attributes,
        position,
        diagnostics,
        schema: STEP_SCHEMA,
      });
      return {
        element: "Step",
        label: validated.label ?? "",
        state: validated.state ?? "todo",
      };
    },
  },
  Connector: {
    category: "content",
    acceptsChildren: false,
    summary:
      "The arrow between two steps of a flow, optionally labeled with the condition.",
    example: '<Connector direction="right" label="on success" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Connector",
        attributes,
        position,
        diagnostics,
        schema: CONNECTOR_SCHEMA,
      });
      return {
        element: "Connector",
        direction: validated.direction ?? "right",
        ...(validated.label === undefined ? {} : { label: validated.label }),
      };
    },
  },
} satisfies Readonly<Record<WireframeElementName, WireframeElementDefinition>>;

// Authored names arrive as plain strings, so lookup widens the exhaustive
// table rather than narrowing the string.
export const WIREFRAME_CATALOG: Readonly<
  Record<string, WireframeElementDefinition>
> = CATALOG;

export const WIREFRAME_ELEMENT_NAMES: ReadonlyArray<string> =
  Object.keys(CATALOG);

/** Finds one catalog entry by authored name. */
export const wireframeElementFor = (
  name: string,
): WireframeElementDefinition | undefined =>
  Object.hasOwn(WIREFRAME_CATALOG, name) ? WIREFRAME_CATALOG[name] : undefined;
