# Commenting round 3: alignment root cause

At the declared 1440×1000 viewport, the reference document kept the title and
the first section card on the shell's native outer edge (`320px` for both).
The v2 rebuild extracted the rendered article into its simulation shell, then
added a harness-only `margin-left: 2.1rem` to every direct commentable block.
Components were reset to zero margin and slide cards never received the margin.
That split one native column into two: the title moved to `502.703px`, while
the summary, part bands, and section cards stayed at `469.109px`.

The regression survived because the alignment audit started at part bands and
section cards. It did not measure the document title, subtitle, quick summary,
or overview, so it reported `pass: true` while the title was `33.594px` off.

The rebuild now leaves top-level layout to the product stylesheet instead of
adding a second shell-specific inset. Its guard also names the title, subtitle,
summary, and overview as outer-edge rows. At 1440×1000, the rebuilt title and
first section card both measure `469.109px` (zero-pixel delta); the inner card
text remains on the separate canonical `34px` inset. Every audited row matches
its declared outer or text-column edge.

PR #43, which owns the broader styling-verification system, is still open.
To avoid duplicating its harness, this branch adds only the missing
agent-facing rule to `CONTRIBUTING.md`: changed controls must have hover,
keyboard-focus, and active states exercised and screenshotted in real Chrome
in both themes, with the real gesture and a state-change assertion.
