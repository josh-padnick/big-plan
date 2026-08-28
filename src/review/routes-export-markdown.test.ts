// Covers the pure response policies at the live Markdown export boundary.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveDecisionInventory } from "./decision-inventory.js";
import { emptyApprovalRecord } from "./shared/approval.js";
import {
  exportPlanMarkdown,
  markdownExportFilename,
} from "./routes-export-markdown.js";

describe("Markdown export attachment naming", () => {
  it.each([
    ["/plans/release-plan.mdx", "release-plan.md"],
    ["/plans/Quarterly plan!.mdx", "Quarterly-plan.md"],
    ["/plans/../../.mdx", "plan.md"],
    ["/plans/café.mdx", "cafe.md"],
  ])("should sanitize %s as %s", (path, expected) => {
    expect(markdownExportFilename(path)).toBe(expected);
  });
});

describe("Markdown export refusals", () => {
  it("should name the image whose meaning cannot survive as text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-export-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n\n![](./diagram.png)\n");
    try {
      const response = await exportPlanMarkdown({
        resolvedPlanPath: planPath,
        decisionAnswers: {
          read: async () => ({ version: 1, revision: 1, answers: [] }),
        },
        approvals: { read: async () => emptyApprovalRecord() },
      });

      expect(response).toMatchObject({
        kind: "json",
        status: 400,
        value: {
          error: expect.stringContaining("alternative text"),
        },
      });
      expect(response).toMatchObject({
        value: { error: expect.stringContaining("./diagram.png") },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Markdown export review-state join", () => {
  it("should include a current answer for a decision with a nested component", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-export-"));
    const planPath = join(directory, "plan.mdx");
    const source = `# Nested decision

<Decision question="How should we release?">

<Callout type="note">

The release must remain reversible.

</Callout>

<Option title="Gradually" />
<Option title="Immediately" />

</Decision>
`;
    await writeFile(planPath, source);
    const inventory = deriveDecisionInventory({
      markdown: source,
      fallbackTitle: "plan",
    });
    const entry = inventory.get("decision-how-should-we-release");
    if (entry === undefined) throw new Error("Expected the decision inventory");
    try {
      const response = await exportPlanMarkdown({
        resolvedPlanPath: planPath,
        decisionAnswers: {
          read: async () => ({
            version: 1,
            revision: 1,
            answers: [
              {
                decisionId: entry.decisionId,
                optionId: "decision-how-should-we-release-option-gradually",
                optionTitle: "Gradually",
                prompt: entry.question,
                answeredAt: "2026-08-27T18:00:00.000Z",
                premiseSnapshot: "0123456789abcdef",
                decisionDigest: entry.decisionDigest,
              },
            ],
          }),
        },
        approvals: { read: async () => emptyApprovalRecord() },
      });

      expect(response.kind).toBe("binary");
      if (response.kind !== "binary") return;
      expect(Buffer.from(response.body).toString("utf8")).toContain(
        "**How should we release?:** Gradually",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse to combine review records that change during compilation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-export-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Stable source\n\nContent.\n");
    let read = 0;
    try {
      const response = await exportPlanMarkdown({
        resolvedPlanPath: planPath,
        decisionAnswers: {
          read: async () => ({ version: 1, revision: read++, answers: [] }),
        },
        approvals: { read: async () => emptyApprovalRecord() },
      });

      expect(response).toMatchObject({
        kind: "json",
        status: 409,
        value: { error: expect.stringContaining("Review state changed") },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
