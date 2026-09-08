import { drawSmoothInkStroke } from "../ink/inkEngine";
import { getAnnotationRenderables } from "../annotation/renderOrder";
import type { AnnotationDocument, ImageAnnotation, NormalizedRect, ShapeAnnotation, StrokeAnnotation, TextAnnotation } from "../types";
import { TEXT_FONT_FAMILIES } from "../config";
import {
	TEXT_LAYOUT_REFERENCE_WIDTH,
	applyCanvasTextStyle,
	getAlignedTextX,
	getCanvasTextLines,
	getRenderedTextFontSize,
	getRenderedTextLayoutMetrics,
	getTextBlockHeight,
	getTextBlockTop,
	resolveTextAlignment,
	resolveTextLineSpacing,
	resolveTextVerticalAlignment,
	resolveTextWordWrap
} from "../text/textLayout";
import { clamp } from "../utils/general";

export function normalizeRect(rect: NormalizedRect): NormalizedRect | null {
	const normalized = {
		left: clamp(Math.min(rect.left, rect.right), 0, 1),
		top: clamp(Math.min(rect.top, rect.bottom), 0, 1),
		right: clamp(Math.max(rect.left, rect.right), 0, 1),
		bottom: clamp(Math.max(rect.top, rect.bottom), 0, 1)
	};
	if (normalized.right <= normalized.left || normalized.bottom <= normalized.top) {
		return null;
	}
	return normalized;
}

export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
	const canvas = createEl("canvas");
	canvas.width = source.width;
	canvas.height = source.height;
	const context = canvas.getContext("2d");
	if (context) {
		context.drawImage(source, 0, 0);
	}
	return canvas;
}

export function cropCanvasToNormalizedRect(source: HTMLCanvasElement, rect: NormalizedRect, padding = 20): HTMLCanvasElement {
	const normalized = normalizeRect(rect);
	if (!normalized) {
		return cloneCanvas(source);
	}
	const cropLeft = Math.max(0, Math.floor(normalized.left * source.width) - padding);
	const cropTop = Math.max(0, Math.floor(normalized.top * source.height) - padding);
	const cropRight = Math.min(source.width, Math.ceil(normalized.right * source.width) + padding);
	const cropBottom = Math.min(source.height, Math.ceil(normalized.bottom * source.height) + padding);
	const cropWidth = Math.max(1, cropRight - cropLeft);
	const cropHeight = Math.max(1, cropBottom - cropTop);
	const canvas = createEl("canvas");
	canvas.width = cropWidth;
	canvas.height = cropHeight;
	const context = canvas.getContext("2d");
	if (context) {
		context.drawImage(source, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
	}
	return canvas;
}

export function parseAnnotatedPdfEmbedSource(source: string): { path: string; page: number; width: number; rect: NormalizedRect | null } {
	const config: Record<string, string> = {};
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.+)$/);
		if (match) {
			config[match[1].toLowerCase()] = match[2].trim();
		}
	}
	const rawPath = (config.path ?? config.file ?? "").replace(/^['"]|['"]$/g, "").replace(/^!?\[\[/, "").replace(/\]\]$/, "");
	const page = Math.max(1, Math.round(Number(config.page ?? "1") || 1));
	const width = clamp(Math.round(Number(config.width ?? "720") || 720), 240, 1400);
	const rectValues = (config.rect ?? "").split(",").map((value) => Number(value.trim()));
	const rect = rectValues.length === 4 && rectValues.every((value) => Number.isFinite(value))
		? normalizeRect({ left: rectValues[0], top: rectValues[1], right: rectValues[2], bottom: rectValues[3] })
		: null;
	return { path: rawPath, page, width, rect };
}

export function formatAnnotatedPdfEmbedBlock(path: string, page: number, rect?: NormalizedRect | null, width = 720): string {
	const lines = [
		"```freedraw-pdf",
		`path: ${path}`,
		`page: ${page}`,
		`width: ${width}`
	];
	if (rect) {
		lines.push(`rect: ${[rect.left, rect.top, rect.right, rect.bottom].map((value) => value.toFixed(4)).join(",")}`);
	}
	lines.push("```");
	return lines.join("\n");
}

export function renderAnnotationDocumentPage(
	context: CanvasRenderingContext2D,
	document: AnnotationDocument,
	pageNumber: number,
	width: number,
	height: number
): void {
	const annotationCanvas = createEl("canvas");
	annotationCanvas.width = Math.max(1, Math.round(width));
	annotationCanvas.height = Math.max(1, Math.round(height));
	const annotationContext = annotationCanvas.getContext("2d");
	if (!annotationContext) {
		return;
	}
	const strokes = document.strokes.filter((stroke) => stroke.page === pageNumber);
	const textItems = document.textItems.filter((item) => item.page === pageNumber);
	const shapes = document.shapes.filter((shape) => shape.page === pageNumber);
	const renderables = getAnnotationRenderables(strokes, textItems, shapes);
	for (const renderable of renderables) {
		if (renderable.kind === "stroke") {
			renderEmbedStroke(annotationContext, renderable.annotation, width, height);
		} else if (renderable.kind === "text") {
			renderEmbedText(annotationContext, renderable.annotation, width, height);
		} else if (renderable.kind === "shape") {
			renderEmbedShape(annotationContext, renderable.annotation, width, height);
		}
	}
	context.drawImage(annotationCanvas, 0, 0);
}

export async function renderAnnotationDocumentPageImages(
	context: CanvasRenderingContext2D,
	document: AnnotationDocument,
	pageNumber: number,
	width: number,
	height: number
): Promise<void> {
	const imageItems = document.imageItems?.filter((image) => image.page === pageNumber) ?? [];
	for (const imageItem of imageItems) {
		const image = await loadImageAnnotation(imageItem);
		context.drawImage(
			image,
			imageItem.x * width,
			imageItem.y * height,
			Math.max(1, imageItem.widthScale * width),
			Math.max(1, imageItem.heightScale * height)
		);
	}
}

function loadImageAnnotation(imageItem: ImageAnnotation): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Could not load image annotation ${imageItem.name}.`));
		image.src = imageItem.dataUrl;
	});
}

function renderEmbedStroke(context: CanvasRenderingContext2D, stroke: StrokeAnnotation, width: number, height: number): void {
	if (stroke.points.length === 0) {
		return;
	}
	const baseWidth = stroke.widthScale ? Math.max(1, stroke.widthScale * width) : stroke.width;
	context.save();
	context.globalAlpha = stroke.tool === "highlighter" ? 0.24 : 0.96;
	context.fillStyle = stroke.color;
	context.strokeStyle = stroke.color;
	context.lineCap = "round";
	context.lineJoin = "round";
	drawSmoothInkStroke(context, stroke.points, width, height, baseWidth, stroke.tool !== "highlighter", false, {
		renderMode: "committed",
		startTaper: stroke.cutStart ? 0 : undefined,
		endTaper: stroke.cutEnd ? 0 : undefined
	});
	context.restore();
}

function renderEmbedText(context: CanvasRenderingContext2D, textItem: TextAnnotation, width: number, height: number): void {
	context.save();
	context.fillStyle = textItem.color;
	const fontScale = textItem.fontScale && textItem.fontScale > 0
		? textItem.fontScale
		: textItem.fontSize / TEXT_LAYOUT_REFERENCE_WIDTH;
	const fontSize = getRenderedTextFontSize(fontScale, width);
	const metrics = getRenderedTextLayoutMetrics(width);
	const fontFamily = textItem.fontFamily ?? TEXT_FONT_FAMILIES[0];
	applyCanvasTextStyle(context, textItem, fontSize, fontFamily);
	const boxWidth = textItem.boxWidthScale && textItem.boxWidthScale > 0
		? textItem.boxWidthScale * width
		: width * 0.48;
	const innerWidth = Math.max(metrics.minimumInnerWidth, boxWidth - (metrics.paddingX * 2));
	const textLeft = (textItem.x * width) + metrics.paddingX;
	const lineSpacing = resolveTextLineSpacing(textItem);
	const lines = getCanvasTextLines(context, textItem.text, innerWidth, resolveTextWordWrap(textItem));
	const fallbackHeight = (metrics.paddingY * 2) +
		getTextBlockHeight(fontSize, lines.length, lineSpacing) +
		metrics.boxExtraHeight;
	const boxHeight = textItem.boxHeightScale && textItem.boxHeightScale > 0
		? textItem.boxHeightScale * height
		: fallbackHeight;
	const textTop = getTextBlockTop(
		textItem.y * height,
		boxHeight,
		fontSize,
		lines.length,
		resolveTextVerticalAlignment(textItem),
		lineSpacing,
		metrics.paddingY
	);
	const textX = getAlignedTextX(textLeft, innerWidth, resolveTextAlignment(textItem));
	lines.forEach((line, index) => {
		context.fillText(line, textX, textTop + (index * fontSize * lineSpacing));
	});
	context.restore();
}

function renderEmbedShape(context: CanvasRenderingContext2D, shape: ShapeAnnotation, width: number, height: number): void {
	const startX = shape.start.x * width;
	const startY = shape.start.y * height;
	const endX = shape.end.x * width;
	const endY = shape.end.y * height;
	context.save();
	context.strokeStyle = shape.color;
	context.lineWidth = shape.widthScale ? Math.max(1, shape.widthScale * width) : shape.width;
	context.globalAlpha = 0.96;
	context.lineCap = "round";
	context.lineJoin = "round";
	if (shape.tool === "line") {
		context.beginPath();
		context.moveTo(startX, startY);
		context.lineTo(endX, endY);
		context.stroke();
		context.restore();
		return;
	}
	if (shape.tool === "rectangle") {
		context.strokeRect(startX, startY, endX - startX, endY - startY);
		context.restore();
		return;
	}
	context.beginPath();
	context.ellipse((startX + endX) / 2, (startY + endY) / 2, Math.abs(endX - startX) / 2, Math.abs(endY - startY) / 2, 0, 0, Math.PI * 2);
	context.stroke();
	context.restore();
}
