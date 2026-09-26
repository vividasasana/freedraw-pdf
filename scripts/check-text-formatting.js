const fs = require("fs");
const path = require("path");
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

const typesTs = read("src/types.ts");
const mainTs = read("main.ts");
const textLayoutTs = read("src/text/textLayout.ts");
const embedRenderTs = read("src/markdown/embedRender.ts");
const stylesCss = read("styles.css");

assertContains("src/types.ts", typesTs, 'export type TextFontWeight = "normal" | "bold";', "text weight must remain backward compatible");
assertContains("src/types.ts", typesTs, 'export type TextFontStyle = "normal" | "italic";', "text style must remain backward compatible");
assertContains("src/types.ts", typesTs, 'export type TextAlignment = "left" | "center" | "right";', "text alignment must remain backward compatible");
assertContains("src/types.ts", typesTs, 'export type TextVerticalAlignment = "top" | "middle" | "bottom";', "saved text must support vertical anchoring");
assertContains("src/types.ts", typesTs, "fontWeight?: TextFontWeight;", "saved text must support bold");
assertContains("src/types.ts", typesTs, "fontStyle?: TextFontStyle;", "saved text must support italic");
assertContains("src/types.ts", typesTs, "textAlign?: TextAlignment;", "saved text must support alignment");
assertContains("src/types.ts", typesTs, "verticalAlign?: TextVerticalAlignment;", "saved text must support vertical alignment");
assertContains("src/types.ts", typesTs, "lineSpacing?: number;", "saved text must support line spacing");
assertContains("src/types.ts", typesTs, "wordWrap?: boolean;", "saved text must support wrapping control");
assertContains("src/types.ts", typesTs, "autoFit?: boolean;", "saved text must distinguish automatic and manual box sizing");
assertContains("src/types.ts", typesTs, "manualBoxSize?: boolean;", "saved text must preserve deliberate manual box sizing");
assertContains("main.ts", mainTs, 'createStyleButton(formatControls, "bold", "Bold"', "text style popup must expose bold");
assertContains("main.ts", mainTs, 'createStyleButton(formatControls, "italic", "Italic"', "text style popup must expose italic");
assertContains("main.ts", mainTs, '`align-${alignment}`', "text style popup must expose alignment controls");
assertContains("main.ts", mainTs, '"align-vertical-justify-center"', "text style popup must expose vertical alignment controls");
assertContains("main.ts", mainTs, 'text: "Line spacing"', "text style popup must expose line spacing");
assertContains("main.ts", mainTs, "this.getInlineTextFramePoint(pageNumber)", "inline text preview and commit must use the live frame origin");
assertContains("main.ts", mainTs, "Math.max(currentHeight, requiredHeight)", "manual text boxes must grow to contain wrapped text");
assertContains("main.ts", mainTs, '"Toggle word wrap"', "text style popup must expose wrapping control");
assertContains("main.ts", mainTs, '"Resize box to fit text"', "text style popup must expose automatic box sizing");
assertContains("main.ts", mainTs, 'text: "Change case"', "text style popup must expose case conversion");
assertContains("main.ts", mainTs, 'this.ownerWindow.addEventListener("keydown", this.handleSessionKeyDown, { capture: true });', "inline text shortcuts must run before Obsidian shortcuts");
assertContains("main.ts", mainTs, 'isModifierShortcut && key === "b"', "inline text editing must support the bold shortcut");
assertContains("main.ts", mainTs, 'isModifierShortcut && key === "i"', "inline text editing must support the italic shortcut");
assertContains("main.ts", mainTs, 'isModifierShortcut && key === "enter"', "inline text editing must support the save shortcut");
assertContains("main.ts", mainTs, "editor.spellcheck = true;", "inline text editing must retain native spellcheck");
assertContains("main.ts", mainTs, 'editor.autocapitalize = "sentences";', "mobile text editing must use sentence capitalization");
assertContains("main.ts", mainTs, "editor.focus({ preventScroll: true });", "Pencil-created text must focus synchronously while iPadOS still has user activation");
assertContains("main.ts", mainTs, 'editor.inputMode = "text";', "Pencil-created text must request the iPad text keyboard");
assertContains("main.ts", mainTs, 'editor.addEventListener("pointerdown", () => focusEditor());', "touching an active text frame must restore its editor focus");
assertContains("main.ts", mainTs, "if (activeElement === editor)", "a transient mobile blur must not commit an editor that regained focus");
assertContains("main.ts", mainTs, "private keepInlineTextEditorAboveKeyboard(): void", "focused iPad text must stay above the software keyboard");
assertContains("main.ts", mainTs, "scrollEl.scrollTop = clamp(scrollEl.scrollTop + deltaY", "keyboard avoidance must move the PDF scroller instead of the whole Obsidian window");
assertContains("main.ts", mainTs, "private captureVisualViewportBaseline(): void", "keyboard detection must retain the pre-keyboard iPad viewport height");
assertContains("main.ts", mainTs, "if (this.inlineTextEditorEl) {", "text menus must prefer the active editor style");
assertContains("main.ts", mainTs, "this.resolveStoredFontScale(existingItem)", "reopening text must preserve its stored logical size");
assertContains("main.ts", mainTs, "getRenderedTextFontSize(this.getStableTextFontScale(this.currentTextFontSize), surface.lastWidth)", "inline editor size must follow page scaling");
assertContains("main.ts", mainTs, "this.inlineTextAutoFit = false;", "manual resizing must disable automatic box sizing");
assertContains("main.ts", mainTs, "measureAutoFitTextAnnotation", "click-created text must be measured from its content");
assertContains("main.ts", mainTs, "existingItem.manualBoxSize !== true", "legacy text boxes must adopt content sizing when edited");
assertContains("main.ts", mainTs, "const autoFitSize = autoFitTextBox && existingItem", "legacy text must be measured before the editor is positioned");
assertContains("main.ts", mainTs, "existing.manualBoxSize = !autoFit;", "edited text must persist an explicit manual sizing marker");
assertContains("main.ts", mainTs, 'width: `${size.width}px`', "automatic text sizing must resize the box width to its content");
assertContains("main.ts", mainTs, "updateInlineTextVerticalAlignment", "inline text and caret must share PowerPoint-style vertical centering");
assertContains("main.ts", mainTs, "this.scheduleInteractionRedraw(this.inlineTextPageNumber);", "resizing a text box must redraw its canvas preview with the caret");
assertContains("main.ts", mainTs, "updateInlineTextCaretMirror", "inline editing must position the compact caret");
assertContains("main.ts", mainTs, 'activeElement.closest(', "text toolbar and popovers must not prematurely commit the active editor");
if ((mainTs.match(/onClose: \(\) => this\.refocusInlineTextEditor\(\)/g) ?? []).length !== 2) {
	throw new Error("main.ts: color and font popovers must restore the active caret through registry close callbacks");
}
assertNotContains("main.ts", mainTs, 'editor.addEventListener("blur", commit, { once: true });', "the editor blur handler must survive temporary toolbar focus");
assertContains("main.ts", mainTs, "private getTextContentLineBounds", "text hit-testing must follow rendered text lines");
assertContains("main.ts", mainTs, "const lineBounds = this.getTextContentLineBounds(item, pageNumber);", "text clicks must use content geometry instead of the editing box");
assertContains("main.ts", mainTs, 'if (this.currentTool === "text") {\n\t\t\t\t\tthis.selectedTarget = null;', "committed text must leave the text tool ready for another insertion");
assertNotContains("main.ts", mainTs, "const selectedTextTarget = this.selectedTargets.find", "blank text-tool clicks must not reopen the previously selected text box");
if (mainTs.includes("this.currentTextFontSize = Math.round(baseFontSize);")) {
	throw new Error("main.ts: reopening text must not save zoom-dependent screen pixels as the logical font size");
}
assertContains("main.ts", mainTs, "applyCanvasTextStyle(context, textItem, fontSize, fontFamily);", "live annotations must use the shared text style");
assertContains("main.ts", mainTs, "resolveTextVerticalAlignment(textItem)", "live annotations must render vertical alignment");
assertContains("main.ts", mainTs, "resolveTextWordWrap(textItem)", "live annotations must render wrapping mode");
assertContains("src/markdown/embedRender.ts", embedRenderTs, "applyCanvasTextStyle(context, textItem, fontSize, fontFamily);", "embeds and exports must use the shared text style");
assertContains("src/markdown/embedRender.ts", embedRenderTs, "getRenderedTextLayoutMetrics(width)", "embeds and exports must share zoom-stable live text metrics");
assertContains("src/markdown/embedRender.ts", embedRenderTs, "resolveTextVerticalAlignment(textItem)", "embeds and exports must preserve vertical alignment");
assertContains("src/markdown/embedRender.ts", embedRenderTs, "resolveTextLineSpacing(textItem)", "embeds and exports must preserve line spacing");
assertContains("styles.css", stylesCss, ".pdf-native-annotator-text-style-button.is-active", "active formatting controls must be visible");
assertContains("styles.css", stylesCss, "width: 44px;", "formatting controls must remain touch accessible");
assertContains("src/text/textLayout.ts", textLayoutTs, "export const DEFAULT_INLINE_TEXT_BOX_WIDTH = 220;", "click-created text must use a stable default width");
assertContains("src/text/textLayout.ts", textLayoutTs, "export const DEFAULT_INLINE_TEXT_BOX_HEIGHT = 64;", "click-created text must use a vertically comfortable default height");
assertContains("styles.css", stylesCss, "border: 1px dotted #6b6b6b;", "text selection must use a PowerPoint-style neutral outline");
assertContains("styles.css", stylesCss, ".pdf-native-annotator-host .pdf-native-annotator-inline-text-handle", "mobile themes must not override text handle appearance");
assertContains("styles.css", stylesCss, "background-color: transparent;", "the iPad inline editor must not inherit an opaque theme background");
assertContains("src/text/textLayout.ts", textLayoutTs, "Array.from(currentLine)", "long words must wrap by Unicode code point");

const previousTypeScriptLoader = require.extensions[".ts"];
require.extensions[".ts"] = (module, filename) => {
	const source = fs.readFileSync(filename, "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
			esModuleInterop: true
		},
		fileName: filename
	});
	module._compile(output.outputText, filename);
};
const {
	applyCanvasTextStyle,
	getAlignedTextX,
	getCanvasTextLines,
	getHorizontalTextCaretIndex,
	getInlineTextEditorLayout,
	getRenderedTextFontSize,
	getTextBlockHeight,
	getTextBlockTop,
	getVerticallyCenteredTextTop,
	getWrappedCanvasTextLines,
	measureAutoFitTextBox,
	resolveTextAlignment,
	resolveTextFontStyle,
	resolveTextFontWeight,
	resolveTextLineSpacing,
	resolveTextVerticalAlignment,
	resolveTextWordWrap
} = require(path.join(projectRoot, "src", "text", "textLayout.ts"));
if (previousTypeScriptLoader) {
	require.extensions[".ts"] = previousTypeScriptLoader;
} else {
	delete require.extensions[".ts"];
}

const context = {
	font: "",
	textAlign: "left",
	textBaseline: "alphabetic",
	measureText(text) {
		return { width: Array.from(text).length * 10 };
	}
};
const wrapped = getWrappedCanvasTextLines(context, "supercalifragilistic", 50);
if (wrapped.length < 2 || wrapped.some((line) => Array.from(line).length > 5)) {
	throw new Error(`Long-word wrapping failed: ${JSON.stringify(wrapped)}`);
}
const blankLines = getWrappedCanvasTextLines(context, "first\n\nsecond", 100);
if (blankLines.join("|") !== "first||second") {
	throw new Error(`Explicit blank lines were not preserved: ${JSON.stringify(blankLines)}`);
}
const unwrapped = getCanvasTextLines(context, "abcdefghij", 30, false);
if (unwrapped.length !== 1 || unwrapped[0] !== "abcdefghij") {
	throw new Error(`Disabled word wrapping is incorrect: ${JSON.stringify(unwrapped)}`);
}
if (
	getHorizontalTextCaretIndex("abc", 2, "left") !== 1 ||
	getHorizontalTextCaretIndex("abc", 2, "right") !== 3 ||
	getHorizontalTextCaretIndex("one two", 7, "left", true) !== 4 ||
	getHorizontalTextCaretIndex("one two", 0, "right", true) !== 4 ||
	getHorizontalTextCaretIndex("a\uD83D\uDE00b", 3, "left") !== 1
) {
	throw new Error("Horizontal text caret movement is incorrect.");
}
if (getAlignedTextX(10, 80, "left") !== 10 || getAlignedTextX(10, 80, "center") !== 50 || getAlignedTextX(10, 80, "right") !== 90) {
	throw new Error("Aligned text origins are incorrect.");
}
if (
	Math.abs(getRenderedTextFontSize(0.018, 720) - 12.96) > 0.001 ||
	Math.abs(getRenderedTextFontSize(0.004, 720) - ((10 / 1524) * 720)) > 0.001
) {
	throw new Error("Rendered text font-size scaling is incorrect.");
}
const shortAutoFit = measureAutoFitTextBox(context, "abc", 18, 300);
if (shortAutoFit.width !== 54 || shortAutoFit.lineCount !== 1 || shortAutoFit.height !== 36) {
	throw new Error(`Short text auto-fit is incorrect: ${JSON.stringify(shortAutoFit)}`);
}
const defaultEditorLayout = getInlineTextEditorLayout({ x: 0.1, y: 0.1, pressure: 0.5 }, 1000, 1400);
if (defaultEditorLayout.width !== 220 || defaultEditorLayout.height !== 64) {
	throw new Error(`Default text frame is incorrect: ${JSON.stringify(defaultEditorLayout)}`);
}
const multilineAutoFit = measureAutoFitTextBox(context, "one\nsecond", 18, 300);
if (multilineAutoFit.width !== 84 || multilineAutoFit.lineCount !== 2 || multilineAutoFit.height !== 57) {
	throw new Error(`Multiline text auto-fit is incorrect: ${JSON.stringify(multilineAutoFit)}`);
}
if (getTextBlockHeight(18, 1) !== 18 || Math.abs(getTextBlockHeight(18, 2) - 42.3) > 0.001) {
	throw new Error("Text block height must not include trailing line spacing after the final line.");
}
if (getTextBlockHeight(18, 2, 2) !== 54) {
	throw new Error("Custom line spacing is incorrect.");
}
if (getVerticallyCenteredTextTop(10, 40, 18, 1) !== 21 || getVerticallyCenteredTextTop(10, 18, 18, 1) !== 10) {
	throw new Error("PowerPoint-style vertical text centering is incorrect.");
}
if (
	getTextBlockTop(10, 100, 18, 1, "top") !== 16 ||
	getTextBlockTop(10, 100, 18, 1, "middle") !== 51 ||
	getTextBlockTop(10, 100, 18, 1, "bottom") !== 86
) {
	throw new Error("Vertical text anchoring is incorrect.");
}
const cappedAutoFit = measureAutoFitTextBox(context, "abcdefghijklmnopqrst", 18, 80);
if (cappedAutoFit.width !== 80 || cappedAutoFit.lineCount < 2) {
	throw new Error(`Long text must wrap at the auto-fit maximum: ${JSON.stringify(cappedAutoFit)}`);
}
if (resolveTextFontWeight({}) !== "normal" || resolveTextFontWeight({ fontWeight: "bold" }) !== "bold") {
	throw new Error("Text weight fallback is incorrect.");
}
if (resolveTextFontStyle({}) !== "normal" || resolveTextFontStyle({ fontStyle: "italic" }) !== "italic") {
	throw new Error("Text style fallback is incorrect.");
}
if (resolveTextAlignment({}) !== "left" || resolveTextAlignment({ textAlign: "center" }) !== "center") {
	throw new Error("Text alignment fallback is incorrect.");
}
if (
	resolveTextVerticalAlignment({}) !== "middle" ||
	resolveTextVerticalAlignment({ verticalAlign: "bottom" }) !== "bottom" ||
	resolveTextLineSpacing({}) !== 1.35 ||
	resolveTextLineSpacing({ lineSpacing: 9 }) !== 3 ||
	resolveTextWordWrap({}) !== true ||
	resolveTextWordWrap({ wordWrap: false }) !== false
) {
	throw new Error("PowerPoint-style paragraph property fallbacks are incorrect.");
}
applyCanvasTextStyle(context, { fontWeight: "bold", fontStyle: "italic", textAlign: "right" }, 18, "Georgia");
if (context.font !== 'italic bold 18px "Georgia", sans-serif' || context.textAlign !== "right" || context.textBaseline !== "top") {
	throw new Error(`Canvas text style is incorrect: ${context.font}, ${context.textAlign}, ${context.textBaseline}`);
}

console.log(`Text formatting verifier passed. wrappedLines=${wrapped.length}`);

assertContains("styles.css", stylesCss, "caret-color: var(--annotator-inline-text-color", "native caret must stay aligned with native editable text");
assertContains("main.ts", mainTs, "if (event.isComposing) { return false; }", "IME composition must not be intercepted by annotation shortcuts");
