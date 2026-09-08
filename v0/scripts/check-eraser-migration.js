const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

const moduleCache = new Map();
function loadTypeScriptModule(filePath) {
	const resolvedPath = path.resolve(filePath);
	if (moduleCache.has(resolvedPath)) {
		return moduleCache.get(resolvedPath).exports;
	}
	const moduleShim = { exports: {} };
	moduleCache.set(resolvedPath, moduleShim);
	const source = fs.readFileSync(resolvedPath, "utf8");
	const transpiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
			esModuleInterop: true,
			skipLibCheck: true
		}
	});
	const localRequire = (request) => {
		if (!request.startsWith(".")) {
			return require(request);
		}
		const target = path.resolve(path.dirname(resolvedPath), request);
		return loadTypeScriptModule(path.extname(target) ? target : `${target}.ts`);
	};
	const evaluate = vm.runInThisContext(
		`(function (require, module, exports) {\n${transpiled.outputText}\n})`,
		{ filename: resolvedPath }
	);
	evaluate(localRequire, moduleShim, moduleShim.exports);
	return moduleShim.exports;
}

const { eraseStrokeSegmentsAlongPath, migrateLegacyEraserPaths, migrateStrokeEraseMasks } = loadTypeScriptModule(path.join(projectRoot, "src", "annotation", "eraser.ts"));
const mainSource = fs.readFileSync(path.join(projectRoot, "main.ts"), "utf8");
const embedSource = fs.readFileSync(path.join(projectRoot, "src", "markdown", "embedRender.ts"), "utf8");
const stylesSource = fs.readFileSync(path.join(projectRoot, "styles.css"), "utf8");

assert(mainSource.includes("this.retainTouchErasePixels(pageNumber);"), "touch erase does not retain its committed pixel frame");
assert(!mainSource.includes("if (segmentErase) {\n\t\t\t\tthis.drawPageAnnotations(pageNumber);"), "touch erase still redraws strokes on pointer-up");
const retainTouchEraseSource = mainSource.slice(
	mainSource.indexOf("private retainTouchErasePixels"),
	mainSource.indexOf("private scheduleCommittedRedrawAfterIdle")
);
assert(!retainTouchEraseSource.includes("this.pendingRedrawPages.delete(pageNumber);"), "touch erase discards an interrupted existing-stroke render");
const eraserPointerUpStart = mainSource.indexOf('if (this.currentTool === "eraser") {', mainSource.indexOf("private handlePointerUpForCanvas"));
const eraserPointerUpSource = mainSource.slice(
	eraserPointerUpStart,
	mainSource.indexOf("this.freezeCurrentStrokeAtRenderedFrame", eraserPointerUpStart)
);
assert(eraserPointerUpSource.includes("this.schedulePageRedraw(pageNumber);"), "rounded segment-erase fragments wait for a later user action before rendering");
assert(!mainSource.includes("drawStoredStroke") && !mainSource.includes("applyStrokeEraseMasks"), "native redraw still replays touch-erased source strokes or eraser masks");
assert(!embedSource.includes("applyStrokeEraseMasks") && !embedSource.includes("eraseMasks"), "exports still replay touch eraser masks");
assert(/\.pdf-native-annotator-stroke-button,\s*\n\s*\.pdf-native-annotator-preset[\s\S]*?height:\s*44px;/.test(stylesSource), "mobile stroke-width control does not use the standard toolbar height");

const points = Array.from({ length: 9 }, (_, index) => ({
	x: 0.1 + index * 0.1,
	y: 0.5,
	pressure: 0.5,
	t: index * 8
}));
const document = {
	version: 7,
	sourceFile: "test.pdf",
	updatedAt: new Date().toISOString(),
	strokes: [
		{
			id: "old-stroke",
			page: 1,
			tool: "pen",
			color: "#000",
			width: 8,
			widthScale: 0.01,
			zIndex: 0,
			points,
			createdAt: new Date().toISOString()
		},
		{
			id: "newer-stroke",
			page: 1,
			tool: "pen",
			color: "#000",
			width: 8,
			widthScale: 0.01,
			zIndex: 2,
			points,
			createdAt: new Date().toISOString()
		}
	],
	eraserPaths: [{
		id: "legacy-eraser",
		page: 1,
		points: [
			{ x: 0.5, y: 0.4, pressure: 0.5 },
			{ x: 0.5, y: 0.6, pressure: 0.5 }
		],
		radiusScale: 0.055,
		zIndex: 1,
		createdAt: new Date().toISOString()
	}],
	textItems: [],
	shapes: [],
	imageItems: []
};

assert(migrateLegacyEraserPaths(document), "legacy eraser path was not migrated");
assert(document.eraserPaths.length === 0, "migrated eraser path remained renderable");
assert(!document.strokes.some((stroke) => stroke.id === "old-stroke"), "contacted stroke did not disappear atomically");
assert(document.strokes.some((stroke) => stroke.id === "newer-stroke" && stroke.points.length === points.length), "stroke drawn after the eraser was modified");
assert(!migrateLegacyEraserPaths(document), "migration was not idempotent");

const segmentDocument = {
	...document,
	strokes: [{
		id: "segment-stroke",
		page: 1,
		tool: "pen",
		color: "#f0f",
		width: 8,
		widthScale: 0.01,
		zIndex: 0,
		points,
		createdAt: new Date().toISOString()
	}],
	textItems: [{ id: "text", page: 1, text: "keep", x: 0.45, y: 0.45 }],
	shapes: [],
	imageItems: [],
	eraserPaths: []
};
let fragmentId = 0;
assert(eraseStrokeSegmentsAlongPath(
	segmentDocument,
	1,
	[
		{ x: 0.5, y: 0.4, pressure: 0.5 },
		{ x: 0.5, y: 0.6, pressure: 0.5 }
	],
	0.055,
	() => `fragment-${++fragmentId}`
), "touch erase did not modify the contacted stroke");
assert(segmentDocument.strokes.length === 2, "touch erase did not persist only the two surviving stroke sections");
assert(segmentDocument.strokes[0].cutEnd === true && segmentDocument.strokes[0].cutStart !== true, "left survivor did not preserve its natural start and mark its rounded cut end");
assert(segmentDocument.strokes[1].cutStart === true && segmentDocument.strokes[1].cutEnd !== true, "right survivor did not mark its rounded cut start and preserve its natural end");
assert(segmentDocument.strokes[0].points.at(-1).x < 0.46, "left survivor extends too far into the erased area");
assert(segmentDocument.strokes[1].points[0].x > 0.54, "right survivor extends too far into the erased area");
assert(segmentDocument.strokes.every((stroke) => stroke.color === "#f0f" && stroke.widthScale === 0.01), "stroke styling was not preserved");
assert(segmentDocument.textItems.length === 1, "touch erase deleted a non-stroke annotation as an object");

const legacyMaskedStrokes = [{
	...segmentDocument.strokes[0],
	id: "legacy-mask-stroke",
	points,
	eraseMasks: [{
		points: [{ x: 0.5, y: 0.4, pressure: 0.5 }, { x: 0.5, y: 0.6, pressure: 0.5 }],
		radiusScale: 0.055
	}]
}];
assert(migrateStrokeEraseMasks(legacyMaskedStrokes, () => `migrated-${++fragmentId}`), "saved mask data was not migrated to permanent survivor geometry");
assert(legacyMaskedStrokes.length === 2 && legacyMaskedStrokes.every((stroke) => !("eraseMasks" in stroke)), "legacy stroke masks remained renderable after migration");

console.log(`Eraser verifier passed. migratedStrokes=${document.strokes.length}; survivorFragments=${segmentDocument.strokes.length}; renderableErasers=${document.eraserPaths.length}`);
