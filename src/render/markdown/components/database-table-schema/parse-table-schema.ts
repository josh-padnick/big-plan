// Owns the DatabaseTableSchema fence grammar: a validated DBML subset of
// one-line column declarations, one optional indexes block, and one optional
// table Note, with per-line diagnostics that name the subset boundary.

export type ReferentialAction =
  "cascade" | "restrict" | "set null" | "set default" | "no action";

export type TableColumnRef = {
  readonly target: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
};

export type TableColumn = {
  readonly name: string;
  readonly type: string;
  readonly primaryKey: boolean;
  readonly notNull: boolean;
  readonly unique: boolean;
  readonly identity: boolean;
  readonly defaultValue?: string;
  readonly note?: string;
  readonly check?: string;
  readonly ref?: TableColumnRef;
};

export type TableIndex = {
  readonly columns: ReadonlyArray<string>;
  readonly unique: boolean;
  readonly name?: string;
  readonly method?: string;
  readonly where?: string;
  readonly note?: string;
};

export type TableSchema = {
  readonly columns: ReadonlyArray<TableColumn>;
  readonly indexes: ReadonlyArray<TableIndex>;
  readonly note?: string;
};

export type TableSchemaParseDiagnostic = {
  readonly line: number;
  readonly message: string;
};

export type ParseTableSchemaResult = {
  readonly schema: TableSchema;
  readonly diagnostics: ReadonlyArray<TableSchemaParseDiagnostic>;
};

const REFERENTIAL_ACTIONS: ReadonlyArray<ReferentialAction> = [
  "cascade",
  "restrict",
  "set null",
  "set default",
  "no action",
];

const INDEX_METHODS: ReadonlyArray<string> = ["btree", "hash", "gin", "gist"];

const COLUMN_SETTING_SUMMARY =
  "pk, not null, null, unique, increment, default:, note:, check:, ref:, delete:, update:";
const INDEX_SETTING_SUMMARY = "unique, name:, type:, where:, note:";

const isReferentialAction = (value: string): value is ReferentialAction =>
  REFERENTIAL_ACTIONS.some((action) => action === value);

const sourceLines = (source: string): ReadonlyArray<string> => {
  const lines = source.split(/\r?\n/u);
  if (lines.at(-1) === "") {
    return lines.slice(0, -1);
  }
  return lines;
};

// Quoted strings ('…', "…") with backslash escapes and backtick expressions
// are opaque to every structural scan below, so commas, colons, and brackets
// inside authored text can never break a line apart.
const topLevelIndexes = ({
  value,
  matches,
}: {
  readonly value: string;
  readonly matches: (character: string, index: number) => boolean;
}): ReadonlyArray<number> | undefined => {
  const indexes: Array<number> = [];
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote !== undefined) {
      if (character === "\\" && quote !== "`") {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (matches(character, index)) {
      indexes.push(index);
    }
  }
  return quote === undefined ? indexes : undefined;
};

// Resolves one quoted value ('…' or "…") to its inner text, or returns
// undefined for anything unquoted so callers can demand quoting explicitly.
const unquote = (value: string): string | undefined => {
  const first = value.at(0);
  if ((first !== "'" && first !== '"') || value.length < 2) {
    return undefined;
  }
  if (value.at(-1) !== first) {
    return undefined;
  }
  return value.slice(1, -1).replaceAll(`\\${first}`, first);
};

type ParsedSetting = {
  readonly key: string;
  readonly value?: string;
};

// Splits a settings group into flag and key-value entries; a colon separates
// a key from its value only at the top level, so quoted values keep colons.
const parseSettings = ({
  content,
  line,
  diagnostics,
}: {
  readonly content: string;
  readonly line: number;
  readonly diagnostics: Array<TableSchemaParseDiagnostic>;
}): ReadonlyArray<ParsedSetting> | undefined => {
  const commaIndexes = topLevelIndexes({
    value: content,
    matches: (character) => character === ",",
  });
  if (commaIndexes === undefined) {
    diagnostics.push({ line, message: "Unterminated quote in settings" });
    return undefined;
  }
  const settings: Array<ParsedSetting> = [];
  let start = 0;
  for (const end of [...commaIndexes, content.length]) {
    const raw = content.slice(start, end).trim();
    start = end + 1;
    if (raw === "") {
      diagnostics.push({ line, message: "Empty setting in settings group" });
      continue;
    }
    const colonIndexes = topLevelIndexes({
      value: raw,
      matches: (character) => character === ":",
    });
    const colonIndex = colonIndexes?.[0];
    if (colonIndex === undefined) {
      settings.push({ key: raw.toLowerCase() });
    } else {
      settings.push({
        key: raw.slice(0, colonIndex).trim().toLowerCase(),
        value: raw.slice(colonIndex + 1).trim(),
      });
    }
  }
  return settings;
};

// Separates a line's trailing [settings] group from the declaration before
// it. The opening bracket must follow whitespace so array types like text[]
// stay part of the type text.
const splitSettingsGroup = ({
  value,
  line,
  diagnostics,
}: {
  readonly value: string;
  readonly line: number;
  readonly diagnostics: Array<TableSchemaParseDiagnostic>;
}):
  { readonly head: string; readonly settingsContent?: string } | undefined => {
  const bracketIndexes = topLevelIndexes({
    value,
    matches: (character, index) =>
      character === "[" && index > 0 && /\s/u.test(value[index - 1] ?? ""),
  });
  if (bracketIndexes === undefined) {
    diagnostics.push({ line, message: "Unterminated quote" });
    return undefined;
  }
  const openIndex = bracketIndexes[0];
  if (openIndex === undefined) {
    return { head: value.trim() };
  }
  const closeIndexes = topLevelIndexes({
    value,
    matches: (character) => character === "]",
  });
  const closeIndex = closeIndexes?.at(-1);
  if (closeIndex === undefined || closeIndex !== value.trimEnd().length - 1) {
    diagnostics.push({
      line,
      message: "A [settings] group must close at the end of the line",
    });
    return undefined;
  }
  return {
    head: value.slice(0, openIndex).trim(),
    settingsContent: value.slice(openIndex + 1, closeIndex),
  };
};

// Renders one authored default into its display text: quoted strings keep
// their quotes psql-style, backtick expressions shed the backticks.
const parseDefaultValue = ({
  value,
  line,
  diagnostics,
}: {
  readonly value: string;
  readonly line: number;
  readonly diagnostics: Array<TableSchemaParseDiagnostic>;
}): string | undefined => {
  const inner = unquote(value);
  if (inner !== undefined) {
    // Embedded apostrophes double psql-style so the displayed literal stays
    // valid SQL whatever quotes the author used.
    return `'${inner.replaceAll("'", "''")}'`;
  }
  if (value.startsWith("`") && value.endsWith("`") && value.length > 1) {
    return value.slice(1, -1);
  }
  if (/^(?:-?\d+(?:\.\d+)?|true|false|null)$/u.test(value)) {
    return value;
  }
  diagnostics.push({
    line,
    message:
      "A default must be a number, true, false, null, a quoted string, or a backtick expression",
  });
  return undefined;
};

const requireQuoted = ({
  key,
  value,
  line,
  diagnostics,
}: {
  readonly key: string;
  readonly value: string | undefined;
  readonly line: number;
  readonly diagnostics: Array<TableSchemaParseDiagnostic>;
}): string | undefined => {
  const inner = value === undefined ? undefined : unquote(value);
  if (inner === undefined) {
    diagnostics.push({
      line,
      message: `The ${key}: setting requires a single-line quoted value`,
    });
    return undefined;
  }
  return inner;
};

type MutableColumn = {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  nullable: boolean;
  unique: boolean;
  identity: boolean;
  defaultValue?: string;
  note?: string;
  check?: string;
  refTarget?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
};

// Applies one column setting, reporting duplicates and out-of-subset keys
// with the supported alternative where one exists.
const applyColumnSetting = ({
  setting,
  column,
  line,
  seen,
  diagnostics,
}: {
  readonly setting: ParsedSetting;
  readonly column: MutableColumn;
  readonly line: number;
  readonly seen: Set<string>;
  readonly diagnostics: Array<TableSchemaParseDiagnostic>;
}): void => {
  const { key, value } = setting;
  const canonical = key === "primary key" ? "pk" : key;
  if (seen.has(canonical)) {
    diagnostics.push({ line, message: `Duplicate setting "${key}"` });
    return;
  }
  seen.add(canonical);
  switch (canonical) {
    case "pk":
    case "not null":
    case "null":
    case "unique":
    case "increment": {
      // Markers are pure flags; a value like pk: false would silently invert
      // the authored semantics if the key alone enabled the constraint.
      if (value !== undefined) {
        diagnostics.push({
          line,
          message: `The "${key}" marker does not take a value`,
        });
        return;
      }
      if (canonical === "pk") {
        column.primaryKey = true;
      } else if (canonical === "not null") {
        column.notNull = true;
      } else if (canonical === "null") {
        column.nullable = true;
      } else if (canonical === "unique") {
        column.unique = true;
      } else {
        column.identity = true;
      }
      return;
    }
    case "default": {
      const parsed =
        value === undefined
          ? undefined
          : parseDefaultValue({ value, line, diagnostics });
      if (value === undefined) {
        diagnostics.push({
          line,
          message: "The default: setting requires a value",
        });
      } else if (parsed !== undefined) {
        column.defaultValue = parsed;
      }
      return;
    }
    case "note": {
      const inner = requireQuoted({ key: "note", value, line, diagnostics });
      if (inner !== undefined) {
        column.note = inner;
      }
      return;
    }
    case "check": {
      const inner = requireQuoted({ key: "check", value, line, diagnostics });
      if (inner !== undefined) {
        column.check = inner;
      }
      return;
    }
    case "ref": {
      const match =
        value === undefined ? null : /^(<>|>|<|-)\s*(.+)$/u.exec(value);
      if (match === null) {
        diagnostics.push({
          line,
          message:
            'The ref: setting requires a relation like "ref: > table.column"',
        });
        return;
      }
      const [, operator = "", target = ""] = match;
      if (operator !== ">") {
        diagnostics.push({
          line,
          message: `Only many-to-one refs (>) are supported on a column; "${operator}" is outside the subset`,
        });
        return;
      }
      if (!/^[\w$]+(?:\.[\w$]+){1,2}$/u.test(target)) {
        diagnostics.push({
          line,
          message: `Expected a ref target like "table.column" or "schema.table.column", got "${target}"`,
        });
        return;
      }
      column.refTarget = target;
      return;
    }
    case "delete":
    case "update": {
      const action = value?.toLowerCase();
      if (action === undefined || !isReferentialAction(action)) {
        diagnostics.push({
          line,
          message: `The ${canonical}: setting expects one of: ${REFERENTIAL_ACTIONS.join(", ")}`,
        });
        return;
      }
      if (canonical === "delete") {
        column.onDelete = action;
      } else {
        column.onUpdate = action;
      }
      return;
    }
    default:
      diagnostics.push({
        line,
        message: `Unknown column setting "${key}"; supported settings: ${COLUMN_SETTING_SUMMARY}`,
      });
  }
};

// Parses one column declaration line: a bare identifier, freeform type text,
// and an optional settings group.
const parseColumnLine = ({
  value,
  line,
  diagnostics,
}: {
  readonly value: string;
  readonly line: number;
  readonly diagnostics: Array<TableSchemaParseDiagnostic>;
}): TableColumn | undefined => {
  const split = splitSettingsGroup({ value, line, diagnostics });
  if (split === undefined) {
    return undefined;
  }
  const spaceIndex = split.head.search(/\s/u);
  const name = spaceIndex === -1 ? split.head : split.head.slice(0, spaceIndex);
  const type = spaceIndex === -1 ? "" : split.head.slice(spaceIndex).trim();
  if (!/^[A-Za-z_][\w$]*$/u.test(name)) {
    diagnostics.push({
      line,
      message: `Expected a column declaration like "name type [settings]"; "${name}" is not a bare identifier`,
    });
    return undefined;
  }
  if (type === "") {
    diagnostics.push({
      line,
      message: `Column "${name}" is missing a type`,
    });
    return undefined;
  }
  const column: MutableColumn = {
    name,
    type,
    primaryKey: false,
    notNull: false,
    nullable: false,
    unique: false,
    identity: false,
  };
  if (split.settingsContent !== undefined) {
    const settings = parseSettings({
      content: split.settingsContent,
      line,
      diagnostics,
    });
    const seen = new Set<string>();
    for (const setting of settings ?? []) {
      applyColumnSetting({ setting, column, line, seen, diagnostics });
    }
    if (
      (column.onDelete !== undefined || column.onUpdate !== undefined) &&
      column.refTarget === undefined
    ) {
      diagnostics.push({
        line,
        message: "delete: and update: require a ref: on the same line",
      });
    }
    if (column.notNull && column.nullable) {
      diagnostics.push({
        line,
        message: '"not null" and "null" contradict each other',
      });
    }
    // Checked here rather than after the pk-implies-not-null fold below, so
    // an explicit null next to pk fails loudly instead of being discarded.
    if (column.primaryKey && column.nullable) {
      diagnostics.push({
        line,
        message: '"pk" and "null" contradict each other',
      });
    }
  }
  return {
    name: column.name,
    type: column.type,
    primaryKey: column.primaryKey,
    // A primary key is not null by definition, so the grid can say so even
    // when the author omits the redundant marker.
    notNull: column.notNull || column.primaryKey,
    unique: column.unique,
    identity: column.identity,
    ...(column.defaultValue === undefined
      ? {}
      : { defaultValue: column.defaultValue }),
    ...(column.note === undefined ? {} : { note: column.note }),
    ...(column.check === undefined ? {} : { check: column.check }),
    ...(column.refTarget === undefined
      ? {}
      : {
          ref: {
            target: column.refTarget,
            ...(column.onDelete === undefined
              ? {}
              : { onDelete: column.onDelete }),
            ...(column.onUpdate === undefined
              ? {}
              : { onUpdate: column.onUpdate }),
          },
        }),
  };
};

// Parses one indexes-block entry: a column, a (composite, tuple), or a
// backtick expression, with an optional settings group.
const parseIndexLine = ({
  value,
  line,
  diagnostics,
}: {
  readonly value: string;
  readonly line: number;
  readonly diagnostics: Array<TableSchemaParseDiagnostic>;
}): TableIndex | undefined => {
  const split = splitSettingsGroup({ value, line, diagnostics });
  if (split === undefined) {
    return undefined;
  }
  const { head } = split;
  let columns: ReadonlyArray<string>;
  if (head.startsWith("(") && head.endsWith(")")) {
    const inner = head.slice(1, -1);
    const commaIndexes = topLevelIndexes({
      value: inner,
      matches: (character) => character === ",",
    });
    if (commaIndexes === undefined) {
      diagnostics.push({ line, message: "Unterminated quote" });
      return undefined;
    }
    const parts: Array<string> = [];
    let start = 0;
    for (const end of [...commaIndexes, inner.length]) {
      parts.push(inner.slice(start, end).trim());
      start = end + 1;
    }
    columns = parts;
  } else {
    columns = [head];
  }
  if (columns.some((column) => column === "")) {
    diagnostics.push({
      line,
      message:
        'Expected an index entry like "column", "(a, b)", or a backtick expression',
    });
    return undefined;
  }
  // A leading backtick alone must not classify an entry as an expression, or
  // trailing text after the closing backtick would render as if validated.
  if (
    columns.some((column) => column.includes("`") && !/^`[^`]+`$/u.test(column))
  ) {
    diagnostics.push({
      line,
      message:
        "A backtick expression must span its whole index entry, like `lower(email)`",
    });
    return undefined;
  }
  const index: {
    unique: boolean;
    name?: string;
    method?: string;
    where?: string;
    note?: string;
  } = { unique: false };
  const settings =
    split.settingsContent === undefined
      ? []
      : (parseSettings({ content: split.settingsContent, line, diagnostics }) ??
        []);
  const seen = new Set<string>();
  for (const { key, value: settingValue } of settings) {
    if (seen.has(key)) {
      diagnostics.push({ line, message: `Duplicate setting "${key}"` });
      continue;
    }
    seen.add(key);
    if (key === "unique") {
      if (settingValue !== undefined) {
        diagnostics.push({
          line,
          message: 'The "unique" marker does not take a value',
        });
      } else {
        index.unique = true;
      }
    } else if (key === "pk") {
      diagnostics.push({
        line,
        message: "Primary keys are declared with pk on the column line",
      });
    } else if (key === "name") {
      const inner = requireQuoted({
        key: "name",
        value: settingValue,
        line,
        diagnostics,
      });
      if (inner !== undefined) {
        index.name = inner;
      }
    } else if (key === "type") {
      const method = settingValue?.toLowerCase();
      if (method === undefined || !INDEX_METHODS.includes(method)) {
        diagnostics.push({
          line,
          message: `The type: setting expects one of: ${INDEX_METHODS.join(", ")}`,
        });
      } else {
        index.method = method;
      }
    } else if (key === "where") {
      const inner = requireQuoted({
        key: "where",
        value: settingValue,
        line,
        diagnostics,
      });
      if (inner !== undefined) {
        index.where = inner;
      }
    } else if (key === "note") {
      const inner = requireQuoted({
        key: "note",
        value: settingValue,
        line,
        diagnostics,
      });
      if (inner !== undefined) {
        index.note = inner;
      }
    } else {
      diagnostics.push({
        line,
        message: `Unknown index setting "${key}"; supported settings: ${INDEX_SETTING_SUMMARY}`,
      });
    }
  }
  return {
    columns,
    unique: index.unique,
    ...(index.name === undefined ? {} : { name: index.name }),
    ...(index.method === undefined ? {} : { method: index.method }),
    ...(index.where === undefined ? {} : { where: index.where }),
    ...(index.note === undefined ? {} : { note: index.note }),
  };
};

// Out-of-subset DBML constructs each get a diagnostic naming the supported
// alternative, so an author is never left guessing what was ignored.
const OUT_OF_SUBSET_LINES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly message: string;
}> = [
  {
    pattern: /^Table\b/u,
    message:
      "Table blocks are not supported; the table identity lives on the component's name attribute",
  },
  {
    pattern: /^Ref\b/u,
    message:
      "Standalone Ref lines are not supported; use ref: on the column line",
  },
  {
    pattern: /^Enum\b/u,
    message:
      "Enum blocks are not supported; use the enum type name as the column type and a note: for its values",
  },
  {
    pattern: /^(?:TableGroup|TablePartial|Project)\b/u,
    message:
      "Only column lines, one indexes block, and one Note are supported inside the fence",
  },
];

/** Parses one dbml fence into a validated single-table schema model. */
export const parseTableSchema = ({
  source,
}: {
  readonly source: string;
}): ParseTableSchemaResult => {
  const columns: Array<TableColumn> = [];
  const indexes: Array<{ readonly index: TableIndex; readonly line: number }> =
    [];
  const diagnostics: Array<TableSchemaParseDiagnostic> = [];
  let note: string | undefined;
  let indexesOpenLine: number | undefined;
  let indexesSeen = false;
  let insideIndexes = false;

  for (const [lineIndex, rawValue] of sourceLines(source).entries()) {
    const value = rawValue.trim();
    const line = lineIndex + 1;
    if (value === "") {
      continue;
    }
    if (insideIndexes) {
      if (value === "}") {
        insideIndexes = false;
        continue;
      }
      const index = parseIndexLine({ value, line, diagnostics });
      if (index !== undefined) {
        indexes.push({ index, line });
      }
      continue;
    }
    if (/^indexes\s*\{$/u.test(value)) {
      if (indexesSeen) {
        diagnostics.push({
          line,
          message: "Only one indexes block is supported",
        });
      }
      indexesSeen = true;
      insideIndexes = true;
      indexesOpenLine = line;
      continue;
    }
    if (value === "}") {
      diagnostics.push({
        line,
        message: 'Unexpected "}" outside an indexes block',
      });
      continue;
    }
    const noteMatch = /^Note:\s*(.*)$/u.exec(value);
    if (noteMatch !== null) {
      const inner = requireQuoted({
        key: "Note",
        value: noteMatch[1],
        line,
        diagnostics,
      });
      if (inner !== undefined && note !== undefined) {
        diagnostics.push({ line, message: "Only one table Note is supported" });
      } else if (inner !== undefined) {
        note = inner;
      }
      continue;
    }
    const outOfSubset = OUT_OF_SUBSET_LINES.find(({ pattern }) =>
      pattern.test(value),
    );
    if (outOfSubset !== undefined) {
      diagnostics.push({ line, message: outOfSubset.message });
      continue;
    }
    const column = parseColumnLine({ value, line, diagnostics });
    if (column !== undefined) {
      if (columns.some((existing) => existing.name === column.name)) {
        diagnostics.push({
          line,
          message: `Duplicate column "${column.name}"`,
        });
      } else {
        columns.push(column);
      }
    }
  }

  if (insideIndexes) {
    diagnostics.push({
      line: indexesOpenLine ?? 1,
      message: 'The indexes block is missing its closing "}"',
    });
  }
  if (columns.length === 0) {
    diagnostics.push({
      line: 1,
      message: "DatabaseTableSchema must declare at least one column",
    });
  }
  // Membership is checkable only after every column line has parsed, since
  // DBML allows the indexes block before the columns it references.
  const columnNames = new Set(columns.map((column) => column.name));
  for (const { index, line } of indexes) {
    for (const column of index.columns) {
      if (!column.startsWith("`") && !columnNames.has(column)) {
        diagnostics.push({
          line,
          message: `Index references unknown column "${column}"`,
        });
      }
    }
  }

  return {
    schema: {
      columns,
      indexes: indexes.map(({ index }) => index),
      ...(note === undefined ? {} : { note }),
    },
    diagnostics,
  };
};
