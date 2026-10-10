const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const cache = new Map();
function load(file) {
	file = path.resolve(root, file);
	if (cache.has(file)) return cache.get(file).exports;
	const module = { exports: {} }; cache.set(file, module);
	vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
		module, exports: module.exports, console,
		require: name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : require(name)
	}); return module.exports;
}
class SvgNode {
	constructor(tag, doc) { this.localName = tag; this.ownerDocument = doc; this.childNodes = []; this.attrs = {}; this.style = {}; this.textContent = ""; }
	setAttribute(key, value) { this.attrs[key] = String(value); }
	getAttribute(key) { return this.attrs[key] ?? null; }
	get children() { return this.childNodes; }
	get childElementCount() { return this.childNodes.length; }
	get firstChild() { return this.childNodes[0] ?? null; }
	get firstElementChild() { return this.firstChild; }
	get nextSibling() { const children = this.parentNode?.childNodes ?? []; return children[children.indexOf(this) + 1] ?? null; }
	getBoundingClientRect() { return { left: -400, top: -500, width: 8000, height: 11000 }; }
	removeAttribute(key) { delete this.attrs[key]; }
	createSvg(tag, options = {}) { const node = new SvgNode(tag, this.ownerDocument); for (const [key, value] of Object.entries(options.attr ?? {})) node.setAttribute(key, value); this.appendChild(node); return node; }
	appendChild(node) { node.remove(); this.childNodes.push(node); node.parentNode = this; return node; }
	insertBefore(node, before) { node.remove(); const i = this.childNodes.indexOf(before); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, node); node.parentNode = this; }
	remove() { if (this.parentNode) { const list = this.parentNode.childNodes; list.splice(list.indexOf(this), 1); this.parentNode = null; } }
	replaceChildren(...nodes) { for (const node of [...this.childNodes]) node.remove(); for (const node of nodes) this.appendChild(node); }
	setCssStyles(styles) { Object.assign(this.style, styles); }
}
let rasterStrokes = 0;
const raster = Object.fromEntries(["save", "restore", "setTransform", "clearRect", "beginPath", "moveTo", "lineTo", "quadraticCurveTo", "arc", "closePath", "fill", "stroke"].map(name => [name, () => {}]));
const doc = { defaultView: { innerWidth: 768, innerHeight: 1024, createFragment: () => new SvgNode("fragment", doc), createEl: () => ({ getContext: () => raster }) } };
const svg = new SvgNode("svg", doc);
const vectorPath = path.join(root, "src/render/svgDrawingContext.ts");
const vector = fs.existsSync(vectorPath) ? load(vectorPath) : { SvgDrawingContext: class {}, SvgAnnotationRenderer: class {} };
const source = fs.readFileSync(path.join(root, "main.ts"), "utf8");
const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const sessionClass = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "NativePdfAnnotatorSession");
const names = ["drawTransientPageAnnotations", "createSvgDrawingContext", "publishSvgDrawingContext", "getLivePreviewPredictionStrength"];
const members = sessionClass.members.filter(member => names.includes(member.name?.getText(tree)));
const globals = { ...vector, console };
vm.runInNewContext(ts.transpileModule(`class Session {${members.map(member => member.getText(tree)).join("\n")}}globalThis.Session=Session;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, globals);
const sut = new globals.Session();
const ink = load("src/ink/inkEngine.ts");
const points = Array.from({ length: 80 }, (_, i) => ({ x: .2 + i * .004, y: .4 + Math.sin(i * .1) * .02, pressure: .5, t: i * 8 }));
const stroke = { id: "new", page: 1, tool: "pen", width: 4, widthScale: .004, color: "#ff0000", points };
const surface = { pageNumber: 1, lastWidth: 8000, lastHeight: 11000, vectorEl: svg, transientEl: { getContext: () => raster } };
Object.assign(sut, { pageSurfaces: new Map([[1, surface]]), ownerWindow: { devicePixelRatio: 2 }, currentStroke: stroke, svgRenderer: new vector.SvgAnnotationRenderer(),
	plugin: { getLivePreviewMode: () => "accurate" }, syncCanvasBackingSize() {}, getAnnotationPixelRatio: () => .218,
	drawStroke(ctx) { if (ctx === raster) rasterStrokes++; ctx.fillStyle = stroke.color; ctx.strokeStyle = stroke.color; ctx.globalAlpha = .96; ink.drawSmoothInkStroke(ctx, points, 8000, 11000, 32, true, false, { serializePath: false }); }
});
sut.drawTransientPageAnnotations(1);
function paths(node) { return [ ...(node.localName === "path" ? [node] : []), ...node.childNodes.flatMap(paths) ]; }
assert.ok(paths(svg).length > 0, "At extreme zoom the visible live stroke is still only a downsampled bitmap");
assert.equal(rasterStrokes, 0, "Vector live ink must not also draw a duplicate low-resolution stroke");
assert.ok(/[QA]/.test(paths(svg)[0].getAttribute("d")), "Visible ink must be a real curved pressure-outline SVG path");
console.log("Vector display replay passed: zoomed live ink is a native SVG path, not an enlarged low-resolution bitmap.");

const renderer = new vector.SvgAnnotationRenderer();
const committedSvg = new SvgNode("svg", doc);
let builds = 0;
function frame(signature = "stable") {
	const ctx = renderer.create(committedSvg, 8000, 11000);
	ctx.setKey("stroke:new");
	ctx.drawCachedStroke(stroke, signature, () => {
		builds++; ctx.fillStyle = stroke.color; ctx.globalAlpha = .96;
		ink.drawSmoothInkStroke(ctx, points, 8000, 11000, 32, true, false, { serializePath: false });
	});
	return ctx;
}
renderer.publish(frame());
const originalNode = paths(committedSvg)[0];
for (let i = 0; i < 20; i++) renderer.publish(frame());
assert.equal(builds, 1, "stationary vector ink was rebuilt every interaction frame");
assert.equal(paths(committedSvg)[0], originalNode, "unchanged SVG paths must retain their DOM nodes");
renderer.publish(frame("edited"));
assert.equal(builds, 2);
assert.notEqual(paths(committedSvg)[0], originalNode);
const live = renderer.create(committedSvg, 16000, 22000);
live.setKey("stroke:next"); live.fillStyle = "#000000"; live.beginPath(); live.moveTo(10, 20); live.lineTo(50, 60); live.stroke();
renderer.publish(live, true);
assert.equal(committedSvg.getAttribute("viewBox"), "0 0 8000 11000", "live ink changed existing committed page coordinates during zoom");
renderer.promote(committedSvg);
renderer.clearLive(committedSvg);
assert.equal(paths(committedSvg).length, 2, "lifting the Pencil discarded the SVG stroke");
renderer.erase(committedSvg, 8000, 11000, { x: .01, y: .01 }, { x: .02, y: .02 }, 8);
const defs = committedSvg.childNodes.find(node => node.localName === "defs");
const mask = defs.firstElementChild;
assert.ok(Number(mask.getAttribute("width")) <= 768 && Number(mask.getAttribute("height")) <= 1024, "eraser allocated a mask for the entire extreme-zoom page");
renderer.release(committedSvg);
assert.equal(committedSvg.childNodes.length, 0, "cold pages retained their SVG paint tree");
console.log("Committed vector replay passed: cached paths, edits, live/commit zoom parity, bounded eraser masks, and cold-page cleanup.");

async function snapshotsAndPublication() {
	const exportNames = ["exportPageSnapshot", "exportSelectionSnapshot", "publishPageRenderSnapshot"];
	const exportMembers = sessionClass.members.filter(member => exportNames.includes(member.name?.getText(tree)));
	const canvases = [], annotationDraws = [];
	const exportContext = { save() {}, restore() {}, translate() {}, drawImage() {} };
	const scope = { console, Notice: class {}, BLANK_PDF_EXPORT_WIDTH_PX: 1600,
		isHtmlCanvasElement: element => element?.canvas === true,
		getNotebookPageRenderDimensions: load("src/notebook/pageModel.ts").getNotebookPageRenderDimensions,
		getBaseName: () => "Paper", dataUrlToArrayBuffer: () => new ArrayBuffer(1),
		createEl() { const canvas = { width: 1, height: 1, canvas: true, getContext: () => exportContext, toDataURL: () => "data:image/png;base64,AA==" }; canvases.push(canvas); return canvas; },
		renderAnnotationDocumentPage(ctx, document, page, width, height) { annotationDraws.push({ page, width, height }); },
		renderAnnotationDocumentPageImages: async () => {}
	};
	vm.runInNewContext(ts.transpileModule(`class Session {${exportMembers.map(member => member.getText(tree)).join("\n")}}globalThis.Session=Session;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, scope);
	const session = new scope.Session();
	const hitCanvas = { canvas: true, width: 1, height: 1, isConnected: true, setCssStyles() {} };
	const exportSurface = { ...surface, overlayEl: hitCanvas, hostEl: { querySelector: selector => selector === "canvas" ? hitCanvas : null } };
	Object.assign(session, {
		file: { path: "Paper.pdf", parent: { path: "Notes" } }, annotationDocument: { strokes: [stroke] },
		ownerWindow: { devicePixelRatio: 2 }, pageSurfaces: new Map([[1, exportSurface]]),
		getSyntheticPageIndex: () => 0, getAppendedPages: () => [{ pageSize: "a4", template: "blank" }], drawSyntheticSnapshotBackground() {}, refreshStatus() {},
		getSelectionRegion: () => ({ page: 1, rect: { left: .2, top: .3, right: .5, bottom: .7 } }),
		plugin: { app: { vault: { getAbstractFileByPath: () => null, createBinary: async name => ({ name }) } } }
	});
	await session.exportPageSnapshot(1);
	assert.ok(canvases[0].width >= 1600, "snapshot exported the one-pixel input canvas rather than the annotations");
	assert.equal(annotationDraws[0].width, canvases[0].width);
	await session.exportSelectionSnapshot();
	assert.ok(canvases[1].width > 400);
	assert.equal(annotationDraws[1].width, 1600, "selection export used a downsampled display layer");
	const publishSvg = new SvgNode("svg", doc), publisher = new vector.SvgAnnotationRenderer();
	const current = publisher.create(publishSvg, 8000, 11000);
	current.setKey("stroke:current"); current.beginPath(); current.moveTo(10, 10); current.lineTo(100, 100); current.stroke();
	const pubSurface = { ...exportSurface, vectorEl: publishSvg };
	let rasterSnapshots = 0;
	Object.assign(session, { pageSurfaces: new Map([[1, pubSurface]]), snapshotCanvases: new Set(),
		pageRenderVersions: new Map([[1, 1]]), pageRenderPublications: new Map([[1, 1]]), pageRenderJobs: new Map(), pageRenderSlots: new Map(),
		pendingRedrawPages: new Set(), publishedFrames: new WeakMap(), renderInputEpoch: 1,
		getPageFrameKey: () => "current", hasActiveTransientRender: () => false,
		createCanvasSnapshot() { rasterSnapshots++; throw new Error("SVG publishing must not encode a bitmap"); },
		publishSvgDrawingContext: (_, frame) => publisher.publish(frame),
		renderTelemetry: { recordRenderComplete() {}, recordRenderCancelled() {}, recordRenderIdle() {} }
	});
	const job = { pageNumber: 1, canvas: { width: 1, height: 1 }, vectorFrame: current, width: 8000, height: 11000, version: 1, inputEpoch: 1, frameKey: "current" };
	await session.publishPageRenderSnapshot(job, pubSurface);
	assert.equal(rasterSnapshots, 0);
	assert.equal(paths(publishSvg).length, 1);
	const committedPath = paths(publishSvg)[0];
	session.pageRenderPublications.set(1, 1); session.pageRenderVersions.set(1, 2);
	await session.publishPageRenderSnapshot(job, pubSurface);
	assert.equal(paths(publishSvg)[0], committedPath, "a stale frame replaced the current vector layer");
	console.log("Vector integration passed: atomic SVG publication without bitmap snapshots, stale-frame rejection, and source-resolution page/selection exports.");
}
snapshotsAndPublication().catch(error => { console.error(error); process.exitCode = 1; });
