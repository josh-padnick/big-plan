// The reviewer's half of plan commenting, authored as the one browser script
// a rendered plan ships for review. scripts/gen-review-script.mjs bundles it
// into src/render/shell/review-script.generated.ts; the shell embeds that
// module, so a document stays self-contained and plan content still
// contributes no script of its own.
//
// Three rules run through every line here, and they are security properties,
// not style:
//
//  1. Reviewer text, quoted plan text, and agent progress text are DATA.
//     Everything user- or agent-supplied reaches the page through textContent
//     or a value property. This file never assigns innerHTML and never builds
//     markup from a string.
//  2. The session token travels in a header, never in a URL, so it stays out
//     of history, referrers, and any log that records paths.
//  3. Nothing leaves the machine. Every request is a same-origin path against
//     the runtime that served this document; a document opened from file://
//     makes no request at all and keeps drafts locally.

import { CHECK_ICON } from "../../src/icons/lucide/check.js";
import { MESSAGE_SQUARE_TEXT_ICON } from "../../src/icons/lucide/message-square-text.js";
import { MESSAGES_SQUARE_ICON } from "../../src/icons/lucide/messages-square.js";
import { MINIMIZE_2_ICON } from "../../src/icons/lucide/minimize-2.js";
import { ROTATE_CCW_ICON } from "../../src/icons/lucide/rotate-ccw.js";
import { UNDO_2_ICON } from "../../src/icons/lucide/undo-2.js";
import { X_ICON } from "../../src/icons/lucide/x.js";
import { diffRunSimilarity } from "../../src/review/revision-diff.js";

(() => {
  "use strict";

  const root = document.documentElement;
  const planId = root.getAttribute("data-plan-id") || "";
  const sessionId = root.getAttribute("data-review-session") || "";
  const sessionToken = root.getAttribute("data-review-token") || "";
  // A runtime is present only when it rendered and served this very document,
  // which is the only way the session attributes can be here at all.
  const hasRuntime = sessionId !== "" && sessionToken !== "";

  const blocks = Array.from(document.querySelectorAll("[data-block-id]"));
  if (blocks.length === 0) return;

  const TOKEN_HEADER = "x-big-plan-review-token";
  const QUOTE_LIMIT = 400;
  const BODY_LIMIT = 4000;
  const LONG_COMMENT_LIMIT = 180;
  const PROGRESS_INTERVAL_MS = 1500;
  const MESSAGE_LIMIT = 200;
  const FLOAT_TOP = 52;
  const FLOAT_GAP = 8;
  const FLOAT_EDGE = 12;
  const FLOAT_CONTENT_GAP = 12;

  // ---------------------------------------------------------------- elements

  // The only DOM builder in this file. Text always arrives as a child string
  // and is set with textContent, so a comment body can never become chrome.
  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    for (const name of Object.keys(props || {})) {
      const value = props[name];
      if (value === undefined || value === false) continue;
      if (name === "text") node.textContent = String(value);
      else if (name === "value") node.value = String(value);
      else if (value === true) node.setAttribute(name, "");
      else node.setAttribute(name, String(value));
    }
    for (const child of children || []) {
      if (child) node.appendChild(child);
    }
    return node;
  };

  const icon = (definition) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const [tag, attributes] of definition.node) {
      const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attributes)) {
        shape.setAttribute(name, String(value));
      }
      svg.appendChild(shape);
    }
    return svg;
  };

  // ------------------------------------------------------------------ target

  // A selection's common ancestor is usually a text node, which has no
  // closest(), so the search starts from the nearest element either way.
  const blockOf = (node) => {
    const element =
      node instanceof Element ? node : (node && node.parentElement) || null;
    return element === null ? null : element.closest("[data-block-id]");
  };

  const labelFor = (block) =>
    (block && block.getAttribute("data-block-label")) || "This block";

  const kindFor = (block) =>
    (block && block.getAttribute("data-block-kind")) || "block";

  // How a target reads in the tray. The authored label stays in the middle,
  // where adjacent same-kind targets differ, while section and kind keep the
  // relationship to the plan explicit.
  const describeTarget = (target) => {
    if (target.type === "document") return "Whole plan";
    const kind = target.kind ? readableKind(target.kind) : "Block";
    const location = [target.section, target.label]
      .filter((part) => typeof part === "string" && part !== "")
      .join(" / ");
    if (target.type === "lines") {
      const range =
        target.start === target.end
          ? "line " + target.start
          : "lines " + target.start + "-" + target.end;
      return location + " · " + kind + " · " + range;
    }
    if (target.type === "selection")
      return location + " · " + kind + " · selected text";
    return location + " · " + kind;
  };

  // The deck transform marks top-level and nested slides but intentionally
  // does not bake display numbers into content. Derive the reader-facing
  // outline once from document order so tray titles can say "3.1 · Backoff"
  // without making that number part of the authoritative plan.
  const slideNumberBySection = new Map();
  let majorSlide = 0;
  let minorSlide = 0;
  for (const slide of document.querySelectorAll("[data-slide]")) {
    if (slide.hasAttribute("data-subslide")) {
      minorSlide += 1;
    } else {
      majorSlide += 1;
      minorSlide = 0;
    }
    const section = slide
      .querySelector("[data-block-section]")
      ?.getAttribute("data-block-section");
    if (section) {
      slideNumberBySection.set(
        section,
        slide.hasAttribute("data-subslide")
          ? majorSlide + "." + minorSlide
          : String(majorSlide),
      );
    }
  }

  // Comment chrome names the numbered slide, not the renderer's full
  // structural path. The source highlight carries the exact passage.
  const slideTitleFor = (target) => {
    if (target.type === "document") return "Overview";
    const title = target.section || target.label || "Plan";
    const number = slideNumberBySection.get(title);
    return number ? number + " · " + title : title;
  };

  const readableKind = (kind) =>
    kind
      .split("-")
      .filter(Boolean)
      .map((word, index) =>
        index === 0 ? word[0].toUpperCase() + word.slice(1) : word,
      )
      .join(" ");

  // ------------------------------------------------------------------- state

  // Drafts are the reviewer's, unsent. Sent comments are kept for the session
  // so "I know the agent has it" survives a scroll away from the tray.
  let drafts = [];
  let sent = [];
  let editingId = null;
  let composeTarget = null;
  let cursorBlock = null;
  let pendingSelection = null;
  let activeDraft = "";
  let threadReplies = {};
  let planChatMessages = [];
  let agentRequests = [];
  let agentResponses = [];
  let sourceRevision = "";
  let progressSeq = 0;
  let progressTimer = null;
  let progressEvents = [];
  let runtimeConfirmed = false;
  let deleteCandidateId = null;
  let revertCandidateId = null;
  let submitRightAway = false;
  let showAgentActivity = true;
  const revisionDiffs = new Map();
  const chatDigestExpansion = new Map();
  let diffLens = null;
  const expandedCommentIds = new Set();
  const expandedThreadIds = new Set();
  const minimizedDraftIds = new Set();
  const resolvedCommentIds = new Set();

  const newId = () => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  // ----------------------------------------------------------------- storage

  // Without a runtime the document still holds drafts, but only when the
  // renderer stamped a plan id. There is deliberately no title-keyed fallback:
  // two plans that share a title would share a namespace, and drafts quote
  // plan text, so a collision would leak one plan's content into another's.
  const isExchangeId = (value) =>
    typeof value === "string" && /^[a-f0-9]{4,64}$/.test(value);

  const storageKey = planId === "" ? null : "big-plan:review:drafts:" + planId;
  const submitPreferenceKey = "big-plan:review:submit-right-away";
  const reloadKey =
    planId === "" ? null : "big-plan:review:live-reload:" + planId;

  const readReloadState = () => {
    if (reloadKey === null) return null;
    try {
      const raw = sessionStorage.getItem(reloadKey);
      sessionStorage.removeItem(reloadKey);
      if (raw === null) return null;
      const value = JSON.parse(raw);
      if (
        value === null ||
        typeof value !== "object" ||
        typeof value.scrollY !== "number" ||
        !Array.isArray(value.expanded)
      ) {
        return null;
      }
      return {
        scrollY: Math.max(0, value.scrollY),
        expanded: value.expanded.filter(isExchangeId),
        tab: value.tab === "chat" ? "chat" : "comments",
        railOpen: value.railOpen === true,
      };
    } catch {
      return null;
    }
  };

  const reloadState = readReloadState();

  const emptyStoredState = () => ({
    drafts: [],
    sent: [],
    activeDraft: "",
    threadReplies: {},
    planChatMessages: [],
    resolvedCommentIds: [],
    agent: { requests: [], responses: [] },
    sourceRevision: "",
  });

  const isStoredState = (value) =>
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value.drafts) &&
    Array.isArray(value.sent) &&
    typeof value.activeDraft === "string";

  const isStoredMessage = (value) =>
    value !== null &&
    typeof value === "object" &&
    (value.role === "user" || value.role === "agent") &&
    typeof value.body === "string" &&
    value.body.trim() !== "" &&
    value.body.length <= BODY_LIMIT &&
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt));

  const checkedMessages = (value) =>
    (Array.isArray(value) ? value : [])
      .filter(isStoredMessage)
      .slice(0, MESSAGE_LIMIT)
      .map((message) => ({
        role: message.role,
        body: message.body,
        createdAt: new Date(message.createdAt).toISOString(),
      }));

  const checkedThreadReplies = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const checked = {};
    for (const [id, messages] of Object.entries(value)) {
      if (!/^[a-f0-9]{4,64}$/.test(id)) continue;
      checked[id] = checkedMessages(messages);
    }
    return checked;
  };

  const checkedStoredState = (value) => {
    if (!isStoredState(value)) return emptyStoredState();
    return {
      drafts: value.drafts.filter(isComment),
      sent: value.sent.filter(isComment),
      activeDraft: value.activeDraft.slice(0, BODY_LIMIT),
      threadReplies: checkedThreadReplies(value.threadReplies),
      planChatMessages: checkedMessages(value.planChatMessages),
      resolvedCommentIds: (Array.isArray(value.resolvedCommentIds)
        ? value.resolvedCommentIds
        : []
      ).filter(isExchangeId),
      agent: checkedAgentSnapshot(value.agent),
      sourceRevision:
        typeof value.sourceRevision === "string" &&
        /^[a-f0-9]{16,64}$/.test(value.sourceRevision)
          ? value.sourceRevision
          : "",
    };
  };

  const isAgentRequest = (value) =>
    value !== null &&
    typeof value === "object" &&
    isExchangeId(value.requestId) &&
    (value.kind === "feedback" ||
      value.kind === "reply" ||
      value.kind === "chat") &&
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    (value.kind === "feedback" ||
      (typeof value.body === "string" &&
        value.body.trim() !== "" &&
        value.body.length <= BODY_LIMIT));

  const isAgentOutcome = (value) =>
    value !== null &&
    typeof value === "object" &&
    isExchangeId(value.commentId) &&
    (value.state === "changed" ||
      value.state === "question" ||
      value.state === "outside") &&
    typeof value.message === "string" &&
    value.message.trim() !== "" &&
    value.message.length <= BODY_LIMIT &&
    (value.changeTargets === undefined ||
      (Array.isArray(value.changeTargets) &&
        value.changeTargets.length > 0 &&
        value.changeTargets.every(
          (target) => typeof target === "string" && target.length <= 300,
        )));

  const isAgentResponse = (value) =>
    value !== null &&
    typeof value === "object" &&
    isExchangeId(value.requestId) &&
    (value.kind === "feedback" ||
      value.kind === "reply" ||
      value.kind === "chat") &&
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    (value.kind === "chat"
      ? typeof value.message === "string" &&
        value.message.trim() !== "" &&
        value.message.length <= BODY_LIMIT
      : Array.isArray(value.outcomes) && value.outcomes.every(isAgentOutcome));

  const checkedAgentSnapshot = (value) => {
    if (value === null || typeof value !== "object") {
      return { requests: [], responses: [] };
    }
    return {
      requests: (Array.isArray(value.requests) ? value.requests : [])
        .filter(isAgentRequest)
        .slice(0, MESSAGE_LIMIT),
      responses: (Array.isArray(value.responses) ? value.responses : [])
        .filter(isAgentResponse)
        .slice(0, MESSAGE_LIMIT),
    };
  };

  const readLocalState = () => {
    if (storageKey === null) return emptyStoredState();
    try {
      const raw = localStorage.getItem(storageKey);
      return checkedStoredState(raw === null ? null : JSON.parse(raw));
    } catch {
      return emptyStoredState();
    }
  };

  const writeLocalState = () => {
    if (storageKey === null) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          drafts,
          sent,
          activeDraft,
          threadReplies,
          planChatMessages,
        }),
      );
    } catch {
      // A full or blocked store costs persistence, never the session.
    }
  };

  const isCommentTarget = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (value.type === "document") return true;
    if (!["block", "selection", "lines"].includes(value.type)) return false;
    if (
      typeof value.blockId !== "string" ||
      typeof value.kind !== "string" ||
      typeof value.label !== "string" ||
      (value.section !== undefined && typeof value.section !== "string")
    ) {
      return false;
    }
    if (value.type === "block") return true;
    return (
      Number.isSafeInteger(value.start) &&
      Number.isSafeInteger(value.end) &&
      value.start >= 0 &&
      value.end >= value.start &&
      typeof value.quote === "string"
    );
  };

  const isComment = (value) =>
    value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.body === "string" &&
    isCommentTarget(value.target);

  const readBootstrapState = () => {
    const raw = root.getAttribute("data-review-bootstrap");
    if (raw === null) return emptyStoredState();
    try {
      return checkedStoredState(JSON.parse(raw));
    } catch {
      return emptyStoredState();
    }
  };

  // The runtime injects validated state into the document itself, so this
  // assignment runs before any review chrome is constructed. Browser storage
  // is a synchronous recovery mirror for a reload that races the last disk
  // write; the server remains the durable owner across runtime restarts.
  const diskState = hasRuntime ? readBootstrapState() : emptyStoredState();
  const browserState = readLocalState();
  const initialIds = new Set(diskState.drafts.map((draft) => draft.id));
  drafts = diskState.drafts.concat(
    browserState.drafts.filter((draft) => !initialIds.has(draft.id)),
  );
  sent = diskState.sent;
  activeDraft =
    browserState.activeDraft !== ""
      ? browserState.activeDraft
      : diskState.activeDraft;
  threadReplies = browserState.threadReplies;
  planChatMessages = browserState.planChatMessages;
  for (const id of diskState.resolvedCommentIds) {
    resolvedCommentIds.add(id);
  }
  agentRequests = diskState.agent.requests;
  agentResponses = diskState.agent.responses;
  sourceRevision = diskState.sourceRevision;
  for (const id of reloadState?.expanded || []) {
    expandedThreadIds.add(id);
  }
  try {
    submitRightAway = localStorage.getItem(submitPreferenceKey) === "true";
  } catch {
    submitRightAway = false;
  }

  // ---------------------------------------------------------------- transport

  // Every call is a same-origin path on the runtime that served this page.
  // The token rides a header; `same-origin` mode makes a redirect to another
  // origin a network error rather than a quiet exfiltration.
  const call = async (path, options) => {
    const response = await fetch(path, {
      method: (options && options.method) || "GET",
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: Object.assign(
        { [TOKEN_HEADER]: sessionToken },
        options && options.body ? { "content-type": "application/json" } : {},
      ),
      ...(options && options.body
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    if (!response.ok) {
      throw new Error(
        "Review runtime refused the request (" + response.status + ")",
      );
    }
    return response.json();
  };

  // The runtime proves it is the process that minted this document's session
  // before the document hands it anything. A process that squatted the port
  // after render fails this check and collects nothing.
  const confirmRuntime = async () => {
    if (runtimeConfirmed) return true;
    const answer = await call("/api/session");
    if (answer.sessionId !== sessionId || answer.planId !== planId) {
      throw new Error("The review runtime on this port is not this session");
    }
    runtimeConfirmed = true;
    return true;
  };

  const persist = async () => {
    writeLocalState();
    if (!hasRuntime) {
      return;
    }
    await confirmRuntime();
    await call("/api/drafts", {
      method: "PUT",
      body: {
        drafts,
        activeDraft,
        resolvedCommentIds: Array.from(resolvedCommentIds),
      },
    });
  };

  // ------------------------------------------------------------------ layout

  const rail = el("aside", {
    "data-review-rail": true,
    "aria-label": "Feedback",
    hidden: true,
  });

  const toggle = el("button", {
    type: "button",
    "data-review-toggle": true,
    "aria-expanded": "false",
    "aria-label": "Open feedback sidebar",
    title: "Open feedback sidebar (Alt+C)",
  });
  const toggleCount = el("span", {
    "data-review-toggle-count": true,
    text: "0",
  });
  toggle.append(
    icon(MESSAGE_SQUARE_TEXT_ICON),
    el("span", { text: "Feedback" }),
    toggleCount,
  );

  const countLabel = el("span", {
    "data-review-count": true,
    text: "Nothing pending",
  });
  const hideButton = el("button", {
    type: "button",
    "data-review-hide": true,
    "aria-label": "Hide feedback",
  });
  hideButton.appendChild(icon(X_ICON));

  const draftList = el("ol", { "data-review-drafts": true });
  const emptyNote = el("p", {
    "data-review-empty": true,
    text: "Hover a block and press Comment, or highlight any text, to start.",
  });
  const responseSummary = el("p", { "data-review-round-summary": true });
  const sentList = el("div", { "data-review-sent-list": true });
  const sentGroup = el("section", { "data-review-sent": true, hidden: true }, [
    responseSummary,
    sentList,
  ]);

  const sendButton = el("button", {
    type: "button",
    "data-review-send": true,
    disabled: true,
    text: "Send all comments to agent",
  });
  const sendNote = el("p", { "data-review-send-note": true });

  const agentState = el("span", {
    "data-review-agent-state": true,
    "data-tone": "idle",
    text: "Waiting for you",
  });
  const activityToggle = el("button", {
    type: "button",
    "data-review-activity-toggle": true,
    hidden: true,
    text: "Hide activity",
  });
  const agentInput = el("textarea", {
    "data-review-agent-input": true,
    id: "big-plan-review-agent-note",
    rows: "3",
    placeholder: "Ask about the plan as a whole…",
    maxlength: String(BODY_LIMIT),
    value: activeDraft,
  });
  const attachInput = el("input", {
    type: "checkbox",
    "data-review-attach-input": true,
    id: "big-plan-review-attach",
  });
  const attachLabel = el(
    "label",
    { "data-review-attach": true, hidden: true },
    [
      attachInput,
      el("span", {
        "data-review-attach-text": true,
        text: "Attach to my selection",
      }),
    ],
  );
  const agentSave = el("button", {
    type: "button",
    "data-review-agent-save": true,
    text: "Send",
  });
  const planChatList = el("ol", {
    "data-review-plan-chat": true,
    "aria-label": "Plan-wide conversation",
  });

  const agentPanel = el("section", { "data-review-agent": true }, [
    el("div", { "data-review-agent-head": true }, [
      el("h3", { text: "Plan-wide chat" }),
      activityToggle,
      agentState,
    ]),
    el("p", {
      "data-review-chat-note": true,
      text: hasRuntime
        ? "Live coding-agent conversation through this plan’s local review session."
        : "Start `big-plan review` and its coding-agent session to chat.",
    }),
    planChatList,
    el("label", {
      for: "big-plan-review-agent-note",
      "data-review-field-label": true,
      text: "Message",
    }),
    agentInput,
    attachLabel,
    agentSave,
  ]);

  const commentsTab = el("button", {
    type: "button",
    role: "tab",
    "data-review-tab": "comments",
    "aria-selected": "true",
    "aria-controls": "big-plan-review-comments",
  });
  commentsTab.append(
    icon(MESSAGE_SQUARE_TEXT_ICON),
    el("span", { text: "Comments" }),
    countLabel,
  );
  const chatTab = el("button", {
    type: "button",
    role: "tab",
    "data-review-tab": "chat",
    "aria-selected": "false",
    "aria-controls": "big-plan-review-chat",
  });
  chatTab.append(icon(MESSAGES_SQUARE_ICON), el("span", { text: "Chat" }));
  const tabList = el("div", { "data-review-tabs": true, role: "tablist" }, [
    commentsTab,
    chatTab,
    hideButton,
  ]);
  const commentsPanel = el(
    "section",
    {
      id: "big-plan-review-comments",
      "data-review-panel": "comments",
      role: "tabpanel",
    },
    [
      el("div", { "data-review-scroll": true }, [
        draftList,
        emptyNote,
        sentGroup,
      ]),
      el("div", { "data-review-send-bar": true }, [sendButton, sendNote]),
    ],
  );
  const chatPanel = el(
    "section",
    {
      id: "big-plan-review-chat",
      "data-review-panel": "chat",
      role: "tabpanel",
      hidden: true,
    },
    [agentPanel],
  );
  rail.append(tabList, commentsPanel, chatPanel);

  const affordance = el("button", {
    type: "button",
    "data-review-affordance": true,
    hidden: true,
  });
  affordance.append(
    icon(MESSAGE_SQUARE_TEXT_ICON),
    el("span", { text: "Comment" }),
  );

  const composeInput = el("textarea", {
    "data-review-compose-input": true,
    id: "big-plan-review-compose",
    rows: "4",
    placeholder: "What should the agent change here?",
    maxlength: String(BODY_LIMIT),
  });
  const composeCancel = el("button", {
    type: "button",
    "data-review-compose-cancel": true,
    text: "Cancel",
  });
  const composeSave = el("button", {
    type: "button",
    "data-review-compose-save": true,
    disabled: true,
    text: "Add Comment",
  });
  const submitImmediatelyInput = el("input", {
    type: "checkbox",
    role: "switch",
    "data-review-submit-immediately-input": true,
    id: "big-plan-review-submit-immediately",
    ...(submitRightAway ? { checked: true } : {}),
  });
  const submitImmediately = el(
    "label",
    {
      "data-review-submit-immediately": true,
      for: "big-plan-review-submit-immediately",
    },
    [
      submitImmediatelyInput,
      el("span", { "data-review-switch-track": true }),
      el("span", { text: "Submit right away" }),
    ],
  );
  const compose = el(
    "div",
    {
      "data-review-compose": true,
      role: "dialog",
      "aria-label": "Add a comment",
      hidden: true,
    },
    [
      el("label", {
        for: "big-plan-review-compose",
        "data-review-field-label": true,
        text: "Add a comment",
      }),
      composeInput,
      el("p", {
        "data-review-compose-hint": true,
        text: "Escape cancels · Cmd/Ctrl+Enter adds",
      }),
      submitImmediately,
      el("div", { "data-review-compose-actions": true }, [
        composeCancel,
        composeSave,
      ]),
    ],
  );

  const threadLayer = el("div", {
    "data-review-thread-layer": true,
    "aria-label": "Comments beside the plan",
  });
  const markerLayer = el("div", {
    "data-review-marker-layer": true,
    "aria-label": "Comment anchors",
  });
  const live = el("p", { "data-review-live": true, "aria-live": "polite" });
  const backdrop = el("button", {
    type: "button",
    "data-review-backdrop": true,
    "aria-label": "Close feedback and return to the plan",
    hidden: true,
  });
  const deleteTitle = el("h2", {
    id: "big-plan-review-delete-title",
    text: "Delete comment?",
  });
  const deleteDescription = el("p", {
    id: "big-plan-review-delete-description",
    text: "This permanently removes your staged comment.",
  });
  const deleteCancel = el("button", {
    type: "button",
    "data-review-delete-cancel": true,
    text: "Cancel",
  });
  const deleteConfirm = el("button", {
    type: "button",
    "data-review-delete-confirm": true,
    text: "Delete",
  });
  const deleteDialog = el(
    "dialog",
    {
      "data-review-delete-dialog": true,
      "aria-labelledby": "big-plan-review-delete-title",
      "aria-describedby": "big-plan-review-delete-description",
    },
    [
      el("div", { "data-review-delete-content": true }, [
        deleteTitle,
        deleteDescription,
        el("div", { "data-review-delete-actions": true }, [
          deleteCancel,
          deleteConfirm,
        ]),
      ]),
    ],
  );
  const revertTitle = el("h2", {
    id: "big-plan-review-revert-title",
    text: "Revert this thread’s changes?",
  });
  const revertDescription = el("p", {
    id: "big-plan-review-revert-description",
    text: "The coding agent will revert all plan changes made in response to this comment.",
  });
  const revertCancel = el("button", {
    type: "button",
    "data-review-revert-cancel": true,
    text: "Cancel",
  });
  const revertConfirm = el("button", {
    type: "button",
    "data-review-revert-confirm": true,
    text: "Revert changes",
  });
  const revertDialog = el(
    "dialog",
    {
      "data-review-revert-dialog": true,
      "aria-labelledby": "big-plan-review-revert-title",
      "aria-describedby": "big-plan-review-revert-description",
    },
    [
      el("div", { "data-review-delete-content": true }, [
        revertTitle,
        revertDescription,
        el("div", { "data-review-delete-actions": true }, [
          revertCancel,
          revertConfirm,
        ]),
      ]),
    ],
  );

  const surface = el("div", { "data-review-root": true }, [
    backdrop,
    toggle,
    rail,
    affordance,
    threadLayer,
    compose,
    markerLayer,
    deleteDialog,
    revertDialog,
    live,
  ]);
  document.body.appendChild(surface);
  // Tailwind's delivery optimizer does not yet parse the standardized
  // ::highlight() pseudo-element, so these two rules live with the browser
  // behavior that creates their named Highlight ranges.
  document.head.appendChild(
    el("style", {
      text:
        "::highlight(big-plan-review-comments){" +
        "background-color:var(--annotation-bg)}" +
        "::highlight(big-plan-review-active){" +
        "background-color:var(--annotation-bg)}",
    }),
  );

  const announce = (message) => {
    live.textContent = message;
  };

  // -------------------------------------------------------------- tray render

  let readingPosition = window.scrollY;
  let restoreReadingPosition = true;

  const setRailOpen = (open) => {
    if (open === !rail.hidden) {
      return;
    }
    if (open && rail.hidden) {
      readingPosition = window.scrollY;
      restoreReadingPosition = true;
    }
    rail.hidden = !open;
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute(
      "aria-label",
      open ? "Close feedback sidebar" : "Open feedback sidebar",
    );
    if (open) {
      root.setAttribute("data-review-open", "");
    } else {
      root.removeAttribute("data-review-open");
    }
    syncFloatingMode();
    if (!compose.hidden && composeTarget) positionCompose(composeTarget);
    positionThreadCards();
    // The drawer never navigates the document. Re-applying the captured
    // position defeats scroll anchoring caused by the desktop width change
    // and makes the below-1280 overlay reversible by construction.
    requestAnimationFrame(() => {
      if (restoreReadingPosition) window.scrollTo(0, readingPosition);
      if (!compose.hidden && composeTarget) positionCompose(composeTarget);
      positionThreadCards();
    });
  };

  const railIsOpen = () => !rail.hidden;

  const setActiveTab = (tab) => {
    const commentsActive = tab === "comments";
    commentsTab.setAttribute(
      "aria-selected",
      commentsActive ? "true" : "false",
    );
    chatTab.setAttribute("aria-selected", commentsActive ? "false" : "true");
    commentsPanel.hidden = !commentsActive;
    chatPanel.hidden = commentsActive;
  };

  commentsTab.addEventListener("click", () => setActiveTab("comments"));
  chatTab.addEventListener("click", () => setActiveTab("chat"));
  backdrop.addEventListener("click", () => setRailOpen(false));

  const chipCounts = () => {
    const counts = new Map();
    for (const draft of drafts) {
      const id = anchorStateFor(draft).block?.getAttribute("data-block-id");
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  };

  const markerByBlock = new Map();

  const positionMarkers = () => {
    for (const [block, marker] of markerByBlock) {
      const rect = block.getBoundingClientRect();
      const visible =
        window.innerWidth < 1280 &&
        marker.hasAttribute("data-review-marker-active") &&
        rect.bottom >= FLOAT_TOP &&
        rect.top <= window.innerHeight;
      marker.hidden = !visible;
      if (!visible) continue;
      marker.style.top = Math.max(FLOAT_TOP, rect.top) + "px";
      marker.style.left =
        Math.max(4, rect.left - marker.offsetWidth - 8) + "px";
    }
  };

  const markerFor = (block) => {
    const existing = markerByBlock.get(block);
    if (existing) return existing;
    const marker = el("button", {
      type: "button",
      "data-review-marker": true,
    });
    marker.append(
      icon(MESSAGE_SQUARE_TEXT_ICON),
      el("span", { "data-review-marker-label": true }),
    );
    marker.addEventListener("click", () => {
      const blockId = block.getAttribute("data-block-id");
      const draft = drafts.find(
        (item) =>
          anchorStateFor(item).block?.getAttribute("data-block-id") === blockId,
      );
      const comment =
        draft ||
        sent.find(
          (item) =>
            anchorStateFor(item).block?.getAttribute("data-block-id") ===
            blockId,
        );
      if (!comment) return;
      setActiveTab("comments");
      if (draft) {
        editingId = draft.id;
        setRailOpen(true);
        renderTray();
        focusTarget(comment);
      } else {
        if (window.innerWidth < 1280) setRailOpen(true);
        openThreadAt(comment);
      }
    });
    markerLayer.appendChild(marker);
    markerByBlock.set(block, marker);
    return marker;
  };

  // Attributes keep the rendered block's state machine-readable. On narrow
  // screens the marker remains a real button; the desktop floating card itself
  // is the direct entry point, avoiding duplicate chrome around the plan.
  const paintChips = () => {
    const counts = chipCounts();
    const sentBlocks = new Map();
    for (const comment of sent.filter(
      (entry) => !resolvedCommentIds.has(entry.id),
    )) {
      const blockId =
        anchorStateFor(comment).block?.getAttribute("data-block-id");
      if (!blockId) continue;
      const current = sentBlocks.get(blockId);
      sentBlocks.set(blockId, {
        count: (current?.count || 0) + 1,
        outcome: outcomeFor(comment),
      });
    }
    for (const block of blocks) {
      const id = block.getAttribute("data-block-id");
      const pending = counts.get(id) || 0;
      const sentPresence = sentBlocks.get(id);
      const outcome = sentPresence?.outcome;
      const total = pending + (sentPresence?.count || 0);
      if (pending > 0) {
        block.setAttribute("data-review-annotated", String(pending));
        block.setAttribute("data-review-chip-tone", "draft");
      } else if (outcome) {
        block.setAttribute(
          "data-review-annotated",
          outcome.key === "question" ? "!" : "✓",
        );
        block.setAttribute("data-review-chip-tone", outcome.key);
      } else {
        block.removeAttribute("data-review-annotated");
        block.removeAttribute("data-review-chip-tone");
      }
      const marker = markerFor(block);
      const hasComment = total > 0;
      marker.hidden = !hasComment;
      if (hasComment) marker.setAttribute("data-review-marker-active", "");
      else marker.removeAttribute("data-review-marker-active");
      marker.setAttribute(
        "data-review-marker-tone",
        pending > 0 ? "draft" : outcome?.key || "sent",
      );
      marker.setAttribute(
        "aria-label",
        pending > 0
          ? `Open ${total} comment${total === 1 ? "" : "s"}, including ${pending} staged, on ${labelFor(block)}`
          : `Open ${total} ${outcome?.label || "sent"} comment${total === 1 ? "" : "s"} on ${labelFor(block)}`,
      );
      marker.setAttribute("data-review-marker-count", String(total));
      const markerLabel = marker.querySelector("[data-review-marker-label]");
      if (markerLabel) {
        markerLabel.textContent = total + " comment" + (total === 1 ? "" : "s");
      }
    }
    positionMarkers();
  };

  const focusTarget = (comment, options = {}) => {
    if (railIsOpen()) restoreReadingPosition = false;
    const block = anchorStateFor(comment).block;
    const destination = block || document.body;
    const scroll = () => {
      destination.scrollIntoView({ behavior: "smooth", block: "center" });
      if (!block) return;
      block.setAttribute("data-review-flash", "");
      setTimeout(() => block.removeAttribute("data-review-flash"), 1400);
    };
    if (
      window.innerWidth < 1280 &&
      railIsOpen() &&
      options.keepRailOpen !== true
    ) {
      setRailOpen(false);
      requestAnimationFrame(scroll);
    } else {
      scroll();
    }
  };

  // Block ids come from the renderer with a restricted character set, so this
  // only has to survive the selector parser, never sanitize authored input.
  const cssEscape = (value) =>
    window.CSS && CSS.escape
      ? CSS.escape(value)
      : value.replace(/["\\]/g, "\\$&");

  const blockForTarget = (target) => {
    const id = target && target.blockId;
    return id
      ? document.querySelector('[data-block-id="' + cssEscape(id) + '"]')
      : null;
  };

  // Turns a renderer-relative character offset back into a DOM boundary. The
  // review chrome never enters a block, so these offsets remain stable while
  // comments and the sidebar are mounted around the document.
  const textBoundary = (block, offset) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let node = walker.nextNode();
    let last = null;
    while (node) {
      last = node;
      if (remaining <= node.data.length) {
        return { node, offset: remaining };
      }
      remaining -= node.data.length;
      node = walker.nextNode();
    }
    return last === null ? null : { node: last, offset: last.data.length };
  };

  const rangeForTarget = (target) => {
    const block = blockForTarget(target);
    if (!block) return null;
    if (target.type === "selection") {
      const start = textBoundary(block, target.start);
      const end = textBoundary(block, target.end);
      if (!start || !end) return null;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    }
    if (target.type === "lines") {
      const rows = Array.from(
        block.querySelectorAll("[data-block-line]"),
      ).filter((row) => {
        const line = Number(row.getAttribute("data-block-line"));
        return line >= target.start && line <= target.end;
      });
      if (rows.length === 0) return null;
      const range = document.createRange();
      range.setStartBefore(rows[0]);
      range.setEndAfter(rows[rows.length - 1]);
      return range;
    }
    return null;
  };

  const rangeAtOffsets = (block, startOffset, endOffset) => {
    const start = textBoundary(block, startOffset);
    const end = textBoundary(block, endOffset);
    if (!start || !end) return null;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  };

  const quoteRangeInBlock = (block, quote, preferredOffset) => {
    if (!block || quote === "") return null;
    const text = block.textContent || "";
    const matches = [];
    let cursor = text.indexOf(quote);
    while (cursor >= 0) {
      matches.push(cursor);
      cursor = text.indexOf(quote, cursor + 1);
    }
    if (matches.length === 0) return null;
    matches.sort(
      (left, right) =>
        Math.abs(left - preferredOffset) - Math.abs(right - preferredOffset),
    );
    const start = matches[0];
    return rangeAtOffsets(block, start, start + quote.length);
  };

  const scopeBlocksFor = (blockId) => {
    if (typeof blockId !== "string") return [];
    const slash = blockId.lastIndexOf("/");
    const prefix = slash < 0 ? blockId : blockId.slice(0, slash + 1);
    return blocks.filter((block) =>
      (block.getAttribute("data-block-id") || "").startsWith(prefix),
    );
  };

  // A persisted range is allowed to paint only text the reviewer actually
  // selected. Exact offsets win; then exact quote matches are searched in the
  // honesty ladder's order. Fuzzy matching is deliberately absent.
  const anchorStateFor = (comment) => {
    const target = comment.target;
    const original = blockForTarget(target);
    if (target.type !== "selection") {
      const range = rangeForTarget(target);
      return range
        ? { kind: "range", range, block: original }
        : { kind: "block", block: original };
    }
    const direct = rangeForTarget(target);
    if (direct && direct.toString() === target.quote) {
      return { kind: "range", range: direct, block: original };
    }
    const candidates = [];
    if (original) candidates.push(original);
    const events = outcomeEventsFor(comment);
    const latestChanged = events
      .filter((event) => event.key === "changed")
      .at(-1);
    const changedTargets = [];
    for (const blockId of latestChanged?.changeTargets || []) {
      const block = document.querySelector(
        '[data-block-id="' + cssEscape(blockId) + '"]',
      );
      if (block) {
        changedTargets.push(block);
        if (!candidates.includes(block)) candidates.push(block);
      }
    }
    for (const block of scopeBlocksFor(target.blockId)) {
      if (!candidates.includes(block)) candidates.push(block);
    }
    for (const block of candidates) {
      const range = quoteRangeInBlock(block, target.quote, target.start);
      if (range) return { kind: "range", range, block };
    }
    const successor =
      changedTargets[0] ||
      original ||
      scopeBlocksFor(target.blockId)[0] ||
      null;
    return {
      kind: "changed",
      block: successor,
      quote: target.quote,
    };
  };

  const setNamedHighlight = (name, ranges) => {
    if (
      typeof CSS === "undefined" ||
      !CSS.highlights ||
      typeof Highlight === "undefined"
    ) {
      return false;
    }
    CSS.highlights.set(name, new Highlight(...ranges));
    return true;
  };

  // Selection comments use the browser's Highlight API so the authored DOM is
  // never wrapped or rewritten. Whole-block comments use attributes because
  // an element box, rather than a text run, is the thing the reviewer chose.
  const paintTargetHighlights = () => {
    for (const block of blocks) {
      block.removeAttribute("data-review-comment-highlight");
      block.removeAttribute("data-review-active-highlight");
      block.removeAttribute("data-review-anchor-changed");
    }
    const commentRanges = [];
    const lensBlocks = diffLens
      ? diffLens.hiddenBlocks.concat(diffLens.movedBlocks)
      : [];
    for (const comment of drafts.concat(sent)) {
      if (resolvedCommentIds.has(comment.id)) continue;
      const anchor = anchorStateFor(comment);
      if (anchor.kind === "range" && !lensBlocks.includes(anchor.block)) {
        commentRanges.push(anchor.range);
      } else if (anchor.block && !lensBlocks.includes(anchor.block)) {
        anchor.block.setAttribute("data-review-comment-highlight", "");
        if (anchor.kind === "changed") {
          anchor.block.setAttribute("data-review-anchor-changed", "");
        }
      }
    }
    const activeTarget = composeTarget || pendingSelection;
    const activeRange = activeTarget ? rangeForTarget(activeTarget) : null;
    if (activeTarget && !activeRange) {
      blockForTarget(activeTarget)?.setAttribute(
        "data-review-active-highlight",
        "",
      );
    }
    root.setAttribute(
      "data-review-selection-highlight-count",
      String(commentRanges.length),
    );
    root.setAttribute(
      "data-review-active-selection-highlight",
      activeRange === null ? "false" : "true",
    );
    setNamedHighlight("big-plan-review-comments", commentRanges);
    setNamedHighlight(
      "big-plan-review-active",
      activeRange === null ? [] : [activeRange],
    );
  };

  const relativeCommentTime = (createdAt) => {
    const time = Date.parse(createdAt);
    if (Number.isNaN(time)) return "Just now";
    const elapsed = Date.now() - time;
    if (elapsed < 60_000) return "Just now";
    if (elapsed < 3_600_000)
      return Math.max(1, Math.floor(elapsed / 60_000)) + "m";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(time));
  };

  const OUTCOME_LABELS = {
    changed: "Changed",
    question: "Needs your answer",
    outside: "Outside this plan",
    waiting: "With agent",
  };

  const spinner = () =>
    el("span", {
      "data-review-spinner": true,
      "aria-hidden": "true",
    });

  const outcomeBadge = (outcome) => {
    const badge = el("span", {
      "data-review-outcome-state": outcome.key,
    });
    if (outcome.key === "waiting") badge.appendChild(spinner());
    badge.appendChild(document.createTextNode(outcome.label));
    return badge;
  };

  const currentAgentActivity = () => {
    const latest = progressEvents[progressEvents.length - 1];
    if (!latest) return "Waiting for the coding agent to begin…";
    const prefix =
      latest.state === "live"
        ? "Working"
        : latest.state === "waiting"
          ? "Queued"
          : latest.state === "failed"
            ? "Needs attention"
            : "Latest";
    return (
      prefix + ": " + latest.step + (latest.detail ? " — " + latest.detail : "")
    );
  };

  const currentActivityEvents = () => {
    let start = 0;
    for (let index = progressEvents.length - 1; index >= 0; index -= 1) {
      if (/agent response ready/i.test(progressEvents[index]?.step || "")) {
        start = index + 1;
        break;
      }
    }
    return progressEvents.slice(start).slice(-4);
  };

  const activityDisclosure = () => {
    if (!showAgentActivity) {
      return el("p", { "data-review-thread-waiting": true }, [
        spinner(),
        document.createTextNode("Agent activity hidden"),
      ]);
    }
    const events = currentActivityEvents();
    const items =
      events.length > 0
        ? events.map((event) =>
            el("li", {
              text: event.step + (event.detail ? " — " + event.detail : ""),
            }),
          )
        : [el("li", { text: currentAgentActivity() })];
    return el(
      "details",
      {
        "data-review-agent-activity": true,
        "data-review-thread-waiting": true,
        open: true,
      },
      [
        el("summary", {}, [
          spinner(),
          document.createTextNode("Agent activity"),
        ]),
        el("ol", {}, items),
      ],
    );
  };

  const waitingLine = () => {
    return activityDisclosure();
  };

  const outcomeEventsFor = (comment) => {
    const events = [];
    for (const response of agentResponses) {
      if (response.kind !== "feedback" && response.kind !== "reply") continue;
      const outcome = response.outcomes.find(
        (entry) => entry.commentId === comment.id,
      );
      if (!outcome) continue;
      const request = agentRequests.find(
        (entry) => entry.requestId === response.requestId,
      );
      events.push({
        key: outcome.state,
        label: OUTCOME_LABELS[outcome.state],
        reply: outcome.message,
        changeTargets: outcome.changeTargets || [],
        createdAt: response.createdAt,
        requestId: response.requestId,
        fromRevision: request?.sourceRevision || "",
        toRevision: response.sourceRevision || "",
      });
    }
    return events;
  };

  const outcomeFor = (comment) => {
    const events = outcomeEventsFor(comment);
    const answered = new Set(
      agentResponses.map((response) => response.requestId),
    );
    const pendingReply = agentRequests.some(
      (request) =>
        request.kind === "reply" &&
        request.commentId === comment.id &&
        !answered.has(request.requestId),
    );
    if (pendingReply) {
      return {
        key: "waiting",
        label: OUTCOME_LABELS.waiting,
        reply: "Waiting for the coding agent to answer this reply.",
      };
    }
    return (
      events[events.length - 1] || {
        key: "waiting",
        label: OUTCOME_LABELS.waiting,
        reply: "Waiting for the coding agent to answer this comment.",
      }
    );
  };

  const outcomeCounts = () => {
    const counts = { changed: 0, question: 0, outside: 0, waiting: 0 };
    for (const comment of sent) {
      if (resolvedCommentIds.has(comment.id)) continue;
      counts[outcomeFor(comment).key] += 1;
    }
    return counts;
  };

  const needsAnswerCount = () => outcomeCounts().question;

  const shortEcho = (body, limit = 88) =>
    body.length <= limit ? body : body.slice(0, limit - 1).trimEnd() + "…";

  const anchorContextLine = (comment) => {
    const anchor = anchorStateFor(comment);
    if (anchor.kind !== "changed" || comment.target.type !== "selection") {
      return null;
    }
    return el("p", {
      "data-review-anchor-context": true,
      text:
        "You commented on: “" +
        shortEcho(comment.target.quote, 120) +
        "” — this text was revised",
    });
  };

  const stagedAnchorNotice = (comment) => {
    if (anchorStateFor(comment).kind !== "changed") return null;
    return el("p", {
      "data-review-draft-stale": true,
      text: "The text changed since you drafted this.",
    });
  };

  const openDeleteDialog = (comment) => {
    deleteCandidateId = comment.id;
    deleteDescription.textContent =
      "This permanently removes your staged comment. This action cannot be undone.";
    deleteDialog.showModal();
  };

  const commitDraftEdit = async (comment, field) => {
    const body = field.value.trim();
    if (body === "") return;
    comment.body = body;
    editingId = null;
    announce("Comment updated.");
    renderTray();
    await save();
  };

  const draftRow = (comment) => {
    const isEditing = comment.id === editingId;
    const jump = el("button", {
      type: "button",
      "data-review-row-target": true,
      text: slideTitleFor(comment.target),
      title: "Jump to this target",
    });
    jump.addEventListener("click", () => focusTarget(comment));
    const state = el("span", {
      "data-review-comment-state": "staged",
      text: "Staged",
    });

    if (!isEditing) {
      const submitNow = el("button", {
        type: "button",
        "data-review-row-submit": true,
        text: "Submit Now",
      });
      submitNow.addEventListener("click", () => {
        void submitComments({
          comments: [comment],
          closeRailAfter: false,
          trigger: submitNow,
        });
      });
      const edit = el("button", {
        type: "button",
        "data-review-row-edit": true,
        text: "Edit",
      });
      edit.addEventListener("click", () => {
        editingId = comment.id;
        renderTray();
      });
      const remove = el("button", {
        type: "button",
        "data-review-row-delete": true,
        text: "Remove",
      });
      remove.addEventListener("click", () => openDeleteDialog(comment));
      return el("li", { "data-review-row": true }, [
        el("div", { "data-review-row-head": true }, [jump, state]),
        el("p", { "data-review-row-body": true, text: comment.body }),
        stagedAnchorNotice(comment),
        el("div", { "data-review-row-actions": true }, [
          submitNow,
          edit,
          remove,
        ]),
      ]);
    }

    const field = el("textarea", {
      "data-review-row-input": true,
      rows: "3",
      value: comment.body,
      maxlength: String(BODY_LIMIT),
      "aria-label": "Editing the note on " + describeTarget(comment.target),
    });
    const cancel = el("button", {
      type: "button",
      "data-review-row-cancel": true,
      text: "Cancel",
    });
    cancel.addEventListener("click", () => {
      editingId = null;
      renderTray();
    });
    const confirm = el("button", {
      type: "button",
      "data-review-row-save": true,
      text: "Save",
    });
    const commit = () => commitDraftEdit(comment, field);
    confirm.addEventListener("click", commit);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        editingId = null;
        renderTray();
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit();
    });
    const row = el(
      "li",
      { "data-review-row": true, "data-review-editing": true },
      [
        el("div", { "data-review-row-head": true }, [jump, state]),
        field,
        el("div", { "data-review-row-actions": true }, [cancel, confirm]),
      ],
    );
    if (railIsOpen()) setTimeout(() => field.focus(), 0);
    return row;
  };

  const openThreadAt = (comment) => {
    expandedThreadIds.add(comment.id);
    editingId = null;
    if (railIsOpen()) restoreReadingPosition = false;
    renderTray();
    requestAnimationFrame(() => {
      focusTarget(comment, { keepRailOpen: railIsOpen() });
      positionThreadCards();
    });
  };

  const sendThreadReply = async (comment, field, button) => {
    const body = field.value.trim();
    if (body === "") return;
    if (!hasRuntime) {
      announce("Start the local review runtime to reply to the agent.");
      return;
    }
    button.disabled = true;
    try {
      await confirmRuntime();
      const answer = await call("/api/agent-requests", {
        method: "POST",
        body: { kind: "reply", commentId: comment.id, body },
      });
      if (isAgentRequest(answer.request)) {
        agentRequests = agentRequests.concat([answer.request]);
      }
      field.value = "";
      expandedThreadIds.add(comment.id);
      setAgentState("With agent", "working");
      announce("Reply sent to the coding agent.");
      renderTray();
      startProgress();
    } catch (error) {
      announce(describeError(error));
      button.disabled = false;
    }
  };

  const checkedDiffLocations = (value) =>
    (Array.isArray(value) ? value : []).filter(
      (location) =>
        location &&
        typeof location === "object" &&
        (location.status === "changed" ||
          location.status === "added" ||
          location.status === "removed") &&
        typeof location.kind === "string" &&
        typeof location.label === "string" &&
        typeof location.section === "string" &&
        typeof location.oldText === "string" &&
        typeof location.newText === "string" &&
        Array.isArray(location.runs) &&
        location.runs.every(
          (run) =>
            run &&
            (run.op === "same" || run.op === "del" || run.op === "ins") &&
            typeof run.text === "string",
        ),
    );

  const loadRevisionDiff = async (event) => {
    if (
      !hasRuntime ||
      event.key !== "changed" ||
      !event.fromRevision ||
      !event.toRevision
    ) {
      return [];
    }
    if (revisionDiffs.has(event.requestId)) {
      return revisionDiffs.get(event.requestId);
    }
    const answer = await call(
      "/api/revision-diff?from=" +
        encodeURIComponent(event.fromRevision) +
        "&to=" +
        encodeURIComponent(event.toRevision),
    );
    const locations = checkedDiffLocations(answer.locations);
    revisionDiffs.set(event.requestId, locations);
    return locations;
  };

  const blockOrder = new Map(
    blocks.map((block, index) => [
      block.getAttribute("data-block-id") || "",
      index,
    ]),
  );

  // Removed locations borrow a fractional slot from their surviving neighbor,
  // so all-location chat diffs retain the document's reading order.
  const locationPosition = (location) => {
    if (location.newBlockId && blockOrder.has(location.newBlockId)) {
      return blockOrder.get(location.newBlockId);
    }
    if (location.beforeBlockId && blockOrder.has(location.beforeBlockId)) {
      return blockOrder.get(location.beforeBlockId) - 0.5;
    }
    if (location.afterBlockId && blockOrder.has(location.afterBlockId)) {
      return blockOrder.get(location.afterBlockId) + 0.5;
    }
    return Number.MAX_SAFE_INTEGER;
  };

  const locationsForEvent = (event) => {
    const locations = revisionDiffs.get(event.requestId) || [];
    const targets = event.changeTargets || [];
    const selected =
      targets.length === 0
        ? locations
        : locations.filter((candidate) =>
            targets.some(
              (target) =>
                candidate.newBlockId === target ||
                candidate.oldBlockId === target,
            ),
          );
    return [...selected].sort(
      (left, right) => locationPosition(left) - locationPosition(right),
    );
  };

  const runSimilarity = (locations) =>
    diffRunSimilarity(locations.flatMap((location) => location.runs || []));

  const placeKindNote = (locations) => {
    if (locations.every((location) => location.status === "added")) {
      return "added";
    }
    if (locations.every((location) => location.status === "removed")) {
      return "removed";
    }
    if (locations.length > 1 && runSimilarity(locations) < 0.2) {
      return "rewritten";
    }
    return locations.length === 1 ? diffKindNote(locations[0]) : "reworked";
  };

  const locationsAreContiguous = ({ previous, next, changedIds }) => {
    if (previous.section !== next.section) return false;
    const previousPosition = locationPosition(previous);
    const nextPosition = locationPosition(next);
    if (nextPosition - previousPosition <= 1) return true;
    const first = Math.floor(previousPosition) + 1;
    const last = Math.ceil(nextPosition);
    for (let index = first; index < last; index += 1) {
      const id = blocks[index]?.getAttribute("data-block-id");
      if (id && !changedIds.has(id)) return false;
    }
    return true;
  };

  // A place is a contiguous run of changed locations within one slide. This
  // keeps chat and anchored-comment diffs on one calm, literal vocabulary.
  const groupLocationsIntoPlaces = (locations) => {
    const changedIds = new Set(
      locations
        .map((location) => location.newBlockId)
        .filter((id) => typeof id === "string"),
    );
    const groups = [];
    for (const location of locations) {
      const previous = groups.at(-1);
      const previousLocation = previous?.locations.at(-1);
      if (
        previous &&
        previousLocation &&
        locationsAreContiguous({
          previous: previousLocation,
          next: location,
          changedIds,
        })
      ) {
        previous.locations.push(location);
        previous.note = placeKindNote(previous.locations);
        if (previous.note === "rewritten") previous.label = "Whole section";
        continue;
      }
      groups.push({
        locations: [location],
        section: location.section,
        label: location.label,
        note: placeKindNote([location]),
        slideTitle: slideTitleFor({
          type: "block",
          section: location.section,
          label: location.label,
        }),
      });
    }
    return groups;
  };

  const placesForEvent = (event) =>
    groupLocationsIntoPlaces(locationsForEvent(event));

  const diffKindNote = (location) => {
    if (location.status === "added") return "added";
    if (location.status === "removed") return "removed";
    if (
      location.kind === "table" ||
      location.kind === "table-row" ||
      location.kind === "code" ||
      location.kind.includes("diff")
    ) {
      return "replaced";
    }
    return "reworded";
  };

  const diffStepper = el("div", {
    "data-review-diff-stepper": true,
    hidden: true,
  });
  const diffPrevious = el("button", {
    type: "button",
    "data-review-diff-previous": true,
    "aria-label": "Previous change",
    text: "‹",
  });
  const diffPosition = el("span", { "data-review-diff-position": true });
  const diffNext = el("button", {
    type: "button",
    "data-review-diff-next": true,
    "aria-label": "Next change",
    text: "›",
  });
  const diffExit = el("button", {
    type: "button",
    "data-review-diff-exit": true,
    text: "Show current text",
  });
  diffStepper.append(diffPrevious, diffPosition, diffNext, diffExit);
  document.body.appendChild(diffStepper);

  // Added content is temporarily moved into the lens so its real formatting
  // remains visible. Restore it before removing the lens: removing first would
  // take the authoritative current blocks with it.
  const restoreMovedBlocksBeforeLens = ({ movedBlocks, container }) => {
    for (const block of movedBlocks) container.before(block);
  };

  const clearDiffLens = () => {
    if (!diffLens) return;
    restoreMovedBlocksBeforeLens(diffLens);
    for (const block of diffLens.hiddenBlocks) {
      block.removeAttribute("hidden");
      block.removeAttribute("data-review-diff-hidden");
    }
    diffLens.container.remove();
    diffLens = null;
    diffStepper.hidden = true;
    renderTray();
  };

  const appendDiffRun = ({ container, run, comment, oldOffset, tagged }) => {
    const nodeFor = (text, marked) => {
      const node = el("span", {
        "data-review-diff-op": run.op,
        ...(marked ? { "data-review-diff-comment": true } : {}),
        text,
      });
      if (marked && !tagged.value) {
        node.appendChild(
          el("span", {
            "data-review-diff-comment-tag": true,
            text: "your comment",
          }),
        );
        tagged.value = true;
      }
      return node;
    };
    if (
      run.op !== "del" ||
      comment?.target.type !== "selection" ||
      run.text === ""
    ) {
      container.appendChild(nodeFor(run.text, false));
      return;
    }
    const runStart = oldOffset.value;
    const runEnd = runStart + run.text.length;
    const markStart = Math.max(runStart, comment.target.start);
    const markEnd = Math.min(runEnd, comment.target.end);
    if (markStart >= markEnd) {
      container.appendChild(nodeFor(run.text, false));
      return;
    }
    const localStart = markStart - runStart;
    const localEnd = markEnd - runStart;
    container.appendChild(nodeFor(run.text.slice(0, localStart), false));
    container.appendChild(nodeFor(run.text.slice(localStart, localEnd), true));
    container.appendChild(nodeFor(run.text.slice(localEnd), false));
  };

  const appendWholesalePlace = ({ body, place, comment }) => {
    const was = el("div", { "data-review-diff-was": true }, [
      el("strong", { text: "Was" }),
    ]);
    place.locations.forEach((location, index) => {
      if (!location.oldText) return;
      if (index > 0) was.appendChild(document.createTextNode("\n\n"));
      if (
        comment?.target.type === "selection" &&
        location.oldBlockId === comment.target.blockId
      ) {
        appendDiffRun({
          container: was,
          run: { op: "del", text: location.oldText },
          comment,
          oldOffset: { value: 0 },
          tagged: { value: false },
        });
      } else {
        was.appendChild(
          el("span", {
            "data-review-diff-op": "del",
            text: location.oldText,
          }),
        );
      }
    });
    const now = el("div", { "data-review-diff-now": true }, [
      el("strong", { text: "Now" }),
      el("span", {
        "data-review-diff-op": "ins",
        text: place.locations
          .map((location) => location.newText)
          .filter(Boolean)
          .join("\n\n"),
      }),
    ]);
    body.append(was, now);
  };

  const appendDiffLocation = ({ body, location, comment }) => {
    const attributedComment =
      comment &&
      (location.oldBlockId === comment.target.blockId ||
        location.newBlockId === comment.target.blockId)
        ? comment
        : null;
    if (location.status === "changed" && location.kind === "table-row") {
      const oldRow = el("div", { "data-review-diff-was": true }, [
        el("strong", { text: "Was" }),
      ]);
      appendDiffRun({
        container: oldRow,
        run: { op: "del", text: location.oldText },
        comment: attributedComment,
        oldOffset: { value: 0 },
        tagged: { value: false },
      });
      body.append(
        oldRow,
        el("div", { "data-review-diff-now": true }, [
          el("strong", { text: "Now" }),
          el("span", {
            "data-review-diff-op": "ins",
            text: location.newText,
          }),
        ]),
      );
      return;
    }
    if (
      location.status === "changed" &&
      !["paragraph", "heading", "quote", "list", "table-row", "code"].includes(
        location.kind,
      )
    ) {
      body.append(
        el("div", { "data-review-diff-was": true }, [
          el("strong", { text: "Was" }),
          el("span", { text: location.oldText }),
        ]),
        el("div", { "data-review-diff-now": true }, [
          el("strong", { text: "Now" }),
          el("span", { text: location.newText }),
        ]),
      );
      return;
    }
    const oldOffset = { value: 0 };
    const tagged = { value: false };
    for (const run of location.runs) {
      appendDiffRun({
        container: body,
        run,
        comment: attributedComment,
        oldOffset,
        tagged,
      });
      if (run.op !== "ins") oldOffset.value += run.text.length;
    }
  };

  const anchorBlockForPlace = (place) => {
    for (const location of place.locations) {
      for (const id of [
        location.newBlockId,
        location.beforeBlockId,
        location.afterBlockId,
      ]) {
        if (!id) continue;
        const block = document.querySelector(
          '[data-block-id="' + cssEscape(id) + '"]',
        );
        if (block) return block;
      }
    }
    return null;
  };

  const renderDiffLocation = ({ comment, event, index }) => {
    const places = placesForEvent(event);
    const place = places[index];
    if (!place) return;
    clearDiffLens();
    const anchorBlock = anchorBlockForPlace(place);
    const containerTag = anchorBlock?.tagName === "TR" ? "tr" : "div";
    const statuses = new Set(
      place.locations.map((location) => location.status),
    );
    const container = el(containerTag, {
      "data-review-diff-lens": true,
      "data-review-diff-status":
        statuses.size === 1 ? place.locations[0]?.status : "changed",
      "data-review-diff-kind":
        place.locations.length === 1 ? place.locations[0]?.kind : "place",
    });
    const content =
      containerTag === "tr" ? el("td", { colspan: "99" }) : container;
    content.appendChild(
      el("span", {
        "data-review-diff-label": true,
        text:
          "Diff vs. previous version" +
          (event.toRevision !== sourceRevision ? " · since revised again" : ""),
      }),
    );
    const body = el(
      place.locations.length === 1 && place.locations[0]?.kind === "code"
        ? "pre"
        : "div",
      {
        "data-review-diff-body": true,
      },
    );
    if (containerTag === "tr") container.appendChild(content);
    if (anchorBlock) {
      if (
        place.locations[0]?.status === "removed" &&
        place.locations[0]?.beforeBlockId
      ) {
        anchorBlock.before(container);
      } else if (
        place.locations[0]?.status === "removed" &&
        place.locations[0]?.afterBlockId
      ) {
        anchorBlock.after(container);
      } else {
        anchorBlock.before(container);
      }
    } else {
      document.querySelector("main")?.appendChild(container);
    }

    const hiddenBlocks = [];
    const movedBlocks = [];
    const allAdded = place.locations.every(
      (location) => location.status === "added",
    );
    for (const location of place.locations) {
      if (!location.newBlockId) continue;
      const block = document.querySelector(
        '[data-block-id="' + cssEscape(location.newBlockId) + '"]',
      );
      if (!block) continue;
      if (allAdded && containerTag !== "tr") {
        movedBlocks.push(block);
      } else {
        block.setAttribute("hidden", "");
        block.setAttribute("data-review-diff-hidden", "");
        hiddenBlocks.push(block);
      }
    }

    if (allAdded && movedBlocks.length > 0) {
      const added = el("div", { "data-review-diff-added-run": true }, [
        el("strong", { text: "Added" }),
      ]);
      for (const block of movedBlocks) added.appendChild(block);
      body.appendChild(added);
    } else if (
      place.locations.length > 1 &&
      runSimilarity(place.locations) < 0.2
    ) {
      appendWholesalePlace({ body, place, comment });
    } else {
      place.locations.forEach((location, locationIndex) => {
        const locationBody = el("div", {
          "data-review-diff-location": true,
        });
        appendDiffLocation({ body: locationBody, location, comment });
        body.appendChild(locationBody);
        if (locationIndex < place.locations.length - 1) {
          body.appendChild(el("hr", { "data-review-diff-separator": true }));
        }
      });
    }
    content.appendChild(body);
    diffLens = {
      comment,
      event,
      index,
      places,
      container,
      hiddenBlocks,
      movedBlocks,
    };
    diffPosition.textContent =
      "Change " +
      (index + 1) +
      " of " +
      places.length +
      " · " +
      place.slideTitle;
    diffPrevious.disabled = index === 0;
    diffNext.disabled = index === places.length - 1;
    diffStepper.hidden = false;
    renderTray();
    container.scrollIntoView({ behavior: "smooth", block: "center" });
    paintTargetHighlights();
  };

  const openDiffLens = async (comment, event, index = 0) => {
    try {
      await loadRevisionDiff(event);
      renderTray();
      renderDiffLocation({ comment, event, index });
    } catch (error) {
      announce(describeError(error));
    }
  };

  diffPrevious.addEventListener("click", () => {
    if (!diffLens || diffLens.index === 0) return;
    renderDiffLocation({
      comment: diffLens.comment,
      event: diffLens.event,
      index: diffLens.index - 1,
    });
  });
  diffNext.addEventListener("click", () => {
    if (!diffLens || diffLens.index >= diffLens.places.length - 1) return;
    renderDiffLocation({
      comment: diffLens.comment,
      event: diffLens.event,
      index: diffLens.index + 1,
    });
  });
  diffExit.addEventListener("click", clearDiffLens);

  const chatChangeEvents = () => {
    const events = [];
    for (const request of agentRequests) {
      if (request.kind !== "chat") continue;
      const response = agentResponses.find(
        (entry) =>
          entry.kind === "chat" && entry.requestId === request.requestId,
      );
      if (
        !response ||
        !request.sourceRevision ||
        !response.sourceRevision ||
        request.sourceRevision === response.sourceRevision
      ) {
        continue;
      }
      events.push({
        key: "changed",
        requestId: request.requestId,
        fromRevision: request.sourceRevision,
        toRevision: response.sourceRevision,
        changeTargets: [],
      });
    }
    return events;
  };

  const hydrateRevisionDiffs = async () => {
    const commentEvents = sent.flatMap((comment) =>
      outcomeEventsFor(comment)
        .filter(
          (event) =>
            event.key === "changed" && !revisionDiffs.has(event.requestId),
        )
        .map((event) => ({ comment, event })),
    );
    const events = [
      ...commentEvents,
      ...chatChangeEvents()
        .filter((event) => !revisionDiffs.has(event.requestId))
        .map((event) => ({ comment: null, event })),
    ];
    if (events.length === 0) return;
    await Promise.all(
      events.map(({ event }) => loadRevisionDiff(event).catch(() => [])),
    );
    renderTray();
  };

  const changeControls = (comment, event) => {
    const loaded = placesForEvent(event);
    const rows =
      loaded.length > 0
        ? loaded
        : groupLocationsIntoPlaces(
            (event.changeTargets || []).map((target) => {
              const block = document.querySelector(
                '[data-block-id="' + cssEscape(target) + '"]',
              );
              return {
                status: "changed",
                newBlockId: target,
                kind: block?.getAttribute("data-block-kind") || "block",
                label:
                  block?.getAttribute("data-block-label") || "Changed block",
                section: block?.getAttribute("data-block-section") || "Plan",
                oldText: "",
                newText: block?.textContent || "",
                runs: [],
              };
            }),
          );
    if (rows.length === 0) return null;
    const active =
      diffLens?.comment?.id === comment.id &&
      diffLens?.event.requestId === event.requestId;
    const list = el("div", { "data-review-change-list": true }, [
      el("strong", {
        text:
          "Changed " + rows.length + " place" + (rows.length === 1 ? "" : "s"),
      }),
    ]);
    rows.forEach((place, index) => {
      const row = el("button", {
        type: "button",
        "data-review-change-row": true,
        "aria-pressed": active && diffLens.index === index ? "true" : "false",
        ...(active && diffLens.index === index
          ? { "aria-current": "true" }
          : {}),
      });
      row.append(
        el("span", {
          "data-review-change-slide": true,
          text: place.slideTitle,
        }),
        el("span", {
          "data-review-change-label": true,
          text: place.label,
        }),
        el("span", {
          "data-review-change-kind": true,
          text: place.note,
        }),
      );
      row.addEventListener("click", () => {
        void openDiffLens(comment, event, index);
      });
      list.appendChild(row);
    });
    const see = el("button", {
      type: "button",
      "data-review-see-change": true,
      text: active
        ? "Hide changes"
        : rows.length === 1
          ? "See the change"
          : "See changes (" + rows.length + ")",
    });
    see.addEventListener("click", () => {
      if (active) clearDiffLens();
      else void openDiffLens(comment, event, 0);
    });
    return el("div", { "data-review-change-controls": true }, [list, see]);
  };

  const agentTurn = (outcome, createdAt, comment, event) => {
    const node = el("div", { "data-review-thread-turn": "agent" }, [
      el("div", { "data-review-turn-meta": true }, [
        el("strong", { text: "Agent" }),
        el("time", {
          datetime: createdAt,
          text: relativeCommentTime(createdAt),
        }),
      ]),
      el("p", { text: outcome.message }),
    ]);
    if (outcome.state === "changed" && event) {
      const controls = changeControls(comment, event);
      if (controls) node.appendChild(controls);
    }
    return node;
  };

  const conversationNodes = (comment) => {
    const outcome = outcomeFor(comment);
    const nodes = [
      el("div", { "data-review-thread-turn": "user" }, [
        el("div", { "data-review-turn-meta": true }, [
          el("strong", { text: "You" }),
          el("time", {
            datetime: comment.createdAt,
            text: relativeCommentTime(comment.createdAt),
          }),
        ]),
        el("p", { text: comment.body }),
        anchorContextLine(comment),
      ]),
    ];

    for (const request of agentRequests) {
      const response = agentResponses.find(
        (entry) => entry.requestId === request.requestId,
      );
      if (
        request.kind === "feedback" &&
        Array.isArray(request.comments) &&
        request.comments.some((entry) => entry.id === comment.id) &&
        response &&
        response.kind === "feedback"
      ) {
        const responseOutcome = response.outcomes.find(
          (entry) => entry.commentId === comment.id,
        );
        if (responseOutcome) {
          const event = outcomeEventsFor(comment).find(
            (candidate) => candidate.requestId === response.requestId,
          );
          nodes.push(
            agentTurn(responseOutcome, response.createdAt, comment, event),
          );
        }
      }
      if (request.kind !== "reply" || request.commentId !== comment.id) {
        continue;
      }
      nodes.push(
        el("div", { "data-review-thread-turn": "user" }, [
          el("div", { "data-review-turn-meta": true }, [
            el("strong", { text: "You" }),
            el("time", {
              datetime: request.createdAt,
              text: relativeCommentTime(request.createdAt),
            }),
          ]),
          el("p", { text: request.body }),
        ]),
      );
      if (response && response.kind === "reply") {
        const responseOutcome = response.outcomes.find(
          (entry) => entry.commentId === comment.id,
        );
        if (responseOutcome) {
          const event = outcomeEventsFor(comment).find(
            (candidate) => candidate.requestId === response.requestId,
          );
          nodes.push(
            agentTurn(responseOutcome, response.createdAt, comment, event),
          );
        }
      }
    }

    if (outcome.key === "waiting") {
      nodes.push(waitingLine());
      return nodes;
    }

    const field = el("textarea", {
      "data-review-thread-reply": true,
      rows: "3",
      maxlength: String(BODY_LIMIT),
      placeholder:
        outcome.key === "question"
          ? "Answer the agent…"
          : "Reply to the agent…",
      "aria-label":
        outcome.key === "question"
          ? "Your answer on this comment"
          : "Reply on this comment",
    });
    const sendReply = el("button", {
      type: "button",
      "data-review-thread-reply-send": true,
      disabled: true,
      text: outcome.key === "question" ? "Send answer" : "Reply",
    });
    const syncReply = () => {
      sendReply.disabled = field.value.trim() === "";
    };
    field.addEventListener("input", syncReply);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void sendThreadReply(comment, field, sendReply);
      }
    });
    sendReply.addEventListener("click", () => {
      void sendThreadReply(comment, field, sendReply);
    });
    nodes.push(
      el("div", { "data-review-thread-reply-box": true }, [
        el("label", {
          text: outcome.key === "question" ? "Your answer" : "Reply",
        }),
        field,
        sendReply,
      ]),
    );
    return nodes;
  };

  const openRevertDialog = (comment) => {
    revertCandidateId = comment.id;
    revertDialog.showModal();
  };

  const resolveThread = async (comment) => {
    resolvedCommentIds.add(comment.id);
    expandedThreadIds.delete(comment.id);
    expandedCommentIds.delete(comment.id);
    announce("Comment resolved.");
    renderTray();
    await save();
  };

  const unresolveThread = async (comment) => {
    resolvedCommentIds.delete(comment.id);
    expandedThreadIds.add(comment.id);
    announce("Comment reopened.");
    renderTray();
    await save();
  };

  const toolbarButton = ({ attribute, label, glyph, action }) => {
    const button = el("button", {
      type: "button",
      [attribute]: true,
      "aria-label": label,
      title: label,
    });
    button.appendChild(icon(glyph));
    button.addEventListener("click", action);
    return button;
  };

  const threadToolbar = (comment, options = {}) => {
    const resolved = options.resolved === true;
    const revertAction = outcomeEventsFor(comment).some(
      (event) => event.key === "changed",
    )
      ? toolbarButton({
          attribute: "data-review-thread-revert",
          label: "Revert agent changes",
          glyph: ROTATE_CCW_ICON,
          action: () => openRevertDialog(comment),
        })
      : null;
    const actions = [
      toolbarButton({
        attribute: "data-review-thread-minimize",
        label: "Minimize thread",
        glyph: MINIMIZE_2_ICON,
        action: () => {
          expandedThreadIds.delete(comment.id);
          renderTray();
        },
      }),
    ];
    actions.push(
      resolved
        ? toolbarButton({
            attribute: "data-review-thread-unresolve",
            label: "Unresolve comment",
            glyph: UNDO_2_ICON,
            action: () => {
              void unresolveThread(comment);
            },
          })
        : toolbarButton({
            attribute: "data-review-thread-resolve",
            label: "Resolve comment",
            glyph: CHECK_ICON,
            action: () => {
              void resolveThread(comment);
            },
          }),
    );
    if (revertAction) actions.push(revertAction);
    return el("div", { "data-review-thread-toolbar": true }, [
      el("div", { "data-review-thread-toolbar-title": true }, [
        outcomeBadge(outcomeFor(comment)),
        el("span", {
          text: resolved ? "Resolved comment" : shortEcho(comment.body, 52),
        }),
      ]),
      el("div", { "data-review-thread-toolbar-actions": true }, actions),
    ]);
  };

  const sentRow = (comment, options = {}) => {
    const resolved = options.resolved === true;
    const outcome = outcomeFor(comment);
    const jump = el("button", {
      type: "button",
      "data-review-row-target": true,
      text: slideTitleFor(comment.target),
      title: "Jump to and expand this thread",
    });
    jump.addEventListener("click", () => {
      if (!resolved) {
        openThreadAt(comment);
        return;
      }
      expandedThreadIds.add(comment.id);
      renderTray();
    });
    if (resolved) jump.title = "Open this resolved thread";
    const children = [
      el("div", { "data-review-row-head": true }, [
        jump,
        outcomeBadge(outcome),
      ]),
      el("p", {
        "data-review-row-body": true,
        text: shortEcho(comment.body),
      }),
    ];
    if (expandedThreadIds.has(comment.id)) {
      children.push(
        el("div", { "data-review-tray-thread": true }, [
          threadToolbar(comment, { resolved }),
          ...conversationNodes(comment),
        ]),
      );
    }
    return el(
      "li",
      {
        "data-review-row": true,
        "data-review-sent-row": true,
        "data-review-comment-id": comment.id,
        "data-review-outcome": outcome.key,
      },
      children,
    );
  };

  const threadCard = ({ comment, state }) => {
    const isEditing = state === "staged" && comment.id === editingId;
    const card = el("article", {
      "data-review-thread-card": true,
      "data-review-thread-state": state,
      "data-review-comment-id": comment.id,
    });
    const head = el("div", { "data-review-thread-head": true }, [
      el("span", { "data-review-thread-avatar": true, text: "Y" }),
      el("strong", { text: "You" }),
      el("time", {
        datetime: comment.createdAt,
        text: relativeCommentTime(comment.createdAt),
      }),
      el("span", {
        "data-review-comment-state": state,
        text: state === "staged" ? "Staged" : "Sent",
      }),
    ]);
    if (state === "sent") {
      const outcome = outcomeFor(comment);
      const expanded = expandedThreadIds.has(comment.id);
      const summary = el(
        "button",
        {
          type: "button",
          "data-review-thread-summary": true,
          "aria-expanded": expanded ? "true" : "false",
          "aria-label":
            (expanded ? "Collapse" : "Open") +
            " " +
            outcome.label +
            " thread: " +
            shortEcho(comment.body),
        },
        [
          outcomeBadge(outcome),
          el("span", {
            "data-review-thread-echo": true,
            text: shortEcho(comment.body),
          }),
        ],
      );
      summary.addEventListener("click", () => {
        if (expanded) expandedThreadIds.delete(comment.id);
        else expandedThreadIds.add(comment.id);
        renderTray();
        requestAnimationFrame(() => {
          threadLayer
            .querySelector(
              '[data-review-comment-id="' +
                comment.id +
                '"] [data-review-thread-summary]',
            )
            ?.focus();
        });
      });
      if (expanded) {
        card.setAttribute("data-review-thread-expanded", "");
        card.append(threadToolbar(comment), ...conversationNodes(comment));
      } else {
        card.appendChild(summary);
      }
      return card;
    }

    if (minimizedDraftIds.has(comment.id)) {
      const summary = el(
        "button",
        {
          type: "button",
          "data-review-thread-summary": true,
          "aria-expanded": "false",
          "aria-label": "Expand staged comment: " + shortEcho(comment.body),
        },
        [
          el("span", {
            "data-review-comment-state": "staged",
            text: "Staged",
          }),
          el("span", {
            "data-review-thread-echo": true,
            text: shortEcho(comment.body),
          }),
        ],
      );
      summary.addEventListener("click", () => {
        minimizedDraftIds.delete(comment.id);
        renderTray();
      });
      card.appendChild(summary);
      return card;
    }

    card.appendChild(head);

    if (isEditing) {
      const field = el("textarea", {
        "data-review-thread-input": true,
        rows: "4",
        value: comment.body,
        maxlength: String(BODY_LIMIT),
        "aria-label": "Edit your comment",
      });
      const cancel = el("button", {
        type: "button",
        "data-review-thread-cancel": true,
        text: "Cancel",
      });
      cancel.addEventListener("click", () => {
        editingId = null;
        renderTray();
      });
      const confirm = el("button", {
        type: "button",
        "data-review-thread-save": true,
        text: "Save",
      });
      confirm.addEventListener("click", () => commitDraftEdit(comment, field));
      field.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          editingId = null;
          renderTray();
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commitDraftEdit(comment, field);
        }
      });
      card.append(
        field,
        el("div", { "data-review-thread-actions": true }, [cancel, confirm]),
      );
      setTimeout(() => field.focus(), 0);
      return card;
    }

    const isLong = comment.body.length > LONG_COMMENT_LIMIT;
    const expanded = expandedCommentIds.has(comment.id);
    const body = el("p", {
      "data-review-thread-body": true,
    });
    if (isLong && !expanded) {
      body.appendChild(
        document.createTextNode(
          comment.body.slice(0, LONG_COMMENT_LIMIT).trimEnd() + " ",
        ),
      );
      const more = el("button", {
        type: "button",
        "data-review-thread-more": true,
        text: "… more",
      });
      more.addEventListener("click", () => {
        expandedCommentIds.add(comment.id);
        renderTray();
      });
      body.appendChild(more);
    } else {
      body.textContent = comment.body;
    }
    card.appendChild(body);
    const staleNotice = stagedAnchorNotice(comment);
    if (staleNotice) card.appendChild(staleNotice);
    if (state === "staged") {
      const submitNow = el("button", {
        type: "button",
        "data-review-thread-submit": true,
        text: "Submit Now",
      });
      submitNow.addEventListener("click", () => {
        void submitComments({
          comments: [comment],
          closeRailAfter: false,
          trigger: submitNow,
        });
      });
      const minimize = el("button", {
        type: "button",
        "data-review-thread-minimize": true,
        text: "Minimize",
      });
      minimize.addEventListener("click", () => {
        minimizedDraftIds.add(comment.id);
        renderTray();
      });
      const edit = el("button", {
        type: "button",
        "data-review-thread-edit": true,
        text: "Edit",
      });
      edit.addEventListener("click", () => {
        editingId = comment.id;
        renderTray();
      });
      const remove = el("button", {
        type: "button",
        "data-review-thread-delete": true,
        text: "Remove",
      });
      remove.addEventListener("click", () => openDeleteDialog(comment));
      card.appendChild(
        el("div", { "data-review-thread-actions": true }, [
          submitNow,
          minimize,
          edit,
          remove,
        ]),
      );
    }
    return card;
  };

  const threadEntries = () =>
    drafts
      .map((comment) => ({ comment, state: "staged" }))
      .concat(
        sent
          .filter((comment) => !resolvedCommentIds.has(comment.id))
          .map((comment) => ({ comment, state: "sent" })),
      );

  const syncFloatingMode = () => {
    const shouldFloat =
      window.innerWidth >= 1280 &&
      !railIsOpen() &&
      (!compose.hidden ||
        drafts.length + sent.length > 0 ||
        threadLayer.childElementCount > 0);
    root.toggleAttribute("data-review-floating", shouldFloat);
  };

  const floatingBlockForTarget = (target) =>
    target?.type === "document" ? blocks[0] || null : blockForTarget(target);

  const floatingBlockForComment = (comment) => {
    if (diffLens?.comment?.id === comment.id && diffLens.container) {
      return diffLens.container;
    }
    return comment.target?.type === "document"
      ? blocks[0] || null
      : anchorStateFor(comment).block;
  };

  const floatLeftForBlock = (block, width) => {
    const rect = block?.getBoundingClientRect();
    if (!rect) return window.innerWidth - width - FLOAT_EDGE;
    return Math.max(
      FLOAT_EDGE,
      Math.min(
        rect.right + FLOAT_CONTENT_GAP,
        window.innerWidth - width - FLOAT_EDGE,
      ),
    );
  };

  const floatLeftFor = (target, width) =>
    floatLeftForBlock(floatingBlockForTarget(target), width);

  const positionThreadCards = () => {
    syncFloatingMode();
    const canFloat =
      window.innerWidth >= 1280 &&
      !railIsOpen() &&
      root.hasAttribute("data-review-floating");
    const cards = Array.from(
      threadLayer.querySelectorAll("[data-review-thread-card]"),
    );
    const composeBottom =
      canFloat &&
      !compose.hidden &&
      compose.hasAttribute("data-review-compose-floating")
        ? compose.getBoundingClientRect().bottom
        : FLOAT_TOP - FLOAT_GAP;
    let previousBottom = Math.max(FLOAT_TOP - FLOAT_GAP, composeBottom);
    for (const card of cards) {
      const id = card.getAttribute("data-review-comment-id");
      const comment = drafts
        .concat(sent)
        .find((candidate) => candidate.id === id);
      const block = comment ? floatingBlockForComment(comment) : null;
      const rect = block?.getBoundingClientRect();
      const visible =
        canFloat &&
        rect !== undefined &&
        rect !== null &&
        rect.bottom >= FLOAT_TOP &&
        rect.top <= window.innerHeight;
      card.hidden = !visible;
      if (!visible) continue;
      // Fit before stacking. A viewport clamp after this constraint can pull
      // a later chip back over an expanded card or composer and cover its
      // textarea and Reply button.
      const fittedTop = Math.max(
        FLOAT_TOP,
        Math.min(rect.top, window.innerHeight - card.offsetHeight - FLOAT_EDGE),
      );
      const top = Math.max(fittedTop, previousBottom + FLOAT_GAP);
      card.style.top = top + "px";
      card.style.left = floatLeftForBlock(block, card.offsetWidth) + "px";
      previousBottom = Number.parseFloat(card.style.top) + card.offsetHeight;
    }
  };

  const renderThreads = () => {
    document
      .querySelectorAll("[data-review-thread-inline]")
      .forEach((card) => card.remove());
    const entries = threadEntries().sort((left, right) => {
      const leftTop =
        floatingBlockForComment(left.comment)?.getBoundingClientRect().top ?? 0;
      const rightTop =
        floatingBlockForComment(right.comment)?.getBoundingClientRect().top ??
        0;
      return leftTop - rightTop;
    });
    const cards = entries.map(threadCard);
    threadLayer.replaceChildren(...cards);
    if (window.innerWidth < 1280) {
      for (const card of cards) {
        const id = card.getAttribute("data-review-comment-id");
        if (!id || !expandedThreadIds.has(id)) continue;
        const comment = sent.find((candidate) => candidate.id === id);
        const block = comment ? floatingBlockForComment(comment) : null;
        if (!block) continue;
        const anchor =
          block.tagName === "TR"
            ? block.closest("[data-table-scroll-container]") || block
            : block;
        card.setAttribute("data-review-thread-inline", "");
        card.hidden = false;
        card.removeAttribute("style");
        anchor.after(card);
      }
    }
    positionThreadCards();
  };

  const renderSentIndex = () => {
    const counts = outcomeCounts();
    responseSummary.textContent =
      "Latest round · " +
      counts.changed +
      " changed · " +
      counts.question +
      " needs your answer · " +
      counts.outside +
      " outside this plan · " +
      counts.waiting +
      " with agent";
    const groups = [
      { key: "question", label: "Needs your answer" },
      { key: "changed", label: "Changed" },
      { key: "outside", label: "Outside this plan" },
      { key: "waiting", label: "With agent" },
    ];
    const renderedGroups = groups
      .map(({ key, label }) => {
        const comments = sent.filter(
          (comment) =>
            !resolvedCommentIds.has(comment.id) &&
            outcomeFor(comment).key === key,
        );
        if (comments.length === 0) return null;
        return el("section", { "data-review-outcome-group": key }, [
          el("h3", { text: label }),
          el("ol", {}, comments.map(sentRow)),
        ]);
      })
      .filter(Boolean);
    const otherChanges = [];
    const seenRequests = new Set();
    for (const comment of sent) {
      for (const event of outcomeEventsFor(comment)) {
        if (event.key !== "changed" || seenRequests.has(event.requestId)) {
          continue;
        }
        seenRequests.add(event.requestId);
        const attributed = new Set(event.changeTargets || []);
        const locations = revisionDiffs.get(event.requestId) || [];
        const roundEvent = {
          ...event,
          changeTargets: locations
            .map((location) => location.newBlockId || location.oldBlockId)
            .filter(Boolean),
        };
        groupLocationsIntoPlaces(locationsForEvent(roundEvent)).forEach(
          (place, index) => {
            if (
              place.locations.some(
                (location) =>
                  attributed.has(location.newBlockId) ||
                  attributed.has(location.oldBlockId),
              )
            ) {
              return;
            }
            otherChanges.push({
              comment,
              event: roundEvent,
              place,
              index,
            });
          },
        );
      }
    }
    if (otherChanges.length > 0) {
      renderedGroups.push(
        el("section", { "data-review-other-changes": true }, [
          el("h3", { text: "Other changes in this round" }),
          el(
            "ol",
            {},
            otherChanges.map(({ comment, event, place, index }) => {
              const button = el("button", {
                type: "button",
                "data-review-change-row": true,
              });
              button.append(
                el("span", {
                  "data-review-change-slide": true,
                  text: slideTitleFor({
                    type: "block",
                    section: place.section,
                    label: place.label,
                  }),
                }),
                el("span", {
                  "data-review-change-label": true,
                  text: place.label,
                }),
                el("span", {
                  "data-review-change-kind": true,
                  text: place.note,
                }),
              );
              button.addEventListener("click", () => {
                void openDiffLens(comment, event, index);
              });
              return el("li", {}, [button]);
            }),
          ),
        ]),
      );
    }
    const resolved = sent.filter((comment) =>
      resolvedCommentIds.has(comment.id),
    );
    if (resolved.length > 0) {
      renderedGroups.push(
        el(
          "details",
          {
            "data-review-resolved-group": true,
            open: resolved.some((comment) => expandedThreadIds.has(comment.id)),
          },
          [
            el("summary", {
              text: "Resolved (" + resolved.length + ")",
            }),
            el(
              "ol",
              {},
              resolved.map((comment) => sentRow(comment, { resolved: true })),
            ),
          ],
        ),
      );
    }
    sentList.replaceChildren(...renderedGroups);
  };

  const renderTray = () => {
    draftList.replaceChildren(...drafts.map(draftRow));
    emptyNote.hidden = drafts.length > 0;
    const pending = drafts.length;
    const needs = needsAnswerCount();
    countLabel.textContent =
      needs > 0 ? String(needs) : pending > 0 ? String(pending) : "";
    countLabel.setAttribute(
      "data-review-count-tone",
      needs > 0 ? "needs" : pending > 0 ? "pending" : "idle",
    );
    commentsTab.setAttribute(
      "aria-label",
      needs > 0
        ? `Comments, ${needs} needs your answer`
        : pending > 0
          ? `Comments, ${pending} staged`
          : "Comments",
    );
    toggleCount.textContent = needs > 0 ? String(needs) : "";
    toggle.setAttribute(
      "data-review-has-pending",
      needs > 0 ? "true" : "false",
    );
    toggle.setAttribute("data-review-needs-answer", String(needs));
    toggle.setAttribute(
      "aria-label",
      (railIsOpen() ? "Close" : "Open") +
        " feedback sidebar" +
        (needs > 0 ? ", " + needs + " needs your answer" : ""),
    );
    sendButton.disabled = pending === 0;
    sentGroup.hidden = sent.length === 0;
    renderSentIndex();
    renderPlanChat();
    syncActivityToggle();
    syncPlanChatValidity();
    paintChips();
    paintTargetHighlights();
    renderThreads();
  };

  document.addEventListener("pointerdown", (event) => {
    if (expandedThreadIds.size === 0) return;
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest("[data-review-thread-card]") ||
        target.closest("[data-review-row]") ||
        target.closest("[data-review-marker]") ||
        target.closest("dialog"))
    ) {
      return;
    }
    expandedThreadIds.clear();
    renderTray();
  });

  deleteCancel.addEventListener("click", () => deleteDialog.close());
  deleteConfirm.addEventListener("click", async () => {
    if (deleteCandidateId === null) return;
    drafts = drafts.filter((comment) => comment.id !== deleteCandidateId);
    expandedCommentIds.delete(deleteCandidateId);
    deleteCandidateId = null;
    deleteDialog.close();
    announce("Comment removed. " + drafts.length + " staged.");
    renderTray();
    await save();
  });
  deleteDialog.addEventListener("close", () => {
    deleteCandidateId = null;
  });
  revertCancel.addEventListener("click", () => revertDialog.close());
  revertConfirm.addEventListener("click", async () => {
    if (revertCandidateId === null) return;
    const comment = sent.find((entry) => entry.id === revertCandidateId);
    if (!comment || !hasRuntime) {
      announce("Start the local review runtime to revert this thread.");
      revertDialog.close();
      return;
    }
    revertConfirm.disabled = true;
    try {
      await confirmRuntime();
      const answer = await call("/api/agent-requests", {
        method: "POST",
        body: {
          kind: "reply",
          commentId: comment.id,
          body: "Revert all plan changes made in response to this comment.",
        },
      });
      if (isAgentRequest(answer.request)) {
        agentRequests = agentRequests.concat([answer.request]);
      }
      expandedThreadIds.add(comment.id);
      setAgentState("With agent", "working");
      announce("Revert request sent to the coding agent.");
      revertDialog.close();
      renderTray();
      startProgress();
    } catch (error) {
      announce(describeError(error));
      revertConfirm.disabled = false;
    }
  });
  revertDialog.addEventListener("close", () => {
    revertCandidateId = null;
    revertConfirm.disabled = false;
  });

  const save = async () => {
    try {
      await persist();
      sendNote.textContent = "";
    } catch (error) {
      sendNote.textContent = describeError(error);
    }
  };

  const describeError = (error) =>
    error && error.message ? String(error.message) : "Something went wrong.";

  // ---------------------------------------------------------------- composing

  const addDraft = (target, body) => {
    const comment = {
      id: newId(),
      body: body,
      createdAt: new Date().toISOString(),
      target: target,
    };
    drafts = drafts.concat([comment]);
    return comment;
  };

  const openCompose = (target) => {
    composeTarget = target;
    pendingSelection = null;
    attachLabel.hidden = true;
    // The affordance did its job; leaving it up would float a second control
    // over the card the reviewer is now typing in.
    affordance.hidden = true;
    composeInput.value = "";
    composeSave.disabled = true;
    compose.hidden = false;
    const before = window.scrollY;
    syncFloatingMode();
    paintTargetHighlights();
    positionCompose(target);
    positionThreadCards();
    requestAnimationFrame(() => {
      window.scrollTo(0, before);
      positionCompose(target);
      positionThreadCards();
      composeInput.focus();
    });
  };

  const closeCompose = () => {
    compose.hidden = true;
    composeTarget = null;
    compose.removeAttribute("data-review-compose-inline");
    compose.removeAttribute("data-review-compose-floating");
    compose.removeAttribute("data-review-compose-centered");
    compose.removeAttribute("style");
    if (compose.parentElement !== surface) surface.appendChild(compose);
    paintTargetHighlights();
    syncFloatingMode();
    positionThreadCards();
  };

  const positionCompose = (target) => {
    const block = blockForTarget(target);
    if (!block) {
      compose.removeAttribute("style");
      compose.setAttribute("data-review-compose-centered", "");
      return;
    }
    if (window.innerWidth >= 1280 && !railIsOpen()) {
      if (compose.parentElement !== surface) surface.appendChild(compose);
      compose.removeAttribute("data-review-compose-inline");
      compose.removeAttribute("data-review-compose-centered");
      compose.setAttribute("data-review-compose-floating", "");
      const rect = block.getBoundingClientRect();
      compose.style.top =
        Math.max(
          FLOAT_TOP,
          Math.min(
            rect.top,
            window.innerHeight - compose.offsetHeight - FLOAT_EDGE,
          ),
        ) + "px";
      compose.style.left = floatLeftFor(target, compose.offsetWidth) + "px";
      return;
    }
    // A table row cannot legally own a div sibling inside tbody, so its
    // scroll container is the insertion anchor. Every other authored block
    // can place the editor immediately after itself. Either way the editor is
    // in flow and pushes following content instead of painting over it.
    const anchor =
      block.tagName === "TR"
        ? block.closest("[data-table-scroll-container]") || block
        : block;
    compose.removeAttribute("style");
    compose.removeAttribute("data-review-compose-centered");
    compose.removeAttribute("data-review-compose-floating");
    compose.setAttribute("data-review-compose-inline", "");
    anchor.after(compose);
  };

  const normalizedComposeBody = () => composeInput.value.trim();

  const syncComposeValidity = () => {
    composeSave.disabled =
      composeTarget === null || normalizedComposeBody() === "";
  };

  const saveCompose = async () => {
    const body = normalizedComposeBody();
    // The handler is the authority. Both pointer and Ctrl/Cmd+Enter arrive
    // here, so the shortcut cannot bypass the button's disabled state.
    if (body === "" || composeTarget === null) return;
    const comment = addDraft(composeTarget, body);
    announce("Comment added on " + describeTarget(composeTarget) + ".");
    closeCompose();
    renderTray();
    await save();
    if (submitRightAway) {
      await submitComments({
        comments: [comment],
        closeRailAfter: false,
        trigger: composeSave,
      });
    }
  };

  composeSave.addEventListener("click", saveCompose);
  composeCancel.addEventListener("click", closeCompose);
  submitImmediatelyInput.addEventListener("change", () => {
    submitRightAway = submitImmediatelyInput.checked;
    try {
      localStorage.setItem(
        submitPreferenceKey,
        submitRightAway ? "true" : "false",
      );
    } catch {
      // The preference remains active for this page when storage is blocked.
    }
    announce(
      submitRightAway
        ? "New comments will submit right away."
        : "New comments will wait for batch submission.",
    );
  });
  composeInput.addEventListener("input", syncComposeValidity);
  composeInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeCompose();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveCompose();
    }
  });

  // -------------------------------------------------------------- affordance

  const targetForBlock = (block) => ({
    type: "block",
    blockId: block.getAttribute("data-block-id"),
    kind: kindFor(block),
    label: labelFor(block),
    section: block.getAttribute("data-block-section") || "",
  });

  // The right edge the floating chrome may reach: the window, or the tray's
  // own left edge while the tray is open, so a control never lands under it.
  const rightLimit = () =>
    railIsOpen() ? rail.getBoundingClientRect().left : window.innerWidth;

  const showAffordance = (block) => {
    if (!block || !compose.hidden) return;
    if (railIsOpen() && window.innerWidth < 1280) {
      affordance.hidden = true;
      return;
    }
    cursorBlock = block;
    const rect = block.getBoundingClientRect();
    if (rect.bottom < FLOAT_TOP || rect.top > window.innerHeight) {
      affordance.hidden = true;
      return;
    }
    affordance.hidden = false;
    affordance.setAttribute(
      "aria-label",
      "Comment on " + kindFor(block) + ": " + labelFor(block),
    );
    affordance.style.top = Math.max(FLOAT_TOP, rect.top) + "px";
    const width = affordance.offsetWidth || 108;
    affordance.style.left =
      Math.min(rect.right + 8, rightLimit() - width - 12) + "px";
  };

  let affordanceDismissTimer = null;

  const cancelAffordanceDismiss = () => {
    if (affordanceDismissTimer === null) return;
    window.clearTimeout(affordanceDismissTimer);
    affordanceDismissTimer = null;
  };

  const hideAffordance = () => {
    cancelAffordanceDismiss();
    if (document.activeElement === affordance) return;
    affordance.hidden = true;
    if (!pendingSelection) cursorBlock = null;
  };

  const scheduleAffordanceDismiss = () => {
    cancelAffordanceDismiss();
    affordanceDismissTimer = window.setTimeout(() => {
      affordanceDismissTimer = null;
      if (!pendingSelection && !affordance.matches(":hover")) hideAffordance();
    }, 100);
  };

  for (const block of blocks) {
    block.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      if (pendingSelection) return;
      cancelAffordanceDismiss();
      showAffordance(block);
    });
    block.addEventListener("pointerleave", () => {
      if (!pendingSelection) scheduleAffordanceDismiss();
    });
  }
  affordance.addEventListener("pointerenter", cancelAffordanceDismiss);
  affordance.addEventListener("pointerleave", scheduleAffordanceDismiss);
  document.addEventListener("pointerleave", hideAffordance);

  affordance.addEventListener("click", () => {
    if (pendingSelection) {
      openCompose(pendingSelection);
      return;
    }
    if (cursorBlock) openCompose(targetForBlock(cursorBlock));
  });

  // --------------------------------------------------------------- selection

  // A selection anchor records the block it sits in, its character offsets
  // inside that block, and the text it quoted. The quote travels as evidence
  // of what the reviewer highlighted - never as an instruction, and never as
  // markup: it is read with toString() and written with textContent.
  const anchorFromSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const selectedText = selection.toString();
    const quote = selectedText.trim();
    if (quote === "") return null;
    const startBlock = blockOf(range.startContainer);
    const endBlock = blockOf(range.endContainer);
    const block =
      startBlock ||
      endBlock ||
      blocks.find((candidate) => {
        try {
          return range.intersectsNode(candidate);
        } catch {
          return false;
        }
      });
    if (!block || surface.contains(block)) return null;

    const lineTarget = lineRangeFor(range, block);
    if (lineTarget) return lineTarget;

    const blockLength = block.textContent?.length || 0;
    let start = 0;
    if (block.contains(range.startContainer)) {
      const prefix = document.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(range.startContainer, range.startOffset);
      start = prefix.toString().length;
    }
    let end = blockLength;
    if (block.contains(range.endContainer)) {
      const throughEnd = document.createRange();
      throughEnd.selectNodeContents(block);
      throughEnd.setEnd(range.endContainer, range.endOffset);
      end = throughEnd.toString().length;
    }
    return {
      type: "selection",
      blockId: block.getAttribute("data-block-id"),
      kind: kindFor(block),
      label: labelFor(block),
      section: block.getAttribute("data-block-section") || "",
      start: start,
      end: Math.max(start, end),
      quote: quote.slice(0, QUOTE_LIMIT),
    };
  };

  // Inside a code figure the reviewer is pointing at lines, so the anchor
  // becomes the same line-range shape an authored Annotation uses.
  const lineRangeFor = (range, block) => {
    const rows = Array.from(block.querySelectorAll("[data-block-line]"));
    if (rows.length === 0) return null;
    const covered = rows.filter((row) => range.intersectsNode(row));
    if (covered.length === 0) return null;
    const numbers = covered
      .map((row) => Number(row.getAttribute("data-block-line")))
      .filter((value) => Number.isInteger(value));
    if (numbers.length === 0) return null;
    return {
      type: "lines",
      blockId: block.getAttribute("data-block-id"),
      kind: kindFor(block),
      label: labelFor(block),
      section: block.getAttribute("data-block-section") || "",
      start: Math.min(...numbers),
      end: Math.max(...numbers),
      quote: covered
        .map((row) => row.textContent)
        .join("\n")
        .slice(0, QUOTE_LIMIT),
    };
  };

  const offerSelection = () => {
    const anchor = anchorFromSelection();
    if (!anchor) {
      if (pendingSelection) {
        pendingSelection = null;
        affordance.hidden = true;
        paintTargetHighlights();
      }
      attachLabel.hidden = true;
      return;
    }
    pendingSelection = anchor;
    attachLabel.hidden = false;
    attachInput.checked = false;
    paintTargetHighlights();
    if (!compose.hidden) return;
    const selection = window.getSelection();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    affordance.hidden = false;
    affordance.setAttribute("aria-label", "Comment on the selected text");
    affordance.style.top = Math.max(FLOAT_TOP, rect.top - 40) + "px";
    const width = affordance.offsetWidth || 108;
    affordance.style.left =
      Math.max(12, Math.min(rect.left, rightLimit() - width - 12)) + "px";
  };

  document.addEventListener("mouseup", () => setTimeout(offerSelection, 0));
  document.addEventListener("keyup", (event) => {
    if (event.shiftKey || event.key === "Shift") setTimeout(offerSelection, 0);
  });
  let selectionOfferTimer = null;
  document.addEventListener("selectionchange", () => {
    if (selectionOfferTimer !== null) {
      window.clearTimeout(selectionOfferTimer);
    }
    selectionOfferTimer = window.setTimeout(() => {
      selectionOfferTimer = null;
      if (!compose.hidden || document.activeElement === affordance) return;
      offerSelection();
    }, 0);
  });

  // --------------------------------------------------------- plan-wide chat

  const chatChangeControls = (event) => {
    const places = placesForEvent(event);
    if (places.length === 0) return null;
    const slideCount = new Set(places.map((place) => place.slideTitle)).size;
    const expanded = chatDigestExpansion.has(event.requestId)
      ? chatDigestExpansion.get(event.requestId)
      : places.length <= 3;
    const active =
      diffLens?.comment === null &&
      diffLens?.event.requestId === event.requestId;
    const disclosure = el("button", {
      type: "button",
      "data-review-chat-change-toggle": true,
      "aria-expanded": expanded ? "true" : "false",
      text:
        "Changed " +
        places.length +
        " place" +
        (places.length === 1 ? "" : "s") +
        " across " +
        slideCount +
        " slide" +
        (slideCount === 1 ? "" : "s"),
    });
    disclosure.addEventListener("click", () => {
      chatDigestExpansion.set(event.requestId, !expanded);
      renderPlanChat();
    });
    const list = el("div", {
      "data-review-chat-change-list": true,
      ...(expanded ? {} : { hidden: true }),
    });
    let previousSlide = "";
    places.forEach((place, index) => {
      if (place.slideTitle !== previousSlide) {
        previousSlide = place.slideTitle;
        list.appendChild(
          el("strong", {
            "data-review-change-slide-header": true,
            text: place.slideTitle,
          }),
        );
      }
      const row = el("button", {
        type: "button",
        "data-review-change-row": true,
        ...(active && diffLens.index === index
          ? { "aria-current": "true" }
          : {}),
      });
      row.append(
        el("span", {
          "data-review-change-label": true,
          text: place.label,
        }),
        el("span", {
          "data-review-change-kind": true,
          text: place.note,
        }),
      );
      row.addEventListener("click", () => {
        void openDiffLens(null, event, index);
      });
      list.appendChild(row);
    });
    const see = el("button", {
      type: "button",
      "data-review-see-change": true,
      text: active
        ? "Hide changes"
        : places.length === 1
          ? "See the change"
          : "See changes (" + places.length + ")",
    });
    see.addEventListener("click", () => {
      if (active) clearDiffLens();
      else void openDiffLens(null, event, 0);
    });
    return el("div", { "data-review-chat-change-digest": true }, [
      disclosure,
      list,
      see,
    ]);
  };

  const livePlanChatMessages = () => {
    const messages = [];
    for (const request of agentRequests) {
      if (request.kind !== "chat") continue;
      messages.push({
        role: "user",
        body: request.body,
        createdAt: request.createdAt,
      });
      const response = agentResponses.find(
        (entry) => entry.requestId === request.requestId,
      );
      if (response && response.kind === "chat") {
        messages.push({
          role: "agent",
          body: response.message,
          createdAt: response.createdAt,
          event:
            request.sourceRevision !== response.sourceRevision
              ? {
                  key: "changed",
                  requestId: request.requestId,
                  fromRevision: request.sourceRevision,
                  toRevision: response.sourceRevision,
                  changeTargets: [],
                }
              : null,
        });
      } else {
        messages.push({
          role: "waiting",
          body: currentAgentActivity(),
          createdAt: request.createdAt,
        });
      }
    }
    return messages;
  };

  const renderPlanChat = () => {
    const messages = hasRuntime ? livePlanChatMessages() : planChatMessages;
    if (messages.length === 0) {
      planChatList.replaceChildren(
        el("li", {
          "data-review-chat-empty": true,
          text: "Ask about the plan as a whole. Anchored comment threads stay beside their source.",
        }),
      );
      return;
    }
    planChatList.replaceChildren(
      ...messages.map((message) => {
        if (message.role === "waiting") {
          return el("li", { "data-review-chat-message": "waiting" }, [
            el("div", { "data-review-turn-meta": true }, [
              el("strong", { text: "Agent status" }),
            ]),
            activityDisclosure(),
          ]);
        }
        const body = el("p", {});
        body.appendChild(document.createTextNode(message.body));
        const turn = el("li", { "data-review-chat-message": message.role }, [
          el("div", { "data-review-turn-meta": true }, [
            el("strong", {
              text: message.role === "user" ? "You" : "Agent",
            }),
            el("time", {
              datetime: message.createdAt,
              text: relativeCommentTime(message.createdAt),
            }),
          ]),
          body,
        ]);
        if (message.role === "agent" && message.event) {
          const controls = chatChangeControls(message.event);
          if (controls) turn.appendChild(controls);
        }
        return turn;
      }),
    );
  };

  const syncPlanChatValidity = () => {
    agentSave.disabled = agentInput.value.trim() === "";
  };

  const sendPlanChat = async () => {
    const body = agentInput.value.trim();
    if (body === "") return;
    if (attachInput.checked && pendingSelection) {
      addDraft(pendingSelection, body);
      announce("Draft saved on " + describeTarget(pendingSelection) + ".");
      attachInput.checked = false;
      agentInput.value = "";
      activeDraft = "";
      syncPlanChatValidity();
      renderTray();
      await save();
      return;
    }

    if (!hasRuntime) {
      announce("Start the local review runtime to chat with the agent.");
      return;
    }
    agentSave.disabled = true;
    try {
      await confirmRuntime();
      const answer = await call("/api/agent-requests", {
        method: "POST",
        body: { kind: "chat", body },
      });
      if (isAgentRequest(answer.request)) {
        agentRequests = agentRequests.concat([answer.request]);
      }
      agentInput.value = "";
      activeDraft = "";
      attachInput.checked = false;
      syncPlanChatValidity();
      writeLocalState();
      renderPlanChat();
      syncActivityToggle();
      setAgentState("With agent", "working");
      announce("Plan-wide question sent to the coding agent.");
      await save();
      startProgress();
    } catch (error) {
      announce(describeError(error));
      agentSave.disabled = false;
    }
  };

  agentSave.addEventListener("click", sendPlanChat);
  let activeDraftTimer = null;
  agentInput.addEventListener("input", () => {
    activeDraft = agentInput.value;
    syncPlanChatValidity();
    writeLocalState();
    if (activeDraftTimer !== null) window.clearTimeout(activeDraftTimer);
    activeDraftTimer = window.setTimeout(() => {
      activeDraftTimer = null;
      void save();
    }, 120);
  });
  agentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendPlanChat();
    }
  });

  // ------------------------------------------------------------------- submit

  // The tray's entry point carries the agent's state whenever nothing is
  // pending, so a reviewer who has already sent never has to open the tray to
  // learn whether anything is happening.
  const setAgentState = (text, tone) => {
    agentState.textContent = text;
    agentState.setAttribute("data-tone", tone);
    toggle.setAttribute("data-review-agent-tone", tone);
    toggle.title = "Open feedback sidebar (Alt+C)";
  };

  const submitComments = async ({ comments, closeRailAfter, trigger }) => {
    const draftIds = new Set(drafts.map((comment) => comment.id));
    const selected = comments.filter((comment) => draftIds.has(comment.id));
    if (selected.length === 0) return false;
    if (!hasRuntime) {
      sendNote.textContent =
        "Start the local review runtime with `big-plan review " +
        "<plan.mdx>` to send. Your drafts are saved here meanwhile.";
      return false;
    }
    trigger.disabled = true;
    sendButton.setAttribute("data-review-busy", "");
    sendNote.textContent = "";
    try {
      await confirmRuntime();
      const answer = await call("/api/feedback", {
        method: "POST",
        body: { comments: selected },
      });
      const submittedIds = new Set(selected.map((comment) => comment.id));
      sent = sent.concat(selected);
      if (isAgentRequest(answer.agentRequest)) {
        agentRequests = agentRequests.concat([answer.agentRequest]);
      }
      drafts = drafts.filter((comment) => !submittedIds.has(comment.id));
      for (const id of submittedIds) minimizedDraftIds.delete(id);
      activeDraft = agentInput.value;
      renderTray();
      await persist();
      setAgentState("With agent", "working");
      sendNote.textContent =
        "Sent " +
        answer.comments +
        " to the agent as " +
        answer.packageId +
        ".";
      announce("Feedback sent to the agent.");
      setActiveTab("comments");
      if (closeRailAfter) setRailOpen(false);
      startProgress();
      return true;
    } catch (error) {
      sendNote.textContent = describeError(error);
      trigger.disabled = false;
      return false;
    } finally {
      sendButton.removeAttribute("data-review-busy");
    }
  };

  // One intentional send of everything pending, with no confirmation dialog:
  // the tray already shows the count and every body about to leave.
  const submit = () =>
    submitComments({
      comments: drafts,
      closeRailAfter: false,
      trigger: sendButton,
    });

  sendButton.addEventListener("click", () => {
    void submit();
  });

  // ----------------------------------------------------------------- progress

  const exchangeSignature = ({ requests, responses }) =>
    JSON.stringify([
      requests.map((request) => request.requestId),
      responses.map((response) => [response.requestId, response.createdAt]),
    ]);

  const reloadForSourceRevision = () => {
    if (reloadKey !== null) {
      try {
        sessionStorage.setItem(
          reloadKey,
          JSON.stringify({
            scrollY: window.scrollY,
            expanded: Array.from(expandedThreadIds),
            tab: chatPanel.hidden ? "comments" : "chat",
            railOpen: railIsOpen(),
          }),
        );
      } catch {
        // Losing a restore hint never blocks the source refresh.
      }
    }
    window.location.reload();
  };

  const applyAgentSnapshot = (answer) => {
    const checked = checkedAgentSnapshot(answer);
    const changed =
      exchangeSignature(checked) !==
      exchangeSignature({
        requests: agentRequests,
        responses: agentResponses,
      });
    agentRequests = checked.requests;
    agentResponses = checked.responses;
    if (!changed) return;
    renderTray();
    void hydrateRevisionDiffs();
    const pending = pendingAgentRequestCount();
    if (needsAnswerCount() > 0) {
      setAgentState("Needs your answer", "ready");
    } else if (pending > 0) {
      setAgentState("With agent", "working");
    } else if (agentResponses.length > 0) {
      setAgentState("Ready to re-review", "ready");
    }
  };

  const pendingAgentRequestCount = () => {
    const answered = new Set(
      agentResponses.map((response) => response.requestId),
    );
    return agentRequests.filter((request) => !answered.has(request.requestId))
      .length;
  };

  const syncActivityToggle = () => {
    activityToggle.hidden = pendingAgentRequestCount() === 0;
    activityToggle.textContent = showAgentActivity
      ? "Hide activity"
      : "Show activity";
    activityToggle.setAttribute(
      "aria-pressed",
      showAgentActivity ? "true" : "false",
    );
  };

  activityToggle.addEventListener("click", () => {
    showAgentActivity = !showAgentActivity;
    renderPlanChat();
    renderThreads();
    syncActivityToggle();
  });

  const renderProgress = (events) => {
    if (events.length === 0) return;
    progressEvents = events;
    // The old DONE/WAITING ledger had no readable story. The latest validated
    // event appears only where the reviewer is waiting: inside a chat turn or
    // expanded anchored thread.
    renderPlanChat();
    renderThreads();
    const last = events[events.length - 1];
    if (needsAnswerCount() > 0) {
      setAgentState("Needs your answer", "ready");
    } else if (pendingAgentRequestCount() > 0) {
      setAgentState("With agent", "working");
    } else if (
      last.state === "done" &&
      (/re-?review/i.test(last.step) || /agent response ready/i.test(last.step))
    ) {
      setAgentState("Ready to re-review", "ready");
    } else if (last.state === "done") {
      setAgentState("Caught up", "ready");
    } else if (last.state === "failed") {
      setAgentState("Needs your attention", "failed");
    } else {
      setAgentState("Working", "working");
    }
  };

  const startProgress = () => {
    if (progressTimer !== null || !hasRuntime) return;
    const tick = async () => {
      try {
        const [answer, exchange] = await Promise.all([
          call("/api/progress"),
          call("/api/agent"),
        ]);
        if (
          typeof exchange.sourceRevision === "string" &&
          sourceRevision !== "" &&
          exchange.sourceRevision !== sourceRevision
        ) {
          reloadForSourceRevision();
          return;
        }
        if (typeof exchange.sourceRevision === "string") {
          sourceRevision = exchange.sourceRevision;
        }
        applyAgentSnapshot(exchange);
        // The runtime already drops foreign and out-of-order events; the
        // document checks the same two facts again rather than trusting that
        // an event reached it only because it was allowed to.
        const timeline = (answer.events || []).filter(
          (event) =>
            event &&
            event.sessionId === sessionId &&
            Number.isInteger(event.seq) &&
            typeof event.step === "string" &&
            typeof event.state === "string",
        );
        const latest =
          timeline.length === 0 ? 0 : timeline[timeline.length - 1].seq;
        if (latest > progressSeq) {
          progressSeq = latest;
          renderProgress(timeline);
        }
      } catch {
        // A refused or unreachable runtime stops the loop rather than
        // retrying forever against a port that may no longer be ours.
        window.clearInterval(progressTimer);
        progressTimer = null;
      }
    };
    progressTimer = window.setInterval(tick, PROGRESS_INTERVAL_MS);
    tick();
  };

  // ---------------------------------------------------------------- keyboard

  const moveCursor = (step) => {
    const index = cursorBlock ? blocks.indexOf(cursorBlock) : -1;
    const next = blocks[Math.min(Math.max(index + step, 0), blocks.length - 1)];
    if (!next) return;
    next.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => showAffordance(next), 220);
    announce(kindFor(next) + ": " + labelFor(next));
  };

  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor(1);
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(-1);
    }
    if (event.altKey && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      if (pendingSelection) openCompose(pendingSelection);
      else if (cursorBlock) openCompose(targetForBlock(cursorBlock));
      else setRailOpen(!railIsOpen());
    }
    if (event.key === "Escape" && diffLens) {
      event.preventDefault();
      clearDiffLens();
    } else if (event.key === "Escape" && !compose.hidden) {
      closeCompose();
    }
  });

  toggle.addEventListener("click", () => setRailOpen(!railIsOpen()));
  hideButton.addEventListener("click", () => setRailOpen(false));
  window.addEventListener("resize", () => {
    if (!compose.hidden && composeTarget) positionCompose(composeTarget);
    affordance.hidden = true;
    syncFloatingMode();
    renderThreads();
    positionMarkers();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!compose.hidden && composeTarget) positionCompose(composeTarget);
      if (pendingSelection) {
        pendingSelection = null;
        attachLabel.hidden = true;
        affordance.hidden = true;
        window.getSelection()?.removeAllRanges();
        paintTargetHighlights();
      } else if (!affordance.hidden && cursorBlock) {
        showAffordance(cursorBlock);
      }
      positionThreadCards();
      positionMarkers();
    },
    { passive: true },
  );

  // --------------------------------------------------------------------- boot

  const boot = async () => {
    if (!hasRuntime) {
      sendNote.textContent =
        "Reading offline: drafts stay in this browser until you run " +
        "`big-plan review`.";
      renderTray();
      if (drafts.length > 0) setRailOpen(true);
      return;
    }
    try {
      await confirmRuntime();
      // On-disk custody becomes the single home: anything the browser held is
      // handed over once and then cleared, so drafts do not linger in an
      // origin every local file shares.
      const answer = await call("/api/drafts");
      const known = new Set((answer.drafts || []).map((draft) => draft.id));
      const carried = readLocalState();
      drafts = (answer.drafts || []).concat(
        carried.drafts.filter((draft) => !known.has(draft.id)),
      );
      sent = answer.sent || [];
      resolvedCommentIds.clear();
      for (const id of answer.resolvedCommentIds || []) {
        if (isExchangeId(id)) resolvedCommentIds.add(id);
      }
      threadReplies = carried.threadReplies;
      planChatMessages = carried.planChatMessages;
      activeDraft =
        carried.activeDraft !== ""
          ? carried.activeDraft
          : answer.activeDraft || activeDraft;
      agentInput.value = activeDraft;
      await call("/api/drafts", {
        method: "PUT",
        body: {
          drafts,
          activeDraft,
          resolvedCommentIds: Array.from(resolvedCommentIds),
        },
      });
      writeLocalState();
      renderTray();
      void hydrateRevisionDiffs();
      if (drafts.length > 0) setRailOpen(true);
      if (sent.length > 0 || agentRequests.length > 0) startProgress();
      if (reloadState !== null) {
        setActiveTab(reloadState.tab);
        setRailOpen(reloadState.railOpen);
        requestAnimationFrame(() => {
          window.scrollTo(0, reloadState.scrollY);
          renderThreads();
        });
      }
    } catch (error) {
      sendNote.textContent = describeError(error);
      const carried = readLocalState();
      drafts = carried.drafts;
      sent = carried.sent;
      threadReplies = carried.threadReplies;
      planChatMessages = carried.planChatMessages;
      activeDraft = carried.activeDraft;
      agentInput.value = activeDraft;
      renderTray();
    }
  };

  renderTray();
  boot();
})();
