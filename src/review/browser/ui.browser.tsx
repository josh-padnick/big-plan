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
import { placeTooltip, type TooltipPosition } from "./tooltip-position.js";

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
        icon: "mt-0.5 shrink-0 text-danger",
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
  | "destructive";
type ButtonSize =
  "default" | "md" | "sm" | "compact" | "micro" | "compactIcon" | "icon";

const BUTTON_VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  default:
    "rounded-md border border-transparent bg-accent font-semibold text-accent-ink shadow-raised hover:shadow-lifted active:inset-shadow-pressed",
  secondary:
    "rounded-md border border-transparent bg-surface font-medium text-ink shadow-raised hover:bg-raised hover:shadow-lifted active:inset-shadow-pressed",
  outline:
    "rounded-md border border-edge bg-transparent font-normal text-muted shadow-none hover:bg-surface hover:text-ink hover:shadow-raised active:inset-shadow-pressed",
  accentOutline:
    "rounded-sm border border-accent bg-paper font-semibold text-accent shadow-none hover:bg-accent-wash hover:shadow-raised active:inset-shadow-pressed",
  ghost:
    "rounded-md border border-transparent bg-transparent font-normal text-muted hover:bg-surface hover:text-ink active:inset-shadow-pressed",
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

type TooltipChildProps = {
  readonly "aria-describedby"?: string;
  readonly ref?: Ref<HTMLElement>;
  readonly onMouseEnter?: MouseEventHandler<HTMLElement>;
  readonly onMouseLeave?: MouseEventHandler<HTMLElement>;
  readonly onFocusCapture?: FocusEventHandler<HTMLElement>;
  readonly onBlurCapture?: FocusEventHandler<HTMLElement>;
};

type TooltipProps = {
  readonly label: string;
  readonly children: ReactElement<TooltipChildProps>;
  readonly className?: string;
  readonly tooltipProps?: HTMLAttributes<HTMLSpanElement> &
    Record<`data-${string}`, string>;
  readonly placement?: "above" | "below";
  readonly asChild?: boolean;
  readonly isInstant?: boolean;
};

/** A portal tooltip with a deliberate default pause before secondary help. */
export const Tooltip = ({
  label,
  children,
  className,
  tooltipProps,
  placement = "above",
  asChild = false,
  isInstant = false,
}: TooltipProps) => {
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
  useEffect(() => {
    if (position === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      hide();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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
            className={`pointer-events-auto fixed z-[2147483647] w-max max-w-[min(11rem,calc(100vw_-_2rem))] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-sm bg-[var(--ink-c)] px-2 py-1 text-center text-2xs leading-[1.35] font-semibold whitespace-normal text-[var(--bg)] shadow-floating [overflow-wrap:anywhere] ${position.placement === "above" ? "-translate-y-full" : ""}`}
            style={{
              top: position.top,
              left: position.left,
              maxHeight: position.maxHeight,
            }}
            onMouseEnter={show}
            onMouseLeave={hide}
            {...tooltipProps}
          >
            {label}
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
};

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
}: AlertDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);

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
      dialogRef.current?.querySelectorAll<HTMLElement>("button") ?? [],
    );
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

  const titleId = "review-alert-dialog-title";
  const descriptionId = "review-alert-dialog-description";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--preferences-backdrop-c)] p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-edge bg-paper p-6 text-ink shadow-floating"
        role="alertdialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        <p id={descriptionId} className="mt-3 text-base text-muted">
          {description}
        </p>
        {children}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" size="md" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "neutral" ? "default" : "destructive"}
            size="md"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
