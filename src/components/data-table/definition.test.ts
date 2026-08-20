// Tests DataTable's server-rendered grid contract, including the complete
// authored-order fallback used before the viewer enhancement runs.

import { describe, expect, it } from "vitest";
import {
  compileMarkdown,
  MarkdownDiagnosticsError,
} from "../../render/markdown/compile-markdown.js";
import { serializeHtml } from "../../render/serialize-html.js";

const render = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeHtml({ root });
};

const GROUPED_TABLE = `<DataTable title="Interleaved" groupBy="Tier">

<Column name="Item" sort="desc" />

\`\`\`table
| Item | Tier |
| --- | --- |
| First | Gold |
| Second | Silver |
| Third | Gold |
\`\`\`

</DataTable>
`;

describe("DataTable rendering", () => {
  it("should keep grouped content complete and authored-order without scripts", () => {
    const html = render(GROUPED_TABLE);
    const rows = [
      ...html.matchAll(/<tr[^>]*data-table-row="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g),
    ];
    const itemTitles = rows.map(
      (row) => row[2]?.match(/<td[^>]*title="([^"]+)"/)?.[1],
    );
    const groupedCells = [
      ...html.matchAll(/<(?:th|td)\b[^>]*data-table-column="1"[^>]*>/g),
    ].map((match) => match[0]);

    expect(html).toContain('data-table-group-column="1"');
    expect(html).toContain('data-table-authored-sort="desc"');
    expect(html).not.toContain("data-table-group-heading");
    expect(html).not.toContain("data-table-grouped");
    expect(html).not.toContain("data-table-sorted");
    expect(itemTitles).toEqual(["First", "Second", "Third"]);
    expect(groupedCells.length).toBeGreaterThan(0);
    expect(groupedCells.every((cell) => !cell.includes(" hidden"))).toBe(true);
  });

  it("should render one summary row in a semantic footer", () => {
    const html = render(`<DataTable title="Totals">

\`\`\`table
| Region | Requests |
| --- | ---: |
| Europe | 120 |
| Asia Pacific | 80 |
\`\`\`

<SummaryRow>

\`\`\`table
| Total | 200 |
\`\`\`

</SummaryRow>
</DataTable>`);

    expect(html).toMatch(
      /<tfoot><tr[^>]*data-table-summary-row[^>]*>[\s\S]*title="Total"[\s\S]*title="200"[\s\S]*<\/tr><\/tfoot>/u,
    );
    expect(html).toContain("2 rows");
  });

  it("should reject a second SummaryRow at its authored location", () => {
    const source = `<DataTable>

\`\`\`table
| Name | Count |
| --- | ---: |
| One | 1 |
\`\`\`

<SummaryRow>

\`\`\`table
| Total | 1 |
\`\`\`

</SummaryRow>
<SummaryRow>

\`\`\`table
| Duplicate | 1 |
\`\`\`

</SummaryRow>
</DataTable>`;

    try {
      compileMarkdown({ markdown: source });
      throw new Error("expected duplicate SummaryRow to fail compilation");
    } catch (error) {
      expect(error).toBeInstanceOf(MarkdownDiagnosticsError);
      if (!(error instanceof MarkdownDiagnosticsError)) return;
      expect(error.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
        [
          "DataTable allows one SummaryRow; combine the table-wide aggregates into that row",
        ],
      );
    }
  });
});
