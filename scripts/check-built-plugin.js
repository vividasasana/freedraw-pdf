const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert/strict");
const bundlePath = path.join(__dirname, "..", "main.js");
if (!fs.existsSync(bundlePath)) throw new Error("Run npm run build before verifying the compiled plugin.");
const commands = [], blocks = [], canvases = [], disk = new Map(), timers = new Map();
class Plugin {
	constructor(app) { this.app = app; }
	async loadData() { return { pressureCaptureVersion: 1, inkInputPolicy: "pen-mouse-only" }; }
	async saveData() {}
	addCommand(command) { commands.push(command); }
	addSettingTab() {}
	addRibbonIcon() {}
	registerEvent() {}
	registerMarkdownCodeBlockProcessor(name) { blocks.push(name); }
}
class TFile {}
const obsidian = { Plugin, TFile, Modal: class {}, PluginSettingTab: class {}, Notice: class {}, normalizePath: value => value };
const moduleShim = { exports: {} };
vm.runInNewContext(fs.readFileSync(bundlePath, "utf8"), {
	module: moduleShim, exports: moduleShim.exports, console, TextEncoder,
	require(name) { assert.equal(name, "obsidian", "Plugin must not add a Node dependency at startup"); return obsidian; },
	window: {
		setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
		clearTimeout(id) { timers.delete(id); }, atob
	},
	createEl(tag) {
		assert.equal(tag, "canvas");
		const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {} }), toDataURL: () => "data:image/jpeg;base64,/9j/2Q==" };
		canvases.push(canvas);
		return canvas;
	}
}, { filename: "compiled-plugin.cjs" });
const app = {
	workspace: { on() {}, getLeavesOfType: () => [], getActiveFile: () => null },
	vault: {
		on() {}, getAbstractFileByPath: () => null,
		async createBinary(filePath, data) {
			disk.set(filePath, data);
			return Object.assign(new TFile(), { path: filePath, name: filePath, basename: filePath.slice(0, -4), extension: "pdf", stat: { size: data.byteLength, ctime: 1, mtime: 1 } });
		},
		adapter: { exists: async name => disk.has(name), read: async name => disk.get(name), write: async (name, data) => { disk.set(name, data); } }
	}
};
async function main() {
	const plugin = new moduleShim.exports.default(app);
	await plugin.onload();
	assert.ok(commands.some(command => command.id === "create-blank-annotatable-pdf"));
	assert.ok(commands.some(command => command.id === "export-annotated-mixed-pdf"));
	assert.ok(blocks.includes("freedraw-pdf"));
	assert.equal(plugin.getInkInputPolicy(), "pen-mouse-only");
	plugin.openPdfPage = async () => {};
	for (const pageSize of ["a4", "compact"]) {
		await plugin.createBlankAnnotatablePdf({ title: pageSize, pageCount: 2, pageSize, template: "grid", paperColor: "#ffffff" });
		const pdf = disk.get(`${pageSize}.pdf`);
		assert.ok(pdf, "The compiled PDF creation path must produce bytes");
		assert.ok(Buffer.from(pdf).toString("latin1").startsWith("%PDF-"));
		const document = JSON.parse(disk.get(`${pageSize}.pdf.annot.json`));
		assert.equal(document.nativePageTemplatesEditable, true);
		assert.equal(document.pdfPageTemplates.length, 2);
		assert.equal(document.pdfPageTemplates[0].pageSize, pageSize);
	}
	assert.equal(canvases.length, 4);
	const a4 = canvases[0], compact = canvases[2];
	assert.ok(a4.width >= 1000, "Blank PDF export must retain its high resolution");
	assert.equal(a4.height, Math.round(a4.width * 1301 / 920));
	assert.equal(compact.width, Math.round(a4.width * 700 / 920));
	assert.equal(compact.height, Math.round(compact.width * 980 / 700));
	plugin.onunload();
	assert.equal(timers.size, 0, "Unloading must cancel pending settings timers");
	console.log(`Compiled plugin passed: startup, ${commands.length} commands, input settings, mixed-size PDF creation, sidecar persistence and unload.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
