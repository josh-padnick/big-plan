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

const fence = (source: string): ElementContent => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "code",
      properties: {},
      children: [{ type: "text", value: source }],
    },
  ],
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
    attributes: { id, name, device: "desktop", ...attributes },
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

type ChoiceName = "purchase" | "loan";

const choiceGroup = (selected?: ChoiceName): ScopedChild =>
  element({
    name: "ChoiceGroup",
    children: [
      element({
        name: "ChoiceCard",
        attributes: {
          icon: "⚽",
          title: "Ask about a purchase",
          description: "See how much money I would have left",
          ...(selected === "purchase"
            ? { selected: true }
            : { navigateTo: "purchase-selected" }),
        },
      }),
      element({
        name: "ChoiceCard",
        attributes: {
          icon: "💵",
          title: "Ask about my loan",
          description: "See what I owe and ask a question",
          ...(selected === "loan"
            ? { selected: true }
            : { navigateTo: "loan-selected" }),
        },
      }),
    ],
  });

const selectedChoiceScreen = (selected: ChoiceName): ScopedChild =>
  screen({
    id: `${selected}-selected`,
    name: `${selected} selected`,
    attributes: { device: "tablet" },
    children: [
      choiceGroup(selected),
      element({
        name: "Button",
        attributes: { label: "Continue", emphasis: "primary" },
      }),
    ],
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
          device: "desktop",

          children: [
            {
              element: "Panel",
              title: "Balance",
              surface: "plain",
              children: [
                { element: "Text", text: "$42.50", role: "body" },
                {
                  element: "Button",
                  label: "Start lesson",
                  emphasis: "secondary",
                  iconOnly: false,
                  navigateTo: "lesson",
                },
              ],
            },
          ],
        },
        {
          id: "lesson",
          name: "Loan lesson",
          device: "desktop",

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

  it("should resolve navigation on every element that can carry it", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Breadcrumbs",
              children: [
                element({
                  name: "Crumb",
                  attributes: { label: "Missing", navigateTo: "missing" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'navigateTo "missing" names no screen in this wireframe; available screens: home',
    ]);
  });

  it("should reject navigation to the source screen", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Button",
              attributes: { label: "Stay here", navigateTo: "home" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'navigateTo "home" names its own screen; choose another screen in this wireframe',
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

  it("should anchor a repeated screen id to its own screen when an earlier screen fails to compile", () => {
    const broken = {
      ...element({
        name: "Screen",
        attributes: { name: "No id", device: "desktop" },
        children: [element({ name: "Text", attributes: { text: "Copy" } })],
      }),
      position: {
        start: { line: 2, column: 1, offset: 10 },
        end: { line: 4, column: 10, offset: 30 },
      },
    };
    const duplicate = {
      ...LESSON,
      position: {
        start: { line: 9, column: 1, offset: 400 },
        end: { line: 11, column: 10, offset: 500 },
      },
    };
    const { diagnostics } = compile({
      scopedChildren: [broken, LESSON, duplicate],
    });
    expect(diagnostics).toContainEqual({
      line: 9,
      column: 1,
      message:
        'Duplicate Screen id "lesson"; every screen in a wireframe needs its own id',
    });
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
          attributes: { device: "watch" },
          children: [element({ name: "Text", attributes: { text: "Hi" } })],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          'Invalid value for attribute "device"; expected one of: desktop, tablet, tablet-portrait, phone',
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

  it("should draw progress in fixed steps and allow a tangible value label", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Progress",
              attributes: {
                label: "Goal",
                value: "61",
                valueLabel: "Only $27.50 to go",
              },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-progress":"60"');
    expect(rendered).toContain("Only $27.50 to go");
    expect(rendered).not.toContain(">61%<");
    // No authored value ever reaches a style attribute.
    expect(rendered).not.toContain('"style"');
  });

  it("should draw every control as its native element inside its own label", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "TextField",
              attributes: {
                label: "Workflow name",
                kind: "search",
                disabled: true,
              },
            }),
            element({
              name: "TextArea",
              attributes: { label: "Prompt", disabled: true },
            }),
            element({
              name: "Select",
              attributes: {
                label: "Agent",
                value: "Writer",
                disabled: true,
              },
            }),
            element({
              name: "Checkbox",
              attributes: { label: "Retry", checked: true },
            }),
            element({
              name: "Switch",
              attributes: { label: "Pause", on: true },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"tagName":"input"');
    expect(rendered).toContain('"tagName":"textarea"');
    expect(rendered).toContain('"tagName":"select"');
    expect(rendered).toContain('"type":"search"');
    expect(rendered).toContain('"role":"switch"');
    expect(rendered.match(/"disabled":true/gu)).toHaveLength(3);
    // Every control is wrapped by its label, so association needs no id and
    // two copies of the same wireframe can never collide.
    expect(rendered.match(/"tagName":"label"/gu)).toHaveLength(5);
    expect(rendered).not.toContain('"htmlFor"');
  });

  it("should require a label on a control rather than drawing an unnamed box", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({ name: "TextField", attributes: { placeholder: "Name" } }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message: 'Missing required attribute "label"; expected a string',
      },
    ]);
  });

  it("should report a step written outside its stepper", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Panel",
              children: [
                element({ name: "Step", attributes: { label: "Basics" } }),
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
        message: "Step belongs inside Stepper, not Panel",
      },
    ]);
  });

  it("should number the steps from the markup rather than from the author", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Stepper",
              children: [
                element({
                  name: "Step",
                  attributes: { label: "Basics", state: "done" },
                }),
                element({
                  name: "Step",
                  attributes: { label: "Trigger", state: "current" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"tagName":"ol"');
    expect(rendered).toContain('"data-wireframe-step":"done"');
    expect(rendered).toContain('"data-wireframe-step":"current"');
    // No authored ordinal: the numbers are drawn by a CSS counter.
    expect(rendered).not.toContain('"1."');
  });

  it("should reject a step label that repeats numbering owned by Stepper", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "choose",
          children: [
            element({
              name: "Stepper",
              children: [
                element({
                  name: "Step",
                  attributes: { label: "1 Choose", state: "current" },
                }),
                element({
                  name: "Step",
                  attributes: { label: "Tell us", state: "todo" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Step label "1 Choose" repeats the progress indicator; write only the task because Stepper draws numbering and completion state',
    ]);
  });

  it("should require exactly one current step", () => {
    const compileStates = (
      states: ReadonlyArray<"done" | "current" | "todo">,
    ) =>
      compile({
        scopedChildren: [
          screen({
            id: "flow",
            children: [
              element({
                name: "Stepper",
                children: states.map((state, index) =>
                  element({
                    name: "Step",
                    attributes: { label: `Task ${index + 1}`, state },
                  }),
                ),
              }),
            ],
          }),
        ],
      });

    expect(
      compileStates(["done", "todo"]).diagnostics.map((entry) => entry.message),
    ).toEqual([
      'Screen "flow" Stepper needs exactly one current Step; found 0',
    ]);
    expect(
      compileStates(["current", "current"]).diagnostics.map(
        (entry) => entry.message,
      ),
    ).toEqual([
      'Screen "flow" Stepper needs exactly one current Step; found 2',
    ]);
  });

  it("should order progress as done, current, then todo", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "check",
          children: [
            element({
              name: "Stepper",
              children: [
                element({
                  name: "Step",
                  attributes: { label: "Choose", state: "todo" },
                }),
                element({
                  name: "Step",
                  attributes: { label: "Check", state: "current" },
                }),
                element({
                  name: "Step",
                  attributes: { label: "Handoff", state: "done" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen "check" Stepper state must read done, then one current, then todo',
    ]);
  });

  it("should keep a connector's condition as text and its arrow as decoration", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Connector",
              attributes: { direction: "down", label: "on success" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-direction":"down"');
    expect(rendered).toContain("on success");
    expect(rendered).toContain('"ariaHidden":"true"');
  });

  it("should frame a web screen as a browser window showing its route", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          attributes: { url: "app.example.dev/workflows" },
          children: [element({ name: "Text", attributes: { text: "Hi" } })],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model).toMatchObject({
      screens: [{ url: "app.example.dev/workflows" }],
    });
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-device":"desktop"');
    expect(rendered).toContain("app.example.dev/workflows");
  });

  it("should compile a flush desktop shell beside tablet and phone form factors", () => {
    const { compiled, diagnostics } = compile({
      attributes: { id: "form-factors", initialScreen: "desk-home" },
      scopedChildren: [
        screen({
          id: "desk-home",
          name: "Desktop inbox",
          attributes: {
            device: "desktop",
            url: "app.harbor.team/inbox",
          },
          children: [
            element({
              name: "AppShell",
              children: [
                element({
                  name: "Sidebar",
                  attributes: { brand: "Harbor" },
                  children: [
                    element({
                      name: "Nav",
                      children: [
                        element({
                          name: "NavItem",
                          attributes: { label: "Inbox", active: true },
                        }),
                      ],
                    }),
                  ],
                }),
                element({
                  name: "AppContent",
                  children: [
                    element({
                      name: "PageHeader",
                      attributes: { title: "Inbox" },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        screen({
          id: "tablet-home",
          name: "Tablet inbox",
          attributes: {
            device: "tablet",
          },
          children: [
            element({
              name: "AppShell",
              children: [
                element({
                  name: "Sidebar",
                  attributes: { brand: "Harbor" },
                  children: [
                    element({
                      name: "Nav",
                      children: [
                        element({
                          name: "NavItem",
                          attributes: { label: "Inbox", active: true },
                        }),
                      ],
                    }),
                  ],
                }),
                element({
                  name: "AppContent",
                  children: [
                    element({
                      name: "PageHeader",
                      attributes: { title: "Inbox" },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        screen({
          id: "phone-home",
          name: "Phone inbox",
          attributes: {
            device: "phone",
          },
          children: [
            element({
              name: "TopBar",
              attributes: { title: "Harbor" },
            }),
            element({
              name: "Panel",
              attributes: { title: "Open" },
              children: [
                element({
                  name: "List",
                  children: [
                    element({
                      name: "ListItem",
                      attributes: { label: "Billing refund", value: "2h" },
                    }),
                  ],
                }),
              ],
            }),
            element({
              name: "BottomBar",
              children: [
                element({
                  name: "Button",
                  attributes: { label: "Inbox", emphasis: "primary" },
                }),
                element({
                  name: "Button",
                  attributes: { label: "Settings", navigateTo: "desk-home" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model).toMatchObject({
      screens: [
        {
          id: "desk-home",
          device: "desktop",
          url: "app.harbor.team/inbox",
        },
        {
          id: "tablet-home",
          device: "tablet",
        },
        {
          id: "phone-home",
          device: "phone",
        },
      ],
    });
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-device":"desktop"');
    expect(rendered).toContain('"data-wireframe-device":"tablet"');
    expect(rendered).toContain('"data-wireframe-device":"phone"');
    expect(rendered).toContain("wireframe-app-shell");
    expect(rendered).toContain("wireframe-sidebar");
    expect(rendered).toContain("wireframe-bottom-bar");
    expect(rendered).toContain("wireframe-tablet-handle");
    expect(rendered).toContain("Primary destinations");
  });

  it("should draw a phone bottom bar as a navigation strip", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          attributes: { device: "phone" },
          children: [
            element({
              name: "BottomBar",
              children: [
                element({
                  name: "Button",
                  attributes: { label: "Home", emphasis: "primary" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model.screens[0]?.children[0]).toMatchObject({
      element: "BottomBar",
    });
    const rendered = html(render(compiled));
    expect(rendered).toContain("wireframe-bottom-bar");
    expect(rendered).toContain("Home");
  });

  it("should draw a segmented mode without counting its selected state as a second filled action", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "reply",
          children: [
            element({
              name: "SegmentedControl",
              children: [
                element({
                  name: "Button",
                  attributes: { label: "Reply", emphasis: "primary" },
                }),
                element({
                  name: "Button",
                  attributes: { label: "Internal note" },
                }),
              ],
            }),
            element({
              name: "TextArea",
              attributes: { label: "Message" },
            }),
            element({
              name: "Button",
              attributes: { label: "Send reply", emphasis: "primary" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model.screens[0]?.children[0]).toMatchObject({
      element: "SegmentedControl",
      children: [
        { element: "Button", label: "Reply", emphasis: "primary" },
        { element: "Button", label: "Internal note" },
      ],
    });
    const rendered = html(render(compiled));
    expect(rendered).toContain("wireframe-segmented-control");
    expect(rendered).toContain('"role":"group"');
  });

  it("should draw a section label for grouped phone settings", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "settings",
          attributes: { device: "phone" },
          children: [
            element({
              name: "Text",
              attributes: { text: "Notifications", role: "section" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model.screens[0]?.children[0]).toEqual({
      element: "Text",
      text: "Notifications",
      role: "section",
    });
    expect(html(render(compiled))).toContain('"data-wireframe-role":"section"');
  });

  it("should let a list row open a screen when navigateTo is set", () => {
    const { compiled, diagnostics } = compile({
      attributes: { id: "wf", initialScreen: "home" },
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "List",
              children: [
                element({
                  name: "ListItem",
                  attributes: {
                    label: "Checkout freeze",
                    navigateTo: "ticket",
                  },
                }),
              ],
            }),
          ],
        }),
        screen({
          id: "ticket",
          children: [element({ name: "Text", attributes: { text: "Ticket" } })],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-navigate":"ticket"');
    expect(rendered).toContain("wireframe-list-row");
  });

  it("should draw a state mark on a status row and on the panel heading its group", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "approve",
          attributes: { device: "desktop" },
          children: [
            element({
              name: "Panel",
              attributes: {
                title: "Open items",
                surface: "outlined",
                status: "attention",
              },
              children: [
                element({
                  name: "List",
                  children: [
                    element({
                      name: "ListItem",
                      attributes: {
                        label: "Rollback window",
                        meta: "Raised by Josh",
                        status: "waiting",
                      },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model.screens[0]?.children[0]).toMatchObject({
      element: "Panel",
      status: "attention",
      children: [
        {
          element: "List",
          children: [{ element: "ListItem", status: "waiting" }],
        },
      ],
    });
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-status":"attention"');
    expect(rendered).toContain('"data-wireframe-status":"waiting"');
    // The mark differs by shape, not only by colour, so the states stay apart
    // in greyscale and at drawing scale.
    expect(rendered).toContain('"data-lucide":"triangle-alert"');
    expect(rendered).toContain('"data-lucide":"hourglass"');
    expect(rendered).toContain('"value":"Status: attention"');
    expect(rendered).toContain('"value":"Status: waiting"');
  });

  it("should reject panel status without a title", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "approve",
          children: [
            element({
              name: "Panel",
              attributes: { status: "done" },
              children: [
                element({ name: "Text", attributes: { text: "Ready" } }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map(({ message }) => message)).toContain(
      "Panel status needs title so the state mark has a group to label",
    );
    expect(compiled.model.screens[0]?.children[0]).not.toHaveProperty("status");
  });

  it("should reject a status outside the closed vocabulary", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "approve",
          children: [
            element({
              name: "List",
              children: [
                element({
                  name: "ListItem",
                  attributes: { label: "Rollback window", status: "urgent" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map(({ message }) => message).join("\n")).toContain(
      "status",
    );
  });

  it("should mark a selected queue row and render timeline messages", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          attributes: { device: "desktop" },
          children: [
            element({
              name: "List",
              children: [
                element({
                  name: "ListItem",
                  attributes: {
                    label: "Checkout freeze",
                    selected: true,
                  },
                }),
              ],
            }),
            element({
              name: "Message",
              attributes: {
                author: "Maya",
                time: "14m",
                kind: "customer",
                text: "Form freezes",
              },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model.screens[0]?.children[0]).toMatchObject({
      element: "List",
      children: [{ element: "ListItem", selected: true }],
    });
    expect(compiled.model.screens[0]?.children[1]).toMatchObject({
      element: "Message",
      kind: "customer",
    });
    const rendered = html(render(compiled));
    expect(rendered).toContain("data-wireframe-selected");
    expect(rendered).toContain('"data-wireframe-message":"customer"');
  });

  it("should make Rail own secondary width beside a derived master pane", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          attributes: {
            device: "desktop",

            url: "app.harbor.team/inbox?ticket=1",
          },
          children: [
            element({
              name: "Row",
              children: [
                element({
                  name: "Panel",
                  attributes: { title: "Queue" },
                  children: [
                    element({
                      name: "List",
                      children: [
                        element({
                          name: "ListItem",
                          attributes: { label: "#1", selected: true },
                        }),
                      ],
                    }),
                  ],
                }),
                element({
                  name: "Panel",
                  attributes: { title: "Conversation" },
                  children: [
                    element({
                      name: "Text",
                      attributes: { text: "Thread body" },
                    }),
                  ],
                }),
                element({
                  name: "Rail",
                  children: [
                    element({
                      name: "Panel",
                      attributes: { title: "Properties" },
                      children: [
                        element({
                          name: "Select",
                          attributes: { label: "Status", value: "Open" },
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model.screens[0]?.children[0]).toMatchObject({
      element: "Row",
      children: [
        { element: "Panel", title: "Queue" },
        { element: "Panel", title: "Conversation" },
        { element: "Rail" },
      ],
    });
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-workspace":""');
    expect(rendered).toContain('"data-wireframe-master":""');
    expect(rendered).toContain("wireframe-rail");
  });

  it("should reject equal flexible thirds on desktop", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          attributes: { device: "desktop" },
          children: [
            element({
              name: "Row",
              children: [
                element({ name: "Panel", attributes: { title: "Queue" } }),
                element({
                  name: "Panel",
                  attributes: { title: "Conversation" },
                }),
                element({
                  name: "Panel",
                  attributes: { title: "Properties" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Desktop Screen "ticket" draws 3 flexible panes in one Row; keep the primary surface dominant and wrap secondary content in Rail',
    ]);
  });

  it("should reject author-owned pane widths now that Rail owns the invariant", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          children: [
            element({
              name: "Panel",
              attributes: { title: "Conversation", span: "main" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Unknown attribute "span" on Panel',
    ]);
  });

  it("should report an address on a phone that has no address bar to draw it in", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          attributes: { device: "phone", url: "app.example.dev/workflows" },
          children: [element({ name: "Text", attributes: { text: "Hi" } })],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          'Attribute "url" is unavailable on device="phone"; browser chrome belongs only to device="desktop"',
      },
    ]);
    // The address is dropped rather than drawn somewhere it does not belong.
    expect(compiled.model).toMatchObject({ screens: [{ device: "phone" }] });
    expect(html(render(compiled))).not.toContain("app.example.dev");
  });

  it("should reject browser chrome on tablet while keeping a native tablet frame", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "tablet",
          attributes: {
            device: "tablet",
            url: "app.example.dev/workflows",
          },
          children: [element({ name: "Text", attributes: { text: "Hi" } })],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Attribute "url" is unavailable on device="tablet"; browser chrome belongs only to device="desktop"',
    ]);
    const rendered = html(render(compiled));
    expect(rendered).toContain("wireframe-tablet-handle");
    expect(rendered).not.toContain("wireframe-browser-bar");
  });

  it("should derive the frame from the screen device", () => {
    const { compiled } = compile({ scopedChildren: [HOME] });
    expect(compiled.model).toMatchObject({
      screens: [{ device: "desktop" }],
    });
    expect(html(render(compiled))).toContain("wireframe-browser-bar");
  });

  it("should reject the split viewport and chrome attributes", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          attributes: { viewport: "desktop", chrome: "phone" },
          children: [element({ name: "Text", attributes: { text: "Hi" } })],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Unknown attribute "viewport" on Screen',
      'Unknown attribute "chrome" on Screen',
    ]);
  });

  it("should expand an opt-in triage pattern into panels and a rail", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          attributes: { pattern: "triage" },
          children: [
            element({
              name: "Panel",
              attributes: { title: "Queue" },
              children: [
                element({
                  name: "List",
                  children: [
                    element({
                      name: "ListItem",
                      attributes: { label: "Checkout freeze", selected: true },
                    }),
                  ],
                }),
              ],
            }),
            element({
              name: "Panel",
              attributes: { title: "Conversation" },
              children: [element({ name: "Text", attributes: { text: "Hi" } })],
            }),
            element({
              name: "Panel",
              attributes: { title: "Properties" },
              children: [
                element({ name: "Text", attributes: { text: "Open" } }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(compiled.model).toMatchObject({
      screens: [
        {
          pattern: "triage",
          children: [
            {
              element: "Row",
              children: [
                { element: "Panel", title: "Queue" },
                { element: "Panel", title: "Conversation" },
                {
                  element: "Rail",
                  children: [{ element: "Panel", title: "Properties" }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("should report pattern slots when an app shell has no content region", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          attributes: { pattern: "triage" },
          children: [
            element({
              name: "AppShell",
              children: [element({ name: "Sidebar" })],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen pattern="triage" needs 3 direct Panel slots; it found 0. Remove pattern to lay the screen out by hand.',
    ]);
  });

  it("should report detail with no selected record", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          children: [
            element({
              name: "Row",
              children: [
                element({
                  name: "Panel",
                  children: [
                    element({
                      name: "List",
                      children: [
                        element({
                          name: "ListItem",
                          attributes: { label: "Checkout freeze" },
                        }),
                      ],
                    }),
                  ],
                }),
                element({
                  name: "Panel",
                  children: [
                    element({ name: "Text", attributes: { text: "Detail" } }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen "ticket" shows detail beside a record list, but no ListItem or Table row is selected',
    ]);
  });

  it("should treat a rail as detail when no primary pane follows a record list", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          children: [
            element({
              name: "Row",
              children: [
                element({
                  name: "Panel",
                  children: [
                    element({
                      name: "List",
                      children: [
                        element({
                          name: "ListItem",
                          attributes: { label: "Checkout freeze" },
                        }),
                      ],
                    }),
                  ],
                }),
                element({
                  name: "Rail",
                  children: [
                    element({
                      name: "Text",
                      attributes: { text: "Ticket properties" },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen "ticket" shows detail beside a record list, but no ListItem or Table row is selected',
    ]);
  });

  it("should reject a desktop shell on a phone screen", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "phone",
          attributes: { device: "phone" },
          children: [
            element({
              name: "AppShell",
              children: [
                element({ name: "Sidebar" }),
                element({
                  name: "AppContent",
                  children: [
                    element({ name: "Text", attributes: { text: "Hi" } }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Phone Screen "phone" cannot contain AppShell or Sidebar; use TopBar, one content column, and BottomBar',
    ]);
  });

  it("should reject four outlined sibling regions", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "dashboard",
          attributes: { device: "tablet" },
          children: [
            element({
              name: "Row",
              children: ["Balance", "Activity", "Loan", "Lesson"].map((title) =>
                element({
                  name: "Panel",
                  attributes: { title, surface: "outlined" },
                }),
              ),
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen "dashboard" outlines 4 sibling Panels; keep regions plain and spend boxes only on elements that behave like cards',
    ]);
  });

  it("should keep three card-like siblings inside the border budget", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "choices",
          attributes: { device: "tablet" },
          children: [
            element({
              name: "Row",
              children: ["Starter", "Team", "Business"].map((title) =>
                element({
                  name: "Panel",
                  attributes: { title, surface: "outlined" },
                }),
              ),
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
  });

  it("should reject two page-level jobs in one screen", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "handoff",
          attributes: { device: "tablet" },
          children: [
            element({
              name: "PageHeader",
              attributes: { title: "Choose what you need" },
            }),
            element({
              name: "PageHeader",
              attributes: { title: "Show your grown-up" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen "handoff" draws 2 PageHeaders; keep one page-level job and move the other task into another Screen',
    ]);
  });

  it("should allow one page job with subordinate groups and progress", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "request",
          attributes: { device: "tablet" },
          children: [
            element({
              name: "PageHeader",
              attributes: { title: "What do you want help with?" },
            }),
            element({
              name: "Stepper",
              children: [
                element({
                  name: "Step",
                  attributes: { label: "Choose", state: "current" },
                }),
                element({
                  name: "Step",
                  attributes: { label: "Prepare", state: "todo" },
                }),
              ],
            }),
            element({
              name: "Panel",
              attributes: { title: "Buying something", surface: "filled" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
  });

  it("should count a composer send button as the screen's filled action", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "reply",
          children: [
            element({
              name: "Panel",
              children: [
                element({
                  name: "TextArea",
                  attributes: { label: "Reply" },
                }),
                element({
                  name: "Row",
                  children: [
                    element({
                      name: "Button",
                      attributes: { label: "Send reply" },
                    }),
                  ],
                }),
              ],
            }),
            element({
              name: "Button",
              attributes: { label: "Resolve", emphasis: "primary" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen "reply" draws 2 filled actions (Resolve, Send reply); keep one primary action, counting a composer\'s Send button',
    ]);
  });

  it("should count a composer send button among direct screen children", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "reply",
          children: [
            element({
              name: "TextArea",
              attributes: { label: "Reply" },
            }),
            element({
              name: "Button",
              attributes: { label: "Send reply" },
            }),
            element({
              name: "Button",
              attributes: { label: "Resolve", emphasis: "primary" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen "reply" draws 2 filled actions (Resolve, Send reply); keep one primary action, counting a composer\'s Send button',
    ]);
  });

  it("should not count a send action outside the text area's container", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "invite",
          children: [
            element({
              name: "Panel",
              children: [
                element({
                  name: "TextArea",
                  attributes: { label: "Notes" },
                }),
              ],
            }),
            element({
              name: "Button",
              attributes: { label: "Save", emphasis: "primary" },
            }),
            element({
              name: "Button",
              attributes: { label: "Send invite" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
  });

  it("should read a fenced table into columns and rows", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Table",
              body: [fence("Run | Result | Cost\n#1042 | Failed | $1.86")],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"tagName":"table"');
    expect(rendered).toContain('"tagName":"th"');
    expect(rendered).toContain("#1042");
    // A column whose every value is a figure lines up on the right.
    expect(rendered).toContain('"data-wireframe-numeric":"true"');
  });

  it("should report a row that does not match the header", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Table",
              body: [fence("Run | Result\n#1042 | Failed | extra")],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      "Table row 1 has 3 cells but the header names 2",
    ]);
  });

  it("should draw a bracketed cell as a toned chip", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Table",
              attributes: { selected: "1" },
              body: [fence("Run | Result\n#1042 | [Failed:danger]")],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-tone":"danger"');
    // The word carries the meaning; the tone only reinforces it.
    expect(rendered).toContain("Failed");
    expect(rendered).toContain('"data-wireframe-selected"');
  });

  it("should report a chip tone that is not one of the tones", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Table",
              body: [fence("Run | Result\n#1042 | [Failed:scary]")],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Unknown chip tone "scary" in a table cell; expected one of: neutral, info, success, warning, danger',
    ]);
  });

  it("should report selecting a row the table does not have", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Table",
              attributes: { selected: "4" },
              body: [fence("Run | Result\n#1042 | Failed")],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message: "Table has no row 4 to select; it holds 1",
      },
    ]);
  });

  it("should draw no box around a region unless the author asks for one", () => {
    const { compiled } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({ name: "Panel", attributes: { title: "Plain" } }),
            element({
              name: "Panel",
              attributes: { title: "Pane", surface: "filled" },
            }),
            element({
              name: "Panel",
              attributes: { title: "Card", surface: "outlined" },
            }),
          ],
        }),
      ],
    });
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-surface":"plain"');
    expect(rendered).toContain('"data-wireframe-surface":"filled"');
    expect(rendered).toContain('"data-wireframe-surface":"outlined"');
  });

  it("should derive an independently scrolling thread and anchored composer", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "ticket",
          children: [
            element({
              name: "Panel",
              attributes: { title: "Conversation" },
              children: [
                element({
                  name: "Message",
                  attributes: {
                    author: "Maya",
                    time: "Now",
                    text: "Checkout worked.",
                  },
                }),
                element({
                  name: "SegmentedControl",
                  children: [
                    element({ name: "Button", attributes: { label: "Reply" } }),
                    element({
                      name: "Button",
                      attributes: {
                        label: "Internal note",
                        emphasis: "primary",
                      },
                    }),
                  ],
                }),
                element({
                  name: "TextArea",
                  attributes: {
                    label: "Internal note",
                    placeholder: "Write an internal note…",
                  },
                }),
                element({
                  name: "Button",
                  attributes: {
                    label: "Add internal note",
                    emphasis: "primary",
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-conversation":""');
    expect(rendered).toContain("wireframe-thread");
    expect(rendered).toContain("wireframe-composer");
  });

  it("should render a deliberate simple-choice flow through the touch-card primitive", () => {
    const { compiled, diagnostics } = compile({
      attributes: { id: "choice", initialScreen: "choose" },
      scopedChildren: [
        screen({
          id: "choose",
          attributes: { device: "tablet" },
          children: [
            element({
              name: "Center",
              children: [choiceGroup()],
            }),
          ],
        }),
        selectedChoiceScreen("purchase"),
        selectedChoiceScreen("loan"),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain("wireframe-choice-group");
    expect(rendered).toContain("wireframe-choice-card");
    expect(rendered).toContain('"ariaChecked":"true"');
    expect(rendered).toContain('"data-wireframe-selected":""');
  });

  it("should reject options that route to another choice's selected outcome", () => {
    const misleadingGroup = element({
      name: "ChoiceGroup",
      children: [
        element({
          name: "ChoiceCard",
          attributes: {
            icon: "⚽",
            title: "Ask about a purchase",
            description: "See how much money I would have left",
            navigateTo: "purchase-selected",
          },
        }),
        element({
          name: "ChoiceCard",
          attributes: {
            icon: "💵",
            title: "Ask about my loan",
            description: "See what I owe and ask a question",
            navigateTo: "purchase-selected",
          },
        }),
      ],
    });
    const { diagnostics } = compile({
      attributes: { id: "choice", initialScreen: "choose" },
      scopedChildren: [
        screen({
          id: "choose",
          attributes: { device: "tablet" },
          children: [misleadingGroup],
        }),
        selectedChoiceScreen("purchase"),
        selectedChoiceScreen("loan"),
      ],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      "every option needs its own truthful visible outcome",
    );
  });

  it("should reject preselection on the initial consequential choice", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "choose",
          attributes: { device: "tablet" },
          children: [
            choiceGroup("purchase"),
            element({
              name: "Button",
              attributes: { label: "Continue", emphasis: "primary" },
            }),
          ],
        }),
        selectedChoiceScreen("purchase"),
        selectedChoiceScreen("loan"),
      ],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      'Initial Screen "choose" preselects a consequential ChoiceCard',
    );
  });

  it("should reject a primary continuation before a deliberate choice", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "choose",
          attributes: { device: "tablet" },
          children: [
            choiceGroup(),
            element({
              name: "Button",
              attributes: { label: "Continue", emphasis: "primary" },
            }),
          ],
        }),
        selectedChoiceScreen("purchase"),
        selectedChoiceScreen("loan"),
      ],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      "shows a primary continuation before any ChoiceCard is selected",
    );
  });

  it("should ignore selected navigation state before a deliberate choice", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "choose",
          attributes: { device: "tablet" },
          children: [
            choiceGroup(),
            element({
              name: "BottomBar",
              children: [
                element({
                  name: "Button",
                  attributes: { label: "Ask", emphasis: "primary" },
                }),
              ],
            }),
          ],
        }),
        selectedChoiceScreen("purchase"),
        selectedChoiceScreen("loan"),
      ],
    });
    expect(diagnostics).toEqual([]);
  });

  it("should require a work action after a deliberate choice", () => {
    const selectedWithoutContinuation = screen({
      id: "purchase-selected",
      name: "purchase selected",
      attributes: { device: "tablet" },
      children: [
        choiceGroup("purchase"),
        element({
          name: "SegmentedControl",
          children: [
            element({
              name: "Button",
              attributes: { label: "Details", emphasis: "primary" },
            }),
          ],
        }),
      ],
    });
    const { diagnostics } = compile({
      attributes: { id: "choice", initialScreen: "choose" },
      scopedChildren: [
        screen({
          id: "choose",
          attributes: { device: "tablet" },
          children: [choiceGroup()],
        }),
        selectedWithoutContinuation,
        selectedChoiceScreen("loan"),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toContain(
      'Screen "purchase-selected" selects a ChoiceCard but offers no primary continuation; add one short next action after the deliberate choice',
    );
  });

  it("should reject a tablet choice inside competing workspace columns", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "choose",
          attributes: { device: "tablet" },
          children: [
            element({
              name: "Row",
              children: [
                choiceGroup(),
                element({
                  name: "Panel",
                  children: [
                    element({
                      name: "Text",
                      attributes: { text: "Competing detail" },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        selectedChoiceScreen("purchase"),
        selectedChoiceScreen("loan"),
      ],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      "the decision must dominate one centered column",
    );
  });

  it("should hold centered content to a measure", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Center",
              attributes: { measure: "narrow" },
              children: [
                element({ name: "Text", attributes: { text: "Focused" } }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(html(render(compiled))).toContain(
      '"data-wireframe-measure":"narrow"',
    );
  });

  it("should draw the last crumb as the current screen rather than a link", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Breadcrumbs",
              children: [
                element({
                  name: "Crumb",
                  attributes: { label: "Runs", navigateTo: "runs" },
                }),
                element({ name: "Crumb", attributes: { label: "#1042" } }),
              ],
            }),
          ],
        }),
        screen({
          id: "runs",
          children: [
            element({ name: "Text", attributes: { text: "All runs" } }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"ariaLabel":"Breadcrumb"');
    expect(rendered).toContain('"ariaCurrent":"page"');
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
  it("should draw a named glyph for a mark and keep its meaning readable", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Icon",
              attributes: { name: "settings", label: "Workspace settings" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-lucide":"settings"');
    expect(rendered).toContain("Workspace settings");
    expect(rendered).not.toContain("data-wireframe-icon-unnamed");
  });

  it("should draw the placeholder carrying the name when the set has no such glyph", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Icon",
              attributes: { name: "rocket", label: "Ship it" },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-lucide":"wireframe-placeholder"');
    expect(rendered).toContain('"data-wireframe-icon-unnamed":""');
    expect(rendered).toContain('"value":"rocket"');
  });

  it("should keep an icon-only control's words as its name and tooltip", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Button",
              attributes: {
                label: "Copy command",
                icon: "copy",
                iconOnly: true,
              },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-lucide":"copy"');
    expect(rendered).toContain('"ariaLabel":"Copy command"');
    expect(rendered).toContain('"title":"Copy command"');
    expect(rendered).not.toContain("wireframe-button-label");
  });

  it("should report an icon-only control that would draw nothing", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Button",
              attributes: { label: "Copy command", iconOnly: true },
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Button "Copy command" is iconOnly with no icon, so it would draw nothing; give it icon="..." or remove iconOnly',
    ]);
  });
  it("should draw an overlay over the page with alert semantics", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({ name: "Text", attributes: { text: "The page" } }),
            element({
              name: "Overlay",
              attributes: { kind: "alert", title: "Delete this plan?" },
              children: [
                element({
                  name: "Button",
                  attributes: { label: "Keep the plan" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    expect(rendered).toContain('"data-wireframe-overlay":"alert"');
    expect(rendered).toContain('"data-wireframe-backdrop":"dim"');
    expect(rendered).toContain('"role":"alertdialog"');
    expect(rendered).toContain('"ariaLabel":"Delete this plan?"');
    // A drawing of a modal must not hide the plan around it from a reader
    // using assistive technology, so the instruction to do that is never set.
    expect(rendered).not.toContain("ariaModal");
  });

  it("should report an overlay with no page under it and no way out", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Overlay",
              attributes: { title: "Nowhere" },
              children: [
                element({ name: "Text", attributes: { text: "Trapped" } }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      "Overlay needs at least one Button so the surface it opens has a visible way out",
      'Screen "home" is an Overlay with no page under it; draw the screen it interrupts so a reviewer can see what the interruption covers',
    ]);
  });

  it("should report a second overlay because one screen shows one moment", () => {
    const overlay = (title: string): ScopedChild =>
      element({
        name: "Overlay",
        attributes: { title },
        children: [element({ name: "Button", attributes: { label: "Close" } })],
      });
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({ name: "Text", attributes: { text: "The page" } }),
            overlay("First"),
            overlay("Second"),
          ],
        }),
      ],
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'Screen "home" draws 2 Overlays; one screen shows one moment, so give the second one its own Screen',
    ]);
  });

  it("should count an overlay's filled action as its own layer", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Button",
              attributes: { label: "Accept plan", emphasis: "primary" },
            }),
            element({
              name: "Overlay",
              attributes: { kind: "alert", title: "Delete this plan?" },
              children: [
                element({
                  name: "Button",
                  attributes: { label: "Keep it", emphasis: "tertiary" },
                }),
                element({
                  name: "Button",
                  attributes: { label: "Delete it", emphasis: "primary" },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
  });
  it("should let a Row anchor one Group at each end", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "Row",
              attributes: { justify: "between" },
              children: [
                element({
                  name: "Group",
                  children: [
                    element({ name: "Heading", attributes: { text: "Plans" } }),
                  ],
                }),
                element({
                  name: "Group",
                  children: [
                    element({
                      name: "Button",
                      attributes: {
                        label: "Workspace settings",
                        icon: "settings",
                        iconOnly: true,
                      },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(html(render(compiled))).toContain("wireframe-group");
  });

  it("should draw a top bar's Group ahead of its title and loose controls after", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          attributes: { device: "phone" },
          children: [
            element({
              name: "TopBar",
              attributes: { title: "#4821" },
              children: [
                element({
                  name: "Group",
                  children: [
                    element({
                      name: "Button",
                      attributes: { label: "Inbox", icon: "back" },
                    }),
                  ],
                }),
                element({
                  name: "Button",
                  attributes: {
                    label: "More actions",
                    icon: "more",
                    iconOnly: true,
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    const rendered = html(render(compiled));
    // The back control has to reach the reader before the title, which is the
    // only thing this slot exists for.
    expect(rendered.indexOf("wireframe-top-bar-leading")).toBeLessThan(
      rendered.indexOf("wireframe-brand"),
    );
    expect(rendered.indexOf("wireframe-brand")).toBeLessThan(
      rendered.indexOf("wireframe-top-bar-actions"),
    );
  });

  it("should keep a top bar's controls away from its title", () => {
    const { compiled, diagnostics } = compile({
      scopedChildren: [
        screen({
          id: "home",
          children: [
            element({
              name: "TopBar",
              attributes: { title: "Checkout rewrite" },
              children: [
                element({
                  name: "Button",
                  attributes: {
                    label: "Search this plan",
                    icon: "search",
                    iconOnly: true,
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(html(render(compiled))).toContain("wireframe-top-bar-actions");
  });
});
