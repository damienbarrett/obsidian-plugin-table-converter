import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const options = {
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
};

if (prod) {
	await esbuild.build(options);
} else {
	const context = await esbuild.context(options);
	await context.watch();
}
