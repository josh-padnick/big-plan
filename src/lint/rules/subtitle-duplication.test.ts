// Exercises subtitle-duplication through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

describe("lintPlan subtitle-duplication", () => {
  it("should report a figure label repeating its slide heading", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Open questions\n\nThree calls remain.\n\n<FileTree title="Open questions">\n\nBody.\n\n</FileTree>\n',
      }),
    ).toEqual([
      {
        ruleId: "subtitle-duplication",
        line: 9,
        column: 1,
        message:
          'Drop this figure\'s title or name what the figure shows: it repeats the heading "Open questions"',
      },
    ]);
  });

  it("should report a context builder repeating its slide heading", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Quality criteria\n\n*The quality criteria.*\n\nProse.\n",
      }),
    ).toEqual([
      {
        ruleId: "subtitle-duplication",
        line: 7,
        column: 1,
        message:
          'Drop this context builder or make it add something: it repeats the heading "Quality criteria"',
      },
    ]);
  });

  it("should report a reordered restatement of the heading", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Retry queue\n\n*Queue retry.*\n\nProse.\n",
      }).map(({ ruleId }) => ruleId),
    ).toEqual(["subtitle-duplication"]);
  });

  it("should ignore a leading article when comparing", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The retry queue\n\n*Retry queue.*\n\nProse.\n",
      }).map(({ ruleId }) => ruleId),
    ).toEqual(["subtitle-duplication"]);
  });

  it("should report identical non-Latin heading and component titles", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Очередь повторов\n\nProse.\n\n<FlowDiagram title="Очередь повторов">\n\nBody.\n\n</FlowDiagram>\n',
      }).map(({ ruleId }) => ruleId),
    ).toEqual(["subtitle-duplication"]);
  });

  it("should accept a context builder that adds information", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Quality criteria\n\n*How we judge the index once it ships.*\n\nProse.\n",
      }),
    ).toEqual([]);
  });

  it("should accept a figure label naming something other than the heading", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Settling the last calls\n\nThree remain.\n\n<FileTree title="Open questions">\n\nBody.\n\n</FileTree>\n',
      }),
    ).toEqual([]);
  });

  it("should accept a heading whose words merely appear inside a longer label", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Pan\n\nProse.\n\n<FlowDiagram title="Drag, scroll, or pan the artboard around at any zoom">\n\nBody.\n\n</FlowDiagram>\n',
      }),
    ).toEqual([]);
  });

  it("should leave a Part marker's act name alone", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Context\n\nProse.\n\n<Part title="Context" />\n\n## Next\n\nProse.\n',
      }),
    ).toEqual([]);
  });

  it("should compare only a leading emphasized paragraph, not a later aside", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Quality criteria\n\nProse.\n\n*The quality criteria.*\n",
      }),
    ).toEqual([]);
  });
});
