// Shared paste, drop, and picker capture for every reviewer composer. Upload
// completion inserts a digest reference at the captured caret position.

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  buildReviewImageReference,
  extractReviewImageReferences,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type ReviewImageDescriptor,
} from "../shared/review-image.js";
import { ReviewImage } from "./review-image.browser.js";
import {
  reviewWriteRefusal,
  type ReviewWriteAvailability,
} from "./review-write-availability.js";
import { Button, Textarea } from "./ui.browser.js";

// Uploading is the one image action that still needs the live session: it
// writes into the plan's review store, so it carries the session token the
// same way every other write does. Reading a stored picture does not.
export type ReviewImageIdentity = { readonly token: string };

export const ComposeImages = ({
  body,
  onBodyChange,
  identity,
  writeAvailability,
  label,
  placeholder,
  maxLength,
  onKeyDown,
  textareaClassName,
  autoFocus = false,
  id,
}: {
  readonly body: string;
  readonly onBodyChange: (body: string) => void;
  readonly identity: ReviewImageIdentity | null;
  /**
   * Whether a write sent now could still be accepted. An upload is a write, so
   * it asks the same shared question every other mutation path asks rather than
   * discovering the refusal after the reviewer has watched it upload.
   *
   * Required, and deliberately without a default: defaulting to "available"
   * would let a composer added later bypass the gate by saying nothing, which
   * is the failure this shared question exists to remove. A missing answer is
   * a compile error instead of a silent upload through a runtime that has
   * already refused.
   */
  readonly writeAvailability: ReviewWriteAvailability;
  readonly label: string;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly textareaClassName?: string;
  readonly autoFocus?: boolean;
  readonly id?: string;
}) => {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);
  const references = extractReviewImageReferences(body);
  // Returns where the caret should sit for the next upload in the chain. A
  // batch that reused one offset spliced each reference in front of the last,
  // so a paste or drop of several images landed them in reverse order.
  const upload = async (
    file: File,
    caret: number,
    altOverride?: string,
  ): Promise<number> => {
    // Nothing typed is touched: only the digest reference this would have
    // inserted is withheld, so the composer keeps exactly what it had.
    const refusal = reviewWriteRefusal({
      path: "attach-image",
      availability: writeAvailability,
    });
    if (refusal !== undefined) {
      setError(refusal);
      return caret;
    }
    if (identity === null) return caret;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Use PNG, JPEG, or WebP images.");
      return caret;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Each image must be 10 MiB or smaller.");
      return caret;
    }
    setPending((value) => value + 1);
    try {
      const response = await fetch("/api/review-images", {
        method: "POST",
        headers: {
          "x-big-plan-review-token": identity.token,
          "x-big-plan-image-alt":
            altOverride ?? (file.name.replace(/\.[^.]+$/u, "") || "Screenshot"),
        },
        body: file,
      });
      const value = (await response.json()) as
        ReviewImageDescriptor | { readonly error?: string };
      if (!response.ok || !("id" in value)) {
        throw new Error(
          "error" in value && value.error ? value.error : "Image upload failed",
        );
      }
      const current = textarea.current?.value ?? body;
      const reference = buildReviewImageReference({
        alt: value.alt,
        id: value.id,
      });
      onBodyChange(
        `${current.slice(0, caret)}${reference}${current.slice(caret)}`,
      );
      setError("");
      return caret + reference.length;
    } catch (uploadError: unknown) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Image upload failed",
      );
      return caret;
    } finally {
      setPending((value) => value - 1);
    }
  };
  const capture = (files: ReadonlyArray<File>, altOverride?: string) => {
    if (references.length + files.length > MAX_IMAGES_PER_MESSAGE) {
      setError(
        `A message can contain at most ${MAX_IMAGES_PER_MESSAGE} images.`,
      );
      return;
    }
    const caret = textarea.current?.selectionStart ?? body.length;
    void files.reduce(
      (chain, file) => chain.then((next) => upload(file, next, altOverride)),
      Promise.resolve(caret),
    );
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items).flatMap((item) => {
      const file = item.kind === "file" ? item.getAsFile() : null;
      return file === null ? [] : [file];
    });
    if (files.length > 0) {
      event.preventDefault();
      capture(files, "Screenshot");
    }
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    capture(Array.from(event.dataTransfer.files));
  };
  return (
    <div onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <Textarea
        ref={textarea}
        id={id}
        className={textareaClassName}
        aria-label={label}
        value={body}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onBodyChange(event.target.value)}
        onPaste={paste}
        onKeyDown={onKeyDown}
      />
      {references.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {references.map((reference, index) => (
            <ReviewImage
              key={`${reference.id}-${index}`}
              id={reference.id}
              alt={reference.alt}
            />
          ))}
        </div>
      ) : null}
      {/* Paste and drop cover the common capture, but neither is available to
          a reader working from the keyboard or from a file they already have
          on disk, so the picker is the third way in rather than a fourth
          convenience. */}
      <input
        ref={picker}
        className="hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) capture(files);
        }}
      />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => picker.current?.click()}
        >
          Choose image
        </Button>
        <p className="m-0 text-2xs text-muted">Markdown and images supported</p>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {pending > 0 ? (
          <span className="text-2xs text-muted">Uploading…</span>
        ) : null}
        {error ? (
          <span role="status" className="text-2xs text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
};
