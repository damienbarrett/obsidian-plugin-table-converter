# Changelog

## 1.1.0

- Backups are now named `Note.BAK.md` (inserted before the `.md` extension) instead of `Note.md.BAK`, so a backup is itself a Markdown note; existing `.md.BAK` files are not touched. The convert and transpose commands, and their menu items, are also no longer offered for a note whose name ends in `.BAK.md` or `.errors.md` (case-insensitive), since converting or transposing one of the plugin's own generated notes doesn't make sense.
- Add a "Transpose rows ↔ columns" command (`transpose-rows-columns`), plus file-menu and editor-menu (whole-note) items, that swaps rows and columns in place while keeping the note's format (document stays a document, table stays a table). Shares conversion's validation, escaping, backup, error-reporting, and atomic-write/race rules. Rejects a transposition that would make the (unchanged) title equal a new column title.
- Fix: document → table conversion now fails when a "###" column title matches the "#" table title, instead of silently producing a table with a duplicate header (table → document already rejected this via its header-uniqueness check).
- Add a "Convert selection ↔ table" command and editor-menu item for converting just the current selection, with no separate backup file (use undo instead).
- Add a file-menu item ("Convert document ↔ table") for any Markdown file, and an editor-menu item that shows the selection or whole-note action as appropriate.
- Add a settings tab: configurable backup location (same folder, a dedicated backup folder, or off) and error reporting (a dialog with clickable, line-jumping errors, or the previous `.errors.md` note).
- Write conversions with an atomic read-modify-write; if the note changed underneath the conversion, it is aborted unchanged and reported instead of overwriting the newer content.
- Fix pipe (`|`) and `<br>` escaping to depend on backslash parity instead of only the immediately preceding character.

## 1.0.0

- Initial release.
