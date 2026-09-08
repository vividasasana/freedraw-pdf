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

export function pointInPolygon(point: GeometryPoint, polygon: GeometryPoint[]): boolean {
	let inside = false;
	for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
		const currentPoint = polygon[current];
		const previousPoint = polygon[previous];
		const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y))
			&& (point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / ((previousPoint.y - currentPoint.y) || 0.000001) + currentPoint.x);
		if (intersects) {
			inside = !inside;
		}
	}
	return inside;
}

export function pathIntersectsPolygon(path: GeometryPoint[], polygon: GeometryPoint[], closePath = false): boolean {
	if (path.length < 2 || polygon.length < 2) {
		return false;
	}
	for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
		const pathStart = path[pathIndex - 1];
		const pathEnd = path[pathIndex];
		for (let polygonIndex = 1; polygonIndex < polygon.length; polygonIndex += 1) {
			const polygonStart = polygon[polygonIndex - 1];
			const polygonEnd = polygon[polygonIndex];
			if (segmentsIntersect(pathStart, pathEnd, polygonStart, polygonEnd)) {
				return true;
			}
		}
		if (segmentsIntersect(pathStart, pathEnd, polygon[polygon.length - 1], polygon[0])) {
			return true;
		}
	}
	if (closePath && segmentsIntersect(path[path.length - 1], path[0], polygon[polygon.length - 1], polygon[0])) {
		return true;
	}
	return false;
}
