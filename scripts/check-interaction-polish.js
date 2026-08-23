const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function assertContains(fileName, content, needle, message) {
	assert(content.includes(needle), `${fileName}: ${message}\nMissing: ${needle}`);
}

const mainTs = read("main.ts");
const stylesCss = read("styles.css");
const textLayoutTs = read("src/text/textLayout.ts");
const annotatedEmbedControllerTs = read("src/markdown/annotatedEmbedController.ts");
const nativePdfJsTs = read("src/pdf/nativePdfJs.ts");
const mixedDocumentExportTs = read("src/export/mixedDocumentExport.ts");

assertContains(
	"styles.css",
	stylesCss,
	".pdf-native-annotator-inline-text-editor::selection",
	"selecting or touching inline text must use a deliberately subtle selection highlight"
);
assertContains(
	"styles.css",
	stylesCss,
	"background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);",
	"the inline text selection highlight must remain low opacity"
);
assertContains(
	"styles.css",
	stylesCss,
	"--annotator-text-focus-fill: color-mix(in srgb, var(--text-muted) 4%, transparent);",
	"the focused text frame must match the embed-region fill opacity"
);
assertContains(
	"styles.css",
	stylesCss,
	".pdf-native-annotator-inline-text-frame:focus-within",
	"mobile focus must be styled on the frame instead of inheriting an opaque textarea background"
);
assertContains(
	"src/text/textLayout.ts",
	textLayoutTs,
	"export const DEFAULT_INLINE_TEXT_BOX_WIDTH = 220;",
	"new text boxes must have a stable default width"
);
assertContains(
	"src/text/textLayout.ts",
	textLayoutTs,
	"export const DEFAULT_INLINE_TEXT_BOX_HEIGHT = 64;",
	"new text boxes must have a stable default height that visually centers one line"
);
assertContains(
	"main.ts",
	mainTs,
	": false;\n\t\tif (existingItem)",
	"click-created text boxes must keep the stable default size instead of immediately shrinking to content"
);
assertContains(
	"styles.css",
	stylesCss,
	"caret-color: transparent;",
	"the browser's line-box caret must be hidden without hiding native spellcheck"
);
assertContains(
	"styles.css",
	stylesCss,
	".pdf-native-annotator-host .pdf-native-annotator-inline-text-caret-mirror {\n\tdisplay: block;",
	"the compact mirrored caret must remain visible"
);
assertContains(
	"styles.css",
	stylesCss,
	"height: 1em;",
	"the mirrored caret must match the full text height without using the line box"
);
assertContains(
	"styles.css",
	stylesCss,
	"vertical-align: -0.12em;",
	"the caret must extend just below the baseline like a native text caret"
);
assertContains(
	"styles.css",
	stylesCss,
	"transform: translateY(-2px);",
	"the painted caret must move upward directly instead of relying on line-box baseline calculations"
);
assertContains(
	"main.ts",
	mainTs,
	"editor.spellcheck = true;",
	"native spellcheck must remain enabled while the visual caret is mirrored"
);
if (mainTs.includes("editor.spellcheck = false;")) {
	throw new Error("main.ts: native spellcheck must not be disabled to correct caret geometry");
}
if (mainTs.includes("transform: `translateY(-${INLINE_TEXT_NATIVE_CARET_LIFT}px)`")) {
	throw new Error("main.ts: moving the textarea separates spellcheck decorations from the rendered text");
}
assertContains(
	"main.ts",
	mainTs,
	"paddingTop: `${textTop}px`,",
	"caret positioning must not invert by redistributing textarea padding"
);
assertContains(
	"src/markdown/annotatedEmbedController.ts",
	annotatedEmbedControllerTs,
	'"data-href": file.path',
	"the PDF.js recovery statement must expose the source PDF as an Obsidian internal link"
);
assertContains(
	"src/markdown/annotatedEmbedController.ts",
	annotatedEmbedControllerTs,
	"void this.host.openPdfPage(file, page, rect);",
	"clicking the recovery PDF link must open the embedded source page"
);
assertContains(
	"src/markdown/annotatedEmbedController.ts",
	annotatedEmbedControllerTs,
	"private showEmbedRenderError(",
	"embed render failures must support structured recovery content"
);
assertContains(
	"src/markdown/annotatedEmbedController.ts",
	annotatedEmbedControllerTs,
	"errorMessage === PDF_JS_LOAD_ERROR_MESSAGE",
	"the PDF.js bootstrap failure must receive a source-file recovery link"
);
assertContains(
	"src/markdown/annotatedEmbedController.ts",
	annotatedEmbedControllerTs,
	"errorEl.appendText(`${PDF_JS_LOAD_ERROR_MESSAGE} Open `);",
	"the linked PDF.js recovery message must retain clear instructions"
);
assertContains(
	"src/pdf/nativePdfJs.ts",
	nativePdfJsTs,
	'export const PDF_JS_LOAD_ERROR_MESSAGE = "Obsidian PDF.js could not be loaded.";',
	"PDF.js loader and embed recovery UI must share one accurate error message"
);
if (nativePdfJsTs.includes("Open a PDF once")) {
	throw new Error("src/pdf/nativePdfJs.ts: automatic PDF.js initialization must not retain the obsolete manual-open instruction");
}
assertContains(
	"src/pdf/nativePdfJs.ts",
	nativePdfJsTs,
	'import { loadPdfJs } from "obsidian";',
	"the shared PDF adapter must initialize Obsidian PDF.js on a fresh app launch"
);
assertContains(
	"src/pdf/nativePdfJs.ts",
	nativePdfJsTs,
	"export async function loadNativePdfJs(): Promise<NativePdfJsLib>",
	"PDF.js initialization must be awaitable"
);
assertContains(
	"src/pdf/nativePdfJs.ts",
	nativePdfJsTs,
	"const loadedPdfJs = await loadPdfJs();",
	"the adapter must use Obsidian's supported lazy PDF.js loader"
);
assertContains(
	"src/markdown/annotatedEmbedController.ts",
	annotatedEmbedControllerTs,
	"const pdfjsLib = await loadNativePdfJs();",
	"embeds must await PDF.js initialization before rendering"
);
assertContains(
	"src/export/mixedDocumentExport.ts",
	mixedDocumentExportTs,
	"const pdfjsLib = await loadNativePdfJs();",
	"mixed PDF export must await the same initialization path"
);
assertContains(
	"main.ts",
	mainTs,
	"this.pauseCommittedRenderingForViewportMotion();",
	"scrollbar and trackpad scrolling must pause background annotation rendering"
);
assertContains(
	"main.ts",
	mainTs,
	"this.isPdfScrolling || this.isFingerPanRenderingPaused()",
	"layout synchronization must remain deferred during active scrolling"
);
assertContains(
	"main.ts",
	mainTs,
	"this.exitAnnotationModeFromEscape();",
	"Escape must leave annotation mode after higher-priority edit cancellation"
);

console.log("Interaction polish verifier passed.");
