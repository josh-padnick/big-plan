// Owns what a reviewer-issued disconnect is: who it addresses, what it is
// called wherever the end is reported, and the words the agent is told in.
//
// The directive is addressed rather than global, because a review outlives the
// agent attached to it. A disconnect names the connection loop the reviewer was
// looking at when they asked, so an agent that attaches a moment later is never
// ended by a decision taken about a different one.
//
// Nothing here stores state or touches Node or the browser: the route that
// records the directive, the loop that answers it, and the card that reports it
// all read the same rule from here.

/**
 * Why the connection ended, wherever that end is reported.
 *
 * It is stated as the reviewer's act rather than as the silence that follows
 * it, because the reviewer's act is the fact: an end Big Plan was asked for is
 * never an inferred gap, whether the agent acknowledged it or was killed before
 * it could (BIG-156).
 */
export const AGENT_DISCONNECTED_REASON = "The reviewer disconnected the agent";

/** What the agent is told at the next command it runs. */
export const AGENT_DISCONNECTED_MESSAGE =
  "The reviewer disconnected this agent from the review, so this session no longer speaks for the plan";

/** What the agent should do about it, in the order it should do it. */
export const AGENT_DISCONNECTED_HELP: ReadonlyArray<string> = [
  "Stop this loop; it cannot claim, note, or respond on this review any more",
  "Anything this session had in flight was dropped when the reviewer disconnected it; the reviewer's comments and questions are safe and stay queued",
  "Connect again only if the reviewer asks for it, from Agent Status in the review",
];

/** One reviewer-issued disconnect, as the review store records it. */
export type AgentDisconnectDirective = {
  /**
   * The agent session the reviewer disconnected, as the presence record named
   * it. It is what `agent next` matches itself against.
   *
   * It identifies a connection rather than one CLI invocation, because the
   * reviewer's decision is most often taken between two of the agent's
   * commands: `agent next` mints this at the session's first command and hands
   * it back on every command after it, so the name the reviewer disconnected is
   * still the agent's own name when it next asks for work (BIG-190).
   */
  readonly writerId?: string;
  /**
   * The pickup token that loop held, when it was holding work.
   *
   * `agent note` and `agent respond` are separate processes that know their
   * token and never learn their loop's writer id, so without this a mid-turn
   * agent could only find out it had been disconnected by asking for work again
   * - which is exactly the turn the reviewer asked to stop.
   */
  readonly claimToken?: string;
  readonly requestedAtMs: number;
};

/**
 * True when this directive is about this agent.
 *
 * An empty directive addresses nobody. Matching on absence would make one
 * reviewer's disconnect apply to every agent that ever attaches to the review,
 * which is the one failure this addressing exists to remove.
 */
export const agentDisconnectAddresses = ({
  directive,
  writerId,
  claimToken,
}: {
  readonly directive: AgentDisconnectDirective;
  readonly writerId?: string;
  readonly claimToken?: string;
}): boolean =>
  (directive.writerId !== undefined && directive.writerId === writerId) ||
  (directive.claimToken !== undefined && directive.claimToken === claimToken);
