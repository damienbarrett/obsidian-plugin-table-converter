import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mjs"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// "Table Converter" is this plugin's own name, used as the Notice
			// prefix throughout (e.g. "Table Converter: ..."). "Table" is
			// already allowed as the sentence-initial word; only "Converter"
			// needs preserving. "Off" is preserved so a setting description
			// can reference the "Off" dropdown option by its exact label.
			"obsidianmd/ui/sentence-case": ["warn", { ignoreWords: ["Converter", "Off"] }],
		},
	},
]);
