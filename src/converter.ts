// Document ↔ Markdown Table Transformation (V1)
// Pure, browser-compatible logic (macOS + iOS). No Node/Electron APIs.

export interface ValidationError {
	line: number;
	message: string;
}

export type Direction = "document-to-table" | "table-to-document";

export type ConvertResult =
	| { ok: true; direction: Direction; output: string }
	| { ok: false; errors: ValidationError[] };

interface DocHeading {
	level: number;
	title: string;
	trimmed: string;
	bodyIndex: number;
	origLine: number;
}

interface DocColumn {
	h3: DocHeading;
	contentLines: string[];
}

interface DocRow {
	h2: DocHeading;
	cols: DocColumn[];
}

interface ParsedDocument {
	title: DocHeading;
	rows: DocRow[];
	columns: string[];
}

interface ParsedTable {
	// Decoded (unescaped) header cells, including the table title at [0].
	headers: string[];
	// Raw (still table-escaped) body cells, trimmed; row title is at [0] of
	// each row. Decoding happens when rendering to document text, since the
	// row-title and per-column decoding rules differ slightly.
	bodyRows: string[][];
}

// ---------------------------------------------------------------------------
// Filename helpers (pure, testable)
// ---------------------------------------------------------------------------

export function getBackupPath(sourcePath: string): string {
	return `${sourcePath}.BAK`;
}

export function getErrorNotePath(sourcePath: string): string {
	if (sourcePath.toLowerCase().endsWith(".md")) {
		return `${sourcePath.slice(0, -3)}.errors.md`;
	}
	return `${sourcePath}.errors.md`;
}

function basenameOf(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1] ?? path;
}

export interface OutputPaths {
	backupPath: string;
	backupName: string;
	errorPath: string;
	errorName: string;
}

// Single source of truth for the backup and error-note paths (and their
// display names) derived from a source note path.
export function getOutputPaths(sourcePath: string): OutputPaths {
	const backupPath = getBackupPath(sourcePath);
	const errorPath = getErrorNotePath(sourcePath);
	return {
		backupPath,
		backupName: basenameOf(backupPath),
		errorPath,
		errorName: basenameOf(errorPath),
	};
}

export function formatErrorsAsNote(
	sourcePath: string,
	errors: ValidationError[],
): string {
	const name = basenameOf(sourcePath);
	const lines: string[] = [];
	lines.push(`# Conversion errors for \`${name}\``);
	lines.push("");
	lines.push("Conversion did not occur.");
	lines.push("");
	if (errors.length === 0) {
		lines.push("An unknown error prevented conversion.");
		lines.push("");
	} else {
		lines.push("Errors:");
		lines.push("");
		const sorted = [...errors].sort((a, b) => a.line - b.line);
		for (const e of sorted) {
			lines.push(`- Line ${e.line}: ${e.message}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

function isFrontMatterDelim(line: string): boolean {
	return /^---\s*$/.test(line);
}

function isFrontMatterClose(line: string): boolean {
	return /^---\s*$/.test(line) || /^\.\.\.\s*$/.test(line);
}

function splitFrontMatter(allLines: string[]): {
	frontMatterLines: string[];
	bodyLines: string[];
	frontMatterCount: number;
} {
	if (allLines.length > 0 && isFrontMatterDelim(allLines[0] ?? "")) {
		for (let i = 1; i < allLines.length; i++) {
			if (isFrontMatterClose(allLines[i] ?? "")) {
				return {
					frontMatterLines: allLines.slice(0, i + 1),
					bodyLines: allLines.slice(i + 1),
					frontMatterCount: i + 1,
				};
			}
		}
	}
	return { frontMatterLines: [], bodyLines: allLines, frontMatterCount: 0 };
}

// ---------------------------------------------------------------------------
// Fences
// ---------------------------------------------------------------------------

interface Fence {
	char: "`" | "~";
	len: number;
}

function parseFenceOpening(line: string): Fence | null {
	const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
	if (!m) return null;
	const fence = m[2] ?? "";
	const char = fence[0] === "`" ? ("`" as const) : ("~" as const);
	// For ``` fences, info string must not contain backtick; keep simple: accept.
	return { char, len: fence.length };
}

function isFenceClosing(line: string, open: Fence): boolean {
	const m = /^(\s*)(`{3,}|~{3,})(\s*)$/.exec(line);
	if (!m) return false;
	const fence = m[2] ?? "";
	if ((fence[0] === "`") !== (open.char === "`")) return false;
	return fence.length >= open.len;
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

function parseHeading(line: string): { level: number; title: string } | null {
	const m = /^(#{1,6})(?:[ \t]+(.*))?[ \t]*$/.exec(line);
	if (!m) return null;
	const hashes = m[1] ?? "";
	// If hashes are followed directly by non-space content, regex above fails
	// except for empty title, which is what we want (#tag is not a heading).
	const title = (m[2] ?? "").trim();
	return { level: hashes.length, title };
}

// ---------------------------------------------------------------------------
// Backslash-escaping: shared rule for titles and cell content
// ---------------------------------------------------------------------------
//
// Only a `|` or a literal `<br>` tag needs escaping for table syntax, and
// only the backslashes immediately in front of one matter to that escaping:
// a run of `n` backslashes directly before a `|`/`<br>` is escaped iff `n`
// is odd (the leftover, unpaired backslash is the escape marker; the rest
// pair off as `floor(n/2)` literal backslashes). Backslashes anywhere else
// (e.g. `C:\Users`, `\frac{a}{b}`) are ordinary content and are never
// touched, so common Markdown/LaTeX/path content round-trips byte-for-byte.
// `escapeCellText` writes output consistent with that rule; `unescapeCellText`
// and `isEscapedAt`/`splitTableRow` read it back.

const BR_TAG_ANCHORED = /^<\s*br\s*\/?\s*>/i;

// Number of consecutive `\` characters immediately before index `idx`.
function countBackslashesBefore(s: string, idx: number): number {
	let n = 0;
	let j = idx - 1;
	while (j >= 0 && s[j] === "\\") {
		n++;
		j--;
	}
	return n;
}

function isEscapedAt(s: string, idx: number): boolean {
	return countBackslashesBefore(s, idx) % 2 === 1;
}

// Escapes `|` and literal `<br>` tags for table syntax. A run of backslashes
// is only doubled when it sits directly in front of one of those two things
// (so the reader can tell those backslashes apart from the escape marker
// that follows); backslashes anywhere else pass through unchanged.
function escapeCellText(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; ) {
		const c = text[i];
		if (c === "\\") {
			let j = i;
			while (j < text.length && text[j] === "\\") j++;
			const runLen = j - i;
			const rest = text.slice(j);
			const br = BR_TAG_ANCHORED.exec(rest);
			if (rest[0] === "|") {
				out += "\\".repeat(runLen * 2) + "\\|";
				i = j + 1;
				continue;
			}
			if (br) {
				out += "\\".repeat(runLen * 2) + "\\" + br[0];
				i = j + br[0].length;
				continue;
			}
			// Not immediately before | or <br>: emit the run unchanged.
			out += text.slice(i, j);
			i = j;
			continue;
		}
		const br = BR_TAG_ANCHORED.exec(text.slice(i));
		if (br) {
			out += "\\" + br[0];
			i += br[0].length;
			continue;
		}
		if (c === "|") {
			out += "\\|";
			i += 1;
			continue;
		}
		out += c;
		i += 1;
	}
	return out;
}

// Inverse of escapeCellText. Only resolves a backslash run that sits
// directly before a `|` or `<br>` tag (per the parity rule above); any other
// backslash run is left exactly as written.
function unescapeCellText(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; ) {
		if (text[i] === "\\") {
			let j = i;
			while (j < text.length && text[j] === "\\") j++;
			const runLen = j - i;
			const rest = text.slice(j);
			const br = BR_TAG_ANCHORED.exec(rest);
			const isPipe = rest[0] === "|";
			if (isPipe || br) {
				out += "\\".repeat(Math.floor(runLen / 2));
				if (runLen % 2 === 1) {
					// Odd: the leftover backslash escapes this tag/pipe.
					if (isPipe) {
						out += "|";
						i = j + 1;
					} else if (br) {
						out += br[0];
						i = j + br[0].length;
					}
				} else {
					// Even: no escape marker here; leave the tag/pipe itself
					// for normal handling (it is a real separator/break).
					i = j;
				}
				continue;
			}
			// Not before | or <br>: emit the run unchanged.
			out += text.slice(i, j);
			i = j;
			continue;
		}
		out += text[i];
		i += 1;
	}
	return out;
}

function escapeTitleForTable(title: string): string {
	return escapeCellText(title.trim());
}

function unescapeTitle(raw: string): string {
	return unescapeCellText(raw).trim();
}

// ---------------------------------------------------------------------------
// Table row splitting
// ---------------------------------------------------------------------------

// A cell closed at a real (unescaped, even-count) delimiter pipe may still
// end in a run of literal backslashes directly against that pipe (e.g. a
// hand-written or foreign table). Per the parity rule, an even run there
// decodes as half as many literal backslashes; splitTableRow itself is the
// only place that still has the pipe's context to apply that halving.
function halveTrailingBackslashes(s: string): string {
	const m = /\\+$/.exec(s);
	if (!m) return s;
	return s.slice(0, m.index) + "\\".repeat(Math.floor(m[0].length / 2));
}

function splitTableRow(line: string): string[] | null {
	if (line.indexOf("|") === -1) return null;
	const parts: string[] = [];
	let cur = "";
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === "|" && !isEscapedAt(line, i)) {
			parts.push(halveTrailingBackslashes(cur));
			cur = "";
		} else {
			cur += c;
		}
	}
	parts.push(cur);

	const trimmed = line.trim();
	// Drop leading empty part when line starts with | (outer pipe).
	if (trimmed.startsWith("|")) {
		parts.shift();
	}
	// Drop trailing empty part when line ends with an unescaped |.
	if (
		trimmed.endsWith("|") &&
		!isEscapedAt(trimmed, trimmed.length - 1)
	) {
		parts.pop();
	}
	return parts;
}

function isDelimiterCell(cell: string): boolean {
	return /^:?-{1,}:?$/.test(cell.trim());
}

function isDelimiterRow(cells: string[]): boolean {
	if (cells.length === 0) return false;
	return cells.every(isDelimiterCell);
}

// ---------------------------------------------------------------------------
// Table detection
// ---------------------------------------------------------------------------

function stripBlankEdges(
	lines: string[],
): { lines: string[]; start: number } {
	let s = 0;
	let e = lines.length - 1;
	while (s <= e && (lines[s] ?? "").trim() === "") s++;
	while (e >= s && (lines[e] ?? "").trim() === "") e--;
	if (s > e) return { lines: [], start: s };
	return { lines: lines.slice(s, e + 1), start: s };
}

export function isEntirelyTable(bodyLines: string[]): boolean {
	const { lines } = stripBlankEdges(bodyLines);
	if (lines.length < 3) return false;
	// Fenced code present means not a pure table.
	for (const l of lines) {
		if (/^\s*(`{3,}|~{3,})/.test(l)) return false;
		if ((l.trim() === "")) return false;
		if (l.indexOf("|") === -1) return false;
		const cells = splitTableRow(l);
		if (!cells) return false;
	}
	const delimCells = splitTableRow(lines[1] ?? "");
	if (!delimCells || !isDelimiterRow(delimCells)) return false;
	return true;
}

function containsDocHeadings(bodyLines: string[]): boolean {
	let fence: Fence | null = null;
	for (const line of bodyLines) {
		if (fence) {
			if (isFenceClosing(line, fence)) fence = null;
			continue;
		}
		const open = parseFenceOpening(line);
		if (open) {
			// Fence marker itself is not a heading.
			fence = open;
			continue;
		}
		const h = parseHeading(line);
		if (h && (h.level === 1 || h.level === 2)) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Table validation + parsing
// ---------------------------------------------------------------------------

function parseAndValidateTable(
	bodyLines: string[],
	lineOffset: number,
): { parsed: ParsedTable | null; errors: ValidationError[] } {
	const errors: ValidationError[] = [];
	const { lines, start } = stripBlankEdges(bodyLines);
	if (lines.length < 3) {
		errors.push({
			line: lineOffset + start + 1,
			message: "Table must have a header row, delimiter row, and at least one body row.",
		});
		return { parsed: null, errors };
	}
	const idxToOrig = (i: number) => lineOffset + start + i + 1;

	const splitRows: string[][] = [];
	for (let i = 0; i < lines.length; i++) {
		const cells = splitTableRow(lines[i] ?? "");
		if (!cells) {
			errors.push({
				line: idxToOrig(i),
				message: `Table row is not valid table syntax. Line ${idxToOrig(i)}.`,
			});
			continue;
		}
		splitRows.push(cells.map((c) => c.trim()));
	}
	if (errors.length > 0) return { parsed: null, errors };

	const headerRaw = splitRows[0] ?? [];
	const delimRaw = splitRows[1] ?? [];
	const headerLine = idxToOrig(0);
	const delimiterLine = idxToOrig(1);

	if (!isDelimiterRow(delimRaw)) {
		errors.push({
			line: delimiterLine,
			message: `Second table row must be a delimiter row (e.g. "| --- |"). Line ${delimiterLine}.`,
		});
		return { parsed: null, errors };
	}

	const colCount = headerRaw.length;
	if (colCount === 0) {
		errors.push({
			line: headerLine,
			message: `Table header must have at least one column. Line ${headerLine}.`,
		});
		return { parsed: null, errors };
	}

	// Raw (still table-escaped) body cells, trimmed; decoding happens when
	// rendering to document text.
	const bodyRows = splitRows.slice(2);
	const bodyLinesNo: number[] = [];
	for (let i = 0; i < bodyRows.length; i++) bodyLinesNo.push(idxToOrig(i + 2));

	// Column count.
	for (let i = 0; i < bodyRows.length; i++) {
		const row = bodyRows[i] ?? [];
		if (row.length !== colCount) {
			errors.push({
				line: bodyLinesNo[i] ?? headerLine,
				message: `Table row has ${row.length} cells but header has ${colCount}. Line ${bodyLinesNo[i]}.`,
			});
		}
	}

	// Headers non-empty + unique (after unescape + trim, case-sensitive).
	const headers = headerRaw.map(unescapeTitle);
	headers.forEach((h, j) => {
		if (h === "") {
			errors.push({
				line: headerLine,
				message: `Table header ${j + 1} is empty. Line ${headerLine}.`,
			});
		}
	});
	const seenH = new Map<string, number>();
	headers.forEach((h, j) => {
		if (h === "") return;
		if (seenH.has(h)) {
			errors.push({
				line: headerLine,
				message: `Duplicate table header "${h}" (first at column ${(seenH.get(h) ?? 0) + 1}). Line ${headerLine}.`,
			});
		} else {
			seenH.set(h, j);
		}
	});

	// Row titles non-empty + unique.
	const rowTitles = bodyRows.map((r) => unescapeTitle(r[0] ?? ""));
	rowTitles.forEach((t, i) => {
		if (t === "") {
			errors.push({
				line: bodyLinesNo[i] ?? headerLine,
				message: `First-column cell (row title) is empty in body row ${i + 1}. Line ${bodyLinesNo[i]}.`,
			});
		}
	});
	const seenR = new Map<string, number>();
	rowTitles.forEach((t, i) => {
		if (t === "") return;
		if (seenR.has(t)) {
			errors.push({
				line: bodyLinesNo[i] ?? headerLine,
				message: `Duplicate row title "${t}" (first at body row ${(seenR.get(t) ?? 0) + 1}, line ${bodyLinesNo[seenR.get(t) ?? 0]}). Line ${bodyLinesNo[i]}.`,
			});
		} else {
			seenR.set(t, i);
		}
	});

	if (bodyRows.length === 0) {
		errors.push({
			line: delimiterLine,
			message: `Table must have at least one body row. Line ${delimiterLine}.`,
		});
		return { parsed: null, errors };
	}

	if (errors.length > 0) return { parsed: null, errors };

	return {
		parsed: { headers, bodyRows },
		errors,
	};
}

// ---------------------------------------------------------------------------
// Document validation + parsing
// ---------------------------------------------------------------------------

function detectNestedTable(
	contentLines: string[],
	contentStartOrigLine: number,
): { found: boolean; line: number } {
	const n = contentLines.length;
	const origOf = (i: number) => contentStartOrigLine + i;
	// Single pass: record fence state per line to check consecutive pairs.
	const inFence: boolean[] = [];
	let fence: Fence | null = null;
	for (let i = 0; i < n; i++) {
		const line = contentLines[i] ?? "";
		if (fence) {
			inFence.push(true);
			if (isFenceClosing(line, fence)) fence = null;
			continue;
		}
		const open = parseFenceOpening(line);
		if (open) {
			inFence.push(true);
			fence = open;
			continue;
		}
		inFence.push(false);
	}
	for (let i = 0; i + 1 < n; i++) {
		if (inFence[i] || inFence[i + 1]) continue;
		const a = (contentLines[i] ?? "").trim();
		const b = (contentLines[i + 1] ?? "").trim();
		if (a === "" || b === "") continue;
		if (a.indexOf("|") === -1 || b.indexOf("|") === -1) continue;
		const ca = splitTableRow(contentLines[i] ?? "");
		const cb = splitTableRow(contentLines[i + 1] ?? "");
		if (!ca || !cb) continue;
		if (ca.length !== cb.length) continue;
		if (!isDelimiterRow(cb)) continue;
		return { found: true, line: origOf(i + 1) };
	}
	return { found: false, line: 0 };
}

function parseAndValidateDocument(
	bodyLines: string[],
	lineOffset: number,
): { parsed: ParsedDocument | null; errors: ValidationError[] } {
	const errors: ValidationError[] = [];
	const origOf = (bodyIdx: number) => lineOffset + bodyIdx + 1;

	let fence: Fence | null = null;
	let state: "BEFORE_H1" | "AFTER_H1" | "IN_ROW_HEADER" | "IN_CELL" =
		"BEFORE_H1";

	const h1s: DocHeading[] = [];
	const allH2: DocHeading[] = [];
	const rows: DocRow[] = [];
	let currentRow: DocRow | null = null;
	let currentCol: DocColumn | null = null;

	const closeCol = () => {
		if (currentRow && currentCol) {
			currentRow.cols.push(currentCol);
			currentCol = null;
		}
	};
	const closeRow = () => {
		if (currentRow) {
			closeCol();
			rows.push(currentRow);
			currentRow = null;
		}
	};

	const contentError = (
		bodyIdx: number,
		kind: "before-h1" | "h1-h2" | "h2-h3",
	) => {
		const line = origOf(bodyIdx);
		if (kind === "before-h1") {
			errors.push({
				line,
				message: `Content before table title ("#"). Content is only allowed beneath "###" headings. Line ${line}.`,
			});
		} else if (kind === "h1-h2") {
			errors.push({
				line,
				message: `Content between "#" and first "##" is not allowed. Content is only allowed beneath "###" headings. Line ${line}.`,
			});
		} else {
			errors.push({
				line,
				message: `Content between "##" and its first "###" is not allowed. Content is only allowed beneath "###" headings. Line ${line}.`,
			});
		}
	};

	const handleContentLine = (bodyIdx: number, line: string) => {
		const isBlank = line.trim() === "";
		if (isBlank) {
			if (state === "IN_CELL" && currentCol) {
				currentCol.contentLines.push(line);
			}
			return;
		}
		if (state === "BEFORE_H1") {
			contentError(bodyIdx, "before-h1");
		} else if (state === "AFTER_H1") {
			contentError(bodyIdx, "h1-h2");
		} else if (state === "IN_ROW_HEADER") {
			contentError(bodyIdx, "h2-h3");
		} else {
			if (currentCol) currentCol.contentLines.push(line);
		}
	};

	for (let i = 0; i < bodyLines.length; i++) {
		const line = bodyLines[i] ?? "";
		// Fence handling first.
		if (fence) {
			if (isFenceClosing(line, fence)) fence = null;
			handleContentLine(i, line);
			continue;
		}
		const open = parseFenceOpening(line);
		if (open) {
			fence = open;
			handleContentLine(i, line);
			continue;
		}
		const h = parseHeading(line);
		if (!h) {
			handleContentLine(i, line);
			continue;
		}
		if (h.level >= 4) {
			handleContentLine(i, line);
			continue;
		}
		const heading: DocHeading = {
			level: h.level,
			title: h.title,
			trimmed: h.title.trim(),
			bodyIndex: i,
			origLine: origOf(i),
		};
		if (h.level === 1) {
			if (heading.trimmed === "") {
				errors.push({
					line: heading.origLine,
					message: `Table title ("#") must be non-empty. Line ${heading.origLine}.`,
				});
			}
			h1s.push(heading);
			if (h1s.length > 1) {
				errors.push({
					line: heading.origLine,
					message: `Multiple "#" headings: exactly one table title is allowed. Line ${heading.origLine}.`,
				});
			}
			if (state !== "BEFORE_H1") {
				// Either duplicate H1 or H1 after rows.
				if (h1s.length === 1) {
					errors.push({
						line: heading.origLine,
						message: `"#" heading must appear before the first "##". Line ${heading.origLine}.`,
					});
				}
			}
			// Close any open row/col at H1 boundary.
			if (currentRow) {
				if (currentRow.cols.length === 0 && currentCol === null) {
					errors.push({
						line: currentRow.h2.origLine,
						message: `Row "${currentRow.h2.trimmed}" ("##") has no "###" columns. Line ${currentRow.h2.origLine}.`,
					});
				}
				closeRow();
			} else if (currentCol) {
				closeCol();
			}
			state = "AFTER_H1";
		} else if (h.level === 2) {
			if (heading.trimmed === "") {
				errors.push({
					line: heading.origLine,
					message: `Row title ("##") must be non-empty. Line ${heading.origLine}.`,
				});
			}
			if (state === "BEFORE_H1") {
				errors.push({
					line: heading.origLine,
					message: `"##" row "${heading.trimmed}" appears before "#" title. Line ${heading.origLine}.`,
				});
			}
			allH2.push(heading);
			// Previous row without columns?
			if (currentRow && state === "IN_ROW_HEADER") {
				errors.push({
					line: currentRow.h2.origLine,
					message: `Row "${currentRow.h2.trimmed}" ("##") has no "###" columns. Line ${currentRow.h2.origLine}.`,
				});
			}
			closeRow();
			currentRow = { h2: heading, cols: [] };
			currentCol = null;
			state = "IN_ROW_HEADER";
		} else {
			// level 3
			if (heading.trimmed === "") {
				errors.push({
					line: heading.origLine,
					message: `Column title ("###") must be non-empty. Line ${heading.origLine}.`,
				});
			}
			if (state === "BEFORE_H1" || state === "AFTER_H1") {
				errors.push({
					line: heading.origLine,
					message: `"###" column "${heading.trimmed}" appears before the first "##". Line ${heading.origLine}.`,
				});
				continue;
			}
			if (!currentRow) {
				errors.push({
					line: heading.origLine,
					message: `"###" column "${heading.trimmed}" appears before the first "##". Line ${heading.origLine}.`,
				});
				continue;
			}
			closeCol();
			currentCol = { h3: heading, contentLines: [] };
			state = "IN_CELL";
		}
	}

	// EOF: finalize.
	if (currentRow) {
		if (state === "IN_ROW_HEADER") {
			errors.push({
				line: currentRow.h2.origLine,
				message: `Row "${currentRow.h2.trimmed}" ("##") has no "###" columns. Line ${currentRow.h2.origLine}.`,
			});
		}
		closeRow();
	} else if (currentCol) {
		closeCol();
	}

	if (h1s.length === 0) {
		errors.push({
			line: lineOffset + 1,
			message: `Document must contain exactly one "#" table title. None found. Line ${lineOffset + 1}.`,
		});
	}
	if (allH2.length === 0) {
		errors.push({
			line: lineOffset + 1,
			message: `Document must contain at least one "##" row. Line ${lineOffset + 1}.`,
		});
	}

	// Duplicate row titles.
	const seenRows = new Map<string, DocHeading>();
	for (const h2 of allH2) {
		if (h2.trimmed === "") continue;
		if (seenRows.has(h2.trimmed)) {
			const first = seenRows.get(h2.trimmed);
			errors.push({
				line: h2.origLine,
				message: `Duplicate "##" row title "${h2.trimmed}" (first at line ${first?.origLine}). Line ${h2.origLine}.`,
			});
		} else {
			seenRows.set(h2.trimmed, h2);
		}
	}

	// Duplicate columns within row + nested tables.
	for (const row of rows) {
		const seen = new Map<string, DocHeading>();
		for (const col of row.cols) {
			if (col.h3.trimmed === "") continue;
			if (seen.has(col.h3.trimmed)) {
				const first = seen.get(col.h3.trimmed);
				errors.push({
					line: col.h3.origLine,
					message: `Duplicate "###" column "${col.h3.trimmed}" in row "${row.h2.trimmed}" (first at line ${first?.origLine}). Line ${col.h3.origLine}.`,
				});
			} else {
				seen.set(col.h3.trimmed, col.h3);
			}
		}
		for (const col of row.cols) {
			if (col.contentLines.length === 0) continue;
			// Compute orig line of first content line: content starts after h3 line,
			// but contentLines may include blanks; find mapping by scanning?
			// We stored raw lines without indices; recompute start as h3.bodyIndex+1.
			const startOrig = lineOffset + col.h3.bodyIndex + 2;
			const nested = detectNestedTable(col.contentLines, startOrig);
			if (nested.found) {
				errors.push({
					line: nested.line,
					message: `Nested Markdown table inside cell (row "${row.h2.trimmed}", column "${col.h3.trimmed}"). Tables inside cells are not allowed. Line ${nested.line}.`,
				});
			}
		}
	}

	if (errors.length > 0) return { parsed: null, errors };

	const title = h1s[0];
	if (!title) return { parsed: null, errors };
	const columns: string[] = [];
	const seenColOrder = new Set<string>();
	for (const row of rows) {
		for (const col of row.cols) {
			if (!seenColOrder.has(col.h3.trimmed)) {
				seenColOrder.add(col.h3.trimmed);
				columns.push(col.h3.trimmed);
			}
		}
	}
	return { parsed: { title, rows, columns }, errors };
}

// ---------------------------------------------------------------------------
// Cell conversions
// ---------------------------------------------------------------------------

// A line whose escaped text ends in a run of backslashes, immediately
// followed by a real (renderer-inserted) `<br>` join marker, needs that
// trailing run doubled first. escapeCellText only doubles a run when it is
// immediately before a `|`/`<br>` *within that same raw line*; it cannot see
// the `<br>` this function is about to append. Without doubling here, an odd
// trailing run (e.g. a line ending in one literal backslash) would look
// identical, to the decoder's backslash-parity check, to an escaped
// "\<br>" and wrongly merge two lines back into one on the next conversion.
function doubleTrailingBackslashes(s: string): string {
	const m = /\\+$/.exec(s);
	if (!m) return s;
	return s.slice(0, m.index) + m[0] + m[0];
}

function docCellLinesToTableCell(rawLines: string[]): string {
	let s = 0;
	let e = rawLines.length - 1;
	while (s <= e && (rawLines[s] ?? "").trim() === "") s++;
	while (e >= s && (rawLines[e] ?? "").trim() === "") e--;
	if (s > e) return "";
	const sliced = rawLines.slice(s, e + 1);
	const escaped: string[] = sliced.map((l) =>
		l.trim() === "" ? "" : escapeCellText(l),
	);
	const paras: string[][] = [];
	let cur: string[] = [];
	for (const l of escaped) {
		if (l === "") {
			if (cur.length > 0) {
				paras.push(cur);
				cur = [];
			}
			continue;
		}
		cur.push(l);
	}
	if (cur.length > 0) paras.push(cur);
	if (paras.length === 0) return "";

	const joined = paras.map((p, pi) => {
		const isLastPara = pi === paras.length - 1;
		const lines = p.map((l, li) => {
			const isLastLineOfPara = li === p.length - 1;
			const followedByBreak = !isLastLineOfPara || !isLastPara;
			return followedByBreak ? doubleTrailingBackslashes(l) : l;
		});
		return lines.join("<br>");
	});
	return joined.join("<br><br>");
}

function tableCellToDocText(cell: string): string {
	const trimmed = cell.trim();
	if (trimmed === "") return "";

	// Phase 1: turn *real* (unescaped) <br> markers into line/paragraph
	// breaks. An escaped "\<br>" (odd preceding backslash run) is left
	// untouched here; it is literal text resolved by unescapeCellText below.
	// A real <br> may still have an even backslash run directly before it
	// (see doubleTrailingBackslashes) — those pair off as literal
	// backslashes and must be halved here, symmetric with the write side.
	let withBreaks = "";
	for (let i = 0; i < trimmed.length; ) {
		const c = trimmed[i];
		if (c === "\\" || BR_TAG_ANCHORED.test(trimmed.slice(i))) {
			let j = i;
			while (j < trimmed.length && trimmed[j] === "\\") j++;
			const runLen = j - i;
			const rest = trimmed.slice(j);
			const m = BR_TAG_ANCHORED.exec(rest);
			if (m) {
				if (runLen % 2 === 0) {
					withBreaks += "\\".repeat(runLen / 2);
					const afterFirst = rest.slice(m[0].length);
					const m2 = BR_TAG_ANCHORED.exec(afterFirst);
					if (m2) {
						withBreaks += "\n\n";
						i = j + m[0].length + m2[0].length;
					} else {
						withBreaks += "\n";
						i = j + m[0].length;
					}
					continue;
				}
				// Odd run: this <br> is escaped. Consume the run and the
				// tag together, untouched, so the tag is never re-examined
				// on its own (which would look like an unescaped <br>);
				// unescapeCellText (phase 2) resolves it below.
				withBreaks += trimmed.slice(i, j + m[0].length);
				i = j + m[0].length;
				continue;
			}
			// Backslash run not before <br> at all (e.g. before `|`, or
			// bare content): leave untouched for phase 2 to resolve.
			withBreaks += trimmed.slice(i, j);
			i = j;
			continue;
		}
		withBreaks += c;
		i += 1;
	}

	// Phase 2: resolve remaining escapes (doubled backslashes, escaped
	// <br> tags, escaped pipes) into literal characters.
	const tmp = unescapeCellText(withBreaks);

	// Trim surrounding blank lines.
	const parts = tmp.split("\n");
	let a = 0;
	let b = parts.length - 1;
	while (a <= b && (parts[a] ?? "").trim() === "") a++;
	while (b >= a && (parts[b] ?? "").trim() === "") b--;
	if (a > b) return "";
	return parts.slice(a, b + 1).join("\n");
}

// ---------------------------------------------------------------------------
// Converters (validated structures -> output body, no front matter)
// ---------------------------------------------------------------------------

function convertDocumentToTableBody(parsed: ParsedDocument): string {
	const titleCell = escapeTitleForTable(parsed.title.trimmed);
	const colCells = parsed.columns.map(escapeTitleForTable);
	const header = `| ${[titleCell, ...colCells].join(" | ")} |`;
	const delim = `| ${["---", ...parsed.columns.map(() => "---")].join(" | ")} |`;
	const bodyRows = parsed.rows.map((row) => {
		const rowTitle = escapeTitleForTable(row.h2.trimmed);
		const byCol = new Map<string, DocColumn>();
		for (const c of row.cols) {
			if (!byCol.has(c.h3.trimmed)) byCol.set(c.h3.trimmed, c);
		}
		const cells = parsed.columns.map((col) => {
			const found = byCol.get(col);
			if (!found) return "";
			return docCellLinesToTableCell(found.contentLines);
		});
		return `| ${[rowTitle, ...cells].join(" | ")} |`;
	});
	return [header, delim, ...bodyRows].join("\n");
}

function convertTableToDocumentBody(parsed: ParsedTable): string {
	const title = parsed.headers[0] ?? "";
	const colHeaders = parsed.headers.slice(1);
	const out: string[] = [];
	out.push(`# ${title}`);
	out.push("");
	parsed.bodyRows.forEach((row) => {
		const rowTitle = unescapeTitle(row[0] ?? "");
		out.push(`## ${rowTitle}`);
		out.push("");
		const cells = row.slice(1);
		colHeaders.forEach((col, ci) => {
			out.push(`### ${col}`);
			out.push("");
			const cellText = tableCellToDocText(cells[ci] ?? "");
			if (cellText !== "") {
				out.push(...cellText.split("\n"));
				out.push("");
			}
		});
	});
	return out.join("\n");
}

function assembleOutput(
	frontMatterLines: string[],
	body: string,
): string {
	const cleanBody = body.replace(/\n+$/, "");
	const withFront =
		frontMatterLines.length > 0
			? `${frontMatterLines.join("\n")}\n${cleanBody}`
			: cleanBody;
	return `${withFront.replace(/\n+$/, "")}\n`;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export interface ConvertNoteOptions {
	// Whether to detect and preserve a leading YAML front-matter block.
	// Defaults to true (whole-note behavior). Pass false when converting a
	// selection/fragment that may not start at the top of the note, so a
	// leading "---" line is treated as ordinary content instead of being
	// mistaken for front matter.
	frontMatter?: boolean;
}

export function convertNote(
	input: string,
	options?: ConvertNoteOptions,
): ConvertResult {
	const useFrontMatter = options?.frontMatter ?? true;
	const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const allLines = normalized.split("\n");
	const { frontMatterLines, bodyLines, frontMatterCount } = useFrontMatter
		? splitFrontMatter(allLines)
		: { frontMatterLines: [] as string[], bodyLines: allLines, frontMatterCount: 0 };

	if (bodyLines.join("\n").trim() === "") {
		return {
			ok: false,
			errors: [
				{
					line: frontMatterCount + 1,
					message: `Empty note: no content after front matter. Provide a document ("#" → "##" → "###") or a single Markdown table. Line ${frontMatterCount + 1}.`,
				},
			],
		};
	}

	if (isEntirelyTable(bodyLines)) {
		const { parsed, errors } = parseAndValidateTable(
			bodyLines,
			frontMatterCount,
		);
		if (!parsed) return { ok: false, errors };
		const body = convertTableToDocumentBody(parsed);
		return {
			ok: true,
			direction: "table-to-document",
			output: assembleOutput(frontMatterLines, body),
		};
	}

	if (containsDocHeadings(bodyLines)) {
		const { parsed, errors } = parseAndValidateDocument(
			bodyLines,
			frontMatterCount,
		);
		if (!parsed) return { ok: false, errors };
		const body = convertDocumentToTableBody(parsed);
		return {
			ok: true,
			direction: "document-to-table",
			output: assembleOutput(frontMatterLines, body),
		};
	}

	return {
		ok: false,
		errors: [
			{
				line: frontMatterCount + 1,
				message: `Input matches neither a valid document ("#" → "##" → "###") nor a single valid Markdown table. Line ${frontMatterCount + 1}.`,
			},
		],
	};
}
