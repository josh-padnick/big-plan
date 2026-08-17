import { describe, expect, it } from "vitest";
import type { Root } from "hast";
import { compileMarkdown } from "./compile-markdown.js";
import { rehypeBlockIdentity, type BlockDescriptor } from "./block-identity.js";
import { serializeHtml } from "../serialize-html.js";

const compile = (markdown: string) => {
  const { root, blocks } = compileMarkdown({ markdown });
  return { html: serializeHtml({ root }), blocks };
};

const attributesFor = ({
  html,
  id,
}: {
  readonly html: string;
  readonly id: string;
}): string => {
  const match = html.match(
    new RegExp(`<[a-z0-9]+[^>]*data-block-id="${id}"[^>]*>`),
  );
  return match === null ? "" : match[0];
};

const DECISION_FIXTURE = `## Calls

<Decision question="Which store?">

Context for the call.

<Option title="SQLite" recommended summary="Zero setup for local review.">

<Consideration label="Setup" verdict="None" tone="good" />

</Option>

<Option title="Postgres" summary="A server the reviewer must run.">

<Consideration label="Setup" verdict="A server" tone="bad" />

</Option>

</Decision>
`;

const SNIPPET_FIXTURE = `## Code

<CodeSnippet file="src/a.ts" startLine="12" showLineNumbers>

\`\`\`ts
const a = 1;
const b = 2;
\`\`\`

</CodeSnippet>
`;

describe("block identity scopes", () => {
  it("should address a slide's blocks under its own heading anchor", () => {
    const { blocks } = compile("## Status quo\n\nToday.\n\n- One\n- Two\n");
    expect(blocks.map((block) => block.id)).toEqual([
      "section/status-quo/heading-1",
      "section/status-quo/paragraph-1",
      "section/status-quo/list-1",
    ]);
  });

  it("should address everything above the first slide as the document", () => {
    const { blocks } = compile("# Plan\n\nThe lede.\n\n## One\n\nA.\n");
    expect(blocks.slice(0, 2).map((block) => block.id)).toEqual([
      "document/heading-1",
      "document/paragraph-1",
    ]);
  });

  it("should give a sub-slide its own scope when a section splits into h3 runs", () => {
    const { blocks } = compile("## Design\n\nIntro.\n\n### Pipeline\n\nHow.\n");
    expect(blocks.map((block) => block.id)).toEqual([
      "section/design/heading-1",
      "section/design/paragraph-1",
      "section/pipeline/heading-1",
      "section/pipeline/paragraph-1",
    ]);
  });

  it("should number repeats of one kind within a scope in document order", () => {
    const { blocks } = compile("## One\n\nA.\n\nB.\n\nC.\n");
    expect(blocks.map((block) => block.id)).toEqual([
      "section/one/heading-1",
      "section/one/paragraph-1",
      "section/one/paragraph-2",
      "section/one/paragraph-3",
    ]);
  });

  it("should address a bare document with no sections at all", () => {
    const { blocks } = compile("Just a sentence.\n");
    expect(blocks.map((block) => block.id)).toEqual(["document/paragraph-1"]);
  });
});

describe("block identity kinds and labels", () => {
  it("should name a component by its own heading when it has one", () => {
    const { blocks } = compile(DECISION_FIXTURE);
    const decision = blocks.find((block) => block.kind === "decision");
    expect(decision?.label).toBe("Which store?");
  });

  it("should carry the component name as the block kind when a component renders", () => {
    const { blocks } = compile(
      "## Contents\n\n<QuickSummary>\n\n<Why>\n\n- Value.\n\n</Why>\n\n<What>\n\n- Build it.\n\n</What>\n\n</QuickSummary>\n",
    );
    expect(blocks.map((block) => block.kind)).toContain("quick-summary");
  });

  it("should use a component's concise title instead of its control labels", () => {
    const { blocks } = compile(
      '## Metrics\n\n<DataTable title="Queue depth by processor">\n\n```table\n| Processor | Attempts |\n| --- | ---: |\n| Stripe | 3 |\n```\n\n</DataTable>\n',
    );
    const table = blocks.find((block) => block.kind === "data-table");
    expect(table?.label).toBe("Queue depth by processor");
  });

  it("should drop the generated kicker prefix from a sub-slide heading label", () => {
    const { blocks } = compile("## Design\n\n### The worker\n\nHow.\n");
    const heading = blocks.find(
      (block) => block.id === "section/the-worker/heading-1",
    );
    expect(heading?.label).toBe("The worker");
  });

  it("should truncate a long block's label rather than carry the whole paragraph", () => {
    const { blocks } = compile(`## One\n\n${"word ".repeat(60)}\n`);
    const paragraph = blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.label.length).toBeLessThanOrEqual(72);
    expect(paragraph?.label.endsWith("…")).toBe(true);
  });

  it("should restrict an id to a path-safe character set when a heading is not", () => {
    const { blocks } = compile("## Ship it! (v2) — now?\n\nBody.\n");
    for (const block of blocks) {
      expect(block.id).toMatch(/^[a-z0-9/-]+$/);
    }
  });

  it("should keep truncated heading scopes globally unique", () => {
    const prefix = "a".repeat(56);
    const { blocks } = compile(
      `## ${prefix} first\n\nA.\n\n## ${prefix} second\n\nB.\n`,
    );
    const paragraphIds = blocks
      .filter((block) => block.kind === "paragraph")
      .map((block) => block.id);
    expect(paragraphIds).toHaveLength(2);
    expect(new Set(paragraphIds).size).toBe(2);
    expect(paragraphIds[0]).toMatch(/^section\/a{48}\/paragraph-1$/u);
    expect(paragraphIds[1]).toMatch(/^section\/a{46}-2\/paragraph-1$/u);
  });

  it("should count kinds by their rendered id segment", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "div",
          properties: { "data-component": "Custom" },
          children: [
            {
              type: "element",
              tagName: "span",
              properties: { "data-commentable-kind": "table cell" },
              children: [{ type: "text", value: "First" }],
            },
            {
              type: "element",
              tagName: "span",
              properties: { "data-commentable-kind": "table-cell" },
              children: [{ type: "text", value: "Second" }],
            },
          ],
        },
      ],
    };
    const blocks: Array<BlockDescriptor> = [];
    rehypeBlockIdentity({ blocks })(tree);
    expect(blocks.map((block) => block.id)).toEqual([
      "document/custom-1",
      "document/table-cell-1",
      "document/table-cell-2",
    ]);
  });

  it("should address authored images inside prose as owned image blocks", () => {
    const { html, blocks } = compile(
      "## Evidence\n\n![Deployment screenshot](capture.png) and ![Trace](trace.webp)\n",
    );
    const images = blocks.filter((block) => block.kind === "image");
    expect(
      images.map(({ id, label, ownerId }) => ({ id, label, ownerId })),
    ).toEqual([
      {
        id: "section/evidence/image-1",
        label: "Deployment screenshot",
        ownerId: "section/evidence/paragraph-1",
      },
      {
        id: "section/evidence/image-2",
        label: "Trace",
        ownerId: "section/evidence/paragraph-1",
      },
    ]);
    expect(attributesFor({ html, id: "section/evidence/image-1" })).toContain(
      'data-block-kind="image"',
    );
  });
});

describe("block identity boundaries", () => {
  it("should leave a slide's generated kicker outside the block tree", () => {
    const { html } = compile("## One\n\nA.\n");
    expect(html).toMatch(/<p data-slide-kicker="" class="[^"]*">1 \/ One<\/p>/);
  });

  it("should address the scroll container rather than the table it wraps", () => {
    const { html, blocks } = compile(
      "## Rows\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
    );
    const table = blocks.find((block) => block.kind === "table");
    expect(table).toBeDefined();
    expect(attributesFor({ html, id: table?.id ?? "" })).toContain(
      "data-table-scroll-container",
    );
  });

  it("should give adjacent Markdown rows their concrete first-cell labels", () => {
    const { html, blocks } = compile(
      "## Rows\n\n| Field | Meaning |\n| --- | --- |\n| `versionId` | Content hash |\n| `number` | History position |\n",
    );
    const rows = blocks.filter((block) => block.kind === "table-row");
    expect(rows.map((row) => row.label)).toEqual([
      "Field",
      "versionId",
      "number",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "section/rows/table-row-1",
      "section/rows/table-row-2",
      "section/rows/table-row-3",
    ]);
    expect(html).toContain('data-block-label="versionId"');
    expect(html).toContain('data-block-label="number"');
    expect(rows.every((row) => row.section === "Rows")).toBe(true);
  });

  it("should address every Markdown table value and each header-defined column", () => {
    const { blocks } = compile(
      "## Rows\n\n| Field | Meaning |\n| --- | --- |\n| `versionId` | Content hash |\n| `number` | History position |\n",
    );
    const columns = blocks.filter((block) => block.kind === "table-column");
    const cells = blocks.filter((block) => block.kind === "table-cell");
    expect(columns.map((column) => column.label)).toEqual([
      "Column: Field",
      "Column: Meaning",
    ]);
    expect(cells.map((cell) => cell.label)).toEqual([
      "Field: versionId",
      "Meaning: Content hash",
      "Field: number",
      "Meaning: History position",
    ]);
  });

  it("should expose each QuickSummary facet without opening private component markup", () => {
    const { html, blocks } = compile(
      "## Summary\n\n<QuickSummary>\n\n<Why>\n\n- Value.\n\n</Why>\n\n<What>\n\n- Build it.\n\n</What>\n\n<How>\n\n- Carefully.\n\n</How>\n\n</QuickSummary>\n",
    );
    expect(
      blocks
        .filter((block) => block.kind === "quick-summary-facet")
        .map((block) => block.label),
    ).toEqual(["Why", "What", "How"]);
    const summary = blocks.find((block) => block.kind === "quick-summary");
    expect(summary).toBeDefined();
    expect(html).toMatch(
      new RegExp(
        `<aside[^>]*data-quick-summary[^>]*data-block-id="${summary?.id}"`,
      ),
    );
  });

  it("should name a Wireframe by its own title, an authored heading, or the screen it draws", () => {
    const wireframeLabel = (source: string): string | undefined =>
      compile(source).blocks.find((block) => block.kind === "wireframe")?.label;
    // A screen's caption names it over subordinate viewport metadata. Read as
    // one run of text those two facts collide, so a screen must never name a
    // whole wireframe through that caption.
    expect(
      wireframeLabel(
        '## Flow\n\n<Wireframe id="plain">\n  <Screen id="approve" name="Approve step" device="desktop">\n    <Text text="No heading anywhere." />\n    <Button label="Approve" />\n  </Screen>\n</Wireframe>\n',
      ),
    ).toBe("Approve step");
    // A figure that names itself outranks the screen beneath it.
    expect(
      wireframeLabel(
        '## Flow\n\n<Wireframe id="named" title="Named wireframe">\n  <Screen id="review" name="Review step" device="desktop">\n    <Text text="No heading anywhere." />\n    <Button label="Approve" />\n  </Screen>\n</Wireframe>\n',
      ),
    ).toBe("Named wireframe");
    // An authored heading inside the drawing outranks both.
    expect(
      wireframeLabel(
        '## Flow\n\n<Wireframe id="panelled">\n  <Screen id="thread" name="Thread step" device="desktop">\n    <Panel title="Review thread">\n      <Text text="Body copy." />\n    </Panel>\n  </Screen>\n</Wireframe>\n',
      ),
    ).toBe("Review thread");
  });

  it("should expose DataTable rows, cells, and columns as semantic sub-targets", () => {
    const { blocks } = compile(
      '## Gates\n\n<DataTable title="Rollout gates">\n\n```table\n| Gate | Owner |\n| --- | --- |\n| Durability | Service |\n```\n\n</DataTable>\n',
    );
    expect(
      blocks
        .filter((block) => block.kind === "table-column")
        .map((block) => block.label),
    ).toEqual(["Column: Gate", "Column: Owner"]);
    expect(
      blocks
        .filter((block) => block.kind === "table-cell")
        .map((block) => block.label),
    ).toEqual(["Gate: Durability", "Owner: Service"]);
    expect(
      blocks
        .filter((block) => block.kind === "table-row")
        .map((block) => block.label),
    ).toEqual(["Durability"]);
  });

  it("should not address a component's private internals as blocks", () => {
    const { blocks } = compile(DECISION_FIXTURE);
    // The decision card is one target; its options and considerations are the
    // component's own markup, not separately addressed units.
    expect(blocks.filter((block) => block.kind === "decision")).toHaveLength(1);
    expect(blocks.map((block) => block.id)).toEqual([
      "section/calls/heading-1",
      "section/calls/decision-1",
    ]);
  });

  it("should give a code figure's rows their file-absolute line numbers", () => {
    const { html } = compile(SNIPPET_FIXTURE);
    expect(html).toContain('data-block-line="12"');
    expect(html).toContain('data-block-line="13"');
  });

  it("should mark only a component's root and hand its declared internals the root as owner", () => {
    const { blocks } = compile(
      "## Summary\n\nIntro.\n\n<QuickSummary>\n\n<Why>\n\n- Value.\n\n</Why>\n\n<What>\n\n- Build it.\n\n</What>\n\n</QuickSummary>\n",
    );
    const summary = blocks.find((block) => block.kind === "quick-summary");
    const facets = blocks.filter(
      (block) => block.kind === "quick-summary-facet",
    );
    const paragraph = blocks.find((block) => block.kind === "paragraph");
    expect(summary?.isComponentRoot).toBe(true);
    expect(paragraph?.isComponentRoot).toBe(false);
    expect(facets).toHaveLength(2);
    for (const facet of facets) {
      expect(facet.isComponentRoot).toBe(false);
      expect(facet.ownerId).toBe(summary?.id);
    }
  });

  it("should hand a Markdown table's rows, columns, and cells the table as owner", () => {
    const { blocks } = compile(
      "## Rows\n\n| Field | Meaning |\n| --- | --- |\n| `versionId` | Content hash |\n",
    );
    const table = blocks.find((block) => block.kind === "table");
    const subTargets = blocks.filter((block) =>
      ["table-row", "table-column", "table-cell"].includes(block.kind),
    );
    expect(table?.isComponentRoot).toBe(false);
    expect(subTargets.length).toBeGreaterThan(0);
    for (const subTarget of subTargets) {
      expect(subTarget.ownerId).toBe(table?.id);
    }
  });

  it("should expose an HttpEndpoint's header, description, parameters, and responses as labeled fields", () => {
    const { blocks } = compile(
      '## Api\n\n<HttpEndpoint method="POST" path="/queue" summary="Queue a refresh" auth="Service token">\n\nQueues one refresh.\n\n<Param name="force" in="query" type="boolean">\n\nRefreshes fresh entries too.\n\n</Param>\n\n<Response status="202" label="Queued" />\n\n</HttpEndpoint>\n',
    );
    const endpoint = blocks.find((block) => block.kind === "http-endpoint");
    const fields = blocks.filter(
      (block) => block.kind === "http-endpoint-field",
    );
    expect(fields.map((field) => field.label)).toEqual([
      "POST /queue",
      "Description",
      "Query parameter: force",
      "Response: 202 Queued",
    ]);
    for (const field of fields) {
      expect(field.ownerId).toBe(endpoint?.id);
    }
    // The identity row keeps word boundaries when flattened, so a field diff
    // reads "force boolean optional" rather than one run-together token.
    const param = fields.find(
      (field) => field.label === "Query parameter: force",
    );
    expect(param?.text).toMatch(/force boolean optional/);
  });

  it("should expose a GraphqlOperation's arguments, returns, and payload fields as labeled fields", () => {
    const { blocks } = compile(
      '## Api\n\n<GraphqlOperation kind="mutation" name="refreshCreate">\n\nQueues a refresh.\n\n<Argument name="input" type="RefreshInput!">\n\nThe input.\n\n</Argument>\n\n<Field in="payload" name="refresh" type="Refresh">\n\nThe job.\n\n</Field>\n\n<Returns type="RefreshPayload">\n\nThe payload.\n\n</Returns>\n\n</GraphqlOperation>\n',
    );
    const operation = blocks.find(
      (block) => block.kind === "graphql-operation",
    );
    const fields = blocks.filter(
      (block) => block.kind === "graphql-operation-field",
    );
    expect(fields.map((field) => field.label)).toEqual([
      "mutation refreshCreate",
      "Description",
      "Argument: input",
      "Returns: RefreshPayload",
      "Payload field: refresh",
    ]);
    for (const field of fields) {
      expect(field.ownerId).toBe(operation?.id);
    }
  });

  it("should expose a GrpcMethod's signature, message fields, and status codes as labeled fields", () => {
    const { blocks } = compile(
      '## Api\n\n<GrpcMethod service="catalog.v1.RefreshService" name="WatchRefreshes" request="WatchRefreshesRequest" response="RefreshEvent" kind="serverStreaming">\n\nStreams refresh state changes.\n\n<Field in="request" name="refresh_id" type="string">\n\nWatches one job.\n\n</Field>\n\n<Error code="NOT_FOUND">\n\nNo such job.\n\n</Error>\n\n</GrpcMethod>\n',
    );
    const method = blocks.find((block) => block.kind === "grpc-method");
    const fields = blocks.filter((block) => block.kind === "grpc-method-field");
    expect(fields.map((field) => field.label)).toEqual([
      "rpc WatchRefreshes",
      "Description",
      "Request field: refresh_id",
      "Status code: NOT_FOUND",
    ]);
    for (const field of fields) {
      expect(field.ownerId).toBe(method?.id);
    }
  });

  it("should expose a DatabaseTableSchema's identity, columns, indexes, and DDL bands as labeled fields", () => {
    const { blocks } = compile(
      `## Schema\n\n<DatabaseTableSchema name="billing.plans">\n\n\`\`\`dbml\ncode  text [pk]\nlabel text [not null]\n\nindexes {\n  code [name: 'plans_code_idx']\n}\n\`\`\`\n\n<Ddl title="Triggers">\n\n\`\`\`sql\nCREATE TRIGGER plans_touch BEFORE UPDATE ON billing.plans;\n\`\`\`\n\n</Ddl>\n\n</DatabaseTableSchema>\n`,
    );
    const schema = blocks.find(
      (block) => block.kind === "database-table-schema",
    );
    const fields = blocks.filter(
      (block) => block.kind === "database-table-schema-field",
    );
    expect(fields.map((field) => field.label)).toEqual([
      "Table: billing.plans",
      "Column: code",
      "Column: label",
      "Index: plans_code_idx",
      "DDL: Triggers",
    ]);
    for (const field of fields) {
      expect(field.ownerId).toBe(schema?.id);
    }
  });

  it("should keep hidden markup out of a block's diffable text", () => {
    const { blocks } = compile(
      `## Schema\n\n<DatabaseTableSchema name="billing.plans">\n\n\`\`\`dbml\ncode text [pk]\n\`\`\`\n\n</DatabaseTableSchema>\n`,
    );
    const schema = blocks.find(
      (block) => block.kind === "database-table-schema",
    );
    // The dormant column menu and the machine-readable source ship with the
    // hidden attribute; neither is presented to the reader, so neither may
    // enter the text a causal diff shows.
    expect(schema?.text).not.toContain("Reset column layout");
    expect(schema?.text).not.toContain("[pk]");
    expect(schema?.text).toContain("code");
  });

  it("should record a callout's authored type and a list's ordering as presentation facts", () => {
    const { blocks } = compile(
      '## Risks\n\n<Callout type="danger" title="Rollback risk">\n\nData loss until verified.\n\n</Callout>\n\n1. Freeze writes.\n2. Backfill twice.\n\n- Alpha\n- Beta\n\nPlain paragraph.\n',
    );
    const callout = blocks.find((block) => block.kind === "callout");
    expect(callout?.presentation).toEqual({
      aspect: "callout",
      calloutType: "danger",
    });
    const lists = blocks.filter((block) => block.kind === "list");
    expect(lists.map((block) => block.presentation)).toEqual([
      { aspect: "list", isOrdered: true },
      { aspect: "list", isOrdered: false },
    ]);
    const paragraph = blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.presentation).toBeUndefined();
  });

  it("should record a picture's source and alternative words as presentation facts", () => {
    const { blocks } = compile(
      "## Evidence\n\n![Retry dashboard](./assets/retries.png)\n",
    );
    const picture = blocks.find((block) => block.kind === "image");
    // A picture contributes no text at all, so these two facts are the only
    // evidence a later snapshot has that the picture changed.
    expect(picture?.text).toBe("");
    expect(picture?.presentation).toEqual({
      aspect: "image",
      source: "./assets/retries.png",
      alt: "Retry dashboard",
    });
  });

  it("should keep block boundaries apart when component text is flattened", () => {
    const { blocks } = compile(
      "## Summary\n\n<QuickSummary>\n\n<Why>\n\n- Value.\n\n</Why>\n\n<What>\n\n- Build it.\n\n</What>\n\n<How>\n\n- Move retries out.\n- Record every attempt.\n\n</How>\n\n</QuickSummary>\n",
    );
    const facet = blocks.find(
      (block) => block.kind === "quick-summary-facet" && block.label === "How",
    );
    expect(facet?.text).toMatch(/^How\n/);
    expect(facet?.text).toMatch(
      /Move retries out\.\s*\nRecord every attempt\./,
    );
  });
});
