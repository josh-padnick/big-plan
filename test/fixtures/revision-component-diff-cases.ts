// Owns the closed browser fixture matrix for registered-component revision
// lenses. Every case starts from a real repository example and changes one
// authored semantic value without inventing a parallel test-only component.

import { readFileSync } from "node:fs";
import type { RegisteredComponentName } from "../../src/components/_registration/registry.js";
import { revisionDiffCases } from "./revision-diff-cases.js";

export type ComponentRevisionDiffCase = {
  readonly name: string;
  readonly component: RegisteredComponentName;
  readonly before: string;
  readonly after: string;
  readonly expected: "changed";
  readonly structure: ReadonlyArray<string>;
  readonly forbiddenConcatenations: ReadonlyArray<string>;
};

const example = (name: string): string =>
  readFileSync(`examples/${name}`, "utf8");

const changedExample = ({
  name,
  component,
  from,
  to,
  structure,
  forbiddenConcatenations,
}: {
  readonly name: string;
  readonly component: RegisteredComponentName;
  readonly from: string;
  readonly to: string;
  readonly structure: ReadonlyArray<string>;
  readonly forbiddenConcatenations: ReadonlyArray<string>;
}): ComponentRevisionDiffCase => {
  const before = example(name);
  if (!before.includes(from)) {
    throw new Error(`${component} revision fixture cannot find ${from}`);
  }
  return {
    name: `${component} component`,
    component,
    before,
    after: before.replace(from, to),
    expected: "changed",
    structure,
    forbiddenConcatenations,
  };
};

const flowFixture = revisionDiffCases.find(
  ({ name }) => name === "flow diagram semantic change",
);
if (flowFixture === undefined) {
  throw new Error("FlowDiagram revision fixture is missing");
}

export const componentRevisionDiffCases: ReadonlyArray<ComponentRevisionDiffCase> =
  [
    changedExample({
      name: "callout.mdx",
      component: "Callout",
      from: "one region at a time",
      to: "two regions at a time",
      structure: ["[data-callout]"],
      forbiddenConcatenations: ["warningThe rollout"],
    }),
    changedExample({
      name: "code-diff.mdx",
      component: "CodeDiff",
      from: "cached.ageSeconds <= 150",
      to: "cached.ageSeconds <= 180",
      structure: ["[data-code-diff]", "[data-diff-line]"],
      forbiddenConcatenations: ["2+  if"],
    }),
    changedExample({
      name: "code-snippet.mdx",
      component: "CodeSnippet",
      from: "ttlSeconds: 300",
      to: "ttlSeconds: 360",
      structure: ["[data-code-snippet]", ".code-snippet-line"],
      forbiddenConcatenations: ["1export"],
    }),
    changedExample({
      name: "data-table.mdx",
      component: "DataTable",
      from: "| Card declined | 3 | Give up and notify |",
      to: "| Card declined | 3 | Escalate and notify |",
      structure: ["[data-data-table]", "[data-data-table] table"],
      forbiddenConcatenations: ["Visible columnsFailure"],
    }),
    changedExample({
      name: "database-table-schema.mdx",
      component: "DatabaseTableSchema",
      from: "check: 'seats > 0'",
      to: "check: 'seats >= 1'",
      structure: [
        "[data-database-table-schema]",
        "[data-database-table-schema] table",
      ],
      forbiddenConcatenations: ["ColumnsIndexes"],
    }),
    changedExample({
      name: "decision.mdx",
      component: "Decision",
      from: "version-matched skill",
      to: "bundled skill",
      structure: ["[data-decision]", "[data-decision-option]"],
      forbiddenConcatenations: ["Nothing selected yet.Confirm choice"],
    }),
    changedExample({
      name: "decision-analysis.mdx",
      component: "DecisionAnalysis",
      from: "Transactions keep a thread and its anchor atomic.",
      to: "Transactions keep a thread and its anchor durable.",
      structure: ["[data-decision]", "[data-decision] table"],
      forbiddenConcatenations: ["Propose another approachNothing selected"],
    }),
    changedExample({
      name: "file-trees.mdx",
      component: "FileTree",
      from: "Consumes deduplicated catalog refresh jobs.",
      to: "Consumes durable catalog refresh jobs.",
      structure: ["[data-file-tree]", "[data-file-tree] li"],
      forbiddenConcatenations: ["src/refresh-worker.ts"],
    }),
    changedExample({
      name: "file-trees.mdx",
      component: "FileTreeDiff",
      from: "Move refresh work behind the queue.",
      to: "Move refresh work behind the durable queue.",
      structure: ["[data-file-tree-diff]", "[data-file-tree-diff] li"],
      forbiddenConcatenations: ["modifiedrefresh-worker.ts"],
    }),
    {
      name: "FlowDiagram component",
      component: "FlowDiagram",
      before: flowFixture.before,
      after: flowFixture.after,
      expected: "changed",
      structure: [
        "[data-flow-diagram-stage]",
        "[data-flow-diagram-node]",
        "[data-flow-diagram-link], [data-flow-diagram-branch]",
      ],
      forbiddenConcatenations: [
        "blockingEligible",
        "arrivesclaims",
        "succeedsreschedules",
      ],
    },
    changedExample({
      name: "api-endpoints.mdx",
      component: "GraphqlOperation",
      from: "Queues a refresh through the GraphQL bridge",
      to: "Queues a durable refresh through the GraphQL bridge",
      structure: ["[data-graphql-operation]", "[data-graphql-field]"],
      forbiddenConcatenations: ["ArgumentsFields"],
    }),
    changedExample({
      name: "api-endpoints.mdx",
      component: "GrpcMethod",
      from: "Streams refresh state changes as the worker pool processes jobs.",
      to: "Streams durable refresh state changes as the worker pool processes jobs.",
      structure: ["[data-grpc-method]", "[data-grpc-field]"],
      forbiddenConcatenations: ["RequestResponse"],
    }),
    changedExample({
      name: "api-endpoints.mdx",
      component: "HttpEndpoint",
      from: "Queues a deduplicated refresh job per cache key",
      to: "Queues one durable refresh job per cache key",
      structure: ["[data-http-endpoint]", "[data-http-response]"],
      forbiddenConcatenations: ["Path parametersRequest body"],
    }),
    changedExample({
      name: "deck.mdx",
      component: "Part",
      from: '<Part title="Context" />',
      to: '<Part title="Current context" />',
      structure: ["[data-part]", "[data-part-number]"],
      forbiddenConcatenations: ["Part 1Context"],
    }),
    changedExample({
      name: "quick-decision.mdx",
      component: "QuickDecision",
      from: "Rollback stays one toggle away.",
      to: "Rollback remains one toggle away.",
      structure: ["[data-decision]", "[data-decision-option]"],
      forbiddenConcatenations: ["Nothing selected yet.Confirm choice"],
    }),
    changedExample({
      name: "quick-summary.mdx",
      component: "QuickSummary",
      from: "operator-visible audit trail",
      to: "operator-readable audit trail",
      structure: ["[data-quick-summary]", "[data-quick-summary] dl"],
      forbiddenConcatenations: ["Quick summaryWhy"],
    }),
    changedExample({
      name: "deck.mdx",
      component: "TableOfContents",
      from: 'gist="Inline retries couple checkout latency to processor health"',
      to: 'gist="Inline retries tie checkout latency to processor health"',
      structure: ["[data-table-of-contents]", "[data-table-of-contents-row]"],
      forbiddenConcatenations: ["ContextStatus quo"],
    }),
    changedExample({
      name: "wireframe.mdx",
      component: "Wireframe",
      from: 'title="Balance & goal"',
      to: 'title="Balance and goal"',
      structure: [
        "[data-wireframe]",
        "[data-wireframe-screen]",
        "[data-wireframe-surface]",
      ],
      forbiddenConcatenations: ["Balance & goalMonthly target"],
    }),
  ];
