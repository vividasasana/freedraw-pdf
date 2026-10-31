import { distanceToSegment, type GeometryPoint } from "../annotation/geometry";
import type { AnnotationPoint, ShapeChoice, ShapeTool } from "../types";

export interface ShapeFit { tool: ShapeTool; start: AnnotationPoint; end: AnnotationPoint; vertices?: GeometryPoint[]; score: number; }
const distance = (a: GeometryPoint, b: GeometryPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const point = (x: number, y: number): AnnotationPoint => ({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), pressure: .5 });

/** Bounded arc-length resampling; event frequency and writing speed do not bias fits. */
export function resampleGesture(input: GeometryPoint[], count = 96): GeometryPoint[] {
	const limit = Math.min(2048, input.length), points: GeometryPoint[] = [];
	for (let i = 0; i < limit; i++) { const p = input[Math.floor(i * (input.length - 1) / Math.max(1, limit - 1))]; if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) points.push(p); }
	if (points.length < 2) return points;
	const cumulative = [0];
	for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
	const length = cumulative[cumulative.length - 1];
	if (length < 1e-8) return [points[0]];
	const output: GeometryPoint[] = [];
	for (let i = 0, j = 1; i < count; i++) {
		const d = i / (count - 1) * length;
		while (j < points.length - 1 && cumulative[j] < d) j++;
		const t = (d - cumulative[j - 1]) / Math.max(1e-10, cumulative[j] - cumulative[j - 1]);
		output.push({ x: points[j - 1].x + (points[j].x - points[j - 1].x) * t, y: points[j - 1].y + (points[j].y - points[j - 1].y) * t });
	}
	return output;
}

function hullOf(points: GeometryPoint[]): GeometryPoint[] {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	const cross = (a: GeometryPoint, b: GeometryPoint, c: GeometryPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	const half = (list: GeometryPoint[]) => { const h: GeometryPoint[] = []; for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } return h.slice(0, -1); };
	return [...half(sorted), ...half(sorted.reverse())];
}

export function fitGesture(input: GeometryPoint[], choice: ShapeChoice, aspectRatio = 1): ShapeFit | null {
	const aspect = Math.max(.1, Math.min(20, aspectRatio));
	const limit = Math.min(2048, input.length);
	const bounded = Array.from({ length: limit }, (_, i) => input[Math.floor(i * (input.length - 1) / Math.max(1, limit - 1))]);
	const points = resampleGesture(bounded.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => ({ x: p.x, y: p.y * aspect })));
	if (points.length < 3) return null;
	const xs = points.map(p => p.x), ys = points.map(p => p.y);
	const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
	const w = right - left, h = bottom - top, diagonal = Math.hypot(w, h);
	if (diagonal < .003) return null;
	let length = 0; for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
	const results: ShapeFit[] = [];
	const add = (tool: ShapeTool, score: number, vertices?: GeometryPoint[]) => {
		results.push({ tool, start: point(left, top / aspect), end: point(right, bottom / aspect), score, ...(vertices ? { vertices } : {}) });
	};
	if (choice === "auto" || choice === "line") {
		const center = { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length };
		let xx = 0, yy = 0, xy = 0;
		for (const p of points) { xx += (p.x - center.x) ** 2; yy += (p.y - center.y) ** 2; xy += (p.x - center.x) * (p.y - center.y); }
		const theta = .5 * Math.atan2(2 * xy, xx - yy), dx = Math.cos(theta), dy = Math.sin(theta);
		const projections = points.map(p => (p.x - center.x) * dx + (p.y - center.y) * dy);
		const low = Math.min(...projections), high = Math.max(...projections);
		const a = { x: center.x + dx * low, y: center.y + dy * low }, b = { x: center.x + dx * high, y: center.y + dy * high };
		const error = Math.sqrt(points.reduce((sum, p) => sum + distanceToSegment(p, a, b) ** 2, 0) / points.length) / diagonal;
		if (choice === "line" || error < .022 && length / Math.max(high - low, 1e-8) < 1.15) results.push({ tool: "line", start: point(a.x, a.y / aspect), end: point(b.x, b.y / aspect), score: error });
	}
	// Small gaps are normal when a rough outline is paused before its start point.
	// Geometry error, corner coverage and perimeter checks still reject scribbles.
	const closed = distance(points[0], points[points.length - 1]) < diagonal * .31;
	if ((closed || choice !== "auto") && w > .002 && h > .002) {
		if (choice === "rectangle" || choice === "auto") {
			const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
			const error = Math.sqrt(points.reduce((sum, p) => sum + Math.min(p.x - left, right - p.x, p.y - top, bottom - p.y) ** 2, 0) / points.length) / diagonal;
			const coverage = corners.every(c => Math.min(...points.map(p => distance(c, p))) < diagonal * .18);
			if (choice === "rectangle" || error < .065 && coverage && length < 2 * (w + h) * 1.22 && length > 2 * (w + h) * .74) add("rectangle", error);
		}
		if (choice === "ellipse" || choice === "auto") {
			const residuals = points.map(p => Math.abs(Math.hypot((p.x - (left + right) / 2) / (w / 2), (p.y - (top + bottom) / 2) / (h / 2)) - 1));
			const error = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / points.length);
			const perimeter = Math.PI * (3 * (w + h) / 2 - Math.sqrt((3 * w + h) * (w + 3 * h)) / 2);
			if (choice === "ellipse" || error < .15 && Math.max(...residuals) < .36 && length > perimeter * .78 && length < perimeter * 1.24) add("ellipse", error * .35);
		}
		if (choice === "triangle" || choice === "auto") {
			const hull = hullOf(points);
			while (hull.length > 3) {
				let remove = 0, smallest = Infinity;
				for (let i = 0; i < hull.length; i++) { const cost = distanceToSegment(hull[i], hull[(i + hull.length - 1) % hull.length], hull[(i + 1) % hull.length]); if (cost < smallest) { smallest = cost; remove = i; } }
				hull.splice(remove, 1);
			}
			if (hull.length === 3) {
				const error = Math.sqrt(points.reduce((sum, p) => sum + Math.min(...hull.map((a, i) => distanceToSegment(p, a, hull[(i + 1) % 3]))) ** 2, 0) / points.length) / diagonal;
				const perimeter = hull.reduce((sum, p, i) => sum + distance(p, hull[(i + 1) % 3]), 0);
				if (choice === "triangle" || error < .05 && length > perimeter * .78 && length < perimeter * 1.24) add("triangle", error, hull.map(p => ({ x: (p.x - left) / w, y: (p.y - top) / h })));
			}
		}
	}
	return results.sort((a, b) => a.score - b.score)[0] ?? null;
}
