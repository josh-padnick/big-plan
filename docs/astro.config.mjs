// Configures the public Big Plan documentation site and its navigation.

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";
import { SIDEBAR } from "./src/sidebar";

export default defineConfig({
  site: "https://bigplan.dev",
  // Every path the job-shaped reorganization moved still resolves.
  redirects: {
    "/architecture": "/review/",
    "/authoring": "/for-agents/",
    "/authoring/anatomy-of-a-plan": "/for-agents/",
    "/authoring/choose-a-component": "/components/",
    "/authoring/fix-a-validation-error": "/for-agents/",
    "/authoring/slide-types": "/for-agents/",
    "/authoring/where-rules-live": "/for-agents/",
    "/concepts": "/review/",
    "/concepts/how-it-works": "/review/",
    "/concepts/inert-documents": "/security/",
    "/concepts/one-writer": "/security/",
    "/concepts/security-policy": "/security/",
    "/concepts/supply-chain": "/security/",
    "/concepts/trust-boundaries": "/security/",
    "/for-agents/answer-feedback": "/for-agents/",
    "/for-agents/approval": "/for-agents/",
    "/for-agents/authoring-plans": "/for-agents/",
    "/for-agents/handoff": "/for-agents/",
    "/for-agents/render-a-plan": "/for-agents/",
    "/for-agents/setup": "/for-agents/",
    "/for-agents/use-the-skill": "/for-agents/",
    "/for-agents/write-and-validate": "/for-agents/",
    "/intro/demo": "/samples/",
    "/intro/features": "/review/",
    "/intro/tour": "/intro/ui-review/",
    "/intro/why-big-plan": "/intro/what-is-big-plan/",
    "/reference": "/reference/commands/render/",
    "/reference/cli": "/reference/commands/render/",
    "/reference/error-codes": "/for-agents/",
    "/reference/files": "/for-agents/",
    "/reference/plan-model": "/for-agents/",
    "/reference/reviewing": "/review/",
    "/reference/security": "/security/",
    "/review/answer-decisions": "/review/",
    "/review/approve-a-plan": "/review/",
    "/review/comment-on-a-plan": "/review/",
    "/review/export-markdown": "/review/",
    "/review/read-changes": "/review/",
    "/review/start-a-review": "/intro/first-review/",
    "/review/troubleshooting": "/reference/commands/review/",
    "/review/viewer-settings": "/intro/ui-review/",
    "/samples/all-components": "/samples/",
    "/samples/rate-limiting": "/samples/",
    "/samples/retry-queue": "/samples/",
    "/samples/workflow-builder": "/samples/",
    "/security/inert-documents": "/security/",
    "/security/reporting": "/security/",
    "/security/supply-chain": "/security/",
    "/security/trust-boundaries": "/security/",
  },
  integrations: [
    mermaid(),
    starlight({
      title: "Big Plan",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/josh-padnick/big-plan",
        },
      ],
      // The boxed favicon marks the docs site apart from the tool's plain
      // /bp favicon; the SVG swaps light/dark art itself.
      favicon: "/favicon.svg",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      // The shared sidebar module also drives the llms.txt page map.
      sidebar: [...SIDEBAR],
      // The site title carries the alpha marker, which links to the page
      // explaining what alpha means rather than asserting it in passing.
      components: {
        // The hero override exists only to stop the splash image being cropped
        // to a square and served at 400px; see the component for why.
        Hero: "./src/components/Hero.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      customCss: ["./src/styles/site.css"],
    }),
  ],
});
