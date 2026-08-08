// Mounts Big Plan's typed React review interaction island over the inert,
// server-rendered plan. React owns only review chrome; authored content stays
// server-rendered and readable when this island is unavailable.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { ACTIVITY_ICON } from "../../icons/lucide/activity.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { MESSAGES_SQUARE_ICON } from "../../icons/lucide/messages-square.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { SCAN_ICON } from "../../icons/lucide/scan.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import type { CommentTarget, ReviewComment } from "../comment.js";
import { parseCommentMarkdownLine } from "../comment-markdown.js";
import { Icon } from "./icon.browser.js";
import { Badge, Button, Card, Textarea } from "./ui.browser.js";

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT = 4000;
const LONG_COMMENT = 180;
const PROSE_KINDS = new Set(["heading", "paragraph", "list", "blockquote"]);

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
  readonly draftId?: string;
  readonly initialBody?: string;
};

type SelectionControlState = {
  readonly target: Extract<CommentTarget, { readonly type: "selection" }>;
  readonly top: number;
  readonly left: number;
};

type FeedbackTab = "comments" | "chat" | "agent";

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

const writeLocalDrafts = (
  planId: string,
  drafts: ReadonlyArray<ReviewComment>,
): void => {
  try {
    localStorage.setItem(localStorageKey(planId), JSON.stringify(drafts));
  } catch {
    // Offline browser persistence is best effort; visible status stays honest.
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

const blockIdentity = (block: HTMLElement) => ({
  blockId: block.dataset.blockId ?? "",
  kind: block.dataset.blockKind ?? "block",
  label: block.dataset.blockLabel ?? "This block",
  ...(block.dataset.blockSection === undefined
    ? {}
    : { section: block.dataset.blockSection }),
});

const targetForBlock = (block: HTMLElement): CommentTarget => ({
  type: "block",
  ...blockIdentity(block),
});

const targetForSlide = (
  slide: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> | null => {
  const firstBlock = slide.querySelector<HTMLElement>("[data-block-id]");
  if (firstBlock === null) {
    return null;
  }
  return {
    type: "block",
    ...blockIdentity(firstBlock),
    kind: "slide",
    label:
      firstBlock.dataset.blockSection ??
      firstBlock.dataset.blockLabel ??
      "Slide",
  };
};

const targetLabel = (target: CommentTarget): string => {
  if (target.type === "document") return "Whole plan";
  if (target.type === "selection") return `Selected text in ${target.label}`;
  return target.label;
};

const parentElementFor = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement;

const selectionControlState = (): SelectionControlState | null => {
  const selection = window.getSelection();
  if (
    selection === null ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed
  ) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const selector = '[data-block-id]:not([data-block-kind="part"])';
  const startBlock = parentElementFor(
    range.startContainer,
  )?.closest<HTMLElement>(selector);
  const endBlock = parentElementFor(range.endContainer)?.closest<HTMLElement>(
    selector,
  );
  if (
    startBlock == null ||
    startBlock !== endBlock ||
    startBlock.closest("#big-plan-review-root") !== null
  ) {
    return null;
  }
  const quote = selection.toString();
  if (quote.trim() === "" || quote.length > 400) return null;
  const before = document.createRange();
  before.selectNodeContents(startBlock);
  before.setEnd(range.startContainer, range.startOffset);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    target: {
      type: "selection",
      ...blockIdentity(startBlock),
      start: before.toString().length,
      end: before.toString().length + quote.length,
      quote,
    },
    top: Math.max(8, rect.top - 44),
    left: Math.max(8, Math.min(window.innerWidth - 132, rect.left)),
  };
};

const targetElement = (target: CommentTarget): HTMLElement | null => {
  if (target.type === "document") return document.querySelector("main");
  const block = document.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(target.blockId)}"]`,
  );
  return target.type === "block" && target.kind === "slide"
    ? (block?.closest<HTMLElement>("[data-slide]") ?? block)
    : block;
};

type HighlightRegistry = {
  set(name: string, value: unknown): void;
  delete(name: string): void;
};

const selectionRange = (
  target: Extract<CommentTarget, { readonly type: "selection" }>,
): Range | null => {
  const block = targetElement(target);
  if (block === null) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let startSet = false;
  let node = walker.nextNode();
  while (node !== null) {
    const length = node.textContent?.length ?? 0;
    if (!startSet && target.start <= offset + length) {
      range.setStart(node, Math.max(0, target.start - offset));
      startSet = true;
    }
    if (startSet && target.end <= offset + length) {
      range.setEnd(node, Math.max(0, target.end - offset));
      return range;
    }
    offset += length;
    node = walker.nextNode();
  }
  return null;
};

const setSelectionHighlight = (
  target: Extract<CommentTarget, { readonly type: "selection" }> | null,
  active: boolean,
): void => {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  registry?.delete("big-plan-review-selection");
  registry?.delete("big-plan-review-selection-active");
  const HighlightClass = (
    window as unknown as {
      Highlight?: new (...ranges: ReadonlyArray<Range>) => unknown;
    }
  ).Highlight;
  if (target === null || registry === undefined || HighlightClass === undefined)
    return;
  const range = selectionRange(target);
  if (range !== null) {
    registry.set(
      active ? "big-plan-review-selection-active" : "big-plan-review-selection",
      new HighlightClass(range),
    );
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

const inlineMarkdown = (source: string): ReadonlyArray<ReactNode> =>
  parseCommentMarkdownLine(source).map((token, index) => {
    const key = `${index}-${token.value}`;
    if (token.type === "code") return <code key={key}>{token.value}</code>;
    if (token.type === "strong")
      return <strong key={key}>{token.value}</strong>;
    if (token.type === "emphasis") return <em key={key}>{token.value}</em>;
    return token.value;
  });

const MarkdownBody = ({
  body,
  className = "",
}: {
  readonly body: string;
  readonly className?: string;
}) => (
  <div className={`review-comment-markdown ${className}`}>
    {body.split(/\n{2,}/u).map((paragraph, index) => (
      <p key={`${index}-${paragraph}`}>
        {paragraph
          .split("\n")
          .flatMap((line, lineIndex) => [
            ...(lineIndex === 0 ? [] : [<br key={`break-${lineIndex}`} />]),
            ...inlineMarkdown(line),
          ])}
      </p>
    ))}
  </div>
);

const relativeTime = (createdAt: string): string => {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(createdAt)) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

const useBlockHosts = () => {
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
    )
      .filter((block) => !PROSE_KINDS.has(block.dataset.blockKind ?? ""))
      .map((block) => {
        const host = document.createElement("span");
        host.dataset.reviewAnchorHost = "";
        block.append(host);
        return { block, host };
      });
    setHosts(mounted);
    return () => mounted.forEach(({ host }) => host.remove());
  }, []);
  return hosts;
};

const useSlideHosts = () => {
  const [hosts, setHosts] = useState<
    ReadonlyArray<{
      readonly slide: HTMLElement;
      readonly host: HTMLSpanElement;
    }>
  >([]);
  useEffect(() => {
    const mounted = Array.from(
      document.querySelectorAll<HTMLElement>("[data-slide]"),
    ).map((slide) => {
      const host = document.createElement("span");
      host.dataset.reviewSlideHost = "";
      slide.append(host);
      slide.dataset.reviewSlideSelectable = "";
      return { slide, host };
    });
    setHosts(mounted);
    return () =>
      mounted.forEach(({ slide, host }) => {
        host.remove();
        delete slide.dataset.reviewSlideSelectable;
        delete slide.dataset.reviewSlideSelected;
      });
  }, []);
  return hosts;
};

const useFeedbackHost = (): HTMLSpanElement | null => {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    const settings = document.querySelector<HTMLElement>(
      "[data-preferences-control]",
    );
    if (settings === null || settings.parentElement === null) return;
    const legacyControl = settings.parentElement.querySelector<HTMLElement>(
      "[data-comment-draft-control]",
    );
    if (legacyControl !== null) legacyControl.hidden = true;
    const next = document.createElement("span");
    next.dataset.reviewFeedbackHost = "";
    settings.before(next);
    setHost(next);
    return () => {
      next.remove();
      if (legacyControl !== null) legacyControl.hidden = false;
    };
  }, []);

  return host;
};

const useInlineComposeHost = (
  compose: ComposeState | null,
  isOpen: boolean,
): HTMLDivElement | null => {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isOpen || compose === null) {
      setHost(null);
      return;
    }
    const anchor = targetElement(compose.target);
    if (anchor === null) return;
    const next = document.createElement("div");
    next.dataset.reviewComposeInline = "";
    anchor.after(next);
    setHost(next);
    return () => next.remove();
  }, [compose, isOpen]);
  return host;
};

const useThreadHosts = (
  drafts: ReadonlyArray<ReviewComment>,
): ReadonlyMap<string, HTMLDivElement> => {
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLDivElement>>(
    new Map(),
  );

  useEffect(() => {
    const mounted = new Map<string, HTMLDivElement>();
    const lastHostByAnchor = new Map<HTMLElement, HTMLDivElement>();
    for (const comment of drafts) {
      const anchor = targetElement(comment.target);
      if (anchor === null) continue;
      const host = document.createElement("div");
      host.dataset.reviewThreadFor = comment.id;
      const lastHost = lastHostByAnchor.get(anchor);
      (lastHost ?? anchor).after(host);
      lastHostByAnchor.set(anchor, host);
      mounted.set(comment.id, host);
    }
    setHosts(mounted);
    return () => {
      for (const host of mounted.values()) host.remove();
    };
  }, [drafts]);

  return hosts;
};

const CommentComposer = ({
  compose,
  inline,
  onCancel,
  onSave,
}: {
  readonly compose: ComposeState;
  readonly inline: boolean;
  readonly onCancel: () => void;
  readonly onSave: (body: string, submitRightAway: boolean) => void;
}) => {
  const [body, setBody] = useState(compose.initialBody ?? "");
  const [submitRightAway, setSubmitRightAway] = useState(
    compose.draftId === undefined,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const save = () => body.trim() !== "" && onSave(body.trim(), submitRightAway);
  const shortcut = /Mac|iPhone|iPad/u.test(navigator.platform)
    ? "⌘+Enter"
    : "Ctrl+Enter";
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };
  const style: CSSProperties | undefined = inline
    ? undefined
    : { top: `${compose.top}px` };
  return (
    <Card
      className={
        inline
          ? "review-comment-composer review-comment-composer-inline"
          : "review-comment-composer review-comment-composer-floating"
      }
      style={style}
      role="dialog"
      aria-label={`Comment on ${targetLabel(compose.target)}`}
      data-review-associated={
        compose.target.type === "selection" ? "true" : undefined
      }
    >
      <p className="review-compose-title">Add a comment</p>
      <Textarea
        ref={inputRef}
        aria-label="Add a comment"
        value={body}
        maxLength={BODY_LIMIT}
        placeholder="What should the agent change here?"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <p className="review-compose-hint">Escape cancels · {shortcut} adds</p>
      <div className="review-compose-controls">
        <button
          type="button"
          className="review-submit-toggle"
          role="switch"
          aria-checked={submitRightAway}
          onClick={() => setSubmitRightAway((current) => !current)}
        >
          <span aria-hidden="true" />
          Submit right away
        </button>
        <div className="review-compose-actions">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <span className="review-shortcut-wrap">
            <Button size="sm" disabled={body.trim() === ""} onClick={save}>
              Submit Now
            </Button>
            <span role="tooltip" className="review-shortcut-tooltip">
              {shortcut}
            </span>
          </span>
        </div>
      </div>
    </Card>
  );
};

const StagedCard = ({
  comment,
  collapsed,
  expanded,
  onCollapse,
  onExpandBody,
  onEdit,
  onDelete,
  onJump,
  onSubmit,
}: {
  readonly comment: ReviewComment;
  readonly collapsed: boolean;
  readonly expanded: boolean;
  readonly onCollapse: () => void;
  readonly onExpandBody: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onJump: () => void;
  readonly onSubmit: () => void;
}) => {
  const setAssociated = (active: boolean) => {
    const target = comment.target.type === "selection" ? comment.target : null;
    setSelectionHighlight(active ? target : null, active);
  };
  if (collapsed) {
    return (
      <button
        type="button"
        className="review-staged-collapsed"
        onClick={onCollapse}
        onPointerEnter={() => setAssociated(true)}
        onPointerLeave={() => setAssociated(false)}
        data-review-associated={
          comment.target.type === "selection" ? "true" : undefined
        }
        aria-label={`Expand staged comment on ${targetLabel(comment.target)}`}
      >
        <Badge>STAGED</Badge>
        <span>{comment.body}</span>
      </button>
    );
  }
  const long = comment.body.length > LONG_COMMENT;
  const visibleBody =
    long && !expanded
      ? `${comment.body.slice(0, LONG_COMMENT).trimEnd()}…`
      : comment.body;
  return (
    <Card
      className="review-staged-card"
      onPointerEnter={() => setAssociated(true)}
      onPointerLeave={() => setAssociated(false)}
      data-review-associated={
        comment.target.type === "selection" ? "true" : undefined
      }
    >
      <div className="review-staged-meta">
        <button
          type="button"
          className="review-staged-collapse"
          onClick={onCollapse}
          aria-label="Collapse staged comment"
        >
          <Badge>STAGED</Badge>
        </button>
        <time dateTime={comment.createdAt}>
          {relativeTime(comment.createdAt)}
        </time>
        <div className="review-staged-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Jump to comment target"
            onClick={onJump}
          >
            <Icon icon={SCAN_ICON} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit staged comment"
            onClick={onEdit}
          >
            <Icon icon={PENCIL_ICON} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete staged comment"
            onClick={onDelete}
          >
            <Icon icon={TRASH_2_ICON} />
          </Button>
        </div>
      </div>
      <MarkdownBody body={visibleBody} className="review-staged-body" />
      {long && !expanded ? (
        <button type="button" className="review-more" onClick={onExpandBody}>
          … more
        </button>
      ) : null}
      <div className="review-staged-footer">
        <Button size="sm" onClick={onSubmit}>
          Submit Now
        </Button>
      </div>
    </Card>
  );
};

const ReviewKernel = () => {
  const identity = useMemo(runtimeIdentity, []);
  const planId =
    identity?.planId ?? rootElement.getAttribute("data-plan-id") ?? "";
  const blockHosts = useBlockHosts();
  const slideHosts = useSlideHosts();
  const feedbackHost = useFeedbackHost();
  const [drafts, setDrafts] = useState<ReadonlyArray<ReviewComment>>([]);
  const [sent, setSent] = useState<ReadonlyArray<ReviewComment>>([]);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [selectionControl, setSelectionControl] =
    useState<SelectionControlState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<FeedbackTab>("comments");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expandedBodies, setExpandedBodies] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [associationActive, setAssociationActive] = useState(false);
  const [status, setStatus] = useState(
    identity === null
      ? "Reading offline: drafts stay in this browser."
      : "Loading review…",
  );
  const inlineComposeHost = useInlineComposeHost(compose, isOpen);
  const threadHosts = useThreadHosts(drafts);

  useEffect(() => {
    rootElement.toggleAttribute("data-review-kernel-open", isOpen);
    return () => rootElement.removeAttribute("data-review-kernel-open");
  }, [isOpen]);

  useEffect(() => {
    const selection =
      compose?.target.type === "selection" ? compose.target : null;
    setSelectionHighlight(selection, associationActive);
    rootElement.toggleAttribute(
      "data-review-selection-active",
      selection !== null && associationActive,
    );
    return () => {
      setSelectionHighlight(null, false);
      rootElement.removeAttribute("data-review-selection-active");
    };
  }, [associationActive, compose]);

  useEffect(() => {
    const selection =
      compose?.target.type === "selection" ? compose.target : null;
    const block = selection === null ? null : targetElement(selection);
    if (block !== null) {
      block.dataset.reviewSelectionAssociated = "";
      const enter = () => setAssociationActive(true);
      const leave = () => setAssociationActive(false);
      block.addEventListener("pointerenter", enter);
      block.addEventListener("pointerleave", leave);
      return () => {
        block.removeEventListener("pointerenter", enter);
        block.removeEventListener("pointerleave", leave);
        delete block.dataset.reviewSelectionAssociated;
      };
    }
    return undefined;
  }, [compose]);

  useEffect(() => {
    for (const { slide } of slideHosts) {
      const selected =
        compose?.target.type === "block" &&
        compose.target.kind === "slide" &&
        targetElement(compose.target) === slide;
      slide.toggleAttribute("data-review-slide-selected", selected);
    }
  }, [compose, slideHosts]);

  useEffect(() => {
    let current = true;
    void (async () => {
      if (identity === null) {
        setDrafts(planId === "" ? [] : readLocalDrafts(planId));
        setIsHydrated(true);
        return;
      }
      try {
        const session = await requestJson({ path: "/api/session", identity });
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
        if (current) {
          setDrafts(snapshot.drafts);
          setSent(snapshot.sent);
          setStatus("Connected to the local review runtime.");
          setIsHydrated(true);
        }
      } catch (error) {
        if (current) {
          setStatus(errorMessage(error));
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [identity, planId]);

  useEffect(() => {
    if (!isHydrated) return;
    if (identity === null) {
      if (planId !== "") writeLocalDrafts(planId, drafts);
      return;
    }
    void requestJson({
      path: "/api/drafts",
      identity,
      method: "PUT",
      body: { drafts },
    }).catch((error: unknown) => setStatus(errorMessage(error)));
  }, [drafts, identity, isHydrated, planId]);

  useEffect(() => {
    if (compose !== null) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setSelectionControl(selectionControlState()),
      );
    };
    const clear = () => setSelectionControl(null);
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", clear, { passive: true });
    window.addEventListener("resize", clear, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", clear);
      window.removeEventListener("resize", clear);
    };
  }, [compose]);

  const beginTarget = useCallback(
    (
      target: CommentTarget,
      rect: Pick<DOMRect, "top">,
      draft?: ReviewComment,
    ) => {
      setCompose(
        (current) =>
          current ?? {
            target,
            top: Math.max(56, Math.min(rect.top, window.innerHeight - 360)),
            ...(draft === undefined
              ? {}
              : { draftId: draft.id, initialBody: draft.body }),
          },
      );
    },
    [],
  );

  const sendComments = async (comments: ReadonlyArray<ReviewComment>) => {
    if (identity === null) {
      setStatus(
        "Start `big-plan review` to submit comments. Your drafts are saved.",
      );
      setIsOpen(true);
      return;
    }
    setIsSending(true);
    try {
      const result = parseSnapshot(
        await requestJson({
          path: "/api/feedback",
          identity,
          method: "POST",
          body: { comments },
        }),
      );
      const ids = new Set(comments.map((comment) => comment.id));
      setDrafts((current) => current.filter((comment) => !ids.has(comment.id)));
      setSent((current) =>
        result.sent.length > 0 ? result.sent : [...current, ...comments],
      );
      setStatus(
        `${comments.length} comment${comments.length === 1 ? "" : "s"} submitted.`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  const saveComment = (body: string, submitRightAway: boolean) => {
    if (compose === null) return;
    const comment: ReviewComment = {
      id: compose.draftId ?? randomId(),
      body,
      createdAt:
        compose.draftId === undefined
          ? new Date().toISOString()
          : (drafts.find((candidate) => candidate.id === compose.draftId)
              ?.createdAt ?? new Date().toISOString()),
      target: compose.target,
    };
    setDrafts((current) =>
      compose.draftId === undefined
        ? [...current, comment]
        : current.map((candidate) =>
            candidate.id === comment.id ? comment : candidate,
          ),
    );
    setCompose(null);
    setIsOpen(true);
    setTab("comments");
    setStatus("Comment staged locally.");
    if (submitRightAway) void sendComments([comment]);
  };

  const deleteDraft = (id: string) =>
    setDrafts((current) => current.filter((comment) => comment.id !== id));
  const jumpTo = (comment: ReviewComment) =>
    targetElement(comment.target)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  const editDraft = (comment: ReviewComment) => {
    const element = targetElement(comment.target);
    if (element !== null)
      beginTarget(comment.target, element.getBoundingClientRect(), comment);
  };

  return (
    <>
      {slideHosts.map(({ slide, host }) => {
        const target = targetForSlide(slide);
        if (target === null) return null;
        const pressed =
          compose?.target.type === "block" &&
          compose.target.kind === "slide" &&
          targetElement(compose.target) === slide;
        return createPortal(
          <button
            type="button"
            className="review-slide-comment"
            aria-label="Comment on slide"
            aria-pressed={pressed}
            disabled={compose !== null && !pressed}
            onClick={() => beginTarget(target, slide.getBoundingClientRect())}
          >
            <Icon icon={MESSAGE_SQUARE_ICON} />
            <span role="tooltip">Comment on slide</span>
          </button>,
          host,
          target.blockId,
        );
      })}
      {blockHosts.map(({ block, host }) =>
        createPortal(
          <Button
            variant="secondary"
            size="sm"
            className="review-block-button"
            aria-label={`Comment on ${block.dataset.blockLabel ?? "this component"}`}
            disabled={compose !== null}
            data-review-block-button=""
            data-review-target-name={
              block.dataset.blockKind?.startsWith("table-")
                ? block.dataset.blockKind.replace("table-", "")
                : undefined
            }
            onClick={() =>
              beginTarget(targetForBlock(block), block.getBoundingClientRect())
            }
          >
            <Icon icon={MESSAGE_SQUARE_ICON} />
          </Button>,
          host,
          block.dataset.blockId,
        ),
      )}
      {selectionControl === null || compose !== null ? null : (
        <button
          type="button"
          className="review-selection-chip"
          style={{
            top: `${selectionControl.top}px`,
            left: `${selectionControl.left}px`,
          }}
          aria-label="Comment on selected text"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            beginTarget(selectionControl.target, { top: selectionControl.top });
            setSelectionControl(null);
          }}
        >
          <Icon icon={MESSAGE_SQUARE_ICON} />
          Comment
        </button>
      )}
      {feedbackHost === null
        ? null
        : createPortal(
            <button
              type="button"
              className="review-feedback-toggle"
              aria-expanded={isOpen}
              aria-controls="big-plan-feedback-rail"
              onClick={() => setIsOpen((current) => !current)}
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
              Feedback
              {drafts.length > 0 ? <Badge>{drafts.length}</Badge> : null}
            </button>,
            feedbackHost,
          )}
      {isOpen ? (
        <aside
          id="big-plan-feedback-rail"
          className="review-feedback-rail"
          aria-label="Feedback"
        >
          <div
            className="review-feedback-tabs"
            role="tablist"
            aria-label="Feedback views"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "comments"}
              onClick={() => setTab("comments")}
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
              Comments
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "chat"}
              onClick={() => setTab("chat")}
            >
              <Icon icon={MESSAGES_SQUARE_ICON} />
              Chat
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "agent"}
              onClick={() => setTab("agent")}
            >
              <Icon icon={ACTIVITY_ICON} />
              Agent
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close feedback"
              onClick={() => setIsOpen(false)}
            >
              <Icon icon={X_ICON} />
            </Button>
          </div>
          {tab === "comments" ? (
            <div className="review-feedback-panel" role="tabpanel">
              {drafts.length === 0 ? (
                <div className="review-feedback-empty">
                  <p>
                    {identity === null
                      ? "Reading offline: drafts stay in this browser until you start the local review runtime."
                      : "No comments staged."}
                  </p>
                  <p>
                    Select text to comment, or use a slide comment icon for the
                    whole slide.
                  </p>
                </div>
              ) : (
                <ol className="review-feedback-list">
                  {drafts.map((comment) => (
                    <li key={comment.id}>
                      <StagedCard
                        comment={comment}
                        collapsed={collapsed.has(comment.id)}
                        expanded={expandedBodies.has(comment.id)}
                        onCollapse={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(comment.id)) next.delete(comment.id);
                            else next.add(comment.id);
                            return next;
                          })
                        }
                        onExpandBody={() =>
                          setExpandedBodies((current) =>
                            new Set(current).add(comment.id),
                          )
                        }
                        onEdit={() => editDraft(comment)}
                        onDelete={() => deleteDraft(comment.id)}
                        onJump={() => jumpTo(comment)}
                        onSubmit={() => void sendComments([comment])}
                      />
                    </li>
                  ))}
                </ol>
              )}
              {sent.length > 0 ? (
                <p className="review-sent-count">
                  {sent.length} comment{sent.length === 1 ? "" : "s"} handed
                  off.
                </p>
              ) : null}
            </div>
          ) : null}
          {tab === "chat" ? (
            <div className="review-feedback-panel" role="tabpanel">
              <div className="review-feedback-empty">
                <Icon icon={MESSAGES_SQUARE_ICON} />
                <p>
                  <strong>Plan-wide chat</strong>
                </p>
                <p>
                  Ask about the plan as a whole. The connected agent loop
                  arrives in the next stack slice.
                </p>
              </div>
            </div>
          ) : null}
          {tab === "agent" ? (
            <div className="review-feedback-panel" role="tabpanel">
              <Card className="review-agent-card">
                <Icon icon={ACTIVITY_ICON} />
                <div>
                  <p>
                    <strong>No agent work in progress</strong>
                  </p>
                  <p>
                    {identity === null
                      ? "No agent connected. Start the local review runtime to hand off feedback."
                      : "The review runtime is connected and waiting for feedback."}
                  </p>
                </div>
              </Card>
            </div>
          ) : null}
          <div className="review-feedback-status">
            <p role="status">{status}</p>
            {tab === "comments" ? (
              <Button
                disabled={drafts.length === 0 || isSending}
                onClick={() => void sendComments(drafts)}
              >
                {isSending ? "Submitting…" : "Submit all"}
              </Button>
            ) : null}
          </div>
        </aside>
      ) : null}
      {drafts.map((comment) => {
        const host = threadHosts.get(comment.id);
        if (host === undefined) return null;
        return createPortal(
          <StagedCard
            comment={comment}
            collapsed={collapsed.has(comment.id)}
            expanded={expandedBodies.has(comment.id)}
            onCollapse={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(comment.id)) next.delete(comment.id);
                else next.add(comment.id);
                return next;
              })
            }
            onExpandBody={() =>
              setExpandedBodies((current) => new Set(current).add(comment.id))
            }
            onEdit={() => editDraft(comment)}
            onDelete={() => deleteDraft(comment.id)}
            onJump={() => jumpTo(comment)}
            onSubmit={() => void sendComments([comment])}
          />,
          host,
          comment.id,
        );
      })}
      {compose === null ? null : inlineComposeHost === null ? (
        <CommentComposer
          key={`${compose.draftId ?? "new"}-${compose.target.type === "document" ? "document" : compose.target.blockId}`}
          compose={compose}
          inline={false}
          onCancel={() => setCompose(null)}
          onSave={saveComment}
        />
      ) : (
        createPortal(
          <CommentComposer
            key={`${compose.draftId ?? "new"}-${compose.target.type === "document" ? "document" : compose.target.blockId}`}
            compose={compose}
            inline
            onCancel={() => setCompose(null)}
            onSave={saveComment}
          />,
          inlineComposeHost,
        )
      )}
    </>
  );
};

const mount = document.createElement("div");
mount.id = "big-plan-review-root";
document.body.append(mount);
createRoot(mount).render(<ReviewKernel />);
