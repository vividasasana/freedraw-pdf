import { getShapeBounds, getTextBounds } from "./bounds";
import { distanceBetween, distanceToSegment } from "./geometry";
import { distanceBetweenSegments, distanceToShape, segmentIntersectsExpandedBounds } from "./interaction";
import type { AnnotationDocument, AnnotationPoint, ImageAnnotation, ShapeAnnotation, StrokeAnnotation, TextAnnotation } from "../types";

interface Segment {
	start: AnnotationPoint;
	end: AnnotationPoint;
}

function getSegments(points: AnnotationPoint[]): Segment[] {
	if (points.length === 0) {
		return [];
	}
	if (points.length === 1) {
		return [{ start: points[0], end: points[0] }];
	}
	return points.slice(1).map((point, index) => ({ start: points[index], end: point }));
}

function pathTouchesStroke(stroke: StrokeAnnotation, segments: Segment[], threshold: number): boolean {
	if (stroke.points.length === 0) {
		return false;
	}
	if (segments.some((segment) => stroke.points.some((point) => distanceToSegment(point, segment.start, segment.end) <= threshold))) {
		return true;
	}
	for (let index = 1; index < stroke.points.length; index += 1) {
		if (segments.some((segment) =>
			distanceBetweenSegments(stroke.points[index - 1], stroke.points[index], segment.start, segment.end) <= threshold
		)) {
			return true;
		}
	}
	return false;
}

function interpolatePoint(start: AnnotationPoint, end: AnnotationPoint, progress: number): AnnotationPoint {
	const startTime = start.t;
	const endTime = end.t;
	return {
		x: start.x + (end.x - start.x) * progress,
		y: start.y + (end.y - start.y) * progress,
		pressure: start.pressure + (end.pressure - start.pressure) * progress,
		t: startTime !== undefined && endTime !== undefined
			? startTime + (endTime - startTime) * progress
			: startTime ?? endTime
	};
}

function pointTouchesPath(point: AnnotationPoint, segments: Segment[], threshold: number): boolean {
	return segments.some((segment) => distanceToSegment(point, segment.start, segment.end) <= threshold);
}

function sampleStrokeNearEraser(stroke: StrokeAnnotation, segments: Segment[], threshold: number): AnnotationPoint[] {
	if (stroke.points.length < 2) {
		return [...stroke.points];
	}
	const sampleSpacing = Math.max(0.00025, Math.min(threshold * 0.2, 0.0025));
	const sampled: AnnotationPoint[] = [stroke.points[0]];
	for (let index = 1; index < stroke.points.length; index += 1) {
		const start = stroke.points[index - 1];
		const end = stroke.points[index];
		const touches = segments.some((segment) =>
			distanceBetweenSegments(start, end, segment.start, segment.end) <= threshold
		);
		const steps = touches
			? Math.min(256, Math.max(1, Math.ceil(distanceBetween(start, end) / sampleSpacing)))
			: 1;
		for (let step = 1; step <= steps; step += 1) {
			sampled.push(step === steps ? end : interpolatePoint(start, end, step / steps));
		}
	}
	return sampled;
}

function getCutContextPoint(
	outside: AnnotationPoint,
	inside: AnnotationPoint,
	segments: Segment[],
	threshold: number
): AnnotationPoint {
	let low = 0;
	let high = 1;
	for (let iteration = 0; iteration < 8; iteration += 1) {
		const middle = (low + high) / 2;
		if (pointTouchesPath(interpolatePoint(outside, inside, middle), segments, threshold)) {
			high = middle;
		} else {
			low = middle;
		}
	}
	return interpolatePoint(outside, inside, Math.min(1, high + 0.08));
}

export function splitStrokeByEraserPath(
	stroke: StrokeAnnotation,
	eraserPoints: AnnotationPoint[],
	radiusScale: number,
	createId: () => string
): { changed: boolean; strokes: StrokeAnnotation[] } {
	const segments = getSegments(eraserPoints);
	const threshold = Math.max(0.0005, radiusScale) + Math.max(0, stroke.widthScale ?? 0) * 0.5;
	if (segments.length === 0 || !pathTouchesStroke(stroke, segments, threshold)) {
		return { changed: false, strokes: [stroke] };
	}
	if (stroke.points.length === 1) {
		return { changed: true, strokes: [] };
	}

	const sampled = sampleStrokeNearEraser(stroke, segments, threshold);
	const fragments: { points: AnnotationPoint[]; cutStart: boolean; cutEnd: boolean }[] = [];
	let active: AnnotationPoint[] = [];
	let activeCutStart = false;
	let previous = sampled[0];
	let previousErased = pointTouchesPath(previous, segments, threshold);
	if (!previousErased) {
		active.push(previous);
	}

	for (let index = 1; index < sampled.length; index += 1) {
		const point = sampled[index];
		const erased = pointTouchesPath(point, segments, threshold);
		if (!previousErased && erased && active.length > 0) {
			active.push(getCutContextPoint(previous, point, segments, threshold));
			if (active.length >= 2) {
				fragments.push({ points: active, cutStart: activeCutStart, cutEnd: true });
			}
			active = [];
		} else if (previousErased && !erased) {
			activeCutStart = true;
			active = [getCutContextPoint(point, previous, segments, threshold), point];
		} else if (!erased) {
			active.push(point);
		}
		previous = point;
		previousErased = erased;
	}
	if (active.length >= 2) {
		fragments.push({ points: active, cutStart: activeCutStart, cutEnd: false });
	}

	return {
		changed: true,
		strokes: fragments.map((fragment, index) => ({
			...stroke,
			id: index === 0 ? stroke.id : createId(),
			points: fragment.points,
			cutStart: stroke.cutStart === true || fragment.cutStart,
			cutEnd: stroke.cutEnd === true || fragment.cutEnd
		}))
	};
}

export function eraseStrokeSegmentsAlongPath(
	document: AnnotationDocument,
	pageNumber: number,
	eraserPoints: AnnotationPoint[],
	radiusScale: number,
	createId: () => string
): boolean {
	let changed = false;
	const strokes: StrokeAnnotation[] = [];
	for (const stroke of document.strokes) {
		if (stroke.page !== pageNumber) {
			strokes.push(stroke);
			continue;
		}
		const result = splitStrokeByEraserPath(stroke, eraserPoints, radiusScale, createId);
		changed = changed || result.changed;
		strokes.push(...result.strokes);
	}
	if (changed) {
		document.strokes = strokes;
	}
	return changed;
}

interface LegacyMaskedStroke extends StrokeAnnotation {
	eraseMasks?: Array<{
		points: AnnotationPoint[];
		radiusScale: number;
	}>;
}

export function migrateStrokeEraseMasks(strokes: StrokeAnnotation[], createId: () => string): boolean {
	let changed = false;
	const migrated: StrokeAnnotation[] = [];
	for (const storedStroke of strokes) {
		const legacyStroke = storedStroke as LegacyMaskedStroke;
		const masks = Array.isArray(legacyStroke.eraseMasks) ? legacyStroke.eraseMasks : [];
		if (masks.length === 0) {
			migrated.push(storedStroke);
			continue;
		}
		const { eraseMasks: _discardedMasks, ...baseStroke } = legacyStroke;
		let fragments: StrokeAnnotation[] = [baseStroke];
		for (const mask of masks) {
			if (!Array.isArray(mask.points) || mask.points.length === 0) {
				continue;
			}
			fragments = fragments.flatMap((fragment) =>
				splitStrokeByEraserPath(fragment, mask.points, Math.max(0.0005, Number(mask.radiusScale) || 0.004), createId).strokes
			);
		}
		migrated.push(...fragments);
		changed = true;
	}
	if (changed) {
		strokes.splice(0, strokes.length, ...migrated);
	}
	return changed;
}

function pathTouchesText(item: TextAnnotation, segments: Segment[], threshold: number): boolean {
	const bounds = getTextBounds(item);
	return segments.some((segment) => segmentIntersectsExpandedBounds(segment.start, segment.end, bounds, threshold));
}

function pathTouchesImage(image: ImageAnnotation, segments: Segment[], threshold: number): boolean {
	const bounds = {
		left: image.x,
		top: image.y,
		right: image.x + image.widthScale,
		bottom: image.y + image.heightScale
	};
	return segments.some((segment) => segmentIntersectsExpandedBounds(segment.start, segment.end, bounds, threshold));
}

function pathTouchesShape(shape: ShapeAnnotation, segments: Segment[], threshold: number): boolean {
	if (shape.tool === "line") {
		return segments.some((segment) => distanceBetweenSegments(segment.start, segment.end, shape.start, shape.end) <= threshold);
	}
	const bounds = getShapeBounds(shape);
	return segments.some((segment) =>
		segmentIntersectsExpandedBounds(segment.start, segment.end, bounds, threshold) ||
		distanceToShape(segment.start, shape) <= threshold ||
		distanceToShape(segment.end, shape) <= threshold
	);
}

function getOrder(zIndex: number | undefined, fallback: number): number {
	return zIndex ?? fallback;
}

export function migrateLegacyEraserPaths(document: AnnotationDocument): boolean {
	const eraserPaths = [...(document.eraserPaths ?? [])]
		.map((annotation, index) => ({ annotation, fallbackOrder: 300000 + index }))
		.sort((left, right) => getOrder(left.annotation.zIndex, left.fallbackOrder) - getOrder(right.annotation.zIndex, right.fallbackOrder));
	if (eraserPaths.length === 0) {
		return false;
	}

	for (const { annotation: eraserPath, fallbackOrder } of eraserPaths) {
		const segments = getSegments(eraserPath.points);
		if (segments.length === 0) {
			continue;
		}
		const eraseOrder = getOrder(eraserPath.zIndex, fallbackOrder);
		document.strokes = document.strokes.filter((stroke, index) =>
			stroke.page !== eraserPath.page ||
			getOrder(stroke.zIndex, index) >= eraseOrder ||
			!pathTouchesStroke(
				stroke,
				segments,
				Math.max(0.0005, eraserPath.radiusScale) + Math.max(0, stroke.widthScale ?? 0) * 0.5
			)
		);
		document.textItems = document.textItems.filter((item, index) =>
			item.page !== eraserPath.page ||
			getOrder(item.zIndex, 100000 + index) >= eraseOrder ||
			!pathTouchesText(item, segments, eraserPath.radiusScale)
		);
		document.shapes = document.shapes.filter((shape, index) =>
			shape.page !== eraserPath.page ||
			getOrder(shape.zIndex, 200000 + index) >= eraseOrder ||
			!pathTouchesShape(shape, segments, eraserPath.radiusScale)
		);
		document.imageItems = (document.imageItems ?? []).filter((image, index) =>
			image.page !== eraserPath.page ||
			getOrder(image.zIndex, index) >= eraseOrder ||
			!pathTouchesImage(image, segments, eraserPath.radiusScale)
		);
	}
	document.eraserPaths = [];
	return true;
}
