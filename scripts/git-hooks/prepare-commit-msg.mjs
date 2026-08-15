// Rewrites a commit message in place so it always carries a body and a
// Signed-off-by trailer, matching CONTRIBUTING.md's DCO requirement, without
// depending on a human or an automated tool to remember `-s` or write a body.
// Invoked by .githooks/prepare-commit-msg, which core.hooksPath activates for
// every clone once `bun install` runs the "prepare" script (scripts/git-hooks/install.mjs).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export const GENERATED_BODY_NOTE =
  "(No commit body was supplied; this line was added automatically to satisfy this repository's commit-body requirement - see CONTRIBUTING.md.)";

/**
 * Splits a raw commit-message file into the real content lines and any
 * trailing `#`-comment block git appends for editor-driven commits. `-m`
 * commits have no comment block, so `commentLines` is empty for those.
 */
const splitCommentBlock = (rawMessage) => {
  const lines = rawMessage.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#")) continue;
    const rest = lines.slice(i);
    if (rest.every((line) => line.startsWith("#") || line.trim() === "")) {
      return { contentLines: lines.slice(0, i), commentLines: rest };
    }
  }
  return { contentLines: lines, commentLines: [] };
};

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
export const ensureBody = (rawMessage) => {
  const { contentLines, commentLines } = splitCommentBlock(rawMessage);

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

/** Appends a Signed-off-by trailer via `git interpret-trailers`, which owns
 * the correct blank-line and dedup semantics for trailer blocks. */
const addSignoffTrailer = (messageFile, ident) => {
  execFileSync("git", [
    "interpret-trailers",
    "--in-place",
    "--if-exists",
    "addIfDifferent",
    "--trailer",
    `Signed-off-by: ${ident.name} <${ident.email}>`,
    messageFile,
  ]);
};

export const run = (argv) => {
  const [messageFile] = argv;
  if (!messageFile) {
    throw new Error("prepare-commit-msg: missing commit message file argument");
  }

  const raw = readFileSync(messageFile, "utf8");
  const withBody = ensureBody(raw);
  if (withBody !== raw) writeFileSync(messageFile, withBody, "utf8");

  const ident = currentCommitterIdent();
  // No configured identity: git itself will refuse to create the commit
  // before this hook's output matters, so there is nothing honest to sign.
  if (!ident) return;
  addSignoffTrailer(messageFile, ident);
};
