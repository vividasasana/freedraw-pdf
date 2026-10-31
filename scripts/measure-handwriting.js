// CPU replay of the real live-preview call chain; not a browser/GPU latency test.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript");
const { performance } = require("node:perf_hooks");
const root = path.resolve(__dirname, "..");
function load(bundlePath) {
	const source = fs.readFileSync(bundlePath, "utf8");
	const tree = ts.createSourceFile("main.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	let session;
	function visit(node) {
		if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) &&
			node.members.some(member => member.name?.getText(tree) === "drawTransientPageAnnotations")) session = node;
		ts.forEachChild(node, visit);
	}
	visit(tree);
	assert.ok(session, "Bundle must contain the live-preview session");
	// Expose only the existing class to the harness; leave the shipped function bodies intact.
	const insertion = ts.isClassExpression(session) ? "globalThis.Session = " : "";
	const suffix = ts.isClassDeclaration(session) ? `;globalThis.Session = ${session.name.text};` : "";
	const code = source.slice(0, session.getStart(tree)) + insertion +
		source.slice(session.getStart(tree), session.end) + suffix + source.slice(session.end);
	const module = { exports: {} };
	const obsidian = { Plugin: class {}, TFile: class {}, Modal: class {}, PluginSettingTab: class {}, Notice: class {} };
	const context = { module, exports: module.exports, console, TextEncoder,
		require(name) { assert.equal(name, "obsidian"); return obsidian; }
	};
	vm.runInNewContext(code, context, { filename: bundlePath });
	return context.Session;
}
function replay(implementation, mode, sampleCount) {
	let operations = 0, checksum = 0, frames = 0;
	const samples = Array.from({ length: sampleCount }, (_, i) => ({
		x: .1 + (i % 300) / 400, y: .5 + Math.sin(i * .07) * .15,
		pressure: .5 + Math.sin(i * .03) * .2, t: i * 1000 / 240
	}));
	const draw = (...args) => { operations++; for (const value of args) if (typeof value === "number") checksum += value; };
	const canvasContext = Object.fromEntries(["save", "restore", "setTransform", "clearRect", "beginPath", "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "closePath", "fill", "stroke", "arc"].map(name => [name, draw]));
	const surface = { lastWidth: 1000, lastHeight: 1400, transientEl: { getContext: () => canvasContext } };
	const stroke = { page: 1, tool: "pen", width: 4, widthScale: .004, color: "#000", points: [] };
	const session = Object.create(implementation.prototype);
	Object.assign(session, {
		pageSurfaces: new Map([[1, surface]]), ownerWindow: { devicePixelRatio: 2 },
		plugin: { getLivePreviewMode: () => mode }, currentStroke: stroke,
		resolveStoredScale: (width, scale) => scale,
		syncCanvasBackingSize() {}, getCachedStrokeOutline: () => null
	});
	const times = [];
	for (let i = 0; i < sampleCount; i += 4) {
		stroke.points.push(...samples.slice(i, i + 4));
		const start = performance.now();
		session.drawTransientPageAnnotations(1);
		times.push(performance.now() - start);
		frames++;
	}
	const beforeCommit = stroke.points.length;
	session.drawTransientPageAnnotations(1, true);
	assert.equal(stroke.points.length, beforeCommit, "Rendering must not discard input points");
	assert.ok(Number.isFinite(checksum), "Canvas coordinates must remain finite");
	times.sort((a, b) => a - b);
	return { frames, points: stroke.points.length, operations, checksum, p50: times[Math.floor(times.length * .5)], p95: times[Math.floor(times.length * .95)], max: times.at(-1) };
}
const versions = [
	["v2 compiled", path.join(root, "v2/main.js")],
	["restored v3 compiled", path.join(root, "v3/freedraw-pdf/main.js")]
].map(([label, bundle]) => [label, load(bundle)]);
for (const [, implementation] of versions) replay(implementation, "balanced", 240);
// The default is a quick comparison; --long adds a five-second continuous stroke.
for (const count of process.argv.includes("--long") ? [240, 1200] : [240, 480]) for (const mode of ["balanced", "smooth"]) {
	const results = versions.map(() => []);
	// Alternate versions to reduce bias from warm-up and background machine load.
	for (let round = 0; round < 3; round++) {
		for (const index of round % 2 ? [1, 0] : [0, 1]) results[index].push(replay(versions[index][1], mode, count));
	}
	assert.equal(results[0][0].operations, results[1][0].operations, "Both builds must issue the same number of canvas operations");
	assert.equal(results[0][0].checksum, results[1][0].checksum, "Both builds must retain the same replay geometry");
	for (let index = 0; index < versions.length; index++) {
		const [label] = versions[index], runs = results[index];
		for (const run of runs) {
			assert.equal(run.operations, runs[0].operations, "Replay work must be deterministic");
			assert.equal(run.checksum, runs[0].checksum, "Replay geometry must be deterministic");
		}
		const median = field => runs.map(run => run[field]).sort((a, b) => a - b)[1].toFixed(2);
		console.log(`${label}; ${mode}; ${count} samples: ${runs[0].points} retained, ${runs[0].operations} canvas operations; frame CPU p50=${median("p50")}ms p95=${median("p95")}ms max=${median("max")}ms`);
	}
}
console.log("CPU replay only: excludes DOM layout, GPU, PDF rendering, autosave, and physical device input latency.");
