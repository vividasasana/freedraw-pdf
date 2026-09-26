const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const modules = new Map();
const settingsTimers = new Map();
function load(file) {
	if (modules.has(file)) return modules.get(file).exports;
	const module = { exports: {} };
	modules.set(file, module);
	vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
	}).outputText, {
		module, exports: module.exports, console,
		window: {
			setTimeout(fn) { const id = settingsTimers.size + 1; settingsTimers.set(id, fn); return id; },
			clearTimeout(id) { settingsTimers.delete(id); }
		},
		require: name => load(path.resolve(path.dirname(file), name + ".ts"))
	}, { filename: file });
	return module.exports;
}
const input = load(path.join(root, "src/pointer/pointerInput.ts"));
const source = fs.readFileSync(path.join(root, "main.ts"), "utf8");
const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const sessionClass = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "NativePdfAnnotatorSession");
const names = ["handleDocumentPointerDown", "handleCapturedInkPointerDown", "handleFallbackPointerDown",
	"handleFingerPanPointerDown", "handleFingerPanPointerMove", "applyPendingFingerPan", "handleDocumentTouchStart",
	"rememberPotentialWebKitStylusPointer", "clearPendingWebKitTouchPointer", "finishFingerPan"];
const members = sessionClass.members.filter(member => names.includes(member.name?.getText(tree)));
assert.equal(members.length, names.length);
const globals = { ...input, performance, OVERLAY_CLASS: "overlay", SESSION_ROOT_CLASS: "toolbar", TOOLBAR_SELECTORS: ".toolbar",
	isDomElement: element => !!element, isHtmlCanvasElement: element => element?.canvas === true };
vm.runInNewContext(ts.transpileModule(`class Session {${members.map(member => member.getText(tree)).join("\n")}} globalThis.Session = Session;`, {
	compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, globals);

function fixture(policy = "pen-mouse-only", tool = "pen") {
	const session = new globals.Session(), frames = new Map(), timers = new Map();
	const scroll = { isConnected: true, scrollTop: 0, scrollLeft: 0 };
	let nextId = 1, inkStarts = 0, stylusReclaims = 0;
	const canvas = { canvas: true, setPointerCapture() {}, releasePointerCapture() {} };
	const target = { closest: selector => selector === ".overlay" ? canvas : null };
	const surface = { overlayEl: canvas };
	Object.assign(session, {
		annotationMode: true, currentTool: tool, activePdfPointerId: null, pointerPage: null,
		fingerPanPointerId: null, fingerPanFrameHandle: null, pendingWebKitTouchHandle: null,
		fingerPanPendingDelta: { x: 0, y: 0 }, fingerPanVelocity: { x: 0, y: 0 }, scrollParent: scroll,
		getInkInputPolicy: () => policy, getViewContentEl: () => ({ contains: () => true }),
		isPointerTargetInsidePdfPage: () => true, ensureSurfaceAtClientPoint: () => surface,
		ownerDocument: { addEventListener() {}, removeEventListener() {} },
		ownerWindow: {
			setTimeout(fn) { const id = nextId++; timers.set(id, fn); return id; },
			clearTimeout(id) { timers.delete(id); },
			requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
			cancelAnimationFrame(id) { frames.delete(id); }
		},
		hideToolPreview() {}, cancelFingerPanInertia() {}, pauseCommittedRenderingForViewportMotion() {},
		resumeCommittedRenderingAfterFingerPan() {},
		handlePointerDownForCanvas(event, canvas, forceStylus) { inkStarts++; stylusReclaims += Number(!!forceStylus); }
	});
	const event = (properties = {}) => ({
		pointerType: "touch", pointerId: 1, isPrimary: true, button: 0,
		clientX: 100, clientY: 200, pressure: .5, width: 5, height: 5, timeStamp: 1,
		target, preventDefault() {}, stopImmediatePropagation() {}, ...properties
	});
	return { session, scroll, event,
		flush() { for (const [id, callback] of frames) { frames.delete(id); callback(); } },
		counts: () => ({ inkStarts, stylusReclaims }) };
}

// Simulated driver fields, not values extracted from the reporters' videos.
// Exercise the real document pointerdown -> provisional pan -> touchstart reclaim chain.
const cases = [
	["ordinary touch", {}, {}],
	["compact forceful touch", {}, { radiusX: 3, radiusY: 3, force: .7 }],
	["unlabelled compact touch", {}, { touchType: undefined, radiusX: 3, radiusY: 3, force: .7 }],
	["touch with tilt", { tiltX: 12, tiltY: 4 }, {}],
	["touch with angle", { altitudeAngle: .6, azimuthAngle: .4 }, {}],
	["touch with WebKit force", { webkitForce: .7 }, {}],
	["direct touch with angle", {}, { altitudeAngle: .6, azimuthAngle: .4 }]
];
const failures = [];
for (const tool of ["pen", "highlighter", "eraser", "rectangle", "ellipse", "line"]) for (const [name, pointerFields, touchFields] of cases) {
	try {
		const f = fixture("pen-mouse-only", tool);
		f.session.handleDocumentPointerDown(f.event(pointerFields));
		f.session.handleDocumentTouchStart({ ...f.event(), changedTouches: [{ clientX: 100, clientY: 200, touchType: "direct", ...touchFields }] });
		f.session.handleFingerPanPointerMove(f.event({ clientY: 100, timeStamp: 17 }));
		f.flush();
		assert.equal(f.counts().inkStarts, 0, "finger-pan gesture started ink");
		assert.equal(f.scroll.scrollTop, 100, "finger gesture did not scroll");
		if (tool === "pen") console.log(`PASS ${name}: scroll=100, ink=0`);
	} catch (error) { failures.push(`${tool}/${name}: ${error.message}`); }
}
for (const policy of ["pen-mouse-only", "allow-touch"]) {
	const f = fixture(policy);
	f.session.handleDocumentPointerDown(f.event({ pointerType: "pen", pressure: .8 }));
	assert.equal(f.counts().inkStarts, 1, "explicit pen must draw in either mode");
	assert.equal(f.scroll.scrollTop, 0);
}
const draw = fixture("allow-touch");
draw.session.handleDocumentPointerDown(draw.event());
assert.equal(draw.counts().inkStarts, 1, "finger drawing mode must still draw");
const pencil = fixture();
pencil.session.handleDocumentPointerDown(pencil.event());
pencil.session.handleFingerPanPointerMove(pencil.event({ clientY: 150, timeStamp: 10 }));
pencil.session.handleDocumentTouchStart({ ...pencil.event(), changedTouches: [{ clientX: 100, clientY: 200, touchType: "stylus" }] });
pencil.flush();
assert.equal(pencil.counts().stylusReclaims, 1, "explicit Apple Pencil touch marker must reclaim ink");
assert.equal(pencil.scroll.scrollTop, 0, "Pencil reclaim must discard the queued pan frame");
assert.equal(pencil.session.fingerPanPointerId, null);
for (const marker of ["touchType", "webkitTouchType"]) {
	const explicit = fixture();
	explicit.session.handleDocumentPointerDown(explicit.event({ [marker]: "stylus" }));
	assert.equal(explicit.counts().inkStarts, 1, "explicit stylus pointer marker must draw");
}
const secondary = fixture();
secondary.session.handleDocumentPointerDown(secondary.event({ isPrimary: false }));
assert.equal(secondary.counts().inkStarts, 0, "secondary finger must not create ink");
assert.equal(secondary.session.fingerPanPointerId, null, "secondary finger must not own primary pan");
if (failures.length) throw new Error("Issue #2 replay failed:\n" + failures.join("\n"));
async function checkSettings() {
	const { PDFAnnotatorSettingsController } = load(path.join(root, "src/settings/settingsController.ts"));
	for (const showDrawingNotices of [false, true]) {
		const controller = new PDFAnnotatorSettingsController(
			async () => ({ inkInputPolicy: "pen-mouse-only", showDrawingNotices }), async () => {}, () => {}
		);
		await controller.load();
		assert.equal(controller.getInkInputPolicy(), "pen-mouse-only", "settings migration must retain an explicit finger-pan choice");
		controller.dispose();
	}
	assert.equal(settingsTimers.size, 0);
	console.log("Issue #2 replay passed: 42 finger-pan cases; pen/Pencil, finger drawing, secondary touch and saved pan settings preserved.");
}
checkSettings().catch(error => { console.error(error); process.exitCode = 1; });
