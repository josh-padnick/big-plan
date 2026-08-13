// Shared paste, drop, and picker capture for every reviewer composer. Upload
// completion inserts a digest reference at the captured caret position.

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
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
import {
  ReviewImage,
  type ReviewImageIdentity,
} from "./review-image.browser.js";
import { Button, Textarea } from "./ui.browser.js";

export const ComposeImages = ({
  body,
  onBodyChange,
  identity,
  label,
  placeholder,
  maxLength,
  onKeyDown,
  autoFocus = false,
  id,
}: {
  readonly body: string;
  readonly onBodyChange: (body: string) => void;
  readonly identity: ReviewImageIdentity | null;
  readonly label: string;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly autoFocus?: boolean;
  readonly id?: string;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);
  const references = extractReviewImageReferences(body);
  const upload = async (file: File, caret: number, altOverride?: string) => {
    if (identity === null) {
      setError("Start big-plan review to attach images.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Use PNG, JPEG, or WebP images.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Each image must be 10 MiB or smaller.");
      return;
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
      onBodyChange(
        `${current.slice(0, caret)}${buildReviewImageReference({ alt: value.alt, id: value.id })}${current.slice(caret)}`,
      );
      setError("");
    } catch (uploadError: unknown) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Image upload failed",
      );
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
      (chain, file) => chain.then(() => upload(file, caret, altOverride)),
      Promise.resolve(),
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
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    capture(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  return (
    <div onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <Textarea
        ref={textarea}
        id={id}
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
              identity={identity}
            />
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={input}
          data-review-image-picker=""
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          onChange={pick}
        />
        <Button
          variant="outline"
          size="micro"
          type="button"
          disabled={identity === null || pending > 0}
          onClick={() => input.current?.click()}
        >
          Choose image
        </Button>
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
