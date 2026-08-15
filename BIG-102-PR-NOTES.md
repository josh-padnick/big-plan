# BIG-102 follow-ups

- Distinguish editor-driven `git commit -c` messages from non-editor `git commit -C` messages even though both reach `prepare-commit-msg` with the `commit` source, so Git-generated editor comments cannot be mistaken for a body.
- Preserve the comment marker Git actually selects for `core.commentChar=auto` through final normalization, so authored content is not classified using a later guess.
- Match Git's effective `trailer.separators` configuration when identifying a trailer-only suffix instead of always treating `=` as a trailer separator.
- Preserve unrelated default hooks such as `pre-commit` and `pre-push` when redirecting an unset `core.hooksPath` to `.githooks`, rather than composing only the two commit-message hooks.
