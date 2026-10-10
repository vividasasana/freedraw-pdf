const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const modules = new Map();
function load(relative) {
	const filename = path.resolve(root, relative);
	if (modules.has(filename)) return modules.get(filename).module.exports;
	const module = { exports: {} };
	const context = vm.createContext({ module, exports: module.exports, console,
		require: name => name === "obsidian" ? { TFile: class {}, AbstractInputSuggest:class{},Modal: class {}, Setting: class {}, Notice: class {} } : name.startsWith(".") ? load(path.resolve(path.dirname(filename), name + ".ts")) : require(name) });
	modules.set(filename, { module, context });
	vm.runInContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
	}).outputText, context);
	return module.exports;
}
const ink = load("src/ink/inkEngine.ts");
const source = fs.readFileSync(path.join(root, "main.ts"), "utf8");
const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const sessionClass = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "NativePdfAnnotatorSession");
function session(names, globals = {}) {
	const members = sessionClass.members.filter(member => names.includes(member.name?.getText(tree)));
	const context = { console, ...globals };
	vm.runInNewContext(ts.transpileModule(`class Session {${members.map(member => member.getText(tree)).join("\n")}} globalThis.Session = Session;`, {
		compilerOptions: { target: ts.ScriptTarget.ES2020 }
	}).outputText, context);
	return new context.Session();
}
const failures = [];
function check(label, fn) {
	try { fn(); console.log("PASS " + label); }
	catch (error) { failures.push(label + ": " + error.message); console.error("FAIL " + label + ": " + error.message); }
}
check("Pencil down position survives nearby samples", () => {
	const start = { x: .2, y: .3, pressure: .5, t: 1 };
	const stroke = { widthScale: .004, points: [{ ...start }] };
	for (let i = 1; i <= 20; i++) ink.appendStrokePoints(stroke, [{ x: .2 + i * .0001, y: .3, pressure: .5, t: 1 + i * 4 }], { mergeThreshold: .001 });
	assert.equal(stroke.points[0].x, start.x, "first point drifted from the Pencil down position");
	assert.equal(stroke.points[0].t, start.t);
});
check("Dense slow Pencil samples retain a curve instead of collapsing to a straight chord", () => {
	const stroke = { widthScale: .004, points: [{ x: .2, y: .3, pressure: .5, t: 1 }] };
	for (let i = 1; i <= 240; i++) {
		const angle = i / 240 * Math.PI;
		ink.appendStrokePoints(stroke, [{ x: .2 + .01 * (1 - Math.cos(angle)), y: .3 + .02 * Math.sin(angle), pressure: .5, t: 1 + i * 4 }], { mergeThreshold: .001 });
	}
	assert.ok(stroke.points.length >= 20, `the curve collapsed to ${stroke.points.length} endpoints`);
	assert.ok(Math.max(...stroke.points.map(point => point.y)) > .319, "merging dropped the top of the curve");
	assert.equal(stroke.points[0].x, .2);
});
check("Late samples cannot draw backwards through a curve", () => {
	const stroke = { widthScale: .004, points: [{ x: .2, y: .3, pressure: .5, t: 20 }] };
	ink.appendStrokePoints(stroke, [{ x: .8, y: .9, pressure: .9, t: 10 }]);
	assert.equal(stroke.points.length, 1, "an older sample created a spurious straight join");
});
check("Stylus sample batches arrive in timestamp order and survive an unavailable API", () => {
	const { getCoalescedPointerEvents } = load("src/pointer/pointerInput.ts");
	const make = (timeStamp, clientX) => ({ pointerType: "pen", timeStamp, clientX, clientY: 10 });
	const event = { ...make(30, 30), getCoalescedEvents: () => [make(20, 20), make(10, 10)] };
	assert.equal(getCoalescedPointerEvents(event).map(p => p.timeStamp).join(","), "10,20,30");
	const unavailable = { ...make(40, 40), getCoalescedEvents() { throw new Error("not supported by this driver"); } };
	assert.equal(getCoalescedPointerEvents(unavailable)[0], unavailable);
});
check("Canvas preview draws numeric geometry without SVG serialization", () => {
	const moduleContext = modules.get(path.join(root, "src/ink/inkEngine.ts")).context;
	vm.runInContext('globalThis.formatCalls = 0; const originalToFixed = Number.prototype.toFixed; Number.prototype.toFixed = function (...args) { globalThis.formatCalls++; return originalToFixed.apply(this, args); };', moduleContext);
	const operations = [];
	const ctx = Object.fromEntries(["beginPath", "moveTo", "lineTo", "quadraticCurveTo", "arc", "closePath", "fill", "stroke"].map(name => [name, (...args) => operations.push([name, ...args])]));
	const points = Array.from({ length: 240 }, (_, i) => ({ x: .1 + i / 400, y: .5 + Math.sin(i * .1) * .1, pressure: .5, t: i * 4 }));
	ink.drawSmoothInkStroke(ctx, points, 1000, 1400, 4, true, false, { renderMode: "live", serializePath: false });
	const canvasOperations = JSON.stringify(operations);
	const formatCalls = vm.runInContext("formatCalls", moduleContext);
	operations.length = 0;
	const svg = ink.drawSmoothInkStroke(ctx, points, 1000, 1400, 4, true);
	assert.equal(JSON.stringify(operations), canvasOperations, "removing serialization must leave canvas geometry unchanged");
	assert.ok(svg?.startsWith("M"), "SVG consumers still need a path");
	assert.equal(formatCalls, 0, "preview constructed unused SVG coordinates");
});
check("Extreme iPad zoom stays within the annotation canvas budget", () => {
	let budget = {};
	if (fs.existsSync(path.join(root, "src/render/canvasBudget.ts"))) budget = load("src/render/canvasBudget.ts");
	const sut = session(["syncCanvasBackingSize", "getAnnotationPixelRatio"], { ...budget, Platform: { isMobile: true } });
	const hostWindow = { devicePixelRatio: 2 };
	sut.ownerWindow = hostWindow;
	sut.publishedFrames = new WeakMap();
	const canvas = { width: 1, height: 1, ownerDocument: { defaultView: hostWindow } };
	sut.syncCanvasBackingSize(canvas, 8000, 11000);
	console.log(`Zoom fixture: ${canvas.width} x ${canvas.height}, ${(canvas.width * canvas.height * 4 / 1048576).toFixed(1)} MiB per canvas`);
	assert.ok(canvas.width * canvas.height <= 4 * 1024 * 1024, "annotation backing store exceeded 16 MiB");
	assert.ok(Math.max(canvas.width, canvas.height) <= 4096, "annotation canvas exceeded the side limit");
});
check("Loading a long document visits each annotation once for layer normalization", () => {
	const { normalizeDocumentZIndexes } = load("src/stores/annotationStore.ts");
	let reads = 0;
	const strokes = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), get page() { reads++; return i % 100 + 1; } }));
	const doc = { strokes, textItems: [], shapes: [], eraserPaths: [] };
	normalizeDocumentZIndexes(doc);
	assert.equal(doc.strokes[0].zIndex, 0);
	assert.equal(doc.strokes[9900].zIndex, 99);
	console.log(`Loading fixture: ${reads} page reads for ${strokes.length} strokes`);
	assert.ok(reads <= strokes.length * 2, "loading scanned every stroke again for every page");
});
check("Pencil release keeps the final coalesced curve and the frozen page coordinates", () => {
	const { getCoalescedPointerEvents } = load("src/pointer/pointerInput.ts");
	const sut = session(["appendFinalStrokeSamples"], { getCoalescedPointerEvents, appendStrokePoints: ink.appendStrokePoints });
	const start = { x: .1, y: .1, pressure: .5, t: 10 };
	sut.currentStroke = { widthScale: .004, points: [start] };
	sut.lastPdfPointTime = 10;
	sut.getStrokeMergeThreshold = () => .001;
	sut.getNormalizedPointFromRect = (rect, sample) => ({ x: (sample.clientX - rect.left) / rect.width, y: (sample.clientY - rect.top) / rect.height, pressure: sample.pressure, t: sample.timeStamp });
	const sample = (timeStamp, clientX, clientY, pressure = .5) => ({ pointerType: "pen", timeStamp, clientX, clientY, pressure });
	const up = { ...sample(40, 50, 20, 0), getCoalescedEvents: () => [sample(20, 25, 30), sample(30, 40, 35)] };
	sut.appendFinalStrokeSamples({}, up, { left: 10, top: 10, width: 100, height: 100 });
	assert.equal(sut.currentStroke.points.length, 4, "lifting the Pencil dropped a final curve");
	assert.equal(sut.currentStroke.points[1].y, .2);
	assert.equal(sut.currentStroke.points[2].y, .25);
	assert.equal(sut.currentStroke.points[3].x, .4);
	assert.ok(sut.currentStroke.points[3].pressure >= .5, "zero lift pressure must not collapse the end");
});
check("Cold pages release their buffers and a snapshot buffer cannot be reused", () => {
	const budget = load("src/render/canvasBudget.ts");
	const makeCanvas = () => ({ width: 2048, height: 2048 });
	const sut = session(["getNextPageRenderSlot", "getAnnotationPixelRatio", "releasePageCanvasResources"], { ...budget, Platform: { isMobile: true }, createEl: makeCanvas });
	const surface = { pageNumber: 1, lastWidth: 8000, lastHeight: 11000, overlayEl: makeCanvas(), transientEl: makeCanvas() };
	const busy = makeCanvas(), free = makeCanvas();
	Object.assign(sut, { ownerWindow: { devicePixelRatio: 2 }, snapshotCanvases: new Set([busy]), pageRenderSlots: new Map([[1, { canvases: [busy, free], nextIndex: 0 }]]), pageSurfaces: new Map([[1, surface]]), publishedFrames: new WeakMap(), cancelPageRenderJob() {} });
	const slot = sut.getNextPageRenderSlot(surface);
	assert.equal(slot, free, "new render overwrote an asynchronous snapshot source");
	assert.ok(slot.width * slot.height <= 4 * 1024 * 1024);
	sut.snapshotCanvases.add(free);
	assert.equal(sut.getNextPageRenderSlot(surface), null, "slow snapshots must queue rather than allocate unbounded buffers");
	assert.equal(sut.pageRenderSlots.get(1).canvases.length, 2);
	sut.snapshotCanvases.delete(free);
	sut.releasePageCanvasResources(1);
	assert.equal(surface.overlayEl.width, 1);
	assert.equal(surface.transientEl.height, 1);
	assert.equal(free.width, 1);
	assert.equal(busy.width, 2048, "pending snapshots retain their source until completion");
	assert.equal(sut.pageRenderSlots.size, 0);
});
check("Object erasing stays offscreen when every snapshot slot is busy", () => {
	const budget = load("src/render/canvasBudget.ts");
	let visibleClears = 0, publications = 0;
	const context = { setTransform() {}, clearRect() {} };
	const hostWindow = { devicePixelRatio: 2, createEl: () => ({ width: 1, height: 1, ownerDocument: { defaultView: hostWindow }, getContext: () => context }) };
	const overlay = { width: 1024, height: 1024, getContext: () => ({ ...context, clearRect() { visibleClears++; } }) };
	const surface = { pageNumber: 1, lastWidth: 8000, lastHeight: 11000, overlayEl: overlay };
	const sut = session(["redrawObjectErasePreview", "getObjectEraseRenderCanvas", "getAnnotationPixelRatio", "syncCanvasBackingSize"], { ...budget, Platform: { isMobile: true }, getAnnotationRenderables: () => [] });
	Object.assign(sut, { annotationDocument: {}, pageSurfaces: new Map([[1, surface]]), ownerWindow: hostWindow,
		publishedFrames: new WeakMap(), selectedTargets: [], objectErasePreviewTargets: new Map(),
		ensureOverlayLayerOrder() {}, resizeOverlay() {}, createSvgDrawingContext: () => null, getNextPageRenderSlot: () => null,
		getPageAnnotationBucket: () => ({ imageItems: [], strokes: [], textItems: [], shapes: [] }),
		getInlineTextPreviewItem: () => null,
		publishRenderedCanvas(source, target) { assert.notEqual(source, target); assert.ok(source.width * source.height <= 4 * 1024 * 1024); publications++; }
	});
	sut.redrawObjectErasePreview(1, [{}]);
	assert.equal(visibleClears, 0, "busy snapshots made erasing clear the visible frame before composition");
	assert.equal(publications, 1);
	const scratch = sut.objectEraseRenderCanvas;
	sut.redrawObjectErasePreview(1, [{}]);
	assert.equal(sut.objectEraseRenderCanvas, scratch, "erasing must reuse a single bounded scratch canvas");
});
async function checkSnapshotPublication() {
	const makeCanvas = () => ({ width: 512, height: 512 });
	let copies = 0, disposals = 0, retries = 0, resolveSnapshot;
	const target = { ...makeCanvas(), isConnected: true, getContext: () => ({ save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() { copies++; } }) };
	const surface = { pageNumber: 1, lastWidth: 512, lastHeight: 512, overlayEl: target, transientEl: makeCanvas() };
	const canvas = makeCanvas();
	const job = { pageNumber: 1, canvas, width: 512, height: 512, version: 1, inputEpoch: 1, frameKey: "current" };
	const sut = session(["publishPageRenderSnapshot", "releasePageCanvasResources"]);
	Object.assign(sut, {
		pageSurfaces: new Map([[1, surface]]), pageRenderSlots: new Map([[1, { canvases: [canvas], nextIndex: 0 }]]),
		snapshotCanvases: new Set(), pageRenderVersions: new Map([[1, 1]]), pageRenderPublications: new Map([[1, 1]]), pageRenderJobs: new Map(),
		renderInputEpoch: 1, publishedFrames: new WeakMap(), pendingRedrawPages: new Set([1]),
		createCanvasSnapshot: () => new Promise(resolve => { resolveSnapshot = resolve; }),
		getPageFrameKey: () => "current", hasActiveTransientRender: () => false, syncCanvasBackingSize() {},
		shouldKeepPageHot: () => true, schedulePageRedraw: () => retries++,
		cancelPageRenderJob(page) { this.pageRenderVersions.set(page, 2); this.pageRenderPublications.delete(page); },
		renderTelemetry: { recordRenderComplete() {}, recordRenderCancelled() {}, recordRenderIdle() {} }
	});
	let publishing = sut.publishPageRenderSnapshot(job, surface);
	assert.equal(sut.snapshotCanvases.has(canvas), true);
	resolveSnapshot({ image: {}, dispose() { disposals++; } });
	await publishing;
	assert.equal(copies, 1, "current frame was not published");
	assert.equal(disposals, 1);
	assert.equal(retries, 1, "a render waiting for a free buffer was never retried");
	assert.equal(sut.snapshotCanvases.size, 0);
	sut.pageRenderPublications.set(1, 1);
	publishing = sut.publishPageRenderSnapshot(job, surface);
	sut.releasePageCanvasResources(1);
	assert.equal(canvas.width, 512, "cold-page cleanup destroyed an in-flight snapshot");
	resolveSnapshot({ image: {}, dispose() { disposals++; } });
	await publishing;
	assert.equal(copies, 1, "cancelled zoom frame replaced newer content");
	assert.equal(disposals, 2);
	assert.equal(canvas.width, 1, "retired snapshot canvas retained its pixels");
	assert.equal(sut.snapshotCanvases.size, 0);
	console.log("PASS Async zoom publication preserves current frames, retires cancelled buffers, and retries waiting pages");
}
checkSnapshotPublication().catch(error => { failures.push(error.message); console.error("FAIL async zoom publication: " + error.message); }).finally(() => {
	if (failures.length) { console.error(failures.length + " handwriting regressions reproduced."); process.exitCode = 1; }
});
