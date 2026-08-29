// Owns the one way Big Plan writes a reviewer's answers back into the plan
// source: it stamps state="decided" onto the decision and chosen onto the
// option the reviewer picked.
//
// It is a splice writer rather than a re-serializer on purpose. A plan source
// is an author's document - its blank lines, attribute order, comments, and
// quote style are part of what a reviewer reads next time - and re-printing an
// mdast would rewrite all of it to record two attributes. So the only bytes
// this module produces are the spans it computed, and every other byte of the
// file is carried through untouched.
//
// It is also all-or-nothing. A stamp that half-applied would leave the source
// asserting a decision nobody made, so every precondition is proved before any
// byte moves, and the result is recompiled and re-read before it is returned.

import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { compileMarkdownModel } from "./markdown/compile-markdown.js";
import type {
  CompiledDecisionCard,
  DecisionCardStatus,
} from "../components/_model/decision-card.js";

/** One answer to record: the decision, and the option title it settled on. */
export type DecisionStamp = {
  readonly decisionId: string;
  readonly optionTitle: string;
};

/** The stamp could not be computed against this source. */
export class DecisionStampRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionStampRejected";
  }
}

/** The two decision components whose answers Big Plan records at approval. */
const STAMPABLE_COMPONENTS: ReadonlySet<string> = new Set([
  "Decision",
  "QuickDecision",
]);

const DECIDED: DecisionCardStatus = "decided";

type UnistPoint = {
  readonly line: number;
  readonly column: number;
  readonly offset?: number;
};

type UnistPosition = {
  readonly start: UnistPoint;
  readonly end: UnistPoint;
};

type MdxAttribute = {
  readonly type: string;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly position?: UnistPosition;
};

type MdxElement = {
  readonly type: string;
  readonly name?: unknown;
  readonly attributes?: ReadonlyArray<MdxAttribute>;
  readonly children?: ReadonlyArray<unknown>;
  readonly position?: UnistPosition;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asElement = (value: unknown): MdxElement | undefined =>
  isRecord(value) && typeof value["type"] === "string"
    ? (value as MdxElement)
    : undefined;

const isFlowElement = (node: MdxElement, name: string): boolean =>
  node.type === "mdxJsxFlowElement" && node.name === name;

/*
Mirrors `stringAttribute` in src/lint/mdx-nodes.ts. Lint sits in a lower tier
than this composer module and may not be imported from here, and the reader is
ten lines, so the rule is restated rather than the boundary bent. Both read the
same thing: a static string attribute, with an expression-valued or missing one
reading as absent.
*/
const stringAttribute = ({
  node,
  name,
}: {
  readonly node: MdxElement;
  readonly name: string;
}): string | undefined => {
  for (const attribute of node.attributes ?? []) {
    if (attribute.type === "mdxJsxAttribute" && attribute.name === name) {
      return typeof attribute.value === "string" ? attribute.value : undefined;
    }
  }
  return undefined;
};

const namedAttribute = ({
  node,
  name,
}: {
  readonly node: MdxElement;
  readonly name: string;
}): MdxAttribute | undefined =>
  (node.attributes ?? []).find(
    (attribute) =>
      attribute.type === "mdxJsxAttribute" && attribute.name === name,
  );

/** One computed byte range and the text that replaces it. */
type Splice = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

const asDecisionCard = (model: unknown): CompiledDecisionCard | undefined => {
  if (!isRecord(model)) return undefined;
  const candidate = model as Partial<CompiledDecisionCard>;
  return typeof candidate.id === "string" &&
    typeof candidate.status === "string" &&
    Array.isArray(candidate.options)
    ? (candidate as CompiledDecisionCard)
    : undefined;
};

const positionOf = (node: MdxElement): UnistPosition => {
  const position = node.position;
  if (
    position === undefined ||
    position.start.offset === undefined ||
    position.end.offset === undefined
  ) {
    throw new DecisionStampRejected(
      "The plan source cannot be stamped: an authored element carries no source position",
    );
  }
  return position;
};

// Every flow element in the document, keyed by the 1-based line and column the
// component pipeline reports for the model it compiled. Equality on that pair
// is the join: it is the same parser reading the same bytes, so a component
// model and its authored element agree on where the element starts.
const flowElementsByPosition = (
  tree: unknown,
): ReadonlyMap<string, MdxElement> => {
  const found = new Map<string, MdxElement>();
  const walk = (value: unknown): void => {
    const node = asElement(value);
    if (node === undefined) return;
    if (node.type === "mdxJsxFlowElement" && node.position !== undefined) {
      found.set(
        `${node.position.start.line}:${node.position.start.column}`,
        node,
      );
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return found;
};

/**
 * Where a new attribute goes on an opening tag: immediately after the element
 * name, which is the one position that exists on every authored form - a
 * self-closing tag, a multi-line opening tag, one already carrying attributes,
 * and one carrying none.
 */
const attributeInsertion = ({
  node,
  name,
  text,
}: {
  readonly node: MdxElement;
  readonly name: string;
  readonly text: string;
}): Splice => {
  const offset = positionOf(node).start.offset ?? 0;
  const at = offset + 1 + name.length;
  return { start: at, end: at, text: ` ${text}` };
};

/**
 * Replaces an existing attribute's value in place, so a source that already
 * says state="proposed" keeps its own quote style and spacing and changes only
 * the word that was wrong. An attribute with no value span at all - which the
 * enum schema rejects, so compilation never reaches here - is replaced whole.
 */
const attributeValueReplacement = ({
  markdown,
  attribute,
  name,
  value,
}: {
  readonly markdown: string;
  readonly attribute: MdxAttribute;
  readonly name: string;
  readonly value: string;
}): Splice => {
  const position = attribute.position;
  const start = position?.start.offset;
  const end = position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new DecisionStampRejected(
      `The plan source cannot be stamped: the "${name}" attribute carries no source position`,
    );
  }
  const raw = markdown.slice(start, end);
  const equals = raw.indexOf("=");
  const quote = equals === -1 ? "" : raw[equals + 1];
  if (equals === -1 || (quote !== '"' && quote !== "'")) {
    return { start, end, text: `${name}="${value}"` };
  }
  return { start: start + equals + 2, end: end - 1, text: value };
};

const applySplices = ({
  markdown,
  splices,
}: {
  readonly markdown: string;
  readonly splices: ReadonlyArray<Splice>;
}): string => {
  // Descending, so every splice's offsets still address the original bytes by
  // the time it is applied.
  const ordered = [...splices].sort((a, b) => b.start - a.start);
  let stamped = markdown;
  let lowestApplied = markdown.length;
  for (const splice of ordered) {
    if (splice.end > lowestApplied) {
      throw new DecisionStampRejected(
        "The plan source cannot be stamped: two edits would overlap",
      );
    }
    stamped =
      stamped.slice(0, splice.start) + splice.text + stamped.slice(splice.end);
    lowestApplied = splice.start;
  }
  return stamped;
};

/*
The same plugin stack authoring lint parses with (src/lint/lint-plan.ts). The
component pipeline compiles models but does not hand back the tree it read, so
the authored elements are re-read here from the same bytes with the same
parsers, and the two readings are joined on source position.
*/
const parsePlan = (markdown: string): unknown =>
  unified().use(remarkParse).use(remarkGfm).use(remarkMdx).parse(markdown);

const decisionCardsById = (
  markdown: string,
): ReadonlyMap<string, CompiledDecisionCard> => {
  const cards = new Map<string, CompiledDecisionCard>();
  for (const collected of compileMarkdownModel({ markdown }).components) {
    if (!STAMPABLE_COMPONENTS.has(collected.component)) continue;
    const card = asDecisionCard(collected.model);
    if (card !== undefined && !cards.has(card.id)) cards.set(card.id, card);
  }
  return cards;
};

/**
 * Records each answer in the plan source and returns the stamped bytes.
 *
 * It throws rather than returning anything it could not prove: a decision that
 * is missing or already settled, an option title that is not on it, a sibling
 * that already claims the choice, or a result that no longer compiles with the
 * stamped decisions decided. The caller re-renders and re-lints the returned
 * string before it reaches the file, so the two together are the whole of the
 * contract that stamped bytes are bytes a reviewer can still read.
 */
export const stampDecisions = ({
  markdown,
  answers,
}: {
  readonly markdown: string;
  readonly answers: ReadonlyArray<DecisionStamp>;
}): { readonly stamped: string } => {
  if (answers.length === 0) return { stamped: markdown };
  const seen = new Set<string>();
  for (const answer of answers) {
    if (seen.has(answer.decisionId)) {
      throw new DecisionStampRejected(
        `Decision ${answer.decisionId} was answered twice in one stamp`,
      );
    }
    seen.add(answer.decisionId);
  }
  const compiled = compileMarkdownModel({ markdown });
  const elements = flowElementsByPosition(parsePlan(markdown));
  const splices: Array<Splice> = [];
  for (const answer of answers) {
    const collected = compiled.components.find(
      (candidate) =>
        STAMPABLE_COMPONENTS.has(candidate.component) &&
        asDecisionCard(candidate.model)?.id === answer.decisionId,
    );
    const card =
      collected === undefined ? undefined : asDecisionCard(collected.model);
    if (collected === undefined || card === undefined) {
      throw new DecisionStampRejected(
        `The plan no longer asks decision ${answer.decisionId}`,
      );
    }
    if (card.status !== "open") {
      throw new DecisionStampRejected(
        `Decision ${answer.decisionId} is already settled and cannot be stamped again`,
      );
    }
    const element =
      collected.line === undefined || collected.column === undefined
        ? undefined
        : elements.get(`${collected.line}:${collected.column}`);
    if (element === undefined) {
      throw new DecisionStampRejected(
        `Decision ${answer.decisionId} could not be located in the plan source`,
      );
    }
    const options = (element.children ?? [])
      .map(asElement)
      .filter(
        (child): child is MdxElement =>
          child !== undefined && isFlowElement(child, "Option"),
      );
    const chosen = options.find(
      (option) =>
        stringAttribute({ node: option, name: "title" }) === answer.optionTitle,
    );
    if (chosen === undefined) {
      throw new DecisionStampRejected(
        `Decision ${answer.decisionId} has no option titled "${answer.optionTitle}"`,
      );
    }
    const alreadyChosen = options.find(
      (option) =>
        namedAttribute({ node: option, name: "chosen" }) !== undefined,
    );
    if (alreadyChosen !== undefined) {
      throw new DecisionStampRejected(
        `Decision ${answer.decisionId} already marks an option chosen`,
      );
    }
    const state = namedAttribute({ node: element, name: "state" });
    splices.push(
      state === undefined
        ? attributeInsertion({
            node: element,
            name: String(element.name),
            text: 'state="decided"',
          })
        : attributeValueReplacement({
            markdown,
            attribute: state,
            name: "state",
            value: DECIDED,
          }),
      attributeInsertion({ node: chosen, name: "Option", text: "chosen" }),
    );
  }
  const stamped = applySplices({ markdown, splices });
  // The proof, not a formality: the stamped bytes are recompiled and each
  // stamped decision is read back as decided on the option the reviewer named.
  // Anything less would let a splice that landed in the wrong element reach the
  // authoritative source, where the reviewer would find an answer they did not
  // give.
  const recompiled = decisionCardsById(stamped);
  for (const answer of answers) {
    const card = recompiled.get(answer.decisionId);
    if (
      card === undefined ||
      card.status !== DECIDED ||
      card.chosenOption?.title !== answer.optionTitle
    ) {
      throw new DecisionStampRejected(
        `Stamping decision ${answer.decisionId} did not record "${answer.optionTitle}"`,
      );
    }
  }
  return { stamped };
};
