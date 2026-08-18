// Publishing one plan's stable address: remember where the plan lives, make
// sure something is there to answer for it, and hand back the link to print.
//
// This is the whole contract between a link-printing command and the service,
// and it is deliberately failure-tolerant. A command that could not reach the
// service still succeeds and still prints the session's direct address, which
// is exactly today's behaviour and never worse.

import { ensureServiceRunning } from "./lifecycle.js";
import { servicePlanUrl } from "./paths.js";
import { rememberPlan } from "./registry.js";

export type StableReviewLink =
  | { readonly kind: "published"; readonly url: string }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Registers one plan and returns the permanent address for it. */
export const publishStableReviewLink = async ({
  planId,
  planPath,
}: {
  readonly planId: string;
  readonly planPath: string;
}): Promise<StableReviewLink> => {
  try {
    // Registered before the service is asked to run, so a service that starts
    // slowly still finds the entry, and a service that never starts still
    // leaves the plan explainable on the next command.
    await rememberPlan({ planId, planPath });
  } catch (error: unknown) {
    return {
      kind: "unavailable",
      reason: `This plan could not be registered for a stable link: ${String(error)}`,
    };
  }
  const availability = await ensureServiceRunning();
  if (availability.kind === "unavailable") {
    return { kind: "unavailable", reason: availability.reason };
  }
  return { kind: "published", url: servicePlanUrl({ planId }) };
};
