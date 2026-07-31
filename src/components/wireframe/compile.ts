// Compiles Wireframe's authored form into its plan model: a validated tree of
// screens and elements. Every authoring rule that needs more than one element
// to decide lives here - where an element may stand, whether screen ids are
// unique, and whether an action names a screen that exists. Per-element
// attribute rules live in the catalog.

import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import { meaningfulChildren } from "../_authoring/authored-body.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import { wireframeElementFor } from "./catalog.js";
import type { WireframeElementDefinition } from "./catalog.js";
import {
  WIREFRAME_DEVICES,
  WIREFRAME_PATTERNS,
  type CompiledWireframe,
  type WireframeNode,
  type WireframePattern,
  type WireframeScreen,
} from "./model.js";

const SCREEN_ELEMENT = "Screen";

const WIREFRAME_SCHEMA = {
  id: { kind: "string", required: true, nonEmpty: true },
  title: { kind: "string", nonEmpty: true },
  initialScreen: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const SCREEN_SCHEMA = {
  id: { kind: "string", required: true, nonEmpty: true },
  name: { kind: "string", required: true, nonEmpty: true },
  device: { kind: "enum", values: WIREFRAME_DEVICES, required: true },
  pattern: { kind: "enum", values: WIREFRAME_PATTERNS },
  url: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

// One authored navigateTo, kept with its source position so a broken target
// reports on the button that wrote it rather than on the whole wireframe.
type ScreenReference = {
  readonly to: string;
  readonly position: ScopedChild["position"];
};

// Wireframe elements carry their copy in attributes, so any prose inside one
// is content the reader would never see drawn. The exception is an element
// whose body policy declares it reads a fenced block, which owns its own
// diagnostics for what that block must contain.
const rejectProse = ({
  child,
  definition,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly definition: WireframeElementDefinition;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (
    definition.body === "fence" ||
    meaningfulChildren(child.children).length === 0
  ) {
    return;
  }
  diagnostics.add({
    message: `${child.name} carries no prose; screen copy is written as <Text text="..." />`,
    position: child.position,
  });
};

// A list read as prose: "Sidebar, TopBar, or AppContent".
const nameList = (names: ReadonlyArray<string>): string =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

// Reports an element standing somewhere it cannot mean anything: a NavItem
// outside its Nav, or a Panel dropped between an app shell's own regions.
const rejectMisplacement = ({
  child,
  definition,
  parent,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly definition: WireframeElementDefinition;
  readonly parent: {
    readonly name: string;
    readonly allowed?: ReadonlyArray<string>;
  };
  readonly diagnostics: DiagnosticCollector;
}): boolean => {
  if (parent.allowed !== undefined && !parent.allowed.includes(child.name)) {
    diagnostics.add({
      message: `${parent.name} holds only ${nameList(parent.allowed)}; ${child.name} belongs inside one of those`,
      position: child.position,
    });
    return true;
  }
  if (
    definition.allowedParents !== undefined &&
    !definition.allowedParents.includes(parent.name)
  ) {
    diagnostics.add({
      message: `${child.name} belongs inside ${nameList(definition.allowedParents)}, not ${parent.name}`,
      position: child.position,
    });
    return true;
  }
  return false;
};

/** Compiles the elements inside one container in authored order. */
const compileNodes = ({
  children,
  parent,
  diagnostics,
  references,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly parent: {
    readonly name: string;
    readonly allowed?: ReadonlyArray<string>;
  };
  readonly diagnostics: DiagnosticCollector;
  readonly references: Array<ScreenReference>;
}): ReadonlyArray<WireframeNode> =>
  children.flatMap((child) => {
    if (child.name === SCREEN_ELEMENT) {
      diagnostics.add({
        message:
          "Screen is a direct child of Wireframe; it cannot nest inside another element",
        position: child.position,
      });
      return [];
    }
    const definition = wireframeElementFor(child.name);
    if (definition === undefined) {
      diagnostics.add({
        message: `"${child.name}" is not a wireframe element`,
        position: child.position,
      });
      return [];
    }
    if (rejectMisplacement({ child, definition, parent, diagnostics })) {
      return [];
    }
    rejectProse({ child, definition, diagnostics });
    const nested = child.scopedChildren ?? [];
    if (!definition.acceptsChildren && nested.length > 0) {
      diagnostics.add({
        message: `${child.name} holds no elements; it is written self-closing, as ${definition.example}`,
        position: child.position,
      });
    }
    const node = definition.compile({
      attributes: child.attributes,
      body: definition.body === "fence" ? child.children : [],
      children: definition.acceptsChildren
        ? compileNodes({
            children: nested,
            parent: {
              name: child.name,
              ...(definition.allowedChildren === undefined
                ? {}
                : { allowed: definition.allowedChildren }),
            },
            diagnostics,
            references,
          })
        : [],
      position: child.position,
      diagnostics,
    });
    if (
      (node.element === "Button" ||
        node.element === "NavItem" ||
        node.element === "ListItem") &&
      "navigateTo" in node &&
      node.navigateTo !== undefined
    ) {
      references.push({ to: node.navigateTo, position: child.position });
    }
    return [node];
  });

/** Every node in one screen, in authored order, at any depth. */
const flatten = (
  nodes: ReadonlyArray<WireframeNode>,
): ReadonlyArray<WireframeNode> =>
  nodes.flatMap((node) =>
    "children" in node ? [node, ...flatten(node.children)] : [node],
  );

const panelWithSpan = ({
  panel,
  span,
}: {
  readonly panel: Extract<WireframeNode, { readonly element: "Panel" }>;
  readonly span: "fill" | "list" | "main";
}): WireframeNode => ({ ...panel, span });

// A pattern is a convenience expansion into the same open vocabulary authors
// can write by hand. It never introduces a closed region model.
const patternedRow = ({
  pattern,
  panels,
}: {
  readonly pattern: WireframePattern;
  readonly panels: ReadonlyArray<
    Extract<WireframeNode, { readonly element: "Panel" }>
  >;
}): WireframeNode => {
  const [first, second, third] = panels;
  const fallback: Extract<WireframeNode, { readonly element: "Panel" }> = {
    element: "Panel",
    span: "fill",
    surface: "plain",
    children: [],
  };
  const lead = first ?? fallback;
  const main = second ?? fallback;
  const assist = third ?? fallback;
  const children: ReadonlyArray<WireframeNode> =
    pattern === "triage"
      ? [
          panelWithSpan({ panel: lead, span: "list" }),
          panelWithSpan({ panel: main, span: "main" }),
          {
            element: "Rail",
            children: [panelWithSpan({ panel: assist, span: "fill" })],
          },
        ]
      : pattern === "create"
        ? [
            panelWithSpan({ panel: lead, span: "main" }),
            {
              element: "Rail",
              children: [panelWithSpan({ panel: main, span: "fill" })],
            },
          ]
        : [
            panelWithSpan({ panel: lead, span: "list" }),
            panelWithSpan({ panel: main, span: "main" }),
          ];
  return {
    element: "Row",
    gap: "none",
    align: "stretch",
    justify: "start",
    children,
  };
};

const expandPanelSlots = ({
  nodes,
  pattern,
  position,
  diagnostics,
}: {
  readonly nodes: ReadonlyArray<WireframeNode>;
  readonly pattern: WireframePattern;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<WireframeNode> => {
  const expected = pattern === "triage" ? 3 : 2;
  const panels = nodes.filter(
    (node): node is Extract<WireframeNode, { readonly element: "Panel" }> =>
      node.element === "Panel",
  );
  if (panels.length !== expected) {
    diagnostics.add({
      message: `Screen pattern="${pattern}" needs ${expected} direct Panel slots; it found ${panels.length}. Remove pattern to lay the screen out by hand.`,
      position,
    });
    return nodes;
  }
  const firstPanel = nodes.findIndex((node) => node.element === "Panel");
  const withoutPanels = nodes.filter((node) => node.element !== "Panel");
  return [
    ...withoutPanels.slice(0, firstPanel),
    patternedRow({ pattern, panels }),
    ...withoutPanels.slice(firstPanel),
  ];
};

const expandPattern = ({
  nodes,
  pattern,
  position,
  diagnostics,
}: {
  readonly nodes: ReadonlyArray<WireframeNode>;
  readonly pattern: WireframePattern | undefined;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<WireframeNode> => {
  if (pattern === undefined) {
    return nodes;
  }
  const shell = nodes.find((node) => node.element === "AppShell");
  if (shell === undefined || shell.element !== "AppShell") {
    return expandPanelSlots({ nodes, pattern, position, diagnostics });
  }
  return nodes.map((node) =>
    node.element !== "AppShell"
      ? node
      : {
          ...node,
          children: node.children.map((child) =>
            child.element !== "AppContent"
              ? child
              : {
                  ...child,
                  children: expandPanelSlots({
                    nodes: child.children,
                    pattern,
                    position,
                    diagnostics,
                  }),
                },
          ),
        },
  );
};

const childNodes = (node: WireframeNode): ReadonlyArray<WireframeNode> =>
  "children" in node ? node.children : [];

const spanOf = (node: WireframeNode): string | undefined =>
  node.element === "Panel" || node.element === "Stack" ? node.span : undefined;

/** A detail pane that shows content must name the selected record beside it. */
const checkSelection = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const visit = (nodes: ReadonlyArray<WireframeNode>): void => {
    for (const node of nodes) {
      if (node.element === "Row") {
        const rail = node.children.find((child) => child.element === "Rail");
        const dependent =
          node.children.find((child) => spanOf(child) === "main") ?? rail;
        const authoredSource = node.children.find(
          (child) => spanOf(child) === "list",
        );
        const inferredSource =
          dependent === rail
            ? node.children.find(
                (child) =>
                  child !== dependent &&
                  flatten([child]).some(
                    (candidate) =>
                      candidate.element === "List" ||
                      candidate.element === "Table",
                  ),
              )
            : undefined;
        const source = authoredSource ?? inferredSource;
        if (
          source !== undefined &&
          dependent !== undefined &&
          flatten(childNodes(dependent)).length > 0
        ) {
          const sourceNodes = flatten([source]);
          const hasRecords = sourceNodes.some(
            (candidate) =>
              candidate.element === "List" || candidate.element === "Table",
          );
          const selected = sourceNodes.filter(
            (candidate) =>
              (candidate.element === "ListItem" && candidate.selected) ||
              (candidate.element === "Table" &&
                candidate.selected !== undefined),
          );
          if (hasRecords && selected.length !== 1) {
            diagnostics.add({
              message:
                selected.length === 0
                  ? `Screen "${screen.id}" shows detail beside a record list, but no ListItem or Table row is selected`
                  : `Screen "${screen.id}" selects ${selected.length} records beside one detail pane; select exactly one`,
              position,
            });
          }
        }
      }
      visit(childNodes(node));
    }
  };
  visit(screen.children);
};

/** A phone uses its compact shell primitives, never a stacked desktop shell. */
const checkPhoneShell = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (screen.device !== "phone") {
    return;
  }
  const forbidden = flatten(screen.children).filter(
    (node) => node.element === "AppShell" || node.element === "Sidebar",
  );
  if (forbidden.length > 0) {
    diagnostics.add({
      message: `Phone Screen "${screen.id}" cannot contain AppShell or Sidebar; use TopBar, one content column, and BottomBar`,
      position,
    });
  }
};

/** A screen has one filled action; a send action beside a composer counts. */
const checkOneFilledAction = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const all = flatten(screen.children);
  const filled = new Set<WireframeNode>(
    all.filter(
      (node) => node.element === "Button" && node.emphasis === "primary",
    ),
  );
  // BottomBar and SegmentedControl use emphasis="primary" to mark current
  // navigation or mode state. Those buttons are not filled work actions.
  const stateButtons = all
    .filter(
      (node) =>
        node.element === "BottomBar" || node.element === "SegmentedControl",
    )
    .flatMap((node) => flatten(node.children))
    .filter((node) => node.element === "Button");
  stateButtons.forEach((node) => filled.delete(node));
  const markComposerSends = (nodes: ReadonlyArray<WireframeNode>): void => {
    for (const node of nodes) {
      const children = childNodes(node);
      if (children.length > 0) {
        const descendants = flatten(children);
        if (descendants.some((candidate) => candidate.element === "TextArea")) {
          descendants.forEach((candidate) => {
            if (
              candidate.element === "Button" &&
              /^send(?:\s|$)/iu.test(candidate.label)
            ) {
              filled.add(candidate);
            }
          });
        }
        markComposerSends(children);
      }
    }
  };
  markComposerSends(screen.children);
  stateButtons.forEach((node) => filled.delete(node));
  if (filled.size > 1) {
    const labels = [...filled].flatMap((node) =>
      node.element === "Button" ? [node.label] : [],
    );
    diagnostics.add({
      message: `Screen "${screen.id}" draws ${filled.size} filled actions (${labels.join(", ")}); keep one primary action, counting a composer's Send button`,
      position,
    });
  }
};

/** Compiles one Screen and the artboard it holds. */
const compileScreen = ({
  child,
  diagnostics,
  references,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
  readonly references: Array<ScreenReference>;
}): WireframeScreen | undefined => {
  const validated = validateComponentAttributes({
    component: "Screen",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: SCREEN_SCHEMA,
  });
  if (meaningfulChildren(child.children).length > 0) {
    diagnostics.add({
      message:
        'Screen carries no prose; screen copy is written as <Text text="..." />',
      position: child.position,
    });
  }
  // A phone frame has no browser address bar.
  if (validated.url !== undefined && validated.device === "phone") {
    diagnostics.add({
      message: 'Attribute "url" is unavailable on device="phone"',
      position: child.position,
    });
  }
  const authoredChildren = compileNodes({
    children: child.scopedChildren ?? [],
    parent: { name: SCREEN_ELEMENT },
    diagnostics,
    references,
  });
  const children = expandPattern({
    nodes: authoredChildren,
    pattern: validated.pattern,
    position: child.position,
    diagnostics,
  });
  if (children.length === 0) {
    diagnostics.add({
      message: "Screen needs at least one element to draw",
      position: child.position,
    });
  }
  if (validated.id === undefined || validated.name === undefined) {
    return undefined;
  }
  const screen: WireframeScreen = {
    id: validated.id,
    name: validated.name,
    device: validated.device ?? "desktop",
    ...(validated.pattern === undefined ? {} : { pattern: validated.pattern }),
    ...(validated.url === undefined || validated.device === "phone"
      ? {}
      : { url: validated.url }),
    children,
  };
  checkSelection({ screen, position: child.position, diagnostics });
  checkPhoneShell({ screen, position: child.position, diagnostics });
  checkOneFilledAction({ screen, position: child.position, diagnostics });
  return screen;
};

// Every screen id is a navigation target, so a repeat would make one of them
// unreachable rather than merely untidy.
const rejectDuplicateIds = ({
  screens,
  positions,
  diagnostics,
}: {
  readonly screens: ReadonlyArray<WireframeScreen>;
  readonly positions: ReadonlyArray<ScopedChild["position"]>;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const seen = new Set<string>();
  screens.forEach((screen, index) => {
    if (seen.has(screen.id)) {
      diagnostics.add({
        message: `Duplicate Screen id "${screen.id}"; every screen in a wireframe needs its own id`,
        position: positions[index],
      });
    }
    seen.add(screen.id);
  });
};

/** Compiles one Wireframe component into the model consumed by rendering. */
export const compileWireframe = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: ComponentCompilerInput): CompiledWireframe => {
  const validated = validateComponentAttributes({
    component: "Wireframe",
    attributes,
    position,
    diagnostics,
    schema: WIREFRAME_SCHEMA,
  });
  if (meaningfulChildren(children).length > 0) {
    diagnostics.add({
      message:
        "Wireframe holds only Screen children; explain the design in prose around the wireframe",
      position,
    });
  }
  const references: Array<ScreenReference> = [];
  const screenChildren = scopedChildren.filter((child) => {
    if (child.name === SCREEN_ELEMENT) {
      return true;
    }
    diagnostics.add({
      message: `A Wireframe holds only Screen children; move ${child.name} inside a Screen`,
      position: child.position,
    });
    return false;
  });
  const screens = screenChildren.flatMap((child) => {
    const screen = compileScreen({ child, diagnostics, references });
    return screen === undefined ? [] : [screen];
  });
  if (screens.length === 0) {
    diagnostics.add({
      message: 'Wireframe needs at least one <Screen id="..." name="..." />',
      position,
    });
  }
  rejectDuplicateIds({
    screens,
    positions: screenChildren.map((child) => child.position),
    diagnostics,
  });

  const screenIds = new Set(screens.map((screen) => screen.id));
  const available = [...screenIds].join(", ");
  for (const reference of references) {
    if (!screenIds.has(reference.to)) {
      diagnostics.add({
        message: `navigateTo "${reference.to}" names no screen in this wireframe; available screens: ${available}`,
        position: reference.position,
      });
    }
  }
  const firstScreen = screens[0];
  if (
    validated.initialScreen !== undefined &&
    !screenIds.has(validated.initialScreen)
  ) {
    diagnostics.add({
      message: `initialScreen "${validated.initialScreen}" names no screen in this wireframe; available screens: ${available}`,
      position,
    });
  }

  return {
    id: validated.id ?? "",
    ...(validated.title === undefined ? {} : { title: validated.title }),
    initialScreenId:
      validated.initialScreen !== undefined &&
      screenIds.has(validated.initialScreen)
        ? validated.initialScreen
        : (firstScreen?.id ?? ""),
    screens,
  };
};
