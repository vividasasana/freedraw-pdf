import type { DrawingModifier, ShapeAnnotation } from "../types";

export type ShapeConstraint = "regular" | "right";
export function isDrawingModifierHeld(event: Pick<KeyboardEvent, "shiftKey" | "altKey" | "ctrlKey" | "metaKey">, modifier: DrawingModifier): boolean {
	return modifier === "shift" ? event.shiftKey : modifier === "alt" ? event.altKey : modifier === "control" ? event.ctrlKey : modifier === "meta" ? event.metaKey : false;
}

/** Work in page pixels/aspect units, so a circle stays round on portrait pages. */
export function constrainShape(shape: ShapeAnnotation, aspect = 1, constraint: ShapeConstraint = "regular"): ShapeAnnotation {
	aspect = Math.max(.1, Math.min(20, aspect));
	const next = { ...shape, start: { ...shape.start }, end: { ...shape.end } };
	if (shape.tool === "line") {
		const dx = shape.end.x - shape.start.x, dy = (shape.end.y - shape.start.y) * aspect, length = Math.hypot(dx, dy);
		const step = constraint === "right" ? Math.PI / 2 : Math.PI / 4, angle = Math.round(Math.atan2(dy, dx) / step) * step;
		const x = Math.cos(angle) * length, y = Math.sin(angle) * length;
		const scale = Math.min(1, x > 0 ? (1 - shape.start.x) / x : x < 0 ? -shape.start.x / x : 1, y > 0 ? (aspect - shape.start.y * aspect) / y : y < 0 ? -shape.start.y * aspect / y : 1);
		next.end = { ...next.end, x: shape.start.x + x * scale, y: shape.start.y + y * scale / aspect };
		return next;
	}
	const left = Math.min(shape.start.x, shape.end.x), top = Math.min(shape.start.y, shape.end.y) * aspect;
	const width = Math.abs(shape.end.x - shape.start.x), height = Math.abs(shape.end.y - shape.start.y) * aspect;
	if (shape.tool === "rectangle" || shape.tool === "ellipse") {
		const cx = left + width / 2, cy = top + height / 2;
		const half = Math.min((width + height) / 4, cx, 1 - cx, cy, aspect - cy);
		next.start = { ...next.start, x: cx - half, y: (cy - half) / aspect };
		next.end = { ...next.end, x: cx + half, y: (cy + half) / aspect };
		return next;
	}
	const input = (shape.vertices ?? [{ x: .5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]).map(p => ({ x: left + p.x * width, y: top + p.y * height }));
	let edge = 0;
	for (let i = 1; i < 3; i++) if (Math.hypot(input[i].x - input[(i + 1) % 3].x, input[i].y - input[(i + 1) % 3].y) > Math.hypot(input[edge].x - input[(edge + 1) % 3].x, input[edge].y - input[(edge + 1) % 3].y)) edge = i;
	const a = input[edge], b = input[(edge + 1) % 3], c = input[(edge + 2) % 3];
	const dx = b.x - a.x, dy = b.y - a.y, sign = dx * (c.y - a.y) - dy * (c.x - a.x) < 0 ? -1 : 1;
	const factor = constraint === "right" ? .5 : Math.sqrt(3) / 2;
	let vertices = [a, b, { x: (a.x + b.x) / 2 - dy * factor * sign, y: (a.y + b.y) / 2 + dx * factor * sign }];
	const minX = Math.min(...vertices.map(p => p.x)), minY = Math.min(...vertices.map(p => p.y));
	const w = Math.max(...vertices.map(p => p.x)) - minX, h = Math.max(...vertices.map(p => p.y)) - minY;
	const scale = Math.min(1, 1 / Math.max(w, 1e-8), aspect / Math.max(h, 1e-8));
	const x = Math.max(0, Math.min(1 - w * scale, minX)), y = Math.max(0, Math.min(aspect - h * scale, minY));
	vertices = vertices.map(p => ({ x: x + (p.x - minX) * scale, y: y + (p.y - minY) * scale }));
	next.start = { ...next.start, x, y: y / aspect }; next.end = { ...next.end, x: x + w * scale, y: (y + h * scale) / aspect };
	next.vertices = vertices.map(p => ({ x: (p.x - x) / Math.max(w * scale, 1e-8), y: (p.y - y) / Math.max(h * scale, 1e-8) }));
	return next;
}
