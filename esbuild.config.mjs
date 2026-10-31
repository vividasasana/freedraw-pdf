import esbuild from "esbuild";
import process from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const prod = process.argv.includes("production");
const projectDir = dirname(fileURLToPath(import.meta.url));
const dependencyNotices = readFileSync(join(projectDir, "THIRD-PARTY-NOTICES.md"), "utf8").replace(/\*\//g, "* /");

const context = await esbuild.context({
	absWorkingDir: projectDir,
	bundle: true,
	entryPoints: ["./main.ts"],
	external: ["obsidian", "electron"],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	outfile: join(projectDir, "main.js"),
	platform: "browser",
	minify: prod,
	banner: {
		js: `/*!\n${dependencyNotices}\n*/\nif (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}`
	},
	sourcemap: prod ? false : "inline"
});

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
