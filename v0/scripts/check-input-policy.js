const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assertContains(fileName, content, needle, message) {
	if (!content.includes(needle)) {
		throw new Error(`${fileName}: ${message}\nMissing: ${needle}`);
	}
}

function assertNotContains(fileName, content, needle, message) {
	if (content.includes(needle)) {
		throw new Error(`${fileName}: ${message}\nUnexpected: ${needle}`);
	}
}

const mainTs = read("main.ts");
const typesTs = read("src/types.ts");
const configTs = read("src/config.ts");
const deviceUtilsTs = read("src/utils/deviceUtils.ts");
const pointerInputTs = read("src/pointer/pointerInput.ts");
const settingsControllerTs = read("src/settings/settingsController.ts");
const settingTabTs = read("src/settings/settingTab.ts");
const packageJson = JSON.parse(read("package.json"));
const builtMainPath = path.join(projectRoot, "main.js");
const builtMain = fs.existsSync(builtMainPath) ? fs.readFileSync(builtMainPath, "utf8") : "";

assertContains("src/types.ts", typesTs, "export type InkInputPolicy", "ink input policy type must exist");
assertContains("src/types.ts", typesTs, "inkInputPolicy: InkInputPolicy", "settings must persist the ink input policy");
assertContains("src/config.ts", configTs, "inkInputPolicy: \"allow-touch\"", "default policy must accept primary touch on iPad");
assertContains("src/config.ts", configTs, "pressureCaptureVersion: 1", "pressure capture changes must have a one-time settings migration marker");
assertContains("src/config.ts", configTs, "pressureMode: \"auto\"", "new installs must automatically use Pencil pressure and speed fallback");
assertContains("src/utils/deviceUtils.ts", deviceUtilsTs, "export function isAppleTouchPlatform", "Apple-only Pencil fallback detection must be platform-scoped");

assertContains("src/pointer/pointerInput.ts", pointerInputTs, "policy: InkInputPolicy = \"pen-mouse-stylus-touch\"", "pointer filter must accept an explicit policy");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "policy === \"allow-touch\"", "touch fallback policy must be implemented");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "policy === \"pen-mouse-only\"", "strict pen/mouse policy must be implemented");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "export function shouldCaptureInkPointerEvent", "stylus routing must be testable independently of the PDF viewer");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "export function shouldPanInkPointerEvent", "finger panning must be testable independently of the PDF viewer");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "export function isStylusLikePointerEvent", "WebKit Pencil fallback detection must be testable independently of the PDF viewer");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "export function isWebKitStylusTouch", "iOS Touch.touchType Pencil detection must be testable independently of the PDF viewer");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "event.isPrimary === false", "touch fallback must ignore secondary touches");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "if (inputMethod === \"touch\")", "touch pointers must use a dedicated admission path");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "policy === \"pen-mouse-only\" || event.isPrimary === false", "all primary touch must be admitted unless touch drawing is explicitly disabled");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, "event.getCoalescedEvents()", "touch input must recover coalesced iPad samples");
assertContains("src/pointer/pointerInput.ts", pointerInputTs, 'event.pointerType === "touch" || event.pointerType === "pen"', "Apple Pencil input must recover coalesced pressure samples");

assertContains("src/settings/settingsController.ts", settingsControllerTs, "normalizeInkInputPolicy", "settings loader must normalize policy values");
assertContains("src/settings/settingsController.ts", settingsControllerTs, "shouldMigrateLegacyPressure", "legacy simulated-pressure defaults must migrate to automatic capture once");
assertContains("src/settings/settingsController.ts", settingsControllerTs, "if (value === \"pen-mouse-stylus-touch\") {\n\t\treturn \"allow-touch\";", "legacy touch mode must migrate to the single finger-drawing mode");
assertContains("src/settings/settingsController.ts", settingsControllerTs, "getInkInputPolicy()", "settings controller must expose the selected policy");
assertContains("src/settings/settingTab.ts", settingTabTs, "Finger input", "settings UI must expose the policy in user language");
assertContains("src/settings/settingTab.ts", settingTabTs, ".addOption(\"allow-touch\", \"Draw with finger\")", "settings UI must expose clear finger drawing state");
assertContains("src/settings/settingTab.ts", settingTabTs, ".addOption(\"pen-mouse-only\", \"Pan with finger\")", "settings UI must expose clear finger panning state");

assertContains("main.ts", mainTs, "getInkInputPolicy(): InkInputPolicy", "plugin/session must expose policy accessors");
assertContains("main.ts", mainTs, "touchDrawing ? \"Finger draws\" : \"Finger pans\"", "iPad toolbar must expose the active finger input mode");
assertContains("main.ts", mainTs, "private toggleTabletTouchInputMode(): void", "iPad toolbar must switch input mode without leaving the document");
assertContains("main.ts", mainTs, "void this.plugin.updateBehaviorSettings({ inkInputPolicy: nextPolicy });", "iPad toolbar input mode must persist through plugin settings");
assertContains("main.ts", mainTs, "private getOverlayTouchAction(): string", "overlay must expose its pre-contact gesture policy");
assertContains("main.ts", mainTs, "return \"pinch-zoom\";", "annotation surfaces must reject stylus pan before pointerdown while preserving pinch zoom");
assertContains("main.ts", mainTs, "private handleFingerPanPointerDown(event: PointerEvent): boolean", "finger navigation must use a dedicated pan path in annotation mode");
assertContains("main.ts", mainTs, "pointerEvents: this.annotationMode ? \"auto\" : \"none\"", "the annotation surface must own single-contact input before WebKit can claim Pencil as a pan");
assertContains("main.ts", mainTs, "this.fingerPanFrameHandle = window.requestAnimationFrame", "finger panning must batch scroll writes to animation frames");
assertContains("main.ts", mainTs, "private startFingerPanInertia", "captured finger panning must retain native-like momentum");
assertContains("main.ts", mainTs, "this.redrawHistoryChangeImmediately(affectedPage);", "history actions must repaint their affected page synchronously");
assertContains("main.ts", mainTs, 'this.cancelPageRenderJobs("history changed")', "history actions must invalidate stale render publications");
assertContains("main.ts", mainTs, "shouldIgnoreInkPointerEvent(event, this.currentTool, this.getInkInputPolicy())", "native PDF pointer handling must pass the policy");
assertContains("main.ts", mainTs, "if (this.handleCapturedInkPointerDown(event))", "document capture must reserve Pencil input before fallback or native panning");
assertContains("main.ts", mainTs, "canvas = this.ensureSurfaceAtClientPoint(event.clientX, event.clientY)?.overlayEl ?? null;", "Pencil capture must resolve the annotation canvas from page coordinates");
assertContains("main.ts", mainTs, 'document.addEventListener("touchstart", this.handleDocumentTouchStart, { capture: true, passive: false });', "iOS Pencil identification must run before native touch scrolling");
assertContains("main.ts", mainTs, 'this.getInkInputPolicy() !== "pen-mouse-only" || !isAppleTouchPlatform()', "Android touchstart events must not enter the iOS Pencil recovery path");
assertContains("main.ts", mainTs, "this.handlePointerDownForCanvas(pendingPointer, surface.overlayEl, true);", "a Touch.touchType stylus signal must reclaim its pending pointer stream as ink");
assertContains("main.ts", mainTs, "if (startInertia) {\n\t\t\tthis.applyPendingFingerPan();\n\t\t} else {\n\t\t\tthis.fingerPanPendingDelta = { x: 0, y: 0 };\n\t\t}", "cancelling provisional finger pan during Pencil reclaim must discard queued scroll movement");
assertContains("main.ts", mainTs, "this.webKitStylusPointerId === event.pointerId", "reclaimed WebKit Pencil streams must preserve reported pressure");
assertContains("main.ts", mainTs, "event.stopImmediatePropagation();", "captured Pencil input must not reach the native PDF pan handlers");
assertContains("main.ts", mainTs, "canvas.setCssStyles({ touchAction: \"none\" })", "accepted ink pointers must disable browser gesture handling while drawing");
assertContains("main.ts", mainTs, "this.currentStroke && canvas && event.pointerType === \"touch\"", "touch pointer-up must preserve very short strokes");
assertContains("main.ts", mainTs, "if (this.activePdfPointerId !== null && this.activePdfPointerId !== event.pointerId)", "secondary pointers must not interrupt an active PDF interaction");
assertContains("main.ts", mainTs, "private moveSelectedTargetsWithinPage", "selection movement must use bounded whole-object translation");
assertContains("main.ts", mainTs, "const boundedDeltaX = clamp(deltaX, -bounds.left, 1 - bounds.right);", "selection movement must stop at the horizontal page edge without collapsing points");
assertContains("main.ts", mainTs, "const boundedDeltaY = clamp(deltaY, -bounds.top, 1 - bounds.bottom);", "selection movement must stop at the vertical page edge without collapsing points");
assertContains("main.ts", mainTs, `.${"${SESSION_ROOT_CLASS}"}, ${"${TOOLBAR_SELECTORS}"}`, "native PDF toolbar clicks must never enter fallback handwriting");
assertContains("main.ts", mainTs, "private isPointerTargetInsidePdfPage(target: Element): boolean", "fallback handwriting must verify that the event belongs to the active PDF page");
assertContains("main.ts", mainTs, "if (!viewContentEl?.contains(target))", "clicks from tabs, sidebars, and other Obsidian views must not start handwriting");
assertContains("main.ts", mainTs, '".pdf-native-annotator-synthetic-page[data-page-number]"', "added template pages must remain valid fallback handwriting targets");
assertContains("main.ts", mainTs, "if (!this.isPointerTargetInsidePdfPage(target)) {\n\t\t\treturn;\n\t\t}", "page ownership must be checked before screen coordinates can resolve a drawing surface");
assertContains("main.ts", mainTs, "if (this.handleFingerPanPointerDown(event)) {\n\t\t\treturn;\n\t\t}", "finger panning must be claimed before ink and fallback hit testing");
assertContains("main.ts", mainTs, 'behavior: isTabletWebKitTouchDevice() ? "auto" : "smooth"', "iPad page switching must avoid expensive long smooth-scroll animations");

const viewPointerMoveSource = mainTs.slice(
	mainTs.indexOf("private readonly handleViewPointerMove"),
	mainTs.indexOf("private readonly handleViewPointerLeave")
);
assertContains("main.ts handleViewPointerMove", viewPointerMoveSource, "shouldPanInkPointerEvent(event", "touch panning must bypass the eraser pointer preview");
assertContains("main.ts handleViewPointerMove", viewPointerMoveSource, "this.hideToolPreview();", "touch panning must immediately hide an existing eraser preview");
const fingerPanDownSource = mainTs.slice(
	mainTs.indexOf("private handleFingerPanPointerDown"),
	mainTs.indexOf("private readonly handleFingerPanPointerMove")
);
assertContains("main.ts handleFingerPanPointerDown", fingerPanDownSource, "this.hideToolPreview();", "starting a finger pan must hide the eraser preview");
const fingerPanFrameSource = mainTs.slice(
	mainTs.indexOf("private applyPendingFingerPan"),
	mainTs.indexOf("private readonly handleFingerPanPointerUp")
);
for (const forcedLayoutRead of ["scrollWidth", "clientWidth", "scrollHeight", "clientHeight"]) {
	assertNotContains("main.ts applyPendingFingerPan", fingerPanFrameSource, forcedLayoutRead, "finger-pan frames must not force layout to clamp browser-managed scroll positions");
}
const fingerPanInertiaSource = mainTs.slice(
	mainTs.indexOf("private startFingerPanInertia"),
	mainTs.indexOf("private cancelFingerPanInertia")
);
for (const forcedLayoutRead of ["scrollWidth", "clientWidth", "scrollHeight", "clientHeight"]) {
	assertNotContains("main.ts startFingerPanInertia", fingerPanInertiaSource, forcedLayoutRead, "finger-pan inertia frames must not force layout to clamp browser-managed scroll positions");
}
assertContains("main.ts", mainTs, "private activePdfPointerRect: DOMRect | null = null;", "active ink must cache its page geometry for the pointer stream");
const normalizedPointsSource = mainTs.slice(
	mainTs.indexOf("private getNormalizedPoints"),
	mainTs.indexOf("private getStrokeMergeThreshold")
);
assertContains("main.ts getNormalizedPoints", normalizedPointsSource, "this.activePdfPointerRect", "ink moves must reuse cached page geometry instead of forcing layout per sample batch");

assertContains("package.json", JSON.stringify(packageJson.scripts), "check:input", "package scripts must expose this verifier");

if (builtMain) {
	assertContains("main.js", builtMain, "Finger input", "built bundle must include the settings UI");
	assertContains("main.js", builtMain, "Draw with finger", "built bundle must include the iPad finger drawing setting");
	assertContains("main.js", builtMain, "Pan with finger", "built bundle must include the iPad finger panning setting");
	assertContains("main.js", builtMain, "pen-mouse-only", "built bundle must include strict policy handling");
}

const transpiledPointerInput = ts.transpileModule(pointerInputTs, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2018,
		skipLibCheck: true
	}
});
const pointerModule = { exports: {} };
let appleTouchPlatform = true;
const pointerRequire = (request) => {
	if (request === "../utils/deviceUtils") {
		return {
			calculateVelocity: (firstX, firstY, secondX, secondY, deltaTimeMs) => Math.hypot(secondX - firstX, secondY - firstY) / deltaTimeMs,
			estimatePressureFromVelocity: (velocity) => Math.max(0.2, Math.min(1, 1 - (velocity * 0.2))),
			getInputMethod: (event) => event.pointerType || "unknown",
			isTabletWebKitTouchDevice: () => true,
			isAppleTouchPlatform: () => appleTouchPlatform
		};
	}
	if (request === "../utils/general") {
		return { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) };
	}
	if (request === "../tools/toolState") {
		return { isShapeTool: () => false };
	}
	throw new Error(`Unexpected pointer-input dependency: ${request}`);
};
vm.runInNewContext(transpiledPointerInput.outputText, {
	require: pointerRequire,
	module: pointerModule,
	exports: pointerModule.exports,
	console
}, { filename: "pointerInput.check.cjs" });
const pointerInput = pointerModule.exports;
const primaryTouch = { pointerType: "touch", isPrimary: true, pressure: 0.5, button: 0 };
const secondaryTouch = { ...primaryTouch, isPrimary: false };
const stylus = { pointerType: "pen", isPrimary: true, pressure: 0.5, button: 0 };
const webkitStylusTouch = {
	...primaryTouch,
	pressure: 0.72,
	width: 2,
	height: 2,
	tiltX: 18,
	tiltY: 4
};
const forcefulFinger = {
	...primaryTouch,
	pressure: 0.72,
	width: 24,
		height: 24,
	altitudeAngle: Math.PI / 2,
	azimuthAngle: 0
};
const compactAndroidFinger = {
	...primaryTouch,
	pressure: 0.72,
	width: 4,
	height: 4
};
if (pointerInput.shouldIgnoreInkPointerEvent(primaryTouch, "pen", "allow-touch")) {
	throw new Error("primary iPad touch was rejected in touch drawing mode");
}
if (pointerInput.shouldIgnoreInkPointerEvent(primaryTouch, "pen", "pen-mouse-stylus-touch")) {
	throw new Error("legacy default mode rejected primary iPad touch");
}
if (!pointerInput.shouldIgnoreInkPointerEvent(secondaryTouch, "pen", "allow-touch")) {
	throw new Error("secondary touch was admitted as handwriting");
}
if (!pointerInput.shouldIgnoreInkPointerEvent(primaryTouch, "pen", "pen-mouse-only")) {
	throw new Error("strict pen/mouse mode admitted touch");
}
if (!pointerInput.shouldCaptureInkPointerEvent(stylus, "pen", "pen-mouse-only")) {
	throw new Error("strict finger-pan mode did not reserve Apple Pencil for ink");
}
if (!pointerInput.shouldCaptureInkPointerEvent(primaryTouch, "pen", "allow-touch")) {
	throw new Error("finger drawing mode did not reserve primary touch before the PDF viewer");
}
if (!pointerInput.shouldCaptureInkPointerEvent(primaryTouch, "pen", "pen-mouse-stylus-touch")) {
	throw new Error("legacy finger drawing mode did not reserve primary touch before the PDF viewer");
}
if (pointerInput.shouldCaptureInkPointerEvent(primaryTouch, "pen", "pen-mouse-only")) {
	throw new Error("strict finger-pan mode captured finger input instead of leaving it to native pan");
}
if (!pointerInput.isStylusLikePointerEvent(webkitStylusTouch)
	|| pointerInput.shouldIgnoreInkPointerEvent(webkitStylusTouch, "pen", "pen-mouse-only")
	|| !pointerInput.shouldCaptureInkPointerEvent(webkitStylusTouch, "pen", "pen-mouse-only")
	|| pointerInput.shouldPanInkPointerEvent(webkitStylusTouch, "pen", "pen-mouse-only")) {
	throw new Error("WebKit Pencil touch fallback was not reserved exclusively for ink");
}
if (pointerInput.isStylusLikePointerEvent(forcefulFinger)
	|| !pointerInput.shouldIgnoreInkPointerEvent(forcefulFinger, "pen", "pen-mouse-only")
	|| !pointerInput.shouldPanInkPointerEvent(forcefulFinger, "pen", "pen-mouse-only")) {
	throw new Error("broad finger contact was misclassified as Apple Pencil");
}
if (!pointerInput.isWebKitStylusTouch({ touchType: "stylus" })) {
	throw new Error("iOS Touch.touchType stylus was not identified as Apple Pencil");
}
if (pointerInput.isWebKitStylusTouch({
	touchType: "direct",
	force: 0.72,
	radiusX: 12,
	radiusY: 12,
	altitudeAngle: Math.PI / 2,
	azimuthAngle: 0
})) {
	throw new Error("a direct broad iOS finger touch was identified as Apple Pencil");
}
if (pointerInput.shouldCaptureInkPointerEvent({ ...stylus, pointerType: "mouse" }, "pen", "pen-mouse-only")) {
	throw new Error("mouse input was unnecessarily captured at the document boundary");
}
if (!pointerInput.shouldPanInkPointerEvent(primaryTouch, "pen", "pen-mouse-only")) {
	throw new Error("strict finger-pan mode did not route primary finger input to the PDF pan controller");
}
if (pointerInput.shouldPanInkPointerEvent(secondaryTouch, "pen", "pen-mouse-only")) {
	throw new Error("secondary touch was incorrectly admitted as a PDF pan controller");
}
if (pointerInput.shouldPanInkPointerEvent(stylus, "pen", "pen-mouse-only")) {
	throw new Error("Apple Pencil was incorrectly routed through finger panning");
}
if (pointerInput.shouldPanInkPointerEvent(primaryTouch, "pen", "allow-touch")) {
	throw new Error("finger drawing mode incorrectly routed touch through panning");
}
appleTouchPlatform = false;
if (pointerInput.isStylusLikePointerEvent(compactAndroidFinger)
	|| !pointerInput.shouldIgnoreInkPointerEvent(compactAndroidFinger, "pen", "pen-mouse-only")
	|| !pointerInput.shouldPanInkPointerEvent(compactAndroidFinger, "pen", "pen-mouse-only")
	|| pointerInput.shouldCaptureInkPointerEvent(compactAndroidFinger, "pen", "pen-mouse-only")) {
	throw new Error("Android compact finger was misclassified as Pencil instead of finger pan");
}
appleTouchPlatform = true;
const lightPencilPressure = pointerInput.resolvePointerPressure({ ...stylus, pressure: 0.14 }, null, 0, "auto");
const firmPencilPressure = pointerInput.resolvePointerPressure({ ...stylus, pressure: 0.86 }, null, 0, "auto");
if (!(firmPencilPressure > lightPencilPressure + 0.6)) {
	throw new Error(`automatic Pencil pressure was flattened (${lightPencilPressure} -> ${firmPencilPressure})`);
}
const webkitPencilPressure = pointerInput.resolvePointerPressure(webkitStylusTouch, null, 0, "auto");
if (Math.abs(webkitPencilPressure - webkitStylusTouch.pressure) > 0.001) {
	throw new Error(`WebKit Pencil pressure was replaced by touch fallback (${webkitPencilPressure})`);
}
const bridgedPencilPressure = pointerInput.resolvePointerPressure(
	{ ...primaryTouch, pressure: 0.68 },
	null,
	0,
	"auto",
	true
);
if (Math.abs(bridgedPencilPressure - 0.68) > 0.001) {
	throw new Error(`Touch.touchType Pencil pressure was replaced by finger fallback (${bridgedPencilPressure})`);
}
const slowMousePressure = pointerInput.resolvePointerPressure(
	{ pointerType: "mouse", pressure: 0.5, clientX: 1, clientY: 0, timeStamp: 100 },
	{ clientX: 0, clientY: 0 },
	0,
	"simulate"
);
const fastMousePressure = pointerInput.resolvePointerPressure(
	{ pointerType: "mouse", pressure: 0.5, clientX: 50, clientY: 0, timeStamp: 10 },
	{ clientX: 0, clientY: 0 },
	0,
	"simulate"
);
if (!(slowMousePressure > fastMousePressure + 0.5)) {
	throw new Error(`simulated speed pressure was flattened (${slowMousePressure} -> ${fastMousePressure})`);
}
const coalescedTouch = {
	...primaryTouch,
	clientX: 3,
	clientY: 3,
	timeStamp: 3,
	getCoalescedEvents: () => [
		{ ...primaryTouch, clientX: 1, clientY: 1, timeStamp: 1 },
		{ ...primaryTouch, clientX: 2, clientY: 2, timeStamp: 2 }
	]
};
const recoveredSamples = pointerInput.getCoalescedPointerEvents(coalescedTouch);
if (recoveredSamples.length !== 3 || recoveredSamples[2] !== coalescedTouch) {
	throw new Error(`touch coalescing lost the dispatched sample (${recoveredSamples.length} samples)`);
}
const coalescedPencil = {
	...stylus,
	clientX: 3,
	clientY: 3,
	timeStamp: 3,
	getCoalescedEvents: coalescedTouch.getCoalescedEvents
};
if (pointerInput.getCoalescedPointerEvents(coalescedPencil).length !== 3) {
	throw new Error("Apple Pencil coalesced pressure samples were not recovered");
}

console.log(`Input-policy verifier passed. recoveredTouchSamples=${recoveredSamples.length}; pencilPressure=${lightPencilPressure.toFixed(2)}-${firmPencilPressure.toFixed(2)}; simulatedPressure=${fastMousePressure.toFixed(2)}-${slowMousePressure.toFixed(2)}`);
