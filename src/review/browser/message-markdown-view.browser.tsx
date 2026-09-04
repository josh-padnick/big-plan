// Owns the React view of every bounded message Markdown vocabulary the review
// island renders: the agent's structured turns and the reviewer's own comments,
// replies, and chat. Both vocabularies are parsed in src/review/shared, which
// stays framework-free; this module is the one place either parsed tree becomes
// elements.
//
// It exists because the reviewer walker had a byte-equivalent copy per renderer
// - one in the message turn, one in the staged-comment card - and a copy is a
// drift channel that fails silently: containment added to one copy's `pre` left
// the other's pasted code running past its card, which is the defect BIG-185
// reported. One walker means one presentation rule and one place to change it.

import type { ReactNode } from "react";
import type { MessageNode } from "../shared/message-markdown.js";
import type { ReviewerMarkdownNode } from "../shared/reviewer-markdown.js";
import { reviewImageSource } from "../shared/review-image.js";
import { ReviewImage } from "./review-image.browser.js";

/**
 * Code in a message, however that message was authored.
 *
 * Every renderer of a reviewer or agent message speaks the same Markdown
 * vocabulary, so code has one presentation and one containment rule. The
 * containment is what keeps the rule honest: a `pre` left to the user agent
 * keeps `white-space: pre`, so one long line gives the message an unbounded
 * min-content width and pushes the card holding it past its surface, where a
 * scrolling panel hides the overflow instead of reporting it (BIG-185).
 */
const InlineCode = ({ value }: { readonly value: string }) => (
  <code className="max-w-full rounded-sm border border-edge bg-surface px-1 font-mono text-[0.9em] [overflow-wrap:anywhere]">
    {value}
  </code>
);

const CodeBlock = ({
  value,
  language,
}: {
  readonly value: string;
  readonly language?: string;
}) => (
  <pre className="relative mt-1 min-w-0 max-w-full overflow-x-auto rounded-md border border-edge bg-surface p-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
    {language === undefined ? null : (
      <span className="mb-1 block text-2xs text-muted uppercase tracking-caps">
        {language}
      </span>
    )}
    <code className="min-w-0 max-w-full font-mono text-2xs whitespace-pre-wrap [overflow-wrap:anywhere]">
      {value}
    </code>
  </pre>
);

/** Renders only the bounded Markdown node vocabulary owned by the parser. */
export const renderMessageNode = (
  node: MessageNode,
  key: string,
): ReactNode => {
  if (node.type === "text") return node.value;
  if (node.type === "inlineCode")
    return <InlineCode key={key} value={node.value} />;
  if (node.type === "code")
    return <CodeBlock key={key} value={node.value} language={node.language} />;
  const children = node.children.map((child, index) =>
    renderMessageNode(child, `${key}-${index}`),
  );
  if (node.type === "paragraph") {
    return (
      <p key={key} className="mt-0 mb-2">
        {children}
      </p>
    );
  }
  if (node.type === "strong") return <strong key={key}>{children}</strong>;
  if (node.type === "emphasis") return <em key={key}>{children}</em>;
  if (node.type === "blockquote") {
    return (
      <blockquote
        key={key}
        className="mt-1 border-l-2 border-edge pl-2 text-muted"
      >
        {children}
      </blockquote>
    );
  }
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  if (node.type === "list") {
    const className =
      "mt-1 mb-0 pl-4 " + (node.ordered ? "list-decimal" : "list-disc");
    return node.ordered ? (
      <ol key={key} className={className}>
        {children}
      </ol>
    ) : (
      <ul key={key} className={className}>
        {children}
      </ul>
    );
  }
  if (node.type !== "link") return null;
  return (
    <a
      key={key}
      className="text-accent underline"
      href={node.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
};

/** Renders the same inert vocabulary for reviewer-authored user turns. */
export const renderReviewerNode = (
  node: ReviewerMarkdownNode,
  key: string,
): ReactNode => {
  if (node.type === "text") return node.value;
  if (node.type === "inlineCode")
    return <InlineCode key={key} value={node.value} />;
  if (node.type === "code")
    return <CodeBlock key={key} value={node.value} language={node.language} />;
  if (node.type === "image") {
    return (
      <ReviewImage
        key={key}
        source={reviewImageSource(node.id)}
        alt={node.alt}
        className="mt-2"
      />
    );
  }
  const children = node.children.map((child, index) =>
    renderReviewerNode(child, `${key}-${index}`),
  );
  if (node.type === "paragraph") return <p key={key}>{children}</p>;
  if (node.type === "strong") return <strong key={key}>{children}</strong>;
  if (node.type === "emphasis") return <em key={key}>{children}</em>;
  if (node.type === "blockquote")
    return <blockquote key={key}>{children}</blockquote>;
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  if (node.type === "list") {
    return node.ordered ? (
      <ol key={key}>{children}</ol>
    ) : (
      <ul key={key}>{children}</ul>
    );
  }
  if (node.type !== "link") return null;
  return (
    <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
};
