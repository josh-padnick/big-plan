// Small presentation elements for the schema figure. Each variant maps to one
// complete Tailwind class string, so extraction does not hide utility names
// from the static scanner.

import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";

const SCHEMA_CODE_CLASSES = {
  default:
    "rounded-none border-0 bg-transparent p-0 font-mono text-[0.875em] whitespace-nowrap",
  muted:
    "rounded-none border-0 bg-transparent p-0 font-mono text-[0.875em] whitespace-nowrap text-muted",
} as const;

/** Renders schema syntax without prose code decoration. */
export const SchemaCode = ({
  tone = "default",
  ...properties
}: Omit<ComponentPropsWithoutRef<"code">, "className"> & {
  readonly tone?: keyof typeof SCHEMA_CODE_CLASSES;
}): ReactElement => (
  <code className={SCHEMA_CODE_CLASSES[tone]} {...properties} />
);

const SCHEMA_CELL_CLASSES = {
  name: "table-schema-cell-name font-mono text-[0.8125rem] font-semibold",
  type: "table-schema-cell-type font-mono text-[0.8125rem]",
  constraints: "table-schema-cell-constraints text-[0.8125rem]",
  default: "table-schema-cell-default font-mono text-[0.8125rem]",
  comment: "table-schema-cell-comment text-xs leading-snug text-muted",
} as const;

/** Renders one table cell with the type and emphasis for its schema role. */
export const SchemaCell = ({
  variant,
  children,
}: {
  readonly variant: keyof typeof SCHEMA_CELL_CLASSES;
  readonly children?: ReactNode;
}): ReactElement =>
  variant === "name" ? (
    <th scope="row" className={SCHEMA_CELL_CLASSES.name}>
      {children}
    </th>
  ) : (
    <td className={SCHEMA_CELL_CLASSES[variant]}>{children}</td>
  );

const MUTED_TEXT_CLASSES = {
  inline: "text-muted",
  note: "block text-xs leading-snug text-muted",
  headerNote: "table-schema-note block pb-[0.15rem] text-xs text-muted",
  indexDefinition:
    "table-schema-index-definition block overflow-x-auto text-xs text-muted",
  refArrow: "table-schema-ref-arrow text-muted",
  schemaName: "table-schema-name-schema text-muted",
} as const;

/** Renders secondary schema text with one complete, named text shape. */
export const MutedText = ({
  variant = "inline",
  ...properties
}: Omit<ComponentPropsWithoutRef<"span">, "className"> & {
  readonly variant?: keyof typeof MUTED_TEXT_CLASSES;
}): ReactElement => (
  <span className={MUTED_TEXT_CLASSES[variant]} {...properties} />
);
