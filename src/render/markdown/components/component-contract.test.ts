// Tests the component contract's static attribute validation and document id
// allocation.

import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "./diagnostics.js";
import {
  createComponentIdAllocator,
  validateComponentAttributes,
} from "./component-contract.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 12, offset: 100 },
};

describe("validateComponentAttributes", () => {
  const validate = (
    schema: Parameters<typeof validateComponentAttributes>[0]["schema"],
    attributes: Readonly<Record<string, string | boolean>>,
  ) => {
    const diagnostics = createDiagnosticCollector();
    const values = validateComponentAttributes({
      component: "Sample",
      attributes,
      position: POSITION,
      diagnostics,
      schema,
    });
    return { values, messages: diagnostics.diagnostics.map((d) => d.message) };
  };

  it("should report a missing required enum with its allowed values", () => {
    const { messages } = validate(
      { tone: { kind: "enum", values: ["calm", "loud"], required: true } },
      {},
    );
    expect(messages).toEqual([
      'Missing required attribute "tone"; expected one of: calm, loud',
    ]);
  });

  it("should report an invalid enum value and return undefined for it", () => {
    const { values, messages } = validate(
      { tone: { kind: "enum", values: ["calm", "loud"], required: true } },
      { tone: "shrill" },
    );
    expect(messages).toEqual([
      'Invalid value for attribute "tone"; expected one of: calm, loud',
    ]);
    expect(values.tone).toBeUndefined();
  });

  it("should return a valid enum value typed to its union", () => {
    const { values, messages } = validate(
      { tone: { kind: "enum", values: ["calm", "loud"], required: true } },
      { tone: "calm" },
    );
    expect(messages).toEqual([]);
    expect(values.tone).toBe("calm");
  });

  it.each(["", "   "])(
    "should reject an empty required non-empty string",
    (value) => {
      const { messages } = validate(
        { file: { kind: "string", required: true, nonEmpty: true } },
        { file: value },
      );
      expect(messages).toEqual(['Attribute "file" must be a non-empty string']);
    },
  );

  it("should report a missing required string", () => {
    const { messages } = validate(
      { file: { kind: "string", required: true } },
      {},
    );
    expect(messages).toEqual([
      'Missing required attribute "file"; expected a string',
    ]);
  });

  it("should reject a shorthand value for a string attribute", () => {
    const { messages } = validate(
      { title: { kind: "string" } },
      { title: true },
    );
    expect(messages).toEqual(['Attribute "title" must be a string']);
  });

  it("should accept a bare shorthand boolean and reject its string form", () => {
    const bare = validate(
      { wide: { kind: "booleanShorthand" } },
      { wide: true },
    );
    expect(bare.messages).toEqual([]);
    expect(bare.values.wide).toBe(true);
    const stringy = validate(
      { wide: { kind: "booleanShorthand" } },
      { wide: "true" },
    );
    expect(stringy.messages).toEqual([
      'Attribute "wide" is a shorthand boolean; use the bare form',
    ]);
  });

  it("should sweep unknown attributes naming the component", () => {
    const { messages } = validate(
      { tone: { kind: "enum", values: ["calm"], required: true } },
      { tone: "calm", compact: true },
    );
    expect(messages).toEqual(['Unknown attribute "compact" on Sample']);
  });
});

describe("createComponentIdAllocator", () => {
  it("should avoid collisions between duplicate suffixes and authored slugs", () => {
    const ids = createComponentIdAllocator();
    const allocate = (label: string) =>
      ids.allocate({ prefix: "decision", label, fallbackId: "decision" });

    expect([
      allocate("Choice"),
      allocate("Choice"),
      allocate("Choice 2"),
    ]).toEqual(["decision-choice", "decision-choice-2", "decision-choice-2-2"]);
    expect([allocate("Route 2"), allocate("Route"), allocate("Route")]).toEqual(
      ["decision-route-2", "decision-route", "decision-route-3"],
    );
  });
});
