// The diagram leg of the viewer script: the canvas a FlowDiagram becomes, the
// selection model a reviewer works through, and the proposal layer their edits
// paint.
//
// WHY IT LIVES BESIDE viewer-script.ts RATHER THAN INSIDE IT
// The shared maximize behavior is small enough to read in place; this leg is
// not, and it is the only part of the document's script that knows anything
// about one component. Keeping it in its own module lets the shell's script
// stay a list of legs.
//
// THREE IDEAS, IN ORDER
//  1. A CANVAS. Not a scrolling figure. No scrollbars in either axis: the
//     artboard is placed by one transform and the reader zooms and pans it,
//     with the trackpad gestures any canvas tool answers to - pinch to zoom,
//     two fingers to pan - plus drag and the toolbar for everyone else.
//  2. SELECTION. Not hover. Hovering says only "this is clickable". Clicking
//     selects, the selection persists, and its actions ride a bar that cannot
//     slip out from under the pointer the way a hover-revealed button did.
//  3. IN PLACE. A selected element is edited where it lives - type into it,
//     press Delete - and the proposal layer paints the result. Only a comment
//     needs a compose surface, because only a comment has nowhere to be typed.
//
// WHAT IT MAY AND MAY NOT ASSUME
// It reads two contracts it cannot import, because a string template has no
// imports: the maximize vocabulary owned by
// components/_model/figure-controls/figure-controls.ts, and the element-anchor
// attributes owned by components/flow-diagram/anchors.ts. A change to either
// spelling changes the strings here too.
//
// It never promotes or restores a figure itself. The shared leg owns that
// toggle; this one watches for the attribute and refits the canvas.
//
// THE TRANSPORT IS A STUB, ON PURPOSE
// Drafts live in memory and Send does nothing. Commenting Phase 1 owns the
// real draft store, tray, and package; this leg exists so the interaction
// design can be tried end to end before that lands, and the tray says so on
// its face rather than pretending to deliver.

import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { PENCIL_LINE_ICON } from "../../icons/lucide/pencil-line.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { lucideIconToMarkup } from "./lucide-icon-markup.js";

const ICON_COMMENT = lucideIconToMarkup(MESSAGE_SQUARE_ICON);
const ICON_EDIT = lucideIconToMarkup(PENCIL_LINE_ICON);
const ICON_DELETE = lucideIconToMarkup(TRASH_2_ICON);
const ICON_REVERT = lucideIconToMarkup(ROTATE_CCW_ICON);
const ICON_CLOSE = lucideIconToMarkup(X_ICON);

export const DIAGRAM_SCRIPT = `
(() => {
  const diagrams = Array.from(document.querySelectorAll("[data-flow-diagram]"));
  if (diagrams.length === 0) return;

  const ICON = {
    comment: '${ICON_COMMENT}',
    edit: '${ICON_EDIT}',
    del: '${ICON_DELETE}',
    revert: '${ICON_REVERT}',
    close: '${ICON_CLOSE}',
  };
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4;
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  const FIELD_LABELS = {
    label: "Label",
    code: "Identifier line",
    badge: "Badge",
    body: "Body line",
    title: "Title",
    footer: "Footer paragraph",
  };
  // How far the artboard may be pushed past the canvas edge before it stops,
  // so a diagram can never be flung out of sight.
  const PAN_MARGIN = 56;

  // Set by a pan that actually moved, read by the click that follows it.
  let suppressClick = false;

  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const quote = (v) => String.fromCharCode(8220) + v + String.fromCharCode(8221);

  // --- Announcements ----------------------------------------------------
  const live = el("div", "flow-diagram-live");
  live.setAttribute("aria-live", "polite");
  document.body.appendChild(live);
  let announceTimer = null;
  const announce = (message) => {
    live.textContent = "";
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { live.textContent = message; }, 40);
  };

  // --- Reading the diagram out of the DOM -------------------------------
  const kindOf = (n) => n.getAttribute("data-flow-element");
  const nameOf = (n) => n.getAttribute("data-flow-name") || "element";
  const anchorOf = (n) => n.getAttribute("data-flow-anchor") || "";
  const elementsIn = (diagram) =>
    Array.from(diagram.querySelectorAll("[data-flow-element]"));
  const targetsIn = (diagram) => [diagram].concat(elementsIn(diagram));
  const fieldsIn = (node) => {
    const own = [];
    for (const field of node.querySelectorAll("[data-flow-field]")) {
      if (field.closest("[data-flow-element]") === node) own.push(field);
    }
    return own;
  };
  const nodesIn = (d) => Array.from(d.querySelectorAll('[data-flow-element="node"]'));
  const edgesIn = (d) => Array.from(d.querySelectorAll('[data-flow-element="edge"]'));

  // Originals live here rather than in attributes: a proposal repaints the
  // document and must be able to put back exactly what the agent wrote.
  const originalHtml = new WeakMap();
  const originalText = new WeakMap();
  for (const diagram of diagrams) {
    for (const field of diagram.querySelectorAll("[data-flow-field]")) {
      originalHtml.set(field, field.innerHTML);
      originalText.set(field, (field.textContent || "").trim());
    }
  }
  const labelOfNode = (node) => {
    const field = node.querySelector('[data-flow-field="label"]');
    return field ? originalText.get(field) : node.getAttribute("data-flow-node");
  };

  // A node label alone rarely says where you were, so a tray line carries the
  // element's neighborhood too.
  const whereOf = (node) => {
    const kind = kindOf(node);
    const diagram = node.closest("[data-flow-diagram]");
    if (kind === "node") {
      const id = node.getAttribute("data-flow-node");
      const before = [], after = [];
      const find = (wanted) =>
        nodesIn(diagram).find((n) => n.getAttribute("data-flow-node") === wanted);
      for (const edge of edgesIn(diagram)) {
        const from = edge.getAttribute("data-flow-edge-from");
        const to = edge.getAttribute("data-flow-edge-to");
        if (to === id && find(from)) before.push(labelOfNode(find(from)));
        if (from === id && find(to)) after.push(labelOfNode(find(to)));
      }
      const parts = [];
      if (before.length) parts.push("after " + before.map(quote).join(", "));
      if (after.length) parts.push("before " + after.map(quote).join(", "));
      return parts.join(", ");
    }
    if (kind === "edge") {
      const field = node.querySelector('[data-flow-field="label"]');
      const text = field ? originalText.get(field) : "";
      return text ? "labelled " + quote(text) : "";
    }
    return node.getAttribute("data-flow-where") || "";
  };

  // --- The draft store (in memory; nothing is persisted or sent) ---------
  let drafts = [];
  let nextId = 1;
  const removalOn = (node) =>
    drafts.find((d) => d.kind === "remove-element" && d.element === node);

  // Undo is a stack of draft-list snapshots. The list is small and every
  // entry is a plain object, so a shallow copy is a complete restore point -
  // no command objects, no inverse operations to keep correct.
  const history = [];
  const pushHistory = () => {
    history.push(drafts.slice());
    if (history.length > 50) history.shift();
  };
  const undo = () => {
    if (history.length === 0) return false;
    drafts = history.pop();
    announce("Undone");
    paint();
    return true;
  };

  // --- The canvas ---------------------------------------------------------
  // One transform per diagram. Nothing scrolls; x, y and zoom are the whole
  // state, and every affordance is re-anchored from them.
  const canvas = new Map();
  for (const diagram of diagrams) {
    const viewport = diagram.querySelector("[data-flow-viewport]");
    const sizer = diagram.querySelector("[data-flow-sizer]");
    const artboard = diagram.querySelector("[data-flow-artboard]");
    if (!viewport || !sizer || !artboard) continue;
    canvas.set(diagram, { viewport, sizer, artboard, x: 0, y: 0, zoom: 1 });
    diagram.setAttribute("data-flow-canvas", "");
  }

  const applyTransform = (diagram) => {
    const c = canvas.get(diagram);
    if (!c) return;
    c.sizer.style.transform =
      "translate(" + c.x + "px," + c.y + "px) scale(" + c.zoom + ")";
    const readout = diagram.querySelector("[data-flow-zoom-readout]");
    if (readout) readout.textContent = Math.round(c.zoom * 100) + "%";
    reanchor();
  };

  const clampPan = (diagram) => {
    const c = canvas.get(diagram);
    if (!c) return;
    const vw = c.viewport.clientWidth, vh = c.viewport.clientHeight;
    const aw = c.artboard.offsetWidth * c.zoom;
    const ah = c.artboard.offsetHeight * c.zoom;
    c.x = aw <= vw
      ? clamp(c.x, -PAN_MARGIN, vw - aw + PAN_MARGIN)
      : clamp(c.x, vw - aw - PAN_MARGIN, PAN_MARGIN);
    c.y = ah <= vh
      ? clamp(c.y, -PAN_MARGIN, vh - ah + PAN_MARGIN)
      : clamp(c.y, vh - ah - PAN_MARGIN, PAN_MARGIN);
  };

  // Zoom about a point, so the artboard pixel under the pointer stays put -
  // the thing that makes pinch feel like pinch rather than like a slider.
  const zoomAbout = (diagram, nextZoom, px, py) => {
    const c = canvas.get(diagram);
    if (!c) return;
    c.userZoomed = true;
    const z1 = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
    if (z1 === c.zoom) return;
    const ratio = z1 / c.zoom;
    c.x = px - (px - c.x) * ratio;
    c.y = py - (py - c.y) * ratio;
    c.zoom = z1;
    clampPan(diagram);
    applyTransform(diagram);
    diagram.toggleAttribute("data-flow-zoomed", true);
  };

  const zoomCentered = (diagram, nextZoom) => {
    const c = canvas.get(diagram);
    if (!c) return;
    zoomAbout(diagram, nextZoom, c.viewport.clientWidth / 2, c.viewport.clientHeight / 2);
  };

  // Fit is measured when it is asked for, never at load: a figure inside a
  // collapsed slide is display:none and measures zero.
  const fit = (diagram) => {
    const c = canvas.get(diagram);
    if (!c) return;
    const vw = c.viewport.clientWidth, vh = c.viewport.clientHeight;
    const aw = c.artboard.offsetWidth, ah = c.artboard.offsetHeight;
    if (!aw || !ah || !vw || !vh) return;
    // Capped at 100 percent, so a small diagram is never blown into a poster.
    const pad = 24;
    c.zoom = clamp(Math.min((vw - pad) / aw, (vh - pad) / ah, 1), ZOOM_MIN, ZOOM_MAX);
    c.x = (vw - aw * c.zoom) / 2;
    c.y = (vh - ah * c.zoom) / 2;
    c.userZoomed = false;
    diagram.removeAttribute("data-flow-zoomed");
    applyTransform(diagram);
  };

  // An edit changes how wide a node is, which changes how much room the
  // diagram needs. A canvas the reader has not taken control of follows the
  // content; one they have zoomed themselves is left exactly where they put
  // it, because moving it under them would be worse than a little clipping.
  const refitIfUntouched = (diagram) => {
    const c = canvas.get(diagram);
    if (!c || c.userZoomed) return;
    sizeRestingCanvas(diagram);
    fit(diagram);
  };

  const stepZoom = (diagram, direction) => {
    const c = canvas.get(diagram);
    if (!c) return;
    let next;
    if (direction > 0) {
      next = ZOOM_STEPS.find((s) => s > c.zoom + 0.001);
      if (next === undefined) next = ZOOM_MAX;
    } else {
      const lower = ZOOM_STEPS.filter((s) => s < c.zoom - 0.001);
      next = lower.length ? lower[lower.length - 1] : ZOOM_MIN;
    }
    zoomCentered(diagram, next);
  };

  // At rest the canvas has no height of its own, so it takes the one the
  // fitted artboard wants - capped, because a tall diagram should not push the
  // rest of the plan off the screen.
  const sizeRestingCanvas = (diagram) => {
    const c = canvas.get(diagram);
    if (!c || diagram.hasAttribute("data-figure-maximized")) return;
    const available = c.viewport.clientWidth;
    const aw = c.artboard.offsetWidth, ah = c.artboard.offsetHeight;
    if (!aw || !ah || !available) return;
    const scale = Math.min(available / aw, 1);
    const height = Math.min(ah * scale + 24, Math.round(innerHeight * 0.7));
    c.viewport.style.height = Math.max(height, 140) + "px";
  };

  for (const diagram of diagrams) {
    const c = canvas.get(diagram);
    if (!c) continue;

    // Trackpad first: a pinch arrives as a wheel event with ctrlKey set, and
    // two-finger panning as a plain wheel with both deltas. Both are ours, so
    // both are prevented - otherwise the page scrolls out from under the
    // gesture and the browser runs its own zoom on top of it.
    c.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = c.viewport.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.01);
        zoomAbout(diagram, c.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      c.x -= event.deltaX;
      c.y -= event.deltaY;
      clampPan(diagram);
      applyTransform(diagram);
    }, { passive: false });

    // Drag to pan, for a mouse. A drag that never really moved is a click, so
    // the threshold decides between panning and selecting.
    let pan = null;
    c.viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("[data-flow-editing], button, a, select, textarea, input")) return;
      pan = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: c.x, oy: c.y, moved: false };
    });
    c.viewport.addEventListener("pointermove", (event) => {
      if (!pan || event.pointerId !== pan.id) return;
      const dx = event.clientX - pan.sx, dy = event.clientY - pan.sy;
      if (!pan.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!pan.moved) {
        pan.moved = true;
        c.viewport.setAttribute("data-flow-panning", "");
        c.viewport.setPointerCapture(pan.id);
      }
      c.x = pan.ox + dx;
      c.y = pan.oy + dy;
      clampPan(diagram);
      applyTransform(diagram);
    });
    const endPan = () => {
      if (!pan) return;
      c.viewport.removeAttribute("data-flow-panning");
      if (c.viewport.hasPointerCapture(pan.id)) c.viewport.releasePointerCapture(pan.id);
      // A pan that moved swallows the click, so dragging never also selects.
      suppressClick = pan.moved;
      pan = null;
    };
    c.viewport.addEventListener("pointerup", endPan);
    c.viewport.addEventListener("pointercancel", endPan);

    // An overflow:hidden box still scrolls when the browser pulls focus into
    // something outside it - which happens the moment a field near an edge
    // becomes editable. That silent scroll would desync every fixed
    // affordance from the artboard, so it is undone and turned into a pan.
    c.viewport.addEventListener("scroll", () => {
      if (!c.viewport.scrollLeft && !c.viewport.scrollTop) return;
      c.x -= c.viewport.scrollLeft;
      c.y -= c.viewport.scrollTop;
      c.viewport.scrollLeft = 0;
      c.viewport.scrollTop = 0;
      clampPan(diagram);
      applyTransform(diagram);
    });

    for (const button of diagram.querySelectorAll("[data-flow-zoom]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = button.getAttribute("data-flow-zoom");
        if (action === "fit") fit(diagram);
        else stepZoom(diagram, action === "in" ? 1 : -1);
      });
    }
    const zoomControls = diagram.querySelector("[data-flow-zoom-controls]");
    if (zoomControls) zoomControls.hidden = false;
    const zoomSep = diagram.querySelector("[data-flow-zoom-sep]");
    if (zoomSep) zoomSep.hidden = true;

    // The shared leg owns promoting the frame; this one only reacts, so the
    // two can never disagree about who is maximized.
    new MutationObserver(() => {
      if (diagram.hasAttribute("data-figure-maximized")) {
        c.viewport.style.height = "";
      } else {
        sizeRestingCanvas(diagram);
      }
      // The collector shows its list only when the diagram is maximized, so
      // promoting or restoring changes what it should be showing.
      renderCollector(diagram);
      requestAnimationFrame(() => fit(diagram));
    }).observe(diagram, { attributes: true, attributeFilter: ["data-figure-maximized"] });

  }

  // --- Selection ----------------------------------------------------------
  let selected = null;
  let editing = null;

  const select = (node) => {
    if (selected === node) { reanchor(); return; }
    if (selected) selected.removeAttribute("data-flow-selected");
    selected = node;
    if (selected) {
      selected.setAttribute("data-flow-selected", "");
      announce("Selected " + nameOf(selected));
    }
    buildActionBar();
  };
  const deselect = () => {
    stopEditing(true);
    if (selected) selected.removeAttribute("data-flow-selected");
    selected = null;
    buildActionBar();
  };

  for (const diagram of diagrams) {
    const c = canvas.get(diagram);
    if (!c) continue;
    c.viewport.addEventListener("click", (event) => {
      if (suppressClick) { suppressClick = false; return; }
      if (event.target.closest("[data-flow-editing]")) return;
      const node = event.target.closest("[data-flow-element]");
      if (node && node !== diagram) select(node);
      else deselect();
    });
    // Double-click goes straight into the words: the shortest path from
    // "that is wrong" to typing the right thing.
    c.viewport.addEventListener("dblclick", (event) => {
      const field = event.target.closest("[data-flow-field]");
      if (!field) return;
      const node = field.closest("[data-flow-element]");
      if (!node) return;
      event.preventDefault();
      select(node);
      startEditing(field);
    });
    // Tab reaches the figure itself, which is how the whole diagram becomes
    // commentable without every background click selecting it.
    diagram.addEventListener("focusin", (event) => {
      if (event.target === diagram) select(diagram);
    });
  }

  // --- Editing in place ---------------------------------------------------
  const startEditing = (field) => {
    if (!field) return;
    stopEditing(true);
    const node = field.closest("[data-flow-element]");
    if (removalOn(node)) return;
    editing = { field, node, before: field.textContent };
    field.setAttribute("data-flow-editing", "");
    field.setAttribute("contenteditable", "plaintext-only");
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // The bar changes what it says while a field is open, because what the
    // keyboard does has changed.
    buildActionBar();
  };

  const stopEditing = (cancel) => {
    if (!editing) return;
    const { field, node, before } = editing;
    editing = null;
    field.removeAttribute("contenteditable");
    field.removeAttribute("data-flow-editing");
    setTimeout(buildActionBar, 0);
    const next = (field.textContent || "").trim();
    const original = originalText.get(field);
    const name = field.getAttribute("data-flow-field");
    if (cancel) {
      field.textContent = before;
      paint();
      return;
    }
    // One edit per field: typing it back to what the agent wrote is not a
    // proposal, it is a change of mind, so the draft goes away entirely.
    if (next !== before.trim()) pushHistory();
    drafts = drafts.filter(
      (d) => !(d.kind === "edit-text" && d.element === node && d.fieldName === name),
    );
    if (next && next !== original) {
      drafts.push({
        id: nextId++, kind: "edit-text", diagram: node.closest("[data-flow-diagram]") || node,
        element: node, anchor: anchorOf(node), field, fieldName: name,
        before: original, after: next,
      });
      announce("Edited " + (FIELD_LABELS[name] || name).toLowerCase() + " of " + nameOf(node));
    }
    paint();
  };

  document.addEventListener("keydown", (event) => {
    // Undo first: it must work whether or not something is selected, and
    // whether or not the pointer is anywhere near the diagram.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      if (editing) return;
      if (undo()) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (editing) {
      if (event.key === "Escape") { event.stopPropagation(); stopEditing(true); }
      else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); stopEditing(false); }
      return;
    }
    if (!compose.hidden) return;
    if (!selected) return;
    const active = document.activeElement;
    if (active && active.closest && active.closest(".flow-diagram-compose, .flow-collector")) return;
    if (event.key === "Escape") { event.stopPropagation(); deselect(); return; }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (kindOf(selected) === "figure") return;
      event.preventDefault();
      toggleRemoval(selected);
      return;
    }
    if (event.key === "Enter") {
      const first = fieldsIn(selected)[0];
      if (first) { event.preventDefault(); startEditing(first); }
      return;
    }
    // Type to overwrite. A printable key on a selected element starts editing
    // its first field with that character already typed - the behaviour every
    // canvas and spreadsheet has, and the reason there is no Edit button.
    if (
      event.key.length === 1 &&
      !event.metaKey && !event.ctrlKey && !event.altKey &&
      !removalOn(selected)
    ) {
      const first = fieldsIn(selected)[0];
      if (first) {
        event.preventDefault();
        startEditing(first);
        document.execCommand("insertText", false, event.key);
      }
    }
    if (event.key.indexOf("Arrow") === 0) {
      const diagram = selected.closest("[data-flow-diagram]") || selected;
      const order = targetsIn(diagram);
      const index = order.indexOf(selected);
      const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? index + 1 : index - 1;
      if (next >= 0 && next < order.length) {
        event.preventDefault();
        select(order[next]);
        bringIntoView(order[next]);
      }
    }
  }, true);

  // Blur commits, so clicking away from a field is the same as pressing Enter.
  document.addEventListener("focusout", (event) => {
    if (editing && event.target === editing.field) {
      setTimeout(() => { if (editing && editing.field === event.target) stopEditing(false); }, 0);
    }
  });

  const toggleRemoval = (node) => {
    pushHistory();
    const existing = removalOn(node);
    if (existing) {
      drafts = drafts.filter((d) => d !== existing);
      announce("Restored " + nameOf(node));
    } else {
      // A removal supersedes text edits on the same element: two contradictory
      // instructions on one element make the agent guess.
      const withdrawn = drafts.filter((d) => d.kind === "edit-text" && d.element === node);
      drafts = drafts.filter((d) => !(d.kind === "edit-text" && d.element === node));
      const note = withdrawn.length
        ? "Withdrew " + withdrawn.length + " pending edit" + (withdrawn.length === 1 ? "" : "s") +
          " on this element (" +
          withdrawn.map((d) => (FIELD_LABELS[d.fieldName] || d.fieldName).toLowerCase()).join(", ") + ")."
        : "";
      drafts.push({
        id: nextId++, kind: "remove-element",
        diagram: node.closest("[data-flow-diagram]") || node,
        element: node, anchor: anchorOf(node), reason: "",
        consequence: consequenceOf(node), note,
      });
      announce("Deleted " + nameOf(node));
    }
    paint();
  };

  // --- Consequences -------------------------------------------------------
  const incidentEdges = (diagram, ids) =>
    edgesIn(diagram).filter(
      (e) => ids.indexOf(e.getAttribute("data-flow-edge-from")) !== -1 ||
             ids.indexOf(e.getAttribute("data-flow-edge-to")) !== -1,
    );
  const removedNodeIdsFor = (node) => {
    const kind = kindOf(node);
    if (kind === "node") return [node.getAttribute("data-flow-node")];
    if (kind === "stage") {
      const stage = node.getAttribute("data-flow-stage");
      return nodesIn(node.closest("[data-flow-diagram]"))
        .filter((n) => n.getAttribute("data-flow-in-stage") === stage)
        .map((n) => n.getAttribute("data-flow-node"));
    }
    return [];
  };
  // The compiler requires every node after the first stage to have exactly one
  // incoming edge, so a removal can leave the flow unbuildable. The reviewer
  // is told in words, from the compiled shape in the DOM.
  const consequenceOf = (node) => {
    const diagram = node.closest("[data-flow-diagram]");
    if (!diagram) return "";
    const gone = removedNodeIdsFor(node);
    const goneEdges = kindOf(node) === "edge" ? [node] : incidentEdges(diagram, gone);
    const sentences = [];
    if (kindOf(node) === "stage" && gone.length > 0) {
      sentences.push(gone.length + (gone.length === 1 ? " node loses its stage" : " nodes lose their stage"));
    }
    const orphans = [];
    for (const candidate of nodesIn(diagram)) {
      const id = candidate.getAttribute("data-flow-node");
      if (gone.indexOf(id) !== -1) continue;
      const incoming = edgesIn(diagram).filter((e) => e.getAttribute("data-flow-edge-to") === id);
      if (incoming.length === 0) continue;
      if (incoming.filter((e) => goneEdges.indexOf(e) === -1).length === 0) orphans.push(labelOfNode(candidate));
    }
    if (orphans.length > 0) {
      const named = orphans.map(quote);
      const list = named.length === 1
        ? named[0]
        : named.slice(0, -1).join(", ") + " and " + named[named.length - 1];
      sentences.push(
        "removing this leaves " + list +
        (orphans.length === 1 ? " with no incoming edge" : " with no incoming edges") +
        "; the agent will re-wire",
      );
    }
    return sentences.join("; ");
  };

  // --- The proposal layer -------------------------------------------------
  const showingOriginal = (diagram) => diagram.hasAttribute("data-flow-original");

  const clearLayer = () => {
    for (const diagram of diagrams) {
      diagram.removeAttribute("data-flow-proposed");
      for (const n of diagram.querySelectorAll("[data-flow-proposed]")) {
        n.removeAttribute("data-flow-proposed");
      }
      for (const old of diagram.querySelectorAll("[data-flow-original]")) old.remove();
      for (const field of diagram.querySelectorAll("[data-flow-edited]")) {
        field.innerHTML = originalHtml.get(field);
        field.removeAttribute("data-flow-edited");
      }
    }
  };
  const addProposedState = (node, state) => {
    const current = (node.getAttribute("data-flow-proposed") || "").split(" ").filter(Boolean);
    if (current.indexOf(state) === -1) current.push(state);
    node.setAttribute("data-flow-proposed", current.join(" "));
  };

  const baseName = new WeakMap();
  const restateName = (node, suffix) => {
    if (!baseName.has(node)) baseName.set(node, node.getAttribute("aria-label") || "");
    node.setAttribute("aria-label", (node.getAttribute("aria-label") || "") + suffix);
  };
  const resetNames = () => {
    for (const diagram of diagrams) {
      for (const node of targetsIn(diagram)) {
        if (baseName.has(node)) node.setAttribute("aria-label", baseName.get(node));
      }
    }
  };

  const paint = () => {
    clearLayer();
    resetNames();
    for (const draft of drafts) {
      if (draft.kind !== "remove-element") continue;
      if (showingOriginal(draft.diagram)) continue;
      const node = draft.element;
      addProposedState(node, "removed");
      restateName(node, ", proposed for removal");
      const diagram = node.closest("[data-flow-diagram]");
      const gone = removedNodeIdsFor(node);
      if (kindOf(node) !== "edge" && diagram) {
        for (const edge of incidentEdges(diagram, gone)) {
          addProposedState(edge, "removed-incident");
          restateName(edge, ", touches an element proposed for removal");
        }
        for (const stub of diagram.querySelectorAll("[data-flow-stub-from]")) {
          if (gone.indexOf(stub.getAttribute("data-flow-stub-from")) !== -1) {
            addProposedState(stub, "removed-incident");
          }
        }
        if (kindOf(node) === "stage") {
          for (const card of nodesIn(diagram)) {
            if (gone.indexOf(card.getAttribute("data-flow-node")) !== -1) {
              addProposedState(card, "removed-incident");
            }
          }
        }
      }
    }
    for (const draft of drafts) {
      if (draft.kind !== "edit-text") continue;
      if (showingOriginal(draft.diagram)) continue;
      const field = draft.field;
      if (!field) continue;
      field.textContent = draft.after;
      field.setAttribute("data-flow-edited", "");
      restateName(draft.element, ", edited from " + quote(draft.before));
      // The original is a clone of the field's own tag and classes, so it
      // renders in the same face and size as the text it sits beside - a
      // monospace identifier's original stays monospace. It is always shown,
      // never revealed on hover: hover may highlight an element, it may never
      // change what the element says or how tall it is.
      const struck = document.createElement(field.tagName);
      struck.className = field.className + " flow-diagram-original";
      struck.setAttribute("data-flow-original", "");
      struck.textContent = draft.before;
      if (field.parentNode) field.parentNode.insertBefore(struck, field.nextSibling);
    }
    const counts = new Map();
    for (const draft of drafts) {
      if (draft.kind !== "comment") continue;
      counts.set(draft.element, (counts.get(draft.element) || 0) + 1);
    }
    for (const entry of counts) {
      restateName(entry[0], entry[1] === 1 ? ", 1 comment" : ", " + entry[1] + " comments");
    }
    for (const diagram of diagrams) {
      const mine = drafts.filter((d) => d.diagram === diagram);
      const proposals = mine.filter((d) => d.kind !== "comment");
      diagram.toggleAttribute("data-flow-has-feedback", mine.length > 0);
      const total = diagram.querySelector("[data-flow-total]");
      if (total) {
        total.hidden = mine.length === 0;
        total.textContent = mine.length === 1 ? "1 note" : mine.length + " notes";
      }
      const group = diagram.querySelector("[data-flow-proposal-group]");
      if (group) group.hidden = proposals.length === 0;
      const zoomSep = diagram.querySelector("[data-flow-zoom-sep]");
      if (zoomSep) zoomSep.hidden = mine.length === 0;
      const revertAll = diagram.querySelector("[data-flow-revert-all]");
      if (revertAll) revertAll.hidden = proposals.length < 2;
      if (proposals.length === 0 && diagram.hasAttribute("data-flow-original")) {
        diagram.removeAttribute("data-flow-original");
        diagram.dispatchEvent(new CustomEvent("flow-original-reset"));
      }
    }
    renderTray();
    for (const diagram of diagrams) refitIfUntouched(diagram);
    buildActionBar();
    reanchor();
  };

  // --- Collision-aware placement -----------------------------------------
  // The proposal labels this engine was written for are gone: the highlight
  // and the strikethrough already say "edited" and "removed", and a pill
  // restating it was noise competing with the diagram. What remains is the
  // action bar, which still has to be placed somewhere it covers neither its
  // own selection nor a neighbouring card.
  const overlapArea = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  };

  // What an element actually occupies on screen. An edge's own rectangle is
  // mostly the invisible padding that makes a two-pixel connector clickable,
  // and treating that as a solid obstacle pushed the bar away from space it
  // could perfectly well have used.
  const obstacleRectOf = (node) => {
    if (kindOf(node) !== "edge") return node.getBoundingClientRect();
    const label = node.querySelector("[data-flow-field]");
    return label ? label.getBoundingClientRect() : null;
  };

  const placeBar = ({ bar, subject, obstacles, bounds }) => {
    const size = bar.getBoundingClientRect();
    const w = size.width, h = size.height;
    const gap = 10;
    const cx = subject.left + subject.width / 2;
    const clampedAt = (x, y) => {
      const left = clamp(x, bounds.left + 2, Math.max(bounds.left + 2, bounds.right - w - 2));
      const top = clamp(y, bounds.top + 2, Math.max(bounds.top + 2, bounds.bottom - h - 2));
      return { left, top, right: left + w, bottom: top + h, width: w, height: h };
    };
    // Just above and centred is where the captain expects it; the rest are
    // fallbacks for when that would bury a card.
    const candidates = [
      [cx - w / 2, subject.top - h - gap],
      [subject.left, subject.top - h - gap],
      [subject.right - w, subject.top - h - gap],
      [cx - w / 2, subject.bottom + gap],
      [subject.left, subject.bottom + gap],
      [subject.right + gap, subject.top + (subject.height - h) / 2],
      [subject.left - w - gap, subject.top + (subject.height - h) / 2],
    ];
    let best = null;
    candidates.forEach(([x, y], order) => {
      const rect = clampedAt(x, y);
      let cost = overlapArea(rect, subject) * 6 + order * 30;
      for (const obstacle of obstacles) cost += overlapArea(rect, obstacle) * 2;
      if (best === null || cost < best.cost) best = { rect, cost };
    });
    return best ? { x: best.rect.left, y: best.rect.top } : null;
  };

  // --- The action bar a selection offers ----------------------------------
  // WHY THIS LIVES INSIDE THE FIGURE AND NOT ON THE BODY
  // The shared maximize leg isolates a promoted figure by walking up to the
  // body and marking every sibling of that branch inert. Chrome parented to
  // the body is therefore inert whenever any figure is maximized: still
  // painted, still passing a screenshot, and completely unclickable. That is
  // the bug the captain hit on Comment, and it silently covered the composer
  // and the tray too. Overlays that belong to a diagram live inside that
  // diagram, where isolation never reaches them.
  const actionBar = el("div", "flow-diagram-actionbar");
  actionBar.hidden = true;
  // Re-parented to whichever diagram owns the current selection.
  const hostFor = (node) => {
    const diagram = node && node.closest ? node.closest("[data-flow-diagram]") : null;
    return diagram || document.body;
  };
  const adopt = (element, node) => {
    const host = hostFor(node);
    if (element.parentElement !== host) host.appendChild(element);
    // Isolation may have stamped it while it was still on the body.
    if (element.inert) element.inert = false;
  };
  document.body.appendChild(actionBar);

  const addAction = (action, icon, text, onClick, title) => {
    const button = el("button", "flow-diagram-actionbar-button");
    button.type = "button";
    button.setAttribute("data-flow-action", action);
    button.title = title || text;
    button.innerHTML = icon + "<span>" + text + "</span>";
    button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
    actionBar.appendChild(button);
  };

  const buildActionBar = () => {
    actionBar.textContent = "";
    if (!selected) { actionBar.hidden = true; return; }
    // Selection IS the edit mode. There is no Edit button and no Delete
    // button, because clicking one made this feel like a mode you enter
    // rather than a thing you have selected: with an element selected you
    // type to overwrite it and press Delete to remove it. What stays is
    // Comment, which is not direct manipulation and has nowhere else to live,
    // and Revert, which only exists once there is something to revert.
    addAction("comment", ICON.comment, "Comment", () => openCompose(selected));
    const mine = drafts.filter((d) => d.element === selected);
    if (mine.length > 0) {
      addAction("revert", ICON.revert, "Revert", () => revertElement(selected),
        "Revert every change on this element");
    }
    if (editing) {
      actionBar.appendChild(el("span", "flow-diagram-actionbar-hint",
        "Enter to save \u00b7 Esc to cancel"));
    } else if (kindOf(selected) !== "figure") {
      const canType = fieldsIn(selected).length > 0 && !removalOn(selected);
      actionBar.appendChild(el("span", "flow-diagram-actionbar-hint",
        canType ? "Type to edit \u00b7 Delete to remove" : "Delete to restore"));
    }
    adopt(actionBar, selected);
    actionBar.hidden = false;
    reanchor();
  };

  const revertElement = (node) => {
    if (!drafts.some((d) => d.element === node)) return;
    pushHistory();
    drafts = drafts.filter((d) => d.element !== node);
    announce("Reverted every change on " + nameOf(node));
    paint();
  };

  const positionActionBar = () => {
    if (!selected || actionBar.hidden) return;
    const diagram = selected.closest("[data-flow-diagram]") || selected;
    const c = canvas.get(diagram);
    const subject = selected.getBoundingClientRect();
    const size = actionBar.getBoundingClientRect();
    const bounds = c ? c.viewport.getBoundingClientRect()
                     : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if (c && (subject.bottom < bounds.top || subject.top > bounds.bottom)) {
      actionBar.style.visibility = "hidden";
      return;
    }
    actionBar.style.visibility = "visible";
    // The bar dodges the cards and the verb chips, not the small-caps stage
    // headers. It is transient chrome the reviewer summoned deliberately, and
    // treating an 11-pixel heading as something worth being pushed below the
    // selection for is how it once ended up below when the captain asked for
    // above.
    const obstacles = (c ? elementsIn(diagram) : [])
      .filter((n) => n !== selected && (kindOf(n) === "node" || kindOf(n) === "edge"))
      .map(obstacleRectOf)
      .filter((r) => r !== null);
    const room = {
      left: Math.max(bounds.left - 8, 8),
      top: Math.max(bounds.top - 44, 8),
      right: Math.min(bounds.right + 8, innerWidth - 8),
      bottom: Math.min(bounds.bottom + 44, innerHeight - 8),
    };
    const best = placeBar({ bar: actionBar, subject, obstacles, bounds: room });
    actionBar.style.left = (best ? best.x : subject.left) + "px";
    actionBar.style.top = (best ? best.y : subject.top - size.height - 6) + "px";
  };

  // A diagram inside a collapsed slide is display:none. Its overlays are
  // children of the body, so nothing takes them away with it - which is how a
  // comment card ended up floating over the collapsed sections after the
  // diagram it belonged to was gone. Visibility is checked on every reanchor,
  // and a host that has left the screen takes its chrome with it.
  const onScreen = (node) =>
    node.isConnected && node.getClientRects().length > 0;

  const dismissOrphanedChrome = () => {
    if (selected && !onScreen(selected)) {
      if (editing) stopEditing(true);
      selected.removeAttribute("data-flow-selected");
      selected = null;
      actionBar.hidden = true;
      actionBar.textContent = "";
    }
    if (composeSubject && !onScreen(composeSubject)) closeCompose();
  };

  // Everything anchored to the artboard is re-placed together, because every
  // one of them moves when the canvas does.
  let reanchorScheduled = false;
  const reanchor = () => {
    if (reanchorScheduled) return;
    reanchorScheduled = true;
    requestAnimationFrame(() => {
      reanchorScheduled = false;
      dismissOrphanedChrome();
      positionActionBar();
      positionCompose();
    });
  };

  const bringIntoView = (node) => {
    const diagram = node.closest("[data-flow-diagram]");
    const c = diagram ? canvas.get(diagram) : null;
    if (!c) return;
    const subject = node.getBoundingClientRect();
    const bounds = c.viewport.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (subject.left < bounds.left + 16) dx = bounds.left + 16 - subject.left;
    if (subject.right > bounds.right - 16) dx = bounds.right - 16 - subject.right;
    if (subject.top < bounds.top + 16) dy = bounds.top + 16 - subject.top;
    if (subject.bottom > bounds.bottom - 16) dy = bounds.bottom - 16 - subject.bottom;
    if (dx || dy) {
      c.x += dx; c.y += dy;
      clampPan(diagram);
      applyTransform(diagram);
    }
  };

  // --- Comment compose ----------------------------------------------------
  // The one surface that survives the redesign: a comment has nowhere in the
  // diagram to be typed, so it gets a card. Edits and deletions do not.
  const compose = el("div", "flow-diagram-compose");
  compose.hidden = true;
  compose.setAttribute("role", "dialog");
  document.body.appendChild(compose);
  let composeSubject = null;

  const closeCompose = () => {
    compose.hidden = true;
    compose.textContent = "";
    composeSubject = null;
  };

  const positionCompose = () => {
    if (compose.hidden || !composeSubject) return;
    const subject = composeSubject.getBoundingClientRect();
    const size = compose.getBoundingClientRect();
    compose.style.left = clamp(subject.left, 8, innerWidth - size.width - 8) + "px";
    const below = subject.bottom + 8;
    compose.style.top =
      (below + size.height > innerHeight - 8
        ? clamp(subject.top - size.height - 8, 8, innerHeight - size.height - 8)
        : below) + "px";
  };

  const openCompose = (node) => {
    compose.textContent = "";
    composeSubject = node;
    compose.appendChild(el("p", "flow-diagram-compose-target", "Comment on " + nameOf(node)));
    const textarea = document.createElement("textarea");
    textarea.placeholder = "Write a comment...";

    const submit = () => {
      const value = textarea.value.trim();
      if (!value) { textarea.focus(); return; }
      pushHistory();
      drafts.push({
        id: nextId++, kind: "comment",
        diagram: node.closest("[data-flow-diagram]") || node,
        element: node, anchor: anchorOf(node), body: value,
      });
      announce("Comment saved on " + nameOf(node));
      closeCompose();
      paint();
    };

    // Cmd+Enter on a Mac, Ctrl+Enter elsewhere. Plain Enter stays a newline,
    // because a comment is prose and prose has paragraphs.
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      event.stopPropagation();
      submit();
    });
    compose.appendChild(textarea);

    const row = el("div", "flow-diagram-compose-row");
    const shortcut = navigator.platform.indexOf("Mac") === 0 ? "Cmd" : "Ctrl";
    row.appendChild(el("span", "flow-diagram-compose-hint", shortcut + "+Enter to comment"));
    const cancel = el("button", "flow-diagram-button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeCompose);
    const save = el("button", "flow-diagram-button", "Comment");
    save.type = "button";
    save.setAttribute("data-variant", "primary");
    save.addEventListener("click", submit);
    row.appendChild(cancel);
    row.appendChild(save);
    compose.appendChild(row);

    adopt(compose, node);
    compose.hidden = false;
    positionCompose();
    textarea.focus();
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || compose.hidden) return;
    event.stopPropagation();
    closeCompose();
    if (selected) selected.focus({ preventScroll: true });
  }, true);

  // --- The diagram's own feedback collector -------------------------------
  // TWO LEVELS THAT MUST NOT COLLAPSE
  // A diagram holds the notes made on ITS elements. The page holds the one
  // feedback package that goes to the agent. The diagram is a source feeding
  // that package - never a second channel - so nothing here sends anything;
  // the only outbound action hands this diagram's batch to the page-level
  // collector, which owns the single Send.
  //
  // Each diagram gets its own collector, parented inside its own figure. That
  // is what makes two diagrams on one page work: notes have an owner, and the
  // chrome is never isolated by another figure being maximized.
  const KIND_LABEL = { comment: "Comment", "edit-text": "Edit", "remove-element": "Delete" };
  const collectors = new Map();

  // The seam the commenting work connects to. It is deliberately explicit and
  // deliberately honest: if the page-level collector is not present, this says
  // so and keeps the notes. It never reports success it did not have.
  const pageCollector = () =>
    (window.bigPlan && window.bigPlan.feedback) || null;

  const buildCollector = (diagram) => {
    const root = el("aside", "flow-collector");
    root.hidden = true;
    root.setAttribute("aria-label", "Feedback on this diagram");

    const head = el("div", "flow-collector-head");
    const title = el("div", "");
    title.appendChild(el("span", "", "Feedback on this diagram"));
    const scope = el("span", "flow-collector-scope",
      diagram.getAttribute("data-flow-scope") || "This diagram");
    title.appendChild(scope);
    head.appendChild(title);
    const count = el("span", "flow-collector-count", "0");
    head.appendChild(count);
    root.appendChild(head);

    const list = el("ul", "flow-collector-list");
    root.appendChild(list);

    const foot = el("div", "flow-collector-foot");
    const note = el("p", "flow-collector-note",
      "These notes belong to this diagram. Adding them puts them in the plan's feedback package, which is sent once, from the page.");
    foot.appendChild(note);
    const status = el("p", "flow-collector-status");
    status.hidden = true;
    foot.appendChild(status);
    root.appendChild(foot);

    // The primary action, in both the inline and the maximized presentation.
    const add = el("button", "flow-collector-add");
    add.type = "button";
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      handOff(diagram, status);
    });

    diagram.appendChild(root);
    diagram.appendChild(add);
    collectors.set(diagram, { root, list, count, add, status, scope });
  };

  const handOff = (diagram, status) => {
    const mine = drafts.filter((d) => d.diagram === diagram);
    if (mine.length === 0) return;
    const target = pageCollector();
    status.hidden = false;
    if (!target || typeof target.add !== "function") {
      // Never pretend. The notes stay exactly where they are.
      status.setAttribute("data-tone", "unavailable");
      collectors.get(diagram).statusFor = mine.length;
      status.textContent =
        "The plan's feedback package is not available in this preview, so nothing was added. " +
        (mine.length === 1 ? "Your note is" : "Your " + mine.length + " notes are") +
        " still here.";
      announce("The plan's feedback package is not available; nothing was added");
      return;
    }
    target.add({
      source: "flow-diagram",
      anchor: diagram.getAttribute("data-flow-anchor"),
      items: mine.map((d) => ({
        kind: d.kind, anchor: d.anchor, field: d.fieldName,
        before: d.before, after: d.after, body: d.body,
        reason: d.reason, consequence: d.consequence,
      })),
    });
    drafts = drafts.filter((d) => d.diagram !== diagram);
    status.setAttribute("data-tone", "added");
    collectors.get(diagram).statusFor = 0;
    status.textContent = "Added " + mine.length + " note" + (mine.length === 1 ? "" : "s") +
      " to the plan's feedback package.";
    announce("Added " + mine.length + " notes to the plan feedback package");
    paint();
  };

  const renderCollector = (diagram) => {
    const c = collectors.get(diagram);
    if (!c) return;
    const mine = drafts.filter((d) => d.diagram === diagram);
    const maximized = diagram.hasAttribute("data-figure-maximized");

    c.list.textContent = "";
    for (const draft of mine) {
      const item = el("li", "flow-collector-item");
      const line = el("div", "flow-collector-item-head");
      const target = el("button", "flow-collector-target", "Flow: " + nameOf(draft.element));
      target.type = "button";
      target.addEventListener("click", (event) => {
        event.stopPropagation();
        select(draft.element);
        bringIntoView(draft.element);
      });
      line.appendChild(target);
      const kind = el("span", "flow-collector-kind",
        draft.kind === "edit-text"
          ? KIND_LABEL[draft.kind] + " " + (FIELD_LABELS[draft.fieldName] || draft.fieldName).toLowerCase()
          : KIND_LABEL[draft.kind]);
      kind.setAttribute("data-kind", draft.kind);
      line.appendChild(kind);
      item.appendChild(line);
      if (draft.kind === "edit-text") {
        const value = el("div", "flow-collector-value");
        value.appendChild(el("s", "", draft.before));
        value.appendChild(document.createTextNode(" " + String.fromCharCode(8594) + " " + draft.after));
        item.appendChild(value);
      }
      if (draft.body) item.appendChild(el("div", "flow-collector-value", draft.body));
      if (draft.consequence) item.appendChild(el("div", "flow-collector-value", "Consequence: " + draft.consequence));
      if (draft.note) item.appendChild(el("div", "flow-collector-note-line", draft.note));
      const revert = el("button", "flow-collector-revert", "Revert");
      revert.type = "button";
      revert.addEventListener("click", (event) => {
        event.stopPropagation();
        pushHistory();
        drafts = drafts.filter((d) => d !== draft);
        announce("Reverted " + KIND_LABEL[draft.kind].toLowerCase() + " on " + nameOf(draft.element));
        paint();
      });
      item.appendChild(revert);
      c.list.appendChild(item);
    }

    c.count.textContent = String(mine.length);
    c.add.textContent = mine.length === 1
      ? "Add 1 note to plan feedback"
      : "Add " + mine.length + " notes to plan feedback";
    // No note, no button. Inline shows only the button; the list is the
    // maximized view's job, so the reading column never sprouts a tray.
    c.add.hidden = mine.length === 0;
    c.root.hidden = mine.length === 0 || !maximized;
    // The status describes one attempt at one batch. Once the batch changes it
    // is describing something that no longer exists, so it goes.
    if (c.statusFor !== mine.length) {
      c.status.hidden = true;
      c.status.textContent = "";
      c.status.removeAttribute("data-tone");
    }
    if (c.add.inert) c.add.inert = false;
    if (c.root.inert) c.root.inert = false;
  };

  const renderTray = () => {
    for (const diagram of diagrams) renderCollector(diagram);
  };

  // --- Figure-level proposal chrome --------------------------------------
  for (const diagram of diagrams) {
    const showOriginal = diagram.querySelector("[data-flow-show-original]");
    if (showOriginal) {
      // The label names what the click will do, and flips on every
      // activation, so the reader can always tell which view they are in and
      // how to get back. The accessible name says the same words.
      const labelSpan = showOriginal.querySelector("span") || showOriginal;
      const setToggleLabel = (on) => {
        const text = on ? "Show changes" : "Show original";
        labelSpan.textContent = text;
        showOriginal.setAttribute("aria-label", text);
        showOriginal.setAttribute("title", text);
        showOriginal.setAttribute("aria-pressed", on ? "true" : "false");
      };
      setToggleLabel(false);
      showOriginal.addEventListener("click", (event) => {
        event.stopPropagation();
        const on = !showingOriginal(diagram);
        diagram.toggleAttribute("data-flow-original", on);
        setToggleLabel(on);
        paint();
        announce(on ? "Showing the original diagram" : "Showing your changes");
      });
      diagram.addEventListener("flow-original-reset", () => setToggleLabel(false));
    }
    const revertAll = diagram.querySelector("[data-flow-revert-all]");
    if (revertAll) {
      revertAll.addEventListener("click", (event) => {
        event.stopPropagation();
        const count = drafts.filter((d) => d.diagram === diagram && d.kind !== "comment").length;
        pushHistory();
        drafts = drafts.filter((d) => !(d.diagram === diagram && d.kind !== "comment"));
        announce("Reverted " + count + " proposals in this diagram");
        paint();
      });
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (compose.contains(event.target) || actionBar.contains(event.target)) return;
    if (event.target.closest && event.target.closest(".flow-collector, .flow-collector-add")) return;
    if (event.target.closest("[data-flow-diagram]")) return;
    closeCompose();
    deselect();
  });
  for (const diagram of diagrams) buildCollector(diagram);

  // First layout runs last: fitting the canvas re-anchors the action bar, so
  // it has to exist before anything is fitted.
  for (const diagram of diagrams) {
    sizeRestingCanvas(diagram);
    fit(diagram);
  }

  // Collapsing a slide changes no attribute on the diagram itself, so the
  // teardown is driven by what actually changed: the size of its host.
  if (typeof ResizeObserver === "function") {
    const sizes = new ResizeObserver(() => reanchor());
    for (const diagram of diagrams) sizes.observe(diagram);
  }

  addEventListener("scroll", reanchor, { passive: true, capture: true });
  addEventListener("resize", () => {
    for (const diagram of diagrams) sizeRestingCanvas(diagram);
    reanchor();
  }, { passive: true });
})();
`;
