import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	convertNote,
	getBackupPath,
	getErrorNotePath,
	formatErrorsAsNote,
} from "./converter.bundled.mjs";

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
