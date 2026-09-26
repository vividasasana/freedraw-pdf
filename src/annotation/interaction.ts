import { distanceBetween, distanceToSegment, pathIntersectsPolygon, segmentsIntersect } from "./geometry";
import { getShapeBounds, getStrokeBounds, getTextBounds } from "./bounds";
import { getAnnotationRenderables } from "./renderOrder";
import { clamp, generateId } from "../utils/general";
import type { AnnotationClipboardPayload, AnnotationPoint, ImageAnnotation, NormalizedRect, RegionReference, ShapeAnnotation, StrokeAnnotation, TextAnnotation } from "../types";

export function getSelectionBoxPoints(start: AnnotationPoint, end: AnnotationPoint): AnnotationPoint[] {
	const left = clamp(Math.min(start.x, end.x), 0, 1);
	const right = clamp(Math.max(start.x, end.x), 0, 1);
	const top = clamp(Math.min(start.y, end.y), 0, 1);
	const bottom = clamp(Math.max(start.y, end.y), 0, 1);
	return [
		{ x: left, y: top, pressure: 0.5 },
		{ x: right, y: top, pressure: 0.5 },
		{ x: right, y: bottom, pressure: 0.5 },
		{ x: left, y: bottom, pressure: 0.5 },
		{ x: left, y: top, pressure: 0.5 }
	];
}

export function parseRegionReference(raw: string): RegionReference | null {
	const match = raw.match(/\[\[([^\]#]+)#page=(\d+)]]\s*::region\[page=(\d+);rect=([0-9.-]+),([0-9.-]+),([0-9.-]+),([0-9.-]+)]/i);
	if (!match) {
		return null;
	}
	const [, filePath, pageFromLink, pageFromRegion, left, top, right, bottom] = match;
	const linkPage = Number(pageFromLink);
	const regionPage = Number(pageFromRegion);
	if (!Number.isFinite(linkPage) || !Number.isFinite(regionPage) || linkPage !== regionPage) {
		return null;
	}
	const rect = {
		left: clamp(Number(left), 0, 1),
		top: clamp(Number(top), 0, 1),
		right: clamp(Number(right), 0, 1),
		bottom: clamp(Number(bottom), 0, 1)
	};
	if (rect.right <= rect.left || rect.bottom <= rect.top) {
		return null;
	}
	return {
		filePath,
		page: linkPage,
		rect
	};
}

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

export function getClipboardBounds(clipboard: AnnotationClipboardPayload): {
	left: number;
	right: number;
	top: number;
	bottom: number;
} | null {
	const bounds = [
		...clipboard.strokes.map((stroke) => getStrokeBounds(stroke)),
		...clipboard.textItems.map((item) => getTextBounds(item)),
		...clipboard.shapes.map((shape) => getShapeBounds(shape)),
		...(clipboard.imageItems ?? []).map((image) => getImageBounds(image))
	];
	if (bounds.length === 0) {
		return null;
	}
	return {
		left: Math.min(...bounds.map((bound) => bound.left)),
		right: Math.max(...bounds.map((bound) => bound.right)),
		top: Math.min(...bounds.map((bound) => bound.top)),
		bottom: Math.max(...bounds.map((bound) => bound.bottom))
	};
}

function getImageBounds(image: ImageAnnotation): { left: number; right: number; top: number; bottom: number } {
	return {
		left: clamp(image.x, 0, 1),
		right: clamp(image.x + image.widthScale, 0, 1),
		top: clamp(image.y, 0, 1),
		bottom: clamp(image.y + image.heightScale, 0, 1)
	};
}

export function getClipboardPasteOffset(
	clipboard: AnnotationClipboardPayload,
	targetPoint: AnnotationPoint | null,
	fallbackOffset = 0.02
): { x: number; y: number } {
	const bounds = getClipboardBounds(clipboard);
	if (!bounds || !targetPoint) {
		return { x: fallbackOffset, y: fallbackOffset };
	}
	const centerX = (bounds.left + bounds.right) / 2;
	const centerY = (bounds.top + bounds.bottom) / 2;
	return {
		x: clamp(targetPoint.x - centerX, -bounds.left, 1 - bounds.right),
		y: clamp(targetPoint.y - centerY, -bounds.top, 1 - bounds.bottom)
	};
}

export function cloneAnnotationsForPage(
	strokes: StrokeAnnotation[],
	textItems: TextAnnotation[],
	shapes: ShapeAnnotation[],
	pageNumber: number
): AnnotationClipboardPayload {
	const payload: AnnotationClipboardPayload = {
		strokes: [],
		textItems: [],
		shapes: []
	};
	getAnnotationRenderables(strokes, textItems, shapes).forEach((renderable, index) => {
		if (renderable.kind === "stroke") {
			payload.strokes.push(JSON.parse(JSON.stringify({ ...renderable.annotation, id: generateId("stroke"), page: pageNumber, zIndex: renderable.annotation.zIndex ?? index })) as StrokeAnnotation);
		} else if (renderable.kind === "text") {
			payload.textItems.push(JSON.parse(JSON.stringify({ ...renderable.annotation, id: generateId("text"), page: pageNumber, zIndex: renderable.annotation.zIndex ?? index })) as TextAnnotation);
		} else {
			payload.shapes.push(JSON.parse(JSON.stringify({ ...renderable.annotation, id: generateId("shape"), page: pageNumber, zIndex: renderable.annotation.zIndex ?? index })) as ShapeAnnotation);
		}
	});
	return payload;
}

export function distanceToRectEdge(point: AnnotationPoint, bounds: { left: number; right: number; top: number; bottom: number }): number {
	const topEdge = distanceToSegment(point, { x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top });
	const rightEdge = distanceToSegment(point, { x: bounds.right, y: bounds.top }, { x: bounds.right, y: bounds.bottom });
	const bottomEdge = distanceToSegment(point, { x: bounds.left, y: bounds.bottom }, { x: bounds.right, y: bounds.bottom });
	const leftEdge = distanceToSegment(point, { x: bounds.left, y: bounds.top }, { x: bounds.left, y: bounds.bottom });
	return Math.min(topEdge, rightEdge, bottomEdge, leftEdge);
}

export function pointInBounds(point: AnnotationPoint, bounds: { left: number; right: number; top: number; bottom: number }, padding = 0): boolean {
	return point.x >= bounds.left - padding &&
		point.x <= bounds.right + padding &&
		point.y >= bounds.top - padding &&
		point.y <= bounds.bottom + padding;
}

export function distanceToBounds(point: AnnotationPoint, bounds: { left: number; right: number; top: number; bottom: number }): number {
	if (pointInBounds(point, bounds)) {
		return 0;
	}
	const nearestX = clamp(point.x, bounds.left, bounds.right);
	const nearestY = clamp(point.y, bounds.top, bounds.bottom);
	return distanceBetween(point, { x: nearestX, y: nearestY });
}

export function distanceToStroke(point: AnnotationPoint, stroke: StrokeAnnotation): number {
	if (stroke.points.length === 0) {
		return Number.POSITIVE_INFINITY;
	}
	if (stroke.points.length === 1) {
		return distanceBetween(point, stroke.points[0]);
	}
	let nearest = Number.POSITIVE_INFINITY;
	for (let index = 1; index < stroke.points.length; index += 1) {
		nearest = Math.min(nearest, distanceToSegment(point, stroke.points[index - 1], stroke.points[index]));
	}
	return nearest;
}

export function polygonIntersectsBounds(
	polygon: AnnotationPoint[],
	bounds: { left: number; right: number; top: number; bottom: number }
): boolean {
	const rectPoints: AnnotationPoint[] = [
		{ x: bounds.left, y: bounds.top, pressure: 0.5 },
		{ x: bounds.right, y: bounds.top, pressure: 0.5 },
		{ x: bounds.right, y: bounds.bottom, pressure: 0.5 },
		{ x: bounds.left, y: bounds.bottom, pressure: 0.5 }
	];
	return pathIntersectsPolygon(rectPoints, polygon, true);
}

export function distanceToShape(point: AnnotationPoint, shape: ShapeAnnotation): number {
	if (shape.tool === "line") {
		return distanceToSegment(point, shape.start, shape.end);
	}
	const bounds = getShapeBounds(shape);
	if (shape.tool === "rectangle") {
		return distanceToRectEdge(point, bounds);
	}
	const centerX = (bounds.left + bounds.right) / 2;
	const centerY = (bounds.top + bounds.bottom) / 2;
	const radiusX = Math.max((bounds.right - bounds.left) / 2, 0.0001);
	const radiusY = Math.max((bounds.bottom - bounds.top) / 2, 0.0001);
	const normalized = Math.abs(((point.x - centerX) ** 2) / (radiusX ** 2) + ((point.y - centerY) ** 2) / (radiusY ** 2) - 1);
	return normalized * Math.max(radiusX, radiusY);
}

export function distanceBetweenSegments(
	firstStart: AnnotationPoint,
	firstEnd: AnnotationPoint,
	secondStart: AnnotationPoint,
	secondEnd: AnnotationPoint
): number {
	if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
		return 0;
	}
	return Math.min(
		distanceToSegment(firstStart, secondStart, secondEnd),
		distanceToSegment(firstEnd, secondStart, secondEnd),
		distanceToSegment(secondStart, firstStart, firstEnd),
		distanceToSegment(secondEnd, firstStart, firstEnd)
	);
}

export function pointInExpandedBounds(
	point: AnnotationPoint,
	bounds: { left: number; right: number; top: number; bottom: number },
	threshold: number
): boolean {
	return point.x >= bounds.left - threshold &&
		point.x <= bounds.right + threshold &&
		point.y >= bounds.top - threshold &&
		point.y <= bounds.bottom + threshold;
}

export function segmentIntersectsExpandedBounds(
	start: AnnotationPoint,
	end: AnnotationPoint,
	bounds: { left: number; right: number; top: number; bottom: number },
	threshold: number
): boolean {
	const expanded = {
		left: bounds.left - threshold,
		right: bounds.right + threshold,
		top: bounds.top - threshold,
		bottom: bounds.bottom + threshold
	};
	if (pointInExpandedBounds(start, bounds, threshold) || pointInExpandedBounds(end, bounds, threshold)) {
		return true;
	}
	const corners: AnnotationPoint[] = [
		{ x: expanded.left, y: expanded.top, pressure: 0.5 },
		{ x: expanded.right, y: expanded.top, pressure: 0.5 },
		{ x: expanded.right, y: expanded.bottom, pressure: 0.5 },
		{ x: expanded.left, y: expanded.bottom, pressure: 0.5 }
	];
	for (let index = 0; index < corners.length; index += 1) {
		if (segmentsIntersect(start, end, corners[index], corners[(index + 1) % corners.length])) {
			return true;
		}
	}
	return false;
}
