// Configures the public Big Plan documentation site and its navigation.

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";
import { SIDEBAR } from "./src/sidebar";

export default defineConfig({
  site: "https://bigplan.dev",
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
