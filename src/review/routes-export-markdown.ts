// Owns live review Markdown export: one immutable authoritative source read,
// one compiler delivery, and the stable review-state overlay attached to it.

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  markdownInlineText,
  MarkdownExportRejected,
} from "../components/_model/markdown-export.js";
import {
  renderMarkdownDocument,
  type RenderedMarkdownDocument,
} from "../render/render-markdown-document.js";
import { deriveSnapshotDigest } from "./agent-exchange.js";
import { decisionInventoryFromComponents } from "./decision-inventory.js";
import { currentAnswers } from "./plan-inputs-store.js";
import type { StagedInputs } from "./plan-inputs-store.js";
import {
  binaryResponse,
  refusal,
  type ReviewRouteResponse,
} from "./review-route-context.js";
import {
  approvalSummary,
  type ApprovalRecord,
  type ApprovalSummary,
} from "./shared/approval.js";
import type { StagedDecisionAnswer } from "./shared/review-wire.js";

const reviewStateFingerprint = (value: unknown): string =>
  JSON.stringify(value);

const overlayInline = (value: string): string =>
  markdownInlineText(value.replace(/\s+/gu, " "));

/** Derives a safe ASCII attachment name from the authoritative plan path. */
export const markdownExportFilename = (planPath: string): string => {
  const rawStem = basename(planPath, extname(planPath));
  const stem = (rawStem.startsWith(".") ? "" : rawStem)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 120);
  return `${stem === "" ? "plan" : stem}.md`;
};

const approvalMarkdown = (approval: ApprovalSummary): string => {
  const counts = approval.openItemCounts;
  const message = approval.message.trim();
  return [
    "### Approval summary",
    "",
    `Approved ${overlayInline(approval.at)}.`,
    ...(message === "" ? [] : ["", markdownInlineText(message)]),
    "",
    `- Decisions answered: ${counts.decisionsAnswered} of ${counts.decisionsTotal}`,
    `- Change sets accepted: ${counts.changeSetsAccepted} of ${counts.changeSetsTotal}`,
    `- Requests canceled: ${counts.requestsCanceled}`,
  ].join("\n");
};

const answersMarkdown = (
  answers: ReadonlyArray<StagedDecisionAnswer>,
): string =>
  [
    "### Saved decision answers",
    "",
    ...answers.map(
      (answer) =>
        `- **${overlayInline(answer.prompt)}:** ${overlayInline(answer.optionTitle)}`,
    ),
  ].join("\n");

const reviewOverlay = ({
  answers,
  approval,
}: {
  readonly answers: ReadonlyArray<StagedDecisionAnswer>;
  readonly approval?: ApprovalSummary;
}): string => {
  const sections = [
    ...(answers.length === 0 ? [] : [answersMarkdown(answers)]),
    ...(approval === undefined ? [] : [approvalMarkdown(approval)]),
  ];
  return [
    "---",
    "",
    "## Review overlay",
    "",
    ...(sections.length === 0
      ? ["No current saved decision answers or matching approval."]
      : [sections.join("\n\n")]),
  ].join("\n");
};

/** Returns the current committed plan as portable, component-owned Markdown. */
export const exportPlanMarkdown = async (context: {
  readonly resolvedPlanPath: string;
  readonly decisionAnswers: { readonly read: () => Promise<StagedInputs> };
  readonly approvals: { readonly read: () => Promise<ApprovalRecord> };
}): Promise<ReviewRouteResponse> => {
  // This is deliberately the only read of the authoritative source. Everything
  // below, including digest and decision currency, derives from these bytes.
  const source = await readFile(context.resolvedPlanPath, "utf8");
  const snapshot = deriveSnapshotDigest(source);
  const before = await Promise.all([
    context.decisionAnswers.read(),
    context.approvals.read(),
  ]);
  let rendered: RenderedMarkdownDocument;
  try {
    rendered = renderMarkdownDocument({
      markdown: source,
      fallbackTitle: basename(
        context.resolvedPlanPath,
        extname(context.resolvedPlanPath),
      ),
      snapshot,
    });
  } catch (error: unknown) {
    // A refusal names what the plan has to change; letting it reach the outer
    // boundary would answer the reviewer with an unactionable runtime failure.
    if (error instanceof MarkdownExportRejected) {
      return refusal({ status: 400, reason: error.message });
    }
    throw error;
  }
  const after = await Promise.all([
    context.decisionAnswers.read(),
    context.approvals.read(),
  ]);
  if (reviewStateFingerprint(before) !== reviewStateFingerprint(after)) {
    return refusal({
      status: 409,
      reason:
        "Review state changed while the export was being prepared. Try again.",
    });
  }

  const [inputs, approvalRecord] = before;
  const inventory = decisionInventoryFromComponents(rendered.components);
  const answers = currentAnswers({ inputs, inventory });
  const summary = approvalSummary({
    record: approvalRecord,
    currentSnapshot: snapshot,
    // Delivery does not alter the portable approval overlay; live review
    // surfaces read the mailbox-backed value before presenting handoff state.
    delivered: true,
  });
  const approval = summary?.status === "approved" ? summary : undefined;
  const filename = markdownExportFilename(context.resolvedPlanPath);
  const markdown = `${rendered.markdown.trimEnd()}\n\n${reviewOverlay({ answers, approval })}\n`;
  return binaryResponse({
    status: 200,
    contentType: "text/markdown; charset=utf-8",
    body: Buffer.from(markdown, "utf8"),
    headers: {
      "content-disposition": `attachment; filename="${filename}"`,
      "x-big-plan-snapshot": snapshot,
    },
  });
};
