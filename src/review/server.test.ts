// Covers review-runtime route behavior against a real listening server,
// including security refusals and durable request-lifecycle invariants.

import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deriveDecisionInventory } from "./decision-inventory.js";
import {
  commentsFromExchange,
  deriveSnapshotDigest,
  messageAgentRequest,
  nextPendingAgentRequest,
  outstandingAgentRequests,
  readAgentCommentHistory,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "./agent-exchange.js";
import {
  appendProgressEvent,
  claimAgentRequest,
  commitRequestTerminal,
  withResolvedCommentLock,
} from "./request-mailbox.js";
import { recordCommittedRevision } from "./change-set-commit.js";
import { recoverApprovalFinalization } from "./approval-finalization.js";
import {
  decodeCommittedChangeSets,
  type CommittedChangeSetState,
} from "./shared/review-wire.js";
import {
  agentMutationJournalPath,
  readAgentConnectionEvents,
  readAgentDisconnectRequestFor,
  readAgentDisconnectRequests,
  readAgentPresence,
  writeAgentHeartbeat,
  writeAgentHeartbeatEnded,
  writeAgentResponseValue,
  writeStoreJson,
  withReviewStoreLock,
} from "./store.js";
import {
  prepareReviewImageAssets,
  publishPreparedPlanAssets,
} from "./plan-assets.js";
import {
  binaryTransportHeaders,
  DEFAULT_REVIEW_IDLE_TIMEOUT_MS,
  startReviewRuntime,
} from "./server.js";
import { runAgentWorkLoopAction } from "./agent-work-loop.js";
import type { ReviewRuntime } from "./server.js";
import { servicePort } from "./service/paths.js";
import {
  reviewSessionIsRunning,
  stopReviewSessionIfInactive,
} from "./session-authority.js";
import type { ReviewComment } from "./shared/comment.js";
import { validateResolvedCommentIds } from "./shared/comment.js";
import {
  AGENT_RECOVERY_HORIZON_MS,
  AGENT_STALL_MS,
} from "./shared/agent-timing.js";
import { AGENT_NO_SIGNAL_REASON } from "./shared/agent-status.js";
import { AGENT_DISCONNECTED_REASON } from "./shared/agent-disconnect.js";
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

const runtimeToken = async (target: ReviewRuntime): Promise<string> => {
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

const callRuntime = ({
  target,
  sessionToken,
  path,
  method = "GET",
  body,
}: {
  readonly target: ReviewRuntime;
  readonly sessionToken: string;
  readonly path: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
}): Promise<Response> =>
  fetch(`${target.url.replace(/\/$/u, "")}${path}`, {
    method,
    headers: {
      "x-big-plan-review-token": sessionToken,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const PLAN = `# Review runtime plan

The runtime serves this document and nothing else.

## Status quo

Today's reality is that feedback does not reach the agent.
`;
const PLAN_SNAPSHOT = deriveSnapshotDigest(PLAN);

// The answers routes are about a plan that asks something, so they get their
// own source. The ids below are the compiler's, spelled out rather than
// recomputed, because their stability is part of what these tests assert.
const DECISION_PLAN = `# Review runtime decisions

Choose the release path before implementation begins.

<Decision question="Which release path should we use?">

<Option title="Gradual rollout" recommended summary="Start with one group.">
<Consideration label="Risk" verdict="Low" tone="good" />
</Option>

<Option title="Immediate rollout" summary="Release everywhere together.">
<Consideration label="Risk" verdict="High" tone="bad" />
</Option>

</Decision>

## Rollback

The rollback runbook stays unchanged.
`;
const DECISION_ID = "decision-which-release-path-should-we-use";
const GRADUAL_OPTION_ID = `${DECISION_ID}-option-gradual-rollout`;
const IMMEDIATE_OPTION_ID = `${DECISION_ID}-option-immediate-rollout`;

const answersOf = async (
  response: Response,
): Promise<{
  readonly answers: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly revision: number;
}> => {
  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    !("answers" in value) ||
    !Array.isArray(value.answers) ||
    !("revision" in value) ||
    typeof value.revision !== "number"
  ) {
    throw new Error("Answers response did not carry answers and a revision");
  }
  return {
    answers: value.answers as ReadonlyArray<Readonly<Record<string, unknown>>>,
    revision: value.revision,
  };
};

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

const call = async ({
  path,
  method = "GET",
  headers = {},
  body,
  prepareReviewState = true,
}: {
  readonly path: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly prepareReviewState?: boolean;
}) => {
  const needsReviewStateVersion =
    prepareReviewState &&
    (path === "/api/feedback" || path === "/api/comments-delete") &&
    typeof body === "object" &&
    body !== null &&
    !("version" in body);
  const requestBody = needsReviewStateVersion
    ? { ...body, version: await draftsVersionOf(runtime, token) }
    : body;
  return fetch(`${runtime.url.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      "x-big-plan-review-token": token,
      "sec-fetch-site": "same-origin",
      origin: runtime.url.replace(/\/$/, ""),
      ...(requestBody === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...headers,
    },
    ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
  });
};

/** Reads the conditional-write version any runtime is currently at. */
const draftsVersionOf = async (
  target: ReviewRuntime,
  sessionToken: string,
): Promise<string> => {
  const answer: unknown = await (
    await fetch(`${target.url}api/drafts`, {
      headers: { "x-big-plan-review-token": sessionToken },
    })
  ).json();
  const version =
    typeof answer === "object" && answer !== null
      ? (answer as { readonly version?: unknown }).version
      : undefined;
  if (typeof version !== "string" || version === "") {
    throw new Error("The drafts snapshot carried no version");
  }
  return version;
};

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

/** The version a conditional drafts write must carry to be accepted. */
const draftsVersion = async (): Promise<string> =>
  draftsVersionOf(runtime, token);

type IsolatedCall = (input: {
  readonly path: string;
  readonly method?: string;
  readonly body?: unknown;
}) => Promise<Response>;

/** Reads the version an isolated runtime's next reviewer-state write needs. */
const isolatedReviewStateVersion = async (
  isolatedCall: IsolatedCall,
): Promise<string> => {
  const snapshot: unknown = await (
    await isolatedCall({ path: "/api/drafts" })
  ).json();
  const version =
    typeof snapshot === "object" && snapshot !== null
      ? (snapshot as { readonly version?: unknown }).version
      : undefined;
  if (typeof version !== "string" || version === "") {
    throw new Error("The drafts snapshot carried no version");
  }
  return version;
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

/** How many listening sockets this process currently holds open. */
const listeningSockets = (): number =>
  process.getActiveResourcesInfo().filter((name) => name === "TCPServerWrap")
    .length;

/** Waits for closed listeners to leave the loop, then reports what is left. */
const settledListeningSockets = async (limit: number): Promise<number> => {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const count = listeningSockets();
    if (count <= limit || Date.now() > deadline) return count;
    await new Promise((settle) => setTimeout(settle, 20));
  }
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
  // The version a conditional write must carry is read before the drafts file
  // becomes a FIFO, because reading it afterwards is what wedges.
  const wedgedVersion = await draftsVersionOf(wedged, wedgedToken);
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
      body: JSON.stringify({
        drafts: [],
        resolvedCommentIds: [],
        version: wedgedVersion,
      }),
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
    /** Unblocks the FIFO reads, then stops the runtime and removes the plan. */
    release: async () => {
      // The wedged mutation reads the drafts file more than once - the
      // conditional-write version check, then validation - and its request may
      // already have been refused at the gate while that work keeps running
      // and holding the store's custody lock. So the FIFO is fed until the
      // runtime replaces it with a real file, which is the moment the wedged
      // work is past its reads; feeding after that would write into the store.
      // O_NONBLOCK refuses with ENXIO when no reader is waiting, so a test that
      // failed before wedging anything cannot hang here.
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const path = await stat(wedged.store.draftsPath).catch(() => undefined);
        if (path?.isFIFO() !== true) break;
        const handle = await open(
          wedged.store.draftsPath,
          constants.O_WRONLY | constants.O_NONBLOCK,
        ).catch(() => undefined);
        if (handle !== undefined) {
          await handle.write("[]");
          await handle.close();
        }
        await new Promise((settle) => setTimeout(settle, 20));
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

  it("should close its listening socket when session activation fails", async () => {
    // The socket is already bound when the session descriptor is written, so a
    // failed activation used to leave an orphan listener behind for the life
    // of the process while the caller saw only the error.
    const directory = await mkdtemp(join(tmpdir(), "big-plan-orphan-socket-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    // The baseline is taken before the probe binds anything, so the probe's own
    // listener can never be counted into it. A baseline read afterwards could
    // still include it, and that listener leaving later would offset a leaked
    // one and let this regression test pass.
    const before = listeningSockets();
    const probe = await startReviewRuntime({ planPath });
    const sessionPath = probe.store.sessionPath;
    await probe.close();
    // A directory in place of the descriptor is a write this runtime cannot do.
    await rm(sessionPath, { force: true });
    await mkdir(sessionPath);
    expect(await settledListeningSockets(before)).toBe(before);
    await expect(startReviewRuntime({ planPath })).rejects.toThrow();
    expect(await settledListeningSockets(before)).toBe(before);
    await rm(directory, { recursive: true, force: true });
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

  it("should admit the service hop's addresses and no other name for itself", async () => {
    // The hop forwards the browser's Host untouched, so a page opened at
    // either address the service answers on arrives here under that name and
    // has to be accepted. Which port that is has to be resolved the same way
    // the runtime resolved it, because `BIG_PLAN_PORT` moves the service and
    // the default is only where it sits when nothing moved it. The premise of
    // the rest of this test is that the two ports differ; an ephemeral port is
    // never the service's configured one.
    const hopPort = servicePort();
    expect(runtime.port).not.toBe(hopPort);
    expect(
      await rawStatus({
        path: "/api/session",
        host: `127.0.0.1:${hopPort}`,
      }),
    ).toBe(200);
    expect(
      await rawStatus({
        path: "/api/session",
        host: `localhost:${hopPort}`,
      }),
    ).toBe(200);
    // Widening for the hop must not widen anything else: nothing publishes
    // this session under `localhost`, so that name stays refused.
    expect(
      await rawStatus({
        path: "/api/session",
        host: `localhost:${runtime.port}`,
      }),
    ).toBe(403);
  });

  it("should accept the service's origins and no other name for itself", async () => {
    const hopPort = servicePort();
    for (const origin of [
      `http://127.0.0.1:${hopPort}`,
      `http://localhost:${hopPort}`,
      `http://127.0.0.1:${runtime.port}`,
    ]) {
      expect(
        (await call({ path: "/api/session", headers: { origin } })).status,
      ).toBe(200);
    }
    expect(
      (
        await call({
          path: "/api/session",
          headers: { origin: `http://localhost:${runtime.port}` },
        })
      ).status,
    ).toBe(403);
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

describe("review runtime binary transport headers", () => {
  it("should keep a route from turning off a transport guarantee", () => {
    expect(
      binaryTransportHeaders({
        contentType: "text/markdown; charset=utf-8",
        headers: {
          "content-disposition": 'attachment; filename="plan.md"',
          "content-type": "text/html",
          "x-content-type-options": "off",
          "cache-control": "public, max-age=31536000",
          "referrer-policy": "unsafe-url",
        },
      }),
    ).toMatchObject({
      "content-disposition": 'attachment; filename="plan.md"',
      "content-type": "text/markdown; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
  });
});

describe("review runtime Markdown export", () => {
  it("should require the live token and return attachment snapshot metadata", async () => {
    const refused = await call({
      path: "/api/export-markdown",
      headers: { "x-big-plan-review-token": "not-the-token" },
    });
    expect(refused.status).toBe(401);

    const response = await call({ path: "/api/export-markdown" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="plan.md"',
    );
    expect(response.headers.get("x-big-plan-snapshot")).toBe(PLAN_SNAPSHOT);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const markdown = await response.text();
    expect(markdown).toContain("# Review runtime plan");
    expect(markdown).toContain(`> Exported plan version: \`${PLAN_SNAPSHOT}\``);
    expect(markdown).toContain("## Review overlay");
  });

  it("should read the committed source when the request arrives", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-export-latest-"));
    const planPath = join(directory, "Latest saved plan.mdx");
    await writeFile(planPath, "# Before confirmation\n\nOld content.\n");
    const target = await startReviewRuntime({ planPath });
    try {
      const sessionToken = await runtimeToken(target);
      const latest =
        "# After confirmation\n\nThe committed change is visible.\n";
      await writeFile(planPath, latest);

      const response = await callRuntime({
        target,
        sessionToken,
        path: "/api/export-markdown",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toBe(
        'attachment; filename="Latest-saved-plan.md"',
      );
      expect(response.headers.get("x-big-plan-snapshot")).toBe(
        deriveSnapshotDigest(latest),
      );
      const markdown = await response.text();
      expect(markdown).toContain("# After confirmation");
      expect(markdown).not.toContain("Old content");
    } finally {
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should report invalid authoritative source without downloading a file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-export-invalid-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Initially valid\n");
    const target = await startReviewRuntime({ planPath });
    try {
      const sessionToken = await runtimeToken(target);
      await writeFile(planPath, "# Invalid\n\n<UnknownComponent />\n");
      const response = await callRuntime({
        target,
        sessionToken,
        path: "/api/export-markdown",
      });
      expect(response.status).toBe(500);
      expect(response.headers.get("content-disposition")).toBeNull();
    } finally {
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should remain available from a replaced read-only session", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-export-readonly-"),
    );
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const first = await startReviewRuntime({ planPath });
    const firstToken = await runtimeToken(first);
    const replacement = await startReviewRuntime({ planPath, takeover: true });
    try {
      const response = await callRuntime({
        target: first,
        sessionToken: firstToken,
        path: "/api/export-markdown",
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("# Review runtime plan");
    } finally {
      await Promise.all([first.close(), replacement.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("review runtime staged decision answers", () => {
  const stageGradual = (target: ReviewRuntime, sessionToken: string) =>
    callRuntime({
      target,
      sessionToken,
      path: "/api/inputs",
      method: "POST",
      body: {
        op: "stage",
        answer: {
          decisionId: DECISION_ID,
          optionId: GRADUAL_OPTION_ID,
          optionTitle: "Gradual rollout",
          prompt: "Which release path should we use?",
          premiseSnapshot: deriveSnapshotDigest(DECISION_PLAN),
        },
      },
    });

  const withDecisionRuntime = async (
    work: (context: {
      readonly target: ReviewRuntime;
      readonly sessionToken: string;
      readonly planPath: string;
    }) => Promise<void>,
  ): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-inputs-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, DECISION_PLAN);
    const target = await startReviewRuntime({ planPath });
    try {
      await work({
        target,
        sessionToken: await runtimeToken(target),
        planPath,
      });
    } finally {
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  };

  it("should stage, replace, retract, and read back one answer per decision", async () => {
    await withDecisionRuntime(async ({ target, sessionToken }) => {
      expect((await stageGradual(target, sessionToken)).status).toBe(200);
      const replaced = await callRuntime({
        target,
        sessionToken,
        path: "/api/inputs",
        method: "POST",
        body: {
          op: "stage",
          answer: {
            decisionId: DECISION_ID,
            optionId: IMMEDIATE_OPTION_ID,
            optionTitle: "Immediate rollout",
            prompt: "Which release path should we use?",
            premiseSnapshot: deriveSnapshotDigest(DECISION_PLAN),
          },
        },
      });
      expect(replaced.status).toBe(200);

      const staged = await callRuntime({
        target,
        sessionToken,
        path: "/api/review-state",
      });
      await expect(staged.json()).resolves.toMatchObject({
        answers: [
          {
            decisionId: DECISION_ID,
            optionId: IMMEDIATE_OPTION_ID,
            optionTitle: "Immediate rollout",
          },
        ],
      });

      expect(
        (
          await callRuntime({
            target,
            sessionToken,
            path: "/api/inputs",
            method: "POST",
            body: { op: "retract", decisionId: DECISION_ID },
          })
        ).status,
      ).toBe(200);
      const retracted = await callRuntime({
        target,
        sessionToken,
        path: "/api/review-state",
      });
      await expect(retracted.json()).resolves.toMatchObject({ answers: [] });
    });
  });

  it("should advance one revision per accepted write and carry it on every response", async () => {
    await withDecisionRuntime(async ({ target, sessionToken }) => {
      const initial = await answersOf(
        await callRuntime({ target, sessionToken, path: "/api/review-state" }),
      );
      const staged = await answersOf(await stageGradual(target, sessionToken));
      const read = await answersOf(
        await callRuntime({ target, sessionToken, path: "/api/review-state" }),
      );
      const retracted = await answersOf(
        await callRuntime({
          target,
          sessionToken,
          path: "/api/inputs",
          method: "POST",
          body: { op: "retract", decisionId: DECISION_ID },
        }),
      );

      expect(staged.revision).toBe(initial.revision + 1);
      expect(read.revision).toBe(staged.revision);
      expect(retracted.revision).toBe(staged.revision + 1);
    });
  });

  it("should refuse ids the compiled plan does not ask for", async () => {
    await withDecisionRuntime(async ({ target, sessionToken }) => {
      const unknownDecision = await callRuntime({
        target,
        sessionToken,
        path: "/api/inputs",
        method: "POST",
        body: {
          op: "stage",
          answer: {
            decisionId: "decision-reworded-release-path",
            optionId: "decision-reworded-release-path-option-gradual",
            optionTitle: "Gradual rollout",
            prompt: "Which release path should we use?",
            premiseSnapshot: deriveSnapshotDigest(DECISION_PLAN),
          },
        },
      });
      expect(unknownDecision.status).toBe(400);
      await expect(unknownDecision.json()).resolves.toMatchObject({
        error: expect.stringContaining("not a decision in the current plan"),
      });

      const unknownOption = await callRuntime({
        target,
        sessionToken,
        path: "/api/inputs",
        method: "POST",
        body: {
          op: "stage",
          answer: {
            decisionId: DECISION_ID,
            optionId: `${DECISION_ID}-option-no-rollout`,
            optionTitle: "No rollout",
            prompt: "Which release path should we use?",
            premiseSnapshot: deriveSnapshotDigest(DECISION_PLAN),
          },
        },
      });
      expect(unknownOption.status).toBe(400);

      const unknownRetraction = await callRuntime({
        target,
        sessionToken,
        path: "/api/inputs",
        method: "POST",
        body: { op: "retract", decisionId: "decision-reworded-release-path" },
      });
      expect(unknownRetraction.status).toBe(400);
    });
  });

  // Membership, not shape: the compiler mints an id as long as the question it
  // came from, and re-guessing that shape here once made a long question
  // unanswerable forever.
  it("should persist compiled decision ids longer than 300 characters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-inputs-long-"));
    const question = `Which ${"release ".repeat(48)}path should we use?`;
    const longPlan = `# Long decision ids

<Decision question="${question}">

<Option title="Gradual rollout" />

<Option title="Immediate rollout" />

</Decision>
`;
    const entry = Array.from(
      deriveDecisionInventory({
        markdown: longPlan,
        fallbackTitle: "Long decision ids",
      }).values(),
    )[0];
    if (entry === undefined) throw new Error("Compiled Decision missing");
    const optionId = Array.from(entry.optionIds).sort()[0];
    if (optionId === undefined) throw new Error("Compiled Option missing");
    expect(entry.decisionId.length).toBeGreaterThan(300);
    expect(optionId.length).toBeGreaterThan(300);

    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, longPlan);
    const target = await startReviewRuntime({ planPath });
    try {
      const sessionToken = await runtimeToken(target);
      const staged = await callRuntime({
        target,
        sessionToken,
        path: "/api/inputs",
        method: "POST",
        body: {
          op: "stage",
          answer: {
            decisionId: entry.decisionId,
            optionId,
            optionTitle: "Gradual rollout",
            prompt: question,
            premiseSnapshot: deriveSnapshotDigest(longPlan),
          },
        },
      });
      expect(staged.status).toBe(200);
      await expect(
        (
          await callRuntime({
            target,
            sessionToken,
            path: "/api/review-state",
          })
        ).json(),
      ).resolves.toMatchObject({
        answers: [{ decisionId: entry.decisionId, optionId }],
      });

      expect(
        (
          await callRuntime({
            target,
            sessionToken,
            path: "/api/inputs",
            method: "POST",
            body: { op: "retract", decisionId: entry.decisionId },
          })
        ).status,
      ).toBe(200);
    } finally {
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should mask an answer whose decision was edited and show it again when the wording returns", async () => {
    await withDecisionRuntime(async ({ target, sessionToken, planPath }) => {
      expect((await stageGradual(target, sessionToken)).status).toBe(200);

      await writeFile(
        planPath,
        DECISION_PLAN.replace(
          "Start with one group.",
          "Start with the beta group.",
        ),
      );
      const masked = await callRuntime({
        target,
        sessionToken,
        path: "/api/review-state",
      });
      const maskedBody = await masked.clone().json();
      // The decision is still asked, so the reader who answered it is named a
      // reason rather than left with a card that looks untouched.
      expect(maskedBody).toMatchObject({
        answers: [],
        supersededDecisionIds: [DECISION_ID],
      });

      await writeFile(planPath, DECISION_PLAN);
      const restored = await callRuntime({
        target,
        sessionToken,
        path: "/api/review-state",
      });
      expect(await restored.clone().json()).toMatchObject({
        answers: [{ decisionId: DECISION_ID, optionId: GRADUAL_OPTION_ID }],
        supersededDecisionIds: [],
      });
      // Masking retained the record, so nothing was written to bring it back.
      expect((await answersOf(restored)).revision).toBe(
        (await answersOf(masked)).revision,
      );
    });
  });

  it("should keep an answer current when an unrelated section changes", async () => {
    await withDecisionRuntime(async ({ target, sessionToken, planPath }) => {
      expect((await stageGradual(target, sessionToken)).status).toBe(200);

      await writeFile(
        planPath,
        DECISION_PLAN.replace(
          "The rollback runbook stays unchanged.",
          "The rollback runbook now names an owner.",
        ),
      );
      await expect(
        (
          await callRuntime({
            target,
            sessionToken,
            path: "/api/review-state",
          })
        ).json(),
      ).resolves.toMatchObject({
        answers: [{ decisionId: DECISION_ID, optionId: GRADUAL_OPTION_ID }],
      });
    });
  });

  it("should export only a decision answer still current for the compiled plan", async () => {
    await withDecisionRuntime(async ({ target, sessionToken, planPath }) => {
      expect((await stageGradual(target, sessionToken)).status).toBe(200);
      const current = await callRuntime({
        target,
        sessionToken,
        path: "/api/export-markdown",
      });
      expect(await current.text()).toContain(
        "- **Which release path should we use?:** Gradual rollout",
      );

      await writeFile(
        planPath,
        DECISION_PLAN.replace(
          "Start with one group.",
          "Start with the beta group.",
        ),
      );
      const stale = await callRuntime({
        target,
        sessionToken,
        path: "/api/export-markdown",
      });
      expect(await stale.text()).not.toContain(
        "- **Which release path should we use?:** Gradual rollout",
      );
    });
  });

  it("should report an unreadable answer record instead of serving it as empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-inputs-corrupt-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, DECISION_PLAN);
    const target = await startReviewRuntime({ planPath });
    // The runtime reports through its one diagnostic sink, so that is where a
    // total answer loss has to be observable.
    const reported: Array<string> = [];
    const reportFailure = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        reported.push(String(chunk));
        return true;
      });
    try {
      const sessionToken = await runtimeToken(target);
      expect((await stageGradual(target, sessionToken)).status).toBe(200);
      await writeFile(target.store.inputsPath, "{ truncated");

      const served = await callRuntime({
        target,
        sessionToken,
        path: "/api/review-state",
      });
      await expect(served.json()).resolves.toMatchObject({
        answers: [expect.objectContaining({ optionId: GRADUAL_OPTION_ID })],
      });
      expect(reported).toContainEqual(
        expect.stringContaining("Stored decision answers could not be read"),
      );
    } finally {
      reportFailure.mockRestore();
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse answer writes from a replaced read-only session", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-inputs-readonly-"),
    );
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, DECISION_PLAN);
    const first = await startReviewRuntime({ planPath });
    const firstToken = await runtimeToken(first);
    // Custody is refused while the first runtime is live, so replacing it is
    // the deliberate takeover case.
    const replacement = await startReviewRuntime({ planPath, takeover: true });
    try {
      const response = await callRuntime({
        target: first,
        sessionToken: firstToken,
        path: "/api/inputs",
        method: "POST",
        body: { op: "retract", decisionId: DECISION_ID },
      });
      expect(response.status).toBe(409);
    } finally {
      await Promise.all([first.close(), replacement.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("review runtime input contract", () => {
  const CONTRACT_PLAN = `# Two questions

<Decision critical question="Which release path should we use?">

<Option title="Gradual rollout" recommended summary="Start with one group.">
<Consideration label="Risk" verdict="Low" tone="good" />
</Option>

<Option title="Immediate rollout" summary="Release everywhere together.">
<Consideration label="Risk" verdict="High" tone="bad" />
</Option>

</Decision>

<QuickDecision question="Do we rename the endpoint?">

<Option title="Yes" recommended summary="The old name misleads." />

<Option title="No" summary="Callers already depend on it." />

</QuickDecision>
`;
  const RENAME_ID = "quick-decision-do-we-rename-the-endpoint";

  const contractOf = async (
    target: ReviewRuntime,
    sessionToken: string,
  ): Promise<
    ReadonlyArray<{
      readonly label: string;
      readonly isCritical: boolean;
      readonly state: string;
    }>
  > => {
    const value: unknown = await (
      await callRuntime({ target, sessionToken, path: "/api/input-contract" })
    ).json();
    if (
      typeof value !== "object" ||
      value === null ||
      !("inputs" in value) ||
      !Array.isArray(value.inputs)
    ) {
      throw new Error("Input contract response carried no inputs");
    }
    return value.inputs as ReadonlyArray<{
      readonly label: string;
      readonly isCritical: boolean;
      readonly state: string;
    }>;
  };

  const withContractRuntime = async (
    work: (context: {
      readonly target: ReviewRuntime;
      readonly sessionToken: string;
      readonly planPath: string;
    }) => Promise<void>,
  ): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-contract-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, CONTRACT_PLAN);
    const target = await startReviewRuntime({ planPath });
    try {
      await work({
        target,
        sessionToken: await runtimeToken(target),
        planPath,
      });
    } finally {
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  };

  it("should list every input the plan asks and which of them is critical", async () => {
    await withContractRuntime(async ({ target, sessionToken }) => {
      expect(await contractOf(target, sessionToken)).toEqual([
        {
          inputId: DECISION_ID,
          label: "Which release path should we use?",
          isCritical: true,
          state: "unanswered",
          detail: "No answer recorded",
        },
        {
          inputId: RENAME_ID,
          label: "Do we rename the endpoint?",
          isCritical: false,
          state: "unanswered",
          detail: "No answer recorded",
        },
      ]);
    });
  });

  it("should turn exactly the reworded decision's input stale", async () => {
    await withContractRuntime(async ({ target, sessionToken, planPath }) => {
      for (const answer of [
        {
          decisionId: DECISION_ID,
          optionId: GRADUAL_OPTION_ID,
          optionTitle: "Gradual rollout",
          prompt: "Which release path should we use?",
          premiseSnapshot: deriveSnapshotDigest(CONTRACT_PLAN),
        },
        {
          decisionId: RENAME_ID,
          optionId: `${RENAME_ID}-option-yes`,
          optionTitle: "Yes",
          prompt: "Do we rename the endpoint?",
          premiseSnapshot: deriveSnapshotDigest(CONTRACT_PLAN),
        },
      ]) {
        expect(
          (
            await callRuntime({
              target,
              sessionToken,
              path: "/api/inputs",
              method: "POST",
              body: { op: "stage", answer },
            })
          ).status,
        ).toBe(200);
      }
      expect(
        (await contractOf(target, sessionToken)).map((input) => input.state),
      ).toEqual(["answered", "answered"]);

      await writeFile(
        planPath,
        CONTRACT_PLAN.replace(
          "The old name misleads.",
          "The old name misleads every new caller.",
        ),
      );

      expect(
        (await contractOf(target, sessionToken)).map((input) => [
          input.label,
          input.state,
        ]),
      ).toEqual([
        ["Which release path should we use?", "answered"],
        ["Do we rename the endpoint?", "stale"],
      ]);
    });
  });
});

describe("review runtime committed change sets", () => {
  const THREAD = "4444444444444444";
  const BASE = "1".repeat(16);
  const FIRST = "2".repeat(16);
  const SECOND = "3".repeat(16);
  const PUSH_REQUEST = "ffffffffffffffff";

  const withChangeSetRuntime = async (
    work: (context: {
      readonly target: ReviewRuntime;
      readonly sessionToken: string;
    }) => Promise<void>,
  ): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-change-sets-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const target = await startReviewRuntime({ planPath });
    try {
      await work({ target, sessionToken: await runtimeToken(target) });
    } finally {
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  };

  const changeSetsOf = async (
    target: ReviewRuntime,
    sessionToken: string,
  ): Promise<CommittedChangeSetState> => {
    const response = await callRuntime({
      target,
      sessionToken,
      path: "/api/change-sets",
    });
    expect(response.status).toBe(200);
    // Decoding through the browser's own decoder proves the served body is
    // one the browser contract can read, not merely valid JSON.
    const decoded = decodeCommittedChangeSets(await response.json());
    if (decoded === undefined) {
      throw new Error("The change-set body did not decode");
    }
    return decoded;
  };

  it("should serve an empty fold before any revision commits", async () => {
    await withChangeSetRuntime(async ({ target, sessionToken }) => {
      await expect(changeSetsOf(target, sessionToken)).resolves.toEqual({
        changeSets: [],
      });
    });
  });

  it("should serve a thread's fold with its start kept and its result advanced", async () => {
    await withChangeSetRuntime(async ({ target, sessionToken }) => {
      await recordCommittedRevision({
        store: target.store,
        revision: {
          requestId: "aaaaaaaaaaaaaaaa",
          changeSetIds: [THREAD],
          baseSnapshot: BASE,
          resultSnapshot: FIRST,
          provenance: "feedback",
          committedAt: "2026-08-21T12:00:00.000Z",
        },
      });
      await recordCommittedRevision({
        store: target.store,
        revision: {
          requestId: "bbbbbbbbbbbbbbbb",
          changeSetIds: [THREAD],
          baseSnapshot: FIRST,
          resultSnapshot: SECOND,
          provenance: "reply",
          committedAt: "2026-08-21T12:05:00.000Z",
        },
      });
      await recordCommittedRevision({
        store: target.store,
        revision: {
          requestId: PUSH_REQUEST,
          changeSetIds: [PUSH_REQUEST],
          baseSnapshot: SECOND,
          resultSnapshot: BASE,
          provenance: "push",
          committedAt: "2026-08-21T12:10:00.000Z",
        },
      });

      const { changeSets } = await changeSetsOf(target, sessionToken);
      // The thread's set keeps the baseline and provenance its first commit
      // recorded while its result advances; the push stays its own
      // request-keyed transaction with its provenance intact.
      expect(changeSets).toEqual([
        {
          changeSetId: THREAD,
          provenance: "feedback",
          baseSnapshot: BASE,
          resultSnapshot: SECOND,
          committedAt: "2026-08-21T12:05:00.000Z",
        },
        {
          changeSetId: PUSH_REQUEST,
          provenance: "push",
          baseSnapshot: SECOND,
          resultSnapshot: BASE,
          committedAt: "2026-08-21T12:10:00.000Z",
        },
      ]);
    });
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
      const prepared = await prepareReviewImageAssets({
        markdown: `# Plan\n\n![Capture](review-image:${descriptor.id})\n`,
        planPath,
        store: review.store,
      });
      await publishPreparedPlanAssets(prepared.assets);
      await writeFile(planPath, prepared.source);
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
          body: {
            drafts,
            resolvedCommentIds: [],
            version: await draftsVersion(),
          },
        })
      ).status,
    ).toBe(200);
    const answer: unknown = await (await call({ path: "/api/drafts" })).json();
    expect(answer).toMatchObject({ drafts: [{ id: "aabbccdd" }] });
  });

  it("should accept a drafts write carrying the current version", async () => {
    const draft = {
      id: "11aa22bb",
      body: "This write was prepared against what the store holds.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    const response = await call({
      path: "/api/drafts",
      method: "PUT",
      body: {
        drafts: [draft],
        resolvedCommentIds: [],
        version: await draftsVersion(),
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      drafts: [{ id: "11aa22bb" }],
      // The version the write produced, so the next write needs no re-read.
      version: await draftsVersion(),
    });
  });

  it("should refuse a stale conditional drafts write", async () => {
    // Two writers hold the same version. The first write moves the store, so
    // the second is prepared against content that no longer exists and must
    // be refused rather than replace the first writer's comment.
    const held = await draftsVersion();
    const winner = {
      id: "33cc44dd",
      body: "The write that got there first.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: { drafts: [winner], resolvedCommentIds: [], version: held },
        })
      ).status,
    ).toBe(200);

    const stale = await call({
      path: "/api/drafts",
      method: "PUT",
      body: {
        drafts: [
          {
            id: "55ee66ff",
            body: "The write prepared before the other one landed.",
            premiseSnapshot: PLAN_SNAPSHOT,
            target: { type: "document" },
          },
        ],
        resolvedCommentIds: [],
        version: held,
      },
    });

    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "stale-review-state",
    });
    await expect(
      (await call({ path: "/api/drafts" })).json(),
    ).resolves.toMatchObject({ drafts: [{ id: "33cc44dd" }] });
  });

  it("should refuse feedback prepared before a newer draft edit", async () => {
    const original = {
      id: "71aa82bb",
      body: "Original feedback body.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: {
            drafts: [original],
            resolvedCommentIds: [],
            version: await draftsVersion(),
          },
        })
      ).status,
    ).toBe(200);
    const held = await draftsVersion();
    const newer = { ...original, body: "Newer feedback body." };
    expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: { drafts: [newer], resolvedCommentIds: [], version: held },
        })
      ).status,
    ).toBe(200);

    const stale = await call({
      path: "/api/feedback",
      method: "POST",
      body: { comments: [original], version: held },
    });

    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "stale-review-state",
    });
    await expect(
      (await call({ path: "/api/drafts" })).json(),
    ).resolves.toMatchObject({
      drafts: [{ id: original.id, body: newer.body }],
      sent: expect.not.arrayContaining([
        expect.objectContaining({ id: original.id }),
      ]),
    });
  });

  it("should return the authoritative state after filtering a sent draft", async () => {
    const sent = {
      id: "93cc04dd",
      body: "Already submitted feedback.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [sent] },
        })
      ).status,
    ).toBe(200);

    const response = await call({
      path: "/api/drafts",
      method: "PUT",
      body: {
        drafts: [{ ...sent, body: "A stale edit of submitted feedback." }],
        resolvedCommentIds: [],
        version: await draftsVersion(),
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      drafts: [],
      sent: expect.arrayContaining([
        expect.objectContaining({ id: sent.id, body: sent.body }),
      ]),
      version: await draftsVersion(),
    });
  });

  it("should refuse deletion prepared before a newer draft edit", async () => {
    const sent = {
      id: "15ee26ff",
      body: "Keep this queued feedback.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [sent] },
        })
      ).status,
    ).toBe(200);
    const held = await draftsVersion();
    const newer = {
      id: "37aa48bb",
      body: "A concurrent staged comment.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };
    expect(
      (
        await call({
          path: "/api/drafts",
          method: "PUT",
          body: { drafts: [newer], resolvedCommentIds: [], version: held },
        })
      ).status,
    ).toBe(200);

    const stale = await call({
      path: "/api/comments-delete",
      method: "POST",
      body: { commentId: sent.id, version: held },
    });

    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "stale-review-state",
    });
    await expect(
      (await call({ path: "/api/drafts" })).json(),
    ).resolves.toMatchObject({
      drafts: [expect.objectContaining({ id: newer.id })],
      sent: expect.arrayContaining([expect.objectContaining({ id: sent.id })]),
    });
  });

  it("should refuse a drafts write that names no version", async () => {
    const response = await call({
      path: "/api/drafts",
      method: "PUT",
      body: { drafts: [], resolvedCommentIds: [] },
    });

    expect(response.status).toBe(400);
  });

  it("should refuse feedback and deletion that name no version", async () => {
    const comment = {
      id: "59cc60dd",
      body: "This mutation has no prepared state.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" },
    };

    expect(
      (
        await call({
          path: "/api/feedback",
          method: "POST",
          body: { comments: [comment] },
          prepareReviewState: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call({
          path: "/api/comments-delete",
          method: "POST",
          body: { commentId: comment.id },
          prepareReviewState: false,
        })
      ).status,
    ).toBe(400);
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
            version: await draftsVersion(),
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
          body: {
            drafts,
            resolvedCommentIds: [],
            version: await draftsVersion(),
          },
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
          body: {
            drafts,
            resolvedCommentIds: [],
            version: await draftsVersion(),
          },
        })
      ).json(),
    ).resolves.toMatchObject({
      drafts: [{ id: "cc33dd44" }],
      version: expect.any(String),
    });
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

  // The feedback directory accumulates across this suite, so a brief is found
  // by the package id the send returned rather than by being the only one there.
  const briefNameFor = async (response: {
    readonly json: () => Promise<unknown>;
  }): Promise<string | undefined> => {
    const body = (await response.json()) as { readonly packageId?: string };
    return (await readdir(runtime.store.feedbackDirectory)).find((name) =>
      name.endsWith(`-${body.packageId ?? ""}.md`),
    );
  };

  // A slide is a scope, not a block, so a reviewer pointing at one can only
  // anchor to the heading that names it. The brief has to carry the slide, or a
  // whole-slide instruction reaches the agent as its title and nothing else.
  it("should carry the whole slide when a highlight anchors to its heading", async () => {
    await fetch(runtime.url);
    const response = await call({
      path: "/api/feedback",
      method: "POST",
      body: {
        comments: [
          {
            id: "99aabbcc",
            body: "rewrite this in Spanish",
            premiseSnapshot: PLAN_SNAPSHOT,
            target: {
              type: "selection",
              blockId: "section/status-quo/heading-1",
              start: 0,
              end: 10,
              quote: "Status quo",
            },
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    const brief = await readFile(
      join(
        runtime.store.feedbackDirectory,
        (await briefNameFor(response)) ?? "",
      ),
      "utf8",
    );
    expect(brief).toContain(
      "Today's reality is that feedback does not reach the agent.",
    );
    expect(brief).toContain(
      "addresses that whole slide, not the heading alone",
    );
  });

  // A grouped slide's own text stops at its first sub-slide, so the runtime has
  // to tell the agent what the slide continues into. Without that the brief
  // claims a group's title is the whole slide and the note under-applies.
  it("should name a grouped slide's sub-slides in the package it writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-grouped-slide-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(
      planPath,
      "# Grouped plan\n\n## HTTP endpoints\n\n### The queueing endpoint\n\nAccepts a job.\n\n### The status endpoint\n\nReports one.\n",
    );
    const isolated = await startReviewRuntime({ planPath });
    try {
      const isolatedToken = await readSessionToken(isolated);
      await fetch(isolated.url);
      const sent = await fetch(`${isolated.url}api/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-big-plan-review-token": isolatedToken,
          "sec-fetch-site": "same-origin",
          origin: isolated.url.replace(/\/$/, ""),
        },
        body: JSON.stringify({
          version: await draftsVersionOf(isolated, isolatedToken),
          comments: [
            {
              id: "aa11bb22",
              body: "rewrite this in Spanish",
              premiseSnapshot: deriveSnapshotDigest(
                await readFile(planPath, "utf8"),
              ),
              target: {
                type: "selection",
                blockId: "section/http-endpoints/heading-1",
                start: 0,
                end: 14,
                quote: "HTTP endpoints",
              },
            },
          ],
        }),
      });
      expect(sent.status).toBe(200);
      const body = (await sent.json()) as { readonly packageId?: string };
      const briefName = (await readdir(isolated.store.feedbackDirectory)).find(
        (name) => name.endsWith(`-${body.packageId ?? ""}.md`),
      );
      const brief = await readFile(
        join(isolated.store.feedbackDirectory, briefName ?? ""),
        "utf8",
      );
      expect(brief).toContain('"The queueing endpoint"');
      expect(brief).toContain('"The status endpoint"');
      expect(brief).toContain(
        "whose content is in the plan source rather than below",
      );
    } finally {
      await isolated.close();
    }
  });

  it("should keep a highlight inside one block anchored to that block", async () => {
    await fetch(runtime.url);
    const response = await call({
      path: "/api/feedback",
      method: "POST",
      body: {
        comments: [
          {
            id: "99aabbcd",
            body: "rewrite this in Spanish",
            premiseSnapshot: PLAN_SNAPSHOT,
            target: {
              type: "selection",
              blockId: "section/status-quo/paragraph-1",
              start: 0,
              end: 6,
              quote: "Today's",
            },
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    const brief = await readFile(
      join(
        runtime.store.feedbackDirectory,
        (await briefNameFor(response)) ?? "",
      ),
      "utf8",
    );
    expect(brief).toContain("· paragraph · selected text");
    expect(brief).not.toContain("addresses that whole slide");
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
      exchange.requests.find(
        (candidate) =>
          candidate.kind === "feedback" &&
          candidate.comments.some((entry) => entry.id === "55667788"),
      ),
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

  it("should resume a reordered retry as the same feedback submission", async () => {
    // A submission carries a set of comments, not a sequence. A retry that
    // sends the same comments in another order used to reach a second
    // submission id, which published a duplicate package and raised a second
    // agent request for feedback the reviewer sent once.
    const directory = await mkdtemp(join(tmpdir(), "big-plan-reorder-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const isolated = await startReviewRuntime({ planPath });
    try {
      const isolatedToken = await readSessionToken(isolated);
      const version = await draftsVersionOf(isolated, isolatedToken);
      const sent = [
        {
          id: "bb22bb22",
          body: "This comment arrives second on the retry.",
          premiseSnapshot: PLAN_SNAPSHOT,
          target: { type: "document" },
        },
        {
          id: "aa11aa11",
          body: "This comment arrives first on the retry.",
          premiseSnapshot: PLAN_SNAPSHOT,
          target: { type: "document" },
        },
      ];
      const post = (comments: ReadonlyArray<unknown>) =>
        fetch(`${isolated.url}api/feedback`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-big-plan-review-token": isolatedToken,
            "sec-fetch-site": "same-origin",
            origin: isolated.url.replace(/\/$/, ""),
          },
          body: JSON.stringify({ version, comments }),
        });

      // The sent record cannot be written, so the first attempt publishes the
      // package and the agent request and then fails. Only that partial state
      // makes the retry reach the submission id again.
      await mkdir(isolated.store.sentPath);
      expect((await post(sent)).status).toBe(500);
      await rm(isolated.store.sentPath, { recursive: true });

      expect((await post([...sent].reverse())).status).toBe(200);
      const exchange = await readAgentExchange({
        store: isolated.store,
        sessionId: isolated.sessionId,
        planId: isolated.planId,
      });
      expect(
        exchange.requests.filter(
          (request) =>
            request.kind === "feedback" &&
            request.comments.some((comment) => comment.id === "aa11aa11"),
        ),
      ).toHaveLength(1);
      expect(
        await readdir(isolated.store.feedbackSubmissionDirectory),
      ).toHaveLength(1);
      expect(await readdir(isolated.store.feedbackDirectory)).toHaveLength(2);
    } finally {
      await isolated.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should resume a partially published feedback submission once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-retry-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const isolated = await startReviewRuntime({ planPath });
    try {
      const isolatedToken = await readSessionToken(isolated);
      const version = await draftsVersionOf(isolated, isolatedToken);
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
            version,
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
      const version = await draftsVersionOf(isolated, isolatedToken);

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
          version,
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
    const stalledVersion = await draftsVersion();
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
          body: {
            drafts: [],
            resolvedCommentIds: [],
            version: stalledVersion,
          },
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

  it("should refuse a reply with no valid comment id as client input", async () => {
    const response = await call({
      path: "/api/agent-requests",
      method: "POST",
      body: { kind: "reply", body: "Please revisit this." },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '"commentId" must be text',
    });
  });

  it("should report transient exchange contention as a runtime failure", async () => {
    let releaseLock = (): void => undefined;
    let markAcquired = (): void => undefined;
    const acquired = new Promise<void>((settle) => {
      markAcquired = settle;
    });
    const released = new Promise<void>((settle) => {
      releaseLock = settle;
    });
    const held = withReviewStoreLock({
      lockPath: join(runtime.store.reviewDirectory, ".progress.lock"),
      change: async () => {
        markAcquired();
        await released;
      },
      timeoutError: () => new Error("Test failed to hold the progress lock"),
    });
    await acquired;
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const commentId = "71cc71cc";
    try {
      const response = await call({
        path: "/api/feedback",
        method: "POST",
        body: {
          comments: [
            {
              id: commentId,
              body: "Keep this feedback despite progress contention.",
              premiseSnapshot: PLAN_SNAPSHOT,
              target: { type: "document" },
            },
          ],
        },
      });

      expect(response.status).toBe(500);
      expect(
        (
          await readAgentExchange({
            store: runtime.store,
            sessionId: runtime.sessionId,
            planId: runtime.planId,
          })
        ).requests.some(
          (request) =>
            request.kind === "feedback" &&
            request.comments.some((comment) => comment.id === commentId),
        ),
      ).toBe(true);
      expect(
        stderr.mock.calls.map(([chunk]) => String(chunk)).join(""),
      ).toContain("Review request POST /api/feedback failed");
    } finally {
      stderr.mockRestore();
      releaseLock();
      await held;
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

<Part title="Component choices" />

<QuickDecision question="Ship behind a flag?">

<Option title="Yes" recommended summary="Rollback stays one toggle away." />

<Option title="No" />

</QuickDecision>

<DecisionAnalysis question="Which store?" state="proposed" interaction="audit">

<Criterion title="Integrity">

Related records commit together.

</Criterion>

<Option title="SQLite" recommended>

<Score criterion="Integrity" verdict="Strong" tone="good">

Transactions preserve the records atomically.

</Score>

</Option>

<Option title="Files">

<Score criterion="Integrity" verdict="Weak" tone="bad">

Separate writes can drift.

</Score>

</Option>

<Reversibility rating="somewhat-hard">

Changing stores requires a data migration.

</Reversibility>

</DecisionAnalysis>

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

## Prototype

<Wireframe id="review-queue" title="Review queue">

<Screen id="queue" name="Queue" device="desktop">

<Panel title="Threads">
<Text text="Three open threads" />
</Panel>

</Screen>

</Wireframe>
`;
    const after = before
      .replace('question="Which path?"', 'question="Which rollout path?"')
      .replace(
        '<Part title="Component choices" />',
        '<Part title="Review choices" />',
      )
      .replace('question="Ship behind a flag?"', 'question="Ship locally?"')
      .replace('question="Which store?"', 'question="Which event store?"')
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
      .replace("Version every resolution.", "Version every resolved thread.")
      .replace("Three open threads", "Two open threads");
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
    const encoded = await response.text();
    for (const retiredField of [
      ["old", "Html"].join(""),
      ["new", "Html"].join(""),
    ]) {
      expect(encoded).not.toContain(JSON.stringify(retiredField));
    }
    const value = JSON.parse(encoded) as {
      readonly locations: ReadonlyArray<{
        readonly kind: string;
        readonly isComponentRoot: boolean;
        readonly status: string;
        readonly view?: string;
      }>;
    };
    const byKind = (kind: string) =>
      value.locations.find((location) => location.kind === kind);
    const decision = byKind("decision");
    const flow = byKind("flow-diagram");
    const fileTree = byKind("file-tree");
    const mermaid = byKind("mermaid-diagram");
    const fileTreeDiff = byKind("file-tree-diff");
    const part = byKind("part");
    const quickDecision = byKind("quick-decision");
    const decisionAnalysis = byKind("decision-analysis");
    const wireframe = byKind("wireframe");
    const httpEndpoint = byKind("http-endpoint");
    const quickSummary = byKind("quick-summary");
    const quickSummaryFacet = byKind("quick-summary-facet");
    // Every component root answers with exactly one component-owned diff view
    // holding both sides.
    for (const location of [
      part,
      quickDecision,
      decisionAnalysis,
      decision,
      flow,
      fileTree,
      mermaid,
      fileTreeDiff,
      wireframe,
    ] as const) {
      expect(location?.isComponentRoot).toBe(true);
      expect(location?.view).toBeTypeOf("string");
      expect(
        Object.keys(location ?? {}).filter((key) => key === "view"),
      ).toEqual(["view"]);
    }
    expect(part?.view).toContain("Component choices");
    expect(part?.view).toContain("Review choices");
    expect(quickDecision?.view).toContain("Ship behind a flag?");
    expect(quickDecision?.view).toContain("Ship locally?");
    expect(decisionAnalysis?.view).toContain("Which store?");
    expect(decisionAnalysis?.view).toContain("Which event store?");
    expect(decision?.view).toContain("Which path?");
    expect(decision?.view).toContain("Which rollout path?");
    expect(flow?.view).toContain("Review service");
    expect(flow?.view).toContain("Local review service");
    expect(fileTree?.view).toContain("service.ts");
    expect(fileTree?.view).toContain("repository.ts");
    expect(mermaid?.view).toContain("Review");
    expect(mermaid?.view).toContain("Plan review");
    expect(fileTreeDiff?.view).toContain("Coordinates review");
    expect(fileTreeDiff?.view).toContain("Coordinates plan review");
    expect(wireframe?.view).toContain("Three open threads");
    expect(wireframe?.view).toContain("Two open threads");
    // Only the proposed side keeps the plan's own address, so opening a diff
    // can never publish a second copy of an address a comment resolves.
    expect([
      ...(mermaid?.view ?? "").matchAll(/data-block-id=/gu),
    ]).toHaveLength(1);
    expect(mermaid?.view).toContain('data-diff-side="baseline"');
    // The last field-bearing roots now answer through their own diff contract;
    // the declared facet remains an engine location, not a second component.
    for (const location of [httpEndpoint, quickSummary] as const) {
      expect(location?.isComponentRoot).toBe(true);
      expect(location?.view).toBeTypeOf("string");
    }
    expect(quickSummaryFacet).toBeDefined();
    expect(quickSummaryFacet?.view).toBeUndefined();
    // The payload-size tripwire. Shipping a scrubbed copy per side, or
    // putting a component's compiled diff model on the wire beside the view
    // that already shows it, is what made this response large enough to be
    // worth measuring; both would roughly double it. The ceiling is generous
    // against the measured 305 KB after the last field-bearing views joined
    // the contract, while staying well below the former 372 KB payload.
    expect(JSON.stringify(value).length).toBeLessThan(320_000);
    // This case compiles both snapshots through every first-class component,
    // including the Mermaid renderer, so it needs the same headroom the
    // renderer's own suites take rather than the default per-test timeout.
    // It runs in about 7s alone and occasionally crossed 15s under full-suite
    // parallel load, which is a flake rather than a regression; the ceiling is
    // sized to the observed worst case instead of the typical one.
  }, 30000);

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
        readonly oldView?: string;
        readonly newView?: string;
      }>;
      readonly places: ReadonlyArray<{ readonly note: string }>;
    };
    const picture = value.locations.find(
      (location) => location.kind === "image",
    );
    // A picture carries no words, so its compiled markup is the only evidence
    // the lens can show the reviewer.
    expect(picture?.oldView).toContain("./assets/before.png");
    expect(picture?.newView).toContain("./assets/after.png");
    expect(picture?.oldView).not.toContain("data-block-id");
    expect(picture?.newView).not.toContain("data-block-id");
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
          body: {
            drafts: [comment],
            resolvedCommentIds: [],
            version: await draftsVersion(),
          },
        })
      ).status,
    ).toBe(200);
    const resubmission = await call({
      path: "/api/feedback",
      method: "POST",
      body: { comments: [comment] },
    });
    expect(resubmission.status).toBe(409);
    await expect(resubmission.json()).resolves.toMatchObject({
      error: "The feedback submission was canceled by the reviewer",
    });
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
      // This block's helper only speaks POST, so the conditional-write version
      // is read straight from the isolated runtime.
      const isolatedVersion = (): Promise<string> =>
        draftsVersionOf(isolated, isolatedToken);
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            body: { comments: [comment], version: await isolatedVersion() },
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

      const mutationLockPath = join(
        isolated.store.reviewDirectory,
        ".plan-mutation.lock",
      );
      await writeFile(mutationLockPath, "Lock path unavailable.");
      const unavailable = await isolatedCall({
        path: "/api/revert-agent-changes",
        body: { requestId: request.requestId, commentId: comment.id },
      });
      await rm(mutationLockPath, { force: true });
      expect(unavailable.status).toBe(503);
      await expect(unavailable.json()).resolves.toEqual({
        error: "The plan mutation area is unavailable",
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
            body: { commentId: comment.id, version: await isolatedVersion() },
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

  const resolveWrite = async (isolatedCall: IsolatedCall): Promise<Response> =>
    isolatedCall({
      path: "/api/drafts",
      method: "PUT",
      body: {
        drafts: [],
        resolvedCommentIds: [commentId],
        version: await isolatedReviewStateVersion(isolatedCall),
      },
    });

  /** Holds `.resolved.lock` the way a concurrent request creation would. */
  const holdResolvedCommentLock = async (
    isolated: ReviewRuntime,
  ): Promise<() => Promise<void>> => {
    let acquire = (): void => undefined;
    const acquired = new Promise<void>((settle) => {
      acquire = settle;
    });
    let release = (): void => undefined;
    const released = new Promise<void>((settle) => {
      release = settle;
    });
    const held = withResolvedCommentLock({
      store: isolated.store,
      change: async () => {
        acquire();
        await released;
      },
    });
    await acquired;
    let done = false;
    return async () => {
      if (done) return;
      done = true;
      release();
      await held;
    };
  };

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
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
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
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
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

  it("should keep an already resolved comment resolvable while unrelated work is queued", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-resolve-unrelated-",
    );
    const otherComment = {
      id: "c8c8c8c8",
      body: "Rewrite the intended change section.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" as const },
    };
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
            body: {
              comments: [otherComment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);

      const draft = {
        id: "d9d9d9d9",
        body: "Keep this draft while the other thread stays resolved.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "document" as const },
      };
      expect(
        (
          await isolatedCall({
            path: "/api/drafts",
            method: "PUT",
            body: {
              drafts: [draft],
              resolvedCommentIds: [commentId],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
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

  it("should refuse feedback that names a resolved thread", async () => {
    const { isolatedCall, close } = await isolatedRuntime(
      "big-plan-feedback-resolved-refuse-",
    );
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/drafts",
            method: "PUT",
            body: {
              drafts: [comment],
              resolvedCommentIds: [commentId],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);

      const refusal = await isolatedCall({
        path: "/api/feedback",
        method: "POST",
        body: {
          comments: [comment],
          version: await isolatedReviewStateVersion(isolatedCall),
        },
      });
      expect(refusal.status).toBe(409);
      await expect(refusal.json()).resolves.toMatchObject({
        error: "Unresolve this thread before sending new work.",
      });
    } finally {
      await close();
    }
  });

  it("should refuse a reply that names a resolved thread", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-reply-resolved-refuse-",
    );
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
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

      const refusal = await isolatedCall({
        path: "/api/agent-requests",
        method: "POST",
        body: {
          kind: "reply",
          commentId,
          body: "Please look at this again.",
        },
      });
      expect(refusal.status).toBe(409);
      await expect(refusal.json()).resolves.toMatchObject({
        error: "Unresolve this thread before sending new work.",
      });
    } finally {
      await close();
    }
  });

  it("should refuse a drafts write that waited for a concurrent create", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-resolve-interleave-",
    );
    let release: (() => Promise<void>) | undefined;
    try {
      const version = await isolatedReviewStateVersion(isolatedCall);
      release = await holdResolvedCommentLock(isolated);
      const resolved = isolatedCall({
        path: "/api/drafts",
        method: "PUT",
        body: { drafts: [], resolvedCommentIds: [commentId], version },
      });
      let settled = false;
      void resolved.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await new Promise((wait) => setTimeout(wait, 100));
      expect(settled).toBe(false);

      await writeAgentRequest({
        store: isolated.store,
        request: messageAgentRequest({
          kind: "reply",
          requestId: "5a5a5a5a5a5a5a5a",
          sessionId: isolated.sessionId,
          planId: isolated.planId,
          premiseSnapshot: PLAN_SNAPSHOT,
          createdAt: "2026-08-17T12:00:00.000Z",
          body: "Please look at this again.",
          commentId,
        }),
      });
      await release();

      const refusal = await resolved;
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
      await release?.();
      await close();
    }
  });

  it("should keep a comment the agent is holding out of the reviewer's hands", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-live-claim-",
    );
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
      await claimAgentRequest({
        store: isolated.store,
        activeSessionId: isolated.sessionId,
        requestId: await queuedRequestId(isolated),
        claimedBy: isolated.sessionId,
        baselineSnapshot: PLAN_SNAPSHOT,
        now: new Date().toISOString(),
      });

      const refused = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: {
          commentId,
          version: await isolatedReviewStateVersion(isolatedCall),
        },
      });

      expect(refused.status).toBe(409);
      await expect(refused.json()).resolves.toMatchObject({
        error: "The agent has already picked up this comment",
      });
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({
        sent: [expect.objectContaining({ id: commentId })],
      });
    } finally {
      await close();
    }
  });

  it("should delete a comment whose claim was proven abandoned", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-abandoned-claim-",
    );
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
      // Nothing has ever heartbeated on this runtime, so presence reports no
      // agent attached; the claim below is the whole of the reviewer's proof.
      const abandonedAtMs = Date.now() - AGENT_RECOVERY_HORIZON_MS - 1;
      await claimAgentRequest({
        store: isolated.store,
        activeSessionId: isolated.sessionId,
        requestId: await queuedRequestId(isolated),
        claimedBy: isolated.sessionId,
        baselineSnapshot: PLAN_SNAPSHOT,
        now: new Date(abandonedAtMs).toISOString(),
        clock: () => abandonedAtMs,
      });

      const deleted = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: {
          commentId,
          version: await isolatedReviewStateVersion(isolatedCall),
        },
      });

      expect(deleted.status).toBe(200);
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({ sent: [] });
      await expect(
        readAgentExchange({
          store: isolated.store,
          sessionId: isolated.sessionId,
          planId: isolated.planId,
        }),
      ).resolves.toMatchObject({
        requests: [expect.objectContaining({ canceledAt: expect.any(String) })],
      });
    } finally {
      await close();
    }
  });

  it("should delete a comment through a journal an abandoned commit left behind", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-stranded-journal-",
    );
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
      const requestId = await queuedRequestId(isolated);
      const abandonedAtMs = Date.now() - AGENT_RECOVERY_HORIZON_MS - 1;
      const claimed = await claimAgentRequest({
        store: isolated.store,
        activeSessionId: isolated.sessionId,
        requestId,
        claimedBy: isolated.sessionId,
        baselineSnapshot: PLAN_SNAPSHOT,
        now: new Date(abandonedAtMs).toISOString(),
        clock: () => abandonedAtMs,
      });
      // The commit wrote its journal and then the agent died. The plan never
      // moved, so nothing this journal describes was published, and no later
      // agent run is coming to settle it.
      const neverLanded = `${PLAN}\nA revision that never landed.\n`;
      await writeStoreJson({
        path: agentMutationJournalPath({ store: isolated.store, requestId }),
        value: {
          version: 1,
          requestId,
          generation: 1,
          claimedBy: isolated.sessionId,
          baseSnapshot: PLAN_SNAPSHOT,
          resultSnapshot: deriveSnapshotDigest(neverLanded),
          answeredAt: "2026-08-17T12:00:05.000Z",
          response: validateAgentResponseDraft({
            value: {
              requestId,
              outcomes: [
                {
                  commentId,
                  state: "answered",
                  message: "The status quo section already says this.",
                },
              ],
            },
            request: claimed,
            commentsById: new Map(),
            changedBlocks: new Set<string>(),
            currentSnapshot: deriveSnapshotDigest(neverLanded),
            now: "2026-08-17T12:00:05.000Z",
          }),
        },
      });

      const deleted = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: {
          commentId,
          version: await isolatedReviewStateVersion(isolatedCall),
        },
      });

      // Without settling that journal first the guard would refuse this
      // forever, relocking the one comment abandonment is proven for.
      expect(deleted.status).toBe(200);
      await expect(
        readdir(isolated.store.agentMutationJournalDirectory),
      ).resolves.toEqual([]);
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({ sent: [] });
    } finally {
      await close();
    }
  });

  it("should refuse a comment delete once the settle finds the answer published", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-settled-answer-",
    );
    const other = {
      id: "b8b8b8b8",
      body: "Keep this one in the batch.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" as const },
    };
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment, other],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
      const requestId = await queuedRequestId(isolated);
      const abandonedAtMs = Date.now() - AGENT_RECOVERY_HORIZON_MS - 1;
      const claimed = await claimAgentRequest({
        store: isolated.store,
        activeSessionId: isolated.sessionId,
        requestId,
        claimedBy: isolated.sessionId,
        baselineSnapshot: PLAN_SNAPSHOT,
        now: new Date(abandonedAtMs).toISOString(),
        clock: () => abandonedAtMs,
      });
      // The commit's rename won and then the agent died before writing its
      // terminal records, so no response exists for the route to see.
      const published = `${PLAN}\nThe published revision.\n`;
      await writeStoreJson({
        path: agentMutationJournalPath({ store: isolated.store, requestId }),
        value: {
          version: 1,
          requestId,
          generation: 1,
          claimedBy: isolated.sessionId,
          baseSnapshot: PLAN_SNAPSHOT,
          resultSnapshot: deriveSnapshotDigest(published),
          answeredAt: "2026-08-17T12:00:05.000Z",
          response: validateAgentResponseDraft({
            value: {
              requestId,
              outcomes: [comment, other].map((entry) => ({
                commentId: entry.id,
                state: "answered",
                message: "The status quo section already says this.",
              })),
            },
            request: claimed,
            commentsById: new Map(),
            changedBlocks: new Set<string>(),
            currentSnapshot: deriveSnapshotDigest(published),
            now: "2026-08-17T12:00:05.000Z",
          }),
        },
      });
      await writeFile(isolated.planPath, published);

      const refused = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: {
          commentId,
          version: await isolatedReviewStateVersion(isolatedCall),
        },
      });

      // Every decision is made from a read taken after the settle, so the
      // route answers on the answer it now has rather than on the queued
      // state it read a moment earlier.
      expect(refused.status).toBe(409);
      await expect(refused.json()).resolves.toMatchObject({
        error:
          "Only a queued, canceled, or reverted comment can be deleted from the review",
      });
      // Stripping the claim would make the published answer unreadable for
      // good while the plan still carries its revision.
      const history = await readAgentCommentHistory({
        store: isolated.store,
        sessionId: isolated.sessionId,
        planId: isolated.planId,
        commentId,
      });
      expect(history.requests[0]).toMatchObject({
        claimedBy: isolated.sessionId,
        answeredAt: expect.any(String),
      });
      expect(history.responses).toHaveLength(1);
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({
        sent: expect.arrayContaining([
          expect.objectContaining({ id: commentId }),
        ]),
      });
    } finally {
      await close();
    }
  });

  it("should leave every request untouched when one of them refuses the delete", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-partial-",
    );
    const replyRequestId = "9d9d9d9d9d9d9d9d";
    try {
      // An earlier reply on the same thread, still queued and never claimed.
      await writeAgentRequest({
        store: isolated.store,
        request: messageAgentRequest({
          kind: "reply",
          requestId: replyRequestId,
          sessionId: isolated.sessionId,
          planId: isolated.planId,
          premiseSnapshot: PLAN_SNAPSHOT,
          createdAt: "2026-08-17T12:00:00.000Z",
          body: "Please look at this again.",
          commentId,
        }),
      });
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
      const requestId = await queuedRequestId(isolated);
      const abandonedAtMs = Date.now() - AGENT_RECOVERY_HORIZON_MS - 1;
      const claimed = await claimAgentRequest({
        store: isolated.store,
        activeSessionId: isolated.sessionId,
        requestId,
        claimedBy: isolated.sessionId,
        baselineSnapshot: PLAN_SNAPSHOT,
        now: new Date(abandonedAtMs).toISOString(),
        clock: () => abandonedAtMs,
      });
      await commitRequestTerminal({
        store: isolated.store,
        response: validateAgentResponseDraft({
          value: {
            requestId,
            outcomes: [
              {
                commentId,
                state: "answered",
                message: "The status quo section already says this.",
              },
            ],
          },
          request: claimed,
          commentsById: new Map(),
          changedBlocks: new Set<string>(),
          currentSnapshot: PLAN_SNAPSHOT,
          now: "2026-08-17T12:00:05.000Z",
        }),
        claimedBy: isolated.sessionId,
        now: "2026-08-17T12:00:05.000Z",
      });
      // Written by a build this one no longer understands, so every reader
      // drops it and the thread reads as unanswered while the mailbox still
      // knows the batch is terminal. The reply sorts first, so a loop that
      // wrote as it went would withdraw it before reaching the refusal.
      await writeAgentResponseValue({
        store: isolated.store,
        requestId,
        value: { version: 99, requestId },
      });

      const refused = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: {
          commentId,
          version: await isolatedReviewStateVersion(isolatedCall),
        },
      });

      expect(refused.status).toBe(409);
      await expect(refused.json()).resolves.toMatchObject({
        error: "The agent has already answered this request",
      });
      // The reviewer never asked to withdraw the reply, so a retry once the
      // state resolves is still open to them.
      const exchange = await readAgentExchange({
        store: isolated.store,
        sessionId: isolated.sessionId,
        planId: isolated.planId,
      });
      expect(
        exchange.requests.find(
          (candidate) => candidate.requestId === replyRequestId,
        )?.canceledAt,
      ).toBeUndefined();
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({
        sent: expect.arrayContaining([
          expect.objectContaining({ id: commentId }),
        ]),
      });
    } finally {
      await close();
    }
  });

  it("should answer a mailbox refusal during a comment delete as a conflict", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-mailbox-refusal-",
    );
    const replyRequestId = "7c7c7c7c7c7c7c7c";
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await isolatedCall({
            path: "/api/agent-cancel",
            method: "POST",
            body: { requestId: await queuedRequestId(isolated) },
          })
        ).status,
      ).toBe(200);
      // A follow-up on the same thread, answered by an agent whose claim has
      // since been proven abandoned.
      await writeAgentRequest({
        store: isolated.store,
        request: messageAgentRequest({
          kind: "reply",
          requestId: replyRequestId,
          sessionId: isolated.sessionId,
          planId: isolated.planId,
          premiseSnapshot: PLAN_SNAPSHOT,
          createdAt: "2026-08-17T12:00:00.000Z",
          body: "Please look at this again.",
          commentId,
        }),
      });
      const abandonedAtMs = Date.now() - AGENT_RECOVERY_HORIZON_MS - 1;
      const claimed = await claimAgentRequest({
        store: isolated.store,
        activeSessionId: isolated.sessionId,
        requestId: replyRequestId,
        claimedBy: isolated.sessionId,
        baselineSnapshot: PLAN_SNAPSHOT,
        now: new Date(abandonedAtMs).toISOString(),
        clock: () => abandonedAtMs,
      });
      await commitRequestTerminal({
        store: isolated.store,
        response: validateAgentResponseDraft({
          value: {
            requestId: replyRequestId,
            outcomes: [
              {
                commentId,
                state: "answered",
                message: "The status quo section already says this.",
              },
            ],
          },
          request: claimed,
          commentsById: new Map([[commentId, comment]]),
          changedBlocks: new Set<string>(),
          currentSnapshot: PLAN_SNAPSHOT,
          now: "2026-08-17T12:00:05.000Z",
        }),
        claimedBy: isolated.sessionId,
        now: "2026-08-17T12:00:05.000Z",
      });
      // The stored answer was written by a build this one no longer
      // understands, so every reader drops it and the thread reads as
      // unanswered - while the mailbox still knows the request is terminal.
      await writeAgentResponseValue({
        store: isolated.store,
        requestId: replyRequestId,
        value: { version: 99, requestId: replyRequestId },
      });

      const refused = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: {
          commentId,
          version: await isolatedReviewStateVersion(isolatedCall),
        },
      });

      // The mailbox refusing is the reviewer's answer, not a runtime failure.
      expect(refused.status).toBe(409);
      await expect(refused.json()).resolves.toMatchObject({
        error: "The agent has already answered this request",
      });
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({
        sent: [expect.objectContaining({ id: commentId })],
      });
    } finally {
      await close();
    }
  });

  it("should delete a resolved comment under the shared lock", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-resolved-lock-",
    );
    let release: (() => Promise<void>) | undefined;
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
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

      const version = await isolatedReviewStateVersion(isolatedCall);
      release = await holdResolvedCommentLock(isolated);
      const deleted = isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: { commentId, version },
      });
      let settled = false;
      void deleted.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await new Promise((wait) => setTimeout(wait, 100));
      expect(settled).toBe(false);
      await release();

      expect((await deleted).status).toBe(200);
      await expect(
        readResolvedCommentIds({
          store: isolated.store,
          validate: validateResolvedCommentIds,
        }),
      ).resolves.toEqual([]);
    } finally {
      await release?.();
      await close();
    }
  });

  it("should delete an unresolved comment while another process holds the shared lock", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-unresolved-lock-",
    );
    const keptComment = {
      id: "c5c5c5c5",
      body: "Keep this queued comment.",
      premiseSnapshot: PLAN_SNAPSHOT,
      target: { type: "document" as const },
    };
    let release: (() => Promise<void>) | undefined;
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment, keptComment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);

      const version = await isolatedReviewStateVersion(isolatedCall);
      release = await holdResolvedCommentLock(isolated);
      const deleted = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: { commentId, version },
      });
      expect(deleted.status).toBe(200);
      await expect(
        readAgentExchange({
          store: isolated.store,
          sessionId: isolated.sessionId,
          planId: isolated.planId,
        }),
      ).resolves.toMatchObject({
        requests: [{ kind: "feedback", comments: [{ id: keptComment.id }] }],
      });
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({
        sent: [expect.objectContaining({ id: keptComment.id })],
      });
    } finally {
      await release?.();
      await close();
    }
  });

  it("should leave a delete retryable when the shared lock times out", async () => {
    const { isolated, isolatedCall, close } = await isolatedRuntime(
      "big-plan-delete-lock-timeout-",
    );
    let release: (() => Promise<void>) | undefined;
    try {
      expect(
        (
          await isolatedCall({
            path: "/api/feedback",
            method: "POST",
            body: {
              comments: [comment],
              version: await isolatedReviewStateVersion(isolatedCall),
            },
          })
        ).status,
      ).toBe(200);
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

      const version = await isolatedReviewStateVersion(isolatedCall);
      release = await holdResolvedCommentLock(isolated);
      const refused = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: { commentId, version },
      });
      expect(refused.status).toBe(409);
      await expect(refused.json()).resolves.toMatchObject({
        error: expect.stringContaining("changing resolved threads"),
      });
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({
        sent: [expect.objectContaining({ id: commentId })],
        resolvedCommentIds: [commentId],
      });

      await release();
      const retried = await isolatedCall({
        path: "/api/comments-delete",
        method: "POST",
        body: { commentId, version },
      });
      expect(retried.status).toBe(200);
      await expect(
        (await isolatedCall({ path: "/api/drafts" })).json(),
      ).resolves.toMatchObject({ sent: [], resolvedCommentIds: [] });
    } finally {
      await release?.();
      await close();
    }
  }, 15_000);
});

describe("review runtime shutdown", () => {
  it("should refuse a mutation queued behind committed idle shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-idle-write-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const review = await startReviewRuntime({
      planPath,
      idleTimeoutMs: 0,
    });
    const descriptor: unknown = JSON.parse(
      await readFile(review.store.sessionPath, "utf8"),
    );
    const sessionToken =
      typeof descriptor === "object" &&
      descriptor !== null &&
      "token" in descriptor &&
      typeof descriptor.token === "string"
        ? descriptor.token
        : "";
    let enterStop = (): void => undefined;
    const stopEntered = new Promise<void>((settle) => {
      enterStop = settle;
    });
    let releaseStop = (): void => undefined;
    const stopReleased = new Promise<void>((settle) => {
      releaseStop = settle;
    });
    const stopping = stopReviewSessionIfInactive({
      store: review.store,
      sessionId: review.sessionId,
      stopReason: "Idle",
      inactive: async () => {
        enterStop();
        await stopReleased;
        return true;
      },
    });
    await stopEntered;
    const mutation = fetch(`${review.url}api/agent-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-big-plan-review-token": sessionToken,
        "sec-fetch-site": "same-origin",
        origin: review.url.replace(/\/$/u, ""),
      },
      body: JSON.stringify({
        kind: "chat",
        body: "Do not acknowledge this after shutdown.",
      }),
    });
    try {
      const mutationWaited = await Promise.race([
        mutation.then(() => false),
        new Promise<true>((settle) => setTimeout(() => settle(true), 20)),
      ]);
      expect(mutationWaited).toBe(true);
      releaseStop();
      await expect(stopping).resolves.toEqual({
        authoritative: true,
        stopped: true,
      });
      // Without the in-lock heartbeat check, this already-waiting POST returns
      // 200 and writes its request after running:false commits. That
      // counterfactual was verified before this test passed.
      const response = await mutation;
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error:
          "This review session has stopped and can no longer accept changes",
      });
      const exchange = await readAgentExchange({
        store: review.store,
        sessionId: review.sessionId,
        planId: review.planId,
      });
      expect(
        exchange.requests.some(
          (request) =>
            request.kind === "chat" &&
            request.body === "Do not acknowledge this after shutdown.",
        ),
      ).toBe(false);
    } finally {
      releaseStop();
      await stopping;
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

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

  it("should keep a takeover runtime authoritative for the same plan", async () => {
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
    // Custody is refused while the first runtime is live, so a replacement is
    // the deliberate takeover case.
    const replacement = await startReviewRuntime({ planPath, takeover: true });
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

  it("should publish a launchable restart command for this plan", async () => {
    const session = (await (await call({ path: "/api/session" })).json()) as {
      readonly restartCommand?: unknown;
    };
    expect(session.restartCommand).toEqual(
      expect.stringMatching(/^node '.+' review '.+'$/),
    );
    expect(session.restartCommand).toEqual(
      expect.stringContaining(`review '${runtime.planPath}'`),
    );
  });

  it("should publish no deadline by default", async () => {
    const payload = (await (await call({ path: "/api/session" })).json()) as {
      readonly idleTimeoutMs?: unknown;
      readonly expiresAtMs?: unknown;
    };
    expect(DEFAULT_REVIEW_IDLE_TIMEOUT_MS).toBe(0);
    expect(payload.idleTimeoutMs).toBe(0);
    expect(payload).not.toHaveProperty("expiresAtMs");
  });

  it("should publish a deadline that advances when a timeout is configured", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-server-deadline-"),
    );
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const timed = await startReviewRuntime({
      planPath,
      idleTimeoutMs: 30 * 60 * 1_000,
    });
    const timedToken = await readSessionToken(timed);
    const sessionOf = async (): Promise<{
      readonly idleTimeoutMs?: unknown;
      readonly expiresAtMs?: unknown;
    }> =>
      (await (
        await fetch(`${timed.url}api/session`, {
          headers: { "x-big-plan-review-token": timedToken },
        })
      ).json()) as {
        readonly idleTimeoutMs?: unknown;
        readonly expiresAtMs?: unknown;
      };
    try {
      const before = await sessionOf();
      expect(before.idleTimeoutMs).toBe(30 * 60 * 1_000);
      expect(before.expiresAtMs).toBeGreaterThan(Date.now());
      await new Promise((settle) => setTimeout(settle, 5));
      const after = await sessionOf();
      expect(after.expiresAtMs).toBeGreaterThan(Number(before.expiresAtMs));
    } finally {
      await timed.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should keep a default review serving after the idle window that used to close it", async () => {
    // The former default was 30 minutes. This uses a shortened analogue so the
    // test does not sleep for that lifetime: a runtime under that policy dies,
    // and a default runtime (no expiry) still answers after the same window.
    const directory = await mkdtemp(join(tmpdir(), "big-plan-idle-survive-"));
    const dyingPath = join(directory, "dying.mdx");
    const survivingPath = join(directory, "surviving.mdx");
    await writeFile(dyingPath, PLAN);
    await writeFile(survivingPath, PLAN);
    const oldWindowMs = 200;
    const dying = await startReviewRuntime({
      planPath: dyingPath,
      idleTimeoutMs: oldWindowMs,
    });
    const surviving = await startReviewRuntime({ planPath: survivingPath });
    try {
      expect(DEFAULT_REVIEW_IDLE_TIMEOUT_MS).toBe(0);
      await expect(fetch(dying.url)).resolves.toMatchObject({ status: 200 });
      await expect(fetch(surviving.url)).resolves.toMatchObject({
        status: 200,
      });

      // GET / counts as activity, so the wait must not poll either document.
      // Reading the session record touches nothing, so it can be watched
      // until the shortened window has actually closed that runtime.
      await vi.waitFor(
        async () => {
          await expect(
            reviewSessionIsRunning({
              store: dying.store,
              sessionId: dying.sessionId,
            }),
          ).resolves.toMatchObject({
            running: false,
            stopReason: expect.stringContaining("of inactivity"),
          });
        },
        { timeout: 5_000, interval: 20 },
      );
      // The record is written before the listener drains, so the socket is
      // watched rather than sampled once.
      await vi.waitFor(
        async () => {
          await expect(fetch(dying.url)).rejects.toThrow();
        },
        { timeout: 5_000, interval: 20 },
      );

      await expect(fetch(surviving.url)).resolves.toMatchObject({
        status: 200,
      });
      await expect(
        reviewSessionIsRunning({
          store: surviving.store,
          sessionId: surviving.sessionId,
        }),
      ).resolves.toMatchObject({ running: true });
    } finally {
      await Promise.all([
        dying.close().catch(() => undefined),
        surviving.close(),
      ]);
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  // The idle check runs on a timer, so nothing is waiting on the promise it
  // returns. A rejection there used to reach the process as an unhandled
  // rejection, which ends the whole review over one failed tick.
  it("should report a failing idle check instead of ending the review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-idle-fail-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const review = await startReviewRuntime({
      planPath,
      idleTimeoutMs: 1_000,
      queuedWorkIdleTimeoutMs: 120_000,
    });
    // Queued work keeps the session open, so the timer goes on reaching for
    // the store instead of stopping the session on its first tick.
    await writeAgentRequest({
      store: review.store,
      request: messageAgentRequest({
        kind: "chat",
        requestId: "1d1e1d1e1d1e1d1e",
        sessionId: review.sessionId,
        planId: review.planId,
        premiseSnapshot: deriveSnapshotDigest(PLAN),
        createdAt: "2026-08-19T12:00:00.000Z",
        body: "Hold this session open while the store goes away.",
      }),
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      // The store goes out from under the live timer, which is what a working
      // directory cleaned up beneath a running review looks like.
      await rm(review.store.reviewDirectory, { recursive: true, force: true });
      await vi.waitFor(
        () => {
          expect(
            stderr.mock.calls.map(([chunk]) => String(chunk)).join(""),
          ).toContain(
            `Review idle check failed for session ${review.sessionId}`,
          );
        },
        { timeout: 10_000, interval: 25 },
      );
    } finally {
      stderr.mockRestore();
      // The store comes back before the close, so the shutdown can finish and
      // hand the port back rather than failing on the directory this took away.
      await mkdir(review.store.reviewDirectory, { recursive: true });
      await review.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

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

// BIG-190: disconnecting is a message to the agent and a release of the review,
// and the log has to record it as an end somebody asked for rather than a gap.
describe("review runtime agent disconnect", () => {
  let disconnected: ReviewRuntime;
  let disconnectToken: string;
  let disconnectDirectory: string;

  beforeAll(async () => {
    disconnectDirectory = await mkdtemp(join(tmpdir(), "big-plan-disconnect-"));
    const planPath = join(disconnectDirectory, "plan.mdx");
    await writeFile(planPath, PLAN);
    disconnected = await startReviewRuntime({ planPath });
    disconnectToken = await readSessionToken(disconnected);
  });

  afterAll(async () => {
    await disconnected.close();
    await rm(disconnectDirectory, { recursive: true, force: true });
  });

  const ask = ({
    path,
    method = "POST",
    body,
  }: {
    readonly path: string;
    readonly method?: string;
    readonly body?: unknown;
  }) =>
    fetch(`${disconnected.url.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        "x-big-plan-review-token": disconnectToken,
        "sec-fetch-site": "same-origin",
        origin: disconnected.url.replace(/\/$/, ""),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  /** Holds the gate `claimAgentRequest` takes first, so a claim cannot land. */
  const holdPlanClaimLock = (runtimeToHold: ReviewRuntime) => {
    let acquire = (): void => undefined;
    let free = (): void => undefined;
    const acquired = new Promise<void>((settle) => {
      acquire = settle;
    });
    const freed = new Promise<void>((settle) => {
      free = settle;
    });
    const held = withReviewStoreLock({
      lockPath: join(runtimeToHold.store.reviewDirectory, ".agent-claim.lock"),
      change: async () => {
        acquire();
        await freed;
      },
      timeoutError: () => new Error("Timed out holding the plan claim lock"),
    });
    return {
      acquired,
      release: async () => {
        free();
        await held;
      },
    };
  };

  const attachAgent = async ({
    writerId,
    state = "waiting",
    requestId,
  }: {
    readonly writerId: string;
    readonly state?: "waiting" | "working";
    readonly requestId?: string;
  }) => {
    await writeAgentHeartbeat({
      store: disconnected.store,
      sessionId: disconnected.sessionId,
      state,
      writerId,
      ...(requestId === undefined ? {} : { requestId }),
    });
  };

  it("should refuse a disconnect when no agent is connected", async () => {
    // Nothing to disconnect is not a quiet success: writing a directive
    // addressed to nobody would leave a standing order against every agent
    // that attaches afterwards.
    const response = await ask({ path: "/api/agent-disconnect" });
    expect(response.status).toBe(409);
    await expect(
      readAgentDisconnectRequests({ store: disconnected.store }),
    ).resolves.toEqual([]);
  });

  it("should address the disconnect to the agent the review names", async () => {
    await attachAgent({ writerId: "1111111111111111" });
    const response = await ask({ path: "/api/agent-disconnect" });
    expect(response.status).toBe(200);
    // With no claim to name, the review's own writer id speaks for the
    // connection - and it speaks alone, so the directive can reach one agent.
    await expect(
      readAgentDisconnectRequests({ store: disconnected.store }),
    ).resolves.toEqual([
      { writerId: "1111111111111111", requestedAtMs: expect.any(Number) },
    ]);
  });

  it("should report the directive only while it is about the attached agent", async () => {
    // The card draws its pending state from this, so it has to stop reporting
    // the moment a different agent takes over the presence record.
    await attachAgent({ writerId: "1111111111111111" });
    expect((await ask({ path: "/api/agent-disconnect" })).status).toBe(200);
    const own: unknown = await (
      await ask({ path: "/api/agent", method: "GET" })
    ).json();
    expect(own).toMatchObject({
      presence: { disconnectRequestedAtMs: expect.any(Number) },
    });
    await attachAgent({ writerId: "2222222222222222" });
    const next: unknown = await (
      await ask({ path: "/api/agent", method: "GET" })
    ).json();
    expect(next).toMatchObject({ presence: { connected: true } });
    expect(next).not.toMatchObject({
      presence: { disconnectRequestedAtMs: expect.any(Number) },
    });
  });

  it("should decide who to disconnect under the plan's claim gate", async () => {
    /*
    The window this closes: the route reads presence and the exchange, sees no
    claim yet, and writes a directive naming only the loop's writer id - while
    the loop claims in between. `agent note` and `agent respond` know only their
    pickup token, so that directive would never reach them and the agent the
    reviewer just disconnected would keep working (BIG-190).

    Holding the gate the claim path takes proves the route waits for it rather
    than reading around it.
    */
    await attachAgent({ writerId: "5555555555555555" });
    const gate = holdPlanClaimLock(disconnected);
    await gate.acquired;
    let settled = false;
    const disconnecting = ask({ path: "/api/agent-disconnect" }).then(
      (response) => {
        settled = true;
        return response;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).toBe(false);
    await gate.release();
    expect((await disconnecting).status).toBe(200);
  });

  it("should record the end as one the reviewer asked for", async () => {
    // The distinction the connection log exists to keep: an end somebody asked
    // for, named as such, rather than a gap Big Plan inferred from silence
    // (BIG-156). The reason survives the agent's acknowledgment, because the
    // runtime's connection check reads it after the agent has already gone.
    await attachAgent({ writerId: "4444444444444444" });
    const lastEdge = async () =>
      (
        await readAgentConnectionEvents({
          store: disconnected.store,
          sessionId: disconnected.sessionId,
        })
      ).at(-1);
    // The runtime writes an edge only when the state changes, so the connection
    // has to be observed before it can be observed ending.
    await vi.waitFor(
      async () => expect(await lastEdge()).toMatchObject({ connected: true }),
      { timeout: 8_000, interval: 100 },
    );
    expect((await ask({ path: "/api/agent-disconnect" })).status).toBe(200);
    await writeAgentHeartbeatEnded({
      store: disconnected.store,
      sessionId: disconnected.sessionId,
      writerId: "4444444444444444",
    });
    await vi.waitFor(
      async () =>
        expect(await lastEdge()).toMatchObject({
          connected: false,
          reason: AGENT_DISCONNECTED_REASON,
        }),
      { timeout: 8_000, interval: 100 },
    );
  }, 15_000);

  it("should return the work the disconnected agent held to the queue", async () => {
    // The reviewer asked the agent to leave, not for their own message to be
    // thrown away: the claim goes and the request stays.
    const sent = await ask({
      path: "/api/agent-requests",
      body: { kind: "chat", body: "Why this ordering?" },
    });
    expect(sent.status).toBe(200);
    const pending = nextPendingAgentRequest(
      await readAgentExchange({
        store: disconnected.store,
        sessionId: disconnected.sessionId,
        planId: disconnected.planId,
      }),
      { claimedBy: "aaaaaaaaaaaaaaaa", nowMs: Date.now() },
    );
    if (pending === undefined)
      throw new Error("The chat request was not stored");
    await claimAgentRequest({
      store: disconnected.store,
      activeSessionId: disconnected.sessionId,
      requestId: pending.requestId,
      claimedBy: "aaaaaaaaaaaaaaaa",
      baselineSnapshot: pending.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await attachAgent({
      writerId: "3333333333333333",
      state: "working",
      requestId: pending.requestId,
    });
    const response = await ask({ path: "/api/agent-disconnect" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      releasedRequestIds: [pending.requestId],
    });
    // One entry per disconnected agent, so the earlier ones can still answer
    // the agents they addressed.
    // This claim declares no connection of its own, and presence names the very
    // request it holds - the proof that presence is describing the holder - so
    // the review's writer id answers for it.
    await expect(
      readAgentDisconnectRequestFor({
        store: disconnected.store,
        writerId: "3333333333333333",
      }),
    ).resolves.toMatchObject({ requestedAtMs: expect.any(Number) });
    const after = await readAgentExchange({
      store: disconnected.store,
      sessionId: disconnected.sessionId,
      planId: disconnected.planId,
    });
    const released = after.requests.find(
      (candidate) => candidate.requestId === pending.requestId,
    );
    expect(released).toMatchObject({ requestId: pending.requestId });
    expect(released?.claimedBy).toBeUndefined();
    expect(released?.canceledAt).toBeUndefined();
  });

  it("should disconnect the agent holding work and leave a bystander attached", async () => {
    /*
    Two agents attached is a state Big Plan supports: one holds the plan's
    single claim while another waits for it. The waiting loop is the one
    writing the heartbeat every half second, so the review's writer id names
    the bystander while the card describes the working agent's turn. Naming
    both on one directive ended both, and the reviewer never saw the second
    (BIG-190).
    */
    const sent = await ask({
      path: "/api/agent-requests",
      body: { kind: "chat", body: "Who is answering this?" },
    });
    expect(sent.status).toBe(200);
    const pending = nextPendingAgentRequest(
      await readAgentExchange({
        store: disconnected.store,
        sessionId: disconnected.sessionId,
        planId: disconnected.planId,
      }),
      { claimedBy: "cccccccccccccccc", nowMs: Date.now() },
    );
    if (pending === undefined)
      throw new Error("The chat request was not stored");
    await claimAgentRequest({
      store: disconnected.store,
      activeSessionId: disconnected.sessionId,
      requestId: pending.requestId,
      claimedBy: "cccccccccccccccc",
      connectionToken: "cccc0000cccc0000",
      baselineSnapshot: pending.premiseSnapshot,
      now: new Date().toISOString(),
    });
    // The bystander's waiting loop, which is what the presence record names.
    await attachAgent({ writerId: "8888888888888888" });
    const edges = async () =>
      readAgentConnectionEvents({
        store: disconnected.store,
        sessionId: disconnected.sessionId,
      });
    // The log has to be describing the bystander's live connection before this
    // disconnect can be seen changing what it says.
    await vi.waitFor(
      async () =>
        expect((await edges()).at(-1)).toMatchObject({ connected: true }),
      { timeout: 8_000, interval: 100 },
    );
    const edgesBefore = await edges();
    expect((await ask({ path: "/api/agent-disconnect" })).status).toBe(200);
    await expect(
      readAgentDisconnectRequestFor({
        store: disconnected.store,
        writerId: "cccc0000cccc0000",
      }),
    ).resolves.toMatchObject({ requestedAtMs: expect.any(Number) });
    await expect(
      readAgentDisconnectRequestFor({
        store: disconnected.store,
        writerId: "8888888888888888",
      }),
    ).resolves.toBeUndefined();
    // The bystander is still attached and was told nothing.
    await expect(
      readAgentPresence({
        store: disconnected.store,
        sessionId: disconnected.sessionId,
      }),
    ).resolves.toMatchObject({
      connected: true,
      writerId: "8888888888888888",
    });
    /*
    And the reviewer's decision is stated, not inferred.

    The ordinary edge cannot state it here: presence goes on describing the
    bystander, healthy and connected, long after the addressee has gone, so
    waiting for that edge reports a disconnect the reviewer asked for as
    nothing at all. The row is asserted by its reason rather than by being
    last, because the checker keeps describing the bystander's live connection
    afterwards (BIG-156, BIG-190). It is asserted over what this disconnect
    added rather than over the whole log, because earlier ends this session
    recorded would answer for it and the row would prove nothing.
    */
    expect((await edges()).slice(edgesBefore.length)).toContainEqual(
      expect.objectContaining({
        connected: false,
        reason: AGENT_DISCONNECTED_REASON,
      }),
    );
  }, 15_000);

  it("should state the reported end after disconnecting a working agent", async () => {
    /*
    The main path, and the one an address that does not outlive the decision
    loses. The agent is healthy, signalling, and holding work; disconnecting
    frees the review by releasing that claim at once, so a directive addressed
    to the pickup would be unresolvable a millisecond later and the reviewer's
    own decision would come back to them as silence (BIG-156, BIG-190).
    */
    const sent = await ask({
      path: "/api/agent-requests",
      body: { kind: "chat", body: "Is this ordering settled?" },
    });
    expect(sent.status).toBe(200);
    const pending = nextPendingAgentRequest(
      await readAgentExchange({
        store: disconnected.store,
        sessionId: disconnected.sessionId,
        planId: disconnected.planId,
      }),
      { claimedBy: "dddddddddddddddd", nowMs: Date.now() },
    );
    if (pending === undefined)
      throw new Error("The chat request was not stored");
    await claimAgentRequest({
      store: disconnected.store,
      activeSessionId: disconnected.sessionId,
      requestId: pending.requestId,
      claimedBy: "dddddddddddddddd",
      connectionToken: "9999999999999999",
      baselineSnapshot: pending.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await attachAgent({
      writerId: "9999999999999999",
      state: "working",
      requestId: pending.requestId,
    });
    const lastEdge = async () =>
      (
        await readAgentConnectionEvents({
          store: disconnected.store,
          sessionId: disconnected.sessionId,
        })
      ).at(-1);
    await vi.waitFor(
      async () => expect(await lastEdge()).toMatchObject({ connected: true }),
      { timeout: 8_000, interval: 100 },
    );
    const response = await ask({ path: "/api/agent-disconnect" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      releasedRequestIds: [pending.requestId],
    });
    // The review is free before the agent has noticed, which is the point.
    const after = await readAgentExchange({
      store: disconnected.store,
      sessionId: disconnected.sessionId,
      planId: disconnected.planId,
    });
    expect(
      after.requests.find(
        (candidate) => candidate.requestId === pending.requestId,
      )?.claimedBy,
    ).toBeUndefined();
    // The agent is told at its next command - the one the loop hands itself,
    // carrying its connection token and no pickup token - and ends its own
    // session there rather than taking the freed message back.
    await expect(
      runAgentWorkLoopAction({
        kind: "next",
        planPath: join(disconnectDirectory, "plan.mdx"),
        shouldWait: false,
        executablePath: "bin/big-plan.mjs",
        connectionToken: "9999999999999999",
      }),
    ).resolves.toMatchObject({ ended: true, disconnected: true });
    // The log has to say who ended it, not merely that it ended.
    await vi.waitFor(
      async () =>
        expect(await lastEdge()).toMatchObject({
          connected: false,
          reason: AGENT_DISCONNECTED_REASON,
        }),
      { timeout: 8_000, interval: 100 },
    );
  }, 20_000);

  it("should state the reported end after a stalled agent's silence", async () => {
    /*
    The state a reviewer is most likely to reach for Disconnect in: the agent
    holds a message, has narrated nothing for longer than a turn takes, and the
    log has already written the silence off as a gap. Ending it there has to
    leave the log saying somebody asked for the end, not repeating the guess it
    replaced (BIG-156).
    */
    const sent = await ask({
      path: "/api/agent-requests",
      body: { kind: "chat", body: "Are you still on this?" },
    });
    expect(sent.status).toBe(200);
    const pending = nextPendingAgentRequest(
      await readAgentExchange({
        store: disconnected.store,
        sessionId: disconnected.sessionId,
        planId: disconnected.planId,
      }),
      { claimedBy: "bbbbbbbbbbbbbbbb", nowMs: Date.now() },
    );
    if (pending === undefined)
      throw new Error("The chat request was not stored");
    await claimAgentRequest({
      store: disconnected.store,
      activeSessionId: disconnected.sessionId,
      requestId: pending.requestId,
      claimedBy: "bbbbbbbbbbbbbbbb",
      connectionToken: "7777777777777777",
      baselineSnapshot: pending.premiseSnapshot,
      now: new Date().toISOString(),
    });
    const lastEdge = async () =>
      (
        await readAgentConnectionEvents({
          store: disconnected.store,
          sessionId: disconnected.sessionId,
        })
      ).at(-1);
    await attachAgent({
      writerId: "7777777777777777",
      state: "working",
      requestId: pending.requestId,
    });
    await vi.waitFor(
      async () => expect(await lastEdge()).toMatchObject({ connected: true }),
      { timeout: 8_000, interval: 100 },
    );
    // Nothing renews the plan heartbeat while a turn runs, so an agent that
    // stops narrating ages out of presence while still holding the claim.
    await writeAgentHeartbeat({
      store: disconnected.store,
      sessionId: disconnected.sessionId,
      state: "working",
      requestId: pending.requestId,
      writerId: "7777777777777777",
      now: Date.now() - AGENT_STALL_MS - 5_000,
    });
    await vi.waitFor(
      async () =>
        expect(await lastEdge()).toMatchObject({
          connected: false,
          reason: AGENT_NO_SIGNAL_REASON,
        }),
      { timeout: 8_000, interval: 100 },
    );
    expect((await ask({ path: "/api/agent-disconnect" })).status).toBe(200);
    await vi.waitFor(
      async () =>
        expect(await lastEdge()).toMatchObject({
          connected: false,
          reason: AGENT_DISCONNECTED_REASON,
        }),
      { timeout: 8_000, interval: 100 },
    );
    // The silence was honest when it was written, so it stays; the reported end
    // is recorded after it rather than over it.
    const edges = await readAgentConnectionEvents({
      store: disconnected.store,
      sessionId: disconnected.sessionId,
    });
    expect(edges.at(-2)).toMatchObject({
      connected: false,
      reason: AGENT_NO_SIGNAL_REASON,
    });
  }, 20_000);
});

/**
 * The commit writes its journal before the rename, so a crash can leave one
 * behind for work that never published. Every reviewer control that takes a
 * message back is what someone reaches for then, so each settles that journal
 * before it decides - otherwise a journal nothing is left alive to settle
 * would lock the message for good.
 */
describe("review runtime reviewer controls versus an interrupted commit", () => {
  const strandedJournal = async ({
    runtime: live,
    requestId,
    planPath,
    published,
    claimAtMs,
  }: {
    readonly runtime: ReviewRuntime;
    readonly requestId: string;
    readonly planPath: string;
    readonly published: string;
    /** When the claim last signalled; past the horizon it reads as abandoned. */
    readonly claimAtMs?: number;
  }): Promise<void> => {
    const source = await readFile(planPath, "utf8");
    const request = messageAgentRequest({
      kind: "chat",
      requestId,
      sessionId: live.sessionId,
      planId: live.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-17T12:00:00.000Z",
      body: "Is the plan ready?",
    });
    await writeAgentRequest({ store: live.store, request });
    await writeSnapshot({
      store: live.store,
      snapshot: deriveSnapshotDigest(source),
      source,
    });
    const claimed = await claimAgentRequest({
      store: live.store,
      activeSessionId: live.sessionId,
      requestId,
      claimedBy: live.sessionId,
      baselineSnapshot: deriveSnapshotDigest(source),
      now: "2026-08-17T12:00:01.000Z",
      ...(claimAtMs === undefined ? {} : { clock: () => claimAtMs }),
    });
    await writeStoreJson({
      path: agentMutationJournalPath({ store: live.store, requestId }),
      value: {
        version: 1,
        requestId,
        generation: 1,
        claimedBy: live.sessionId,
        baseSnapshot: deriveSnapshotDigest(source),
        resultSnapshot: deriveSnapshotDigest(published),
        answeredAt: "2026-08-17T12:00:05.000Z",
        response: validateAgentResponseDraft({
          value: { requestId, message: "The plan is ready." },
          request: claimed,
          commentsById: new Map(),
          changedBlocks: new Set<string>(),
          currentSnapshot: deriveSnapshotDigest(published),
          now: "2026-08-17T12:00:05.000Z",
        }),
      },
    });
  };

  const runtimeFor = async (prefix: string) => {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const live = await startReviewRuntime({ planPath });
    const descriptor: unknown = JSON.parse(
      await readFile(live.store.sessionPath, "utf8"),
    );
    const liveToken =
      typeof descriptor === "object" &&
      descriptor !== null &&
      "token" in descriptor &&
      typeof descriptor.token === "string"
        ? descriptor.token
        : "";
    const post = (path: string, body: unknown) =>
      fetch(`${live.url.replace(/\/$/u, "")}${path}`, {
        method: "POST",
        headers: {
          "x-big-plan-review-token": liveToken,
          "sec-fetch-site": "same-origin",
          origin: live.url.replace(/\/$/u, ""),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const cancel = (requestId: string) =>
      post("/api/agent-cancel", { requestId });
    const close = async () => {
      await live.close();
      await rm(directory, { recursive: true, force: true });
    };
    return { live, planPath, cancel, post, close };
  };

  it("should return 503 when reviewer controls cannot read settlement journals", async () => {
    const { live, post, close } = await runtimeFor(
      "big-plan-settlement-unavailable-",
    );
    const journalDirectory = live.store.agentMutationJournalDirectory;
    try {
      const sendChat = async (body: string): Promise<string> => {
        const response = await post("/api/agent-requests", {
          kind: "chat",
          body,
        });
        expect(response.status).toBe(200);
        const value: unknown = await response.json();
        if (
          typeof value !== "object" ||
          value === null ||
          !("requestId" in value) ||
          typeof value.requestId !== "string"
        ) {
          throw new Error("The runtime did not return a request id");
        }
        return value.requestId;
      };
      const reviseId = await sendChat("Revise this queued question.");
      const deleteId = await sendChat("Delete this queued question.");
      const cancelId = await sendChat("Cancel this queued question.");
      const comment = {
        id: "a9a9a9a9",
        body: "Delete this queued comment.",
        premiseSnapshot: PLAN_SNAPSHOT,
        target: { type: "document" as const },
      };
      const token = await runtimeToken(live);
      expect(
        (
          await post("/api/feedback", {
            comments: [comment],
            version: await draftsVersionOf(live, token),
          })
        ).status,
      ).toBe(200);
      const commentVersion = await draftsVersionOf(live, token);

      await rm(journalDirectory, { recursive: true, force: true });
      await writeFile(journalDirectory, "Journal directory unavailable.");
      const responses = await Promise.all([
        post("/api/agent-requests", {
          kind: "chat",
          requestId: reviseId,
          body: "Use this revised queued question.",
        }),
        post("/api/agent-request-delete", { requestId: deleteId }),
        post("/api/agent-cancel", { requestId: cancelId }),
        post("/api/comments-delete", {
          commentId: comment.id,
          version: commentVersion,
        }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
          error:
            "The interrupted-commit journals could not be read, so an interrupted plan commit cannot be settled",
        });
      }
      const exchange = await readAgentExchange({
        store: live.store,
        sessionId: live.sessionId,
        planId: live.planId,
      });
      expect(
        exchange.requests.find((request) => request.requestId === reviseId),
      ).toMatchObject({ body: "Revise this queued question." });
      expect(
        exchange.requests.find((request) => request.requestId === deleteId),
      ).toBeDefined();
      expect(
        exchange.requests.find((request) => request.requestId === cancelId),
      ).not.toMatchObject({ canceledAt: expect.any(String) });
      await expect(
        readComments({
          path: live.store.sentPath,
          validate: (value) =>
            Array.isArray(value) ? (value as Array<ReviewComment>) : [],
        }),
      ).resolves.toEqual([expect.objectContaining({ id: comment.id })]);
    } finally {
      await rm(journalDirectory, { recursive: true, force: true });
      await mkdir(journalDirectory, { recursive: true });
      await close();
    }
  });

  it("should cancel through a journal whose rename never ran", async () => {
    const { live, planPath, cancel, close } = await runtimeFor(
      "big-plan-cancel-stranded-",
    );
    const requestId = "abababababababab";
    try {
      // The plan never moved, so nothing this journal describes was published.
      await strandedJournal({
        runtime: live,
        requestId,
        planPath,
        published: `${PLAN}\nA revision that never landed.\n`,
      });

      expect((await cancel(requestId)).status).toBe(200);
      const exchange = await readAgentExchange({
        store: live.store,
        sessionId: live.sessionId,
        planId: live.planId,
      });
      expect(
        exchange.requests.find((candidate) => candidate.requestId === requestId)
          ?.canceledAt,
      ).toBeDefined();
      await expect(
        readdir(live.store.agentMutationJournalDirectory),
      ).resolves.toEqual([]);
      await expect(readFile(planPath, "utf8")).resolves.toBe(PLAN);
    } finally {
      await close();
    }
  });

  it("should delete an abandoned message through a journal whose rename never ran", async () => {
    const { live, planPath, post, close } = await runtimeFor(
      "big-plan-delete-stranded-",
    );
    const requestId = "efefefefefefefef";
    try {
      await strandedJournal({
        runtime: live,
        requestId,
        planPath,
        published: `${PLAN}\nA revision that never landed.\n`,
        claimAtMs: Date.now() - AGENT_RECOVERY_HORIZON_MS - 1,
      });

      expect(
        (await post("/api/agent-request-delete", { requestId })).status,
      ).toBe(200);
      const exchange = await readAgentExchange({
        store: live.store,
        sessionId: live.sessionId,
        planId: live.planId,
      });
      expect(
        exchange.requests.some(
          (candidate) => candidate.requestId === requestId,
        ),
      ).toBe(false);
      await expect(
        readdir(live.store.agentMutationJournalDirectory),
      ).resolves.toEqual([]);
      await expect(readFile(planPath, "utf8")).resolves.toBe(PLAN);
    } finally {
      await close();
    }
  });

  it("should revise an abandoned message through a journal whose rename never ran", async () => {
    const { live, planPath, post, close } = await runtimeFor(
      "big-plan-revise-stranded-",
    );
    const requestId = "0a0a0a0a0a0a0a0a";
    try {
      await strandedJournal({
        runtime: live,
        requestId,
        planPath,
        published: `${PLAN}\nA revision that never landed.\n`,
        claimAtMs: Date.now() - AGENT_RECOVERY_HORIZON_MS - 1,
      });

      expect(
        (
          await post("/api/agent-requests", {
            kind: "chat",
            requestId,
            body: "Ask something else instead.",
          })
        ).status,
      ).toBe(200);
      const exchange = await readAgentExchange({
        store: live.store,
        sessionId: live.sessionId,
        planId: live.planId,
      });
      expect(
        exchange.requests.find(
          (candidate) => candidate.requestId === requestId,
        ),
      ).toMatchObject({ body: "Ask something else instead." });
      await expect(
        readdir(live.store.agentMutationJournalDirectory),
      ).resolves.toEqual([]);
      await expect(readFile(planPath, "utf8")).resolves.toBe(PLAN);
    } finally {
      await close();
    }
  });

  it("should refuse a cancel once that journal's rename won", async () => {
    const { live, planPath, cancel, close } = await runtimeFor(
      "big-plan-cancel-published-",
    );
    const requestId = "cdcdcdcdcdcdcdcd";
    const published = `${PLAN}\nThe published revision.\n`;
    try {
      await strandedJournal({ runtime: live, requestId, planPath, published });
      // The rename won before the crash, so the answer really is published.
      await writeFile(planPath, published);

      expect((await cancel(requestId)).status).toBe(409);
      const exchange = await readAgentExchange({
        store: live.store,
        sessionId: live.sessionId,
        planId: live.planId,
      });
      const settled = exchange.requests.find(
        (candidate) => candidate.requestId === requestId,
      );
      expect(settled?.canceledAt).toBeUndefined();
      expect(settled?.answeredAt).toBeDefined();
      await expect(readFile(planPath, "utf8")).resolves.toBe(published);
    } finally {
      await close();
    }
  });
});

describe("review runtime approval", () => {
  const withApprovalRuntime = async (
    source: string,
    work: (context: {
      readonly target: ReviewRuntime;
      readonly sessionToken: string;
      readonly planPath: string;
      readonly digest: string;
    }) => Promise<void>,
  ): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, source);
    const target = await startReviewRuntime({ planPath });
    try {
      await work({
        target,
        sessionToken: await runtimeToken(target),
        planPath,
        digest: deriveSnapshotDigest(source),
      });
    } finally {
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  };

  const approve = (
    target: ReviewRuntime,
    sessionToken: string,
    body: unknown,
  ) =>
    callRuntime({
      target,
      sessionToken,
      path: "/api/approve",
      method: "POST",
      body,
    });

  const approvalProgress = async (
    target: ReviewRuntime,
    sessionToken: string,
  ): Promise<ReadonlyArray<Record<string, unknown>>> => {
    const response = await callRuntime({
      target,
      sessionToken,
      path: "/api/progress",
    });
    const body = (await response.json()) as {
      readonly events: ReadonlyArray<Record<string, unknown>>;
    };
    return body.events;
  };

  it("writes the approval record, pins the digest, and survives a reread", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        expect(
          (
            await callRuntime({
              target,
              sessionToken,
              path: "/api/inputs",
              method: "POST",
              body: {
                op: "stage",
                answer: {
                  decisionId: DECISION_ID,
                  optionId: GRADUAL_OPTION_ID,
                  optionTitle: "Gradual rollout",
                  prompt: "Which release path should we use?",
                  premiseSnapshot: digest,
                },
              },
            })
          ).status,
        ).toBe(200);

        const response = await approve(target, sessionToken, {
          expectedSnapshot: digest,
          message: "Start on it now.",
        });
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(body).toMatchObject({
          pinnedSnapshot: digest,
          canceledRequests: 0,
          delivered: true,
          approval: { status: "approved", pinnedSnapshot: digest },
        });

        const stored: unknown = JSON.parse(
          await readFile(target.store.approvalPath, "utf8"),
        );
        expect(stored).toMatchObject({
          version: 1,
          entries: [
            {
              kind: "approval",
              pinnedSnapshot: digest,
              agentConnected: false,
              message: "Start on it now.",
              recordedAnswers: [
                {
                  decisionId: DECISION_ID,
                  optionTitle: "Gradual rollout",
                },
              ],
            },
          ],
        });

        const session = await (
          await callRuntime({ target, sessionToken, path: "/api/session" })
        ).json();
        expect(session).toMatchObject({
          approval: { status: "approved", pinnedSnapshot: digest },
        });

        const exported = await callRuntime({
          target,
          sessionToken,
          path: "/api/export-markdown",
        });
        const approvedMarkdown = await exported.text();
        expect(approvedMarkdown).toContain("### Approval summary");
        expect(approvedMarkdown).toContain("Start on it now.");

        await writeFile(
          target.planPath,
          DECISION_PLAN.replace(
            "The rollback runbook stays unchanged.",
            "The rollback runbook now names an owner.",
          ),
        );
        const changed = await callRuntime({
          target,
          sessionToken,
          path: "/api/export-markdown",
        });
        expect(await changed.text()).not.toContain("### Approval summary");
      },
    );
  });

  it("refuses a digest that no longer matches the source", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken }) => {
        const response = await approve(target, sessionToken, {
          expectedSnapshot: "ffffffffffffffff",
          message: "Start on it now.",
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
          code: "plan-changed",
        });
      },
    );
  });

  it("refuses unanswered critical decisions", async () => {
    const criticalPlan = DECISION_PLAN.replace(
      '<Decision question="Which release path should we use?">',
      '<Decision critical question="Which release path should we use?">',
    );
    await withApprovalRuntime(
      criticalPlan,
      async ({ target, sessionToken, digest }) => {
        await writeAgentRequest({
          store: target.store,
          request: messageAgentRequest({
            sessionId: target.sessionId,
            planId: target.planId,
            requestId: "cccccccccccccccc",
            kind: "chat",
            body: "Keep this request open.",
            premiseSnapshot: digest,
            createdAt: "2026-08-19T17:00:00.000Z",
          }),
        });
        const response = await approve(target, sessionToken, {
          expectedSnapshot: digest,
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
          code: "critical-unanswered",
          blockingDecisionIds: [DECISION_ID],
        });
        const exchange = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        expect(exchange.requests[0]?.canceledAt).toBeUndefined();
      },
    );
  });

  it("writes the approval brief beside the feedback briefs", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest, planPath }) => {
        const approved = await approve(target, sessionToken, {
          expectedSnapshot: digest,
          message: "Start on it now.",
        });
        expect(approved.status).toBe(200);
        const { approvalId } = (await approved.json()) as {
          readonly approvalId: string;
        };
        const written = (await readdir(target.store.feedbackDirectory)).filter(
          (name) => name.endsWith(`-approval-${approvalId}.md`),
        );
        expect(written).toHaveLength(1);
        const brief = await readFile(
          join(target.store.feedbackDirectory, written[0] ?? ""),
          "utf8",
        );
        expect(brief).toContain(planPath);
        expect(brief).toContain(digest);
        expect(brief).toContain("Start on it now.");
      },
    );
  });

  it("refuses a second approve of the same snapshot", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        expect(
          (await approve(target, sessionToken, { expectedSnapshot: digest }))
            .status,
        ).toBe(200);
        const again = await approve(target, sessionToken, {
          expectedSnapshot: digest,
        });
        expect(again.status).toBe(409);
        await expect(again.json()).resolves.toMatchObject({
          code: "already-approved",
        });
      },
    );
  });

  it("revokes the in-force approval", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        const approved = await approve(target, sessionToken, {
          expectedSnapshot: digest,
        });
        const body = (await approved.json()) as {
          readonly approvalId: string;
        };
        const revoked = await callRuntime({
          target,
          sessionToken,
          path: "/api/revoke-approval",
          method: "POST",
          body: { approvalId: body.approvalId },
        });
        expect(revoked.status).toBe(200);
        const session = (await (
          await callRuntime({ target, sessionToken, path: "/api/session" })
        ).json()) as { readonly approval?: unknown };
        expect(session.approval).toBeUndefined();
        const exchange = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        expect(
          exchange.requests.find(
            (request) => request.requestId === body.approvalId,
          )?.canceledAt,
        ).toBeDefined();
        expect(outstandingAgentRequests(exchange)).toEqual([]);
      },
    );
  });

  it("reports an undelivered handoff instead of implying the agent has it", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        // A mailbox nothing can be written into: the record still commits, so
        // the answer has to say the agent was never handed the approval.
        await chmod(target.store.agentRequestDirectory, 0o500);
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation(() => true);
        try {
          const approved = await approve(target, sessionToken, {
            expectedSnapshot: digest,
          });
          expect(approved.status).toBe(200);
          await expect(approved.json()).resolves.toMatchObject({
            delivered: false,
            approval: { status: "approved" },
          });
        } finally {
          stderr.mockRestore();
          await chmod(target.store.agentRequestDirectory, 0o700);
        }
        const exchange = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        expect(exchange.requests).toEqual([]);
        // The claim of delivery must not come back on the next load: the
        // session route answers every reader, including a second tab.
        const session = await (
          await callRuntime({ target, sessionToken, path: "/api/session" })
        ).json();
        expect(session).toMatchObject({
          approval: { status: "approved", delivered: false },
        });
        await recoverApprovalFinalization({
          store: target.store,
          planPath: target.planPath,
        });
        const recovered = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        expect(recovered.requests).toHaveLength(1);
        expect(recovered.requests[0]).toMatchObject({ kind: "approval" });
        await expect(
          readFile(target.store.approvalFinalizationPath, "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
  });

  it("does not recover a handoff after its approval was revoked", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        await chmod(target.store.agentRequestDirectory, 0o500);
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation(() => true);
        let approvalId = "";
        try {
          const approved = await approve(target, sessionToken, {
            expectedSnapshot: digest,
          });
          ({ approvalId } = (await approved.json()) as {
            readonly approvalId: string;
          });
        } finally {
          stderr.mockRestore();
          await chmod(target.store.agentRequestDirectory, 0o700);
        }
        const revoked = await callRuntime({
          target,
          sessionToken,
          path: "/api/revoke-approval",
          method: "POST",
          body: { approvalId },
        });
        expect(revoked.status).toBe(200);

        await recoverApprovalFinalization({
          store: target.store,
          planPath: target.planPath,
        });

        const exchange = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        expect(exchange.requests).toEqual([]);
        const session = await (
          await callRuntime({ target, sessionToken, path: "/api/session" })
        ).json();
        expect(session).not.toHaveProperty("approval");
      },
    );
  });

  it("preserves an answered handoff when recovery repeats delivery", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        await chmod(target.store.agentRequestDirectory, 0o500);
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation(() => true);
        let approvalId = "";
        let journal = "";
        try {
          const approved = await approve(target, sessionToken, {
            expectedSnapshot: digest,
          });
          ({ approvalId } = (await approved.json()) as {
            readonly approvalId: string;
          });
          journal = await readFile(
            target.store.approvalFinalizationPath,
            "utf8",
          );
        } finally {
          stderr.mockRestore();
          await chmod(target.store.agentRequestDirectory, 0o700);
        }
        await recoverApprovalFinalization({
          store: target.store,
          planPath: target.planPath,
        });
        const claimed = await claimAgentRequest({
          store: target.store,
          requestId: approvalId,
          claimedBy: target.sessionId,
          baselineSnapshot: digest,
          now: new Date().toISOString(),
        });
        await commitRequestTerminal({
          store: target.store,
          claimedBy: target.sessionId,
          response: validateAgentResponseDraft({
            value: { requestId: approvalId },
            request: claimed,
            commentsById: new Map(),
            changedBlocks: new Set(),
            currentSnapshot: digest,
            now: new Date().toISOString(),
          }),
          now: new Date().toISOString(),
        });
        await writeFile(target.store.approvalFinalizationPath, journal);

        await recoverApprovalFinalization({
          store: target.store,
          planPath: target.planPath,
        });

        const exchange = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        expect(exchange.requests).toHaveLength(1);
        expect(exchange.requests[0]).toMatchObject({
          requestId: approvalId,
          answeredAt: expect.any(String),
        });
        expect(exchange.responses).toHaveLength(1);
      },
    );
  });

  it("settles a revoke of an approval the agent already answered", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        const approved = await approve(target, sessionToken, {
          expectedSnapshot: digest,
        });
        const { approvalId } = (await approved.json()) as {
          readonly approvalId: string;
        };
        const claimed = await claimAgentRequest({
          store: target.store,
          requestId: approvalId,
          claimedBy: target.sessionId,
          baselineSnapshot: digest,
          now: new Date().toISOString(),
        });
        await commitRequestTerminal({
          store: target.store,
          claimedBy: target.sessionId,
          response: validateAgentResponseDraft({
            value: { requestId: approvalId },
            request: claimed,
            commentsById: new Map(),
            changedBlocks: new Set(),
            currentSnapshot: digest,
            now: new Date().toISOString(),
          }),
          now: new Date().toISOString(),
        });
        const reported: Array<string> = [];
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation((chunk: unknown) => {
            reported.push(String(chunk));
            return true;
          });
        try {
          const revoked = await callRuntime({
            target,
            sessionToken,
            path: "/api/revoke-approval",
            method: "POST",
            body: { approvalId },
          });
          expect(revoked.status).toBe(200);
        } finally {
          stderr.mockRestore();
        }
        await expect(approvalProgress(target, sessionToken)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              requestId: approvalId,
              stepCode: "plan-approved",
            }),
            expect.objectContaining({
              requestId: approvalId,
              stepCode: "approval-acknowledged",
              step: "Approval acknowledged",
            }),
          ]),
        );
        // Nothing failed: the acknowledgment is in, so there was never a
        // handoff left to withdraw.
        expect(reported.join("")).not.toContain(
          "The approval handoff could not be canceled after revoking",
        );
        const settled = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        expect(
          settled.requests.find((request) => request.requestId === approvalId),
        ).toMatchObject({ answeredAt: expect.any(String) });
      },
    );
  });

  it("reports a handoff it could not cancel because the answer is publishing", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        const approved = await approve(target, sessionToken, {
          expectedSnapshot: digest,
        });
        const { approvalId } = (await approved.json()) as {
          readonly approvalId: string;
        };
        // The journal the commit writes under the request lock is what tells
        // every reviewer control the answer is no longer theirs to withdraw.
        await mkdir(target.store.agentMutationJournalDirectory, {
          recursive: true,
        });
        await writeFile(
          agentMutationJournalPath({
            store: target.store,
            requestId: approvalId,
          }),
          "{}",
        );
        const reported: Array<string> = [];
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation((chunk: unknown) => {
            reported.push(String(chunk));
            return true;
          });
        try {
          const revoked = await callRuntime({
            target,
            sessionToken,
            path: "/api/revoke-approval",
            method: "POST",
            body: { approvalId },
          });
          expect(revoked.status).toBe(200);
        } finally {
          stderr.mockRestore();
        }
        expect(reported.join("")).toContain(
          "The approval handoff could not be canceled after revoking",
        );
        const exchange = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        expect(
          exchange.requests.find((request) => request.requestId === approvalId)
            ?.canceledAt,
        ).toBeUndefined();
      },
    );
  });

  it("cancels open agent requests on approve", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest, planPath }) => {
        await writeAgentRequest({
          store: target.store,
          request: messageAgentRequest({
            sessionId: target.sessionId,
            planId: target.planId,
            requestId: "aaaaaaaaaaaaaaaa",
            kind: "chat",
            body: "Please look at the retry queue.",
            premiseSnapshot: digest,
            createdAt: "2026-08-19T17:00:00.000Z",
          }),
        });
        const response = await approve(target, sessionToken, {
          expectedSnapshot: digest,
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          canceledRequests: 1,
        });
        const exchange = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        const chat = exchange.requests.find(
          (request) => request.requestId === "aaaaaaaaaaaaaaaa",
        );
        expect(chat?.canceledAt).toBeDefined();
        const pending = outstandingAgentRequests(exchange);
        expect(pending).toHaveLength(1);
        expect(pending[0]).toMatchObject({
          kind: "approval",
          planPath,
          pinnedSnapshot: digest,
        });
      },
    );
  });

  it("leaves the approval request waiting when no agent is connected", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest, planPath }) => {
        expect(
          (await approve(target, sessionToken, { expectedSnapshot: digest }))
            .status,
        ).toBe(200);
        const exchange = await readAgentExchange({
          store: target.store,
          sessionId: target.sessionId,
          planId: target.planId,
        });
        const pending = outstandingAgentRequests(exchange);
        expect(pending).toHaveLength(1);
        expect(pending[0]).toMatchObject({
          kind: "approval",
          planPath,
          pinnedSnapshot: digest,
        });
        expect(pending[0]?.answeredAt).toBeUndefined();
        expect(pending[0]?.canceledAt).toBeUndefined();
        const progress = await approvalProgress(target, sessionToken);
        expect(progress.at(-1)).toMatchObject({
          requestId: pending[0]?.requestId,
          stepCode: "plan-approved",
          step: "Plan approved",
          detail: "Approval recorded - no agent connected to notify",
        });
      },
    );
  });

  it("should derive agentless approval Chat when presence is malformed", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        await writeFile(target.store.agentHeartbeatPath, "{");
        const response = await approve(target, sessionToken, {
          expectedSnapshot: digest,
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          delivered: true,
          approval: { status: "approved", pinnedSnapshot: digest },
        });
        const progress = await approvalProgress(target, sessionToken);
        expect(progress.at(-1)).toMatchObject({
          stepCode: "plan-approved",
          step: "Plan approved",
          detail: "Approval recorded - no agent connected to notify",
        });
        const stored: unknown = JSON.parse(
          await readFile(target.store.approvalPath, "utf8"),
        );
        expect(stored).toMatchObject({
          entries: [
            expect.objectContaining({
              kind: "approval",
              pinnedSnapshot: digest,
            }),
          ],
        });
      },
    );
  });

  it("should derive approval Chat when progress storage is unwritable", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest }) => {
        await writeFile(target.store.progressPath, "");
        await chmod(target.store.progressPath, 0o400);
        try {
          const response = await approve(target, sessionToken, {
            expectedSnapshot: digest,
          });
          expect(response.status).toBe(200);
        } finally {
          await chmod(target.store.progressPath, 0o600);
        }
        await expect(approvalProgress(target, sessionToken)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              stepCode: "plan-approved",
              detail: "Approval recorded - no agent connected to notify",
            }),
          ]),
        );
      },
    );
  });

  it("accepts every open change set as part of approval", async () => {
    await withApprovalRuntime(
      DECISION_PLAN,
      async ({ target, sessionToken, digest, planPath }) => {
        const requestId = "dddddddddddddddd";
        const request = messageAgentRequest({
          sessionId: target.sessionId,
          planId: target.planId,
          requestId,
          kind: "chat",
          body: "Clarify the rollback owner.",
          premiseSnapshot: digest,
          createdAt: "2026-08-19T17:00:00.000Z",
        });
        await writeAgentRequest({ store: target.store, request });
        const claimed = await claimAgentRequest({
          store: target.store,
          activeSessionId: target.sessionId,
          requestId,
          claimedBy: target.sessionId,
          baselineSnapshot: digest,
          now: "2026-08-19T17:00:01.000Z",
        });
        const published = `${DECISION_PLAN}\nThe rollback owner is the release captain.\n`;
        const publishedDigest = deriveSnapshotDigest(published);
        await writeFile(planPath, published);
        await writeSnapshot({
          store: target.store,
          snapshot: publishedDigest,
          source: published,
        });
        await commitRequestTerminal({
          store: target.store,
          claimedBy: target.sessionId,
          response: validateAgentResponseDraft({
            value: { requestId, message: "Named the rollback owner." },
            request: claimed,
            commentsById: new Map(),
            changedBlocks: new Set(),
            currentSnapshot: publishedDigest,
            now: "2026-08-19T17:00:02.000Z",
          }),
          now: "2026-08-19T17:00:02.000Z",
        });

        const response = await approve(target, sessionToken, {
          expectedSnapshot: publishedDigest,
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          approval: {
            openItemCounts: {
              changeSetsAccepted: 1,
              changeSetsTotal: 1,
            },
          },
        });
        const verdicts = await callRuntime({
          target,
          sessionToken,
          path: "/api/change-verdicts",
        });
        await expect(verdicts.json()).resolves.toMatchObject({
          accepted: [
            expect.objectContaining({ from: digest, to: publishedDigest }),
          ],
        });
      },
    );
  });
});
