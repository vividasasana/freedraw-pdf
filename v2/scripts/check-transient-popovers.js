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
const { TransientPopoverRegistry } = require(path.join(projectRoot, "src", "ui", "transientPopoverRegistry.ts"));
if (previousTypeScriptLoader) {
	require.extensions[".ts"] = previousTypeScriptLoader;
} else {
	delete require.extensions[".ts"];
}

function fakeElement(name) {
	return {
		name,
		removed: false,
		children: [],
		remove() { this.removed = true; },
		appendChild(child) { this.children.push(child); }
	};
}

let mountedBackdrops = 0;
let stoppedEscapeListeners = 0;
let dismissFromBackdrop = null;
let dismissFromEscape = null;
const environment = {
	mountBackdrop(onDismiss) {
		mountedBackdrops += 1;
		dismissFromBackdrop = onDismiss;
		return fakeElement(`backdrop-${mountedBackdrops}`);
	},
	mountPopover(backdrop, popover) {
		backdrop.appendChild(popover);
	},
	listenForEscape(onDismiss) {
		dismissFromEscape = onDismiss;
		return () => { stoppedEscapeListeners += 1; };
	}
};

const registry = new TransientPopoverRegistry(environment);
let closeCount = 0;
const color = fakeElement("color");
registry.open("color", color, { onClose: () => { closeCount += 1; } });
if (!registry.hasOpen() || registry.get("color") !== color || registry.get("font") !== null) {
	throw new Error("Opening a popover did not publish the active keyed element.");
}

const font = fakeElement("font");
registry.open("font", font, { onClose: () => { closeCount += 1; } });
if (!color.removed || closeCount !== 1 || registry.get("font") !== font || mountedBackdrops !== 2) {
	throw new Error("Opening a new popover did not exclusively replace and clean up the previous one.");
}

dismissFromEscape();
if (!font.removed || registry.hasOpen() || closeCount !== 2 || stoppedEscapeListeners !== 2) {
	throw new Error("Escape did not dismiss the active popover and its infrastructure.");
}

const pageList = fakeElement("page-list");
registry.open("pages", pageList);
dismissFromBackdrop();
if (!pageList.removed || registry.hasOpen()) {
	throw new Error("Backdrop dismissal did not close the active popover.");
}

const confirm = fakeElement("confirm");
registry.open("confirm", confirm);
registry.dispose();
registry.dispose();
if (!confirm.removed || registry.hasOpen()) {
	throw new Error("Popover registry disposal was not complete and idempotent.");
}

console.log("Transient popover registry verifier passed.");
