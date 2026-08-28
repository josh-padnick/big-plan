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

  it("names removed HttpEndpoint parameters", () => {
    const baseline: CompiledHttpEndpoint = {
      method: "GET",
      path: "/jobs",
      deprecated: false,
      description: [],
      params: [
        {
          name: "legacy",
          location: "query",
          required: false,
          children: [],
        },
      ],
      responses: [],
    };
    expect(
      compileHttpEndpointDiff({
        status: "changed",
        baseline,
        proposed: { ...baseline, params: [] },
        runs,
      }).changedFields,
    ).toEqual(["query: legacy"]);
  });

  it("names both GraphqlOperation argument identities on rename", () => {
    const baseline: CompiledGraphqlOperation = {
      kind: "query",
      name: "jobs",
      deprecated: false,
      description: [],
      args: [{ name: "before", argumentType: "String", children: [] }],
      inputFields: [],
      payloadFields: [],
      responses: [],
    };
    expect(
      compileGraphqlOperationDiff({
        status: "changed",
        baseline,
        proposed: {
          ...baseline,
          args: [{ name: "after", argumentType: "String", children: [] }],
        },
        runs,
      }).changedFields,
    ).toEqual(["Argument: before", "Argument: after"]);
  });

  it("names removed GrpcMethod errors", () => {
    const baseline: CompiledGrpcMethod = {
      service: "Jobs",
      name: "Get",
      request: "GetRequest",
      response: "GetResponse",
      kind: "unary",
      deprecated: false,
      description: [],
      requestFields: [],
      responseFields: [],
      errors: [{ code: "NOT_FOUND", children: [] }],
      examples: [],
    };
    expect(
      compileGrpcMethodDiff({
        status: "changed",
        baseline,
        proposed: { ...baseline, errors: [] },
        runs,
      }).changedFields,
    ).toEqual(["Status code: NOT_FOUND"]);
  });

  it("names removed DatabaseTableSchema DDL sections", () => {
    const baseline: CompiledDatabaseTableSchema = {
      tableName: "jobs",
      schema: { columns: [], indexes: [] },
      source: "",
      ddlSections: [{ title: "Backfill", children: text("UPDATE jobs") }],
    };
    expect(
      compileDatabaseTableSchemaDiff({
        status: "changed",
        baseline,
        proposed: { ...baseline, ddlSections: [] },
        runs,
      }).changedFields,
    ).toEqual(["DDL: Backfill"]);
  });

  it("names both DatabaseTableSchema column identities on rename", () => {
    const column = {
      name: "before",
      type: "text",
      primaryKey: false,
      notNull: false,
      unique: false,
      identity: false,
    };
    const baseline: CompiledDatabaseTableSchema = {
      tableName: "jobs",
      schema: { columns: [column], indexes: [] },
      source: "before text",
      ddlSections: [],
    };
    expect(
      compileDatabaseTableSchemaDiff({
        status: "changed",
        baseline,
        proposed: {
          ...baseline,
          schema: {
            ...baseline.schema,
            columns: [{ ...column, name: "after" }],
          },
          source: "after text",
        },
        runs,
      }).changedFields,
    ).toEqual(["Column: before", "Column: after"]);
  });

  it("names only an inserted DatabaseTableSchema index", () => {
    const existing = { columns: ["status"], unique: false, name: "by_status" };
    const inserted = { columns: ["owner_id"], unique: false };
    const baseline: CompiledDatabaseTableSchema = {
      tableName: "jobs",
      schema: { columns: [], indexes: [existing] },
      source: "",
      ddlSections: [],
    };
    expect(
      compileDatabaseTableSchemaDiff({
        status: "changed",
        baseline,
        proposed: {
          ...baseline,
          schema: { ...baseline.schema, indexes: [inserted, existing] },
        },
        runs,
      }).changedFields,
    ).toEqual(["Index: owner_id"]);
  });

  it("names a removed DataTable summary row", () => {
    const baseline: CompiledDataTable = {
      id: "jobs",
      filter: false,
      fit: "wrap",
      columns: [{ label: "Job", type: "text", align: "left" }],
      rows: [{ cells: [cell("Build")] }],
      summaryRow: { cells: [cell("1 job")] },
      groups: [],
      groupColumn: -1,
    };
    expect(
      compileDataTableDiff({
        status: "changed",
        baseline,
        proposed: { ...baseline, summaryRow: undefined },
        runs,
      }).changedFields,
    ).toEqual(["Summary row"]);
  });
});
