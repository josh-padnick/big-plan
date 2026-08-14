// Exercises wireframe-envelope-fit through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

const wireframe = (screen: string): string =>
  `# Ship it\n\nOne sentence of thesis.\n\n<Wireframe id="w" initialScreen="s">\n\n${screen}\n\n</Wireframe>\n`;

describe("lintPlan wireframe-envelope-fit", () => {
  it("should report a desktop Row that lays out a fourth column", () => {
    const markdown = wireframe(
      [
        '<Screen id="s" name="Triage" device="desktop">',
        "<Row>",
        '<Panel title="Queue"><List><ListItem label="One" /></List></Panel>',
        '<Panel title="Conversation"><Text text="Body" /></Panel>',
        '<Panel title="Notes"><Text text="Body" /></Panel>',
        '<Rail><Text text="Properties" /></Rail>',
        "</Row>",
        "</Screen>",
      ].join("\n"),
    );

    expect(
      lintPlan({ markdown }).filter(
        ({ ruleId }) => ruleId === "wireframe-envelope-fit",
      ),
    ).toEqual([
      {
        ruleId: "wireframe-envelope-fit",
        line: 8,
        column: 1,
        message:
          "This Row lays out 4 columns on a desktop screen, which the desktop envelope cannot hold at a readable width; the figure never widens, so give the screen 3 columns or fewer and move the rest to another screen, a Rail, or progressive disclosure",
      },
    ]);
  });

  it("should report side-by-side columns on a phone screen", () => {
    const markdown = wireframe(
      [
        '<Screen id="s" name="Inbox" device="phone">',
        "<Row>",
        '<Stack><Text text="Left" /></Stack>',
        '<Stack><Text text="Right" /></Stack>',
        "</Row>",
        "</Screen>",
      ].join("\n"),
    );

    const findings = lintPlan({ markdown }).filter(
      ({ ruleId }) => ruleId === "wireframe-envelope-fit",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("2 columns on a phone screen");
  });

  it.each([
    [
      "a desktop screen inside the column budget",
      [
        '<Screen id="s" name="Triage" device="desktop">',
        "<Row>",
        '<Panel title="Queue"><List><ListItem label="One" /></List></Panel>',
        '<Panel title="Conversation"><Text text="Body" /></Panel>',
        '<Rail><Text text="Properties" /></Rail>',
        "</Row>",
        "</Screen>",
      ].join("\n"),
    ],
    [
      "a row of controls rather than columns",
      [
        '<Screen id="s" name="Confirm" device="desktop">',
        '<Row justify="end">',
        '<Button label="Keep reviewing" emphasis="tertiary" />',
        '<Button label="Approve plan" emphasis="primary" />',
        '<Badge label="Ready" tone="success" />',
        '<Badge label="Two open" tone="warning" />',
        "</Row>",
        "</Screen>",
      ].join("\n"),
    ],
    [
      "a single phone column",
      [
        '<Screen id="s" name="Inbox" device="phone">',
        "<Stack>",
        '<Text text="One column" />',
        "</Stack>",
        "</Screen>",
      ].join("\n"),
    ],
  ])("should not report %s", (_label, screen) => {
    expect(
      lintPlan({ markdown: wireframe(screen) }).filter(
        ({ ruleId }) => ruleId === "wireframe-envelope-fit",
      ),
    ).toEqual([]);
  });
});
