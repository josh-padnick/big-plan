// Owns the small shadcn/ui primitive set used by review interaction islands.
// The copied component shapes keep native semantics and shadcn variants while
// mapping every visual choice onto Big Plan's closed design-token vocabulary.

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef } from "react";

const joinClasses = (
  ...values: ReadonlyArray<string | false | null | undefined>
): string => values.filter(Boolean).join(" ");

type ButtonVariant = "default" | "secondary" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "icon";

const BUTTON_VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  default:
    "bg-accent text-accent-ink shadow-raised hover:shadow-lifted active:inset-shadow-pressed",
  secondary:
    "bg-surface text-ink shadow-raised hover:bg-raised hover:shadow-lifted active:inset-shadow-pressed",
  ghost:
    "bg-transparent text-muted hover:bg-surface hover:text-ink active:inset-shadow-pressed",
  destructive:
    "bg-danger text-danger-ink shadow-raised hover:shadow-lifted active:inset-shadow-pressed",
};

const BUTTON_SIZES: Readonly<Record<ButtonSize, string>> = {
  default: "h-11 px-4 py-2",
  sm: "h-11 min-w-11 px-3 py-1.5 text-sm wide:h-9 wide:min-w-9",
  icon: "size-11 p-0",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
};

/** Token-themed shadcn Button primitive. */
export const Button = ({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={joinClasses(
      "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border-0 font-medium transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
      BUTTON_VARIANTS[variant],
      BUTTON_SIZES[size],
      className,
    )}
    {...props}
  />
);

/** Token-themed shadcn Textarea primitive. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={joinClasses(
      "flex min-h-24 w-full resize-y rounded-md border border-edge-strong bg-paper px-3 py-2 text-base text-ink shadow-raised placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/** Token-themed shadcn Card primitive. */
export const Card = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={joinClasses(
      "min-w-0 rounded-xl bg-raised p-4 text-ink shadow-floating",
      className,
    )}
    {...props}
  />
);

/** Token-themed shadcn Badge primitive. */
export const Badge = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={joinClasses(
      "inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted",
      className,
    )}
    {...props}
  />
);
