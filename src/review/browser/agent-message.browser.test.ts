import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestStatusStrip } from "./agent-message.browser.js";

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
