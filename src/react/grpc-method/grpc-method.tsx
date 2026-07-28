// The React port of GrpcMethod: the always-expanded RPC review card headed
// by the authentic proto signature, with message-typed field sections, gRPC
// status codes, grouped examples, and proto source; markup mirrors the
// vanilla renderer class-for-class until the vanilla side is deleted.

import type { ElementContent } from "hast";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CompiledGrpcError,
  CompiledGrpcField,
  CompiledGrpcMethod,
  GrpcStreamingKind,
} from "../../model/compile-grpc-method.js";
import { hastContentToReact } from "../hast-content.js";
import { BadgePill } from "../shared/badge-pill/badge-pill.js";
import {
  CardSection,
  DefinitionEntry,
  DefinitionList,
  ExampleBlock,
  SectionLabel,
} from "../shared/labeled-section/labeled-section.js";

const KIND_LABELS: Readonly<Record<GrpcStreamingKind, string>> = {
  unary: "Unary",
  serverStreaming: "Server streaming",
  clientStreaming: "Client streaming",
  bidiStreaming: "Bidirectional streaming",
};

const Keyword = ({ value }: { readonly value: string }) => (
  <span className="text-muted">{value}</span>
);

// The stream keyword is the load-bearing signal Google's reference drops;
// here it is both present and tinted so streaming reads at a glance.
const StreamKeyword = () => (
  <span className="grpc-method-stream font-semibold">{"stream "}</span>
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
      <span className="grpc-method-error-code inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[0.6875rem] leading-4 font-bold">
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
const GrpcMethodView = ({ model }: { readonly model: CompiledGrpcMethod }) => (
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
          classNames={[
            "grpc-method-kind-pill",
            `grpc-method-kind-${model.kind.toLowerCase()}`,
          ]}
        />
        {model.deprecated ? (
          <BadgePill
            label="Deprecated"
            classNames={["grpc-method-deprecated"]}
          />
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

/** Renders one compiled GrpcMethod to static HTML via the React port. */
export const renderGrpcMethodStatic = (model: CompiledGrpcMethod): string =>
  renderToStaticMarkup(<GrpcMethodView model={model} />);
