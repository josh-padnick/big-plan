// Proves a Decision diff uses one live proposed address, isolates every
// baseline identifier, and keeps the component's real interactive markup, and
// that the engine's own rendering of a picture publishes no plan identity.

import { fromHtml } from "hast-util-from-html";
import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./markdown/compile-markdown.js";
import { renderDiffView, renderIsolatedBlockView } from "./render-diff-view.js";

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

  it("should keep a proposed field's declared target id inside its diff", () => {
    const endpoint = (description: string): string => `# Plan

## API

<HttpEndpoint method="POST" path="/queue" summary="Queue a refresh">

${description}

</HttpEndpoint>`;
    const baselineDocument = compileMarkdown({
      markdown: endpoint("Queues a refresh."),
    });
    const proposedDocument = compileMarkdown({
      markdown: endpoint("Queues one refresh."),
    });
    const proposedRoot = proposedDocument.blocks.find(
      (block) => block.kind === "http-endpoint",
    );
    const declaredField = proposedDocument.blocks.find(
      (block) =>
        block.ownerId === proposedRoot?.id && block.label === "Description",
    );
    expect(declaredField).toBeDefined();

    const rendered = renderDiffView({
      baselineDocument,
      proposedDocument,
      baselineBlockId: baselineDocument.blocks.find(
        (block) => block.kind === "http-endpoint",
      )?.id,
      proposedBlockId: proposedRoot?.id,
      status: "changed",
      runs: [],
    });
    const nodes = elements(fromHtml(rendered?.view ?? "", { fragment: true }));
    expect(
      nodes.filter((node) => node.properties.dataBlockId === declaredField?.id),
    ).toHaveLength(1);
  });

  it.each([
    {
      kind: "http-endpoint",
      label: "Query parameter: legacy",
      baseline: `<HttpEndpoint method="GET" path="/jobs"><Param name="legacy" in="query">Old.</Param></HttpEndpoint>`,
      proposed: `<HttpEndpoint method="GET" path="/jobs"><Param name="legacy" in="query">New.</Param></HttpEndpoint>`,
    },
    {
      kind: "graphql-operation",
      label: "Input field: jobId",
      baseline: `<GraphqlOperation kind="query" name="job"><Field in="input" name="jobId" type="ID!">Old.</Field></GraphqlOperation>`,
      proposed: `<GraphqlOperation kind="query" name="job"><Field in="input" name="jobId" type="ID!">New.</Field></GraphqlOperation>`,
    },
    {
      kind: "grpc-method",
      label: "Request field: job_id",
      baseline: `<GrpcMethod service="Jobs" name="Get" request="GetRequest" response="GetResponse"><Field in="request" name="job_id" type="string">Old.</Field></GrpcMethod>`,
      proposed: `<GrpcMethod service="Jobs" name="Get" request="GetRequest" response="GetResponse"><Field in="request" name="job_id" type="string">New.</Field></GrpcMethod>`,
    },
    {
      kind: "data-table",
      label: "A",
      baseline: `<DataTable>\n\n\`\`\`table\n| Job | State |\n| --- | --- |\n| A | Old |\n\`\`\`\n\n</DataTable>`,
      proposed: `<DataTable>\n\n\`\`\`table\n| Job | State |\n| --- | --- |\n| A | New |\n\`\`\`\n\n</DataTable>`,
    },
    {
      kind: "database-table-schema",
      label: "Index: status",
      baseline: `<DatabaseTableSchema name="jobs">\n\n\`\`\`dbml\nstatus text\nindexes {\n  status\n}\n\`\`\`\n\n</DatabaseTableSchema>`,
      proposed: `<DatabaseTableSchema name="jobs">\n\n\`\`\`dbml\nstatus text\nindexes {\n  status [unique]\n}\n\`\`\`\n\n</DatabaseTableSchema>`,
    },
  ])(
    "should preserve the declared $label target",
    ({ kind, label, baseline, proposed }) => {
      const compile = (component: string) =>
        compileMarkdown({ markdown: `# Plan\n\n## Contract\n\n${component}` });
      const baselineDocument = compile(baseline);
      const proposedDocument = compile(proposed);
      const baselineRoot = baselineDocument.blocks.find(
        (block) => block.kind === kind,
      );
      const proposedRoot = proposedDocument.blocks.find(
        (block) => block.kind === kind,
      );
      const declaredField = proposedDocument.blocks.find(
        (block) => block.ownerId === proposedRoot?.id && block.label === label,
      );
      expect(declaredField).toBeDefined();
      const rendered = renderDiffView({
        baselineDocument,
        proposedDocument,
        baselineBlockId: baselineRoot?.id,
        proposedBlockId: proposedRoot?.id,
        status: "changed",
        runs: [],
      });
      const nodes = elements(
        fromHtml(rendered?.view ?? "", { fragment: true }),
      );
      expect(
        nodes.filter(
          (node) => node.properties.dataBlockId === declaredField?.id,
        ),
      ).toHaveLength(1);
    },
  );
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
