const assert = require("node:assert/strict");
const { loadSource } = require("./load-source");
const { buildRoundedInkGeometry } = loadSource("src/ink/roundedInkGeometry.ts");
const { normalizeInkRenderSettings } = loadSource("src/settings/settingsController.ts");
const settings = { strokeGeometry: "round", edgeGeometryVersion: 2, widthSmoothing: "extra-smooth", widthSmoothingVersion: 2, thinning: .5, streamline: 0, smoothing: 1, easing: "linear", taperStart: 0, taperEnd: 0, pressureMode: "stylus" };
const points = [{ x: .1, y: .4, pressure: .2, t: 0 }, { x: .2, y: .45, pressure: .8, t: 8 }];
const geometry = buildRoundedInkGeometry(points, 1000, 1000, 10, true, settings);
const polygon = geometry.pieces.find(piece => piece.kind === "polygon");
assert.ok(polygon);
const [a, b] = geometry.samples;
for (const [i, j] of [[0, 1], [3, 2]]) {
 const pa = polygon.points[i], pb = polygon.points[j];
 const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
 const norm = Math.hypot(dx, dy);
 const errorA = Math.abs((pa[0] - a.x) * dx + (pa[1] - a.y) * dy) / (norm * a.radius);
 const errorB = Math.abs((pb[0] - b.x) * dx + (pb[1] - b.y) * dy) / (norm * b.radius);
 assert.ok(errorA < 1e-10 && errorB < 1e-10, "Pressure joins must be tangent at both disks, without a hard edge");
}
const near = buildRoundedInkGeometry([{ x: .1, y: .1, pressure: .2 }, { x: .10001, y: .1, pressure: 1 }], 1000, 1000, 10, true, settings);
assert.equal(near.pieces.filter(piece => piece.kind === "polygon").length, 0, "Contained disks must not generate flipped or spiked connectors");
assert.ok(near.samples.every(point => Number.isFinite(point.radius)));
const corner = [{ x: .1, y: .1, pressure: .5 }, { x: .5, y: .1, pressure: .5 }, { x: .5, y: .5, pressure: .5 }];
const detailed = buildRoundedInkGeometry(corner, 1000, 1000, 10, true, settings);
const legacy = buildRoundedInkGeometry(corner, 1000, 1000, 10, true, { ...settings, edgeGeometryVersion: undefined });
assert.ok(detailed.samples.length > legacy.samples.length * 2, "Sparse bends need finer curve detail than the old capped subdivision");
const zoomed = buildRoundedInkGeometry(corner, 4000, 4000, 40, true, settings);
assert.equal(zoomed.samples.length, detailed.samples.length);
for (let i = 0; i < detailed.samples.length; i++) {
 assert.ok(Math.abs(zoomed.samples[i].x / 4 - detailed.samples[i].x) < 1e-8);
 assert.ok(Math.abs(zoomed.samples[i].radius / 4 - detailed.samples[i].radius) < 1e-8);
}
assert.equal(normalizeInkRenderSettings(settings).edgeGeometryVersion, 2, "Save/reopen must retain corrected edges");
assert.equal(normalizeInkRenderSettings({ ...settings, edgeGeometryVersion: undefined }).edgeGeometryVersion, undefined, "Earlier strokes must keep recorded geometry");
console.log("Smooth edges passed: tangent pressure joins, contained disks, finer sparse curves, zoom parity and version persistence.");
