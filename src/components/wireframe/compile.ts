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
  WIREFRAME_CHROMES,
  WIREFRAME_VIEWPORTS,
  type CompiledWireframe,
  type WireframeNode,
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
  viewport: { kind: "enum", values: WIREFRAME_VIEWPORTS },
  chrome: { kind: "enum", values: WIREFRAME_CHROMES },
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
      (node.element === "Button" || node.element === "NavItem") &&
      node.navigateTo !== undefined
    ) {
      references.push({ to: node.navigateTo, position: child.position });
    }
    return [node];
  });

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
  // An address only means something inside a browser frame; anywhere else it
  // would be drawn nowhere and quietly lost.
  if (validated.url !== undefined && validated.chrome !== "browser") {
    diagnostics.add({
      message:
        'Attribute "url" needs chrome="browser"; only a browser frame has an address bar',
      position: child.position,
    });
  }
  const children = compileNodes({
    children: child.scopedChildren ?? [],
    parent: { name: SCREEN_ELEMENT },
    diagnostics,
    references,
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
  return {
    id: validated.id,
    name: validated.name,
    viewport: validated.viewport ?? "desktop",
    chrome: validated.chrome ?? "none",
    ...(validated.url === undefined || validated.chrome !== "browser"
      ? {}
      : { url: validated.url }),
    children,
  };
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
