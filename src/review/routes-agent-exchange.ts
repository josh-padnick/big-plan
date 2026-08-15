// The routes that carry the conversation with the agent: the exchange the
// browser polls, and the progress events the runtime and the agent append to
// it.

import { jsonResponse } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteResponse,
} from "./review-route-context.js";
import { readAgentExchange } from "./agent-exchange.js";
import {
  readAgentConnectionEvents,
  readAgentPresence,
  readProgress,
} from "./store.js";
import { encodeAgentSnapshot, encodeProgress } from "./shared/review-wire.js";

/**
 * Reading the exchange is also how the runtime learns that a response arrived,
 * so it advances reader progress before answering.
 */
export const readAgentSnapshot = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { store, sessionId, planId, readerProgress } = context;
  const exchange = await readAgentExchange({ store, sessionId, planId });
  for (const agentResponse of exchange.responses) {
    readerProgress.observe(agentResponse);
  }
  const presence = await readAgentPresence({ store, sessionId });
  const connectionLog = await readAgentConnectionEvents({ store, sessionId });
  return jsonResponse({
    status: 200,
    value: encodeAgentSnapshot({
      // The browser reloads only revisions the response command has
      // rendered, linted, and accepted. Watching the raw file here would
      // navigate the reviewer onto a transient parse error while an agent
      // is midway through editing the authoritative MDX.
      currentSnapshot: readerProgress.currentSnapshot(),
      presence,
      connectionLog,
      plan: context.resolvedPlanPath,
      agentCommand: context.agentCommand,
      recoveryPrompt: context.recoveryPrompt,
      requests: exchange.requests,
      responses: exchange.responses,
    }),
  });
};

export const readProgressEvents = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const events = await readProgress({
    store: context.store,
    sessionId: context.sessionId,
  });
  return jsonResponse({ status: 200, value: encodeProgress({ events }) });
};
