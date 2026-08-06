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
          '<Slide type="acceptance-criteria" />\n\n## The change has checkable proof\n\nA.\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nB.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should allow repeated User journeys with distinct names and canonical Success looks like", () => {
    expect(
      lintPlan({
        markdown:
          '## Success looks like\n\nA.\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nB.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nC.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should require a Wireframe or an explicit opt-out reason on User journeys slides", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## A reviewer opens the plan\n\nProse alone.\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 1,
        column: 1,
        message:
          'User journeys slide "Reviewing the plan" needs a Wireframe with actual UI mockups, or a non-empty wireframeReason explaining why no UI was created',
      },
    ]);
    expect(
      lintPlan({
        markdown:
          '<Slide type="user-journey" name="Reviewing the plan" toc="Review" wireframeReason="This journey covers a text-only command flow with no interface to show." />\n\n## A reviewer opens the plan\n\nProse only.\n',
      }),
    ).toEqual([]);
  });

  it("should reject repeated journey names and TOC forms", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## An agent reviews the plan\n\nA.\n\n<Wireframe id="agent"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## A captain reviews the plan\n\nB.\n\n<Wireframe id="captain"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 9,
        column: 1,
        message:
          'Give every journey in User journeys a distinct name; "Reviewing the plan" is repeated',
      },
      {
        ruleId: "slide-type-structure",
        line: 9,
        column: 1,
        message:
          'Give every journey in User journeys a distinct table-of-contents form; "Review" is repeated',
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
