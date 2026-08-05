// Proves the immutable revision-pair and shared-lens contract through real
// rendered plans. Pure invariants and browser structure intentionally meet in
// one spec so every authored block kind crosses the same public seam.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derivePlanId, renderDocument } from "../src/render/render-document.js";
import {
  commentsFromExchange,
  deriveSourceRevision,
  effectiveSourceRevision,
  feedbackAgentRequests,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentResponse,
} from "../src/review/agent-exchange.js";
import { buildFeedbackPackage } from "../src/review/feedback-package.js";
import { buildRevisionChangeSet } from "../src/review/revision-change-set.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  writeAgentHeartbeat,
  writeRevisionSnapshot,
} from "../src/review/store.js";
import { expect, test } from "./fixtures";
import {
  associationCases,
  revisionDiffCases,
} from "./fixtures/revision-diff-cases.js";

const revisionPairFor = ({
  before,
  after,
}: {
  readonly before: string;
  readonly after: string;
}) => ({
  fromRevision: deriveSourceRevision(before),
  toRevision: deriveSourceRevision(after),
});

for (const fixture of revisionDiffCases) {
  test(`revision lens should honor its contract for ${fixture.name}`, async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-diff-lens-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, fixture.before);
    const runtime = await startReviewRuntime({ planPath });
    try {
      await page.goto(runtime.url);
      const requestValue = await page.evaluate(async () => {
        const token =
          document.documentElement.getAttribute("data-review-token") ?? "";
        const response = await fetch("/api/agent-requests", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-big-plan-review-token": token,
          },
          body: JSON.stringify({
            kind: "chat",
            body: "Apply the fixture revision.",
          }),
        });
        return response.json();
      });
      const snapshot = await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      });
      const request = snapshot.requests.find(
        (candidate) => candidate.requestId === requestValue.requestId,
      );
      if (request === undefined) throw new Error("The chat request was lost");
      await writeFile(planPath, fixture.after);
      const pair = revisionPairFor(fixture);
      await writeRevisionSnapshot({
        store: runtime.store,
        revision: pair.toRevision,
        source: fixture.after,
      });
      const fallbackTitle = "plan";
      const changeSet = buildRevisionChangeSet({
        pair,
        before: renderDocument({
          markdown: fixture.before,
          fallbackTitle,
          identity: {},
        }).blocks,
        after: renderDocument({
          markdown: fixture.after,
          fallbackTitle,
          identity: {},
        }).blocks,
      });
      expect(changeSet.places.length).toBeGreaterThan(0);
      expect(new Set(changeSet.places.map((place) => place.placeId)).size).toBe(
        changeSet.places.length,
      );
      for (const place of changeSet.places) {
        expect(place.locations.length).toBeGreaterThan(0);
        for (const location of place.locations) {
          expect(location.runs.every((run) => run.text !== "")).toBe(true);
          expect(
            location.runs.every(
              (run, index) =>
                index === 0 || location.runs[index - 1]?.op !== run.op,
            ),
          ).toBe(true);
          expect(
            location.oldContent !== undefined ||
              location.newContent !== undefined,
          ).toBe(true);
        }
      }
      const response = validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          message: "Applied the fixture revision.",
        },
        request,
        commentsById: commentsFromExchange(snapshot),
        changedPlaceIds: new Set(
          changeSet.places.map((place) => place.placeId),
        ),
        fromRevision: pair.fromRevision,
        currentRevision: pair.toRevision,
        now: new Date().toISOString(),
      });
      await writeAgentResponse({ store: runtime.store, response });
      await writeAgentHeartbeat({
        store: runtime.store,
        sessionId: runtime.sessionId,
        state: "waiting",
      });

      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "data-review-ready",
        "",
      );
      const trayToggle = page.locator("[data-review-toggle]");
      if ((await trayToggle.getAttribute("aria-expanded")) === "false") {
        await trayToggle.click();
      }
      await page.locator('[data-review-tab="chat"]').click();
      const digest = page.locator("[data-review-chat-change-digest]").first();
      await expect(digest).toBeVisible();
      const digestToggle = digest.locator("[data-review-chat-change-toggle]");
      if ((await digestToggle.getAttribute("aria-expanded")) === "false") {
        await digestToggle.click();
      }
      for (const group of await digest
        .locator("[data-review-change-group]")
        .all()) {
        if ((await group.getAttribute("aria-expanded")) === "false") {
          await group.click();
        }
      }
      const rows = digest.locator("[data-review-change-row]");
      await expect(rows).toHaveCount(changeSet.places.length);
      const originalOrder = await page
        .locator("[data-block-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-block-id")),
        );
      for (let index = 0; index < changeSet.places.length; index += 1) {
        if ((await digestToggle.getAttribute("aria-expanded")) === "false") {
          await digestToggle.click();
        }
        for (const group of await digest
          .locator("[data-review-change-group]")
          .all()) {
          if ((await group.getAttribute("aria-expanded")) === "false") {
            await group.click();
          }
        }
        const placeId = changeSet.places[index]?.placeId ?? "";
        const row = digest
          .locator(`[data-review-change-row][data-place-id="${placeId}"]`)
          .first();
        await row.click();
        const lens = page.locator("[data-review-diff-lens]");
        await expect(lens).toBeVisible();
        await expect(row).toHaveAttribute("data-place-id", placeId);
        await expect(lens).toHaveAttribute("data-place-id", placeId);
        await expect(lens.locator("[data-review-diff-comment]")).toHaveCount(0);
        const place = changeSet.places[index];
        const expectedSides =
          place?.status === "added"
            ? ["now"]
            : place?.status === "removed"
              ? ["was"]
              : ["was", "now"];
        await expect(lens.locator("[data-review-diff-side]")).toHaveCount(
          expectedSides.length,
        );
        for (const sideName of expectedSides) {
          const side = lens.locator(`[data-review-diff-side="${sideName}"]`);
          await expect(
            side.locator("[data-review-diff-side-label]"),
          ).toHaveCount(1);
          const content = side.locator("[data-review-diff-side-content]");
          await expect(content).toHaveCount(1);
          expect(
            await side.evaluate((node) =>
              [...node.childNodes].some(
                (child) =>
                  child.nodeType === Node.TEXT_NODE &&
                  (child.textContent ?? "").trim() !== "",
              ),
            ),
          ).toBe(false);
          expect(
            await content.evaluate((node) => getComputedStyle(node).overflowX),
          ).toMatch(/auto|scroll/);
          const dimensions = await side.evaluate((node) => {
            const contentNode = node.querySelector(
              "[data-review-diff-side-content]",
            );
            return {
              side: node.getBoundingClientRect().width,
              content: contentNode?.getBoundingClientRect().width ?? 0,
            };
          });
          expect(dimensions.content / dimensions.side).toBeGreaterThanOrEqual(
            0.55,
          );
        }
        for (const theme of ["light", "dark"]) {
          await page.evaluate(
            (value) =>
              document.documentElement.setAttribute("data-theme", value),
            theme,
          );
          await expect(lens).toBeVisible();
        }
      }
      await page.locator("[data-review-diff-hide]").click();
      await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
      expect(
        await page
          .locator("[data-block-id]")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-block-id")),
          ),
      ).toEqual(originalOrder);
    } finally {
      await page.goto("about:blank");
      await runtime.close();
      await rm(directory, { recursive: true });
    }
  });
}

for (const name of associationCases) {
  test(`revision ownership should isolate ${name}`, async () => {
    const first = "# Pair ownership\n\n## Scope\n\nAlpha.\n\nBeta.\n";
    const second =
      name === "two comments on the same block"
        ? "# Pair ownership\n\n## Scope\n\nAlpha one.\n\nBeta.\n"
        : "# Pair ownership\n\n## Scope\n\nAlpha one.\n\nBeta one.\n";
    const third =
      name === "a later revision of the same thread"
        ? "# Pair ownership\n\n## Scope\n\nAlpha two.\n\nBeta one.\n"
        : "# Pair ownership\n\n## Scope\n\nAlpha two.\n\nBeta two.\n";
    const firstPair = revisionPairFor({ before: first, after: second });
    const secondPair = revisionPairFor({ before: second, after: third });
    const render = (markdown: string) =>
      renderDocument({ markdown, fallbackTitle: "pair", identity: {} }).blocks;
    const firstSet = buildRevisionChangeSet({
      pair: firstPair,
      before: render(first),
      after: render(second),
    });
    const secondSet = buildRevisionChangeSet({
      pair: secondPair,
      before: render(second),
      after: render(third),
    });
    expect(firstSet.fromRevision).toBe(firstPair.fromRevision);
    expect(firstSet.toRevision).toBe(firstPair.toRevision);
    expect(secondSet.fromRevision).toBe(firstSet.toRevision);
    expect(
      firstSet.places
        .flatMap((place) => place.locations)
        .some((location) => location.newText.includes("two")),
    ).toBe(false);
    expect(
      new Set(
        [...firstSet.places, ...secondSet.places].map((place) => place.placeId),
      ).size,
    ).toBe(firstSet.places.length + secondSet.places.length);
    const feedback = buildFeedbackPackage({
      sessionId: "1111111111111111",
      packageId: "2222222222222222",
      planId: "3333333333333333",
      planPath: `/tmp/${name}.mdx`,
      createdAt: "2026-08-04T12:00:00.000Z",
      comments: [
        {
          id: "4444444444444444",
          body: "Revise the first claim.",
          createdAt: "2026-08-04T12:00:00.000Z",
          target: {
            type: "block",
            blockId: "section/scope/paragraph-1",
            kind: "paragraph",
            label: "Alpha.",
            section: "Scope",
          },
        },
        {
          id: "5555555555555555",
          body: "Revise the next claim.",
          createdAt: "2026-08-04T12:00:01.000Z",
          target: {
            type: "block",
            blockId:
              name === "two comments on the same block"
                ? "section/scope/paragraph-1"
                : "section/scope/paragraph-2",
            kind: "paragraph",
            label:
              name === "two comments on the same block" ? "Alpha." : "Beta.",
            section: "Scope",
          },
        },
      ],
    });
    const requests = feedbackAgentRequests({
      feedback,
      sourceRevision: firstPair.fromRevision,
      requestIds: ["6666666666666666", "7777777777777777"],
    });
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.comments.length)).toEqual([1, 1]);
    const firstRequest = requests[0];
    const secondRequest = requests[1];
    if (firstRequest === undefined || secondRequest === undefined) {
      throw new Error("The serialized feedback batch is incomplete");
    }
    const firstResponse = validateAgentResponseDraft({
      value: {
        requestId: firstRequest.requestId,
        outcomes: [
          {
            commentId: firstRequest.comments[0]?.id,
            state: "changed",
            message: "Revised the first owned pair.",
          },
        ],
      },
      request: firstRequest,
      commentsById: new Map(
        feedback.comments.map((comment) => [comment.id, comment]),
      ),
      changedPlaceIds: new Set(firstSet.places.map((place) => place.placeId)),
      fromRevision: firstPair.fromRevision,
      currentRevision: firstPair.toRevision,
      now: "2026-08-04T12:01:00.000Z",
    });
    expect(
      effectiveSourceRevision({
        request: secondRequest,
        snapshot: {
          requests,
          responses: [firstResponse],
          cancelledIds: [],
        },
      }),
    ).toBe(firstPair.toRevision);
    expect(derivePlanId({ planPath: `/tmp/${name}.mdx` })).toMatch(
      /^[a-f0-9]{16}$/,
    );
  });
}
