# Using Flow well

A staged diagram for genuinely relational content - flows, dependencies, fan-outs - never for a list of claims.

- Order nodes chronologically left to right and label arrows as forward progress ("feeds", "unblocks", "then"), never as a backward reference that fights reading order.
- Stage headers name the same kind of thing ("Source of truth / Generate / Available through"); state each relationship once, in the headers or the arrow label, not both.
- Node labels name comparable things; state and status live in the `badge` ("Open - must merge first"), never fused into the label, and never phrased as already true.
- Explain a relationship at the point of connection through a node's body line ("Adds X", "Calls X"), not a detached caption.
- Use `code` only for technical identifiers - commands, paths, branches, PR numbers; explanatory prose stays in the body line.
- Include identity and status when known ("PR #33", "Open") so the diagram is actionable.
- Tone marks the roles: `source` for this plan's artifact, `neutral` for machinery, `destination` for where the result lands.
- A conditional workflow gets an explicit footer paragraph inside the Flow, never a fused subtitle like "branches from or lands after".
