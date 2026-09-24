import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	convertNote,
	getBackupPath,
	getErrorNotePath,
	getOutputPaths,
	formatErrorsAsNote,
} from "../node_modules/.cache/table-converter-tests/converter.bundled.mjs";

const DOC1 = `# Table Title

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
`;

const TABLE1 = `| Table Title | Column A Title | Column B Title |
| --- | --- | --- |
| Row 1 Title | A1 text. | B1 text. |
| Row 2 Title | A2 text. | B2 text. |
`;

const DOC2 = `# Tasks

## Alpha

### Notes

First line.
Second line.

New paragraph with a | pipe.

### Steps

- One
- Two
`;

const TABLE2 = `| Tasks | Notes | Steps |
| --- | --- | --- |
| Alpha | First line.<br>Second line.<br><br>New paragraph with a \\| pipe. | - One<br>- Two |
`;

function okOut(input) {
	const r = convertNote(input);
	assert.equal(r.ok, true, `expected ok, got errors: ${JSON.stringify(r.errors)}`);
	return r;
}

describe("T01 valid document -> table", () => {
	it("converts example 1", () => {
		const r = okOut(DOC1);
		assert.equal(r.direction, "document-to-table");
		assert.equal(r.output, TABLE1);
	});
	it("converts breaks/lists/pipes example", () => {
		const r = okOut(DOC2);
		assert.equal(r.direction, "document-to-table");
		assert.equal(r.output, TABLE2);
	});
});

describe("T02 valid table -> document", () => {
	it("converts example 1 table", () => {
		const r = okOut(TABLE1);
		assert.equal(r.direction, "table-to-document");
		assert.equal(r.output, DOC1);
	});
	it("converts table2", () => {
		const r = okOut(TABLE2);
		assert.equal(r.direction, "table-to-document");
		assert.equal(r.output, DOC2);
	});
});

describe("T03 round-trip", () => {
	it("doc->table->doc preserves", () => {
		const t = okOut(DOC2);
		const d = okOut(t.output);
		assert.equal(d.output, DOC2);
	});
	it("table->doc->table preserves", () => {
		const d = okOut(TABLE2);
		const t = okOut(d.output);
		assert.equal(t.output, TABLE2);
	});
});

describe("T04 front matter", () => {
	it("preserved exactly, ignored for detection (doc)", () => {
		const fm = `---\ntitle: Hi\n---\n`;
		const r = okOut(fm + DOC1);
		assert.equal(r.direction, "document-to-table");
		assert.ok(r.output.startsWith(fm));
		assert.ok(r.output.endsWith(TABLE1));
	});
	it("preserved for table->doc", () => {
		const fm = `---\ntitle: Hi\ntags: [a]\n---\n`;
		const r = okOut(fm + TABLE1);
		assert.equal(r.direction, "table-to-document");
		assert.ok(r.output.startsWith(fm));
		assert.ok(r.output.endsWith(DOC1));
	});
	it("CRLF accepted, LF written", () => {
		const crlf = DOC1.replaceAll("\n", "\r\n");
		const r = okOut(crlf);
		assert.ok(!r.output.includes("\r"));
		assert.ok(r.output.endsWith("\n"));
	});
});

describe("T05 missing column -> empty cell", () => {
	it("row missing column produces empty cell", () => {
		const doc = `# T\n\n## R1\n\n### A\n\nx\n\n### B\n\ny\n\n## R2\n\n### A\n\nz\n`;
		const r = okOut(doc);
		assert.equal(
			r.output,
			`| T | A | B |\n| --- | --- | --- |\n| R1 | x | y |\n| R2 | z |  |\n`,
		);
	});
});

describe("T06 empty cell -> empty section", () => {
	it("empty table cell produces empty ### section", () => {
		const table = `| T | A | B |\n| --- | --- | --- |\n| R1 |  | y |\n`;
		const r = okOut(table);
		assert.equal(r.direction, "table-to-document");
		assert.ok(r.output.includes("### A\n\n##"));
		// Explicit: empty A section followed directly by next heading
		assert.ok(r.output.includes("# T\n\n## R1\n\n### A\n\n### B\n\ny\n"));
	});
});

describe("T07 breaks and lists", () => {
	it("paragraph + list survive", () => {
		const r = okOut(DOC2);
		assert.ok(r.output.includes("<br><br>"));
		assert.ok(r.output.includes("- One<br>- Two"));
		const back = okOut(r.output);
		assert.equal(back.output, DOC2);
	});
});

describe("T08 deep headings as content", () => {
	it("#### survives as cell content", () => {
		const doc = `# T\n\n## R\n\n### C\n\ntext\n\n#### deep heading\n\nmore\n`;
		const r = okOut(doc);
		assert.equal(r.direction, "document-to-table");
		assert.ok(r.output.includes("#### deep heading"));
		const back = okOut(r.output);
		assert.ok(back.output.includes("#### deep heading"));
	});
});

describe("T09 fenced code", () => {
	it("headings inside fence are not structure", () => {
		const doc = "# T\n\n## R\n\n### C\n\n```\n## not a row\n### not a col\n| a | b |\n| --- | --- |\n```\n";
		const r = okOut(doc);
		assert.equal(r.direction, "document-to-table");
	});
	it("table syntax inside fence is not a table", () => {
		const note = "```\n| A | B |\n| --- | --- |\n| x | y |\n```\n";
		const r = convertNote(note);
		assert.equal(r.ok, false);
	});
});

describe("T10 pipes", () => {
	it("escaped and restored", () => {
		const doc = "# T\n\n## R\n\n### C\n\na | b\n";
		const r = okOut(doc);
		assert.ok(r.output.includes("a \\| b"));
		const back = okOut(r.output);
		assert.ok(back.output.includes("a | b"));
	});
	it("wikilink alias pipe", () => {
		const doc = "# T\n\n## R\n\n### C\n\n[[Note|Alias]]\n";
		const r = okOut(doc);
		assert.ok(r.output.includes("[[Note\\|Alias]]"));
		const back = okOut(r.output);
		assert.ok(back.output.includes("[[Note|Alias]]"));
	});
});

describe("T11 duplicate ### fails", () => {
	it("fails with line numbers", () => {
		const doc = "# T\n\n## R\n\n### C\n\nx\n\n### C\n\ny\n";
		const r = convertNote(doc);
		assert.equal(r.ok, false);
		assert.ok(r.errors.length >= 1);
		for (const e of r.errors) assert.ok(Number.isInteger(e.line) && e.line > 0);
		assert.ok(r.errors.some((e) => /duplicate/i.test(e.message)));
	});
});

describe("T12 duplicate ## fails", () => {
	it("fails", () => {
		const doc = "# T\n\n## R\n\n### C\n\nx\n\n## R\n\n### C\n\ny\n";
		const r = convertNote(doc);
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => /duplicate/i.test(e.message)));
		assert.ok(r.errors.every((e) => Number.isInteger(e.line)));
	});
});

describe("T13 content between # and ## fails", () => {
	it("fails", () => {
		const doc = "# T\n\nstray text\n\n## R\n\n### C\n\nx\n";
		const r = convertNote(doc);
		assert.equal(r.ok, false);
	});
});

describe("T14 content between ## and ### fails", () => {
	it("fails", () => {
		const doc = "# T\n\n## R\n\nintro\n\n### C\n\nx\n";
		const r = convertNote(doc);
		assert.equal(r.ok, false);
	});
});

describe("T15 neither format fails detection", () => {
	it("plain text fails", () => {
		const r = convertNote("just some text\nanother line\n");
		assert.equal(r.ok, false);
	});
});

describe("T16 validation failure -> errors note (pure helpers)", () => {
	it("convertNote does not mutate; error note path + content", () => {
		const bad = "# T\n\n## R\n\n### C\n\nx\n\n### C\n\ny\n";
		const r = convertNote(bad);
		assert.equal(r.ok, false);
		const p = getErrorNotePath("Folder/Note.md");
		assert.equal(p, "Folder/Note.errors.md");
		const note = formatErrorsAsNote("Folder/Note.md", r.errors);
		assert.ok(note.includes("Conversion did not occur"));
		assert.ok(note.includes("Line"));
	});
});

describe("T17 backup path", () => {
	it("uses .BAK suffix in same folder", () => {
		assert.equal(getBackupPath("Note.md"), "Note.md.BAK");
		assert.equal(getBackupPath("F/Note.md"), "F/Note.md.BAK");
	});
});

describe("T19 multiple # fails", () => {
	it("fails", () => {
		const doc = "# A\n\n## R\n\n### C\n\nx\n\n# B\n";
		const r = convertNote(doc);
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => /multiple|"#"/i.test(e.message)));
	});
});

describe("T20 mismatched cell counts fail", () => {
	it("fails", () => {
		const t = "| A | B |\n| --- | --- |\n| x |\n";
		const r = convertNote(t);
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => /cells|expected/i.test(e.message)));
	});
});

describe("T21 empty/duplicate headers fail", () => {
	it("empty header fails", () => {
		const t = "| A |  |\n| --- | --- |\n| x | y |\n";
		const r = convertNote(t);
		assert.equal(r.ok, false);
	});
	it("duplicate header fails", () => {
		const t = "| A | A |\n| --- | --- |\n| x | y |\n";
		const r = convertNote(t);
		assert.equal(r.ok, false);
	});
	it("empty row title fails", () => {
		const t = "| A | B |\n| --- | --- |\n|  | y |\n";
		const r = convertNote(t);
		assert.equal(r.ok, false);
	});
	it("duplicate row title fails", () => {
		const t = "| A | B |\n| --- | --- |\n| x | y |\n| x | z |\n";
		const r = convertNote(t);
		assert.equal(r.ok, false);
	});
});

describe("T22 empty note fails", () => {
	it("empty + front-matter-only fail", () => {
		assert.equal(convertNote("").ok, false);
		assert.equal(convertNote("\n\n").ok, false);
		assert.equal(convertNote("---\ntitle: x\n---\n").ok, false);
	});
});

describe("T23 literal <br> round-trips", () => {
	it("literal br escaped", () => {
		const doc = "# T\n\n## R\n\n### C\n\nuse <br> literally\n";
		const r = okOut(doc);
		assert.ok(r.output.includes("\\<br>"));
		const back = okOut(r.output);
		assert.ok(back.output.includes("use <br> literally"));
	});
});

describe("T24/T25 plugin behaviour documented", () => {
	it("error path helper", () => {
		assert.equal(getErrorNotePath("Note.md"), "Note.errors.md");
	});
});

describe("nested table error", () => {
	it("table inside cell section fails", () => {
		const doc = "# T\n\n## R\n\n### C\n\ntext\n\n| A | B |\n| --- | --- |\n| x | y |\n";
		const r = convertNote(doc);
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => /nested/i.test(e.message)));
	});
});

describe("row without columns fails", () => {
	it("## with no ### fails", () => {
		const doc = "# T\n\n## Lonely\n";
		const r = convertNote(doc);
		assert.equal(r.ok, false);
	});
});

describe("### before ## fails", () => {
	it("fails", () => {
		const doc = "# T\n\n### Early\n\nx\n\n## R\n\n### C\n\ny\n";
		const r = convertNote(doc);
		assert.equal(r.ok, false);
	});
});

describe("delimiter alignment not preserved (parses)", () => {
	it("accepts alignment markers", () => {
		const t = "| A | B |\n| :--- | ---: |\n| x | y |\n";
		const r = okOut(t);
		assert.equal(r.direction, "table-to-document");
	});
});

describe("pipe escaping: backslash parity", () => {
	// A `|` in table syntax is escaped iff it is preceded by an odd number
	// of consecutive backslashes. These cases pin down that rule instead of
	// a naive "single preceding char" check.

	it("two backslashes before a pipe: escaped backslash, then a real separator", () => {
		// Body cell "A" is `x` followed by two literal backslashes, directly
		// against the delimiter pipe (even count -> not escaped -> the row
		// still has 3 cells).
		const t = "| T | A | B |\n| --- | --- | --- |\n| R | x\\\\| y |\n";
		const r = okOut(t);
		assert.equal(r.direction, "table-to-document");
		// Decodes to one literal backslash (the pair), not two.
		assert.ok(r.output.includes("### A\n\nx\\\n\n### B"));
	});

	it("three backslashes before a pipe: escaped backslash + escaped pipe, one cell", () => {
		// Body cell "C" is `x` + three backslashes + `|` + `y`. The pipe is
		// escaped (odd count), so it does not split the row.
		const t = "| T | C |\n| --- | --- |\n| R | x\\\\\\|y |\n";
		const r = okOut(t);
		assert.equal(r.direction, "table-to-document");
		// Decodes to one literal backslash followed by one literal pipe.
		assert.ok(r.output.includes("### C\n\nx\\|y\n"));
		const back = okOut(r.output);
		assert.equal(back.output, t);
	});

	it("a three-backslash run still merges the row (regression guard)", () => {
		// Same pattern as above but with a header expecting 3 columns: since
		// the pipe is escaped, the row only has 2 cells and validation must
		// report a mismatch rather than silently splitting on it.
		const t = "| T | A | B |\n| --- | --- | --- |\n| R | x\\\\\\| y |\n";
		const r = convertNote(t);
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => /cells/i.test(e.message)));
	});

	it("applies the same rule to a table header (title)", () => {
		// Header cell is `T` + three backslashes + `|` + `U` (escaped pipe).
		const t = "| T\\\\\\|U | C |\n| --- | --- |\n| R | x |\n";
		const r = okOut(t);
		assert.equal(r.direction, "table-to-document");
		assert.ok(r.output.startsWith("# T\\|U\n"));
	});

	it("applies the same rule to a row title", () => {
		const t = "| T | C |\n| --- | --- |\n| R\\\\\\|S | x |\n";
		const r = okOut(t);
		assert.ok(r.output.includes("## R\\|S\n"));
	});

	it("literal <br> directly adjacent to a pipe round-trips", () => {
		const doc = "# T\n\n## R\n\n### C\n\nbefore<br>after | pipe\n";
		const r = okOut(doc);
		assert.equal(r.direction, "document-to-table");
		assert.ok(r.output.includes("before\\<br>after \\| pipe"));
		const back = okOut(r.output);
		assert.equal(back.output, doc);
	});

	it("literal backslashes next to a pipe round-trip through a document", () => {
		// Doc content has two literal backslashes directly before a pipe;
		// this is plain text (not table syntax) at this stage.
		const doc = "# T\n\n## R\n\n### C\n\nx\\\\|y\n";
		const r = okOut(doc);
		assert.equal(r.direction, "document-to-table");
		const back = okOut(r.output);
		assert.equal(back.output, doc);
	});

	it("a single literal backslash with no adjacent special character round-trips", () => {
		const doc = "# T\n\n## R\n\n### C\n\nx\\y\n";
		const r = okOut(doc);
		// Not near a `|` or `<br>`, so it must not be doubled in the table.
		assert.ok(r.output.includes("x\\y"));
		assert.ok(!r.output.includes("x\\\\y"));
		const back = okOut(r.output);
		assert.equal(back.output, doc);
	});
});

describe("backslash escaping is targeted, not wholesale doubling", () => {
	// escapeCellText/unescapeCellText must only touch backslashes that sit
	// directly in front of a `|` or `<br>`. Anything else (LaTeX, Windows
	// paths, arbitrary backslash pairs) must appear in the table exactly as
	// typed and round-trip byte-identically, matching 1.0.0 output for
	// content with no backslash-before-pipe/br.

	it("LaTeX-style content with backslashes round-trips untouched", () => {
		const doc = "# T\n\n## R\n\n### C\n\n$\\frac{a}{b}$\n";
		const r = okOut(doc);
		assert.equal(
			r.output,
			"| T | C |\n| --- | --- |\n| R | $\\frac{a}{b}$ |\n",
		);
		const back = okOut(r.output);
		assert.equal(back.output, doc);
	});

	it("a Windows path in a code span round-trips untouched", () => {
		const doc = "# T\n\n## R\n\n### C\n\n`C:\\Users\\x`\n";
		const r = okOut(doc);
		assert.equal(
			r.output,
			"| T | C |\n| --- | --- |\n| R | `C:\\Users\\x` |\n",
		);
		const back = okOut(r.output);
		assert.equal(back.output, doc);
	});

	it("a backslash pair not near a pipe survives unchanged, un-doubled", () => {
		const doc = "# T\n\n## R\n\n### C\n\na\\\\b\n";
		const r = okOut(doc);
		assert.equal(r.output, "| T | C |\n| --- | --- |\n| R | a\\\\b |\n");
		const back = okOut(r.output);
		assert.equal(back.output, doc);
	});

	it("a table with a 1.0.0-style literal backslash pair decodes unchanged", () => {
		// As 1.0.0 would have written a literal `a\\b` (no pipe adjacency):
		// two backslashes, untouched by escaping, must decode as two
		// backslashes, not collapse to one.
		const t = "| T | C |\n| --- | --- |\n| R | a\\\\b |\n";
		const r = okOut(t);
		assert.equal(r.direction, "table-to-document");
		assert.equal(r.output, "# T\n\n## R\n\n### C\n\na\\\\b\n");
	});
});

describe("item 4: getOutputPaths", () => {
	it("derives backup/error paths and display names from a source path", () => {
		const p = getOutputPaths("Folder/Note.md");
		assert.equal(p.backupPath, "Folder/Note.md.BAK");
		assert.equal(p.backupName, "Note.md.BAK");
		assert.equal(p.errorPath, "Folder/Note.errors.md");
		assert.equal(p.errorName, "Note.errors.md");
	});
	it("matches the standalone helpers for a root-level path", () => {
		const p = getOutputPaths("Note.md");
		assert.equal(p.backupPath, getBackupPath("Note.md"));
		assert.equal(p.errorPath, getErrorNotePath("Note.md"));
		assert.equal(p.backupName, "Note.md.BAK");
		assert.equal(p.errorName, "Note.errors.md");
	});
	it("handles a source path without a .md extension", () => {
		const p = getOutputPaths("Folder/Note");
		assert.equal(p.backupPath, "Folder/Note.BAK");
		assert.equal(p.backupName, "Note.BAK");
		assert.equal(p.errorPath, "Folder/Note.errors.md");
		assert.equal(p.errorName, "Note.errors.md");
	});
});

describe("selection support: convertNote on a fragment", () => {
	// convertNote takes raw text, not a whole-note object, so a selection
	// containing exactly one document block or one table (with no front
	// matter) should convert the same way the whole note would.

	it("converts a document fragment with leading/trailing blank lines", () => {
		const r = okOut(`\n\n${DOC1}\n\n`);
		assert.equal(r.direction, "document-to-table");
		assert.equal(r.output, TABLE1);
	});

	it("converts a table fragment with leading/trailing blank lines", () => {
		const r = okOut(`\n\n${TABLE1.trimEnd()}\n\n`);
		assert.equal(r.direction, "table-to-document");
		assert.equal(r.output, DOC1);
	});

	it("converts a document fragment with no trailing newline", () => {
		const r = okOut(DOC1.replace(/\n+$/, ""));
		assert.equal(r.direction, "document-to-table");
		assert.equal(r.output, TABLE1);
	});

	it("converts a table fragment with no trailing newline", () => {
		const r = okOut(TABLE1.replace(/\n+$/, ""));
		assert.equal(r.direction, "table-to-document");
		assert.equal(r.output, DOC1);
	});

	// By default convertNote treats a leading `---` line as the start of
	// YAML front matter (see splitFrontMatter), which is correct for a
	// whole note but wrong for a selection/fragment that isn't anchored at
	// the top of the note. `{ frontMatter: false }` opts out of that.
	it("with frontMatter: false, a leading '---' line is content, not front matter", () => {
		const fm = "---\ntitle: Hi\n---\n";
		const withFm = fm + DOC1;

		// Default behavior (frontMatter: true): the leading block is parsed
		// and preserved as front matter, and conversion succeeds.
		const asWholeNote = convertNote(withFm);
		assert.equal(asWholeNote.ok, true);
		assert.ok(asWholeNote.output.startsWith(fm));

		// Same text as a selection fragment (frontMatter: false): the
		// leading "---" is now content appearing before the "#" title,
		// which is a real validation error per the document rules.
		const asSelection = convertNote(withFm, { frontMatter: false });
		assert.equal(asSelection.ok, false);
		assert.ok(
			asSelection.errors.some((e) => /before table title/i.test(e.message)),
		);
	});

	it("frontMatter option defaults to true (existing calls are unaffected)", () => {
		const r = convertNote(DOC1);
		assert.equal(r.ok, true);
		assert.equal(r.output, TABLE1);
	});
});
