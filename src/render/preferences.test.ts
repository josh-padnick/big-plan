// Tests the persisted preferences contract without a browser or storage
// dependency, keeping malformed records fail-closed at the lowest rung.

import { describe, expect, it } from "vitest";
import {
  appearanceModeFromRecord,
  parsePreferencesRecord,
  serializePreferencesRecord,
} from "./preferences.js";

describe("preferences", () => {
  it("should follow System when storage is absent", () => {
    expect(appearanceModeFromRecord(parsePreferencesRecord(null))).toBe(
      "system",
    );
  });

  it("should parse a valid stored render mode", () => {
    expect(parsePreferencesRecord('{"version":1,"mode":"dark"}')).toEqual({
      version: 1,
      mode: "dark",
    });
  });

  it("should reject corrupt, old, and unknown records", () => {
    expect(parsePreferencesRecord("not json")).toBeNull();
    expect(parsePreferencesRecord('{"version":2,"mode":"dark"}')).toBeNull();
    expect(parsePreferencesRecord('{"version":1,"mode":"sepia"}')).toBeNull();
  });

  it("should omit System from the serialized record", () => {
    expect(serializePreferencesRecord("system")).toBe('{"version":1}');
    expect(serializePreferencesRecord("light")).toBe(
      '{"version":1,"mode":"light"}',
    );
  });
});
