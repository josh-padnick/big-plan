import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentStatePill, RequestStatusStrip } from "./agent-message.browser.js";

describe("request status strip", () => {
  it("should show queue position when another request is ahead", () => {
    const html = renderToStaticMarkup(
      createElement(RequestStatusStrip, {
        status: {
          stage: "waiting",
          label: "Queued, 2 ahead",
          headline: "Waiting - the agent is working on another request",
          detail: "",
          tone: "neutral",
        },
        activity: [],
        surface: "chat",
        onShowAgent: () => undefined,
      }),
    );

    expect(html).toContain("Queued, 2 ahead");
    expect(html).toContain("Waiting - the agent is working on another request");
  });
});

// BIG-147. Past the recovery horizon the strip's own copy sends the reviewer to
// the Agent tab, so it has to carry the route there, and it must not read like
// an agent that fell quiet ninety seconds ago.
describe("an abandoned request", () => {
  const abandoned = {
    stage: "stalled",
    label: "No longer reporting",
    headline: "No progress for 40m",
    detail:
      "The agent has reported nothing for far longer than a turn takes. Connect a coding agent from the Agent tab to pick this up; doing so takes the work over, so the original agent's answer will no longer be accepted.",
    tone: "danger",
  } as const;
  const quietTurn = {
    stage: "stalled",
    label: "Working",
    headline: "No progress for 2m",
    detail: "Check the agent terminal - it may be waiting for your approval.",
    tone: "warning",
  } as const;

  it("should route the reviewer to the setup instructions its copy names", () => {
    expect(
      renderToStaticMarkup(
        createElement(RequestStatusStrip, {
          status: abandoned,
          activity: [],
          surface: "thread",
          onShowAgent: () => undefined,
        }),
      ),
    ).toContain("Show setup instructions");
    expect(
      renderToStaticMarkup(
        createElement(RequestStatusStrip, {
          status: quietTurn,
          activity: [],
          surface: "thread",
          onShowAgent: () => undefined,
        }),
      ),
    ).not.toContain("Show setup instructions");
  });

  it("should not present identically to an ordinary quiet turn", () => {
    const pill = (status: typeof abandoned | typeof quietTurn) =>
      renderToStaticMarkup(createElement(AgentStatePill, { status }));
    expect(pill(abandoned)).toContain("No longer reporting");
    expect(pill(abandoned)).toContain('data-tone="failed"');
    expect(pill(quietTurn)).toContain("Agent silent");
    expect(pill(quietTurn)).toContain('data-tone="idle"');
  });
});
