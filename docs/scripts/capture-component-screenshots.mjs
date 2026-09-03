// Captures the light and dark viewer and component screenshots embedded in
// the docs. Renders fixtures with the local CLI, then screenshots the same
// regions in both color schemes so each light/dark pair shares one crop. Run
// from docs/ via `bun run screenshots` after building the renderer.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "docs", "src", "assets", "components");
const VIEWER_OUT_DIR = join(ROOT, "docs", "src", "assets");
const VIEWER_FIXTURE = readFileSync(
  join(ROOT, "docs", "src", "demo", "example-plan.md"),
  "utf8",
);
const CLI = join(ROOT, "bin", "big-plan.mjs");

const CALLOUTS_FIXTURE = `<Callout type="note" title="Review decision">

Approving this plan green-lights the cache rewrite; the rollout plan ships separately.

</Callout>

<Callout type="tip">

Render this plan locally with \`npx -y big-plan@latest render plan.mdx\` to review it in your own browser.

</Callout>

<Callout type="warning" title="Deploy ordering">

Enable the worker before raising the stale-read window, or reads serve stale data with no refresh running.

</Callout>

<Callout type="danger">

Skipping the backfill drops rows written during the migration window; there is no recovery path.

</Callout>
`;

const ANNOTATION_FIXTURE = `<CodeDiff file="src/catalog/read-through-cache.ts" showLineNumbers>

\`\`\`diff
@@ -18,4 +18,7 @@ export const readCatalog = async (key: string) => {
   const cached = await cache.get(key);
-  if (cached !== null && cached.ageSeconds <= 60) {
+  if (cached !== null && cached.ageSeconds <= 150) {
+    if (cached.ageSeconds > 60) {
+      await refreshQueue.enqueueOnce(key);
+    }
     return cached.value;
   }
\`\`\`

<Annotation lines="19-22" side="new">
This range turns the cache-age check into a stale-while-revalidate policy: entries under 60 seconds serve directly, entries between 60 and 150 serve stale while a background refresh runs, and older entries fall through to the origin.
</Annotation>

</CodeDiff>
`;

const SNIPPET_FIXTURE = `<CodeSnippet file="src/catalog/refresh-worker.ts" startLine="42" showLineNumbers>

\`\`\`ts
export const refreshCatalog = async (key: string): Promise<void> => {
  const current = await catalogOrigin.read(key);
  await cache.put(key, current, { ttlSeconds: 300 });
  metrics.increment("catalog_cache.refresh_success");
};
\`\`\`

<Annotation lines="43">

Resolve through \`catalogOrigin\` so refreshes use the same retries and tracing as synchronous fallbacks.

</Annotation>

<Annotation lines="44-45">

The cache write must complete before success is recorded; otherwise dashboards can report a refresh that readers cannot observe.

</Annotation>

</CodeSnippet>
`;

const FILE_TREE_FIXTURE = `<FileTree title="Worker pool layout">

\`\`\`tree
worker-pool/
  refresh-worker.ts - Consumes deduplicated catalog refresh jobs.
  worker-config.ts - Owns concurrency and timeout settings.
\`\`\`

</FileTree>
`;

const TREE_DIFF_FIXTURE = `<FileTreeDiff title="Planned changes">

\`\`\`tree
src/
  catalog/
    catalog-origin.ts
    refresh-worker.ts [modified] - Move refresh work behind the queue.
    refresh-queue.ts [added] - Deduplicate refresh jobs by cache key.
  metrics/ [removed] - The legacy metrics module retires with its counter.
    legacy-cache-counter.ts [removed]
  queue/ [added] - New home for queue worker configuration.
    queue-config.ts [added]
ops/ -> deploy/ [renamed] - Match the platform team's naming.
  runbook.md
README.md [modified]
\`\`\`

</FileTreeDiff>
`;

const DECISION_ANALYSIS_FIXTURE = `<DecisionAnalysis question="Which persistence layer should back review state?" state="proposed" interaction="audit">

Comments need durable identities and ordered replies without blocking a later multi-reviewer workflow.

<Criterion title="Anchor integrity">

Selection anchors and their threads must stay consistent through crashes.

</Criterion>

<Criterion title="Local-first setup">

How much local setup the store requires.

</Criterion>

<Criterion title="Concurrent reviewers">

How well the store admits shared review later.

</Criterion>

<Option title="PostgreSQL" recommended summary="The relational store the team already operates.">

<Score criterion="Anchor integrity" verdict="Strong" tone="good">

Transactions keep a thread and its anchor in one atomic write.

</Score>

<Score criterion="Local-first setup" verdict="Needs a server" tone="bad">

A database service must be running.

</Score>

<Score criterion="Concurrent reviewers" verdict="Ready" tone="good">

Concurrent readers and writers are native.

</Score>

</Option>

<Option title="SQLite" summary="One embedded database beside the local server.">

<Score criterion="Anchor integrity" verdict="Strong" tone="good">

Transactions protect related records in one file.

</Score>

<Score criterion="Local-first setup" verdict="Zero setup" tone="good">

The process opens the file directly.

</Score>

<Score criterion="Concurrent reviewers" verdict="Single writer" tone="mixed">

Write concurrency becomes the migration boundary.

</Score>

</Option>

<Reversibility rating="somewhat-hard">

The repository layer isolates SQL, so swapping engines later costs a data migration.

</Reversibility>

</DecisionAnalysis>
`;

const QUICK_DECISION_FIXTURE = `<QuickDecision question="Should the first release ship behind a feature flag?" context="The first week carries the rollout risk.">

<Option title="Yes" recommended summary="Rollback stays one toggle away." />

<Option title="No" />

</QuickDecision>
`;

/** Renders an MDX fixture through the CLI and returns the output HTML path. */
const renderFixture = ({ dir, name, mdx }) => {
  const input = join(dir, `${name}.mdx`);
  const output = join(dir, `${name}.html`);
  writeFileSync(input, mdx);
  execFileSync(process.execPath, [CLI, "render", input, output]);
  return output;
};

/** Screenshots one region of a rendered fixture in one color scheme. */
const capture = async ({
  browser,
  colorScheme,
  html,
  shoot,
  out,
  outDir = OUT_DIR,
  width = 760,
  height = 1600,
}) => {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`file://${html}`);
  await shoot(page, join(outDir, out));
  await context.close();
};

/** Screenshots the union of every callout box, padded, in page coordinates. */
const shootCallouts = async (page, path) => {
  const clip = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-callout]")].map((el) =>
      el.getBoundingClientRect(),
    );
    const pad = 8;
    const left = Math.min(...boxes.map((b) => b.left)) - pad;
    const top = Math.min(...boxes.map((b) => b.top)) + window.scrollY - pad;
    const right = Math.max(...boxes.map((b) => b.right)) + pad;
    const bottom =
      Math.max(...boxes.map((b) => b.bottom)) + window.scrollY + pad;
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
  await page.screenshot({ path, clip });
};

/** Screenshots the CodeDiff figure element. */
const shootFigure = async (page, path) => {
  await page.locator("figure[data-code-diff]").screenshot({ path });
};

/** Screenshots the CodeSnippet figure element. */
const shootSnippet = async (page, path) => {
  await page.locator("figure[data-code-snippet]").screenshot({ path });
};

/** Screenshots the FileTree figure element. */
const shootFileTree = async (page, path) => {
  await page.locator("figure[data-file-tree]").screenshot({ path });
};

/** Screenshots the FileTreeDiff figure element. */
const shootFileTreeDiff = async (page, path) => {
  await page.locator("figure[data-file-tree-diff]").screenshot({ path });
};

/** Screenshots the DecisionAnalysis figure element. */
const shootDecisionAnalysis = async (page, path) => {
  await page
    .locator("figure[data-decision-layout=matrix]")
    .screenshot({ path });
};

/** Screenshots the QuickDecision figure element. */
const shootQuickDecision = async (page, path) => {
  await page.locator("figure[data-decision-layout=brief]").screenshot({ path });
};

/** Screenshots a square crop beginning at the review document's article. */
const shootViewer = async (page, path) => {
  const article = await page.locator("article").boundingBox();
  if (article === null) {
    throw new Error("Rendered viewer has no article.");
  }
  await page.screenshot({
    path,
    clip: {
      x: article.x,
      y: article.y,
      width: Math.min(article.width, 744),
      height: 744,
    },
  });
};

/** Screenshots the shell and unified diff at a representative reading point. */
const shootFullViewer = async (page, path) => {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const heading = document.querySelector("#code-diff");
    if (heading === null) {
      throw new Error("Rendered viewer has no Code diff section.");
    }
    heading.scrollIntoView();
    window.scrollBy({ top: -96 });
  });
  await page.waitForFunction(
    () =>
      Math.abs(
        (document.querySelector("#code-diff")?.getBoundingClientRect().top ??
          0) - 96,
      ) < 2,
  );
  await page.screenshot({ path });
};

const DATA_TABLE_FIXTURE = `<DataTable groupBy="Region" filter>

\`\`\`table
| Region | Store | Orders | Refund rate |
| --- | --- | ---: | ---: |
| EU | Berlin | 1,204 | 2.1% |
| EU | Paris | 987 | 1.8% |
| EU | Madrid | 612 | 3.4% |
| US | Austin | 2,310 | 1.2% |
| US | Denver | 1,845 | 1.9% |
| US | Portland | 903 | 2.7% |
\`\`\`

</DataTable>
`;

const SCHEMA_FIXTURE = `<DatabaseTableSchema name="capture_attempt">

\`\`\`dbml
id uuid [pk]
payment_id uuid [ref: > payment.id, not null]
attempt_no integer [not null, note: 'Ordinal within one payment']
state text [not null, note: 'queued | running | settled | failed']
created_at timestamptz [not null, default: 'now()']
\`\`\`

</DatabaseTableSchema>
`;

const FLOW_FIXTURE = `<FlowDiagram>

<Stage title="Source of truth">
<Node id="plan" label="plan.mdx" tone="source">

The authored plan on disk

</Node>
</Stage>

<Stage title="Compile">
<Node id="compile" label="Validate and translate" code="compileMarkdownTree()">

Rejects anything outside the plan format

</Node>
</Stage>

<Stage id="surfaces" title="Available through">
<Node id="review" label="Live review" code="big-plan review" tone="destination">

Comments, decisions, approval

</Node>
<Node id="html" label="Review document" code="big-plan render" tone="destination">

One self-contained file

</Node>
</Stage>

<Edge from="plan" to="compile" label="feeds" />
<Edge from="compile" to="review" label="serves" />
<Edge from="compile" to="html" label="writes" />

One source - three deliveries - no drift between them.

</FlowDiagram>
`;

const HTTP_FIXTURE = `<HttpEndpoint method="POST" path="/v1/captures/{paymentId}/retry" summary="Queue one more capture attempt" auth="Internal service token">

Queues a deduplicated retry for one payment and returns immediately; the capture worker performs the attempt asynchronously.

<Param name="paymentId" in="path" type="string" required>

The payment to retry.

</Param>

<Param name="Idempotency-Key" in="header" type="string" required>

Makes a repeated request safe; a replay returns the original attempt.

</Param>

<Param name="delaySeconds" in="body" type="integer" default="0">

Seconds to wait before the worker picks the attempt up.

</Param>

<Request contentType="application/json">

\`\`\`json
{ "delaySeconds": 30 }
\`\`\`

</Request>

<Response status="202" label="Attempt queued">

\`\`\`json
{ "attemptId": "b7f2c1a9", "state": "queued", "attemptNo": 2 }
\`\`\`

</Response>

<Response status="409" label="Already queued">

\`\`\`json
{ "error": "attempt_already_queued" }
\`\`\`

</Response>

</HttpEndpoint>
`;

const GRAPHQL_FIXTURE = `<GraphqlOperation kind="mutation" name="captureRetryCreate" access="Requires payments:write">

Queues a capture retry through the GraphQL bridge, mirroring the HTTP endpoint.

<Argument name="input" type="CaptureRetryCreateInput!">

The payment to retry and how long to wait first.

</Argument>

<Field in="input" name="paymentId" type="ID!">

The payment to retry.

</Field>

<Field in="input" name="delaySeconds" type="Int" default="0">

Seconds to wait before the worker picks the attempt up.

</Field>

<Returns type="CaptureRetryCreatePayload">

The queued \`attempt\` plus a \`userErrors\` list following the mutation-payload convention.

</Returns>

<Field in="payload" name="attempt" type="CaptureAttempt">

The attempt that was queued.

</Field>

<Field in="payload" name="userErrors" type="[UserError!]!">

Empty when the retry was accepted.

</Field>

</GraphqlOperation>
`;

const GRPC_FIXTURE = `<GrpcMethod service="payments.v1.CaptureService" name="WatchAttempts" request="WatchAttemptsRequest" response="CaptureAttempt" kind="serverStreaming">

Streams capture-attempt state changes as the worker processes the queue.

<Field in="request" name="payment_id" type="string">

Optional. Watches one payment; absent means every payment the caller can see.

</Field>

<Field in="response" name="attempt_no" type="int32">

The ordinal of this attempt within its payment.

</Field>

<Field in="response" name="state" type="string">

One of queued, running, settled, or failed.

</Field>

<Error code="NOT_FOUND">

The payment does not exist or the caller cannot see it.

</Error>

<Example label="Request">

\`\`\`json
{ "payment_id": "pay_31c8" }
\`\`\`

</Example>

</GrpcMethod>
`;

const QUICK_SUMMARY_FIXTURE = `<QuickSummary>

<Why>

- Failed captures block checkout requests, so a slow processor becomes a slow storefront.

</Why>

<What>

- Move capture retries into a durable queue with explicit state and an audit trail.

</What>

<How>

- Take retries out of the API server and into a worker.
- Ship operator controls to pause, force, and cancel a retry.

</How>

</QuickSummary>
`;

const TOC_FIXTURE = `<TableOfContents>
  <Entry section="Status quo" gist="Captures retry inline and block the request" />
  <Entry section="Desired outcome" gist="A failed capture recovers without a blocked request" />
  <Entry section="The retry queue" gist="Durable state, explicit transitions, one worker" />
  <Entry section="Acceptance criteria" gist="Recovery, ordering, and the operator controls" />
</TableOfContents>

## Status quo

Placeholder.

## Desired outcome

Placeholder.

## The retry queue

Placeholder.

## Acceptance criteria

Placeholder.
`;

const PART_FIXTURE = `<Part title="The proposal" />

## The retry queue replaces the inline attempt

Every capture that fails is written to a durable queue instead of retried in the request.
`;

const DECISION_FIXTURE = `<Decision question="How should the retry worker be scheduled?">

<Option title="One worker per region" recommended summary="Isolate a regional processor outage.">

<Consideration label="Blast radius" verdict="Regional" tone="good">

One region's backlog cannot stall another region's captures.

</Consideration>

<Consideration label="Operations" verdict="More processes" tone="mixed">

Each region needs its own health check and dashboard row.

</Consideration>

</Option>

<Option title="One global worker" summary="Fewer moving parts to operate.">

<Consideration label="Blast radius" verdict="Global" tone="bad">

One stuck payment delays every region's queue behind it.

</Consideration>

<Consideration label="Operations" verdict="One process" tone="good">

A single health check covers the whole queue.

</Consideration>

</Option>

</Decision>
`;

const SLIDE_FIXTURE = `<Slide type="status-quo" />

## Captures retry inline and block the request

A failed capture is retried inside the checkout request, so a slow processor becomes a slow
storefront.
`;

const WIREFRAME_FIXTURE = `<Wireframe id="retry-console" title="Operator retry console">
  <Screen id="queue" name="Retry queue" device="desktop" url="ops.example.com/retries">
    <AppShell>
      <Sidebar brand="Payments Ops">
        <Nav label="Sections">
          <NavItem label="Payments" />
          <NavItem label="Retry queue" active />
          <NavItem label="Settings" />
        </Nav>
      </Sidebar>
      <AppContent>
        <Stack gap="md">
          <PageHeader title="Retry queue" description="Attempts waiting on the capture worker." />
          <Row gap="md">
            <Panel surface="outlined" title="Queued" status="waiting">
              <Metric label="Attempts" value="24" note="Oldest 4m" />
            </Panel>
            <Panel surface="outlined" title="Failed today" status="attention">
              <Metric label="Payments" value="3" note="All retryable" />
            </Panel>
          </Row>
          <Table selected="1">

\`\`\`text
Payment | Attempt | State
#4821 | 2 | [Queued:warning]
#4818 | 1 | [Running:info]
#4802 | 3 | [Failed:danger]
\`\`\`

          </Table>
          <Row gap="sm" justify="between">
            <Group gap="sm">
              <Button label="Force retry now" emphasis="primary" icon="refresh" />
              <Button label="Pause the queue" emphasis="tertiary" icon="pause" />
            </Group>
            <Button label="Export" emphasis="tertiary" icon="download" />
          </Row>
        </Stack>
      </AppContent>
    </AppShell>
  </Screen>
</Wireframe>
`;

const MERMAID_FIXTURE = `<MermaidDiagram>

\`\`\`mermaid
stateDiagram-v2
  [*] --> Queued
  Queued --> Running: worker picks it up
  Running --> Settled: processor accepts
  Running --> Failed: processor refuses
  Failed --> Queued: operator forces a retry
  Settled --> [*]
\`\`\`

</MermaidDiagram>
`;

/** Screenshots the rendered slide frame a Slide marker types. */
const shootSlide = async (page, path) => {
  await page.locator("section[data-slide-type]").first().screenshot({ path });
};

/** Builds a shoot function that screenshots one component's rendered root. */
const shootComponent = (name) => async (page, path) => {
  await page.locator(`[data-component="${name}"]`).first().screenshot({ path });
};

const SHOTS = [
  {
    name: "callouts",
    mdx: CALLOUTS_FIXTURE,
    base: "callout-types",
    shoot: shootCallouts,
  },
  {
    name: "annotation",
    mdx: ANNOTATION_FIXTURE,
    base: "annotation-card",
    shoot: shootFigure,
  },
  {
    name: "decision-analysis",
    mdx: DECISION_ANALYSIS_FIXTURE,
    base: "decision-analysis",
    shoot: shootDecisionAnalysis,
  },
  {
    name: "quick-decision",
    mdx: QUICK_DECISION_FIXTURE,
    base: "quick-decision",
    shoot: shootQuickDecision,
  },
  {
    name: "snippet",
    mdx: SNIPPET_FIXTURE,
    base: "code-snippet-annotated",
    shoot: shootSnippet,
  },
  {
    name: "file-tree",
    mdx: FILE_TREE_FIXTURE,
    base: "file-tree-plain",
    shoot: shootFileTree,
  },
  {
    name: "tree-diff-combined",
    mdx: TREE_DIFF_FIXTURE,
    base: "file-tree-diff-combined",
    shoot: shootFileTreeDiff,
  },
  {
    name: "data-table",
    mdx: DATA_TABLE_FIXTURE,
    base: "data-table",
    shoot: shootComponent("DataTable"),
  },
  {
    name: "database-table-schema",
    mdx: SCHEMA_FIXTURE,
    base: "database-table-schema",
    shoot: shootComponent("DatabaseTableSchema"),
  },
  {
    name: "decision",
    mdx: DECISION_FIXTURE,
    base: "decision",
    shoot: shootComponent("Decision"),
  },
  {
    name: "flow-diagram",
    mdx: FLOW_FIXTURE,
    base: "flow-diagram",
    shoot: shootComponent("FlowDiagram"),
  },
  {
    name: "mermaid-diagram",
    mdx: MERMAID_FIXTURE,
    base: "mermaid-diagram",
    shoot: shootComponent("MermaidDiagram"),
  },
  {
    name: "http-endpoint",
    mdx: HTTP_FIXTURE,
    base: "http-endpoint",
    shoot: shootComponent("HttpEndpoint"),
  },
  {
    name: "graphql-operation",
    mdx: GRAPHQL_FIXTURE,
    base: "graphql-operation",
    shoot: shootComponent("GraphqlOperation"),
  },
  {
    name: "grpc-method",
    mdx: GRPC_FIXTURE,
    base: "grpc-method",
    shoot: shootComponent("GrpcMethod"),
  },
  {
    name: "quick-summary",
    mdx: QUICK_SUMMARY_FIXTURE,
    base: "quick-summary",
    shoot: shootComponent("QuickSummary"),
  },
  {
    name: "table-of-contents",
    mdx: TOC_FIXTURE,
    base: "table-of-contents",
    shoot: shootComponent("TableOfContents"),
  },
  {
    name: "part",
    mdx: PART_FIXTURE,
    base: "part",
    shoot: shootComponent("Part"),
  },
  {
    name: "slide",
    mdx: SLIDE_FIXTURE,
    base: "slide",
    shoot: shootSlide,
  },
  {
    name: "wireframe",
    mdx: WIREFRAME_FIXTURE,
    base: "wireframe",
    shoot: shootComponent("Wireframe"),
  },
];

// `BIG_PLAN_SHOTS` narrows a run to a comma-separated list of shot names, and
// `BIG_PLAN_SHOTS=components` skips the two viewer captures. Capturing every
// shot stays the default, so an unfiltered run is unchanged.
const requested = (process.env.BIG_PLAN_SHOTS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");
const componentsOnly = requested.includes("components");
const selected =
  requested.length === 0 || componentsOnly
    ? SHOTS
    : SHOTS.filter((shot) => requested.includes(shot.name));

const dir = mkdtempSync(join(tmpdir(), "big-plan-shots-"));
const browser = await chromium.launch();
try {
  const viewerHtml =
    requested.length === 0
      ? renderFixture({ dir, name: "viewer", mdx: VIEWER_FIXTURE })
      : undefined;
  for (const colorScheme of viewerHtml === undefined ? [] : ["light", "dark"]) {
    await capture({
      browser,
      colorScheme,
      html: viewerHtml,
      shoot: shootViewer,
      out: `viewer-${colorScheme}.png`,
      outDir: VIEWER_OUT_DIR,
      width: 1280,
      height: 900,
    });
    console.log(`captured viewer-${colorScheme}.png`);
    await capture({
      browser,
      colorScheme,
      html: viewerHtml,
      shoot: shootFullViewer,
      out: `viewer-full-${colorScheme}.png`,
      outDir: VIEWER_OUT_DIR,
      width: 1280,
      height: 900,
    });
    console.log(`captured viewer-full-${colorScheme}.png`);
  }
  for (const shot of selected) {
    const html = renderFixture({ dir, name: shot.name, mdx: shot.mdx });
    for (const colorScheme of ["light", "dark"]) {
      await capture({
        browser,
        colorScheme,
        html,
        shoot: shot.shoot,
        out: `${shot.base}-${colorScheme}.png`,
      });
      console.log(`captured ${shot.base}-${colorScheme}.png`);
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
