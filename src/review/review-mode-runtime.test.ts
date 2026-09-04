// Proves auto-accept through the real review protocol and terminal publication
// boundary, without depending on the later review-mode UI.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderDocument } from "../render/render-document.js";
import {
  deriveSnapshotDigest,
  readAgentExchange,
  validateAgentResponseDraft,
} from "./agent-exchange.js";
import { validateChangeVerdicts } from "./change-verdicts-store.js";
import { mintAgentPush } from "./request-mailbox.js";
import { startReviewRuntime, type ReviewRuntime } from "./server.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
import {
  commitStagedPlanMutation,
  recoverStagedPlanMutations,
} from "./staged-plan-mutation.js";
import {
  agentMutationJournalPath,
  readChangeVerdicts,
  writeStoreJson,
} from "./store.js";
import {
  acceptedChangeKeys,
  changeSetStanding,
} from "./shared/change-verdict.js";

const AGENT = "aaaaaaaaaaaaaaaa";
const ALPHA_THREAD = "1111111111111111";
const BETA_THREAD = "2222222222222222";
const ARMED_PUSH = "3333333333333333";
const RESTARTED_PUSH = "4444444444444444";
const RECOVERY_PUSH = "5555555555555555";
const CHANGE_TARGET = "section/status/paragraph-1";

const BASE = `# Delivery plan

## Alpha

Alpha stays old.

## Beta

Beta stays old.

## Gamma

Gamma stays old.
`;
const ALPHA = BASE.replace("Alpha stays old.", "Alpha is ready.");
const BETA = ALPHA.replace("Beta stays old.", "Beta is ready.").replace(
  "Gamma stays old.",
  "Gamma is ready.",
);
const ARMED = BETA.replace("Beta is ready.", "Beta is ready and measured.");
const RESTARTED = ARMED.replace("Alpha is ready.", "Alpha is ready and owned.");

const runtimeToken = async (runtime: ReviewRuntime): Promise<string> => {
  const value: unknown = JSON.parse(
    await readFile(runtime.store.sessionPath, "utf8"),
  );
  return typeof value === "object" &&
    value !== null &&
    "token" in value &&
    typeof value.token === "string"
    ? value.token
    : "";
};

const callRuntime = async ({
  runtime,
  path,
  method = "GET",
  body,
}: {
  readonly runtime: ReviewRuntime;
  readonly path: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
}): Promise<Response> =>
  fetch(`${runtime.url.replace(/\/$/u, "")}${path}`, {
    method,
    headers: {
      "x-big-plan-review-token": await runtimeToken(runtime),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const publishPush = async ({
  runtime,
  planPath,
  requestId,
  resultSource,
  threadId,
}: {
  readonly runtime: ReviewRuntime;
  readonly planPath: string;
  readonly requestId: string;
  readonly resultSource: string;
  readonly threadId?: string;
}) => {
  const now = new Date().toISOString();
  const minted = await mintAgentPush({
    store: runtime.store,
    planPath,
    activeSessionId: runtime.sessionId,
    planId: runtime.planId,
    requestId,
    claimedBy: AGENT,
    origin: "about",
    body: `Publish ${requestId}`,
    ...(threadId === undefined ? {} : { threadId }),
    now,
  });
  await writeFile(minted.stage.candidatePath, resultSource, "utf8");
  const resultSnapshot = deriveSnapshotDigest(resultSource);
  const response = validateAgentResponseDraft({
    value: {
      requestId,
      outcomes: [
        {
          commentId: minted.request.threadId,
          state: "changed",
          message: "Published the requested revision.",
          changeTargets: [CHANGE_TARGET],
        },
      ],
    },
    request: minted.request,
    commentsById: new Map(),
    changedBlocks: new Set([CHANGE_TARGET]),
    currentSnapshot: resultSnapshot,
    now,
  });
  await commitStagedPlanMutation({
    store: runtime.store,
    planPath,
    request: minted.request,
    generation: minted.stage.generation,
    claimedBy: AGENT,
    baseSnapshot: minted.stage.baseSnapshot,
    resultSnapshot,
    resultSource,
    assets: [],
    response,
    now,
  });
  return {
    request: minted.request,
    response,
    from: minted.stage.baseSnapshot,
    to: resultSnapshot,
  };
};

const placeIdsFor = ({
  planPath,
  from,
  to,
  before,
  after,
}: {
  readonly planPath: string;
  readonly from: string;
  readonly to: string;
  readonly before: string;
  readonly after: string;
}): ReadonlyArray<string> => {
  const fallbackTitle = basename(planPath, extname(planPath));
  const beforeDocument = renderDocument({
    markdown: before,
    fallbackTitle,
    identity: {},
  });
  const afterDocument = renderDocument({
    markdown: after,
    fallbackTitle,
    identity: {},
  });
  return buildSnapshotDiff({
    from,
    to,
    before: beforeDocument.blocks,
    after: afterDocument.blocks,
  }).places.map((place) => place.placeId);
};

describe("review mode protocol", () => {
  it("should close only the armed thread, close arriving pushes, and reset on restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-mode-runtime-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, BASE);
    let runtime = await startReviewRuntime({ planPath });
    try {
      const alpha = await publishPush({
        runtime,
        planPath,
        requestId: ALPHA_THREAD,
        resultSource: ALPHA,
      });
      const beta = await publishPush({
        runtime,
        planPath,
        requestId: BETA_THREAD,
        resultSource: BETA,
      });
      const alphaPlaces = placeIdsFor({
        planPath,
        from: alpha.from,
        to: alpha.to,
        before: BASE,
        after: ALPHA,
      });
      const betaPlaces = placeIdsFor({
        planPath,
        from: beta.from,
        to: beta.to,
        before: ALPHA,
        after: BETA,
      });
      expect(alphaPlaces.length).toBeGreaterThan(0);
      expect(betaPlaces.length).toBeGreaterThan(1);

      const reviewerAccepted = await callRuntime({
        runtime,
        path: "/api/change-verdicts",
        method: "POST",
        body: {
          op: "accept",
          changeSetId: BETA_THREAD,
          from: beta.from,
          to: beta.to,
          places: [{ placeId: betaPlaces[0] }],
          actor: "auto-accept",
        },
      });
      expect(reviewerAccepted.status).toBe(200);

      const armed = await callRuntime({
        runtime,
        path: "/api/review-mode",
        method: "POST",
        body: { mode: "auto-accept", threadId: ALPHA_THREAD },
      });
      expect(armed.status).toBe(200);
      await expect(armed.json()).resolves.toMatchObject({
        mode: "auto-accept",
        armedAtMs: expect.any(Number),
      });

      let verdicts = await readChangeVerdicts({
        store: runtime.store,
        validate: validateChangeVerdicts,
      });
      const accepted = acceptedChangeKeys(verdicts);
      expect(
        changeSetStanding({
          changeSetId: ALPHA_THREAD,
          from: alpha.from,
          to: alpha.to,
          places: alphaPlaces.map((placeId) => ({ placeId })),
          accepted,
          rejected: new Set(),
        }),
      ).toMatchObject({ open: 0, isAccepted: true });
      expect(
        changeSetStanding({
          changeSetId: BETA_THREAD,
          from: beta.from,
          to: beta.to,
          places: betaPlaces.map((placeId) => ({ placeId })),
          accepted,
          rejected: new Set(),
        }),
      ).toMatchObject({ accepted: 1, open: betaPlaces.length - 1 });
      expect(verdicts.decided).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: beta.from,
            to: beta.to,
            placeId: betaPlaces[0],
            actor: "reviewer",
          }),
          expect.objectContaining({
            from: alpha.from,
            to: alpha.to,
            actor: "auto-accept",
          }),
        ]),
      );

      const arriving = await publishPush({
        runtime,
        planPath,
        requestId: ARMED_PUSH,
        threadId: BETA_THREAD,
        resultSource: ARMED,
      });
      const arrivingPlaces = placeIdsFor({
        planPath,
        from: arriving.from,
        to: arriving.to,
        before: BETA,
        after: ARMED,
      });
      verdicts = await readChangeVerdicts({
        store: runtime.store,
        validate: validateChangeVerdicts,
      });
      expect(
        changeSetStanding({
          changeSetId: ARMED_PUSH,
          from: arriving.from,
          to: arriving.to,
          places: arrivingPlaces.map((placeId) => ({ placeId })),
          accepted: acceptedChangeKeys(verdicts),
        }),
      ).toMatchObject({ open: 0, isAccepted: true });
      expect(
        verdicts.decided.filter(
          (entry) => entry.from === arriving.from && entry.to === arriving.to,
        ),
      ).toEqual(
        arrivingPlaces.map((placeId) =>
          expect.objectContaining({ placeId, actor: "auto-accept" }),
        ),
      );

      const session = await callRuntime({ runtime, path: "/api/session" });
      await expect(session.json()).resolves.toMatchObject({
        mode: "auto-accept",
        armedAtMs: expect.any(Number),
      });
      await runtime.close();
      const staleMode: unknown = JSON.parse(
        await readFile(runtime.store.reviewModePath, "utf8"),
      );
      expect(staleMode).toMatchObject({
        mode: "auto-accept",
        sessionId: runtime.sessionId,
      });

      runtime = await startReviewRuntime({ planPath });
      const restartedSession = await callRuntime({
        runtime,
        path: "/api/session",
      });
      const restartedBody = (await restartedSession.json()) as Record<
        string,
        unknown
      >;
      expect(restartedBody).toMatchObject({ mode: "review" });
      expect(restartedBody).not.toHaveProperty("armedAtMs");

      const restarted = await publishPush({
        runtime,
        planPath,
        requestId: RESTARTED_PUSH,
        threadId: ALPHA_THREAD,
        resultSource: RESTARTED,
      });
      const restartedPlaces = placeIdsFor({
        planPath,
        from: restarted.from,
        to: restarted.to,
        before: ARMED,
        after: RESTARTED,
      });
      verdicts = await readChangeVerdicts({
        store: runtime.store,
        validate: validateChangeVerdicts,
      });
      expect(
        changeSetStanding({
          changeSetId: RESTARTED_PUSH,
          from: restarted.from,
          to: restarted.to,
          places: restartedPlaces.map((placeId) => ({ placeId })),
          accepted: acceptedChangeKeys(verdicts),
          rejected: new Set(),
        }),
      ).toMatchObject({ accepted: 0, open: restartedPlaces.length });
    } finally {
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should replay auto-accept before answering an interrupted push", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-mode-recovery-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, BASE);
    const runtime = await startReviewRuntime({ planPath });
    try {
      await publishPush({
        runtime,
        planPath,
        requestId: ALPHA_THREAD,
        resultSource: ALPHA,
      });
      expect(
        (
          await callRuntime({
            runtime,
            path: "/api/review-mode",
            method: "POST",
            body: { mode: "auto-accept", threadId: ALPHA_THREAD },
          })
        ).status,
      ).toBe(200);

      const minted = await mintAgentPush({
        store: runtime.store,
        planPath,
        activeSessionId: runtime.sessionId,
        planId: runtime.planId,
        requestId: RECOVERY_PUSH,
        claimedBy: AGENT,
        origin: "about",
        body: "Publish through recovery",
        threadId: ALPHA_THREAD,
        now: new Date().toISOString(),
      });
      const resultSnapshot = deriveSnapshotDigest(BETA);
      const answeredAt = new Date().toISOString();
      const response = validateAgentResponseDraft({
        value: {
          requestId: RECOVERY_PUSH,
          outcomes: [
            {
              commentId: ALPHA_THREAD,
              state: "changed",
              message: "Published the recovered revision.",
              changeTargets: [CHANGE_TARGET],
            },
          ],
        },
        request: minted.request,
        commentsById: new Map(),
        changedBlocks: new Set([CHANGE_TARGET]),
        currentSnapshot: resultSnapshot,
        now: answeredAt,
      });
      await writeStoreJson({
        path: agentMutationJournalPath({
          store: runtime.store,
          requestId: RECOVERY_PUSH,
        }),
        value: {
          version: 1,
          requestId: RECOVERY_PUSH,
          generation: minted.stage.generation,
          claimedBy: AGENT,
          baseSnapshot: minted.stage.baseSnapshot,
          resultSnapshot,
          answeredAt,
          response,
        },
      });
      await writeFile(planPath, BETA);

      await expect(
        recoverStagedPlanMutations({ store: runtime.store, planPath }),
      ).resolves.toEqual([{ outcome: "completed", requestId: RECOVERY_PUSH }]);
      const exchange = await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      });
      expect(
        exchange.requests.find((request) => request.requestId === RECOVERY_PUSH)
          ?.answeredAt,
      ).toBe(answeredAt);
      const places = placeIdsFor({
        planPath,
        from: minted.stage.baseSnapshot,
        to: resultSnapshot,
        before: ALPHA,
        after: BETA,
      });
      const verdicts = await readChangeVerdicts({
        store: runtime.store,
        validate: validateChangeVerdicts,
      });
      expect(
        changeSetStanding({
          changeSetId: RECOVERY_PUSH,
          from: minted.stage.baseSnapshot,
          to: resultSnapshot,
          places: places.map((placeId) => ({ placeId })),
          accepted: acceptedChangeKeys(verdicts),
          rejected: new Set(),
        }),
      ).toMatchObject({ open: 0, isAccepted: true });
      expect(
        verdicts.decided.filter(
          (entry) =>
            entry.from === minted.stage.baseSnapshot &&
            entry.to === resultSnapshot,
        ),
      ).toEqual(
        places.map((placeId) =>
          expect.objectContaining({ placeId, actor: "auto-accept" }),
        ),
      );

      const disarmed = await callRuntime({
        runtime,
        path: "/api/review-mode",
        method: "POST",
        body: { mode: "review" },
      });
      await expect(disarmed.json()).resolves.toEqual({ mode: "review" });
      const session = (await (
        await callRuntime({ runtime, path: "/api/session" })
      ).json()) as Record<string, unknown>;
      expect(session).toMatchObject({ mode: "review" });
      expect(session).not.toHaveProperty("armedAtMs");
      await expect(
        readFile(runtime.store.reviewModePath, "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
