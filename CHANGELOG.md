# Changelog

## Unreleased

- Add a "Transpose rows ↔ columns" command (`transpose-rows-columns`), plus file-menu and editor-menu (whole-note) items, that swaps rows and columns in place while keeping the note's format (document stays a document, table stays a table). Shares conversion's validation, escaping, backup, error-reporting, and atomic-write/race rules. Rejects a transposition that would make the (unchanged) title equal a new column title.
- Fix: document → table conversion now fails when a "###" column title matches the "#" table title, instead of silently producing a table with a duplicate header (table → document already rejected this via its header-uniqueness check).
- Add a "Convert selection ↔ table" command and editor-menu item for converting just the current selection, with no separate backup file (use undo instead).
- Add a file-menu item ("Convert document ↔ table") for any Markdown file, and an editor-menu item that shows the selection or whole-note action as appropriate.
- Add a settings tab: configurable backup location (same folder, a dedicated backup folder, or off) and error reporting (a dialog with clickable, line-jumping errors, or the previous `.errors.md` note).
- Write conversions with an atomic read-modify-write; if the note changed underneath the conversion, it is aborted unchanged and reported instead of overwriting the newer content.
- Fix pipe (`|`) and `<br>` escaping to depend on backslash parity instead of only the immediately preceding character.

## 1.0.0

- Initial release.
