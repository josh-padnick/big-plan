import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  batchSectionTone,
  CommentsSurface,
  type CommentsSurfaceBatch,
  type CommentsSurfaceModel,
} from "./comments-surface.browser.js";
import type { AgentStatus } from "../shared/agent-status.js";
import type { ReviewComment } from "../shared/comment.js";
import type { ThreadGroup } from "../shared/thread-projection.js";

const status = (overrides: Partial<AgentStatus> = {}): AgentStatus => ({
  stage: "working",
  label: "Agent working",
  headline: "Agent is working on this",
  detail: "",
  tone: "positive",
  ...overrides,
});

describe("batch section tone", () => {
  // BIG-147. Warning is the tone of an ordinary long turn, so demoting it would
  // swap the spinner for an hourglass every time the agent went quiet and back
  // on the next note, relabelling started work as queued through a treatment.
  it("should keep a quiet turn in the picked-up treatment", () => {
    expect(
      batchSectionTone({
        status: status({ stage: "stalled", label: "Working", tone: "warning" }),
      }),
    ).toBe("working");
    expect(batchSectionTone({ status: status() })).toBe("working");
  });

  it("should demote a batch whose reading has turned to danger", () => {
    expect(
      batchSectionTone({
        status: status({
          stage: "stalled",
          label: "No longer reporting",
          tone: "danger",
        }),
      }),
    ).toBe("queued");
  });

  // BIG-158. The reviewer sends B1, the agent claims it and works, then the
  // reviewer sends B2. B2 heads the section while B1's threads fill the rail's
  // working group, so a rail-wide count put the spinner beside B2's own
  // "Queued, 1 ahead" label - asserting work nothing had picked up.
  it("should queue a batch nobody has picked up while an earlier batch works", () => {
    expect(
      batchSectionTone({
        status: status({
          stage: "waiting",
          label: "Queued, 1 ahead",
          headline: "Waiting for an agent",
          tone: "neutral",
        }),
      }),
    ).toBe("queued");
  });

  it("should queue a batch that cannot start because no agent is connected", () => {
    expect(
      batchSectionTone({
        status: status({
          stage: "blocked",
          label: "Blocked",
          headline: "Blocked - no agent connected",
          tone: "warning",
        }),
      }),
    ).toBe("queued");
  });
});

const renderCount = (html: string, id: string): number =>
  html.split(`>${id}`).length - 1;

const comment = (id: string): ReviewComment => ({
  id,
  body: `note ${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  premiseSnapshot: "snapshot",
  target: { type: "document" },
});

const batch = (
  requestId: string,
  comments: ReadonlyArray<ReviewComment>,
): CommentsSurfaceBatch => ({
  requestId,
  count: comments.length,
  comments,
  content: null,
  label: "Queued, 1 ahead",
  tone: "queued",
});

const surface = ({
  groups,
  batches,
}: {
  readonly groups: ReadonlyMap<ThreadGroup, ReadonlyArray<ReviewComment>>;
  readonly batches: ReadonlyArray<CommentsSurfaceBatch>;
}): string =>
  renderToStaticMarkup(
    createElement(CommentsSurface, {
      model: {
        query: "",
        onQueryChange: () => undefined,
        drafts: [],
        sentCount: [...groups.values()].flat().length,
        hasRuntime: true,
        hasComponentBatchNotes: false,
        groups,
        batches,
        resolved: [],
        resolvedDrafts: [],
        canResolveAll: false,
        renderDraft: () => null,
        renderResolvedDraft: () => null,
        renderSent: (sent, _resolved, _compact, queuePosition) =>
          createElement(
            "span",
            { key: sent.id },
            `${sent.id}${queuePosition === undefined ? "" : `#${queuePosition}`}`,
          ),
        onResolveAll: () => undefined,
        onDeleteAll: () => undefined,
      } satisfies CommentsSurfaceModel,
    }),
  );

// BIG-162 follow-up. Batch headers take their own threads out of the Queued
// group, so the leftovers have to be numbered by where they sit in the whole
// queue: counting them from one puts the back of the line at its front, and
// counting every headed thread as ahead of them does the reverse for a comment
// sent before a batch that is still waiting.
describe("queued card numbering", () => {
  it("should count past the queued threads a batch header owns", () => {
    const worked = [comment("w1"), comment("w2")];
    const behind = [comment("q1"), comment("q2")];
    const alone = comment("c3");

    const html = surface({
      groups: new Map([
        ["working", worked],
        ["queued", [...behind, alone]],
      ]),
      batches: [
        {
          ...batch("1111111111111111", worked),
          tone: "working",
          label: "Working",
        },
        batch("2222222222222222", behind),
      ],
    });

    expect(html).toContain("c3#3");
    expect(html).not.toContain("c3#1");
  });

  it("should keep a thread sent ahead of a queued batch at the front of the line", () => {
    const worked = [comment("w1"), comment("w2")];
    const alone = comment("c1");
    const behind = [comment("q2"), comment("q3")];

    const html = surface({
      groups: new Map([
        ["working", worked],
        ["queued", [alone, ...behind]],
      ]),
      batches: [
        {
          ...batch("1111111111111111", worked),
          tone: "working",
          label: "Working",
        },
        batch("2222222222222222", behind),
      ],
    });

    expect(html).toContain("c1#1");
    expect(html).not.toContain("c1#3");
  });

  it("should number a queue no batch header speaks for from one", () => {
    expect(
      surface({
        groups: new Map([["queued", [comment("c1"), comment("c2")]]]),
        batches: [],
      }),
    ).toContain("c1#1");
  });
});

// BIG-162. A batch header owns its threads, so no lifecycle section may repeat
// one, and a thread the header has stopped owning has to be shown somewhere:
// cancel a reply on an open package's comment and that thread reaches an
// outcome while its package is still open, so the header no longer speaks for
// it and the Ready for review section does.
describe("threads a batch header owns", () => {
  const headed = [comment("a1"), comment("a2")];
  const other = [comment("b1"), comment("b2")];

  it("should show each thread it heads exactly once", () => {
    const html = surface({
      groups: new Map([
        ["working", headed],
        ["queued", other],
      ]),
      batches: [
        {
          ...batch("1111111111111111", headed),
          tone: "working",
          label: "Working",
        },
        batch("2222222222222222", other),
      ],
    });

    expect(renderCount(html, "a1")).toBe(1);
    expect(renderCount(html, "b1")).toBe(1);
  });

  it("should leave a thread its batch no longer heads in Ready for review", () => {
    const settled = comment("a1");

    const html = surface({
      groups: new Map([
        ["ready", [settled]],
        ["working", [headed[1]]],
        ["queued", other],
      ]),
      batches: [
        {
          ...batch("1111111111111111", [headed[1]]),
          tone: "working",
          label: "Working",
        },
        batch("2222222222222222", other),
      ],
    });

    expect(html).toContain("Ready for review");
    expect(renderCount(html, "a1")).toBe(1);
  });
});
