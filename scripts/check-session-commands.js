const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const previousTypeScriptLoader = require.extensions[".ts"];
require.extensions[".ts"] = function transpileTypeScript(module, filename) {
	const source = fs.readFileSync(filename, "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
			esModuleInterop: true
		},
		fileName: filename
	});
	module._compile(output.outputText, filename);
};

const { registerSessionCommands } = require(path.join(projectRoot, "src", "commands", "sessionCommands.ts"));
if (previousTypeScriptLoader) {
	require.extensions[".ts"] = previousTypeScriptLoader;
} else {
	delete require.extensions[".ts"];
}

const registered = [];
let activeSession = null;
let runCount = 0;
registerSessionCommands(
	(command) => registered.push(command),
	() => activeSession,
	[
		{ id: "always", name: "Always", run: () => { runCount += 1; } },
		{ id: "conditional", name: "Conditional", isEnabled: (session) => session.enabled, run: () => { runCount += 1; } }
	]
);

if (registered.length !== 2 || registered[0].id !== "always" || registered[1].id !== "conditional") {
	throw new Error("Session command definitions were not registered in order.");
}
if (registered[0].checkCallback(true) !== false || runCount !== 0) {
	throw new Error("A session command must be unavailable without an active session.");
}
activeSession = { enabled: false };
if (registered[0].checkCallback(true) !== true || registered[1].checkCallback(true) !== false || runCount !== 0) {
	throw new Error("Session command availability checks changed execution state.");
}
if (registered[0].checkCallback(false) !== true || runCount !== 1) {
	throw new Error("An enabled session command did not execute exactly once.");
}
activeSession.enabled = true;
if (registered[1].checkCallback(false) !== true || runCount !== 2) {
	throw new Error("A conditionally enabled session command did not execute.");
}

console.log("Session command registry verifier passed.");
