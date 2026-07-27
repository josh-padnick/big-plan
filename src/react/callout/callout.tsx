// The React port of Callout: renders the compiled model into the same
// semantic panel the vanilla renderer emits, class-for-class. The visual
// constants are duplicated from the vanilla renderer on purpose - the two
// coexist only during the port, and the parity test holds them identical
// until the vanilla renderer is deleted.

import { renderToStaticMarkup } from "react-dom/server";
import type {
  CalloutType,
  CompiledCallout,
} from "../../model/compile-callout.js";
import type { LucideIcon } from "../../render/icons/lucide-icon.js";
import { INFO_ICON } from "../../render/icons/lucide/info.js";
import { LIGHTBULB_ICON } from "../../render/icons/lucide/lightbulb.js";
import { OCTAGON_ALERT_ICON } from "../../render/icons/lucide/octagon-alert.js";
import { TRIANGLE_ALERT_ICON } from "../../render/icons/lucide/triangle-alert.js";
import { hastContentToReact } from "../hast-content.js";
import { lucideIconToReact } from "../lucide-icon.js";

type CalloutConfig = {
  readonly defaultTitle: string;
  readonly icon: LucideIcon;
};

const CALLOUT_CONFIGS = {
  note: { defaultTitle: "Note", icon: INFO_ICON },
  tip: { defaultTitle: "Tip", icon: LIGHTBULB_ICON },
  warning: { defaultTitle: "Warning", icon: TRIANGLE_ALERT_ICON },
  danger: { defaultTitle: "Danger", icon: OCTAGON_ALERT_ICON },
} satisfies Readonly<Record<CalloutType, CalloutConfig>>;

const CALLOUT_CLASSES =
  // Border colors come from the stylesheet's [data-callout] rules; a
  // border-edge utility here would win the cascade and flatten the accent.
  "callout mb-5 rounded-md border border-l-4 px-4 py-3";
const HEADER_CLASSES =
  "callout-header mb-2 flex items-center gap-2 font-semibold [&_svg]:size-4 [&_svg]:shrink-0";
const TITLE_CLASSES = "callout-title text-sm leading-5";
const BODY_CLASSES = "callout-body text-ink";

const CalloutView = ({ model }: { readonly model: CompiledCallout }) => {
  const config = CALLOUT_CONFIGS[model.type];
  return (
    <aside data-callout={model.type} className={CALLOUT_CLASSES}>
      <header className={HEADER_CLASSES}>
        {lucideIconToReact({ icon: config.icon, hidden: false })}
        <span className={TITLE_CLASSES}>
          {model.title ?? config.defaultTitle}
        </span>
      </header>
      <div className={BODY_CLASSES}>{hastContentToReact(model.body)}</div>
    </aside>
  );
};

/** Renders one compiled Callout to static HTML via the React port. */
export const renderCalloutStatic = (model: CompiledCallout): string =>
  renderToStaticMarkup(<CalloutView model={model} />);
