// Proves a Decision diff uses one live proposed address, isolates every
// baseline identifier, and keeps the component's real interactive markup, and
// that the engine's own rendering of a picture publishes no plan identity.

import { fromHtml } from "hast-util-from-html";
import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./markdown/compile-markdown.js";
import {
  renderDiffView,
  renderIsolatedBlockView,
} from "./render-diff-view.js";

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

describe("renderIsolatedBlockView", () => {
  const pictures = `# Evidence

## Screens

![Retry dashboard](./assets/before.png)
`;

  it("should replay a picture without the address the plan minted for it", () => {
    const document = compileMarkdown({ markdown: pictures });
    const picture = document.blocks.find((block) => block.kind === "image");
    expect(picture).toBeDefined();

    const view = renderIsolatedBlockView({
      document,
      blockId: picture?.id,
      key: "was-0123456789abcdef",
    });
    const nodes = elements(fromHtml(view ?? "", { fragment: true }));
    expect(view).toContain("./assets/before.png");
    // A replayed picture is evidence beside a block the lens has hidden, so it
    // must carry neither the address a stored comment resolves nor anything a
    // reader could act on.
    expect(
      nodes.filter((node) => node.properties.dataBlockId !== undefined),
    ).toEqual([]);
    expect(nodes.at(0)?.properties.inert).toBe(true);
    expect(nodes.at(0)?.properties.dataDiffSide).toBe("baseline");
  });

  it("should answer with nothing when the side has no such block", () => {
    const document = compileMarkdown({ markdown: pictures });
    expect(
      renderIsolatedBlockView({ document, blockId: undefined, key: "k" }),
    ).toBeUndefined();
    expect(
      renderIsolatedBlockView({ document, blockId: "no-such-block", key: "k" }),
    ).toBeUndefined();
  });

  it("should leave the compiled document unchanged for the next side", () => {
    const document = compileMarkdown({ markdown: pictures });
    const picture = document.blocks.find((block) => block.kind === "image");
    renderIsolatedBlockView({
      document,
      blockId: picture?.id,
      key: "was-0123456789abcdef",
    });
    // The route renders both sides from one compile, so isolating a side must
    // not strip the identity the other reads next.
    const again = renderIsolatedBlockView({
      document,
      blockId: picture?.id,
      key: "now-fedcba9876543210",
    });
    expect(again).toContain("./assets/before.png");
  });
});
