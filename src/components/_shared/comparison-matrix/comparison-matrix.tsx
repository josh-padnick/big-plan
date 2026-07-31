// Owns the comparison-matrix presentation the two decision components share:
// the horizontal scroll shell, the table skeleton, and the tone vocabulary.
//
// Decision and ComplexDecision are deliberately two components with two
// purposes - one asks a question and ends in a confirmed answer, the other
// records an analysis already made - but they present the same shape, options
// across and criteria down. Sharing the shape here is what stops the two from
// drifting into two dialects a reader has to learn twice.
//
// What is shared is the skeleton and the meaning of a tone, not where a tone
// is painted: `matrix-tone-*` sets `--matrix-tone` and each component decides
// what takes that colour. Decision tints the whole verdict, because three
// short rows scan better in colour; ComplexDecision tints only the glyph,
// because its denser matrix would turn into a paint chart.

import type { ReactNode } from "react";
import { CHECK_ICON } from "../../../icons/lucide/check.js";
import { MINUS_ICON } from "../../../icons/lucide/minus.js";
import { TRIANGLE_ALERT_ICON } from "../../../icons/lucide/triangle-alert.js";
import { X_ICON } from "../../../icons/lucide/x.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";

/** The verdict tones every comparison matrix speaks. */
export type MatrixTone = "good" | "bad" | "mixed" | "neutral";

/**
 * Resolves to `true` only when two unions are mutually assignable. A component
 * asserts `MatrixToneParity<ItsOwnTone> = true`, which stops compiling the
 * moment either union gains or loses a member - a one-sided `satisfies` check
 * would still accept a tone added on only one side.
 */
export type MatrixToneParity<Tone> = [Tone] extends [MatrixTone]
  ? [MatrixTone] extends [Tone]
    ? true
    : never
  : never;

/** One glyph per tone, so a tone never reaches the reader as colour alone. */
export const MATRIX_TONE_ICONS = {
  good: CHECK_ICON,
  bad: X_ICON,
  mixed: TRIANGLE_ALERT_ICON,
  neutral: MINUS_ICON,
} satisfies Record<MatrixTone, LucideIcon>;

/** The class carrying a tone's colour into `--matrix-tone`. */
export const matrixToneClass = (tone: MatrixTone): string =>
  `matrix-tone-${tone}`;

/**
 * Wraps a comparison table in the scroll shell and table skeleton both
 * decision components present. Callers supply their own thead and tbody, and
 * add a component class for anything local to their matrix.
 */
export const ComparisonMatrix = ({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) => (
  <div className="relative overflow-x-auto" data-table-scroll-container="">
    <table
      className={[
        "comparison-matrix",
        "w-full",
        "border-collapse",
        ...(className === undefined ? [] : [className]),
      ].join(" ")}
    >
      {children}
    </table>
  </div>
);
