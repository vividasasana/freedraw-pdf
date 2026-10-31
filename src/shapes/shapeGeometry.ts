import { distanceToSegment, segmentsIntersect, type GeometryPoint } from "../annotation/geometry";
import { annotationOpacity } from "./shapeOptions";
import type { ShapeAnnotation } from "../types";

export type ShapeGeometryInput = Pick<ShapeAnnotation, "start" | "end" | "width" | "widthScale" | "lineStyle" | "waveSize" | "aspectRatio" | "vertices" | "clippedGeometry"> & { tool?: string };

function geometryBox(shape: Pick<ShapeAnnotation, "start" | "end">) {
	const dx = Math.abs(shape.end.x - shape.start.x), dy = Math.abs(shape.end.y - shape.start.y);
	return { left: Math.min(shape.start.x, shape.end.x), top: Math.min(shape.start.y, shape.end.y), width: dx || dy || 1, height: dy || dx || 1 };
}

export function relativeShapeGeometry(shape: ShapeGeometryInput, paths: GeometryPoint[][], dots: GeometryPoint[]): NonNullable<ShapeAnnotation["clippedGeometry"]> {
	const box = geometryBox(shape), relative = (point: GeometryPoint) => ({ x: (point.x - box.left) / box.width, y: (point.y - box.top) / box.height });
	return { paths: paths.map(path => path.map(relative)), dots: dots.map(relative) };
}
export function shapeWidthScale(shape: Pick<ShapeAnnotation, "width" | "widthScale">): number {
	return Math.max(.00001, Math.min(.12, Number.isFinite(shape.widthScale) && shape.widthScale! > 0 ? shape.widthScale! : Number.isFinite(shape.width) ? shape.width / 1524 : .002));
}

/** All paths are normalized page coordinates. Pattern spacing is in page-width units. */
export function shapeGeometry(shape: ShapeGeometryInput): { paths: GeometryPoint[][]; dots: GeometryPoint[]; radius: number; aspect: number } {
	const aspect = Number.isFinite(shape.aspectRatio) ? Math.max(.1, Math.min(20, shape.aspectRatio!)) : 1;
	const width = shapeWidthScale(shape), radius = width / 2;
	const result = { paths: [] as GeometryPoint[][], dots: [] as GeometryPoint[], radius, aspect };
	const a = shape.start, b = shape.end;
	if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return result;
	if (shape.clippedGeometry) {
		const box = geometryBox(shape), absolute = (point: GeometryPoint) => ({ x: box.left + point.x * box.width, y: box.top + point.y * box.height });
		result.paths = shape.clippedGeometry.paths.map(path => path.map(absolute));
		result.dots = shape.clippedGeometry.dots.map(absolute);
		return result;
	}
	if (shape.tool !== "line") {
		if (shape.tool === "triangle") {
			const vertices = shape.vertices?.length === 3 ? shape.vertices : [{ x: .5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
			const points = vertices.map(p => ({ x: a.x + (b.x - a.x) * p.x, y: a.y + (b.y - a.y) * p.y }));
			result.paths.push([...points, points[0]]);
		} else if (shape.tool === "ellipse") {
			result.paths.push(Array.from({ length: 129 }, (_, i) => ({ x: (a.x + b.x) / 2 + (b.x - a.x) / 2 * Math.cos(i * Math.PI / 64), y: (a.y + b.y) / 2 + (b.y - a.y) / 2 * Math.sin(i * Math.PI / 64) })));
		} else result.paths.push([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]);
		return result;
	}
	const dx = b.x - a.x, dy = (b.y - a.y) * aspect, length = Math.hypot(dx, dy);
	if (length < 1e-9) return result;
	const at = (d: number, offset = 0): GeometryPoint => ({ x: a.x + dx * d / length - dy / length * offset, y: a.y + (dy * d / length + dx / length * offset) / aspect });
	const step = Math.max(width * 3, length / 2048);
	if (shape.lineStyle === "dotted") {
		const count = Math.max(1, Math.floor(length / step));
		for (let i = 0; i <= count; i++) result.dots.push(at(i * length / count));
	} else if (shape.lineStyle === "dashed") {
		const dash = Math.max(width * 3, length / 2048), gap = dash * .8;
		for (let d = 0, i = 0; d < length && i < 2048; d += dash + gap, i++) result.paths.push([at(d), at(Math.min(d + dash, length))]);
	} else if (shape.lineStyle === "wavy") {
		const amplitude = width * Math.max(.25, Math.min(6, Number.isFinite(shape.waveSize) ? shape.waveSize! : 1.5));
		const wavelength = Math.max(width * 6, amplitude * 4);
		const cycles = Math.max(.5, Math.round(length / wavelength * 2) / 2);
		const count = Math.min(8192, Math.max(8, Math.ceil(cycles * 32)));
		result.paths.push(Array.from({ length: count + 1 }, (_, i) => at(length * i / count, Math.sin(i / count * cycles * Math.PI * 2) * amplitude)));
	} else result.paths.push([a, b]);
	return result;
}

type DrawingContext = Pick<CanvasRenderingContext2D, "save" | "restore" | "beginPath" | "moveTo" | "lineTo" | "arc" | "ellipse" | "strokeRect" | "stroke" | "fill" | "setLineDash" | "strokeStyle" | "fillStyle" | "lineWidth" | "lineCap" | "lineJoin" | "globalAlpha">;
export function renderShape(context: DrawingContext, shape: ShapeAnnotation, width: number, height: number): void {
	const geometry = shapeGeometry(shape);
	context.save();
	context.strokeStyle = shape.color; context.fillStyle = shape.color;
	context.lineWidth = Math.max(1, shapeWidthScale(shape) * width);
	context.globalAlpha = annotationOpacity(shape); context.lineCap = "round"; context.lineJoin = "round"; context.setLineDash([]);
	// Preserve exact legacy primitives. New line styles/triangles use shared paths.
	if (!shape.clippedGeometry && shape.tool === "rectangle") context.strokeRect(shape.start.x * width, shape.start.y * height, (shape.end.x - shape.start.x) * width, (shape.end.y - shape.start.y) * height);
	else if (!shape.clippedGeometry && shape.tool === "ellipse") {
		context.beginPath(); context.ellipse((shape.start.x + shape.end.x) / 2 * width, (shape.start.y + shape.end.y) / 2 * height, Math.abs(shape.end.x - shape.start.x) / 2 * width, Math.abs(shape.end.y - shape.start.y) / 2 * height, 0, 0, Math.PI * 2); context.stroke();
	} else if (geometry.dots.length) {
		context.beginPath();
		for (const dot of geometry.dots) { context.moveTo((dot.x + geometry.radius) * width, dot.y * height); context.ellipse(dot.x * width, dot.y * height, geometry.radius * width, geometry.radius / geometry.aspect * height, 0, 0, Math.PI * 2); }
		context.fill();
	} else {
		context.beginPath();
		for (const path of geometry.paths) { if (!path.length) continue; context.moveTo(path[0].x * width, path[0].y * height); for (const point of path.slice(1)) context.lineTo(point.x * width, point.y * height); }
		context.stroke();
	}
	context.restore();
}

export function distanceToShapeGeometry(point: GeometryPoint, shape: ShapeGeometryInput): number {
	const { paths, dots, radius, aspect } = shapeGeometry(shape);
	let best = Infinity;
	for (const path of paths) for (let i = 1; i < path.length; i++) best = Math.min(best, distanceToSegment(point, path[i - 1], path[i]));
	for (const dot of dots) best = Math.min(best, Math.hypot(point.x - dot.x, (point.y - dot.y) * aspect) / Math.max(1, aspect));
	return Math.max(0, best - radius);
}

export function shapeIntersectsSegment(shape: ShapeGeometryInput, start: GeometryPoint, end: GeometryPoint, tolerance: number): boolean {
	const geometry = shapeGeometry(shape), limit = tolerance + geometry.radius;
	for (const path of geometry.paths) for (let i = 1; i < path.length; i++) {
		const a = path[i - 1], b = path[i];
		if (segmentsIntersect(start, end, a, b) || Math.min(distanceToSegment(start, a, b), distanceToSegment(end, a, b), distanceToSegment(a, start, end), distanceToSegment(b, start, end)) <= limit) return true;
	}
	return geometry.dots.some(dot => distanceToSegment(dot, start, end) <= limit);
}
