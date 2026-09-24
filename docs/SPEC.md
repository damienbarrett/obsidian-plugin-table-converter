# Document ↔ Markdown Table Transformation

##### Purpose

-   Transform a heading-based Markdown document to a Markdown table.
-   Transform the Markdown table back to the heading-based document.
-   Preserve meaningful content during either transformation.

##### Document Structure

-   `#` = table title.
-   `##` = row title.
-   `###` = column title.
-   Content beneath a `###` heading = cell content.
-   `####` and deeper headings are cell content, not table structure.
-   **Single title**. Exactly one `#` heading, before the first `##`.
-   **Rows required**. At least one `##` heading.
-   **Heading order**. A `###` before the first `##` is an error.
-   Each row title must be unique.
-   Each column title within a row must be unique.
-   **Title matching**. Titles match by exact, case-sensitive text after trimming whitespace.
-   **Row without columns**. A `##` with no `###` is invalid. There should be headings with no content for empty cells. 
-   Content directly below `#`, before the first `##`, is an error.
-   Content directly below `##`, before the first `###`, is an error.

##### Table Structure

-   **Single table**. Header row, delimiter row, then one or more body rows.
-   **Column count**. Every row has the same number of cells as the header.
-   **Headers**. Header cells are non-empty and unique.
-   **Row titles**. First-column body cells are non-empty and unique.
-   **Alignment**. Delimiter-row alignment (`:---`, `:---:`, `---:`) is not preserved.

##### Document → Table

-   Use the `#` heading as the first table header.
-   Use each unique `###` heading as a column header.
-   Use each `##` heading as the first cell of its row.
-   Place each section's content in its corresponding cell.
-   Determine column order from each column's first occurrence.
-   Create an empty cell when a row has no content for a column.
-   Use `<br>` for a line break and `<br><br>` for a paragraph break within cells.
-   Preserve lists within cells. Separate list items with `<br>`.
-   Escape `|` characters where required by Markdown table syntax. Use `\|`, including in wikilink aliases (`[[Note\|Alias]]`).
-   **Literal `<br>`**. Escape existing `<br>` text as `\<br>`.
-   **Output format**. Use `| --- |` delimiters and no column padding, as in the example.

##### Table → Document

-   Convert the first table header to `#`.
-   Convert each first-column body cell to `##`.
-   Convert each remaining table header to `###` beneath every row.
-   Place the corresponding cell content beneath each `###` heading.
-   Always create the `###` heading, even when its cell is empty.
-   Convert `<br>` representations back to document line or paragraph breaks.
-   Preserve lists where possible.
-   **Unescape**. Restore `\|` to `|` and `\<br>` to `<br>`.
-   **Spacing**. One blank line between each heading and content block.

##### Content Handling

-   Preserve inline Markdown where possible.
-   Preserve links, emphasis, inline code, tags, and lists.
-   Do not interpret headings inside fenced code blocks as document structure.
-   Do not interpret table syntax inside fenced code blocks as the table to transform.
-   **Nested tables**. A Markdown table inside a cell section is an error.
-   Ignore surrounding blank lines when identifying cell content.
-   Allow YAML front matter at the top of the note.
-   Ignore front matter when detecting whether the note is a document or table.
-   Preserve front matter exactly as written during conversion.
-   **Line endings**. Accept CRLF or LF. Write LF and end the note with one newline.

##### Plugin Form

-   Implement as an Obsidian community plugin.
-   Support both macOS and iOS as first-class platforms.
-   Use only Obsidian APIs and browser-compatible functionality available on both platforms.
-   Do not require Node.js, Electron-only APIs, shell commands, or other desktop-only dependencies.

##### User Workflow

-   Provide one command: `Convert document ↔ table`.
-   The command operates on the entire active note.
-   **Availability**. The command is available only when the active file is a Markdown note.
-   The command detects the current supported format and converts to the other format.
-   Replace the active note in place after a successful conversion.
-   Do not perform partial conversions.
-   Do not modify the source note when validation or format detection fails.
-   **Feedback**. Show an Obsidian notice on success or failure.

##### Transpose

-   Provide one command: `Transpose rows ↔ columns` (id `transpose-rows-columns`).
-   The command operates on the entire active note, in place. **Availability**: only when the active file is a Markdown note. Selection-only transpose is out of scope.
-   **Format**. Keep the input format: a document transposes to a document; a table transposes to a table.
-   **Title**. The `#` title, or the first table header, is unchanged.
-   **Axes**. Original column titles become row titles, ordered by first occurrence. Original row titles become column titles, in their original order.
-   **Cells**. Move each cell to its transposed position. Create an empty cell, or an empty `###` section, wherever the original omitted a column.
-   **Header conflict**. Fail if the unchanged title would equal a new column title (i.e. an original row title); titles are never renamed to avoid a conflict.
-   **Output**. Apply the same escaping, spacing, front-matter, and line-ending rules as conversion; the same validation applies to the input. Same backup, backup-failure, stale-error, error-output, atomic-write, and race rules as conversion, via the same workflow path.
-   Available from the command palette, the file menu (for Markdown files), and the editor menu (whole note only; not shown alongside the selection-conversion item). No default hotkey.
-   See the Example section below for a worked transpose of the first example.

##### Format Detection

-   If the remaining note is entirely one valid Markdown table, treat it as table input.
-   If the remaining note strictly follows the defined `#` → `##` → `###` hierarchy, treat it as document input.
-   Otherwise, fail validation.
-   Do not use fuzzy detection or guess the intended format.
-   **Empty note**. A note with no body after the front matter fails detection.

##### Validation

-   Validate the complete note before changing it.
-   If any validation error exists, abort the conversion.
-   Report all detected validation errors where practical, rather than stopping at the first error.
-   Include enough information to locate each error, such as the relevant heading, row, column, or line when available. Always include the line number.

##### Backup Behaviour

-   Before a successful in-place conversion, create a backup in the same folder as the source note.
-   Use a `.BAK` suffix for the backup file. 
-   Overwrite an existing backup with the same backup name.
-   Do not create or replace the backup when validation fails and the source note is not modified.
-   **Backup failure**. If the backup cannot be written, abort without modifying the source.

##### Error Reporting

-   On failure, create an error note in the same folder as the source note.
-   Use the source note name with an `.errors` suffix. Name: `Note.errors.md`.
-   Overwrite an existing error note with the same error-note name.
-   The error note must explain why conversion did not occur.
-   **Stale errors**. Delete an existing error note after a successful conversion.

##### Settings

-   V1 has no user-configurable settings.
-   Hard-code the agreed transformation, backup, error-reporting, and compatibility behaviour.

##### Scope

-   The same input should produce the same output on both platforms.
-   Selection-based conversion is explicitly out of scope for V1.

##### Example

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

-   **Transpose example**. Transposing either form above (keeping its own format) yields the equivalent of:

```markdown
| Table Title | Row 1 Title | Row 2 Title |
| --- | --- | --- |
| Column A Title | A1 text. | A2 text. |
| Column B Title | B1 text. | B2 text. |
```

-   **Second example**. Breaks, lists and pipes (below).

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

-   T01 — Valid document converts to the expected table.
-   T02 — Valid table converts to the expected document.
-   T03 — Document → table → document preserves meaningful content.
-   T04 — YAML front matter is preserved exactly and ignored for format detection.
-   T05 — A row missing a defined column produces an empty table cell.
-   T06 — An empty table cell produces an empty `###` section.
-   T07 — Paragraph breaks and lists survive conversion using the defined `<br>` representation.
-   T08 — `####` and deeper headings survive as cell content.
-   T09 — Fenced-code content is treated as text without being misread as document structure or a table.
-   T10 — Literal `|` characters are escaped and restored correctly.
-   T11 — A duplicate `###` heading within one row fails validation and produces an error note.
-   T12 — A duplicate `##` row title fails validation and produces an error note.
-   T13 — Content between `#` and the first `##` fails validation.
-   T14 — Content between a `##` heading and its first `###` fails validation.
-   T15 — Input that is neither a valid document nor one valid Markdown table fails detection.
-   T16 — Validation failure leaves the source note unchanged and creates or overwrites the `.errors` note.
-   T17 — Successful conversion creates or overwrites the `.BAK` note before replacing the source.
-   T18 — The same test inputs produce the same results on macOS and iOS.
-   T19 — More than one `#` heading fails validation.
-   T20 — Table rows with mismatched cell counts fail validation.
-   T21 — Empty or duplicate table headers fail validation.
-   T22 — An empty note fails detection.
-   T23 — Literal `<br>` text round-trips as text.
-   T24 — Successful conversion deletes a stale `.errors` note.
-   T25 — Backup write failure leaves the source unchanged.
-   T26 — Transposing a document → document and a table → table (the example above, both formats) swaps rows and columns as expected.
-   T27 — Transposing twice restores cell positions and meaningful content: byte-identical for a dense input; for a sparse document, the second transpose leaves empty `###` sections where columns were missing (content-equal, not byte-identical).
-   T28 — A sparse document's rows without a given column produce empty cells/sections in the missing positions after transpose.
-   T29 — Transposing rejects a transposition that would duplicate a header (title equals an original row title): the source is left unchanged and the error is reported (error-note mode writes the note; modal mode writes no file).
-   T30 — Backup, stale-error, validation-failure, and race rules apply to transpose, exercised via the workflow tests' fake adapter.

Also covered: multi-line cells, lists, `<br>`/pipe/backslash content, wikilink aliases with `|`, deeper headings, and fenced code inside cells all survive transpose in both formats and survive transpose → convert → transpose → convert.

##### Future Considerations

-   Selection-only conversion.
-   Revisit whether `.BAK` files remain necessary after the plugin is mature.
-   Revisit richer fenced-code-block round-tripping after observing real examples.
-   Add configurable settings only where actual usage justifies them.

