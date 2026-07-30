// Tests Wireframe's authoring contract: where an element may stand, the
// references that must resolve before a document can offer a dead action, and
// the markup and navigation data the view emits for each screen.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import type { ScopedChild } from "../_authoring/contract.js";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { WIREFRAME_COMPONENT_DEFINITION } from "./definition.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 20 },
  end: { line: 30, column: 12, offset: 900 },
};

const CHILD_POSITION = {
  start: { line: 5, column: 1, offset: 40 },
  end: { line: 12, column: 10, offset: 200 },
};

const element = ({
  name,
  attributes = {},
  children = [],
  body = [],
}: {
  readonly name: string;
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ScopedChild>;
  readonly body?: ReadonlyArray<ElementContent>;
}): ScopedChild => ({
  name,
  attributes,
  children: body,
  ...(children.length === 0 ? {} : { scopedChildren: children }),
  position: CHILD_POSITION,
});

const screen = ({
  id,
  name = "A screen",
  children,
  attributes = {},
}: {
  readonly id: string;
  readonly name?: string;
  readonly children: ReadonlyArray<ScopedChild>;
  readonly attributes?: Readonly<Record<string, string | boolean>>;
}): ScopedChild =>
  element({
    name: "Screen",
    attributes: { id, name, ...attributes },
    children,
  });

const compile = ({
  attributes = { id: "wf" },
  scopedChildren = [],
  children = [],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
  readonly children?: ReadonlyArray<ElementContent>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const compiled = WIREFRAME_COMPONENT_DEFINITION.compile({
    attributes,
    children,
    scopedChildren,
    position: POSITION,
    diagnostics,
  });
  return { compiled, diagnostics: diagnostics.diagnostics };
};

const render = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const html = (node: Element): string => JSON.stringify(node);

const HOME = screen({
  id: "home",
  name: "Wallet home",
  children: [
    element({
      name: "Panel",
      attributes: { title: "Balance" },
      children: [
        element({ name: "Text", attributes: { text: "$42.50" } }),
        element({
          name: "Button",
          attributes: { label: "Start lesson", navigateTo: "lesson" },
        }),
      ],
    }),
  ],
});

const LESSON = screen({
  id: "lesson",
  name: "Loan lesson",
  children: [element({ name: "Text", attributes: { text: "Lesson 3 of 6" } })],
});

describe("WIREFRAME_COMPONENT_DEFINITION", () => {
  it("should compile a two-screen prototype when every reference resolves", () => {
    const { compiled, diagnostics } = compile({
      attributes: {
        id: "wallet",
        title: "Child mode",
        initialScreen: "lesson",
      },
      scopedChildren: [HOME, LESSON],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model).toEqual({
      id: "wallet",
      title: "Child mode",
      initialScreenId: "lesson",
      screens: [
        {
          id: "home",
          name: "Wallet home",
          viewport: "desktop",
          children: [
            {
              element: "Panel",
              title: "Balance",
              children: [
                { element: "Text", text: "$42.50", role: "body" },
                {
                  element: "Button",
                  label: "Start lesson",
                  emphasis: "secondary",
                  navigateTo: "lesson",
                },
              ],
            },
          ],
        },
        {
          id: "lesson",
          name: "Loan lesson",
          viewport: "desktop",
          children: [{ element: "Text", text: "Lesson 3 of 6", role: "body" }],
        },
      ],
    });
  });

  it("should start on the first screen when initialScreen is not authored", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [HOME, LESSON],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model).toMatchObject({ initialScreenId: "home" });
  });

  it("should report the screen a button names when it does not exist", () => {
    const { diagnostics } = compile({ scopedChildren: [HOME] });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          'navigateTo "lesson" names no screen in this wireframe; available screens: home',
      },
    ]);
  });

  it("should report an initialScreen that names no screen", () => {
    const { compiled, diagnostics } = compile({
      attributes: { id: "wf", initialScreen: "settings" },
      scopedChildren: [LESSON],
    });
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          'initialScreen "settings" names no screen in this wireframe; available screens: lesson',
      },
    ]);
    // The reader still gets a screen: a broken reference falls back rather
    // than rendering an empty block.
    expect(compiled.model).toMatchObject({ initialScreenId: "lesson" });
  });

  it("should report a repeated screen id", () => {
    const { diagnostics } = compile({ scopedChildren: [LESSON, LESSON] });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          'Duplicate Screen id "lesson"; every screen in a wireframe needs its own id',
      },
    ]);
  });

  it("should report an element written directly inside the wireframe", () => {
    const { diagnostics } = compile({
      scopedChildren: [element({ name: "Panel" }), LESSON],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          "A Wireframe holds only Screen children; move Panel inside a Screen",
      },
    ]);
  });

  it("should report a screen nested inside an element", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [element({ name: "Stack", children: [LESSON] })],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          "Screen is a direct child of Wireframe; it cannot nest inside another element",
      },
    ]);
  });

  it("should report elements nested inside a leaf element", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Text",
              attributes: { text: "Hello" },
              children: [
                element({ name: "Button", attributes: { label: "x" } }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          'Text holds no elements; it is written self-closing, as <Text text="You have four tasks left today." />',
      },
    ]);
  });

  it("should report prose written inside a wireframe element", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Panel",
              body: [
                {
                  type: "element",
                  tagName: "p",
                  properties: {},
                  children: [{ type: "text", value: "A note" }],
                },
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          'Panel carries no prose; screen copy is written as <Text text="..." />',
      },
    ]);
  });

  it("should report a wireframe with no screens", () => {
    const { diagnostics } = compile();
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Wireframe needs at least one <Screen id="..." name="..." />',
      },
    ]);
  });

  it("should report an unknown token rather than silently defaulting", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          attributes: { viewport: "watch" },
          children: [element({ name: "Text", attributes: { text: "Hi" } })],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          'Invalid value for attribute "viewport"; expected one of: mobile-portrait, mobile-landscape, tablet-portrait, tablet-landscape, desktop',
      },
    ]);
  });

  it("should report an element dropped between the app shell's own regions", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "AppShell",
              children: [element({ name: "Panel" })],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          "AppShell holds only Sidebar, TopBar or AppContent; Panel belongs inside one of those",
      },
    ]);
  });

  it("should report a navigation item written outside its navigation", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Panel",
              children: [
                element({ name: "NavItem", attributes: { label: "Wallet" } }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message: "NavItem belongs inside Nav, not Panel",
      },
    ]);
  });

  it("should resolve a navigation item's screen the same way a button's is resolved", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Nav",
              children: [
                element({
                  name: "NavItem",
                  attributes: { label: "Settings", navigateTo: "settings" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          'navigateTo "settings" names no screen in this wireframe; available screens: home',
      },
    ]);
  });

  it("should draw progress in fixed steps and always write the number beside it", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Progress",
              attributes: { label: "Goal", value: "61" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-progress":"60"');
    expect(rendered).toContain("61");
    // No authored value ever reaches a style attribute.
    expect(rendered).not.toContain('"style"');
  });

  it("should mark only the initial screen current so an inert document shows every screen", () => {
    const { compiled } = compile({ scopedChildren: [HOME, LESSON] });
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-screen":"home"');
    expect(rendered).toContain('"data-wireframe-screen":"lesson"');
    expect(rendered.match(/"data-wireframe-current"/gu)).toHaveLength(1);
  });

  it("should render an action as navigation data rather than script", () => {
    const { compiled } = compile({ scopedChildren: [HOME, LESSON] });
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-navigate":"lesson"');
    expect(rendered).not.toContain("onClick");
    expect(rendered).not.toContain("<script");
  });

  it("should draw each control as its own semantic element", () => {
    const { compiled } = compile({ scopedChildren: [HOME, LESSON] });
    const rendered = html(render(compiled));
    expect(rendered).toContain('"tagName":"button"');
    expect(rendered).toContain('"tagName":"h4"');
    expect(rendered).toContain('"type":"button"');
  });
});
