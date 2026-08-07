// Owns the labeled card-section grammar shared by protocol review cards.

import type { ElementContent } from "hast";
import type { ReactNode } from "react";
import { hastContentToReact } from "../hast-content/hast-content.js";

/** Renders the uppercase muted label naming one card section. */
export const SectionLabel = ({
  label,
  dataProperties = {},
}: {
  readonly label: string;
  readonly dataProperties?: Readonly<Record<string, string>>;
}) => (
  // The label reads a step above muted so section names anchor scanning
  // without competing with content ink.
  <div
    className="card-section-label text-2xs leading-4 font-semibold tracking-caps uppercase text-subtle"
    {...dataProperties}
  >
    {label}
  </div>
);

/** Renders one top-bordered card section holding a labeled region. */
export const CardSection = ({
  children,
  dataProperties = {},
}: {
  readonly children: ReactNode;
  readonly dataProperties?: Readonly<Record<string, string>>;
}) => (
  <section className="border-t border-edge px-4 py-4" {...dataProperties}>
    {children}
  </section>
);

// One definition entry: the dt row carries the identity spans, the dd the
// markdown body, and the div wrapper is valid dl grouping content that lets
// the border sit around the pair.
export const DefinitionEntry = ({
  term,
  body,
  dataProperties = {},
}: {
  readonly term: ReactNode;
  readonly body: ReadonlyArray<ElementContent>;
  readonly dataProperties?: Readonly<Record<string, string>>;
}) => (
  <div
    className="border-b border-edge py-3 last:border-b-0"
    {...dataProperties}
  >
    <dt className="flex flex-wrap items-baseline gap-2">{term}</dt>
    <dd className="mt-1.5 text-sm text-muted [&>:last-child]:mb-0">
      {hastContentToReact(body)}
    </dd>
  </div>
);

/** One quiet sublabeled block inside a grouped example section. */
export const ExampleBlock = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReadonlyArray<ElementContent>;
}) => (
  <>
    <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
    <div className="mb-4 last:mb-0 [&>:last-child]:mb-0">
      {hastContentToReact(children)}
    </div>
  </>
);

/** Renders the definition list wrapper for stacked entries. */
export const DefinitionList = ({
  children,
}: {
  readonly children: ReactNode;
}) => <dl className="mt-1">{children}</dl>;
