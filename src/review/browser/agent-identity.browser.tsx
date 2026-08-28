// Owns how the review island names the agent on the other end.
//
// Two surfaces say who an agent is - the roster card and a pushed arrival -
// and they are read minutes apart in the same session. Composing the same line
// twice would let them drift into two ways of writing one agent's name, which
// reads as two agents. The catalog already owns the lookup from what the
// connector declared to what a vendor writes; this owns the one line those
// lookups are arranged into, and nothing else.

import { agentClientDisplayName } from "../shared/agent-identity-catalog.js";

/**
 * The agent's name, and the tool it is connected through when it declared one.
 * The client is deliberately secondary: it answers "which window is this?"
 * after the model has already answered "who is this?".
 */
export const AgentIdentityText = ({
  label,
  client,
}: {
  readonly label: string;
  readonly client: string | undefined;
}) => (
  <>
    {label}
    {client === undefined ? null : (
      <span className="font-normal text-muted">
        {" · "}
        {agentClientDisplayName(client)}
      </span>
    )}
  </>
);
