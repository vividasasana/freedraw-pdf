import type { GeometryBounds, GeometryPoint } from "./geometry";
import { clamp } from "../utils/general";

export interface BoundedStroke<TPoint extends GeometryPoint = GeometryPoint> {
	width: number;
	widthScale?: number;
	points: TPoint[];
}

export interface BoundedShape<TPoint extends GeometryPoint = GeometryPoint> {
	width: number;
	widthScale?: number;
	start: TPoint;
	end: TPoint;
}

export interface BoundedText {
	text: string;
	x: number;
	y: number;
	fontSize: number;
	fontScale?: number;
	boxWidthScale?: number;
	boxHeightScale?: number;
	lineSpacing?: number;
	wordWrap?: boolean;
}

export function getTextLines(text: string): string[] {
	const lines = text.split(/\r?\n/);
	return lines.length > 0 ? lines : [text];
}

export function getNormalizedStrokePadding(width: number, widthScale?: number): number {
	const normalizedWidth = widthScale && widthScale > 0 ? widthScale : width * 0.0012;
	return clamp(normalizedWidth * 0.75, 0.003, 0.04);
}

export function getShapeBounds(shape: BoundedShape): GeometryBounds {
	const padding = getNormalizedStrokePadding(shape.width, shape.widthScale);
	return {
		left: clamp(Math.min(shape.start.x, shape.end.x) - padding, 0, 1),
		right: clamp(Math.max(shape.start.x, shape.end.x) + padding, 0, 1),
		top: clamp(Math.min(shape.start.y, shape.end.y) - padding, 0, 1),
		bottom: clamp(Math.max(shape.start.y, shape.end.y) + padding, 0, 1)
	};
}

export function getStrokeBounds(stroke: BoundedStroke): GeometryBounds {
	if (stroke.points.length === 0) {
		return { left: 0, right: 0, top: 0, bottom: 0 };
	}
	const xs = stroke.points.map((point) => point.x);
	const ys = stroke.points.map((point) => point.y);
	const padding = getNormalizedStrokePadding(stroke.width, stroke.widthScale);
	return {
		left: clamp(Math.min(...xs) - padding, 0, 1),
		right: clamp(Math.max(...xs) + padding, 0, 1),
		top: clamp(Math.min(...ys) - padding, 0, 1),
		bottom: clamp(Math.max(...ys) + padding, 0, 1)
	};
}

export function getTextBounds(textItem: BoundedText): GeometryBounds {
	const lines = getTextLines(textItem.text);
	const longestLine = lines.reduce((longest, line) => line.length > longest.length ? line : longest, "");
	const normalizedFontSize = textItem.fontScale && textItem.fontScale > 0
		? textItem.fontScale
		: textItem.fontSize * 0.00135;
	const rawEstimatedWidth = Math.max(0.032, longestLine.length * normalizedFontSize * 0.58);
	const estimatedWidth = textItem.boxWidthScale && textItem.boxWidthScale > 0
		? Math.max(0.032, textItem.boxWidthScale)
		: rawEstimatedWidth;
	const estimatedWrappedLineCount = textItem.wordWrap !== false && textItem.boxWidthScale && textItem.boxWidthScale > 0
		? lines.reduce((sum, line) => {
			const lineWidth = Math.max(0.032, line.length * normalizedFontSize * 0.58);
			return sum + Math.max(1, Math.ceil(lineWidth / estimatedWidth));
		}, 0)
		: lines.length;
	const lineSpacing = clamp(textItem.lineSpacing ?? 1.35, 0.8, 3);
	const estimatedHeight = Math.max(
		0.026,
		normalizedFontSize + ((Math.max(1, estimatedWrappedLineCount) - 1) * normalizedFontSize * lineSpacing)
	);
	const finalHeight = textItem.boxHeightScale && textItem.boxHeightScale > 0
		? Math.max(estimatedHeight, textItem.boxHeightScale)
		: estimatedHeight;
	const padding = textItem.boxWidthScale ? 0 : 0.005;
	return {
		left: textItem.x - padding,
		right: textItem.x + estimatedWidth,
		top: textItem.y - padding,
		bottom: textItem.y + finalHeight
	};
}
