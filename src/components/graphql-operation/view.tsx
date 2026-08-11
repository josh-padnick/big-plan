// Renders an always-expanded GraphqlOperation review card with arguments,
// return fields, and grouped executable examples.

import type {
  CompiledGraphqlArgument,
  CompiledGraphqlExample,
  CompiledGraphqlField,
  CompiledGraphqlOperation,
  CompiledGraphqlResponse,
  CompiledGraphqlReturns,
} from "./compile.js";
import { LOCK_ICON } from "../../icons/lucide/lock.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";
import {
  CardSection,
  DefinitionEntry,
  DefinitionList,
  ExampleBlock,
  SectionLabel,
} from "../_shared/labeled-section/labeled-section.js";

// /* off-scale */ Phase A preserves the legacy 14% token washes exactly;
// Phase B will replace them with palette-backed theme shades.
const KIND_CLASSES: Readonly<Record<CompiledGraphqlOperation["kind"], string>> =
  {
    query:
      "text-[var(--callout-note-c)] [background:color-mix(in_srgb,var(--callout-note-c)_14%,transparent)]",
    mutation:
      "text-[var(--callout-warning-c)] [background:color-mix(in_srgb,var(--callout-warning-c)_14%,transparent)]",
    subscription:
      "text-[var(--annotation-c)] [background:color-mix(in_srgb,var(--annotation-c)_14%,transparent)]",
  };

const DEPRECATED_CLASSES =
  "text-muted [background:color-mix(in_srgb,var(--color-muted)_14%,transparent)]";

const MonoType = ({ value }: { readonly value: string }) => (
  <span className="font-mono text-xs text-muted">{value}</span>
);

// Renders one argument as a definition pair; the literal GraphQL type keeps
// its `!` and `[...]` markers because that is how the ecosystem states
// requiredness.
const ArgumentEntry = ({
  argument,
}: {
  readonly argument: CompiledGraphqlArgument;
}) => (
  <DefinitionEntry
    dataProperties={{ "data-graphql-argument": argument.name }}
    term={
      <>
        <span className="font-mono text-sm font-semibold">{argument.name}</span>
        <MonoType value={argument.argumentType} />
      </>
    }
    body={argument.children}
  />
);

// One expanded field: literal type beside the name, an authored default
// beside that, and the markdown description beneath.
const FieldEntry = ({ field }: { readonly field: CompiledGraphqlField }) => (
  <DefinitionEntry
    dataProperties={{ "data-graphql-field": field.side }}
    term={
      <>
        <span className="font-mono text-sm font-semibold">{field.name}</span>
        <MonoType value={field.fieldType} />
        {field.defaultValue === undefined ? null : (
          <span className="text-2xs text-muted">
            {"default "}
            <span className="font-mono">{field.defaultValue}</span>
          </span>
        )}
      </>
    }
    body={field.children}
  />
);

// One level of expansion, indented under the argument or return entry it
// details, so the reader gets the shape without leaving the card.
const FieldExpansion = ({
  fields,
}: {
  readonly fields: ReadonlyArray<CompiledGraphqlField>;
}) => (
  <div className="mt-1 border-l border-edge pl-4">
    <DefinitionList>
      {fields.map((field) => (
        <FieldEntry key={field.name} field={field} />
      ))}
    </DefinitionList>
  </div>
);

// Builds the complete card while omitting every empty optional region; a
// header-only operation is a legitimate compact way to enumerate a schema.
export const GraphqlOperation = ({
  model,
}: {
  readonly model: CompiledGraphqlOperation;
}) => (
  <figure
    className="graphql-operation mb-6 min-w-0 overflow-hidden rounded-md border border-edge bg-raised"
    data-graphql-operation=""
    data-graphql-kind={model.kind}
    {...(model.deprecated ? { "data-graphql-deprecated": "" } : {})}
  >
    <header className="flex min-w-0 items-start justify-between gap-1 bg-header px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <BadgePill
            label={model.kind}
            classNames={[
              "graphql-operation-kind-pill",
              KIND_CLASSES[model.kind],
            ]}
          />
          <span
            className={[
              "font-mono",
              "text-sm",
              "font-semibold",
              ...(model.deprecated ? ["text-muted", "line-through"] : []),
            ].join(" ")}
          >
            {model.name}
          </span>
          {model.deprecated ? (
            <BadgePill label="Deprecated" classNames={[DEPRECATED_CLASSES]} />
          ) : null}
          {model.deprecationReason === undefined ? null : (
            <span className="text-sm text-muted">
              {model.deprecationReason}
            </span>
          )}
        </div>
        {model.access === undefined ? null : (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
            {lucideIconToReact({ icon: LOCK_ICON, hidden: false })}
            {model.access}
          </div>
        )}
      </div>
      <span className="figure-action-group inline-flex shrink-0 items-center gap-1" />
    </header>
    {model.description.length === 0 ? null : (
      <div className="px-4 py-4 [&>:last-child]:mb-0">
        {hastContentToReact(model.description)}
      </div>
    )}
    {model.args.length === 0 && model.inputFields.length === 0 ? null : (
      <CardSection>
        <SectionLabel label="Arguments" />
        <DefinitionList>
          {model.args.map((argument) => (
            <ArgumentEntry key={argument.name} argument={argument} />
          ))}
        </DefinitionList>
        {model.inputFields.length === 0 ? null : (
          <FieldExpansion fields={model.inputFields} />
        )}
      </CardSection>
    )}
    {model.returns === undefined && model.payloadFields.length === 0 ? null : (
      <ReturnsSection
        {...(model.returns === undefined ? {} : { returns: model.returns })}
        payloadFields={model.payloadFields}
      />
    )}
    {model.operation === undefined &&
    model.variables === undefined &&
    model.responses.length === 0 ? null : (
      <ExampleSection
        {...(model.operation === undefined
          ? {}
          : { operation: model.operation })}
        {...(model.variables === undefined
          ? {}
          : { variables: model.variables })}
        responses={model.responses}
      />
    )}
  </figure>
);

const ReturnsSection = ({
  returns,
  payloadFields,
}: {
  readonly returns?: CompiledGraphqlReturns;
  readonly payloadFields: ReadonlyArray<CompiledGraphqlField>;
}) => (
  <CardSection>
    <SectionLabel label="Returns" />
    {returns === undefined ? null : (
      <DefinitionList>
        <DefinitionEntry
          term={
            <span className="font-mono text-sm font-semibold">
              {returns.returnType}
            </span>
          }
          body={returns.children}
        />
      </DefinitionList>
    )}
    {payloadFields.length === 0 ? null : (
      <FieldExpansion fields={payloadFields} />
    )}
  </CardSection>
);

// Operation, variables, and responses form one executable example, so they
// share one labeled section instead of three sibling sections.
const ExampleSection = ({
  operation,
  variables,
  responses,
}: {
  readonly operation?: CompiledGraphqlExample;
  readonly variables?: CompiledGraphqlExample;
  readonly responses: ReadonlyArray<CompiledGraphqlResponse>;
}) => (
  <CardSection dataProperties={{ "data-graphql-example": "" }}>
    <div className="mb-3">
      <SectionLabel label="Example" />
    </div>
    {operation === undefined ? null : (
      <ExampleBlock label="Operation" children={operation.children} />
    )}
    {variables === undefined ? null : (
      <ExampleBlock label="Variables" children={variables.children} />
    )}
    {responses.map((response, index) => (
      <ExampleBlock
        key={index}
        label={response.label ?? "Response"}
        children={response.children}
      />
    ))}
  </CardSection>
);
