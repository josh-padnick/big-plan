// Owns the annotation card shared by every component that anchors reviewer
// notes to lines. Callers keep their anchoring and pass hook classes and data
// attributes through a deliberately narrow interface.

import type { ElementContent } from "hast";
import { MESSAGE_SQUARE_ICON } from "../../../icons/lucide/message-square.js";
import { hastContentToReact } from "../hast-content/hast-content.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";

export const AnnotationCard = ({
  label,
  children,
  className = [],
  dataProperties = {},
}: {
  readonly label: string;
  readonly children: ReadonlyArray<ElementContent>;
  readonly className?: ReadonlyArray<string>;
  readonly dataProperties?: Readonly<Record<string, string | number>>;
}) => (
  <aside
    className={[
      "annotation-card flex min-w-0 gap-2 px-3 py-2 font-sans text-sm leading-normal whitespace-normal [&>svg]:size-4 [&>svg]:shrink-0",
      ...className,
    ].join(" ")}
    role="note"
    aria-label={label}
    {...dataProperties}
  >
    {lucideIconToReact({ icon: MESSAGE_SQUARE_ICON, hidden: false })}
    <div className="annotation-card-content min-w-0">
      <span className="annotation-card-badge mb-1 inline-flex rounded-sm px-1.5 py-0.5 text-xs font-semibold">
        {label}
      </span>
      <div className="annotation-card-body">{hastContentToReact(children)}</div>
    </div>
  </aside>
);
