import { clamp } from "../utils/general";

export interface GeometryPoint {
	x: number;
	y: number;
}

export interface GeometryBounds {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export function distanceBetween(first: GeometryPoint, second: GeometryPoint): number {
	return Math.hypot(first.x - second.x, first.y - second.y);
}

export function distanceToSegment(point: GeometryPoint, start: GeometryPoint, end: GeometryPoint): number {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	if (dx === 0 && dy === 0) {
		return distanceBetween(point, start);
	}
	const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
	const projection = {
		x: start.x + t * dx,
		y: start.y + t * dy
	};
	return distanceBetween(point, projection);
}

export function getPolygonBounds(points: GeometryPoint[]): GeometryBounds {
	return {
		left: Math.min(...points.map((point) => point.x)),
		right: Math.max(...points.map((point) => point.x)),
		top: Math.min(...points.map((point) => point.y)),
		bottom: Math.max(...points.map((point) => point.y))
	};
}

export function boundsOverlap(first: GeometryBounds, second: GeometryBounds): boolean {
	return !(
		first.right < second.left ||
		first.left > second.right ||
		first.bottom < second.top ||
		first.top > second.bottom
	);
}

function orientation(a: GeometryPoint, b: GeometryPoint, c: GeometryPoint): number {
	const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
	if (Math.abs(value) < 0.000001) {
		return 0;
	}
	return value > 0 ? 1 : 2;
}

function onSegment(a: GeometryPoint, b: GeometryPoint, c: GeometryPoint): boolean {
	return (
		b.x <= Math.max(a.x, c.x) &&
		b.x >= Math.min(a.x, c.x) &&
		b.y <= Math.max(a.y, c.y) &&
		b.y >= Math.min(a.y, c.y)
	);
}

export function segmentsIntersect(
	firstStart: GeometryPoint,
	firstEnd: GeometryPoint,
	secondStart: GeometryPoint,
	secondEnd: GeometryPoint
): boolean {
	const o1 = orientation(firstStart, firstEnd, secondStart);
	const o2 = orientation(firstStart, firstEnd, secondEnd);
	const o3 = orientation(secondStart, secondEnd, firstStart);
	const o4 = orientation(secondStart, secondEnd, firstEnd);

	if (o1 !== o2 && o3 !== o4) {
		return true;
	}
	if (o1 === 0 && onSegment(firstStart, secondStart, firstEnd)) {
		return true;
	}
	if (o2 === 0 && onSegment(firstStart, secondEnd, firstEnd)) {
		return true;
	}
	if (o3 === 0 && onSegment(secondStart, firstStart, secondEnd)) {
		return true;
	}
	if (o4 === 0 && onSegment(secondStart, firstEnd, secondEnd)) {
		return true;
	}
	return false;
}
