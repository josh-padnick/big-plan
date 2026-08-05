> [!IMPORTANT]
>
> ## Superseded by the five-PR review stack
>
> This draft remains open as the historical source, but review and approval should proceed in this order:
>
> 1. #56 — review foundation
> 2. #57 — agent review loop and revision diffs
> 3. #58 — complete commenting workflow
> 4. #59 — Tailwind/UI contracts and causal diffs
> 5. #60 — persistence hardening and component revision lenses
>
> Each replacement PR targets `main`, declares its predecessor, includes independent green evidence, and links a rendered Big Plan review document. The final branch contains every change from this PR plus two root-fix bridges in #59: the authorized three-file capture-harness commit and a separately labeled one-file Playwright locator fix required by the captain's standing flake rule.
>
> **This PR's current head is red on `style-history`.** Its configuration declares 34 captures, but its harness produces only 32. The missing light/dark `expanded-thread-reply` captures promote a draft only in browser-local state; after reload, the production runtime correctly reads sent comments from server bootstrap state and therefore has no thread to expand.
>
> Its exact-pixel capture was also flaky: identical hosted runs alternated between two hashes that differed at eight one-channel pixels on two rounded-card corners because Skia selected CPU-specific antialias paths. #59 fixes both harness defects while preserving the zero-pixel rule: it uses a valid server bootstrap, pins deterministic raster settings, writes only a repeated byte-identical settled frame, and scopes each replay pair to the capture config declared by its child commit. It does not change production runtime behavior.
>
> The source also contained a flaky Playwright assertion: a live toolbar locator could resolve across node replacement between a successful focus poll and a later geometry lookup. #59 keeps the non-null bounding box in the same successful poll iteration. The final stack differs from this head by exactly those two listed bridge commits; subtracting both yields this PR's tree exactly.

## Scope

- Adds the local review server and durable feedback state.
- Adds the request-scoped agent exchange protocol for comments, replies, progress, cancellation, and revisions.
- Adds the Feedback sidebar, anchored threads, lifecycle states, diff review, and bidirectional document navigation.
- Includes the Tailwind-utilities conversion and architecture seams that keep runtime state, rendering, and revision ownership explicit.

## Review status

This is a living draft for captain code review while the final UI polish rounds continue. The validation pipeline has intentionally not run yet; it will run only after UX sign-off.

<!-- Macroscope's pull request summary starts here -->
<!-- Macroscope will only edit the content between these invisible markers, and the markers themselves will not be visible in the GitHub rendered markdown. -->
<!-- If you delete either of the start / end markers from your PR's description, Macroscope will append its summary at the bottom of the description. -->

> [!NOTE]
>
> ### Add first-class plan commenting system with review server, agent protocol, and reviewer UI
>
> - Adds a `big-plan review <input.mdx>` CLI command that lints the document, starts a loopback HTTP server with a session token, and prints connection details plus a pasteable agent launcher command.
> - Adds a `big-plan agent` CLI command that reads the live session, fetches the next pending feedback request, and writes a validated agent response back to the review store.
> - The render pipeline now annotates output HTML with `data-block-*` attributes (via `rehypeBlockIdentity`) and returns a `blocks` array; the shell conditionally injects an embedded review script when commentable blocks are present.
> - Introduces `src/review/` containing: typed agent exchange protocol, filesystem-backed review store with path-traversal guards, word-level revision diffing and change-set grouping, feedback package Markdown brief generation, thread status derivation, and time/duration formatters.
> - Adds a style-history verification pipeline (`scripts/style-snapshots/`) that builds a historical checkout, renders documents with the checkout's own CLI, and captures screenshots for visual contract enforcement via a new CI job.
> - Risk: CSS `@layer` ordering is now enforced globally in `src/render/global.css`; layers added outside the declared order may silently lose precedence.
>
> <!-- Macroscope's review summary starts here -->
>
> <details>
> <summary>📊 <a href="https://app.macroscope.com">Macroscope</a> summarized 63789c6. 2 files reviewed, 0 issues evaluated, 0 issues filtered, 0 comments posted</summary>
>
> ### 🗂️ Filtered Issues
>
> No issues evaluated.
>
> </details><!-- Macroscope's review summary ends here -->
>
> <!-- macroscope-ui-refresh -->

<!-- Macroscope's pull request summary ends here -->
<!-- devin-review-badge-begin -->

---

<a href="https://app.devin.ai/review/josh-padnick/big-plan/pull/54" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://static.devin.ai/assets/gh-open-in-devin-review-dark.svg?v=1">
    <img src="https://static.devin.ai/assets/gh-open-in-devin-review-light.svg?v=1" alt="Open in Devin Review">
  </picture>
</a>
<!-- devin-review-badge-end -->
