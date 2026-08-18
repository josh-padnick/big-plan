// Turns one plan id into the single answer the service owes a saved link.
//
// Every fact here is read from the plan's own review store, never from the
// registry: the registry says where a plan lives, and the plan's session
// files say what happened to it. That split is why a page served here cannot
// disagree with the runtime about whether a session is alive.

import { basename } from "node:path";
import type { ServicePlanRow } from "../../render/service-page.js";
import {
  readCurrentReviewSession,
  readReviewSessionOutcome,
} from "../session-authority.js";
import { reviewStoreFor } from "../store.js";
import {
  listServiceRegistryEntries,
  readServiceRegistryEntry,
} from "./registry.js";

export type ServicePlanAnswer =
  /** A session is answering right now; the link should go to its address. */
  | { readonly kind: "live"; readonly planPath: string; readonly url: string }
  /** A session stopped on purpose and said why. */
  | {
      readonly kind: "ended";
      readonly planPath: string;
      readonly reason: string;
      readonly atMs: number;
    }
  /** A session stopped without saying why, which is what a crash looks like. */
  | {
      readonly kind: "interrupted";
      readonly planPath: string;
      readonly lastSeenAtMs: number;
    }
  /** The plan is known, but no session has ever owned it here. */
  | { readonly kind: "never-started"; readonly planPath: string }
  /** This machine has no review at this address. */
  | { readonly kind: "unknown" };

/** Answers what a saved link for one plan id should do right now. */
export const answerForPlan = async ({
  planId,
  now,
}: {
  readonly planId: string;
  readonly now?: number;
}): Promise<ServicePlanAnswer> => {
  const entry = await readServiceRegistryEntry({ planId });
  if (entry === undefined) return { kind: "unknown" };

  let store;
  try {
    store = reviewStoreFor({ planPath: entry.planPath, planId });
  } catch {
    // A registry entry whose path no longer resolves inside a review store is
    // not something to repair here; it reads as a plan with no session.
    return { kind: "never-started", planPath: entry.planPath };
  }

  const descriptor = await readCurrentReviewSession({ store });
  if (descriptor === undefined || descriptor.planId !== planId) {
    return { kind: "never-started", planPath: entry.planPath };
  }

  const outcome = await readReviewSessionOutcome({
    store,
    sessionId: descriptor.sessionId,
    ...(now === undefined ? {} : { now }),
  });
  switch (outcome.kind) {
    case "running":
      return { kind: "live", planPath: entry.planPath, url: descriptor.url };
    case "ended":
      return {
        kind: "ended",
        planPath: entry.planPath,
        reason: outcome.reason,
        atMs: outcome.atMs,
      };
    case "interrupted":
      return {
        kind: "interrupted",
        planPath: entry.planPath,
        lastSeenAtMs: outcome.lastSeenAtMs,
      };
    case "unknown":
      // A descriptor with no heartbeat at all is a session that started and
      // left no ending, which is the interrupted case rather than a plan that
      // was never reviewed. Its start time is the last moment it was known
      // alive.
      return {
        kind: "interrupted",
        planPath: entry.planPath,
        lastSeenAtMs: Date.parse(descriptor.startedAt),
      };
  }
};

// A plan file's name is what a person recognises in a list; the path is what
// the registry stores. "review-front-door.mdx" reads as "review front door".
const planName = (planPath: string): string => {
  const file = basename(planPath).replace(/\.mdx$/u, "");
  return file === "" ? planPath : file.replaceAll("-", " ");
};

/**
 * Every plan this service answers for, with what each address does right now.
 *
 * This reads each plan's own session files, so a row can never claim a session
 * is alive that the heartbeat does not support. It lists what the registry was
 * told to remember, which is not the same as every review running on the
 * machine: a plan appears here only because a `big-plan` command registered it.
 */
export const listServicePlanRows = async (): Promise<
  ReadonlyArray<ServicePlanRow>
> => {
  const entries = await listServiceRegistryEntries();
  const rows = await Promise.all(
    entries.map(async (entry): Promise<ServicePlanRow> => {
      const answer = await answerForPlan({ planId: entry.planId });
      return {
        name: planName(entry.planPath),
        href: `/plan/${entry.planId}`,
        state: answer.kind === "unknown" ? "never-started" : answer.kind,
      };
    }),
  );
  return [...rows].sort((left, right) => left.name.localeCompare(right.name));
};
