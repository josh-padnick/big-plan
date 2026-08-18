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
import {
  agentMutationJournalPath,
  writeAgentResponseValue,
  writeStoreJson,
} from "./store.js";
import {
  prepareReviewImageAssets,
  publishPreparedPlanAssets,
} from "./plan-assets.js";
import {
  DEFAULT_REVIEW_IDLE_TIMEOUT_MS,
  startReviewRuntime,
} from "./server.js";
import type { ReviewRuntime } from "./server.js";
import {
  reviewSessionIsRunning,
  stopReviewSessionIfInactive,
} from "./session-authority.js";
import type { ReviewComment } from "./shared/comment.js";
import { validateResolvedCommentIds } from "./shared/comment.js";
import { AGENT_RECOVERY_HORIZON_MS } from "./shared/agent-timing.js";
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
    const probe = await startReviewRuntime({ planPath });
    const sessionPath = probe.store.sessionPath;
    await probe.close();
    // A directory in place of the descriptor is a write this runtime cannot do.
    await rm(sessionPath, { force: true });
    await mkdir(sessionPath);
    // A closed listener leaves the event loop one timer turn later, so the
    // count is read after that turn rather than in the same one.
    await new Promise((settle) => setTimeout(settle, 25));
    const before = listeningSockets();
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
      await expect(served.json()).resolves.toMatchObject({ answers: [] });
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
