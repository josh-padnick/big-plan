import { describe, expect, it } from "vitest";
import {
  agentClientDisplayName,
  agentModelDisplayName,
  agentModelVendor,
} from "./agent-identity-catalog.js";

describe("agentModelVendor", () => {
  it.each([
    // Canonical ids, which is what the protocol asks an agent to declare.
    ["grok-4.6", "grok"],
    ["claude-fable-5", "claude"],
    ["gpt-5.6-sol", "openai"],
    ["mistral-large", "mistral"],
    // Display forms, which an agent following the earlier prompt still sends.
    ["Grok 4.6", "grok"],
    ["Claude Sonnet 5", "claude"],
    ["GPT-5.6-Luna", "openai"],
    // Family recognition, for a model the catalog holds no entry for.
    ["gpt-4o-mini-2026", "openai"],
    ["claude-opus-9-experimental", "claude"],
    ["mixtral-8x7b", "mistral"],
  ] as const)("should resolve %j to %s", (declared, vendor) => {
    expect(agentModelVendor(declared)).toBe(vendor);
  });

  it.each([
    // Real models whose vendors have no faithful mark in the catalog. They
    // show a name and nothing else rather than a mark drawn from memory.
    "llama-3.1",
    "deepseek-v3",
    "kimi-k2",
    "glm-4.6",
    // Unrelated GPT-named models must not borrow OpenAI's mark.
    "gpt-j-6b",
    "gpt-neox-20b",
    "gpt4all",
    "",
  ])("should leave %j without a vendor", (declared) => {
    expect(agentModelVendor(declared)).toBeUndefined();
  });
});

describe("agentModelDisplayName", () => {
  it.each([
    ["grok-4.6", "Grok 4.6"],
    ["claude-fable-5", "Claude Fable 5"],
    ["gpt-5.6-sol", "GPT-5.6-sol"],
    // The display form resolves to the same entry as its canonical id.
    ["Grok 4.6", "Grok 4.6"],
    ["GPT-5.6-SOL", "GPT-5.6-sol"],
  ] as const)("should print %j as %j", (declared, display) => {
    expect(agentModelDisplayName(declared)).toBe(display);
  });

  it.each([
    // An id the catalog does not hold renders exactly as declared. Re-casing it
    // would be Big Plan asserting how a vendor writes its own name.
    "deepseek-v3",
    "kimi-k2",
    "some-internal-model-2026-08",
    "GLM-4.6",
  ])("should print unknown %j unchanged", (declared) => {
    expect(agentModelDisplayName(declared)).toBe(declared);
  });
});

describe("agentClientDisplayName", () => {
  it.each([
    ["claude-code 2.1.217", "Claude Code"],
    ["grok-cli 0.2.99", "Grok CLI"],
    ["codex-cli v1.4.0", "Codex"],
    ["claude-code", "Claude Code"],
  ] as const)("should print %j as %j", (declared, display) => {
    expect(agentClientDisplayName(declared)).toBe(display);
  });

  it.each(["some-harness 9.9.9", "internal-tool", "aider 0.1"])(
    "should print unknown client %j unchanged",
    (declared) => {
      expect(agentClientDisplayName(declared)).toBe(declared);
    },
  );
});
