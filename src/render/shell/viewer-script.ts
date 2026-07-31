// The one script a rendered document ships, carrying the viewer enhancements:
// a scroll-spy that marks the section being read with aria-current on its TOC
// links (falling back to the overview links above the first section), hover
// popovers that float [data-info-popover] disclosures beside their triggers,
// positioned to stay inside the viewport, and a decision matrix's column
// highlight, rationale swap, and confirm step. Plan content never contributes
// script, and every affordance keeps a no-JS fallback.
export const VIEWER_SCRIPT = `<script>
(() => {
  const links = Array.from(document.querySelectorAll("[data-section-link]"));
  const overviewLinks = Array.from(
    document.querySelectorAll("[data-overview-link]"),
  );
  const targets = new Map();
  for (const link of links) {
    const id = decodeURIComponent((link.getAttribute("href") || "").slice(1));
    const heading = document.getElementById(id);
    if (heading === null) continue;
    targets.set(heading, (targets.get(heading) || []).concat(link));
  }
  const headings = Array.from(targets.keys());
  if (headings.length === 0) return;
  const apply = () => {
    const readingLine = window.innerHeight * 0.25;
    let current = null;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= readingLine) current = heading;
    }
    for (const [heading, sectionLinks] of targets) {
      for (const link of sectionLinks) {
        if (heading === current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    }
    for (const link of overviewLinks) {
      if (current === null) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  apply();
})();
(() => {
  const infos = document.querySelectorAll("details[data-info-popover]");
  for (const info of infos) {
    const summary = info.querySelector("summary");
    const body = info.querySelector("[data-info-popover-body]");
    if (summary === null || body === null) continue;
    info.setAttribute("data-info-popover-floating", "");
    const open = () => {
      info.open = true;
      const anchor = summary.getBoundingClientRect();
      body.style.left = "0px";
      body.style.top = "0px";
      const size = body.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(
          anchor.left + anchor.width / 2 - size.width / 2,
          innerWidth - size.width - 8,
        ),
      );
      const below = anchor.bottom + 6;
      const top =
        below + size.height > innerHeight - 8
          ? Math.max(8, anchor.top - size.height - 6)
          : below;
      body.style.left = left + "px";
      body.style.top = top + "px";
    };
    const close = () => {
      info.open = false;
    };
    info.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") open();
    });
    info.addEventListener("pointerleave", () => {
      if (!info.matches(":focus-within")) close();
    });
    summary.addEventListener("focus", () => {
      if (summary.matches(":focus-visible")) open();
    });
    info.addEventListener("focusout", (event) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !info.contains(event.relatedTarget)
      )
        close();
    });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (info.open) close();
      else open();
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    document.addEventListener(
      "scroll",
      () => {
        if (info.open) open();
      },
      { capture: true, passive: true },
    );
  }
})();
(() => {
  // Decision matrices. Native radios already own picking an option and the
  // selected column header, so this leg adds only what markup cannot express:
  // highlighting the whole column, swapping the rationale panel without
  // moving the page, gating the confirm action, and the answered state.
  for (const decision of document.querySelectorAll(
    "[data-decision-selector]",
  )) {
    // A Decision may sit inside another Decision's context, so every lookup
    // is scoped to the nearest owning selector. Without this an outer
    // Decision binds the inner one's controls and the two corrupt each other.
    const mine = (node) =>
      node !== null && node.closest("[data-decision-selector]") === decision;
    const own = (selector) => {
      const found = decision.querySelector(selector);
      return mine(found) ? found : null;
    };
    const ownAll = (selector) =>
      Array.from(decision.querySelectorAll(selector)).filter(mine);

    const confirm = own("[data-decision-confirm]");
    const change = own("[data-decision-change]");
    const footer = own("[data-decision-footer]");
    const answer = own("[data-decision-answer]");
    const answerTitle = own("[data-decision-answer-title]");
    const answerLead = own("[data-decision-answer-lead]");
    const summary = own("[data-decision-selection-summary]");
    const rationale = own("[data-decision-rationale]");
    const question = own("[data-decision-question]");
    const proposalText = own("[data-decision-proposal-text]");
    const propose = own("[data-option-proposal]");
    if (confirm === null || change === null || answer === null) continue;
    const choices = ownAll("[data-decision-choice]");
    const panels = ownAll("[data-rationale-panel]");
    const cells = ownAll("[data-decision-column]");
    const columnHeaders = ownAll(".decision-column");
    const compareZones = ownAll("[data-decision-compare]");
    const explainZone = own("[data-decision-explain]");
    const picked = () => choices.find((choice) => choice.checked) || null;
    const proposes = (choice) =>
      choice instanceof Element &&
      choice.hasAttribute("data-decision-proposal-choice");
    const proposalValue = () =>
      proposalText === null ? "" : proposalText.value.trim();

    // Overlapping the panels freezes the region at the tallest one, so from
    // here on swapping the visible panel cannot move anything below it.
    if (rationale !== null) rationale.setAttribute("data-rationale-live", "");
    const defaultIndex =
      rationale === null ? "0" : rationale.getAttribute("data-default-index");

    const showPanel = (index) => {
      for (const panel of panels) {
        const shown = panel.getAttribute("data-option-index") === index;
        if (shown) panel.setAttribute("data-rationale-shown", "");
        else panel.removeAttribute("data-rationale-shown");
      }
    };
    const paintColumn = (index, settled) => {
      for (const cell of cells) {
        const on = index !== null && cell.getAttribute("data-decision-column") === index;
        if (on) cell.setAttribute("data-column-selected", "");
        else cell.removeAttribute("data-column-selected");
        if (on && settled) cell.setAttribute("data-column-settled", "");
        else cell.removeAttribute("data-column-settled");
      }
    };
    const sync = () => {
      const choice = picked();
      const proposing = proposes(choice);
      const index = choice === null ? null : choice.getAttribute("data-option-index");
      showPanel(index === null ? defaultIndex : index);
      paintColumn(index, false);
      confirm.textContent = proposing ? "Submit proposal" : "Confirm choice";
      confirm.disabled =
        choice === null || (proposing && proposalValue() === "");
      if (summary !== null) {
        summary.textContent =
          choice === null
            ? "Nothing selected yet."
            : proposing
              ? "Your own approach selected."
              : choice.value + " selected.";
      }
    };
    decision.addEventListener("change", (event) => {
      if (!mine(event.target)) return;
      sync();
      if (proposes(event.target) && proposalText !== null) proposalText.focus();
    });
    if (proposalText !== null) proposalText.addEventListener("input", sync);

    const compress = (answered) => {
      if (footer !== null) footer.hidden = answered;
      answer.hidden = !answered;
      const choice = picked();
      const proposing = proposes(choice);
      const index =
        choice === null ? null : choice.getAttribute("data-option-index");
      // A proposal is not one of the columns, so compressing to it means
      // retiring the comparison entirely and leaving the reader's own words
      // standing. Hiding columns by index would strand the criterion labels
      // beside an unrelated rationale.
      const retireComparison = answered && proposing;
      for (const zone of compareZones) zone.hidden = retireComparison;
      if (explainZone !== null) explainZone.hidden = retireComparison;
      // The propose block carries the recorded proposal, so it survives a
      // proposal answer and only retires when a column won.
      if (propose !== null) propose.hidden = answered && !proposing;
      // Answering with a column drops the ones the reader turned down, so the
      // record reads as one option against the criteria, not a live matrix.
      for (const cell of cells) {
        const kept = cell.getAttribute("data-decision-column") === index;
        cell.hidden = answered && !proposing && !kept;
      }
      for (const header of columnHeaders) {
        if (answered && !proposing && header.getAttribute("data-decision-column") === index) {
          header.setAttribute("data-option-chosen", "");
        } else if (answered) {
          header.removeAttribute("data-option-chosen");
        }
      }
      paintColumn(proposing ? null : index, answered);
    };

    confirm.addEventListener("click", () => {
      const choice = picked();
      if (choice === null || confirm.disabled) return;
      const proposing = proposes(choice);
      if (answerLead !== null) {
        answerLead.textContent = proposing
          ? "Proposal recorded"
          : "Answer recorded";
      }
      if (answerTitle !== null) {
        answerTitle.textContent =
          ": " + (proposing ? proposalValue() : choice.value);
      }
      if (proposalText !== null) proposalText.readOnly = proposing;
      decision.setAttribute("data-decision-answered", "");
      compress(true);
      // The transport carrying an answer back to the agent belongs to the
      // review commenting runtime. Until it lands, the answer is announced on
      // the document and queued where that runtime can drain it.
      const record = {
        decision: decision.id,
        question: question === null ? "" : question.textContent,
        option: choice.value,
        proposal: proposing ? proposalValue() : "",
      };
      window.bigPlanDecisionAnswers = window.bigPlanDecisionAnswers || [];
      window.bigPlanDecisionAnswers.push(record);
      document.dispatchEvent(
        new CustomEvent("bigplan:decision-answered", { detail: record }),
      );
      change.focus();
    });
    change.addEventListener("click", () => {
      decision.removeAttribute("data-decision-answered");
      for (const header of columnHeaders) {
        header.removeAttribute("data-option-chosen");
      }
      compress(false);
      if (proposalText !== null) proposalText.readOnly = false;
      sync();
      const choice = picked();
      if (choice !== null) choice.focus();
    });
    sync();
  }
})();
</script>`;
