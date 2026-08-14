import { describe, expect, it } from "vitest";
import { agentModelVendor } from "./agent-model-icon.js";

describe("agentModelVendor", () => {
  it.each([
    ["Grok 4.6", "grok"],
    ["OpenAI o3", "openai"],
    ["GPT-5.6-Luna", "openai"],
    ["GPT-4o", "openai"],
    ["gpt4-turbo", "openai"],
    ["Claude Sonnet 5", "claude"],
    ["claude-opus-4-1", "claude"],
  ] as const)("should recognize %s as %s", (name, vendor) => {
    expect(agentModelVendor(name)).toBe(vendor);
  });

  it.each([
    "GPT-J 6B",
    "GPT-NeoX-20B",
    "GPT4All",
    "Llama 3.1",
    "Mistral Large",
    "",
    "  ",
  ])("should leave %j unrecognized instead of guessing a vendor", (name) => {
    expect(agentModelVendor(name)).toBeUndefined();
  });
});
