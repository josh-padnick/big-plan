import type { ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import type { NamedFieldDiff } from "../_model/component-diff/named-fields.js";
import { compileCalloutDiff } from "../callout/compile-diff.js";
import type { CompiledCallout } from "../callout/compile.js";
import { compileCodeDiffDiff } from "../code-diff/compile-diff.js";
import type { CompiledCodeDiff } from "../code-diff/compile.js";
import { compileCodeSnippetDiff } from "../code-snippet/compile-diff.js";
import type { CompiledCodeSnippet } from "../code-snippet/compile.js";
import { compileDataTableDiff } from "../data-table/compile-diff.js";
import type { CompiledDataTable } from "../data-table/compile.js";
import { compileDatabaseTableSchemaDiff } from "../database-table-schema/compile-diff.js";
import type { CompiledDatabaseTableSchema } from "../database-table-schema/compile.js";
import { compileGraphqlOperationDiff } from "../graphql-operation/compile-diff.js";
import type { CompiledGraphqlOperation } from "../graphql-operation/compile.js";
import { compileGrpcMethodDiff } from "../grpc-method/compile-diff.js";
import type { CompiledGrpcMethod } from "../grpc-method/compile.js";
import { compileHttpEndpointDiff } from "../http-endpoint/compile-diff.js";
import type { CompiledHttpEndpoint } from "../http-endpoint/compile.js";
import { compileQuickSummaryDiff } from "../quick-summary/compile-diff.js";
import type { CompiledQuickSummary } from "../quick-summary/compile.js";

const text = (value: string): ReadonlyArray<ElementContent> => [
  { type: "text", value },
];
const cell = (value: string) => ({
  text: value,
  segments: [{ kind: "text" as const, value }],
});
const runs: ComponentDiffInput<never>["runs"] = [];

const expectFieldContract = <Model>({
  compile,
  baseline,
  proposed,
  changedField,
}: {
  readonly compile: (input: ComponentDiffInput<Model>) => NamedFieldDiff<Model>;
  readonly baseline: Model;
  readonly proposed: Model;
  readonly changedField: string;
}): void => {
  expect(
    compile({ status: "changed", baseline, proposed, runs }).changedFields,
  ).toEqual([changedField]);
  expect(compile({ status: "added", proposed, runs })).toMatchObject({
    status: "added",
    wholeComponent: true,
    proposed,
  });
};

describe("last-wave component diff fields", () => {
  it("names DataTable rows", () => {
    const baseline: CompiledDataTable = {
      id: "table",
      filter: false,
      fit: "wrap",
      columns: [{ label: "Job", type: "text", align: "left" }],
      rows: [{ cells: [cell("Refresh")] }],
      groups: [],
      groupColumn: -1,
    };
    expectFieldContract({
      compile: compileDataTableDiff,
      baseline,
      proposed: { ...baseline, rows: [{ cells: [cell("Rebuild")] }] },
      changedField: "Row: Rebuild",
    });
  });

  it("names QuickSummary facets", () => {
    const baseline: CompiledQuickSummary = {
      facets: [{ name: "Why", items: [text("Faster")] }],
    };
    expectFieldContract({
      compile: compileQuickSummaryDiff,
      baseline,
      proposed: { facets: [{ name: "Why", items: [text("Safer")] }] },
      changedField: "Why",
    });
  });

  it("names HttpEndpoint fields", () => {
    const baseline: CompiledHttpEndpoint = {
      method: "POST",
      path: "/queue",
      deprecated: false,
      description: text("Queue once"),
      params: [],
      responses: [],
    };
    expectFieldContract({
      compile: compileHttpEndpointDiff,
      baseline,
      proposed: { ...baseline, description: text("Queue safely") },
      changedField: "Description",
    });
  });

  it("names GraphqlOperation fields", () => {
    const baseline: CompiledGraphqlOperation = {
      kind: "mutation",
      name: "queue",
      deprecated: false,
      description: text("Queue once"),
      args: [],
      inputFields: [],
      payloadFields: [],
      responses: [],
    };
    expectFieldContract({
      compile: compileGraphqlOperationDiff,
      baseline,
      proposed: { ...baseline, description: text("Queue safely") },
      changedField: "Description",
    });
  });

  it("names GrpcMethod fields", () => {
    const baseline: CompiledGrpcMethod = {
      service: "Queue",
      name: "Start",
      request: "StartRequest",
      response: "StartResponse",
      kind: "unary",
      deprecated: false,
      description: text("Queue once"),
      requestFields: [],
      responseFields: [],
      errors: [],
      examples: [],
    };
    expectFieldContract({
      compile: compileGrpcMethodDiff,
      baseline,
      proposed: { ...baseline, description: text("Queue safely") },
      changedField: "Description",
    });
  });

  it("names DatabaseTableSchema fields", () => {
    const baseline: CompiledDatabaseTableSchema = {
      tableName: "jobs",
      schema: {
        columns: [
          {
            name: "attempts",
            type: "integer",
            primaryKey: false,
            notNull: true,
            unique: false,
            identity: false,
          },
        ],
        indexes: [],
      },
      source: "attempts integer",
      ddlSections: [],
    };
    const baselineColumn = baseline.schema.columns[0];
    if (baselineColumn === undefined) throw new Error("Missing test column");
    expectFieldContract({
      compile: compileDatabaseTableSchemaDiff,
      baseline,
      proposed: {
        ...baseline,
        schema: {
          ...baseline.schema,
          columns: [{ ...baselineColumn, type: "smallint" }],
        },
      },
      changedField: "Column: attempts",
    });
  });

  it("names Callout text fields", () => {
    const baseline: CompiledCallout = {
      type: "note",
      title: "Heads up",
      body: text("Queue once"),
    };
    expectFieldContract({
      compile: compileCalloutDiff,
      baseline,
      proposed: { ...baseline, body: text("Queue safely") },
      changedField: "Body",
    });
  });

  it("names CodeSnippet text fields", () => {
    const baseline: CompiledCodeSnippet = {
      source: "queue();",
      highlightedLines: [],
      startLine: 1,
      showLineNumbers: false,
      annotations: [],
    };
    expectFieldContract({
      compile: compileCodeSnippetDiff,
      baseline,
      proposed: { ...baseline, source: "queueSafely();" },
      changedField: "Code",
    });
  });

  it("names CodeDiff text fields", () => {
    const baseline: CompiledCodeDiff = {
      filePath: "queue.ts",
      source: "- queue();\n+ queueSafely();",
      diff: { hunks: [], hasHunkHeaders: false },
      showLineNumbers: false,
      showLineCounts: false,
      addedCount: 1,
      removedCount: 1,
      annotations: [],
    };
    expectFieldContract({
      compile: compileCodeDiffDiff,
      baseline,
      proposed: { ...baseline, source: "- queue();\n+ queueOnce();" },
      changedField: "Code",
    });
  });
});
