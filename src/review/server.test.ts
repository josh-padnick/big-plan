// The transport boundary is the review runtime's whole security story, so it
// is covered here as behavior rather than as intent: each test is one refusal
// the design promises, exercised against a real listening runtime.

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deriveSourceRevision,
  nextPendingAgentRequest,
  readAgentExchange,
} from "./agent-exchange.js";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
import { writeRevisionSnapshot } from "./store.js";

const PLAN = `# Review runtime plan

The runtime serves this document and nothing else.

## Status quo

Today's reality is that feedback does not reach the agent.
`;

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

  it("should refuse a comment pointing at a block this document does not contain", async () => {
    const response = await call({
      path: "/api/feedback",
      method: "POST",
      body: {
        comments: [
          {
            id: "11223344",
            body: "Traversal attempt.",
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
            target: { type: "document" },
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    const written = await readdir(runtime.store.feedbackDirectory);
    // Names come from a timestamp and a random id, never from comment text.
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

  it("should expose only validated live agent exchange state", async () => {
    const answer: unknown = await (await call({ path: "/api/agent" })).json();
    expect(answer).toMatchObject({
      sourceRevision: expect.stringMatching(/^[a-f0-9]{16}$/),
      requests: [
        { kind: "feedback" },
        { kind: "reply", commentId: "55667788" },
      ],
      responses: [],
    });
    if (
      typeof answer !== "object" ||
      answer === null ||
      !("sourceRevision" in answer)
    ) {
      throw new Error("The agent snapshot did not expose a source revision");
    }
    const acceptedRevision = answer.sourceRevision;
    await writeFile(runtime.planPath, `${PLAN}\n<unfinished`);
    const whileEditing: unknown = await (
      await call({ path: "/api/agent" })
    ).json();
    expect(whileEditing).toMatchObject({
      sourceRevision: acceptedRevision,
    });
    await writeFile(runtime.planPath, PLAN);
  });

  it("should keep a retried feedback id unique in sent state", async () => {
    const body = {
      comments: [
        {
          id: "a1b2c3d4",
          body: "Retry this exact feedback package.",
          target: { type: "document" },
        },
      ],
    };
    expect(
      (await call({ path: "/api/feedback", method: "POST", body })).status,
    ).toBe(200);
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
  });

  it("should serve a deterministic diff between retained revisions", async () => {
    const revised = PLAN.replace(
      "feedback does not reach the agent",
      "feedback reaches the coding agent",
    );
    const from = deriveSourceRevision(PLAN);
    const to = deriveSourceRevision(revised);
    await writeRevisionSnapshot({
      store: runtime.store,
      revision: from,
      source: PLAN,
    });
    await writeRevisionSnapshot({
      store: runtime.store,
      revision: to,
      source: revised,
    });

    const response = await call({
      path: `/api/revision-diff?from=${from}&to=${to}`,
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

  it("should reject malformed revision names at the diff boundary", async () => {
    expect(
      (
        await call({
          path: "/api/revision-diff?from=../../etc/passwd&to=1111111111111111",
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
});

describe("review runtime shutdown", () => {
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
});
