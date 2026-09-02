// Configures the public Big Plan documentation site and its navigation.

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";
import { SIDEBAR } from "./src/sidebar";

export default defineConfig({
  site: "https://bigplan.dev",
  // Every path the job-shaped reorganization moved still resolves.
  redirects: {
    "/architecture": "/concepts/how-it-works/",
    "/concepts": "/concepts/how-it-works/",
    "/concepts/inert-documents": "/security/inert-documents/",
    "/concepts/security-policy": "/security/reporting/",
    "/concepts/supply-chain": "/security/supply-chain/",
    "/concepts/trust-boundaries": "/security/trust-boundaries/",
    "/for-agents/answer-feedback": "/for-agents/",
    "/for-agents/approval": "/for-agents/",
    "/for-agents/authoring-plans": "/authoring/",
    "/for-agents/handoff": "/for-agents/",
    "/for-agents/render-a-plan": "/for-agents/",
    "/for-agents/setup": "/for-agents/",
    "/for-agents/use-the-skill": "/for-agents/",
    "/for-agents/write-and-validate": "/for-agents/",
    "/intro/demo": "/samples/",
    "/intro/features": "/review/",
    "/intro/tour": "/intro/ui-review/",
    "/intro/why-big-plan": "/intro/what-is-big-plan/",
    "/reference/cli": "/reference/",
    "/reference/reviewing": "/review/",
    "/reference/security": "/security/reporting/",
    "/review/answer-decisions": "/review/",
    "/review/approve-a-plan": "/review/",
    "/review/comment-on-a-plan": "/review/",
    "/review/export-markdown": "/review/",
    "/review/read-changes": "/review/",
    "/review/start-a-review": "/intro/first-review/",
    "/review/troubleshooting": "/reference/commands/review/",
    "/review/viewer-settings": "/intro/ui-review/",
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
    }),
  ],
});
