// Tests DataTable's server-rendered grid contract, including the complete
// authored-order fallback used before the viewer enhancement runs.

import { describe, expect, it } from "vitest";
import { compileMarkdown } from "../../render/markdown/compile-markdown.js";
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
});
