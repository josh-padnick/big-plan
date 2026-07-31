// Exercises slide-leading-title through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

describe("lintPlan slide-leading-title", () => {
  it("should report a sub-slide whose first block is a component", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Delivery\n\nProse.\n\n### Retiring the route\n\n<Callout type="warning" title="Deprecation">\n\nGone next release.\n\n</Callout>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-leading-title",
        line: 11,
        column: 1,
        message:
          "Title this sub-slide above the figure: its h3 renders as a small kicker, so add an h4 line stating the message this figure shows",
      },
    ]);
  });

  it("should report a slide whose first block is a fenced code block", () => {
    expect(
      lintPlan({
        markdown: "# T\n\nLede.\n\n## SQL\n\n```sql\nSELECT 1;\n```\n",
      }),
    ).toEqual([
      {
        ruleId: "slide-leading-title",
        line: 7,
        column: 1,
        message:
          "Say what this figure shows before showing it: lead the slide with a title line or a context builder, not the figure",
      },
    ]);
  });

  it("should report a slide whose first block is a table", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Failure classes\n\n| Code | Retry |\n| --- | --- |\n| 429 | yes |\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should report a slide whose first block is a standalone image", () => {
    expect(
      lintPlan({
        markdown: "# T\n\nLede.\n\n## The pipeline\n\n![Pipeline](p.png)\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should report a slide whose first block is a reference-style image", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\n![Pipeline][pipeline]\n\n[pipeline]: p.png\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should report a slide whose first block is a linked image", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\n[![Pipeline](p.png)](p.png)\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should report a slide whose first block is a reference-linked image", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\n[![Pipeline][pipeline]][detail]\n\n[pipeline]: p.png\n[detail]: pipeline.md\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should accept a sub-slide that titles the figure with an h4 first", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Delivery\n\nProse.\n\n### End to end\n\n#### One save touches only what changed\n\n<FlowDiagram>\n\nBody.\n\n</FlowDiagram>\n",
      }),
    ).toEqual([]);
  });

  it("should accept a slide that leads with a context builder before the figure", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## SQL\n\n*A join, so every token colour appears at once.*\n\n```sql\nSELECT 1;\n```\n",
      }),
    ).toEqual([]);
  });

  it("should accept a slide whose figure follows ordinary prose", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\nThe authored file is the only hand-edited copy.\n\n<FlowDiagram>\n\nBody.\n\n</FlowDiagram>\n",
      }),
    ).toEqual([]);
  });

  it("should accept an image used inside a sentence rather than as a figure", () => {
    expect(
      lintPlan({
        markdown: "# T\n\nLede.\n\n## Badges\n\nStatus ![ok](o.png) today.\n",
      }),
    ).toEqual([]);
  });

  it("should accept a text link used as prose", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\n[Read the pipeline guide](pipeline.md).\n",
      }),
    ).toEqual([]);
  });

  it("should leave a section that immediately opens its sub-slides alone", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Delivery\n\n### First\n\n#### Titled\n\nProse.\n",
      }),
    ).toEqual([]);
  });
});
