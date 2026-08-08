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
import { MINIMIZE_2_ICON } from "../../icons/lucide/minimize-2.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import type { CommentTarget, ReviewComment } from "../comment.js";
import { parseCommentMarkdownLine } from "../comment-markdown.js";
import { Icon } from "./icon.browser.js";
import { AlertDialog, Badge, Button, Card, Textarea } from "./ui.browser.js";

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT = 4000;
const LONG_COMMENT = 180;
const PROSE_KINDS = new Set(["heading", "paragraph", "list", "blockquote"]);
const TABLE_PRECISION_KINDS = new Set([
  "table-cell",
  "table-column",
  "table-row",
]);

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
  readonly left: number;
  readonly draftId?: string;
  readonly initialBody?: string;
};

type SelectionControlState = {
  readonly target: Extract<CommentTarget, { readonly type: "selection" }>;
  readonly top: number;
  readonly left: number;
};

type FeedbackTab = "comments" | "chat" | "agent";
type StagedCardSurface = "rail" | "thread";
type SelectionTarget = Extract<CommentTarget, { readonly type: "selection" }>;

const rootElement = document.documentElement;

/** Formats the compact freshness label used by contextual thread cards. */
const threadTime = (createdAt: string): string => {
  const elapsed = Math.max(0, Date.now() - Date.parse(createdAt));
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000)
    return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 2_592_000_000)
    return `${Math.floor(elapsed / 86_400_000)}d ago`;
  if (elapsed < 31_536_000_000)
    return `${Math.floor(elapsed / 2_592_000_000)}mo ago`;
  return `${Math.floor(elapsed / 31_536_000_000)}y ago`;
};

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

const targetForBlock = (
  block: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> => ({
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

const targetForReviewContainer = (
  container: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> | null =>
  container.matches("[data-quick-summary]")
    ? targetForBlock(container)
    : targetForSlide(container);

const targetLabel = (
  target: CommentTarget,
  includeSlideReference = false,
): string => {
  let label: string;
  if (target.type === "document") label = "Whole plan";
  else if (target.type === "selection")
    label = `Selected text in ${target.label}`;
  else if (target.kind === "table" || target.kind === "data-table")
    label = [target.section, "Table"].filter(Boolean).join(" · ");
  else label = target.label;

  if (!includeSlideReference || target.type === "document") return label;
  const kicker = targetElement(target)
    ?.closest<HTMLElement>("[data-slide]")
    ?.querySelector<HTMLElement>("[data-slide-kicker]")
    ?.textContent?.trim();
  const slideReference = kicker?.match(/^(\d+(?:\.\d+)*)\s*\//u)?.[1];
  return slideReference === undefined ? label : `${slideReference} · ${label}`;
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

const setSelectionHighlights = (
  targets: ReadonlyArray<SelectionTarget>,
  activeTarget: SelectionTarget | null,
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
  if (registry === undefined || HighlightClass === undefined) return;
  const ranges = targets
    .map((target) => selectionRange(target))
    .filter((range): range is Range => range !== null);
  if (ranges.length > 0)
    registry.set("big-plan-review-selection", new HighlightClass(...ranges));
  const activeRange =
    activeTarget === null ? null : selectionRange(activeTarget);
  if (activeRange !== null)
    registry.set(
      "big-plan-review-selection-active",
      new HighlightClass(activeRange),
    );
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

/** Finds chrome owned by one block without borrowing controls from a nested block. */
const ownedDescendant = (
  block: HTMLElement,
  selector: string,
): HTMLElement | null =>
  Array.from(block.querySelectorAll<HTMLElement>(selector)).find(
    (element) => element.closest<HTMLElement>("[data-block-id]") === block,
  ) ?? null;

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
      .filter(
        (block) =>
          !PROSE_KINDS.has(block.dataset.blockKind ?? "") &&
          !TABLE_PRECISION_KINDS.has(block.dataset.blockKind ?? "") &&
          block.closest("[data-quick-summary]") === null,
      )
      .map((block) => {
        const host = document.createElement("span");
        if (
          block.dataset.blockKind === "data-table" ||
          block.dataset.blockKind === "table"
        ) {
          host.dataset.reviewTableHost = "";
          (
            ownedDescendant(block, "[data-table-scroll-container]") ?? block
          ).append(host);
        } else {
          host.dataset.reviewAnchorHost = "";
          const copyControl = ownedDescendant(
            block,
            "[data-copy-source], [data-copy-code]",
          );
          const actionGroup = ownedDescendant(
            block,
            ".figure-action-group, .figure-control-bar",
          );
          const inlineHeader = ownedDescendant(
            block,
            ".file-tree-header, .callout-header",
          );
          const overlayHeader = ownedDescendant(
            block,
            ".decision-zone-question",
          );
          if (copyControl !== null) {
            host.dataset.reviewToolbarHost = "";
            copyControl.before(host);
          } else if (actionGroup !== null) {
            host.dataset.reviewToolbarHost = "";
            actionGroup.prepend(host);
          } else if (inlineHeader !== null) {
            host.dataset.reviewToolbarHost = "";
            host.dataset.reviewToolbarInline = "";
            inlineHeader.append(host);
          } else if (overlayHeader !== null) {
            host.dataset.reviewToolbarHost = "";
            host.dataset.reviewToolbarOverlay = "";
            overlayHeader.append(host);
          } else {
            block.append(host);
          }
        }
        return { block, host };
      });
    setHosts(mounted);
    return () => mounted.forEach(({ host }) => host.remove());
  }, []);
  return hosts;
};

const useReviewContainerHosts = () => {
  const [hosts, setHosts] = useState<
    ReadonlyArray<{
      readonly container: HTMLElement;
      readonly host: HTMLSpanElement;
    }>
  >([]);
  useEffect(() => {
    const mounted = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-slide], [data-quick-summary]",
      ),
    )
      .filter(
        (container) =>
          !container.matches("[data-quick-summary]") ||
          container.closest("[data-slide]") === null,
      )
      .map((container) => {
        const host = document.createElement("span");
        host.dataset.reviewSlideHost = "";
        container.append(host);
        container.dataset.reviewSlideSelectable = "";
        return { container, host };
      });
    setHosts(mounted);
    return () =>
      mounted.forEach(({ container, host }) => {
        host.remove();
        delete container.dataset.reviewSlideSelectable;
        delete container.dataset.reviewSlideSelected;
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
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia("(width < 80rem)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(width < 80rem)");
    const update = () => setIsNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if ((!isOpen && !isNarrow) || compose === null) {
      setHost(null);
      return;
    }
    const anchor = targetElement(compose.target);
    if (anchor === null) return;
    const next = document.createElement("div");
    next.dataset.reviewComposeInline = "";
    anchor.after(next);
    setHost(next);
    return () => {
      next.remove();
    };
  }, [compose, isNarrow, isOpen]);
  return host;
};

const useThreadHosts = (
  drafts: ReadonlyArray<ReviewComment>,
  isOpen: boolean,
): ReadonlyMap<string, HTMLDivElement> => {
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLDivElement>>(
    new Map(),
  );
  const [isWide, setIsWide] = useState(
    () => window.matchMedia("(min-width: 80rem)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 80rem)");
    const update = () => setIsWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (isOpen || !isWide) {
      setHosts(new Map());
      return;
    }
    const mounted = new Map<string, HTMLDivElement>();
    for (const comment of drafts) {
      const anchor = targetElement(comment.target);
      if (anchor === null) continue;
      const host = document.createElement("div");
      host.dataset.reviewThreadFor = comment.id;
      host.dataset.reviewThreadSide = "";
      document.body.append(host);
      mounted.set(comment.id, host);
    }
    const position = () => {
      const viewportWidth = document.documentElement.clientWidth;
      const edge = 24;
      const threadWidth = 17 * 16;
      const lastBottomByAnchor = new Map<HTMLElement, number>();
      for (const comment of drafts) {
        const host = mounted.get(comment.id);
        const target = targetElement(comment.target);
        if (host === undefined || target === null) continue;
        const anchor =
          target.closest<HTMLElement>("[data-slide], [data-quick-summary]") ??
          target;
        const anchorRect = anchor.getBoundingClientRect();
        const targetRect =
          comment.target.type === "selection"
            ? selectionRange(comment.target)?.getBoundingClientRect()
            : null;
        const cardHeight = Math.max(
          1,
          host.firstElementChild?.getBoundingClientRect().height ?? 1,
        );
        const desiredTop = (targetRect?.top ?? anchorRect.top) + window.scrollY;
        const previousBottom = lastBottomByAnchor.get(anchor) ?? 0;
        const top = Math.max(previousBottom, desiredTop);
        host.style.top = `${top}px`;
        host.style.left = `${Math.max(
          edge + window.scrollX,
          Math.min(
            anchorRect.right + window.scrollX - 12,
            window.scrollX + viewportWidth - threadWidth - edge,
          ),
        )}px`;
        lastBottomByAnchor.set(anchor, top + cardHeight + 8);
      }
    };
    const frame = requestAnimationFrame(position);
    const observer = new ResizeObserver(position);
    for (const host of mounted.values()) observer.observe(host);
    window.addEventListener("resize", position, { passive: true });
    setHosts(mounted);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", position);
      for (const host of mounted.values()) host.remove();
    };
  }, [drafts, isOpen, isWide]);

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
  const style: CSSProperties = {
    backgroundColor: "var(--bg)",
    borderRadius: "0.5rem",
    padding: "0.75rem",
    ...(inline ? {} : { top: `${compose.top}px`, left: `${compose.left}px` }),
  };
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
      <p className="review-compose-title text-xs">Add a comment</p>
      <Textarea
        ref={inputRef}
        aria-label="Add a comment"
        style={{ backgroundColor: "var(--review-compose-input-c)" }}
        value={body}
        maxLength={BODY_LIMIT}
        placeholder="What should the agent change here?"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <p className="review-compose-hint text-2xs">
        Escape cancels · {shortcut} adds
      </p>
      <div className="review-compose-controls">
        <button
          type="button"
          className="review-submit-toggle text-xs"
          role="switch"
          aria-checked={submitRightAway}
          onClick={() => setSubmitRightAway((current) => !current)}
        >
          <span aria-hidden="true" />
          Submit right away
        </button>
        <div className="review-compose-actions">
          <Button variant="outline" size="compact" onClick={onCancel}>
            Cancel
          </Button>
          <span className="review-shortcut-wrap">
            <Button size="compact" disabled={body.trim() === ""} onClick={save}>
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
  surface,
  collapsed,
  expanded,
  onCollapse,
  onExpandBody,
  onEdit,
  onDelete,
  onJump,
  onSubmit,
  onAssociate,
}: {
  readonly comment: ReviewComment;
  readonly surface: StagedCardSurface;
  readonly collapsed: boolean;
  readonly expanded: boolean;
  readonly onCollapse: () => void;
  readonly onExpandBody: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onJump: () => void;
  readonly onSubmit: () => void;
  readonly onAssociate: (target: SelectionTarget | null) => void;
}) => {
  const setAssociated = (active: boolean) => {
    const target = comment.target.type === "selection" ? comment.target : null;
    onAssociate(active ? target : null);
  };
  if (collapsed) {
    return (
      <button
        type="button"
        className={`review-staged-collapsed review-staged-collapsed-${surface}`}
        onClick={onCollapse}
        onPointerEnter={() => setAssociated(true)}
        onPointerLeave={() => setAssociated(false)}
        onFocus={() => setAssociated(true)}
        onBlur={() => setAssociated(false)}
        data-review-associated={
          comment.target.type === "selection" ? "true" : undefined
        }
        aria-label={`Expand staged comment on ${targetLabel(comment.target)}`}
      >
        <Badge
          size="micro"
          tone="accentOutline"
          weight="bold"
          className="review-staged-badge tracking-caps"
        >
          STAGED
        </Badge>
        <span>
          {surface === "rail" ? targetLabel(comment.target) : comment.body}
        </span>
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
      className="review-staged-card rounded-lg"
      density={surface === "rail" ? "dense" : "compact"}
      elevation={surface === "rail" ? "none" : "floating"}
      onPointerEnter={() => setAssociated(true)}
      onPointerLeave={() => setAssociated(false)}
      onFocus={() => setAssociated(true)}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setAssociated(false);
      }}
      data-review-associated={
        comment.target.type === "selection" ? "true" : undefined
      }
      data-review-surface={surface}
    >
      <div className="review-staged-meta">
        {surface === "rail" ? (
          <button
            type="button"
            className="review-staged-target"
            onClick={onJump}
            title="Jump to this target"
          >
            {targetLabel(comment.target, true)}
          </button>
        ) : (
          <>
            <Badge
              size="micro"
              tone="accentOutline"
              weight="bold"
              className="review-staged-badge tracking-caps"
            >
              STAGED
            </Badge>
            <time dateTime={comment.createdAt}>
              {threadTime(comment.createdAt)}
            </time>
          </>
        )}
        {surface === "rail" ? (
          <Badge
            size="micro"
            tone="accentOutline"
            weight="bold"
            className="review-staged-badge tracking-caps"
          >
            STAGED
          </Badge>
        ) : null}
        <div className="review-staged-actions">
          {surface === "thread" ? (
            <Button
              variant="ghost"
              size="compactIcon"
              aria-label="Minimize staged comment"
              onClick={onCollapse}
            >
              <Icon icon={MINIMIZE_2_ICON} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="compactIcon"
            className="review-staged-edit"
            aria-label="Edit staged comment"
            onClick={onEdit}
          >
            <Icon icon={PENCIL_ICON} />
          </Button>
          <Button
            variant="ghost"
            size="compactIcon"
            className="review-staged-delete"
            aria-label="Delete staged comment"
            onClick={onDelete}
          >
            <Icon icon={TRASH_2_ICON} />
          </Button>
        </div>
      </div>
      <MarkdownBody body={visibleBody} className="review-staged-body text-xs" />
      {long && !expanded ? (
        <button type="button" className="review-more" onClick={onExpandBody}>
          … more
        </button>
      ) : null}
      <div className="review-staged-footer">
        <Button variant="accentOutline" size="compact" onClick={onSubmit}>
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
  const reviewContainerHosts = useReviewContainerHosts();
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
  const [pendingDelete, setPendingDelete] = useState<ReviewComment | null>(
    null,
  );
  const [associatedSelection, setAssociatedSelection] =
    useState<SelectionTarget | null>(null);
  const [associationActive, setAssociationActive] = useState(false);
  const [status, setStatus] = useState(
    identity === null
      ? "Reading offline: drafts stay in this browser."
      : "Loading review…",
  );
  const inlineComposeHost = useInlineComposeHost(compose, isOpen);
  const threadHosts = useThreadHosts(drafts, isOpen);

  useEffect(() => {
    rootElement.toggleAttribute("data-review-kernel-open", isOpen);
    return () => rootElement.removeAttribute("data-review-kernel-open");
  }, [isOpen]);

  useEffect(() => {
    const composeSelection =
      compose?.target.type === "selection" ? compose.target : null;
    const persistentSelections = drafts
      .map((comment) => comment.target)
      .filter(
        (target): target is SelectionTarget => target.type === "selection",
      );
    if (composeSelection !== null) persistentSelections.push(composeSelection);
    const activeSelection =
      associatedSelection ?? (associationActive ? composeSelection : null);
    setSelectionHighlights(persistentSelections, activeSelection);
    rootElement.toggleAttribute(
      "data-review-selection-active",
      activeSelection !== null,
    );
    return () => {
      setSelectionHighlights([], null);
      rootElement.removeAttribute("data-review-selection-active");
    };
  }, [associatedSelection, associationActive, compose, drafts]);

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
    for (const { container } of reviewContainerHosts) {
      const selected =
        compose?.target.type === "block" &&
        targetElement(compose.target) === container;
      container.toggleAttribute("data-review-slide-selected", selected);
    }
  }, [compose, reviewContainerHosts]);

  useEffect(() => {
    for (const { block } of blockHosts) {
      const selected =
        compose?.target.type === "block" &&
        targetElement(compose.target) === block;
      block.toggleAttribute("data-review-block-selected", selected);
    }
  }, [blockHosts, compose]);

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
          current ??
          (() => {
            const targetRect = targetElement(target)?.getBoundingClientRect();
            const composerWidth = 17 * 16;
            const edge = 24;
            const gap = 12;
            const viewportWidth = document.documentElement.clientWidth;
            return {
              target,
              top: Math.max(56, Math.min(rect.top, window.innerHeight - 360)),
              left: Math.max(
                edge,
                Math.min(
                  (targetRect?.right ?? viewportWidth) + gap,
                  viewportWidth - composerWidth - edge,
                ),
              ),
              ...(draft === undefined
                ? {}
                : { draftId: draft.id, initialBody: draft.body }),
            };
          })(),
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

  const deleteDraft = (id: string) => {
    setDrafts((current) => current.filter((comment) => comment.id !== id));
    setPendingDelete(null);
    setStatus("Staged comment deleted.");
  };
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
      {reviewContainerHosts.map(({ container, host }) => {
        const target = targetForReviewContainer(container);
        if (target === null) return null;
        const pressed =
          compose?.target.type === "block" &&
          targetElement(compose.target) === container;
        const label = container.matches("[data-quick-summary]")
          ? "Comment on quick summary"
          : "Comment on slide";
        return createPortal(
          <button
            type="button"
            className="review-slide-comment"
            aria-label={label}
            aria-pressed={pressed}
            disabled={compose !== null && !pressed}
            onClick={() =>
              beginTarget(target, container.getBoundingClientRect())
            }
          >
            <Icon icon={MESSAGE_SQUARE_ICON} />
            <span role="tooltip">{label}</span>
          </button>,
          host,
          target.blockId,
        );
      })}
      {blockHosts.map(({ block, host }) =>
        createPortal(
          block.dataset.blockKind === "data-table" ||
            block.dataset.blockKind === "table" ? (
            <button
              type="button"
              className="review-table-comment"
              aria-label={`Comment on ${block.dataset.blockLabel ?? "this table"}`}
              aria-pressed={
                compose?.target.type === "block" &&
                targetElement(compose.target) === block
              }
              disabled={
                compose !== null && targetElement(compose.target) !== block
              }
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
              <span role="tooltip">Comment on table</span>
            </button>
          ) : host.dataset.reviewToolbarHost !== undefined ? (
            <button
              type="button"
              className="review-toolbar-comment"
              aria-label={`Comment on ${block.dataset.blockLabel ?? "this component"}`}
              aria-pressed={
                compose?.target.type === "block" &&
                targetElement(compose.target) === block
              }
              disabled={
                compose !== null && targetElement(compose.target) !== block
              }
              data-tooltip={`Comment on ${block.dataset.blockLabel ?? "component"}`}
              data-tooltip-delay="1s"
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
            </button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="review-block-button"
              aria-label={`Comment on ${block.dataset.blockLabel ?? "this component"}`}
              disabled={compose !== null}
              data-review-block-button=""
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
            </Button>
          ),
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
              {drafts.length > 0 ? (
                <Badge size="compact">{drafts.length}</Badge>
              ) : null}
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
              {drafts.length > 0 ? (
                <Badge size="compact">{drafts.length}</Badge>
              ) : null}
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
              size="compactIcon"
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
                        surface="rail"
                        collapsed={false}
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
                        onDelete={() => setPendingDelete(comment)}
                        onJump={() => jumpTo(comment)}
                        onSubmit={() => void sendComments([comment])}
                        onAssociate={setAssociatedSelection}
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
            {tab === "comments" ? (
              <Button
                className="review-send-all"
                size="sm"
                disabled={drafts.length === 0 || isSending}
                onClick={() => void sendComments(drafts)}
              >
                {isSending ? "Sending…" : "Send all comments to agent"}
              </Button>
            ) : null}
            <p role="status">{status}</p>
          </div>
        </aside>
      ) : null}
      {drafts.map((comment) => {
        const host = threadHosts.get(comment.id);
        if (host === undefined) return null;
        return createPortal(
          <StagedCard
            comment={comment}
            surface="thread"
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
            onDelete={() => setPendingDelete(comment)}
            onJump={() => jumpTo(comment)}
            onSubmit={() => void sendComments([comment])}
            onAssociate={setAssociatedSelection}
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
      <AlertDialog
        open={pendingDelete !== null}
        title="Delete comment?"
        description="This permanently removes your staged comment. This action cannot be undone."
        actionLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onAction={() => {
          if (pendingDelete !== null) deleteDraft(pendingDelete.id);
        }}
      />
    </>
  );
};

const mount = document.createElement("div");
mount.id = "big-plan-review-root";
document.body.append(mount);
createRoot(mount).render(<ReviewKernel />);
