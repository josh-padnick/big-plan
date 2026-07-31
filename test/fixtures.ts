// The suite's extended Playwright test, per the render-health rule: every
// spec fails on console errors or uncaught page errors automatically, and the
// fixture documents are rendered once per worker through the built CLI so
// specs exercise exactly what a user runs. Specs import test/expect from here,
// never from @playwright/test directly.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Locator } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

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
  readonly componentsViewerUrl: string;
  readonly apiEndpointsViewerUrl: string;
  readonly dataTableViewerUrl: string;
  readonly decisionAnalysisViewerUrl: string;
  readonly nestedWeightedDecisionAnalysisViewerUrl: string;
  readonly deckViewerUrl: string;
  readonly decisionViewerUrl: string;
  readonly nestedDecisionMatrixViewerUrl: string;
  readonly flowDiagramViewerUrl: string;
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
  readonly wireframeShortContentViewerUrl: string;
  readonly wireframeViewerUrl: string;
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
  <Screen id="ready" name="Ready" device="desktop">
    <Panel title="Ready">
      <Text text="The short state is complete." />
    </Panel>
  </Screen>
</Wireframe>
`;

export const test = base.extend<NonNullable<unknown>, WorkerFixtures>({
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
  // Render-health contract: any console error or uncaught page error during
  // the test fails it in teardown, even when every journey assertion passed.
  page: async ({ page }, use) => {
    const renderHealthErrors: Array<string> = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        renderHealthErrors.push(message.text());
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
