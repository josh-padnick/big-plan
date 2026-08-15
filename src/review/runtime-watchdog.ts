// Owns what the review runtime can say about its own health while it is still
// running. A review session that stops answering writes while it keeps
// answering reads (BIG-44) looks alive from every angle a reviewer can see, so
// the runtime has to name the stall itself: which mutation is stuck, how long
// it has been stuck, and how large the append-only review state has grown.
//
// Every decision here is pure and clock-injected. The runtime supplies the
// clock and the I/O; the CLI owns writing the result to stderr.

import type { ReviewStoreGrowth } from "./store.js";

/** One mutation the write gate has started and not yet seen settle. */
export type InFlightMutation = {
  readonly id: string;
  readonly route: string;
  readonly startedAtMs: number;
};

/** One mutation that has outlived the bound a healthy mutation stays inside. */
export type StalledMutation = {
  readonly id: string;
  readonly route: string;
  readonly ageMs: number;
};

/** What the runtime reports about itself on demand or on a stall. */
export type ReviewRuntimeDiagnostics = {
  readonly sessionId: string;
  readonly planPath: string;
  readonly nowMs: number;
  readonly inFlight: ReadonlyArray<InFlightMutation>;
  readonly stalled: ReadonlyArray<StalledMutation>;
  readonly growth?: ReviewStoreGrowth;
};

/**
 * Selects the mutations that have been running at least `boundMs`, oldest
 * first. Age is measured from when the gate handed the mutation its turn, not
 * from when the request arrived, so a request that merely waited its turn
 * behind a slow neighbour is not reported as stalled.
 */
export const stalledMutations = ({
  inFlight,
  nowMs,
  boundMs,
}: {
  readonly inFlight: ReadonlyArray<InFlightMutation>;
  readonly nowMs: number;
  readonly boundMs: number;
}): ReadonlyArray<StalledMutation> =>
  inFlight
    .map((mutation) => ({
      id: mutation.id,
      route: mutation.route,
      ageMs: nowMs - mutation.startedAtMs,
    }))
    .filter((mutation) => mutation.ageMs >= boundMs)
    .sort((left, right) => right.ageMs - left.ageMs);

/**
 * Reports growth only once per threshold multiple, so a long session logs a
 * short ladder of counts rather than one line a minute forever.
 */
export const growthMilestone = ({
  growth,
  threshold,
}: {
  readonly growth: ReviewStoreGrowth;
  readonly threshold: number;
}): number =>
  Math.floor(
    Math.max(
      growth.progressLines,
      growth.agentRequests,
      growth.agentResponses,
    ) / threshold,
  );

/** Renders one stalled mutation as the operator-facing fact about it. */
export const describeStalledMutation = (mutation: StalledMutation): string =>
  `${mutation.route} has not settled for ${Math.round(mutation.ageMs / 1_000)}s`;

/** Renders the on-demand dump a stuck session is asked for before it is killed. */
export const describeRuntimeDiagnostics = (
  diagnostics: ReviewRuntimeDiagnostics,
): string => {
  const lines = [
    `Big Plan review diagnostics for session ${diagnostics.sessionId} (${diagnostics.planPath})`,
    `  in-flight mutations: ${diagnostics.inFlight.length}`,
  ];
  for (const mutation of diagnostics.stalled) {
    lines.push(`  stalled: ${describeStalledMutation(mutation)}`);
  }
  if (diagnostics.growth !== undefined) {
    lines.push(
      `  growth: ${diagnostics.growth.progressLines} progress lines, ${diagnostics.growth.agentRequests} agent requests, ${diagnostics.growth.agentResponses} agent responses`,
    );
  }
  return `${lines.join("\n")}\n`;
};

/** Tracks which mutations the write gate is currently running. */
export type MutationRegistry = {
  /** Records that one mutation has started, returning how to close it out. */
  readonly begin: (input: {
    readonly route: string;
    readonly atMs: number;
  }) => () => void;
  readonly inFlight: () => ReadonlyArray<InFlightMutation>;
};

/** Creates the runtime's in-flight mutation registry. */
export const createMutationRegistry = (): MutationRegistry => {
  const open = new Map<string, InFlightMutation>();
  let nextId = 0;
  return {
    begin: ({ route, atMs }) => {
      nextId += 1;
      const id = String(nextId);
      open.set(id, { id, route, startedAtMs: atMs });
      // A mutation that timed out at the gate is still running, so it stays
      // in flight until its work really settles. Removing it at the timeout
      // would erase the only evidence that the session is degraded.
      return () => {
        open.delete(id);
      };
    },
    inFlight: () => [...open.values()],
  };
};
