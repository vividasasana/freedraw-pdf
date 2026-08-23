const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const previousTypeScriptLoader = require.extensions[".ts"];
require.extensions[".ts"] = function transpileTypeScript(module, filename) {
	const source = fs.readFileSync(filename, "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
		fileName: filename
	});
	module._compile(output.outputText, filename);
};
const { addMenuDescriptors, menuSeparator } = require(path.join(projectRoot, "src", "ui", "menuDescriptors.ts"));
if (previousTypeScriptLoader) {
	require.extensions[".ts"] = previousTypeScriptLoader;
} else {
	delete require.extensions[".ts"];
}

const rendered = [];
const menu = {
	addSeparator() { rendered.push({ type: "separator" }); },
	addItem(configure) {
		const state = { type: "item" };
		const item = {
			setTitle(value) { state.title = value; return item; },
			setIcon(value) { state.icon = value; return item; },
			setChecked(value) { state.checked = value; return item; },
			setDisabled(value) { state.disabled = value; return item; },
			setWarning(value) { state.warning = value; return item; },
			onClick(value) { state.onClick = value; return item; }
		};
		configure(item);
		rendered.push(state);
	}
};

let runCount = 0;
addMenuDescriptors(menu, [
	{ title: "First", icon: "pencil", checked: true, run: () => { runCount += 1; } },
	menuSeparator,
	{ title: "Danger", disabled: false, warning: true }
]);

if (rendered.length !== 3 || rendered[1].type !== "separator") {
	throw new Error("Menu descriptor order or separators changed.");
}
if (rendered[0].title !== "First" || rendered[0].icon !== "pencil" || rendered[0].checked !== true) {
	throw new Error("Menu item title, icon, or checked state was not preserved.");
}
if (rendered[2].title !== "Danger" || rendered[2].disabled !== false || rendered[2].warning !== true) {
	throw new Error("Menu item disabled or warning state was not preserved.");
}
rendered[0].onClick({ type: "click" });
if (runCount !== 1) {
	throw new Error("Menu item callback did not execute exactly once.");
}

console.log("Menu descriptor verifier passed.");
