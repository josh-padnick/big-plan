// Exposes the renderer's validated semantic-model compilation through a
// document-level seam for server-owned consumers that need compiled meaning.

export { compileMarkdownModel } from "./markdown/compile-markdown.js";
export type {
  CollectedComponentModel,
  CompiledMarkdown,
} from "./markdown/compile-markdown.js";
