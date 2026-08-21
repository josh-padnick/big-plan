// Proves a Decision diff uses one live proposed address, isolates every
// baseline identifier, and keeps the component's real interactive markup.

import { fromHtml } from "hast-util-from-html";
import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./markdown/compile-markdown.js";
import { renderDiffView } from "./render-diff-view.js";

const decision = (option: string): string => `# Plan

## Choice

<Decision question="Which path should we take?">

<Option title="${option}" recommended>

<Consideration label="Durability" verdict="Strong" tone="good">

It lasts.

</Consideration>

</Option>

<Option title="Wait">

<Consideration label="Durability" verdict="Weak" tone="bad">

It drifts.

</Consideration>

</Option>

</Decision>`;

const elements = (node: Root | Element): ReadonlyArray<Element> =>
  node.children.flatMap((child): ReadonlyArray<Element> =>
    child.type === "element" ? [child, ...elements(child)] : [],
  );

const decisionBlockId = (markdown: string): string => {
  const block = compileMarkdown({ markdown }).blocks.find(
    (candidate) => candidate.kind === "decision",
  );
  if (block === undefined) throw new Error("Decision fixture did not compile");
  return block.id;
};

describe("render diff view", () => {
  it("should render one addressed Decision root with an isolated baseline", () => {
    const baselineMarkdown = decision("Ship now");
    const proposedMarkdown = decision("Ship safely");
    const blockId = decisionBlockId(proposedMarkdown);
    const rendered = renderDiffView({
      baselineDocument: compileMarkdown({ markdown: baselineMarkdown }),
      proposedDocument: compileMarkdown({ markdown: proposedMarkdown }),
      baselineBlockId: decisionBlockId(baselineMarkdown),
      proposedBlockId: blockId,
      status: "changed",
      runs: [],
    });
    expect(rendered).not.toBeNull();

    const root = fromHtml(rendered?.view ?? "", { fragment: true });
    const nodes = elements(root);
    expect(
      nodes.filter((node) => node.properties.dataBlockId === blockId),
    ).toHaveLength(1);
    const baseline = nodes.find(
      (node) => node.properties.dataDiffSide === "baseline",
    );
    expect(baseline?.properties.inert).toBe(true);
    expect(
      baseline === undefined
        ? []
        : [baseline, ...elements(baseline)].filter(
            (node) => node.properties.dataBlockId !== undefined,
          ),
    ).toEqual([]);
    const ids = nodes.flatMap((node) =>
      typeof node.properties.id === "string" ? [node.properties.id] : [],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      nodes.some(
        (node) => node.properties.dataDecisionChangeOpen !== undefined,
      ),
    ).toBe(true);
    expect(
      nodes.filter(
        (node) => node.properties.dataDecisionDefinition !== undefined,
      ),
    ).toHaveLength(4);
  });
});
