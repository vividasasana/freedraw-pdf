const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");
const ts = require("typescript");
const { deepEqual } = require("assert/strict");

const projectRoot = path.resolve(__dirname, "..");

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function createStrokeSamples() {
	const points = [];
	const count = 96;
	for (let index = 0; index < count; index += 1) {
		const t = index / (count - 1);
		const loop = Math.sin(t * Math.PI * 5.2);
		const wobble = Math.sin(t * Math.PI * 17) * 0.004;
		points.push({
			x: 0.08 + (t * 0.84),
			y: 0.48 + (loop * 0.08) + wobble,
			pressure: 0.34 + (Math.sin(t * Math.PI * 2.4) * 0.16) + (index % 9 === 0 ? 0.08 : 0),
			t: index * 8
		});
	}
	return points;
}

try {
	const source = fs.readFileSync(path.join(projectRoot, "src", "ink", "inkEngine.ts"), "utf8");
	const mainSource = fs.readFileSync(path.join(projectRoot, "main.ts"), "utf8");
	const configSource = fs.readFileSync(path.join(projectRoot, "src", "config.ts"), "utf8");
	const settingsSource = fs.readFileSync(path.join(projectRoot, "src", "settings", "settingTab.ts"), "utf8");
	const settingsControllerSource = fs.readFileSync(path.join(projectRoot, "src", "settings", "settingsController.ts"), "utf8");
	const typesSource = fs.readFileSync(path.join(projectRoot, "src", "types.ts"), "utf8");
	assert(source.includes("simulatePressure: false"), "perfect-freehand must render the pressure captured with each stable stroke point");
	assert(source.includes("const effectiveUsePressure = usePressure;"), "stored stylus or simulated pressure must reach perfect-freehand");
	assert(source.includes("taper: options.startTaper === undefined ? settings.taperStart : options.startTaper * geometryScale"), "eraser-cut starts must be able to suppress artificial tapering");
	assert(source.includes("taper: options.endTaper === undefined ? settings.taperEnd : options.endTaper * geometryScale"), "eraser-cut ends must be able to suppress artificial tapering");
	assert(source.includes('(renderMode === "live" || predictTail || !usePressure)'), "live fallback selection must match the last Git version");
	const drawSmoothSource = source.slice(
		source.indexOf("export function drawSmoothInkStroke"),
		source.indexOf("export function drawInkDot")
	);
	const liveFastPathIndex = drawSmoothSource.indexOf('renderMode === "live"');
	const outlinePathIndex = drawSmoothSource.indexOf("fillInkStrokeOutline");
	assert(
		outlinePathIndex >= 0 && (liveFastPathIndex < 0 || outlinePathIndex < liveFastPathIndex),
		"live ink must render the same pressure-sensitive outline before any uniform-width fallback"
	);
	assert(mainSource.includes("startTaper: stroke.cutStart ? 0 : undefined"), "cut stroke starts must render as stable rounded ends");
	assert(mainSource.includes("endTaper: stroke.cutEnd ? 0 : undefined"), "cut stroke ends must render as stable rounded ends");
	assert(
		mainSource.includes("this.drawTransientPageAnnotations(pageNumber, true);"),
		"stroke commit must replace the retained live preview with canonical geometry"
	);
	assert(mainSource.includes("const predictionStrength = commitCurrentStroke ? 0 : this.getLivePreviewPredictionStrength();"), "committed stroke promotion must disable tail prediction");
	assert(typesSource.includes('export type LivePreviewMode = "accurate" | "balanced" | "smooth";'), "live preview preference must expose closest, balanced, and smoothest choices");
	assert(configSource.includes('livePreviewMode: "balanced"'), "balanced preview must be the default compromise between fidelity and response");
	assert(settingsControllerSource.includes('value === "quality" ? "smooth"'), "legacy detailed preview preference must migrate to smoothest");
	assert(settingsControllerSource.includes('value === "fast" ? "accurate"'), "legacy responsive preview preference must migrate to closest geometry");
	assert((settingsSource.match(/\.addOption\("accurate", "Closest to saved"\)/g) ?? []).length === 1, "the canonical settings definition must offer closest-to-saved preview exactly once");
	assert((settingsSource.match(/\.addOption\("balanced", "Balanced"\)/g) ?? []).length === 1, "the canonical settings definition must offer balanced preview exactly once");
	assert((settingsSource.match(/\.addOption\("smooth", "Smoothest"\)/g) ?? []).length === 1, "the canonical settings definition must offer smoothest preview exactly once");
	assert(
		mainSource.includes("const cachedOutline = this.getCachedStrokeOutline"),
		"committed rendering must reuse cached numeric outlines"
	);
	assert(
		mainSource.includes("new WeakMap<StrokeAnnotation,") && mainSource.includes("outline: InkStrokeOutline;"),
		"native rendering must cache numeric outlines without retaining deleted strokes"
	);
	assert(
		mainSource.includes("fillInkStrokeOutline(context, cachedOutline);"),
		"cached geometry must be traced directly onto the target canvas"
	);
	assert(mainSource.includes("private activePdfPointerRect: DOMRect | null = null;"), "active ink must cache its page geometry for the pointer stream");
	assert(
		!source.includes("new Path2D(") && !mainSource.includes("new Path2D("),
		"ink rendering must not depend on Electron Path2D SVG parsing"
	);
	const configTranspiled = ts.transpileModule(configSource, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
			skipLibCheck: true
		}
	});
	const configModule = { exports: {} };
	vm.runInNewContext(configTranspiled.outputText, {
		require,
		module: configModule,
		exports: configModule.exports
	}, { filename: "config.check.cjs" });
	const widthRanges = configModule.exports.TOOL_WIDTH_RANGES;
	assert(widthRanges.pen.max === 48, "pen width range did not expand to 48 px");
	assert(widthRanges.highlighter.max === 64, "highlighter width range did not expand to 64 px");
	assert(widthRanges.eraser.max === 80, "eraser width range did not expand to 80 px");
	assert(configModule.exports.clampToolWidth("pen", 100) === 48, "pen width state is not clamped to the shared maximum");
	assert(mainSource.includes("const widthRange = this.getWidthRange(targetTool);"), "toolbar width slider does not use shared ranges");
	assert(settingsSource.includes("TOOL_WIDTH_RANGES.pen.max"), "settings UI does not use the expanded pen range");
	const transpiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
			esModuleInterop: true,
			skipLibCheck: true
		}
	});
	const moduleShim = { exports: {} };
	const inkContext = {
		require,
		module: moduleShim,
		exports: moduleShim.exports,
		console,
		formattedCoordinates: 0
	};
	vm.runInNewContext(`
		const originalFormat = Number.prototype.toFixed;
		Number.prototype.toFixed = function (...args) {
			globalThis.formattedCoordinates++;
			return originalFormat.apply(this, args);
		};
	` + transpiled.outputText, inkContext, { filename: "inkEngine.check.cjs" });
	const ink = moduleShim.exports;
	ink.setInkRenderSettings({ pressureMode: "auto", thinning: 0.5 });
	const stroke = { widthScale: 8 / 1600, points: [] };
	for (const point of createStrokeSamples()) {
		ink.appendStrokePoints(stroke, [point]);
	}

	assert(stroke.points.length >= 72, `appendStrokePoints over-compressed handwriting samples (${stroke.points.length})`);
	assert(stroke.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.pressure)), "stroke contains non-finite point data");
	assert(stroke.points.every((point) => point.pressure >= 0.06 && point.pressure <= 1), "stroke pressure escaped expected range");

	const pressureLine = (pressure) => Array.from({ length: 24 }, (_, index) => ({
		x: 0.1 + (index * 0.03),
		y: 0.5,
		pressure,
		t: index * 8
	}));
	const lightOutline = ink.getSmoothInkStrokeOutline(pressureLine(0.14), 1000, 1000, 12, true, false, { renderMode: "committed" });
	const firmOutline = ink.getSmoothInkStrokeOutline(pressureLine(0.9), 1000, 1000, 12, true, false, { renderMode: "committed" });
	const outlineHeight = (outline) => Math.max(...outline.map((point) => point[1])) - Math.min(...outline.map((point) => point[1]));
	assert(lightOutline && firmOutline, "pressure comparison outlines were not generated");
	assert(outlineHeight(firmOutline) > outlineHeight(lightOutline) * 1.35, "stored pressure does not visibly change stroke width");

	const liveDrawOperations = [];
	const liveDrawContext = {
		beginPath: () => liveDrawOperations.push("begin"),
		moveTo: () => liveDrawOperations.push("move"),
		quadraticCurveTo: () => liveDrawOperations.push("quadratic"),
		lineTo: () => liveDrawOperations.push("line"),
		closePath: () => liveDrawOperations.push("close"),
		fill: () => liveDrawOperations.push("fill"),
		stroke: () => liveDrawOperations.push("stroke"),
		lineWidth: 1
	};
	ink.drawSmoothInkStroke(liveDrawContext, stroke.points, 1600, 2200, 8, true, true, { renderMode: "live" });
	assert(liveDrawOperations.includes("fill"), "live pressure ink must draw a filled variable-width outline");
	assert(!liveDrawOperations.includes("stroke"), "live pressure ink must not collapse into one uniform-width centerline");

	const committedOutline = ink.getSmoothInkStrokeOutline(stroke.points, 1600, 2200, 8, true, false, { renderMode: "committed" });
	const liveOutline = ink.getSmoothInkStrokeOutline(stroke.points, 1600, 2200, 8, true, true, { renderMode: "live" });
	const releasePreviewOutline = ink.getSmoothInkStrokeOutline(stroke.points, 1600, 2200, 8, true, false, { renderMode: "live" });
	const tinyDotOutline = ink.getSmoothInkStrokeOutline([
		{ x: 0.5, y: 0.5, pressure: 0.5, t: 0 },
		{ x: 0.5001, y: 0.5001, pressure: 0.5, t: 8 }
	], 1600, 2200, 8, true, false, { renderMode: "committed" });

	for (const outline of [committedOutline, liveOutline, releasePreviewOutline]) {
		assert(outline && outline.every(point => point.every(Number.isFinite)), "handwriting outline must contain finite coordinates");
	}
	assert(tinyDotOutline === null, "tiny accidental dot should be suppressed");
	assert(committedOutline.length >= 40, "committed outline is too sparse and likely angular");
	assert(liveOutline.length >= 32, "live outline is too sparse and likely angular");
	deepEqual(releasePreviewOutline, committedOutline, "release-preview geometry must not snap on pen-up");
	assert(liveOutline.length >= committedOutline.length * 0.8, "live geometry must not become sparse");

	const predictionLine = Array.from({ length: 12 }, (_, index) => ({
		x: 0.1 + (index * 0.035),
		y: 0.5,
		pressure: 0.55,
		t: index * 8
	}));
	const canonicalPredictionOutline = ink.getSmoothInkStrokeOutline(predictionLine, 1000, 1000, 10, true, false, { renderMode: "committed" });
	const accuratePredictionOutline = ink.getSmoothInkStrokeOutline(predictionLine, 1000, 1000, 10, true, true, { renderMode: "live", predictionStrength: 0 });
	const balancedPredictionOutline = ink.getSmoothInkStrokeOutline(predictionLine, 1000, 1000, 10, true, true, { renderMode: "live", predictionStrength: 0.45 });
	const smoothPredictionOutline = ink.getSmoothInkStrokeOutline(predictionLine, 1000, 1000, 10, true, true, { renderMode: "live", predictionStrength: 1 });
	deepEqual(accuratePredictionOutline, canonicalPredictionOutline, "closest preview must use exactly the saved stroke geometry");
	assert(balancedPredictionOutline && smoothPredictionOutline, "adjustable live prediction outlines were not generated");
	const maxOutlineX = (outline) => Math.max(...outline.map((point) => point[0]));
	assert(accuratePredictionOutline, "closest live prediction outline was not generated");
	assert(maxOutlineX(balancedPredictionOutline) > maxOutlineX(accuratePredictionOutline), "balanced preview must respond ahead of closest preview");
	assert(maxOutlineX(smoothPredictionOutline) > maxOutlineX(balancedPredictionOutline), "smoothest preview must respond ahead of balanced preview");

	const halfScaleOutline = ink.getSmoothInkStrokeOutline(stroke.points, 800, 1100, 4, true, false, { renderMode: "committed" });
	assert(committedOutline && halfScaleOutline, "zoom-scale comparison outlines were not generated");
	assert(
		committedOutline.length === halfScaleOutline.length,
		`zoom changed stroke outline complexity (${committedOutline.length} -> ${halfScaleOutline.length})`
	);
	const maxNormalizedScaleDrift = committedOutline.reduce((maximum, point, index) => {
		const halfPoint = halfScaleOutline[index];
		return Math.max(
			maximum,
			Math.abs((point[0] / 1600) - (halfPoint[0] / 800)),
			Math.abs((point[1] / 2200) - (halfPoint[1] / 1100))
		);
	}, 0);
	assert(maxNormalizedScaleDrift < 1e-8, `zoom changed normalized stroke geometry (${maxNormalizedScaleDrift})`);
	const tracedCommands = [];
	const traceContext = {
		beginPath: () => tracedCommands.push("begin"),
		moveTo: (...args) => tracedCommands.push(["move", ...args]),
		quadraticCurveTo: (...args) => tracedCommands.push(["quadratic", ...args]),
		closePath: () => tracedCommands.push("close"),
		fill: () => tracedCommands.push("fill")
	};
	assert(committedOutline && ink.fillInkStrokeOutline(traceContext, committedOutline), "committed outline could not be traced directly");
	assert(tracedCommands.filter((command) => Array.isArray(command) && command[0] === "quadratic").length === committedOutline.length - 2, "direct outline tracing dropped quadratic segments");
	assert(tracedCommands.at(-1) === "fill", "direct outline tracing did not fill the closed stroke");

	const start = performance.now();
	for (let index = 0; index < 30; index += 1) {
		ink.drawSmoothInkStroke(liveDrawContext, stroke.points, 1600, 2200, 8, true, index % 2 === 0, { renderMode: index % 2 === 0 ? "live" : "committed" });
	}
	const elapsedMs = performance.now() - start;
	assert(inkContext.formattedCoordinates === 0, "canvas ink must not serialize unused SVG coordinates");
	assert(elapsedMs < 900, `ink drawing is too slow (${elapsedMs.toFixed(1)} ms for 30 strokes)`);

	console.log(`Ink engine verifier passed. points=${stroke.points.length}; committedOutline=${committedOutline.length}; liveOutline=${liveOutline.length}; drawTime=${elapsedMs.toFixed(1)}ms`);
} finally {
	// No filesystem cleanup required; the transpiled module is evaluated in memory.
}
