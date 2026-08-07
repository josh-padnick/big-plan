// Mounts Big Plan's typed React review interaction island over the inert,
// server-rendered plan. React owns only comment controls, composition, and the
// thin thread kernel; it never renders, replaces, or gates authored content.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import type { CommentTarget, ReviewComment } from "../comment.js";
import { Icon } from "./icon.browser.js";
import { Badge, Button, Card, Textarea } from "./ui.browser.js";

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT = 4000;

type RuntimeIdentity = {
  readonly planId: string;
  readonly sessionId: string;
  readonly token: string;
};

type ReviewSnapshot = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sent: ReadonlyArray<ReviewComment>;
};

type ComposeState = {
  readonly target: CommentTarget;
  readonly top: number;
};

const rootElement = document.documentElement;

const runtimeIdentity = (): RuntimeIdentity | null => {
  const planId = rootElement.getAttribute("data-plan-id") ?? "";
  const sessionId = rootElement.getAttribute("data-review-session") ?? "";
  const token = rootElement.getAttribute("data-review-token") ?? "";
  return planId === "" || sessionId === "" || token === ""
    ? null
    : { planId, sessionId, token };
};

const isComment = (value: unknown): value is ReviewComment => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return (
    typeof record.id === "string" &&
    typeof record.body === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.target === "object" &&
    record.target !== null
  );
};

const parseSnapshot = (value: unknown): ReviewSnapshot => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { drafts: [], sent: [] };
  }
  const record = value as Readonly<Record<string, unknown>>;
  return {
    drafts: Array.isArray(record.drafts) ? record.drafts.filter(isComment) : [],
    sent: Array.isArray(record.sent) ? record.sent.filter(isComment) : [],
  };
};

const localStorageKey = (planId: string): string =>
  `big-plan:review:drafts:${planId}`;

const readLocalDrafts = (planId: string): ReadonlyArray<ReviewComment> => {
  try {
    const raw = localStorage.getItem(localStorageKey(planId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isComment) : [];
  } catch {
    return [];
  }
};

const writeLocalDrafts = ({
  planId,
  drafts,
}: {
  readonly planId: string;
  readonly drafts: ReadonlyArray<ReviewComment>;
}): void => {
  try {
    localStorage.setItem(localStorageKey(planId), JSON.stringify(drafts));
  } catch {
    // Browser storage is a best-effort fallback; the visible runtime status
    // remains the reviewer's source of truth when persistence is unavailable.
  }
};

const requestJson = async ({
  path,
  identity,
  method = "GET",
  body,
}: {
  readonly path: string;
  readonly identity: RuntimeIdentity;
  readonly method?: "GET" | "PUT" | "POST";
  readonly body?: unknown;
}): Promise<unknown> => {
  const response = await fetch(path, {
    method,
    mode: "same-origin",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    headers: {
      [TOKEN_HEADER]: identity.token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Review runtime refused the request (${response.status})`);
  }
  return response.json();
};

const randomId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
};

const targetForBlock = (block: HTMLElement): CommentTarget => ({
  type: "block",
  blockId: block.dataset.blockId ?? "",
  kind: block.dataset.blockKind ?? "block",
  label: block.dataset.blockLabel ?? "This block",
  ...(block.dataset.blockSection === undefined
    ? {}
    : { section: block.dataset.blockSection }),
});

const targetLabel = (target: CommentTarget): string => {
  if (target.type === "document") {
    return "Whole plan";
  }
  return target.label;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

const useBlockHosts = (): ReadonlyArray<{
  readonly block: HTMLElement;
  readonly host: HTMLSpanElement;
}> => {
  const [hosts, setHosts] = useState<
    ReadonlyArray<{
      readonly block: HTMLElement;
      readonly host: HTMLSpanElement;
    }>
  >([]);

  useEffect(() => {
    const mounted = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-block-id]:not([data-block-kind="part"])',
      ),
    ).map((block) => {
      const host = document.createElement("span");
      host.dataset.reviewAnchorHost = "";
      block.append(host);
      return { block, host };
    });
    setHosts(mounted);
    return () => {
      for (const { host } of mounted) {
        host.remove();
      }
    };
  }, []);

  return hosts;
};

const CommentComposer = ({
  compose,
  isKernelOpen,
  onCancel,
  onSave,
}: {
  readonly compose: ComposeState;
  readonly isKernelOpen: boolean;
  readonly onCancel: () => void;
  readonly onSave: (body: string) => void;
}) => {
  const [body, setBody] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = (): void => {
    const trimmed = body.trim();
    if (trimmed !== "") {
      onSave(trimmed);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };

  const style: CSSProperties = {
    top: `${compose.top}px`,
    ...(isKernelOpen ? { right: "calc(24rem + 1rem)" } : { right: "1rem" }),
  };

  return (
    <Card
      className="fixed z-20 w-[22rem] max-w-[calc(100vw-2rem)]"
      style={style}
      role="dialog"
      aria-label={`Comment on ${targetLabel(compose.target)}`}
    >
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase tracking-caps text-subtle">
            Add a note
          </p>
          <p className="mt-1 mb-0 truncate text-sm font-semibold text-ink">
            {targetLabel(compose.target)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label="Cancel comment"
          onClick={onCancel}
        >
          <Icon icon={X_ICON} />
        </Button>
      </div>
      <label
        className="mb-1.5 block text-sm font-medium text-ink"
        htmlFor="big-plan-review-note"
      >
        Your note
      </label>
      <Textarea
        ref={inputRef}
        id="big-plan-review-note"
        value={body}
        maxLength={BODY_LIMIT}
        placeholder="What should the agent consider?"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-subtle">⌘/Ctrl + Enter</span>
        <Button size="sm" disabled={body.trim() === ""} onClick={save}>
          Add note
        </Button>
      </div>
    </Card>
  );
};

const ReviewKernel = () => {
  const identity = useMemo(runtimeIdentity, []);
  const planId =
    identity?.planId ?? rootElement.getAttribute("data-plan-id") ?? "";
  const hosts = useBlockHosts();
  const [drafts, setDrafts] = useState<ReadonlyArray<ReviewComment>>([]);
  const [sent, setSent] = useState<ReadonlyArray<ReviewComment>>([]);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState(
    identity === null ? "Drafts stay in this browser." : "Loading review…",
  );

  useEffect(() => {
    rootElement.toggleAttribute("data-review-kernel-open", isOpen);
    return () => rootElement.removeAttribute("data-review-kernel-open");
  }, [isOpen]);

  useEffect(() => {
    const trigger = document.querySelector<HTMLButtonElement>(
      "[data-comment-draft-open]",
    );
    if (identity === null || trigger === null) {
      return;
    }
    const openKernel = (): void => {
      const legacyPanel = document.querySelector<HTMLElement>(
        "[data-comment-draft-panel]",
      );
      if (legacyPanel !== null) {
        legacyPanel.hidden = true;
      }
      setIsOpen(true);
    };
    trigger.addEventListener("click", openKernel);
    trigger.setAttribute("aria-controls", "big-plan-review-kernel");
    trigger.setAttribute("aria-expanded", String(isOpen));
    return () => trigger.removeEventListener("click", openKernel);
  }, [identity, isOpen]);

  useEffect(() => {
    let isCurrent = true;
    const hydrate = async (): Promise<void> => {
      if (identity === null) {
        setDrafts(planId === "" ? [] : readLocalDrafts(planId));
        setIsHydrated(true);
        return;
      }
      try {
        const session = await requestJson({
          path: "/api/session",
          identity,
        });
        if (
          typeof session !== "object" ||
          session === null ||
          !("sessionId" in session) ||
          session.sessionId !== identity.sessionId
        ) {
          throw new Error("This page is not connected to its review runtime.");
        }
        const snapshot = parseSnapshot(
          await requestJson({ path: "/api/drafts", identity }),
        );
        if (isCurrent) {
          setDrafts(snapshot.drafts);
          setSent(snapshot.sent);
          setStatus("Connected to the local review runtime.");
          setIsHydrated(true);
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setStatus(errorMessage(error));
          setIsHydrated(true);
        }
      }
    };
    void hydrate();
    return () => {
      isCurrent = false;
    };
  }, [identity, planId]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (identity === null) {
      if (planId !== "") {
        writeLocalDrafts({ planId, drafts });
      }
      return;
    }
    const persist = async (): Promise<void> => {
      try {
        await requestJson({
          path: "/api/drafts",
          identity,
          method: "PUT",
          body: { drafts },
        });
      } catch (error: unknown) {
        setStatus(errorMessage(error));
      }
    };
    void persist();
  }, [drafts, identity, isHydrated, planId]);

  useEffect(() => {
    const counts = new Map<string, number>();
    for (const comment of drafts) {
      if (comment.target.type !== "document") {
        counts.set(
          comment.target.blockId,
          (counts.get(comment.target.blockId) ?? 0) + 1,
        );
      }
    }
    for (const { block } of hosts) {
      const count = counts.get(block.dataset.blockId ?? "") ?? 0;
      if (count === 0) {
        block.removeAttribute("data-review-note-count");
      } else {
        block.dataset.reviewNoteCount = String(count);
      }
    }
  }, [drafts, hosts]);

  const beginComment = useCallback((block: HTMLElement): void => {
    const rect = block.getBoundingClientRect();
    setCompose({
      target: targetForBlock(block),
      top: Math.max(56, Math.min(rect.top, window.innerHeight - 360)),
    });
  }, []);

  const saveComment = (body: string): void => {
    if (compose === null) {
      return;
    }
    setDrafts((current) => [
      ...current,
      {
        id: randomId(),
        body,
        createdAt: new Date().toISOString(),
        target: compose.target,
      },
    ]);
    setCompose(null);
    setIsOpen(true);
    setStatus("Note saved locally.");
  };

  const sendDrafts = async (): Promise<void> => {
    if (identity === null) {
      setStatus("Start `big-plan review` to send these notes.");
      return;
    }
    setIsSending(true);
    try {
      const result = parseSnapshot(
        await requestJson({
          path: "/api/feedback",
          identity,
          method: "POST",
          body: { comments: drafts },
        }),
      );
      setSent(result.sent.length > 0 ? result.sent : [...sent, ...drafts]);
      setDrafts([]);
      setStatus("Notes sent to the local agent handoff.");
    } catch (error: unknown) {
      setStatus(errorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      {hosts.map(({ block, host }) =>
        createPortal(
          <Button
            variant="secondary"
            size="sm"
            className="review-block-button"
            aria-label="Add note"
            title={`Comment on ${block.dataset.blockLabel ?? "this block"}`}
            data-review-block-button=""
            onClick={() => beginComment(block)}
          >
            <Icon icon={MESSAGE_SQUARE_ICON} />
          </Button>,
          host,
          block.dataset.blockId,
        ),
      )}
      {identity === null && drafts.length > 0 && !isOpen ? (
        <Button
          className="fixed right-4 bottom-4 z-20"
          aria-expanded="false"
          aria-controls="big-plan-review-kernel"
          onClick={() => setIsOpen(true)}
        >
          <Icon icon={MESSAGE_SQUARE_ICON} />
          Review notes
          <Badge>{drafts.length}</Badge>
        </Button>
      ) : null}
      {isOpen ? (
        <aside
          id="big-plan-review-kernel"
          className="fixed top-11 right-0 bottom-0 z-10 flex w-96 max-w-full flex-col bg-paper p-4 shadow-floating"
          aria-label="Review notes"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="m-0 text-xl font-semibold text-ink">Review notes</p>
              <p className="mt-1 mb-0 text-sm text-muted">
                Thin thread kernel · {drafts.length} staged
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close review notes"
              onClick={() => setIsOpen(false)}
            >
              <Icon icon={X_ICON} />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {drafts.length === 0 ? (
              <Card className="bg-surface shadow-raised">
                <p className="m-0 font-semibold text-ink">
                  No notes staged yet
                </p>
                <p className="mt-2 mb-0 text-sm text-muted">
                  Hover or focus a plan block, then choose Comment.
                </p>
              </Card>
            ) : (
              <ol className="m-0 grid list-none gap-3 p-0">
                {drafts.map((comment) => (
                  <li key={comment.id}>
                    <Card className="shadow-raised">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="m-0 truncate text-sm font-semibold text-ink">
                            {targetLabel(comment.target)}
                          </p>
                          <p className="mt-2 mb-0 text-sm text-muted">
                            {comment.body}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          aria-label={`Delete note on ${targetLabel(comment.target)}`}
                          onClick={() =>
                            setDrafts((current) =>
                              current.filter(
                                (candidate) => candidate.id !== comment.id,
                              ),
                            )
                          }
                        >
                          <Icon icon={TRASH_2_ICON} />
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ol>
            )}
            {sent.length > 0 ? (
              <section className="mt-6">
                <p className="m-0 text-xs font-semibold uppercase tracking-caps text-subtle">
                  Sent
                </p>
                <p className="mt-2 mb-0 text-sm text-muted">
                  {sent.length} note{sent.length === 1 ? "" : "s"} handed off.
                </p>
              </section>
            ) : null}
          </div>
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted" role="status">
              {status}
            </p>
            <Button
              className="w-full"
              disabled={drafts.length === 0 || isSending}
              onClick={() => void sendDrafts()}
            >
              {isSending ? "Sending…" : "Send notes"}
            </Button>
          </div>
        </aside>
      ) : null}
      {compose === null ? null : (
        <CommentComposer
          compose={compose}
          isKernelOpen={isOpen}
          onCancel={() => setCompose(null)}
          onSave={saveComment}
        />
      )}
    </>
  );
};

const mount = document.createElement("div");
mount.id = "big-plan-review-root";
document.body.append(mount);
createRoot(mount).render(<ReviewKernel />);
