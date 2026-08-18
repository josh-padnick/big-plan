// Owns timing constants shared by agent claims and reader-facing status.

export const AGENT_STALL_MS = 75_000;
export const AGENT_STALL_WINDOW_LABEL = "75 seconds";

// How long a claim keeps explaining an agent's silence. Held work is the reason
// Big Plan stops reading a quiet turn as a lost connection, but nothing ever
// reaps a claim, so without a bound one abandoned request would explain silence
// forever and withhold the reviewer's only route back to a working agent.
//
// 24 x AGENT_STALL_MS. AGENT_STALL_MS is one minute of expected narration plus
// 15 seconds of jitter, so this sits an order of magnitude beyond any plausible
// single turn: past half an hour of total silence an agent has finished, died,
// or drifted so far outside its expected cadence that the explanation is no
// longer worth what it costs. The asymmetry decides the direction - a reviewer
// left with no route to recovery is worse off than one offered a takeover they
// are told the consequences of - and the takeover-aware wording on the
// recovery disclosure is what keeps that trade honest, because this horizon is
// itself an inference from silence (BIG-147).
//
// This multiplier is the only place the value lives. No runtime string states
// it, so nothing can interpolate it; the reader-facing statement of the figure
// is one sentence in docs/src/content/docs/reference/reviewing.md, under
// "Connect the coding agent", and it has to be edited alongside this line.
export const AGENT_RECOVERY_HORIZON_MS = AGENT_STALL_MS * 24;
