import {
	App,
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Menu,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	normalizePath,
} from "obsidian";
import { isConvertibleNotePath, type ValidationError } from "./converter";
import {
	convertFile,
	convertSelection,
	transposeFile,
	type BackupMode,
	type ErrorOutput,
	type Reporter,
	type VaultAdapter,
	type WorkflowSettings,
} from "./workflow";

interface TableConverterSettings {
	backupMode: BackupMode;
	backupFolder: string;
	errorOutput: ErrorOutput;
}

const DEFAULT_SETTINGS: TableConverterSettings = {
	backupMode: "same-folder",
	backupFolder: "Table Converter backups",
	errorOutput: "modal",
};

// Real, Obsidian-backed implementation of the workflow's VaultAdapter.
class ObsidianVaultAdapter implements VaultAdapter {
	constructor(private app: App) {}

	async read(file: TFile): Promise<string> {
		return this.app.vault.read(file);
	}

	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		return this.app.vault.process(file, fn);
	}

	async exists(path: string): Promise<boolean> {
		return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
	}

	async writeOrOverwrite(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(normalized, content);
		}
	}

	async delete(path: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			await this.app.fileManager.trashFile(existing);
		}
	}

	async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (normalized === "" || normalized === "/") return;
		// Vault.createFolder() does not reliably create missing intermediate
		// segments, so walk the path and create each one that's missing.
		const segments = normalized.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (this.app.vault.getAbstractFileByPath(current)) continue;
			try {
				await this.app.vault.createFolder(current);
			} catch (e) {
				// Ignore a concurrent create of the same folder; anything
				// else is a real failure.
				if (!this.app.vault.getAbstractFileByPath(current)) throw e;
			}
		}
	}
}

// Real, Obsidian-backed implementation of the workflow's Reporter.
class ObsidianReporter implements Reporter {
	constructor(private app: App) {}

	notice(message: string): void {
		new Notice(message);
	}

	showErrors(file: TFile, errors: ValidationError[]): void {
		new ConversionErrorModal(this.app, file, errors).open();
	}
}

// Lists conversion errors with line numbers. Clicking an error moves the
// cursor to that line in the source note, if it is open in a MarkdownView.
class ConversionErrorModal extends Modal {
	constructor(
		app: App,
		private file: TFile,
		private errors: ValidationError[],
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle("Table converter: conversion failed");
		contentEl.createEl("p", {
			text: `Conversion did not occur for "${this.file.path}".`,
		});
		const list = contentEl.createEl("ul", { cls: "table-converter-error-list" });
		const sorted = [...this.errors].sort((a, b) => a.line - b.line);
		for (const error of sorted) {
			const item = list.createEl("li");
			const link = item.createEl("a", {
				text: `Line ${error.line}: ${error.message}`,
				href: "#",
			});
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				this.jumpToLine(error.line);
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private jumpToLine(line: number): void {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === this.file.path) {
				const target = { line: Math.max(0, line - 1), ch: 0 };
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
				view.editor.setCursor(target);
				view.editor.scrollIntoView({ from: target, to: target }, true);
				view.editor.focus();
				this.close();
				return;
			}
		}
	}
}

class TableConverterSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TableConverterPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Backups")
			.setHeading();

		new Setting(containerEl)
			.setName("Backup location")
			.setDesc(
				"Where to save a copy of the note before converting it, or \"Off\" to disable backups.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("same-folder", "Same folder as the note")
					.addOption("folder", "Dedicated backup folder")
					.addOption("off", "Off")
					.setValue(this.plugin.settings.backupMode)
					.onChange(async (value) => {
						this.plugin.settings.backupMode = value as BackupMode;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.backupMode === "folder") {
			new Setting(containerEl)
				.setName("Backup folder")
				.setDesc(
					"Vault-relative folder to store backups in. Backups mirror the note's own folder structure underneath it, so notes with the same name in different folders don't collide. Folders are created automatically if missing.",
				)
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_SETTINGS.backupFolder)
						.setValue(this.plugin.settings.backupFolder)
						.onChange(async (value) => {
							const normalized = normalizePath(value.trim() || DEFAULT_SETTINGS.backupFolder);
							this.plugin.settings.backupFolder = normalized;
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Errors")
			.setHeading();

		new Setting(containerEl)
			.setName("Error reporting")
			.setDesc(
				"How to report conversion errors. \"Dialog\" shows a list you can click through; \"note\" writes a .errors.md file next to the note.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("modal", "Dialog")
					.addOption("note", "Error note")
					.setValue(this.plugin.settings.errorOutput)
					.onChange(async (value) => {
						this.plugin.settings.errorOutput = value as ErrorOutput;
						await this.plugin.saveSettings();
					}),
			);
	}
}

export default class TableConverterPlugin extends Plugin {
	settings: TableConverterSettings = DEFAULT_SETTINGS;
	private adapter!: ObsidianVaultAdapter;
	private reporter!: ObsidianReporter;

	async onload() {
		await this.loadSettings();
		this.adapter = new ObsidianVaultAdapter(this.app);
		this.reporter = new ObsidianReporter(this.app);
		this.addSettingTab(new TableConverterSettingTab(this.app, this));

		this.addCommand({
			id: "convert-document-table",
			name: "Convert document ↔ table",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !isConvertibleNotePath(file.path)) return false;
				if (checking) return true;
				void this.runConvertFile(file);
				return true;
			},
		});

		this.addCommand({
			id: "transpose-rows-columns",
			name: "Transpose rows ↔ columns",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !isConvertibleNotePath(file.path)) return false;
				if (checking) return true;
				void this.runTransposeFile(file);
				return true;
			},
		});

		this.addCommand({
			id: "convert-selection",
			name: "Convert selection ↔ table",
			editorCheckCallback: (
				checking: boolean,
				editor: Editor,
				ctx: MarkdownView | MarkdownFileInfo,
			) => {
				if (!editor.somethingSelected()) return false;
				const file = ctx.file;
				if (!file || !isConvertibleNotePath(file.path)) return false;
				if (checking) return true;
				void this.runConvertSelection(editor, file);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFile) || !isConvertibleNotePath(file.path)) return;
				menu.addItem((item) =>
					item
						.setTitle("Convert document ↔ table")
						.setIcon("table")
						.onClick(() => void this.runConvertFile(file)),
				);
				menu.addItem((item) =>
					item
						.setTitle("Transpose rows ↔ columns")
						.setIcon("arrow-left-right")
						.onClick(() => void this.runTransposeFile(file)),
				);
			}),
		);

		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
					const file = info.file;
					if (!file || !isConvertibleNotePath(file.path)) return;
					if (editor.somethingSelected()) {
						menu.addItem((item) =>
							item
								.setTitle("Convert selection ↔ table")
								.setIcon("table")
								.onClick(() => void this.runConvertSelection(editor, file)),
						);
					} else {
						menu.addItem((item) =>
							item
								.setTitle("Convert document ↔ table")
								.setIcon("table")
								.onClick(() => void this.runConvertFile(file)),
						);
						menu.addItem((item) =>
							item
								.setTitle("Transpose rows ↔ columns")
								.setIcon("arrow-left-right")
								.onClick(() => void this.runTransposeFile(file)),
						);
					}
				},
			),
		);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<TableConverterSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...data };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private workflowSettings(): WorkflowSettings {
		return this.settings;
	}

	private async runConvertFile(file: TFile): Promise<void> {
		await convertFile(this.adapter, this.reporter, file, this.workflowSettings());
	}

	private async runTransposeFile(file: TFile): Promise<void> {
		await transposeFile(this.adapter, this.reporter, file, this.workflowSettings());
	}

	private async runConvertSelection(editor: Editor, file: TFile): Promise<void> {
		const selection = editor.getSelection();
		const selectionStartLine = editor.getCursor("from").line + 1;
		const result = await convertSelection(
			this.adapter,
			this.reporter,
			file,
			selection,
			selectionStartLine,
			this.workflowSettings(),
		);
		if (result.ok && result.output !== undefined) {
			editor.replaceSelection(result.output);
		}
	}
}
