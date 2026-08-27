// Owns the live review's More actions menu and confirmed Markdown download.
// Static documents never mount this control and retain their Settings gear.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ELLIPSIS_ICON } from "../../icons/lucide/ellipsis.js";
import { Icon } from "./icon.browser.js";
import {
  requestMarkdownExport,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { AlertDialog, toast } from "./ui.browser.js";

const MENU_LABELS = ["Export", "Settings"] as const;

const focusTrigger = (trigger: RefObject<HTMLButtonElement | null>): void => {
  requestAnimationFrame(() => trigger.current?.focus());
};

export const PlanExportControl = ({
  identity,
}: {
  readonly identity: RuntimeIdentity;
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const settings = document.querySelector<HTMLElement>(
      "[data-preferences-control]",
    );
    if (settings === null) return;
    const wasHidden = settings.hidden;
    settings.hidden = true;
    return () => {
      settings.hidden = wasHidden;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    itemRefs.current[0]?.focus();
    const outside = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        menuRef.current?.contains(target) !== true &&
        triggerRef.current?.contains(target) !== true
      ) {
        // Clicking elsewhere is intent to use that control, so the trigger is
        // restored only by Escape or by choosing an item.
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);

  const closeMenu = (): void => {
    setMenuOpen(false);
    focusTrigger(triggerRef);
  };

  const openExport = (): void => {
    setMenuOpen(false);
    triggerRef.current?.focus();
    setDialogOpen(true);
  };

  const openSettings = (): void => {
    setMenuOpen(false);
    // The settings bridge records the currently focused element for its own
    // close path. Focus the durable trigger before dispatching so it never
    // captures the menu item React is about to remove.
    triggerRef.current?.focus();
    document.dispatchEvent(new CustomEvent("bigplan:open-settings"));
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = itemRefs.current.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % MENU_LABELS.length;
    if (event.key === "ArrowUp") {
      next = (current - 1 + MENU_LABELS.length) % MENU_LABELS.length;
    }
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = MENU_LABELS.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    itemRefs.current[next]?.focus();
  };

  const dismissDialog = (): void => {
    if (pending) return;
    setDialogOpen(false);
    focusTrigger(triggerRef);
  };

  const download = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const result = await requestMarkdownExport({ identity });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Browsers that queue the download navigation rather than starting it
      // during click dispatch cancel it when the blob URL is already gone.
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
      setAnnouncement(`Downloaded ${result.filename}.`);
      setDialogOpen(false);
      focusTrigger(triggerRef);
    } catch (error: unknown) {
      toast.error("The plan could not be exported.", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-toolbar-surface hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="size-4">
          <Icon icon={ELLIPSIS_ICON} />
        </span>
      </button>
      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More actions"
          className="absolute top-full right-0 z-50 mt-1 min-w-36 rounded-lg border border-edge bg-raised p-1 text-sm text-ink shadow-floating"
          onKeyDown={handleMenuKeyDown}
        >
          <button
            ref={(node) => {
              itemRefs.current[0] = node;
            }}
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full cursor-pointer items-center rounded-md border-0 bg-transparent px-3 text-left hover:bg-surface focus-visible:outline-1 focus-visible:outline-accent"
            onClick={openExport}
          >
            Export
          </button>
          <button
            ref={(node) => {
              itemRefs.current[1] = node;
            }}
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full cursor-pointer items-center rounded-md border-0 bg-transparent px-3 text-left hover:bg-surface focus-visible:outline-1 focus-visible:outline-accent"
            onClick={openSettings}
          >
            Settings
          </button>
        </div>
      ) : null}
      <AlertDialog
        open={dialogOpen}
        title="Export this plan as Markdown?"
        description="Download the latest saved plan as a Markdown file. Draft agent edits and comments are not included."
        actionLabel="Export"
        tone="neutral"
        pending={pending}
        onCancel={dismissDialog}
        onDismiss={dismissDialog}
        onAction={() => {
          void download();
        }}
      >
        {pending ? (
          <p role="status" aria-live="polite" className="text-sm text-muted">
            Preparing export...
          </p>
        ) : undefined}
      </AlertDialog>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </span>
  );
};
