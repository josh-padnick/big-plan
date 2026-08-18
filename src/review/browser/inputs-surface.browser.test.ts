// @vitest-environment happy-dom
//
// Proves the Inputs panel as the reviewer meets it: what it shows for a
// contract the runtime answered, what it shows when nobody answered, and that
// it catches up when this page applies a newer answers record.
//
// The last of those is why this test mounts the review island rather than
// calling the panel's own helpers. The chain it protects runs through two
// modules that never reference each other - the controller applies the answers
// record, the panel hears that it did - and every link is silent when it
// breaks: the panel simply keeps showing a review the decision cards have
// already moved past. So the controller and the panel are mounted together and
// driven through the runtime responses they really read.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffTourProvider } from "./diff-tour.browser.js";
import { InputsSurface } from "./inputs-surface.browser.js";
import { ReviewController } from "./review-controller.browser.js";

const DECISION_ID = "quick-decision-do-we-ship-behind-a-flag";

const contractResponse = ({
  revision,
  state,
  detail,
}: {
  readonly revision: number;
  readonly state: string;
  readonly detail: string;
}) => ({
  revision,
  inputs: [
    {
      inputId: DECISION_ID,
      label: "Do we ship behind a flag?",
      isCritical: true,
      state,
      detail,
    },
  ],
});

const answersResponse = (revision: number) => ({
  revision,
  supersededDecisionIds: [],
  answers: [
    {
      decisionId: DECISION_ID,
      optionId: `${DECISION_ID}-option-yes`,
      optionTitle: "Yes",
      prompt: "Do we ship behind a flag?",
      answeredAt: "2026-08-18T00:00:00.000Z",
      premiseSnapshot: "0123456789abcdef",
      decisionDigest: "fedcba9876543210",
    },
  ],
});

let mounted: Root | null = null;

afterEach(async () => {
  if (mounted !== null) {
    const root = mounted;
    mounted = null;
    await act(async () => {
      root.unmount();
    });
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/**
 * A served review page: the runtime identity the document carries, and a
 * runtime that answers the paths this page asks for.
 */
const servedPage = (answer: (path: string) => unknown): void => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const root = document.documentElement;
  root.setAttribute("data-plan-id", "plan-one");
  root.setAttribute("data-review-session", "session-one");
  root.setAttribute("data-review-token", "token-one");
  vi.stubGlobal("fetch", (path: string) => {
    const value = answer(String(path));
    return value === undefined
      ? Promise.reject(new Error("The review runtime did not answer"))
      : Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(value),
        });
  });
};

/** Mounts a tree the way the review island does, and settles its first reads. */
const show = async (
  tree: ReturnType<typeof createElement>,
): Promise<Element> => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = root;
  await act(async () => {
    root.render(tree);
  });
  for (let settle = 0; settle < 5; settle += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return container;
};

const panelText = (container: Element): string =>
  container.querySelector("#review-panel-inputs")?.textContent ?? "";

describe("the Inputs panel", () => {
  it("should show every input the runtime says the review is waiting for", async () => {
    servedPage((path) =>
      path === "/api/input-contract"
        ? contractResponse({
            revision: 0,
            state: "unanswered",
            detail: "No answer recorded",
          })
        : {},
    );

    const container = await show(createElement(InputsSurface));

    expect(panelText(container)).toContain("Do we ship behind a flag?");
    expect(panelText(container)).toContain("Not answered");
    expect(panelText(container)).toContain("1 critical input is still open");
    expect(
      container.querySelector(`[data-review-input="${DECISION_ID}"]`),
    ).not.toBeNull();
  });

  // The panel and the decision cards are driven by the same record, so the
  // page applying a newer copy of it is exactly when the panel is out of date.
  it("should catch up when this page applies a newer answers record", async () => {
    let contractReads = 0;
    servedPage((path) => {
      if (path === "/api/review-state") return answersResponse(0);
      if (path !== "/api/input-contract") return {};
      contractReads += 1;
      return contractReads === 1
        ? contractResponse({
            revision: 0,
            state: "unanswered",
            detail: "No answer recorded",
          })
        : contractResponse({
            revision: 1,
            state: "answered",
            detail: "Answered: Yes",
          });
    });

    const container = await show(
      createElement(
        DiffTourProvider,
        null,
        createElement(ReviewController),
        createElement(InputsSurface),
      ),
    );

    expect(panelText(container)).toContain("Answered: Yes");
    expect(panelText(container)).toContain("1 of 1 answered");
    expect(panelText(container)).not.toContain("Not answered");
  });

  it("should say nobody answered rather than claim it is still reading", async () => {
    servedPage((path) => (path === "/api/input-contract" ? undefined : {}));

    const container = await show(createElement(InputsSurface));

    expect(panelText(container)).toContain(
      "Could not read what this review needs",
    );
    expect(panelText(container)).not.toContain("Reading what this review");
    expect(panelText(container)).not.toContain("This plan asks nothing of you");
    expect(panelText(container)).not.toContain("Nothing yet");
  });

  it("should read again when the reviewer asks it to", async () => {
    let answered = false;
    servedPage((path) => {
      if (path !== "/api/input-contract") return {};
      if (!answered) {
        answered = true;
        return undefined;
      }
      return contractResponse({
        revision: 0,
        state: "unanswered",
        detail: "No answer recorded",
      });
    });

    const container = await show(createElement(InputsSurface));
    const retry = container.querySelector<HTMLButtonElement>(
      "[data-review-input-unavailable] button",
    );
    expect(retry).not.toBeNull();

    await act(async () => {
      retry?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(panelText(container)).toContain("Do we ship behind a flag?");
    expect(panelText(container)).not.toContain(
      "Could not read what this review needs",
    );
  });
});
