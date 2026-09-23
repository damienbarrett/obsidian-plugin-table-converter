import { Notice, Plugin, TFile } from "obsidian";
import {
	convertNote,
	formatErrorsAsNote,
	getBackupPath,
	getErrorNotePath,
} from "./converter";

export default class TableConverterPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: "convert-document-table",
			name: "Convert document ↔ table",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension.toLowerCase() !== "md") return false;
				if (checking) return true;
				void this.convertActiveNote();
				return true;
			},
		});
	}

	private async convertActiveNote(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension.toLowerCase() !== "md") {
			new Notice("Table Converter: no active Markdown note.");
			return;
		}

		let original: string;
		try {
			original = await this.app.vault.read(file);
		} catch (e) {
			new Notice("Table Converter: could not read active note.");
			return;
		}

		const result = convertNote(original);

		if (!result.ok) {
			await this.writeErrorNote(file, result.errors);
			new Notice(
				`Table Converter: conversion failed (${result.errors.length} error${result.errors.length === 1 ? "" : "s"}). See ${this.errorNoteName(file)}.`,
			);
			return;
		}

		// Backup before modifying source. Abort if backup fails.
		try {
			await this.writeBackup(file, original);
		} catch (e) {
			await this.writeErrorNote(file, [
				{
					line: 1,
					message: `Backup could not be written (${this.backupName(file)}). Source left unchanged. Line 1.`,
				},
			]);
			new Notice(
				"Table Converter: backup failed. Source left unchanged.",
			);
			return;
		}

		try {
			await this.app.vault.modify(file, result.output);
		} catch (e) {
			new Notice("Table Converter: could not write converted note.");
			return;
		}

		await this.deleteStaleErrorNote(file);
		new Notice(
			result.direction === "document-to-table"
				? "Table Converter: document → table."
				: "Table Converter: table → document.",
		);
	}

	private backupName(file: TFile): string {
		return `${file.name}.BAK`;
	}

	private errorNoteName(file: TFile): string {
		if (file.name.toLowerCase().endsWith(".md")) {
			return `${file.basename}.errors.md`;
		}
		return `${file.name}.errors.md`;
	}

	private async writeBackup(file: TFile, original: string): Promise<void> {
		const backupPath = getBackupPath(file.path);
		const existing = this.app.vault.getAbstractFileByPath(backupPath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, original);
		} else {
			await this.app.vault.create(backupPath, original);
		}
	}

	private async writeErrorNote(
		file: TFile,
		errors: { line: number; message: string }[],
	): Promise<void> {
		const errorPath = getErrorNotePath(file.path);
		const content = formatErrorsAsNote(file.path, errors);
		const existing = this.app.vault.getAbstractFileByPath(errorPath);
		try {
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
			} else {
				await this.app.vault.create(errorPath, content);
			}
		} catch (e) {
			// Error-note write failure must not modify the source note.
			// Surface via Notice only.
			new Notice("Table Converter: could not write error note.");
		}
	}

	private async deleteStaleErrorNote(file: TFile): Promise<void> {
		const errorPath = getErrorNotePath(file.path);
		const existing = this.app.vault.getAbstractFileByPath(errorPath);
		if (existing instanceof TFile) {
			try {
				await this.app.vault.delete(existing);
			} catch (e) {
				// Non-fatal: conversion already succeeded.
			}
		}
	}
}
