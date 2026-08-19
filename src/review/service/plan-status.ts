// Turns one plan id into the single answer the service owes a saved link.
//
// Every fact here is read from the plan's own review store, never from the
// registry: the registry says where a plan lives, and the plan's session
// files say what happened to it. That split is why a page served here cannot
// disagree with the runtime about whether a session is alive.

import {
  readCurrentReviewSession,
  readReviewSessionOutcome,
} from "../session-authority.js";
import { reviewStoreFor } from "../store.js";
import { readServiceRegistryEntry } from "./registry.js";

// The one rule about where a saved link may be sent. This service exists to be
// the stable address a link points at, so the only address it will forward a
// browser to is a loopback one on this machine: a descriptor naming anywhere
// else is answered with a page rather than followed.
const isLoopbackHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
};

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
      // Fails closed: an unreachable-by-policy address is answered the same way
      // a plan with no session is, which tells the visitor how to start one.
      return isLoopbackHttpUrl(descriptor.url)
        ? { kind: "live", planPath: entry.planPath, url: descriptor.url }
        : { kind: "never-started", planPath: entry.planPath };
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
