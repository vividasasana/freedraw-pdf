import type { ShapeOptions, ShapeAnnotation } from "../types";

const finite = (n: unknown, fallback: number, min: number, max: number): number =>
	typeof n === "number" && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
export function normalizeShapeOptions(value?: Partial<ShapeOptions>): ShapeOptions {
	const method = value?.method === "hold" ? "hold" : "drag";
	const choice = value?.shape;
	const shape = choice === "rectangle" || choice === "ellipse" || choice === "triangle" || choice === "line" || choice === "auto" && method === "hold" ? choice : "line";
	const style = (input: ShapeOptions["pen"] | undefined, highlighter: boolean) => ({
		color: typeof input?.color === "string" && /^#[\da-f]{6}$/i.test(input.color) ? input.color : highlighter ? "#ffcb47" : "#ff6b57",
		width: finite(input?.width, highlighter ? 12 : 3, highlighter ? 4 : 1, highlighter ? 64 : 48),
		opacity: finite(input?.opacity, highlighter ? .24 : .96, .05, 1)
	});
	return { method, shape, appearance: value?.appearance === "highlighter" ? "highlighter" : "pen",
		lineStyle: value?.lineStyle === "dashed" || value?.lineStyle === "dotted" || value?.lineStyle === "wavy" ? value.lineStyle : "solid",
		waveSize: finite(value?.waveSize, 1.5, .25, 6), pen: style(value?.pen, false), highlighter: style(value?.highlighter, true) };
}

/** Shape creation stays separate from Pen/Highlighter drawing modes. */
export function normalizeShapeToolOptions(value?: Partial<ShapeOptions>): ShapeOptions {
	const method = value?.method === "drag" ? "drag" : "hold";
	const choice = value?.shape !== "auto" && value?.shape ? value.shape : value?.dragShape;
	const dragShape = choice === "rectangle" || choice === "ellipse" || choice === "triangle" ? choice : "line";
	return { ...normalizeShapeOptions({ ...value, method, shape: method === "hold" ? "auto" : dragShape, appearance: "pen", lineStyle: value?.lineStyle }), dragShape };
}
export function drawAndHoldOptions(value?: Partial<ShapeOptions>): ShapeOptions {
	return normalizeShapeToolOptions({ ...value, method: "hold" });
}

/** Only normalize new optional fields; old records retain their original defaults. */
export function normalizeShapeFields<T extends ShapeAnnotation>(shape: T): T {
	const next = { ...shape };
	if (next.appearance !== "pen" && next.appearance !== "highlighter") delete next.appearance;
	if (next.opacity !== undefined) next.opacity = finite(next.opacity, next.appearance === "highlighter" ? .24 : .96, .05, 1);
	if (next.lineStyle !== undefined && !["solid", "dashed", "dotted", "wavy"].includes(next.lineStyle)) delete next.lineStyle;
	if (next.waveSize !== undefined) next.waveSize = finite(next.waveSize, 1.5, .25, 6);
	if (next.aspectRatio !== undefined) next.aspectRatio = finite(next.aspectRatio, 1, .1, 20);
	if (next.vertices !== undefined) {
		if (!Array.isArray(next.vertices) || next.vertices.length !== 3 || next.vertices.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) delete next.vertices;
		else next.vertices = next.vertices.map(p => ({ x: finite(p.x, 0, 0, 1), y: finite(p.y, 0, 0, 1) }));
	}
	if (next.clippedGeometry !== undefined) {
		const geometry = next.clippedGeometry;
		const pointValid = (point: { x: number; y: number }) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e6 && Math.abs(point.y) <= 1e6;
		if (!geometry || !Array.isArray(geometry.paths) || !Array.isArray(geometry.dots) || geometry.paths.length > 65536 ||
			!geometry.paths.every(path => Array.isArray(path) && path.every(pointValid)) || !geometry.dots.every(pointValid) ||
			geometry.paths.reduce((total, path) => total + path.length, geometry.dots.length) > 65536) delete next.clippedGeometry;
		else next.clippedGeometry = { paths: geometry.paths.map(path => path.map(({ x, y }) => ({ x, y }))), dots: geometry.dots.map(({ x, y }) => ({ x, y })) };
	}
	return next;
}

export function annotationOpacity(item: { tool?: string; appearance?: string; opacity?: number }): number {
	return finite(item.opacity, item.tool === "highlighter" || item.appearance === "highlighter" ? .24 : .96, .05, 1);
}
