// Fences the invariant `screenLayers` exists for: a rule that counts controls
// across a screen counts them one layer at a time, because only one layer is
// answerable at a time. Four separate checks have reached across that boundary
// during this vocabulary's life, each found by reading the code, so this
// asserts the property itself rather than any one call site: content that
// compiles clean on the page and content that compiles clean inside an overlay
// must still compile clean when the same screen draws both. A future check
// that counts that screen's controls across layers fails here without anyone
// having to notice it. It reaches what one screen holds; a rule that counts
// across the layers of a screen it navigated to needs its own case, because a
// fragment cannot be pasted onto the destination it points at.

import type { ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import type { ScopedChild } from "../_authoring/contract.js";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import { WIREFRAME_COMPONENT_DEFINITION } from "./definition.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 20 },
  end: { line: 30, column: 12, offset: 900 },
};

const element = ({
  name,
  attributes = {},
  children = [],
}: {
  readonly name: string;
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ScopedChild>;
}): ScopedChild => ({
  name,
  attributes,
  children: [] as ReadonlyArray<ElementContent>,
  ...(children.length === 0 ? {} : { scopedChildren: children }),
  position: POSITION,
});

const compile = (screens: ReadonlyArray<ScopedChild>) => {
  const diagnostics = createDiagnosticCollector();
  WIREFRAME_COMPONENT_DEFINITION.compile({
    attributes: { id: "wf" },
    children: [],
    scopedChildren: screens,
    position: POSITION,
    diagnostics,
  });
  return diagnostics.diagnostics.map((entry) => entry.message);
};

// One piece of screen content, plus whatever other screens it needs to resolve.
// Each is written so it is valid on its own, on either layer.
type Fragment = {
  readonly name: string;
  readonly nodes: ReadonlyArray<ScopedChild>;
  readonly screens: ReadonlyArray<ScopedChild>;
};

const screen = ({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReadonlyArray<ScopedChild>;
}): ScopedChild =>
  element({
    name: "Screen",
    attributes: { id, name: id, device: "tablet" },
    children,
  });

type Choice = "purchase" | "loan";

const CHOICES: ReadonlyArray<{
  readonly name: Choice;
  readonly title: string;
  readonly description: string;
}> = [
  {
    name: "purchase",
    title: "Ask about a purchase",
    description: "See how much money I would have left",
  },
  {
    name: "loan",
    title: "Ask about my loan",
    description: "See what I owe and ask a question",
  },
];

const choiceGroup = (selected?: Choice): ScopedChild =>
  element({
    name: "ChoiceGroup",
    children: CHOICES.map(({ name, title, description }) =>
      element({
        name: "ChoiceCard",
        attributes: {
          title,
          description,
          ...(name === selected
            ? { selected: true }
            : { navigateTo: `${name}-picked` }),
        },
      }),
    ),
  });

const DECISION: Fragment = {
  name: "a decision",
  nodes: [choiceGroup()],
  screens: CHOICES.map(({ name }) =>
    screen({
      id: `${name}-picked`,
      children: [
        choiceGroup(name),
        element({
          name: "Button",
          attributes: { label: "Continue", emphasis: "primary" },
        }),
      ],
    }),
  ),
};

const FRAGMENTS: ReadonlyArray<Fragment> = [
  {
    name: "a page header",
    nodes: [element({ name: "PageHeader", attributes: { title: "Plans" } })],
    screens: [],
  },
  {
    name: "a filled action",
    nodes: [
      element({
        name: "Button",
        attributes: { label: "Rename", emphasis: "primary" },
      }),
    ],
    screens: [],
  },
  DECISION,
];

// An overlay owes its reader a way out, so every overlay layer carries one.
const OVERLAY_EXIT = element({
  name: "Button",
  attributes: { label: "Close", emphasis: "tertiary" },
});

const planFor = ({
  page,
  overlay,
}: {
  readonly page?: Fragment;
  readonly overlay?: Fragment;
}): ReadonlyArray<ScopedChild> => {
  const destinations = new Map(
    [...(page?.screens ?? []), ...(overlay?.screens ?? [])].map(
      (destination) => [String(destination.attributes["id"]), destination],
    ),
  );
  return [
    screen({
      id: "home",
      children: [
        element({
          name: "Panel",
          attributes: { title: "Plans" },
          children: [element({ name: "Text", attributes: { text: "One" } })],
        }),
        ...(page?.nodes ?? []),
        ...(overlay === undefined
          ? []
          : [
              element({
                name: "Overlay",
                attributes: { title: "Rename" },
                children: [...overlay.nodes, OVERLAY_EXIT],
              }),
            ]),
      ],
    }),
    ...destinations.values(),
  ];
};

describe("screen layers", () => {
  it("should keep every fragment valid on its own layer", () => {
    for (const fragment of FRAGMENTS) {
      expect(compile(planFor({ page: fragment }))).toEqual([]);
      expect(compile(planFor({ overlay: fragment }))).toEqual([]);
    }
  });

  it.each(
    FRAGMENTS.flatMap((page) =>
      FRAGMENTS.map((overlay) => ({
        page,
        overlay,
        label: `${page.name} on the page and ${overlay.name} in an overlay`,
      })),
    ),
  )("should accept $label", ({ page, overlay }) => {
    expect(compile(planFor({ page, overlay }))).toEqual([]);
  });
});
