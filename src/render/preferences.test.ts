// Tests the persisted preferences contract without a browser or storage
// dependency, keeping malformed records fail-closed at the lowest rung.

import { describe, expect, it } from "vitest";
import {
  appearanceModeFromRecord,
  paletteFromRecord,
  parsePreferencesRecord,
  serializePreferencesRecord,
} from "./preferences.js";

describe("preferences", () => {
  it("should follow System and the product palette when storage is absent", () => {
    const record = parsePreferencesRecord(null);
    expect(appearanceModeFromRecord(record)).toBe("system");
    expect(paletteFromRecord(record)).toBe("default");
  });

  it("should parse a valid stored render mode and colour theme", () => {
    expect(parsePreferencesRecord('{"version":1,"mode":"dark"}')).toEqual({
      version: 1,
      mode: "dark",
    });
    expect(
      parsePreferencesRecord('{"version":1,"mode":"dark","palette":"cole"}'),
    ).toEqual({ version: 1, mode: "dark", palette: "cole" });
    expect(
      parsePreferencesRecord('{"version":1,"palette":"rose-pine"}'),
    ).toEqual({ version: 1, palette: "rose-pine" });
  });

  it("should read each field back through its own accessor", () => {
    const record = parsePreferencesRecord(
      '{"version":1,"mode":"light","palette":"everforest"}',
    );
    expect(appearanceModeFromRecord(record)).toBe("light");
    expect(paletteFromRecord(record)).toBe("everforest");
  });

  it("should reject corrupt, old, and unknown records", () => {
    expect(parsePreferencesRecord("not json")).toBeNull();
    expect(parsePreferencesRecord('{"version":2,"mode":"dark"}')).toBeNull();
    expect(parsePreferencesRecord('{"version":1,"mode":"sepia"}')).toBeNull();
    expect(
      parsePreferencesRecord('{"version":1,"palette":"solarized"}'),
    ).toBeNull();
    // The product's own palette is the value absence means, so naming it is
    // itself an unknown value rather than a redundant one.
    expect(
      parsePreferencesRecord('{"version":1,"palette":"default"}'),
    ).toBeNull();
    expect(parsePreferencesRecord('{"version":1,"palette":7}')).toBeNull();
  });

  it("should omit System and the product palette from the serialized record", () => {
    expect(
      serializePreferencesRecord({ mode: "system", palette: "default" }),
    ).toBe('{"version":1}');
    expect(
      serializePreferencesRecord({ mode: "light", palette: "default" }),
    ).toBe('{"version":1,"mode":"light"}');
    expect(
      serializePreferencesRecord({ mode: "system", palette: "catppuccin" }),
    ).toBe('{"version":1,"palette":"catppuccin"}');
    expect(
      serializePreferencesRecord({ mode: "dark", palette: "rose-pine" }),
    ).toBe('{"version":1,"mode":"dark","palette":"rose-pine"}');
  });

  it("should round-trip every serialized pairing", () => {
    for (const mode of ["system", "light", "dark"] as const) {
      for (const palette of [
        "default",
        "rose-pine",
        "cole",
        "catppuccin",
        "everforest",
      ] as const) {
        const record = parsePreferencesRecord(
          serializePreferencesRecord({ mode, palette }),
        );
        expect(appearanceModeFromRecord(record)).toBe(mode);
        expect(paletteFromRecord(record)).toBe(palette);
      }
    }
  });
});
