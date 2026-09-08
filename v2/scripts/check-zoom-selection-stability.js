const fs = require("fs");
const path = require("path");
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

function methodSource(source, signature, nextSignature) {
	const start = source.indexOf(signature);
	if (start < 0) {
		throw new Error(`main.ts: missing ${signature}`);
	}
	const end = source.indexOf(nextSignature, start + signature.length);
	return source.slice(start, end < 0 ? source.length : end);
}

const mainTs = read("main.ts");
const stylesCss = read("styles.css");

const syntheticPageRuleStart = stylesCss.indexOf(".pdf-native-annotator-synthetic-page {");
const syntheticPageRuleEnd = stylesCss.indexOf("}", syntheticPageRuleStart);
const syntheticPageRule = stylesCss.slice(syntheticPageRuleStart, syntheticPageRuleEnd + 1);
if (syntheticPageRule.includes("max-width: 100%;")) {
	throw new Error("styles.css: extreme zoom clamps only synthetic page width and squeezes normalized strokes horizontally");
}

const resizeOverlay = methodSource(
	mainTs,
	"private resizeOverlay(",
	"private syncPdfPageTemplateBackground("
);
const backgroundSyncIndex = resizeOverlay.indexOf("this.syncPdfPageTemplateBackground(surface, width, height);");
const stableSizeReturnIndex = resizeOverlay.indexOf("if (!sizeChanged && preserveVisibleFrame)");
if (backgroundSyncIndex < 0 || stableSizeReturnIndex < 0 || backgroundSyncIndex > stableSizeReturnIndex) {
	throw new Error("main.ts: page backgrounds must be restored before a same-size overlay resize returns early");
}

assertContains(
	"main.ts",
	mainTs,
	"this.resizeInlineTextEditorForSurface(surface, previousWidth, previousHeight);",
	"active text frames must be repositioned from normalized coordinates when zoom changes"
);
const previewResize = methodSource(mainTs, "private previewResizeOverlay(", "private syncCanvasBackingSize(");
assertContains(
	"main.ts",
	previewResize,
	"this.resizeInlineTextEditorForSurface(surface, previousWidth, previousHeight, width, height);",
	"active text frames must track the lightweight zoom preview instead of snapping after zoom settles"
);
assertContains(
	"main.ts",
	previewResize,
	"const previewScale = width / Math.max(surface.lastWidth, 1);",
	"zoom preview must scale the existing annotation frame uniformly instead of reshaping it"
);
assertContains(
	"main.ts",
	previewResize,
	"transform: `scale(${previewScale})`",
	"zoom preview must preserve committed stroke geometry with one uniform transform"
);
assertContains(
	"main.ts",
	mainTs,
	"this.applyInlineTextEditorScale(editor, nextWidth);",
	"the active editor font and padding must follow the same zoom scale as its frame"
);
assertContains(
	"main.ts",
	mainTs,
	"this.applyCssTemplateBackground(backgroundEl, width, page.paperColor);",
	"synthetic pages must use scalable CSS templates instead of regenerating large bitmap backgrounds during zoom"
);
if (mainTs.includes("createTemplatePageBackgroundDataUrl")) {
	throw new Error("main.ts: zoom must not regenerate template PNG data URLs on the UI thread");
}
assertContains(
	"main.ts",
	mainTs,
	"captureZoomPageAnchor(",
	"zoom must capture a stable page identity and within-page offset before layout changes"
);
assertContains(
	"main.ts",
	mainTs,
	"resolveZoomPageScrollTop(",
	"zoom restoration must target the anchored page instead of the document origin"
);
assertContains(
	"main.ts",
	mainTs,
	'viewContentEl.addEventListener("touchstart", this.handleZoomGestureTouchStart, { capture: true, passive: true });',
	"two-finger zoom must capture its page anchor before native pinch layout begins"
);
assertContains(
	"main.ts",
	mainTs,
	'viewContentEl.addEventListener("wheel", this.handleZoomGestureWheel, { capture: true, passive: true });',
	"trackpad pinch must capture its page anchor before PDF scale events"
);
assertContains(
	"main.ts",
	mainTs,
	'viewContentEl.addEventListener("gesturestart", this.handleZoomGestureStart, { capture: true, passive: true });',
	"iPad WebKit gesture zoom must capture its page anchor before native pinch layout begins"
);
assertContains(
	"main.ts",
	mainTs,
	'viewContentEl?.removeEventListener("touchstart", this.handleZoomGestureTouchStart, { capture: true });',
	"gesture anchor listeners must be removed with the PDF session"
);
const captureZoomAnchor = methodSource(mainTs, "private captureZoomScrollAnchor(", "private scheduleZoomScrollAnchorRestore(");
assertContains(
	"main.ts",
	captureZoomAnchor,
	"if (this.zoomScrollAnchor) {",
	"continuous pinch updates must retain the first stable page anchor until the zoom burst settles"
);
const scheduleZoomAnchorRestore = methodSource(
	mainTs,
	"private scheduleZoomScrollAnchorRestore(",
	"private restoreZoomScrollAnchor("
);
const scheduledZoomRestoreFrames = scheduleZoomAnchorRestore.split("this.ownerWindow.requestAnimationFrame(").length - 1;
if (scheduledZoomRestoreFrames !== 1) {
	throw new Error(
		`Pinch zoom anchor restoration must happen before the next paint; found ${scheduledZoomRestoreFrames} queued frames.`
	);
}
const observePageSurface = methodSource(mainTs, "private observePageSurface(", "private markPageZooming(");
assertContains(
	"main.ts",
	observePageSurface,
	"this.zoomScrollAnchor?.pageNumber === surface.pageNumber",
	"only the anchored page may correct scroll position during a pinch"
);
assertContains(
	"main.ts",
	observePageSurface,
	"this.restoreZoomScrollAnchor();",
	"the anchored page must correct scroll position inside ResizeObserver before the wrong page is painted"
);
assertContains(
	"main.ts",
	observePageSurface,
	"this.scheduleSyntheticPageZoomPreview();",
	"real and synthetic pages must receive the same zoom update frame"
);
const anchorBranchStart = observePageSurface.indexOf("if (this.zoomScrollAnchor?.pageNumber === surface.pageNumber)");
const scheduledRestoreAfterAnchor = observePageSurface.indexOf("this.scheduleZoomScrollAnchorRestore();", anchorBranchStart);
if (scheduledRestoreAfterAnchor >= 0) {
	throw new Error("main.ts: queued anchor restoration permits a visible jump before correction");
}
const markRealPagesZooming = methodSource(mainTs, "private markRealPagesZooming(", "private captureZoomScrollAnchor(");
assertContains(
	"main.ts",
	markRealPagesZooming,
	"this.shouldKeepPageHot(pageNumber)",
	"zoom bookkeeping must remain limited to visible or otherwise hot pages"
);
const syntheticZoomPreview = methodSource(
	mainTs,
	"private previewSyntheticPageZoom(",
	"private applyPaperTemplateCssVariables("
);
if (syntheticZoomPreview.includes("this.getRealPdfPageElements(")) {
	throw new Error("main.ts: every pinch frame must not scan and measure the full PDF page DOM");
}
assertContains(
	"main.ts",
	syntheticZoomPreview,
	"this.getSyntheticPreviewReferenceWidth(anchorPageNumber)",
	"synthetic zoom must resolve reference width from a bounded set of cached page surfaces"
);
assertContains(
	"main.ts",
	mainTs,
	"private getSelectionCursorAtPoint(",
	"selection mode must derive its cursor from the action available under the pointer"
);
assertContains(
	"main.ts",
	mainTs,
	'return hit ? "move" : "crosshair";',
	"selectable objects must advertise movement while empty selection space advertises area selection"
);
const selectionRegionHit = methodSource(mainTs, "private getSelectedRegionHit(", "private getSelectionCursorAtPoint(");
assertContains(
	"main.ts",
	selectionRegionHit,
	"pointInBounds(point, selectedBounds)",
	"the full interior of an existing selection must own the move cursor instead of starting another cross selection"
);
assertContains(
	"main.ts",
	mainTs,
	"?? this.getSelectedRegionHit(pageNumber, point);",
	"pointer down inside the full selected bounds must start moving rather than begin a new box or lasso selection"
);
assertContains(
	"main.ts",
	mainTs,
	"this.updateOverlayCursorForPointer(event);",
	"pointer movement must refresh the action cursor"
);
assertContains(
	"main.ts",
	mainTs,
	"resolveOverlayModeCursor(",
	"overlay refreshes must preserve an action-aware select cursor instead of flashing back to crosshair"
);
assertContains(
	"main.ts",
	mainTs,
	"this.moveSelectedTargetsWithinPage(this.selectedTargets, deltaX, deltaY);",
	"dragging a selected image or annotation must translate the selected target"
);
assertContains(
	"main.ts",
	mainTs,
	"(this.annotationDocument.imageItems ?? []).length - 1",
	"image annotations must participate in selection hit-testing"
);

const applyOverlayMode = methodSource(mainTs, "private applyOverlayMode(", "private applySelectionMode(");
if (applyOverlayMode.includes('? "grab"')) {
	throw new Error("main.ts: select mode must not display a permanent pan/grab cursor");
}

const selectionDrawing = methodSource(mainTs, "private drawSelection(", "private drawStroke(");
if (selectionDrawing.includes("#4da3ff") || selectionDrawing.includes("powerpointTextSelection")) {
	throw new Error("main.ts: every annotation selection must use the same neutral text-style outline");
}
assertContains(
	"main.ts",
	selectionDrawing,
	"context.strokeStyle = SELECTION_OUTLINE_COLOR;",
	"all selection outlines must use the text selection colour"
);
const lassoDrawing = methodSource(mainTs, "private drawLasso(", "private drawFocusedRegion(");
if (lassoDrawing.includes("#4da3ff") || lassoDrawing.includes("77, 163, 255")) {
	throw new Error("main.ts: box and lasso selection previews must use the same neutral selection style");
}
assertContains(
	"main.ts",
	lassoDrawing,
	"context.strokeStyle = SELECTION_OUTLINE_COLOR;",
	"selection-area previews must use the text selection colour"
);
const focusedRegionDrawing = methodSource(mainTs, "private drawFocusedRegion(", "private drawShape(");
if (focusedRegionDrawing.includes("#4da3ff") || focusedRegionDrawing.includes("77, 163, 255")) {
	throw new Error("main.ts: completed region boxes must not revert to the old blue selection style");
}
assertContains(
	"main.ts",
	focusedRegionDrawing,
	"context.strokeStyle = SELECTION_OUTLINE_COLOR;",
	"completed region boxes must share the neutral selection outline"
);
assertContains(
	"main.ts",
	focusedRegionDrawing,
	"context.setLineDash(SELECTION_LINE_DASH);",
	"completed region boxes must share the fine dotted selection line"
);
assertContains(
	"main.ts",
	selectionDrawing,
	"context.setLineDash(SELECTION_LINE_DASH);",
	"all selection outlines must use the text selection dash pattern"
);

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
const {
	getRenderedTextFontSize,
	getRenderedTextPadding,
	getZoomStableTextFrameLayout
} = require(path.join(projectRoot, "src", "text", "textLayout.ts"));
const { resolveOverlayModeCursor } = require(path.join(projectRoot, "src", "interaction", "cursorState.ts"));
const {
	captureZoomPageAnchor,
	isTrackpadPinchWheel,
	resolveZoomPageScrollTop
} = require(path.join(projectRoot, "src", "pdf", "zoomAnchor.ts"));
const { resolvePdfPageContentWidth } = require(path.join(projectRoot, "src", "pdf", "pdfDom.ts"));
if (previousTypeScriptLoader) {
	require.extensions[".ts"] = previousTypeScriptLoader;
} else {
	delete require.extensions[".ts"];
}

if (typeof getZoomStableTextFrameLayout !== "function") {
	throw new Error("src/text/textLayout.ts: missing zoom-stable inline text frame layout helper");
}
if (typeof getRenderedTextPadding !== "function") {
	throw new Error("src/text/textLayout.ts: missing zoom-stable text padding helper");
}
if (typeof resolveOverlayModeCursor !== "function") {
	throw new Error("src/interaction/cursorState.ts: missing stable overlay cursor resolver");
}
if (typeof captureZoomPageAnchor !== "function" || typeof resolveZoomPageScrollTop !== "function") {
	throw new Error("src/pdf/zoomAnchor.ts: missing stable page-relative zoom anchor helpers");
}
if (typeof resolvePdfPageContentWidth !== "function") {
	throw new Error("src/pdf/pdfDom.ts: missing visible PDF canvas width resolver");
}
const visibleCanvasWidth = resolvePdfPageContentWidth({
	canvasRectWidth: 920,
	canvasClientWidth: 920,
	hostRectWidth: 920,
	hostClientWidth: 920,
	pageRectWidth: 928,
	pageClientWidth: 928
});
if (visibleCanvasWidth !== 920) {
	throw new Error(`Synthetic page matched the PDF viewer frame instead of its visible paper: ${visibleCanvasWidth}`);
}
if (
	typeof isTrackpadPinchWheel !== "function" ||
	!isTrackpadPinchWheel({ ctrlKey: true, metaKey: false }) ||
	!isTrackpadPinchWheel({ ctrlKey: false, metaKey: true }) ||
	isTrackpadPinchWheel({ ctrlKey: false, metaKey: false })
) {
	throw new Error("Trackpad pinch detection must not treat ordinary wheel scrolling as zoom.");
}
if (
	resolveOverlayModeCursor("select", "select", "move", "crosshair") !== "move" ||
	resolveOverlayModeCursor("select", "select", "nwse-resize", "crosshair") !== "nwse-resize" ||
	resolveOverlayModeCursor("select", "eraser", "cell", "crosshair") !== "crosshair" ||
	resolveOverlayModeCursor("eraser", "select", "move", "cell") !== "cell"
) {
	throw new Error("Overlay refreshes can alternate between crosshair and the active selection cursor.");
}

const pageSevenAnchor = captureZoomPageAnchor(7, 7350, 7200, 1000);
if (pageSevenAnchor.pageNumber !== 7 || Math.abs(pageSevenAnchor.offsetRatio - 0.15) > 1e-9) {
	throw new Error(`Zoom captured the wrong page-relative anchor: ${JSON.stringify(pageSevenAnchor)}`);
}
const zoomedInScrollTop = resolveZoomPageScrollTop(pageSevenAnchor, 10800, 1500, 20000);
const zoomedOutScrollTop = resolveZoomPageScrollTop(pageSevenAnchor, 3600, 500, 9000);
if (zoomedInScrollTop !== 11025 || zoomedOutScrollTop !== 3675) {
	throw new Error(`Zoom restored toward page 1 instead of page 7: ${zoomedInScrollTop}, ${zoomedOutScrollTop}`);
}

const fullWidth = 720;
const halfWidth = 360;
const fullFontSize = getRenderedTextFontSize(0.018, fullWidth);
const halfFontSize = getRenderedTextFontSize(0.018, halfWidth);
const fullPadding = getRenderedTextPadding(10, fullWidth);
const halfPadding = getRenderedTextPadding(10, halfWidth);
if (
	Math.abs((halfFontSize / fullFontSize) - 0.5) > 1e-9 ||
	Math.abs((halfPadding / fullPadding) - 0.5) > 1e-9
) {
	throw new Error(
		`Zoom changed text wrapping proportions: font ${fullFontSize}->${halfFontSize}, padding ${fullPadding}->${halfPadding}`
	);
}

const origin = { x: 0.37, y: 0.22 };
const widthScale = 0.28;
const heightScale = 0.12;
for (const [pageWidth, pageHeight] of [[1200, 1600], [600, 800], [1450, 1933], [900, 1200]]) {
	const layout = getZoomStableTextFrameLayout(origin, widthScale, heightScale, pageWidth, pageHeight);
	if (
		Math.abs((layout.left / pageWidth) - origin.x) > 1e-9 ||
		Math.abs((layout.top / pageHeight) - origin.y) > 1e-9 ||
		Math.abs((layout.width / pageWidth) - widthScale) > 1e-9 ||
		Math.abs((layout.height / pageHeight) - heightScale) > 1e-9
	) {
		throw new Error(`Zoom changed normalized text geometry: ${JSON.stringify(layout)}`);
	}
}

console.log("Zoom and selection stability verifier passed.");
