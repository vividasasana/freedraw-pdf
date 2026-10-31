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
const { toolCommandDefinitions } = require(path.join(projectRoot, "src", "commands", "toolCommands.ts"));
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
const toolCommands=toolCommandDefinitions();
if(new Set(toolCommands.map(command=>command.id)).size!==toolCommands.length) throw new Error("Duplicate tool command IDs");
const calls=[];
const toolSession=new Proxy({}, {get:(_target,key)=>(...args)=>calls.push([key,...args])});
for(const command of toolCommands) {
  const before=calls.length;command.run(toolSession);
  if(calls.length!==before+1) throw new Error(`Tool command ${command.id} failed to dispatch exactly once`);
}
const invoke=id=>toolCommands.find(command=>command.id===id).run(toolSession);
invoke("tool-highlighter-line-wavy");
if(JSON.stringify(calls.at(-1))!==JSON.stringify(["setInkToolLineStyle","highlighter","wavy"]))throw new Error("Highlighter style command did not retain tool identity");
invoke("shape-method-hold");
if(JSON.stringify(calls.at(-1))!==JSON.stringify(["configureShapeTool",{method:"hold",shape:"auto"}]))throw new Error("Shapes must enable automatic hold recognition without resetting remembered drag styling");
invoke("tool-highlighter-preset-3");
if(JSON.stringify(calls.at(-1))!==JSON.stringify(["chooseToolPreset","highlighter",2]))throw new Error("Preset shortcut must select a stable slot");
console.log(`Tool commands passed: ${toolCommands.length} unique assignable commands, distinct ink modes, nine preset slots and automatic Shapes.`);
