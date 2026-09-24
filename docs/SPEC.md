# Document ↔ Markdown Table Transformation

##### Purpose

-   **Convert.** Transform a heading-based document to a Markdown table and back.
-   **Transpose.** Swap rows and columns in either format.
-   **Preserve content.** Keep meaningful content through the conversion and transposition.

##### Differences from the provided specification

This document is the provided specification, corrected to match the plugin as built. The changes:

-   ==**Backslash escaping.** Only a run of backslashes immediately before `|` or `<br>` is doubled (parity rule: an odd run is escaped — the leftover backslash is the marker; an even run is literal backslashes followed by a real separator/break); other backslashes are written unchanged. Doubling every `\` would corrupt LaTeX (`$\frac{a}{b}$`), code spans, and Windows paths in the rendered table, and would change how 1.0.0-written tables decode. The text still round-trips.==
-   ==**Settings exist.** A settings tab adds a backup location (same folder — default, a dedicated mirrored backup folder, or off) and an error output (a dialog — default, or an error note).==
-   ==**Error output default.** Failure is reported via a dialog listing every error with clickable, line-jumping links by default; the `Note.errors.md` note is opt-in. A stale error note is deleted on success in both modes, via the vault's trash (following the user's Obsidian trash preference).==
-   ==**Extra command: `Convert selection ↔ table`.** An editor command that converts just the current selection in place. It writes no backup (relies on the editor's undo), does not treat a leading `---` line in the selection as front matter, and reports error line numbers relative to the whole note. Transpose remains whole-note only.==
-   ==**Menus.** A file-menu item and editor-menu items expose the same commands, in addition to the command palette.==
-   ==**Commands hidden for the plugin's own generated notes.** The convert/transpose commands and menu items are not offered for a note whose name ends `.BAK.md` or `.errors.md` (case-insensitive).==
-   ==**Atomic write with a race check.** The final write uses Obsidian's `vault.process`; if the note changed underneath the conversion between validation/backup and the write, the write aborts unchanged and is reported instead of silently overwriting newer content.==
-   ==**minAppVersion 1.6.6.** Required because deleting a stale error note uses `FileManager.trashFile`, added in Obsidian 1.6.6.==

##### Document Format

-   **Title.** Exactly one `#` heading, before the first `##`.
-   **Rows.** At least one `##` heading; each row title is unique.
-   **Columns.** Each row has at least one `###` heading; column titles within a row are unique.
-   **Cells.** Content beneath a `###` belongs to that cell. `####` and deeper headings are cell content.
-   **Empty cells.** Use a `###` heading with no content.
-   **Heading order.** A `###` before the first `##` is invalid.
-   **Unexpected content.** Content between `#` and the first `##`, or between `##` and its first `###`, is invalid.
-   **Title matching.** Compare titles case-sensitively after trimming surrounding whitespace.

##### Table Format

-   **Single table.** One header row, one delimiter row, and at least one body row; only surrounding blank lines are allowed.
-   **Column count.** Every body row has the header's number of cells.
-   **Headers.** Header cells are non-empty and unique.
-   **Row titles.** First-column body cells are non-empty and unique.
-   **Alignment.** Accept delimiter alignment but do not preserve it.
-   **Physical rows.** When in 'table mode' each row occupies one line. Line breaks within cells use `<br>`.

##### Shared Input Rules

-   **Front matter.** Allow YAML front matter at the top and exclude it from format detection. ==(`Convert selection ↔ table` does not treat a leading `---` line within the selection as front matter — see Plugin and Workflow.)==
-   **Detection.** After front matter, accept only a valid document or a single valid table. Otherwise, fail without guessing.
-   **Empty input.** A note with no body after front matter fails detection.
-   **Fenced code.** Ignore headings and table syntax inside backtick or tilde fences when identifying structure.
-   **Nested tables.** A Markdown table in a document cell section is invalid; table-like text inside a fenced code block is allowed.
-   **Whitespace.** Ignore surrounding blank lines when identifying cell content.
-   **Line endings.** Accept CRLF or LF; write LF and end the note with exactly one newline.

##### Document → Table

-   **Headers.** Use `#` for the first header and each distinct `###` title for the remaining headers, ordered by first occurrence.
-   **Rows.** Use each `##` title for the first cell of its row.
-   **Cells.** Place each section's content under its matching header; use an empty cell when that column is absent from a row.
-   **Header conflict.** Fail if the `#` title matches a column title, since table headers must be unique.
-   **Breaks.** Encode a line break as `<br>` and a paragraph break as `<br><br>`; keep list markers and separate list items with `<br>`.
-   **Pipes.** Escape literal `|` as `\|`, including in wikilink aliases.
-   **Literal breaks.** Escape existing `<br>` text as `\<br>`.
-   **Backslashes.** ~~Escape existing `\` as `\\` before encoding pipes and literal `<br>` text, so the original text can be restored.~~ ==Only a run of backslashes immediately before a `|` or a literal `<br>` is doubled (an odd run is escaped — the leftover backslash is the marker; an even run is literal backslashes followed by a real separator/break). Backslashes elsewhere (e.g. `C:\Users`, `\frac{a}{b}`) are written unchanged. See Differences, above.==
-   **Output.** Use `| --- |` delimiters without column padding.

##### Table → Document

-   **Title and rows.** Convert the first header to `#` and each first-column body cell to `##`.
-   **Columns.** Add a `###` heading for every remaining header beneath every row, including empty cells.
-   **Content.** Restore `<br>` as line breaks and `<br><br>` as paragraph breaks; preserve lists where possible.
-   **Escapes.** ~~Decode `\\`, `\|`, and `\<br>` to their literal forms; interpret only unescaped `<br>` as a break.~~ ==Apply the same backslash-parity rule used for encoding: a backslash run immediately before `|` or `<br>` is halved, and an odd run leaves that `|` or `<br>` as literal text; interpret only an unescaped (even-preceding-backslash) `<br>` as a break. Backslashes elsewhere in the cell are left exactly as written, since they were never doubled on the way in. See Differences, above.==
-   **Spacing.** Put one blank line between each heading and its content block.

##### Transpose

-   **Format.** Keep the input format: document → document or table → table.
-   **Title.** Keep the `#` title or first table header unchanged.
-   **Axes.** Original column titles become row titles, ordered by first occurrence. Original row titles become column titles, in their original order.
-   **Cells.** Move each cell to its transposed position. Create an empty cell or section wherever the original document omitted a column.
-   **Header conflict.** Fail if the unchanged title matches a new column title; do not rename titles.
-   **Output.** Apply the same escaping, spacing, and line-ending rules as conversion.
-   ==**Selection.** There is no selection-only transpose; it always operates on the whole note.==

##### Plugin and Workflow

-   **Plugin.** Implement as an Obsidian community plugin using only Obsidian APIs and browser-compatible functionality available on macOS and iOS.
-   ~~**Command.** Provide one command: `Convert document ↔ table`.~~
-   **Commands.** ~~Provide `Convert document ↔ table` and `Transpose rows ↔ columns`.~~ ==Provide `Convert document ↔ table`, `Transpose rows ↔ columns`, and `Convert selection ↔ table` (an editor command, available only with a non-empty selection; converts just the selection in place and writes no backup — see Differences, above).==
-   **Availability.** ~~Offer commands only when the active file is a Markdown note.~~ ==Offer the whole-note commands only when the active file is a Markdown note that is not one of the plugin's own generated notes (a name ending `.BAK.md` or `.errors.md`, case-insensitive). Offer the selection command under the same file restriction, plus a non-empty editor selection.==
-   **Scope.** ~~Each command operates on the entire active note and replaces it in place after success.~~ ==Each whole-note command operates on the entire active note and replaces it in place after success; `Convert selection ↔ table` operates only on the current selection and replaces just that text.==
-   **Validation.** Validate the complete note before writing; never partially convert or transpose it. ==(`Convert selection ↔ table` validates the complete selection the same way.)==
-   **Feedback.** ~~Show an Obsidian notice on success or failure.~~ ==Show an Obsidian notice on success or failure; a success notice also states where the backup was written, or that it was skipped, and a failure notice states how the errors were reported.==
-   ==**Menus.** A file-menu item, for any Markdown file eligible for the commands, offers `Convert document ↔ table` and `Transpose rows ↔ columns`. An editor-menu item offers `Convert selection ↔ table` when there is a selection, otherwise the same two whole-note items. No default hotkeys.==
-   **Settings.** ~~V1 has no user-configurable settings.~~ ==Backup location (same folder — default, dedicated backup folder, or off) and error output (dialog — default, or an error note) are configurable from a settings tab; see Backup and Errors.==
-   **Compatibility.** The same input and command produce the same output on macOS and iOS. ==(Requires Obsidian 1.6.6+; see Differences, above.)==

##### Backup and Errors

-   **Backup.** ~~Before replacing the source, create or overwrite a backup in the same folder.~~ ==Before replacing the source, create or overwrite a backup: in the same folder as the source (default), in a mirrored path under a configurable backup folder (e.g. `<backupFolder>/Projects/Notes.BAK.md` for `Projects/Notes.md`), or not at all if backups are turned off.==
-   **Backup name.** Use `Note.BAK.md` for `Note.md`.
-   **Backup failure.** Abort without changing the source if the backup cannot be written.
-   **Error note.** ~~On failure, create or overwrite `Note.errors.md` in the source folder, explaining why the source was not changed.~~ ==On failure, report why the source was not changed: by default, a dialog listing all errors with clickable line numbers; when the error-output setting is "Error note", create or overwrite `Note.errors.md` in the source folder instead.==
-   **Stale errors.** ~~Delete an existing error note after successful replacement.~~ ==Delete an existing `Note.errors.md`, if present, after a successful replacement — regardless of which error-output mode is currently active — via the vault's trash (following the user's Obsidian trash preference).==
-   **Validation failures.** Do not create or replace the backup when validation fails.
-   **Diagnostics.** Report all detectable validation errors where practical. Identify the relevant heading, row, or column, and always include a line number.
-   ==**Race.** The final write is atomic (`vault.process`); if the note changed underneath the conversion between validation/backup and the write, the write is aborted unchanged and reported as an error instead of overwriting the newer content.==
-   ==**Selection.** `Convert selection ↔ table` writes no backup (the editor's undo covers it); failures are reported via the error-output setting (dialog, or `Note.errors.md` for the whole note), with line numbers relative to the whole note.==

##### Examples

```markdown
# Table Title

## Row 1 Title

### Column A Title

A1 text.

### Column B Title

B1 text.

## Row 2 Title

### Column A Title

A2 text.

### Column B Title

B2 text.
```

```markdown
| Table Title | Column A Title | Column B Title |
| --- | --- | --- |
| Row 1 Title | A1 text. | B1 text. |
| Row 2 Title | A2 text. | B2 text. |
```

**Transpose either example above:**

```markdown
| Table Title | Row 1 Title | Row 2 Title |
| --- | --- | --- |
| Column A Title | A1 text. | A2 text. |
| Column B Title | B1 text. | B2 text. |
```

**Breaks, lists, and pipes:**

```markdown
# Tasks

## Alpha

### Notes

First line.
Second line.

New paragraph with a | pipe.

### Steps

- One
- Two
```

```markdown
| Tasks | Notes | Steps |
| --- | --- | --- |
| Alpha | First line.<br>Second line.<br><br>New paragraph with a \| pipe. | - One<br>- Two |
```

##### Acceptance Tests

-   **T01–T03.** Convert each valid format as shown; a round trip preserves meaningful content.
-   **T04.** Preserve YAML front matter text and ordering while normalizing line endings.
-   **T05–T06.** Missing document columns become empty table cells; empty table cells become empty `###` sections.
-   **T07–T10.** Preserve paragraphs, lists, deeper headings, fenced code, and literal pipes.
-   **T11–T14.** Reject duplicate row or within-row column titles and content in either forbidden gap.
-   **T15–T16.** Reject unsupported input without changing the source; ==report why, via the dialog by default or the error note when that setting is selected==.
-   **T17–T18.** Create or overwrite the backup before replacement; produce identical results on macOS and iOS.
-   **T19–T22.** Reject multiple `#` headings, mismatched table rows, empty or duplicate headers, and empty input.
-   **T23.** Round-trip literal `<br>` as text.
-   **T24–T25.** Delete stale errors after success ==in both error-output modes==; leave the source unchanged if backup writing fails.
-   **T26.** Transpose a document and a table into their respective formats.
-   **T27.** Transposing twice restores cell positions and meaningful content.
-   **T28.** Transpose sparse document rows with empty cells in the missing positions.
-   **T29.** Reject a transposition that would duplicate a table header; leave the source unchanged and report the error==, in both error-output modes==.
-   **T30.** Apply backup, stale-error, validation, and race rules to transposition ==(exercised against a fake vault adapter that stands in for both platforms, since the underlying logic is pure and platform-free)==.

Also covered, beyond T01–T30:

-   ==**Backslash parity.** Targeted escaping of only the backslash run immediately before `|` or `<br>` (not blanket doubling): LaTeX, a code-span Windows path, and an unrelated backslash pair all round-trip untouched; a run's parity determines whether it is escaped; a 1.0.0-style literal `\\` pair decodes unchanged.==
-   ==**Settings modes.** Backup location (same folder, dedicated folder — including mirrored nested paths and no collision between same-named notes in different folders — and off) and error output (dialog vs. error note) are each exercised for both convert and transpose.==
-   ==**Race.** A note that changes between validation/backup and the atomic write aborts unchanged and is reported, for both convert and transpose.==
-   ==**Selection.** Converting a selection fragment (with and without a trailing newline, and with surrounding blank lines) succeeds without writing a backup; validation-error line numbers are shifted to be note-relative; a leading `---` in the selection is treated as content, not front matter.==
-   ==**Title/column header conflict.** A document `###` column title equal to the `#` title is rejected, with a line number, before it could produce a duplicate table header.==
-   ==**Filename and availability helpers.** `getOutputPaths`/`getBackupPath`/`getErrorNotePath` are pinned down directly, including for a source name without a `.md` extension. `isConvertibleNotePath` is pinned down rejecting the plugin's own `.BAK.md`/`.errors.md` notes case-insensitively, while accepting an ordinary note whose name merely contains "bak" or "errors".==
-   Multi-line cells, lists, `<br>`/pipe/backslash content, wikilink aliases with `|`, deeper headings, and fenced code inside cells all survive transpose in both formats and survive transpose → convert → transpose → convert.

##### Future Considerations

-   **Selection.** ~~Consider selection-only operations after V1.~~ ==Partly done: selection-only convert has shipped (`Convert selection ↔ table`); selection-only transpose remains a future consideration.==
-   **Backups.** ~~Revisit whether `.BAK` files remain necessary.~~ ==Whether backup notes remain necessary at all is still open. In the meantime they are named `Note.BAK.md` (a Markdown note, not `Note.md.BAK`), and their location is configurable (same folder, dedicated folder, or off) — see Backup and Errors.==
-   **Fenced code.** Revisit richer fenced-code-block round-tripping after observing real examples.
-   **Settings.** ~~Add settings only where usage justifies them.~~ ==Backup location and error output are now configurable; add further settings only where usage justifies them.==
