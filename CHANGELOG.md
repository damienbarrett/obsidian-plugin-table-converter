# Changelog

## Unreleased

- Add a "Convert selection ↔ table" command and editor-menu item for converting just the current selection, with no separate backup file (use undo instead).
- Add a file-menu item ("Convert document ↔ table") for any Markdown file, and an editor-menu item that shows the selection or whole-note action as appropriate.
- Add a settings tab: configurable backup location (same folder, a dedicated backup folder, or off) and error reporting (a dialog with clickable, line-jumping errors, or the previous `.errors.md` note).
- Write conversions with an atomic read-modify-write; if the note changed underneath the conversion, it is aborted unchanged and reported instead of overwriting the newer content.
- Fix pipe (`|`) and `<br>` escaping to depend on backslash parity instead of only the immediately preceding character.

## 1.0.0

- Initial release.
