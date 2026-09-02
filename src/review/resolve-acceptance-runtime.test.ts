// Proves what resolving a thread does to the changes that thread proposed,
// through the real review protocol: the still-undecided ones are accepted as
// part of resolving, and the ones the reviewer already answered are left
// exactly as they answered them.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderDocument } from "../render/render-document.js";
import {
  deriveSnapshotDigest,
  validateAgentResponseDraft,
} from "./agent-exchange.js";
import { validateChangeVerdicts } from "./change-verdicts-store.js";
import { mintAgentPush } from "./request-mailbox.js";
import { startReviewRuntime, type ReviewRuntime } from "./server.js";
import { buildSnapshotDiff, diffSnapshots } from "./snapshot-diff.js";
import { commitStagedPlanMutation } from "./staged-plan-mutation.js";
import { readChangeVerdicts } from "./store.js";
import {
  acceptedChangeKeys,
  changeSetStanding,
  rejectedChangeKeys,
} from "./shared/change-verdict.js";

const AGENT = "aaaaaaaaaaaaaaaa";
const THREAD = "1111111111111111";

const BASE = `# Delivery plan

## Alpha

Alpha stays old.

## Beta

Beta stays old.

## Gamma

Gamma stays old.
`;
const PROPOSED = BASE.replace("Alpha stays old.", "Alpha is ready.")
  .replace("Beta stays old.", "Beta is ready.")
  .replace("Gamma stays old.", "Gamma is ready.");

const render = (planPath: string, markdown: string) =>
  renderDocument({
    markdown,
    fallbackTitle: basename(planPath, extname(planPath)),
    identity: {},
  });

/** The block ids the runtime would derive for this revision. */
const changedBlocksFor = ({
  planPath,
  before,
  after,
}: {
  readonly planPath: string;
  readonly before: string;
  readonly after: string;
}): ReadonlyArray<string> => {
  const blocks = new Set<string>();
  for (const location of diffSnapshots({
    before: render(planPath, before).blocks,
    after: render(planPath, after).blocks,
  })) {
    if (location.newBlockId !== undefined) blocks.add(location.newBlockId);
    if (location.oldBlockId !== undefined) blocks.add(location.oldBlockId);
  }
  return [...blocks];
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
}): ReadonlyArray<string> =>
  buildSnapshotDiff({
    from,
    to,
    before: render(planPath, before).blocks,
    after: render(planPath, after).blocks,
  }).places.map((place) => place.placeId);

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
  readonly method?: "GET" | "POST" | "PUT";
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

/** Publishes one pushed thread whose reply changes every section. */
const publishThread = async ({
  runtime,
  planPath,
}: {
  readonly runtime: ReviewRuntime;
  readonly planPath: string;
}) => {
  const now = new Date().toISOString();
  const minted = await mintAgentPush({
    store: runtime.store,
    planPath,
    activeSessionId: runtime.sessionId,
    planId: runtime.planId,
    requestId: THREAD,
    claimedBy: AGENT,
    origin: "about",
    body: "Three sections are ready.",
    now,
  });
  await writeFile(minted.stage.candidatePath, PROPOSED, "utf8");
  const resultSnapshot = deriveSnapshotDigest(PROPOSED);
  const changeTargets = changedBlocksFor({
    planPath,
    before: BASE,
    after: PROPOSED,
  });
  const response = validateAgentResponseDraft({
    value: {
      requestId: THREAD,
      outcomes: [
        {
          commentId: minted.request.threadId,
          state: "changed",
          message: "Published the requested revision.",
          changeTargets,
        },
      ],
    },
    request: minted.request,
    commentsById: new Map(),
    changedBlocks: new Set(changeTargets),
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
    resultSource: PROPOSED,
    assets: [],
    response,
    now,
  });
  return { from: minted.stage.baseSnapshot, to: resultSnapshot };
};

const reviewState = async (runtime: ReviewRuntime) => {
  const response = await callRuntime({ runtime, path: "/api/drafts" });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    readonly version: string;
    readonly resolvedCommentIds: ReadonlyArray<string>;
  };
};

describe("resolving a thread", () => {
  it("should accept only the changes it still leaves undecided", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-resolve-accept-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, BASE);
    const runtime = await startReviewRuntime({ planPath });
    try {
      const { from, to } = await publishThread({ runtime, planPath });
      const places = placeIdsFor({
        planPath,
        from,
        to,
        before: BASE,
        after: PROPOSED,
      });
      expect(places.length).toBe(3);
      const [rejected, accepted, undecided] = places;

      const rejection = await callRuntime({
        runtime,
        path: "/api/change-verdicts",
        method: "POST",
        body: { op: "reject", from, to, placeIds: [rejected] },
      });
      expect(rejection.status).toBe(200);
      const acceptance = await callRuntime({
        runtime,
        path: "/api/change-verdicts",
        method: "POST",
        body: { op: "accept", from, to, placeIds: [accepted] },
      });
      expect(acceptance.status).toBe(200);
      const decidedBefore = await readChangeVerdicts({
        store: runtime.store,
        validate: validateChangeVerdicts,
      });
      const acceptedRow = decidedBefore.decided.find(
        (entry) => entry.placeId === accepted,
      );

      const state = await reviewState(runtime);
      const resolved = await callRuntime({
        runtime,
        path: "/api/drafts",
        method: "PUT",
        body: {
          drafts: [],
          resolvedCommentIds: [THREAD],
          version: state.version,
        },
      });
      expect(resolved.status).toBe(200);

      const verdicts = await readChangeVerdicts({
        store: runtime.store,
        validate: validateChangeVerdicts,
      });
      // Every still-open change is answered, and answering all of them is one
      // ledger revision rather than one per change.
      expect(verdicts.revision).toBe(decidedBefore.revision + 1);
      expect(
        changeSetStanding({
          from,
          to,
          placeIds: places,
          accepted: acceptedChangeKeys(verdicts),
          rejected: rejectedChangeKeys(verdicts),
        }),
      ).toMatchObject({
        total: 3,
        accepted: 2,
        rejected: 1,
        open: 0,
        isSettled: true,
        isAccepted: false,
      });
      expect(
        verdicts.decided.find((entry) => entry.placeId === rejected),
      ).toMatchObject({ verdict: "rejected", actor: "reviewer" });
      // The reviewer's own acceptance is left exactly as they recorded it.
      expect(
        verdicts.decided.find((entry) => entry.placeId === accepted),
      ).toEqual(acceptedRow);
      expect(
        verdicts.decided.find((entry) => entry.placeId === undecided),
      ).toMatchObject({ verdict: "accepted", actor: "auto-accept" });

      // Resolving again decides nothing, because nothing is left open.
      const repeated = await reviewState(runtime);
      expect(repeated.resolvedCommentIds).toEqual([THREAD]);
    } finally {
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
