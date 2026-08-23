import { getTextLines } from "../annotation/bounds";
import { clamp } from "../utils/general";
import type {
	AnnotationPoint,
	TextAlignment,
	TextAnnotation,
	TextFontStyle,
	TextFontWeight,
	TextVerticalAlignment
} from "../types";

export const INLINE_TEXT_BOX_PADDING_X = 10;
export const INLINE_TEXT_BOX_PADDING_Y = 6;
export const INLINE_TEXT_LINE_HEIGHT = 1.35;
export const DEFAULT_INLINE_TEXT_BOX_WIDTH = 220;
export const DEFAULT_INLINE_TEXT_BOX_HEIGHT = 64;
export const MIN_TEXT_LINE_SPACING = 0.8;
export const MAX_TEXT_LINE_SPACING = 3;
export const TEXT_LAYOUT_REFERENCE_WIDTH = 1524;

export interface RenderedTextLayoutMetrics {
	paddingX: number;
	paddingY: number;
	minimumInnerWidth: number;
	boxExtraWidth: number;
	boxExtraHeight: number;
	minimumBoxWidth: number;
	minimumBoxHeight: number;
}

export interface ZoomStableTextFrameLayout {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function getZoomStableTextFrameLayout(
	point: Pick<AnnotationPoint, "x" | "y">,
	widthScale: number,
	heightScale: number,
	pageWidth: number,
	pageHeight: number
): ZoomStableTextFrameLayout {
	const safeWidth = Math.max(pageWidth, 1);
	const safeHeight = Math.max(pageHeight, 1);
	return {
		left: point.x * safeWidth,
		top: point.y * safeHeight,
		width: widthScale * safeWidth,
		height: heightScale * safeHeight
	};
}

export function resolveTextFontWeight(textItem: Pick<TextAnnotation, "fontWeight">): TextFontWeight {
	return textItem.fontWeight === "bold" ? "bold" : "normal";
}

export function resolveTextFontStyle(textItem: Pick<TextAnnotation, "fontStyle">): TextFontStyle {
	return textItem.fontStyle === "italic" ? "italic" : "normal";
}

export function resolveTextAlignment(textItem: Pick<TextAnnotation, "textAlign">): TextAlignment {
	return textItem.textAlign === "center" || textItem.textAlign === "right" ? textItem.textAlign : "left";
}

export function resolveTextVerticalAlignment(
	textItem: Pick<TextAnnotation, "verticalAlign">
): TextVerticalAlignment {
	return textItem.verticalAlign === "top" || textItem.verticalAlign === "bottom"
		? textItem.verticalAlign
		: "middle";
}

export function resolveTextLineSpacing(textItem: Pick<TextAnnotation, "lineSpacing">): number {
	return clamp(
		Number.isFinite(textItem.lineSpacing) ? textItem.lineSpacing ?? INLINE_TEXT_LINE_HEIGHT : INLINE_TEXT_LINE_HEIGHT,
		MIN_TEXT_LINE_SPACING,
		MAX_TEXT_LINE_SPACING
	);
}

export function resolveTextWordWrap(textItem: Pick<TextAnnotation, "wordWrap">): boolean {
	return textItem.wordWrap !== false;
}

export function applyCanvasTextStyle(
	context: CanvasRenderingContext2D,
	textItem: Pick<TextAnnotation, "fontWeight" | "fontStyle" | "textAlign">,
	fontSize: number,
	fontFamily: string
): void {
	context.font = `${resolveTextFontStyle(textItem)} ${resolveTextFontWeight(textItem)} ${fontSize}px "${fontFamily}", sans-serif`;
	context.textAlign = resolveTextAlignment(textItem);
	context.textBaseline = "top";
}

export function getAlignedTextX(left: number, width: number, alignment: TextAlignment): number {
	if (alignment === "center") {
		return left + (width / 2);
	}
	if (alignment === "right") {
		return left + width;
	}
	return left;
}

export function getRenderedTextPadding(value: number, pageWidth: number): number {
	return value * (Math.max(pageWidth, 1) / TEXT_LAYOUT_REFERENCE_WIDTH);
}

export function getRenderedTextLayoutMetrics(pageWidth: number): RenderedTextLayoutMetrics {
	return {
		paddingX: getRenderedTextPadding(INLINE_TEXT_BOX_PADDING_X, pageWidth),
		paddingY: getRenderedTextPadding(INLINE_TEXT_BOX_PADDING_Y, pageWidth),
		minimumInnerWidth: getRenderedTextPadding(24, pageWidth),
		boxExtraWidth: getRenderedTextPadding(4, pageWidth),
		boxExtraHeight: getRenderedTextPadding(2, pageWidth),
		minimumBoxWidth: getRenderedTextPadding(44, pageWidth),
		minimumBoxHeight: getRenderedTextPadding(36, pageWidth)
	};
}

export function getRenderedTextFontSize(fontScale: number, pageWidth: number, minimumSize = 10): number {
	const safeWidth = Math.max(pageWidth, 1);
	return Math.max(minimumSize / TEXT_LAYOUT_REFERENCE_WIDTH, fontScale) * safeWidth;
}

export function getTextBlockHeight(
	fontSize: number,
	lineCount: number,
	lineSpacing = INLINE_TEXT_LINE_HEIGHT
): number {
	const safeLineCount = Math.max(1, lineCount);
	return fontSize + ((safeLineCount - 1) * fontSize * clamp(lineSpacing, MIN_TEXT_LINE_SPACING, MAX_TEXT_LINE_SPACING));
}

export function getTextBlockTop(
	boxTop: number,
	boxHeight: number,
	fontSize: number,
	lineCount: number,
	verticalAlign: TextVerticalAlignment,
	lineSpacing = INLINE_TEXT_LINE_HEIGHT,
	paddingY = INLINE_TEXT_BOX_PADDING_Y
): number {
	const blockHeight = getTextBlockHeight(fontSize, lineCount, lineSpacing);
	if (verticalAlign === "top") {
		return boxTop + paddingY;
	}
	if (verticalAlign === "bottom") {
		return boxTop + Math.max(paddingY, boxHeight - paddingY - blockHeight);
	}
	return boxTop + Math.max(0, (Math.max(boxHeight, blockHeight) - blockHeight) / 2);
}

export function getVerticallyCenteredTextTop(
	boxTop: number,
	boxHeight: number,
	fontSize: number,
	lineCount: number
): number {
	return getTextBlockTop(boxTop, boxHeight, fontSize, lineCount, "middle");
}

export function measureAutoFitTextBox(
	context: CanvasRenderingContext2D,
	text: string,
	fontSize: number,
	maxWidth: number,
	lineSpacing = INLINE_TEXT_LINE_HEIGHT,
	wordWrap = true,
	metrics: RenderedTextLayoutMetrics = getRenderedTextLayoutMetrics(TEXT_LAYOUT_REFERENCE_WIDTH)
): { width: number; height: number; lineCount: number } {
	const safeMaxWidth = Math.max(metrics.minimumBoxWidth, maxWidth);
	const sourceLines = getTextLines(text || " ");
	const widestLine = sourceLines.reduce(
		(width, line) => Math.max(width, context.measureText(line || " ").width),
		0
	);
	const width = clamp(
		Math.ceil(widestLine + (metrics.paddingX * 2) + metrics.boxExtraWidth),
		metrics.minimumBoxWidth,
		safeMaxWidth
	);
	const innerWidth = Math.max(metrics.minimumInnerWidth, width - (metrics.paddingX * 2));
	const lineCount = Math.max(1, getCanvasTextLines(context, text || " ", innerWidth, wordWrap).length);
	const height = Math.max(
		metrics.minimumBoxHeight,
		Math.ceil((metrics.paddingY * 2) + getTextBlockHeight(fontSize, lineCount, lineSpacing) + metrics.boxExtraHeight)
	);
	return { width, height, lineCount };
}

export function getInlineTextEditorLayout(
	point: AnnotationPoint,
	width: number,
	height: number,
	existingItem?: TextAnnotation
): { left: number; top: number; width: number; height: number; point: AnnotationPoint } {
	const safeWidth = Math.max(width, 1);
	const safeHeight = Math.max(height, 1);
	const left = clamp(point.x * safeWidth, 8, Math.max(8, safeWidth - 56));
	const top = clamp(point.y * safeHeight, 8, Math.max(8, safeHeight - 64));
	const savedWidth = existingItem?.boxWidthScale && existingItem.boxWidthScale > 0
		? existingItem.boxWidthScale * safeWidth
		: 0;
	const preferredWidth = savedWidth > 0
		? savedWidth
		: DEFAULT_INLINE_TEXT_BOX_WIDTH;
	const availableWidth = Math.max(44, safeWidth - left - 12);
	const maxWidth = Math.max(44, Math.min(availableWidth, safeWidth * 0.78, 560));
	const editorWidth = clamp(preferredWidth, 44, maxWidth);
	const savedHeight = existingItem?.boxHeightScale && existingItem.boxHeightScale > 0
		? existingItem.boxHeightScale * safeHeight
		: 0;
	const preferredHeight = savedHeight > 0 ? savedHeight : DEFAULT_INLINE_TEXT_BOX_HEIGHT;
	const editorHeight = clamp(preferredHeight, 36, Math.max(60, safeHeight - top - 12));
	return {
		left,
		top,
		width: editorWidth,
		height: editorHeight,
		point: {
			...point,
			x: clamp(left / safeWidth, 0.01, 0.96),
			y: clamp(top / safeHeight, 0.01, 0.96)
		}
	};
}

export function resizeInlineTextEditor(editor: HTMLTextAreaElement, maxHeight: number): void {
	editor.setCssStyles({ height: "auto" });
	editor.setCssStyles({ height: `${Math.min(Math.max(40, editor.scrollHeight + 2), Math.max(80, maxHeight))}px` });
}

export function getHorizontalTextCaretIndex(
	text: string,
	index: number,
	direction: "left" | "right",
	byWord = false
): number {
	const safeIndex = clamp(Math.round(index), 0, text.length);
	if (byWord) {
		let cursor = safeIndex;
		if (direction === "left") {
			while (cursor > 0 && /\s/.test(text[cursor - 1])) {
				cursor -= 1;
			}
			while (cursor > 0 && !/\s/.test(text[cursor - 1])) {
				cursor -= 1;
			}
			return cursor;
		}
		while (cursor < text.length && !/\s/.test(text[cursor])) {
			cursor += 1;
		}
		while (cursor < text.length && /\s/.test(text[cursor])) {
			cursor += 1;
		}
		return cursor;
	}
	if (direction === "left") {
		const previousCharacter = Array.from(text.slice(0, safeIndex)).pop();
		return previousCharacter ? safeIndex - previousCharacter.length : 0;
	}
	const nextCharacter = Array.from(text.slice(safeIndex))[0];
	return nextCharacter ? safeIndex + nextCharacter.length : text.length;
}

export function getCanvasTextLines(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	wordWrap = true
): string[] {
	return wordWrap ? getWrappedCanvasTextLines(context, text, maxWidth) : getTextLines(text);
}

export function getWrappedCanvasTextLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	const safeMaxWidth = Math.max(20, maxWidth);
	for (const sourceLine of getTextLines(text)) {
		if (sourceLine.trim() === "") {
			lines.push("");
			continue;
		}
		let currentLine = "";
		for (const word of sourceLine.split(/(\s+)/)) {
			if (word === "") {
				continue;
			}
			const candidate = `${currentLine}${word}`;
			if (currentLine && context.measureText(candidate).width > safeMaxWidth) {
				lines.push(currentLine.trimEnd());
				currentLine = word.trimStart();
			} else {
				currentLine = candidate;
			}
			while (currentLine && context.measureText(currentLine).width > safeMaxWidth) {
				const characters = Array.from(currentLine);
				let splitIndex = Math.max(1, characters.length - 1);
				while (splitIndex > 1 && context.measureText(characters.slice(0, splitIndex).join("")).width > safeMaxWidth) {
					splitIndex -= 1;
				}
				lines.push(characters.slice(0, splitIndex).join("").trimEnd());
				currentLine = characters.slice(splitIndex).join("").trimStart();
			}
		}
		if (currentLine) {
			lines.push(currentLine.trimEnd());
		}
	}
	return lines.length > 0 ? lines : [""];
}
