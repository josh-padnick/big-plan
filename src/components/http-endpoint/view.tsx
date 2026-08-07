// Renders an expanded HttpEndpoint review card with auth, description,
// location-grouped parameters, request examples, and status-coded responses.

import type { ReactNode } from "react";
import type {
  CompiledHttpEndpoint,
  CompiledHttpParam,
  CompiledHttpRequest,
  CompiledHttpResponse,
} from "./compile.js";
import { LOCK_ICON } from "../../icons/lucide/lock.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";
import {
  CardSection,
  DefinitionEntry,
  DefinitionList,
  SectionLabel,
} from "../_shared/labeled-section/labeled-section.js";

// /* off-scale */ Phase A preserves the legacy 12% and 14% token washes
// exactly; Phase B will replace them with palette-backed theme shades.
const METHOD_CLASSES: Readonly<Record<CompiledHttpEndpoint["method"], string>> =
  {
    GET: "text-[var(--callout-note-c)] [background:color-mix(in_srgb,var(--callout-note-c)_14%,transparent)]",
    POST: "text-[var(--diff-add-c)] [background:color-mix(in_srgb,var(--diff-add-c)_14%,transparent)]",
    PUT: "text-[var(--callout-warning-c)] [background:color-mix(in_srgb,var(--callout-warning-c)_14%,transparent)]",
    PATCH:
      "text-[var(--annotation-c)] [background:color-mix(in_srgb,var(--annotation-c)_14%,transparent)]",
    DELETE:
      "text-[var(--diff-remove-c)] [background:color-mix(in_srgb,var(--diff-remove-c)_14%,transparent)]",
    HEAD: "text-muted [background:color-mix(in_srgb,var(--color-muted)_14%,transparent)]",
    OPTIONS:
      "text-muted [background:color-mix(in_srgb,var(--color-muted)_14%,transparent)]",
  };

const STATUS_CLASSES: Readonly<
  Record<CompiledHttpResponse["statusClass"], string>
> = {
  informational:
    "text-muted [background:color-mix(in_srgb,var(--color-muted)_14%,transparent)]",
  success:
    "text-[var(--diff-add-c)] [background:color-mix(in_srgb,var(--diff-add-c)_14%,transparent)]",
  redirect:
    "text-muted [background:color-mix(in_srgb,var(--color-muted)_14%,transparent)]",
  "client-error":
    "text-[var(--callout-warning-c)] [background:color-mix(in_srgb,var(--callout-warning-c)_14%,transparent)]",
  "server-error":
    "text-[var(--diff-remove-c)] [background:color-mix(in_srgb,var(--diff-remove-c)_14%,transparent)]",
};

const DEPRECATED_CLASSES =
  "text-muted [background:color-mix(in_srgb,var(--color-muted)_14%,transparent)]";

// Splits brace-delimited placeholders from the literal path without treating
// the authored string as markup.
const pathChildren = (path: string): ReadonlyArray<ReactNode> =>
  path
    .split(/(\{[^{}]+\})/u)
    .filter((part) => part !== "")
    .map((part, index) =>
      /^\{[^{}]+\}$/u.test(part) ? (
        <span
          key={index}
          className="http-endpoint-placeholder rounded-sm bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-0.5 text-accent"
        >
          {part}
        </span>
      ) : (
        part
      ),
    );

// Renders one parameter as a definition pair so its identity and prose remain
// semantically connected even when scripts are unavailable. The location badge
// is gone: each parameter now lives under an explicit location section, so a
// per-row badge would restate the section label.
const ParamEntry = ({ param }: { readonly param: CompiledHttpParam }) => (
  <DefinitionEntry
    dataProperties={{ "data-http-param-location": param.location }}
    term={
      <>
        <span className="font-mono text-sm font-semibold">{param.name}</span>
        {param.dataType === undefined ? null : (
          <span className="text-xs text-muted">{param.dataType}</span>
        )}
        {param.required ? (
          <span className="text-2xs font-bold text-ink">{"required"}</span>
        ) : (
          <>
            {/* Optional-ness is a visual property beside the name, never a
                separate cell; an authored default rides right next to it. */}
            <span className="text-2xs text-muted">{"optional"}</span>
            {param.defaultValue === undefined ? null : (
              <span className="text-2xs text-muted">
                {"default "}
                <span className="font-mono">{param.defaultValue}</span>
              </span>
            )}
          </>
        )}
      </>
    }
    body={param.children}
  />
);

// Each non-body location gets its own labeled section, so where a parameter
// travels is stated by the section instead of inferred from a badge.
const PARAM_GROUPS: ReadonlyArray<{
  readonly location: CompiledHttpParam["location"];
  readonly label: string;
}> = [
  { location: "path", label: "Path parameters" },
  { location: "query", label: "Query parameters" },
  { location: "header", label: "Headers" },
];

const ParamGroups = ({
  params,
}: {
  readonly params: ReadonlyArray<CompiledHttpParam>;
}) => (
  <>
    {PARAM_GROUPS.flatMap(({ location, label }) => {
      const grouped = params.filter((param) => param.location === location);
      return grouped.length === 0
        ? []
        : [
            <CardSection
              key={location}
              dataProperties={{ "data-http-section": `${location}-params` }}
            >
              <SectionLabel label={label} />
              <DefinitionList>
                {grouped.map((param) => (
                  <ParamEntry key={param.name} param={param} />
                ))}
              </DefinitionList>
            </CardSection>,
          ];
    })}
  </>
);

// The Request section states what the body IS: the media type up front, the
// body fields describing the payload's parameters, then the example
// demonstrating it. Body Params live here, not among the transport
// parameters, because they describe the payload's shape.
const RequestSection = ({
  request,
  bodyParams,
}: {
  readonly request?: CompiledHttpRequest;
  readonly bodyParams: ReadonlyArray<CompiledHttpParam>;
}) => (
  <CardSection dataProperties={{ "data-http-section": "request-body" }}>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <SectionLabel label="Request body" />
      {request?.contentType === undefined ? null : (
        // Media types stay lowercase monospace, the way every API reference
        // prints them; the uppercase chip is for labels.
        <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 font-mono text-2xs leading-4 text-muted">
          {request.contentType}
        </span>
      )}
    </div>
    {bodyParams.length === 0 ? null : (
      // No trailing margin: the last field row's own padding gives the
      // Example rule the same clearance as the rules between rows.
      <DefinitionList>
        {bodyParams.map((param) => (
          <ParamEntry key={param.name} param={param} />
        ))}
      </DefinitionList>
    )}
    {request === undefined || request.children.length === 0 ? null : (
      <>
        {/* The fence is explicitly an example of the body, not the body's
            definition; the label keeps it from floating after the fields. */}
        <div
          // A rule seats the example against preceding fields the same way
          // the field rows separate from each other; with no fields there is
          // nothing to separate.
          className={
            bodyParams.length === 0 ? "mb-2" : "mb-2 border-t border-edge pt-3"
          }
        >
          <SectionLabel label="Example" />
        </div>
        <div className="[&>:last-child]:mb-0">
          {hastContentToReact(request.children)}
        </div>
      </>
    )}
  </CardSection>
);

const ResponseEntry = ({
  response,
}: {
  readonly response: CompiledHttpResponse;
}) => (
  <div
    className="border-b border-edge py-3 last:border-b-0"
    data-http-response={response.status}
  >
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <BadgePill
        label={response.status}
        classNames={[
          "http-endpoint-status-pill",
          STATUS_CLASSES[response.statusClass],
        ]}
        dataProperties={{ "data-http-status-class": response.statusClass }}
      />
      {response.label === undefined ? null : (
        <span className="text-sm text-muted">{response.label}</span>
      )}
    </div>
    <div className="text-sm [&>:last-child]:mb-0">
      {hastContentToReact(response.children)}
    </div>
  </div>
);

// Builds the complete card while omitting every empty optional region, making
// a header-only endpoint a deliberate and useful compact rendering.
export const HttpEndpoint = ({
  model,
}: {
  readonly model: CompiledHttpEndpoint;
}) => (
  <figure
    className="http-endpoint mb-6 min-w-0 overflow-hidden rounded-md border border-edge bg-raised"
    data-http-endpoint=""
    data-http-method={model.method}
    {...(model.deprecated ? { "data-http-deprecated": "" } : {})}
  >
    <header className="bg-header px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <BadgePill
          label={model.method}
          classNames={[
            "http-endpoint-method-pill",
            METHOD_CLASSES[model.method],
          ]}
        />
        <span
          className={[
            "http-endpoint-path",
            "font-mono",
            "text-sm",
            "font-semibold",
            ...(model.deprecated ? ["text-muted", "line-through"] : []),
          ].join(" ")}
        >
          {pathChildren(model.path)}
        </span>
        {model.summary === undefined ? null : (
          <span className="text-sm text-muted">{model.summary}</span>
        )}
        {model.deprecated ? (
          <BadgePill label="Deprecated" classNames={[DEPRECATED_CLASSES]} />
        ) : null}
      </div>
      {model.auth === undefined ? null : (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
          {lucideIconToReact({ icon: LOCK_ICON, hidden: false })}
          {model.auth}
        </div>
      )}
    </header>
    {model.description.length === 0 ? null : (
      <div className="px-4 py-4 [&>:last-child]:mb-0">
        {hastContentToReact(model.description)}
      </div>
    )}
    <ParamGroups params={model.params} />
    {model.request === undefined &&
    !model.params.some((param) => param.location === "body") ? null : (
      <RequestSection
        {...(model.request === undefined ? {} : { request: model.request })}
        bodyParams={model.params.filter((param) => param.location === "body")}
      />
    )}
    {model.responses.length === 0 ? null : (
      <CardSection dataProperties={{ "data-http-section": "responses" }}>
        <SectionLabel label="Responses" />
        <div className="mt-1">
          {model.responses.map((response) => (
            <ResponseEntry key={response.status} response={response} />
          ))}
        </div>
      </CardSection>
    )}
  </figure>
);
