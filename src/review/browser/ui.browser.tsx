// Owns the small shadcn/ui primitive set used by review interaction islands.
// The copied component shapes keep native semantics and shadcn variants while
// mapping every visual choice onto Big Plan's closed design-token vocabulary.

import type {
  ComponentProps,
  ComponentPropsWithRef,
  FocusEventHandler,
  HTMLAttributes,
  KeyboardEvent,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Toaster as Sonner, toast } from "sonner";
import {
  placeAnchoredDialog,
  type AnchoredDialogPosition,
} from "./alert-dialog-position.js";
import {
  placeTooltip,
  resolveRemMeasure,
  type TooltipPosition,
} from "./tooltip-position.js";

export { toast };

const joinClasses = (
  ...values: ReadonlyArray<string | false | null | undefined>
): string => values.filter(Boolean).join(" ");

/** Token-themed shadcn Sonner primitive for transient review notices. */
export const Toaster = ({
  toastOptions,
  ...props
}: ComponentProps<typeof Sonner>) => (
  <Sonner
    closeButton
    position="bottom-right"
    toastOptions={{
      unstyled: true,
      ...toastOptions,
      classNames: {
        toast:
          "group flex w-full min-w-0 items-start gap-3 rounded-lg bg-raised p-4 text-ink shadow-floating",
        error: "border-l border-danger",
        content: "min-w-0 flex-1",
        title: "text-sm font-semibold text-ink",
        description: "mt-1 text-sm text-muted",
        // Sonner owns this wrapper, so mirror the shared data-leading-icon
        // line-box contract with utilities it can accept.
        icon: "inline-flex h-[1lh] shrink-0 items-center text-danger",
        closeButton:
          "ml-auto inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md bg-transparent text-muted hover:bg-surface hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent wide:size-6",
        ...toastOptions?.classNames,
      },
    }}
    {...props}
  />
);

type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "accentOutline"
  | "ghost"
  | "toned"
  | "destructive";
type ButtonSize =
  "default" | "md" | "sm" | "compact" | "micro" | "compactIcon" | "icon";

const BUTTON_VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  default:
    "rounded-md border border-transparent bg-accent font-semibold text-accent-ink shadow-raised hover:shadow-lifted active:inset-shadow-pressed",
  // Bordered, at the captain's instruction: a secondary that carried only a
  // ground read as less of a control than the bordered tertiary beside it, so
  // the weakest button in a row looked like the strongest. The hairline is what
  // keeps the three ranks in order - accent fill, bordered ground, bordered
  // nothing - and it is the edge every other bordered control uses.
  secondary:
    "rounded-md border border-edge bg-surface font-medium text-ink shadow-raised hover:bg-raised hover:shadow-lifted active:inset-shadow-pressed",
  outline:
    "rounded-md border border-edge bg-transparent font-normal text-muted shadow-none hover:bg-surface hover:text-ink hover:shadow-raised active:inset-shadow-pressed",
  accentOutline:
    "rounded-sm border border-accent bg-paper font-semibold text-accent shadow-none hover:bg-accent-wash hover:shadow-raised active:inset-shadow-pressed",
  ghost:
    "rounded-md border border-transparent bg-transparent font-normal text-muted hover:bg-surface hover:text-ink active:inset-shadow-pressed",
  // A control on a card that carries its own colour. Grey text and a grey
  // hairline on a coloured ground are the one thing the palette forbids, so
  // every step here is taken from that ground's own ramp through currentColor.
  toned:
    "rounded-md border border-current/35 bg-transparent font-medium text-current shadow-none hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] active:inset-shadow-pressed",
  destructive:
    "rounded-md border border-transparent bg-danger font-semibold text-danger-ink shadow-raised hover:shadow-lifted active:inset-shadow-pressed",
};

const BUTTON_SIZES: Readonly<Record<ButtonSize, string>> = {
  default: "min-h-11 px-2 py-1 wide:min-h-0",
  md: "min-h-11 px-2 py-1 text-sm wide:min-h-0",
  sm: "min-h-11 min-w-11 px-2 py-1 text-xs wide:min-h-0 wide:min-w-0",
  compact: "min-h-11 min-w-11 px-2 py-1 text-xs wide:min-h-0 wide:min-w-0",
  micro: "min-h-11 min-w-11 px-2 py-1 text-2xs wide:min-h-0 wide:min-w-0",
  compactIcon: "size-11 p-0 wide:size-6",
  icon: "size-11 p-0",
};

type ButtonProps = ComponentPropsWithRef<"button"> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
};

/** Token-themed shadcn Button primitive. */
export const Button = ({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ref,
  ...props
}: ButtonProps) => (
  <button
    ref={ref}
    type={type}
    className={joinClasses(
      "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 transition hover:brightness-95 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:border-edge disabled:bg-surface disabled:text-subtle disabled:opacity-100 disabled:shadow-none motion-reduce:transition-none",
      BUTTON_VARIANTS[variant],
      BUTTON_SIZES[size],
      className,
    )}
    {...props}
  />
);

/** Token-themed shadcn Textarea primitive. */
export const Textarea = ({
  className,
  ref,
  ...props
}: ComponentPropsWithRef<"textarea">) => (
  <textarea
    ref={ref}
    className={joinClasses(
      "flex min-h-24 w-full resize-y rounded-md border border-edge-strong bg-paper px-2 py-1.5 text-base text-ink placeholder:text-subtle focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 wide:text-xs",
      className,
    )}
    {...props}
  />
);

/** Token-themed shadcn Card primitive. */
type CardProps = ComponentPropsWithRef<"div"> & {
  readonly density?: "default" | "compact" | "dense";
  readonly elevation?: "floating" | "none";
};

const CARD_DENSITIES = {
  default: "p-4",
  compact: "p-3",
  dense: "p-2",
} as const;

const CARD_ELEVATIONS = {
  floating: "shadow-floating",
  none: "shadow-none",
} as const;

export const Card = ({
  className,
  density = "default",
  elevation = "floating",
  ref,
  ...props
}: CardProps) => (
  <div
    ref={ref}
    className={joinClasses(
      "min-w-0 rounded-lg bg-raised text-ink",
      CARD_DENSITIES[density],
      CARD_ELEVATIONS[elevation],
      className,
    )}
    {...props}
  />
);

/** Token-themed shadcn Badge primitive. */
type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  readonly size?: "default" | "compact" | "micro" | "status";
  readonly shape?: "badge" | "pill";
  readonly tone?:
    | "neutral"
    | "accent"
    | "accentOutline"
    | "annotation"
    | "secondary"
    | "statusAccent"
    | "statusNeutral"
    | "statusWarning"
    | "statusWarningOutline"
    | "statusDanger";
  readonly weight?: "semibold" | "bold";
};

const BADGE_SIZES = {
  default: "px-2 py-0.5 text-xs",
  compact: "px-1 py-0.5 text-2xs",
  micro: "px-0.5 py-0 text-2xs",
  status: "px-1.5 py-0.5 text-2xs",
} as const;

const BADGE_TONES = {
  neutral: "border border-transparent bg-surface text-muted",
  accent: "border border-transparent bg-accent text-accent-ink",
  accentOutline: "border border-accent bg-transparent text-accent",
  annotation:
    "border border-[var(--annotation-c)] bg-transparent text-[var(--annotation-c)]",
  secondary: "border border-transparent bg-well text-muted",
  statusAccent:
    "bg-[color-mix(in_srgb,var(--accent-c)_14%,var(--bg))] text-accent",
  statusNeutral: "bg-[color-mix(in_srgb,var(--ink-c)_8%,var(--bg))] text-muted",
  statusWarning:
    "bg-[color-mix(in_srgb,var(--callout-warning-c)_14%,var(--bg))] text-[var(--callout-warning-c)]",
  // The same reading as statusWarning at a lighter weight, so a row can carry
  // both a warning state and a warning-family label without the two competing.
  statusWarningOutline:
    "border border-[var(--callout-warning-c)] bg-transparent text-[var(--callout-warning-c)]",
  statusDanger:
    "bg-[color-mix(in_srgb,var(--danger-c)_14%,var(--bg))] text-danger",
} as const;

const BADGE_SHAPES = {
  badge: "rounded-md",
  pill: "rounded-full",
} as const;

const BADGE_WEIGHTS = {
  semibold: "font-semibold",
  bold: "font-bold",
} as const;

/*
The one mark that means "working", everywhere the product says it.

A rotating circle with a gap, at the size its surface gives it. It had grown
three nearly-identical spellings and one bespoke alternative; a reader who has
learned what it means in one place should not have to learn it again in the
next, so it is spelled once here and sized by the caller.

The motion slows rather than stops for a reader who asks the OS for reduced
motion. Stopping it entirely would leave a static ring that reads as a shape
rather than as activity, and this mark is only ever on screen while something
is genuinely in flight.
*/
export const WorkingMark = ({
  className = "size-3",
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    /* box-border so the ring's own stroke sits inside the size it is given:
       a mark asked for eight pixels has to occupy eight, or it shifts the
       toolbar it replaces a dot in. */
    className={`box-border inline-block shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent motion-reduce:[animation-duration:2.4s] ${className}`}
    aria-hidden="true"
    {...props}
  />
);

export const Badge = ({
  className,
  size = "default",
  shape = "pill",
  tone = "neutral",
  weight = "semibold",
  ...props
}: BadgeProps) => (
  <span
    className={joinClasses(
      "inline-flex items-center",
      BADGE_SIZES[size],
      BADGE_SHAPES[shape],
      BADGE_TONES[tone],
      BADGE_WEIGHTS[weight],
      className,
    )}
    {...props}
  />
);

/**
 * A tooltip names the control it hangs off, tells the keystroke that drives
 * it, or explains a choice the reader is about to make; the three want
 * different measures. The shape is not a separate prop, because it follows
 * from what the caller supplies: keys make a shortcut, sections make an
 * explanation, a bare label names a control. Nothing can therefore pair
 * chipped keys or two paragraphs with the centred measure a caption wants.
 */
type TooltipShape = "label" | "shortcut" | "explanation";

type TooltipChildProps = {
  readonly "aria-describedby"?: string;
  readonly ref?: Ref<HTMLElement>;
  readonly onMouseEnter?: MouseEventHandler<HTMLElement>;
  readonly onMouseLeave?: MouseEventHandler<HTMLElement>;
  readonly onFocusCapture?: FocusEventHandler<HTMLElement>;
  readonly onBlurCapture?: FocusEventHandler<HTMLElement>;
};

/** One option of a choice: the option's name, and what choosing it costs. */
type TooltipSection = {
  readonly term: string;
  readonly detail: string;
};

/**
 * What the tooltip says, in exactly one of three forms. The union is what
 * keeps the forms from being mixed: a caller cannot ask for chipped keys and
 * sections at once, so the shape below is always decidable.
 */
type TooltipContent =
  | {
      readonly label: string;
      /**
       * One entry per keystroke, chipped ahead of the label, which then reads
       * as the rest of the sentence the keys start: ⌘ Enter "to submit this
       * comment now".
       */
      readonly shortcutKeys?: readonly string[];
      readonly sections?: undefined;
    }
  | {
      /**
       * One paragraph per option, each led by the option's name in bold. A
       * choice between two behaviours is two things a reader compares, and a
       * comparison told as one run of prose has to be taken apart before it
       * can be made.
       */
      readonly sections: readonly TooltipSection[];
      readonly label?: undefined;
      readonly shortcutKeys?: undefined;
    };

type TooltipProps = TooltipContent & {
  readonly children: ReactElement<TooltipChildProps>;
  readonly className?: string;
  readonly tooltipProps?: HTMLAttributes<HTMLSpanElement> &
    Record<`data-${string}`, string>;
  readonly placement?: "above" | "below";
  readonly asChild?: boolean;
  readonly isInstant?: boolean;
};

// A tooltip carrying one short label centres in a narrow column, because a
// centred line reads as a caption on the control it names. A tooltip that
// explains a trade-off is prose: it needs a wider measure and a left edge to
// return to, or the reader re-finds the start of every line.
// Each shape states its widest measure twice on purpose, once as the static
// Tailwind class the stylesheet can discover and once as the number the
// positioner clamps against; both are the same rem measure, so they sit
// together and stay equal.
const TOOLTIP_SHAPES: Record<
  TooltipShape,
  { readonly className: string; readonly maxWidthRem: number }
> = {
  label: {
    className:
      "max-w-[min(11rem,calc(100vw_-_2rem))] text-center font-semibold",
    maxWidthRem: 11,
  },
  explanation: {
    className: "max-w-[min(17rem,calc(100vw_-_2rem))] text-left font-normal",
    maxWidthRem: 17,
  },
  shortcut: {
    className: "max-w-[min(15rem,calc(100vw_-_2rem))] text-left font-normal",
    maxWidthRem: 15,
  },
};

/** Reads the shape's authored measure back at the reader's own root size. */
const tooltipMaxWidth = (shape: TooltipShape) =>
  resolveRemMeasure(
    TOOLTIP_SHAPES[shape].maxWidthRem,
    getComputedStyle(document.documentElement).fontSize,
  );

// A keystroke is a thing the reader presses, so it is drawn as a key rather
// than set in the sentence: one chip per key, found by the eye before the
// sentence explaining what it does is read. Its face is the tooltip's own key
// surface, which holds the ink back to a tint picked per theme; its edge
// borrows the tooltip's text colour, so the key keeps a drawn border on either
// surface without a second colour to keep in step.
const ShortcutKey = ({ children }: { readonly children: string }) => (
  <kbd className="inline-flex min-w-[1.25em] items-center justify-center rounded-sm border border-[color-mix(in_srgb,currentColor_30%,transparent)] bg-tooltip-key px-1 py-px font-sans font-semibold">
    {children}
  </kbd>
);

/** A portal tooltip with a deliberate default pause before secondary help. */
export const Tooltip = ({
  label,
  shortcutKeys,
  sections,
  children,
  className,
  tooltipProps,
  placement = "above",
  asChild = false,
  isInstant = false,
}: TooltipProps) => {
  const shape: TooltipShape =
    sections !== undefined
      ? "explanation"
      : shortcutKeys !== undefined
        ? "shortcut"
        : "label";
  const tooltipId = useId();
  const anchorRef = useRef<HTMLElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const hide = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    showTimerRef.current = null;
    hideTimerRef.current = null;
    setPosition(null);
  };
  const scheduleHide = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(hide, 100);
  };
  const reveal = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPosition(
      placeTooltip({
        anchor: rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        preferredPlacement: placement,
        maxWidth: tooltipMaxWidth(shape),
      }),
    );
  };
  const show = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (isInstant) {
      reveal();
      return;
    }
    showTimerRef.current = window.setTimeout(() => {
      reveal();
      showTimerRef.current = null;
    }, 1_000);
  };
  useEffect(
    () => () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
      }
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    },
    [],
  );
  useLayoutEffect(() => {
    if (position === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [position]);
  useLayoutEffect(() => {
    if (position === null) return;
    const reposition = () => reveal();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [position]);
  const tooltip =
    position === null
      ? null
      : createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            className={`pointer-events-auto fixed z-[2147483647] w-max -translate-x-1/2 overflow-y-auto overscroll-contain rounded-sm border border-tooltip-edge bg-tooltip px-2 py-1 text-2xs leading-[1.35] whitespace-normal text-tooltip-ink shadow-floating [overflow-wrap:anywhere] ${TOOLTIP_SHAPES[shape].className} ${position.placement === "above" ? "-translate-y-full" : ""}`}
            style={{
              top: position.top,
              left: position.left,
              maxHeight: position.maxHeight,
            }}
            onMouseEnter={show}
            // Scheduled, not immediate: the pointer travelling from the
            // tooltip back to its anchor would otherwise close it before the
            // anchor's own enter handler could cancel the hide, and the next
            // reveal would wait out the full open delay again.
            onMouseLeave={scheduleHide}
            {...tooltipProps}
          >
            {sections !== undefined ? (
              <dl className="m-0 flex flex-col gap-2">
                {sections.map(({ term, detail }) => (
                  // The name and its consequence stay one paragraph rather
                  // than two stacked lines: the reader is comparing options,
                  // and a lead-in that shares the line keeps each option to
                  // one block the eye can weigh against the other.
                  <div key={term}>
                    <dt className="m-0 inline font-semibold">{term}:</dt>{" "}
                    <dd className="m-0 inline">{detail}</dd>
                  </div>
                ))}
              </dl>
            ) : shortcutKeys === undefined ? (
              label
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1">
                {shortcutKeys.map((key) => (
                  <ShortcutKey key={key}>{key}</ShortcutKey>
                ))}
                <span>{label}</span>
              </span>
            )}
          </span>,
          document.body,
        );
  if (asChild) {
    return (
      <>
        {cloneElement(children, {
          "aria-describedby": tooltipId,
          ref: anchorRef,
          onMouseEnter: show,
          onMouseLeave: scheduleHide,
          onFocusCapture: show,
          onBlurCapture: hide,
        })}
        {tooltip}
      </>
    );
  }
  return (
    <span
      ref={anchorRef}
      className={joinClasses("inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {cloneElement(children, { "aria-describedby": tooltipId })}
      {tooltip}
    </span>
  );
};

type AlertDialogProps = {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly cancelLabel?: string;
  readonly actionLabel: string;
  readonly onCancel: () => void;
  readonly onAction: () => void;
  readonly onDismiss?: () => void;
  /** Evidence the choice needs, shown between the description and the controls. */
  readonly children?: ReactNode;
  /** A choice between two equal options is not a destructive one. */
  readonly tone?: "destructive" | "neutral";
  /** Overrides the action button's variant. Defaults from `tone`. */
  readonly actionVariant?: ButtonVariant;
  /** Full-width footnote below the action row, announced with the action. */
  readonly footnote?: string;
  readonly width?: "default" | "wide";
  /** Split puts cancel on the left and the action on the right. */
  readonly footerAlign?: "end" | "split";
  /** When set, the panel hangs below this control instead of the viewport center. */
  readonly anchorRef?: RefObject<HTMLElement | null>;
};

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Token-themed shadcn AlertDialog primitive for consequential choices. */
export const AlertDialog = ({
  open,
  title,
  description,
  cancelLabel = "Cancel",
  actionLabel,
  onCancel,
  onAction,
  onDismiss = onCancel,
  children,
  tone = "destructive",
  actionVariant,
  footnote,
  width = "default",
  footerAlign = "end",
  anchorRef,
}: AlertDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const footnoteId = useId();
  const [anchorPosition, setAnchorPosition] =
    useState<AnchoredDialogPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    window.getSelection()?.removeAllRanges();
    dialogRef.current?.focus();
    return () => {
      // The element that opened this dialog can be replaced while the dialog
      // is up - the plan refreshes in place - and focusing a detached node
      // drops focus to the body instead of returning it.
      if (previousFocus?.isConnected === true) previousFocus.focus();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setAnchorPosition(null);
      return;
    }
    const anchor = anchorRef?.current;
    if (anchor === undefined || anchor === null) {
      setAnchorPosition(null);
      return;
    }
    const update = () => {
      // Below the reading breakpoint a hanging panel collides with the
      // mobile sections bar and is too narrow for the disclosures.
      if (window.innerWidth < 80 * 16) {
        setAnchorPosition(null);
        return;
      }
      setAnchorPosition(
        placeAnchoredDialog({
          anchor: anchor.getBoundingClientRect(),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          preferredWidth: width === "wide" ? 42 * 16 : 32 * 16,
        }),
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open, width]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.repeat &&
      event.target === dialogRef.current
    ) {
      event.preventDefault();
      onAction();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
        [],
    ).filter((element) => !element.hasAttribute("disabled"));
    if (controls.length === 0) return;
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next =
      current === -1
        ? event.shiftKey
          ? controls.length - 1
          : 0
        : event.shiftKey
          ? (current - 1 + controls.length) % controls.length
          : (current + 1) % controls.length;
    event.preventDefault();
    controls[next]?.focus();
  };

  const describedBy =
    footnote === undefined ? descriptionId : `${descriptionId} ${footnoteId}`;
  const resolvedActionVariant =
    actionVariant ?? (tone === "neutral" ? "default" : "destructive");
  const anchored = anchorPosition !== null;
  // Header chrome is its own stacking context. Portaling to body is what lets
  // this overlay sit above the mobile sections bar instead of under it.
  // An anchored panel is a menu over the live page: no dim, and a click on
  // the transparent overlay dismisses it. A centered alert still dims.
  return createPortal(
    <div
      className={
        anchored
          ? "fixed inset-0 z-50"
          : "fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] place-items-center bg-backdrop/70 p-4"
      }
      {...(anchored ? {} : { "data-modal-backdrop": "" })}
      onKeyDown={handleKeyDown}
      onClick={
        anchored
          ? (event) => {
              if (event.target === event.currentTarget) onDismiss();
            }
          : undefined
      }
    >
      <div
        ref={dialogRef}
        // Raised, not paper: a floating surface reads as floating through
        // colour first, before its shadow. The danger tone belongs to the
        // destructive action alone, never to the whole dialog.
        className={joinClasses(
          "flex flex-col rounded-xl border border-edge bg-raised p-6 text-ink shadow-floating",
          anchored
            ? "absolute min-h-0 overflow-y-auto overscroll-contain"
            : "w-full max-h-[calc(100dvh-1.5rem)]",
          anchored ? undefined : width === "wide" ? "max-w-2xl" : "max-w-lg",
        )}
        style={
          anchored
            ? {
                top: anchorPosition.top,
                right: anchorPosition.right,
                width: anchorPosition.maxWidth,
                maxHeight: anchorPosition.maxHeight,
                maxWidth: anchorPosition.maxWidth,
              }
            : undefined
        }
        role="alertdialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        data-review-alert-width={width}
        data-review-alert-placement={anchored ? "anchor" : "center"}
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        <p id={descriptionId} className="mt-3 text-base text-muted">
          {description}
        </p>
        {/* The evidence slot's own space, owned here rather than by each
            dialog that fills it. Set at the call site it was set once and
            forgotten once: the hand-off dialog's "What happens" label sat
            flush against the sentence above it and read as that sentence's
            caption rather than as the heading of the list under it. */}
        {children === undefined ? null : (
          <div className="mt-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 overflow-y-auto overscroll-contain">
            {children}
          </div>
        )}
        <div
          className={joinClasses(
            "mt-6 flex gap-2",
            footerAlign === "split"
              ? "flex-col-reverse items-stretch wide:flex-row wide:items-center wide:justify-between"
              : "justify-end",
            )}
        >
          <Button variant="outline" size="md" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={resolvedActionVariant}
            size="md"
            onClick={onAction}
            aria-describedby={footnote === undefined ? undefined : footnoteId}
            className={
              width === "wide" && footerAlign === "split"
                ? "wide:w-auto max-sm:w-full"
                : undefined
            }
          >
            {actionLabel}
          </Button>
        </div>
        {footnote === undefined ? null : (
          <p
            id={footnoteId}
            className="mt-3 text-xs leading-normal text-muted"
            data-review-approve-footnote=""
          >
            {footnote}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
};
