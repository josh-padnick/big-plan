// The attribute writer is the one place Big Plan edits an author's document
// without an author asking, so these tests are deliberately the bulk of this
// feature's confidence: what it writes, what it refuses, and - the corpus test
// at the end - that it leaves every other byte alone.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileMarkdownModel } from "./markdown/compile-markdown.js";
import { lintPlan } from "../lint/lint-plan.js";
import { renderDocument } from "./render-document.js";
import { DecisionStampRejected, stampDecisions } from "./stamp-decisions.js";
import type { CompiledDecisionCard } from "../components/_model/decision-card.js";

const DECISION_COMPONENTS = new Set(["Decision", "QuickDecision"]);

const STAMP_ATTRIBUTES = [' state="decided"', " chosen"] as const;

// Everything the writer is allowed to have written, removed. Two sources that
// agree once these are gone agree on every byte the writer was not asked to
// touch - authored blank lines, attribute order, comments and all.
const withoutStampAttributes = (value: string): string =>
  STAMP_ATTRIBUTES.reduce(
    (stripped, attribute) => stripped.replaceAll(attribute, ""),
    value,
  );

const occurrences = (value: string, needle: string): number =>
  value.split(needle).length - 1;

const cards = (markdown: string): ReadonlyArray<CompiledDecisionCard> =>
  compileMarkdownModel({ markdown })
    .components.filter((component) =>
      DECISION_COMPONENTS.has(component.component),
    )
    .map((component) => component.model as CompiledDecisionCard);

const cardById = (
  markdown: string,
  decisionId: string,
): CompiledDecisionCard => {
  const found = cards(markdown).find((card) => card.id === decisionId);
  if (found === undefined) throw new Error(`No decision ${decisionId}`);
  return found;
};

const onlyDecisionId = (markdown: string): string => {
  const [first] = cards(markdown);
  if (first === undefined) throw new Error("No decision in the fixture");
  return first.id;
};

const ROWS = `# Plan

A one-line lede that says what this plan does.

<Decision question="Which path?">

<Option title="Canary" recommended summary="Start narrow.">

<Consideration label="Risk" verdict="Low" tone="good" />

</Option>

<Option title="Global">

<Consideration label="Risk" verdict="High" tone="bad" />

</Option>

</Decision>
`;

describe("stampDecisions", () => {
  it("should record the answer as decided plus chosen", () => {
    const decisionId = onlyDecisionId(ROWS);

    const { stamped } = stampDecisions({
      markdown: ROWS,
      answers: [{ decisionId, optionTitle: "Global" }],
    });

    expect(stamped).toContain(
      '<Decision state="decided" question="Which path?">',
    );
    expect(stamped).toContain('<Option chosen title="Global">');
    const card = cardById(stamped, decisionId);
    expect(card.status).toBe("decided");
    expect(card.chosenOption?.title).toBe("Global");
  });

  it("should leave every byte outside the two edits untouched", () => {
    const decisionId = onlyDecisionId(ROWS);

    const { stamped } = stampDecisions({
      markdown: ROWS,
      answers: [{ decisionId, optionTitle: "Canary" }],
    });

    expect(withoutStampAttributes(stamped)).toBe(withoutStampAttributes(ROWS));
    for (const attribute of STAMP_ATTRIBUTES) {
      expect(occurrences(stamped, attribute)).toBe(
        occurrences(ROWS, attribute) + 1,
      );
    }
  });

  it("should return the source untouched when there is nothing to record", () => {
    expect(stampDecisions({ markdown: ROWS, answers: [] }).stamped).toBe(ROWS);
  });

  it("should stamp a multi-line opening tag without reflowing it", () => {
    const markdown = `# Plan

A one-line lede that says what this plan does.

<Decision
  question="Which path?"
  critical
>

<Option
  title="Canary"
  recommended
/>

<Option title="Global" />

</Decision>
`;
    const decisionId = onlyDecisionId(markdown);

    const { stamped } = stampDecisions({
      markdown,
      answers: [{ decisionId, optionTitle: "Canary" }],
    });

    expect(stamped).toContain(
      '<Decision state="decided"\n  question="Which path?"',
    );
    expect(stamped).toContain(
      '<Option chosen\n  title="Canary"\n  recommended\n/>',
    );
    expect(cardById(stamped, decisionId).chosenOption?.title).toBe("Canary");
  });

  it('should replace an authored state="proposed" rather than adding a second one', () => {
    const markdown = ROWS.replace(
      '<Decision question="Which path?">',
      '<Decision question="Which path?" state="proposed">',
    );
    const decisionId = onlyDecisionId(markdown);

    const { stamped } = stampDecisions({
      markdown,
      answers: [{ decisionId, optionTitle: "Global" }],
    });

    expect(stamped).toContain(
      '<Decision question="Which path?" state="decided">',
    );
    expect(stamped.match(/state=/gu)).toHaveLength(1);
    expect(cardById(stamped, decisionId).status).toBe("decided");
  });

  it("should keep the authored quote style when it replaces a value", () => {
    const markdown = ROWS.replace(
      '<Decision question="Which path?">',
      "<Decision question=\"Which path?\" state='proposed'>",
    );
    const decisionId = onlyDecisionId(markdown);

    const { stamped } = stampDecisions({
      markdown,
      answers: [{ decisionId, optionTitle: "Global" }],
    });

    expect(stamped).toContain("state='decided'");
  });

  it("should preserve spaced state attribute syntax outside its value", () => {
    const markdown = ROWS.replace(
      '<Decision question="Which path?">',
      "<Decision question=\"Which path?\" state = 'proposed'>",
    );
    const decisionId = onlyDecisionId(markdown);

    const { stamped } = stampDecisions({
      markdown,
      answers: [{ decisionId, optionTitle: "Global" }],
    });

    expect(stamped).toContain("state = 'decided'");
    const withoutChosen = stamped.replace(" chosen", "");
    const originalValueStart = markdown.indexOf("proposed");
    const stampedValueStart = withoutChosen.indexOf("decided");
    expect(withoutChosen.slice(0, stampedValueStart)).toBe(
      markdown.slice(0, originalValueStart),
    );
    expect(withoutChosen.slice(stampedValueStart + "decided".length)).toBe(
      markdown.slice(originalValueStart + "proposed".length),
    );
  });

  it("should stamp a self-closing QuickDecision option", () => {
    const markdown = `# Plan

A one-line lede that says what this plan does.

<QuickDecision question="Ship behind a flag?" context="The first week carries the risk.">

<Option title="Yes" recommended summary="Rollback stays one toggle away." />

<Option title="No" />

</QuickDecision>
`;
    const decisionId = onlyDecisionId(markdown);

    const { stamped } = stampDecisions({
      markdown,
      answers: [{ decisionId, optionTitle: "Yes" }],
    });

    expect(stamped).toContain('<QuickDecision state="decided" question=');
    expect(stamped).toContain(
      '<Option chosen title="Yes" recommended summary="Rollback stays one toggle away." />',
    );
    expect(cardById(stamped, decisionId).chosenOption?.title).toBe("Yes");
  });

  it("should record two answers in one document in one pass", () => {
    const markdown = `# Plan

A one-line lede that says what this plan does.

<QuickDecision question="Ship behind a flag?">

<Option title="Yes" recommended />

<Option title="No" />

</QuickDecision>

<QuickDecision question="Announce it first?">

<Option title="Announce" />

<Option title="Stay quiet" recommended />

</QuickDecision>
`;
    const [first, second] = cards(markdown);

    const { stamped } = stampDecisions({
      markdown,
      answers: [
        { decisionId: first?.id ?? "", optionTitle: "No" },
        { decisionId: second?.id ?? "", optionTitle: "Announce" },
      ],
    });

    expect(cardById(stamped, first?.id ?? "").chosenOption?.title).toBe("No");
    expect(cardById(stamped, second?.id ?? "").chosenOption?.title).toBe(
      "Announce",
    );
    expect(withoutStampAttributes(stamped)).toBe(
      withoutStampAttributes(markdown),
    );
  });

  it("should refuse an option title the decision does not offer", () => {
    const decisionId = onlyDecisionId(ROWS);

    expect(() =>
      stampDecisions({
        markdown: ROWS,
        answers: [{ decisionId, optionTitle: "Regional" }],
      }),
    ).toThrow(DecisionStampRejected);
  });

  it("should refuse a decision the plan no longer asks", () => {
    expect(() =>
      stampDecisions({
        markdown: ROWS,
        answers: [{ decisionId: "decision-gone", optionTitle: "Global" }],
      }),
    ).toThrow(DecisionStampRejected);
  });

  it("should refuse a decision that is already decided", () => {
    const decisionId = onlyDecisionId(ROWS);
    const { stamped } = stampDecisions({
      markdown: ROWS,
      answers: [{ decisionId, optionTitle: "Global" }],
    });

    expect(() =>
      stampDecisions({
        markdown: stamped,
        answers: [{ decisionId, optionTitle: "Canary" }],
      }),
    ).toThrow(DecisionStampRejected);
  });

  it("should never stamp over an option that already carries chosen", () => {
    // Two authored forms reach this. A half-stamp - chosen without a state -
    // is not a valid plan at all, so compilation refuses it first; a complete
    // one is a settled decision, which the writer refuses itself. Neither may
    // acquire a second chosen option, which is the fact under test.
    const halfStamped = ROWS.replace(
      '<Option title="Global">',
      '<Option chosen title="Global">',
    );
    const decisionId = onlyDecisionId(ROWS);
    const settled = ROWS.replace(
      '<Decision question="Which path?">',
      '<Decision question="Which path?" state="decided">',
    ).replace('<Option title="Global">', '<Option chosen title="Global">');

    expect(() =>
      stampDecisions({
        markdown: halfStamped,
        answers: [{ decisionId, optionTitle: "Canary" }],
      }),
    ).toThrow();
    expect(() =>
      stampDecisions({
        markdown: settled,
        answers: [{ decisionId, optionTitle: "Canary" }],
      }),
    ).toThrow(DecisionStampRejected);
  });

  it("should refuse the same decision answered twice in one stamp", () => {
    const decisionId = onlyDecisionId(ROWS);

    expect(() =>
      stampDecisions({
        markdown: ROWS,
        answers: [
          { decisionId, optionTitle: "Canary" },
          { decisionId, optionTitle: "Global" },
        ],
      }),
    ).toThrow(DecisionStampRejected);
  });

  it("should refuse a source that does not compile at all", () => {
    expect(() =>
      stampDecisions({
        markdown:
          '<Decision question="Only one option?">\n\n<Option title="A" />\n\n</Decision>\n',
        answers: [{ decisionId: "decision-only-one-option", optionTitle: "A" }],
      }),
    ).toThrow();
  });
});

// One pass over the real corpus: every example that asks an answerable
// question is stamped on its recommended option and must still render, lint,
// and recompile - and must differ from the original only inside the spans the
// writer computed.
describe("stampDecisions over the example corpus", () => {
  const examples = readdirSync("examples")
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => ({
      name,
      markdown: readFileSync(join("examples", name), "utf8"),
    }))
    .flatMap(({ name, markdown }) => {
      const open = cards(markdown).filter(
        (card) => card.status === "open" && card.interaction === "choose",
      );
      return open.length === 0 ? [] : [{ name, markdown, open }];
    });

  it("should find open decisions to stamp in the corpus", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((example) => [example.name, example] as const))(
    "should stamp %s without disturbing anything else",
    (_name, example) => {
      const answers = example.open.map((card) => ({
        decisionId: card.id,
        optionTitle: (
          card.options.find((option) => option.recommended) ?? card.options[0]
        )?.title,
      }));
      const { stamped } = stampDecisions({
        markdown: example.markdown,
        answers: answers.flatMap((answer) =>
          answer.optionTitle === undefined
            ? []
            : [
                {
                  decisionId: answer.decisionId,
                  optionTitle: answer.optionTitle,
                },
              ],
        ),
      });

      expect(() =>
        renderDocument({ markdown: stamped, fallbackTitle: _name }),
      ).not.toThrow();
      expect(lintPlan({ markdown: stamped })).toEqual(
        lintPlan({ markdown: example.markdown }),
      );
      for (const card of example.open) {
        expect(cardById(stamped, card.id).status).toBe("decided");
      }
      expect(withoutStampAttributes(stamped)).toBe(
        withoutStampAttributes(example.markdown),
      );
      for (const attribute of STAMP_ATTRIBUTES) {
        expect(occurrences(stamped, attribute)).toBe(
          occurrences(example.markdown, attribute) + example.open.length,
        );
      }
    },
  );
});
