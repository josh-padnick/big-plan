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
  WIREFRAME_SPACES,
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

const PANEL_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
  eyebrow: { kind: "string", nonEmpty: true },
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
  Panel: {
    category: "surface",
    acceptsChildren: true,
    summary: "A bounded region of a screen, optionally titled.",
    example: '<Panel title="Recent activity">...</Panel>',
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
    summary: "One line of screen copy: body, helper, or muted.",
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
