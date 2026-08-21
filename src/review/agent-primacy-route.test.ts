// Proves the reviewer's half of the primacy hand-off over the wire it actually
// travels on.
//
// The rules live in shared/agent-primacy.test.ts and the store's behavior in
// agent-roster.test.ts. What only this layer can answer is whether the answer
// a reviewer clicks reaches those rules intact: what the route refuses, what it
// moves, and - the part no unit can see - that a hand-off which cannot complete
// leaves the plan with an agent still speaking for it rather than none.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveSnapshotDigest,
  messageAgentRequest,
  readAgentExchange,
  writeAgentRequest,
} from "./agent-exchange.js";
import { claimAgentRequest } from "./request-mailbox.js";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
import {
  attachAgentToRoster,
  readAgentDisconnectRequestFor,
  readAgentRoster,
  recordAgentClaimToken,
  writeAgentHeartbeat,
} from "./store.js";
import * as reviewStore from "./store.js";
import { selectPrimaryAgent } from "./shared/agent-primacy.js";
import { AGENT_STALL_MS } from "./shared/agent-timing.js";
import type { AttachedAgent } from "./shared/agent-primacy.js";

const PLAN = `# Two agents plan

One agent answers this review at a time.

## Status quo

Two connectors have attached to the same review.
`;

const open: Array<{
  readonly runtime: ReviewRuntime;
  readonly directory: string;
}> = [];

const startReview = async (): Promise<{
  readonly runtime: ReviewRuntime;
  readonly token: string;
}> => {
  const directory = await mkdtemp(join(tmpdir(), "bp-primacy-route-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  open.push({ runtime, directory });
  const descriptor: unknown = JSON.parse(
    await readFile(runtime.store.sessionPath, "utf8"),
  );
  const token =
    typeof descriptor === "object" &&
    descriptor !== null &&
    "token" in descriptor &&
    typeof descriptor.token === "string"
      ? descriptor.token
      : "";
  return { runtime, token };
};

afterEach(async () => {
  await Promise.all(
    open.splice(0).map(async ({ runtime, directory }) => {
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

const answerPrimacy = ({
  runtime,
  token,
  body,
}: {
  readonly runtime: ReviewRuntime;
  readonly token: string;
  readonly body: unknown;
}): Promise<Response> =>
  fetch(`${runtime.url.replace(/\/$/u, "")}/api/agent-primacy`, {
    method: "POST",
    headers: {
      "x-big-plan-review-token": token,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

const disconnectAgent = ({
  runtime,
  token,
}: {
  readonly runtime: ReviewRuntime;
  readonly token: string;
}): Promise<Response> =>
  fetch(`${runtime.url.replace(/\/$/u, "")}/api/agent-disconnect`, {
    method: "POST",
    headers: { "x-big-plan-review-token": token },
  });

/** Attaches one agent and hands back the identity the roster gave it. */
const attach = async ({
  runtime,
  writerId,
  now,
}: {
  readonly runtime: ReviewRuntime;
  readonly writerId: string;
  readonly now?: number;
}): Promise<AttachedAgent> => {
  const { agent } = await attachAgentToRoster({
    store: runtime.store,
    sessionId: runtime.sessionId,
    writerId,
    ...(now === undefined ? {} : { now }),
  });
  return agent;
};

const rosterOf = (
  runtime: ReviewRuntime,
): Promise<ReadonlyArray<AttachedAgent>> =>
  readAgentRoster({ store: runtime.store, sessionId: runtime.sessionId });

describe("the reviewer's primacy answer over the wire", () => {
  it("should report a failed roster read and leave every card attached", async () => {
    const { runtime, token } = await startReview();
    await attach({ runtime, writerId: "1111111111111111" });
    await attach({ runtime, writerId: "2222222222222222" });
    await writeAgentHeartbeat({
      store: runtime.store,
      sessionId: runtime.sessionId,
      state: "waiting",
      writerId: "1111111111111111",
    });
    const rosterRead = vi
      .spyOn(reviewStore, "readAgentRoster")
      .mockRejectedValueOnce(new Error("roster read failed"));

    try {
      const response = await disconnectAgent({ runtime, token });

      expect(response.status).toBe(500);
    } finally {
      rosterRead.mockRestore();
    }
    await expect(
      readAgentDisconnectRequestFor({
        store: runtime.store,
        writerId: "1111111111111111",
      }),
    ).resolves.toBeUndefined();
    await expect(rosterOf(runtime)).resolves.toEqual([
      expect.objectContaining({
        writerId: "1111111111111111",
        role: "primary",
      }),
      expect.objectContaining({
        writerId: "2222222222222222",
        role: "observer",
      }),
    ]);
  });

  it("should report a failed durable disconnect and leave every card attached", async () => {
    const { runtime, token } = await startReview();
    await attach({ runtime, writerId: "primary0" });
    await attach({ runtime, writerId: "observer" });
    await writeAgentHeartbeat({
      store: runtime.store,
      sessionId: runtime.sessionId,
      state: "waiting",
      writerId: "primary0",
    });
    await writeFile(runtime.store.agentRosterLockPath, "unavailable", "utf8");

    try {
      const response = await disconnectAgent({ runtime, token });

      expect(response.status).toBe(500);
      await expect(rosterOf(runtime)).resolves.toEqual([
        expect.objectContaining({ writerId: "primary0", role: "primary" }),
        expect.objectContaining({ writerId: "observer", role: "observer" }),
      ]);
    } finally {
      await rm(runtime.store.agentRosterLockPath, { force: true });
    }
  });

  it("should refuse an answer that names no agent", async () => {
    const { runtime, token } = await startReview();

    const response = await answerPrimacy({
      runtime,
      token,
      body: { answer: "primary" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("name an agent"),
    });
  });

  it("should refuse an answer that is not one of the three", async () => {
    const { runtime, token } = await startReview();
    await attach({ runtime, writerId: "aaaaaaaa" });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "aaaaaaaa", answer: "promote" },
    });

    expect(response.status).toBe(400);
  });

  it("should refuse an answer about an agent that is not attached", async () => {
    const { runtime, token } = await startReview();

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "nobody00", answer: "primary" },
    });

    expect(response.status).toBe(404);
  });

  it("should refuse an answer about an agent the roster has stopped counting", async () => {
    // The cards are drawn from membership, so the route has to answer from it
    // too. Without that check a reviewer whose browser has been open long
    // enough could install a process that exited into the primary seat.
    const { runtime, token } = await startReview();
    await attach({
      runtime,
      writerId: "departed",
      now: Date.now() - AGENT_STALL_MS - 1,
    });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "departed", answer: "primary" },
    });

    expect(response.status).toBe(404);
  });

  it("should move primacy to the observer the reviewer picked", async () => {
    const { runtime, token } = await startReview();
    await attach({ runtime, writerId: "incumbent" });
    await attach({ runtime, writerId: "arriving" });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "arriving", answer: "primary" },
    });

    expect(response.status).toBe(200);
    const agents = await rosterOf(runtime);
    expect(agents.map(({ writerId, role }) => ({ writerId, role }))).toEqual(
      expect.arrayContaining([
        { writerId: "arriving", role: "primary" },
        { writerId: "incumbent", role: "observer" },
      ]),
    );
    // The question is answered, not merely moved: a request left standing
    // would keep the toolbar in hazard after the reviewer had decided.
    expect(
      agents.find((agent) => agent.writerId === "arriving")
        ?.requestedPrimacyAtMs,
    ).toBeUndefined();
  });

  it("should leave an agent where it is when the reviewer declines", async () => {
    const { runtime, token } = await startReview();
    await attach({ runtime, writerId: "incumbent" });
    await attach({ runtime, writerId: "arriving" });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "arriving", answer: "observer" },
    });

    expect(response.status).toBe(200);
    const agents = await rosterOf(runtime);
    const arriving = agents.find((agent) => agent.writerId === "arriving");
    // Not "go away", just "not you": still attached, and no longer asking.
    expect(arriving?.role).toBe("observer");
    expect(arriving?.requestedPrimacyAtMs).toBeUndefined();
    expect(agents.find((agent) => agent.writerId === "incumbent")?.role).toBe(
      "primary",
    );
  });

  it("should drop an agent the reviewer disconnects", async () => {
    const { runtime, token } = await startReview();
    await attach({ runtime, writerId: "incumbent" });
    await attach({ runtime, writerId: "arriving" });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "arriving", answer: "disconnect" },
    });

    expect(response.status).toBe(200);
    await expect(rosterOf(runtime)).resolves.toEqual([
      expect.objectContaining({ writerId: "incumbent" }),
    ]);
  });

  /*
  Attaches an agent that is mid turn: on the roster, and holding the claim on a
  real request. The claim is what actually fences publication, so a card that
  promises an agent is dropped from the review has to reach it.
  */
  const attachWorkingPrimary = async ({
    runtime,
    writerId,
  }: {
    readonly runtime: ReviewRuntime;
    readonly writerId: string;
  }): Promise<string> => {
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "1212121212121212",
      sessionId: runtime.sessionId,
      planId: runtime.planId,
      premiseSnapshot: deriveSnapshotDigest(PLAN),
      createdAt: "2026-08-19T12:00:00.000Z",
      body: "Answer this.",
    });
    await writeAgentRequest({ store: runtime.store, request });
    const claimToken = "abcdefabcdefabcd";
    await claimAgentRequest({
      store: runtime.store,
      activeSessionId: runtime.sessionId,
      requestId: request.requestId,
      claimedBy: claimToken,
      baselineSnapshot: request.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await attach({ runtime, writerId });
    await recordAgentClaimToken({
      store: runtime.store,
      sessionId: runtime.sessionId,
      writerId,
      claimToken,
    });
    return request.requestId;
  };

  const claimHolderOf = async ({
    runtime,
    requestId,
  }: {
    readonly runtime: ReviewRuntime;
    readonly requestId: string;
  }): Promise<string | undefined> =>
    (
      await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      })
    ).requests.find((request) => request.requestId === requestId)?.claimedBy;

  it("should fence the turn a disconnected agent was part way through", async () => {
    // Removing the record is not a fence on its own: the commands that finish
    // a turn know their token and not their registration, so a disconnected
    // agent still published the revision the reviewer had just removed it
    // from. The card promises it is dropped from this review; this is what
    // makes that true.
    const { runtime, token } = await startReview();
    const requestId = await attachWorkingPrimary({
      runtime,
      writerId: "incumbent",
    });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "incumbent", answer: "disconnect" },
    });

    expect(response.status).toBe(200);
    await expect(
      claimHolderOf({ runtime, requestId }),
    ).resolves.toBeUndefined();
  });

  it("should leave the working primary alone when an observer is disconnected", async () => {
    const { runtime, token } = await startReview();
    const requestId = await attachWorkingPrimary({
      runtime,
      writerId: "incumbent",
    });
    await attach({ runtime, writerId: "arriving" });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "arriving", answer: "disconnect" },
    });

    expect(response.status).toBe(200);
    await expect(claimHolderOf({ runtime, requestId })).resolves.toBe(
      "abcdefabcdefabcd",
    );
  });

  it("should leave the new primary's turn alone when a stale card is disconnected", async () => {
    /*
    The sequence a plan-wide release could not survive. A holds R1; the
    reviewer moves primacy to B, which frees R1 and leaves A's card on the rail
    as an observer; B claims R1 and is mid turn; the reviewer tidies up by
    disconnecting A. Releasing every open claim here would discard the turn B
    is part way through, under a progress line about a change the reviewer
    never made.
    */
    const { runtime, token } = await startReview();
    const requestId = await attachWorkingPrimary({
      runtime,
      writerId: "incumbent",
    });
    await attach({ runtime, writerId: "arriving" });
    await answerPrimacy({
      runtime,
      token,
      body: { writerId: "arriving", answer: "primary" },
    });
    const successorToken = "1234123412341234";
    await claimAgentRequest({
      store: runtime.store,
      activeSessionId: runtime.sessionId,
      requestId,
      claimedBy: successorToken,
      baselineSnapshot: deriveSnapshotDigest(PLAN),
      now: new Date().toISOString(),
    });
    await recordAgentClaimToken({
      store: runtime.store,
      sessionId: runtime.sessionId,
      writerId: "arriving",
      claimToken: successorToken,
    });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "incumbent", answer: "disconnect" },
    });

    expect(response.status).toBe(200);
    await expect(claimHolderOf({ runtime, requestId })).resolves.toBe(
      successorToken,
    );
  });

  it("should close the claim a hand-off took from the outgoing primary", async () => {
    // The record must stop describing an agent mid turn the moment the claim
    // it names is freed; otherwise the displaced card sits on the rail for
    // half an hour offering to be made the primary again.
    const { runtime, token } = await startReview();
    await attachWorkingPrimary({ runtime, writerId: "incumbent" });
    await attach({ runtime, writerId: "arriving" });

    await answerPrimacy({
      runtime,
      token,
      body: { writerId: "arriving", answer: "primary" },
    });

    const displaced = (await rosterOf(runtime)).find(
      (agent) => agent.writerId === "incumbent",
    );
    expect(displaced?.role).toBe("observer");
    expect(displaced?.claimClosedAtMs).toEqual(expect.any(Number));
  });

  it("should let the reviewer appoint a primary when the plan has none", async () => {
    /*
    The way out of a seat the reviewer emptied. They disconnected the agent
    that was answering them, so nothing succeeds into the seat automatically -
    which leaves their own answer as the only thing that can fill it, and it
    has to be accepted.
    */
    const { runtime, token } = await startReview();
    await attach({ runtime, writerId: "incumbent" });
    await attach({ runtime, writerId: "watching" });
    await answerPrimacy({
      runtime,
      token,
      body: { writerId: "watching", answer: "observer" },
    });
    await answerPrimacy({
      runtime,
      token,
      body: { writerId: "incumbent", answer: "disconnect" },
    });
    expect(
      selectPrimaryAgent({
        agents: await rosterOf(runtime),
        nowMs: Date.now(),
      }),
    ).toBeUndefined();

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "watching", answer: "primary" },
    });

    expect(response.status).toBe(200);
    expect(
      selectPrimaryAgent({ agents: await rosterOf(runtime), nowMs: Date.now() })
        ?.writerId,
    ).toBe("watching");
  });

  it("should leave a turn alone when a hand-off displaces nobody holding it", async () => {
    // The release is named to the outgoing primary's own token, so a hand-off
    // into an empty seat cannot reach a claim that is not part of it.
    const { runtime, token } = await startReview();
    const requestId = await attachWorkingPrimary({
      runtime,
      writerId: "incumbent",
    });
    await attach({ runtime, writerId: "watching" });
    await answerPrimacy({
      runtime,
      token,
      body: { writerId: "incumbent", answer: "disconnect" },
    });
    const successorToken = "1234123412341234";
    await claimAgentRequest({
      store: runtime.store,
      activeSessionId: runtime.sessionId,
      requestId,
      claimedBy: successorToken,
      baselineSnapshot: deriveSnapshotDigest(PLAN),
      now: new Date().toISOString(),
    });
    await recordAgentClaimToken({
      store: runtime.store,
      sessionId: runtime.sessionId,
      writerId: "watching",
      claimToken: successorToken,
    });

    const response = await answerPrimacy({
      runtime,
      token,
      body: { writerId: "watching", answer: "primary" },
    });

    expect(response.status).toBe(200);
    await expect(claimHolderOf({ runtime, requestId })).resolves.toBe(
      successorToken,
    );
  });

  it("should hand the outgoing draft over only when the reviewer asked for it", async () => {
    const { runtime, token } = await startReview();
    await attach({ runtime, writerId: "incumbent" });
    await attach({ runtime, writerId: "arriving" });

    await answerPrimacy({
      runtime,
      token,
      body: { writerId: "arriving", answer: "primary" },
    });

    // Nothing was ticked, so nothing is carried. The promoted agent starts
    // from the last published revision like any other pickup.
    const promoted = (await rosterOf(runtime)).find(
      (agent) => agent.writerId === "arriving",
    );
    expect(promoted).toEqual(
      expect.objectContaining({
        writerId: "arriving",
        role: "primary",
      }),
    );
    expect(promoted).not.toHaveProperty("inheritedDraftPath");
  });
});
