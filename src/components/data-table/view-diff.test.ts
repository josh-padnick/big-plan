// Verifies DataTable diff projections keep summary evidence independent from row labels.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import type { CompiledDataTable } from "./compile.js";
import { compileDataTableDiff } from "./compile-diff.js";
import { DataTableDiffView } from "./view-diff.js";

const cell = (value: string) => ({
  text: value,
  segments: [{ kind: "text" as const, value }],
});

describe("DataTable diff view", () => {
  it("should omit an unchanged summary when a row has a summary-shaped label", () => {
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
    const input: ComponentDiffInput<CompiledDataTable> = {
      status: "changed",
      baseline,
      proposed: {
        ...baseline,
        rows: [...baseline.rows, { cells: [cell("Summary: Build")] }],
      },
      runs: [],
    };

    const html = renderToStaticMarkup(
      createElement(DataTableDiffView, {
        model: compileDataTableDiff(input),
        controlId: "jobs-diff",
      }),
    );

    expect(html).toContain("Summary: Build");
    expect(html).not.toContain("1 job");
  });
});
