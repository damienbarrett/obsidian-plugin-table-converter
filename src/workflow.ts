// Conversion workflow: reads a note, converts it, backs it up, and writes
// the result back. Depends only on a small VaultAdapter/Reporter interface
// rather than the Obsidian API directly, so it can run against a fake vault
// in tests. `main.ts` supplies the real, Obsidian-backed implementation.
//
// Only `import type` is used from "obsidian" (erased at compile time), so
// this module has no runtime dependency on Obsidian and bundles cleanly for
// Node-based tests.
import type { TFile } from "obsidian";
import {
	convertNote,
	formatErrorsAsNote,
	getOutputPaths,
	type ValidationError,
} from "./converter";

export type BackupMode = "same-folder" | "folder" | "off";
export type ErrorOutput = "modal" | "note";

export interface WorkflowSettings {
	backupMode: BackupMode;
	backupFolder: string;
	errorOutput: ErrorOutput;
}

// Vault operations the workflow needs, kept deliberately small. Paths are
// vault-relative strings (as used throughout the Obsidian API); `read` and
// `process` take a TFile because they operate on a note that must already
// exist.
export interface VaultAdapter {
	read(file: TFile): Promise<string>;
	// Atomic read-modify-write, mirroring `app.vault.process`. `fn` is
	// synchronous and must return the full new content.
	process(file: TFile, fn: (data: string) => string): Promise<string>;
	exists(path: string): Promise<boolean>;
	// Creates the file at `path` if it doesn't exist, otherwise overwrites it.
	writeOrOverwrite(path: string, content: string): Promise<void>;
	delete(path: string): Promise<void>;
	// Creates the folder at `path` if it doesn't already exist, including any
	// missing intermediate segments (e.g. ensuring "a/b/c" also creates "a"
	// and "a/b" as needed).
	ensureFolder(path: string): Promise<void>;
}

// User feedback. `showErrors` is only used when `errorOutput` is "modal";
// the "note" path writes a file via the adapter instead.
export interface Reporter {
	notice(message: string): void;
	showErrors(file: TFile, errors: ValidationError[]): void;
}

export interface SelectionConversionResult {
	ok: boolean;
	output?: string;
}

function directionMessage(direction: "document-to-table" | "table-to-document"): string {
	return direction === "document-to-table" ? "document → table" : "table → document";
}

// Mirrors the note's vault-relative folder structure under the backup
// folder, so e.g. "Projects/Notes.md" and "Archive/Notes.md" don't collide
// on a shared "Notes.md.BAK".
function backupPathFor(settings: WorkflowSettings, sameFolderPath: string): string {
	if (settings.backupMode === "folder") {
		return `${settings.backupFolder}/${sameFolderPath}`;
	}
	return sameFolderPath;
}

function dirnameOf(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx === -1 ? "" : path.slice(0, idx);
}

async function reportFailure(
	adapter: VaultAdapter,
	reporter: Reporter,
	file: TFile,
	errors: ValidationError[],
	settings: WorkflowSettings,
): Promise<void> {
	const { errorPath, errorName } = getOutputPaths(file.path);
	const summary = `Table Converter: conversion failed (${errors.length} error${errors.length === 1 ? "" : "s"}).`;
	if (settings.errorOutput === "note") {
		try {
			await adapter.writeOrOverwrite(errorPath, formatErrorsAsNote(file.path, errors));
			reporter.notice(`${summary} See ${errorName}.`);
		} catch (e) {
			console.error("Table Converter:", e);
			reporter.notice(`${summary} The error note could not be written.`);
		}
		return;
	}
	reporter.notice(summary);
	reporter.showErrors(file, errors);
}

// Deletes a stale error note left by a previous failed conversion, if one
// exists. Runs on every successful conversion regardless of the current
// errorOutput setting, so switching modes doesn't leave orphaned notes.
async function deleteStaleErrorNote(adapter: VaultAdapter, file: TFile): Promise<void> {
	const { errorPath } = getOutputPaths(file.path);
	try {
		if (await adapter.exists(errorPath)) {
			await adapter.delete(errorPath);
		}
	} catch (e) {
		console.error("Table Converter:", e);
		// Non-fatal: conversion already succeeded.
	}
}

// Converts the whole note in place: read, validate, back up, then write the
// converted content atomically. Used by both the command palette action and
// the file-menu item, so it takes the target TFile rather than assuming the
// active file.
export async function convertFile(
	adapter: VaultAdapter,
	reporter: Reporter,
	file: TFile,
	settings: WorkflowSettings,
): Promise<void> {
	let original: string;
	try {
		original = await adapter.read(file);
	} catch (e) {
		console.error("Table Converter:", e);
		reporter.notice("Table Converter: could not read note.");
		return;
	}

	const result = convertNote(original);
	if (!result.ok) {
		await reportFailure(adapter, reporter, file, result.errors, settings);
		return;
	}

	let backupMessage = "no backup (disabled)";
	if (settings.backupMode !== "off") {
		const { backupPath: sameFolderPath } = getOutputPaths(file.path);
		const backupPath = backupPathFor(settings, sameFolderPath);
		try {
			if (settings.backupMode === "folder") {
				// Mirroring the note's folder can require intermediate
				// segments beyond the backup root (e.g. backupFolder/Projects
				// for "Projects/Notes.md"), not just backupFolder itself.
				const parent = dirnameOf(backupPath);
				if (parent) await adapter.ensureFolder(parent);
			}
			await adapter.writeOrOverwrite(backupPath, original);
			backupMessage = `backup at ${backupPath}`;
		} catch (e) {
			console.error("Table Converter:", e);
			await reportFailure(
				adapter,
				reporter,
				file,
				[
					{
						line: 1,
						message: `Backup could not be written (${backupPath}). Source left unchanged. Line 1.`,
					},
				],
				settings,
			);
			return;
		}
	}

	let racedAway = false;
	try {
		await adapter.process(file, (data) => {
			if (data !== original) {
				// The note changed underneath us between validation/backup and
				// this atomic write. Abort without changing the note.
				racedAway = true;
				return data;
			}
			const fresh = convertNote(data);
			if (!fresh.ok) {
				// Defensive: data is identical to the already-validated
				// original, so this should be unreachable. Treat it like a
				// race rather than lose data.
				racedAway = true;
				return data;
			}
			return fresh.output;
		});
	} catch (e) {
		console.error("Table Converter:", e);
		await reportFailure(
			adapter,
			reporter,
			file,
			[
				{
					line: 1,
					message: "Could not write the converted note. Source may be unchanged.",
				},
			],
			settings,
		);
		return;
	}

	if (racedAway) {
		await reportFailure(
			adapter,
			reporter,
			file,
			[{ line: 1, message: "Note changed during conversion, try again." }],
			settings,
		);
		return;
	}

	await deleteStaleErrorNote(adapter, file);
	reporter.notice(`Table Converter: ${directionMessage(result.direction)}. ${backupMessage}.`);
}

// Converts a selection's text and returns the replacement on success. No
// backup is written (the editor's own undo history covers it); the caller
// is responsible for replacing the selection and for computing
// `selectionStartLine` (the 1-indexed note line the selection starts on).
export async function convertSelection(
	adapter: VaultAdapter,
	reporter: Reporter,
	file: TFile,
	selection: string,
	selectionStartLine: number,
	settings: WorkflowSettings,
): Promise<SelectionConversionResult> {
	const result = convertNote(selection, { frontMatter: false });
	if (!result.ok) {
		const shifted = result.errors.map((e) => ({
			...e,
			line: e.line + selectionStartLine - 1,
		}));
		await reportFailure(adapter, reporter, file, shifted, settings);
		return { ok: false };
	}
	reporter.notice(
		`Table Converter: converted selection (${directionMessage(result.direction)}). Undo with Ctrl/Cmd+Z if needed.`,
	);
	return { ok: true, output: result.output };
}
