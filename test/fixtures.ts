// The suite's extended Playwright test, per the render-health rule: every
// spec fails on console errors or uncaught page errors automatically, and the
// fixture documents are rendered once per worker through the built CLI so
// specs exercise exactly what a user runs. Specs import test/expect from here,
// never from @playwright/test directly.

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";
import { startReviewRuntime } from "../src/review/server.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(repoRoot, "bin", "big-plan.mjs");

// Fixtures follow the same workflow a user runs: guidance first, then render.
// The acknowledgment state lives inside the fixture's temporary directory so
// workers never read or write the developer's real acknowledgment state.
const renderThroughCli = async ({
  inputPath,
  outputPath,
  outputDir,
}: {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly outputDir: string;
}): Promise<void> => {
  const env = { ...process.env, BIG_PLAN_STATE_DIR: join(outputDir, "state") };
  await execFileAsync(process.execPath, [binPath, "guidance"], { env });
  await execFileAsync(
    process.execPath,
    [binPath, "render", inputPath, outputPath],
    { env },
  );
};

type WorkerFixtures = {
  readonly annotationCodeViewerUrl: string;
  readonly codeSnippetSyntaxMaximizeViewerUrl: string;
  readonly imageSelectionViewerUrl: string;
  readonly allComponentsViewerUrl: string;
  readonly componentsViewerUrl: string;
  readonly apiEndpointsViewerUrl: string;
  readonly dataTableViewerUrl: string;
  readonly decisionAnalysisViewerUrl: string;
  readonly nestedWeightedDecisionAnalysisViewerUrl: string;
  readonly deckViewerUrl: string;
  readonly decisionViewerUrl: string;
  readonly nestedDecisionMatrixViewerUrl: string;
  readonly flowDiagramViewerUrl: string;
  readonly mermaidDiagramViewerUrl: string;
  readonly mermaidGalleryViewerUrl: string;
  readonly slideCraftViewerUrl: string;
  readonly nestedDecisionViewerUrl: string;
  readonly planIdCollisionViewerUrls: {
    readonly empty: string;
    readonly first: string;
    readonly second: string;
    readonly unidentified: string;
  };
  readonly quickDecisionViewerUrl: string;
  readonly sampleViewerUrl: string;
  readonly tableSchemaViewerUrl: string;
  readonly weightedAuditDecisionAnalysisViewerUrl: string;
  readonly wireframeFormFactorsViewerUrl: string;
  readonly wireframeLongCaptionDesktopViewerUrl: string;
  readonly wireframeQualityViewerUrl: string;
  readonly wireframeSparseAppShellViewerUrl: string;
  readonly wireframeShortContentViewerUrl: string;
  readonly wireframeViewerUrl: string;
};

type TestFixtures = {
  readonly reviewRuntimeUrl: string;
  // Browser-level messages a journey deliberately provokes, such as the 404 a
  // missing picture logs while the document proves it says so. Every other
  // console error still fails the test, so an allowance names one expected
  // message rather than relaxing the render-health contract.
  readonly allowedConsoleErrors: ReadonlyArray<RegExp>;
};

const ANNOTATION_CODE_MDX = `# Annotation code

<CodeDiff file="src/retry.ts">

\`\`\`diff
@@ -1 +1 @@
-oldRetry();
+newRetry();
\`\`\`

<Annotation lines="1">

Try the fallback locally:

\`\`\`ts
retry();
\`\`\`

</Annotation>

</CodeDiff>
`;

// A CodeSnippet with no showLineNumbers attribute, so the fixture proves the
// number rail stays hidden at rest and appears only once maximized. The
// TypeScript fence keeps a keyword, a type name, and a string in view so the
// same document verifies token-level syntax highlighting.
const CODE_SNIPPET_SYNTAX_MAXIMIZE_MDX = `# Code snippet syntax and maximize

<CodeSnippet file="src/review/plan.ts" startLine="42">

\`\`\`ts
export const summarize = (title: string): string =>
  "Reviewing " + title;
\`\`\`

</CodeSnippet>
`;

const IMAGE_SELECTION_MDX = `# Image selection

Reviewers should be able to comment on visual evidence alongside text.

## Evidence

Review the deployment result before approving the rollout.

![Deployment screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=)
`;

const MERMAID_REVIEW_MDX = `# Mermaid diagram review

This fixture proves review state survives every viewer transition.

## Review state survives a hidden theme change

The graph remains reviewable before and after the slide is collapsed.

<MermaidDiagram>

\`\`\`mermaid
flowchart LR
  source[Source] -->|ships| result((Result))
  source -.-> result
\`\`\`

Static SVG content remains readable with scripts disabled.

</MermaidDiagram>
`;

// Two Decisions, one inside the other's context, so the specs can prove an
// outer selector never binds the inner one's controls.
const NESTED_DECISION_MATRIX_MDX = `# Nested decision matrices

<Decision question="Which outer channel?">

<Decision question="Which inner channel?">

<Option title="Inner A" recommended summary="First inner option.">
<Consideration label="Cost" verdict="Low" tone="good">

It reuses the existing inner path.

</Consideration>
</Option>

<Option title="Inner B" summary="Second inner option.">
<Consideration label="Cost" verdict="High" tone="bad">

It requires a separate inner path.

</Consideration>
</Option>

</Decision>

<Option title="Outer A" recommended summary="First outer option.">
<Consideration label="Cost" verdict="Low" tone="good">

It reuses the existing outer path.

</Consideration>
</Option>

<Option title="Outer B" summary="Second outer option.">
<Consideration label="Cost" verdict="High" tone="bad">

It requires a separate outer path.

</Consideration>
</Option>

</Decision>
`;

const NESTED_DECISION_MDX = `# Nested decisions

<Decision question="Which outer option should win?">

The outer context introduces a complete decision.

<Decision question="Which inner option should win?">
  <Option title="Inner A" recommended summary="First inner option." />
  <Option title="Inner B" summary="Second inner option." />
</Decision>

<Option title="Outer A" recommended summary="First outer option." />
<Option title="Outer B" summary="Second outer option." />

</Decision>
`;

const PLAN_ID_COLLISION_FIRST_MDX = `# Shared title

The first delivery approach keeps its review state isolated.

<Part title="Context" />

## Shared section

The first plan has its own review state.

<DatabaseTableSchema name="shared.review_items">

\`\`\`dbml
id      bigint [pk]
status  text   [not null, default: 'open']
comment text   [note: 'Reviewer context.']
\`\`\`

</DatabaseTableSchema>

<DataTable title="Shared review items">

\`\`\`table
| Item | Owner | Note |
| --- | --- | --- |
| Retry policy | Platform | First plan context |
\`\`\`

</DataTable>
`;

const PLAN_ID_COLLISION_SECOND_MDX = `# Shared title

The second delivery approach keeps its review state isolated.

<Part title="Context" />

## Shared section

The second plan must not inherit review state.

<DatabaseTableSchema name="shared.review_items">

\`\`\`dbml
id      bigint [pk]
status  text   [not null, default: 'open']
comment text   [note: 'Reviewer context.']
\`\`\`

</DatabaseTableSchema>

<DataTable title="Shared review items">

\`\`\`table
| Item | Owner | Note |
| --- | --- | --- |
| Retry policy | Platform | Second plan context |
\`\`\`

</DataTable>
`;

const WIREFRAME_SHORT_CONTENT_MDX = `# Short wireframe

<Wireframe id="short-content" title="Content-sized screen">
  <Screen id="ready" name="Ready" device="phone">
    <Panel title="Ready">
      <Text text="The short state is complete." />
    </Panel>
  </Screen>
</Wireframe>
`;

// A name far longer than any frame can hold on one line. It is the caption
// contract's worst case: the two lines have to wrap inside the frame's width
// at every review width and still leave the maximized frame room to fit.
const WIREFRAME_LONG_CAPTION_DESKTOP_MDX = `# Long-caption desktop workspace

<Wireframe id="long-caption-desktop" title="Long caption alignment">
  <Screen
    id="historical"
    name="Historical change across a deliberately long reviewer-visible desktop screen caption that must wrap without outgrowing its frame while preserving readable typography, subordinate viewport metadata, frame alignment, and the complete maximized desktop silhouette at every supported review width"
    device="desktop"
  >
    <Panel title="Review thread">
      <Text text="The complete caption remains aligned with this desktop frame." />
    </Panel>
  </Screen>
</Wireframe>
`;

const WIREFRAME_SPARSE_APP_SHELL_MDX = `# Sparse application shells

<Wireframe id="sparse-app-shell-top-bar">
  <Screen id="workspace" name="Workspace" device="desktop">
    <AppShell>
      <TopBar title="Workspace" />
      <AppContent>
        <Row>
          <Panel title="Workspace">
            <Text text="One focused task." />
          </Panel>
        </Row>
      </AppContent>
    </AppShell>
  </Screen>
</Wireframe>

<Wireframe id="sparse-app-shell-no-top-bar">
  <Screen id="full-workspace" name="Full workspace" device="desktop">
    <AppShell>
      <AppContent>
        <Row>
          <Panel title="Workspace">
            <Text text="One focused task." />
          </Panel>
        </Row>
      </AppContent>
    </AppShell>
  </Screen>
</Wireframe>
`;

const REVIEW_RUNTIME_MDX = `# Review persistence

Keep every reviewer note safe while the plan is discussed.

## Details

The table has adjacent targets that must remain distinguishable.

| Field | Meaning |
| --- | --- |
| \`versionId\` | Content hash of the snapshot |
| \`number\` | Position in this plan's history |

## Delivery

Sending writes one real feedback package beside this plan.
`;

export const test = base.extend<TestFixtures, WorkerFixtures>({
  reviewRuntimeUrl: [
    async ({ page }, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-review-runtime-"),
      );
      const inputPath = join(outputDir, "plan.mdx");
      await writeFile(inputPath, REVIEW_RUNTIME_MDX, "utf8");
      const runtime = await startReviewRuntime({ planPath: inputPath });
      try {
        await use(runtime.url);
      } finally {
        // Unmount the polling review island before its runtime disappears.
        if (!page.isClosed()) await page.goto("about:blank");
        await runtime.close();
        await rm(outputDir, { recursive: true, force: true });
      }
    },
    { scope: "test" },
  ],
  annotationCodeViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-annotation-code-"),
      );
      const inputPath = join(outputDir, "annotation-code.mdx");
      const outputPath = join(outputDir, "annotation-code.html");
      await writeFile(inputPath, ANNOTATION_CODE_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  codeSnippetSyntaxMaximizeViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-code-snippet-syntax-maximize-"),
      );
      const inputPath = join(outputDir, "code-snippet-syntax-maximize.mdx");
      const outputPath = join(outputDir, "code-snippet-syntax-maximize.html");
      await writeFile(inputPath, CODE_SNIPPET_SYNTAX_MAXIMIZE_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  imageSelectionViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-image-selection-"),
      );
      const inputPath = join(outputDir, "image-selection.mdx");
      const outputPath = join(outputDir, "image-selection.html");
      await writeFile(inputPath, IMAGE_SELECTION_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // The complete gallery is the registry-level interaction gate: unlike the
  // focused fixtures below, it gives one rendered document an instance of
  // every authorable component.
  allComponentsViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-all-components-"),
      );
      const outputPath = join(outputDir, "all-components.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "all-components.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // The component example has its own rendered artifact so the plain sample
  // remains the baseline for the original viewer journeys.
  componentsViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-components-"));
      const outputPath = join(outputDir, "components.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "mdx-components.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  apiEndpointsViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-api-endpoints-"),
      );
      const outputPath = join(outputDir, "api-endpoints.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "api-endpoints.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // The schema showcase carries the DDL-band shapes the component journeys
  // exercise, which the general components example deliberately keeps out.
  tableSchemaViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-table-schema-"));
      const inputPath = join(outputDir, "table-schema.mdx");
      const outputPath = join(outputDir, "table-schema.html");
      const examplePath = join(
        repoRoot,
        "examples",
        "database-table-schema.mdx",
      );
      const source = await readFile(examplePath, "utf8");
      await writeFile(
        inputPath,
        `${source}\n## Table Schema Panel 1\n\n## Table Schema Panel 2 Tab\n`,
        "utf8",
      );
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  nestedDecisionMatrixViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-nested-decision-matrix-"),
      );
      const inputPath = join(outputDir, "nested-decision-matrix.mdx");
      const outputPath = join(outputDir, "nested-decision-matrix.html");
      await writeFile(inputPath, NESTED_DECISION_MATRIX_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  decisionViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-decision-"));
      const outputPath = join(outputDir, "decision.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "decision.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  decisionAnalysisViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-decision-analysis-"),
      );
      const outputPath = join(outputDir, "decision-analysis.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "decision-analysis.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  nestedWeightedDecisionAnalysisViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-nested-weighted-decision-analysis-"),
      );
      const outputPath = join(outputDir, "nested-weighted-analysis.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "decision-analysis.mdx"),
        outputPath,
        outputDir,
      });
      const html = await readFile(outputPath, "utf8");
      const weighted = (
        html.match(/<figure id="decision-analysis-[\s\S]*?<\/figure>/g) ?? []
      ).find((figure) => figure.includes('data-decision-scoring="weighted"'));
      if (weighted === undefined) {
        throw new Error("expected the DecisionAnalysis example to be weighted");
      }
      await writeFile(
        outputPath,
        html.replace(
          weighted,
          weighted.replace("</figcaption>", `</figcaption>${weighted}`),
        ),
        "utf8",
      );
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  weightedAuditDecisionAnalysisViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-weighted-audit-decision-analysis-"),
      );
      const inputPath = join(outputDir, "weighted-audit-analysis.mdx");
      const outputPath = join(outputDir, "weighted-audit-analysis.html");
      const source = await readFile(
        join(repoRoot, "examples", "decision-analysis.mdx"),
        "utf8",
      );
      await writeFile(
        inputPath,
        source.replace(
          'question="Which review store best fits the next two years?" state="proposed" interaction="choose" scoring="weighted"',
          'question="Which review store best fits the next two years?" state="proposed" interaction="audit" scoring="weighted"',
        ),
        "utf8",
      );
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  dataTableViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-data-table-"));
      const outputPath = join(outputDir, "data-table.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "data-table.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // The deck example carries Parts, a TableOfContents, sub-slides, and context
  // builders, so the deck journey reads the paradigm end to end.
  deckViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-deck-"));
      const outputPath = join(outputDir, "deck.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "deck.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  flowDiagramViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-flow-diagram-"));
      const outputPath = join(outputDir, "flow-diagram.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "flow-diagram.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  mermaidDiagramViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-mermaid-diagram-"),
      );
      const inputPath = join(outputDir, "mermaid-diagram.mdx");
      const outputPath = join(outputDir, "mermaid-diagram.html");
      await writeFile(inputPath, MERMAID_REVIEW_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  mermaidGalleryViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-mermaid-gallery-"),
      );
      const outputPath = join(outputDir, "mermaid-gallery.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "mermaid-gallery.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  slideCraftViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-slide-craft-"));
      const outputPath = join(outputDir, "slide-craft.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "slide-craft.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  nestedDecisionViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-nested-decision-"),
      );
      const inputPath = join(outputDir, "nested-decision.mdx");
      const outputPath = join(outputDir, "nested-decision.html");
      await writeFile(inputPath, NESTED_DECISION_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // These documents deliberately share presentation text and collapse ids.
  // Only the renderer-stamped identity may distinguish their browser state.
  planIdCollisionViewerUrls: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-plan-id-"));
      const firstInputPath = join(outputDir, "first.mdx");
      const secondInputPath = join(outputDir, "second.mdx");
      const firstOutputPath = join(outputDir, "first.html");
      const secondOutputPath = join(outputDir, "second.html");
      const emptyOutputPath = join(outputDir, "empty.html");
      const unidentifiedOutputPath = join(outputDir, "unidentified.html");
      await writeFile(firstInputPath, PLAN_ID_COLLISION_FIRST_MDX, "utf8");
      await writeFile(secondInputPath, PLAN_ID_COLLISION_SECOND_MDX, "utf8");
      await renderThroughCli({
        inputPath: firstInputPath,
        outputPath: firstOutputPath,
        outputDir,
      });
      await renderThroughCli({
        inputPath: secondInputPath,
        outputPath: secondOutputPath,
        outputDir,
      });
      const firstHtml = await readFile(firstOutputPath, "utf8");
      await writeFile(
        emptyOutputPath,
        firstHtml.replace(/ data-plan-id="[^"]+"/, ' data-plan-id=""'),
        "utf8",
      );
      await writeFile(
        unidentifiedOutputPath,
        firstHtml.replace(/ data-plan-id="[^"]+"/, ""),
        "utf8",
      );
      await use({
        empty: pathToFileURL(emptyOutputPath).href,
        first: pathToFileURL(firstOutputPath).href,
        second: pathToFileURL(secondOutputPath).href,
        unidentified: pathToFileURL(unidentifiedOutputPath).href,
      });
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  quickDecisionViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-quick-decision-"),
      );
      const outputPath = join(outputDir, "quick-decision.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "quick-decision.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // Rendering through the built CLI (not the library) keeps specs aligned
  // with what a user actually runs: big-plan render <file.mdx>.
  sampleViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-viewer-"));
      const outputPath = join(outputDir, "sample.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "sample.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  wireframeViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-wireframe-"));
      const outputPath = join(outputDir, "wireframe.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "wireframe.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  wireframeFormFactorsViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-wireframe-form-factors-"),
      );
      const outputPath = join(outputDir, "wireframe-form-factors.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "wireframe-form-factors.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  wireframeQualityViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-wireframe-quality-"),
      );
      const outputPath = join(outputDir, "wireframe-quality.html");
      await renderThroughCli({
        inputPath: join(repoRoot, "examples", "wireframe-quality-bar.mdx"),
        outputPath,
        outputDir,
      });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  wireframeSparseAppShellViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-wireframe-sparse-app-shell-"),
      );
      const inputPath = join(outputDir, "wireframe-sparse-app-shell.mdx");
      const outputPath = join(outputDir, "wireframe-sparse-app-shell.html");
      await writeFile(inputPath, WIREFRAME_SPARSE_APP_SHELL_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  wireframeShortContentViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-wireframe-short-content-"),
      );
      const inputPath = join(outputDir, "wireframe-short-content.mdx");
      const outputPath = join(outputDir, "wireframe-short-content.html");
      await writeFile(inputPath, WIREFRAME_SHORT_CONTENT_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  wireframeLongCaptionDesktopViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(
        join(tmpdir(), "big-plan-wireframe-long-caption-desktop-"),
      );
      const inputPath = join(outputDir, "wireframe-long-caption-desktop.mdx");
      const outputPath = join(outputDir, "wireframe-long-caption-desktop.html");
      await writeFile(inputPath, WIREFRAME_LONG_CAPTION_DESKTOP_MDX, "utf8");
      await renderThroughCli({ inputPath, outputPath, outputDir });
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  allowedConsoleErrors: [[], { option: true }],
  // Render-health contract: any console error or uncaught page error during
  // the test fails it in teardown, even when every journey assertion passed.
  page: async ({ page, allowedConsoleErrors }, use) => {
    const renderHealthErrors: Array<string> = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !allowedConsoleErrors.some((allowed) => allowed.test(message.text()))
      ) {
        // A failed resource load logs only a status line, so the offending
        // URL has to come from the message location to be diagnosable.
        const url = message.location().url;
        renderHealthErrors.push(
          url === "" ? message.text() : `${message.text()} (${url})`,
        );
      }
    });
    page.on("pageerror", (error) => {
      renderHealthErrors.push(error.message);
    });
    await use(page);
    expect(renderHealthErrors, "console and page errors").toEqual([]);
  },
});

export { expect };
export type { Locator, Page };

/**
 * Ends a journey's own review runtime.
 *
 * The open document polls its runtime until it is navigated away, so closing
 * the runtime under a live page makes the browser log a connection failure
 * that the render-health contract then counts against the test. The shared
 * `reviewRuntimeUrl` fixture unmounts for the same reason.
 */
export const closeReviewRuntime = async ({
  page,
  runtime,
}: {
  readonly page: Page;
  readonly runtime: { readonly close: () => Promise<void> };
}): Promise<void> => {
  if (!page.isClosed()) await page.goto("about:blank");
  await runtime.close();
};

/** Stages an offline-first slide comment without depending on saved switch state. */
export const stageComment = async (page: Page, body: string): Promise<void> => {
  const slide = page.locator("[data-slide]").first();
  await slide.hover();
  await slide.getByRole("button", { name: "Comment on slide" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/ });
  const submitRightAway = composer.getByRole("switch", {
    name: "Submit right away",
  });
  if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
    await submitRightAway.click();
  }
  await composer.getByLabel("Add a comment").fill(body);
  const addComment = composer.getByRole("button", { name: "Add Comment" });
  await expect(addComment).toBeEnabled();
  await addComment.click();
};

type AgentCliRun = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs one real `big-plan agent` command and reports how it ended. */
const spawnAgentCli = (args: ReadonlyArray<string>): Promise<AgentCliRun> =>
  new Promise((settle, fail) => {
    const child = spawn(process.execPath, [binPath, "agent", ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    // Generous, because this bound exists to turn a hang into a readable
    // failure, not to police latency. A parallel suite run starves a spawned
    // Node process for far longer than the command itself needs, and a tight
    // bound turns that starvation into a flake.
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail(
        new Error(
          `Agent CLI timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 30_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      fail(
        new Error(
          `Agent CLI could not start: ${String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      settle({ code, stdout, stderr });
    });
  });

/**
 * Runs one real `big-plan agent` command against a plan, so a journey can
 * cross the same process boundary a coding agent crosses. The whole output is
 * returned, and a non-zero exit or a hang becomes a readable failure rather
 * than a silent one.
 */
export const runAgentCli = async (
  args: ReadonlyArray<string>,
): Promise<{ readonly stdout: string; readonly stderr: string }> => {
  const { code, stdout, stderr } = await spawnAgentCli(args);
  if (code !== 0) {
    throw new Error(
      `Agent CLI stopped with code ${String(code)}.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return { stdout, stderr };
};

/**
 * Runs one real `big-plan agent` command that the runtime is expected to
 * refuse, so a journey can read the refusal instead of catching a throw.
 */
export const runRefusedAgentCli = async (
  args: ReadonlyArray<string>,
): Promise<{ readonly stdout: string; readonly stderr: string }> => {
  const { code, stdout, stderr } = await spawnAgentCli(args);
  if (code === 0) {
    throw new Error(
      `Agent CLI was expected to refuse this command.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return { stdout, stderr };
};

/**
 * Reads one hexadecimal identifier - a claim token, a request id, a comment
 * id - out of an agent CLI's stdout. The CLI prints TOON, which quotes any
 * scalar that would otherwise read as a number, so a digit-only identifier
 * arrives as `agent_token: "9983087100926270"`. Accepting those quotes keeps
 * the encoding from reading as a missing field once every few hundred runs.
 */
export const agentIdOf = (stdout: string, field: string): string => {
  const id = new RegExp(`${field}: "?([a-f0-9]{16})"?`, "u").exec(stdout)?.[1];
  if (id === undefined) {
    throw new Error(`The agent CLI printed no ${field}:\n${stdout}`);
  }
  return id;
};

/**
 * Returns the locator's bounding box, failing the test when the element has
 * none, so geometry assertions read as arithmetic instead of null handling.
 */
export const boxOf = async (
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`expected a bounding box for ${String(locator)}`);
  }
  return box;
};

/**
 * The one viewer-chrome control that opens the agent sidebar. Its visible label
 * is fixed, so tests match the stable accessible-name prefix and read the state
 * from the shape-and-colour mark rather than from changing text.
 */
export const agentStatusTrigger = (page: Page): Locator =>
  page.getByRole("button", { name: /^Agent Status:/u });

export const agentStatusIndicator = (page: Page): Locator =>
  agentStatusTrigger(page).locator("[data-review-agent-status]");

/** The sidebar while it is showing the agent, not the feedback it replaced. */
export const agentSidebar = (page: Page): Locator =>
  page.getByRole("complementary", { name: "Agent Status" });
