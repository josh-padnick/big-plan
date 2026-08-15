// Covers review-runtime route behavior against a real listening server,
// including security refusals and durable request-lifecycle invariants.

import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import {
  appendProgressEvent,
  claimAgentRequest,
  commitRequestTerminal,
} from "./request-mailbox.js";
import { materializeReviewImages } from "./plan-assets.js";
import {
  DEFAULT_REVIEW_IDLE_TIMEOUT_MS,
  startReviewRuntime,
} from "./server.js";
import type { ReviewRuntime } from "./server.js";
import { reviewSessionIsRunning } from "./session-authority.js";
import type { ReviewComment } from "./shared/comment.js";
import { validateResolvedCommentIds } from "./shared/comment.js";
import { MAX_IMAGE_BYTES } from "./shared/review-image.js";
import { REVIEW_POLL_INTERVAL_MS } from "./shared/review-polling.js";
import {
  readComments,
  readResolvedCommentIds,
  readSessionHeartbeatValue,
  publishReviewImage,
  readProgress,
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

const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 2, 0, 0, 0, 3,
]);

let runtime: ReviewRuntime;
let token: string;
let planDirectory: string;

beforeAll(async () => {
  planDirectory = await mkdtemp(join(tmpdir(), "big-plan-server-"));
  const planPath = join(planDirectory, "plan.mdx");
  await writeFile(planPath, PLAN);
  runtime = await startReviewRuntime({ planPath });
  token = await readSessionToken(runtime);
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

const readSessionToken = async (target: ReviewRuntime): Promise<string> => {
  const descriptor: unknown = JSON.parse(
    await readFile(target.store.sessionPath, "utf8"),
  );
  return typeof descriptor === "object" &&
    descriptor !== null &&
    "token" in descriptor &&
    typeof descriptor.token === "string"
    ? descriptor.token
    : "";
};

const uploadImage = (bytes: Uint8Array = TINY_PNG) =>
  fetch(`${runtime.url.replace(/\/$/u, "")}/api/review-images`, {
    method: "POST",
    headers: {
      "x-big-plan-review-token": token,
      "sec-fetch-site": "same-origin",
      origin: runtime.url.replace(/\/$/u, ""),
      "content-type": "image/png",
      "x-big-plan-image-alt": "Test capture",
    },
    body: bytes,
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

const sessionTokenFor = async (target: ReviewRuntime): Promise<string> => {
  const descriptor: unknown = JSON.parse(
    await readFile(target.store.sessionPath, "utf8"),
  );
  return typeof descriptor === "object" &&
    descriptor !== null &&
    "token" in descriptor &&
    typeof descriptor.token === "string"
    ? descriptor.token
    : "";
};

/**
 * Starts a runtime whose next write cannot finish. The fault is a real
 * filesystem hang rather than a stubbed one: drafts.json becomes a FIFO with no
 * writer, so the readFile() inside PUT /api/drafts blocks until a writer
 * appears. That path reads drafts.json exactly once, so one write releases it.
 */
const startWedgedRuntime = async (
  prefix: string,
  options: { readonly writeStallMs?: number } = {},
) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const wedged = await startReviewRuntime({ planPath, ...options });
  const wedgedToken = await sessionTokenFor(wedged);
  await rm(wedged.store.draftsPath, { force: true });
  execFileSync("mkfifo", [wedged.store.draftsPath]);

  const put = (target: string) =>
    fetch(`${target}api/drafts`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-big-plan-review-token": wedgedToken,
        "sec-fetch-site": "same-origin",
        origin: target.replace(/\/$/, ""),
      },
      body: JSON.stringify({ drafts: [], resolvedCommentIds: [] }),
    });
  const stuck = put(wedged.url).then(
    (response) => response.status,
    () => 0,
  );

  return {
    runtime: wedged,
    token: wedgedToken,
    stuck,
    write: () => put(wedged.url),
    /** Waits for that many requests to reach the gate rather than sleeping. */
    waitForInFlight: async (count = 1) => {
      const deadline = Date.now() + 5_000;
      for (;;) {
        const { inFlight } = wedged.diagnostics();
        if (inFlight.length >= count) return inFlight;
        if (Date.now() > deadline) return inFlight;
        await new Promise((settle) => setTimeout(settle, 10));
      }
    },
    /** Unblocks the FIFO read, then stops the runtime and removes the plan. */
    release: async () => {
      // O_NONBLOCK refuses with ENXIO when no reader is waiting, so a test
      // that failed before wedging anything cannot hang here.
      const handle = await open(
        wedged.store.draftsPath,
        constants.O_WRONLY | constants.O_NONBLOCK,
      ).catch(() => undefined);
      if (handle !== undefined) {
        await handle.write("[]");
        await handle.close();
      }
      await stuck;
      // Work the gate gave up on keeps running once it is unblocked, so the
      // plan directory cannot be removed until it has finished writing.
      const deadline = Date.now() + 5_000;
      while (
        wedged.diagnostics().inFlight.length > 0 &&
        Date.now() < deadline
      ) {
        await new Promise((settle) => setTimeout(settle, 20));
      }
      await wedged.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
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

describe("review runtime images", () => {
  it("should publish a deduplicated image and return identical bytes", async () => {
    const first = await uploadImage();
    expect(first.status).toBe(200);
    const descriptor = (await first.json()) as {
      readonly id: string;
      readonly mimeType: string;
    };
    expect(descriptor.mimeType).toBe("image/png");
    const duplicate = await uploadImage();
    await expect(duplicate.json()).resolves.toMatchObject({
      id: descriptor.id,
    });
    const image = await fetch(
      `${runtime.url.replace(/\/$/u, "")}/review-images/${descriptor.id}`,
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(TINY_PNG);
  });

  it("should refuse a review image path that names no stored picture", async () => {
    const missing = await fetch(
      `${runtime.url.replace(/\/$/u, "")}/review-images/${"a".repeat(64)}`,
    );
    expect(missing.status).toBe(404);
    const malformed = await fetch(
      `${runtime.url.replace(/\/$/u, "")}/review-images/not-a-digest`,
    );
    expect(malformed.status).toBe(404);
  });

  it("should reject image publication without the review token", async () => {
    const response = await fetch(
      `${runtime.url.replace(/\/$/u, "")}/api/review-images`,
      {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: TINY_PNG,
      },
    );
    expect(response.status).toBe(401);
  });

  it("should keep published images readable after the runtime restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-image-restart-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const first = await startReviewRuntime({ planPath });
    const firstToken = await readSessionToken(first);
    const upload = await fetch(`${first.url}api/review-images`, {
      method: "POST",
      headers: {
        "x-big-plan-review-token": firstToken,
        "sec-fetch-site": "same-origin",
        origin: first.url.replace(/\/$/u, ""),
        "content-type": "image/png",
      },
      body: TINY_PNG,
    });
    const descriptor = (await upload.json()) as { readonly id: string };
    await first.close();

    const restarted = await startReviewRuntime({ planPath });
    try {
      // No token, and a different port: the picture belongs to the plan, so
      // the reference minted in the first session still resolves in this one.
      const image = await fetch(
        `${restarted.url}review-images/${descriptor.id}`,
      );
      expect(image.status).toBe(200);
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(TINY_PNG);
    } finally {
      await restarted.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should serve materialized plan assets from their relative source path", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-plan-asset-route-"),
    );
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const review = await startReviewRuntime({ planPath });
    try {
      const descriptor = await publishReviewImage({
        store: review.store,
        bytes: TINY_PNG,
        alt: "Capture",
      });
      const source = await materializeReviewImages({
        markdown: `# Plan\n\n![Capture](review-image:${descriptor.id})\n`,
        planPath,
        store: review.store,
      });
      await writeFile(planPath, source);
      const asset = await fetch(
        `${review.url}assets/review-image-${descriptor.id}.png`,
      );
      expect(asset.status).toBe(200);
      expect(new Uint8Array(await asset.arrayBuffer())).toEqual(TINY_PNG);
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should serve an author's own picture files and refuse everything else beside the plan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-plan-picture-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    await mkdir(join(directory, "assets", "site"), { recursive: true });
    await writeFile(join(directory, "assets", "site", "cabinet.jpg"), TINY_PNG);
    await writeFile(join(directory, "diagram.PNG"), TINY_PNG);
    await writeFile(
      join(directory, "scripted.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/")</script></svg>',
    );
    await writeFile(join(directory, "notes.md"), "Not a picture.");
    await mkdir(join(directory, "inside"), { recursive: true });
    await writeFile(join(directory, "inside", "linked-target.png"), TINY_PNG);
    const outside = await mkdtemp(join(tmpdir(), "big-plan-outside-"));
    await writeFile(join(outside, "secret.png"), TINY_PNG);
    const review = await startReviewRuntime({ planPath });
    const url = review.url.replace(/\/$/u, "");
    try {
      // A photograph named by its subject is the ordinary case, at any depth
      // and with any letter case in its extension.
      expect((await fetch(`${url}/assets/site/cabinet.jpg`)).status).toBe(200);
      expect((await fetch(`${url}/diagram.PNG`)).status).toBe(200);
      expect(
        (await fetch(`${url}/assets/site/cabinet.jpg`)).headers.get(
          "content-type",
        ),
      ).toBe("image/jpeg");
      const svg = await fetch(`${url}/scripted.svg`);
      expect(svg.status).toBe(200);
      expect(svg.headers.get("content-type")).toBe("image/svg+xml");
      expect(svg.headers.get("content-security-policy")).toBe(
        "default-src 'none'; sandbox",
      );

      // Everything that is not a picture inside this plan's own directory is
      // refused, including the plan source, the review state, an escape
      // through a parent segment, and an escape through a link.
      expect((await fetch(`${url}/notes.md`)).status).toBe(404);
      expect((await fetch(`${url}/plan.mdx`)).status).toBe(404);
      expect((await fetch(`${url}/.big-plan/review/session.png`)).status).toBe(
        404,
      );
      expect(
        (await fetch(`${url}/assets/%2e%2e/%2e%2e/escape.png`)).status,
      ).toBe(404);
      await symlink(
        join(directory, "inside", "linked-target.png"),
        join(directory, "assets", "linked.png"),
      );
      expect((await fetch(`${url}/assets/linked.png`)).status).toBe(200);
      await symlink(
        join(directory, "notes.md"),
        join(directory, "assets", "notes.png"),
      );
      expect((await fetch(`${url}/assets/notes.png`)).status).toBe(404);
      const protectedPicture = join(
        review.store.reviewDirectory,
        "protected.png",
      );
      await writeFile(protectedPicture, TINY_PNG);
      await symlink(
        protectedPicture,
        join(directory, "assets", "protected.png"),
      );
      expect((await fetch(`${url}/assets/protected.png`)).status).toBe(404);
      await symlink(outside, join(directory, "assets", "elsewhere"));
      // The link resolves on disk, so only the containment check can refuse it.
      await expect(
        readFile(join(directory, "assets", "elsewhere", "secret.png")),
      ).resolves.toBeDefined();
      expect((await fetch(`${url}/assets/elsewhere/secret.png`)).status).toBe(
        404,
      );
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("should refuse oversized and non-regular plan pictures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-plan-picture-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    await writeFile(
      join(directory, "oversized.png"),
      new Uint8Array(MAX_IMAGE_BYTES + 1),
    );
    await mkdir(join(directory, "directory.png"));
    const review = await startReviewRuntime({ planPath });
    const url = review.url.replace(/\/$/u, "");
    try {
      expect((await fetch(`${url}/oversized.png`)).status).toBe(404);
      expect((await fetch(`${url}/directory.png`)).status).toBe(404);
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
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
          body: { drafts, resolvedCommentIds: [] },
        })
      ).status,
    ).toBe(200);
    const answer: unknown = await (await call({ path: "/api/drafts" })).json();
    expect(answer).toMatchObject({ drafts: [{ id: "aabbccdd" }] });
  });

  it("should hold an anchored draft alongside state another vintage left behind", async () => {
    await fetch(runtime.url);
    // A reviewer resuming a review that an earlier runtime persisted: the
    // browser still names a whole-plan composer field, and the file that
    // backed it is still on disk. Both are state this runtime does not own,
    // and neither may cost the reviewer an anchored comment.
    await writeFile(
      join(runtime.store.reviewDirectory, "active-draft.json"),
      '"Text no composer will ever read back."\n',
    );
    const drafts = [
      {
        id: "dd44ee55",
        body: "Anchored, unsent, and not the composer's business.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "block", blockId },
      },
    ];
    expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: {
            drafts,
            activeDraft: "Text no composer will ever read back.",
            resolvedCommentIds: [],
          },
        })
      ).status,
    ).toBe(200);
    const snapshot: unknown = await (
      await call({ path: "/api/drafts" })
    ).json();
    expect(snapshot).toMatchObject({ drafts: [{ id: "dd44ee55" }] });
    expect(snapshot).not.toHaveProperty("activeDraft");
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
          body: { drafts, resolvedCommentIds: [] },
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
          body: { drafts, resolvedCommentIds: [] },
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
    expect(
      nextPendingAgentRequest(exchange, {
        claimedBy: runtime.sessionId,
        nowMs: Date.now(),
      }),
    ).toMatchObject({
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
      const isolatedToken = await readSessionToken(isolated);
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
        activeSessionId: isolated.sessionId,
        requestId: created.requestId,
        claimedBy: isolated.sessionId,
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

  it("should never create an agent request without its feedback package", async () => {
    // The queue must not learn about work whose package the reviewer's own
    // record does not yet hold. Package and snapshot are written before the
    // request, so a failure there leaves nothing half-created for an agent to
    // pick up. This pins that order against a future reshuffle.
    const directory = await mkdtemp(join(tmpdir(), "big-plan-package-first-"));
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

      // Blocks the package write the way the resume test blocks the sent
      // comments: the directory cannot hold the files the package needs.
      await rm(isolated.store.feedbackDirectory, {
        recursive: true,
        force: true,
      });
      await writeFile(isolated.store.feedbackDirectory, "not a directory");

      const sent = await fetch(`${isolated.url}api/feedback`, {
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
              id: "ab12cd34",
              body: "This must not reach the queue without its package.",
              premiseSnapshot: PLAN_SNAPSHOT,
              target: { type: "document" },
            },
          ],
        }),
      });
      expect(sent.status).toBe(500);

      const exchange = await readAgentExchange({
        store: isolated.store,
        sessionId: isolated.sessionId,
        planId: isolated.planId,
      });
      expect(
        exchange.requests.filter(
          (request) =>
            request.kind === "feedback" &&
            request.comments.some((comment) => comment.id === "ab12cd34"),
        ),
      ).toHaveLength(0);
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
          body: { drafts: [], resolvedCommentIds: [] },
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
    expect(httpEndpoint).toBeDefined();
    expect(httpEndpoint?.oldHtml).toBeUndefined();
    expect(httpEndpoint?.newHtml).toBeUndefined();
    const httpEndpointField = value.locations.find(
      (location) => location.kind === "http-endpoint-field",
    );
    expect(httpEndpointField).toBeDefined();
    expect(httpEndpointField?.oldHtml).toBeUndefined();
    expect(httpEndpointField?.newHtml).toBeUndefined();
    expect(quickSummary).toBeDefined();
    expect(quickSummary?.oldHtml).toBeUndefined();
    expect(quickSummary?.newHtml).toBeUndefined();
    expect(quickSummaryFacet).toBeDefined();
    expect(quickSummaryFacet?.oldHtml).toBeUndefined();
    expect(quickSummaryFacet?.newHtml).toBeUndefined();
    // This case compiles both snapshots through every first-class component,
    // including the Mermaid renderer, so it needs the same headroom the
    // renderer's own suites take rather than the default per-test timeout.
  }, 15000);

  it("should carry both pictures when a snapshot swaps one", async () => {
    const before = `# Pictures

## Evidence

![Retry dashboard](./assets/before.png)

The dashboard shows the retry backlog.
`;
    const after = before
      .replace("./assets/before.png", "./assets/after.png")
      .replace("retry backlog", "retry backlog and its age");
    const from = deriveSnapshotDigest(before);
    const to = deriveSnapshotDigest(after);
    await writeSnapshot({
      store: runtime.store,
      snapshot: from,
      source: before,
    });
    await writeSnapshot({ store: runtime.store, snapshot: to, source: after });

    const response = await call({
      path: `/api/snapshot-diff?from=${from}&to=${to}`,
    });
    const value = (await response.json()) as {
      readonly locations: ReadonlyArray<{
        readonly kind: string;
        readonly oldHtml?: string;
        readonly newHtml?: string;
      }>;
      readonly places: ReadonlyArray<{ readonly note: string }>;
    };
    const picture = value.locations.find(
      (location) => location.kind === "image",
    );
    // A picture carries no words, so its compiled markup is the only evidence
    // the lens can show the reviewer.
    expect(picture?.oldHtml).toContain("./assets/before.png");
    expect(picture?.newHtml).toContain("./assets/after.png");
    expect(picture?.oldHtml).not.toContain("data-block-id");
    expect(value.places.map((place) => place.note)).toContain("replaced");
  });

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
          body: { drafts: [comment], resolvedCommentIds: [] },
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
      const isolatedToken = await readSessionToken(isolated);
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
        activeSessionId: isolated.sessionId,
        requestId: request.requestId,
        claimedBy: isolated.sessionId,
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
      await commitRequestTerminal({
        claimedBy: isolated.sessionId,
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
        now: new Date().toISOString(),
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
      activeSessionId: runtime.sessionId,
      requestId: request.requestId,
      claimedBy: runtime.sessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await commitRequestTerminal({
      claimedBy: runtime.sessionId,
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
      now: new Date().toISOString(),
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

describe("review runtime resolve invariant", () => {
  const commentId = "b7b7b7b7";
  const comment = {
    id: commentId,
    body: "Rewrite the status quo section.",
    premiseSnapshot: PLAN_SNAPSHOT,
    target: { type: "document" as const },
  };

  // Each test owns a runtime, because the assertion is about the durable
  // resolved set the shared runtime's other tests also write.
  const isolatedRuntime = async (prefix: string) => {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const isolated = await startReviewRuntime({ planPath });
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
      method = "GET",
      body,
    }: {
      readonly path: string;
      readonly method?: string;
      readonly body?: unknown;
    }) =>
      fetch(`${isolated.url.replace(/\/$/u, "")}${path}`, {
        method,
        headers: {
          "x-big-plan-review-token": isolatedToken,
          "sec-fetch-site": "same-origin",
          origin: isolated.url.replace(/\/$/u, ""),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const close = async () => {
      await isolated.close();
      await rm(directory, { recursive: true, force: true });
    };
    return { isolated, isolatedCall, close };
  };

  const queuedRequestId = async (isolated: ReviewRuntime): Promise<string> => {
    const exchange = await readAgentExchange({
      store: isolated.store,
      sessionId: isolated.sessionId,
      planId: isolated.planId,
    });
    const request = exchange.requests.find(
      (candidate) =>
        candidate.kind === "feedback" &&
        candidate.comments.some((entry) => entry.id === commentId),
    );
    if (request === undefined) throw new Error("Feedback was not queued");
    return request.requestId;
  };

  const resolveWrite = (
    isolatedCall: (input: {
      readonly path: string;
      readonly method?: string;
      readonly body?: unknown;
    }) => Promise<Response>,
  ) =>
    isolatedCall({
      path: "/api/drafts",
      method: "PUT",
      body: { drafts: [], resolvedCommentIds: [commentId] },
    });

  it("should refuse a drafts write that resolves a comment with a queued message", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-resolve-refuse-",
    );
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: { comments: [comment] },
          })
        ).status,
      ).toBe(200);

      const refusal = await resolveWrite(isolatedCall);
      expect(refusal.status).toBe(409);
      await expect(refusal.json()).resolves.toMatchObject({
        error: expect.stringContaining("waiting for the coding agent"),
      });
      await expect(
        readResolvedCommentIds({
          store: isolated.store,
          validate: validateResolvedCommentIds,
        }),
      ).resolves.toEqual([]);
    } finally {
      await close();
    }
  });

  it("should accept the same write after the request is cancelled", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-resolve-accept-",
    );
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: { comments: [comment] },
          })
        ).status,
      ).toBe(200);
      expect((await resolveWrite(isolatedCall)).status).toBe(409);

      expect(
        (
          await isolatedCall({
            path: "/api/agent-cancel",
            method: "POST",
            body: { requestId: await queuedRequestId(isolated) },
          })
        ).status,
      ).toBe(200);

      expect((await resolveWrite(isolatedCall)).status).toBe(200);
      await expect(
        readResolvedCommentIds({
          store: isolated.store,
          validate: validateResolvedCommentIds,
        }),
      ).resolves.toEqual([commentId]);
    } finally {
      await close();
    }
  });

  it("should keep an already resolved comment resolvable while work is queued", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-resolve-idempotent-",
    );
    try {
      await writeResolvedCommentIds({
        store: isolated.store,
        ids: [commentId],
      });
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: { comments: [comment] },
          })
        ).status,
      ).toBe(200);

      expect((await resolveWrite(isolatedCall)).status).toBe(200);
    } finally {
      await close();
    }
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
      activeSessionId: first.sessionId,
      requestId: oldRequest.requestId,
      claimedBy: first.sessionId,
      baselineSnapshot: oldRevision,
      now: "2026-08-10T12:00:01.000Z",
    });
    await commitRequestTerminal({
      claimedBy: first.sessionId,
      store: first.store,
      response: validateAgentResponseDraft({
        value: { requestId: oldRequest.requestId, message: "The old answer." },
        request: oldClaim,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: oldRevision,
        now: "2026-08-10T12:00:02.000Z",
      }),
      now: "2026-08-10T12:00:02.000Z",
    });
    await first.close();

    const restartedSource = `${PLAN}\nThe source changed while review was stopped.\n`;
    await writeFile(planPath, restartedSource);
    const restarted = await startReviewRuntime({ planPath });
    try {
      const restartedToken = await readSessionToken(restarted);
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
        activeSessionId: restarted.sessionId,
        requestId: newRequest.requestId,
        claimedBy: restarted.sessionId,
        baselineSnapshot: newRequest.premiseSnapshot,
        now: "2026-08-10T12:01:01.000Z",
      });
      const acceptedSource = `${restartedSource}\nThe agent accepted this revision.\n`;
      await writeFile(planPath, acceptedSource);
      await commitRequestTerminal({
        claimedBy: restarted.sessionId,
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
        now: "2026-08-10T12:01:02.000Z",
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
    const firstToken = await readSessionToken(first);
    const stalled = openStalledMutation({
      target: first,
      sessionToken: firstToken,
    });
    await new Promise((settle) => setTimeout(settle, 20));
    const replacement = await startReviewRuntime({ planPath });
    try {
      stalled.request.end('"drafts":[],"resolvedCommentIds":[]}');
      await expect(stalled.status).resolves.toBe(409);
      expect(
        await reviewSessionIsRunning({
          store: replacement.store,
          sessionId: replacement.sessionId,
        }),
      ).toMatchObject({ running: true });
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

  it("should stay open while a page does nothing but poll", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-server-poll-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const idleTimeoutMs = REVIEW_POLL_INTERVAL_MS * 2;
    const polling = await startReviewRuntime({ planPath, idleTimeoutMs });
    const pollingToken = await readSessionToken(polling);
    const poll = () =>
      fetch(`${polling.url}api/session`, {
        headers: { "x-big-plan-review-token": pollingToken },
      });
    try {
      const until = Date.now() + idleTimeoutMs * 2;
      while (Date.now() < until) {
        await expect(poll()).resolves.toMatchObject({ status: 200 });
        await new Promise((settle) =>
          setTimeout(settle, REVIEW_POLL_INTERVAL_MS),
        );
      }
      await expect(poll()).resolves.toMatchObject({ status: 200 });
      await expect(
        reviewSessionIsRunning({
          store: polling.store,
          sessionId: polling.sessionId,
        }),
      ).resolves.toMatchObject({ running: true });
    } finally {
      await polling.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("should publish its lifetime and deadline on the session route", async () => {
    const before = (await (await call({ path: "/api/session" })).json()) as {
      readonly idleTimeoutMs?: unknown;
      readonly expiresAtMs?: unknown;
    };
    expect(before.idleTimeoutMs).toBe(DEFAULT_REVIEW_IDLE_TIMEOUT_MS);
    expect(before.expiresAtMs).toBeGreaterThan(Date.now());
    await new Promise((settle) => setTimeout(settle, 5));
    const after = (await (await call({ path: "/api/session" })).json()) as {
      readonly expiresAtMs?: unknown;
    };
    expect(after.expiresAtMs).toBeGreaterThan(Number(before.expiresAtMs));
  });

  it("should publish no deadline when the idle timeout is disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-server-forever-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const endless = await startReviewRuntime({ planPath, idleTimeoutMs: 0 });
    const endlessToken = await readSessionToken(endless);
    try {
      const response = await fetch(`${endless.url}api/session`, {
        headers: { "x-big-plan-review-token": endlessToken },
      });
      const payload = (await response.json()) as Readonly<
        Record<string, unknown>
      >;
      expect(payload.idleTimeoutMs).toBe(0);
      expect(payload).not.toHaveProperty("expiresAtMs");
    } finally {
      await endless.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should force-close a stalled active request after a short grace period", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-server-stall-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const closing = await startReviewRuntime({ planPath });
    const closingToken = await readSessionToken(closing);
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

// BIG-44: a review session stopped answering writes while it stayed alive and
// kept answering reads. These tests inject the shape that produces it - one
// filesystem read inside a mutation that never returns - and hold the runtime
// to reporting it.
describe("review runtime diagnostics", () => {
  it("should name the in-flight write and keep answering reads when a mutation never settles", async () => {
    const wedged = await startWedgedRuntime("big-plan-server-diagnostics-");
    try {
      const inFlight = await wedged.waitForInFlight();
      expect(inFlight.map((mutation) => mutation.route)).toEqual([
        "PUT /api/drafts",
      ]);

      // The reason this failure is invisible today: every polled route is a
      // GET, and a GET never touches the gate the write is stuck behind.
      const session = await fetch(`${wedged.runtime.url}api/session`, {
        headers: { "x-big-plan-review-token": wedged.token },
      });
      expect(session.status).toBe(200);
      const progress = await fetch(`${wedged.runtime.url}api/progress`, {
        headers: { "x-big-plan-review-token": wedged.token },
      });
      expect(progress.status).toBe(200);
    } finally {
      await wedged.release();
    }
  });

  it("should count the append-only state a long session accumulates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-server-growth-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const counted = await startReviewRuntime({ planPath });
    try {
      for (let index = 0; index < 3; index += 1) {
        await appendProgressEvent({
          store: counted.store,
          event: {
            sessionId: counted.sessionId,
            stepCode: "agent-note",
            step: "Working through the plan",
            state: "live",
          },
        });
      }
      await Promise.all([
        writeFile(
          join(counted.store.agentRequestDirectory, "aaaaaaaaaaaaaaaa.json"),
          "{}\n",
        ),
        writeFile(
          join(counted.store.agentRequestDirectory, "bbbbbbbbbbbbbbbb.json"),
          "{}\n",
        ),
        writeFile(
          join(counted.store.agentResponseDirectory, "cccccccccccccccc.json"),
          "{}\n",
        ),
        mkdir(
          join(counted.store.agentRequestDirectory, ".dddddddddddddddd.lock"),
        ),
        writeFile(
          join(
            counted.store.agentResponseDirectory,
            ".cccccccccccccccc.json.1234.deadbeef.tmp",
          ),
          "{}\n",
        ),
      ]);
      await expect(counted.diagnosticGrowth()).resolves.toEqual({
        progressLines: 3,
        agentRequests: 2,
        agentResponses: 1,
      });
    } finally {
      await counted.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should capture in-flight mutations without reading store growth", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-server-dump-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const captured = await startReviewRuntime({ planPath });
    try {
      await rm(captured.store.progressPath, { force: true });
      execFileSync("mkfifo", [captured.store.progressPath]);
      expect(captured.diagnostics()).toMatchObject({
        sessionId: captured.sessionId,
        inFlight: [],
        stalled: [],
      });
    } finally {
      await rm(captured.store.progressPath, { force: true });
      await captured.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

// The fix BIG-44's evidence names: one mutation that never settles must cost
// its own request, not the session. The bound is shortened here because the
// behavior under test is what happens after it, not how long it is.
describe("review runtime write gate", () => {
  it("should keep serving writes when one mutation never settles", async () => {
    const wedged = await startWedgedRuntime("big-plan-server-gate-", {
      writeStallMs: 300,
    });
    try {
      await expect(wedged.stuck).resolves.toBe(503);

      // The whole fix: the gate hands the next write its turn instead of
      // queueing it behind a mutation that will never settle.
      const answering = wedged.write();
      expect(await wedged.waitForInFlight(2)).toHaveLength(2);

      const answered = await Promise.race([
        answering.then(async (response) => {
          await expect(response.json()).resolves.toEqual({
            error:
              "This review session has stopped accepting changes. Restart the review runtime to continue.",
          });
          return response.status;
        }),
        new Promise<"hung">((settle) =>
          setTimeout(() => settle("hung"), 10_000),
        ),
      ]);
      // It is answered, not served: the abandoned work still holds the store's
      // custody lock until it settles. Which refusal arrives depends on which
      // bound is shorter - here the gate's, in production the store's own
      // two-second lock ceiling - and either way the reviewer gets an answer.
      expect(answered).not.toBe("hung");
      expect(answered).toBe(503);
    } finally {
      await wedged.release();
    }
  }, 20_000);

  it("should report a stalled write on the session route", async () => {
    const wedged = await startWedgedRuntime("big-plan-server-stalled-", {
      writeStallMs: 300,
    });
    try {
      await expect(wedged.stuck).resolves.toBe(503);

      const session: unknown = await fetch(`${wedged.runtime.url}api/session`, {
        headers: { "x-big-plan-review-token": wedged.token },
      }).then((response) => response.json());
      expect(session).toMatchObject({ authoritative: true });
      expect(
        typeof session === "object" &&
          session !== null &&
          "writesStalledMs" in session
          ? session.writesStalledMs
          : undefined,
      ).toBeGreaterThanOrEqual(300);
    } finally {
      await wedged.release();
    }
  }, 20_000);

  it("should keep renewing the session heartbeat while one mutation is stalled", async () => {
    const wedged = await startWedgedRuntime("big-plan-server-hb-", {
      writeStallMs: 300,
    });
    try {
      await expect(wedged.stuck).resolves.toBe(503);

      // A heartbeat that shares the custody lock with mutations can never
      // renew while one is stuck holding it, so the agent reads a session that
      // is serving requests as stopped. Renewal, not mere freshness, is the
      // fact under test: a beat written before the wedge stays fresh for
      // seconds afterwards.
      const beatAtMs = async (): Promise<number> => {
        const value = await readSessionHeartbeatValue(wedged.runtime.store);
        return typeof value === "object" &&
          value !== null &&
          "updatedAtMs" in value &&
          typeof value.updatedAtMs === "number"
          ? value.updatedAtMs
          : 0;
      };
      const before = await beatAtMs();
      const deadline = Date.now() + 5_000;
      let renewed = before;
      while (renewed <= before && Date.now() < deadline) {
        await new Promise((settle) => setTimeout(settle, 50));
        renewed = await beatAtMs();
      }
      expect(renewed).toBeGreaterThan(before);
      await expect(
        reviewSessionIsRunning({
          store: wedged.runtime.store,
          sessionId: wedged.runtime.sessionId,
        }),
      ).resolves.toMatchObject({ running: true });
    } finally {
      await wedged.release();
    }
  }, 20_000);
});

// A message sent while the agent is busy is the reported loss in BIG-84: it
// must survive the wait, stay editable, and still be deliverable afterwards.
describe("review runtime queued messages", () => {
  let queued: ReviewRuntime;
  let queuedToken: string;
  let queuedDirectory: string;

  beforeAll(async () => {
    queuedDirectory = await mkdtemp(join(tmpdir(), "big-plan-queued-"));
    const planPath = join(queuedDirectory, "plan.mdx");
    await writeFile(planPath, PLAN);
    queued = await startReviewRuntime({ planPath });
    const descriptor: unknown = JSON.parse(
      await readFile(queued.store.sessionPath, "utf8"),
    );
    queuedToken =
      typeof descriptor === "object" &&
      descriptor !== null &&
      "token" in descriptor &&
      typeof descriptor.token === "string"
        ? descriptor.token
        : "";
  });

  afterAll(async () => {
    await queued.close();
    await rm(queuedDirectory, { recursive: true, force: true });
  });

  const ask = ({
    path,
    body,
  }: {
    readonly path: string;
    readonly body: unknown;
  }) =>
    fetch(`${queued.url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-big-plan-review-token": queuedToken,
        "sec-fetch-site": "same-origin",
        origin: queued.url.replace(/\/$/, ""),
      },
      body: JSON.stringify(body),
    });

  const sendChat = async (body: string): Promise<string> => {
    const response = await ask({
      path: "/api/agent-requests",
      body: { kind: "chat", body },
    });
    expect(response.status).toBe(200);
    const answer: unknown = await response.json();
    if (
      typeof answer !== "object" ||
      answer === null ||
      !("requestId" in answer) ||
      typeof answer.requestId !== "string"
    ) {
      throw new Error("The runtime did not return a request id");
    }
    return answer.requestId;
  };

  const exchangeNow = () =>
    readAgentExchange({
      store: queued.store,
      sessionId: queued.sessionId,
      planId: queued.planId,
    });

  const storedRequest = async (requestId: string) => {
    const exchange = await exchangeNow();
    return exchange.requests.find((request) => request.requestId === requestId);
  };

  it("should queue and deliver a message sent while a request is claimed", async () => {
    const firstId = await sendChat("What drives the retry boundary?");
    const first = await storedRequest(firstId);
    if (first === undefined) throw new Error("The first message was lost");
    const claimed = await claimAgentRequest({
      store: queued.store,
      activeSessionId: queued.sessionId,
      requestId: firstId,
      claimedBy: queued.sessionId,
      baselineSnapshot: first.premiseSnapshot,
      now: new Date().toISOString(),
    });

    const secondId = await sendChat("And what happens on the third retry?");

    const busy = await exchangeNow();
    expect(
      busy.requests.find((request) => request.requestId === secondId),
    ).toMatchObject({
      kind: "chat",
      body: "And what happens on the third retry?",
    });
    expect(
      nextPendingAgentRequest(busy, {
        claimedBy: queued.sessionId,
        nowMs: Date.now(),
      }),
    ).toBeUndefined();

    await commitRequestTerminal({
      store: queued.store,
      response: validateAgentResponseDraft({
        value: { requestId: firstId, message: "Three attempts, then stop." },
        request: claimed,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: claimed.premiseSnapshot,
        now: new Date().toISOString(),
      }),
      claimedBy: queued.sessionId,
      now: new Date().toISOString(),
    });

    expect(
      nextPendingAgentRequest(await exchangeNow(), {
        claimedBy: queued.sessionId,
        nowMs: Date.now(),
      })?.requestId,
    ).toBe(secondId);
  });

  it("should revise a queued message without creating another one", async () => {
    const requestId = await sendChat("Waht is the retry boundary?");
    const before = (await exchangeNow()).requests.length;

    const response = await ask({
      path: "/api/agent-requests",
      body: { kind: "chat", requestId, body: "What is the retry boundary?" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId,
      request: { requestId, body: "What is the retry boundary?" },
    });
    const after = await exchangeNow();
    expect(after.requests).toHaveLength(before);
    expect(
      after.requests.find((request) => request.requestId === requestId),
    ).toMatchObject({ body: "What is the retry boundary?" });
    const events = await readProgress({
      store: queued.store,
      sessionId: queued.sessionId,
    });
    expect(events.at(-1)).toMatchObject({
      stepCode: "queued-message-revised",
      requestId,
      state: "waiting",
    });
  });

  it("should refuse to revise a message the agent already started", async () => {
    const requestId = await sendChat("Waht about the timeout?");
    const request = await storedRequest(requestId);
    if (request === undefined) throw new Error("The message was lost");
    const expiredClaimAt = Date.now() - 100_000;
    const claimed = await claimAgentRequest({
      store: queued.store,
      activeSessionId: queued.sessionId,
      requestId,
      claimedBy: queued.sessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: new Date(expiredClaimAt).toISOString(),
      clock: () => expiredClaimAt,
    });

    const response = await ask({
      path: "/api/agent-requests",
      body: { kind: "chat", requestId, body: "What about the timeout?" },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "The agent already started on this message",
    });
    expect(await storedRequest(requestId)).toMatchObject({
      body: "Waht about the timeout?",
    });
    await commitRequestTerminal({
      store: queued.store,
      response: validateAgentResponseDraft({
        value: { requestId, message: "Answered after revision was refused." },
        request: claimed,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: claimed.premiseSnapshot,
        now: new Date(expiredClaimAt + 1).toISOString(),
      }),
      claimedBy: queued.sessionId,
      now: new Date(expiredClaimAt + 1).toISOString(),
      clock: () => expiredClaimAt + 1,
    });
  });

  it("should refuse to revise a message this session never stored", async () => {
    const response = await ask({
      path: "/api/agent-requests",
      body: {
        kind: "chat",
        requestId: "abcdefabcdefabcd",
        body: "Revise a message that does not exist.",
      },
    });

    expect(response.status).toBe(404);
  });

  it("should delete a queued message", async () => {
    const requestId = await sendChat("Never mind this question.");

    const response = await ask({
      path: "/api/agent-request-delete",
      body: { requestId },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ requestId });
    expect(await storedRequest(requestId)).toBeUndefined();
  });

  it("should report cleanup failure without failing a committed deletion", async () => {
    const requestId = await sendChat("Delete even if cleanup fails.");
    const attachmentsDirectory = queued.store.requestAttachmentsDirectory;
    const displacedDirectory = `${attachmentsDirectory}.displaced`;
    await rename(attachmentsDirectory, displacedDirectory);
    await writeFile(attachmentsDirectory, "Blocks attachment cleanup.");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const response = await ask({
        path: "/api/agent-request-delete",
        body: { requestId },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ requestId });
      expect(await storedRequest(requestId)).toBeUndefined();
      await expect(readdir(displacedDirectory)).resolves.toContain(requestId);
      expect(
        stderr.mock.calls.map(([chunk]) => String(chunk)).join(""),
      ).toContain(
        `Review attachment cleanup failed after deleting request ${requestId}`,
      );
    } finally {
      stderr.mockRestore();
      await rm(attachmentsDirectory, { force: true });
      await rename(displacedDirectory, attachmentsDirectory);
    }
  });

  it("should refuse attachment cleanup through a symlinked store directory", async () => {
    const requestId = await sendChat("Keep outside files during cleanup.");
    const attachmentsDirectory = queued.store.requestAttachmentsDirectory;
    const displacedDirectory = `${attachmentsDirectory}.symlink-displaced`;
    const outsideDirectory = join(
      queuedDirectory,
      `outside-attachments-${requestId}`,
    );
    const outsideRequestDirectory = join(outsideDirectory, requestId);
    const sentinelPath = join(outsideRequestDirectory, "keep.txt");
    await rename(attachmentsDirectory, displacedDirectory);
    await mkdir(outsideRequestDirectory, { recursive: true });
    await writeFile(sentinelPath, "Keep this file.");
    await symlink(outsideDirectory, attachmentsDirectory, "dir");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const response = await ask({
        path: "/api/agent-request-delete",
        body: { requestId },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ requestId });
      expect(await storedRequest(requestId)).toBeUndefined();
      await expect(readFile(sentinelPath, "utf8")).resolves.toBe(
        "Keep this file.",
      );
      expect(
        stderr.mock.calls.map(([chunk]) => String(chunk)).join(""),
      ).toContain(
        `Review attachment cleanup failed after deleting request ${requestId}`,
      );
    } finally {
      stderr.mockRestore();
      await rm(attachmentsDirectory, { force: true });
      await rename(displacedDirectory, attachmentsDirectory);
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("should report progress failures without failing committed queue mutations", async () => {
    const revisedId = await sendChat("Waht is the retry boundary?");
    const deletedId = await sendChat("Delete after committing.");
    const canceledId = await sendChat("Cancel after committing.");
    const progress = await readFile(queued.store.progressPath, "utf8");
    await rm(queued.store.progressPath);
    await mkdir(queued.store.progressPath);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const revised = await ask({
        path: "/api/agent-requests",
        body: {
          kind: "chat",
          requestId: revisedId,
          body: "What is the retry boundary?",
        },
      });
      const deleted = await ask({
        path: "/api/agent-request-delete",
        body: { requestId: deletedId },
      });
      const canceled = await ask({
        path: "/api/agent-cancel",
        body: { requestId: canceledId },
      });
      const queuedId = await sendChat("Queue despite progress failure.");

      expect(revised.status).toBe(200);
      expect(deleted.status).toBe(200);
      expect(canceled.status).toBe(200);
      expect(await storedRequest(revisedId)).toMatchObject({
        body: "What is the retry boundary?",
      });
      expect(await storedRequest(deletedId)).toBeUndefined();
      expect(await storedRequest(canceledId)).toMatchObject({
        canceledAt: expect.any(String),
      });
      expect(await storedRequest(queuedId)).toMatchObject({
        body: "Queue despite progress failure.",
      });
      const diagnostics = stderr.mock.calls
        .map(([chunk]) => String(chunk))
        .join("");
      for (const message of [
        `Review progress update failed after revising request ${revisedId}`,
        `Review progress update failed after deleting request ${deletedId}`,
        `Review progress update failed after canceling request ${canceledId}`,
        `Review progress update failed after queuing request ${queuedId}`,
      ]) {
        expect(diagnostics).toContain(message);
      }
    } finally {
      stderr.mockRestore();
      await rm(queued.store.progressPath, { recursive: true, force: true });
      await writeFile(queued.store.progressPath, progress);
    }
  });

  it("should refuse to delete a message the agent already started", async () => {
    const requestId = await sendChat("Keep this one after all.");
    const request = await storedRequest(requestId);
    if (request === undefined) throw new Error("The message was lost");
    const expiredClaimAt = Date.now() - 100_000;
    await claimAgentRequest({
      store: queued.store,
      activeSessionId: queued.sessionId,
      requestId,
      claimedBy: queued.sessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: new Date(expiredClaimAt).toISOString(),
      clock: () => expiredClaimAt,
    });

    const response = await ask({
      path: "/api/agent-request-delete",
      body: { requestId },
    });

    expect(response.status).toBe(409);
    expect(await storedRequest(requestId)).toMatchObject({
      body: "Keep this one after all.",
    });
  });
});
