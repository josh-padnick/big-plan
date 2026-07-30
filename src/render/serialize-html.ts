// Owns final HTML serialization of a compiled review document. Serialization
// is a delivery concern: the markdown module returns structured HAST plus its
// metadata, and the composer decides when the tree is finished enough to
// become text.

import type { Root } from "hast";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

/** Serializes a compiled review document only after all transforms finish. */
export const serializeHtml = ({ root }: { readonly root: Root }): string =>
  unified().use(rehypeStringify).stringify(root);
