const fs = require("fs"), path = require("path"), vm = require("vm");
const assert = require("assert/strict"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "main.ts"), "utf8");
const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const sessionClass = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "NativePdfAnnotatorSession");
function session(names, globals = {}) {
	const members = sessionClass.members.filter(member => names.includes(member.name?.getText(tree)));
	const context = { console, ...globals };
	vm.runInNewContext(ts.transpileModule(`class Session {${members.map(member => member.getText(tree)).join("\n")}} globalThis.Session = Session;`, {
		compilerOptions: { target: ts.ScriptTarget.ES2020 }
	}).outputText, context);
	return new context.Session();
}

// Exercise navigation's actual call chain: a page list must not scan every stroke once per page.
let pageReads = 0, templateChecks = 0;
const pageCount = 100, strokeCount = 10000;
const document = {
	strokes: Array.from({ length: strokeCount }, (_, index) => ({
		id: String(index), get page() { pageReads++; return index % pageCount + 1; }
	})),
	textItems: [{ page: 1 }], shapes: [{ page: 2 }], imageItems: [{ page: 3 }],
	appendedPages: [{ id: "added", title: "Notes", insertAfterPdfPage: 1, template: "grid", pageSize: "a4" }],
	deletedPdfPages: [2], pdfPageTemplates: [{ page: 1, template: "ruled", pageSize: "a4" }]
};
const pages = session([
	"getPageAnnotationCounts", "getMixedPageEntries", "getRemovedPageEntries",
	"getPageAnnotationBucket", "getSyntheticPageInsertAfterPdfPage", "isPdfPageDeleted"
], {
	clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
	hasEditableNativePageTemplates: () => { templateChecks++; return true; },
	getNotebookTemplateLabel: value => value, getNotebookPageSizeLabel: value => value
});
Object.assign(pages, { annotationDocument: document, realPdfPageCount: pageCount, annotationPageCache: null });
const pageStart = performance.now();
const entries = pages.getMixedPageEntries();
const pageMs = performance.now() - pageStart;
assert.equal(entries.length, pageCount, "Hidden page must be replaced by the added page in this fixture");
assert.equal(entries[0].annotationCount, 101);
assert.equal(entries[0].template, "ruled");
assert.equal(entries[1].pageId, "added");
assert.equal(entries[1].annotationCount, 0);
assert.equal(entries[2].annotationCount, 101);

// Measure warm outline lookups independently of geometry generation or the GPU.
let serializations = 0, builds = 0;
const outlines = session(["getStrokePathSignature", "getCachedStrokeOutline"], {
	JSON: { stringify(value) { serializations++; return JSON.stringify(value); } },
	getSmoothInkStrokeOutline: () => { builds++; return [[0, 0], [1, 0], [1, 1], [0, 1]]; }
});
outlines.strokePathCache = new WeakMap();
const surface = { lastWidth: 1000, lastHeight: 1400 };
const points = Array.from({ length: 100 }, (_, i) => ({ x: i / 100, y: .5, pressure: .5 }));
const inkSettings = { thinning: .5, streamline: .12, smoothing: .5, easing: "linear", taperStart: 0, taperEnd: 0, pressureMode: "auto" };
const strokes = Array.from({ length: strokeCount }, (_, i) => ({ id: String(i), points, inkSettings }));
for (const stroke of strokes) outlines.getCachedStrokeOutline(surface, stroke, 4, true, false);
serializations = 0;
const cacheStart = performance.now();
for (const stroke of strokes) outlines.getCachedStrokeOutline(surface, stroke, 4, true, false);
const cacheMs = performance.now() - cacheStart;
assert.equal(builds, strokeCount, "Warm redraws must reuse all outlines");
console.log(`Runtime measurement: ${strokeCount} strokes/${pageCount} pages; navigation=${pageMs.toFixed(2)}ms, pageReads=${pageReads}, templateChecks=${templateChecks}; warm cache=${cacheMs.toFixed(2)}ms, serializations=${serializations}`);
assert.ok(pageReads <= strokeCount * 2, "Navigation must visit each annotation at most twice, independent of page count");
assert.equal(templateChecks, 1, "Template eligibility must be checked once per page list");
assert.equal(serializations, 0, "Warm stroke redraws must not serialize settings");
assert.equal(pages.getRemovedPageEntries()[0].annotationCount, 101, "Removed pages must retain their annotation counts");
assert.equal(pages.getMixedPageEntries(null).length, pageCount, "Unannotated PDFs must still list every page");

// Geometry-affecting edits invalidate; color-only edits keep the same outline.
const stroke = strokes[0];
const cached = outlines.getCachedStrokeOutline(surface, stroke, 4, true, false);
stroke.color = "#f00";
assert.equal(outlines.getCachedStrokeOutline(surface, stroke, 4, true, false), cached);
for (const change of [
	() => { stroke.points = points.map(point => ({ ...point, x: point.x + .01 })); },
	() => { stroke.points.push({ x: .5, y: .5, pressure: .4 }); },
	() => { stroke.inkSettings = { ...inkSettings, thinning: .8 }; },
	() => { stroke.cutStart = true; },
	() => { stroke.cutEnd = true; },
	() => { surface.lastWidth += .001; },
	() => { surface.lastHeight += .001; }
]) {
	const oldBuilds = builds;
	change();
	outlines.getCachedStrokeOutline(surface, stroke, 4, true, false);
	assert.equal(builds, oldBuilds + 1, "Edited or resized strokes must rebuild their outlines");
}
const beforeWidthChange = builds;
outlines.getCachedStrokeOutline(surface, stroke, 4.001, true, false);
assert.equal(builds, beforeWidthChange + 1, "Subpixel stroke width changes must invalidate the outline");
const widthBuilds = builds;
outlines.getCachedStrokeOutline(surface, stroke, 4.001, false, false);
assert.equal(builds, widthBuilds + 1, "Pressure mode must invalidate the outline");
assert.equal(outlines.getCachedStrokeOutline(surface, stroke, 4, true, true), null, "Predicted ink must bypass the committed cache");
const beforeClone = builds;
outlines.getCachedStrokeOutline(surface, { ...stroke }, 4.001, false, false);
assert.equal(builds, beforeClone + 1, "Different stroke objects with the same id must not share cache entries");
// A foreign document snapshot must have its own counts, even after the active index was populated.
const snapshot = { ...document, strokes: [{ page: 1 }] };
assert.equal(pages.getMixedPageEntries(snapshot)[0].annotationCount, 2);
assert.equal(pages.getMixedPageEntries()[0].annotationCount, 101);
console.log("Runtime efficiency passed: linear page enumeration and allocation-free warm outline validation.");
