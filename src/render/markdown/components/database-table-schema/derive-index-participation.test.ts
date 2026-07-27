// Tests the column-to-index participation model: key entries, expression
// entries, predicate-only references, and regex-hostile column names.

import { describe, expect, it } from "vitest";
import { indexParticipation } from "./derive-index-participation.js";
import type {
  TableColumn,
  TableIndex,
} from "../../../../model/parse-table-schema.js";

const column = (name: string): TableColumn => ({
  name,
  type: "text",
  primaryKey: false,
  notNull: false,
  unique: false,
  identity: false,
});

const index = (partial: Partial<TableIndex>): TableIndex => ({
  columns: [],
  unique: false,
  ...partial,
});

describe("indexParticipation", () => {
  it("should report key participation with one-based positions", () => {
    expect(
      indexParticipation({
        column: column("status"),
        indexes: [
          index({ columns: ["cache_key"] }),
          index({ columns: ["status", "enqueued_at"] }),
        ],
      }),
    ).toEqual([{ position: 2, kind: "key" }]);
  });

  it("should report predicate participation when a WHERE mentions the column", () => {
    expect(
      indexParticipation({
        column: column("status"),
        indexes: [index({ columns: ["cache_key"], where: "status <> 'done'" })],
      }),
    ).toEqual([{ position: 1, kind: "predicate" }]);
  });

  it("should prefer key over predicate when a column is both", () => {
    expect(
      indexParticipation({
        column: column("status"),
        indexes: [index({ columns: ["status"], where: "status <> 'done'" })],
      }),
    ).toEqual([{ position: 1, kind: "key" }]);
  });

  it("should find a column inside an expression entry", () => {
    expect(
      indexParticipation({
        column: column("email"),
        indexes: [index({ columns: ["`lower(email)`"] })],
      }),
    ).toEqual([{ position: 1, kind: "key" }]);
  });

  it("should find a double-quoted identifier inside an expression entry", () => {
    expect(
      indexParticipation({
        column: column("status"),
        indexes: [index({ columns: ['`lower("status")`'] })],
      }),
    ).toEqual([{ position: 1, kind: "key" }]);
  });

  it("should ignore non-column tokens inside expression entries", () => {
    expect(
      indexParticipation({
        column: column("date"),
        indexes: [
          index({ columns: ["`date(occurred_at)`"] }),
          index({ columns: ["`created_at::date`"] }),
          index({ columns: ["`events.date`"] }),
          index({ columns: ["`coalesce(date, CURRENT_DATE)`"] }),
        ],
      }),
    ).toEqual([{ position: 4, kind: "key" }]);
  });

  it("should not match a column whose name is a substring of another", () => {
    expect(
      indexParticipation({
        column: column("status"),
        indexes: [
          index({ columns: ["status_reason"] }),
          index({ columns: ["cache_key"], where: "status_reason IS NULL" }),
        ],
      }),
    ).toEqual([]);
  });

  it("should escape regex metacharacters in identifier names", () => {
    expect(
      indexParticipation({
        column: column("total$usd"),
        indexes: [index({ columns: ["cache_key"], where: "total$usd > 0" })],
      }),
    ).toEqual([{ position: 1, kind: "predicate" }]);
  });

  it("should ignore quoted literals when scanning a predicate", () => {
    expect(
      indexParticipation({
        column: column("active"),
        indexes: [
          index({ columns: ["cache_key"], where: "status = 'active'" }),
        ],
      }),
    ).toEqual([]);
  });

  it("should find a double-quoted identifier inside a predicate", () => {
    expect(
      indexParticipation({
        column: column("status"),
        indexes: [
          index({ columns: ["cache_key"], where: "\"status\" = 'active'" }),
        ],
      }),
    ).toEqual([{ position: 1, kind: "predicate" }]);
  });

  it("should ignore non-column tokens inside predicates", () => {
    expect(
      indexParticipation({
        column: column("date"),
        indexes: [
          index({ columns: ["id"], where: "date  (occurred_at) IS NULL" }),
          index({ columns: ["id"], where: "created_at::date IS NULL" }),
          index({ columns: ["id"], where: "events.date IS NULL" }),
          index({ columns: ["id"], where: "date IS NULL" }),
        ],
      }),
    ).toEqual([{ position: 4, kind: "predicate" }]);
  });

  it("should ignore quoted literals inside an expression entry", () => {
    expect(
      indexParticipation({
        column: column("active"),
        indexes: [index({ columns: ["`coalesce(status, 'active')`"] })],
      }),
    ).toEqual([]);
  });

  it("should treat a dollar sign as part of an identifier when matching", () => {
    expect(
      indexParticipation({
        column: column("usd"),
        indexes: [index({ columns: ["cache_key"], where: "total$usd > 0" })],
      }),
    ).toEqual([]);
    expect(
      indexParticipation({
        column: column("amount$"),
        indexes: [index({ columns: ["cache_key"], where: "amount$ > 0" })],
      }),
    ).toEqual([{ position: 1, kind: "predicate" }]);
  });

  it("should report nothing for an unreferenced column", () => {
    expect(
      indexParticipation({
        column: column("id"),
        indexes: [index({ columns: ["cache_key"] })],
      }),
    ).toEqual([]);
  });
});
