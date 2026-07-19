// Renders the file-identity caption shared by file-associated components: a
// file icon, a muted directory prefix, and an emphasized file name behind one
// small { filePath } interface. Modules in shared/ are never authorable from
// MDX; they are presentation building blocks the registered component
// directories beside shared/ compose.

import type { Element, Text } from "hast";
import { FILE_ICON } from "../../../icons/lucide/file.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";

const IDENTITY_CLASSES =
  "file-identity flex min-w-0 items-center gap-[0.45rem] [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted";

const text = (value: string): Text => ({ type: "text", value });

// The explicit label keeps the accessible name the exact file path (CodeDiff's
// full-screen dialog references this element), independent of the styled
// dir/name split below.
export const renderFileIdentity = ({
  filePath,
}: {
  readonly filePath: string;
}): Element => {
  const lastSlashIndex = filePath.lastIndexOf("/");
  const fileDir =
    lastSlashIndex === -1 ? "" : filePath.slice(0, lastSlashIndex + 1);
  const fileName =
    lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: IDENTITY_CLASSES.split(" "),
      ariaLabel: filePath,
    },
    children: [
      renderLucideIcon({ icon: FILE_ICON, hidden: false }),
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["file-identity-path", "min-w-0", "truncate"],
        },
        children: [
          ...(fileDir === ""
            ? []
            : [
                {
                  type: "element" as const,
                  tagName: "span",
                  properties: {
                    className: ["file-identity-dir", "text-muted"],
                  },
                  children: [text(fileDir)],
                },
              ]),
          {
            type: "element",
            tagName: "span",
            properties: {
              className: ["file-identity-name", "font-semibold", "text-ink"],
            },
            children: [text(fileName)],
          },
        ],
      },
    ],
  };
};
