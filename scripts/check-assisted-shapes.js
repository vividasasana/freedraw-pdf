const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
const previous = require.extensions[".ts"];
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { shapeGeometry, renderShape, shapeIntersectsSegment, distanceToShapeGeometry } = require("../src/shapes/shapeGeometry.ts");
const { fitGesture } = require("../src/shapes/recognition.ts");
const { HoldGesture } = require("../src/shapes/holdGesture.ts");
const { normalizeShapeOptions, normalizeShapeFields, annotationOpacity } = require("../src/shapes/shapeOptions.ts");
const { ToolStateController } = require("../src/tools/toolState.ts");
const { DEFAULT_TOOL_PRESETS } = require("../src/config.ts");
const { getShapeBounds } = require("../src/annotation/bounds.ts");
const { appendStrokePoints } = require("../src/ink/inkEngine.ts");
const { migrateLegacyEraserPaths } = require("../src/annotation/eraser.ts");
const point = (x, y) => ({ x, y, pressure: .5 });
const base = { id: "shape", page: 1, tool: "line", color: "#ffcb47", width: 8, widthScale: .005, start: point(.15, .3), end: point(.8, .6), aspectRatio: 1.4, createdAt: "2026-10-18", appearance: "highlighter", opacity: .24 };
const same = (a, b, message) => assert.equal(JSON.stringify(a), JSON.stringify(b), message);

// Pattern geometry is persisted document data, independent of display resolution.
for (const lineStyle of ["solid", "dotted", "dashed", "wavy"]) {
  const shape = { ...base, lineStyle, waveSize: 2 };
  same(shapeGeometry(shape), shapeGeometry(JSON.parse(JSON.stringify(shape))), "reload changed pattern geometry");
  const atZoom = zoom => { const commands = []; const ctx = new Proxy({}, { get: (target, key) => key in target ? target[key] : (...args) => commands.push([key, ...args]), set: (target, key, value) => { target[key] = value; return true; } }); renderShape(ctx, shape, 1000 * zoom, 1400 * zoom); return commands; };
  const a = atZoom(1), b = atZoom(3);
  assert.equal(a.length, b.length, "zoom changed pattern segment/dot count");
  for (let i = 0; i < a.length; i++) { assert.equal(a[i][0], b[i][0]); if (["moveTo", "lineTo"].includes(a[i][0])) for (let j = 1; j <= 2; j++) assert.ok(Math.abs(a[i][j] * 3 - b[i][j]) < 1e-8); }
  const geometry = shapeGeometry(shape), bounds = getShapeBounds(shape);
  for (const p of [...geometry.paths.flat(), ...geometry.dots]) assert.ok(p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.top && p.y <= bounds.bottom);
  assert.ok(geometry.paths.flat().length <= 8193 && geometry.dots.length <= 2049);
  for (const length of [0, 1e-12, .00001, 1]) {
    const tiny = shapeGeometry({ ...shape, widthScale: .00000001, end: point(shape.start.x + length, shape.start.y) });
    assert.ok([...tiny.paths.flat(), ...tiny.dots].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
}
const dash = { ...base, start: point(.1, .5), end: point(.9, .5), widthScale: .005, lineStyle: "dashed" };
assert.equal(shapeIntersectsSegment(dash, point(.105, .49), point(.105, .51), .0002), true);
assert.equal(shapeIntersectsSegment(dash, point(.121, .4999), point(.121, .5001), .0002), false, "dash gap was treated as a solid baseline");
assert.ok(distanceToShapeGeometry(point(.121, .5), dash) > .003);
const wave = { ...dash, lineStyle: "wavy", waveSize: 3 };
const wavePoint = shapeGeometry(wave).paths[0][8];
assert.ok(distanceToShapeGeometry(wavePoint, wave) < 1e-8);
assert.ok(getShapeBounds(wave).top < .49, "wave amplitude omitted from bounds");
const triangle = { ...base, tool: "triangle", start: point(.2, .2), end: point(.6, .7), vertices: [{ x: .1, y: 0 }, { x: 1, y: .9 }, { x: 0, y: 1 }] };
const moved = { ...triangle, start: point(.3, .3), end: point(.7, .8) };
shapeGeometry(triangle).paths[0].forEach((p, i) => assert.ok(Math.abs(shapeGeometry(moved).paths[0][i].x - p.x - .1) < 1e-8));
same(normalizeShapeFields(base), base, "legacy optional fields changed");
const malformed = normalizeShapeFields({ ...base, opacity: NaN, waveSize: Infinity, lineStyle: "unknown", vertices: [null], aspectRatio: -100 });
assert.ok(Number.isFinite(malformed.opacity) && Number.isFinite(malformed.waveSize)); assert.equal(malformed.lineStyle, undefined); assert.equal(malformed.vertices, undefined);
assert.equal(annotationOpacity({ tool: "highlighter" }), .24); assert.equal(annotationOpacity({ tool: "line" }), .96);
const tools = new ToolStateController(DEFAULT_TOOL_PRESETS);
const pen = tools.snapshot;
tools.setActiveTool("line"); tools.setColor("#abcdef"); tools.setWidth(19);
const options = tools.shapeOptions; options.appearance = "highlighter"; options.highlighter.width = 34; tools.setShapeOptions(options);
tools.setActiveTool("pen"); assert.equal(tools.activeColor, pen.activeColor); assert.equal(tools.getWidth(), pen.widths.pen);
tools.setActiveTool("line"); assert.equal(tools.getWidth(), 19); assert.equal(tools.shapeOptions.appearance, "pen");
assert.equal(normalizeShapeOptions({ method: "drag", shape: "auto" }).shape, "line");
// Pen/Highlighter controls must be independent from Shapes and each other.
{
  const state = new ToolStateController(DEFAULT_TOOL_PRESETS.map(p => ({...p})));
  assert.equal(state.getInkShapeOptions("pen"), null, "new Pen state must keep normal freehand");
  state.setActiveTool("highlighter");
  assert.equal(state.getInkShapeOptions("highlighter"), null, "new Highlighter state must keep normal freehand");
  const shapeBefore = JSON.stringify(state.shapeOptions);
  state.setInkToolOptions("highlighter", {...state.getInkToolOptions("highlighter"),mode:"straight",lineStyle:"dotted"});
  state.setColor("#123456");state.setWidth(22);
  const gesture=state.getInkShapeOptions("highlighter");
  assert.equal(gesture.method,"drag");assert.equal(gesture.shape,"line");assert.equal(gesture.lineStyle,"dotted");
  assert.equal(gesture.highlighter.color,"#123456");assert.equal(gesture.highlighter.width,22);
  assert.equal(gesture.highlighter.opacity,state.activeOpacity);
  assert.equal(state.getInkToolOptions("pen").mode,"freehand");assert.equal(JSON.stringify(state.shapeOptions),shapeBefore);
  state.setActiveTool("pen");state.setInkToolOptions("pen",{...state.getInkToolOptions("pen"),mode:"hold",holdShape:"auto"});
  assert.equal(state.getInkShapeOptions("pen"),null,"Legacy per-pen hold preference migrates to freehand; Shapes owns hold");
  const snapshot=state.snapshot;snapshot.inkToolOptions.pen.mode="straight";
  assert.equal(state.getInkToolOptions("pen").mode,"freehand","snapshot mutation leaked into live state");
  const restored=new ToolStateController(DEFAULT_TOOL_PRESETS.map(p=>({...p})),state.snapshot);
  assert.equal(restored.getInkToolOptions("highlighter").mode,"straight");assert.equal(restored.getInkToolOptions("highlighter").lineStyle,"dotted");
  assert.equal(restored.getInkToolOptions("pen").mode,"freehand");
  const unknown=new ToolStateController(DEFAULT_TOOL_PRESETS.map(p=>({...p})),{inkToolOptions:{pen:{mode:"unexpected",holdShape:"bad",lineStyle:"bad",waveSize:NaN}}});
  assert.equal(unknown.getInkToolOptions("pen").mode,"freehand");assert.equal(unknown.getInkToolOptions("pen").lineStyle,"solid");
}

function polyline(vertices, noise = 0) {
  const points = [];
  for (let i = 1; i < vertices.length; i++) for (let j = 0; j < 30; j++) { const t = j / 30; points.push(point(vertices[i - 1][0] + (vertices[i][0] - vertices[i - 1][0]) * t + Math.sin(j * 3) * noise, vertices[i - 1][1] + (vertices[i][1] - vertices[i - 1][1]) * t + Math.cos(j * 2) * noise)); }
  points.push(point(...vertices[vertices.length - 1])); return points;
}
const gestures = {
  line: polyline([[.2, .3], [.8, .47]], .001),
  rectangle: polyline([[.2, .2], [.8, .2], [.8, .65], [.2, .65], [.2, .2]], .001),
  triangle: polyline([[.5, .2], [.8, .7], [.2, .7], [.5, .2]], .001),
  ellipse: Array.from({ length: 150 }, (_, i) => point(.5 + Math.cos(i / 149 * Math.PI * 2) * .3 + Math.sin(i * 3) * .001, .45 + Math.sin(i / 149 * Math.PI * 2) * .2))
};
for (const [tool, points] of Object.entries(gestures)) {
  assert.equal(fitGesture(points, "auto", 1.4)?.tool, tool, `Auto failed noisy ${tool}`);
  assert.equal(fitGesture(points, tool, 1.4)?.tool, tool);
}
for (const vertices of [ [[.1,.2],[.8,.7],[.2,.7],[.8,.2],[.1,.2]], [[.2,.2],[.8,.2],[.5,.4],[.8,.7],[.2,.7],[.2,.2]], [[.2,.2],[.2,.7],[.6,.7],[.6,.4]], [[.3,.3],[.3,.3]] ]) assert.equal(fitGesture(polyline(vertices), "auto", 1.4), null, "Auto forced scribble/letter into shape");
assert.equal(fitGesture([point(0, 0), point(1e-10, 1e-10)], "auto"), null);
console.log("Shape geometry/recognition passed: patterns, zoom, bounds, visible gaps, noisy fits, scribbles, legacy fields and isolated settings.");

// Real session methods with only host surfaces/saving replaced by in-memory adapters.
const source = fs.readFileSync(path.join(root, "main.ts"), "utf8"), ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === "NativePdfAnnotatorSession");
const names = ["handlePointerDownForCanvas", "handlePointerMoveForCanvas", "handlePointerUpForCanvas", "getNormalizedPoints", "startShapeGesture", "constrainShapePreview", "updateShapeModifiers", "finishShapeGesture", "clearShapeGesture", "cancelActiveSessionInteraction", "pushHistory", "pushStrokeAddHistory", "pushHistoryEntry", "cloneStroke", "undo", "redo", "markDirtyAndRedraw", "moveSelectedTarget", "scaleTargetWithinBounds", "setActiveTool", "applyPreset", "releasePageCanvasResources", "appendFinalStrokeSamples", "getNormalizedPointFromRect"];
const methods = names.map(name => { const member = cls.members.find(n => n.name?.getText(ast) === name); assert.ok(member, name); return member.getText(ast); }).join("\n");
let nextId = 0;
const context = { ...require("../src/shapes/constraints.ts"), isShapeTool: tool=>["line","rectangle","ellipse","triangle"].includes(tool), HoldGesture, fitGesture, appendStrokePoints, generateId: () => `fixture-${++nextId}`, cloneDocument: d => JSON.parse(JSON.stringify(d)), MAX_HISTORY: 100, performance, getCoalescedPointerEvents: require("../src/pointer/pointerInput.ts").getCoalescedPointerEvents, resolvePointerPressure: require("../src/pointer/pointerInput.ts").resolvePointerPressure, clamp: (n,a,b) => Math.max(a,Math.min(b,n)), isInkDrawingTool: require("../src/pointer/pointerInput.ts").isInkDrawingTool };
vm.runInNewContext(ts.transpileModule("class Session {" + methods + "}globalThis.Session=Session;", { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
context.shouldIgnoreInkPointerEvent=require("../src/pointer/pointerInput.ts").shouldIgnoreInkPointerEvent;
function fixture() {
  const tasks = new Map(); let now = 0, serial = 0;
  const clock = { setTimeout(fn, ms) { const id = ++serial; tasks.set(id, { fn, due: now + ms }); return id; }, clearTimeout(id) { tasks.delete(id); } };
  const tick = ms => { now += ms; for (const [id, job] of [...tasks]) if (job.due <= now) { tasks.delete(id); job.fn(); } };
  const sut = new context.Session();
  const rect = { left: 0, top: 0, width: 1000, height: 1400 };
  const surface = { pageNumber: 1, lastWidth: 1000, lastHeight: 1400, overlayEl: { isConnected: true, getBoundingClientRect: () => rect }, transientEl: {} };
  Object.assign(sut, { toolState: new ToolStateController(DEFAULT_TOOL_PRESETS), ownerWindow: clock, annotationDocument: { version: 1, sourceFile: "fixture.pdf", updatedAt: "fixture", strokes: [], shapes: [], textItems: [] }, pageSurfaces: new Map([[1, surface]]),
    selectedTargets: [], pendingCommittedRedrawPages: new Set(), annotationMode: true, publishedFrames: new WeakMap(), pageRenderSlots: new Map(), snapshotCanvases: new Set(), pageResidency: {forget() {}},
    persistToolDefaults() {}, applyOverlayMode() {}, shouldApplyStyleToSelection: () => false, cancelPageRenderJob() {}, promoteCurrentTransientPreview() {}, deferCommittedPageRedraw() {}, scheduleMotionPreviewPreparation() {},
    currentStroke: null, currentShape: null, pointerPage: null, currentLasso: null, dragAnchor: null, erasingSession: false, undoStack: [], redoStack: [], objectErasePreviewTargets: new Map(), documentRevision: 0, nextPageZIndexCache: new Map(), saves: 0,
    plugin: { getInkRenderSettings: () => ({ inkModel: "continuous-v1", taperStart: 0, taperEnd: 0 }) }, getStableAnnotationWidthScale: w => w / 1524, getNextPageZIndex: () => 5,
    getNormalizedPointFromRect: (_, event) => point(event.clientX / 1000, event.clientY / 1400), getStrokeMergeThreshold: () => .0001,
    scheduleInteractionRedraw() {}, drawTransientPageAnnotations() {}, refreshStatus() {}, unbindPdfPointerDocumentTracking() {}, cancelPendingInteractionRedraw() {}, clearTransientLayer() {}, refreshToolPreviewFromLastPointer() {}, drawPageAnnotations() {}, drawAllAnnotations() {},
    appendFinalStrokeSamples() {}, invalidateAnnotationPageCache() {}, scheduleSave() { this.saves++; }, store: { inheritBaseline() {} }, scheduleSyncPages() {}, redrawHistoryChangeImmediately() {}, refreshToolbar() {}, showDrawingNotice() {}, currentPage: 1 });
  return { sut, surface, tick, tasks };
}
function startHold(choice = "auto") {
  const f = fixture(), options = normalizeShapeOptions({ method: "hold", shape: choice }); f.sut.toolState.setShapeOptions(options);
  f.sut.startShapeGesture(f.surface, { pointerType: "pen" }, gestures.line[0], false);
  f.sut.assistedShapeSource.points = gestures.line;
  for (const point of gestures.line) f.sut.shapeHold.move(point);
  return f;
}

// Drag sizing is free until a modifier is held, and release uses the same preview.
for (const tool of ["line","rectangle","ellipse","triangle"]) {
 for (const shiftKey of [false,true]) {
  const {sut,surface}=fixture();sut.currentTool=tool;
  const options=normalizeShapeOptions({method:"drag",shape:tool});
  sut.startShapeGesture(surface,{pointerType:"pen",shiftKey},point(.1,.2),options);
  sut.finishShapeGesture({clientX:700,clientY:560,shiftKey},null);
  const saved=sut.annotationDocument.shapes[0];assert.equal(saved.tool,tool);assert.equal(sut.undoStack.length,1);
  if(!shiftKey){same(saved.start,point(.1,.2),"Free drag moved the first anchor");same(saved.end,point(.7,.4),"Free drag silently constrained the opposite anchor")}
  else if(tool==="rectangle"||tool==="ellipse")assert.ok(Math.abs(Math.abs(saved.end.x-saved.start.x)-Math.abs(saved.end.y-saved.start.y)*1.4)<1e-10,"Held modifier must produce physical square/circle");
  sut.undo();assert.equal(sut.annotationDocument.shapes.length,0);sut.redo();assert.equal(sut.annotationDocument.shapes[0].tool,tool);
 }
}
{
 const {sut,surface}=fixture();sut.currentTool="rectangle";
 sut.startShapeGesture(surface,{pointerType:"pen",shiftKey:true},point(.1,.2),normalizeShapeOptions({method:"drag",shape:"rectangle"}));
 sut.finishShapeGesture({clientX:700,clientY:560,shiftKey:false},null);
 same(sut.annotationDocument.shapes[0].end,point(.7,.4),"Releasing the modifier must restore free sizing");
}
console.log("Restored drag shapes passed: all four shapes, free sizing by default, temporary constraints, modifier release and single-step Undo/Redo.");


// Replay complete pointer down/move/quiet hold/up, not just the fitting helper.
{
 const {sut,surface,tick}=fixture(),canvas=surface.overlayEl,rect=canvas.getBoundingClientRect();
 canvas.dataset={pageNumber:'1'};canvas.setCssStyles=()=>{};canvas.setPointerCapture=()=>{};canvas.releasePointerCapture=()=>{};
 Object.assign(sut,{currentTool:'line',currentColor:'#55b4ff',svgRenderer:{hideMotionPreviews(){}},getOverlayTouchAction:()=> 'none',getInkInputPolicy:()=> 'pen-mouse-only',pauseCommittedRenderingForInkInput(){},resumeCommittedRenderingAfterInkInput(){},forceFinishStalePdfInteraction(){},renderTelemetry:{recordPointerDown(){},recordPointerUp(){}},bindPdfPointerDocumentTracking(_id,canvas,rect){this.activePdfPointerCanvas=canvas;this.activePdfPointerRect=rect;}});
 const points=Array.from({length:150},(_,i)=>{const a=i/149*Math.PI*2,r=1+.10*Math.sin(3*a)+.04*Math.cos(5*a);return point(.5+.2*r*Math.cos(a),.5+.2*r*Math.sin(a)/1.4)});
 const event=(p,i)=>({pointerType:'pen',pointerId:7,clientX:p.x*rect.width,clientY:p.y*rect.height,timeStamp:100+i*8,pressure:.5,preventDefault(){}});
 sut.handlePointerDownForCanvas(event(points[0],0),canvas);
 points.slice(1).forEach((p,i)=>sut.handlePointerMoveForCanvas(event(p,i+1),canvas));
 assert.ok(sut.assistedShapeSource.points.length>100,'Pointer path lost the drawn outline');
 tick(500);assert.equal(sut.currentShape?.tool,'ellipse');
 sut.handlePointerUpForCanvas(event(points.at(-1),151),canvas);
 assert.equal(sut.annotationDocument.shapes[0]?.tool,'ellipse');assert.equal(sut.annotationDocument.strokes.length,0);assert.equal(sut.saves,1);
 console.log('Complete Shapes pointer path passed: rough outline, held preview, release and one save.');
}
{
  const { sut, tick, tasks } = startHold(); tick(499); assert.equal(sut.currentShape, null); tick(1); assert.equal(sut.currentShape.tool, "line");
  assert.equal(sut.annotationDocument.shapes.length, 0, "timer committed a shape");
  sut.finishShapeGesture({ clientX: 800, clientY: .47 * 1400 }, null);
  assert.equal(sut.annotationDocument.shapes.length, 1); assert.equal(sut.annotationDocument.strokes.length, 0); assert.equal(sut.saves, 1, "intermediate source ink was saved"); assert.equal(sut.undoStack.length, 2); assert.equal(tasks.size, 0);
  const final = JSON.stringify(sut.annotationDocument.shapes);
  sut.undo(); assert.equal(sut.annotationDocument.shapes.length, 0); assert.equal(sut.annotationDocument.strokes.length, 1);
  sut.undo(); assert.equal(sut.annotationDocument.strokes.length, 0);
  sut.redo(); assert.equal(sut.annotationDocument.strokes.length, 1);
  sut.redo(); assert.equal(JSON.stringify(sut.annotationDocument.shapes), final); assert.equal(sut.annotationDocument.strokes.length, 0);
}
{
  const { sut, tick } = startHold(); tick(500); sut.shapeHold.move(point(.85, .5)); assert.equal(sut.currentShape, null); assert.ok(sut.currentStroke);
  tick(499); assert.equal(sut.currentShape, null);
  sut.cancelActiveSessionInteraction(); tick(1000); assert.equal(sut.currentShape, null); assert.equal(sut.saves, 0); assert.equal(sut.undoStack.length, 0);
}
{
  const { sut, tick } = startHold(); sut.finishShapeGesture({ clientX: 800, clientY: .47 * 1400 }, null); tick(1000);
  assert.equal(sut.annotationDocument.strokes.length, 1); assert.equal(sut.annotationDocument.shapes.length, 0); assert.equal(sut.undoStack.length, 1);
}
{
  const { sut, surface, tick } = fixture();
  sut.startShapeGesture(surface, { pointerType: "mouse" }, point(.1, .2), normalizeShapeOptions({ method: "drag", shape: "line" }));
  sut.finishShapeGesture({ clientX: 600, clientY: 420 }, null); tick(1000);
  assert.equal(sut.annotationDocument.shapes.length, 1); assert.equal(sut.annotationDocument.shapes[0].end.y, .3); assert.equal(sut.undoStack.length, 1);
  sut.undo(); assert.equal(sut.annotationDocument.shapes.length, 0);
  sut.startShapeGesture(surface, { pointerType: "mouse" }, point(.1, .2), normalizeShapeOptions({ method: "drag", shape: "line" })); sut.finishShapeGesture({ clientX: 100, clientY: 280 }, null);
  assert.equal(sut.annotationDocument.shapes.length, 0); assert.equal(sut.undoStack.length, 0);
}
{
  const { sut, surface } = fixture(); sut.toolState.setActiveTool("highlighter"); sut.currentColor = sut.toolState.activeColor;
  const before = JSON.stringify(sut.toolState.snapshot);
  sut.startShapeGesture(surface, { pointerType: "mouse" }, point(.1, .2), true);
  assert.equal(sut.currentShape.appearance, "highlighter"); assert.equal(sut.currentShape.lineStyle, "solid");
  sut.finishShapeGesture({ clientX: 700, clientY: 560 }, null); assert.equal(JSON.stringify(sut.toolState.snapshot), before, "Shift override leaked persistent tool state");
}
// Real gesture path from normal Pen and Highlighter, with touch-accessible modes.
for (const kind of ["pen","highlighter"]) {
  const {sut,surface,tick}=fixture();sut.toolState.setActiveTool(kind);
  sut.toolState.setInkToolOptions(kind,{...sut.toolState.getInkToolOptions(kind),mode:"straight",lineStyle:"wavy"});
  const persistent=JSON.stringify(sut.toolState.snapshot), options=sut.toolState.getInkShapeOptions(kind);
  sut.startShapeGesture(surface,{pointerType:"pen"},point(.1,.2),options);
  assert.equal(sut.currentShape.appearance,kind);assert.equal(sut.currentShape.lineStyle,"wavy");
  assert.equal(sut.currentShape.color,sut.toolState.activeColor);assert.equal(sut.currentShape.width,sut.toolState.getWidth(kind));
  sut.finishShapeGesture({clientX:700,clientY:560},null);tick(1000);
  assert.equal(sut.annotationDocument.shapes.length,1);assert.equal(sut.annotationDocument.shapes[0].end.y,.4);
  assert.equal(JSON.stringify(sut.toolState.snapshot),persistent,"gesture rewrote independent preferences");
}
// A long, continuously moving line must keep resetting its hold deadline.
{
  let fits = 0; const tasks = new Map(); let now = 0, serial = 0;
  const clock = { setTimeout(fn, ms) { tasks.set(++serial, { fn, due: now + ms }); return serial; }, clearTimeout(id) { tasks.delete(id); } };
  const gesture = new HoldGesture(clock, point(0, 0), { width: 1000, height: 1000, tolerance: 3 }, () => fits++, () => {});
  for (let i = 1; i < 50; i++) { now += 100; gesture.move(point(i / 2000, 0)); for (const [id, task] of tasks) if (task.due <= now) { tasks.delete(id); task.fn(); } }
  assert.equal(fits, 0); gesture.cancel(); assert.equal(tasks.size, 0);
}

{
  const {sut,tick}=startHold();tick(500);
  sut.appendFinalStrokeSamples=context.Session.prototype.appendFinalStrokeSamples;
  sut.getNormalizedPointFromRect=context.Session.prototype.getNormalizedPointFromRect;
  sut.lastPdfPointTime=100;sut.lastPdfPoint={clientX:800,clientY:.47*1400};sut.assistedShapeSource.inkSettings.strokeGeometry="round";
  const event={type:"pointerup",pointerType:"pen",pointerId:1,timeStamp:200,pressure:0,clientX:800,clientY:.47*1400,getCoalescedEvents:()=>[{type:"pointermove",pointerType:"pen",pointerId:1,timeStamp:150,pressure:.9,clientX:850,clientY:700}]};
  sut.finishShapeGesture(event,null);
  assert.equal(sut.annotationDocument.shapes.length,0,"release excursion must revert the fitted preview");
  const points=sut.annotationDocument.strokes[0].points;
  assert.ok(points.some(p=>p.t===150&&p.pressure===.9),"coalesced release curve/pressure was discarded");
  assert.equal(points.at(-1).pressure,.9,"lift event replaced actual final contact pressure");
}
for (const cancel of [s => s.setActiveTool("pen"), s => s.applyPreset("highlight-slot-1"), s => s.releasePageCanvasResources(1)]) {
  const { sut, tick, tasks } = startHold(); cancel(sut); tick(1000);
  assert.equal(sut.currentShape, null); assert.equal(sut.currentStroke, null); assert.equal(tasks.size, 0); assert.equal(sut.saves, 0);
}
for (const shape of [triangle, wave, dash, {...dash,lineStyle:"dotted"}]) {
  const {sut} = fixture(); sut.annotationDocument.shapes = [JSON.parse(JSON.stringify(shape))];
  const target = {kind:"shape",id:shape.id,page:1};
  sut.moveSelectedTarget(target,.01,.02);
  assert.ok(Math.abs(sut.annotationDocument.shapes[0].start.x-shape.start.x-.01)<1e-10);
  const styleBefore = JSON.stringify([shape.vertices,shape.lineStyle,shape.waveSize,shape.widthScale]);
  sut.scaleTargetWithinBounds(target,{left:0,top:0,right:1,bottom:1},{left:.1,top:.1,right:.6,bottom:.6},.5,.5);
  const resized = sut.annotationDocument.shapes[0];
  assert.ok(Math.abs(resized.start.x-(.1+(shape.start.x+.01)*.5))<1e-10);
  assert.equal(JSON.stringify([resized.vertices,resized.lineStyle,resized.waveSize,resized.widthScale]),styleBefore);
}
{
  let callback, fits=0;
  const gesture=new HoldGesture({setTimeout(fn){callback=fn;return 1},clearTimeout(){}},point(0,0),{width:1000,height:1000,tolerance:4},()=>fits++,()=>{});
  gesture.cancel();callback();assert.equal(fits,0,"stale timer bypassed cancellation generation");
}

for (const [x, expected] of [[.121, 1], [.105, 0]]) {
  const doc = { strokes: [], textItems: [], shapes: [{ ...dash, zIndex: 1 }], eraserPaths: [{ id: "erase", page: 1, zIndex: 2, radiusScale: .0001, points: [point(x, .4999), point(x, .5001)] }] };
  migrateLegacyEraserPaths(doc); assert.equal(doc.shapes.length, expected, "object erasure ignored visible dash geometry");
}
console.log("Assisted session passed: preview-only hold, early release, movement reset, cancellation, zero-length rejection, atomic save, two-step undo/redo, Shift isolation and slow-stroke timer.");
// Obsidian's Document.createDiv appends to its receiver, so it throws when an
// HTML root is already present. Repeated openings must use unattached elements.
{
  const control=new Proxy({}, {get:(_target,key)=>key==="then"?undefined:key==="sliderEl"?{setAttribute(){}}:(..._args)=>control});
  class Setting {
    constructor(){this.settingEl={};}
    setName(){return this}setHeading(){return this}setDesc(){return this}
    addExtraButton(fn){fn(control);return this}addDropdown(fn){fn(control);return this}
    addColorPicker(fn){fn(control);return this}addSlider(fn){fn(control);return this}
  }
  const document={createDiv(){throw new DOMException("Only one root element is allowed","HierarchyRequestError")},createElement(){return {dataset:{},isConnected:false,className:"",setAttribute(){},empty(){},createEl(){return{}},querySelectorAll(){return []}}}};
  const loadPopover=(file)=>{
    const module={exports:{}};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:name=>name==="obsidian"?{Setting}:name.endsWith("shapeOptionsRows")?loadPopover("src/ui/shapeOptionsRows.ts"):name.endsWith("inkToolOptions")?require("../src/shapes/inkToolOptions.ts"):require("../src/shapes/shapeOptions.ts")});
    return module.exports;
  };
  assert.throws(()=>document.createDiv(),{name:"HierarchyRequestError"});
  const shapePopover=loadPopover("src/ui/shapeOptionsPopover.ts").createShapeOptionsPopover;
  for(let i=0;i<3;i++) {
    assert.equal(shapePopover(document,normalizeShapeOptions(),()=>{},()=>{}).isConnected,false);
  }
  console.log("Shape popover ownership passed: repeated Shape options creation avoids Document root append errors.");
}
if (previous) require.extensions[".ts"] = previous; else delete require.extensions[".ts"];

