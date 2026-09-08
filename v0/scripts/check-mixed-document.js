const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assertContains(fileName, content, needle, message) {
	if (!content.includes(needle)) {
		throw new Error(`${fileName}: ${message}\nMissing: ${needle}`);
	}
}

function assertNotContains(fileName, content, needle, message) {
	if (content.includes(needle)) {
		throw new Error(`${fileName}: ${message}\nUnexpected: ${needle}`);
	}
}

const mainTs = read("main.ts");
const mixedExportTs = read("src/export/mixedDocumentExport.ts");
const pageLifecycleTs = read("src/notebook/pageLifecycle.ts");
const annotationStoreTs = read("src/stores/annotationStore.ts");
const typesTs = read("src/types.ts");
const stylesCss = read("styles.css");
const packageJson = JSON.parse(read("package.json"));
const builtMainPath = path.join(projectRoot, "main.js");
const builtMain = fs.existsSync(builtMainPath) ? fs.readFileSync(builtMainPath, "utf8") : "";

assertContains("main.ts", mainTs, "id: \"create-blank-annotatable-pdf\"", "scratch native PDF command must be registered");
assertContains("main.ts", mainTs, "Create blank annotatable PDF", "scratch native PDF workflow must be visible");
assertContains("main.ts", mainTs, "this.addRibbonIcon(\"file-plus-2\", \"Create blank annotatable PDF\"", "scratch native PDF workflow must have a visible ribbon entry");
assertContains("main.ts", mainTs, "buildPdfFromJpegPages(pages)", "scratch native PDF workflow must create a real PDF");
assertContains("main.ts", mainTs, "createEmptyDocument(pdfFile)", "scratch native PDF must create an annotation sidecar document");
assertContains("main.ts", mainTs, "annotationDocument.nativePageTemplatesEditable = true", "scratch native PDFs must be explicitly marked as plugin-created");
assertContains("main.ts", mainTs, "annotationDocument.pdfPageTemplates =", "scratch native PDFs must store editable template metadata");
assertContains("main.ts", mainTs, "hasEditableNativePageTemplates(this.annotationDocument, this.realPdfPageCount)", "native-page template editing must be restricted to plugin-created PDFs");
assertContains("main.ts", mainTs, "await this.store.save(pdfFile, annotationDocument)", "scratch native PDF must save the annotation sidecar");

assertContains("main.ts", mainTs, "id: \"export-annotated-mixed-pdf\"", "mixed annotated PDF export command must be registered");
assertContains("main.ts", mainTs, "Export annotated mixed PDF", "mixed annotated PDF export must be visible");
assertContains("main.ts", mainTs, "await this.plugin.openPdfFileAtPage(outputFile, 1)", "mixed annotated PDF export should open the generated PDF");
assertContains("src/export/mixedDocumentExport.ts", mixedExportTs, "export async function exportAnnotatedMixedDocumentPdf", "mixed annotated PDF export implementation must exist");
assertContains("src/export/mixedDocumentExport.ts", mixedExportTs, "renderMixedPagesToPdfBytes(app, host, sourceFile, annotationDocument, mixedEntries, realPdfPageCount, true)", "mixed export must include annotations");
assertContains("src/export/mixedDocumentExport.ts", mixedExportTs, "\"annotated mixed\"", "mixed export must write a separate annotated PDF");

assertContains("main.ts", mainTs, "id: \"insert-native-notebook-page-after-current\"", "temporary insertion-after command must remain registered");
assertContains("main.ts", mainTs, "id: \"insert-native-notebook-page-before-current\"", "temporary insertion-before command must remain registered");
assertContains("main.ts", mainTs, "openTemplatePageInsertModal", "default insertion must use the configurable temporary-page modal path");
assertContains("main.ts", mainTs, "Add template page after current", "temporary insertion must be visible in menus");
assertContains("main.ts", mainTs, "Export finished annotated PDF", "finished-PDF export must be visible in the page workflow");
assertContains("main.ts", mainTs, "deleteCurrentPdfPageFromSession", "current original PDF pages must be deletable non-destructively from the session");
assertContains("main.ts", mainTs, "deletedPdfPages", "deleted original PDF pages must be tracked in the sidecar");
assertContains("main.ts", mainTs, "isPdfPageDeleted(pageNumber, document)", "deleted original PDF pages must be omitted from mixed page entries");
const pdfPageRemovalSource = mainTs.slice(
	mainTs.indexOf("private deleteCurrentPdfPageFromSession(): void"),
	mainTs.indexOf("private deleteAddedPageById(")
);
assertContains("main.ts", pdfPageRemovalSource, "hidePdfPage(this.annotationDocument, pageNumber)", "ordinary PDF page omission must update the session directly");
assertNotContains("main.ts", pdfPageRemovalSource, "requestDangerConfirmation(", "ordinary PDF page omission must not require a destructive-action warning");
assertContains("main.ts", mainTs, "restorePdfPageToSession", "hidden PDF pages must be restorable");
assertContains("main.ts", mainTs, "restoreRemovedAddedPageById", "removed added pages must be restorable");
assertContains("main.ts", mainTs, "Delete permanently", "removed added pages must support explicit permanent deletion");
assertContains("main.ts", mainTs, "activePageNumbers.has", "native materialization must discard annotations belonging to omitted pages");
assertContains("main.ts", mainTs, "private syncCurrentPageForPageAction(): void", "page actions must reconcile stale native viewer page state");
assertContains("main.ts", mainTs, "this.syncCurrentPageForPageAction();\n\t\tthis.insertTemplatePageAfterCurrent();", "quick add-after must use the visible current page");
assertContains("main.ts", mainTs, "this.syncCurrentPageForPageAction();\n\t\tthis.insertTemplatePageBeforeCurrent();", "quick add-before must use the visible current page");
assertContains("main.ts", mainTs, "this.deleteCurrentPage(false);", "explicit page-list deletion must retain its selected page");
assertContains("main.ts", mainTs, "private syncNativeMixedPageThumbnails(", "mixed pages must integrate with Obsidian's native PDF thumbnail rail");
assertContains("main.ts", mainTs, "private getNativeThumbnailScrollParent(thumbnailView: HTMLElement): HTMLElement | null", "thumbnail restoration must be scoped to the PDF sidebar");
assertContains("main.ts", mainTs, "const sidebar = thumbnailView.closest<HTMLElement>(\".pdf-sidebar-container\");", "thumbnail synchronization must never select the main PDF scroller");
assertNotContains("main.ts", mainTs, "const scrollParent = findScrollParent(thumbnailView);", "thumbnail synchronization must not mutate an unrelated ancestor scroll position");
assertContains("main.ts", mainTs, "this.nativeMixedThumbnailSignature === signature", "unchanged thumbnail structure must survive zoom renders without DOM rebuilding");
assertContains("main.ts", mainTs, "const currentAtIndex = pageContainer.children.item(index);", "synthetic pages must retain stable DOM order during layout refreshes");
assertContains("main.ts", mainTs, "private captureZoomScrollAnchor(): void", "iPad zoom must capture a stable content point before page geometry changes");
assertContains("main.ts", mainTs, "private scheduleZoomScrollAnchorRestore", "iPad zoom must restore its content point after asynchronous page resizing");
const zoomAnchorCaptureSource = mainTs.slice(
	mainTs.indexOf("private captureZoomScrollAnchor"),
	mainTs.indexOf("private scheduleZoomScrollAnchorRestore")
);
assertContains("main.ts captureZoomScrollAnchor", zoomAnchorCaptureSource, "ownerDocument.elementFromPoint", "zoom anchor capture must identify the visible page without scanning the full PDF");
assertNotContains("main.ts captureZoomScrollAnchor", zoomAnchorCaptureSource, "this.pageSurfaces.values()", "zoom scale events must not force geometry reads for every PDF page");
const nativePdfEventSource = mainTs.slice(
	mainTs.indexOf("private bindNativePdfEvents"),
	mainTs.indexOf("private unbindNativePdfEvents")
);
assertContains("main.ts bindNativePdfEvents", nativePdfEventSource, "this.captureZoomScrollAnchor();", "native PDF scale changes must capture the visible page anchor");
assertContains("main.ts bindNativePdfEvents", nativePdfEventSource, "this.scheduleZoomScrollAnchorRestore", "native PDF scale completion must restore the visible page anchor");
assertContains("main.ts bindNativePdfEvents", nativePdfEventSource, "this.scheduleFinishZoomingPages();", "native PDF scale completion must debounce expensive overlay resizing and redraws");
assertNotContains("main.ts bindNativePdfEvents", nativePdfEventSource, "this.finishZoomingPages();", "native PDF scale events must not synchronously redraw every page during pinch zoom");
assertContains("main.ts", mainTs, "private syncNativeMixedPageNavigator(): void", "native PDF page input must navigate the mixed page sequence");
assertContains("main.ts", mainTs, "private commitNativeMixedPageInput(): void", "native mixed-page input must map visible ordinals back to page identities");
assertContains("main.ts", mainTs, "input.max = String(Math.max(1, entries.length));", "native page input must expose the mixed document page count");
assertContains("main.ts", mainTs, "this.nativeMixedPageCountEl.textContent = `of ${entries.length}`;", "native page count must reflect added and active PDF pages");
assertContains("main.ts", mainTs, "this.detachNativeMixedPageNavigator();", "native page input must restore its original PDF behavior when detached");
assertContains("main.ts", mainTs, ".pdf-sidebar-container .pdf-thumbnail-view", "native thumbnail integration must target the PDF sidebar rather than replacing it");
assertContains("main.ts", mainTs, "private cleanupNativeMixedPageThumbnails(): void", "native thumbnail additions must be removable on session teardown");
assertContains("main.ts", mainTs, "private openMixedPageEntryMenu(", "native and management page lists must share page actions");
assertContains("main.ts", mainTs, "text: \"Manage pages\"", "the secondary page manager must have a clear management label");
assertContains("styles.css", stylesCss, ".pdf-native-annotator-native-page-entry", "added pages must have native-rail thumbnail styling");
assertContains("styles.css", stylesCss, ".pdf-native-annotator-native-page-footer", "native rail must expose compact access to search and Removed pages");
assertContains("styles.css", stylesCss, ".pdf-native-annotator-native-mixed-page-input", "mixed native page input must have a visible integrated state");
assertContains("styles.css", stylesCss, "@media (hover: none)", "native mixed-page actions must remain visible on touch devices");
assertContains("src/types.ts", typesTs, "export interface RemovedNotebookPage", "removed page payload must have a persisted schema");
assertContains("src/stores/annotationStore.ts", annotationStoreTs, "version: Math.max(8", "removed-page schema must upgrade sidecars to version 8");
assertContains("src/stores/annotationStore.ts", annotationStoreTs, "removedPages:", "removed pages must survive sidecar reload");
const renameMigrationSource = annotationStoreTs.slice(
	annotationStoreTs.indexOf("async migrateForRename("),
	annotationStoreTs.indexOf("async deleteForPdfPath(")
);
assertContains("src/stores/annotationStore.ts migrateForRename", renameMigrationSource, "sourceFile: file.path", "PDF rename must update the sidecar source path");
assertContains("src/stores/annotationStore.ts migrateForRename", renameMigrationSource, "sourcePdf: getPdfIdentity(file)", "PDF rename must refresh the sidecar PDF identity");
assertContains("src/stores/annotationStore.ts migrateForRename", renameMigrationSource, "adapter.remove(oldSidecarPath)", "PDF rename must remove the stale old sidecar after writing the new one");
assertContains("src/notebook/pageLifecycle.ts", pageLifecycleTs, "export function insertSyntheticPage", "synthetic page insertion must use a shared lifecycle");
assertContains("src/notebook/pageLifecycle.ts", pageLifecycleTs, "export function removeSyntheticPageToTrash", "synthetic page removal must use a shared lifecycle");
assertContains("src/notebook/pageLifecycle.ts", pageLifecycleTs, "export function restoreSyntheticPageFromTrash", "synthetic page restoration must use a shared lifecycle");
assertContains("src/notebook/pageLifecycle.ts", pageLifecycleTs, "export function permanentlyDeleteHiddenPdfPage", "hidden PDF pages must be permanently removable from Removed");
assertContains("main.ts", mainTs, "createNativeMixedWorkingPdf", "advanced native materialization must remain available");
assertContains("src/export/mixedDocumentExport.ts", mixedExportTs, "export async function createNativeMixedWorkingPdf", "native mixed working PDF implementation must exist");
assertContains("src/export/mixedDocumentExport.ts", mixedExportTs, "renderMixedPagesToPdfBytes(app, host, sourceFile, annotationDocument, mixedEntries, realPdfPageCount, false)", "native working PDF should keep annotations editable in sidecar");
assertContains("main.ts", mainTs, "nextDocument.appendedPages = []", "native working PDF sidecar must clear converted synthetic pages");

assertNotContains("main.ts", mainTs, "registerNotebookCommands", "standalone notebook commands must not be registered");
assertNotContains("main.ts", mainTs, "AnnotatorNotebookView", "standalone notebook view must not be registered");
assertNotContains("main.ts", mainTs, "NOTEBOOK_VIEW_TYPE", "standalone notebook view type must not be registered");

assertContains("package.json", JSON.stringify(packageJson.scripts), "check:mixed", "package scripts must expose this verifier");

if (builtMain) {
	assertContains("main.js", builtMain, "Create blank annotatable PDF", "built bundle must include scratch native PDF workflow");
	assertContains("main.js", builtMain, "Export annotated mixed PDF", "built bundle must include mixed annotated PDF export");
	assertContains("main.js", builtMain, "Add template page after current", "built bundle must include temporary page insertion");
	assertContains("main.js", builtMain, "Remove current PDF page from session", "built bundle must include recoverable session-level PDF page removal");
	assertContains("main.js", builtMain, "Delete permanently", "built bundle must include removed-page cleanup");
	assertNotContains("main.js", builtMain, "Legacy: Create .annotbook notebook", "built bundle must not include standalone notebook commands");
	assertNotContains("main.js", builtMain, "Create annotator notebook", "built bundle must not expose the old primary annotbook command label");
}

const transpiledLifecycle = ts.transpileModule(pageLifecycleTs, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2020,
		skipLibCheck: true
	}
});
const lifecycleModule = { exports: {} };
vm.runInNewContext(transpiledLifecycle.outputText, {
	module: lifecycleModule,
	exports: lifecycleModule.exports,
	console
}, { filename: "pageLifecycle.check.cjs" });
const lifecycle = lifecycleModule.exports;

const makePage = (id) => ({
	id,
	title: id,
	kind: "template",
	template: "ruled",
	paperColor: "#ffffff",
	pageSize: "a4",
	strokes: [],
	textItems: [],
	shapes: [],
	imageItems: []
});
const document = {
	version: 8,
	sourceFile: "sample.pdf",
	updatedAt: "now",
	strokes: [
		{ id: "pdf-stroke", page: 1, points: [] },
		{ id: "a-stroke", page: 3, points: [] },
		{ id: "b-stroke", page: 4, points: [] }
	],
	eraserPaths: [],
	textItems: [],
	shapes: [],
	imageItems: [],
	appendedPages: [makePage("a"), makePage("b")],
	deletedPdfPages: [],
	permanentlyDeletedPdfPages: [],
	removedPages: []
};
const insertedPageNumber = lifecycle.insertSyntheticPage(document, 2, 1, makePage("x"));
if (insertedPageNumber !== 4 || document.strokes.find((stroke) => stroke.id === "b-stroke").page !== 5) {
	throw new Error("inserting a note page did not shift later annotations as one transaction");
}
const removed = lifecycle.removeSyntheticPageToTrash(document, 2, 0, "removed-now");
if (!removed || removed.page.id !== "a" || removed.annotations.strokes[0]?.id !== "a-stroke") {
	throw new Error("removing an annotated note page did not retain its page identity and annotations");
}
if (document.strokes.find((stroke) => stroke.id === "b-stroke").page !== 4) {
	throw new Error("removing a note page did not compact later annotation page numbers");
}
const restoredPageNumber = lifecycle.restoreSyntheticPageFromTrash(document, 2, "a");
if (restoredPageNumber !== 3 || document.strokes.find((stroke) => stroke.id === "a-stroke").page !== 3) {
	throw new Error("restoring a note page did not return its annotations to the restored page");
}
const strokeCountBeforePdfHide = document.strokes.length;
if (!lifecycle.hidePdfPage(document, 1) || document.strokes.length !== strokeCountBeforePdfHide) {
	throw new Error("hiding a PDF page discarded annotations");
}
if (!lifecycle.restorePdfPage(document, 1) || document.deletedPdfPages.length !== 0) {
	throw new Error("hidden PDF page could not be restored");
}
lifecycle.removeSyntheticPageToTrash(document, 2, 0, "removed-again");
if (!lifecycle.permanentlyDeleteRemovedPage(document, "a") || document.removedPages.some((entry) => entry.page.id === "a")) {
	throw new Error("permanent removed-page cleanup failed");
}

function makeAnnotation(id, page) {
	return { id, page, points: [] };
}

function makeLifecycleMatrixDocument() {
	return {
		version: 8,
		sourceFile: "matrix.pdf",
		updatedAt: "now",
		strokes: [makeAnnotation("stroke-note", 4), makeAnnotation("stroke-later", 5)],
		eraserPaths: [makeAnnotation("eraser-note", 4), makeAnnotation("eraser-later", 5)],
		textItems: [makeAnnotation("text-note", 4), makeAnnotation("text-later", 5)],
		shapes: [makeAnnotation("shape-note", 4), makeAnnotation("shape-later", 5)],
		imageItems: [makeAnnotation("image-note", 4), makeAnnotation("image-later", 5)],
		appendedPages: [makePage("matrix-a"), makePage("matrix-b")],
		deletedPdfPages: [],
		permanentlyDeletedPdfPages: [],
		removedPages: []
	};
}

function getAnnotationCollections(target) {
	return [
		target.strokes,
		target.eraserPaths,
		target.textItems,
		target.shapes,
		target.imageItems
	];
}

const matrixDocument = makeLifecycleMatrixDocument();
const firstInsertedPage = lifecycle.insertSyntheticPage(matrixDocument, 3, -100, makePage("matrix-first"));
if (firstInsertedPage !== 4 || matrixDocument.appendedPages[0].id !== "matrix-first") {
	throw new Error("first-page insertion did not clamp to the beginning");
}
for (const collection of getAnnotationCollections(matrixDocument)) {
	if (collection.find((item) => item.id.endsWith("-note")).page !== 5
		|| collection.find((item) => item.id.endsWith("-later")).page !== 6) {
		throw new Error("first-page insertion did not shift every annotation collection");
	}
}

const lastInsertedPage = lifecycle.insertSyntheticPage(matrixDocument, 3, 999, makePage("matrix-last"));
if (lastInsertedPage !== 7 || matrixDocument.appendedPages.at(-1).id !== "matrix-last") {
	throw new Error("last-page insertion did not clamp to the end");
}

const snapshotBeforeInvalidRemoval = JSON.stringify(matrixDocument);
if (lifecycle.removeSyntheticPageToTrash(matrixDocument, 3, -1) !== null
	|| lifecycle.removeSyntheticPageToTrash(matrixDocument, 3, 99) !== null
	|| JSON.stringify(matrixDocument) !== snapshotBeforeInvalidRemoval) {
	throw new Error("invalid note-page removal mutated the document");
}

const removedMatrixPage = lifecycle.removeSyntheticPageToTrash(matrixDocument, 3, 1, "matrix-removed");
if (!removedMatrixPage || removedMatrixPage.page.id !== "matrix-a") {
	throw new Error("middle note page was not moved to Removed");
}
for (const collection of Object.values(removedMatrixPage.annotations)) {
	if (collection.length !== 1 || !collection[0].id.endsWith("-note")) {
		throw new Error("removed note page did not retain every annotation collection");
	}
}
for (const collection of getAnnotationCollections(matrixDocument)) {
	if (collection.find((item) => item.id.endsWith("-later")).page !== 5) {
		throw new Error("middle note-page removal did not compact every later annotation collection");
	}
}

const persistedMatrixDocument = JSON.parse(JSON.stringify(matrixDocument));
if (persistedMatrixDocument.removedPages[0].annotations.imageItems[0].id !== "image-note") {
	throw new Error("removed page data did not survive JSON persistence");
}
const restoredMatrixPage = lifecycle.restoreSyntheticPageFromTrash(persistedMatrixDocument, 3, "matrix-a");
if (restoredMatrixPage !== 5 || persistedMatrixDocument.appendedPages[1].id !== "matrix-a") {
	throw new Error("removed note page was not restored at its original position");
}
for (const collection of getAnnotationCollections(persistedMatrixDocument)) {
	if (collection.find((item) => item.id.endsWith("-note")).page !== 5
		|| collection.find((item) => item.id.endsWith("-later")).page !== 6) {
		throw new Error("restored note page did not remap every annotation collection");
	}
}
if (lifecycle.restoreSyntheticPageFromTrash(persistedMatrixDocument, 3, "missing") !== null) {
	throw new Error("restoring an unknown removed page should be a no-op");
}
if (lifecycle.permanentlyDeleteRemovedPage(persistedMatrixDocument, "missing")) {
	throw new Error("permanently deleting an unknown removed page should be a no-op");
}

const pdfLifecycleDocument = makeLifecycleMatrixDocument();
const pdfAnnotationCount = getAnnotationCollections(pdfLifecycleDocument)
	.reduce((count, collection) => count + collection.length, 0);
if (!lifecycle.hidePdfPage(pdfLifecycleDocument, 3)
	|| !lifecycle.hidePdfPage(pdfLifecycleDocument, 1)
	|| lifecycle.hidePdfPage(pdfLifecycleDocument, 3)
	|| pdfLifecycleDocument.deletedPdfPages.join(",") !== "1,3") {
	throw new Error("PDF page hiding is not sorted and idempotent");
}
if (getAnnotationCollections(pdfLifecycleDocument)
	.reduce((count, collection) => count + collection.length, 0) !== pdfAnnotationCount) {
	throw new Error("PDF page hiding changed annotation data");
}
if (!lifecycle.restorePdfPage(pdfLifecycleDocument, 1)
	|| lifecycle.restorePdfPage(pdfLifecycleDocument, 1)
	|| pdfLifecycleDocument.deletedPdfPages.join(",") !== "3") {
	throw new Error("PDF page restoration is not idempotent");
}
if (!lifecycle.permanentlyDeleteHiddenPdfPage(pdfLifecycleDocument, 3)
	|| pdfLifecycleDocument.deletedPdfPages.length !== 0
	|| pdfLifecycleDocument.permanentlyDeletedPdfPages.join(",") !== "3"
	|| lifecycle.restorePdfPage(pdfLifecycleDocument, 3)) {
	throw new Error("permanently deleted PDF pages should leave Removed and stay omitted");
}

console.log(
	`Mixed-document verifier passed. activeAdded=${document.appendedPages.length}; `
	+ `removed=${document.removedPages.length}; strokes=${document.strokes.length}; `
	+ "lifecycleMatrix=all-annotation-types"
);
