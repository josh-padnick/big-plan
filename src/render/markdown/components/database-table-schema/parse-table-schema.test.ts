// Tests the DBML-subset grammar: column settings, quoting edge cases, the
// indexes block, the table Note, and every out-of-subset diagnostic.

import { describe, expect, it } from "vitest";
import { parseTableSchema } from "./parse-table-schema.js";

describe("parseTableSchema columns", () => {
  it("should parse a bare column with a multi-word type", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "created_at timestamp with time zone\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns).toEqual([
      {
        name: "created_at",
        type: "timestamp with time zone",
        primaryKey: false,
        notNull: false,
        unique: false,
        identity: false,
      },
    ]);
  });

  it("should keep array brackets as type text when no settings follow", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "tags text[]\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]?.type).toBe("text[]");
  });

  it("should separate an array type from a whitespace-preceded settings group", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "tags text[] [not null]\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]).toMatchObject({ type: "text[]", notNull: true });
  });

  it("should parse every column marker", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "id bigint [pk, unique, increment, not null]\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]).toMatchObject({
      primaryKey: true,
      unique: true,
      identity: true,
      notNull: true,
    });
  });

  it("should treat primary key as the pk marker and imply not null", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "id bigint [primary key]\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]).toMatchObject({
      primaryKey: true,
      notNull: true,
    });
  });

  it.each(["pk", "not null", "null", "unique", "increment"])(
    "should diagnose a value on the %s marker instead of enabling it",
    (marker) => {
      const { schema, diagnostics } = parseTableSchema({
        source: `id bigint [${marker}: false]\n`,
      });
      expect(diagnostics).toEqual([
        { line: 1, message: `The "${marker}" marker does not take a value` },
      ]);
      expect(schema.columns[0]).toMatchObject({
        primaryKey: false,
        notNull: false,
        unique: false,
        identity: false,
      });
    },
  );

  it("should diagnose pk next to an explicit null marker", () => {
    const { diagnostics } = parseTableSchema({
      source: "id bigint [pk, null]\n",
    });
    expect(diagnostics).toEqual([
      { line: 1, message: '"pk" and "null" contradict each other' },
    ]);
  });

  it("should separate a tab-preceded settings group from the type", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "id\tbigint\t[pk]\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]).toMatchObject({
      type: "bigint",
      primaryKey: true,
    });
  });

  it.each([
    ["default: 'trialing'", "'trialing'"],
    ['default: "trialing"', "'trialing'"],
    ["default: 0", "0"],
    ["default: -1.5", "-1.5"],
    ["default: true", "true"],
    ["default: null", "null"],
    ["default: `now()`", "now()"],
    [`default: "O'Reilly"`, "'O''Reilly'"],
    [String.raw`default: 'O\'Reilly'`, "'O''Reilly'"],
  ])("should parse %s into display text %s", (setting, display) => {
    const { schema, diagnostics } = parseTableSchema({
      source: `status text [${setting}]\n`,
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]?.defaultValue).toBe(display);
  });

  it("should diagnose an unquoted default expression", () => {
    const { diagnostics } = parseTableSchema({
      source: "status text [default: now()]\n",
    });
    expect(diagnostics).toEqual([
      {
        line: 1,
        message:
          "A default must be a number, true, false, null, a quoted string, or a backtick expression",
      },
    ]);
  });

  it("should keep commas, colons, and brackets inside quoted notes", () => {
    const { schema, diagnostics } = parseTableSchema({
      source:
        "plan text [not null, note: 'Options: [a, b], or c', default: 'x,y']\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]?.note).toBe("Options: [a, b], or c");
    expect(schema.columns[0]?.defaultValue).toBe("'x,y'");
  });

  it("should resolve escaped quotes inside a quoted value", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "plan text [note: 'the \\'trial\\' plan']\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]?.note).toBe("the 'trial' plan");
  });

  it("should diagnose an unterminated quote", () => {
    const { diagnostics } = parseTableSchema({
      source: "plan text [note: 'oops]\n",
    });
    expect(diagnostics).toContainEqual({
      line: 1,
      message: "Unterminated quote",
    });
  });

  it("should parse a ref with referential actions", () => {
    const { schema, diagnostics } = parseTableSchema({
      source:
        "customer_id bigint [not null, ref: > public.customers.id, delete: cascade, update: set null]\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]?.ref).toEqual({
      target: "public.customers.id",
      onDelete: "cascade",
      onUpdate: "set null",
    });
  });

  it("should diagnose ref operators outside the subset", () => {
    const { diagnostics } = parseTableSchema({
      source: "customer_id bigint [ref: <> customers.id]\n",
    });
    expect(diagnostics).toEqual([
      {
        line: 1,
        message:
          'Only many-to-one refs (>) are supported on a column; "<>" is outside the subset',
      },
    ]);
  });

  it("should diagnose a ref target that is not table.column", () => {
    const { diagnostics } = parseTableSchema({
      source: "customer_id bigint [ref: > customers]\n",
    });
    expect(diagnostics).toEqual([
      {
        line: 1,
        message:
          'Expected a ref target like "table.column" or "schema.table.column", got "customers"',
      },
    ]);
  });

  it("should diagnose actions without a ref on the same line", () => {
    const { diagnostics } = parseTableSchema({
      source: "customer_id bigint [delete: cascade]\n",
    });
    expect(diagnostics).toEqual([
      {
        line: 1,
        message: "delete: and update: require a ref: on the same line",
      },
    ]);
  });

  it("should diagnose contradictory nullability markers", () => {
    const { diagnostics } = parseTableSchema({
      source: "plan text [not null, null]\n",
    });
    expect(diagnostics).toEqual([
      { line: 1, message: '"not null" and "null" contradict each other' },
    ]);
  });

  it("should diagnose duplicate settings once per key", () => {
    const { diagnostics } = parseTableSchema({
      source: "id bigint [pk, primary key]\n",
    });
    expect(diagnostics).toEqual([
      { line: 1, message: 'Duplicate setting "primary key"' },
    ]);
  });

  it("should diagnose an unknown setting with the supported list", () => {
    const { diagnostics } = parseTableSchema({
      source: "id bigint [indexed]\n",
    });
    expect(diagnostics).toEqual([
      {
        line: 1,
        message:
          'Unknown column setting "indexed"; supported settings: pk, not null, null, unique, increment, default:, note:, check:, ref:, delete:, update:',
      },
    ]);
  });

  it("should diagnose duplicate column names", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "id bigint\nid text\n",
    });
    expect(diagnostics).toEqual([
      { line: 2, message: 'Duplicate column "id"' },
    ]);
    expect(schema.columns).toHaveLength(1);
  });

  it("should diagnose a missing type and a malformed name", () => {
    expect(
      parseTableSchema({ source: "id\nother text\n" }).diagnostics,
    ).toEqual([{ line: 1, message: 'Column "id" is missing a type' }]);
    expect(
      parseTableSchema({ source: "user-id bigint\n" }).diagnostics,
    ).toEqual([
      {
        line: 1,
        message:
          'Expected a column declaration like "name type [settings]"; "user-id" is not a bare identifier',
      },
      {
        line: 1,
        message: "DatabaseTableSchema must declare at least one column",
      },
    ]);
  });

  it("should diagnose a settings group that does not close the line", () => {
    const { diagnostics } = parseTableSchema({
      source: "id bigint [pk] extra\n",
    });
    expect(diagnostics).toContainEqual({
      line: 1,
      message: "A [settings] group must close at the end of the line",
    });
  });

  it("should parse a check expression", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "username text [check: 'char_length(username) > 4']\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.columns[0]?.check).toBe("char_length(username) > 4");
  });
});

describe("parseTableSchema indexes", () => {
  const withColumns = (body: string): string =>
    `customer_id bigint\nstatus text\n${body}`;

  it("should parse single, composite, and expression entries", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: withColumns(
        "indexes {\n  (customer_id, status)\n  status [unique, name: 'status_idx', type: hash]\n  `lower(status)`\n}\n",
      ),
    });
    expect(diagnostics).toEqual([]);
    expect(schema.indexes).toEqual([
      { columns: ["customer_id", "status"], unique: false },
      {
        columns: ["status"],
        unique: true,
        name: "status_idx",
        method: "hash",
      },
      // Expression entries stay verbatim, backticks included, so the
      // renderer can tell them apart from declared column names.
      { columns: ["`lower(status)`"], unique: false },
    ]);
  });

  it("should parse the partial-index where extension", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: withColumns(
        "indexes {\n  status [unique, where: 'status = \\'live\\'']\n}\n",
      ),
    });
    expect(diagnostics).toEqual([]);
    expect(schema.indexes[0]?.where).toBe("status = 'live'");
  });

  it("should diagnose a value on the unique index marker instead of enabling it", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: withColumns("indexes {\n  status [unique: false]\n}\n"),
    });
    expect(diagnostics).toEqual([
      { line: 4, message: 'The "unique" marker does not take a value' },
    ]);
    expect(schema.indexes[0]?.unique).toBe(false);
  });

  it("should diagnose an expression entry with text outside the backticks", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: withColumns("indexes {\n  `lower(status)` trailing\n}\n"),
    });
    expect(diagnostics).toEqual([
      {
        line: 4,
        message:
          "A backtick expression must span its whole index entry, like `lower(email)`",
      },
    ]);
    expect(schema.indexes).toEqual([]);
  });

  it("should diagnose an unknown index method and unknown setting", () => {
    const { diagnostics } = parseTableSchema({
      source: withColumns(
        "indexes {\n  status [type: brin]\n  status [foo]\n}\n",
      ),
    });
    expect(diagnostics).toEqual([
      {
        line: 4,
        message: "The type: setting expects one of: btree, hash, gin, gist",
      },
      {
        line: 5,
        message:
          'Unknown index setting "foo"; supported settings: unique, name:, type:, where:, note:',
      },
    ]);
  });

  it("should point pk index entries back to the column line", () => {
    const { diagnostics } = parseTableSchema({
      source: withColumns("indexes {\n  status [pk]\n}\n"),
    });
    expect(diagnostics).toEqual([
      {
        line: 4,
        message: "Primary keys are declared with pk on the column line",
      },
    ]);
  });

  it("should diagnose entries naming undeclared columns at their line", () => {
    const { diagnostics } = parseTableSchema({
      source: withColumns("indexes {\n  (customer_id, missing)\n}\n"),
    });
    expect(diagnostics).toEqual([
      { line: 4, message: 'Index references unknown column "missing"' },
    ]);
  });

  it("should diagnose a second indexes block and an unclosed block", () => {
    expect(
      parseTableSchema({
        source: withColumns("indexes {\n}\nindexes {\n}\n"),
      }).diagnostics,
    ).toEqual([{ line: 5, message: "Only one indexes block is supported" }]);
    expect(
      parseTableSchema({ source: withColumns("indexes {\n  status\n") })
        .diagnostics,
    ).toEqual([
      { line: 3, message: 'The indexes block is missing its closing "}"' },
    ]);
  });

  it("should diagnose a stray closing brace", () => {
    const { diagnostics } = parseTableSchema({
      source: withColumns("}\n"),
    });
    expect(diagnostics).toEqual([
      { line: 3, message: 'Unexpected "}" outside an indexes block' },
    ]);
  });
});

describe("parseTableSchema table shape", () => {
  it("should parse a single quoted table Note", () => {
    const { schema, diagnostics } = parseTableSchema({
      source: "id bigint\nNote: 'One row per subscription attempt.'\n",
    });
    expect(diagnostics).toEqual([]);
    expect(schema.note).toBe("One row per subscription attempt.");
  });

  it("should diagnose an unquoted or duplicate Note", () => {
    expect(
      parseTableSchema({ source: "id bigint\nNote: bare text\n" }).diagnostics,
    ).toEqual([
      {
        line: 2,
        message: "The Note: setting requires a single-line quoted value",
      },
    ]);
    expect(
      parseTableSchema({ source: "id bigint\nNote: 'a'\nNote: 'b'\n" })
        .diagnostics,
    ).toEqual([{ line: 3, message: "Only one table Note is supported" }]);
  });

  it("should reject an empty fence", () => {
    const { diagnostics } = parseTableSchema({ source: "\n\n" });
    expect(diagnostics).toEqual([
      {
        line: 1,
        message: "DatabaseTableSchema must declare at least one column",
      },
    ]);
  });

  it.each([
    [
      "Table users {",
      "Table blocks are not supported; the table identity lives on the component's name attribute",
    ],
    [
      "Ref: posts.user_id > users.id",
      "Standalone Ref lines are not supported; use ref: on the column line",
    ],
    [
      "Enum status_values {",
      "Enum blocks are not supported; use the enum type name as the column type and a note: for its values",
    ],
    [
      "TableGroup billing {",
      "Only column lines, one indexes block, and one Note are supported inside the fence",
    ],
  ])(
    "should name the alternative for out-of-subset line %s",
    (line, message) => {
      const { diagnostics } = parseTableSchema({
        source: `id bigint\n${line}\n`,
      });
      expect(diagnostics).toEqual([{ line: 2, message }]);
    },
  );

  it("should ignore blank and whitespace-only lines when numbering", () => {
    const { diagnostics } = parseTableSchema({
      source: "\nid bigint\n\n   \nbroken\n",
    });
    expect(diagnostics).toEqual([
      { line: 5, message: 'Column "broken" is missing a type' },
    ]);
  });
});
