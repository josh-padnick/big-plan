// Exercises typed-slide structure findings, source positions, and the
// deliberate boundary between objective lint and title-writing guidance.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

describe("lintPlan slide-type-structure", () => {
  it("should reject a duplicate singleton type at the second marker", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="status-quo" />\n\n## Today\n\nA.\n\n<Slide type="status-quo" />\n\n## The inherited constraint\n\nB.\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 7,
        column: 1,
        message: "Use at most one Status quo slide in a plan",
      },
    ]);
  });

  it("should reject using both outcome types", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="desired-experience" />\n\n## Reviewers leave feedback in place\n\nA.\n\n<Slide type="desired-outcome" />\n\n## Review state survives regeneration\n\nB.\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 7,
        column: 1,
        message:
          "Use either Desired experience for a new feature or Desired outcome for other work, not both",
      },
    ]);
  });

  it("should allow Acceptance criteria before another typed slide", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="acceptance-criteria" />\n\n## The change has checkable proof\n\nA.\n\n<Part title="User journeys" />\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nB.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should allow repeated User journeys with distinct names and canonical Success looks like", () => {
    expect(
      lintPlan({
        markdown:
          '## Success looks like\n\nA.\n\n<Part title="User journeys" />\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nB.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nC.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should allow journeys nested as sub-slides of an untyped container slide", () => {
    expect(
      lintPlan({
        markdown:
          '## User journeys\n\n### A reviewer opens the plan\n\nA.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n\n### A reviewer accepts the plan\n\nB.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should allow a container Part that names its journey audience", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="Reviewer journeys" />\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nA.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should reject journey slides authored beside their container slide", () => {
    expect(
      lintPlan({
        markdown:
          '## User journeys\n\nThe loops this plan changes.\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nA.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nB.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 1,
        column: 1,
        message:
          'Nest the journeys under "User journeys" instead of beside it: replace that slide with <Part title="User journeys" /> so each journey is a slide inside it, or make each journey an h3 sub-slide of it',
      },
    ]);
  });

  it("should reject a redundant container slide inside a journeys Part", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="User journeys" />\n\n## User journeys\n\nThe loops this plan changes.\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nA.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nB.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 3,
        column: 1,
        message:
          'Nest the journeys under "User journeys" instead of beside it: delete that redundant slide so each typed journey remains directly inside <Part title="User journeys" />, or make each journey an h3 sub-slide of it',
      },
    ]);
  });

  it("should distinguish separate journey Parts with the same title", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="User journeys" />\n\n## User journeys\n\n### A reviewer reads the plan\n\nA.\n\n<Part title="User journeys" />\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nA.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should ignore a journey heading nested inside a component", () => {
    expect(
      lintPlan({
        markdown:
          '<Callout>\n\n## User journeys\n\nContext only.\n\n</Callout>\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nA.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 9,
        column: 1,
        message:
          'Put User journeys slide "Opening the plan" inside a Part titled "User journeys" so every journey nests under its container',
      },
    ]);
  });

  it("should reject a journey slide that has no container at all", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="The proposal" />\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nA.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 3,
        column: 1,
        message:
          'Put User journeys slide "Opening the plan" inside a Part titled "User journeys" so every journey nests under its container',
      },
    ]);
  });

  it("should reject a journey that escapes an established container Part", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="User journeys" />\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nA.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n\n<Part title="Shipping" />\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nB.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 13,
        column: 1,
        message:
          'Put User journeys slide "Accepting the plan" inside a Part titled "User journeys" so every journey nests under its container',
      },
    ]);
  });

  it("should require a Wireframe or an explicit opt-out reason on User journeys slides", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="User journeys" />\n\n<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## A reviewer opens the plan\n\nProse alone.\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 3,
        column: 1,
        message:
          'User journeys slide "Reviewing the plan" needs a Wireframe with actual UI mockups, or a non-empty wireframeReason explaining why no UI was created',
      },
    ]);
    expect(
      lintPlan({
        markdown:
          '<Part title="User journeys" />\n\n<Slide type="user-journey" name="Reviewing the plan" toc="Review" wireframeReason="This journey covers a text-only command flow with no interface to show." />\n\n## A reviewer opens the plan\n\nProse only.\n',
      }),
    ).toEqual([]);
  });

  it("should reject repeated journey names and TOC forms", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="User journeys" />\n\n<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## An agent reviews the plan\n\nA.\n\n<Wireframe id="agent"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## A captain reviews the plan\n\nB.\n\n<Wireframe id="captain"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 11,
        column: 1,
        message:
          'Give every journey in User journeys a distinct name; "Reviewing the plan" is repeated',
      },
      {
        ruleId: "slide-type-structure",
        line: 11,
        column: 1,
        message:
          'Give every journey in User journeys a distinct table-of-contents form; "Review" is repeated',
      },
    ]);
  });

  it("should apply the journey contracts to a typed sub-slide", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="User journeys" />\n\n## Merchant journeys\n\nThe merchant acts first.\n\n<Slide type="user-journey" name="Review a failed payment" toc="Review failure" />\n\n### A merchant reads why one payment failed\n\nProse alone.\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 7,
        column: 1,
        message:
          'User journeys slide "Review a failed payment" needs a Wireframe with actual UI mockups, or a non-empty wireframeReason explaining why no UI was created',
      },
    ]);
  });

  it("should accept grouped journeys nested under an actor group", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="User journeys" />\n\n## Merchant journeys\n\nThe merchant acts first.\n\n<Slide type="user-journey" name="Review a failed payment" toc="Review failure" />\n\n### A merchant reads why one payment failed\n\nA.\n\n<Wireframe id="review"><Screen id="failure" name="Failure" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Queue a protected retry" toc="Queue retry" />\n\n### A merchant schedules the next attempt\n\nB.\n\n<Wireframe id="retry"><Screen id="schedule" name="Schedule" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should reject a grouped journey with no journeys container", () => {
    expect(
      lintPlan({
        markdown:
          '<Part title="The proposal" />\n\n## How the merchant works\n\nContext.\n\n<Slide type="user-journey" name="Review a failed payment" toc="Review failure" />\n\n### A merchant reads why one payment failed\n\nA.\n\n<Wireframe id="review"><Screen id="failure" name="Failure" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 7,
        column: 1,
        message:
          'Put User journeys sub-slide "Review a failed payment" under a container that names the journeys, such as <Part title="User journeys" /> or an actor group titled "Merchant journeys"',
      },
    ]);
  });

  it("should leave plain-language title judgment to guidance", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="status-quo" />\n\n## The ultimate revolutionary architecture\n\nA.\n',
      }),
    ).toEqual([]);
  });
});
