// ESLint flat config. Two jobs: the typescript-eslint recommended baseline
// with the conventions AGENTS.md promises (separate type imports), and the
// project-specific guardrails that convention alone cannot enforce - most
// importantly that Playwright specs use the extended test from test/fixtures
// (which fails on console errors) instead of importing @playwright/test.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "**/*.generated.ts",
      "examples/",
      "test-results/",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Playwright fixture signatures destructure an empty object by design.
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
    },
  },
  // Architectural layering: information flows one way, cli -> render-document
  // -> { markdown/, shell/, page } -> escape-html. A layer knows what it
  // calls and never what calls it. Flat config does not merge
  // no-restricted-imports across overlapping blocks (last match wins), so the
  // scopes below are non-overlapping and each block lists its full pattern set.
  {
    // The CLI consumes the renderer only through its public entry point.
    files: ["src/cli/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/render/markdown/**",
                "**/render/shell/**",
                "**/render/page.js",
                "**/render/escape-html.js",
              ],
              message:
                "The CLI consumes the renderer through render-document.js, its public entry point - never the renderer's internals.",
            },
          ],
        },
      ],
    },
  },
  {
    // The composer (and its test) may import every render part; the render
    // layer as a whole sits below the CLI.
    files: ["src/render/*.ts"],
    ignores: ["src/render/page.ts", "src/render/escape-html.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**"],
              message:
                "The render layer sits below the CLI and must never import from it.",
            },
          ],
        },
      ],
    },
  },
  {
    // markdown/ is self-contained: pipeline dependencies only.
    files: ["src/render/markdown/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/cli/**",
                "**/shell/**",
                "**/page.js",
                "**/escape-html.js",
                "**/render-document.js",
              ],
              message:
                "markdown/ produces content and knows nothing about the shell, the page, the composer, or the CLI. Escaping is rehype-stringify's job here.",
            },
          ],
        },
      ],
    },
  },
  {
    // shell/ presents content handed to it as data; it may use escape-html
    // and its own generated modules.
    files: ["src/render/shell/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/cli/**",
                "**/markdown/**",
                "**/page.js",
                "**/render-document.js",
              ],
              message:
                "shell/ owns the reading surface and knows nothing about markdown, the page envelope, the composer, or the CLI. Content arrives as data (NavEntry, contentHtml).",
            },
          ],
        },
      ],
    },
  },
  {
    // page.ts packages what it is handed; escape-html is its only local import.
    files: ["src/render/page.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/cli/**",
                "**/markdown/**",
                "**/shell/**",
                "**/render-document.js",
              ],
              message:
                "page.ts is the envelope: it packages styles, scripts, and markup handed to it as data, and knows nothing about who produced them.",
            },
          ],
        },
      ],
    },
  },
  {
    // escape-html.ts is the bottom layer: no project-local imports at all.
    files: ["src/render/escape-html.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["./*", "./**", "../*", "../**"],
              message:
                "escape-html.ts is the lowest layer and imports nothing project-local.",
            },
          ],
        },
      ],
    },
  },
  {
    // Browser-side scripts run in the viewer, not Node.
    files: ["src/**/*.browser.ts"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Node-runtime JavaScript: the bin shim and build-time generators.
    files: ["bin/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright specs must go through the extended test in fixtures.ts so
    // every spec fails on console errors and uncaught page errors; importing
    // @playwright/test directly would silently opt out of that guarantee.
    files: ["test/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              message:
                "Import test and expect from ./fixtures so the spec fails on console errors.",
            },
          ],
        },
      ],
    },
  },
  {
    // fixtures.ts is the one legitimate importer of @playwright/test.
    files: ["test/fixtures.ts"],
    rules: { "no-restricted-imports": "off" },
  },
);
