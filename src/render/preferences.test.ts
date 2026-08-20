// Tests the persisted preferences contract without a browser or storage
// dependency, keeping malformed records fail-closed at the lowest rung.

import { describe, expect, it } from "vitest";
import * as mirror from "../review/shared/approval-message.js";
import {
  APPROVAL_MESSAGE_LIMIT,
  APPROVAL_MESSAGE_RECORD_VERSION,
  APPROVAL_MESSAGE_STORAGE_KEY,
  appearanceModeFromRecord,
  approvalMessageFromRecord,
  DEFAULT_APPROVAL_MESSAGE,
  paletteFromRecord,
  parseApprovalMessageRecord,
  parsePreferencesRecord,
  serializeApprovalMessageRecord,
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
      parsePreferencesRecord('{"version":1,"mode":"dark","palette":"nord"}'),
    ).toEqual({ version: 1, mode: "dark", palette: "nord" });
    expect(
      parsePreferencesRecord('{"version":1,"palette":"rose-pine"}'),
    ).toEqual({ version: 1, palette: "rose-pine" });
  });

  it("should read each field back through its own accessor", () => {
    const record = parsePreferencesRecord(
      '{"version":1,"mode":"light","palette":"brutalist"}',
    );
    expect(appearanceModeFromRecord(record)).toBe("light");
    expect(paletteFromRecord(record)).toBe("brutalist");
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

  it("should send a withdrawn theme back to the product palette", () => {
    // Cole and Everforest were offered before the captain replaced them. An
    // old record naming one is indistinguishable from a corrupt record, and
    // takes the same route: the whole record is dropped, so the reviewer gets
    // the product palette following their OS rather than a theme that is gone.
    for (const withdrawn of ["cole", "everforest"]) {
      const record = parsePreferencesRecord(
        `{"version":1,"mode":"dark","palette":"${withdrawn}"}`,
      );
      expect(record).toBeNull();
      expect(paletteFromRecord(record)).toBe("default");
      expect(appearanceModeFromRecord(record)).toBe("system");
    }
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
        "nord",
        "catppuccin",
        "brutalist",
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

// The reviewer's covering note, read the way an approval will read it: what the
// field shows and what the approval carries are the same string, so every case
// below is stated as "this storage means this message".
const effective = (raw: string | null): string =>
  approvalMessageFromRecord(parseApprovalMessageRecord(raw));

describe("approval message", () => {
  it("should send the default wording when nothing is stored", () => {
    expect(parseApprovalMessageRecord(null)).toBeNull();
    expect(effective(null)).toBe(DEFAULT_APPROVAL_MESSAGE);
  });

  it("should parse and read back a stored note", () => {
    expect(
      parseApprovalMessageRecord('{"version":1,"message":"Ship it."}'),
    ).toEqual({ version: 1, message: "Ship it." });
    expect(effective('{"version":1,"message":"Ship it."}')).toBe("Ship it.");
  });

  it("should reject corrupt, old, and mistyped records", () => {
    expect(parseApprovalMessageRecord("not json")).toBeNull();
    expect(
      parseApprovalMessageRecord('{"version":2,"message":"a"}'),
    ).toBeNull();
    expect(parseApprovalMessageRecord('{"version":1}')).toBeNull();
    expect(parseApprovalMessageRecord('{"version":1,"message":7}')).toBeNull();
    expect(parseApprovalMessageRecord('["version",1]')).toBeNull();
  });

  it("should refuse a note past the bound rather than sending a truncated one", () => {
    const tooLong = "x".repeat(APPROVAL_MESSAGE_LIMIT + 1);
    expect(
      parseApprovalMessageRecord(
        JSON.stringify({ version: 1, message: tooLong }),
      ),
    ).toBeNull();
    const atBound = "x".repeat(APPROVAL_MESSAGE_LIMIT);
    expect(
      parseApprovalMessageRecord(
        JSON.stringify({ version: 1, message: atBound }),
      ),
    ).toEqual({ version: 1, message: atBound });
  });

  it("should treat a blank note as no note at all", () => {
    // An approval always says something, so a message the reviewer emptied
    // reads as the default rather than as an approval with nothing in it.
    expect(effective('{"version":1,"message":"   \\n  "}')).toBe(
      DEFAULT_APPROVAL_MESSAGE,
    );
    expect(effective('{"version":1,"message":"  Ship it.  "}')).toBe(
      "Ship it.",
    );
  });

  it("should clamp what it serializes to the bound it parses", () => {
    expect(serializeApprovalMessageRecord("Ship it.")).toBe(
      '{"version":1,"message":"Ship it."}',
    );
    expect(
      parseApprovalMessageRecord(
        serializeApprovalMessageRecord("x".repeat(APPROVAL_MESSAGE_LIMIT + 50)),
      ),
    ).toEqual({ version: 1, message: "x".repeat(APPROVAL_MESSAGE_LIMIT) });
  });

  // The browser island may not import this module, so it carries its own copy
  // of the same contract. A drift between the two would show up as an approval
  // quietly carrying different words than the settings field displays, which no
  // other test would catch.
  it("should stay byte-identical to the island's mirror", () => {
    expect(mirror.APPROVAL_MESSAGE_STORAGE_KEY).toBe(
      APPROVAL_MESSAGE_STORAGE_KEY,
    );
    expect(mirror.APPROVAL_MESSAGE_RECORD_VERSION).toBe(
      APPROVAL_MESSAGE_RECORD_VERSION,
    );
    expect(mirror.APPROVAL_MESSAGE_LIMIT).toBe(APPROVAL_MESSAGE_LIMIT);
    expect(mirror.DEFAULT_APPROVAL_MESSAGE).toBe(DEFAULT_APPROVAL_MESSAGE);
  });

  it("should resolve every storage case the same way the mirror does", () => {
    for (const raw of [
      null,
      "not json",
      "[]",
      '{"version":2,"message":"a"}',
      '{"version":1}',
      '{"version":1,"message":7}',
      '{"version":1,"message":""}',
      '{"version":1,"message":"   "}',
      '{"version":1,"message":"  Ship it.  "}',
      JSON.stringify({
        version: 1,
        message: "x".repeat(APPROVAL_MESSAGE_LIMIT),
      }),
      JSON.stringify({
        version: 1,
        message: "x".repeat(APPROVAL_MESSAGE_LIMIT + 1),
      }),
    ]) {
      expect(mirror.effectiveApprovalMessage(raw), `storage: ${raw}`).toBe(
        effective(raw),
      );
    }
  });
});
