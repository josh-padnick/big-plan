// Fetches reviewer-owned image blobs with the session token and presents a
// thumbnail that opens in one accessible, focus-restoring dialog.

import { useEffect, useRef, useState } from "react";
import { X_ICON } from "../../icons/lucide/x.js";
import { Icon } from "./icon.browser.js";
import { Button } from "./ui.browser.js";

export type ReviewImageIdentity = { readonly token: string };

/** Reads the token injected into the live review document, if present. */
export const runtimeReviewImageIdentity = (): ReviewImageIdentity | null => {
  const token = document.documentElement.getAttribute("data-review-token");
  return token === null || token === "" ? null : { token };
};

export const ReviewImage = ({
  id,
  alt,
  identity,
}: {
  readonly id: string;
  readonly alt: string;
  readonly identity: ReviewImageIdentity | null;
}) => {
  const [url, setUrl] = useState<string>();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  useEffect(() => {
    if (identity === null) return undefined;
    let active = true;
    let objectUrl: string | undefined;
    void fetch(`/api/review-images?id=${encodeURIComponent(id)}`, {
      headers: { "x-big-plan-review-token": identity.token },
    })
      .then(async (response) => {
        if (!response.ok) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [id, identity]);
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  if (url === undefined)
    return <span className="text-xs text-subtle">Image unavailable</span>;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="mt-2 block cursor-zoom-in rounded border border-edge p-0.5 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`Open ${alt}`}
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={alt} className="h-12 w-16 rounded object-cover" />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
            if (event.key === "Tab") {
              event.preventDefault();
              closeButton.current?.focus();
            }
          }}
        >
          <div className="relative max-h-full max-w-full rounded border border-edge bg-paper p-3 shadow-floating">
            <Button
              ref={closeButton}
              variant="ghost"
              size="compactIcon"
              className="absolute top-1 right-1"
              aria-label="Close image"
              onClick={close}
            >
              <Icon icon={X_ICON} />
            </Button>
            <img
              src={url}
              alt={alt}
              className="max-h-[80vh] max-w-[min(90vw,64rem)] object-contain"
            />
            <p className="m-0 mt-2 max-w-[min(90vw,64rem)] text-xs text-muted">
              {alt}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
};
