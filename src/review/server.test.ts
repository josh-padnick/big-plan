// The transport boundary is the review runtime's whole security story, so it
// is covered here as behavior rather than as intent: each test is one refusal
// the design promises, exercised against a real listening runtime.

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commentsFromExchange,
  deriveSnapshotDigest,
  messageAgentRequest,
  nextPendingAgentRequest,
  readAgentCommentHistory,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "./agent-exchange.js";
import { claimAgentRequest, publishAgentResponse } from "./request-mailbox.js";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
import { reviewSessionIsRunning } from "./session-authority.js";
import type { ReviewComment } from "./shared/comment.js";
import {
  readComments,
  readResolvedCommentIds,
  writeComments,
  writeResolvedCommentIds,
  writeSnapshot,
} from "./store.js";

const PLAN = `# Review runtime plan

The runtime serves this document and nothing else.

## Status quo

Today's reality is that feedback does not reach the agent.
`;
const PLAN_SNAPSHOT = deriveSnapshotDigest(PLAN);

let runtime: ReviewRuntime;
let token: string;
let planDirectory: string;

beforeAll(async () => {
  planDirectory = await mkdtemp(join(tmpdir(), "big-plan-server-"));
  const planPath = join(planDirectory, "plan.mdx");
  await writeFile(planPath, PLAN);
  runtime = await startReviewRuntime({ planPath });
  const descriptor: unknown = JSON.parse(
    await readFile(runtime.store.sessionPath, "utf8"),
  );
  token =
    typeof descriptor === "object" &&
    descriptor !== null &&
    "token" in descriptor &&
    typeof descriptor.token === "string"
      ? descriptor.token
      : "";
});

afterAll(async () => {
  await runtime.close();
  await rm(planDirectory, { recursive: true, force: true });
});

const call = ({
  path,
  method = "GET",
  headers = {},
  body,
}: {
  readonly path: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}) =>
  fetch(`${runtime.url.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      "x-big-plan-review-token": token,
      "sec-fetch-site": "same-origin",
      origin: runtime.url.replace(/\/$/, ""),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

// Speaks HTTP directly so a test can set headers fetch() reserves for itself.
const rawStatus = ({
  path,
  host,
}: {
  readonly path: string;
  readonly host: string;
}): Promise<number> =>
  new Promise((settle, fail) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: runtime.port,
        path,
        method: "GET",
        headers: {
          host,
          "x-big-plan-review-token": token,
          "sec-fetch-site": "same-origin",
        },
      },
      (response) => {
        response.resume();
        settle(response.statusCode ?? 0);
      },
    );
    request.on("error", fail);
    request.end();
  });

const openStalledMutation = ({
  target,
  sessionToken,
}: {
  readonly target: ReviewRuntime;
  readonly sessionToken: string;
}) => {
  let settleStatus = (_status: number): void => undefined;
  const status = new Promise<number>((settle) => {
    settleStatus = settle;
  });
  const request = httpRequest(
    {
      host: "127.0.0.1",
      port: target.port,
      path: "/api/drafts",
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-big-plan-review-token": sessionToken,
        "sec-fetch-site": "same-origin",
        origin: target.url.replace(/\/$/, ""),
      },
    },
    (response) => {
      response.resume();
      settleStatus(response.statusCode ?? 0);
    },
  );
  request.on("error", () => undefined);
  request.write("{");
  return { request, status };
};

describe("review runtime transport", () => {
  it("should bind loopback on an ephemeral port when it starts", () => {
    expect(runtime.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(runtime.port).toBeGreaterThan(0);
  });

  it("should refuse a request whose Host header is not its own address", async () => {
    // The anti-rebinding control: a name that resolves to 127.0.0.1 is
    // same-origin to a browser, so the address proves nothing and Host does.
    // fetch() forbids setting Host, so this speaks HTTP directly.
    expect(
      await rawStatus({
        path: "/api/session",
        host: "plan-review.evil.example.com",
      }),
    ).toBe(403);
    expect(
      await rawStatus({
        path: "/api/session",
        host: `127.0.0.1:${runtime.port}`,
      }),
    ).toBe(200);
  });

  it("should refuse a state-changing request with no session token", async () => {
    const response = await fetch(`${runtime.url}api/drafts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drafts: [] }),
    });
    expect(response.status).toBe(401);
  });

  it("should refuse a request carrying the wrong session token", async () => {
    const response = await call({
      path: "/api/session",
      headers: { "x-big-plan-review-token": "not-the-token" },
    });
    expect(response.status).toBe(401);
  });

  it("should refuse a write from a foreign origin", async () => {
    const response = await call({
      path: "/api/feedback",
      method: "POST",
      headers: {
        origin: "https://evil.example.com",
        "sec-fetch-site": "cross-site",
      },
      body: { comments: [] },
    });
    expect(response.status).toBe(403);
  });

  it("should never send a CORS allowance on any response", async () => {
    const response = await call({ path: "/api/session" });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("should answer only its route allow-list", async () => {
    expect((await call({ path: "/api/anything-else" })).status).toBe(404);
    expect((await call({ path: "/plan.mdx" })).status).toBe(404);
    expect((await call({ path: "/api/session", method: "POST" })).status).toBe(
      405,
    );
  });

  it("should forbid outbound origins and framing through its policy header", async () => {
    const response = await fetch(runtime.url);
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("review runtime document", () => {
  it("should render the document itself and stamp this session on it", async () => {
    const html = await (await fetch(runtime.url)).text();
    expect(html).toContain(`data-review-session="${runtime.sessionId}"`);
    expect(html).toContain(`data-plan-id="${runtime.planId}"`);
    expect(html).toContain("data-block-id=");
  });

  it("should let a document confirm the runtime is the session that served it", async () => {
    const answer: unknown = await (await call({ path: "/api/session" })).json();
    expect(answer).toMatchObject({
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
  });
});

describe("review runtime feedback", () => {
  const blockId = "section/status-quo/paragraph-1";

  it("should hold drafts for the session and hand them back", async () => {
    await fetch(runtime.url);
    const drafts = [
      {
        id: "aabbccdd",
        body: "Say what breaks, not just what works.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "block", blockId },
      },
    ];
    expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: { drafts, activeDraft: "", resolvedCommentIds: [] },
        })
      ).status,
    ).toBe(200);
    const answer: unknown = await (await call({ path: "/api/drafts" })).json();
    expect(answer).toMatchObject({ drafts: [{ id: "aabbccdd" }] });
  });

  it("should remove only submitted comments from persisted drafts", async () => {
    const drafts = [
      {
        id: "aa11bb22",
        body: "Send this staged comment.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "document" },
      },
      {
        id: "cc33dd44",
        body: "Keep this staged comment.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "document" },
      },
    ];
    expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: { drafts, activeDraft: "", resolvedCommentIds: [] },
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [drafts[0]] },
        })
      ).status,
    ).toBe(200);
    await expect(
      (await call({ path: "/api/drafts" })).json(),
    ).resolves.toMatchObject({
      drafts: [{ id: "cc33dd44" }],
      sent: expect.arrayContaining([
        expect.objectContaining({ id: "aa11bb22" }),
      ]),
    });
    await expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: { drafts, activeDraft: "", resolvedCommentIds: [] },
        })
      ).json(),
    ).resolves.toEqual({ drafts: 1 });
    await expect(
      (await call({ path: "/api/drafts" })).json(),
    ).resolves.toMatchObject({
      drafts: [{ id: "cc33dd44" }],
      sent: expect.arrayContaining([
        expect.objectContaining({ id: "aa11bb22" }),
      ]),
    });
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests.find(
      (candidate) =>
        candidate.kind === "feedback" &&
        candidate.comments.some((comment) => comment.id === "aa11bb22"),
    );
    if (request === undefined) {
      throw new Error("The submitted draft did not create agent work");
    }
    expect(
      (
        await call({
          path: "/api/agent-cancel",
          method: "POST",
          body: { requestId: request.requestId },
        })
      ).status,
    ).toBe(200);
  });

  it("should preserve exact orphaned feedback after the plan changes", async () => {
    await fetch(runtime.url);
    const draft = {
      id: "abcd1234",
      body: "Keep this history after the target disappears.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "block", blockId },
    };
    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [draft] },
        })
      ).status,
    ).toBe(200);
    const before: unknown = await (await call({ path: "/api/drafts" })).json();
    expect(before).toMatchObject({
      sent: expect.arrayContaining([expect.objectContaining({ id: draft.id })]),
    });
    try {
      await writeFile(
        runtime.planPath,
        "# A different plan\n\nNo prior block.\n",
      );
      const after: unknown = await (await call({ path: "/api/drafts" })).json();
      expect(after).toEqual(before);
    } finally {
      await writeFile(runtime.planPath, PLAN);
      await fetch(runtime.url);
      const exchange = await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      });
      const request = exchange.requests.find(
        (candidate) =>
          candidate.kind === "feedback" &&
          candidate.comments.some((comment) => comment.id === draft.id),
      );
      if (request !== undefined) {
        await call({
          path: "/api/agent-cancel",
          method: "POST",
          body: { requestId: request.requestId },
        });
        await call({
          path: "/api/comments-delete",
          method: "POST",
          body: { commentId: draft.id },
        });
      }
    }
  });

  it("should refuse a comment pointing at a block this document does not contain", async () => {
    const response = await call({
      path: "/api/feedback",
      method: "POST",
      body: {
        comments: [
          {
            id: "11223344",
            body: "Traversal attempt.",
            premiseSnapshot: PLAN_SNAPSHOT,
            target: { type: "block", blockId: "../../../../etc/passwd" },
          },
        ],
      },
    });
    expect(response.status).toBe(400);
  });

  it("should write a package and brief under runtime-generated names on send", async () => {
    await fetch(runtime.url);
    const response = await call({
      path: "/api/feedback",
      method: "POST",
      body: {
        comments: [
          {
            id: "55667788",
            body: "Open with a shorter lede.",
            premiseSnapshot: PLAN_SNAPSHOT,
            target: { type: "document" },
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    const written = await readdir(runtime.store.feedbackDirectory);
    // Names come from a timestamp and runtime-generated id, never comment text.
    expect(
      written.some((name) => /^\d{14}-[a-f0-9]{16}\.json$/.test(name)),
    ).toBe(true);
    expect(written.some((name) => /^\d{14}-[a-f0-9]{16}\.md$/.test(name))).toBe(
      true,
    );
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    expect(nextPendingAgentRequest(exchange)).toMatchObject({
      kind: "feedback",
      comments: [{ id: "55667788" }],
    });
  });

  it("should route a thread reply back into the same agent exchange", async () => {
    const response = await call({
      path: "/api/agent-requests",
      method: "POST",
      body: {
        kind: "reply",
        commentId: "55667788",
        body: "Keep the lede under twelve words.",
      },
    });
    expect(response.status).toBe(200);
    const answer: unknown = await response.json();
    expect(answer).toMatchObject({
      request: {
        kind: "reply",
        commentId: "55667788",
        body: "Keep the lede under twelve words.",
      },
    });
  });

  it("should cancel a pending request through the authenticated runtime", async () => {
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const reply = exchange.requests.find((request) => request.kind === "reply");
    if (reply === undefined)
      throw new Error("The reply request was not stored");
    const response = await call({
      path: "/api/agent-cancel",
      method: "POST",
      body: { requestId: reply.requestId },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      request: {
        requestId: reply.requestId,
        canceledAt: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
      },
    });
    const canceled = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    expect(
      canceled.requests.find(
        (request) => request.requestId === reply.requestId,
      ),
    ).toMatchObject({ canceledAt: expect.any(String) });
  });

  it("should expose only validated live agent exchange state", async () => {
    const answer: unknown = await (await call({ path: "/api/agent" })).json();
    expect(answer).toMatchObject({
      currentSnapshot: expect.stringMatching(/^[a-f0-9]{16}$/),
      requests: expect.arrayContaining([
        expect.objectContaining({ kind: "feedback" }),
        expect.objectContaining({ kind: "reply", commentId: "55667788" }),
      ]),
      responses: [],
      plan: runtime.planPath,
      agentCommand: expect.stringContaining(`agent '${runtime.planPath}'`),
      recoveryPrompt: expect.stringContaining(
        "Reconnect to my existing Big Plan review",
      ),
      connectionLog: [{ connected: false }],
    });
    if (
      typeof answer !== "object" ||
      answer === null ||
      !("currentSnapshot" in answer)
    ) {
      throw new Error("The agent snapshot did not expose its current snapshot");
    }
    const acceptedSnapshot = answer.currentSnapshot;
    try {
      await writeFile(runtime.planPath, `${PLAN}\n<unfinished`);
      const whileEditing: unknown = await (
        await call({ path: "/api/agent" })
      ).json();
      expect(whileEditing).toMatchObject({
        currentSnapshot: acceptedSnapshot,
      });
    } finally {
      await writeFile(runtime.planPath, PLAN);
    }
  });

  it("should keep a retried feedback id unique in sent state", async () => {
    const body = {
      comments: [
        {
          id: "a1b2c3d4",
          body: "Retry this exact feedback package.",
          premiseSnapshot: PLAN_SNAPSHOT,
          target: { type: "document" },
        },
      ],
    };
    expect(
      (await call({ path: "/api/feedback", method: "POST", body })).status,
    ).toBe(200);
    const artifactsAfterFirst = (
      await readdir(runtime.store.feedbackDirectory)
    ).sort();
    const exchangeAfterFirst = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    expect(
      (await call({ path: "/api/feedback", method: "POST", body })).status,
    ).toBe(200);
    const sent: unknown = JSON.parse(
      await readFile(runtime.store.sentPath, "utf8"),
    );
    expect(
      Array.isArray(sent)
        ? sent.filter(
            (comment) =>
              typeof comment === "object" &&
              comment !== null &&
              "id" in comment &&
              comment.id === "a1b2c3d4",
          )
        : [],
    ).toHaveLength(1);
    expect((await readdir(runtime.store.feedbackDirectory)).sort()).toEqual(
      artifactsAfterFirst,
    );
    const exchangeAfterRetry = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const matchingRequests = (exchange: typeof exchangeAfterRetry) =>
      exchange.requests.filter(
        (request) =>
          request.kind === "feedback" &&
          request.comments.some((comment) => comment.id === "a1b2c3d4"),
      );
    expect(matchingRequests(exchangeAfterFirst)).toHaveLength(1);
    expect(matchingRequests(exchangeAfterRetry)).toHaveLength(1);
  });

  it("should resume a partially published feedback submission once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-retry-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const isolated = await startReviewRuntime({ planPath });
    try {
      const descriptor: unknown = JSON.parse(
        await readFile(isolated.store.sessionPath, "utf8"),
      );
      const isolatedToken =
        typeof descriptor === "object" &&
        descriptor !== null &&
        "token" in descriptor &&
        typeof descriptor.token === "string"
          ? descriptor.token
          : "";
      const post = () =>
        fetch(`${isolated.url}api/feedback`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-big-plan-review-token": isolatedToken,
            "sec-fetch-site": "same-origin",
            origin: isolated.url.replace(/\/$/, ""),
          },
          body: JSON.stringify({
            comments: [
              {
                id: "ee44ff55",
                body: "Publish this feedback exactly once after recovery.",
                premiseSnapshot: PLAN_SNAPSHOT,
                target: { type: "document" },
              },
            ],
          }),
        });

      await mkdir(isolated.store.sentPath);
      expect((await post()).status).toBe(500);
      const afterFailure = await readAgentExchange({
        store: isolated.store,
        sessionId: isolated.sessionId,
        planId: isolated.planId,
      });
      const created = afterFailure.requests.find(
        (request) =>
          request.kind === "feedback" &&
          request.comments.some((comment) => comment.id === "ee44ff55"),
      );
      if (created === undefined) {
        throw new Error("Partial publication did not reach the mailbox");
      }
      const claimedAt = new Date().toISOString();
      await claimAgentRequest({
        store: isolated.store,
        requestId: created.requestId,
        baselineSnapshot: created.premiseSnapshot,
        now: claimedAt,
      });

      await rm(isolated.store.sentPath, { recursive: true });
      expect((await post()).status).toBe(200);
      const afterRetry = await readAgentExchange({
        store: isolated.store,
        sessionId: isolated.sessionId,
        planId: isolated.planId,
      });
      const matching = afterRetry.requests.filter(
        (request) =>
          request.kind === "feedback" &&
          request.comments.some((comment) => comment.id === "ee44ff55"),
      );
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        requestId: created.requestId,
        claimedAt,
      });
      expect(
        await readdir(isolated.store.feedbackSubmissionDirectory),
      ).toHaveLength(1);
      expect(await readdir(isolated.store.feedbackDirectory)).toHaveLength(2);
    } finally {
      await isolated.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should preserve feedback sent by overlapping requests", async () => {
    const comments = [
      {
        id: "c1c1c1c1",
        body: "Keep the first concurrent comment.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "document" },
      },
      {
        id: "d2d2d2d2",
        body: "Keep the second concurrent comment.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "document" },
      },
    ];
    const responses = await Promise.all(
      comments.map((comment) =>
        call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [comment] },
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const sent: unknown = JSON.parse(
      await readFile(runtime.store.sentPath, "utf8"),
    );
    expect(sent).toEqual(
      expect.arrayContaining(
        comments.map((comment) => expect.objectContaining({ id: comment.id })),
      ),
    );
  });

  it("should not let a streaming body hold the mutation gate", async () => {
    const stalled = openStalledMutation({
      target: runtime,
      sessionToken: token,
    });
    try {
      await new Promise((settle) => setTimeout(settle, 20));
      const result = await Promise.race([
        call({
          path: "/api/drafts",
          method: "PUT",
          body: { drafts: [], activeDraft: "", resolvedCommentIds: [] },
        }),
        new Promise<"timeout">((settle) =>
          setTimeout(() => settle("timeout"), 500),
        ),
      ]);
      expect(result).not.toBe("timeout");
      if (result === "timeout") return;
      expect(result.status).toBe(200);
    } finally {
      stalled.request.destroy();
    }
  });

  it("should refuse empty chat and reply requests", async () => {
    for (const body of [undefined, "", "   "]) {
      const response = await call({
        path: "/api/agent-requests",
        method: "POST",
        body: { kind: "chat", body },
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "An agent request needs a body",
      });
    }
  });

  it("should serve a deterministic diff between retained snapshots", async () => {
    const revised = PLAN.replace(
      "feedback does not reach the agent",
      "feedback reaches the coding agent",
    );
    const from = deriveSnapshotDigest(PLAN);
    const to = deriveSnapshotDigest(revised);
    await writeSnapshot({
      store: runtime.store,
      snapshot: from,
      source: PLAN,
    });
    await writeSnapshot({
      store: runtime.store,
      snapshot: to,
      source: revised,
    });

    const response = await call({
      path: `/api/snapshot-diff?from=${from}&to=${to}`,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      from,
      to,
      locations: [
        {
          status: "changed",
          oldText: "Today's reality is that feedback does not reach the agent.",
          newText: "Today's reality is that feedback reaches the coding agent.",
        },
      ],
    });
  });

  it("should preserve first-class component markup in snapshot diffs", async () => {
    const before = `# Component snapshots

## Choice

<Decision question="Which path?">

<Option title="Canary" recommended summary="Start narrow.">
<Consideration label="Risk" verdict="Low" />
</Option>

<Option title="Global">
<Consideration label="Risk" verdict="High" />
</Option>

</Decision>

## Flow

<FlowDiagram>

<Stage title="Author">
<Node id="source" label="Plan source" />
</Stage>

<Stage title="Review">
<Node id="review" label="Review service" />
</Stage>

<Edge from="source" to="review" label="opens" />

</FlowDiagram>

## Sequence

<MermaidDiagram>

\`\`\`mermaid
flowchart LR
  A[Author] --> B[Review]
\`\`\`

</MermaidDiagram>

## Layout

<FileTree title="Review module">

\`\`\`tree
src/
  service.ts - Coordinates review.
\`\`\`

</FileTree>

<FileTreeDiff title="Planned changes">

\`\`\`tree
src/
  service.ts [modified] - Coordinates review.
\`\`\`

</FileTreeDiff>

## Contract

<HttpEndpoint method="POST" path="/api/restore" summary="Restore a historical version">

Restores the selected snapshot as a new current plan.

</HttpEndpoint>

## Summary

<QuickSummary>

<Why>

- Reviewers need durable history.

</Why>

<What>

- Version every resolution.

</What>

</QuickSummary>
`;
    const after = before
      .replace('question="Which path?"', 'question="Which rollout path?"')
      .replace('label="Review service"', 'label="Local review service"')
      .replace("A[Author] --> B[Review]", "A[Author] --> B[Plan review]")
      .replace(
        "  service.ts - Coordinates review.",
        "  service.ts - Coordinates review.\n  repository.ts - Stores events.",
      )
      .replace(
        "  service.ts [modified] - Coordinates review.",
        "  service.ts [modified] - Coordinates plan review.",
      )
      .replace(
        "Restores the selected snapshot as a new current plan.",
        "Restores the selected snapshot as a new current plan after confirmation.",
      )
      .replace("Version every resolution.", "Version every resolved thread.");
    const from = deriveSnapshotDigest(before);
    const to = deriveSnapshotDigest(after);
    await writeSnapshot({
      store: runtime.store,
      snapshot: from,
      source: before,
    });
    await writeSnapshot({
      store: runtime.store,
      snapshot: to,
      source: after,
    });

    const response = await call({
      path: `/api/snapshot-diff?from=${from}&to=${to}`,
    });
    const value = (await response.json()) as {
      readonly locations: ReadonlyArray<{
        readonly kind: string;
        readonly oldHtml?: string;
        readonly newHtml?: string;
      }>;
    };
    const decision = value.locations.find(
      (location) => location.kind === "decision",
    );
    const flow = value.locations.find(
      (location) => location.kind === "flow-diagram",
    );
    const fileTree = value.locations.find(
      (location) => location.kind === "file-tree",
    );
    const mermaid = value.locations.find(
      (location) => location.kind === "mermaid-diagram",
    );
    const fileTreeDiff = value.locations.find(
      (location) => location.kind === "file-tree-diff",
    );
    const httpEndpoint = value.locations.find(
      (location) => location.kind === "http-endpoint",
    );
    const quickSummary = value.locations.find(
      (location) => location.kind === "quick-summary",
    );
    const quickSummaryFacet = value.locations.find(
      (location) => location.kind === "quick-summary-facet",
    );
    expect(decision?.oldHtml).toContain("Which path?");
    expect(decision?.newHtml).toContain("Which rollout path?");
    expect(flow?.oldHtml).toContain("Review service");
    expect(flow?.newHtml).toContain("Local review service");
    expect(fileTree?.oldHtml).toContain("service.ts");
    expect(fileTree?.newHtml).toContain("repository.ts");
    expect(fileTree?.oldHtml).not.toContain("data-block-id");
    expect(fileTree?.newHtml).not.toContain("data-block-id");
    expect(mermaid?.oldHtml).toContain("Review");
    expect(mermaid?.newHtml).toContain("Plan review");
    expect(fileTreeDiff?.oldHtml).toContain("Coordinates review");
    expect(fileTreeDiff?.newHtml).toContain("Coordinates plan review");
    expect(mermaid?.oldHtml).toContain(`review-diff-was-${from}`);
    expect(mermaid?.newHtml).toContain(`review-diff-now-${to}`);
    // A component root without a dedicated text treatment defaults to the
    // rendered evidence; components with one keep the text path so the lens
    // can diff their declared sub-targets instead.
    expect(httpEndpoint?.oldHtml).toContain("/api/restore");
    expect(httpEndpoint?.newHtml).toContain("after confirmation");
    expect(quickSummary?.oldHtml).toBeUndefined();
    expect(quickSummary?.newHtml).toBeUndefined();
    expect(quickSummaryFacet?.oldHtml).toBeUndefined();
    expect(quickSummaryFacet?.newHtml).toBeUndefined();
    // This case compiles both snapshots through every first-class component,
    // including the Mermaid renderer, so it needs the same headroom the
    // renderer's own suites take rather than the default per-test timeout.
  }, 15000);

  it("should reject malformed snapshot names at the diff boundary", async () => {
    expect(
      (
        await call({
          path: "/api/snapshot-diff?from=../../etc/passwd&to=1111111111111111",
        })
      ).status,
    ).toBe(400);
  });

  it("should report having received the package on its own progress channel", async () => {
    const response = await call({
      path: "/api/feedback",
      method: "POST",
      body: {
        comments: [
          {
            id: "deadbeef",
            body: "Emit an independent progress event.",
            premiseSnapshot: PLAN_SNAPSHOT,
            target: { type: "document" },
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    const answer: unknown = await (
      await call({ path: "/api/progress" })
    ).json();
    expect(answer).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({
          sessionId: runtime.sessionId,
          state: "done",
          step: "Feedback package received",
        }),
      ]),
    });
  });

  it("should delete one queued comment without discarding its batch peers", async () => {
    const comments = [
      {
        id: "a1a1a1a1",
        body: "Delete this queued comment.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "document" },
      },
      {
        id: "b2b2b2b2",
        body: "Keep this queued comment.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "document" },
      },
    ];
    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments },
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await call({
          path: "/api/comments-delete",
          method: "POST",
          body: { commentId: comments[0]?.id },
        })
      ).status,
    ).toBe(200);

    const snapshot: unknown = await (
      await call({ path: "/api/drafts" })
    ).json();
    expect(snapshot).toMatchObject({
      sent: expect.arrayContaining([
        expect.objectContaining({ id: "b2b2b2b2" }),
      ]),
    });
    expect(snapshot).not.toMatchObject({
      sent: expect.arrayContaining([
        expect.objectContaining({ id: "a1a1a1a1" }),
      ]),
    });
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const batch = exchange.requests.find(
      (request) =>
        request.kind === "feedback" &&
        request.comments.some((comment) => comment.id === "b2b2b2b2"),
    );
    expect(batch).toMatchObject({
      kind: "feedback",
      comments: [{ id: "b2b2b2b2" }],
    });
  });

  it("should delete a comment after its request is canceled", async () => {
    const comment = {
      id: "c3c3c3c3",
      body: "Delete this canceled comment.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [comment] },
        })
      ).status,
    ).toBe(200);
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests.find(
      (candidate) =>
        candidate.kind === "feedback" &&
        candidate.comments.some((item) => item.id === comment.id),
    );
    if (request === undefined) throw new Error("The request was not stored");
    expect(
      (
        await call({
          path: "/api/agent-cancel",
          method: "POST",
          body: { requestId: request.requestId },
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await call({
          path: "/api/comments-delete",
          method: "POST",
          body: { commentId: comment.id },
        })
      ).status,
    ).toBe(200);
    const snapshot: unknown = await (
      await call({ path: "/api/drafts" })
    ).json();
    expect(snapshot).not.toMatchObject({
      sent: expect.arrayContaining([
        expect.objectContaining({ id: comment.id }),
      ]),
    });

    expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: {
            drafts: [comment],
            activeDraft: "",
            resolvedCommentIds: [],
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [comment] },
        })
      ).status,
    ).toBe(500);
    const afterResubmission: unknown = await (
      await call({ path: "/api/drafts" })
    ).json();
    expect(afterResubmission).toMatchObject({
      drafts: [expect.objectContaining({ id: comment.id })],
    });
    expect(afterResubmission).not.toMatchObject({
      sent: expect.arrayContaining([
        expect.objectContaining({ id: comment.id }),
      ]),
    });
  });

  it("should revert a current changed response before deleting its comment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-revert-"));
    const planPath = join(directory, "plan.mdx");
    const baseline = `# Revert review\n\n## Status\n\nBefore the agent change.\n`;
    const revised = baseline.replace("Before", "After");
    await writeFile(planPath, baseline);
    const isolated = await startReviewRuntime({ planPath });
    try {
      const descriptor: unknown = JSON.parse(
        await readFile(isolated.store.sessionPath, "utf8"),
      );
      const isolatedToken =
        typeof descriptor === "object" &&
        descriptor !== null &&
        "token" in descriptor &&
        typeof descriptor.token === "string"
          ? descriptor.token
          : "";
      const isolatedCall = ({
        path,
        body,
      }: {
        readonly path: string;
        readonly body: unknown;
      }) =>
        fetch(`${isolated.url.replace(/\/$/u, "")}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-big-plan-review-token": isolatedToken,
            "sec-fetch-site": "same-origin",
            origin: isolated.url.replace(/\/$/u, ""),
          },
          body: JSON.stringify(body),
        });
      const comment = {
        id: "e5e5e5e5",
        body: "Make the status current.",
        premiseSnapshot: deriveSnapshotDigest(baseline),
        target: { type: "document" as const },
      };
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            body: { comments: [comment] },
          })
        ).status,
      ).toBe(200);
      const exchange = await readAgentExchange({
        store: isolated.store,
        sessionId: isolated.sessionId,
        planId: isolated.planId,
      });
      const request = exchange.requests.find(
        (candidate) => candidate.kind === "feedback",
      );
      if (request === undefined) throw new Error("Feedback was not queued");
      const claimed = await claimAgentRequest({
        store: isolated.store,
        requestId: request.requestId,
        baselineSnapshot: request.premiseSnapshot,
        now: new Date().toISOString(),
      });
      await writeFile(planPath, revised);
      const resultSnapshot = deriveSnapshotDigest(revised);
      await writeSnapshot({
        store: isolated.store,
        snapshot: resultSnapshot,
        source: revised,
      });
      await publishAgentResponse({
        store: isolated.store,
        response: validateAgentResponseDraft({
          value: {
            requestId: request.requestId,
            outcomes: [
              {
                commentId: comment.id,
                state: "changed",
                message: "Updated the status.",
                changeTargets: ["section/status/paragraph-1"],
              },
            ],
          },
          request: claimed,
          commentsById: commentsFromExchange(exchange),
          changedBlocks: new Set(["section/status/paragraph-1"]),
          currentSnapshot: resultSnapshot,
          now: new Date().toISOString(),
        }),
      });

      const reverted = await isolatedCall({
        path: "/api/revert-agent-changes",
        body: { requestId: request.requestId, commentId: comment.id },
      });
      expect(reverted.status).toBe(200);
      expect(await readFile(planPath, "utf8")).toBe(baseline);
      expect(
        (
          await isolatedCall({
            path: "/api/revert-agent-changes",
            body: { requestId: request.requestId, commentId: comment.id },
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await isolatedCall({
            path: "/api/comments-delete",
            body: { commentId: comment.id },
          })
        ).status,
      ).toBe(200);
      const snapshot: unknown = await (
        await fetch(`${isolated.url}api/drafts`, {
          headers: {
            "x-big-plan-review-token": isolatedToken,
            "sec-fetch-site": "same-origin",
            origin: isolated.url.replace(/\/$/u, ""),
          },
        })
      ).json();
      expect(snapshot).not.toMatchObject({
        sent: expect.arrayContaining([
          expect.objectContaining({ id: comment.id }),
        ]),
      });
    } finally {
      await isolated.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should keep answered history when a later follow-up is canceled", async () => {
    const comment = {
      id: "d4d4d4d4",
      body: "Keep this answered thread.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [comment] },
        })
      ).status,
    ).toBe(200);
    let exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests.find(
      (candidate) =>
        candidate.kind === "feedback" &&
        candidate.comments.some((entry) => entry.id === comment.id),
    );
    if (request === undefined)
      throw new Error("The feedback request was not stored");
    const claimed = await claimAgentRequest({
      store: runtime.store,
      requestId: request.requestId,
      baselineSnapshot: request.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await publishAgentResponse({
      store: runtime.store,
      response: validateAgentResponseDraft({
        value: {
          requestId: claimed.requestId,
          outcomes: [
            {
              commentId: comment.id,
              state: "declined",
              message: "The existing plan already covers this.",
            },
          ],
        },
        request: claimed,
        commentsById: commentsFromExchange(exchange),
        changedBlocks: new Set(),
        currentSnapshot: request.premiseSnapshot,
        now: new Date().toISOString(),
      }),
    });
    const answeredAt = Date.parse(request.createdAt);
    for (let index = 0; index < 400; index += 1) {
      await writeAgentRequest({
        store: runtime.store,
        request: messageAgentRequest({
          kind: "chat",
          requestId: `f${index.toString(16).padStart(15, "0")}`,
          sessionId: runtime.sessionId,
          planId: runtime.planId,
          premiseSnapshot: request.premiseSnapshot,
          createdAt: new Date(answeredAt + index + 1).toISOString(),
          body: `Later plan question ${index + 1}`,
        }),
      });
    }
    const followUpResponse = await call({
      path: "/api/agent-requests",
      method: "POST",
      body: {
        kind: "reply",
        commentId: comment.id,
        body: "One canceled follow-up.",
      },
    });
    const followUpBody: unknown = await followUpResponse.json();
    if (
      typeof followUpBody !== "object" ||
      followUpBody === null ||
      !("requestId" in followUpBody) ||
      typeof followUpBody.requestId !== "string"
    ) {
      throw new Error("The follow-up request was not returned");
    }
    expect(
      (
        await call({
          path: "/api/agent-cancel",
          method: "POST",
          body: { requestId: followUpBody.requestId },
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await call({
          path: "/api/comments-delete",
          method: "POST",
          body: { commentId: comment.id },
        })
      ).status,
    ).toBe(409);
    exchange = await readAgentCommentHistory({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
      commentId: comment.id,
    });
    expect(
      exchange.responses.some(
        (response) => response.requestId === request.requestId,
      ),
    ).toBe(true);
  });
});

describe("review runtime shutdown", () => {
  it("should not replace durable review state when reopening a diff preview", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-preview-reopen-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const before = PLAN.replace(
      "Today's reality is that feedback does not reach the agent.",
      "Today's reality is that feedback is easy to lose.",
    );
    const first = await startReviewRuntime({
      planPath,
      diffPreviewSource: before,
    });
    const validateComments = (value: unknown): ReadonlyArray<ReviewComment> =>
      Array.isArray(value) ? (value as ReadonlyArray<ReviewComment>) : [];
    const existing = await readComments({
      path: first.store.sentPath,
      validate: validateComments,
    });
    const retained: ReviewComment = {
      id: "cafefeed",
      body: "Keep this reviewer comment across preview restarts.",
      createdAt: "2026-08-10T12:00:00.000Z",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    await writeComments({
      path: first.store.sentPath,
      comments: [...existing, retained],
    });
    await writeResolvedCommentIds({
      store: first.store,
      ids: [retained.id],
    });
    await first.close();

    const reopened = await startReviewRuntime({
      planPath,
      diffPreviewSource: before,
    });
    try {
      await expect(
        readComments({
          path: reopened.store.sentPath,
          validate: validateComments,
        }),
      ).resolves.toEqual(expect.arrayContaining([retained]));
      await expect(
        readResolvedCommentIds({
          store: reopened.store,
          validate: (value) =>
            Array.isArray(value)
              ? value.filter((item): item is string => typeof item === "string")
              : [],
        }),
      ).resolves.toContain(retained.id);
    } finally {
      await reopened.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should restart from the rendered source before accepting new responses", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-server-revision-"),
    );
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const first = await startReviewRuntime({ planPath });
    const oldRevision = deriveSnapshotDigest(PLAN);
    const oldRequest = messageAgentRequest({
      kind: "chat",
      requestId: "1111111111111111",
      sessionId: first.sessionId,
      planId: first.planId,
      premiseSnapshot: oldRevision,
      createdAt: "2026-08-10T12:00:00.000Z",
      body: "What changed?",
    });
    await writeAgentRequest({ store: first.store, request: oldRequest });
    const oldClaim = await claimAgentRequest({
      store: first.store,
      requestId: oldRequest.requestId,
      baselineSnapshot: oldRevision,
      now: "2026-08-10T12:00:01.000Z",
    });
    await publishAgentResponse({
      store: first.store,
      response: validateAgentResponseDraft({
        value: { requestId: oldRequest.requestId, message: "The old answer." },
        request: oldClaim,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: oldRevision,
        now: "2026-08-10T12:00:02.000Z",
      }),
    });
    await first.close();

    const restartedSource = `${PLAN}\nThe source changed while review was stopped.\n`;
    await writeFile(planPath, restartedSource);
    const restarted = await startReviewRuntime({ planPath });
    try {
      const descriptor: unknown = JSON.parse(
        await readFile(restarted.store.sessionPath, "utf8"),
      );
      const restartedToken =
        typeof descriptor === "object" &&
        descriptor !== null &&
        "token" in descriptor &&
        typeof descriptor.token === "string"
          ? descriptor.token
          : "";
      const agentState = () =>
        fetch(`${restarted.url}api/agent`, {
          headers: { "x-big-plan-review-token": restartedToken },
        }).then((response) => response.json());
      await expect(agentState()).resolves.toMatchObject({
        currentSnapshot: deriveSnapshotDigest(restartedSource),
      });

      const newRequest = messageAgentRequest({
        kind: "chat",
        requestId: "2222222222222222",
        sessionId: restarted.sessionId,
        planId: restarted.planId,
        premiseSnapshot: deriveSnapshotDigest(restartedSource),
        createdAt: "2026-08-10T12:01:00.000Z",
        body: "What changed now?",
      });
      await writeAgentRequest({ store: restarted.store, request: newRequest });
      const newClaim = await claimAgentRequest({
        store: restarted.store,
        requestId: newRequest.requestId,
        baselineSnapshot: newRequest.premiseSnapshot,
        now: "2026-08-10T12:01:01.000Z",
      });
      const acceptedSource = `${restartedSource}\nThe agent accepted this revision.\n`;
      await writeFile(planPath, acceptedSource);
      await publishAgentResponse({
        store: restarted.store,
        response: validateAgentResponseDraft({
          value: {
            requestId: newRequest.requestId,
            message: "The current answer.",
          },
          request: newClaim,
          commentsById: new Map(),
          changedBlocks: new Set(),
          currentSnapshot: deriveSnapshotDigest(acceptedSource),
          now: "2026-08-10T12:01:02.000Z",
        }),
      });
      await expect(agentState()).resolves.toMatchObject({
        currentSnapshot: deriveSnapshotDigest(acceptedSource),
      });
    } finally {
      await restarted.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should keep a replacement runtime authoritative for the same plan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-server-restart-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const first = await startReviewRuntime({ planPath });
    const firstDescriptor: unknown = JSON.parse(
      await readFile(first.store.sessionPath, "utf8"),
    );
    const firstToken =
      typeof firstDescriptor === "object" &&
      firstDescriptor !== null &&
      "token" in firstDescriptor &&
      typeof firstDescriptor.token === "string"
        ? firstDescriptor.token
        : "";
    const stalled = openStalledMutation({
      target: first,
      sessionToken: firstToken,
    });
    await new Promise((settle) => setTimeout(settle, 20));
    const replacement = await startReviewRuntime({ planPath });
    try {
      stalled.request.end(
        '"drafts":[],"activeDraft":"","resolvedCommentIds":[]}',
      );
      await expect(stalled.status).resolves.toBe(409);
      expect(
        await reviewSessionIsRunning({
          store: replacement.store,
          sessionId: replacement.sessionId,
        }),
      ).toBe(true);
      const oldSessionResponse = await fetch(`${first.url}api/session`, {
        headers: { "x-big-plan-review-token": firstToken },
      });
      await expect(oldSessionResponse.json()).resolves.toMatchObject({
        authoritative: false,
        latestReviewUrl: replacement.url,
      });
      const oldWriteResponse = await fetch(`${first.url}api/drafts`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-big-plan-review-token": firstToken,
        },
        body: JSON.stringify({ drafts: [] }),
      });
      expect(oldWriteResponse.status).toBe(409);
    } finally {
      stalled.request.destroy();
      await Promise.all([first.close(), replacement.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should stop listening when the reviewer closes it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-server-close-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const closing = await startReviewRuntime({ planPath });
    try {
      await closing.close();
      await expect(fetch(closing.url)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should force-close a stalled active request after a short grace period", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-server-stall-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const closing = await startReviewRuntime({ planPath });
    const descriptor: unknown = JSON.parse(
      await readFile(closing.store.sessionPath, "utf8"),
    );
    const closingToken =
      typeof descriptor === "object" &&
      descriptor !== null &&
      "token" in descriptor &&
      typeof descriptor.token === "string"
        ? descriptor.token
        : "";
    const stalled = openStalledMutation({
      target: closing,
      sessionToken: closingToken,
    });
    try {
      await new Promise((settle) => setTimeout(settle, 20));
      await expect(closing.close()).resolves.toBeUndefined();
    } finally {
      stalled.request.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
