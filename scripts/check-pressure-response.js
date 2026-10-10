const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript");
const crypto = require("node:crypto");
const { loadSource } = require("./load-source");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/ink/inkEngine.ts"), "utf8");
const moduleShim = { exports: {} };
vm.runInNewContext(ts.transpileModule(source + "\nexport { getRenderStrokePoints };", {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, { module: moduleShim, exports: moduleShim.exports, require: name => name.startsWith(".") ? loadSource(path.join("src/ink", name + ".ts")) : require(name), console });
const ink = moduleShim.exports;
const settings = { thinning: .5, streamline: .12, smoothing: .5, easing: "linear", taperStart: 0, taperEnd: 0, pressureMode: "stylus", smoothingMode: "pressure" };
const failures = [];
function check(label, fn) {
	try { fn(); console.log("PASS " + label); }
	catch (error) { failures.push(label + ": " + error.message); console.error("FAIL " + label + ": " + error.message); }
}
function line(pressure) { return Array.from({ length: 90 }, (_, i) => ({ x: .1 + i * .008, y: .5, pressure, t: i * 8 })); }
function width(pressure, smoothing, overrides = {}) {
	const outline = ink.getSmoothInkStrokeOutline(line(pressure), 1000, 1000, 10, true, false, { inkSettings: { ...settings, smoothing, ...overrides } });
	return Math.max(...outline.map(p => p[1])) - Math.min(...outline.map(p => p[1]));
}
check("Higher smoothing amplifies both increases and decreases in Pencil pressure", () => {
	const low = [width(.42, 0), width(.5, 0), width(.58, 0)];
	const high = [width(.42, 1), width(.5, 1), width(.58, 1)];
	console.log("Width replay (light / neutral / firm): low=" + low.map(v => v.toFixed(3)).join("/") + ", high=" + high.map(v => v.toFixed(3)).join("/"));
	assert.ok(high[2] - high[1] > (low[2] - low[1]) * 1.2, "firm pressure was not amplified at higher smoothing");
	assert.ok(high[1] - high[0] > (low[1] - low[0]) * 1.2, "light pressure was not amplified at higher smoothing");
	assert.ok(Math.abs(high[1] - low[1]) < 1e-8, "smoothing changed the neutral stroke width");
});
check("Neutral hardware pressure is captured without an extra pressure gain", () => {
	const stroke = { widthScale: .01, inkSettings: settings, points: [] };
	ink.appendStrokePoints(stroke, line(.5));
	assert.ok(stroke.points.every(point => Math.abs(point.pressure - .5) < 1e-10), "capture shifted neutral Pencil pressure before rendering");
});
check("Gentle pressure prevents a bulbous light-contact head with inverted sensitivity", () => {
	const pressures = [.06, .15, .3, .5, .7, .9, 1];
	const options = { thinning: -.35, pressureResponse: "gentle" };
	const widths = pressures.map(pressure => width(pressure, .7, options));
	const oldWidths = pressures.map(pressure => width(pressure, .7, { thinning: -.35 }));
	const spread = Math.max(...widths) - Math.min(...widths);
	const oldSpread = Math.max(...oldWidths) - Math.min(...oldWidths);
	console.log(`Inverted-pressure replay: widest/narrowest=${(Math.max(...widths) / Math.min(...widths)).toFixed(3)}, previous=${(Math.max(...oldWidths) / Math.min(...oldWidths)).toFixed(3)}`);
	assert.ok(Math.max(...widths) / Math.min(...widths) < 1.25, "light-contact head became much wider than the stroke body");
	assert.ok(spread < oldSpread * .5, "new pressure response is still too dramatic");
	assert.ok(spread > .1, "pressure response became completely flat");
});
check("Pressure spikes have a gradual effect on new strokes", () => {
	const current = { ...settings, pressureResponse: "gentle" };
	const stroke = { widthScale: .01, inkSettings: current, points: [{ x: .1, y: .5, pressure: .5, t: 0 }] };
	const samples = [1, .06, .9, .12, .8, .06].map((pressure, i) => ({ x: .1 + (i + 1) * .008, y: .5, pressure, t: (i + 1) * 8 }));
	ink.appendStrokePoints(stroke, samples);
	const biggestStep = Math.max(...stroke.points.slice(1).map((p, i) => Math.abs(p.pressure - stroke.points[i].pressure)));
	console.log(`Captured pressure-spike step: ${biggestStep.toFixed(3)}`);
	assert.ok(biggestStep <= .080001, "a single sample caused an abrupt pressure jump");
});
check("Gentle smoothing keeps stronger response at higher settings without extreme widths", () => {
	const gentle = { pressureResponse: "gentle" };
	const neutral = width(.5, 0, gentle);
	assert.ok(width(.58, 1, gentle) - neutral > (width(.58, 0, gentle) - neutral) * 1.2);
	assert.ok(neutral - width(.42, 1, gentle) > (neutral - width(.42, 0, gentle)) * 1.2);
	assert.equal(width(.5, 1, gentle), neutral);
});
check("Gentle response stays subtle with every pressure curve", () => {
	for (const easing of ["linear", "ease-in", "ease-out", "ease-in-out"]) for (const thinning of [-.35, .35]) {
		const options = { easing, thinning, pressureResponse: "gentle" };
		const widths = [.06, .3, .5, .7, 1].map(pressure => width(pressure, 1, options));
		assert.ok(Math.max(...widths) / Math.min(...widths) < 1.3, `${easing} made the pressure response dramatic again`);
	}
});
check("Short strokes follow the same pressure response and zero sensitivity stays constant", () => {
	const dotWidth = (pressure, smoothing, thinning = .5) => {
		const ctx = { beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
		ink.drawSmoothInkStroke(ctx, [{ x: .3, y: .4, pressure }], 1000, 1000, 10, true, false, { inkSettings: { ...settings, smoothing, thinning, pressureResponse: "gentle" } });
		return ctx.lineWidth;
	};
	assert.ok(dotWidth(.58, 1) > dotWidth(.58, 0));
	assert.ok(dotWidth(.42, 1) < dotWidth(.42, 0));
	assert.equal(dotWidth(.42, 1, 0), dotWidth(.58, 1, 0));
});
check("Saved strokes keep their original geometry across the smoothing semantics change", () => {
	// Snapshots of the pre-change renderer, including pressures below its legacy floor.
	const snapshots = [
		[0, "7b533a75f0d3342314ef9a1340bb2e558cfda37027d7c665541de053b144ea4c"],
		[.5, "b8490b2b033d1cf96fa7be5ef30acec08e66f477409761a1d580533a5276ea3f"],
		[1, "467cf1e591ee19b6add9b1e4a21c6039e5b4809b394655ae8080ffd232335473"]
	];
	const points = Array.from({ length: 42 }, (_, i) => ({ x: .1 + i * .012, y: .4 + Math.sin(i * .4) * .018, pressure: .07 + i * .018, t: i * 8 }));
	for (const [smoothing, expected] of snapshots) {
		const legacy = { ...settings, smoothing, pressureMode: "auto" };
		delete legacy.smoothingMode;
		const outline = ink.getSmoothInkStrokeOutline(points, 1000, 1400, 5, true, false, { inkSettings: legacy });
		assert.equal(crypto.createHash("sha256").update(JSON.stringify(outline)).digest("hex"), expected);
	}
});
check("New pressure-responsive strokes render identically live, reopened, and at another zoom", () => {
	const current = { ...settings, smoothing: 1, pressureResponse: "gentle" };
	const points = line(.58);
	const draw = (width, stored) => ink.getSmoothInkStrokeOutline(points, width, width, width / 100, true, false, { inkSettings: stored });
	const saved = draw(1000, current);
	assert.deepEqual(draw(1000, JSON.parse(JSON.stringify(current))), saved);
	assert.deepEqual(ink.getSmoothInkStrokeOutline(points, 1000, 1000, 10, true, true, { inkSettings: current, predictionStrength: 0 }), saved);
	const zoomed = draw(2000, current);
	assert.equal(saved.length, zoomed.length);
	saved.forEach((p, i) => p.forEach((v, axis) => assert.ok(Math.abs(v - zoomed[i][axis] / 2) < 1e-8)));
});
// Flatten the actual canvas quadratic outline, then evaluate the nonzero fill rule.
function filledPolygon(outline) {
	const polygon = [];
	let current;
	const ctx = { beginPath() {}, moveTo(x, y) { current = [x, y]; polygon.push(current); },
		quadraticCurveTo(cx, cy, x, y) {
			const start = current;
			for (let step = 1; step <= 8; step++) {
				const t = step / 8, u = 1 - t;
				polygon.push([u * u * start[0] + 2 * u * t * cx + t * t * x, u * u * start[1] + 2 * u * t * cy + t * t * y]);
			}
			current = [x, y];
		}, closePath() {}, fill() {} };
	ink.fillInkStrokeOutline(ctx, outline);
	return polygon;
}
function contains(polygon, x, y) {
	let winding = 0;
	for (let i = 0; i < polygon.length; i++) {
		const a = polygon[i], b = polygon[(i + 1) % polygon.length];
		const side = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
		if (a[1] <= y && b[1] > y && side > 0) winding++;
		if (a[1] > y && b[1] <= y && side < 0) winding--;
	}
	return winding !== 0;
}
const turns = [
	Array.from({ length: 140 }, (_, i) => ({ x: .4 - .18 * Math.sin(i / 139 * Math.PI), y: .25 + i / 139 * .16, pressure: .5, t: i * 8 })),
	Array.from({ length: 140 }, (_, i) => ({ x: .4 - .18 * Math.sin(i / 139 * Math.PI), y: .25 + i / 139 * .025, pressure: .5, t: i * 8 })),
	Array.from({ length: 140 }, (_, i) => ({ x: .4 - .18 * Math.sin(i / 139 * Math.PI), y: .25 + i / 139 * .008, pressure: .5, t: i * 8 }))
];
turns.push(Array.from({ length: 24 }, (_, i) => ({ x: .4 - .06 * Math.sin(i / 23 * Math.PI), y: .25 + i / 23 * .0001, pressure: .18 + i / 23 * .72, t: i * 8 })));
check("High smoothing does not cut holes in a continuous left-to-right turn", () => {
	let missed = 0;
	for (const [index, points] of turns.entries()) {
		const current = { ...settings, smoothing: 1, streamline: index === 3 ? 0 : .12 };
		const outline = ink.getSmoothInkStrokeOutline(points, 1000, 1000, 10, true, false, { inkSettings: current });
		const polygon = filledPolygon(outline);
		const prepared = ink.getRenderStrokePoints(points, false, 0, current);
		// Interior turn samples are well away from the real start/end caps.
		const endTime = points.at(-1).t;
		for (const p of prepared.filter(p => p.t > endTime * .35 && p.t < endTime * .7)) {
			if (!contains(polygon, p.x * 1000, p.y * 1000)) missed++;
		}
	}
	console.log("Unfilled centerline samples around turns: " + missed);
	assert.equal(missed, 0, "outline filtering separated the stroke at a turn");
});
if (failures.length) { console.error(failures.length + " pressure/turn regressions reproduced."); process.exitCode = 1; }
