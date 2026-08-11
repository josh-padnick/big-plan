// Owns the annotation card shared by every component that anchors reviewer
// notes to lines. Callers keep their anchoring and pass hook classes and data
// attributes through a deliberately narrow interface.

import type { ElementContent } from "hast";
import { MESSAGE_SQUARE_ICON } from "../../../icons/lucide/message-square.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";
import { hastContentToReact } from "../hast-content/hast-content.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";

// /* off-scale */ Phase A preserves the legacy 0.3rem radius and token mixes
// exactly; Phase B will move the primitive onto the canonical scales.
export const AnnotationCard = ({
  label,
  children,
  className = [],
  dataProperties = {},
  icon = MESSAGE_SQUARE_ICON,
}: {
  readonly label: string;
  readonly children: ReadonlyArray<ElementContent>;
  readonly className?: ReadonlyArray<string>;
  readonly dataProperties?: Readonly<Record<string, string | number>>;
  readonly icon?: LucideIcon;
}) => (
  <aside
    className={[
      "annotation-card flex min-w-0 gap-2 rounded-md border bg-[var(--annotation-bg)] px-3 py-2 font-sans text-sm leading-normal whitespace-normal [border-color:color-mix(in_srgb,var(--annotation-c)_30%,transparent)] [&.annotation-hover]:bg-[color-mix(in_srgb,var(--annotation-c)_14%,var(--annotation-bg))] [&.annotation-hover]:[border-color:color-mix(in_srgb,var(--annotation-c)_60%,transparent)] [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--annotation-c)]",
      ...className,
    ].join(" ")}
    role="note"
    aria-label={label}
    {...dataProperties}
  >
    {lucideIconToReact({ icon, hidden: false })}
    <div className="annotation-card-content min-w-0">
      <span className="annotation-card-badge mb-1 inline-flex rounded-sm bg-[color-mix(in_srgb,var(--annotation-c)_14%,transparent)] px-1.5 py-0.5 text-xs font-semibold text-[var(--annotation-c)]">
        {label}
      </span>
      <div className="annotation-card-body text-[var(--annotation-ink)] [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        {hastContentToReact(children)}
      </div>
    </div>
  </aside>
);
