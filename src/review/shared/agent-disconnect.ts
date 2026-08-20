// Owns what a reviewer-issued disconnect is: who it addresses, what it is
// called wherever the end is reported, and the words the agent is told in.
//
// The directive is addressed rather than global, because a review outlives the
// agent attached to it. A disconnect names the one connection the reviewer was
// looking at when they asked, so neither an agent that attaches a moment later
// nor one merely waiting beside it is ended by a decision taken about another.
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
   * The one agent the reviewer disconnected, named by its connection token.
   *
   * A connection is the only identity that survives everything this decision
   * does. It is stable across the agent's commands, because `agent next` mints
   * it at the session's first command and hands it back on every command after
   * it; and it outlives the pickup, because disconnecting releases the claim at
   * once so the review frees, which would destroy a lease token used as the
   * address. A claim records the connection holding it, so the agent that is
   * working can be named without ever naming one merely waiting (BIG-190).
   */
  readonly writerId: string;
  readonly requestedAtMs: number;
};

/**
 * True when this directive is about this agent.
 *
 * One directive, one addressee. A disconnect that could match on more than one
 * identity matched agents the reviewer never saw, so there is exactly one name
 * on the record and exactly one way to answer to it.
 */
export const agentDisconnectAddresses = ({
  directive,
  writerId,
}: {
  readonly directive: AgentDisconnectDirective;
  readonly writerId?: string;
}): boolean => directive.writerId === writerId;
