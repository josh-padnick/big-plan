// Renders an always-expanded GrpcMethod review card with the authentic proto
// signature, message-typed fields, status codes, examples, and proto source.

import type { ElementContent } from "hast";
import type {
  CompiledGrpcError,
  CompiledGrpcField,
  CompiledGrpcMethod,
  GrpcStreamingKind,
} from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";
import {
  CardSection,
  DefinitionEntry,
  DefinitionList,
  ExampleBlock,
  SectionLabel,
} from "../_shared/labeled-section/labeled-section.js";

const KIND_LABELS: Readonly<Record<GrpcStreamingKind, string>> = {
  unary: "Unary",
  serverStreaming: "Server streaming",
  clientStreaming: "Client streaming",
  bidiStreaming: "Bidirectional streaming",
};

// /* off-scale */ Phase A preserves the legacy 14% token washes exactly;
// Phase B will replace them with palette-backed theme shades.
const KIND_CLASSES: Readonly<Record<GrpcStreamingKind, string>> = {
  unary:
    "text-muted [background:color-mix(in_srgb,var(--color-muted)_14%,transparent)]",
  serverStreaming:
    "text-[var(--callout-note-c)] [background:color-mix(in_srgb,var(--callout-note-c)_14%,transparent)]",
  clientStreaming:
    "text-[var(--callout-warning-c)] [background:color-mix(in_srgb,var(--callout-warning-c)_14%,transparent)]",
  bidiStreaming:
    "text-[var(--annotation-c)] [background:color-mix(in_srgb,var(--annotation-c)_14%,transparent)]",
};

const DEPRECATED_CLASSES =
  "text-muted [background:color-mix(in_srgb,var(--color-muted)_14%,transparent)]";

const Keyword = ({ value }: { readonly value: string }) => (
  <span className="text-muted">{value}</span>
);

// The stream keyword is the load-bearing signal Google's reference drops;
// here it is both present and tinted so streaming reads at a glance.
const StreamKeyword = () => (
  <span className="grpc-method-stream font-semibold text-accent">
    {"stream "}
  </span>
);

// Renders the literal proto signature with the stream keywords placed by the
// declared kind, so the header states what the .proto would say.
const Signature = ({ model }: { readonly model: CompiledGrpcMethod }) => (
  <span className="grpc-method-signature font-mono text-sm">
    <Keyword value="rpc " />
    <span
      className={[
        "font-semibold",
        ...(model.deprecated ? ["text-muted", "line-through"] : []),
      ].join(" ")}
    >
      {model.name}
    </span>
    <Keyword value="(" />
    {model.kind === "clientStreaming" || model.kind === "bidiStreaming" ? (
      <StreamKeyword />
    ) : null}
    {model.request}
    <Keyword value=") returns (" />
    {model.kind === "serverStreaming" || model.kind === "bidiStreaming" ? (
      <StreamKeyword />
    ) : null}
    {model.response}
    <Keyword value=")" />
  </span>
);

// Renders one message field as a definition pair; proto3 requiredness stays
// prose inside the description, matching the ecosystem.
const FieldEntry = ({ field }: { readonly field: CompiledGrpcField }) => (
  <DefinitionEntry
    dataProperties={{ "data-grpc-field": field.side }}
    term={
      <>
        <span className="font-mono text-[0.8125rem] font-semibold">
          {field.name}
        </span>
        {field.fieldType === undefined ? null : (
          <span className="font-mono text-xs text-muted">
            {field.fieldType}
          </span>
        )}
      </>
    }
    body={field.children}
  />
);

// The section names the message type beside its label, keeping the
// signature's RPC-to-message mental model alive inside the field lists.
const FieldSection = ({
  label,
  messageType,
  fields,
}: {
  readonly label: string;
  readonly messageType: string;
  readonly fields: ReadonlyArray<CompiledGrpcField>;
}) => (
  <CardSection>
    <div className="flex flex-wrap items-center gap-2">
      <SectionLabel label={label} />
      <span className="font-mono text-[0.8125rem] font-semibold">
        {messageType}
      </span>
    </div>
    <DefinitionList>
      {fields.map((field) => (
        <FieldEntry key={field.name} field={field} />
      ))}
    </DefinitionList>
  </CardSection>
);

const ErrorEntry = ({ error }: { readonly error: CompiledGrpcError }) => (
  <div
    className="border-b border-edge py-3 last:border-b-0"
    data-grpc-error={error.code}
  >
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="grpc-method-error-code inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--callout-warning-c)_14%,transparent)] px-2 py-0.5 font-mono text-[0.6875rem] leading-4 font-bold text-[var(--callout-warning-c)]">
        {error.code}
      </span>
    </div>
    <div className="text-sm [&>:last-child]:mb-0">
      {hastContentToReact(error.children)}
    </div>
  </div>
);

const ProtoSection = ({
  proto,
}: {
  readonly proto: ReadonlyArray<ElementContent>;
}) => (
  <CardSection>
    <div className="mb-3">
      <SectionLabel label="Proto" />
    </div>
    <div className="[&>:last-child]:mb-0">{hastContentToReact(proto)}</div>
  </CardSection>
);

// Builds the complete card while omitting every empty optional region; a
// header-only method is a legitimate compact way to enumerate a service.
export const GrpcMethod = ({
  model,
}: {
  readonly model: CompiledGrpcMethod;
}) => (
  <figure
    className="grpc-method mb-5 min-w-0 overflow-hidden rounded-md border border-edge"
    data-grpc-method=""
    data-grpc-kind={model.kind}
    {...(model.deprecated ? { "data-grpc-deprecated": "" } : {})}
  >
    <header className="bg-header px-4 py-3">
      <div className="font-mono text-xs text-muted">{model.service}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2.5">
        <Signature model={model} />
        <BadgePill
          label={KIND_LABELS[model.kind]}
          classNames={["grpc-method-kind-pill", KIND_CLASSES[model.kind]]}
        />
        {model.deprecated ? (
          <BadgePill label="Deprecated" classNames={[DEPRECATED_CLASSES]} />
        ) : null}
      </div>
    </header>
    {model.description.length === 0 ? null : (
      <div className="px-4 py-4 [&>:last-child]:mb-0">
        {hastContentToReact(model.description)}
      </div>
    )}
    {model.requestFields.length === 0 ? null : (
      <FieldSection
        label="Request"
        messageType={model.request}
        fields={model.requestFields}
      />
    )}
    {model.responseFields.length === 0 ? null : (
      <FieldSection
        label="Response"
        messageType={model.response}
        fields={model.responseFields}
      />
    )}
    {model.errors.length === 0 ? null : (
      <CardSection>
        <SectionLabel label="gRPC status codes" />
        <div className="mt-1">
          {model.errors.map((error) => (
            <ErrorEntry key={error.code} error={error} />
          ))}
        </div>
      </CardSection>
    )}
    {model.examples.length === 0 ? null : (
      <CardSection dataProperties={{ "data-grpc-example": "" }}>
        <div className="mb-3">
          <SectionLabel label="Example" />
        </div>
        {model.examples.map((example, index) => (
          <ExampleBlock
            key={index}
            label={example.label ?? "Example"}
            children={example.children}
          />
        ))}
      </CardSection>
    )}
    {model.proto === undefined ? null : <ProtoSection proto={model.proto} />}
  </figure>
);
