// Publishing one plan's stable address: remember where the plan lives, and
// hand back the link when something is there to answer for it.
//
// This is the whole contract between a link-printing command and the service,
// and it is deliberately failure-tolerant. A command that could not reach the
// service still succeeds and still prints the session's direct address, which
// is exactly today's behaviour and never worse.

import { probeService } from "./lifecycle.js";
import { servicePlanUrl, servicePort } from "./paths.js";
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
    // Registration is unconditional and comes first, so a plan stays
    // explainable even when nothing is answering for it yet: the moment a
    // service does start, every previously registered link works.
    await rememberPlan({ planId, planPath });
  } catch (error: unknown) {
    return {
      kind: "unavailable",
      reason: `This plan could not be registered for a stable link: ${String(error)}`,
    };
  }
  const port = servicePort();
  const probe = await probeService({ port });
  if (probe.kind !== "running") {
    return {
      kind: "unavailable",
      reason: `No Big Plan service is answering on port ${port}, so this review has no stable link yet.`,
    };
  }
  return { kind: "published", url: servicePlanUrl({ planId }) };
};
