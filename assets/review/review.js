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

import { ACTIVITY_ICON } from "../../src/icons/lucide/activity.js";
import { CHECK_ICON } from "../../src/icons/lucide/check.js";
import { CHEVRON_LEFT_ICON } from "../../src/icons/lucide/chevron-left.js";
import { CHEVRON_RIGHT_ICON } from "../../src/icons/lucide/chevron-right.js";
import { CIRCLE_X_ICON } from "../../src/icons/lucide/circle-x.js";
import { COPY_ICON } from "../../src/icons/lucide/copy.js";
import { HOURGLASS_ICON } from "../../src/icons/lucide/hourglass.js";
import { MESSAGE_SQUARE_TEXT_ICON } from "../../src/icons/lucide/message-square-text.js";
import { MESSAGES_SQUARE_ICON } from "../../src/icons/lucide/messages-square.js";
import { MINIMIZE_2_ICON } from "../../src/icons/lucide/minimize-2.js";
import { PENCIL_ICON } from "../../src/icons/lucide/pencil.js";
import { ROTATE_CCW_ICON } from "../../src/icons/lucide/rotate-ccw.js";
import { TRASH_2_ICON } from "../../src/icons/lucide/trash-2.js";
import { TRIANGLE_ALERT_ICON } from "../../src/icons/lucide/triangle-alert.js";
import { UNDO_2_ICON } from "../../src/icons/lucide/undo-2.js";
import { X_ICON } from "../../src/icons/lucide/x.js";
import { threadSubstate } from "../../src/review/thread-group.js";
import {
  deriveAgentIndicator,
  deriveThreadStatus,
  sessionQuietMs,
} from "../../src/review/thread-status.js";
import { layoutAnchoredCards } from "../../src/review/anchored-layout.js";
import {
  commentTimeLabel,
  compactDurationLabel,
  relativeSignalLabel,
} from "../../src/review/time-label.js";

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
  // How long a pending request may sit unclaimed before the UI says no agent
  // is connected, and how long a claimed request may go without any new
  // progress before the UI says the agent has gone quiet.
  const AGENT_QUIET_MS = 90_000;
  const REVIEW_CONTROL_TOP = 52;
  const FLOAT_EDGE = 12;
  const FLOAT_CONTENT_GAP = 12;
  const COMMENT_WRAP_CLASSES =
    "min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]";

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

  const messageBody = (nodes, fallback) => {
    const renderNode = (node) => {
      if (node.type === "text") {
        return document.createTextNode(node.value);
      }
      if (node.type === "inlineCode") {
        return el("code", { text: node.value });
      }
      if (node.type === "code") {
        return el("pre", {}, [
          ...(node.language
            ? [
                el("span", {
                  class:
                    "[display:block] [margin-bottom:0.25rem] [color:var(--muted-c)] [font-size:0.58rem] [text-transform:uppercase]",
                  "data-review-code-language": true,
                  text: node.language,
                }),
              ]
            : []),
          el("code", { text: node.value }),
        ]);
      }
      const children = (node.children || []).map(renderNode);
      if (node.type === "paragraph") return el("p", {}, children);
      if (node.type === "strong") return el("strong", {}, children);
      if (node.type === "emphasis") return el("em", {}, children);
      if (node.type === "blockquote") return el("blockquote", {}, children);
      if (node.type === "listItem") return el("li", {}, children);
      if (node.type === "list") {
        return el(node.ordered ? "ol" : "ul", {}, children);
      }
      if (node.type === "link") {
        return el(
          "a",
          {
            href: node.url,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          children,
        );
      }
      return document.createTextNode("");
    };
    const checked = checkedMessageNodes(nodes);
    return checked
      ? el(
          "div",
          {
            class:
              COMMENT_WRAP_CLASSES +
              " data-[review-message-body=structured]:[min-width:0] data-[review-message-body=structured]:[color:var(--ink-c)] data-[review-message-body=structured]:[font-size:0.75rem] data-[review-message-body=structured]:[line-height:1.45] data-[review-message-body=structured]:[overflow-wrap:anywhere]",
            "data-review-message-body": "structured",
          },
          checked.map(renderNode),
        )
      : el("p", { class: COMMENT_WRAP_CLASSES, text: fallback });
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

  // Shortcut discovery lives on the button itself: hovering or focusing any
  // submit control shows its key combo as keycap chips beside the action name,
  // so the shortcut is learnable exactly where the click happens.
  const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || "");
  const MOD_KEY_LABEL = IS_MAC ? "⌘" : "Ctrl";

  const attachShortcutTooltip = (button, label) => {
    button.appendChild(
      el(
        "span",
        {
          class:
            "[position:absolute] [right:0] [bottom:calc(100%_+_0.45rem)] [z-index:60] [display:flex] [align-items:center] [gap:0.3rem] [padding:0.32rem_0.45rem] [border:1px_solid_var(--edge-c)] [border-radius:0.4rem] [background:var(--bg)] [color:var(--muted-c)] [font-size:0.6875rem] [font-weight:500] [white-space:nowrap] [box-shadow:0_6px_20px_rgb(0_0_0_/_0.14)] [opacity:0] [visibility:hidden] [transition:opacity_100ms_ease,_visibility_0s_linear_100ms] [pointer-events:none]",
          "data-review-kbd-tooltip": true,
          "aria-hidden": "true",
        },
        [
          el("kbd", { text: MOD_KEY_LABEL }),
          el("kbd", { text: "Enter" }),
          el("span", { text: label }),
        ],
      ),
    );
    button.setAttribute(
      "aria-keyshortcuts",
      (IS_MAC ? "Meta" : "Control") + "+Enter",
    );
    return button;
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
    if (target.type === "slide")
      return (target.section || target.label || "Plan") + " · Whole slide";
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

  // Major headings are the outline authority. Counting only [data-slide]
  // wrappers is incorrect because a parent with subslides may be flattened
  // away by the deck transform while its h2 remains in the document.
  const slideNumberBySection = new Map();
  let majorSlide = 0;
  for (const heading of document.querySelectorAll(
    "main h2[data-block-section]",
  )) {
    if (heading.closest("section.footnotes")) continue;
    const section = heading.getAttribute("data-block-section");
    if (!section || section === "Overview") continue;
    majorSlide += 1;
    slideNumberBySection.set(section, String(majorSlide));
  }
  for (const slide of document.querySelectorAll("[data-slide]")) {
    if (!slide.hasAttribute("data-subslide")) continue;
    const section = slide
      .querySelector("[data-block-section]")
      ?.getAttribute("data-block-section");
    const kicker = slide
      .querySelector("[data-slide-kicker]")
      ?.textContent?.trim();
    const number = kicker?.match(/^(\d+(?:\.\d+)*)\s*\//)?.[1];
    if (section && number) slideNumberBySection.set(section, number);
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
  let pendingSelection = null;
  let activeDraft = "";
  let composeDrafts = {};
  let threadReplies = {};
  let planChatMessages = [];
  let agentRequests = [];
  let agentResponses = [];
  let agentCancelledIds = [];
  let agentConnected = false;
  let agentHeartbeatAt = 0;
  let agentSessionState = null;
  let agentConnectionLog = [];
  let agentPlanPath = "";
  let agentCommand = "";
  let agentRecoveryPrompt = "";
  let sourceRevision = "";
  let progressSeq = 0;
  let liveProgressSeq = 0;
  let progressTimer = null;
  let progressEvents = [];
  let runtimeConfirmed = false;
  let deleteCandidateId = null;
  let revertCandidateId = null;
  let submitRightAway = false;
  let showAgentActivity = true;
  const revisionDiffs = new Map();
  const chatDigestExpansion = new Map();
  const changeGroupExpansion = new Map();
  let diffLens = null;
  const expandedCommentIds = new Set();
  const expandedThreadIds = new Set();
  const minimizedDraftIds = new Set();
  const resolvedCommentIds = new Set();
  // Honest in-flight and failure states: a comment mid-submit renders as
  // sending, a failed submit renders its error on the card, and the agent's
  // availability is derived rather than assumed.
  const submittingIds = new Set();
  const submitErrorById = new Map();
  const requestSeenAt = new Map();
  let emphasizedCommentId = null;
  let lastProgressAdvanceAt = 0;
  let pollFailures = 0;
  let runtimeOffline = false;
  let lastHealthSignature = "";
  let connectionPanelSignature = "";

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
        tab:
          value.tab === "chat" || value.tab === "agent"
            ? value.tab
            : "comments",
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
    composeDrafts: {},
    threadReplies: {},
    planChatMessages: [],
    resolvedCommentIds: [],
    agent: {
      requests: [],
      responses: [],
      cancelledIds: [],
      connected: false,
      state: null,
      updatedAtMs: 0,
      connectionLog: [],
    },
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

  const checkedComposeDrafts = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const checked = {};
    for (const [key, body] of Object.entries(value).slice(0, MESSAGE_LIMIT)) {
      if (
        key.length <= 1200 &&
        typeof body === "string" &&
        body.length <= BODY_LIMIT
      ) {
        checked[key] = body;
      }
    }
    return checked;
  };

  const checkedStoredState = (value) => {
    if (!isStoredState(value)) return emptyStoredState();
    return {
      drafts: value.drafts.filter(isComment),
      sent: value.sent.filter(isComment),
      activeDraft: value.activeDraft.slice(0, BODY_LIMIT),
      composeDrafts: checkedComposeDrafts(value.composeDrafts),
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
    (value.kind === "feedback"
      ? Array.isArray(value.comments) &&
        value.comments.length === 1 &&
        Number.isInteger(value.batchIndex) &&
        Number.isInteger(value.batchSize) &&
        value.batchIndex >= 0 &&
        value.batchIndex < value.batchSize
      : typeof value.body === "string" &&
        value.body.trim() !== "" &&
        value.body.length <= BODY_LIMIT);

  const checkedMessageNodes = (value) => {
    if (!Array.isArray(value)) return null;
    let count = 0;
    const check = (node, depth) => {
      count += 1;
      if (
        count > 500 ||
        depth > 6 ||
        node === null ||
        typeof node !== "object"
      ) {
        return false;
      }
      const children = () =>
        Array.isArray(node.children) &&
        node.children.every((child) => check(child, depth + 1));
      if (node.type === "text" || node.type === "inlineCode") {
        return typeof node.value === "string";
      }
      if (node.type === "code") {
        return (
          typeof node.value === "string" &&
          (node.language === undefined || typeof node.language === "string")
        );
      }
      if (node.type === "link") {
        if (typeof node.url !== "string" || node.url.length > 1000)
          return false;
        try {
          const url = new URL(node.url);
          if (url.protocol !== "http:" && url.protocol !== "https:")
            return false;
        } catch {
          return false;
        }
        return children();
      }
      if (node.type === "list") {
        return typeof node.ordered === "boolean" && children();
      }
      return (
        (node.type === "paragraph" ||
          node.type === "strong" ||
          node.type === "emphasis" ||
          node.type === "blockquote" ||
          node.type === "listItem") &&
        children()
      );
    };
    return value.every((node) => check(node, 1)) ? value : null;
  };

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
    (value.messageNodes === undefined ||
      checkedMessageNodes(value.messageNodes) !== null) &&
    (value.changes === undefined ||
      (Array.isArray(value.changes) &&
        value.changes.every(
          (change) =>
            change !== null &&
            typeof change === "object" &&
            isExchangeId(change.placeId) &&
            typeof change.summary === "string" &&
            change.summary.trim() !== "" &&
            change.summary.length <= 90,
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
    value.revisionPair !== null &&
    typeof value.revisionPair === "object" &&
    /^[a-f0-9]{16,64}$/.test(value.revisionPair.fromRevision || "") &&
    /^[a-f0-9]{16,64}$/.test(value.revisionPair.toRevision || "") &&
    (value.kind === "chat"
      ? typeof value.message === "string" &&
        value.message.trim() !== "" &&
        value.message.length <= BODY_LIMIT &&
        (value.messageNodes === undefined ||
          checkedMessageNodes(value.messageNodes) !== null)
      : Array.isArray(value.outcomes) && value.outcomes.every(isAgentOutcome));

  const checkedAgentSnapshot = (value) => {
    if (value === null || typeof value !== "object") {
      return emptyStoredState().agent;
    }
    const heartbeat =
      value.agent !== null &&
      typeof value.agent === "object" &&
      !Array.isArray(value.agent)
        ? value.agent
        : value;
    return {
      requests: (Array.isArray(value.requests) ? value.requests : [])
        .filter(isAgentRequest)
        .slice(0, MESSAGE_LIMIT),
      responses: (Array.isArray(value.responses) ? value.responses : [])
        .filter(isAgentResponse)
        .slice(0, MESSAGE_LIMIT),
      cancelledIds: (Array.isArray(value.cancelledIds)
        ? value.cancelledIds
        : []
      )
        .filter(isExchangeId)
        .slice(0, MESSAGE_LIMIT),
      connected: value.connected === true,
      state:
        heartbeat.state === "waiting" || heartbeat.state === "working"
          ? heartbeat.state
          : null,
      updatedAtMs:
        typeof heartbeat.updatedAtMs === "number" &&
        Number.isFinite(heartbeat.updatedAtMs)
          ? heartbeat.updatedAtMs
          : 0,
      connectionLog: (Array.isArray(value.connectionLog)
        ? value.connectionLog
        : []
      )
        .filter(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            typeof entry.connected === "boolean" &&
            typeof entry.at === "string" &&
            !Number.isNaN(Date.parse(entry.at)),
        )
        .map((entry) => ({
          connected: entry.connected,
          at: new Date(entry.at).toISOString(),
          ...(typeof entry.reason === "string" &&
          entry.reason.trim() !== "" &&
          entry.reason.length <= 160
            ? { reason: entry.reason }
            : {}),
        }))
        .slice(0, MESSAGE_LIMIT),
      plan:
        typeof value.plan === "string" && value.plan.length <= BODY_LIMIT
          ? value.plan
          : "",
      agentCommand:
        typeof value.agentCommand === "string" &&
        value.agentCommand.length <= BODY_LIMIT
          ? value.agentCommand
          : "",
      recoveryPrompt:
        typeof value.recoveryPrompt === "string" &&
        value.recoveryPrompt.length <= BODY_LIMIT
          ? value.recoveryPrompt
          : "",
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
          composeDrafts,
          threadReplies,
          planChatMessages,
        }),
      );
    } catch {
      // A full or blocked store costs persistence, never the session.
    }
  };

  const isComment = (value) =>
    value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.body === "string" &&
    value.target !== null &&
    typeof value.target === "object";

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
  composeDrafts = browserState.composeDrafts;
  threadReplies = browserState.threadReplies;
  planChatMessages = browserState.planChatMessages;
  for (const id of diskState.resolvedCommentIds) {
    resolvedCommentIds.add(id);
  }
  agentRequests = diskState.agent.requests;
  agentResponses = diskState.agent.responses;
  agentCancelledIds = diskState.agent.cancelledIds;
  agentConnected = diskState.agent.connected;
  agentHeartbeatAt = diskState.agent.updatedAtMs;
  agentSessionState = diskState.agent.state;
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
    class:
      "[position:fixed] [top:2.75rem] [right:0] [bottom:0] [z-index:44] [display:flex] [width:min(22rem,_100vw)] max-[80rem]:[width:min(24rem,calc(100vw-2rem))] max-[40rem]:[width:100vw]! [flex-direction:column] [border-left:1px_solid_var(--edge-c)] [background:var(--bg)] [box-shadow:-8px_0_24px_rgb(0_0_0_/_0.06)] [font-size:0.875rem] [overflow-anchor:none]",
    "data-review-rail": true,
    "aria-label": "Feedback",
    hidden: true,
  });

  // Connection trouble stays visible beside the Feedback toggle and links to
  // the existing chat status surface; it does not introduce a second status
  // model.
  const agentAlertLabel = el("span", { text: "No agent connected" });
  const agentAlert = el("button", {
    class:
      "[display:inline-flex] [min-height:1.85rem] [align-items:center] [gap:0.4rem] [padding:0.32rem_0.4rem] [border:0] [border-radius:0.25rem] [background:transparent] [color:var(--muted-c)] [font-size:0.8125rem] [line-height:1.2] [cursor:pointer] [color:var(--callout-danger-c)] [font-size:0.75rem] [font-weight:650] [white-space:nowrap] hover:[background:var(--callout-danger-bg)] active:[background:color-mix(in_srgb,_var(--callout-danger-bg)_80%,_var(--ink-c))]",
    type: "button",
    "data-review-agent-alert": true,
    hidden: true,
  });
  agentAlert.append(icon(TRIANGLE_ALERT_ICON), agentAlertLabel);
  agentAlert.addEventListener("click", () => {
    setRailOpen(true);
    setActiveTab("agent");
  });
  const agentOk = el("button", {
    class:
      "[display:inline-flex] [min-height:1.85rem] [align-items:center] [gap:0.4rem] [padding:0.32rem_0.4rem] [border:0] [border-radius:0.25rem] [background:transparent] [color:var(--muted-c)] [font-size:0.8125rem] [line-height:1.2] [cursor:pointer] [position:relative] [width:1.85rem] [justify-content:center] hover:[background:var(--review-control-hover)] active:[background:var(--review-control-active)]",
    type: "button",
    "data-review-agent-ok": true,
    "aria-label": "Agent session active",
    hidden: true,
  });
  agentOk.append(
    el("span", {
      class:
        "[width:6px] [height:6px] [border-radius:999px] [background:var(--diff-add-c)] [box-shadow:0_0_0_2px_color-mix(in_srgb,_var(--diff-add-c)_34%,_transparent)]",
      "data-review-agent-ok-dot": true,
      "aria-hidden": "true",
    }),
    el("span", {
      class:
        "[position:absolute] [top:calc(100%_+_0.35rem)] [right:0] [z-index:60] [width:max-content] [max-width:11rem] [padding:0.22rem_0.42rem] [border-radius:0.25rem] [background:var(--ink-c)] [color:var(--bg)] [font-size:0.66rem] [font-weight:600] [line-height:1.35] [pointer-events:none] [opacity:0] [transform:translateY(-0.1rem)] [transition:opacity_70ms_ease,_transform_70ms_ease]",
      "data-review-icon-tooltip": true,
      "aria-hidden": "true",
      text: "Agent session active",
    }),
  );
  agentOk.addEventListener("click", () => {
    setRailOpen(true);
    setActiveTab("agent");
  });

  const toggle = el("button", {
    class:
      "[display:inline-flex] [min-height:1.85rem] [align-items:center] [gap:0.4rem] [padding:0.32rem_0.4rem] [border:0] [border-radius:0.25rem] [background:transparent] [color:var(--muted-c)] [font-size:0.8125rem] [line-height:1.2] [cursor:pointer] hover:[background:var(--review-control-hover)] hover:[color:var(--ink-c)] active:[background:var(--review-control-active)] aria-expanded:[border-radius:0.375rem] aria-expanded:[background:color-mix(in_srgb,_var(--diff-add-c)_9%,_var(--bg))] aria-expanded:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,_var(--diff-add-c)_26%,_transparent)] aria-expanded:[color:var(--diff-add-c)] data-[review-has-pending=true]:[color:var(--accent-c)]",
    type: "button",
    "data-review-toggle": true,
    "aria-expanded": "false",
    "aria-label": "Open feedback sidebar",
    title: "Open feedback sidebar (Alt+C)",
  });
  const toggleCount = el("span", {
    class:
      "[display:inline-flex] [min-width:1.15rem] [height:1.15rem] [align-items:center] [justify-content:center] [padding:0_0.28rem] [border:1px_solid_currentColor] [border-radius:999px] [font-variant-numeric:tabular-nums] [font-size:0.625rem] [font-weight:700] [text-align:center] empty:[display:none] data-[review-toggle-count-kind=needs]:[border-color:var(--callout-warning-c)] data-[review-toggle-count-kind=needs]:[background:var(--callout-warning-bg)] data-[review-toggle-count-kind=needs]:[color:var(--callout-warning-c)]",
    "data-review-toggle-count": true,
    text: "0",
  });
  const feedbackLabel = el("span", { "data-review-toggle-label": true });
  toggle.append(icon(MESSAGE_SQUARE_TEXT_ICON), feedbackLabel, toggleCount);
  const sendButton = el("button", {
    class:
      "[display:inline-flex] [width:auto] [min-height:1.85rem] [align-items:center] [padding:0.32rem_0.65rem] [border:1px_solid_var(--accent-c)] [border-radius:0.4rem] [background:var(--accent-c)] [color:var(--bg)] [font-size:0.8125rem] [font-weight:600] [white-space:nowrap] [cursor:pointer]",
    type: "button",
    "data-review-send": true,
    hidden: true,
    text: "Send all to agent",
  });
  const compactBatchLabel = el("span", {
    "data-review-batch-label": true,
  });
  const compactBatchMenu = el("details", {
    class: "[position:relative] [display:none]",
    "data-review-batch-menu": true,
    hidden: true,
  });
  const compactBatchSummary = el("summary", {}, [
    compactBatchLabel,
    icon(CHEVRON_RIGHT_ICON),
  ]);
  const compactReviewButton = el("button", {
    type: "button",
    "data-review-batch-review": true,
    text: "Review comments",
  });
  const compactSendButton = el("button", {
    type: "button",
    "data-review-batch-send": true,
    text: "Send all to agent",
  });
  compactBatchMenu.append(
    compactBatchSummary,
    el(
      "div",
      {
        class:
          "[position:absolute] [top:calc(100%_+_0.3rem)] [right:0] [display:grid] [width:11rem] [padding:0.3rem] [border:1px_solid_var(--edge-c)] [border-radius:0.45rem] [background:var(--bg)] [box-shadow:0_8px_24px_rgb(0_0_0_/_0.14)]",
        "data-review-batch-actions": true,
      },
      [compactReviewButton, compactSendButton],
    ),
  );
  const toolbar = el(
    "div",
    {
      class:
        "[position:fixed] [top:0] [right:0] [left:0] [z-index:80] [display:flex] [height:2.75rem] [align-items:center] [justify-content:flex-end] [gap:0.35rem] [padding-right:1rem] [border-bottom:1px_solid_var(--edge-c)] [background:var(--bg)] [pointer-events:none]",
      "data-review-toolbar": true,
    },
    [agentAlert, agentOk, toggle, sendButton, compactBatchMenu],
  );

  const countLabel = el("span", {
    class:
      "[display:inline-flex] [min-width:1.15rem] [height:1.15rem] [align-items:center] [justify-content:center] [padding:0_0.28rem] [border-radius:999px] [background:var(--surface-c)] [color:var(--muted-c)] [font-size:0.625rem] [font-weight:750] [font-variant-numeric:tabular-nums] empty:[display:none]",
    "data-review-count": true,
    text: "Nothing pending",
  });
  const hideButton = el("button", {
    class:
      "[display:inline-flex] [padding:0.2rem] [border-radius:0.3rem] [color:var(--muted-c)] [cursor:pointer] hover:[background:var(--review-control-hover)] hover:[color:var(--ink-c)] active:[background:var(--review-control-active)]",
    type: "button",
    "data-review-hide": true,
    "aria-label": "Hide feedback",
  });
  hideButton.appendChild(icon(X_ICON));

  const draftList = el("ol", {
    class: "[margin:0] [padding:0] [list-style:none]",
    "data-review-drafts": true,
  });
  const draftGroupCount = el("span", {
    class:
      "[display:inline-flex] [min-width:1.1rem] [height:1.1rem] [align-items:center] [justify-content:center] [margin-left:auto] [padding:0_0.25rem] [border-radius:999px] [background:var(--surface-c)] [font-size:0.625rem] [font-variant-numeric:tabular-nums]",
    "data-review-outcome-group-count": true,
  });
  const sidebarSendButton = el("button", {
    type: "button",
    class:
      "mt-3 w-full cursor-pointer rounded-md border border-accent bg-accent px-3 py-2 text-[0.8125rem] font-semibold text-[var(--bg)] hover:brightness-110 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "data-review-sidebar-send": true,
    text: "Send all to agent",
  });
  const draftGroup = el(
    "section",
    {
      "data-review-draft-group": true,
      "data-review-outcome-group": "staged",
      hidden: true,
    },
    [
      el("h3", {}, [
        el("span", { text: "Staged" }),
        document.createTextNode(" "),
        draftGroupCount,
      ]),
      draftList,
      sidebarSendButton,
    ],
  );
  const emptyNote = el("p", {
    class:
      "[margin:0.4rem_0_0] [color:var(--muted-c)] [font-size:0.8125rem] [line-height:1.5]",
    "data-review-empty": true,
    text: "Select text to comment, or use a slide selector to select it all.",
  });
  const responseSummary = el("p", {
    class:
      "[min-width:0] [flex:1_1_auto] [margin:0] [color:var(--muted-c)] [font-size:0.6875rem] [line-height:1.45] [display:flex] [flex-wrap:wrap] [gap:0.3rem]",
    "data-review-round-summary": true,
  });
  const resolveAllButton = el("button", {
    class:
      "[flex:0_0_auto] [padding:0] [border:0] [background:transparent] [color:var(--muted-c)] [font-size:0.72rem] [cursor:pointer] hover:[color:var(--ink-c)] hover:[text-decoration:underline] focus-visible:[color:var(--ink-c)] focus-visible:[text-decoration:underline] active:[color:var(--accent-c)]",
    type: "button",
    "data-review-resolve-all": true,
    text: "Resolve all",
    hidden: true,
  });
  const roundHead = el(
    "div",
    {
      class:
        "[display:flex] [min-width:0] [align-items:baseline] [gap:0.6rem] [margin-bottom:0.7rem]",
      "data-review-round-head": true,
    },
    [responseSummary, resolveAllButton],
  );
  const sentList = el("div", {
    class: "[margin:0] [padding:0] [list-style:none]",
    "data-review-sent-list": true,
  });
  const sentGroup = el(
    "section",
    {
      class:
        "[margin-top:0.9rem] [padding-top:0.7rem] [border-top:1px_solid_var(--edge-c)]",
      "data-review-sent": true,
      hidden: true,
    },
    [roundHead, sentList],
  );

  const sendNote = el("p", {
    class:
      "[margin:0.45rem_0_0] [color:var(--muted-c)] [font-size:0.75rem] [line-height:1.45] [overflow-wrap:anywhere] empty:[display:none]",
    "data-review-send-note": true,
  });
  const sendBar = el(
    "div",
    {
      class:
        "[margin-top:0.7rem] [padding-top:0.7rem] [border-top:1px_solid_var(--edge-c)]",
      "data-review-send-bar": true,
      hidden: true,
    },
    [sendNote],
  );

  const agentState = el("span", {
    class:
      "[margin-left:auto] [padding:0.1rem_0.45rem] [border-radius:999px] [font-size:0.6875rem] [font-weight:600] [white-space:nowrap] data-[tone=idle]:[background:var(--callout-warning-bg)] data-[tone=idle]:[color:var(--callout-warning-c)] data-[tone=working]:[background:var(--callout-note-bg)] data-[tone=working]:[color:var(--callout-note-c)] data-[tone=ready]:[background:var(--diff-add-bg)] data-[tone=ready]:[color:var(--diff-add-c)] data-[tone=failed]:[background:var(--callout-danger-bg)] data-[tone=failed]:[color:var(--callout-danger-c)]",
    "data-review-agent-state": true,
    "data-tone": "idle",
    text: "Waiting for you",
  });
  const agentInput = el("textarea", {
    class:
      "[display:block] [width:100%] [padding:0.4rem_0.5rem] [border:1px_solid_var(--edge-c)] [border-radius:0.4rem] [background:var(--bg)] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [resize:vertical] focus-visible:[outline:1px_solid_var(--accent-c)] focus-visible:[outline-offset:2px]",
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
    {
      class:
        "[display:flex] [align-items:center] [gap:0.4rem] [margin-top:0.4rem] [color:var(--muted-c)] [font-size:0.75rem]",
      "data-review-attach": true,
      hidden: true,
    },
    [
      attachInput,
      el("span", {
        "data-review-attach-text": true,
        text: "Attach to my selection",
      }),
    ],
  );
  const agentSave = el("button", {
    class:
      "[margin-top:0.45rem] [padding:0.3rem_0.65rem] [border:1px_solid_var(--edge-c)] [border-radius:0.35rem] [background:var(--bg)] [color:var(--ink-c)] [font-size:0.75rem] [cursor:pointer] [position:relative] hover:[background:var(--review-control-hover)] hover:[border-color:var(--accent-c)] hover:[color:var(--accent-c)] active:[background:var(--review-control-active)]",
    type: "button",
    "data-review-agent-save": true,
    text: "Send",
  });
  attachShortcutTooltip(agentSave, "Send message");
  const planChatList = el("ol", {
    class:
      "[display:grid] [gap:0.5rem] [margin:0_0_0.7rem] [padding:0] [list-style:none]",
    "data-review-plan-chat": true,
    "aria-label": "Plan-wide conversation",
  });

  const agentPanel = el(
    "section",
    {
      class:
        "[padding:0.7rem_0.9rem_0.9rem] [border-top:1px_solid_var(--edge-c)] [background:var(--surface-c)]",
      "data-review-agent": true,
    },
    [
      el(
        "div",
        {
          class:
            "[display:flex] [align-items:center] [gap:0.5rem] [margin-bottom:0.5rem]",
          "data-review-agent-head": true,
        },
        [el("h3", { text: "Plan-wide chat" }), agentState],
      ),
      el("p", {
        class:
          "[margin:-0.15rem_0_0.65rem] [color:var(--muted-c)] [font-size:0.6875rem] [line-height:1.45]",
        "data-review-chat-note": true,
        text: hasRuntime
          ? "Live coding-agent conversation through this plan’s local review session."
          : "Start `big-plan review` and its coding-agent session to chat.",
      }),
      planChatList,
      el("label", {
        class:
          "[display:block] [margin-bottom:0.25rem] [color:var(--muted-c)] [font-size:0.75rem] [font-weight:600]",
        for: "big-plan-review-agent-note",
        "data-review-field-label": true,
        text: "Message",
      }),
      agentInput,
      attachLabel,
      agentSave,
    ],
  );

  const commentsTab = el("button", {
    class:
      "[display:inline-flex] [align-items:center] [gap:0.35rem] [padding:0.42rem_0.52rem] [border-top-width:0] [border-right-width:0] [border-bottom-width:2px] [border-left-width:0] [border-bottom-style:solid] [border-bottom-color:transparent] [background:transparent] [color:var(--muted-c)] [font-size:0.75rem] [font-weight:650] [cursor:pointer] hover:[background:var(--review-control-hover)] active:[background:var(--review-control-active)] aria-selected:[border-bottom-color:var(--accent-c)] aria-selected:[color:var(--ink-c)]",
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
    class:
      "[display:inline-flex] [align-items:center] [gap:0.35rem] [padding:0.42rem_0.52rem] [border-top-width:0] [border-right-width:0] [border-bottom-width:2px] [border-left-width:0] [border-bottom-style:solid] [border-bottom-color:transparent] [background:transparent] [color:var(--muted-c)] [font-size:0.75rem] [font-weight:650] [cursor:pointer] hover:[background:var(--review-control-hover)] active:[background:var(--review-control-active)] aria-selected:[border-bottom-color:var(--accent-c)] aria-selected:[color:var(--ink-c)]",
    type: "button",
    role: "tab",
    "data-review-tab": "chat",
    "aria-selected": "false",
    "aria-controls": "big-plan-review-chat",
  });
  chatTab.append(icon(MESSAGES_SQUARE_ICON), el("span", { text: "Chat" }));
  const connectionTab = hasRuntime
    ? el("button", {
        class:
          "[display:inline-flex] [align-items:center] [gap:0.35rem] [padding:0.42rem_0.52rem] [border-top-width:0] [border-right-width:0] [border-bottom-width:2px] [border-left-width:0] [border-bottom-style:solid] [border-bottom-color:transparent] [background:transparent] [color:var(--muted-c)] [font-size:0.75rem] [font-weight:650] [cursor:pointer] hover:[background:var(--review-control-hover)] active:[background:var(--review-control-active)] aria-selected:[border-bottom-color:var(--accent-c)] aria-selected:[color:var(--ink-c)]",
        type: "button",
        role: "tab",
        "data-review-tab": "agent",
        "aria-selected": "false",
        "aria-controls": "big-plan-review-agent",
      })
    : null;
  connectionTab?.append(icon(ACTIVITY_ICON), el("span", { text: "Agent" }));
  const tabList = el(
    "div",
    {
      class:
        "[display:flex] [flex:0_0_auto] [align-items:stretch] [gap:0.2rem] [padding:0.35rem_0.4rem_0]",
      "data-review-tabs": true,
      role: "tablist",
    },
    [commentsTab, chatTab, connectionTab, hideButton],
  );
  const commentsPanel = el(
    "section",
    {
      class:
        "[min-height:0] data-[review-panel=comments]:[display:flex] data-[review-panel=comments]:[flex:1_1_auto] data-[review-panel=comments]:[flex-direction:column] data-[review-panel=chat]:[flex:1_1_auto] data-[review-panel=chat]:[overflow-y:auto] data-[review-panel=chat]:[overscroll-behavior:contain] data-[review-panel=agent]:[flex:1_1_auto] data-[review-panel=agent]:[padding:0.9rem] data-[review-panel=agent]:[overflow-y:auto] data-[review-panel=agent]:[overscroll-behavior:contain]",
      id: "big-plan-review-comments",
      "data-review-panel": "comments",
      role: "tabpanel",
    },
    [
      el(
        "div",
        {
          class:
            "[flex:1_1_auto] [overflow-y:auto] [overscroll-behavior:contain] [padding:0.7rem_0.9rem_1.2rem]",
          "data-review-scroll": true,
        },
        [draftGroup, sendBar, emptyNote, sentGroup],
      ),
    ],
  );
  const chatPanel = el(
    "section",
    {
      class:
        "[min-height:0] data-[review-panel=comments]:[display:flex] data-[review-panel=comments]:[flex:1_1_auto] data-[review-panel=comments]:[flex-direction:column] data-[review-panel=chat]:[flex:1_1_auto] data-[review-panel=chat]:[overflow-y:auto] data-[review-panel=chat]:[overscroll-behavior:contain] data-[review-panel=agent]:[flex:1_1_auto] data-[review-panel=agent]:[padding:0.9rem] data-[review-panel=agent]:[overflow-y:auto] data-[review-panel=agent]:[overscroll-behavior:contain]",
      id: "big-plan-review-chat",
      "data-review-panel": "chat",
      role: "tabpanel",
      hidden: true,
    },
    [agentPanel],
  );
  const connectionPanel = hasRuntime
    ? el("section", {
        class:
          "[min-height:0] data-[review-panel=comments]:[display:flex] data-[review-panel=comments]:[flex:1_1_auto] data-[review-panel=comments]:[flex-direction:column] data-[review-panel=chat]:[flex:1_1_auto] data-[review-panel=chat]:[overflow-y:auto] data-[review-panel=chat]:[overscroll-behavior:contain] data-[review-panel=agent]:[flex:1_1_auto] data-[review-panel=agent]:[padding:0.9rem] data-[review-panel=agent]:[overflow-y:auto] data-[review-panel=agent]:[overscroll-behavior:contain]",
        id: "big-plan-review-agent",
        "data-review-panel": "agent",
        role: "tabpanel",
        hidden: true,
      })
    : null;
  const railHeader = el(
    "header",
    {
      class: "[flex:0_0_auto] [border-bottom:1px_solid_var(--edge-c)]",
      "data-review-rail-header": true,
    },
    [tabList],
  );
  rail.append(railHeader, commentsPanel, chatPanel);
  if (connectionPanel) rail.appendChild(connectionPanel);

  const affordance = el("button", {
    class:
      "[position:fixed] [z-index:46] [display:inline-flex] [align-items:center] [gap:0.3rem] [padding:0.2rem_0.5rem] [border:1px_solid_var(--edge-c)] [border-radius:999px] [background:var(--bg)] [color:var(--muted-c)] [font-size:0.75rem] [cursor:pointer] [box-shadow:0_2px_8px_rgb(0_0_0_/_0.08)] hover:[background:var(--review-control-hover)] hover:[border-color:var(--accent-c)] hover:[color:var(--accent-c)] focus-visible:[background:var(--review-control-hover)] focus-visible:[border-color:var(--accent-c)] focus-visible:[color:var(--accent-c)] active:[background:var(--review-control-active)]",
    type: "button",
    "data-review-affordance": true,
    hidden: true,
  });
  const affordanceLabel = el("span", { text: "Comment" });
  affordance.append(icon(MESSAGE_SQUARE_TEXT_ICON), affordanceLabel);
  const composeInput = el("textarea", {
    class:
      "[display:block] [width:100%] [padding:0.4rem_0.5rem] [border:1px_solid_var(--edge-c)] [border-radius:0.4rem] [background:var(--bg)] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [resize:vertical] focus-visible:[outline:1px_solid_var(--accent-c)] focus-visible:[outline-offset:2px]",
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
  const composeSaveLabel = el("span", {
    "data-review-button-label": true,
    text: "Add Comment",
  });
  const composeSave = el(
    "button",
    {
      class:
        "[border-color:var(--accent-c)]! [background:var(--accent-c)]! [color:var(--bg)]! [font-weight:600] [position:relative]",
      type: "button",
      "data-review-compose-save": true,
      disabled: true,
    },
    [composeSaveLabel],
  );
  attachShortcutTooltip(composeSave, "Add comment");
  // The one visible action mirrors the submit-right-away preference, so the
  // button always names what clicking it will actually do.
  const syncComposeSaveLabel = () => {
    const label = submitRightAway ? "Submit Now" : "Add Comment";
    composeSaveLabel.textContent = label;
    const tooltipLabel = composeSave.querySelector(
      "[data-review-kbd-tooltip] > span",
    );
    if (tooltipLabel) tooltipLabel.textContent = label;
  };
  syncComposeSaveLabel();
  const submitImmediatelyInput = el("input", {
    class: "peer [position:absolute] [width:1px] [height:1px] [opacity:0]",
    type: "checkbox",
    role: "switch",
    "data-review-submit-immediately-input": true,
    id: "big-plan-review-submit-immediately",
    ...(submitRightAway ? { checked: true } : {}),
  });
  const submitImmediately = el(
    "label",
    {
      class:
        "[display:flex] [align-items:center] [gap:0.45rem] [width:fit-content] [margin-top:0.55rem] [color:var(--muted-c)] [font-size:0.75rem] [cursor:pointer]",
      "data-review-submit-immediately": true,
      for: "big-plan-review-submit-immediately",
    },
    [
      submitImmediatelyInput,
      el("span", {
        class:
          "[position:relative] [width:1.8rem] [height:1rem] [flex:0_0_auto] [border:1px_solid_var(--edge-c)] [border-radius:999px] [background:var(--surface-c)] peer-checked:[border-color:var(--diff-add-c)] peer-checked:[background:var(--diff-add-c)] peer-checked:after:[background:var(--bg)] peer-checked:after:[transform:translateX(0.8rem)] peer-focus-visible:[outline:1px_solid_var(--accent-c)] peer-focus-visible:[outline-offset:2px]",
        "data-review-switch-track": true,
      }),
      el("span", { text: "Submit right away" }),
    ],
  );
  const compose = el(
    "div",
    {
      class:
        "data-[review-compose-inline]:relative! data-[review-compose-inline]:[right:auto] data-[review-compose-inline]:[z-index:2]! data-[review-compose-inline]:[width:100%]! data-[review-compose-inline]:[margin:0.65rem_0_1rem] data-[review-compose-inline]:[box-shadow:0_4px_18px_rgb(0_0_0_/_0.11)] data-[review-compose-centered]:fixed! data-[review-compose-centered]:[top:50%] data-[review-compose-centered]:[right:auto] data-[review-compose-centered]:[left:50%] data-[review-compose-centered]:[width:min(24rem,calc(100vw-2rem))]! data-[review-compose-centered]:[transform:translate(-50%,-50%)] [position:absolute] [right:auto] [z-index:47] [width:17rem] [padding:0.75rem] [border:1px_solid_var(--edge-c)] [border-radius:0.6rem] [background:var(--bg)] [box-shadow:0_8px_28px_rgb(0_0_0_/_0.16)] [pointer-events:auto]",
      "data-review-compose": true,
      role: "dialog",
      "aria-label": "Add a comment",
      hidden: true,
    },
    [
      el("label", {
        class:
          "[display:block] [margin-bottom:0.25rem] [color:var(--muted-c)] [font-size:0.75rem] [font-weight:600]",
        for: "big-plan-review-compose",
        "data-review-field-label": true,
        text: "Add a comment",
      }),
      composeInput,
      el("p", {
        class:
          "[margin:0.35rem_0_0] [color:var(--muted-c)] [font-size:0.6875rem]",
        "data-review-compose-hint": true,
        text: "Escape cancels · Cmd/Ctrl+Enter adds",
      }),
      submitImmediately,
      el(
        "div",
        {
          class:
            "[display:flex] [justify-content:flex-end] [gap:0.4rem] [margin-top:0.5rem]",
          "data-review-compose-actions": true,
        },
        [composeCancel, composeSave],
      ),
    ],
  );

  const threadLayer = el("div", {
    class:
      "[position:absolute] [top:0] [right:0] [left:0] [height:0] [z-index:44] [pointer-events:none]",
    "data-review-thread-layer": true,
    "aria-label": "Comments beside the plan",
  });
  const markerLayer = el("div", {
    "data-review-marker-layer": true,
    "aria-label": "Comment anchors",
  });
  const live = el("p", {
    class:
      "[position:absolute] [width:1px] [height:1px] [margin:-1px] [padding:0] [overflow:hidden] [clip-path:inset(50%)] [white-space:nowrap]",
    "data-review-live": true,
    "aria-live": "polite",
  });
  const toast = el("div", {
    class:
      "fixed bottom-4 left-1/2 z-[70] hidden -translate-x-1/2 items-center gap-3 rounded-md border border-edge bg-[var(--ink-c)] px-3 py-2 text-xs font-semibold text-[var(--bg)] shadow-lg",
    "data-review-toast": true,
    role: "status",
  });
  const backdrop = el("button", {
    class:
      "[position:fixed] [inset:2.75rem_0_0] [z-index:43] [border:0] [background:rgb(0_0_0_/_0.28)] [cursor:pointer]",
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
    class:
      "[border-color:var(--diff-remove-c)]! [background:var(--diff-remove-c)]! [color:var(--bg)]!",
    type: "button",
    "data-review-delete-confirm": true,
    text: "Delete",
  });
  const deleteDialog = el(
    "dialog",
    {
      class:
        "[position:fixed] [width:min(26rem,_calc(100vw_-_2rem))] [margin:auto] [padding:0] [border:1px_solid_var(--edge-c)] [border-radius:0.65rem] [background:var(--bg)] [color:var(--ink-c)] [box-shadow:0_18px_48px_rgb(0_0_0_/_0.24)]",
      "data-review-delete-dialog": true,
      "aria-labelledby": "big-plan-review-delete-title",
      "aria-describedby": "big-plan-review-delete-description",
    },
    [
      el(
        "div",
        { class: "[padding:1.1rem]", "data-review-delete-content": true },
        [
          deleteTitle,
          deleteDescription,
          el(
            "div",
            {
              class:
                "[display:flex] [justify-content:flex-end] [gap:0.5rem] [margin-top:1rem]",
              "data-review-delete-actions": true,
            },
            [deleteCancel, deleteConfirm],
          ),
        ],
      ),
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
    class:
      "[border-color:var(--diff-remove-c)]! [color:var(--diff-remove-c)]! [font-weight:650]",
    type: "button",
    "data-review-revert-confirm": true,
    text: "Revert changes",
  });
  const revertDialog = el(
    "dialog",
    {
      class:
        "[position:fixed] [width:min(26rem,_calc(100vw_-_2rem))] [margin:auto] [padding:0] [border:1px_solid_var(--edge-c)] [border-radius:0.65rem] [background:var(--bg)] [color:var(--ink-c)] [box-shadow:0_18px_48px_rgb(0_0_0_/_0.24)]",
      "data-review-revert-dialog": true,
      "aria-labelledby": "big-plan-review-revert-title",
      "aria-describedby": "big-plan-review-revert-description",
    },
    [
      el(
        "div",
        { class: "[padding:1.1rem]", "data-review-delete-content": true },
        [
          revertTitle,
          revertDescription,
          el(
            "div",
            {
              class:
                "[display:flex] [justify-content:flex-end] [gap:0.5rem] [margin-top:1rem]",
              "data-review-delete-actions": true,
            },
            [revertCancel, revertConfirm],
          ),
        ],
      ),
    ],
  );

  const surface = el(
    "div",
    { class: "[position:static] [z-index:40]", "data-review-root": true },
    [
      backdrop,
      toolbar,
      rail,
      affordance,
      threadLayer,
      compose,
      markerLayer,
      deleteDialog,
      revertDialog,
      toast,
      live,
    ],
  );
  document.body.appendChild(surface);
  // Tailwind's delivery optimizer does not yet parse the standardized
  // ::highlight() pseudo-element, so these named-highlight rules live with the browser
  // behavior that creates their named Highlight ranges.
  document.head.appendChild(
    el("style", {
      text:
        "::highlight(big-plan-review-comments){" +
        "background-color:color-mix(in srgb,var(--annotation-bg) 55%,transparent);" +
        "text-decoration:underline;" +
        "text-decoration-color:var(--annotation-c);" +
        "text-decoration-thickness:2px;" +
        "text-underline-offset:.16em}" +
        "::highlight(big-plan-review-focus){" +
        "background-color:color-mix(in srgb,var(--annotation-c) 12%,transparent);" +
        "text-decoration:underline;" +
        "text-decoration-color:var(--annotation-c);" +
        "text-decoration-thickness:2px;" +
        "text-underline-offset:.16em}" +
        "::highlight(big-plan-review-active){" +
        "background-color:var(--annotation-bg)}",
    }),
  );

  const announce = (message) => {
    live.textContent = message;
  };

  const showToast = ({ message, actionLabel, action }) => {
    const actionButton = el("button", {
      type: "button",
      class:
        "cursor-pointer rounded-sm underline underline-offset-2 hover:opacity-80 active:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bg)]",
      "data-review-toast-action": true,
      text: actionLabel,
    });
    actionButton.addEventListener("click", () => {
      toast.classList.add("hidden");
      toast.classList.remove("flex");
      void action();
    });
    toast.replaceChildren(
      el("span", { "data-review-toast-message": true, text: message }),
      actionButton,
    );
    toast.classList.remove("hidden");
    toast.classList.add("flex");
  };

  // -------------------------------------------------------------- tray render

  const setRailOpen = (open) => {
    if (open === !rail.hidden) {
      return;
    }
    const readingPosition = window.scrollY;
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
      window.scrollTo(0, readingPosition);
      if (!compose.hidden && composeTarget) positionCompose(composeTarget);
      positionThreadCards();
    });
  };

  const railIsOpen = () => !rail.hidden;

  const relativeSignal = (at) => relativeSignalLabel({ now: Date.now(), at });

  const selectionTouches = (node) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }
    return (
      (selection.anchorNode && node.contains(selection.anchorNode)) ||
      (selection.focusNode && node.contains(selection.focusNode)) ||
      selection.containsNode(node, true)
    );
  };

  const setLiveText = (node, text) => {
    if (node.textContent === text || selectionTouches(node)) return;
    node.textContent = text;
  };

  const refreshConnectionTimes = () => {
    for (const node of connectionPanel?.querySelectorAll(
      "[data-review-agent-heartbeat]",
    ) || []) {
      node.setAttribute("data-review-relative-at", String(agentHeartbeatAt));
    }
    for (const node of connectionPanel?.querySelectorAll(
      "[data-review-relative-at]",
    ) || []) {
      const at = Number(node.getAttribute("data-review-relative-at"));
      setLiveText(node, relativeSignal(at));
    }
    for (const node of connectionPanel?.querySelectorAll(
      "[data-review-duration-start]",
    ) || []) {
      const start = Number(node.getAttribute("data-review-duration-start"));
      const endAttribute = node.getAttribute("data-review-duration-end");
      const end = endAttribute === null ? Date.now() : Number(endAttribute);
      const duration = compactDurationLabel({ start, end });
      if (duration === null) continue;
      const prefix = node.getAttribute("data-review-duration-prefix") || "";
      const suffix = node.getAttribute("data-review-duration-suffix") || "";
      setLiveText(node, prefix + duration + suffix);
    }
  };

  const copyBlock = ({ attribute, text }) => {
    const button = el("button", {
      class:
        "[position:absolute] [top:0.38rem] [right:0.38rem] [display:inline-flex] [align-items:center] [gap:0.25rem] [padding:0.2rem_0.35rem] [border:1px_solid_var(--edge-c)] [border-radius:0.3rem] [background:var(--surface-c)] [color:var(--muted-c)] [font-size:0.625rem] [line-height:1] [cursor:pointer] hover:[background:var(--review-control-hover)] hover:[color:var(--ink-c)] active:[background:var(--review-control-active)]",
      type: "button",
      "data-review-copy": attribute,
      "aria-label": "Copy to clipboard",
    });
    button.append(icon(COPY_ICON), el("span", { text: "Copy" }));
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        button.replaceChildren(
          icon(CHECK_ICON),
          el("span", { text: "Copied" }),
        );
        button.setAttribute("aria-label", "Copied to clipboard");
        setTimeout(() => {
          button.replaceChildren(icon(COPY_ICON), el("span", { text: "Copy" }));
          button.setAttribute("aria-label", "Copy to clipboard");
        }, 1_500);
      } catch (error) {
        const message = "Couldn’t copy: " + describeError(error);
        announce(message);
        button.setAttribute("aria-label", message);
      }
    });
    return el(
      "div",
      {
        class: "[position:relative] [min-width:0]",
        "data-review-copy-block": attribute,
      },
      [el("pre", { [attribute]: true }, [el("code", { text })]), button],
    );
  };

  const connectionLogView = ({ historyWasOpen }) => {
    const events = agentConnectionLog
      .map((entry) => ({ ...entry, atMs: Date.parse(entry.at) }))
      .filter((entry) => Number.isFinite(entry.atMs))
      .sort((left, right) => left.atMs - right.atMs);
    const latest = events.at(-1);
    let disconnects = 0;
    let reconnects = 0;
    let hasConnected = false;
    events.forEach((entry, index) => {
      if (!entry.connected && events[index - 1]?.connected) disconnects += 1;
      if (
        entry.connected &&
        hasConnected &&
        events[index - 1]?.connected === false
      ) {
        reconnects += 1;
      }
      if (entry.connected) hasConnected = true;
    });
    const title = el("span", { text: "Connection log" });
    const count = el("span", {
      class:
        "[padding:0.08rem_0.32rem] [border:1px_solid_var(--edge-c)] [border-radius:999px] [color:var(--muted-c)] [font-size:0.5625rem] [font-weight:700] [letter-spacing:0.04em] [line-height:1.2] [text-transform:uppercase]",
      "data-review-connection-count": true,
      text: String(events.length),
      "aria-label": events.length + " event" + (events.length === 1 ? "" : "s"),
    });
    const details = el(
      "details",
      {
        class:
          "[margin-top:0.9rem] [color:var(--muted-c)] [font-size:0.75rem] [font-variant-numeric:tabular-nums]",
        "data-review-connection-history": true,
        ...(historyWasOpen ? { open: true } : {}),
      },
      [el("summary", {}, [title, count])],
    );
    if (events.length === 0) {
      details.appendChild(
        el("p", { text: "No connection events recorded yet." }),
      );
      return details;
    }

    const latestAt = latest?.atMs || Date.now();
    const lastSignalAt = agentHeartbeatAt > 0 ? agentHeartbeatAt : latestAt;
    const summary = el(
      "dl",
      {
        class:
          "[display:grid] [grid-template-columns:repeat(2,_minmax(0,_1fr))] [gap:0.55rem_0.8rem] [margin:0.65rem_0_0.8rem] [padding:0.65rem_0] [border-block:1px_solid_var(--edge-c)]",
        "data-review-connection-summary": true,
      },
      [
        el("div", {}, [
          el("dt", { text: "State" }),
          el("dd", {
            "data-state": agentConnected ? "connected" : "disconnected",
            text: agentConnected ? "CONNECTED" : "DISCONNECTED",
          }),
        ]),
        el("div", {}, [
          el("dt", { text: "Since" }),
          el("dd", {}, [
            el("time", {
              datetime: latest?.at,
              text: new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              }).format(new Date(latestAt)),
            }),
          ]),
        ]),
        el("div", {}, [
          el("dt", { text: "Last signal" }),
          el("dd", {
            "data-review-agent-heartbeat": true,
            "data-review-relative-at": lastSignalAt,
            text: relativeSignal(lastSignalAt),
          }),
        ]),
        el("div", {}, [
          el("dt", { text: "Events" }),
          el("dd", {
            text: disconnects + " disconnects · " + reconnects + " reconnects",
          }),
        ]),
      ],
    );
    details.appendChild(summary);

    const groups = new Map();
    for (const [reverseIndex, entry] of [...events].reverse().entries()) {
      const index = events.length - reverseIndex - 1;
      const date = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
      }).format(new Date(entry.atMs));
      if (!groups.has(date)) groups.set(date, []);
      const next = events[index + 1];
      const durationEnd = next?.atMs;
      const reconnectsKnownSession = events
        .slice(0, index)
        .some((previous) => previous.connected);
      const durationPrefix = entry.connected
        ? "Connected for "
        : next?.connected
          ? reconnectsKnownSession
            ? "Reconnected after "
            : "Connected after "
          : "Offline for ";
      const durationSuffix =
        !entry.connected && next?.connected ? " offline" : "";
      const durationLabel =
        compactDurationLabel({
          start: entry.atMs,
          end: durationEnd ?? Date.now(),
        }) ?? "duration unavailable";
      groups.get(date).push(
        el(
          "li",
          {
            class:
              "[position:relative] [display:grid] [grid-template-columns:0.65rem_4.6rem_minmax(0,_1fr)_auto] [gap:0.22rem_0.4rem] [align-items:baseline] [min-width:0] [padding:0.28rem_0]",
            "data-review-connection-event": entry.connected
              ? "connected"
              : "disconnected",
            ...(reverseIndex === 0
              ? { "data-review-connection-current": true }
              : {}),
          },
          [
            el("span", {
              class:
                "[position:relative] [width:6px] [height:6px] [align-self:center] [border:1px_solid_var(--muted-c)] [border-radius:999px] [background:var(--bg)]",
              "data-review-connection-marker": true,
              "aria-hidden": "true",
            }),
            el("time", {
              datetime: entry.at,
              text: new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              }).format(new Date(entry.atMs)),
            }),
            el("strong", {
              text: entry.connected ? "Connected" : "Disconnected",
            }),
            ...(reverseIndex === 0
              ? [
                  el("span", {
                    class:
                      "[padding:0.08rem_0.32rem] [border:1px_solid_var(--edge-c)] [border-radius:999px] [color:var(--muted-c)] [font-size:0.5625rem] [font-weight:700] [letter-spacing:0.04em] [line-height:1.2] [text-transform:uppercase]",
                    "data-review-current": true,
                    text: "Current",
                  }),
                ]
              : []),
            el("span", {
              class:
                "[grid-column:3_/_-1] [color:var(--muted-c)] [font-size:0.625rem]",
              "data-review-connection-duration": true,
              "data-review-duration-start": entry.atMs,
              ...(durationEnd === undefined
                ? {}
                : { "data-review-duration-end": durationEnd }),
              "data-review-duration-prefix": durationPrefix,
              "data-review-duration-suffix": durationSuffix,
              text: durationPrefix + durationLabel + durationSuffix,
            }),
            ...(entry.reason
              ? [
                  el("span", {
                    class:
                      "[grid-column:3_/_-1] [color:var(--muted-c)] [font-size:0.625rem] [color:var(--callout-warning-c)]",
                    "data-review-connection-reason": true,
                    text: entry.reason,
                  }),
                ]
              : []),
          ],
        ),
      );
    }
    for (const [date, rows] of groups) {
      details.append(
        el("section", { "data-review-connection-day": true }, [
          el("h3", { text: date }),
          el("ol", {}, rows),
        ]),
      );
    }
    return details;
  };

  const renderConnectionPanel = () => {
    if (!connectionPanel) return;
    const signature = JSON.stringify({
      connected: agentConnected,
      runtimeOffline,
      state: agentSessionState,
      log: agentConnectionLog,
      plan: agentPlanPath,
      command: agentCommand,
      recoveryPrompt: agentRecoveryPrompt,
    });
    if (signature === connectionPanelSignature) {
      refreshConnectionTimes();
      return;
    }
    connectionPanelSignature = signature;
    const historyWasOpen =
      connectionPanel.querySelector("[data-review-connection-history]")
        ?.open === true;
    const state = el("section", {
      class:
        "[display:grid] [gap:0.55rem] [padding:0.8rem] [border:1px_solid_var(--edge-c)] [border-radius:0.45rem] [font-size:0.75rem] [line-height:1.5] data-[tone=danger]:[border-color:var(--callout-danger-c)] data-[tone=danger]:[background:var(--callout-danger-bg)] data-[tone=danger]:[color:var(--callout-danger-c)] data-[tone=connected]:[border-color:var(--diff-add-c)] data-[tone=connected]:[background:var(--diff-add-bg)] data-[tone=connected]:[color:var(--diff-add-c)]",
      "data-review-connection-state": agentConnected
        ? "connected"
        : runtimeOffline
          ? "offline"
          : "disconnected",
      "data-tone": agentConnected ? "connected" : "danger",
    });
    if (agentConnected) {
      state.append(
        el(
          "div",
          {
            class: "[display:flex] [align-items:center] [gap:0.45rem]",
            "data-review-connection-title": true,
          },
          [
            el("span", {
              class:
                "[width:6px] [height:6px] [border-radius:999px] [background:currentColor] [box-shadow:0_0_0_2px_color-mix(in_srgb,_var(--diff-add-c)_34%,_transparent)]",
              "data-review-connection-dot": true,
              "aria-hidden": "true",
            }),
            el("strong", { text: "Agent session active" }),
            el("span", {
              class:
                "[margin-left:auto] [font-size:0.6875rem] [font-weight:700] [text-transform:uppercase]",
              "data-review-connection-phase": true,
              text: agentSessionState === "working" ? "Working" : "Waiting",
            }),
          ],
        ),
        el("p", {}, [
          document.createTextNode("Last signal "),
          el("span", {
            "data-review-agent-heartbeat": true,
            "data-review-relative-at": agentHeartbeatAt,
            text: relativeSignal(agentHeartbeatAt),
          }),
        ]),
      );
    } else if (runtimeOffline) {
      state.append(
        el("strong", { text: "The review server is unreachable" }),
        appendInlineCode(
          el("p", {}),
          "Restart `big-plan review`, then open the new URL it prints. All comments are safe.",
        ),
      );
    } else {
      state.append(
        el("strong", { text: "No agent is connected to this review session." }),
        el("p", {
          text: "Your comments still save and queue here; nothing is sent until an agent reconnects.",
        }),
        el("p", {
          text: "To reconnect this running review, paste this exact prompt into your coding agent:",
        }),
        copyBlock({
          attribute: "data-review-recovery-prompt",
          text:
            agentRecoveryPrompt ||
            "Ask your coding agent to reconnect to this Big Plan review and keep its feedback loop running.",
        }),
        el("p", {
          text: "Or run this exact connector command yourself from the Big Plan repository:",
        }),
        copyBlock({
          attribute: "data-review-recovery-command",
          text:
            agentCommand ||
            "node bin/big-plan.mjs agent " + (agentPlanPath || "<plan.mdx>"),
        }),
      );
    }
    const history = connectionLogView({ historyWasOpen });
    connectionPanel.replaceChildren(state, history);
  };

  const setActiveTab = (tab) => {
    const active = tab === "agent" && !connectionTab ? "comments" : tab;
    const commentsActive = active === "comments";
    const chatActive = active === "chat";
    commentsTab.setAttribute(
      "aria-selected",
      commentsActive ? "true" : "false",
    );
    chatTab.setAttribute("aria-selected", chatActive ? "true" : "false");
    connectionTab?.setAttribute(
      "aria-selected",
      active === "agent" ? "true" : "false",
    );
    commentsPanel.hidden = !commentsActive;
    chatPanel.hidden = !chatActive;
    if (connectionPanel) connectionPanel.hidden = active !== "agent";
    if (active === "agent") renderConnectionPanel();
  };

  commentsTab.addEventListener("click", () => setActiveTab("comments"));
  chatTab.addEventListener("click", () => setActiveTab("chat"));
  connectionTab?.addEventListener("click", () => setActiveTab("agent"));
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
        rect.bottom >= REVIEW_CONTROL_TOP &&
        rect.top <= window.innerHeight;
      marker.hidden = !visible;
      if (!visible) continue;
      marker.style.top = Math.max(REVIEW_CONTROL_TOP, rect.top) + "px";
      marker.style.left =
        Math.max(4, rect.left - marker.offsetWidth - 8) + "px";
    }
  };

  const markerFor = (block) => {
    const existing = markerByBlock.get(block);
    if (existing) return existing;
    const marker = el("button", {
      class:
        "[position:fixed] [z-index:42] [display:inline-flex] [min-width:1.65rem] [height:1.65rem] [align-items:center] [justify-content:center] [gap:0.28rem] [padding:0_0.48rem] [border:1px_solid_var(--edge-c)] [border-radius:999px] [background:var(--bg)] [color:var(--accent-c)] [cursor:pointer] [box-shadow:0_2px_8px_rgb(0_0_0_/_0.08)] hover:[background:var(--review-control-hover)] hover:[border-color:var(--accent-c)] active:[background:var(--review-control-active)]",
      type: "button",
      "data-review-marker": true,
    });
    marker.append(
      icon(MESSAGE_SQUARE_TEXT_ICON),
      el("span", {
        class: "[font-size:0.625rem] [font-weight:700] [white-space:nowrap]",
        "data-review-marker-label": true,
      }),
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

  const visualAnchorForTarget = (target) => {
    const block = blockForTarget(target);
    if (target?.type !== "slide") return block;
    return block?.closest("[data-slide]")?.querySelector("[data-slide-kicker]");
  };

  const slideForTarget = (target) =>
    target?.type === "slide"
      ? blockForTarget(target)?.closest("[data-slide]") || null
      : null;

  const pointInside = ({ x, y, rect }) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

  // CSS highlights do not create clickable DOM. Resolve a document click back
  // through the same anchor model that painted the highlight, including a
  // precise range hit for text selections and the kicker for whole slides.
  const commentAtDocumentPoint = ({ target, x, y }) => {
    if (!(target instanceof Element)) return null;
    if (target.closest("[data-review-root]")) return null;
    for (const comment of drafts.concat(sent)) {
      if (resolvedCommentIds.has(comment.id)) continue;
      if (
        comment.target.type === "slide" &&
        slideForTarget(comment.target)?.contains(target)
      ) {
        return comment;
      }
      const anchor = anchorStateFor(comment);
      if (
        anchor.kind === "range" &&
        Array.from(anchor.range.getClientRects()).some((rect) =>
          pointInside({ x, y, rect }),
        )
      ) {
        return comment;
      }
      if (
        anchor.kind !== "range" &&
        anchor.block &&
        anchor.block.contains(target) &&
        anchor.block.hasAttribute("data-review-comment-highlight")
      ) {
        return comment;
      }
    }
    return null;
  };

  const syncCommentEmphasis = () => {
    for (const node of document.querySelectorAll(
      "[data-review-comment-emphasized]",
    )) {
      node.removeAttribute("data-review-comment-emphasized");
    }
    if (emphasizedCommentId === null) return;
    for (const node of document.querySelectorAll(
      '[data-review-comment-id="' + cssEscape(emphasizedCommentId) + '"]',
    )) {
      node.setAttribute("data-review-comment-emphasized", "");
    }
  };

  const setEmphasizedComment = (commentId) => {
    if (commentId === emphasizedCommentId) return;
    emphasizedCommentId = commentId;
    paintTargetHighlights();
    syncCommentEmphasis();
  };

  // The document-to-tray half of comment navigation changes only the tray's
  // scroll container; the reader's document position remains untouched.
  const revealCommentInTray = (comment) => {
    const documentTop = window.scrollY;
    setActiveTab("comments");
    setRailOpen(true);
    renderTray();
    requestAnimationFrame(() => {
      window.scrollTo({ top: documentTop, behavior: "auto" });
      const row = rail.querySelector(
        '[data-review-comment-id="' + cssEscape(comment.id) + '"]',
      );
      const scroller = rail.querySelector("[data-review-scroll]");
      if (!row || !scroller) return;
      for (const previous of rail.querySelectorAll(
        "[data-review-tray-target]",
      )) {
        previous.removeAttribute("data-review-tray-target");
      }
      row.setAttribute("data-review-tray-target", "");
      const rowRect = row.getBoundingClientRect();
      const scrollRect = scroller.getBoundingClientRect();
      const centered =
        scroller.scrollTop +
        rowRect.top -
        scrollRect.top -
        (scroller.clientHeight - rowRect.height) / 2;
      scroller.scrollTo({ top: Math.max(0, centered), behavior: "smooth" });
      setTimeout(() => row.removeAttribute("data-review-tray-target"), 1400);
      announce("Comment shown in Feedback.");
      requestAnimationFrame(() => {
        window.scrollTo({ top: documentTop, behavior: "auto" });
      });
    });
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

  /** Reads a Range through raw text nodes so list layout newlines add no drift. */
  const rangeText = (range) => range.cloneContents().textContent || "";

  /** Maps a DOM boundary to the same raw-text coordinate system as textBoundary. */
  const textOffsetForBoundary = ({ block, container, offset }) => {
    const prefix = document.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(container, offset);
    return rangeText(prefix).length;
  };

  const rangeForTarget = (target) => {
    const block = blockForTarget(target);
    if (!block) return null;
    if (target.type === "selection") {
      const endBlock = target.endBlockId
        ? document.querySelector(
            '[data-block-id="' + cssEscape(target.endBlockId) + '"]',
          )
        : block;
      if (!endBlock) return null;
      const start = textBoundary(block, target.start);
      const end = textBoundary(endBlock, target.end);
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
    if (
      direct &&
      (rangeText(direct) === target.quote ||
        (target.endBlockId && rangeText(direct).startsWith(target.quote)))
    ) {
      return { kind: "range", range: direct, block: original };
    }
    const candidates = [];
    if (original) candidates.push(original);
    for (const block of scopeBlocksFor(target.blockId)) {
      if (!candidates.includes(block)) candidates.push(block);
    }
    for (const block of candidates) {
      const range = quoteRangeInBlock(block, target.quote, target.start);
      if (range) return { kind: "range", range, block };
    }
    const successor = original || scopeBlocksFor(target.blockId)[0] || null;
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
      block.removeAttribute("data-review-comment-focus");
      block.removeAttribute("data-review-anchor-changed");
    }
    for (const slide of document.querySelectorAll("[data-slide]")) {
      slide.removeAttribute("data-review-slide-highlight");
      slide.removeAttribute("data-review-slide-focus");
    }
    const commentRanges = [];
    const focusRanges = [];
    const lensBlocks = diffLens?.hiddenBlocks ?? [];
    for (const comment of drafts.concat(sent)) {
      if (resolvedCommentIds.has(comment.id)) continue;
      const anchor = anchorStateFor(comment);
      const visualAnchor =
        comment.target.type === "slide"
          ? visualAnchorForTarget(comment.target)
          : null;
      if (visualAnchor && !lensBlocks.includes(anchor.block)) {
        slideForTarget(comment.target)?.setAttribute(
          "data-review-slide-highlight",
          "comment",
        );
        if (comment.id === emphasizedCommentId) {
          slideForTarget(comment.target)?.setAttribute(
            "data-review-slide-focus",
            "",
          );
        }
        continue;
      }
      if (anchor.kind === "range" && !lensBlocks.includes(anchor.block)) {
        commentRanges.push(anchor.range);
        if (comment.id === emphasizedCommentId) focusRanges.push(anchor.range);
      } else if (anchor.block && !lensBlocks.includes(anchor.block)) {
        anchor.block.setAttribute("data-review-comment-highlight", "");
        if (comment.id === emphasizedCommentId) {
          anchor.block.setAttribute("data-review-comment-focus", "");
        }
        if (anchor.kind === "changed") {
          anchor.block.setAttribute("data-review-anchor-changed", "");
        }
      }
    }
    const activeTarget = composeTarget || pendingSelection;
    const activeRange = activeTarget ? rangeForTarget(activeTarget) : null;
    if (activeTarget && !activeRange) {
      if (activeTarget.type === "slide") {
        slideForTarget(activeTarget)?.setAttribute(
          "data-review-slide-highlight",
          "active",
        );
      } else {
        visualAnchorForTarget(activeTarget)?.setAttribute(
          "data-review-active-highlight",
          "",
        );
      }
    }
    root.setAttribute(
      "data-review-selection-highlight-count",
      String(commentRanges.length),
    );
    root.setAttribute(
      "data-review-active-selection-highlight",
      activeRange === null ? "false" : "true",
    );
    root.setAttribute(
      "data-review-focus-highlight-count",
      String(focusRanges.length),
    );
    setNamedHighlight("big-plan-review-comments", commentRanges);
    setNamedHighlight("big-plan-review-focus", focusRanges);
    setNamedHighlight(
      "big-plan-review-active",
      activeRange === null ? [] : [activeRange],
    );
  };

  const relativeCommentTime = (createdAt) => {
    return commentTimeLabel({
      now: Date.now(),
      at: Date.parse(createdAt),
      absoluteLabel: (at) =>
        new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(at)),
    });
  };

  const OUTCOME_LABELS = {
    changed: "Changed",
    question: "Needs your answer",
    outside: "Outside this plan",
    waiting: "Waiting",
    cancelled: "Cancelled",
  };

  const spinner = () =>
    el("span", {
      class:
        "animate-spin motion-reduce:[animation-duration:1.8s] [animation-duration:700ms] [display:inline-block] [width:0.72rem] [height:0.72rem] [flex:0_0_auto] [border:1.5px_solid_currentcolor] [border-right-color:transparent] [border-radius:999px]",
      "data-review-spinner": true,
      "aria-hidden": "true",
    });

  const outcomeBadge = (outcome, options = {}) => {
    const state = outcome.status?.stage || outcome.key;
    const badge = el("span", {
      class:
        "[display:inline-flex] [align-items:center] [gap:0.22rem] [font-size:0.625rem] [font-weight:750] [letter-spacing:0.06em] [text-transform:uppercase]",
      "data-review-outcome-state": state,
      ...(options.iconOnly === true ? { "aria-label": outcome.label } : {}),
    });
    if (options.spin === true) badge.appendChild(spinner());
    if (options.waitingBusy === true) {
      badge.setAttribute("data-waiting-busy", "");
    }
    if (state === "waiting") badge.appendChild(icon(HOURGLASS_ICON));
    if (state === "blocked") badge.appendChild(icon(TRIANGLE_ALERT_ICON));
    if (options.iconOnly !== true) {
      badge.appendChild(document.createTextNode(outcome.label));
    }
    return badge;
  };

  const isAgentWorkEvent = (event) =>
    (event.state === "live" || event.state === "waiting") &&
    !/^(reply sent to agent|plan question sent to agent)$/i.test(event.step);

  const currentActivityEvents = (requestId) => {
    const deduped = [];
    for (const event of progressEvents) {
      if (
        !isAgentWorkEvent(event) ||
        /feedback package received/i.test(event.step) ||
        (requestId && event.requestId !== requestId)
      ) {
        continue;
      }
      const previous = deduped[deduped.length - 1];
      if (
        previous &&
        previous.step.toLocaleLowerCase() === event.step.toLocaleLowerCase()
      ) {
        continue;
      }
      deduped.push(event);
    }
    return deduped.slice(-8);
  };

  // ------------------------------------------------------------ agent health

  // A pending request is never allowed to look fine silently. The document
  // derives the agent's condition from what it can actually observe - the
  // runtime answering, work being picked up, progress still advancing - and
  // names the failure honestly when any of those stop.
  const pendingRequestList = () => {
    const answered = new Set(
      agentResponses.map((response) => response.requestId),
    );
    const cancelled = new Set(agentCancelledIds);
    return agentRequests.filter(
      (request) =>
        !answered.has(request.requestId) && !cancelled.has(request.requestId),
    );
  };

  const observeRequests = () => {
    const pending = pendingRequestList();
    const ids = new Set(pending.map((request) => request.requestId));
    for (const request of pending) {
      if (!requestSeenAt.has(request.requestId)) {
        requestSeenAt.set(request.requestId, {
          at: Date.now(),
          seqAtSeen: progressSeq,
          liveSeqAtSeen: liveProgressSeq,
        });
      }
    }
    for (const id of Array.from(requestSeenAt.keys())) {
      if (!ids.has(id)) requestSeenAt.delete(id);
    }
  };

  const requestPickedUp = (request) => {
    const seen = requestSeenAt.get(request.requestId);
    const attributed = progressEvents.some(
      (event) =>
        isAgentWorkEvent(event) && event.requestId === request.requestId,
    );
    const legacy =
      seen !== undefined &&
      progressEvents.some(
        (event) =>
          isAgentWorkEvent(event) &&
          typeof event.requestId !== "string" &&
          event.seq > seen.liveSeqAtSeen,
      );
    return attributed || legacy;
  };

  const sessionShowsLife = (now = Date.now()) =>
    agentConnected ||
    now - Math.max(lastProgressAdvanceAt, agentHeartbeatAt) <= AGENT_QUIET_MS;

  const failedEventFor = (request) => {
    const seen = requestSeenAt.get(request.requestId);
    return progressEvents
      .filter(
        (event) =>
          event.state === "failed" &&
          (event.requestId === request.requestId ||
            (typeof event.requestId !== "string" &&
              seen !== undefined &&
              event.seq > seen.seqAtSeen)),
      )
      .at(-1);
  };

  const agentHealth = () => {
    if (!hasRuntime) return null;
    if (runtimeOffline) {
      return {
        key: "offline",
        headline: "The review server is unreachable",
        hint: "Restart `big-plan review` in its terminal, then open the new URL it prints. All comments are safe.",
      };
    }
    observeRequests();
    const pending = pendingRequestList();
    if (pending.length === 0) return null;
    const failed = pending.map(failedEventFor).filter(Boolean).at(-1);
    if (failed) {
      return {
        key: "errored",
        headline: "The agent reported a problem",
        hint:
          failed.step +
          (failed.detail ? " - " + failed.detail : "") +
          ". Reply again or restart `big-plan agent`.",
      };
    }
    const now = Date.now();
    const pickedUp = pending.filter(requestPickedUp);
    if (pickedUp.length === 0) {
      if (agentConnected) return { key: "working" };
      return {
        key: "unavailable",
        headline: "No agent connected",
        hint: "This request is queued until an agent connects.",
      };
    }
    const seen = pickedUp
      .map((request) => requestSeenAt.get(request.requestId))
      .filter(Boolean);
    const oldestAt =
      seen.length > 0 ? Math.min(...seen.map((entry) => entry.at)) : now;
    const quietFor = sessionQuietMs({
      now,
      lastProgressAdvanceAt,
      heartbeatAt: agentHeartbeatAt,
      seenAt: oldestAt,
    });
    if (quietFor > AGENT_QUIET_MS) {
      const minutes = Math.max(1, Math.round(quietFor / 60_000));
      return {
        key: "quiet",
        headline: "No progress for " + minutes + "m",
        hint: "Check the agent terminal - it may be waiting for your approval, out of usage or rate-limited, or stopped. This thread updates by itself once the agent resumes.",
      };
    }
    return { key: "working" };
  };

  const pendingRequestForComment = (comment) => {
    const answered = new Set(
      agentResponses.map((response) => response.requestId),
    );
    const cancelled = new Set(agentCancelledIds);
    return agentRequests
      .filter((request) => {
        if (
          answered.has(request.requestId) ||
          cancelled.has(request.requestId)
        ) {
          return false;
        }
        if (request.kind === "reply") return request.commentId === comment.id;
        return (
          request.kind === "feedback" &&
          Array.isArray(request.comments) &&
          request.comments.some((entry) => entry.id === comment.id)
        );
      })
      .at(-1);
  };

  const requestBelongsToComment = ({ request, comment }) =>
    request.kind === "reply"
      ? request.commentId === comment.id
      : request.kind === "feedback" &&
        Array.isArray(request.comments) &&
        request.comments.some((entry) => entry.id === comment.id);

  const latestRequestForComment = (comment) =>
    agentRequests
      .filter((request) => requestBelongsToComment({ request, comment }))
      .at(-1);

  const pendingStatusFor = (request, surfaceName) => {
    observeRequests();
    const seen = requestSeenAt.get(request.requestId);
    const pickedUp = requestPickedUp(request);
    const sessionBusy =
      !pickedUp &&
      pendingRequestList().some(
        (candidate) =>
          candidate.requestId !== request.requestId &&
          requestPickedUp(candidate),
      ) &&
      sessionShowsLife();
    const failed = failedEventFor(request);
    return {
      ...deriveThreadStatus({
        phase: "pending",
        surface: surfaceName,
        runtimeOffline,
        agentConnected,
        pickedUp,
        sessionBusy,
        quietForMs: pickedUp
          ? sessionQuietMs({
              now: Date.now(),
              lastProgressAdvanceAt,
              heartbeatAt: agentHeartbeatAt,
              seenAt: seen?.at || Date.now(),
            })
          : 0,
        ...(failed
          ? {
              failedStep: failed.step,
              failedDetail: failed.detail || "",
            }
          : {}),
      }),
      requestId: request.requestId,
    };
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
        messageNodes: checkedMessageNodes(outcome.messageNodes),
        changes: outcome.changes || [],
        createdAt: response.createdAt,
        requestId: response.requestId,
        fromRevision:
          response.revisionPair?.fromRevision || request?.sourceRevision || "",
        toRevision:
          response.revisionPair?.toRevision || response.sourceRevision || "",
      });
    }
    return events;
  };

  const outcomeFor = (comment) => {
    const events = outcomeEventsFor(comment);
    const pending = pendingRequestForComment(comment);
    if (pending) {
      const status = pendingStatusFor(pending, "thread");
      return {
        key: "waiting",
        label: status.badge,
        status,
      };
    }
    const latestRequest = latestRequestForComment(comment);
    if (
      latestRequest &&
      agentCancelledIds.includes(latestRequest.requestId) &&
      !agentResponses.some(
        (response) => response.requestId === latestRequest.requestId,
      )
    ) {
      return {
        key: "cancelled",
        label: OUTCOME_LABELS.cancelled,
      };
    }
    return (
      events[events.length - 1] || {
        key: "waiting",
        label: OUTCOME_LABELS.waiting,
        status: deriveThreadStatus({
          phase: "pending",
          surface: "thread",
          agentConnected,
        }),
      }
    );
  };

  const appendInlineCode = (node, text) => {
    const pieces = String(text).split("`");
    pieces.forEach((piece, index) => {
      if (piece === "") return;
      node.appendChild(
        index % 2 === 1
          ? el("code", { text: piece })
          : document.createTextNode(piece),
      );
    });
    return node;
  };

  const statusIcon = (status) => {
    if (status.stage === "waiting") return icon(HOURGLASS_ICON);
    if (status.stage === "blocked" || status.stage === "stalled")
      return icon(TRIANGLE_ALERT_ICON);
    if (status.stage === "errored" || status.stage === "offline") {
      return icon(CIRCLE_X_ICON);
    }
    return null;
  };

  const setupInstructions = () =>
    el(
      "details",
      { class: "[margin-top:0.35rem]", "data-review-status-setup": true },
      [
        el("summary", { text: "Show setup instructions" }),
        appendInlineCode(
          el("p", {}),
          "Keep `big-plan review` running. In a second terminal, run `big-plan agent` and start the command it prints.",
        ),
        appendInlineCode(
          el("p", {}),
          "If the review server stopped, restart `big-plan review`, then open the new URL it prints. Your comments remain saved.",
        ),
      ],
    );

  const cancelAgentRequest = async ({ requestId, trigger }) => {
    trigger.disabled = true;
    try {
      await confirmRuntime();
      await call("/api/agent-requests/cancel", {
        method: "POST",
        body: { requestId },
      });
      if (!agentCancelledIds.includes(requestId)) {
        agentCancelledIds = agentCancelledIds.concat([requestId]);
      }
      clearInlineError(trigger);
      announce("Agent request cancelled.");
      renderTray();
      startProgress();
    } catch (error) {
      trigger.disabled = false;
      showInlineError(trigger, "Couldn’t cancel: " + describeError(error));
      announce(describeError(error));
    }
  };

  const threadStatusStrip = (status, options = {}) => {
    if (!status.headline) return null;
    const events =
      status.stage === "working" ? currentActivityEvents(status.requestId) : [];
    const row = el("div", {
      class: "[display:flex] [align-items:center] [gap:0.38rem]",
      "data-review-status-row": true,
    });
    if (status.showsSpinner) row.appendChild(spinner());
    else {
      const glyph = statusIcon(status);
      if (glyph) row.appendChild(glyph);
    }
    if (events.length > 0) {
      const activityButton = el("button", {
        class:
          "[display:inline-flex] [min-width:0] [flex:1_1_auto] [align-items:center] [justify-content:space-between] [gap:0.45rem] [padding:0.12rem_0.2rem] [border-radius:0.25rem] [color:currentcolor] [cursor:pointer] hover:[background:color-mix(in_srgb,_currentcolor_12%,_transparent)] focus-visible:[background:color-mix(in_srgb,_currentcolor_12%,_transparent)]",
        type: "button",
        "data-review-status-activity-toggle": true,
        "aria-expanded": showAgentActivity ? "true" : "false",
        "aria-label": showAgentActivity
          ? "Hide agent activity"
          : "Show agent activity",
        title: showAgentActivity ? "Hide activity" : "Show activity",
      });
      activityButton.append(
        el("strong", { text: status.headline }),
        icon(CHEVRON_RIGHT_ICON),
      );
      activityButton.addEventListener("click", () => {
        showAgentActivity = !showAgentActivity;
        renderTray();
      });
      row.appendChild(activityButton);
    } else {
      row.appendChild(el("strong", { text: status.headline }));
    }
    const strip = el("div", {
      class:
        "[display:grid] [gap:0.3rem] [margin:0.35rem_0] [padding:0.5rem_0.55rem] [border:1px_solid_var(--edge-c)] [border-left-width:3px] [border-radius:0.4rem] [background:color-mix(in_srgb,_var(--surface-c)_60%,_var(--bg))] [color:var(--muted-c)] [font-size:0.6875rem] [line-height:1.4] data-[tone=working]:[border-color:var(--callout-note-c)] data-[tone=working]:[background:var(--callout-note-bg)] data-[tone=working]:[color:var(--callout-note-c)] data-[tone=warning]:[border-color:var(--callout-warning-c)] data-[tone=warning]:[background:var(--callout-warning-bg)] data-[tone=warning]:[color:var(--callout-warning-c)] data-[tone=danger]:[border-color:var(--callout-danger-c)] data-[tone=danger]:[background:var(--callout-danger-bg)] data-[tone=danger]:[color:var(--callout-danger-c)]",
      "data-review-thread-status": status.stage,
      "data-tone": status.tone,
      ...(status.waitingBusy ? { "data-waiting-busy": true } : {}),
    });
    strip.appendChild(row);
    if (status.hint) {
      strip.appendChild(
        appendInlineCode(
          el("p", {
            class: "[margin:0] [color:var(--ink-c)] [overflow-wrap:anywhere]",
            "data-review-status-hint": true,
          }),
          status.hint,
        ),
      );
    }
    if (status.showsSetup) {
      strip.appendChild(setupInstructions());
    }
    if (events.length > 0 && showAgentActivity) {
      strip.appendChild(
        el(
          "ol",
          {
            class:
              (options.surface === "tray"
                ? "max-h-none! overflow-visible!"
                : "") +
              " [display:grid] [min-width:0] [max-width:100%] [max-height:9rem] [margin:0] [padding-left:0.2rem] [color:var(--ink-c)] [list-style:none] [overflow-x:hidden] [overflow-y:auto] [overscroll-behavior:contain] [line-height:1.35]",
            "data-review-status-activity": true,
            ...(options.surface === "card" && options.commentId
              ? { "data-review-activity-owner": options.commentId }
              : {}),
          },
          events.map((event) => {
            const item = el("li", {}, [
              el("span", {
                text: event.step + (event.detail ? " — " + event.detail : ""),
              }),
            ]);
            if (
              typeof event.at === "string" &&
              !Number.isNaN(Date.parse(event.at)) &&
              relativeCommentTime(event.at) !== "Just now"
            ) {
              item.appendChild(
                el("time", {
                  datetime: event.at,
                  text: relativeCommentTime(event.at),
                }),
              );
            }
            return item;
          }),
        ),
      );
    }
    if (
      status.requestId &&
      ["waiting", "blocked", "working", "stalled"].includes(status.stage)
    ) {
      const cancel = el("button", {
        type: "button",
        class:
          "-mx-1 cursor-pointer rounded-sm px-1 transition-colors hover:bg-[color-mix(in_srgb,currentColor_10%,transparent)] active:opacity-65 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-current [justify-self:end] [color:currentColor] [font-size:0.65rem] [text-decoration:underline] [text-underline-offset:0.16em]",
        "data-review-cancel-request": true,
        text: "Cancel request",
      });
      cancel.addEventListener("click", () => {
        void cancelAgentRequest({
          requestId: status.requestId,
          trigger: cancel,
        });
      });
      strip.appendChild(cancel);
    }
    return strip;
  };

  const outcomeCounts = () => {
    const counts = {
      changed: 0,
      question: 0,
      outside: 0,
      waiting: 0,
      cancelled: 0,
    };
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
    const changed = outcomeEventsFor(comment).some(
      (event) => event.key === "changed",
    );
    if (
      !changed ||
      anchor.kind !== "changed" ||
      comment.target.type !== "selection"
    ) {
      return null;
    }
    return el("p", {
      class:
        "[margin:0.45rem_0_0] [padding-left:0.55rem] [border-left:2px_solid_var(--annotation-c)] [color:var(--muted-c)] [font-size:0.72rem] [line-height:1.4]",
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
      class:
        "[margin:0.45rem_0_0] [padding-left:0.55rem] [border-left:2px_solid_var(--annotation-c)] [color:var(--muted-c)] [font-size:0.72rem] [line-height:1.4]",
      "data-review-draft-stale": true,
      text: "The text changed since you drafted this.",
    });
  };

  const stagedSubmitActions = ({ comment, surface }) => {
    const sendThis = el("button", {
      type: "button",
      class: "active:opacity-60",
      [`data-review-${surface}-submit`]: true,
      text: "Send this",
    });
    sendThis.addEventListener("click", () => {
      void submitComments({
        comments: [comment],
        closeRailAfter: false,
        trigger: sendThis,
      });
    });
    if (surface === "row" || drafts.length < 2) return [sendThis];
    const sendAll = el("button", {
      type: "button",
      class:
        "active:opacity-60 [border-color:transparent]! [background:transparent]! [color:var(--annotation-c)]! [font-weight:650] hover:[text-decoration:underline] hover:[text-underline-offset:0.15em] active:[opacity:0.65]",
      "data-review-thread-submit-all": true,
      text: `Send all ${drafts.length}`,
    });
    sendAll.addEventListener("click", () => {
      void submitComments({
        comments: drafts,
        closeRailAfter: false,
        trigger: sendAll,
      });
    });
    return [sendThis, sendAll];
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
    const rowAttributes = {
      class:
        "[margin-bottom:0.55rem] [padding:0.55rem_0.6rem] [border:1px_solid_var(--edge-c)] [border-radius:0.5rem] [background:var(--surface-c)]",
      "data-review-row": true,
      "data-review-comment-id": comment.id,
    };
    const jump = el("button", {
      class:
        "[display:flex] [min-width:0] [flex:1_1_auto] [align-items:center] [overflow:hidden] [color:var(--ink-c)] [font-size:0.6875rem] [font-weight:600] [letter-spacing:0.06em] [text-align:left] [text-overflow:ellipsis] [text-transform:uppercase] [white-space:nowrap]",
      type: "button",
      "data-review-row-target": true,
      text: slideTitleFor(comment.target),
      title: "Jump to this target",
    });
    jump.addEventListener("click", () => focusTarget(comment));
    if (submittingIds.has(comment.id)) {
      return el(
        "li",
        {
          class: "[opacity:0.85]",
          ...rowAttributes,
          "data-review-row-sending": true,
        },
        [
          el(
            "div",
            {
              class:
                "[display:flex] [min-width:0] [align-items:center] [gap:0.5rem] [margin-bottom:0.3rem]",
              "data-review-row-head": true,
            },
            [
              jump,
              outcomeBadge(
                { key: "waiting", label: "Sending" },
                { spin: true },
              ),
            ],
          ),
          el("p", {
            class:
              COMMENT_WRAP_CLASSES +
              " [margin:0] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [overflow-wrap:anywhere] [white-space:pre-wrap]",
            "data-review-row-body": true,
            text: comment.body,
          }),
        ],
      );
    }

    if (!isEditing) {
      const iconActions = el(
        "div",
        {
          class:
            "[display:flex] [flex:0_0_auto] [align-items:center] [gap:0.18rem]",
          "data-review-row-icons": true,
        },
        [
          toolbarButton({
            attribute: "data-review-row-edit",
            label: "Edit comment",
            glyph: PENCIL_ICON,
            action: () => {
              editingId = comment.id;
              renderTray();
            },
          }),
          toolbarButton({
            attribute: "data-review-row-delete",
            label: "Remove comment",
            glyph: TRASH_2_ICON,
            action: () => openDeleteDialog(comment),
          }),
        ],
      );
      return el("li", rowAttributes, [
        el(
          "div",
          {
            class:
              "[display:flex] [min-width:0] [align-items:center] [gap:0.5rem] [margin-bottom:0.3rem]",
            "data-review-row-head": true,
          },
          [jump, iconActions],
        ),
        el("p", {
          class:
            COMMENT_WRAP_CLASSES +
            " [margin:0] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [overflow-wrap:anywhere] [white-space:pre-wrap]",
          "data-review-row-body": true,
          text: comment.body,
        }),
        stagedAnchorNotice(comment),
        submitErrorNote(comment),
        el(
          "div",
          {
            class:
              "[display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:0.4rem] [margin-top:0.4rem]",
            "data-review-row-actions": true,
          },
          stagedSubmitActions({ comment, surface: "row" }),
        ),
      ]);
    }

    const field = el("textarea", {
      class:
        "[display:block] [width:100%] [padding:0.4rem_0.5rem] [border:1px_solid_var(--edge-c)] [border-radius:0.4rem] [background:var(--bg)] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [resize:vertical] focus-visible:[outline:1px_solid_var(--accent-c)] focus-visible:[outline-offset:2px]",
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
      class:
        "[color:var(--bg)]! [background:var(--accent-c)]! [border-color:var(--accent-c)]! [position:relative]",
      type: "button",
      "data-review-row-save": true,
      text: "Save",
    });
    attachShortcutTooltip(confirm, "Save comment");
    const commit = () => commitDraftEdit(comment, field);
    confirm.addEventListener("click", commit);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        editingId = null;
        renderTray();
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit();
    });
    const row = el("li", { ...rowAttributes, "data-review-editing": true }, [
      el(
        "div",
        {
          class:
            "[display:flex] [min-width:0] [align-items:center] [gap:0.5rem] [margin-bottom:0.3rem]",
          "data-review-row-head": true,
        },
        [jump],
      ),
      field,
      el(
        "div",
        {
          class:
            "[display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:0.4rem] [margin-top:0.4rem]",
          "data-review-row-actions": true,
        },
        [cancel, confirm],
      ),
    ]);
    if (railIsOpen()) setTimeout(() => field.focus(), 0);
    return row;
  };

  const openThreadAt = (comment) => {
    if (diffLens?.comment && diffLens.comment.id !== comment.id) {
      clearDiffLens();
    }
    expandedThreadIds.add(comment.id);
    editingId = null;
    renderTray();
    requestAnimationFrame(() => {
      focusTarget(comment, { keepRailOpen: railIsOpen() });
      positionThreadCards();
    });
  };

  const sendThreadReply = async (comment, field, button) => {
    const body = field.value.trim();
    if (body === "") return false;
    if (!hasRuntime) {
      announce("Start the local review runtime to reply to the agent.");
      return false;
    }
    button.disabled = true;
    try {
      await confirmRuntime();
      const answer = await call("/api/agent-requests", {
        method: "POST",
        body: { kind: "reply", commentId: comment.id, body },
      });
      agentConnected = answer.agentConnected === true;
      if (isAgentRequest(answer.request)) {
        agentRequests = agentRequests.concat([answer.request]);
      }
      field.value = "";
      clearInlineError(button);
      expandedThreadIds.add(comment.id);
      setAgentState("Agent working", "working");
      announce("Reply sent to the coding agent.");
      renderTray();
      startProgress();
      return true;
    } catch (error) {
      showInlineError(
        button,
        "Couldn’t send: " +
          describeError(error) +
          " Your reply text is preserved — try again.",
      );
      announce(describeError(error));
      button.disabled = false;
      return false;
    }
  };

  const checkedDiffLocations = (value) =>
    (Array.isArray(value) ? value : []).filter(
      (location) =>
        location &&
        typeof location === "object" &&
        (location.status === "changed" ||
          location.status === "added" ||
          location.status === "removed" ||
          location.status === "moved") &&
        typeof location.kind === "string" &&
        typeof location.label === "string" &&
        typeof location.section === "string" &&
        typeof location.oldText === "string" &&
        typeof location.newText === "string" &&
        (location.parentBlockId === undefined ||
          typeof location.parentBlockId === "string") &&
        Array.isArray(location.runs) &&
        location.runs.every(
          (run) =>
            run &&
            (run.op === "same" || run.op === "del" || run.op === "ins") &&
            typeof run.text === "string",
        ),
    );

  const checkedRevisionChangeSet = (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      value.version !== 1 ||
      typeof value.fromRevision !== "string" ||
      typeof value.toRevision !== "string" ||
      !Array.isArray(value.places)
    ) {
      return { version: 1, fromRevision: "", toRevision: "", places: [] };
    }
    return {
      version: 1,
      fromRevision: value.fromRevision,
      toRevision: value.toRevision,
      places: value.places.flatMap((place) => {
        if (
          !place ||
          typeof place !== "object" ||
          typeof place.placeId !== "string" ||
          typeof place.label !== "string" ||
          typeof place.section !== "string" ||
          typeof place.note !== "string"
        ) {
          return [];
        }
        const locations = checkedDiffLocations(place.locations);
        return locations.length === 0 ? [] : [{ ...place, locations }];
      }),
    };
  };

  const loadRevisionDiff = async (event) => {
    if (
      !hasRuntime ||
      event.key !== "changed" ||
      !event.fromRevision ||
      !event.toRevision
    ) {
      return { version: 1, fromRevision: "", toRevision: "", places: [] };
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
    const changeSet = checkedRevisionChangeSet(answer.changeSet);
    revisionDiffs.set(event.requestId, changeSet);
    return changeSet;
  };

  const placesForEvent = (event) =>
    (revisionDiffs.get(event.requestId)?.places || []).map((place) => ({
      ...place,
      slideTitle: slideTitleFor({
        type: "block",
        section: place.section,
        label: place.label,
      }),
    }));

  const diffStepper = el("div", {
    class:
      "[position:fixed] [z-index:22] [bottom:1rem] [left:50%] [display:flex] [align-items:center] [gap:0.2rem] [padding:0.28rem] [border:1px_solid_var(--edge-c)] [border-radius:999px] [background:var(--surface-c)] [box-shadow:0_0.7rem_1.8rem_rgb(0_0_0_/_18%)] [transform:translateX(-50%)]",
    "data-review-diff-stepper": true,
    hidden: true,
  });
  const diffPrevious = el("button", {
    type: "button",
    "data-review-diff-previous": true,
    "aria-label": "Previous change",
  });
  diffPrevious.appendChild(icon(CHEVRON_LEFT_ICON));
  const diffPosition = el("span", {
    class:
      "[max-width:min(42vw,_28rem)] [overflow:hidden] [padding:0_0.45rem] [color:var(--muted-c)] [font-size:0.68rem] [font-weight:700] [text-overflow:ellipsis] [white-space:nowrap]",
    "data-review-diff-position": true,
  });
  const diffNext = el("button", {
    type: "button",
    "data-review-diff-next": true,
    "aria-label": "Next change",
  });
  diffNext.appendChild(icon(CHEVRON_RIGHT_ICON));
  const diffExit = el("button", {
    type: "button",
    "data-review-diff-exit": true,
    text: "Show current text",
  });
  const diffHide = el("button", {
    type: "button",
    "data-review-diff-hide": true,
    text: "Hide changes",
  });
  diffStepper.append(diffPrevious, diffPosition, diffNext, diffExit, diffHide);
  document.body.appendChild(diffStepper);

  const clearDiffLens = () => {
    if (!diffLens) return;
    for (const block of diffLens.hiddenBlocks) {
      block.removeAttribute("hidden");
      block.removeAttribute("data-review-diff-hidden");
    }
    diffLens.container.remove();
    diffLens = null;
    diffStepper.hidden = true;
    renderTray();
  };

  const clearCommentLensIfOwned = (commentId) => {
    if (diffLens?.comment?.id === commentId) clearDiffLens();
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

  const renderRevisionContent = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "text") {
      return typeof node.value === "string"
        ? document.createTextNode(node.value)
        : null;
    }
    const tags = {
      paragraph: "p",
      strong: "strong",
      emphasis: "em",
      "inline-code": "code",
      code: "pre",
      quote: "blockquote",
      "list-item": "li",
      group: "div",
      list: node.ordered === true ? "ol" : "ul",
      table: "table",
      "table-row": "tr",
      "table-cell": node.header === true ? "th" : "td",
      link: "a",
    };
    const tag = tags[node.type];
    if (!tag) return null;
    const rendered = el(tag);
    if (
      node.type === "link" &&
      typeof node.href === "string" &&
      /^(?:https?:|#)/.test(node.href)
    ) {
      rendered.setAttribute("href", node.href);
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      const childNode = renderRevisionContent(child);
      if (childNode) rendered.appendChild(childNode);
    }
    return rendered;
  };

  const diffSide = ({ label, locations, side }) => {
    const snapshots = locations.flatMap((location) => {
      const content =
        side === "was" ? location.oldContent : location.newContent;
      const fallback = side === "was" ? location.oldText : location.newText;
      if (!content && !fallback) return [];
      const snapshot = el("div", {
        class:
          "data-[review-diff-op=del]:[background:var(--diff-remove-bg)] data-[review-diff-op=del]:[color:var(--diff-remove-c)] data-[review-diff-op=ins]:[background:var(--diff-add-bg)] data-[review-diff-op=ins]:[color:var(--diff-add-c)]",
        "data-review-diff-snapshot": true,
        "data-review-diff-kind": location.kind,
        "data-review-diff-op": side === "was" ? "del" : "ins",
      });
      const rendered = renderRevisionContent(content);
      if (rendered) snapshot.appendChild(rendered);
      else snapshot.appendChild(document.createTextNode(fallback));
      return [snapshot];
    });
    if (snapshots.length === 0) return null;
    return el(
      "section",
      {
        class:
          "[display:grid] [grid-template-columns:3rem_minmax(0,_1fr)] [gap:0.55rem] [padding:0.45rem_0.55rem] [overflow:hidden] data-[review-diff-side=was]:[background:var(--diff-remove-bg)] data-[review-diff-side=was]:[color:var(--diff-remove-c)] data-[review-diff-side=now]:[background:var(--diff-add-bg)] data-[review-diff-side=now]:[color:var(--diff-add-c)]",
        "data-review-diff-side": side,
      },
      [
        el("strong", {
          class: "[font-size:0.68rem] [text-transform:uppercase]",
          "data-review-diff-side-label": true,
          text: label,
        }),
        el(
          "div",
          {
            class:
              "[min-width:55%] [overflow:auto] [overscroll-behavior:contain]",
            "data-review-diff-side-content": true,
          },
          snapshots,
        ),
      ],
    );
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
      class:
        "[position:relative] [box-sizing:border-box] [width:100%] [margin:0_0_0.35rem] [padding:0.85rem_1rem_0.8rem] [border:1px_dashed_var(--annotation-c)] [border-radius:0.45rem] [background:var(--diff-content-bg)] [color:var(--text-c)] data-[review-diff-status=added]:[border-color:var(--diff-add-c)] data-[review-diff-status=added]:[background:var(--diff-add-bg)] data-[review-diff-status=removed]:[border-color:var(--diff-remove-c)] data-[review-diff-status=removed]:[background:var(--diff-remove-bg)]",
      "data-review-diff-lens": true,
      "data-review-diff-status":
        statuses.size === 1 ? place.locations[0]?.status : "changed",
      "data-review-diff-kind":
        place.locations.length === 1 ? place.locations[0]?.kind : "place",
    });
    container.setAttribute("data-place-id", place.placeId);
    const content =
      containerTag === "tr" ? el("td", { colspan: "99" }) : container;
    content.appendChild(
      el("span", {
        class:
          "[position:absolute] [top:-0.55rem] [left:0.75rem] [padding:0.12rem_0.38rem] [border:1px_solid_var(--annotation-c)] [border-radius:999px] [background:var(--bg)] [color:var(--annotation-c)] [font-size:0.58rem] [font-weight:750] [letter-spacing:0.04em] [text-transform:uppercase]",
        "data-review-diff-label": true,
        text:
          "Diff vs. previous version" +
          (event.toRevision !== sourceRevision ? " · since revised again" : ""),
      }),
    );
    const body = el("div", {
      class:
        "[display:grid] [gap:0.55rem] [margin:0] [color:inherit] [line-height:inherit]",
      "data-review-diff-body": true,
    });
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
      const firstDocumentBlock = document.querySelector("[data-block-id]");
      if (firstDocumentBlock) firstDocumentBlock.before(container);
      else document.querySelector("main")?.prepend(container);
    }

    const was = diffSide({
      label: "Was",
      locations: place.locations,
      side: "was",
    });
    const now = diffSide({
      label: "Now",
      locations: place.locations,
      side: "now",
    });
    if (was) body.appendChild(was);
    if (now) body.appendChild(now);
    content.appendChild(body);
    const hiddenBlocks = place.locations.flatMap((location) => {
      if (!location.newBlockId) return [];
      const block = document.querySelector(
        '[data-block-id="' + cssEscape(location.newBlockId) + '"]',
      );
      if (!(block instanceof HTMLElement)) return [];
      block.setAttribute("hidden", "");
      block.setAttribute("data-review-diff-hidden", "");
      return [block];
    });
    diffLens = {
      comment,
      event,
      index,
      places,
      container,
      hiddenBlocks,
      showingCurrent: false,
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
    diffExit.textContent = "Show current text";
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
  diffExit.addEventListener("click", () => {
    if (!diffLens) return;
    if (!diffLens.showingCurrent) {
      for (const block of diffLens.hiddenBlocks) {
        block.removeAttribute("hidden");
        block.removeAttribute("data-review-diff-hidden");
      }
      diffLens.container.hidden = true;
      diffLens.showingCurrent = true;
      diffExit.textContent = "Show changes";
      paintTargetHighlights();
      return;
    }
    const { comment, event, index } = diffLens;
    const scrollY = window.scrollY;
    renderDiffLocation({ comment, event, index });
    requestAnimationFrame(() =>
      window.scrollTo({ top: scrollY, behavior: "auto" }),
    );
  });
  diffHide.addEventListener("click", clearDiffLens);

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
        !response.revisionPair?.fromRevision ||
        !response.revisionPair?.toRevision ||
        response.revisionPair.fromRevision === response.revisionPair.toRevision
      ) {
        continue;
      }
      events.push({
        key: "changed",
        requestId: request.requestId,
        fromRevision: response.revisionPair.fromRevision,
        toRevision: response.revisionPair.toRevision,
        changes: [],
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

  // The change list is a navigator, not a card stack: slides are the grouping,
  // changes are quiet rows beneath their slide, inactive slides collapse, and
  // the selected row carries the only strong accent. Details stay in the lens.
  const summariesForPlace = ({ event, place }) =>
    (event.changes || []).filter((change) => change.placeId === place.placeId);

  const changeEntriesForPlace = ({ event, place, index }) => {
    const changes = summariesForPlace({ event, place });
    return changes.length > 0
      ? changes.map((change) => ({
          index,
          placeId: place.placeId,
          label: change.summary,
          note: place.note,
        }))
      : [
          {
            index,
            placeId: place.placeId,
            label: place.label,
            note: place.note,
          },
        ];
  };

  const changeSummaryText = ({ places, event }) => {
    const slides = new Set(places.map((place) => place.slideTitle)).size;
    const count = places.reduce(
      (total, place, index) =>
        total + changeEntriesForPlace({ event, place, index }).length,
      0,
    );
    return (
      count +
      " change" +
      (count === 1 ? "" : "s") +
      " across " +
      slides +
      " slide" +
      (slides === 1 ? "" : "s")
    );
  };

  const changeNavigator = ({ comment, event, places, active }) => {
    const groups = [];
    places.forEach((place, index) => {
      const entries = changeEntriesForPlace({ event, place, index });
      const previous = groups[groups.length - 1];
      if (previous && previous.title === place.slideTitle) {
        previous.entries.push(...entries);
      } else {
        groups.push({ title: place.slideTitle, entries });
      }
    });
    const activeSlide =
      active && diffLens ? places[diffLens.index]?.slideTitle : null;
    const nav = el("div", {
      class:
        "[display:grid] [grid-template-columns:minmax(0,_1fr)] [min-width:0] [border:1px_solid_var(--edge-c)] [border-radius:0.4rem] [background:var(--bg)] [overflow:hidden]",
      "data-review-change-nav": true,
    });
    for (const group of groups) {
      const key = event.requestId + ":" + group.title;
      const stored = changeGroupExpansion.get(key);
      const expanded =
        stored !== undefined
          ? stored
          : groups.length === 1 ||
            group.title === activeSlide ||
            (activeSlide === null && places.length <= 5);
      const header = el(
        "button",
        {
          class:
            "[display:flex] [width:100%] [align-items:center] [gap:0.3rem] [padding:0.34rem_0.5rem] [border:0] [background:var(--surface-c)] [color:var(--muted-c)] [font-size:0.66rem] [font-weight:700] [text-align:left] [cursor:pointer] hover:[background:var(--review-control-hover)] hover:[color:var(--ink-c)] active:[background:var(--review-control-active)]",
          type: "button",
          "data-review-change-group": true,
          "aria-expanded": expanded ? "true" : "false",
        },
        [
          icon(CHEVRON_RIGHT_ICON),
          el("span", {
            class:
              "[min-width:0] [flex:1_1_auto] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]",
            "data-review-change-group-title": true,
            text: group.title,
          }),
          el("span", {
            class:
              "[flex:0_0_auto] [min-width:1.05rem] [padding:0_0.25rem] [border-radius:999px] [background:var(--bg)] [color:var(--muted-c)] [font-size:0.6rem] [font-variant-numeric:tabular-nums] [text-align:center]",
            "data-review-change-group-count": true,
            text: String(group.entries.length),
          }),
        ],
      );
      header.addEventListener("click", () => {
        changeGroupExpansion.set(key, !expanded);
        renderTray();
      });
      nav.appendChild(header);
      if (!expanded) continue;
      for (const { index, placeId, label, note } of group.entries) {
        const current = active && diffLens && diffLens.index === index;
        const row = el("button", {
          class:
            "[display:flex] [width:100%] [min-width:0] [align-items:start] [gap:0.4rem] [padding:0.34rem_0.5rem_0.34rem_1.35rem] [border:0] [background:transparent] [color:var(--text-c)] [text-align:left] [cursor:pointer] hover:[background:var(--review-control-hover)] active:[background:var(--review-control-active)] aria-current:[background:color-mix(in_srgb,_var(--annotation-bg)_45%,_transparent)] aria-current:[box-shadow:inset_3px_0_0_var(--annotation-c)]",
          type: "button",
          "data-review-change-row": true,
          "data-place-id": placeId,
          ...(current ? { "aria-current": "true" } : {}),
        });
        row.appendChild(
          el("span", {
            class:
              "[min-width:0] [flex:1_1_auto] [font-size:0.72rem] [font-weight:550] [overflow-wrap:anywhere] [white-space:normal]",
            "data-review-change-label": true,
            text: label,
          }),
        );
        if (note && note !== "reworded") {
          row.appendChild(
            el("span", {
              class:
                "[flex:0_0_auto] [margin-top:0.1rem] [color:var(--muted-c)] [font-size:0.6rem] [font-style:italic]",
              "data-review-change-kind": true,
              text: note,
            }),
          );
        }
        row.addEventListener("click", () => {
          void openDiffLens(comment, event, index);
        });
        nav.appendChild(row);
      }
    }
    return nav;
  };

  const changeControls = (comment, event) => {
    const rows = placesForEvent(event);
    if (rows.length === 0) return null;
    const active =
      diffLens?.comment?.id === comment.id &&
      diffLens?.event.requestId === event.requestId;
    const list = el(
      "div",
      {
        class:
          "[display:grid] [grid-template-columns:minmax(0,_1fr)] [gap:0.3rem] [min-width:0]",
        "data-review-change-list": true,
      },
      [
        el("strong", { text: changeSummaryText({ places: rows, event }) }),
        changeNavigator({ comment, event, places: rows, active }),
      ],
    );
    const see = el("button", {
      class:
        "[margin-top:0.45rem] [padding:0.2rem_0.45rem] [border:1px_solid_var(--edge-c)] [border-radius:0.3rem] [background:var(--bg)] [color:var(--accent-c)] [font-size:0.6875rem] [font-weight:650] [cursor:pointer] hover:[background:var(--review-control-hover)] hover:[border-color:var(--accent-c)] active:[background:var(--review-control-active)]",
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
    return el(
      "div",
      {
        class:
          "[display:grid] [grid-template-columns:minmax(0,_1fr)] [gap:0.45rem] [margin-top:0.6rem]",
        "data-review-change-controls": true,
      },
      [list, see],
    );
  };

  const agentTurn = (outcome, createdAt, comment, event) => {
    const node = el(
      "div",
      {
        class:
          "min-w-0 max-w-full [width:calc(100%_-_1rem)] [margin-top:0.45rem] [padding:0.48rem_0.52rem] [border:1px_solid_var(--edge-c)] [border-radius:0.45rem] data-[review-thread-turn=user]:[margin-left:1rem] data-[review-thread-turn=user]:[border-right:2px_solid_var(--annotation-c)] data-[review-thread-turn=user]:[background:color-mix(in_srgb,_var(--annotation-bg)_30%,_var(--bg))] data-[review-thread-turn=agent]:[margin-right:1rem] data-[review-thread-turn=agent]:[border-left:2px_solid_var(--callout-note-c)] data-[review-thread-turn=agent]:[background:color-mix(in_srgb,_var(--callout-note-bg)_46%,_var(--bg))]",
        "data-review-thread-turn": "agent",
      },
      [
        el(
          "div",
          {
            class:
              "[display:flex] [align-items:center] [gap:0.35rem] [color:var(--muted-c)] [font-size:0.625rem]",
            "data-review-turn-meta": true,
          },
          [
            el("strong", { text: "Agent" }),
            el("time", {
              datetime: createdAt,
              text: relativeCommentTime(createdAt),
            }),
          ],
        ),
        messageBody(outcome.messageNodes, outcome.message),
      ],
    );
    if (outcome.state === "changed" && event) {
      const controls = changeControls(comment, event);
      if (controls) node.appendChild(controls);
    }
    return node;
  };

  const requestDeliveryLabel = (request) => {
    if (!request) return "Saved";
    const answered = agentResponses.some(
      (response) => response.requestId === request.requestId,
    );
    return answered || requestPickedUp(request) ? "Sent" : "Queued";
  };

  const cancelledRequestLine = () =>
    el("p", {
      class:
        "[margin:0.2rem_0] [color:var(--muted-c)] [font-size:0.6875rem] [font-style:italic]",
      "data-review-request-cancelled": true,
      text: "You cancelled this request.",
    });

  const conversationNodes = (comment, options = {}) => {
    const outcome = outcomeFor(comment);
    const initialRequest = agentRequests.find(
      (request) =>
        request.kind === "feedback" &&
        Array.isArray(request.comments) &&
        request.comments.some((entry) => entry.id === comment.id),
    );
    const nodes = [
      el(
        "div",
        {
          class:
            "min-w-0 max-w-full [width:calc(100%_-_1rem)] [margin-top:0.45rem] [padding:0.48rem_0.52rem] [border:1px_solid_var(--edge-c)] [border-radius:0.45rem] data-[review-thread-turn=user]:[margin-left:1rem] data-[review-thread-turn=user]:[border-right:2px_solid_var(--annotation-c)] data-[review-thread-turn=user]:[background:color-mix(in_srgb,_var(--annotation-bg)_30%,_var(--bg))] data-[review-thread-turn=agent]:[margin-right:1rem] data-[review-thread-turn=agent]:[border-left:2px_solid_var(--callout-note-c)] data-[review-thread-turn=agent]:[background:color-mix(in_srgb,_var(--callout-note-bg)_46%,_var(--bg))]",
          "data-review-thread-turn": "user",
        },
        [
          el(
            "div",
            {
              class:
                "[display:flex] [align-items:center] [gap:0.35rem] [color:var(--muted-c)] [font-size:0.625rem]",
              "data-review-turn-meta": true,
            },
            [
              el("strong", { text: "You" }),
              el("time", {
                datetime: initialRequest?.createdAt || comment.createdAt,
                text:
                  requestDeliveryLabel(initialRequest) +
                  " · " +
                  relativeCommentTime(
                    initialRequest?.createdAt || comment.createdAt,
                  ),
              }),
            ],
          ),
          el("p", { class: COMMENT_WRAP_CLASSES, text: comment.body }),
          anchorContextLine(comment),
        ],
      ),
    ];
    if (
      initialRequest &&
      agentCancelledIds.includes(initialRequest.requestId)
    ) {
      nodes.push(cancelledRequestLine());
    }

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
        el(
          "div",
          {
            class:
              "min-w-0 max-w-full [width:calc(100%_-_1rem)] [margin-top:0.45rem] [padding:0.48rem_0.52rem] [border:1px_solid_var(--edge-c)] [border-radius:0.45rem] data-[review-thread-turn=user]:[margin-left:1rem] data-[review-thread-turn=user]:[border-right:2px_solid_var(--annotation-c)] data-[review-thread-turn=user]:[background:color-mix(in_srgb,_var(--annotation-bg)_30%,_var(--bg))] data-[review-thread-turn=agent]:[margin-right:1rem] data-[review-thread-turn=agent]:[border-left:2px_solid_var(--callout-note-c)] data-[review-thread-turn=agent]:[background:color-mix(in_srgb,_var(--callout-note-bg)_46%,_var(--bg))]",
            "data-review-thread-turn": "user",
          },
          [
            el(
              "div",
              {
                class:
                  "[display:flex] [align-items:center] [gap:0.35rem] [color:var(--muted-c)] [font-size:0.625rem]",
                "data-review-turn-meta": true,
              },
              [
                el("strong", { text: "You" }),
                el("time", {
                  datetime: request.createdAt,
                  text:
                    requestDeliveryLabel(request) +
                    " · " +
                    relativeCommentTime(request.createdAt),
                }),
              ],
            ),
            el("p", { class: COMMENT_WRAP_CLASSES, text: request.body }),
          ],
        ),
      );
      if (agentCancelledIds.includes(request.requestId)) {
        nodes.push(cancelledRequestLine());
      }
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
      const strip = threadStatusStrip(outcome.status, {
        surface: options.surface,
        commentId: comment.id,
      });
      if (strip) nodes.push(strip);
      nodes.push(threadResolutionFooter({ comment }));
      return nodes;
    }

    const field = el("textarea", {
      class:
        "[display:block] [width:100%] [padding:0.4rem_0.5rem] [border:1px_solid_var(--edge-c)] [border-radius:0.4rem] [background:var(--bg)] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [resize:vertical] [min-height:3.25rem] [resize:vertical] focus-visible:[outline:1px_solid_var(--accent-c)] focus-visible:[outline-offset:2px]",
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
      class:
        "[justify-self:end] [padding:0.35rem_0.55rem] [border:1px_solid_var(--accent-c)] [border-radius:0.35rem] [background:var(--accent-c)] [color:var(--bg)] [font-size:0.6875rem] [font-weight:650] [cursor:pointer] [position:relative]",
      type: "button",
      "data-review-thread-reply-send": true,
      disabled: true,
      text: outcome.key === "question" ? "Send answer" : "Reply",
    });
    attachShortcutTooltip(
      sendReply,
      outcome.key === "question" ? "Send answer" : "Send reply",
    );
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
      el(
        "div",
        {
          class:
            "[display:grid] [grid-template-columns:minmax(0,_1fr)] [gap:0.4rem] [margin-top:0.55rem]",
          "data-review-thread-reply-box": true,
        },
        [
          el("label", {
            text: outcome.key === "question" ? "Your answer" : "Reply",
          }),
          field,
          sendReply,
        ],
      ),
    );
    nodes.push(
      threadResolutionFooter({
        comment,
        replyField: field,
        replyButton: sendReply,
      }),
    );
    return nodes;
  };

  const openRevertDialog = (comment) => {
    revertCandidateId = comment.id;
    revertDialog.showModal();
  };

  const resolveThreadIds = async (ids, options = {}) => {
    if (diffLens?.comment && ids.includes(diffLens.comment.id)) {
      clearDiffLens();
    }
    const previousResolved = new Set(resolvedCommentIds);
    const previousExpandedThreads = new Set(expandedThreadIds);
    const previousExpandedComments = new Set(expandedCommentIds);
    for (const id of ids) {
      resolvedCommentIds.add(id);
      expandedThreadIds.delete(id);
      expandedCommentIds.delete(id);
    }
    const resolvedMessage =
      ids.length === 1
        ? "Comment resolved."
        : "Resolved " + ids.length + " comments.";
    announce(resolvedMessage);
    renderTray();
    try {
      await persist();
      sendNote.textContent = "";
      if (ids.length === 1 && options.toast !== false) {
        showToast({
          message: "Resolved",
          actionLabel: "Undo",
          action: async () => {
            resolvedCommentIds.delete(ids[0]);
            expandedThreadIds.add(ids[0]);
            announce("Comment reopened.");
            renderTray();
            await save();
          },
        });
      }
    } catch (error) {
      resolvedCommentIds.clear();
      previousResolved.forEach((id) => resolvedCommentIds.add(id));
      expandedThreadIds.clear();
      previousExpandedThreads.forEach((id) => expandedThreadIds.add(id));
      expandedCommentIds.clear();
      previousExpandedComments.forEach((id) => expandedCommentIds.add(id));
      const message = "Couldn’t resolve: " + describeError(error);
      sendNote.textContent = message;
      announce(message);
      renderTray();
    }
  };

  const resolveThread = async (comment) => resolveThreadIds([comment.id]);

  const unresolveThread = async (comment) => {
    resolvedCommentIds.delete(comment.id);
    expandedThreadIds.add(comment.id);
    announce("Comment reopened.");
    renderTray();
    await save();
  };

  const keepThreadOpen = (comment) => {
    clearCommentLensIfOwned(comment.id);
    expandedThreadIds.delete(comment.id);
    renderTray();
  };

  const threadResolutionFooter = ({ comment, replyField, replyButton }) => {
    const keepOpen = el("button", {
      type: "button",
      class:
        "cursor-pointer rounded-sm px-2 py-1 text-xs font-semibold text-muted hover:bg-[var(--review-control-hover)] hover:text-ink active:bg-[var(--review-control-active)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent",
      "data-review-thread-keep-open": true,
      text: "Keep open",
    });
    const resolve = el("button", {
      type: "button",
      class:
        "cursor-pointer rounded-sm border border-accent bg-accent px-2 py-1 text-xs font-semibold text-[var(--bg)] hover:brightness-110 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      "data-review-thread-resolve-footer": true,
      text: "Resolve thread",
    });
    const syncLabel = () => {
      resolve.textContent =
        replyField?.value.trim() === "" ? "Resolve thread" : "Reply & resolve";
    };
    replyField?.addEventListener("input", syncLabel);
    keepOpen.addEventListener("click", () => keepThreadOpen(comment));
    resolve.addEventListener("click", async () => {
      const hasReply = replyField?.value.trim() !== "";
      if (hasReply) {
        const sentReply = await sendThreadReply(
          comment,
          replyField,
          replyButton,
        );
        if (!sentReply) return;
      }
      await resolveThread(comment);
    });
    syncLabel();
    return el(
      "footer",
      {
        class:
          "mt-3 flex items-center justify-end gap-2 border-t border-edge pt-3",
        "data-review-thread-resolution": true,
      },
      [keepOpen, resolve],
    );
  };

  const toolbarButton = ({ attribute, label, glyph, action }) => {
    const button = el("button", {
      class:
        "group/review-icon relative inline-flex size-[1.65rem] flex-none items-center justify-center overflow-visible p-0 leading-none",
      type: "button",
      [attribute]: true,
      "aria-label": label,
    });
    button.append(
      icon(glyph),
      el("span", {
        class:
          "group-hover/review-icon:[opacity:1] group-hover/review-icon:[transform:translateY(0)] group-focus-visible/review-icon:[opacity:1] group-focus-visible/review-icon:[transform:translateY(0)] [position:absolute] [top:calc(100%_+_0.35rem)] [right:0] [z-index:60] [width:max-content] [max-width:11rem] [padding:0.22rem_0.42rem] [border-radius:0.25rem] [background:var(--ink-c)] [color:var(--bg)] [font-size:0.66rem] [font-weight:600] [line-height:1.35] [pointer-events:none] [opacity:0] [transform:translateY(-0.1rem)] [transition:opacity_70ms_ease,_transform_70ms_ease]",
        "data-review-icon-tooltip": true,
        "aria-hidden": "true",
        text: label,
      }),
    );
    button.addEventListener("click", action);
    return button;
  };

  const threadQuickActions = (comment, options = {}) => {
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
    const actions = [];
    if (resolved) {
      actions.push(
        toolbarButton({
          attribute: "data-review-thread-unresolve",
          label: "Unresolve comment",
          glyph: UNDO_2_ICON,
          action: () => {
            void unresolveThread(comment);
          },
        }),
      );
    } else {
      actions.push(
        toolbarButton({
          attribute: "data-review-thread-resolve",
          label: "Resolve comment",
          glyph: CHECK_ICON,
          action: () => {
            void resolveThread(comment);
          },
        }),
      );
    }
    if (revertAction) actions.push(revertAction);
    return el(
      "div",
      {
        class:
          "[display:flex] [flex:0_0_auto] [align-items:center] [gap:0.18rem]",
        "data-review-thread-toolbar-actions": true,
      },
      actions,
    );
  };

  const threadToolbarActions = (comment, options = {}) => {
    const minimize = toolbarButton({
      attribute: "data-review-thread-minimize",
      label: "Minimize thread",
      glyph: MINIMIZE_2_ICON,
      action:
        options.minimize ||
        (() => {
          clearCommentLensIfOwned(comment.id);
          expandedThreadIds.delete(comment.id);
          renderTray();
        }),
    });
    const quickActions = threadQuickActions(comment, options);
    quickActions.prepend(minimize);
    return quickActions;
  };

  const threadToolbar = (comment, options = {}) => {
    return el(
      "div",
      {
        class:
          "[display:flex] [min-width:0] [align-items:center] [gap:0.45rem] [margin:-0.65rem_-0.65rem_0.6rem] [padding:0.42rem_0.45rem] [border-bottom:1px_solid_var(--edge-c)] [border-radius:0.55rem_0.55rem_0_0] [background:var(--surface-c)]",
        "data-review-thread-toolbar": true,
      },
      [
        el(
          "div",
          {
            class:
              "[display:flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:0.35rem]",
            "data-review-thread-toolbar-title": true,
          },
          [
            el("span", {
              text: slideTitleFor(comment.target),
            }),
          ],
        ),
        threadToolbarActions(comment, options),
      ],
    );
  };

  // Staged cards share the sent-thread toolbar pattern: state and actions in
  // one top bar, so the body carries exactly one button - Submit Now - and
  // only while the comment has not been submitted.
  const stagedToolbar = (comment, options = {}) => {
    const actions =
      options.withActions === false
        ? []
        : [
            el(
              "div",
              {
                class:
                  "[display:flex] [flex:0_0_auto] [align-items:center] [gap:0.18rem]",
                "data-review-thread-toolbar-actions": true,
              },
              [
                toolbarButton({
                  attribute: "data-review-thread-minimize",
                  label: "Minimize comment",
                  glyph: MINIMIZE_2_ICON,
                  action: () => {
                    minimizedDraftIds.add(comment.id);
                    renderTray();
                  },
                }),
                toolbarButton({
                  attribute: "data-review-thread-edit",
                  label: "Edit comment",
                  glyph: PENCIL_ICON,
                  action: () => {
                    editingId = comment.id;
                    renderTray();
                  },
                }),
                toolbarButton({
                  attribute: "data-review-thread-delete",
                  label: "Remove comment",
                  glyph: TRASH_2_ICON,
                  action: () => openDeleteDialog(comment),
                }),
              ],
            ),
          ];
    return el(
      "div",
      {
        class:
          "[display:flex] [min-width:0] [align-items:center] [gap:0.45rem] [margin:-0.65rem_-0.65rem_0.6rem] [padding:0.42rem_0.45rem] [border-bottom:1px_solid_var(--edge-c)] [border-radius:0.55rem_0.55rem_0_0] [background:var(--surface-c)]",
        "data-review-thread-toolbar": true,
      },
      [
        el(
          "div",
          {
            class:
              "[display:flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:0.35rem]",
            "data-review-thread-toolbar-title": true,
          },
          [
            el("span", {
              class:
                "[flex:0_0_auto] [padding:0.05rem_0.35rem] [border:1px_solid_var(--edge-c)] [border-radius:999px] [color:var(--muted-c)] [font-size:0.5625rem] [font-weight:700] [letter-spacing:0.06em] [text-transform:uppercase] data-[review-comment-state=staged]:[border-color:color-mix(in_srgb,_var(--annotation-c)_50%,_var(--edge-c))] data-[review-comment-state=staged]:[color:var(--annotation-c)]",
              "data-review-comment-state": "staged",
              text: "Staged",
            }),
            el("time", {
              datetime: comment.createdAt,
              text: relativeCommentTime(comment.createdAt),
            }),
          ],
        ),
        ...actions,
      ],
    );
  };

  const submitErrorNote = (comment) => {
    const message = submitErrorById.get(comment.id);
    if (!message) return null;
    return el("p", {
      class:
        "[grid-column:1_/_-1] [margin:0.35rem_0_0] [padding:0.3rem_0.45rem] [border-left:2px_solid_var(--callout-danger-c)] [background:var(--callout-danger-bg)] [color:var(--callout-danger-c)] [font-size:0.6875rem] [line-height:1.4] [overflow-wrap:anywhere]",
      "data-review-action-error": true,
      text: message,
    });
  };

  const bindCommentAssociation = (node, comment) => {
    const emphasize = () => {
      setEmphasizedComment(comment.id);
    };
    const relax = () => {
      if (emphasizedCommentId !== comment.id) return;
      setEmphasizedComment(null);
    };
    if (emphasizedCommentId === comment.id) {
      node.setAttribute("data-review-comment-emphasized", "");
    }
    node.addEventListener("pointerenter", emphasize);
    node.addEventListener("pointerleave", relax);
    node.addEventListener("focusin", emphasize);
    node.addEventListener("focusout", (event) => {
      if (!node.contains(event.relatedTarget)) relax();
    });
    return node;
  };

  const NATIVE_INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "label",
    "summary",
    "details",
    '[contenteditable]:not([contenteditable="false"])',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="link"]',
    '[role="listbox"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="textbox"]',
  ].join(",");

  // Container-wide opening is a collapsed-row convenience only. This guard
  // keeps future native controls from accidentally becoming row navigation.
  const isNativeInteractiveTarget = (event) =>
    event
      .composedPath()
      .some(
        (candidate) =>
          candidate instanceof Element &&
          candidate.matches(NATIVE_INTERACTIVE_SELECTOR),
      );

  const sentRow = (comment, options = {}) => {
    const resolved = options.resolved === true;
    const outcome = outcomeFor(comment);
    const lifecycle = outcome.status?.stage;
    const rowState =
      outcome.key !== "waiting"
        ? "ready"
        : lifecycle === "working" || lifecycle === "stalled"
          ? "working"
          : "queued";
    const expanded = expandedThreadIds.has(comment.id);
    const collapse = () => {
      clearCommentLensIfOwned(comment.id);
      expandedThreadIds.delete(comment.id);
      renderTray();
      requestAnimationFrame(() => {
        sentList
          .querySelector(
            '[data-review-comment-id="' +
              comment.id +
              '"] [data-review-row-target]',
          )
          ?.focus();
      });
    };
    const toggleThread = () => {
      if (expanded) {
        collapse();
        return;
      }
      if (resolved) {
        expandedThreadIds.add(comment.id);
        renderTray();
        return;
      }
      openThreadAt(comment);
    };
    const jump = el(
      "button",
      {
        class:
          "[display:flex] [min-width:0] [flex:1_1_auto] [align-items:center] [overflow:hidden] [color:var(--ink-c)] [font-size:0.6875rem] [font-weight:600] [letter-spacing:0.06em] [text-align:left] [text-overflow:ellipsis] [text-transform:uppercase] [white-space:nowrap] [cursor:pointer] hover:[color:var(--ink-c)] focus-visible:[outline:none] active:[color:var(--annotation-c)]",
        type: "button",
        "data-review-row-target": true,
        "aria-expanded": expanded ? "true" : "false",
        "aria-label":
          (expanded ? "Collapse" : "Open") +
          " thread on " +
          slideTitleFor(comment.target) +
          ": " +
          shortEcho(comment.body),
        title: expanded
          ? "Collapse this thread"
          : resolved
            ? "Open this resolved thread"
            : "Jump to and expand this thread",
      },
      [
        el("span", {
          class: "[min-width:0] [overflow:hidden] [text-overflow:ellipsis]",
          "data-review-row-title": true,
          text: slideTitleFor(comment.target),
        }),
        el(
          "span",
          {
            class:
              "[display:inline-flex] [width:1rem] [height:1rem] [flex:0_0_auto] [align-items:center] [justify-content:center] [color:var(--muted-c)] [opacity:0] [transition:opacity_100ms_ease] group-hover/row:[opacity:1] group-focus-within/row:[opacity:1]",
            "data-review-row-locator": true,
          },
          [icon(CHEVRON_RIGHT_ICON)],
        ),
      ],
    );
    jump.addEventListener("click", toggleThread);
    const rowHeadChildren = [jump];
    if (expanded) {
      rowHeadChildren.push(
        threadToolbarActions(comment, { resolved, minimize: collapse }),
      );
    } else {
      const substate = threadSubstate(outcome.status?.stage);
      if (substate !== null) {
        const slot = el("span", {
          class:
            "[display:inline-flex] [width:1.2rem] [height:1.2rem] [flex:0_0_auto] [align-items:center] [justify-content:center] [color:var(--muted-c)] data-[review-row-substate=stalled]:[color:var(--callout-warning-c)]",
          "data-review-row-substate": substate,
          "aria-label":
            substate === "working" ? "Agent working" : "Agent progress stalled",
        });
        slot.appendChild(
          substate === "working" ? spinner() : icon(TRIANGLE_ALERT_ICON),
        );
        rowHeadChildren.push(slot);
      }
      rowHeadChildren.push(threadQuickActions(comment, { resolved }));
    }
    const rowHead = el(
      "div",
      {
        class:
          "[display:flex] [min-width:0] [align-items:center] [gap:0.5rem] [margin-bottom:0.3rem]",
        "data-review-row-head": true,
      },
      rowHeadChildren,
    );
    const children = [rowHead];
    if (expanded) {
      children.push(...conversationNodes(comment, { surface: "tray" }));
    } else {
      const pendingRequest = pendingRequestForComment(comment);
      const latestOutcome = outcomeEventsFor(comment).at(-1);
      const secondary =
        rowState === "ready"
          ? `${outcome.label} · ${relativeCommentTime(
              latestOutcome?.createdAt || comment.createdAt,
            )}`
          : rowState === "working"
            ? lifecycle === "stalled"
              ? "Agent quiet · check its terminal"
              : `Working · ${relativeCommentTime(
                  pendingRequest?.createdAt || comment.createdAt,
                )}`
            : "Queued";
      children.push(
        el("p", {
          class:
            COMMENT_WRAP_CLASSES +
            " [margin:0] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [overflow-wrap:anywhere] [white-space:pre-wrap]",
          "data-review-row-body": true,
          text: shortEcho(comment.body),
        }),
        el("p", {
          class:
            "[margin:0.25rem_0_0] [color:var(--muted-c)] [font-size:0.6875rem] [font-variant-numeric:tabular-nums] [line-height:1.35]",
          "data-review-row-secondary": rowState,
          text: secondary,
        }),
      );
      const changedEvent = outcomeEventsFor(comment)
        .filter((event) => event.key === "changed")
        .at(-1);
      if (rowState === "ready" && changedEvent !== undefined) {
        const reviewChange = el("button", {
          class:
            "[margin-top:0.45rem] [padding:0.28rem_0.5rem] [border:1px_solid_var(--annotation-c)] [border-radius:0.35rem] [background:color-mix(in_srgb,_var(--annotation-c)_9%,_var(--bg))] [color:var(--annotation-c)] [cursor:pointer] [font-size:0.6875rem] [font-weight:700] hover:[background:color-mix(in_srgb,_var(--annotation-c)_14%,_var(--bg))] active:[background:color-mix(in_srgb,_var(--annotation-c)_20%,_var(--bg))]",
          type: "button",
          "data-review-row-review-change": true,
          text: "Review change",
        });
        reviewChange.addEventListener("click", (event) => {
          event.stopPropagation();
          expandedThreadIds.add(comment.id);
          renderTray();
          void openDiffLens(comment, changedEvent);
        });
        children.push(reviewChange);
      }
    }
    const rowClasses =
      "group/row [margin-bottom:0.55rem] [padding:0.55rem_0.6rem] [border:1px_solid_var(--edge-c)] [border-radius:0.5rem] [background:var(--surface-c)] [cursor:pointer] [transition:border-color_100ms_ease,_background-color_100ms_ease] [background:transparent] [display:grid] [grid-template-columns:minmax(0,_1fr)] [gap:0.18rem] [padding:0.45rem_0.5rem] [border:1px_solid_var(--edge-c)] [border-left-width:2px] [border-radius:0.4rem] [background:var(--bg)] [color:var(--muted-c)] [font-size:0.6875rem] hover:[border-color:color-mix(in_srgb,_var(--muted-c)_45%,_var(--edge-c))] hover:[background:color-mix(in_srgb,_var(--surface-c)_94%,_var(--ink-c))] data-[review-outcome=changed]:[border-left-color:var(--diff-add-c)] data-[review-outcome=question]:[border-left-color:var(--callout-warning-c)] data-[review-outcome=outside]:[border-left-color:var(--muted-c)] data-[review-outcome=waiting]:[border-left-color:var(--muted-c)] data-[review-outcome=cancelled]:[border-left-color:var(--muted-c)]" +
      (resolved ? " [background:var(--surface-c)]" : "") +
      (outcome.status
        ? " data-[review-lifecycle=blocked]:[border-left-color:var(--callout-warning-c)]"
        : "");
    const row = el(
      "li",
      {
        class: rowClasses,
        "data-review-row": true,
        "data-review-sent-row": true,
        "data-review-row-state": rowState,
        ...(resolved
          ? {
              "data-review-resolved-row": true,
            }
          : {}),
        ...(expanded ? { "data-review-row-expanded": true } : {}),
        "data-review-comment-id": comment.id,
        "data-review-outcome": outcome.key,
        ...(outcome.status
          ? {
              "data-review-lifecycle": outcome.status.stage,
            }
          : {}),
      },
      children,
    );
    if (!expanded) {
      row.addEventListener("click", (event) => {
        if (isNativeInteractiveTarget(event)) return;
        toggleThread();
      });
    }
    return bindCommentAssociation(row, comment);
  };

  const threadCard = ({ comment, state }) => {
    const isEditing = state === "staged" && comment.id === editingId;
    const card = el("article", {
      class:
        "max-[80rem]:data-[review-thread-inline]:relative! max-[80rem]:data-[review-thread-inline]:[right:auto] max-[80rem]:data-[review-thread-inline]:[z-index:2]! max-[80rem]:data-[review-thread-inline]:block! max-[80rem]:data-[review-thread-inline]:[width:100%]! max-[80rem]:data-[review-thread-inline]:[margin:0.65rem_0_1rem] [position:absolute] [right:auto] [width:17rem] [padding:0.65rem] [border:1px_solid_var(--edge-c)] [border-radius:0.6rem] [background:var(--bg)] [box-shadow:0_3px_14px_rgb(0_0_0_/_0.1)] [pointer-events:auto] data-[review-thread-state=sent]:[padding:0.28rem] data-[review-thread-state=sent]:[box-shadow:0_4px_16px_rgb(0_0_0_/_0.1)]",
      "data-review-thread-card": true,
      "data-review-thread-state": state,
      "data-review-comment-id": comment.id,
    });
    bindCommentAssociation(card, comment);
    if (state === "staged" && submittingIds.has(comment.id)) {
      card.setAttribute("data-review-thread-sending", "");
      card.append(
        el(
          "div",
          {
            class:
              "[display:flex] [min-width:0] [align-items:center] [gap:0.45rem] [margin:-0.65rem_-0.65rem_0.6rem] [padding:0.42rem_0.45rem] [border-bottom:1px_solid_var(--edge-c)] [border-radius:0.55rem_0.55rem_0_0] [background:var(--surface-c)]",
            "data-review-thread-toolbar": true,
          },
          [
            el(
              "div",
              {
                class:
                  "[display:flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:0.35rem]",
                "data-review-thread-toolbar-title": true,
              },
              [
                outcomeBadge(
                  { key: "waiting", label: "Sending" },
                  { spin: true },
                ),
              ],
            ),
          ],
        ),
        el("p", {
          class:
            COMMENT_WRAP_CLASSES +
            " [margin:0] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [overflow-wrap:anywhere] [white-space:pre-wrap]",
          "data-review-thread-body": true,
          text: comment.body,
        }),
      );
      return card;
    }
    if (state === "sent") {
      const outcome = outcomeFor(comment);
      card.setAttribute("data-review-outcome", outcome.key);
      if (outcome.status) {
        card.setAttribute("data-review-lifecycle", outcome.status.stage);
      }
      const expanded = expandedThreadIds.has(comment.id);
      const summaryToggle = el(
        "button",
        {
          class:
            "[min-width:0] [padding:0] [border:0] [background:transparent] [color:inherit] [cursor:pointer] [text-align:left]",
          type: "button",
          "data-review-thread-summary-toggle": true,
          "aria-expanded": expanded ? "true" : "false",
          "aria-label":
            (expanded ? "Collapse" : "Open") +
            " " +
            outcome.label +
            " thread: " +
            shortEcho(comment.body),
        },
        [
          el("span", {
            class:
              "[min-width:0] [overflow:hidden] [font-size:0.6875rem] [text-overflow:ellipsis] [white-space:nowrap]",
            "data-review-thread-echo": true,
            text: shortEcho(comment.body),
          }),
        ],
      );
      const summary = el(
        "div",
        {
          class:
            "[display:grid] [width:100%] [min-width:0] [grid-template-columns:auto_minmax(0,_1fr)] [align-items:center] [gap:0.4rem] [padding:0.18rem_5.2rem_0.18rem_0.22rem] [color:var(--ink-c)] [text-align:left]",
          "data-review-thread-summary": true,
        },
        [
          outcomeBadge(outcome, {
            spin: outcome.status?.stage === "working",
            iconOnly: outcome.key === "waiting",
            waitingBusy: outcome.status?.waitingBusy,
          }),
          summaryToggle,
        ],
      );
      summaryToggle.addEventListener("click", () => {
        if (expanded) {
          clearCommentLensIfOwned(comment.id);
          expandedThreadIds.delete(comment.id);
        } else {
          expandedThreadIds.add(comment.id);
        }
        renderTray();
        requestAnimationFrame(() => {
          threadLayer
            .querySelector(
              '[data-review-comment-id="' +
                comment.id +
                '"] [data-review-thread-summary-toggle]',
            )
            ?.focus();
        });
      });
      if (expanded) {
        card.setAttribute("data-review-thread-expanded", "");
        card.append(
          threadToolbar(comment),
          ...conversationNodes(comment, { surface: "card" }),
        );
      } else {
        card.setAttribute("data-review-thread-collapsed", "");
        card.append(summary, threadQuickActions(comment));
      }
      return card;
    }

    if (minimizedDraftIds.has(comment.id)) {
      const summaryToggle = el(
        "button",
        {
          class:
            "[min-width:0] [padding:0] [border:0] [background:transparent] [color:inherit] [cursor:pointer] [text-align:left]",
          type: "button",
          "data-review-thread-summary-toggle": true,
          "aria-expanded": "false",
          "aria-label": "Expand staged comment: " + shortEcho(comment.body),
        },
        [
          el("span", {
            class:
              "[min-width:0] [overflow:hidden] [font-size:0.6875rem] [text-overflow:ellipsis] [white-space:nowrap]",
            "data-review-thread-echo": true,
            text: shortEcho(comment.body),
          }),
        ],
      );
      const summary = el(
        "div",
        {
          class:
            "[display:grid] [width:100%] [min-width:0] [grid-template-columns:auto_minmax(0,_1fr)] [align-items:center] [gap:0.4rem] [padding:0.18rem_5.2rem_0.18rem_0.22rem] [color:var(--ink-c)] [text-align:left]",
          "data-review-thread-summary": true,
        },
        [
          el("span", {
            class:
              "[flex:0_0_auto] [padding:0.05rem_0.35rem] [border:1px_solid_var(--edge-c)] [border-radius:999px] [color:var(--muted-c)] [font-size:0.5625rem] [font-weight:700] [letter-spacing:0.06em] [text-transform:uppercase] data-[review-comment-state=staged]:[border-color:color-mix(in_srgb,_var(--annotation-c)_50%,_var(--edge-c))] data-[review-comment-state=staged]:[color:var(--annotation-c)]",
            "data-review-comment-state": "staged",
            text: "Staged",
          }),
          summaryToggle,
        ],
      );
      summaryToggle.addEventListener("click", () => {
        minimizedDraftIds.delete(comment.id);
        renderTray();
      });
      card.appendChild(summary);
      return card;
    }

    card.appendChild(stagedToolbar(comment, { withActions: !isEditing }));

    if (isEditing) {
      const field = el("textarea", {
        class:
          "[display:block] [width:100%] [padding:0.4rem_0.5rem] [border:1px_solid_var(--edge-c)] [border-radius:0.4rem] [background:var(--bg)] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [resize:vertical] focus-visible:[outline:1px_solid_var(--accent-c)] focus-visible:[outline-offset:2px]",
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
        class:
          "[border-color:var(--accent-c)]! [background:var(--accent-c)]! [color:var(--bg)]! [position:relative]",
        type: "button",
        "data-review-thread-save": true,
        text: "Save",
      });
      attachShortcutTooltip(confirm, "Save comment");
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
        el(
          "div",
          {
            class:
              "[display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:0.35rem] [margin-top:0.55rem]",
            "data-review-thread-actions": true,
          },
          [cancel, confirm],
        ),
      );
      setTimeout(() => field.focus(), 0);
      return card;
    }

    const isLong = comment.body.length > LONG_COMMENT_LIMIT;
    const expanded = expandedCommentIds.has(comment.id);
    const body = el("p", {
      class:
        COMMENT_WRAP_CLASSES +
        " [margin:0] [color:var(--ink-c)] [font-size:0.8125rem] [line-height:1.5] [overflow-wrap:anywhere] [white-space:pre-wrap]",
      "data-review-thread-body": true,
    });
    if (isLong && !expanded) {
      body.appendChild(
        document.createTextNode(
          comment.body.slice(0, LONG_COMMENT_LIMIT).trimEnd() + " ",
        ),
      );
      const more = el("button", {
        class:
          "[display:inline] [padding:0] [border:0] [background:transparent] [color:var(--muted-c)] [font-size:0.75rem] [font-weight:600] [cursor:pointer] hover:[color:var(--accent-c)] hover:[text-decoration:underline] active:[color:var(--ink-c)]",
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
    const errorNote = submitErrorNote(comment);
    if (errorNote) card.appendChild(errorNote);
    if (state === "staged") {
      card.appendChild(
        el(
          "div",
          {
            class:
              "[display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:0.35rem] [margin-top:0.55rem]",
            "data-review-thread-actions": true,
          },
          stagedSubmitActions({ comment, surface: "thread" }),
        ),
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
    target?.type === "document"
      ? blocks[0] || null
      : visualAnchorForTarget(target);

  const floatingBlockForComment = (comment) => {
    if (diffLens?.comment?.id === comment.id && diffLens.container) {
      return diffLens.container;
    }
    return comment.target?.type === "document"
      ? blocks[0] || null
      : comment.target?.type === "slide"
        ? visualAnchorForTarget(comment.target)
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
    const entries = [];
    const nodes = new Map();
    for (const card of cards) {
      const id = card.getAttribute("data-review-comment-id");
      const comment = drafts
        .concat(sent)
        .find((candidate) => candidate.id === id);
      const block = comment ? floatingBlockForComment(comment) : null;
      const rect = block?.getBoundingClientRect();
      const visible = canFloat && block !== null && rect !== undefined;
      card.hidden = !visible;
      if (!visible || !id) continue;
      card.style.left = floatLeftForBlock(block, card.offsetWidth) + "px";
      entries.push({
        id,
        anchorTop: rect.top + window.scrollY,
        height: card.offsetHeight,
      });
      nodes.set(id, card);
    }
    if (
      canFloat &&
      !compose.hidden &&
      composeTarget &&
      compose.hasAttribute("data-review-compose-floating")
    ) {
      const block = visualAnchorForTarget(composeTarget);
      const rect = block?.getBoundingClientRect();
      if (block && rect) {
        if (compose.parentElement !== threadLayer) {
          threadLayer.appendChild(compose);
        }
        compose.style.left =
          floatLeftFor(composeTarget, compose.offsetWidth) + "px";
        entries.push({
          id: "compose",
          anchorTop: rect.top + window.scrollY,
          height: compose.offsetHeight,
        });
        nodes.set("compose", compose);
      }
    }
    for (const { id, top } of layoutAnchoredCards(entries)) {
      const node = nodes.get(id);
      if (node) node.style.top = top + "px";
    }
  };

  const renderThreads = () => {
    const anchoredActivityScroll = new Map(
      Array.from(
        threadLayer.querySelectorAll("[data-review-activity-owner]"),
      ).map((node) => [
        node.getAttribute("data-review-activity-owner"),
        node.scrollTop,
      ]),
    );
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
    const floatingCompose =
      compose.parentElement === threadLayer && !compose.hidden ? compose : null;
    threadLayer.replaceChildren(
      ...cards,
      ...(floatingCompose === null ? [] : [floatingCompose]),
    );
    for (const activity of threadLayer.querySelectorAll(
      "[data-review-activity-owner]",
    )) {
      const owner = activity.getAttribute("data-review-activity-owner");
      if (owner !== null && anchoredActivityScroll.has(owner)) {
        activity.scrollTop = anchoredActivityScroll.get(owner);
      }
    }
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
    const workingCount = sent.filter((comment) => {
      if (resolvedCommentIds.has(comment.id)) return false;
      const stage = outcomeFor(comment).status?.stage;
      return stage === "working" || stage === "stalled";
    }).length;
    const waitingCount = Math.max(0, counts.waiting - workingCount);
    const readyCount =
      counts.question + counts.changed + counts.outside + counts.cancelled;
    const summaryItems = [
      { count: readyCount, label: "ready" },
      { count: workingCount, label: "working" },
      { count: waitingCount, label: "queued" },
    ].filter((item) => item.count > 0);
    responseSummary.replaceChildren(
      ...summaryItems.map((item) =>
        el("span", {
          class:
            "[padding:0.1rem_0.38rem] [border:1px_solid_var(--edge-c)] [border-radius:999px] [background:var(--surface-c)] [font-variant-numeric:tabular-nums] [white-space:nowrap]",
          "data-review-round-chip": item.label,
          text: `${item.count} ${item.label}`,
        }),
      ),
    );
    resolveAllButton.hidden =
      counts.changed + counts.question + counts.outside === 0;
    const groups = [
      {
        key: "ready",
        label: "Ready for Review",
        glyph: CHECK_ICON,
        match: (outcome) => outcome.key !== "waiting",
      },
      {
        key: "working",
        label: "Working",
        spin: true,
        match: (outcome) =>
          outcome.status?.stage === "working" ||
          outcome.status?.stage === "stalled",
      },
      {
        key: "queued",
        label: "Queued",
        glyph: HOURGLASS_ICON,
        match: (outcome) =>
          outcome.key === "waiting" &&
          outcome.status?.stage !== "working" &&
          outcome.status?.stage !== "stalled",
      },
    ];
    const renderedGroups = groups
      .map(({ key, label, displayKey = key, glyph, spin, match }) => {
        const comments = sent.filter((comment) => {
          if (resolvedCommentIds.has(comment.id)) return false;
          const outcome = outcomeFor(comment);
          return match ? match(outcome) : outcome.key === key;
        });
        if (comments.length === 0) return null;
        const heading = el("h3", {}, [
          ...(spin === true ? [spinner()] : []),
          ...(glyph === undefined ? [] : [icon(glyph)]),
          el("span", { text: label }),
          document.createTextNode(" "),
          el("span", {
            class:
              "[display:inline-flex] [min-width:1.1rem] [height:1.1rem] [align-items:center] [justify-content:center] [margin-left:auto] [padding:0_0.25rem] [border-radius:999px] [background:var(--surface-c)] [font-size:0.625rem] [font-variant-numeric:tabular-nums]",
            "data-review-outcome-group-count": true,
            "aria-label":
              comments.length + " thread" + (comments.length === 1 ? "" : "s"),
            text: String(comments.length),
          }),
        ]);
        return el("section", { "data-review-outcome-group": displayKey }, [
          heading,
          el("ol", {}, comments.map(sentRow)),
        ]);
      })
      .filter(Boolean);
    const resolved = sent.filter((comment) =>
      resolvedCommentIds.has(comment.id),
    );
    if (resolved.length > 0) {
      const followsActiveGroup = renderedGroups.length > 0;
      renderedGroups.push(
        el(
          "details",
          {
            class:
              (followsActiveGroup ? "" : "mt-0! border-t-0! pt-0!") +
              " [margin-top:0.7rem] [padding-top:0.7rem] [border-top:1px_solid_var(--edge-c)]",
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

  resolveAllButton.addEventListener("click", () => {
    const ids = sent
      .filter(
        (comment) =>
          !resolvedCommentIds.has(comment.id) &&
          outcomeFor(comment).key !== "waiting",
      )
      .map((comment) => comment.id);
    if (ids.length > 0) void resolveThreadIds(ids);
  });

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
    const toolbarCount = pending > 0 ? pending : needs;
    const toolbarCountKind =
      pending > 0 ? "staged" : needs > 0 ? "needs" : "idle";
    feedbackLabel.textContent = "Feedback";
    toggleCount.textContent = toolbarCount > 0 ? String(toolbarCount) : "";
    toggleCount.setAttribute("data-review-toggle-count-kind", toolbarCountKind);
    toggleCount.setAttribute(
      "aria-label",
      pending > 0
        ? `${pending} staged comment${pending === 1 ? "" : "s"} waiting submission`
        : needs > 0
          ? `${needs} comment${needs === 1 ? "" : "s"} needs your answer`
          : "",
    );
    toggle.setAttribute(
      "data-review-has-pending",
      toolbarCount > 0 ? "true" : "false",
    );
    toggle.setAttribute("data-review-needs-answer", String(needs));
    toggle.setAttribute(
      "aria-label",
      (railIsOpen() ? "Close" : "Open") +
        " feedback sidebar" +
        (pending > 0
          ? `, ${pending} staged waiting submission`
          : needs > 0
            ? `, ${needs} needs your answer`
            : ""),
    );
    toolbar.setAttribute(
      "data-review-batch-ready",
      pending > 0 ? "true" : "false",
    );
    sendButton.hidden = pending === 0;
    sendButton.disabled = pending === 0;
    draftGroup.hidden = pending === 0;
    draftGroupCount.textContent = String(pending);
    draftGroupCount.setAttribute(
      "aria-label",
      `${pending} staged comment${pending === 1 ? "" : "s"}`,
    );
    sidebarSendButton.disabled = pending === 0;
    compactBatchMenu.hidden = pending === 0;
    compactBatchLabel.textContent = `Send ${pending} comment${pending === 1 ? "" : "s"}`;
    compactBatchMenu.open = false;
    sendBar.hidden = sendNote.textContent.trim().length === 0;
    sentGroup.hidden = sent.length === 0;
    renderSentIndex();
    renderPlanChat();
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
        target.closest("[data-review-compose]") ||
        target.closest("[data-review-row]") ||
        target.closest("[data-review-marker]") ||
        target.closest("[data-review-diff-stepper]") ||
        target.closest("dialog"))
    ) {
      return;
    }
    if (diffLens?.comment) clearDiffLens();
    expandedThreadIds.clear();
    renderTray();
  });

  // CSS highlights have no DOM event target. Hit-test pointer coordinates
  // through the same anchor ranges used by click navigation so source hover
  // can emphasize both sides of the document ↔ comment association.
  document.addEventListener("pointermove", (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest("[data-review-root]")
    ) {
      return;
    }
    const comment = commentAtDocumentPoint({
      target: event.target,
      x: event.clientX,
      y: event.clientY,
    });
    setEmphasizedComment(comment?.id || null);
  });
  document.addEventListener("pointerleave", () => {
    setEmphasizedComment(null);
  });

  document.addEventListener("click", (event) => {
    const clickedElement =
      event.target instanceof Element
        ? event.target
        : event.target?.parentElement;
    // Named highlights are paint-only; their association hit-testing must not
    // turn a real document link into a comment-card shortcut.
    if (clickedElement?.closest("a[href]")) return;
    const comment = commentAtDocumentPoint({
      target: event.target,
      x: event.clientX,
      y: event.clientY,
    });
    if (!comment) return;
    event.preventDefault();
    if (railIsOpen()) {
      revealCommentInTray(comment);
      return;
    }
    setEmphasizedComment(comment.id);
    if (sent.some((entry) => entry.id === comment.id)) {
      expandedThreadIds.add(comment.id);
    } else {
      minimizedDraftIds.delete(comment.id);
    }
    renderTray();
    requestAnimationFrame(() => {
      threadLayer
        .querySelector(
          '[data-review-comment-id="' +
            cssEscape(comment.id) +
            '"] button, ' +
            '[data-review-comment-id="' +
            cssEscape(comment.id) +
            '"] textarea',
        )
        ?.focus();
    });
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
      agentConnected = answer.agentConnected === true;
      if (isAgentRequest(answer.request)) {
        agentRequests = agentRequests.concat([answer.request]);
      }
      expandedThreadIds.add(comment.id);
      setAgentState("Agent working", "working");
      announce("Revert request sent to the coding agent.");
      revertDialog.close();
      renderTray();
      startProgress();
    } catch (error) {
      showInlineError(revertConfirm, "Couldn’t send: " + describeError(error));
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

  const describeError = (error) => {
    const message =
      error && error.message ? String(error.message) : "Something went wrong.";
    return /failed to fetch|fetch failed|networkerror/i.test(message)
      ? "The review server is offline."
      : message;
  };

  // A failed action must say so where the click happened. The note lands
  // beside the triggering control and survives until the next render.
  const showInlineError = (anchorNode, message) => {
    const parent = anchorNode.parentElement;
    if (!parent) {
      announce(message);
      return;
    }
    let note = parent.querySelector("[data-review-action-error]");
    if (!note) {
      note = el("p", {
        class:
          "[grid-column:1_/_-1] [margin:0.35rem_0_0] [padding:0.3rem_0.45rem] [border-left:2px_solid_var(--callout-danger-c)] [background:var(--callout-danger-bg)] [color:var(--callout-danger-c)] [font-size:0.6875rem] [line-height:1.4] [overflow-wrap:anywhere]",
        "data-review-action-error": true,
      });
      parent.appendChild(note);
    }
    note.textContent = message;
  };

  const clearInlineError = (anchorNode) => {
    anchorNode.parentElement
      ?.querySelector("[data-review-action-error]")
      ?.remove();
  };

  // ---------------------------------------------------------------- composing

  const composeDraftKey = (target) =>
    JSON.stringify({
      type: target?.type,
      blockId: target?.blockId,
      scope: target?.scope,
      endBlockId: target?.endBlockId,
      start: target?.start,
      end: target?.end,
      quote: target?.quote,
    });

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
    window.getSelection()?.removeAllRanges();
    attachLabel.hidden = true;
    // The affordance did its job; leaving it up would float a second control
    // over the card the reviewer is now typing in.
    affordance.hidden = true;
    composeInput.value = composeDrafts[composeDraftKey(target)] || "";
    syncComposeValidity();
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
    if (composeTarget) {
      const key = composeDraftKey(composeTarget);
      if (composeInput.value.trim() === "") delete composeDrafts[key];
      else composeDrafts[key] = composeInput.value.slice(0, BODY_LIMIT);
      writeLocalState();
    }
    compose.hidden = true;
    composeTarget = null;
    compose.removeAttribute("data-review-compose-inline");
    compose.removeAttribute("data-review-compose-floating");
    compose.removeAttribute("data-review-compose-centered");
    compose.removeAttribute("data-review-compose-placement");
    compose.removeAttribute("style");
    if (compose.parentElement !== surface) surface.appendChild(compose);
    paintTargetHighlights();
    syncFloatingMode();
    positionThreadCards();
  };

  const positionCompose = (target) => {
    const block = visualAnchorForTarget(target);
    if (!block) {
      compose.removeAttribute("style");
      compose.setAttribute("data-review-compose-centered", "");
      compose.setAttribute("data-review-compose-placement", "centered");
      return;
    }
    if (target.type !== "slide" && window.innerWidth >= 1280 && !railIsOpen()) {
      if (compose.parentElement !== threadLayer)
        threadLayer.appendChild(compose);
      compose.removeAttribute("data-review-compose-inline");
      compose.removeAttribute("data-review-compose-centered");
      compose.setAttribute("data-review-compose-floating", "");
      compose.setAttribute("data-review-compose-placement", "floating");
      positionThreadCards();
      return;
    }
    const endBlock =
      target.type === "selection" && target.endBlockId
        ? document.querySelector(
            '[data-block-id="' + cssEscape(target.endBlockId) + '"]',
          )
        : null;
    const slide =
      target.type === "slide" ? block.closest("[data-slide]") : null;
    const insertionBlock = endBlock || block;
    // A table row cannot legally own a div sibling inside tbody, so its
    // scroll container is the insertion anchor.
    const trailingAnchor =
      insertionBlock.tagName === "TR"
        ? insertionBlock.closest("[data-table-scroll-container]") ||
          insertionBlock
        : insertionBlock;
    const leadingAnchor =
      block.tagName === "TR"
        ? block.closest("[data-table-scroll-container]") || block
        : block;
    compose.removeAttribute("style");
    compose.removeAttribute("data-review-compose-centered");
    compose.removeAttribute("data-review-compose-floating");
    compose.setAttribute("data-review-compose-inline", "");
    if (slide) {
      slide.before(compose);
      compose.setAttribute("data-review-compose-placement", "before-slide");
      return;
    }
    const composeHeight = compose.offsetHeight;
    const startRect = leadingAnchor.getBoundingClientRect();
    const endRect = trailingAnchor.getBoundingClientRect();
    const roomBelow = window.innerHeight - endRect.bottom;
    const roomAbove = startRect.top - REVIEW_CONTROL_TOP;
    if (roomBelow >= composeHeight + FLOAT_CONTENT_GAP) {
      trailingAnchor.after(compose);
      compose.setAttribute("data-review-compose-placement", "after-selection");
      return;
    }
    if (roomAbove >= composeHeight + FLOAT_CONTENT_GAP) {
      leadingAnchor.before(compose);
      compose.setAttribute("data-review-compose-placement", "before-selection");
      return;
    }
    if (compose.parentElement !== surface) surface.appendChild(compose);
    compose.removeAttribute("data-review-compose-inline");
    compose.setAttribute("data-review-compose-centered", "");
    compose.setAttribute("data-review-compose-placement", "centered");
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
    delete composeDrafts[composeDraftKey(composeTarget)];
    composeInput.value = "";
    // With submit-right-away on, the very first paint of this comment must
    // already say "Sending", never a staged card with its own Submit button.
    if (submitRightAway && hasRuntime) submittingIds.add(comment.id);
    announce(
      submitRightAway
        ? "Submitting comment on " + describeTarget(composeTarget) + "."
        : "Comment added on " + describeTarget(composeTarget) + ".",
    );
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
    syncComposeSaveLabel();
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
  composeInput.addEventListener("input", () => {
    syncComposeValidity();
    if (!composeTarget) return;
    const key = composeDraftKey(composeTarget);
    if (composeInput.value === "") delete composeDrafts[key];
    else composeDrafts[key] = composeInput.value.slice(0, BODY_LIMIT);
    writeLocalState();
  });
  composeInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeCompose();
      clearReviewSelection();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveCompose();
    }
  });

  // -------------------------------------------------------------- affordance

  // The right edge the floating chrome may reach: the window, or the tray's
  // own left edge while the tray is open, so a control never lands under it.
  const rightLimit = () =>
    railIsOpen() ? rail.getBoundingClientRect().left : window.innerWidth;

  affordance.addEventListener("click", () => {
    if (pendingSelection) openCompose(pendingSelection);
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
    const rawText = rangeText(range);
    const quote = rawText.trim();
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
    if (!startBlock || !endBlock) {
      const touchedSlides = new Set(
        Array.from(document.querySelectorAll("[data-slide]"))
          .filter((slide) => {
            try {
              return range.intersectsNode(slide);
            } catch {
              return false;
            }
          })
          .map((slide) => slide),
      );
      if (touchedSlides.size > 1) return null;
    }

    const lineTarget =
      startBlock === endBlock ? lineRangeFor(range, block) : null;
    if (lineTarget) return lineTarget;

    const leadingWhitespace = rawText.length - rawText.trimStart().length;
    const trailingWhitespace = rawText.length - rawText.trimEnd().length;
    const blockLength = block.textContent?.length || 0;
    let start = block.contains(range.startContainer)
      ? textOffsetForBoundary({
          block,
          container: range.startContainer,
          offset: range.startOffset,
        })
      : 0;
    start += leadingWhitespace;
    const rangeEndBlock = endBlock || block;
    let end = rangeEndBlock.contains(range.endContainer)
      ? textOffsetForBoundary({
          block: rangeEndBlock,
          container: range.endContainer,
          offset: range.endOffset,
        })
      : rangeEndBlock.textContent?.length || blockLength;
    end = Math.max(0, end - trailingWhitespace);
    return {
      type: "selection",
      blockId: block.getAttribute("data-block-id"),
      ...(rangeEndBlock !== block
        ? { endBlockId: rangeEndBlock.getAttribute("data-block-id") }
        : {}),
      kind: kindFor(block),
      label: labelFor(block),
      section: block.getAttribute("data-block-section") || "",
      start: start,
      end: rangeEndBlock === block ? Math.max(start, end) : end,
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
    affordance.setAttribute("data-review-mode", "selection");
    affordanceLabel.hidden = false;
    affordance.setAttribute("aria-label", "Comment on the selected text");
    const width = affordance.offsetWidth || 108;
    const startBlock = blockForTarget(anchor);
    const slide = startBlock?.closest("[data-slide]");
    const slideRect = slide?.getBoundingClientRect();
    const gutterLeft = slideRect
      ? Math.min(slideRect.left, rect.left) - width - 10
      : -1;
    const hasGutter = gutterLeft >= 12;
    affordance.style.top =
      Math.max(
        REVIEW_CONTROL_TOP,
        Math.min(
          hasGutter ? rect.top : rect.bottom + 8,
          window.innerHeight - affordance.offsetHeight - FLOAT_EDGE,
        ),
      ) + "px";
    affordance.style.left = hasGutter
      ? gutterLeft + "px"
      : Math.max(12, Math.min(rect.left, rightLimit() - width - 12)) + "px";
  };

  let selectionOfferTimer = null;

  // Escape returns both native and semantic selection flows to the same quiet
  // reading state. Clearing only the Range would leave a whole-slide target
  // behind; clearing only pendingSelection would leave native selection blue.
  const clearReviewSelection = () => {
    if (selectionOfferTimer !== null) {
      window.clearTimeout(selectionOfferTimer);
      selectionOfferTimer = null;
    }
    pendingSelection = null;
    attachLabel.hidden = true;
    attachInput.checked = false;
    affordance.hidden = true;
    window.getSelection()?.removeAllRanges();
    paintTargetHighlights();
  };

  for (const slide of document.querySelectorAll("[data-slide]")) {
    const title =
      slide
        .querySelector("[data-block-section]")
        ?.getAttribute("data-block-section") || "this slide";
    const selector = el("button", {
      class:
        "[position:absolute] [top:calc(0.75rem_-_1px)] [right:calc(100%_+_0.5625rem)] [z-index:44] [display:inline-flex] [width:1.4rem] [height:1.4rem] [align-items:center] [justify-content:center] [padding:0] [border:1px_solid_transparent] [border-radius:0.3rem] [background:color-mix(in_srgb,_var(--bg)_88%,_transparent)] [color:color-mix(in_srgb,_var(--muted-c)_72%,_transparent)] [cursor:pointer] hover:[border-color:var(--edge-c)] hover:[background:var(--review-control-hover)] hover:[color:var(--accent-c)] focus-visible:[border-color:var(--edge-c)] focus-visible:[background:var(--review-control-hover)] focus-visible:[color:var(--accent-c)] focus-visible:[outline:1px_solid_var(--accent-c)] focus-visible:[outline-offset:2px] active:[background:var(--review-control-active)]",
      type: "button",
      "data-review-slide-selector": true,
      "aria-label": "Comment on all content in " + title,
    });
    selector.append(
      icon(MESSAGE_SQUARE_TEXT_ICON),
      el("span", {
        class:
          "[position:absolute] [top:calc(100%_+_0.35rem)] [right:0] [z-index:60] [width:max-content] [max-width:11rem] [padding:0.22rem_0.42rem] [border-radius:0.25rem] [background:var(--ink-c)] [color:var(--bg)] [font-size:0.66rem] [font-weight:600] [line-height:1.35] [pointer-events:none] [opacity:0] [transform:translateY(-0.1rem)] [transition:opacity_70ms_ease,_transform_70ms_ease]",
        "data-review-icon-tooltip": true,
        "aria-hidden": "true",
        text: "Comment on slide",
      }),
    );
    selector.addEventListener("mouseup", (event) => {
      event.stopPropagation();
    });
    selector.addEventListener("click", () => {
      const slideBlocks = Array.from(slide.querySelectorAll("[data-block-id]"));
      const first = slideBlocks[0];
      const kicker = slide.querySelector("[data-slide-kicker]");
      if (!first || !kicker) return;
      if (!compose.hidden) closeCompose();
      window.getSelection()?.removeAllRanges();
      const target = {
        type: "slide",
        blockId: first.getAttribute("data-block-id"),
        scope: first
          .getAttribute("data-block-id")
          .split("/")
          .slice(0, -1)
          .join("/"),
        kind: kindFor(first),
        label: labelFor(first),
        section: first.getAttribute("data-block-section") || "",
      };
      pendingSelection = target;
      attachLabel.hidden = false;
      attachInput.checked = false;
      paintTargetHighlights();
      openCompose(target);
      announce("Commenting on all content in " + title + ".");
    });
    slide.setAttribute("data-review-slide-selectable", "");
    slide.appendChild(selector);
  }

  document.addEventListener("mouseup", () => setTimeout(offerSelection, 0));
  document.addEventListener("keyup", (event) => {
    if (event.shiftKey || event.key === "Shift") setTimeout(offerSelection, 0);
  });
  document.addEventListener("selectionchange", () => {
    if (selectionOfferTimer !== null) {
      window.clearTimeout(selectionOfferTimer);
    }
    selectionOfferTimer = window.setTimeout(() => {
      selectionOfferTimer = null;
      if (!compose.hidden || document.activeElement === affordance) return;
      if (pendingSelection?.type === "slide") return;
      offerSelection();
    }, 0);
  });

  // --------------------------------------------------------- plan-wide chat

  const chatChangeControls = (event) => {
    const places = placesForEvent(event);
    if (places.length === 0) return null;
    const expanded = chatDigestExpansion.has(event.requestId)
      ? chatDigestExpansion.get(event.requestId)
      : places.length <= 3;
    const active =
      diffLens?.comment === null &&
      diffLens?.event.requestId === event.requestId;
    const disclosure = el(
      "button",
      {
        class:
          "[display:flex] [width:100%] [align-items:center] [gap:0.3rem] [padding:0.18rem_0.25rem] [border:0] [border-radius:0.25rem] [background:transparent] [color:var(--muted-c)] [font-size:0.68rem] [font-weight:750] [text-align:left] [cursor:pointer] hover:[background:var(--review-control-hover)] hover:[color:var(--accent-c)] active:[background:var(--review-control-active)]",
        type: "button",
        "data-review-chat-change-toggle": true,
        "aria-expanded": expanded ? "true" : "false",
      },
      [
        icon(CHEVRON_RIGHT_ICON),
        el("span", { text: changeSummaryText({ places, event }) }),
      ],
    );
    disclosure.addEventListener("click", () => {
      if (expanded && active) clearDiffLens();
      chatDigestExpansion.set(event.requestId, !expanded);
      renderPlanChat();
    });
    const list = el(
      "div",
      {
        class:
          "[display:grid] [grid-template-columns:minmax(0,_1fr)] [gap:0.25rem] [min-width:0]",
        "data-review-chat-change-list": true,
        ...(expanded ? {} : { hidden: true }),
      },
      [changeNavigator({ comment: null, event, places, active })],
    );
    const see = el("button", {
      class:
        "[margin-top:0.45rem] [padding:0.2rem_0.45rem] [border:1px_solid_var(--edge-c)] [border-radius:0.3rem] [background:var(--bg)] [color:var(--accent-c)] [font-size:0.6875rem] [font-weight:650] [cursor:pointer] hover:[background:var(--review-control-hover)] hover:[border-color:var(--accent-c)] active:[background:var(--review-control-active)]",
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
    return el(
      "div",
      {
        class:
          "[display:grid] [gap:0.4rem] [margin-top:0.55rem] [padding-top:0.5rem] [border-top:1px_solid_var(--edge-c)]",
        "data-review-chat-change-digest": true,
      },
      [disclosure, list, see],
    );
  };

  const livePlanChatMessages = () => {
    const messages = [];
    for (const request of agentRequests) {
      if (request.kind !== "chat") continue;
      messages.push({
        role: "user",
        body: request.body,
        createdAt: request.createdAt,
        request,
      });
      const response = agentResponses.find(
        (entry) => entry.requestId === request.requestId,
      );
      if (response && response.kind === "chat") {
        messages.push({
          role: "agent",
          body: response.message,
          messageNodes: checkedMessageNodes(response.messageNodes),
          createdAt: response.createdAt,
          event:
            request.sourceRevision !== response.sourceRevision
              ? {
                  key: "changed",
                  requestId: request.requestId,
                  fromRevision: request.sourceRevision,
                  toRevision: response.sourceRevision,
                  changes: [],
                }
              : null,
        });
      } else if (agentCancelledIds.includes(request.requestId)) {
        messages.push({
          role: "cancelled",
          createdAt: request.createdAt,
          request,
        });
      } else {
        messages.push({
          role: "waiting",
          createdAt: request.createdAt,
          request,
        });
      }
    }
    return messages;
  };

  const renderPlanChat = () => {
    const messages = hasRuntime ? livePlanChatMessages() : planChatMessages;
    if (messages.length === 0) {
      const empty = el(
        "li",
        {
          class:
            "[color:var(--muted-c)] [font-size:0.75rem] [line-height:1.45]",
          "data-review-chat-empty": true,
        },
        [
          el("p", {
            text: hasRuntime
              ? "Ask about the plan as a whole. Connection status and setup are in the Agent tab."
              : "Ask about the plan as a whole. Anchored comment threads stay beside their source.",
          }),
        ],
      );
      planChatList.replaceChildren(empty);
      return;
    }
    const rendered = messages.map((message) => {
      if (message.role === "cancelled") {
        return el(
          "li",
          {
            class:
              "[width:calc(100%_-_1.5rem)] [padding:0.5rem_0.55rem] [border:1px_solid_var(--edge-c)] [border-radius:0.45rem] [background:var(--bg)] [min-width:0] data-[review-chat-message=user]:[margin-left:1.5rem] data-[review-chat-message=user]:[border-right:2px_solid_var(--annotation-c)] data-[review-chat-message=user]:[background:color-mix(in_srgb,_var(--annotation-bg)_30%,_var(--bg))] data-[review-chat-message=agent]:[margin-right:1.5rem] data-[review-chat-message=agent]:[border-left:2px_solid_var(--callout-note-c)] data-[review-chat-message=agent]:[background:color-mix(in_srgb,_var(--callout-note-bg)_46%,_var(--bg))] data-[review-chat-message=waiting]:[border-style:dashed] data-[review-chat-message=waiting]:[color:var(--muted-c)]",
            "data-review-chat-message": "cancelled",
          },
          [cancelledRequestLine()],
        );
      }
      if (message.role === "waiting") {
        const status = pendingStatusFor(message.request, "chat");
        return el(
          "li",
          {
            class:
              "[width:calc(100%_-_1.5rem)] [padding:0.5rem_0.55rem] [border:1px_solid_var(--edge-c)] [border-radius:0.45rem] [background:var(--bg)] [min-width:0] data-[review-chat-message=user]:[margin-left:1.5rem] data-[review-chat-message=user]:[border-right:2px_solid_var(--annotation-c)] data-[review-chat-message=user]:[background:color-mix(in_srgb,_var(--annotation-bg)_30%,_var(--bg))] data-[review-chat-message=agent]:[margin-right:1.5rem] data-[review-chat-message=agent]:[border-left:2px_solid_var(--callout-note-c)] data-[review-chat-message=agent]:[background:color-mix(in_srgb,_var(--callout-note-bg)_46%,_var(--bg))] data-[review-chat-message=waiting]:[border-style:dashed] data-[review-chat-message=waiting]:[color:var(--muted-c)]",
            "data-review-chat-message": "waiting",
          },
          [threadStatusStrip(status, { surface: "tray" })],
        );
      }
      const body =
        message.role === "agent"
          ? messageBody(message.messageNodes, message.body)
          : el("p", { class: COMMENT_WRAP_CLASSES, text: message.body });
      const turn = el(
        "li",
        {
          class:
            "[width:calc(100%_-_1.5rem)] [padding:0.5rem_0.55rem] [border:1px_solid_var(--edge-c)] [border-radius:0.45rem] [background:var(--bg)] [min-width:0] data-[review-chat-message=user]:[margin-left:1.5rem] data-[review-chat-message=user]:[border-right:2px_solid_var(--annotation-c)] data-[review-chat-message=user]:[background:color-mix(in_srgb,_var(--annotation-bg)_30%,_var(--bg))] data-[review-chat-message=agent]:[margin-right:1.5rem] data-[review-chat-message=agent]:[border-left:2px_solid_var(--callout-note-c)] data-[review-chat-message=agent]:[background:color-mix(in_srgb,_var(--callout-note-bg)_46%,_var(--bg))] data-[review-chat-message=waiting]:[border-style:dashed] data-[review-chat-message=waiting]:[color:var(--muted-c)]",
          "data-review-chat-message": message.role,
        },
        [
          el(
            "div",
            {
              class:
                "[display:flex] [align-items:center] [gap:0.35rem] [color:var(--muted-c)] [font-size:0.625rem]",
              "data-review-turn-meta": true,
            },
            [
              el("strong", {
                text: message.role === "user" ? "You" : "Agent",
              }),
              el("time", {
                datetime: message.createdAt,
                text:
                  (message.role === "user"
                    ? requestDeliveryLabel(message.request) + " · "
                    : "") + relativeCommentTime(message.createdAt),
              }),
            ],
          ),
          body,
        ],
      );
      if (message.role === "agent" && message.event) {
        const controls = chatChangeControls(message.event);
        if (controls) turn.appendChild(controls);
      }
      return turn;
    });
    planChatList.replaceChildren(...rendered);
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
      agentConnected = answer.agentConnected === true;
      if (isAgentRequest(answer.request)) {
        agentRequests = agentRequests.concat([answer.request]);
      }
      agentInput.value = "";
      activeDraft = "";
      attachInput.checked = false;
      clearInlineError(agentSave);
      syncPlanChatValidity();
      writeLocalState();
      renderPlanChat();
      setAgentState("Agent working", "working");
      announce("Plan-wide question sent to the coding agent.");
      await save();
      startProgress();
    } catch (error) {
      showInlineError(
        agentSave,
        "Couldn’t send: " +
          describeError(error) +
          " Your message is preserved — try again.",
      );
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
    if (agentState.textContent !== text) agentState.textContent = text;
    if (agentState.getAttribute("data-tone") !== tone) {
      agentState.setAttribute("data-tone", tone);
    }
    if (toggle.getAttribute("data-review-agent-tone") !== tone) {
      toggle.setAttribute("data-review-agent-tone", tone);
    }
    if (toggle.title !== "Open feedback sidebar (Alt+C)") {
      toggle.title = "Open feedback sidebar (Alt+C)";
    }
  };

  const submitComments = async ({ comments, closeRailAfter, trigger }) => {
    const draftIds = new Set(drafts.map((comment) => comment.id));
    const selected = comments.filter((comment) => draftIds.has(comment.id));
    if (selected.length === 0) return false;
    if (!hasRuntime) {
      sendNote.textContent =
        "Start the local review runtime with `big-plan review " +
        "<plan.mdx>` to send. Your drafts are saved here meanwhile.";
      sendBar.hidden = false;
      return false;
    }
    trigger.disabled = true;
    sendButton.setAttribute("data-review-busy", "");
    sendNote.textContent = "";
    // The card says "Sending" for the whole round trip, so the submit-now
    // path never shows a staged view that implies nothing happened.
    for (const comment of selected) {
      submittingIds.add(comment.id);
      submitErrorById.delete(comment.id);
    }
    renderTray();
    try {
      await confirmRuntime();
      const answer = await call("/api/feedback", {
        method: "POST",
        body: { comments: selected },
      });
      agentConnected = answer.agentConnected === true;
      const submittedIds = new Set(selected.map((comment) => comment.id));
      sent = sent.concat(selected);
      const submittedRequests = (
        Array.isArray(answer.agentRequests)
          ? answer.agentRequests
          : [answer.agentRequest]
      ).filter(isAgentRequest);
      agentRequests = agentRequests.concat(submittedRequests);
      drafts = drafts.filter((comment) => !submittedIds.has(comment.id));
      for (const id of submittedIds) {
        minimizedDraftIds.delete(id);
        submittingIds.delete(id);
      }
      activeDraft = agentInput.value;
      renderTray();
      await persist();
      setAgentState(
        agentConnected ? "Waiting for agent" : "No agent connected",
        agentConnected ? "idle" : "failed",
      );
      sendNote.textContent =
        "Queued " +
        answer.comments +
        " to the agent as " +
        answer.packageId +
        ".";
      sendBar.hidden = false;
      announce("Feedback queued for the agent.");
      setActiveTab("comments");
      if (closeRailAfter) setRailOpen(false);
      startProgress();
      return true;
    } catch (error) {
      // A failed send returns the comment to staged with the failure written
      // on the card itself, never silently.
      for (const comment of selected) {
        submittingIds.delete(comment.id);
        submitErrorById.set(
          comment.id,
          "Couldn’t send: " +
            describeError(error) +
            " Your comment is still staged. Restart `big-plan review`, then open the new URL it prints.",
        );
      }
      sendNote.textContent =
        describeError(error) +
        " Restart `big-plan review`, then open the new URL it prints. Your comments are safe.";
      trigger.disabled = false;
      announce("Sending failed. The comment stays staged.");
      renderTray();
      return false;
    } finally {
      sendButton.removeAttribute("data-review-busy");
    }
  };

  // One intentional send of everything pending, with no confirmation dialog:
  // the tray already shows the count and every body about to leave.
  const submit = (trigger = sendButton) =>
    submitComments({
      comments: drafts,
      closeRailAfter: false,
      trigger,
    });

  sendButton.addEventListener("click", () => {
    void submit();
  });
  sidebarSendButton.addEventListener("click", () => {
    void submit(sidebarSendButton);
  });
  compactSendButton.addEventListener("click", () => {
    compactBatchMenu.open = false;
    void submit(compactSendButton);
  });
  compactReviewButton.addEventListener("click", () => {
    compactBatchMenu.open = false;
    setRailOpen(true);
    setActiveTab("comments");
  });

  // ----------------------------------------------------------------- progress

  const exchangeSignature = ({ requests, responses, cancelledIds = [] }) =>
    JSON.stringify([
      requests.map((request) => request.requestId),
      responses.map((response) => [response.requestId, response.createdAt]),
      cancelledIds,
    ]);

  const reloadForSourceRevision = () => {
    if (reloadKey !== null) {
      try {
        sessionStorage.setItem(
          reloadKey,
          JSON.stringify({
            scrollY: window.scrollY,
            expanded: Array.from(expandedThreadIds),
            tab:
              connectionPanel && !connectionPanel.hidden
                ? "agent"
                : chatPanel.hidden
                  ? "comments"
                  : "chat",
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
    const connectionChanged = checked.connected !== agentConnected;
    const changed =
      exchangeSignature(checked) !==
      exchangeSignature({
        requests: agentRequests,
        responses: agentResponses,
        cancelledIds: agentCancelledIds,
      });
    agentRequests = checked.requests;
    agentResponses = checked.responses;
    agentCancelledIds = checked.cancelledIds;
    agentConnected = checked.connected;
    agentHeartbeatAt = checked.updatedAtMs;
    agentSessionState = checked.state;
    agentConnectionLog = checked.connectionLog;
    agentPlanPath = checked.plan;
    agentCommand = checked.agentCommand;
    agentRecoveryPrompt = checked.recoveryPrompt;
    if (changed || connectionChanged) {
      renderTray();
      void hydrateRevisionDiffs();
    }
    if (connectionPanel && !connectionPanel.hidden) renderConnectionPanel();
    const pending = pendingAgentRequestCount();
    if (needsAnswerCount() > 0) {
      setAgentState("Needs your answer", "ready");
    } else if (pending > 0) {
      setAgentState("Agent working", "working");
    } else if (agentResponses.length > 0) {
      setAgentState("Ready to re-review", "ready");
    }
  };

  const pendingAgentRequestCount = () => {
    const answered = new Set(
      agentResponses.map((response) => response.requestId),
    );
    const cancelled = new Set(agentCancelledIds);
    return agentRequests.filter(
      (request) =>
        !answered.has(request.requestId) && !cancelled.has(request.requestId),
    ).length;
  };

  const renderProgress = (events) => {
    if (events.length === 0) return;
    progressEvents = events;
    // The old DONE/WAITING ledger had no readable story. The latest validated
    // event appears only where the reviewer is waiting: inside a chat turn or
    // an expanded anchored thread - including one expanded inside the tray,
    // so the whole tray repaints, not just the floating layer.
    renderTray();
    const last = events[events.length - 1];
    if (needsAnswerCount() > 0) {
      setAgentState("Needs your answer", "ready");
    } else if (pendingAgentRequestCount() > 0) {
      setAgentState("Agent working", "working");
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

  const AGENT_ALERT_LABELS = {
    unavailable: "No agent connected",
    quiet: "Agent not responding",
    errored: "Agent error",
    offline: "Review server offline",
  };

  const syncAgentAlert = (health) => {
    const label = health
      ? AGENT_ALERT_LABELS[health.key]
      : hasRuntime && !agentConnected
        ? AGENT_ALERT_LABELS.unavailable
        : undefined;
    const indicator = deriveAgentIndicator({
      hasRuntime,
      agentConnected,
      healthKey: health?.key,
    });
    agentOk.hidden = indicator !== "ok";
    agentAlert.hidden = indicator !== "alert";
    if (indicator !== "alert" || label === undefined) return;
    agentAlertLabel.textContent = label;
    agentAlert.setAttribute(
      "aria-label",
      label + " — open the connection status",
    );
  };

  // Re-renders the waiting chrome only when the derived health actually
  // changes, and lets a failure state own the toolbar pill until it clears.
  const syncAgentHealthPresentation = () => {
    const health = agentHealth();
    const signature = health ? health.key + "|" + (health.headline || "") : "";
    syncAgentAlert(health);
    if (health) {
      if (health.key === "offline") {
        setAgentState("Review server offline", "failed");
      } else if (health.key === "errored") {
        setAgentState("Agent needs attention", "failed");
      } else if (health.key === "unavailable") {
        setAgentState("No agent connected", "failed");
      } else if (health.key === "quiet") {
        setAgentState("Agent silent — check terminal", "idle");
      }
    }
    if (signature === lastHealthSignature) return;
    const wasFailing =
      lastHealthSignature !== "" && !lastHealthSignature.startsWith("working");
    lastHealthSignature = signature;
    if ((!health || health.key === "working") && wasFailing) {
      if (needsAnswerCount() > 0) setAgentState("Needs your answer", "ready");
      else if (pendingAgentRequestCount() > 0) {
        setAgentState("Agent working", "working");
      }
    }
    renderTray();
  };

  const startProgress = () => {
    if (progressTimer !== null || !hasRuntime) return;
    const tick = async () => {
      try {
        const [answer, exchange] = await Promise.all([
          call("/api/progress"),
          call("/api/agent"),
        ]);
        pollFailures = 0;
        if (runtimeOffline) {
          runtimeOffline = false;
          renderTray();
        }
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
        const liveTimeline = timeline.filter(isAgentWorkEvent);
        const liveLatest =
          liveTimeline.length === 0
            ? 0
            : liveTimeline[liveTimeline.length - 1].seq;
        const progressChanged = latest > progressSeq;
        if (liveLatest > liveProgressSeq) {
          liveProgressSeq = liveLatest;
          lastProgressAdvanceAt = Date.now();
        }
        if (progressChanged) {
          progressSeq = latest;
          progressEvents = timeline;
        }
        // On the first poll, establish the existing progress baseline before
        // pending requests are observed. Historical work must not claim a new
        // request merely because the page was just opened.
        applyAgentSnapshot(exchange);
        if (progressChanged) {
          renderProgress(timeline);
        }
        syncAgentHealthPresentation();
      } catch {
        // The loop keeps polling the loopback port so recovery is observed,
        // but after two straight failures the UI says so instead of waiting
        // silently on a runtime that may be gone.
        pollFailures += 1;
        if (pollFailures >= 2 && !runtimeOffline) {
          runtimeOffline = true;
          renderTray();
        }
        syncAgentHealthPresentation();
      }
    };
    progressTimer = window.setInterval(tick, PROGRESS_INTERVAL_MS);
    tick();
  };

  // ---------------------------------------------------------------- keyboard

  document.addEventListener("keydown", (event) => {
    if (event.altKey && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      if (pendingSelection) openCompose(pendingSelection);
      else setRailOpen(!railIsOpen());
    }
    if (event.key === "Escape" && diffLens) {
      event.preventDefault();
      clearDiffLens();
    } else if (event.key === "Escape" && !compose.hidden) {
      event.preventDefault();
      closeCompose();
      clearReviewSelection();
    } else if (
      event.key === "Escape" &&
      (pendingSelection !== null || !window.getSelection()?.isCollapsed)
    ) {
      event.preventDefault();
      clearReviewSelection();
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
      if (pendingSelection) {
        pendingSelection = null;
        attachLabel.hidden = true;
        affordance.hidden = true;
        window.getSelection()?.removeAllRanges();
        paintTargetHighlights();
      }
      positionMarkers();
    },
    { passive: true },
  );
  const anchoredChromeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (window.innerWidth >= 1280 && !railIsOpen()) {
            positionThreadCards();
          }
        });
  anchoredChromeObserver?.observe(document.body);

  // --------------------------------------------------------------------- boot

  const boot = async () => {
    if (!hasRuntime) {
      sendNote.textContent =
        "Reading offline: drafts stay in this browser until you run " +
        "`big-plan review`.";
      renderTray();
      if (drafts.length > 0) setRailOpen(true);
      root.setAttribute("data-review-ready", "");
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
      if (hasRuntime) startProgress();
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
    root.setAttribute("data-review-ready", "");
  };

  renderTray();
  boot();
})();
