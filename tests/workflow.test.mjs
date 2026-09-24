import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	convertFile,
	convertSelection,
	transposeFile,
} from "../node_modules/.cache/table-converter-tests/workflow.bundled.mjs";

// Minimal stand-in for a TFile: workflow.ts only reads .path/.name/.basename.
function makeFile(path) {
	const name = path.split("/").pop();
	const dot = name.lastIndexOf(".");
	const basename = dot === -1 ? name : name.slice(0, dot);
	return { path, name, basename };
}

// In-memory fake of the VaultAdapter interface, with knobs to simulate
// specific failures and races.
class FakeAdapter {
	constructor(initialFiles = {}) {
		this.files = new Map(Object.entries(initialFiles));
		this.folders = new Set();
		this.failWritePaths = new Set();
		this.failProcess = false;
		this.failEnsureFolder = false;
		// When set, `process` reads this value instead of the file's current
		// content, simulating a change that happened between validation/backup
		// and the atomic write.
		this.raceValue = null;
	}

	async read(file) {
		if (!this.files.has(file.path)) throw new Error(`not found: ${file.path}`);
		return this.files.get(file.path);
	}

	async process(file, fn) {
		if (this.failProcess) throw new Error("process failed");
		const current = this.raceValue !== null ? this.raceValue : this.files.get(file.path);
		const next = fn(current);
		this.files.set(file.path, next);
		return next;
	}

	async exists(path) {
		return this.files.has(path);
	}

	async writeOrOverwrite(path, content) {
		if (this.failWritePaths.has(path)) throw new Error(`write failed: ${path}`);
		this.files.set(path, content);
	}

	async delete(path) {
		this.files.delete(path);
	}

	async ensureFolder(path) {
		if (this.failEnsureFolder) throw new Error("ensureFolder failed");
		this.folders.add(path);
	}
}

class FakeReporter {
	constructor() {
		this.notices = [];
		this.modals = [];
	}

	notice(message) {
		this.notices.push(message);
	}

	showErrors(file, errors) {
		this.modals.push({ file, errors });
	}
}

const DOC = "# T\n\n## R\n\n### C\n\ntext\n";
const TABLE = "| T | C |\n| --- | --- |\n| R | text |\n";
const INVALID = "not a document or a table\n";

const baseSettings = {
	backupMode: "same-folder",
	backupFolder: "Table Converter backups",
	errorOutput: "note",
};

describe("convertFile success", () => {
	it("writes the backup, then converts the note (same-folder mode)", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, baseSettings);

		assert.equal(adapter.files.get("Note.md"), TABLE);
		assert.equal(adapter.files.get("Note.BAK.md"), DOC);
		assert.ok(reporter.notices.some((n) => /document → table/.test(n)));
	});

	it("round-trips document -> table -> document", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, baseSettings);
		assert.equal(adapter.files.get("Note.md"), TABLE);

		await convertFile(adapter, reporter, file, baseSettings);
		assert.equal(adapter.files.get("Note.md"), DOC);
	});
});

describe("convertFile backup failure", () => {
	it("leaves the source unchanged and reports the failure", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		adapter.failWritePaths.add("Note.BAK.md");
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, baseSettings);

		assert.equal(adapter.files.get("Note.md"), DOC);
		assert.ok(adapter.files.has("Note.errors.md"));
		assert.ok(reporter.notices.some((n) => /failed/i.test(n)));
	});
});

describe("convertFile source write failure", () => {
	it("reports the failure; backup was already written", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		adapter.failProcess = true;
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, baseSettings);

		assert.equal(adapter.files.get("Note.md"), DOC);
		assert.equal(adapter.files.get("Note.BAK.md"), DOC);
		assert.ok(adapter.files.has("Note.errors.md"));
	});
});

describe("stale error note deletion on success", () => {
	it("deletes it in 'note' errorOutput mode", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC, "Note.errors.md": "stale" });
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, { ...baseSettings, errorOutput: "note" });

		assert.equal(adapter.files.has("Note.errors.md"), false);
	});

	it("deletes it in 'modal' errorOutput mode too", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC, "Note.errors.md": "stale" });
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, { ...baseSettings, errorOutput: "modal" });

		assert.equal(adapter.files.has("Note.errors.md"), false);
	});
});

describe("errorOutput modal", () => {
	it("shows the errors and writes no file", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": INVALID });
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, { ...baseSettings, errorOutput: "modal" });

		assert.equal(adapter.files.has("Note.errors.md"), false);
		assert.equal(reporter.modals.length, 1);
		assert.ok(reporter.modals[0].errors.length > 0);
	});
});

describe("backupMode variants", () => {
	it("'off' skips the backup entirely", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, { ...baseSettings, backupMode: "off" });

		assert.equal(adapter.files.has("Note.BAK.md"), false);
		assert.ok(reporter.notices.some((n) => /no backup \(disabled\)/.test(n)));
	});

	it("'folder' creates the backup folder and writes the backup there", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, {
			...baseSettings,
			backupMode: "folder",
			backupFolder: "Backups",
		});

		assert.ok(adapter.folders.has("Backups"));
		assert.equal(adapter.files.get("Backups/Note.BAK.md"), DOC);
	});

	it("mirrors a nested note's folder under the backup folder", async () => {
		const file = makeFile("Projects/Sub/Notes.md");
		const adapter = new FakeAdapter({ "Projects/Sub/Notes.md": DOC });
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, {
			...baseSettings,
			backupMode: "folder",
			backupFolder: "Backups",
		});

		assert.ok(adapter.folders.has("Backups/Projects/Sub"));
		assert.equal(adapter.files.get("Backups/Projects/Sub/Notes.BAK.md"), DOC);
	});

	it("does not collide when two notes share a name in different folders", async () => {
		const fileA = makeFile("Projects/Notes.md");
		const fileB = makeFile("Archive/Notes.md");
		const adapter = new FakeAdapter({
			"Projects/Notes.md": DOC,
			"Archive/Notes.md": DOC,
		});
		const reporter = new FakeReporter();
		const settings = { ...baseSettings, backupMode: "folder", backupFolder: "Backups" };

		await convertFile(adapter, reporter, fileA, settings);
		await convertFile(adapter, reporter, fileB, settings);

		assert.equal(adapter.files.get("Backups/Projects/Notes.BAK.md"), DOC);
		assert.equal(adapter.files.get("Backups/Archive/Notes.BAK.md"), DOC);
		// Both backups survive; neither overwrote the other.
		assert.equal(adapter.files.get("Projects/Notes.md"), TABLE);
		assert.equal(adapter.files.get("Archive/Notes.md"), TABLE);
	});
});

describe("race between validation and the atomic write", () => {
	it("aborts unchanged and reports, when the note changed underneath", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		adapter.raceValue = "someone typed this in the meantime\n";
		const reporter = new FakeReporter();

		await convertFile(adapter, reporter, file, baseSettings);

		assert.equal(adapter.files.get("Note.md"), "someone typed this in the meantime\n");
		assert.ok(reporter.notices.some((n) => /failed/i.test(n)));
		const errNote = adapter.files.get("Note.errors.md");
		assert.ok(/changed during conversion/i.test(errNote));
	});
});

describe("T30 transposeFile shares convertFile's workflow rules", () => {
	const TRANSPOSED_DOC = "# T\n\n## C\n\n### R\n\ntext\n";

	it("writes the backup, then transposes the note", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		const reporter = new FakeReporter();

		await transposeFile(adapter, reporter, file, baseSettings);

		assert.equal(adapter.files.get("Note.md"), TRANSPOSED_DOC);
		assert.equal(adapter.files.get("Note.BAK.md"), DOC);
		assert.ok(reporter.notices.some((n) => /transposed rows ↔ columns \(document\)/.test(n)));
	});

	it("round-trips via two transposes back to the original", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		const reporter = new FakeReporter();

		await transposeFile(adapter, reporter, file, baseSettings);
		assert.equal(adapter.files.get("Note.md"), TRANSPOSED_DOC);

		await transposeFile(adapter, reporter, file, baseSettings);
		assert.equal(adapter.files.get("Note.md"), DOC);
	});

	it("backup failure leaves the source unchanged and reports the failure", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		adapter.failWritePaths.add("Note.BAK.md");
		const reporter = new FakeReporter();

		await transposeFile(adapter, reporter, file, baseSettings);

		assert.equal(adapter.files.get("Note.md"), DOC);
		assert.ok(adapter.files.has("Note.errors.md"));
		assert.ok(reporter.notices.some((n) => /failed/i.test(n)));
	});

	it("validation failure: source unchanged, error note written (note mode)", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": INVALID });
		const reporter = new FakeReporter();

		await transposeFile(adapter, reporter, file, { ...baseSettings, errorOutput: "note" });

		assert.equal(adapter.files.get("Note.md"), INVALID);
		assert.ok(adapter.files.has("Note.errors.md"));
		assert.equal(adapter.files.has("Note.BAK.md"), false);
	});

	it("validation failure (header conflict): source unchanged, no file written (modal mode)", async () => {
		const file = makeFile("Note.md");
		const conflictDoc = "# Alpha\n\n## Alpha\n\n### C\n\nx\n";
		const adapter = new FakeAdapter({ "Note.md": conflictDoc });
		const reporter = new FakeReporter();

		await transposeFile(adapter, reporter, file, { ...baseSettings, errorOutput: "modal" });

		assert.equal(adapter.files.get("Note.md"), conflictDoc);
		assert.equal(adapter.files.has("Note.errors.md"), false);
		assert.equal(reporter.modals.length, 1);
		assert.ok(reporter.modals[0].errors.length > 0);
	});

	it("validation failure (header conflict), note mode: writes the error note, source unchanged", async () => {
		const file = makeFile("Note.md");
		const conflictDoc = "# Alpha\n\n## Alpha\n\n### C\n\nx\n";
		const adapter = new FakeAdapter({ "Note.md": conflictDoc });
		const reporter = new FakeReporter();

		await transposeFile(adapter, reporter, file, { ...baseSettings, errorOutput: "note" });

		assert.equal(adapter.files.get("Note.md"), conflictDoc);
		assert.ok(adapter.files.has("Note.errors.md"));
		assert.ok(reporter.notices.some((n) => /failed/i.test(n)));
	});

	it("deletes a stale error note on success", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC, "Note.errors.md": "stale" });
		const reporter = new FakeReporter();

		await transposeFile(adapter, reporter, file, baseSettings);

		assert.equal(adapter.files.has("Note.errors.md"), false);
	});

	it("aborts unchanged and reports when the note changed underneath (race)", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": DOC });
		adapter.raceValue = "someone typed this in the meantime\n";
		const reporter = new FakeReporter();

		await transposeFile(adapter, reporter, file, baseSettings);

		assert.equal(adapter.files.get("Note.md"), "someone typed this in the meantime\n");
		assert.ok(reporter.notices.some((n) => /failed/i.test(n)));
		const errNote = adapter.files.get("Note.errors.md");
		assert.ok(/changed during transpose/i.test(errNote));
	});
});

describe("convertSelection", () => {
	it("converts the selection and writes no backup", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": `prefix\n\n${DOC}` });
		const reporter = new FakeReporter();

		const result = await convertSelection(adapter, reporter, file, DOC, 3, baseSettings);

		assert.equal(result.ok, true);
		assert.equal(result.output, TABLE);
		assert.equal(adapter.files.has("Note.BAK.md"), false);
		assert.ok(reporter.notices.some((n) => /Ctrl\/Cmd\+Z/.test(n)));
	});

	it("reports failures with line numbers relative to the note", async () => {
		const file = makeFile("Note.md");
		const adapter = new FakeAdapter({ "Note.md": `prefix\n\n${INVALID}` });
		const reporter = new FakeReporter();

		// The selection starts on note line 3, so its own line 1 is note line 3.
		const result = await convertSelection(adapter, reporter, file, INVALID, 3, {
			...baseSettings,
			errorOutput: "note",
		});

		assert.equal(result.ok, false);
		const errNote = adapter.files.get("Note.errors.md");
		assert.ok(errNote);
		assert.ok(/Line 3/.test(errNote));
	});
});
