// Rewrites a commit message in place so it always carries a body and a
// Signed-off-by trailer, matching CONTRIBUTING.md's DCO requirement, without
// depending on a human or an automated tool to remember `-s` or write a body.
// Invoked before and after commit-message editing by the committed hooks that
// scripts/git-hooks/install.mjs activates during `bun install`.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export const GENERATED_BODY_NOTE =
  "(No commit body was supplied; this line was added automatically to satisfy this repository's commit-body requirement - see CONTRIBUTING.md.)";

/**
 * Splits a raw commit-message file into the real content lines and any
 * trailing comment block git appends for editor-driven commits. `-m` commits
 * have no comment block, so `commentLines` is empty for those.
 */
const splitCommentBlock = (rawMessage, commentMarker) => {
  const lines = rawMessage.split("\n");
  if (!commentMarker) return { contentLines: lines, commentLines: [] };
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(commentMarker)) continue;
    const rest = lines.slice(i);
    if (
      rest.every((line) => line.startsWith(commentMarker) || line.trim() === "")
    ) {
      return { contentLines: lines.slice(0, i), commentLines: rest };
    }
  }
  return { contentLines: lines, commentLines: [] };
};

const hasSubject = (rawMessage, commentMarker) =>
  splitCommentBlock(rawMessage, commentMarker).contentLines.some(
    (line) => line.trim() !== "",
  );

// Git recognizes only `:` as a trailer separator unless trailer.separators
// says otherwise; `=` is accepted here regardless, so an authored body line
// such as `Refs=BIG-102` is still misread as a trailer-only suffix.
const trailerLinePattern = /^[^\s:=]+[=:][ \t]*\S/;

const findTrailerBlockStart = (lines, subjectIndex) => {
  let separatorIndex = -1;
  for (let i = subjectIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") separatorIndex = i;
  }
  if (separatorIndex === -1 || separatorIndex === lines.length - 1) {
    return lines.length;
  }

  let hasTrailer = false;
  for (const line of lines.slice(separatorIndex + 1)) {
    if (trailerLinePattern.test(line)) {
      hasTrailer = true;
      continue;
    }
    if (hasTrailer && /^[ \t]+\S/.test(line)) continue;
    return lines.length;
  }

  return hasTrailer ? separatorIndex + 1 : lines.length;
};

/**
 * Ensures the message has a body paragraph after its subject line. A trailing
 * Git trailer block does not count as body content and is preserved after any
 * generated body note.
 */
export const ensureBody = (rawMessage, commentMarker = "#") => {
  const { contentLines, commentLines } = splitCommentBlock(
    rawMessage,
    commentMarker,
  );

  const trimmed = [...contentLines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }
  if (trimmed.length === 0) {
    // No subject at all; nothing sensible to add, let git reject the empty commit.
    return rawMessage;
  }

  const subjectIndex = trimmed.findIndex((line) => line.trim() !== "");
  const trailerStart = findTrailerBlockStart(trimmed, subjectIndex);
  const hasBody = trimmed
    .slice(subjectIndex + 1, trailerStart)
    .some((line) => line.trim() !== "");

  let content = trimmed;
  if (!hasBody) {
    content = [...trimmed.slice(0, subjectIndex + 1), "", GENERATED_BODY_NOTE];
    if (trailerStart < trimmed.length) {
      content.push("", ...trimmed.slice(trailerStart));
    }
  }

  return commentLines.length > 0
    ? [...content, "", ...commentLines].join("\n")
    : content.join("\n");
};

/** Parses "Name <email> <timestamp> <tz>" as produced by `git var`. */
const parseIdent = (identLine) => {
  const match = identLine.match(/^(.*) <([^>]*)> \d+ [+-]\d{4}\s*$/);
  return match ? { name: match[1], email: match[2] } : null;
};

const currentCommitterIdent = () => {
  try {
    const identLine = execFileSync("git", ["var", "GIT_COMMITTER_IDENT"], {
      encoding: "utf8",
    }).trim();
    return parseIdent(identLine);
  } catch {
    return null;
  }
};

const automaticCommentMarkers = "#;@!$%^&|:";

const unusedCommentMarker = (rawMessage) => {
  const lines = rawMessage.split("\n");
  let marker = "BIG_PLAN_UNUSED_COMMENT";
  while (lines.some((line) => line.startsWith(marker))) marker += "_";
  return marker;
};

/** Finds the marker Git selected for an auto-configured trailing comment
 * block. The selection is re-guessed from the message after editing, so a
 * template that shifted Git off `#` can be reconstructed wrongly here. */
const inferAutomaticCommentMarker = (rawMessage) => {
  const lines = rawMessage.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i][0];
    if (!marker || !automaticCommentMarkers.includes(marker)) continue;
    const rest = lines.slice(i);
    if (rest.every((line) => line.startsWith(marker) || line.trim() === "")) {
      return marker;
    }
  }
  return null;
};

/** Reads the last configured spelling because commentChar and commentString
 * are aliases whose effective value follows Git's config order. Editor-driven
 * `git commit -c` and non-editor `git commit -C` both arrive as source
 * `commit`, so the comments Git generates for `-c` are still counted as a
 * body. */
const currentCommentMarker = (rawMessage, source) => {
  if (
    source !== undefined &&
    source !== "template" &&
    source !== "merge" &&
    source !== "squash"
  ) {
    return null;
  }
  try {
    const configured = execFileSync(
      "git",
      ["config", "--null", "--get-regexp", "^core\\.comment(Char|String)$"],
      { encoding: "utf8" },
    );
    const entries = configured.split("\0").filter(Boolean);
    const effectiveEntry = entries.at(-1);
    if (!effectiveEntry) return "#";
    const valueSeparator = effectiveEntry.indexOf("\n");
    if (valueSeparator === -1) return "#";
    const marker = effectiveEntry.slice(valueSeparator + 1);
    if (marker !== "auto") return marker;
    return inferAutomaticCommentMarker(rawMessage);
  } catch (error) {
    if (error && typeof error === "object" && error.status === 1) return "#";
    throw error;
  }
};

/** Appends a Signed-off-by trailer while keeping editor comments outside the
 * content that `git interpret-trailers` normalizes. */
const addSignoffTrailer = (messageFile, ident, commentMarker) => {
  const rawMessage = readFileSync(messageFile, "utf8");
  const { contentLines, commentLines } = splitCommentBlock(
    rawMessage,
    commentMarker,
  );
  if (commentLines.length > 0) {
    writeFileSync(messageFile, contentLines.join("\n"), "utf8");
  }
  // `core.commentString` needs Git 2.45 or newer. An older Git ignores the
  // unknown key and falls back to "#", which lets interpret-trailers strip an
  // authored line that begins with "#". CONTRIBUTING.md records the floor.
  const trailerConfig = commentMarker
    ? []
    : ["-c", `core.commentString=${unusedCommentMarker(rawMessage)}`];
  execFileSync("git", [
    ...trailerConfig,
    "interpret-trailers",
    "--in-place",
    "--if-exists",
    "addIfDifferent",
    "--trailer",
    `Signed-off-by: ${ident.name} <${ident.email}>`,
    messageFile,
  ]);
  if (commentLines.length > 0) {
    const signedContent = readFileSync(messageFile, "utf8").replace(/\n+$/, "");
    writeFileSync(
      messageFile,
      `${signedContent}\n\n${commentLines.join("\n")}`,
      "utf8",
    );
  }
};

export const run = (argv) => {
  const [messageFile, source] = argv;
  if (!messageFile) {
    throw new Error("prepare-commit-msg: missing commit message file argument");
  }

  const raw = readFileSync(messageFile, "utf8");
  const commentMarker = currentCommentMarker(raw, source);
  if (!hasSubject(raw, commentMarker)) return;
  const withBody = ensureBody(raw, commentMarker);
  if (withBody !== raw) writeFileSync(messageFile, withBody, "utf8");

  const ident = currentCommitterIdent();
  // No configured identity: git itself will refuse to create the commit
  // before this hook's output matters, so there is nothing honest to sign.
  if (!ident) return;
  addSignoffTrailer(messageFile, ident, commentMarker);
};
