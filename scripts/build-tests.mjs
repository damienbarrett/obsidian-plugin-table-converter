import esbuild from "esbuild";

await esbuild.build({
	entryPoints: ["src/converter.ts"],
	bundle: true,
	platform: "neutral",
	format: "esm",
	target: "es2020",
	outfile: "tests/converter.bundled.mjs",
});
console.log("built tests/converter.bundled.mjs");
