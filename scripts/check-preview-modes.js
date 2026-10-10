const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript");
const { loadSource } = require("./load-source");
const { resolvePointerPressure } = loadSource("src/pointer/pointerInput.ts");
const ink = loadSource("src/ink/inkEngine.ts");
for (const mode of ["auto", "simulate", "stylus"]) {
 for (const stylus of [{ pointerType: "pen" }, { pointerType: "touch", touchType: "stylus" }, { pointerType: "touch", forced: true }]) {
  for (const x of [0, 1, 5000]) {
   const event = { ...stylus, clientX: x, clientY: 0, timeStamp: 12, pressure: .23 };
   const resolve = sample => resolvePointerPressure(sample, { clientX: 0, clientY: 0 }, 10, mode, !!stylus.forced, .31);
   assert.equal(resolve(event), .23, "Pen pressure must ignore writing velocity and simulation preference");
   assert.equal(resolve({ ...event, pressure: 0 }), .31, "Missing pen pressure must retain the last force");
   assert.equal(resolve({ ...event, pressure: 0, webkitForce: .4 }), .4);
  }
 }
}
const source = fs.readFileSync(path.join(__dirname, "..", "main.ts"), "utf8");
const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const sessionClass = tree.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === "NativePdfAnnotatorSession");
const method = sessionClass.members.find(n => n.name?.getText(tree) === "getLivePreviewPredictionStrength");
const context = {};
vm.runInNewContext(ts.transpileModule(`class Session {${method.getText(tree)}} globalThis.Session = Session;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
const session = new context.Session();
let previewMode = "auto-smooth";
session.plugin = { getLivePreviewMode: () => previewMode };
session.pageSurfaces = new Map([[1, { lastWidth: 1000, lastHeight: 1000 }]]);
const points = [{ x: .1, y: .2, pressure: .4, t: 0 }, { x: .2, y: .2, pressure: .4, t: 8 }, { x: .3, y: .2, pressure: .4, t: 16 }];
session.currentStroke = { page: 1, points };
assert.ok(session.getLivePreviewPredictionStrength() > 0 && session.getLivePreviewPredictionStrength() <= .15);
for (const mode of ["fast", "accurate"]) {
 previewMode = mode;
 assert.equal(session.getLivePreviewPredictionStrength(), 0);
}
previewMode = "auto-smooth";
session.currentStroke.points = [...points.slice(0, 2), { ...points[2], x: .1 }];
assert.equal(session.getLivePreviewPredictionStrength(), 0, "Reversals must not extrapolate a straight tail");
session.currentStroke.points = [...points.slice(0, 2), { ...points[2], pressure: .8 }];
assert.equal(session.getLivePreviewPredictionStrength(), 0, "Pressure changes must not extrapolate old force");
session.currentStroke.points = [...points.slice(0, 2), { ...points[2], t: 100 }];
assert.equal(session.getLivePreviewPredictionStrength(), 0, "Input gaps must disable prediction");
session.currentStroke.points = points.slice(0, 2);
assert.equal(session.getLivePreviewPredictionStrength(), 0, "Short strokes must not predict a tail");
const settings = { smoothingMode: "pressure", pressureResponse: "gentle", strokeGeometry: "round", widthSmoothing: "extra-smooth", widthSmoothingVersion: 2, thinning: .5, streamline: 0, smoothing: .8, easing: "linear", taperStart: 0, taperEnd: 0, pressureMode: "auto" };
const curve = Array.from({ length: 30 }, (_, i) => ({ x: .1 + i * .01, y: .4 + Math.sin(i / 3) * .04, pressure: i < 15 ? .2 : .8, t: i * 8 }));
const full = ink.getRoundedInkStrokeGeometry(curve, 1000, 1000, 10, true, false, { inkSettings: settings });
const fast = ink.getRoundedInkStrokeGeometry(curve, 1000, 1000, 10, true, false, { inkSettings: settings, previewQuality: "fast" });
assert.ok(fast.samples.length < full.samples.length, "Fast must actually reduce live rendering work");
assert.equal(JSON.stringify(fast.controlRadii), JSON.stringify(full.controlRadii), "Fast must retain pressure widths");
assert.ok(full.controlRadii[0] < full.controlRadii.at(-1), "Actual light/firm pressure must reach geometry");
const prefix = ink.getRoundedInkStrokeGeometry(curve.slice(0, 15), 1000, 1000, 10, true, false, { inkSettings: settings });
assert.equal(JSON.stringify(prefix.controlRadii), JSON.stringify(full.controlRadii.slice(0, 15)), "Later firm pressure must not widen earlier light ink");
console.log("Preview modes passed: adaptive tip, lighter Fast geometry, actual pen pressure at every speed, and local width tracking.");
