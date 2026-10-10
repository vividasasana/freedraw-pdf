// Load local TypeScript dependencies for the in-memory verifier harnesses.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), modules = new Map();
function loadSource(relative) {
	const filename = path.resolve(root, relative);
	if (modules.has(filename)) return modules.get(filename).exports;
	const module = { exports: {} }; modules.set(filename, module);
	vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
		{ module, exports: module.exports, console, require: name => name.startsWith(".") ? loadSource(path.resolve(path.dirname(filename), name + ".ts")) : require(name) });
	return module.exports;
}
module.exports = { loadSource };
