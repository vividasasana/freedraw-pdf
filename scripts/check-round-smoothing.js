const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const modules = new Map();
function load(file) {
	file = path.resolve(root, file);
	if (modules.has(file)) return modules.get(file).exports;
	const module = { exports: {} }; modules.set(file, module);
	vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
		{ module, exports: module.exports, require: name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : require(name), console });
	return module.exports;
}
const ink = load("src/ink/inkEngine.ts");
const settings = { smoothingMode: "pressure", pressureResponse: "gentle", strokeGeometry: "round", thinning: .35, streamline: 0, smoothing: .8, easing: "linear", taperStart: 0, taperEnd: 0, pressureMode: "stylus" };
const failures = [];
function check(label, fn) { try { fn(); console.log("PASS " + label); } catch (e) { failures.push(e.message); console.error("FAIL " + label + ": " + e.message); } }
check("Pressure capture keeps the actual peak rather than clamping it", () => {
	const stroke = { widthScale: .008, inkSettings: settings, points: [] };
	ink.appendStrokePoints(stroke, [.3, .4, 1, .4].map((pressure, i) => ({ x: .1 + i * .003, y: .5, pressure, t: i * 8 })));
	assert.equal(Math.max(...stroke.points.map(p => p.pressure)), 1, "smoothing discarded the strongest Pencil pressure");
});
function geometry(points, smoothing) {
	if (!ink.getRoundedInkStrokeGeometry) throw new Error("smoothing has no dedicated rounded stroke geometry");
	return ink.getRoundedInkStrokeGeometry(points, 1000, 1000, 10, true, false, { inkSettings: { ...settings, smoothing } });
}
const peak = Array.from({ length: 19 }, (_, i) => ({ x: .15 + i * .002, y: .5, pressure: i === 9 ? 1 : .35, t: i * 8 }));
check("Higher smoothing raises neighbouring widths without lowering the maximum", () => {
	const low = geometry(peak, 0), high = geometry(peak, 1);
	assert.ok(high.controlRadii[8] > low.controlRadii[8], "the preceding point was not widened to blend into the peak");
	assert.ok(high.controlRadii[10] > low.controlRadii[10], "the following point was not widened to blend out of the peak");
	assert.ok(Math.abs(high.controlRadii[9] - low.controlRadii[9]) < 1e-8, "smoothing reduced the pressure peak's final width");
	assert.ok(Math.abs(Math.max(...high.samples.map(p => p.radius)) - Math.max(...low.samples.map(p => p.radius))) < 1e-8);
});
const corner = [{ x: .1, y: .4, pressure: .5, t: 0 }, { x: .15, y: .4, pressure: .5, t: 8 }, { x: .2, y: .4, pressure: .5, t: 16 }, { x: .2, y: .45, pressure: .5, t: 24 }, { x: .2, y: .5, pressure: .5, t: 32 }];
check("Smoothing rounds an actual corner instead of just changing pressure sensitivity", () => {
	const low = geometry(corner, 0), high = geometry(corner, 1);
	assert.notDeepEqual(high.samples.map(p => [p.x, p.y]), low.samples.map(p => [p.x, p.y]));
	assert.ok(high.samples.some(p => p.x > 175 && p.x < 200 && p.y > 400 && p.y < 425), "the right-angle turn was not rounded");
});
check("Rounded joins are painted as one continuous union, with no separate capped head", () => {
	let fills = 0, arcs = 0;
	const ctx = { lineWidth: 1, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() { arcs++; }, closePath() {}, fill() { fills++; }, stroke() {} };
	ink.drawSmoothInkStroke(ctx, corner, 1000, 1000, 10, true, false, { inkSettings: settings, serializePath: false });
	assert.ok(arcs > 0, "the renderer still uses the old internally capped outline at joins");
	assert.equal(fills, 1, "overlapping joins must not be painted as separate strokes");
});
check("Tight reversals have connected coverage and consistent winding at every smoothing level", () => {
	const turn = Array.from({ length: 35 }, (_, i) => ({ x: .3 - .08 * Math.sin(i / 34 * Math.PI), y: .3 + i / 34 * .002, pressure: .2 + i / 34 * .8, t: i * 8 }));
	for (const smoothing of [0, .5, 1]) {
		const g = geometry(turn, smoothing);
		assert.ok(g.pieces.some(p => p.kind === "circle"));
		for (const piece of g.pieces) if (piece.kind === "polygon") {
			const area = piece.points.reduce((sum, p, i) => { const q = piece.points[(i + 1) % piece.points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
			assert.ok(area < 0, "a reversing segment changed winding and could open a gap");
		}
		assert.ok(g.samples.every(p => g.pieces.some(piece => piece.kind === "circle" && piece.x === p.x && piece.y === p.y && piece.radius === p.radius)), "a join sample has no continuous round coverage");
	}
});
check("Round geometry is stable across live/commit, zoom, and stored settings", () => {
	const g = geometry(peak, 1);
	const stored = JSON.parse(JSON.stringify({ ...settings, smoothing: 1 }));
	const reopened = ink.getRoundedInkStrokeGeometry(peak, 1000, 1000, 10, true, false, { inkSettings: stored });
	assert.deepEqual(reopened, g);
	const zoomed = ink.getRoundedInkStrokeGeometry(peak, 2000, 2000, 20, true, false, { inkSettings: stored });
	assert.equal(zoomed.samples.length, g.samples.length);
	g.samples.forEach((p, i) => { for (const key of ["x", "y", "radius"]) assert.ok(Math.abs(p[key] - zoomed.samples[i][key] / 2) < 1e-8); });
	assert.deepEqual(ink.getRoundedInkStrokeGeometry(peak, 1000, 1000, 10, true, true, { inkSettings: stored, predictionStrength: 0 }), g);
});
if (failures.length) process.exitCode = 1;
