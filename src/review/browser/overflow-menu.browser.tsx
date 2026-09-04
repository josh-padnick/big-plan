// Owns the "..." menu that holds a control's less-used siblings.
//
// The review bar's row is a decision the reviewer makes over and over, so it
// carries only the two per-change answers and the step controls. Deciding a
// whole set at once, and deleting the thread that proposed it, are rarer and
// heavier, and putting them in the row would make the row read as a wall of
// equally likely buttons. They live behind one disclosure instead, immediately
// to the right of the control they are variations of.
//
// The panel is portalled because the bar clips its own content, and positioned
// from a measured rect because the bar is pinned to the bottom of the viewport
// where a panel drawn below its trigger is off-screen.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ELLIPSIS_ICON } from "../../icons/lucide/ellipsis.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { Icon } from "./icon.browser.js";
import { Button } from "./ui.browser.js";
import {
  placeOverflowMenu,
  type MenuPosition,
} from "./overflow-menu-position.js";

/** One thing the menu can do, as the reviewer reads it. */
export type OverflowMenuItem = {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** An explanation the label alone cannot carry, such as why it is disabled. */
  readonly description?: string;
  /** Destructive items are separated from the rest and coloured as such. */
  readonly tone?: "default" | "danger";
};

type EscapeKeyboardEvent = KeyboardEvent & { bigPlanEscapeHandled?: boolean };

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

export const OverflowMenu = ({
  label,
  items,
  disabled = false,
  triggerClassName,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<OverflowMenuItem>;
  readonly disabled?: boolean;
  readonly triggerClassName?: string;
}): ReactNode => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = (restoreFocus = true): void => {
    setIsOpen(false);
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  };

  // Measured after the panel is in the tree but before the reader sees it, so
  // it never paints at the origin and jumps to where it belongs.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const anchor = trigger.current?.getBoundingClientRect();
    const menu = panel.current?.getBoundingClientRect();
    if (anchor === undefined || menu === undefined) return;
    setPosition(
      placeOverflowMenu({
        anchor,
        menu: { width: menu.width, height: menu.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [isOpen, items.length]);

  // Focus waits for the measurement, because the panel is hidden until it has
  // one and a hidden element cannot take focus: focusing a frame earlier is a
  // no-op that leaves the menu open with the keyboard still outside it.
  useEffect(() => {
    if (!isOpen || position === null) return;
    panel.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (
        target !== null &&
        (panel.current?.contains(target) === true ||
          trigger.current?.contains(target) === true)
      ) {
        return;
      }
      close(false);
    };
    // Escape closes the menu and stops there. The tour behind it also listens
    // for Escape, and an unmarked event would close both, taking the reviewer
    // out of the review they were only closing a menu inside of.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        const escapeEvent = event as EscapeKeyboardEvent;
        event.preventDefault();
        escapeEvent.bigPlanEscapeHandled = true;
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const options = [
        ...(panel.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []),
      ];
      if (options.length === 0) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + step + options.length) % options.length;
      options.at(next)?.focus();
    };
    // A resize can move the trigger out from under a panel that was measured
    // against the old viewport. Scrolling deliberately does not close it: the
    // bar this hangs from is pinned to the viewport and does not move, and a
    // capture-phase scroll listener would also fire for every scrollable
    // container the pointer happens to cross on its way to the item.
    const onResize = (): void => close(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [isOpen]);

  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        size="micro"
        className={triggerClassName}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-review-overflow-trigger=""
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon icon={ELLIPSIS_ICON} />
      </Button>
      {!isOpen
        ? null
        : createPortal(
            <div
              ref={panel}
              role="menu"
              aria-label={label}
              data-review-overflow-menu=""
              className="fixed z-50 grid w-64 grid-cols-[minmax(0,1fr)] gap-0.5 rounded-lg border border-edge-strong bg-raised p-1 text-xs text-ink shadow-floating"
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                visibility: position === null ? "hidden" : "visible",
              }}
            >
              {items.map((item, index) => (
                <div key={item.id} className="grid grid-cols-[minmax(0,1fr)]">
                  {/* A destructive item is set apart by a rule rather than by
                      colour alone, so the break is visible before the reader
                      has read the label. */}
                  {item.tone === "danger" && index > 0 ? (
                    <span aria-hidden="true" className="my-1 h-px bg-edge" />
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled === true}
                    data-review-overflow-item={item.id}
                    className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left transition hover:bg-surface focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent disabled:cursor-default disabled:text-subtle disabled:hover:bg-transparent [&>svg]:size-3.5 ${
                      item.tone === "danger" ? "text-danger" : "text-ink"
                    }`}
                    onClick={() => {
                      close();
                      item.onSelect();
                    }}
                  >
                    <Icon icon={item.icon} />
                    <span className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
                      <span className="truncate font-medium">{item.label}</span>
                      {item.description === undefined ? null : (
                        <span className="text-2xs text-muted [overflow-wrap:anywhere]">
                          {item.description}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )}
    </>
  );
};
