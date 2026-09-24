import esbuild from "esbuild";

// Bundled outside tests/ so the generated file never lives alongside test
// sources; node_modules is already git-ignored, so no separate ignore rule
// is needed for it.
const cacheDir = "node_modules/.cache/table-converter-tests";

await esbuild.build({
	entryPoints: ["src/converter.ts"],
	bundle: true,
	platform: "neutral",
	format: "esm",
	target: "es2020",
	outfile: `${cacheDir}/converter.bundled.mjs`,
});
console.log(`built ${cacheDir}/converter.bundled.mjs`);

// workflow.ts only uses Obsidian's TFile as a type (`import type`, erased at
// build time), so it bundles cleanly for Node with no "obsidian" module
// present.
await esbuild.build({
	entryPoints: ["src/workflow.ts"],
	bundle: true,
	platform: "neutral",
	format: "esm",
	target: "es2020",
	outfile: `${cacheDir}/workflow.bundled.mjs`,
});
console.log(`built ${cacheDir}/workflow.bundled.mjs`);
