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
  COLLECTIONS,
  FLEXIBLE_PANES,
  NEVER_GROUPED,
  flattenNodes,
  paneSiblings,
  workActionButtons,
} from "./nodes.js";
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
// reports on the control that wrote it rather than on the whole wireframe.
type ScreenReference = {
  readonly from: string;
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
  sourceScreenId,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly parent: {
    readonly name: string;
    readonly allowed?: ReadonlyArray<string>;
  };
  readonly diagnostics: DiagnosticCollector;
  readonly references: Array<ScreenReference>;
  readonly sourceScreenId: string | undefined;
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
            sourceScreenId,
          })
        : [],
      position: child.position,
      diagnostics,
    });
    if (
      sourceScreenId !== undefined &&
      "navigateTo" in node &&
      node.navigateTo !== undefined
    ) {
      references.push({
        from: sourceScreenId,
        to: node.navigateTo,
        position: child.position,
      });
    }
    return [node];
  });

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
    surface: "plain",
    children: [],
  };
  const lead = first ?? fallback;
  const main = second ?? fallback;
  const assist = third ?? fallback;
  const children: ReadonlyArray<WireframeNode> =
    pattern === "triage"
      ? [
          lead,
          main,
          {
            element: "Rail",
            children: [assist],
          },
        ]
      : pattern === "create"
        ? [
            lead,
            {
              element: "Rail",
              children: [main],
            },
          ]
        : pattern === "settings"
          ? [
              {
                element: "Rail",
                children: [lead],
              },
              main,
            ]
          : [lead, main];
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
  if (!shell.children.some((child) => child.element === "AppContent")) {
    expandPanelSlots({ nodes: [], pattern, position, diagnostics });
    return nodes;
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

const containsElement = ({
  node,
  element,
}: {
  readonly node: WireframeNode;
  readonly element: WireframeNode["element"];
}): boolean =>
  node.element === element ||
  childNodes(node).some((child) => containsElement({ node: child, element }));

const containsRecordCollection = (node: WireframeNode): boolean =>
  node.element === "Panel" &&
  node.children.some(
    (candidate) =>
      candidate.element === "List" || candidate.element === "Table",
  );

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
        const siblings = paneSiblings(node.children);
        const source = siblings.find(containsRecordCollection);
        const sourceIndex =
          source === undefined ? -1 : siblings.indexOf(source);
        const following = siblings.slice(sourceIndex + 1);
        const dependent =
          following.find((child) => child.element !== "Rail") ??
          following.find((child) => child.element === "Rail");
        if (
          source !== undefined &&
          dependent !== undefined &&
          flattenNodes(childNodes(dependent)).length > 0
        ) {
          const sourceNodes = flattenNodes([source]);
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

/**
 * A Group clusters loose controls; it never holds a pane or a collection.
 *
 * A Group is a run of items that travel together as one item of a row, so a
 * Group holding a region would have to be both that one travelling item and
 * the region itself. Only the first meaning survives, wherever the Group
 * stands: a Group with no Row around it draws its contents side by side with
 * none of the row rules and none of the device column budget that keep them
 * readable, which is the same layout refused here for the same reason. The
 * outermost Group reports, because a region reached through several Groups is
 * still one mistake.
 */
const checkGroupedPanes = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const visit = ({
    nodes,
    insideGroup,
  }: {
    readonly nodes: ReadonlyArray<WireframeNode>;
    readonly insideGroup: boolean;
  }): void => {
    for (const node of nodes) {
      if (node.element === "Group") {
        const region = insideGroup
          ? undefined
          : paneSiblings(node.children).find((candidate) =>
              NEVER_GROUPED.has(candidate.element),
            );
        if (region !== undefined) {
          const remedy = COLLECTIONS.has(region.element)
            ? `Write the ${region.element} directly in the Stack or Row that should lay it out instead of wrapping it in a Group`
            : `Panes are direct children of a Row: write the ${region.element} as a child of a Row and use the Row gap and justify to space the panes`;
          diagnostics.add({
            message: `Screen "${screen.id}": a Group holds a ${region.element}, but a Group clusters loose controls - buttons, text, badges - so they travel together as one item of a row. ${remedy}`,
            position,
          });
        }
        visit({ nodes: node.children, insideGroup: true });
        continue;
      }
      visit({ nodes: childNodes(node), insideGroup: false });
    }
  };
  visit({ nodes: screen.children, insideGroup: false });
};

/** Three flexible desktop panes create equal thirds; a Rail owns secondary width. */
const checkEqualThirds = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  if (screen.device !== "desktop") {
    return;
  }
  const visit = (nodes: ReadonlyArray<WireframeNode>): void => {
    for (const node of nodes) {
      if (node.element === "Row") {
        const siblings = paneSiblings(node.children);
        const flexible = siblings.filter((child) =>
          FLEXIBLE_PANES.has(child.element),
        );
        const hasRail = siblings.some((child) => child.element === "Rail");
        if (flexible.length >= 3 && !hasRail) {
          diagnostics.add({
            message: `Desktop Screen "${screen.id}" draws ${flexible.length} flexible panes in one Row; keep the primary surface dominant and wrap secondary content in Rail`,
            position,
          });
        }
      }
      visit(childNodes(node));
    }
  };
  visit(screen.children);
};

/** A screen spends boxes on cards, never on an entire group of sibling regions. */
const checkOutlinedSiblingBudget = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const visit = (nodes: ReadonlyArray<WireframeNode>): void => {
    const siblings = paneSiblings(nodes);
    const outlined = siblings.filter(
      (node) => node.element === "Panel" && node.surface === "outlined",
    );
    if (outlined.length >= 4) {
      diagnostics.add({
        message: `Screen "${screen.id}" outlines ${outlined.length} sibling Panels; keep regions plain and spend boxes only on elements that behave like cards`,
        position,
      });
    }
    siblings.forEach((node) => visit(childNodes(node)));
  };
  visit(screen.children);
};

/**
 * A small choice is one dominant touch interaction, not a record workspace.
 *
 * ChoiceGroup is deliberately a deep primitive: once an author names this
 * intent, the compiler owns selection timing and composition while the view
 * owns touch treatment.
 */
const checkChoiceComposition = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const all = flattenNodes(screen.children);
  const groups = all.filter((node) => node.element === "ChoiceGroup");
  if (groups.length === 0) {
    return;
  }
  const selected = groups.flatMap((group) =>
    group.children.filter(
      (node) => node.element === "ChoiceCard" && node.selected,
    ),
  );
  if (selected.length > 1) {
    diagnostics.add({
      message: `Screen "${screen.id}" selects ${selected.length} ChoiceCards; a simple decision shows at most one deliberate selection`,
      position,
    });
  }
  const primaryActions = workActionButtons(screen.children).filter(
    (node) => node.element === "Button" && node.emphasis === "primary",
  );
  if (selected.length === 0 && primaryActions.length > 0) {
    diagnostics.add({
      message: `Screen "${screen.id}" shows a primary continuation before any ChoiceCard is selected; hide it until a deliberate tap reveals the selected state`,
      position,
    });
  }
  if (selected.length === 1 && primaryActions.length === 0) {
    diagnostics.add({
      message: `Screen "${screen.id}" selects a ChoiceCard but offers no primary continuation; add one short next action after the deliberate choice`,
      position,
    });
  }
  if (screen.device !== "tablet" && screen.device !== "tablet-portrait") {
    return;
  }
  const visit = (nodes: ReadonlyArray<WireframeNode>): void => {
    for (const node of nodes) {
      const siblings =
        node.element === "Row" ? paneSiblings(node.children) : [];
      if (
        siblings.length > 1 &&
        siblings.some((child) =>
          containsElement({ node: child, element: "ChoiceGroup" }),
        )
      ) {
        diagnostics.add({
          message: `Tablet Screen "${screen.id}" puts a ChoiceGroup beside a competing region; the decision must dominate one centered column, never a miniature list-and-inspector workspace`,
          position,
        });
      }
      visit(childNodes(node));
    }
  };
  visit(screen.children);
};

/**
 * Every unselected touch option must reveal the state for that same option.
 *
 * This is checked after all screens compile because a static prototype models
 * selection as navigation to a deliberate selected-state screen.
 */
const checkChoiceNavigation = ({
  screens,
  positions,
  fallbackPosition,
  diagnostics,
}: {
  readonly screens: ReadonlyArray<WireframeScreen>;
  readonly positions: ReadonlyArray<ScopedChild>;
  readonly fallbackPosition: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  const positionFor = (screen: WireframeScreen): ScopedChild["position"] =>
    positions.find((child) => child.attributes.id === screen.id)?.position ??
    fallbackPosition;

  for (const screen of screens) {
    const groups = flattenNodes(screen.children).filter(
      (node) => node.element === "ChoiceGroup",
    );
    for (const group of groups) {
      const choices = group.children.filter(
        (node) => node.element === "ChoiceCard",
      );
      for (const choice of choices.filter((candidate) => !candidate.selected)) {
        if (choice.navigateTo === undefined) {
          diagnostics.add({
            message: `ChoiceCard "${choice.title}" on Screen "${screen.id}" has no selected-state destination; make the whole option reveal a screen that selects this same choice`,
            position: positionFor(screen),
          });
          continue;
        }
        const destination = byId.get(choice.navigateTo);
        if (destination === undefined) {
          continue;
        }
        const selectedChoices = flattenNodes(destination.children).flatMap(
          (node) =>
            node.element === "ChoiceCard" && node.selected ? [node] : [],
        );
        const selectedChoice = selectedChoices[0];
        if (
          selectedChoices.length !== 1 ||
          selectedChoice?.title !== choice.title ||
          selectedChoice?.description !== choice.description
        ) {
          diagnostics.add({
            message: `ChoiceCard "${choice.title}" on Screen "${screen.id}" navigates to "${choice.navigateTo}" without selecting that same title and consequence; every option needs its own truthful visible outcome`,
            position: positionFor(screen),
          });
        }
      }
    }
  }
};

/** Multiple page-level headers make one screen claim more than one clear job. */
const checkOneClearJob = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const pageHeaders = flattenNodes(screen.children).filter(
    (node) => node.element === "PageHeader",
  );
  if (pageHeaders.length > 1) {
    diagnostics.add({
      message: `Screen "${screen.id}" draws ${pageHeaders.length} PageHeaders; keep one page-level job and move the other task into another Screen`,
      position,
    });
  }
};

/** Progress has one present step, with completed work before work still ahead. */
const checkStepperState = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const steppers = flattenNodes(screen.children).filter(
    (node) => node.element === "Stepper",
  );
  for (const stepper of steppers) {
    const steps = stepper.children.filter((node) => node.element === "Step");
    const currentIndexes = steps.flatMap((step, index) =>
      step.element === "Step" && step.state === "current" ? [index] : [],
    );
    if (currentIndexes.length !== 1) {
      diagnostics.add({
        message: `Screen "${screen.id}" Stepper needs exactly one current Step; found ${currentIndexes.length}`,
        position,
      });
      continue;
    }
    const currentIndex = currentIndexes[0] ?? -1;
    const ordered = steps.every(
      (step, index) =>
        step.element === "Step" &&
        step.state ===
          (index < currentIndex
            ? "done"
            : index === currentIndex
              ? "current"
              : "todo"),
    );
    if (!ordered) {
      diagnostics.add({
        message: `Screen "${screen.id}" Stepper state must read done, then one current, then todo`,
        position,
      });
    }
  }
};

/**
 * An overlay covers a page, and exactly one at a time.
 *
 * Two stacked modals is not a design a reviewer can judge; it is what a
 * drawing shows when a screen tried to depict two moments at once, and each of
 * those moments is its own Screen. An overlay with nothing under it is the same
 * mistake from the other side: the page it is meant to interrupt was never
 * drawn, so the reviewer cannot see what the interruption costs.
 */
const checkOverlay = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const overlays = screen.children.filter((node) => node.element === "Overlay");
  if (overlays.length === 0) {
    return;
  }
  if (overlays.length > 1) {
    diagnostics.add({
      message: `Screen "${screen.id}" draws ${overlays.length} Overlays; one screen shows one moment, so give the second one its own Screen`,
      position,
    });
  }
  if (overlays.length === screen.children.length) {
    diagnostics.add({
      message: `Screen "${screen.id}" is an Overlay with no page under it; draw the screen it interrupts so a reviewer can see what the interruption covers`,
      position,
    });
  }
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
  const forbidden = flattenNodes(screen.children).filter(
    (node) => node.element === "AppShell" || node.element === "Sidebar",
  );
  if (forbidden.length > 0) {
    diagnostics.add({
      message: `Phone Screen "${screen.id}" cannot contain AppShell or Sidebar; use TopBar, one content column, and BottomBar`,
      position,
    });
  }
};

/** The filled actions one layer draws; a send action beside a composer counts. */
const filledActionsIn = (
  nodes: ReadonlyArray<WireframeNode>,
): ReadonlySet<WireframeNode> => {
  const filled = new Set<WireframeNode>(
    workActionButtons(nodes).filter(
      (node) => node.element === "Button" && node.emphasis === "primary",
    ),
  );
  const sendActions = (
    candidates: ReadonlyArray<WireframeNode>,
  ): ReadonlyArray<WireframeNode> =>
    workActionButtons(candidates).filter(
      (node) => node.element === "Button" && /^send(?:\s|$)/iu.test(node.label),
    );
  const markComposerSends = ({
    nodes: layer,
    ancestors,
  }: {
    readonly nodes: ReadonlyArray<WireframeNode>;
    readonly ancestors: ReadonlyArray<ReadonlyArray<WireframeNode>>;
  }): void => {
    if (layer.some((candidate) => candidate.element === "TextArea")) {
      const container = [layer, ...ancestors].find(
        (candidate) => sendActions(candidate).length > 0,
      );
      sendActions(container ?? []).forEach((candidate) =>
        filled.add(candidate),
      );
    }
    for (const node of layer) {
      const children = childNodes(node);
      if (children.length > 0) {
        markComposerSends({
          nodes: children,
          ancestors: [layer, ...ancestors],
        });
      }
    }
  };
  if (nodes.some((candidate) => candidate.element === "TextArea")) {
    sendActions(nodes).forEach((candidate) => filled.add(candidate));
  }
  nodes.forEach((node) => {
    const children = childNodes(node);
    if (children.length > 0) {
      markComposerSends({ nodes: children, ancestors: [] });
    }
  });
  return filled;
};

/**
 * Each layer of a screen has one filled action.
 *
 * An overlay is counted on its own rather than with the page it covers,
 * because only one of the two layers is answerable at a time: the page's
 * primary action is exactly what the overlay took away. Counting them together
 * would force an author to demote the confirm button on a dialog, which is the
 * opposite of the honest drawing.
 */
const checkOneFilledAction = ({
  screen,
  position,
  diagnostics,
}: {
  readonly screen: WireframeScreen;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const overlays = screen.children.filter((node) => node.element === "Overlay");
  const layers: ReadonlyArray<{
    readonly where: string;
    readonly nodes: ReadonlyArray<WireframeNode>;
  }> = [
    {
      where: "",
      nodes: screen.children.filter((node) => node.element !== "Overlay"),
    },
    ...overlays.map((overlay) => ({
      where: " Overlay",
      nodes: childNodes(overlay),
    })),
  ];
  for (const layer of layers) {
    const filled = filledActionsIn(layer.nodes);
    if (filled.size > 1) {
      const labels = [...filled].flatMap((node) =>
        node.element === "Button" ? [node.label] : [],
      );
      diagnostics.add({
        message: `Screen "${screen.id}"${layer.where} draws ${filled.size} filled actions (${labels.join(", ")}); keep one primary action, counting a composer's Send button`,
        position,
      });
    }
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
  // Browser chrome belongs to desktop web SaaS. Tablet owns a native device
  // frame, and phone owns its compact handset frame.
  if (validated.url !== undefined && validated.device !== "desktop") {
    diagnostics.add({
      message: `Attribute "url" is unavailable on device="${validated.device ?? "desktop"}"; browser chrome belongs only to device="desktop"`,
      position: child.position,
    });
  }
  const authoredChildren = compileNodes({
    children: child.scopedChildren ?? [],
    parent: { name: SCREEN_ELEMENT },
    diagnostics,
    references,
    sourceScreenId: validated.id,
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
    ...(validated.url === undefined || validated.device !== "desktop"
      ? {}
      : { url: validated.url }),
    children,
  };
  checkGroupedPanes({ screen, position: child.position, diagnostics });
  checkSelection({ screen, position: child.position, diagnostics });
  checkEqualThirds({ screen, position: child.position, diagnostics });
  checkOutlinedSiblingBudget({
    screen,
    position: child.position,
    diagnostics,
  });
  checkChoiceComposition({ screen, position: child.position, diagnostics });
  checkOneClearJob({ screen, position: child.position, diagnostics });
  checkStepperState({ screen, position: child.position, diagnostics });
  checkPhoneShell({ screen, position: child.position, diagnostics });
  checkOverlay({ screen, position: child.position, diagnostics });
  checkOneFilledAction({ screen, position: child.position, diagnostics });
  return screen;
};

// Every screen id is a navigation target, so a repeat would make one of them
// unreachable rather than merely untidy.
const rejectDuplicateIds = ({
  screens,
  diagnostics,
}: {
  readonly screens: ReadonlyArray<{
    readonly screen: WireframeScreen;
    readonly position: ScopedChild["position"];
  }>;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const seen = new Set<string>();
  for (const { screen, position } of screens) {
    if (seen.has(screen.id)) {
      diagnostics.add({
        message: `Duplicate Screen id "${screen.id}"; every screen in a wireframe needs its own id`,
        position,
      });
    }
    seen.add(screen.id);
  }
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
  const compiledScreens = screenChildren.flatMap((child) => {
    const screen = compileScreen({ child, diagnostics, references });
    return screen === undefined ? [] : [{ screen, position: child.position }];
  });
  const screens = compiledScreens.map((entry) => entry.screen);
  if (screens.length === 0) {
    diagnostics.add({
      message: 'Wireframe needs at least one <Screen id="..." name="..." />',
      position,
    });
  }
  rejectDuplicateIds({ screens: compiledScreens, diagnostics });

  const screenIds = new Set(screens.map((screen) => screen.id));
  const available = [...screenIds].join(", ");
  for (const reference of references) {
    if (!screenIds.has(reference.to)) {
      diagnostics.add({
        message: `navigateTo "${reference.to}" names no screen in this wireframe; available screens: ${available}`,
        position: reference.position,
      });
    } else if (reference.to === reference.from) {
      diagnostics.add({
        message: `navigateTo "${reference.to}" names its own screen; choose another screen in this wireframe`,
        position: reference.position,
      });
    }
  }
  checkChoiceNavigation({
    screens,
    positions: screenChildren,
    fallbackPosition: position,
    diagnostics,
  });
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
  const initialScreenId =
    validated.initialScreen !== undefined &&
    screenIds.has(validated.initialScreen)
      ? validated.initialScreen
      : (firstScreen?.id ?? "");
  const initialScreen = screens.find((screen) => screen.id === initialScreenId);
  const selectedInitialChoices =
    initialScreen === undefined
      ? []
      : flattenNodes(initialScreen.children).filter(
          (node) => node.element === "ChoiceCard" && node.selected,
        );
  if (selectedInitialChoices.length > 0) {
    diagnostics.add({
      message: `Initial Screen "${initialScreenId}" preselects a consequential ChoiceCard; start unselected and reveal the selected state only after a deliberate tap`,
      position:
        screenChildren.find((child) => child.attributes.id === initialScreenId)
          ?.position ?? position,
    });
  }

  return {
    id: validated.id ?? "",
    ...(validated.title === undefined ? {} : { title: validated.title }),
    initialScreenId,
    screens,
  };
};
