# docs/claude/ — Claude-facing design docs

> **Audience: Claude. Not humans.** Every file in this directory exists to make Claude (or another automated assistant) execute the correct change on the relevant subsystem without re-deriving design rationale from scratch each time. Human-facing framing, scenic examples, editorial narration, and feel-good prose do not belong here — they waste tokens and dilute the actionable rules.

## Mandatory properties of every doc in this directory

A file in `docs/claude/` must have, at minimum:

1. **A preamble blockquote** declaring: (a) that the file is Claude-facing and optimised for execution; (b) the concrete triggers to Read it (which files being edited, which user symptoms); (c) the repo-relative path convention; (d) the "trust the code if they disagree" clause.
2. **File-level references throughout the body**. Use `path/to/file.rs:123::function_name` style, not prose descriptions like "the startup code". If Claude would have to grep to find what you mean, the reference is not specific enough.
3. **Explicit `Do not X` rules**, typically grouped in a "What we deliberately DON'T do" or "Critical invariants" section. State the rule, the reason (usually "this was tried; it broke Y"), and the class of future change that would tempt re-introduction. Without the "tempt" framing, the next Claude pass will "helpfully" re-add the deleted mechanism.
4. **A Files list** at the end enumerating every code path that matters for the subsystem. This is the acceptance criterion: if Claude edits any file in the list, Reading the deep-dive first is mandated by CLAUDE.md's "Subsystem deep-dives" section.

## Style rules (Claude-executable, not human-readable)

- **Rules before explanations.** Lead with "Do X." / "Don't do X." State the reason on the next line, not before. Claude reads top-down and applies the first imperative it sees.
- **Concrete over abstract.** `engine/macos/mod.rs::reapply_on_active_primary early-returns when released == true` beats "the reapply function guards against the release window".
- **No scenic examples.** "e.g. Starbucks / airport / hotel Wi-Fi" is narrative colour. Replace with the property that matters: "networks that block outbound UDP/53 entirely".
- **No motivational prose.** "This is a powerful technique" / "We love this because" / "elegantly handles" — delete.
- **Preserve the why when it prevents regressions.** A `Do not X` without a `Reason:` will be deleted by the next refactor pass. Keep reason + tempt together.
- **Tables for decision matrices.** Multi-axis rules (platform × behaviour, version × path) render far better as tables than prose.
- **Preserve intentional typos** with an inline note. Example: the string `miexdGlobalConfig` in `config-template-loading.md` is preserved so `git log -S` still hits historical callers. An unmarked typo will be "corrected" on the next pass.
- **No emoji.** Not a human-readability aid here.

## When creating a new doc in this directory

1. **Copy the preamble structure** from any existing file (`dns-override.md`, `update-argv-suppression.md`, `config-template-loading.md`). Do not invent a new preamble shape.
2. **Register it in `CLAUDE.md`** under the "Subsystem deep-dives" section, with the same `Read before editing: <path list>` line. Unregistered docs are invisible to the "Read before editing" trigger and will be ignored.
3. **Link from the module's top-of-file doc comment** (e.g., `src/foo/mod.rs` top docstring: `// See docs/claude/foo.md for the state-machine invariants.`) so anyone grepping the code finds the doc.
4. **List every rule in "What we deliberately DON'T do"**. If you can't name three, the subsystem probably isn't non-trivial enough to warrant a deep-dive — keep it in `CLAUDE.md` or as a code comment.

## When editing an existing doc

- **The code is ground truth.** If the doc disagrees with `src/` / `src-tauri/`, the doc is wrong — update the doc, not the code (unless the code is also wrong, in which case fix both).
- **Don't remove `Do not X` rules without understanding why they were added.** Check `git blame` / `git log` for the commit that added the rule; the commit message usually explains the bug that motivated it. "It seems unnecessary now" is almost always wrong — the rule exists because the bug existed, and the bug will re-appear if the rule is deleted.
- **Don't add human-flavoured framing** even if the existing doc has some. This directory is being audited for Claude-facing style; new content should set the bar, not lower it.
