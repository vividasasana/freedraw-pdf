const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript");
const source = fs.readFileSync(path.join(__dirname, "..", "main.ts"), "utf8");
const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const sessionClass = tree.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === "NativePdfAnnotatorSession");
const names = ["getPageFrameKey", "getStableSurfaceSize", "previewResizeOverlay", "startPageRenderJob", "drawImageAnnotation"];
const methods = sessionClass.members.filter(n => names.includes(n.name?.getText(tree))).map(n => n.getText(tree)).join("\n");
let loadedImage;
const context = { Image: class { constructor() { loadedImage = this; } }, SvgDrawingContext: class {}, isEmbeddedImageDataUrl: () => true };
vm.runInNewContext(ts.transpileModule(`class Session {${methods}} globalThis.Session = Session;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
const session = new context.Session();
const styles = {};
const surface = { pageNumber: 1, lastWidth: 1000, lastHeight: 1400, pendingWidth: 1000, pendingHeight: 1400,
 hostEl: { isConnected: true, clientWidth: 1000, clientHeight: 1400, getBoundingClientRect: () => ({ width: 4000, height: 5600 }) },
 pageEl: { clientWidth: 1000, clientHeight: 1400 },
 vectorEl: { setCssStyles: values => Object.assign(styles, values) },
 overlayEl: { isConnected: true, setCssStyles() {} }, transientEl: { setCssStyles() {} } };
let builds = 0, cancellations = 0;
Object.assign(session, { documentRevision: 1, ownerWindow: { devicePixelRatio: 2 }, selectedTargets: [],
 inlineTextTargetId: null, inlineTextPageNumber: null, lastSelectionRegion: null, focusedRegion: null,
 annotationDocument: { strokes: Array.from({ length: 10000 }, () => ({})) },
 pageSurfaces: new Map([[1, surface]]), publishedFrames: new WeakMap(), pendingRedrawPages: new Set(),
 svgRenderer: { hasCommittedFrame: () => true }, isViewportMotionActive: () => false, hasActiveTransientRender: () => false,
 ensureOverlayLayerOrder() {}, resizeOverlay() {}, resizeInlineTextEditorForSurface() {},
 cancelPageRenderJob() { cancellations++; }, createSvgDrawingContext() { builds++; return null; }, getNextPageRenderSlot: () => null });
const stable = session.getStableSurfaceSize(surface);
assert.equal(stable.width, 1000, "Pinch transforms must not be counted as layout width");
assert.equal(stable.height, 1400);
session.previewResizeOverlay(surface);
assert.equal(styles.width, "100%", "SVG must follow the page without waiting for the redraw queue");
assert.equal(styles.height, "100%");
session.publishedFrames.set(surface.overlayEl, session.getPageFrameKey(surface));
for (let i = 0; i < 21; i++) {
 surface.lastWidth = 500 + i * 400; surface.lastHeight = surface.lastWidth * 1.4;
 session.startPageRenderJob(1);
}
assert.equal(builds, 0, "Zooming an unchanged 10,000-stroke vector page must not rebuild its geometry");
assert.equal(cancellations, 21, "Obsolete queued jobs must be cancelled when retaining a current SVG frame");
session.documentRevision++;
session.startPageRenderJob(1);
assert.equal(builds, 1, "Actual edits must still queue a fresh frame");
session.imageElementCache = new Map();
let imageRedraws = 0;
session.schedulePageRedraw = () => imageRedraws++;
session.publishedFrames.set(surface.overlayEl, session.getPageFrameKey(surface));
session.drawImageAnnotation({ save() {}, restore() {}, setLineDash() {}, strokeRect() {} }, surface, { id: "image", page: 1, dataUrl: "data:image/png;base64,AA==", x: 0, y: 0, widthScale: .1, heightScale: .1 });
loadedImage.onload();
assert.equal(imageRedraws, 1);
assert.equal(session.publishedFrames.has(surface.overlayEl), false, "Newly loaded images must invalidate retained frames");
session.startPageRenderJob(1);
assert.equal(builds, 2, "Image completion must not be mistaken for a zoom-only change");
const rasterSurface = { ...surface, vectorEl: undefined };
const before = session.getPageFrameKey(rasterSurface);
rasterSurface.lastWidth *= 2;
assert.notEqual(session.getPageFrameKey(rasterSurface), before, "Raster fallbacks must still refresh at new sizes");
console.log("Vector zoom passed: immediate page-relative sizing, transform-safe layout and zero geometry rebuilds over 21 zoom steps.");
