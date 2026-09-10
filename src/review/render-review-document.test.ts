// Proves live-review rendering keeps the runtime event loop responsive across
// growing Mermaid-bearing revisions.

import { describe, expect, it } from "vitest";
import { clearMermaidRenderCache } from "../components/mermaid-diagram/renderer.js";
import { renderReviewDocument } from "./render-review-document.js";

describe("renderReviewDocument", () => {
  it("keeps event-loop progress continuous across repeated diagram revisions (BIG-300)", async () => {
    clearMermaidRenderCache();
    let ticks = 0;
    const ticker = setInterval(() => {
      ticks += 1;
    }, 10);
    try {
      for (const names of [
        ["a", "b"],
        ["a", "b", "c"],
        ["a", "c", "d"],
        ["a", "b", "d", "e"],
      ]) {
        const ticksBeforeRender = ticks;
        const diagrams = names
          .map(
            (name) => `<MermaidDiagram>

\`\`\`mermaid
flowchart LR
  ${name}[${name}] --> done[Done]
\`\`\`

</MermaidDiagram>`,
          )
          .join("\n\n");
        const rendered = await renderReviewDocument({
          markdown: `# Revision ${names.length}\n\n${diagrams}`,
          fallbackTitle: "plan",
          identity: {},
        });
        expect(rendered.html).toContain("<svg");
        expect(ticks).toBeGreaterThan(ticksBeforeRender);
      }
    } finally {
      clearInterval(ticker);
      clearMermaidRenderCache();
    }
  });
});
