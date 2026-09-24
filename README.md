# Table Converter

Convert heading-based Markdown documents to Markdown tables and back. The plugin transforms structural information into tabular form, making it easy to switch between hierarchical and tabular representations of the same data.

## How it works

The plugin converts between two formats for the same data:

**Document format** (heading-based structure):
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

**Table format** (Markdown table):
```markdown
| Table Title | Column A Title | Column B Title |
| --- | --- | --- |
| Row 1 Title | A1 text. | B1 text. |
| Row 2 Title | A2 text. | B2 text. |
```

The document format uses headings to define structure: the title (`#`), row titles (`##`), and column titles (`###`), with content beneath column headings forming table cells.

## Usage

Three commands are available from the command palette:

- **Convert document ↔ table** — converts the entire active note. Available only when the active file is a Markdown note.
- **Convert selection ↔ table** — converts the current selection in place. Available only when there is a non-empty selection. Selection conversions are not backed up separately; undo with Ctrl/Cmd+Z if needed.
- **Transpose rows ↔ columns** — swaps rows and columns in the entire active note, keeping its format (a document stays a document, a table stays a table). Available only when the active file is a Markdown note.

Both convert commands automatically detect whether the input is a document or a table and convert it to the other format.

None of the three commands (or their menu items) are offered for one of the plugin's own generated notes — a backup (`*.BAK.md`) or an error note (`*.errors.md`) — since converting or transposing those doesn't make sense.

The same actions are available from the right-click menu:

- The file menu (right-click a Markdown file, e.g. in the file explorer) shows **Convert document ↔ table** and **Transpose rows ↔ columns**.
- The editor menu (right-click inside a note) shows **Convert selection ↔ table** when there is a selection, otherwise **Convert document ↔ table** and **Transpose rows ↔ columns**.

### Transpose example

Transposing the table above yields the equivalent of:
```markdown
| Table Title | Row 1 Title | Row 2 Title |
| --- | --- | --- |
| Column A Title | A1 text. | A2 text. |
| Column B Title | B1 text. | B2 text. |
```
The title stays the same; original column titles become row titles (ordered by first occurrence) and original row titles become column titles (in their original order). Transposing a document works the same way, in document form. Transposing a note whose title would then equal one of the new column titles (an original row title) is rejected, since titles are never renamed to avoid the conflict.

## Settings

- **Backup location** — where to save a copy of the note before converting it:
  - *Same folder as the note* (default) — creates a `Note.BAK.md` file next to the source note (for `Note.md`).
  - *Dedicated backup folder* — saves the backup into a configurable vault folder (default: "Table Converter backups"), mirroring the note's own folder structure underneath it (e.g. `Projects/Notes.md` backs up to `Table Converter backups/Projects/Notes.BAK.md`), so notes with the same name in different folders don't collide. Folders are created automatically if missing.
  - *Off* — no backup is written. Selection conversions never write a backup, regardless of this setting; use undo instead.
- **Error reporting** — how conversion errors are reported when validation fails:
  - *Dialog* (default) — shows a dialog listing each error with its line number; clicking an error jumps the editor to that line if the note is open.
  - *Error note* — writes an `.errors.md` file next to the source note, as in earlier versions.

  Either way, a stale error note from a previous failed conversion is deleted automatically on the next successful conversion.

## Installation

Once the plugin is listed in the community plugins, you can install it from within Obsidian.

For manual installation: download `main.js` and `manifest.json` from the latest release and place them in `<vault>/.obsidian/plugins/table-converter/`.

You can also use BRAT (Beta Reviewers Auto-update Tool) to install and auto-update the plugin from its GitHub releases.

## Development

Install dependencies:
```
npm install
```

Start the development server:
```
npm run dev
```

Build for production:
```
npm run build
```

Run tests:
```
npm test
```

To release a new version:
```
npm version patch|minor|major
git push --follow-tags
```

The CI/CD pipeline will automatically build and publish a GitHub release.

## License

MIT
