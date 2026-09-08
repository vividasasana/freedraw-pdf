const fs = require("fs");
const path = require("path");

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

const pageModelTs = read("src/notebook/pageModel.ts");
const templateCanvasTs = read("src/notebook/templateCanvas.ts");
const mixedExportTs = read("src/export/mixedDocumentExport.ts");
const mainTs = read("main.ts");
const packageJson = JSON.parse(read("package.json"));
const builtMainPath = path.join(projectRoot, "main.js");
const builtMain = fs.existsSync(builtMainPath) ? fs.readFileSync(builtMainPath, "utf8") : "";

assertContains("src/notebook/pageModel.ts", pageModelTs, "export function getNotebookPageRenderDimensions", "page render dimensions must be centralized");
assertContains("src/notebook/pageModel.ts", pageModelTs, "a4ReferenceWidth * dimensions.width", "render dimensions must preserve page-size width ratios from an A4 reference");
assertContains("src/notebook/templateCanvas.ts", templateCanvasTs, "drawTemplatePageBackground", "template backgrounds must use the shared canvas renderer");
assertContains("src/notebook/templateCanvas.ts", templateCanvasTs, "getPaperTemplateMetrics(width)", "template metrics must derive from rendered page width");

assertContains("main.ts", mainTs, "getNotebookPageRenderDimensions(templatePage.pageSize, BLANK_PDF_EXPORT_WIDTH_PX)", "blank annotatable PDFs must use shared render dimensions");
assertContains("main.ts", mainTs, "canvas.width = renderDimensions.width", "blank annotatable PDFs must preserve page-size width");
assertContains("main.ts", mainTs, "canvas.height = renderDimensions.height", "blank annotatable PDFs must preserve page-size height");
assertContains("main.ts", mainTs, "annotationDocument.nativePageTemplatesEditable = true", "blank PDFs must be marked as plugin-created before enabling native template controls");
assertContains("main.ts", mainTs, "annotationDocument.pdfPageTemplates =", "blank PDFs must store editable native-page template metadata");

assertContains("src/export/mixedDocumentExport.ts", mixedExportTs, "getNotebookPageRenderDimensions(syntheticPage.pageSize, EXPORT_PAGE_WIDTH_PX)", "synthetic mixed export must use shared render dimensions");
assertContains("src/export/mixedDocumentExport.ts", mixedExportTs, "drawTemplatePageBackground(context, canvas.width, canvas.height, syntheticPage)", "synthetic mixed export must use the shared template renderer");
assertContains("src/export/mixedDocumentExport.ts", mixedExportTs, "hasEditableNativePageTemplates(annotationDocument, realPdfPageCount)", "native PDF export must only apply templates to plugin-created PDFs");

assertContains("package.json", JSON.stringify(packageJson.scripts), "check:templates", "package scripts must expose this verifier");

if (builtMain) {
	assertContains("main.js", builtMain, "getNotebookPageRenderDimensions", "built bundle must include shared page render dimensions");
	assertContains("main.js", builtMain, "BLANK_PDF_EXPORT_WIDTH_PX", "built bundle must include blank PDF export sizing");
}

console.log("Template consistency verifier passed.");
