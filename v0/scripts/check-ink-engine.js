const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");
const ts = require("typescript");

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

function getCommandCount(pathData) {
	return (pathData.match(/[MQTLCZ]/g) ?? []).length;
}

function getCoordinatePairCount(pathData) {
	return (pathData.match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) ?? []).length;
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
	assert(source.includes("taper: options.startTaper ?? settings.taperStart"), "eraser-cut starts must be able to suppress artificial tapering");
	assert(source.includes("taper: options.endTaper ?? settings.taperEnd"), "eraser-cut ends must be able to suppress artificial tapering");
	assert(source.includes("): string | null {\n\tconst outline = getSmoothInkStrokeOutline"), "live outline helper must retain the last Git version's return contract");
	assert(source.includes("return getSvgPathFromStroke(outline) || null;"), "live outline helper must retain the last Git version's path publication behavior");
	assert(source.includes('(renderMode === "live" || predictTail || !usePressure)'), "live fallback selection must match the last Git version");
	const drawSmoothSource = source.slice(
		source.indexOf("export function drawSmoothInkStroke"),
		source.indexOf("export function drawInkDot")
	);
	const liveFastPathIndex = drawSmoothSource.indexOf('renderMode === "live"');
	const outlinePathIndex = drawSmoothSource.indexOf("drawFreehandOutlineStroke");
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
	assert((settingsSource.match(/\.addOption\("accurate", "Closest to saved"\)/g) ?? []).length === 2, "both settings views must offer closest-to-saved preview");
	assert((settingsSource.match(/\.addOption\("balanced", "Balanced"\)/g) ?? []).length === 2, "both settings views must offer balanced preview");
	assert((settingsSource.match(/\.addOption\("smooth", "Smoothest"\)/g) ?? []).length === 2, "both settings views must offer smoothest preview");
	assert(
		mainSource.includes("const cachedOutline = this.getCachedStrokeOutline"),
		"committed rendering must reuse cached numeric outlines"
	);
	assert(
		mainSource.includes("new Map<string, { signature: string; outline: InkStrokeOutline }>()"),
		"native rendering must cache immutable numeric outlines instead of browser-native paths"
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
	vm.runInNewContext(transpiled.outputText, {
		require,
		module: moduleShim,
		exports: moduleShim.exports,
		console
	}, { filename: "inkEngine.check.cjs" });
	const ink = moduleShim.exports;
	ink.setInkRenderSettings({ pressureMode: "auto", thinning: 0.5 });
	const stroke = { widthScale: 8 / 1600, points: [] };
	for (const point of createStrokeSamples()) {
		ink.appendStrokePoints(stroke, [point]);
	}

	assert(stroke.points.length >= 72, `appendStrokePoints over-compressed handwriting samples (${stroke.points.length})`);
	assert(stroke.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.pressure)), "stroke contains non-finite point data");
	assert(stroke.points.every((point) => point.pressure >= 0.06 && point.pressure <= 1), "stroke pressure escaped expected range");
	const lightNativePressureStroke = { widthScale: 8 / 1600, points: [] };
	ink.appendStrokePoints(lightNativePressureStroke, [{ x: 0.2, y: 0.2, pressure: 0.14, t: 0 }]);
	assert(
		Math.abs(lightNativePressureStroke.points[0].pressure - 0.14) < 0.001,
		"native light stylus pressure was amplified instead of preserved"
	);

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

	const committedPath = ink.getSmoothInkStrokePath(stroke.points, 1600, 2200, 8, true, false, { renderMode: "committed" });
	const livePath = ink.getSmoothInkStrokePath(stroke.points, 1600, 2200, 8, true, true, { renderMode: "live" });
	const releasePreviewPath = ink.getSmoothInkStrokePath(stroke.points, 1600, 2200, 8, true, false, { renderMode: "live" });
	const tinyDotPath = ink.getSmoothInkStrokePath([
		{ x: 0.5, y: 0.5, pressure: 0.5, t: 0 },
		{ x: 0.5001, y: 0.5001, pressure: 0.5, t: 8 }
	], 1600, 2200, 8, true, false, { renderMode: "committed" });

	assert(committedPath, "committed handwriting path was not generated");
	assert(livePath, "live handwriting path was not generated");
	assert(releasePreviewPath, "release-preview handwriting path was not generated");
	assert(tinyDotPath === null, "tiny accidental dot should be suppressed");
	assert(!/NaN|Infinity/.test(committedPath), "committed path contains invalid numeric output");
	assert(!/NaN|Infinity/.test(livePath), "live path contains invalid numeric output");
	assert(!/NaN|Infinity/.test(releasePreviewPath), "release-preview path contains invalid numeric output");
	assert(getCoordinatePairCount(committedPath) >= 40, "committed path is too sparse and likely angular");
	assert(getCoordinatePairCount(livePath) >= 32, "live path is too sparse and likely angular");
	assert(releasePreviewPath === committedPath, "live release-preview and committed paths diverged, causing release-time stroke snap");
	assert(getCoordinatePairCount(livePath) >= getCoordinatePairCount(committedPath) * 0.8, "live path is much sparser than committed path and will visibly change on release");

	const predictionLine = Array.from({ length: 12 }, (_, index) => ({
		x: 0.1 + (index * 0.035),
		y: 0.5,
		pressure: 0.55,
		t: index * 8
	}));
	const canonicalPredictionPath = ink.getSmoothInkStrokePath(predictionLine, 1000, 1000, 10, true, false, { renderMode: "committed" });
	const accuratePredictionPath = ink.getSmoothInkStrokePath(predictionLine, 1000, 1000, 10, true, true, { renderMode: "live", predictionStrength: 0 });
	const balancedPredictionOutline = ink.getSmoothInkStrokeOutline(predictionLine, 1000, 1000, 10, true, true, { renderMode: "live", predictionStrength: 0.45 });
	const smoothPredictionOutline = ink.getSmoothInkStrokeOutline(predictionLine, 1000, 1000, 10, true, true, { renderMode: "live", predictionStrength: 1 });
	assert(accuratePredictionPath === canonicalPredictionPath, "closest preview must use exactly the saved stroke geometry");
	assert(balancedPredictionOutline && smoothPredictionOutline, "adjustable live prediction outlines were not generated");
	const accuratePredictionOutline = ink.getSmoothInkStrokeOutline(predictionLine, 1000, 1000, 10, true, true, { renderMode: "live", predictionStrength: 0 });
	const maxOutlineX = (outline) => Math.max(...outline.map((point) => point[0]));
	assert(accuratePredictionOutline, "closest live prediction outline was not generated");
	assert(maxOutlineX(balancedPredictionOutline) > maxOutlineX(accuratePredictionOutline), "balanced preview must respond ahead of closest preview");
	assert(maxOutlineX(smoothPredictionOutline) > maxOutlineX(balancedPredictionOutline), "smoothest preview must respond ahead of balanced preview");

	const committedOutline = ink.getSmoothInkStrokeOutline(stroke.points, 1600, 2200, 8, true, false, { renderMode: "committed" });
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
		const pathData = ink.getSmoothInkStrokePath(stroke.points, 1600, 2200, 8, true, index % 2 === 0, { renderMode: index % 2 === 0 ? "live" : "committed" });
		assert(pathData, "timed path generation returned no path");
	}
	const elapsedMs = performance.now() - start;
	assert(elapsedMs < 900, `ink path generation is too slow (${elapsedMs.toFixed(1)} ms for 30 paths)`);

	console.log(`Ink engine verifier passed. points=${stroke.points.length}; committedPairs=${getCoordinatePairCount(committedPath)}; livePairs=${getCoordinatePairCount(livePath)}; committedCommands=${getCommandCount(committedPath)}; liveCommands=${getCommandCount(livePath)}; time=${elapsedMs.toFixed(1)}ms`);
} finally {
	// No filesystem cleanup required; the transpiled module is evaluated in memory.
}
