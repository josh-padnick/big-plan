// Owns the wireframe element catalog: the single source of truth for which
// elements a plan author may write inside a Wireframe, what each accepts, and
// how one authored element becomes a validated node. Authoring rules, child
// placement, and the agent-facing description of every element live here and
// nowhere else; the view consumes the nodes this catalog produces.

import type { ElementContent, Root } from "hast";
import { singleAuthoredFence } from "./../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentAttributeValue,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import type { WireframeTableCell } from "./model.js";
import { workActionButtons } from "./nodes.js";
import {
  WIREFRAME_ALIGNMENTS,
  WIREFRAME_EMPHASES,
  WIREFRAME_HEADING_LEVELS,
  WIREFRAME_ICON_NAMES,
  WIREFRAME_ICON_SIZES,
  WIREFRAME_JUSTIFICATIONS,
  WIREFRAME_MEASURES,
  WIREFRAME_DIRECTIONS,
  WIREFRAME_FIELD_KINDS,
  WIREFRAME_MEDIA_SHAPES,
  WIREFRAME_OVERLAY_BACKDROPS,
  WIREFRAME_OVERLAY_KINDS,
  WIREFRAME_SPACES,
  WIREFRAME_STATUSES,
  WIREFRAME_STEP_STATES,
  WIREFRAME_SURFACES,
  WIREFRAME_TONES,
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
  // The element's authored body, given only to elements whose body policy is
  // "fence"; every other element is drawn entirely from its attributes.
  readonly body: ReadonlyArray<ElementContent>;
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
  // Whether this element reads an authored body. Only a fenced block is ever
  // allowed, and only where rows of data are genuinely more readable written
  // out than nested one element deep.
  readonly body?: "fence";
  // One line an agent can act on, and one authored line proving the shape.
  readonly summary: string;
  readonly example: string;
  readonly compile: (input: WireframeElementCompilerInput) => WireframeNode;
};

const STACK_SCHEMA = {
  gap: { kind: "enum", values: WIREFRAME_SPACES },
  align: { kind: "enum", values: WIREFRAME_ALIGNMENTS },
} satisfies ComponentAttributeSchema;

const ROW_SCHEMA = {
  gap: { kind: "enum", values: WIREFRAME_SPACES },
  align: { kind: "enum", values: WIREFRAME_ALIGNMENTS },
  justify: { kind: "enum", values: WIREFRAME_JUSTIFICATIONS },
} satisfies ComponentAttributeSchema;

const GROUP_SCHEMA = {
  gap: { kind: "enum", values: WIREFRAME_SPACES },
  align: { kind: "enum", values: WIREFRAME_ALIGNMENTS },
} satisfies ComponentAttributeSchema;

const PANEL_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
  eyebrow: { kind: "string", nonEmpty: true },
  surface: { kind: "enum", values: WIREFRAME_SURFACES },
  status: { kind: "enum", values: WIREFRAME_STATUSES },
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
  icon: { kind: "string", nonEmpty: true },
  iconOnly: { kind: "booleanShorthand" },
  navigateTo: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

// The named glyphs, read as prose so one authoring message can list them.
const ICON_NAME_LIST = WIREFRAME_ICON_NAMES.join(", ");

const ICON_SCHEMA = {
  name: { kind: "string", required: true, nonEmpty: true },
  label: { kind: "string", required: true, nonEmpty: true },
  labelled: { kind: "booleanShorthand" },
  size: { kind: "enum", values: WIREFRAME_ICON_SIZES },
} satisfies ComponentAttributeSchema;

// An overlay's exit is often a Button inside a Row of actions rather than a
// direct child, so the search reaches the whole surface. It counts only the
// buttons that act: a segmented control's options and a bottom bar's
// destinations are drawn as buttons but only change what the surface shows,
// so reading one as the way out leaves the reader in exactly the trap this
// check exists to refuse.
const holdsExit = (nodes: ReadonlyArray<WireframeNode>): boolean =>
  workActionButtons(nodes).length > 0;

const OVERLAY_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
  kind: { kind: "enum", values: WIREFRAME_OVERLAY_KINDS },
  backdrop: { kind: "enum", values: WIREFRAME_OVERLAY_BACKDROPS },
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
  valueLabel: { kind: "string", nonEmpty: true },
  detail: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const BADGE_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  tone: { kind: "enum", values: WIREFRAME_TONES },
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
  status: { kind: "enum", values: WIREFRAME_STATUSES },
  selected: { kind: "booleanShorthand" },
  navigateTo: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const CHOICE_CARD_SCHEMA = {
  icon: { kind: "string", required: true, nonEmpty: true },
  title: { kind: "string", required: true, nonEmpty: true },
  description: { kind: "string", required: true, nonEmpty: true },
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

const CENTER_SCHEMA = {
  measure: { kind: "enum", values: WIREFRAME_MEASURES },
} satisfies ComponentAttributeSchema;

const CRUMB_SCHEMA = {
  label: { kind: "string", required: true, nonEmpty: true },
  navigateTo: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

// A figure reads as a figure: a cell right-aligns when every value under that
// header is one, which is what lets a reader compare down a column.
const NUMERIC_CELL = /^[+-]?[$£€]?\d[\d,.]*\s*[%a-z]*$/iu;

const isNumericColumn = (values: ReadonlyArray<string>): boolean =>
  values.length > 0 && values.every((value) => NUMERIC_CELL.test(value.trim()));

// A cell written as [Failed] or [Failed:danger] reports state, so it is drawn
// as a chip. The word is always there; the tone only reinforces it.
const CHIP_CELL = /^\[([^\]:]+)(?::([a-z]+))?\]$/u;

const parseCell = ({
  raw,
  position,
  diagnostics,
}: {
  readonly raw: string;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
}): WireframeTableCell => {
  const match = CHIP_CELL.exec(raw.trim());
  if (match === null) {
    return { text: raw.trim() };
  }
  const [, label = "", tone] = match;
  if (tone === undefined) {
    return { text: label.trim(), tone: "neutral" };
  }
  const known = WIREFRAME_TONES.find((value) => value === tone);
  if (known === undefined) {
    diagnostics.add({
      message: `Unknown chip tone "${tone}" in a table cell; expected one of: ${WIREFRAME_TONES.join(", ")}`,
      position,
    });
    return { text: label.trim(), tone: "neutral" };
  }
  return { text: label.trim(), tone: known };
};

const TABLE_SCHEMA = {
  selected: { kind: "number", min: 1, max: 200, integer: true },
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
    summary: "Stacks its children vertically with one spacing token.",
    example: '<Stack gap="md">...</Stack>',
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
  Group: {
    category: "layout",
    acceptsChildren: true,
    summary:
      'A run of loose controls that travel together as one item of a Row; it never holds a Panel, Stack, Row, Center, or Rail. Two Groups inside <Row justify="between"> put one set at the start and the other at the end, which is how a real toolbar carries its title on the left and its controls on the right.',
    example:
      '<Row justify="between"><Group><Heading text="Plans" /></Group><Group><Button icon="settings" label="Settings" iconOnly /></Group></Row>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Group",
        attributes,
        position,
        diagnostics,
        schema: GROUP_SCHEMA,
      });
      return {
        element: "Group",
        gap: validated.gap ?? "sm",
        align: validated.align ?? "center",
        children,
      };
    },
  },
  Panel: {
    category: "surface",
    acceptsChildren: true,
    summary:
      'A region that draws no box by default. A direct List or Table makes it the Row\'s master pane; surface="filled" marks a pane and surface="outlined" is for a card. status marks where the whole group stands: done, attention, waiting, or blocked.',
    example: '<Panel title="Conversation">...</Panel>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Panel",
        attributes,
        position,
        diagnostics,
        schema: PANEL_SCHEMA,
      });
      if (validated.status !== undefined && validated.title === undefined) {
        diagnostics.add({
          message:
            "Panel status needs title so the state mark has a group to label",
          position,
        });
      }
      return {
        element: "Panel",
        ...(validated.title === undefined ? {} : { title: validated.title }),
        ...(validated.eyebrow === undefined
          ? {}
          : { eyebrow: validated.eyebrow }),
        surface: validated.surface ?? "plain",
        ...(validated.status === undefined || validated.title === undefined
          ? {}
          : { status: validated.status }),
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
    summary: `An action. icon draws a named glyph before the label, and iconOnly draws that glyph alone while label stays the accessible name and the tooltip. Give it navigateTo to move the prototype to another screen. Named glyphs: ${ICON_NAME_LIST}.`,
    example: '<Button label="Start lesson" navigateTo="loan-lesson" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Button",
        attributes,
        position,
        diagnostics,
        schema: BUTTON_SCHEMA,
      });
      // A control drawn with neither words nor a mark is a blank box, which is
      // the one thing an author cannot have meant. The label is never dropped,
      // so this is only ever about what the button draws.
      if (validated.iconOnly === true && validated.icon === undefined) {
        diagnostics.add({
          message: `Button "${validated.label ?? ""}" is iconOnly with no icon, so it would draw nothing; give it icon="..." or remove iconOnly`,
          position,
        });
      }
      return {
        element: "Button",
        label: validated.label ?? "",
        emphasis: validated.emphasis ?? "secondary",
        ...(validated.icon === undefined ? {} : { icon: validated.icon }),
        iconOnly: validated.iconOnly === true && validated.icon !== undefined,
        ...(validated.navigateTo === undefined
          ? {}
          : { navigateTo: validated.navigateTo }),
      };
    },
  },
  Icon: {
    category: "content",
    acceptsChildren: false,
    summary: `A glyph standing on its own as a mark - a tip marker, a lock beside a field, a chevron at the end of a row. label always says what it means and always reaches assistive technology; labelled also draws those words beside it. Anything a person clicks is a Button with the same icon, never this. A name outside the set draws a crossed placeholder carrying that name rather than a nearby glyph that would be wrong. Named glyphs: ${ICON_NAME_LIST}.`,
    example: '<Icon name="tip" label="Tip" size="sm" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Icon",
        attributes,
        position,
        diagnostics,
        schema: ICON_SCHEMA,
      });
      return {
        element: "Icon",
        name: validated.name ?? "",
        label: validated.label ?? "",
        labelled: validated.labelled === true,
        size: validated.size ?? "md",
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
  Overlay: {
    category: "surface",
    acceptsChildren: true,
    allowedParents: ["Screen"],
    summary:
      'A surface drawn over the page: a dialog, a confirmation, a menu, a toast. kind="alert" is the interruption that guards a destructive or irreversible action and draws its own alert mark; kind="dialog" is an ordinary task surface. backdrop="dim" says the page is unavailable until this is answered, and backdrop="clear" says it is not. It holds any drawing elements, belongs directly to a Screen, and needs the page it covers beside it.',
    example:
      '<Overlay kind="alert" title="Delete this view?">...<Button label="Delete view" emphasis="destructive" />...</Overlay>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Overlay",
        attributes,
        position,
        diagnostics,
        schema: OVERLAY_SCHEMA,
      });
      // Every opened surface owes the reader a way out, and an overlay is the
      // surface where forgetting it traps them: the page underneath is covered,
      // so a drawing with no control on top is a screen nobody can leave.
      if (!holdsExit(children)) {
        diagnostics.add({
          message:
            "Overlay needs at least one Button that acts so the surface it opens has a visible way out; SegmentedControl and BottomBar options switch mode rather than leave",
          position,
        });
      }
      return {
        element: "Overlay",
        ...(validated.title === undefined ? {} : { title: validated.title }),
        kind: validated.kind ?? "dialog",
        backdrop: validated.backdrop ?? "dim",
        children,
      };
    },
  },
  AppShell: {
    category: "layout",
    acceptsChildren: true,
    allowedChildren: ["Sidebar", "TopBar", "AppContent"],
    summary:
      "The product frame: a flush-left sidebar on desktop, optional top bar, and content region. Tablet devices relax the gutters; phone screens use TopBar and BottomBar instead.",
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
      "A strip across the top of a shell or a screen. The title leads and loose controls trail, which is how a desktop or tablet bar reads. A Group written first leads, before the title, which is how a phone draws the back control iOS puts there; every later child trails.",
    example:
      '<TopBar title="Dashboard"><Button label="Settings" icon="settings" iconOnly /></TopBar>',
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
      "A phone tab strip across the bottom of the screen. Reach for it on device=phone; keep desktop navigation in Sidebar.",
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
    summary:
      "How far along something is, with an optional tangible label in place of a percentage.",
    example:
      '<Progress label="Headphones goal" value="61" valueLabel="Only $27.50 to go" detail="$42.50 of $70" />',
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
        ...(validated.valueLabel === undefined
          ? {}
          : { valueLabel: validated.valueLabel }),
        ...(validated.detail === undefined ? {} : { detail: validated.detail }),
      };
    },
  },
  Badge: {
    category: "content",
    acceptsChildren: false,
    summary:
      "A short status beside the thing it describes. The tone tints it; the word is what carries the meaning.",
    example: '<Badge label="Failed" tone="danger" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Badge",
        attributes,
        position,
        diagnostics,
        schema: BADGE_SCHEMA,
      });
      return {
        element: "Badge",
        label: validated.label ?? "",
        tone: validated.tone ?? "neutral",
      };
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
  ChoiceGroup: {
    category: "surface",
    acceptsChildren: true,
    allowedChildren: ["ChoiceCard"],
    summary:
      "Two to five simple alternatives as one dominant touch decision; each option supplies an icon, title, and one-line consequence.",
    example:
      '<ChoiceGroup><ChoiceCard icon="⚽" title="Ask about a purchase" description="See how much money I would have left" /></ChoiceGroup>',
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "ChoiceGroup",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      if (children.length < 2 || children.length > 5) {
        diagnostics.add({
          message: `ChoiceGroup needs 2–5 ChoiceCard options; it found ${children.length}. Use a focused choice surface for a small decision and another pattern for a larger collection.`,
          position,
        });
      }
      return { element: "ChoiceGroup", children };
    },
  },
  ChoiceCard: {
    category: "content",
    acceptsChildren: false,
    allowedParents: ["ChoiceGroup"],
    summary:
      "One whole-surface touch option. selected adds radio, check, border, and fill signals; navigateTo may reveal the deliberate selected state.",
    example:
      '<ChoiceCard icon="⚽" title="Ask about a purchase" description="See how much money I would have left" navigateTo="purchase-selected" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "ChoiceCard",
        attributes,
        position,
        diagnostics,
        schema: CHOICE_CARD_SCHEMA,
      });
      return {
        element: "ChoiceCard",
        icon: validated.icon ?? "",
        title: validated.title ?? "",
        description: validated.description ?? "",
        selected: validated.selected === true,
        ...(validated.navigateTo === undefined
          ? {}
          : { navigateTo: validated.navigateTo }),
      };
    },
  },
  ListItem: {
    category: "content",
    acceptsChildren: false,
    allowedParents: ["List"],
    summary:
      "One row: identity, context, and a trailing value. Mark selected on the active queue row; navigateTo makes the whole row open a screen. status draws a state mark (done, attention, waiting, blocked) so a checklist is scannable without reading every line.",
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
        ...(validated.status === undefined ? {} : { status: validated.status }),
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
      if (
        validated.label !== undefined &&
        /^(?:[✓✔]\s*|\(?\d+\)?[.)]?\s+)/u.test(validated.label)
      ) {
        diagnostics.add({
          message: `Step label "${validated.label}" repeats the progress indicator; write only the task because Stepper draws numbering and completion state`,
          position,
        });
      }
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
  Rail: {
    category: "layout",
    acceptsChildren: true,
    summary:
      "A details column beside the main content. It keeps a fixed rail width so the main content stays the dominant pane.",
    example: "<Row><Stack>...</Stack><Rail>...</Rail></Row>",
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "Rail",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      return { element: "Rail", children };
    },
  },
  Center: {
    category: "layout",
    acceptsChildren: true,
    summary:
      "Holds its children to a readable measure and centers them in the space.",
    example: '<Center measure="prose">...</Center>',
    compile: ({ attributes, children, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Center",
        attributes,
        position,
        diagnostics,
        schema: CENTER_SCHEMA,
      });
      return {
        element: "Center",
        measure: validated.measure ?? "prose",
        children,
      };
    },
  },
  Breadcrumbs: {
    category: "layout",
    acceptsChildren: true,
    allowedChildren: ["Crumb"],
    summary: "Where this screen sits in the product, above the page title.",
    example: '<Breadcrumbs><Crumb label="Workflows" /></Breadcrumbs>',
    compile: ({ attributes, children, position, diagnostics }) => {
      validateComponentAttributes({
        component: "Breadcrumbs",
        attributes,
        position,
        diagnostics,
        schema: EMPTY_SCHEMA,
      });
      return { element: "Breadcrumbs", children };
    },
  },
  Crumb: {
    category: "content",
    acceptsChildren: false,
    allowedParents: ["Breadcrumbs"],
    summary: "One level of the trail; the last one is the current screen.",
    example: '<Crumb label="Workflows" navigateTo="library" />',
    compile: ({ attributes, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Crumb",
        attributes,
        position,
        diagnostics,
        schema: CRUMB_SCHEMA,
      });
      return {
        element: "Crumb",
        label: validated.label ?? "",
        ...(validated.navigateTo === undefined
          ? {}
          : { navigateTo: validated.navigateTo }),
      };
    },
  },
  Table: {
    category: "surface",
    acceptsChildren: false,
    body: "fence",
    summary:
      "Rows of the same kind of record. Write a fenced block: the first line is the header, cells are separated by a pipe.",
    example: "<Table> with a fenced block of pipe-separated rows",
    compile: ({ attributes, body, position, diagnostics }) => {
      const validated = validateComponentAttributes({
        component: "Table",
        attributes,
        position,
        diagnostics,
        schema: TABLE_SCHEMA,
      });
      const fence = singleAuthoredFence({ children: body });
      if (fence === undefined) {
        diagnostics.add({
          message:
            "Table holds one fenced block: the first line names the columns, and every later line is a row of pipe-separated cells",
          position,
        });
        return { element: "Table", headers: [], rows: [], numeric: [] };
      }
      const lines = fence.source
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      const cells = lines.map((line) =>
        line.split("|").map((cell) => cell.trim()),
      );
      const [headers = [], ...rawRows] = cells;
      const rows = rawRows.map((row) =>
        row.map((raw) =>
          parseCell({ raw, position: fence.codePosition, diagnostics }),
        ),
      );
      if (headers.length === 0) {
        diagnostics.add({
          message: "Table needs a first line naming its columns",
          position: fence.codePosition,
        });
      }
      // A row that does not match the header is a table whose columns mean
      // different things on different lines, which is worse than no table.
      const shaped = rows.filter((row, index) => {
        if (row.length === headers.length) {
          return true;
        }
        diagnostics.add({
          message: `Table row ${index + 1} has ${row.length} cells but the header names ${headers.length}`,
          position: fence.codePosition,
        });
        return false;
      });
      if (
        validated.selected !== undefined &&
        validated.selected > shaped.length
      ) {
        diagnostics.add({
          message: `Table has no row ${validated.selected} to select; it holds ${shaped.length}`,
          position,
        });
      }
      return {
        element: "Table",
        headers,
        rows: shaped,
        numeric: headers.map((_header, column) =>
          isNumericColumn(shaped.map((row) => row[column]?.text ?? "")),
        ),
        ...(validated.selected === undefined ||
        validated.selected > shaped.length
          ? {}
          : { selected: validated.selected }),
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
